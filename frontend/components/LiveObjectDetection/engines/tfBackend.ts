/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The self-hosted TensorFlow.js runtime and where it runs, shared by the custom model (VideoClassifier/engine.ts)
 * and the COCO-SSD detector (engines/coco.ts). Both use the same window.tf, so the backend is global.
 *
 *   webgl  the graphics card (fast; callers check that it computes the right numbers)
 *   wasm   WebAssembly on the processor, with SIMD (and threads only when the page is cross-origin isolated,
 *          which this site is not): 5-10x faster than plain cpu, so laptops without a usable GPU stay smooth
 *   cpu    plain JavaScript (slow; last resort)
 *
 * Everything is served from /models/runtime/tfjs/ (no CDN: the office network may block it). The wasm script and
 * its three .wasm files must be the same version as tf.min.js (4.22.0).
 */

import { loadBrowserUmdScript } from './runtime';

export const TFJS_BASE = '/models/runtime/tfjs/';
export const TFJS_URL = `${TFJS_BASE}tf.min.js`;
export const TFJS_WASM_URL = `${TFJS_BASE}tf-backend-wasm.min.js`;

export type TfBackendName = 'webgl' | 'wasm' | 'cpu';

const tfGlobal = (): any => (typeof window === 'undefined' ? undefined : (window as any).tf);

let runtimeReady: Promise<any> | null = null;
let wasmScript: Promise<boolean> | null = null;

/** Load tf.min.js once (plus the wasm backend script; that one is optional). */
export function loadTfRuntime(): Promise<any> {
  if (!runtimeReady) {
    runtimeReady = (async () => {
      await loadBrowserUmdScript([TFJS_URL], () => Boolean(tfGlobal()?.loadLayersModel && tfGlobal()?.loadGraphModel));
      await loadWasmScript();
      return tfGlobal();
    })().catch((e) => {
      runtimeReady = null;
      throw e;
    });
  }
  return runtimeReady;
}

function loadWasmScript(): Promise<boolean> {
  if (!wasmScript) {
    wasmScript = (async () => {
      if (typeof WebAssembly !== 'object') return false;
      try {
        await loadBrowserUmdScript([TFJS_WASM_URL], () => Boolean(tfGlobal()?.wasm?.setWasmPaths));
        // a prefix ending in '/': the backend picks tfjs-backend-wasm{,-simd,-threaded-simd}.wasm itself
        tfGlobal().wasm.setWasmPaths(TFJS_BASE);
        return true;
      } catch (e) {
        console.warn('[live-object-detection] the WebAssembly backend did not load:', e);
        return false;
      }
    })();
  }
  return wasmScript;
}

/** setBackend that never throws: true when `name` is now the active backend. */
export async function trySetBackend(tf: any, name: TfBackendName): Promise<boolean> {
  try {
    if (name === 'wasm' && !(await loadWasmScript())) return false;
    if (!tf.findBackendFactory?.(name)) return false;
    const ok = await tf.setBackend(name);
    await tf.ready();
    return Boolean(ok) && tf.getBackend() === name;
  } catch {
    return false;
  }
}

let fallbackName: Promise<TfBackendName> | null = null;

/**
 * The best backend that does not need the graphics card: wasm when it starts, else cpu. Leaves it active.
 * The answer is remembered, but the backend is set again on every call.
 */
export async function switchToProcessorBackend(tf: any): Promise<TfBackendName> {
  if (!fallbackName) {
    fallbackName = (async () => ((await trySetBackend(tf, 'wasm')) ? 'wasm' : 'cpu') as TfBackendName)();
  }
  const name = await fallbackName;
  if (tf.getBackend() !== name && !(await trySetBackend(tf, name))) {
    await trySetBackend(tf, 'cpu');
    return 'cpu';
  }
  return name;
}

/** Try webgl first, then wasm, then cpu. Returns the backend now active. */
export async function switchToBestBackend(tf: any): Promise<TfBackendName> {
  if (await trySetBackend(tf, 'webgl')) return 'webgl';
  return switchToProcessorBackend(tf);
}

/** A short description of the wasm features in use (for the console). */
export async function wasmFeatures(tf: any): Promise<string> {
  try {
    const simd = await tf.env().getAsync('WASM_HAS_SIMD_SUPPORT');
    const threads = await tf.env().getAsync('WASM_HAS_MULTITHREAD_SUPPORT');
    return `SIMD ${simd ? 'on' : 'off'}, threads ${threads ? 'on' : 'off'}`;
  } catch {
    return 'features unknown';
  }
}

/** Human name of a backend, for messages. */
export function backendLabel(name: string): string {
  return name === 'webgl' ? 'the graphics card (WebGL)' : name === 'wasm' ? 'the processor (WebAssembly)' : 'the processor (plain JavaScript, slow)';
}

/** Cosine similarity of two equal-length arrays; NaN if either has a non-finite number. */
export function similarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return NaN;
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
