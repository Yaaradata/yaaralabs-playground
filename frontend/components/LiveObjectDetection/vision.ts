import type { BBox, Detection } from './types';
import { iou } from './tracker';

export type VisionObject = {
  name: string;
  score: number;
  bbox: BBox;
};

type VisionApiObject = {
  name?: string;
  score?: number;
  box?: number[];
};

function clamp01(value: number): number {
  if (value > 1 && value <= 1000) return value / 1000;
  if (value > 1000) return Math.min(1, value / 1000);
  return Math.min(1, Math.max(0, value));
}

export function geminiBoxToPixel(box: number[], videoWidth: number, videoHeight: number): BBox | null {
  if (box.length < 4) return null;
  const nums = box.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (nums.length < 4) return null;
  let ymin = clamp01(Math.min(nums[0], nums[2]));
  let ymax = clamp01(Math.max(nums[0], nums[2]));
  let xmin = clamp01(Math.min(nums[1], nums[3]));
  let xmax = clamp01(Math.max(nums[1], nums[3]));
  // Mild inset for a tighter visual fit around the subject.
  const padY = (ymax - ymin) * 0.025;
  const padX = (xmax - xmin) * 0.025;
  ymin = Math.min(0.98, Math.max(0, ymin + padY));
  xmin = Math.min(0.98, Math.max(0, xmin + padX));
  ymax = Math.min(1, Math.max(ymin + 0.01, ymax - padY));
  xmax = Math.min(1, Math.max(xmin + 0.01, xmax - padX));
  const width = (xmax - xmin) * videoWidth;
  const height = (ymax - ymin) * videoHeight;
  if (width < 4 || height < 4) return null;
  return [xmin * videoWidth, ymin * videoHeight, width, height];
}

export function parseVisionObjects(
  items: VisionApiObject[] | undefined,
  videoWidth: number,
  videoHeight: number
): VisionObject[] {
  if (!items?.length) return [];
  const parsed: VisionObject[] = [];
  items.forEach((item) => {
    const name = (item.name || '').trim();
    if (!name) return;
    const bbox = geminiBoxToPixel(item.box || [], videoWidth, videoHeight);
    if (!bbox || bbox[2] < 8 || bbox[3] < 8) return;
    parsed.push({
      name,
      score: Math.max(0.05, Math.min(1, item.score ?? 0.85)),
      bbox,
    });
  });
  return parsed;
}

function hasBox(item: VisionObject): boolean {
  return item.bbox[2] > 4 && item.bbox[3] > 4;
}

export function retainLiveVision(yolo: Detection[], vision: VisionObject[]): VisionObject[] {
  if (!vision.length) return [];
  if (!yolo.length) return [];
  return vision.filter((item) => {
    if (!hasBox(item)) return false;
    return yolo.some((candidate) => iou(candidate.bbox, item.bbox) > 0.18);
  });
}

export function mergeVisionAndYolo(yolo: Detection[], vision: VisionObject[]): Detection[] {
  if (!vision.length) return yolo;

  const usedVision = new Set<number>();
  return yolo.map((candidate) => {
    let bestIndex = -1;
    let bestScore = 0.18;
    vision.forEach((item, index) => {
      if (usedVision.has(index) || !hasBox(item)) return;
      const score = iou(candidate.bbox, item.bbox);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex < 0) return candidate;
    usedVision.add(bestIndex);
    return {
      class: vision[bestIndex].name,
      score: Math.max(candidate.score, vision[bestIndex].score),
      bbox: candidate.bbox,
    };
  });
}
