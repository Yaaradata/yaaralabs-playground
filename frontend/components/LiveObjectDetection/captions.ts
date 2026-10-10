import { formatLabel, withArticleName } from './tracker';
import type { CaptureRecord, Detection, TimelineEvent, TrackedObject } from './types';

const COLOR_MAP: { name: string; r: number; g: number; b: number }[] = [
  { name: 'red', r: 190, g: 40, b: 40 },
  { name: 'orange', r: 220, g: 120, b: 40 },
  { name: 'yellow', r: 220, g: 200, b: 50 },
  { name: 'green', r: 50, g: 150, b: 70 },
  { name: 'blue', r: 40, g: 90, b: 200 },
  { name: 'purple', r: 130, g: 70, b: 180 },
  { name: 'pink', r: 220, g: 110, b: 160 },
  { name: 'brown', r: 120, g: 75, b: 40 },
  { name: 'black', r: 25, g: 25, b: 25 },
  { name: 'white', r: 235, g: 235, b: 235 },
  { name: 'gray', r: 140, g: 140, b: 140 },
];

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

export function sampleObjectColor(
  video: HTMLVideoElement,
  bbox: [number, number, number, number]
): string | null {
  const [x, y, w, h] = bbox;
  if (w < 8 || h < 8) return null;
  const canvas = document.createElement('canvas');
  const sw = 24;
  const sh = 24;
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const insetX = x + w * 0.2;
  const insetY = y + h * 0.2;
  const insetW = w * 0.6;
  const insetH = h * 0.6;
  try {
    ctx.drawImage(video, insetX, insetY, insetW, insetH, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 16) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
    if (!count) return null;
    const avg = { r: r / count, g: g / count, b: b / count };
    const saturation = (Math.max(avg.r, avg.g, avg.b) - Math.min(avg.r, avg.g, avg.b)) / 255;
    if (saturation < 0.12 && (avg.r + avg.g + avg.b) / 3 > 180) return 'white';
    if (saturation < 0.12 && (avg.r + avg.g + avg.b) / 3 < 50) return 'black';
    if (saturation < 0.12) return null;
    let best = COLOR_MAP[0];
    let bestDist = Number.POSITIVE_INFINITY;
    COLOR_MAP.forEach((entry) => {
      const dist = colorDistance(avg, entry);
      if (dist < bestDist) {
        best = entry;
        bestDist = dist;
      }
    });
    return best.name;
  } catch {
    return null;
  }
}

function captionFromDetections(detections: Detection[]): string | null {
  if (!detections.length) return null;
  const people = detections.filter((item) => item.class.toLowerCase() === 'person');
  const objects = detections.filter((item) => item.class.toLowerCase() !== 'person');
  if (people.length && !objects.length) {
    return people.length > 1 ? 'People are in the camera frame.' : 'A person is in the camera frame.';
  }
  if (objects.length === 1 && !people.length) {
    const name = formatLabel(objects[0].class);
    return `${name.replace(/^\w/, (c) => c.toUpperCase())} is in the camera frame.`;
  }
  if (objects.length) {
    const names = objects.slice(0, 3).map((item) => formatLabel(item.class)).join(', ');
    if (people.length) return `Person is interacting with ${names}.`;
    return `Detected ${names} in the scene.`;
  }
  return null;
}

export function buildActionCaption(
  tracks: TrackedObject[],
  recentEvents: TimelineEvent[],
  fallbackDetections: Detection[] = []
): string {
  const present = tracks.filter((track) => track.present);
  const people = present.filter((track) => track.className === 'person');
  const objects = present.filter((track) => track.className !== 'person');
  const latestAction = [...recentEvents].reverse().find((event) => event.kind === 'action');
  if (latestAction) return latestAction.text.endsWith('.') ? latestAction.text : `${latestAction.text}.`;

  const held = objects.find((track) => track.held);
  if (people.length && held) {
    return `Person is holding ${withArticleName(held.className, held.colorName)}.`;
  }

  if (people.length && objects.length) {
    const beside = objects.find((object) => {
      return objects.some(
        (other) =>
          other.id !== object.id &&
          Math.abs(object.cy - other.cy) < Math.max(object.bbox[3], other.bbox[3]) * 0.6 &&
          Math.abs(object.cx - other.cx) < (object.bbox[2] + other.bbox[2]) * 0.9
      );
    });
    if (beside && objects.length >= 2) {
      const other = objects.find((object) => object.id !== beside.id);
      if (other) {
        return `Person places ${withArticleName(beside.className, beside.colorName)} beside ${withArticleName(other.className, other.colorName)}.`;
      }
    }
    const focus = objects[0];
    return `Person is interacting with ${withArticleName(focus.className, focus.colorName)}.`;
  }

  if (people.length && !objects.length) {
    return people.length > 1 ? 'People are in the camera frame.' : 'A person is in the camera frame.';
  }

  if (objects.length === 1) {
    const object = objects[0];
    return `${formatLabel(object.className).replace(/^\w/, (c) => c.toUpperCase())} is in the camera frame.`;
  }

  if (objects.length > 1) {
    const names = objects.slice(0, 3).map((object) => formatLabel(object.className)).join(', ');
    return `Detected ${names} in the scene.`;
  }

  const fromDetections = captionFromDetections(fallbackDetections);
  if (fromDetections) return fromDetections;

  return 'No prominent objects are in view.';
}

export function summarizeCaptureObjects(capture: CaptureRecord): string {
  if (!capture.objects.length) return 'No objects';
  return capture.objects
    .slice(0, 4)
    .map((object) => formatLabel(object.className))
    .join(', ');
}
