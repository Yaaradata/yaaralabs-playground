import { suppressOverlaps } from './engines/runtime';
import { canonicalClass } from './labels';
import type { BBox, Detection } from './types';

/** Desk / hand-held items students commonly show to the camera. */
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
  'toothbrush',
  'hair drier',
  'handbag',
  'backpack',
  'umbrella',
  'suitcase',
  'clock',
  'vase',
  'teddy bear',
]);

const FOOD = new Set([
  'banana',
  'apple',
  'sandwich',
  'orange',
  'broccoli',
  'carrot',
  'hot dog',
  'pizza',
  'donut',
  'cake',
  'bowl',
  'fork',
  'knife',
  'spoon',
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
  'bench',
]);

/**
 * Per-class confidence floor used across YOLO / COCO / Cloud Vision
 * so handheld classroom objects stay visible without drowning in furniture noise.
 */
export function classScoreFloor(className: string): number {
  const key = canonicalClass(className);
  if (key === 'person') return 0.28;
  if (HANDHELDS.has(key)) return 0.2;
  if (FOOD.has(key)) return 0.22;
  if (BACKGROUND.has(key)) return 0.38;
  return 0.24;
}

export function normalizeDetection(item: Detection): Detection {
  return {
    class: canonicalClass(item.class),
    score: Math.max(0, Math.min(1, Number(item.score) || 0)),
    bbox: item.bbox,
  };
}

/** Clamp and reject noisy / near-full-frame boxes so overlays stay sharp. */
export function refineBox(
  bbox: BBox,
  frameWidth?: number,
  frameHeight?: number,
  className = ''
): BBox | null {
  let [x, y, w, h] = bbox;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
    return null;
  }
  if (frameWidth && frameHeight && frameWidth > 0 && frameHeight > 0) {
    x = Math.max(0, Math.min(x, frameWidth - 1));
    y = Math.max(0, Math.min(y, frameHeight - 1));
    w = Math.max(0, Math.min(w, frameWidth - x));
    h = Math.max(0, Math.min(h, frameHeight - y));
    const area = w * h;
    const frameArea = frameWidth * frameHeight;
    if (area / frameArea > 0.9) return null;
    if (area / frameArea < 0.0006 && canonicalClass(className) !== 'person') return null;
  }
  if (w < 6 || h < 6) return null;
  const ratio = w / Math.max(1, h);
  const key = canonicalClass(className);
  if (key !== 'person' && (ratio > 8 || ratio < 0.08)) return null;
  return [x, y, w, h];
}

export function finalizeDetections(
  items: Detection[],
  options: {
    maxDet?: number;
    iou?: number;
    minSide?: number;
    frameWidth?: number;
    frameHeight?: number;
  } = {}
): Detection[] {
  const maxDet = options.maxDet ?? 16;
  const iou = options.iou ?? 0.32;
  const kept = items
    .map(normalizeDetection)
    .map((item) => {
      const box = refineBox(item.bbox, options.frameWidth, options.frameHeight, item.class);
      return box ? { ...item, bbox: box } : null;
    })
    .filter((item): item is Detection => {
      if (!item) return false;
      return item.score >= classScoreFloor(item.class);
    })
    // Prefer people, then higher confidence — sharper primary subject.
    .sort((a, b) => {
      const personBoost = (name: string) => (canonicalClass(name) === 'person' ? 0.08 : 0);
      return b.score + personBoost(b.class) - (a.score + personBoost(a.class));
    });
  return suppressOverlaps(kept, maxDet, iou);
}

export function averageConfidence(items: { score: number }[]): number {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + item.score, 0) / items.length;
}
