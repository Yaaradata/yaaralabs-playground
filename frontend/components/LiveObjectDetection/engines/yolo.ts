import type { Detection } from '../types';
import { boxCoverage } from '../tracker';
import { canUseWasmSimd, canUseWasmThreads, canUseWebGpu, getDeviceTier } from '../compat';
import { canonicalClass } from '../labels';
import { finalizeDetections } from '../detectionQuality';
import { loadScriptFrom, smoothDetections, suppressOverlaps, type ObjectDetectorModel } from './runtime';

type OrtTensor = {
  data: Float32Array | Float64Array | Int32Array;
  dims: number[];
};

type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>;
};

type OrtNamespace = {
  env: {
    wasm: { wasmPaths: string; numThreads: number; simd: boolean; proxy: boolean };
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create: (
      path: string,
      options?: {
        executionProviders?: string[];
        graphOptimizationLevel?: string;
        enableCpuMemArena?: boolean;
        enableMemPattern?: boolean;
      }
    ) => Promise<OrtSession>;
  };
};

type YoloPack = {
  session: OrtSession;
  names: string[];
  inputName: string;
  outputName: string;
};

const ORT_VERSION = '1.21.0';
const ORT_BASES = [
  '/models/runtime/ort/',
  `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`,
  `https://unpkg.com/onnxruntime-web@${ORT_VERSION}/dist/`,
];
const SCORE_THRESHOLD = 0.28;
const PERSON_THRESHOLD = 0.3;
const NMS_IOU = 0.42;
const MAX_DETECTIONS = 16;
const MIN_BOX_AREA = 40;
const SENSITIVE = new Set([
  'person',
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
const BACKGROUND = new Set([
  'chair',
  'couch',
  'dining table',
  'bed',
  'potted plant',
  'toilet',
  'sink',
  'refrigerator',
  'oven',
  'microwave',
  'tv',
]);
const CLOTHING = new Set(['tie']);
const SMALL_MODEL = { url: '/models/yolo/yolov8n.onnx', size: 512 };
const ACCURATE_MODEL = { url: '/models/yolo/yolov8s.onnx', size: 640 };

let cocoPromise: Promise<ObjectDetectorModel> | null = null;

function getOrt(): OrtNamespace {
  const ort = (window as unknown as { ort?: OrtNamespace }).ort;
  if (!ort?.InferenceSession?.create) {
    throw new Error('YOLO runtime failed to initialize');
  }
  return ort;
}

function letterboxVideo(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  input: Float32Array,
  inputSize: number
): { scale: number; padX: number; padY: number } {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(inputSize / vw, inputSize / vh);
  const nw = Math.max(1, Math.round(vw * scale));
  const nh = Math.max(1, Math.round(vh * scale));
  const padX = (inputSize - nw) / 2;
  const padY = (inputSize - nh) / 2;
  ctx.fillStyle = '#727272';
  if (padY > 0) {
    ctx.fillRect(0, 0, inputSize, padY);
    ctx.fillRect(0, padY + nh, inputSize, inputSize - padY - nh);
  }
  if (padX > 0) {
    ctx.fillRect(0, padY, padX, nh);
    ctx.fillRect(padX + nw, padY, inputSize - padX - nw, nh);
  }
  ctx.drawImage(video, padX, padY, nw, nh);
  const pixels = ctx.getImageData(0, 0, inputSize, inputSize).data;
  const plane = inputSize * inputSize;
  const inv = 1 / 255;
  for (let i = 0, px = 0; i < plane; i += 1, px += 4) {
    input[i] = pixels[px] * inv;
    input[plane + i] = pixels[px + 1] * inv;
    input[plane * 2 + i] = pixels[px + 2] * inv;
  }
  return { scale, padX, padY };
}

function decodeYoloOutput(
  tensor: OrtTensor,
  names: string[],
  floors: Float32Array,
  videoWidth: number,
  videoHeight: number,
  scale: number,
  padX: number,
  padY: number
): Detection[] {
  const dims = tensor.dims;
  const data = tensor.data;
  if (dims.length < 2) return [];
  const last = dims[dims.length - 1];
  const mid = dims[dims.length - 2];
  const expectedChannels = names.length + 4;
  let channelFirst = mid < last;
  if (mid === expectedChannels) channelFirst = true;
  else if (last === expectedChannels) channelFirst = false;
  const channels = channelFirst ? mid : last;
  const numPreds = channelFirst ? last : mid;
  const numClasses = channels - 4;
  if (numClasses <= 0 || numPreds <= 0) return [];

  const bestScore = new Float32Array(numPreds);
  const bestClass = new Int32Array(numPreds);
  bestClass.fill(-1);

  if (channelFirst) {
    for (let c = 0; c < numClasses; c += 1) {
      const base = (4 + c) * numPreds;
      const floor = floors[c] || SCORE_THRESHOLD;
      for (let i = 0; i < numPreds; i += 1) {
        const score = data[base + i];
        if (score > floor && score > bestScore[i]) {
          bestScore[i] = score;
          bestClass[i] = c;
        }
      }
    }
  } else {
    for (let i = 0; i < numPreds; i += 1) {
      const row = i * channels + 4;
      let top = 0;
      let topClass = -1;
      for (let c = 0; c < numClasses; c += 1) {
        const score = data[row + c];
        if (score > top) {
          top = score;
          topClass = c;
        }
      }
      if (topClass >= 0 && top >= (floors[topClass] || SCORE_THRESHOLD)) {
        bestScore[i] = top;
        bestClass[i] = topClass;
      }
    }
  }

  const raw: Detection[] = [];
  for (let i = 0; i < numPreds; i += 1) {
    const classId = bestClass[i];
    if (classId < 0) continue;
    const cx = channelFirst ? data[i] : data[i * channels];
    const cy = channelFirst ? data[numPreds + i] : data[i * channels + 1];
    const bw = channelFirst ? data[2 * numPreds + i] : data[i * channels + 2];
    const bh = channelFirst ? data[3 * numPreds + i] : data[i * channels + 3];
    if (bw * bh < MIN_BOX_AREA) continue;
    let x = (cx - bw / 2 - padX) / scale;
    let y = (cy - bh / 2 - padY) / scale;
    let w = bw / scale;
    let h = bh / scale;
    if (x < 0) {
      w += x;
      x = 0;
    }
    if (y < 0) {
      h += y;
      y = 0;
    }
    if (x + w > videoWidth) w = videoWidth - x;
    if (y + h > videoHeight) h = videoHeight - y;
    if (w < 6 || h < 6) continue;
    raw.push({
      class: canonicalClass(names[classId] || `class_${classId}`),
      score: bestScore[i],
      bbox: [x, y, w, h],
    });
  }
  return raw;
}

async function createSession(ort: OrtNamespace, modelUrl: string, useWebGpu: boolean): Promise<OrtSession> {
  if (useWebGpu) {
    try {
      return await ort.InferenceSession.create(modelUrl, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
      });
    } catch {
      // WASM keeps detection running without WebGPU.
    }
  }
  return ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    enableMemPattern: true,
  });
}

function pruneNested(items: Detection[]): Detection[] {
  const people = items.filter((item) => item.class.toLowerCase() === 'person');
  const stripped = items.filter((item) => {
    const name = item.class.toLowerCase();
    if (!people.length || !CLOTHING.has(name)) return true;
    return !people.some((person) => boxCoverage(item.bbox, person.bbox) > 0.55);
  });
  return suppressOverlaps(stripped, MAX_DETECTIONS, NMS_IOU);
}

export function createYoloDetector(): Promise<ObjectDetectorModel> {
  if (cocoPromise) return cocoPromise;
  cocoPromise = (async () => {
    const tier = getDeviceTier();
    const useWebGpu = tier === 'high' && (await canUseWebGpu());
    const fileName = useWebGpu ? 'ort.webgpu.min.js' : 'ort.min.js';
    let wasmBase = ORT_BASES[1];
    try {
      wasmBase = await loadScriptFrom(ORT_BASES.map((base) => `${base}${fileName}`));
    } catch (error) {
      if (!useWebGpu) throw error;
      wasmBase = await loadScriptFrom(ORT_BASES.map((base) => `${base}ort.min.js`));
    }
    const ort = getOrt();
    ort.env.wasm.wasmPaths = wasmBase;
    ort.env.wasm.numThreads = canUseWasmThreads() ? Math.min(tier === 'high' ? 4 : 2, Math.max(1, navigator.hardwareConcurrency || 1)) : 1;
    ort.env.wasm.simd = canUseWasmSimd();
    ort.env.wasm.proxy = false;
    const namesRes = await fetch('/models/yolo/coco-names.json');
    const names = (await namesRes.json()) as string[];
    const floors = new Float32Array(names.length);
    names.forEach((name, index) => {
      const key = name.toLowerCase();
      if (key === 'person') floors[index] = PERSON_THRESHOLD;
      else if (SENSITIVE.has(key)) floors[index] = 0.22;
      else if (BACKGROUND.has(key)) floors[index] = 0.4;
      else floors[index] = SCORE_THRESHOLD;
    });
    // Prefer yolov8s for sharper boxes whenever the device can take it.
    const preferred =
      tier === 'low'
        ? { ...SMALL_MODEL, size: 416 }
        : useWebGpu || tier === 'high'
          ? ACCURATE_MODEL
          : { ...SMALL_MODEL, size: 640 };
    let inputSize = preferred.size;
    let session: OrtSession;
    try {
      session = await createSession(ort, preferred.url, useWebGpu);
    } catch (error) {
      ort.env.wasm.simd = false;
      ort.env.wasm.numThreads = 1;
      try {
        session = await createSession(ort, SMALL_MODEL.url, false);
        inputSize = SMALL_MODEL.size;
      } catch {
        throw error;
      }
    }
    const pack: YoloPack = {
      session,
      names,
      inputName: session.inputNames[0],
      outputName: session.outputNames[0],
    };
    const canvas = document.createElement('canvas');
    canvas.width = inputSize;
    canvas.height = inputSize;
    const ctx =
      canvas.getContext('2d', { willReadFrequently: true, alpha: false }) ||
      canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not create a YOLO preprocessing canvas');
    let input = new Float32Array(3 * inputSize * inputSize);
    let inferEma = 40;
    let lastAdaptAt = 0;
    let last: Detection[] = [];
    const setInputSize = (size: number) => {
      if (size === inputSize) return;
      inputSize = size;
      canvas.width = size;
      canvas.height = size;
      input = new Float32Array(3 * size * size);
    };
    return {
      kind: 'yolo',
      detect: async (video: HTMLVideoElement) => {
        if (video.readyState < 2 || video.videoWidth < 8) return last;
        const started = performance.now();
        const { scale, padX, padY } = letterboxVideo(video, ctx, input, inputSize);
        const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
        const results = await pack.session.run({ [pack.inputName]: tensor });
        const decoded = decodeYoloOutput(
          results[pack.outputName],
          pack.names,
          floors,
          video.videoWidth,
          video.videoHeight,
          scale,
          padX,
          padY
        );
        inferEma = inferEma * 0.72 + (performance.now() - started) * 0.28;
        if (!useWebGpu && performance.now() - lastAdaptAt > 1400) {
          const minSize = tier === 'low' ? 320 : 416;
          if (inferEma > 58 && inputSize > minSize) {
            setInputSize(inputSize === 640 ? 512 : inputSize === 512 ? 416 : 320);
            lastAdaptAt = performance.now();
          } else if (inferEma < 26 && inputSize < (tier === 'low' ? 416 : 640)) {
            setInputSize(inputSize === 320 ? 416 : inputSize === 416 ? 512 : 640);
            lastAdaptAt = performance.now();
          }
        }
        last = smoothDetections(
          last,
          finalizeDetections(pruneNested(decoded), {
            maxDet: MAX_DETECTIONS,
            iou: NMS_IOU,
            frameWidth: video.videoWidth,
            frameHeight: video.videoHeight,
          }),
          0.78
        );
        return last;
      },
    };
  })().catch((error) => {
    cocoPromise = null;
    throw error;
  });
  return cocoPromise;
}
