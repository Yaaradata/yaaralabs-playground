import type { Detection } from '../types';
import { boxCoverage } from '../tracker';
import { canonicalClass } from '../labels';
import { finalizeDetections } from '../detectionQuality';
import { loadBrowserUmdScript, smoothDetections, type ObjectDetectorModel } from './runtime';

type TfTensor = {
  shape: number[];
  data: () => Promise<Float32Array | Int32Array | Uint8Array>;
  dispose: () => void;
};

type TfGraph = {
  executeAsync: (input: TfTensor) => Promise<TfTensor | TfTensor[]>;
};

type TfNamespace = {
  setBackend?: (name: string) => Promise<boolean>;
  getBackend?: () => string;
  ready?: () => Promise<void>;
  env?: () => { set: (key: string, value: string | boolean | number) => void };
  tidy?: <T>(fn: () => T) => T;
  zeros?: (shape: number[], dtype?: string) => TfTensor;
  expandDims?: (tensor: TfTensor, axis?: number) => TfTensor;
  loadGraphModel?: (url: string) => Promise<TfGraph>;
  browser?: { fromPixels: (img: HTMLCanvasElement) => TfTensor };
};

type CocoWindow = Window & { tf?: TfNamespace };

const INPUT_SIZE = 300;
const MAX_DETECTIONS = 16;
const MIN_SCORE = 0.28;
const PERSON_SCORE = 0.3;
const NMS_IOU = 0.42;
const NMS_FLOOR = 0.2;
const HANDHELDS = new Set([
  'cell phone',
  'cup',
  'book',
  'bottle',
  'remote',
  'laptop',
  'mouse',
  'keyboard',
  'wine glass',
  'scissors',
  'handbag',
  'backpack',
  'clock',
  'toothbrush',
  'teddy bear',
]);
const BACKGROUND = new Set(['chair', 'couch', 'dining table', 'bed', 'potted plant', 'tv']);
const LOCAL_LITE = '/models/runtime/coco-ssd/ssdlite_mobilenet_v2/model.json';
const CDN_LITE = ['https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json'];

const SSD_CLASS_ID_TO_NAME: Record<number, string> = {
  1: 'person',
  2: 'bicycle',
  3: 'car',
  4: 'motorcycle',
  5: 'airplane',
  6: 'bus',
  7: 'train',
  8: 'truck',
  9: 'boat',
  10: 'traffic light',
  11: 'fire hydrant',
  13: 'stop sign',
  14: 'parking meter',
  15: 'bench',
  16: 'bird',
  17: 'cat',
  18: 'dog',
  19: 'horse',
  20: 'sheep',
  21: 'cow',
  22: 'elephant',
  23: 'bear',
  24: 'zebra',
  25: 'giraffe',
  27: 'backpack',
  28: 'umbrella',
  31: 'handbag',
  32: 'tie',
  33: 'suitcase',
  34: 'frisbee',
  35: 'skis',
  36: 'snowboard',
  37: 'sports ball',
  38: 'kite',
  39: 'baseball bat',
  40: 'baseball glove',
  41: 'skateboard',
  42: 'surfboard',
  43: 'tennis racket',
  44: 'bottle',
  46: 'wine glass',
  47: 'cup',
  48: 'fork',
  49: 'knife',
  50: 'spoon',
  51: 'bowl',
  52: 'banana',
  53: 'apple',
  54: 'sandwich',
  55: 'orange',
  56: 'broccoli',
  57: 'carrot',
  58: 'hot dog',
  59: 'pizza',
  60: 'donut',
  61: 'cake',
  62: 'chair',
  63: 'couch',
  64: 'potted plant',
  65: 'bed',
  67: 'dining table',
  70: 'toilet',
  72: 'tv',
  73: 'laptop',
  74: 'mouse',
  75: 'remote',
  76: 'keyboard',
  77: 'cell phone',
  78: 'microwave',
  79: 'oven',
  80: 'toaster',
  81: 'sink',
  82: 'refrigerator',
  84: 'book',
  85: 'clock',
  86: 'vase',
  87: 'scissors',
  88: 'teddy bear',
  89: 'hair drier',
  90: 'toothbrush',
};

let cocoPromise: Promise<ObjectDetectorModel> | null = null;

function tfGlobal(): TfNamespace | undefined {
  return (window as CocoWindow).tf;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function disposeTensor(tensor: TfTensor | undefined): void {
  try {
    tensor?.dispose();
  } catch {
    // Tensor may already be disposed after a failed run.
  }
}

async function resourceExists(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
    if (head.ok) return true;
  } catch {
    // Some static hosts reject HEAD; fall through to a tiny GET.
  }
  try {
    const response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, cache: 'force-cache' });
    return response.ok;
  } catch {
    return false;
  }
}

async function prepareTfBackend(): Promise<TfNamespace> {
  const tf = tfGlobal();
  if (!tf?.setBackend || !tf.ready || !tf.loadGraphModel || !tf.browser?.fromPixels || !tf.expandDims || !tf.tidy) {
    throw new Error('TensorFlow.js did not start');
  }
  try {
    tf.env?.().set('WEBGL_PACK', true);
    tf.env?.().set('WEBGL_FORCE_F16_TEXTURES', true);
  } catch {
    // Optional WebGL flags; detection still runs without them.
  }
  const ok = await tf.setBackend('webgl');
  await tf.ready();
  if (!ok || tf.getBackend?.() !== 'webgl') {
    throw new Error('COCO needs WebGL. Turn on hardware acceleration in Chrome or Edge.');
  }
  return tf;
}

function asTensorList(value: TfTensor | TfTensor[]): TfTensor[] {
  return Array.isArray(value) ? value : [value];
}

function splitOutputs(result: TfTensor[]): { scores: TfTensor; boxes: TfTensor } {
  if (result.length < 2) {
    throw new Error('COCO model returned an unexpected output');
  }
  const first = result[0];
  const second = result[1];
  const firstIsBoxes = first.shape[first.shape.length - 1] === 4;
  return firstIsBoxes ? { boxes: first, scores: second } : { scores: first, boxes: second };
}

function scoreLayout(shape: number[]): { numBoxes: number; numClasses: number } {
  if (shape.length >= 3) return { numBoxes: shape[1], numClasses: shape[shape.length - 1] };
  if (shape.length === 2) return { numBoxes: shape[0], numClasses: shape[1] };
  throw new Error('COCO score tensor has an unexpected shape');
}

function yxyxIou(boxes: Float32Array, a: number, b: number): number {
  const ay1 = boxes[a * 4];
  const ax1 = boxes[a * 4 + 1];
  const ay2 = boxes[a * 4 + 2];
  const ax2 = boxes[a * 4 + 3];
  const by1 = boxes[b * 4];
  const bx1 = boxes[b * 4 + 1];
  const by2 = boxes[b * 4 + 2];
  const bx2 = boxes[b * 4 + 3];
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

function nmsIndexes(
  boxes: Float32Array,
  scores: number[],
  maxDet: number,
  iouThresh: number,
  scoreThresh: number
): number[] {
  const order = scores
    .map((_, index) => index)
    .filter((index) => scores[index] >= scoreThresh)
    .sort((a, b) => scores[b] - scores[a]);
  const kept: number[] = [];
  order.forEach((index) => {
    if (kept.length >= maxDet) return;
    if (kept.some((other) => yxyxIou(boxes, index, other) >= iouThresh)) return;
    kept.push(index);
  });
  return kept;
}

function maxClassScores(scores: Float32Array, numBoxes: number, numClasses: number): { maxes: number[]; classes: number[] } {
  const maxes = new Array<number>(numBoxes);
  const classes = new Array<number>(numBoxes);
  for (let box = 0; box < numBoxes; box += 1) {
    let best = Number.NEGATIVE_INFINITY;
    let bestClass = -1;
    const offset = box * numClasses;
    for (let cls = 0; cls < numClasses; cls += 1) {
      const value = scores[offset + cls];
      if (value > best) {
        best = value;
        bestClass = cls;
      }
    }
    maxes[box] = best;
    classes[box] = bestClass;
  }
  return { maxes, classes };
}

async function loadLiteGraph(tf: TfNamespace): Promise<TfGraph> {
  const urls = [(await resourceExists(LOCAL_LITE)) ? LOCAL_LITE : '', ...CDN_LITE].filter(Boolean);
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await tf.loadGraphModel!(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('COCO-SSD model failed to start');
}

async function warmup(tf: TfNamespace, graph: TfGraph): Promise<void> {
  const input = tf.zeros ? tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3], 'int32') : undefined;
  if (!input) return;
  let outputs: TfTensor[] = [];
  try {
    outputs = asTensorList(await graph.executeAsync(input));
    await Promise.all(outputs.map((tensor) => tensor.data()));
  } finally {
    disposeTensor(input);
    outputs.forEach(disposeTensor);
  }
}

function letterboxCoco(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  size: number
): { scale: number; padX: number; padY: number } {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(size / vw, size / vh);
  const nw = Math.max(1, Math.round(vw * scale));
  const nh = Math.max(1, Math.round(vh * scale));
  const padX = (size - nw) / 2;
  const padY = (size - nh) / 2;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(video, padX, padY, nw, nh);
  return { scale, padX, padY };
}

export function createCocoSsdDetector(): Promise<ObjectDetectorModel> {
  if (cocoPromise) return cocoPromise;
  cocoPromise = (async () => {
    await loadBrowserUmdScript(
      [
        '/models/runtime/tfjs/tf.min.js',
        'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
        'https://unpkg.com/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
      ],
      () => Boolean(tfGlobal()?.loadGraphModel && tfGlobal()?.browser?.fromPixels)
    );
    await yieldToUi();
    const tf = await prepareTfBackend();
    await yieldToUi();
    const graph = await loadLiteGraph(tf);
    await yieldToUi();
    await warmup(tf, graph);
    const canvas = document.createElement('canvas');
    canvas.width = INPUT_SIZE;
    canvas.height = INPUT_SIZE;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a COCO preprocessing canvas');
    let last: Detection[] = [];
    let busy = false;
    return {
      kind: 'coco',
      detect: async (video: HTMLVideoElement) => {
        if (busy || video.readyState < 2 || video.videoWidth < 8) return last;
        busy = true;
        let batched: TfTensor | undefined;
        let outputs: TfTensor[] = [];
        try {
          const { scale, padX, padY } = letterboxCoco(video, ctx, INPUT_SIZE);
          batched = tf.tidy!(() => tf.expandDims!(tf.browser!.fromPixels(canvas)));
          outputs = asTensorList(await graph.executeAsync(batched));
          const { scores: scoresTensor, boxes: boxesTensor } = splitOutputs(outputs);
          const scoreShape = scoresTensor.shape.slice();
          const [scoreData, boxData] = await Promise.all([scoresTensor.data(), boxesTensor.data()]);
          const { numBoxes, numClasses } = scoreLayout(scoreShape);
          const { maxes, classes } = maxClassScores(scoreData as Float32Array, numBoxes, numClasses);
          const kept = nmsIndexes(boxData as Float32Array, maxes, MAX_DETECTIONS, NMS_IOU, NMS_FLOOR);
          const detections: Detection[] = [];
          kept.forEach((index) => {
            const name = SSD_CLASS_ID_TO_NAME[classes[index] + 1];
            if (!name) return;
            const floor =
              name === 'person'
                ? PERSON_SCORE
                : HANDHELDS.has(name)
                  ? 0.22
                  : BACKGROUND.has(name)
                    ? 0.38
                    : MIN_SCORE;
            if (maxes[index] < floor) return;
            // Boxes are normalized to the letterboxed INPUT_SIZE canvas.
            const y1 = (boxData as Float32Array)[index * 4] * INPUT_SIZE;
            const x1 = (boxData as Float32Array)[index * 4 + 1] * INPUT_SIZE;
            const y2 = (boxData as Float32Array)[index * 4 + 2] * INPUT_SIZE;
            const x2 = (boxData as Float32Array)[index * 4 + 3] * INPUT_SIZE;
            const x = (x1 - padX) / scale;
            const y = (y1 - padY) / scale;
            const width = (x2 - x1) / scale;
            const height = (y2 - y1) / scale;
            if (width < 6 || height < 6) return;
            detections.push({
              class: canonicalClass(name),
              score: maxes[index],
              bbox: [x, y, width, height],
            });
          });
          const people = detections.filter((item) => item.class === 'person');
          const pruned = detections.filter((item) => {
            if (item.class === 'tie' && people.some((person) => boxCoverage(item.bbox, person.bbox) > 0.55)) {
              return false;
            }
            return true;
          });
          last = smoothDetections(
            last,
            finalizeDetections(pruned, {
              maxDet: MAX_DETECTIONS,
              iou: 0.32,
              frameWidth: video.videoWidth,
              frameHeight: video.videoHeight,
            }),
            0.76
          );
          return last;
        } catch {
          return last;
        } finally {
          disposeTensor(batched);
          outputs.forEach(disposeTensor);
          busy = false;
        }
      },
    };
  })().catch((error) => {
    cocoPromise = null;
    throw error;
  });
  return cocoPromise;
}
