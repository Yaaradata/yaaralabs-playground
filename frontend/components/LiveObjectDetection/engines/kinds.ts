export type DetectorKind = 'yolo' | 'coco' | 'sam6' | 'vision';

export type DetectorOption = {
  id: DetectorKind;
  title: string;
  blurb: string;
  speed: string;
};

export const DEFAULT_DETECTOR: DetectorKind = 'vision';

export const DETECTOR_OPTIONS: DetectorOption[] = [
  {
    id: 'vision',
    title: 'Cloud Vision',
    blurb: 'Google Cloud Vision localizes a wide set of names. Live boxes stay smooth.',
    speed: 'Accurate',
  },
  {
    id: 'yolo',
    title: 'YOLO',
    blurb: 'YOLOv8n in WebGPU/WASM. Tight boxes, 80 COCO names, smoothed live tracks.',
    speed: 'Fastest',
  },
  {
    id: 'coco',
    title: 'COCO',
    blurb: 'TensorFlow.js MobileNet SSD on WebGL (WebAssembly without a GPU). Local, quick, and stable.',
    speed: 'Fast',
  },
  {
    id: 'sam6',
    title: 'SAM-6',
    blurb: 'YOLO names the objects; SlimSAM tightens each box to the real silhouette.',
    speed: 'Medium',
  },
];

export function isDetectorKind(value: string): value is DetectorKind {
  return DETECTOR_OPTIONS.some((option) => option.id === value);
}

export function readStoredDetector(): DetectorKind {
  return DEFAULT_DETECTOR;
}

export function storeDetector(_kind: DetectorKind): void {
  // Engine choice is session-only so Cloud Vision stays the default on every open.
}

export function detectorHeadline(kind: DetectorKind): string {
  switch (kind) {
    case 'yolo':
      return 'YOLO boxes';
    case 'coco':
      return 'COCO-SSD boxes';
    case 'sam6':
      return 'SAM-6 segments';
    case 'vision':
      return 'Cloud Vision boxes';
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function detectorTitle(kind: string): string {
  const option = DETECTOR_OPTIONS.find((entry) => entry.id === kind);
  return option?.title ?? kind;
}
