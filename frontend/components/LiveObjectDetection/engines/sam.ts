import type { Detection } from '../types';
import { canUseHeavyEngine, canUseWasmSimd, canUseWasmThreads } from '../compat';
import { boxCoverage, iou } from '../tracker';
import { smoothDetections, suppressOverlaps, type ObjectDetectorModel } from './runtime';
import { createYoloDetector } from './yolo';

type SamMask = {
  bbox: Detection['bbox'];
  score: number;
};

type TransformersModule = {
  env?: {
    allowLocalModels?: boolean;
    backends?: { onnx?: { wasm?: { numThreads?: number; simd?: boolean } } };
  };
  SamModel: {
    from_pretrained: (
      modelId: string,
      options?: { quantized?: boolean }
    ) => Promise<{
      (inputs: Record<string, unknown>): Promise<{
        pred_masks: { data: Uint8Array | Float32Array; dims: number[] };
        iou_scores: { data: Float32Array };
      }>;
    }>;
  };
  AutoProcessor: {
    from_pretrained: (modelId: string) => Promise<{
      (image: unknown, options: {
        input_points: number[][][];
        input_labels?: number[][][];
        input_boxes?: number[][][];
      }): Promise<Record<string, unknown> & {
        original_sizes: number[][];
        reshaped_input_sizes: number[][];
      }>;
      post_process_masks: (
        predMasks: unknown,
        originalSizes: unknown,
        reshaped: unknown
      ) => Promise<Array<{ data: Uint8Array | Float32Array; dims: number[] }>>;
    }>;
  };
  RawImage: {
    fromCanvas: (canvas: HTMLCanvasElement) => unknown;
  };
};

const SAM_MODEL = 'Xenova/slimsam-77-uniform';
const SAM_INTERVAL_MS = 320;
const SAM_MAX_WIDTH = 320;
const MAX_PROMPTS = 3;

let samPromise: Promise<ObjectDetectorModel> | null = null;
let frameCanvas: HTMLCanvasElement | null = null;

async function importTransformers(): Promise<TransformersModule> {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm',
    'https://unpkg.com/@xenova/transformers@2.17.2/+esm',
  ];
  const importer = new Function('url', 'return import(url)') as (url: string) => Promise<TransformersModule>;
  let lastError: unknown;
  for (const href of urls) {
    try {
      return await importer(href);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('SAM-6 runtime failed to load');
}

function maskToBox(
  data: Uint8Array | Float32Array,
  dims: number[],
  videoWidth: number,
  videoHeight: number,
  quality = 0.5
): SamMask | null {
  const height = dims[dims.length - 2] || 0;
  const width = dims[dims.length - 1] || 0;
  if (!height || !width) return null;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const plane = height * width;
  const offset = data.length >= plane ? data.length - plane : 0;
  const threshold = data instanceof Float32Array ? 0.35 : 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[offset + y * width + x] > threshold) {
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const area = width * height;
  if (count < area * 0.006 || count > area * 0.68) return null;
  const scaleX = videoWidth / width;
  const scaleY = videoHeight / height;
  const x = minX * scaleX;
  const y = minY * scaleY;
  const w = (maxX - minX + 1) * scaleX;
  const h = (maxY - minY + 1) * scaleY;
  if (w < 12 || h < 12) return null;
  return {
    bbox: [x, y, w, h],
    score: Math.min(0.95, Math.max(0.4, quality)),
  };
}

function promptPoints(named: Detection[], canvasWidth: number, canvasHeight: number, videoWidth: number, videoHeight: number): number[][][] {
  const scaleX = canvasWidth / Math.max(1, videoWidth);
  const scaleY = canvasHeight / Math.max(1, videoHeight);
  const ranked = [...named].sort((a, b) => b.score - a.score).slice(0, MAX_PROMPTS);
  if (!ranked.length) {
    return [[[canvasWidth * 0.5, canvasHeight * 0.52]]];
  }
  return ranked.map((item) => {
    const [x, y, w, h] = item.bbox;
    const clampX = (value: number) => Math.max(1, Math.min(canvasWidth - 1, value * scaleX));
    const clampY = (value: number) => Math.max(1, Math.min(canvasHeight - 1, value * scaleY));
    return [
      [clampX(x + w * 0.5), clampY(y + h * 0.45)],
      [clampX(x + w * 0.5), clampY(y + h * 0.28)],
      [clampX(x + w * 0.35), clampY(y + h * 0.58)],
    ];
  });
}

function promptLabels(count: number): number[][][] {
  return Array.from({ length: count }, () => [[1, 1, 1]]);
}

function promptBoxes(named: Detection[], canvasWidth: number, canvasHeight: number, videoWidth: number, videoHeight: number): number[][][] {
  const scaleX = canvasWidth / Math.max(1, videoWidth);
  const scaleY = canvasHeight / Math.max(1, videoHeight);
  const ranked = [...named].sort((a, b) => b.score - a.score).slice(0, MAX_PROMPTS);
  return ranked.map((item) => {
    const [x, y, w, h] = item.bbox;
    return [[
      Math.max(0, x * scaleX),
      Math.max(0, y * scaleY),
      Math.min(canvasWidth, (x + w) * scaleX),
      Math.min(canvasHeight, (y + h) * scaleY),
    ]];
  });
}

function mergeSamAndYolo(named: Detection[], segments: SamMask[]): Detection[] {
  const used = new Set<number>();
  const merged: Detection[] = named.map((item) => {
    let best = -1;
    let bestScore = 0.18;
    segments.forEach((segment, index) => {
      if (used.has(index)) return;
      const overlap = Math.max(iou(item.bbox, segment.bbox), boxCoverage(segment.bbox, item.bbox));
      if (overlap > bestScore) {
        best = index;
        bestScore = overlap;
      }
    });
    if (best < 0) return item;
    const segment = segments[best];
    const yoloArea = Math.max(1, item.bbox[2] * item.bbox[3]);
    const samArea = segment.bbox[2] * segment.bbox[3];
    const ratio = samArea / yoloArea;
    if (ratio > 2.4 || ratio < 0.28) return item;
    used.add(best);
    const rest = 0.38;
    const amount = 0.62;
    return {
      ...item,
      bbox: [
        item.bbox[0] * rest + segment.bbox[0] * amount,
        item.bbox[1] * rest + segment.bbox[1] * amount,
        item.bbox[2] * rest + segment.bbox[2] * amount,
        item.bbox[3] * rest + segment.bbox[3] * amount,
      ],
      score: Math.max(item.score, segment.score * 0.92),
    };
  });
  return suppressOverlaps(merged, 12, 0.32);
}

export function createSam6Detector(): Promise<ObjectDetectorModel> {
  if (samPromise) return samPromise;
  samPromise = (async () => {
    const yolo = await createYoloDetector();
    if (!canUseHeavyEngine()) {
      return {
        kind: 'sam6',
        detect: async (video: HTMLVideoElement) => suppressOverlaps(await yolo.detect(video), 12, 0.32),
      };
    }
    const segmentRef: { current: ((video: HTMLVideoElement, named: Detection[]) => Promise<SamMask[]>) | null } = {
      current: null,
    };

    void (async () => {
      try {
        const transformers = await importTransformers();
        if (transformers.env) {
          transformers.env.allowLocalModels = false;
          const wasm = transformers.env.backends?.onnx?.wasm;
          if (wasm) {
            wasm.numThreads = canUseWasmThreads() ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
            wasm.simd = canUseWasmSimd();
          }
        }
        const model = await transformers.SamModel.from_pretrained(SAM_MODEL, { quantized: true });
        const processor = await transformers.AutoProcessor.from_pretrained(SAM_MODEL);
        if (!frameCanvas) frameCanvas = document.createElement('canvas');
        segmentRef.current = async (video: HTMLVideoElement, named: Detection[]) => {
          const scale = Math.min(1, SAM_MAX_WIDTH / Math.max(1, video.videoWidth));
          frameCanvas!.width = Math.max(1, Math.round(video.videoWidth * scale));
          frameCanvas!.height = Math.max(1, Math.round(video.videoHeight * scale));
          const ctx = frameCanvas!.getContext('2d', { alpha: false });
          if (!ctx) return [];
          ctx.drawImage(video, 0, 0, frameCanvas!.width, frameCanvas!.height);
          const image = transformers.RawImage.fromCanvas(frameCanvas!);
          const inputPoints = promptPoints(
            named,
            frameCanvas!.width,
            frameCanvas!.height,
            video.videoWidth,
            video.videoHeight
          );
          const inputLabels = promptLabels(inputPoints.length);
          const inputBoxes = promptBoxes(
            named,
            frameCanvas!.width,
            frameCanvas!.height,
            video.videoWidth,
            video.videoHeight
          );
          let inputs: Record<string, unknown> & {
            original_sizes: number[][];
            reshaped_input_sizes: number[][];
          };
          try {
            inputs = await processor(image, {
              input_points: inputPoints,
              input_labels: inputLabels,
              input_boxes: inputBoxes,
            });
          } catch {
            inputs = await processor(image, { input_points: inputPoints, input_labels: inputLabels });
          }
          const outputs = await model(inputs);
          const masks = await processor.post_process_masks(
            outputs.pred_masks,
            inputs.original_sizes,
            inputs.reshaped_input_sizes
          );
          const found: SamMask[] = [];
          masks.forEach((mask, index) => {
            const quality = outputs.iou_scores?.data?.[index] ?? 0.5;
            const box = maskToBox(mask.data, mask.dims, video.videoWidth, video.videoHeight, quality);
            if (box) found.push(box);
          });
          return found;
        };
      } catch {
        segmentRef.current = null;
      }
    })();

    let lastSegments: SamMask[] = [];
    let lastSegAt = 0;
    let segPending: Promise<void> | null = null;
    let last: Detection[] = [];

    return {
      kind: 'sam6',
      detect: async (video: HTMLVideoElement) => {
        const named = await yolo.detect(video);
        const segment = segmentRef.current;
        if (segment && !segPending && Date.now() - lastSegAt > SAM_INTERVAL_MS) {
          segPending = segment(video, named)
            .then((items) => {
              lastSegments = items;
              lastSegAt = Date.now();
            })
            .catch(() => undefined)
            .finally(() => {
              segPending = null;
            });
        }
        last = smoothDetections(last, mergeSamAndYolo(named, lastSegments), 0.7);
        return last;
      },
    };
  })().catch((error) => {
    samPromise = null;
    throw error;
  });
  return samPromise;
}
