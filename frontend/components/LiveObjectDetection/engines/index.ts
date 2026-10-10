import type { DetectorKind } from './kinds';
import type { ObjectDetectorModel } from './runtime';
import { createCocoSsdDetector } from './coco';
import { createSam6Detector } from './sam';
import { createCloudVisionDetector } from './vision';
import { createYoloDetector } from './yolo';

export type { ObjectDetectorModel } from './runtime';
export {
  DETECTOR_OPTIONS,
  detectorHeadline,
  readStoredDetector,
  storeDetector,
  type DetectorKind,
} from './kinds';

const cache = new Map<string, ObjectDetectorModel>();

function cacheKeyFor(kind: DetectorKind, visionEndpoint?: string): string {
  return kind === 'vision' ? `vision:${visionEndpoint || ''}` : kind;
}

export function hasCachedDetector(kind: DetectorKind, visionEndpoint?: string): boolean {
  return cache.has(cacheKeyFor(kind, visionEndpoint));
}

function fallbacksFor(kind: DetectorKind, visionEndpoint?: string): DetectorKind[] {
  const skipVision = !visionEndpoint;
  const chain: DetectorKind[] =
    kind === 'yolo'
      ? ['yolo', 'coco']
      : kind === 'coco'
        ? ['coco', 'yolo']
        : kind === 'sam6'
          ? ['sam6', 'yolo', 'coco']
          : ['vision'];
  return chain.filter((item, index) => chain.indexOf(item) === index && (item !== 'vision' || !skipVision));
}

async function createExactDetector(
  kind: DetectorKind,
  options: { visionEndpoint?: string } = {}
): Promise<ObjectDetectorModel> {
  switch (kind) {
    case 'yolo':
      return createYoloDetector();
    case 'coco':
      return createCocoSsdDetector();
    case 'sam6':
      return createSam6Detector();
    case 'vision':
      if (!options.visionEndpoint) {
        throw new Error('Cloud Vision needs an active project session.');
      }
      return createCloudVisionDetector(options.visionEndpoint);
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown detector: ${exhaustive}`);
    }
  }
}

export async function createDetector(
  kind: DetectorKind,
  options: { visionEndpoint?: string } = {}
): Promise<ObjectDetectorModel> {
  const cacheKey = cacheKeyFor(kind, options.visionEndpoint);
  const cached = cache.get(cacheKey);
  if (cached && cached.kind === kind) return cached;

  let lastError: unknown;
  try {
    const model = await createExactDetector(kind, options);
    cache.set(cacheKey, model);
    return model;
  } catch (error) {
    lastError = error;
  }

  for (const next of fallbacksFor(kind, options.visionEndpoint)) {
    if (next === kind) continue;
    const nextKey = cacheKeyFor(next, options.visionEndpoint);
    const existing = cache.get(nextKey);
    if (existing && existing.kind === next) return existing;
    try {
      const model = await createExactDetector(next, options);
      cache.set(nextKey, model);
      return model;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No detection engine could start on this device.');
}
