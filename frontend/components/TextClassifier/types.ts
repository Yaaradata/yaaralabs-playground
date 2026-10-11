/** Text Classification (Day 1, Ex 2). Mirrors backend/app/models.py (TC*). */

export type Step = 1 | 2 | 3 | 4 | 5;
export type Representation = 'tfidf' | 'hashed';
export type Level = 'basic' | 'advanced';
export type Preset = 'quick' | 'balanced' | 'thorough' | 'custom';
export type CellKey = 'tp' | 'fn' | 'fp' | 'tn';

export interface Params {
  threshold: number;
  testSplit: number;
  C: number;
  ngrams: number;
  maxFeatures: number;
  maxIter: number;
}

export interface Clean {
  dropDuplicates: boolean;
  dropConflicts: boolean;
  removeMasks: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  classes: [string, string]; // [class we care about, other class]
  short: [string, string];
  noun: string;
  kind: 'real' | 'synthetic';
  source: string;
  sourceUrl: string;
  licence: string;
  blurb: string;
  nuvama: string;
  recommended: boolean;
  counts: number[];
  n: number;
}

export interface SampleRow {
  id: number;
  label: string;
  text: string;
  chars: number;
  masked: boolean;
}

export interface InspectExample {
  id: number;
  text: string;
  labels: string[];
  copies: number;
}

export interface Inspect {
  n: number;
  counts: number[];
  missing: number;
  duplicates: number;
  duplicateGroups: number;
  conflicts: number;
  conflictGroups: number;
  leakage: number;
  masked: number;
  chars: { median: number; max: number; min: number };
  words: { median: number; max: number };
  examples: { missing: InspectExample[]; duplicates: InspectExample[]; conflicts: InspectExample[]; masked: InspectExample[] };
  clean: Clean;
  after: { n: number; counts: number[] };
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

export interface CurvePoint {
  iter: number;
  trainLoss: number;
  testLoss: number;
  trainAcc: number;
  testAcc: number;
}

export interface Run {
  id: string;
  no: number;
  datasetId: string;
  datasetKey: string;
  classes: [string, string];
  clean: Clean;
  representation: Representation;
  params: Params;
  trainN: number;
  m: Metrics;
  curves: CurvePoint[];
  seconds: number;
  modelSaved: boolean;
  reusedFit: boolean;
  createdAt: string;
}

export interface Evidence {
  term: string;
  weight: number; // + pushes to the class we care about, - to the other
}

export interface Try {
  id: string;
  text: string;
  label: string;
  confidence: number;
  p: number;
  runId: string;
  runNo: number;
  verdict: 'right' | 'wrong' | null;
  evidence: Evidence[];
  createdAt: string;
}

export interface State {
  datasetId: string | null;
  step: Step;
  inspected: boolean;
  clean: Clean;
  representation: Representation;
  level: Level;
  preset: Preset;
  params: Params;
  selectedRunId: string | null;
}

export interface Project {
  project_id: string;
  state: State;
  dataset: Dataset | null;
  runs: Run[];
  tries: Try[];
}

export interface Example {
  id: number;
  text: string;
  score: number;
}
