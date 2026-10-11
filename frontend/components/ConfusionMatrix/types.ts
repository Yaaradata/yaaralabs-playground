export type Level = 'basic' | 'intermediate' | 'advanced';
export type ModelId = 'lr' | 'bert';
export type Source = 'ex2' | 'pre';
export type CellKey = 'tp' | 'fn' | 'fp' | 'tn';

export interface Params {
  threshold: number;
  testSplit: number;
  C: number;
  ngrams: number;
  maxFeatures: number;
  maxIter: number;
  maxLen: number;
  epochs: number;
  lr: number;
  batch: number;
}

export interface Dataset {
  id: string;
  name: string;
  classes: [string, string]; // [class we care about, other]
  short: [string, string];
  noun: string;
  source: string;
  licence: string;
  blurb: string;
  counts: [number, number];
  n: number;
}

export interface Metrics {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  n: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface Run {
  id: string;
  no: number;
  source: Source;
  datasetKey: string;
  kind: 'ex2' | 'pre' | 'retrain';
  model: ModelId;
  params: Params;
  trainN: number;
  m: Metrics;
  modelSaved: boolean;
  reusedFit: boolean;
  createdAt: string;
}

export type Ex2Kind = 'textclass' | 'textrec' | 'exercises'; // textclass = a Text Classification project (Day 1 Ex 2)

export interface Ex2Snapshot {
  kind: Ex2Kind; // 'textrec' = a Text Recognition project
  projectId: string;
  projectName: string;
  datasetId: string;
  datasetName: string;
  datasetKey: string; // runs of this model + class are filed under this key
  classes: [string, string]; // [class we care about, other or "Other labels"]
  labels: string[]; // every label the Ex 2 model knows
  params: Params;
  trainedAt?: string | null;
}

export interface State {
  source: Source | null;
  datasetId: string | null;
  model: ModelId;
  level: Level;
  params: Params;
  selectedRunId: string | null;
}

export interface Project {
  project_id: string;
  state: State;
  ex2: Ex2Snapshot | null;
  dataset: Dataset | null;
  runs: Run[];
}

export interface Ex2Run {
  kind: Ex2Kind;
  projectId: string;
  projectName: string;
  datasetId?: string | null;
  datasetName: string;
  classes: string[];
  labels: string[];
  labelCounts: Record<string, number>;
  nExamples: number;
  modelType: string;
  params: Params | null;
  accuracy?: number | null;
  nTest: number;
  usable: boolean;
  reason: string;
  updatedAt?: string | null;
}

export interface SampleRow {
  text: string;
  y: number;
}

export interface Example {
  text: string;
  score: number;
}
