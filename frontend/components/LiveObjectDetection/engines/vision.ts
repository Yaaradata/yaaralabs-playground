import type { Detection } from '../types';
import { finalizeDetections } from '../detectionQuality';
import { canonicalClass } from '../labels';
import { geminiBoxToPixel } from '../vision';
import { smoothDetections, type ObjectDetectorModel } from './runtime';

type DetectResponse = {
  objects?: { name?: string; score?: number; box?: number[] }[];
  success?: boolean;
};

// Up to two frames in flight, one every 250 ms: boxes update about twice as often as one-at-a-time
// (each answer takes a Cloud Vision round trip). The server allows 6 detects a second per session.
const MIN_INTERVAL_MS = 250;
const MAX_IN_FLIGHT = 2;
const JPEG_WIDTH = 720;
const JPEG_QUALITY = 0.82;
const MAX_DETECTIONS = 16;
const EMPTY_COAST_MS = 1400;
const MIN_VISION_SCORE = 0.16;

let visionCanvas: HTMLCanvasElement | null = null;
let visionCtx: CanvasRenderingContext2D | null = null;

function grabVisionJpeg(video: HTMLVideoElement): string {
  if (!visionCanvas) visionCanvas = document.createElement('canvas');
  if (!visionCtx) {
    visionCtx = visionCanvas.getContext('2d', { alpha: false });
  }
  if (!visionCtx) return '';
  const scale = Math.min(1, JPEG_WIDTH / Math.max(1, video.videoWidth));
  visionCanvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  visionCanvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    visionCtx.drawImage(video, 0, 0, visionCanvas.width, visionCanvas.height);
    return visionCanvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } catch {
    try {
      return visionCanvas.toDataURL('image/jpeg');
    } catch {
      return '';
    }
  }
}

function parseObjects(
  payload: DetectResponse,
  frameWidth: number,
  frameHeight: number
): Detection[] {
  const detections: Detection[] = [];
  (payload.objects || []).forEach((item) => {
    const name = (item.name || '').trim();
    if (!name) return;
    const score = Math.max(0.05, Math.min(1, item.score ?? 0.7));
    if (score < MIN_VISION_SCORE) return;
    const bbox = geminiBoxToPixel(item.box || [], frameWidth, frameHeight);
    // Skip label-only hits with no usable box — keeps overlays sharp and truthful.
    if (!bbox) return;
    detections.push({
      class: canonicalClass(name),
      score,
      bbox,
    });
  });
  return finalizeDetections(detections, {
    maxDet: MAX_DETECTIONS,
    iou: 0.28,
    frameWidth,
    frameHeight,
  });
}

export function createCloudVisionDetector(endpoint: string): ObjectDetectorModel {
  let last: Detection[] = [];
  let inFlight = 0;
  let first: Promise<void> | null = null;
  let lastSentAt = 0;
  let lastHitAt = 0;
  let sent = 0;
  let applied = 0;

  const run = async (video: HTMLVideoElement, seq: number) => {
    const frameWidth = video.videoWidth;
    const frameHeight = video.videoHeight;
    const imageBase64 = grabVisionJpeg(video);
    if (!imageBase64) return;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64 }),
    });
    if (response.status === 429) return;
    if (!response.ok) {
      throw new Error(`Cloud Vision detect failed (${response.status})`);
    }
    const payload = (await response.json()) as DetectResponse;
    if (seq < applied) return; // a newer frame already answered: don't move boxes back in time
    applied = seq;
    const next = parseObjects(payload, frameWidth, frameHeight);
    if (next.length) {
      last = smoothDetections(last, next, 0.72);
      lastHitAt = Date.now();
      return;
    }
    if (Date.now() - lastHitAt > EMPTY_COAST_MS) {
      last = [];
    }
  };

  return {
    kind: 'vision',
    detect: async (video: HTMLVideoElement) => {
      if (video.readyState < 2 || video.videoWidth < 8) return last;
      const now = Date.now();
      if (inFlight < MAX_IN_FLIGHT && now - lastSentAt >= MIN_INTERVAL_MS) {
        lastSentAt = now;
        inFlight += 1;
        const request = run(video, ++sent)
          .catch(() => undefined)
          .finally(() => {
            inFlight -= 1;
          });
        if (!last.length) first = request;
      }
      // Nothing on screen yet: wait for an answer so the first boxes appear as soon as they can.
      if (first && !last.length) {
        await first;
        first = null;
      }
      return last;
    },
  };
}
