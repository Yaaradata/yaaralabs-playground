export type ModelId = "knn" | "svm" | "rf" | "mlp" | "cnn";
export type LearnTrack = "ml" | "dl";
export type ParamValue = number | string;
export type ParamMap = Record<string, ParamValue>;
export type Step = 1 | 2 | 3 | 4 | 5;
export type Theme = "dark" | "light";
export type CheckLevel = "ok" | "warn" | "bad";
export type TrayFilter = "all" | "new" | "wrong";

export interface DepartmentInfo {
  id: string;
  code: string;
  name: string;
  color: string;
  drive: string;
  data: string;
  classes: string;
  sampleClasses: string[];
}

export interface CheckItem {
  level: CheckLevel;
  message: string;
  action: "pool" | "fixtest" | null;
}

export interface ClassRow {
  name: string;
  images: number;
  bytes: number;
  train: number;
  test: number;
  pool: number;
  thumbs: string[];
  kept: boolean;
}

export interface Summary {
  classes: ClassRow[];
  train: number;
  test: number;
  pool: number;
  skipped: number;
  uploadedAt: string | null;
  updatedAt: string | null;
  checks: CheckItem[];
  ok: boolean;
}

export interface ClassMeta {
  name: string;
  short: string;
}

export interface DatasetMeta {
  key: string;
  classes: ClassMeta[];
  K: number;
  ntr: number;
  nte: number;
  nall: number;
  valIdx: number[];
  byClass: number[][];
  testIdx: number[];
  y: number[];
  small: boolean[];
  rep: number[];
  wall: number[];
  dupes: number;
  baseRate: number;
  trainCount: number;
  valCount: number;
  side?: number;
  failed?: number;
}

export interface LogPoint {
  e: number;
  acc: number;
  loss: number;
  P: number;
  R: number;
  cls: { p: number; r: number }[];
}

export interface ClassScore {
  p: number;
  r: number;
  tp: number;
  rs: number;
  cs: number;
  undef: boolean;
}

export interface ScoreResult {
  cm: number[][];
  cls: ClassScore[];
  pred: number[];
  conf: number[];
  acc: number;
  loss: number;
  P: number;
  R: number;
  m: number;
}

export interface Neighbor {
  index: number;
  cls: number;
  dist: number;
}

export type Viz =
  | { kind: "knn"; query: number; truth: number; pred: number; probs: number[]; neighbors: Neighbor[] }
  | { kind: "svm"; weights: number[][] }
  | { kind: "rf"; treeAcc: number[]; trees: number; importance: number[]; meanDepth: number }
  | { kind: "mlp"; units: number; neurons: number[][] }
  | { kind: "cnn"; kernel: number; filters: number[][]; maps: number[][]; probe: number };

export interface LiveStats {
  step: number;
  seen: number;
  acc: number | null;
  loss: number | null;
  aux: number | null;
  progress: number;
}

export interface RunView {
  id: string;
  no: number;
  model: ModelId;
  params: ParamMap;
  n: number;
  frac: number;
  steps: number;
  status: "running" | "done" | "error";
  phase: string;
  error: string | null;
  done: boolean;
  stopped: boolean;
  valAcc: number | null;
  log: LogPoint[];
  res: ScoreResult | null;
  viz: Viz | null;
  belt: number[];
  runtimeMs?: number | null;
  live: LiveStats;
}

export interface PredictView {
  index: number | null;
  pred: number;
  probs: number[];
  truth: number | null;
  ok: boolean | null;
  seen: string;
  small?: boolean;
}

export interface HistItem {
  id: string;
  n: number | null;
  url: string;
  small: boolean;
  name?: string;
  probs: number[];
  seen: string;
  a: number;
  conf: number;
  truth: number | null;
  ok: boolean | null;
}

export interface BoardCard {
  id?: string;
  n: number | null;
  url: string;
  small: boolean;
  name?: string;
  probs: number[];
  pred: number;
  truth: number | null;
  seen: string;
}
