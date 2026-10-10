import type { Detection } from '../types';
import { iou, sameObjectBoxes } from '../tracker';

export type ObjectDetectorModel = {
  kind: string;
  detect: (video: HTMLVideoElement) => Promise<Detection[]>;
};

export async function loadScriptFrom(urls: string[]): Promise<string> {
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      await loadScript(url);
      return url.slice(0, url.lastIndexOf('/') + 1);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`Failed to load ${url}`);
    }
  }
  throw lastError || new Error('Failed to load a detection runtime');
}

export async function loadBrowserUmdScript(urls: string[], isReady: () => boolean): Promise<void> {
  if (isReady()) return;
  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      await loadScriptAsBrowserGlobal(url);
      if (isReady()) return;
      lastError = new Error(`${url} loaded without a browser global`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(`Failed to load ${url}`);
    }
  }
  throw lastError || new Error('Failed to load a detection runtime');
}

function loadScriptAsBrowserGlobal(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const win = window as unknown as { module?: unknown; exports?: unknown; define?: unknown };
    const previous = { module: win.module, exports: win.exports, define: win.define };
    win.module = undefined;
    win.exports = undefined;
    win.define = undefined;
    const restore = () => {
      win.module = previous.module;
      win.exports = previous.exports;
      win.define = previous.define;
    };
    const existing = document.querySelector(`script[data-lod-src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      restore();
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    if (/^https?:\/\//i.test(src)) script.crossOrigin = 'anonymous';
    script.dataset.lodSrc = src;
    script.onload = () => {
      restore();
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => {
      restore();
      reject(new Error(`Failed to load ${src}`));
    };
    document.body.appendChild(script);
  });
}

export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lod-src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    if (/^https?:\/\//i.test(src)) script.crossOrigin = 'anonymous';
    script.dataset.lodSrc = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

let jpegCanvas: HTMLCanvasElement | null = null;
let jpegCtx: CanvasRenderingContext2D | null = null;

export function grabJpeg(video: HTMLVideoElement, maxWidth = 360, quality = 0.52): string {
  if (!jpegCanvas) jpegCanvas = document.createElement('canvas');
  if (!jpegCtx) {
    jpegCtx = jpegCanvas.getContext('2d', { alpha: false });
  }
  if (!jpegCtx) return '';
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  jpegCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  jpegCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  jpegCtx.drawImage(video, 0, 0, jpegCanvas.width, jpegCanvas.height);
  try {
    return jpegCanvas.toDataURL('image/jpeg', quality);
  } catch {
    try {
      return jpegCanvas.toDataURL('image/jpeg');
    } catch {
      return jpegCanvas.toDataURL('image/png');
    }
  }
}

export function nms(items: Detection[], iouThresh: number, maxDet: number): Detection[] {
  return suppressOverlaps(items, maxDet, iouThresh);
}

export function suppressOverlaps(items: Detection[], maxDet = 12, iouThresh = 0.3): Detection[] {
  const ranked = [...items].sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  ranked.forEach((item) => {
    if (kept.length >= maxDet) return;
    if (kept.some((other) => isDuplicateDetection(other, item, iouThresh))) return;
    kept.push(item);
  });
  return kept;
}

export function isDuplicateDetection(a: Detection, b: Detection, iouThresh = 0.3): boolean {
  const nameA = a.class.toLowerCase();
  const nameB = b.class.toLowerCase();
  if (nameA !== nameB) return iou(a.bbox, b.bbox) >= 0.84;
  if (sameObjectBoxes(a.bbox, b.bbox, nameA === 'person')) return true;
  return iou(a.bbox, b.bbox) >= iouThresh;
}

export function smoothDetections(prev: Detection[], next: Detection[], alpha = 0.7): Detection[] {
  if (!prev.length || !next.length) return next;
  const used = new Set<number>();
  return next.map((item) => {
    let best = -1;
    let bestScore = 0.22;
    const className = item.class.toLowerCase();
    prev.forEach((candidate, index) => {
      if (used.has(index) || candidate.class.toLowerCase() !== className) return;
      const score = iou(candidate.bbox, item.bbox);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best < 0) return item;
    used.add(best);
    const prior = prev[best].bbox;
    // Bias toward the newest box when overlap is strong so edges stay sharp.
    const blend = bestScore > 0.5 ? Math.min(0.92, alpha + 0.12) : Math.min(0.82, alpha);
    const rest = 1 - blend;
    return {
      class: item.class,
      score: prev[best].score * 0.18 + item.score * 0.82,
      bbox: [
        prior[0] * rest + item.bbox[0] * blend,
        prior[1] * rest + item.bbox[1] * blend,
        prior[2] * rest + item.bbox[2] * blend,
        prior[3] * rest + item.bbox[3] * blend,
      ],
    };
  });
}
