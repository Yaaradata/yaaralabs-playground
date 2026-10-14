/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Teachable Machine's image engine, rebuilt on the self-hosted TensorFlow.js 4.22 global
 * (frontend/public/models/runtime/tfjs). Behaviour follows googlecreativelab/teachablemachine-community
 * libraries/image/src (custom-mobilenet.ts, teachable-mobilenet.ts, utils/tf.ts, utils/canvas.ts):
 *
 *   extractor  MobileNet v2, width 0.35, 224 px, cut at 'out_relu' + GlobalAveragePooling -> 1280 numbers
 *              (self-hosted copy of TM's checkpoint: /models/runtime/tm-mobilenet-v2-035)
 *   input      centre crop to 224 (cropTo), pixels / 127 - 1 (capture)
 *   head       Dense(100, relu, varianceScaling) -> Dense(classes, softmax, no bias, varianceScaling)
 *   training   Adam, categorical cross-entropy, accuracy; per class ceil(15%) held out for validation
 *   export     one Sequential [extractor, head] + TM metadata.json, so tmImage.load() can read it
 *
 * Everything runs in the browser. Embeddings are plain Float32Arrays (not tensors), computed once
 * per sample, so training only fits the small head.
 */

import {
  TFJS_URL,
  backendLabel,
  loadTfRuntime,
  similarity,
  switchToBestBackend,
  switchToProcessorBackend,
  wasmFeatures,
} from '../LiveObjectDetection/engines/tfBackend';

export const IMAGE_SIZE = 224;
export { TFJS_URL };
export const CHECKPOINT_URL = '/models/runtime/tm-mobilenet-v2-035/model.json';
export const TRAINING_LAYER = 'out_relu';
export const VALIDATION_FRACTION = 0.15;
export const DENSE_UNITS = 100;
export const TM_VERSION = '2.4.10'; // the Teachable Machine release whose metadata this matches
export const APP_VERSION = 'yaaralabs-playground/live-object-detection@1';

export interface TrainParams {
  epochs: number;
  batchSize: number;
  learningRate: number;
}
export const DEFAULT_PARAMS: TrainParams = { epochs: 50, batchSize: 16, learningRate: 0.001 };

export interface EpochLog {
  epoch: number;
  acc: number;
  loss: number;
  valAcc: number | null;
  valLoss: number | null;
}

export interface TrainResult {
  history: EpochLog[];
  perClass: { label: string; correct: number; total: number }[];
  confusion: number[][]; // [actual][predicted], validation samples
  valAccuracy: number | null;
  validationCount: number;
}

type Tf = any;

let tfReady: Promise<Tf> | null = null;
let extractorReady: Promise<any> | null = null;
/** Where the model runs on this computer, and why (shown in the console and kept for support). */
export const computeInfo: { backend: string; note: string } = { backend: '', note: '' };

/**
 * Load the self-hosted TensorFlow.js once (no CDN fallback: the office network may block it) and pick where it
 * runs: the graphics card (WebGL) when it starts, else WebAssembly on the processor, else plain JavaScript.
 * checkGraphics() later moves off WebGL if it computes wrong numbers on this laptop.
 */
export function loadTf(): Promise<Tf> {
  if (tfReady) return tfReady.then(keepBackend);
  tfReady = (async () => {
    const tf = await loadTfRuntime();
    await switchToBestBackend(tf);
    return tf;
  })().catch((e) => {
    tfReady = null;
    throw e;
  });
  return tfReady;
}

/** The pretrained COCO detector shares window.tf and may have switched the backend: switch back to ours. */
async function keepBackend(tf: Tf): Promise<Tf> {
  const want = computeInfo.backend;
  if (want && tf.getBackend() !== want) {
    try {
      await tf.setBackend(want);
    } catch {
      /* keep whatever runs */
    }
  }
  return tf;
}

/** TM's truncated MobileNet: base model up to 'out_relu', then GlobalAveragePooling2D. Loaded once. */
export function loadExtractor(): Promise<any> {
  if (!extractorReady) {
    extractorReady = (async () => {
      const tf = await loadTf();
      const mobilenet = await tf.loadLayersModel(CHECKPOINT_URL);
      const layer = mobilenet.getLayer(TRAINING_LAYER);
      const truncated = tf.model({ inputs: mobilenet.inputs, outputs: layer.output });
      const extractor = tf.sequential();
      extractor.add(truncated);
      extractor.add(tf.layers.globalAveragePooling2d({}));
      // warm up: the first predict compiles the shaders
      tf.tidy(() => extractor.predict(tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3])));
      await checkGraphics(tf, extractor);
      return extractor;
    })().catch((e) => {
      extractorReady = null;
      throw e;
    });
  }
  return extractorReady;
}

/**
 * Some laptops start WebGL but compute wrong numbers (low-precision textures, driver bugs): every frame then
 * gives the same features and the model sticks on one class. Run the model on a fixed test picture on the
 * graphics card and on the processor (WebAssembly, else plain JavaScript); if the two disagree, or the result
 * is broken, keep the processor.
 */
let graphicsChecked = false;
async function checkGraphics(tf: Tf, model: any) {
  if (graphicsChecked) return;
  graphicsChecked = true;
  const current = tf.getBackend();
  if (current !== 'webgl') {
    const extra = current === 'wasm' ? ` (${await wasmFeatures(tf)})` : '';
    computeInfo.backend = current;
    computeInfo.note = `WebGL is not available: the model runs on ${backendLabel(current)}${extra}.`;
    console.info('[live-object-detection]', computeInfo.note);
    return;
  }
  // a smooth colour pattern in [-1, 1], the same on every computer
  const px = new Float32Array(IMAGE_SIZE * IMAGE_SIZE * 3);
  for (let y = 0; y < IMAGE_SIZE; y++) {
    for (let x = 0; x < IMAGE_SIZE; x++) {
      const k = (y * IMAGE_SIZE + x) * 3;
      px[k] = Math.sin(x / 17) * 0.9;
      px[k + 1] = Math.cos(y / 23) * 0.9;
      px[k + 2] = ((x + y) / IMAGE_SIZE) - 1;
    }
  }
  const picture = () => tf.tensor4d(px, [1, IMAGE_SIZE, IMAGE_SIZE, 3]);
  const run = () => tf.tidy(() => model.predict(picture()).dataSync() as Float32Array).slice();
  let reason = '';
  let score = '';
  let reference = 'cpu';
  try {
    const gpu = run();
    reference = await switchToProcessorBackend(tf);
    const ref = run();
    let ng = 0;
    for (let i = 0; i < gpu.length; i++) ng += gpu[i] * gpu[i];
    const sim = similarity(gpu, ref);
    score = sim.toFixed(4);
    if (Number.isNaN(sim)) reason = 'the graphics card gave broken numbers';
    else if (ng === 0) reason = 'the graphics card gave all zeros';
    else if (sim < 0.98) reason = `the graphics card's result differs from the processor's (similarity ${sim.toFixed(3)})`;
  } catch (e) {
    reason = `the graphics check failed (${e instanceof Error ? e.message : String(e)})`;
  }
  if (reason) {
    const name = await switchToProcessorBackend(tf);
    computeInfo.backend = name;
    const extra = name === 'wasm' ? ` (${await wasmFeatures(tf)})` : '';
    computeInfo.note = `On this computer ${reason}, so the model runs on ${backendLabel(name)}${extra}: slower, but correct.`;
    console.warn('[live-object-detection]', computeInfo.note);
  } else {
    await tf.setBackend('webgl');
    computeInfo.backend = 'webgl';
    computeInfo.note = `The model runs on the graphics card (check: similarity ${score} with ${reference}).`;
    console.info('[live-object-detection]', computeInfo.note);
  }
}

/**
 * True when the camera picture is blank: black, one flat colour, or covered (a privacy shutter, or another app
 * such as Teams holding the camera). The model then sees the same picture every time and sticks on one class.
 */
export function blankFrame(source: HTMLVideoElement | HTMLCanvasElement, canvas = document.createElement('canvas')): boolean {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!w || !h) return true;
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let sum = 0, sq = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    sum += l;
    sq += l * l;
  }
  const n = d.length / 4;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  return std < 3 || mean < 8;
}

export const BLANK_CAMERA =
  'The camera picture is blank or covered. Open the camera shutter, close other apps using the camera (Teams, Zoom), then try again.';
export const PREDICT_FAILING =
  'The model stopped working on this computer (often the graphics card ran out of memory). Reload the page (Ctrl + Shift + R).';

type Drawable = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap;

/** TM cropTo: scale the short side to `size`, centre crop; optional horizontal flip (webcam mirror). */
export function cropTo(image: Drawable, size = IMAGE_SIZE, flipped = false, canvas = document.createElement('canvas')) {
  let width = (image as HTMLImageElement).naturalWidth || image.width;
  let height = (image as HTMLImageElement).naturalHeight || image.height;
  if (image instanceof HTMLVideoElement) {
    width = image.videoWidth;
    height = image.videoHeight;
  }
  const min = Math.min(width, height);
  const scale = size / min;
  const scaledW = Math.ceil(width * scale);
  const scaledH = Math.ceil(height * scale);
  const dx = scaledW - size;
  const dy = scaledH - size;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, ~~(dx / 2) * -1, ~~(dy / 2) * -1, scaledW, scaledH);
  if (flipped) {
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, size * -1, 0);
  }
  return canvas;
}

/** TM capture: pixels, centre square, batch of 1, scaled to [-1, 1] by / 127 - 1. */
function capture(tf: Tf, raster: HTMLCanvasElement) {
  return tf.tidy(() => {
    const pixels = tf.browser.fromPixels(raster);
    const size = Math.min(pixels.shape[0], pixels.shape[1]);
    const top = pixels.shape[0] / 2 - size / 2;
    const left = pixels.shape[1] / 2 - size / 2;
    const cropped = pixels.slice([top, left, 0], [size, size, 3]);
    return cropped.expandDims(0).toFloat().div(tf.scalar(127)).sub(tf.scalar(1));
  });
}

/** One 224 px sample: the thumbnail (JPEG data URL) and its 1280-number embedding. */
export async function embed(source: Drawable, flipped = false): Promise<{ thumb: string; embedding: Float32Array }> {
  const tf = await loadTf();
  const extractor = await loadExtractor();
  const canvas = cropTo(source, IMAGE_SIZE, flipped);
  const thumb = canvas.toDataURL('image/jpeg', 0.85);
  const embedding = tf.tidy(() => extractor.predict(capture(tf, canvas)).dataSync() as Float32Array).slice();
  return { thumb, embedding };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // other origins (signed GCS URLs) must allow reading the pixels
    if (/^https?:/i.test(src) && !src.startsWith(window.location.origin)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

export async function fileToImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    await img.decode().catch(() => undefined);
    return img;
  } finally {
    // the image keeps its pixels after load; revoke on the next tick
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function shuffle<T>(a: T[]): T[] {
  const s = a.slice();
  for (let i = s.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]];
  }
  return s;
}

/**
 * Fit TM's head on the embeddings. `classes[i]` holds class i's embeddings. Per class, ceil(15%)
 * is held out for validation (a class with a single sample keeps it for training, otherwise it would
 * have nothing to learn from). Yields to the page between epochs.
 */
export async function trainHead(
  classes: { label: string; embeddings: Float32Array[] }[],
  params: TrainParams,
  onEpoch: (log: EpochLog) => void,
): Promise<{ head: any; result: TrainResult }> {
  const tf = await loadTf();
  const n = classes.length;
  const train: { x: Float32Array; y: number }[] = [];
  const val: { x: Float32Array; y: number }[] = [];
  classes.forEach((c, y) => {
    const s = shuffle(c.embeddings);
    let numVal = Math.ceil(VALIDATION_FRACTION * s.length);
    if (s.length - numVal < 1) numVal = 0;
    s.slice(0, s.length - numVal).forEach((x) => train.push({ x, y }));
    s.slice(s.length - numVal).forEach((x) => val.push({ x, y }));
  });
  const trainSet = shuffle(train);
  const valSet = shuffle(val);
  const inputSize = classes[0].embeddings[0].length;

  const toTensors = (set: { x: Float32Array; y: number }[]) => {
    const flat = new Float32Array(set.length * inputSize);
    set.forEach((s, i) => flat.set(s.x, i * inputSize));
    const xs = tf.tensor2d(flat, [set.length, inputSize]);
    const ys = tf.tidy(() => tf.oneHot(tf.tensor1d(set.map((s) => s.y), 'int32'), n).toFloat());
    return { xs, ys };
  };

  const head = tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [inputSize], units: DENSE_UNITS, activation: 'relu', kernelInitializer: 'varianceScaling', useBias: true }),
      tf.layers.dense({ units: n, activation: 'softmax', kernelInitializer: 'varianceScaling', useBias: false }),
    ],
  });
  const optimizer = tf.train.adam(params.learningRate);
  head.compile({ optimizer, loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

  const t = toTensors(trainSet);
  const v = valSet.length ? toTensors(valSet) : null;
  const history: EpochLog[] = [];
  try {
    await head.fit(t.xs, t.ys, {
      epochs: params.epochs,
      batchSize: params.batchSize,
      shuffle: true,
      validationData: v ? [v.xs, v.ys] : undefined,
      callbacks: {
        onEpochEnd: async (epoch: number, logs: Record<string, number>) => {
          const log: EpochLog = {
            epoch: epoch + 1,
            acc: logs.acc ?? logs.accuracy ?? 0,
            loss: logs.loss ?? 0,
            valAcc: v ? logs.val_acc ?? logs.val_accuracy ?? null : null,
            valLoss: v ? logs.val_loss ?? null : null,
          };
          history.push(log);
          onEpoch(log);
          await tf.nextFrame();
        },
      },
    });
  } finally {
    t.xs.dispose();
    t.ys.dispose();
    optimizer.dispose();
  }

  // per-class accuracy and confusion matrix on the validation samples
  const confusion = Array.from({ length: n }, () => new Array(n).fill(0));
  if (v) {
    const top = tf.tidy(() => head.predict(v.xs).argMax(1));
    const predicted: number[] = Array.from(top.dataSync() as Int32Array);
    top.dispose();
    valSet.forEach((s, i) => (confusion[s.y][predicted[i]] += 1));
    v.xs.dispose();
    v.ys.dispose();
  }
  const perClass = classes.map((c, i) => ({
    label: c.label,
    correct: confusion[i][i],
    total: confusion[i].reduce((a, b) => a + b, 0),
  }));
  const right = perClass.reduce((a, c) => a + c.correct, 0);
  return {
    head,
    result: {
      history,
      perClass,
      confusion,
      valAccuracy: valSet.length ? right / valSet.length : null,
      validationCount: valSet.length,
    },
  };
}

/** Probabilities for every class: crop -> extractor -> head (or a loaded combined model). */
export async function predict(source: Drawable, model: { head?: any; combined?: any }, flipped = false): Promise<number[]> {
  const tf = await loadTf();
  const canvas = cropTo(source, IMAGE_SIZE, flipped);
  if (model.combined) {
    return Array.from(tf.tidy(() => model.combined.predict(capture(tf, canvas)).dataSync() as Float32Array));
  }
  const extractor = await loadExtractor();
  return Array.from(tf.tidy(() => model.head.predict(extractor.predict(capture(tf, canvas))).dataSync() as Float32Array));
}

/** The combined model for export: Sequential [extractor, head], the same shape TM saves. Shares layers. */
export async function combinedModel(head: any): Promise<any> {
  const tf = await loadTf();
  const extractor = await loadExtractor();
  const joint = tf.sequential();
  joint.add(extractor);
  joint.add(head);
  return joint;
}

export interface TmMetadata {
  tfjsVersion: string;
  tmVersion: string;
  packageVersion: string;
  packageName: string;
  modelName: string;
  timeStamp: string;
  labels: string[];
  userMetadata: Record<string, unknown>;
  grayscale: boolean;
  imageSize: number;
  // our fields
  classes?: { label: string; color: string }[];
  training?: TrainParams & { denseUnits: number; validationFraction: number };
  validationAccuracy?: number | null;
  created_at?: string;
  appVersion?: string;
}

export interface ModelFiles {
  'model.json': Blob;
  'weights.bin': Blob;
  'metadata.json': Blob;
}

/** model.json + weights.bin + metadata.json, captured with tf.io.withSaveHandler (TM's file layout). */
export async function exportFiles(joint: any, metadata: TmMetadata): Promise<ModelFiles> {
  const tf = await loadTf();
  let artifacts: any = null;
  await joint.save(
    tf.io.withSaveHandler(async (a: any) => {
      artifacts = a;
      return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
    }),
  );
  const weightData: ArrayBuffer = Array.isArray(artifacts.weightData)
    ? concatBuffers(artifacts.weightData as ArrayBuffer[])
    : (artifacts.weightData as ArrayBuffer);
  const modelJson = {
    modelTopology: artifacts.modelTopology,
    format: artifacts.format ?? 'layers-model',
    generatedBy: artifacts.generatedBy ?? `TensorFlow.js tfjs-layers v${tf.version_layers ?? tf.version?.['tfjs-layers'] ?? ''}`,
    convertedBy: artifacts.convertedBy ?? null,
    weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
  };
  return {
    'model.json': new Blob([JSON.stringify(modelJson)], { type: 'application/json' }),
    'weights.bin': new Blob([weightData], { type: 'application/octet-stream' }),
    'metadata.json': new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  };
}

function concatBuffers(parts: ArrayBuffer[]): ArrayBuffer {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), o);
    o += p.byteLength;
  }
  return out.buffer;
}

export async function buildMetadata(
  name: string,
  classes: { label: string; color: string }[],
  params: TrainParams,
  valAccuracy: number | null,
): Promise<TmMetadata> {
  const tf = await loadTf();
  const now = new Date().toISOString();
  return {
    tfjsVersion: String(tf.version?.tfjs ?? tf.version_core ?? '4.22.0'),
    tmVersion: TM_VERSION,
    packageVersion: '0.8.4',
    packageName: '@teachablemachine/image',
    modelName: name || 'tm-my-image-model',
    timeStamp: now,
    labels: classes.map((c) => c.label),
    userMetadata: {},
    grayscale: false,
    imageSize: IMAGE_SIZE,
    classes,
    training: { ...params, denseUnits: DENSE_UNITS, validationFraction: VALIDATION_FRACTION },
    validationAccuracy: valAccuracy,
    created_at: now,
    appVersion: APP_VERSION,
  };
}

/** Load a saved combined model; `urlFor` maps each file name (model.json, weights.bin) to its URL. */
export async function loadCombined(urlFor: (name: string) => string): Promise<any> {
  const tf = await loadTf();
  const model = await tf.loadLayersModel(urlFor('model.json'), {
    weightUrlConverter: async (weightFileName: string) => urlFor(weightFileName.split('/').pop() || weightFileName),
  });
  await checkGraphics(tf, model);
  return model;
}

export async function tensorCount(): Promise<number> {
  const tf = await loadTf();
  return tf.memory().numTensors;
}

export function disposeModel(m: any) {
  try {
    m?.dispose?.();
  } catch {
    /* already disposed */
  }
}
