export type BBox = [number, number, number, number];

export type Detection = {
  class: string;
  score: number;
  bbox: BBox;
};

export type CameraStatus = 'idle' | 'starting' | 'active' | 'stopped' | 'error';

export type TrackedObject = {
  id: string;
  className: string;
  displayName: string | null;
  colorName: string | null;
  bbox: BBox;
  score: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  firstSeenAt: number;
  lastSeenAt: number;
  missingFrames: number;
  present: boolean;
  held: boolean;
};

export type TimelineKind = 'enter' | 'leave' | 'action' | 'caption';

export type TimelineEvent = {
  id: string;
  at: number;
  kind: TimelineKind;
  text: string;
};

export type CaptureObject = {
  className: string;
  score: number;
  colorName: string | null;
  /** Pixel bbox [x, y, w, h] in the source video frame for model comparison / retrain. */
  bbox: BBox | null;
};

export type CaptureRecord = {
  id: string;
  at: number;
  imageDataUrl: string;
  objects: CaptureObject[];
  caption: string;
  captionSource: 'heuristic' | 'model';
  avgConfidence: number;
  /** Vision method that produced this capture (yolo, coco, sam6, vision, …). */
  detectorKind: string;
  /** Human-readable method name for UI and exports. */
  detectorLabel: string;
  /** Inference FPS at the moment of capture. */
  fpsAtCapture: number;
};

export type ObjectMemoryRow = {
  id: string;
  className: string;
  colorName: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  present: boolean;
  held: boolean;
};
