import { METRIC_JUDGE_SCENARIOS, type MetricChoice } from './metricScenarios';
import type { Ex2Result, TfidfTestProb } from './types';

export interface ClassMetrics {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ThresholdSlice {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  illustrated: boolean;
}

function ratio(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export function classIndex(classes: string[], target: string): number {
  const needle = target.trim().toLowerCase();
  return classes.findIndex((name) => name.toLowerCase() === needle);
}

export function classLabel(classes: string[], target: string): string {
  const index = classIndex(classes, target);
  return index >= 0 ? classes[index] : target;
}

export function metricsFromMatrix(matrix: number[][], k: number): ClassMetrics {
  const n = matrix.length;
  let tp = 0;
  let fn = 0;
  let fp = 0;
  if (k < 0 || k >= n) return { tp: 0, fp: 0, fn: 0, precision: 0, recall: 0, f1: 0 };
  const row = matrix[k] || [];
  row.forEach((value, j) => {
    const cell = Number(value) || 0;
    if (j === k) tp += cell;
    else fn += cell;
  });
  matrix.forEach((cells, i) => {
    if (i === k) return;
    fp += Number(cells?.[k]) || 0;
  });
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = ratio(2 * precision * recall, precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

export function accuracyFromMatrix(matrix: number[][]): number {
  let correct = 0;
  let total = 0;
  matrix.forEach((row, i) => {
    row.forEach((value, j) => {
      const cell = Number(value) || 0;
      total += cell;
      if (i === j) correct += cell;
    });
  });
  return ratio(correct, total);
}

function classProb(row: TfidfTestProb, k: number, nClasses: number): number | null {
  if (row.probs && row.probs.length === nClasses && Number.isFinite(row.probs[k])) {
    return row.probs[k];
  }
  if (nClasses === 2 && Number.isFinite(row.p)) {
    return k === 1 ? row.p : 1 - row.p;
  }
  return null;
}

export function buildProbsByClass(
  classes: string[],
  rows: TfidfTestProb[],
): Ex2Result['probsByClass'] | undefined {
  if (!classes.length || !rows.length) return undefined;
  const out: NonNullable<Ex2Result['probsByClass']> = {};
  let usable = 0;
  classes.forEach((name, k) => {
    const pos: number[] = [];
    const neg: number[] = [];
    rows.forEach((row) => {
      const p = classProb(row, k, classes.length);
      if (p == null) return;
      usable += 1;
      if (row.y === k) pos.push(p);
      else neg.push(p);
    });
    out[name] = { pos: sampleScores(pos), neg: sampleScores(neg) };
  });
  return usable > 0 ? out : undefined;
}

const SCORE_CAP = 8000;

function sampleScores(values: number[]): number[] {
  if (values.length <= SCORE_CAP) return values;
  const step = values.length / SCORE_CAP;
  return Array.from({ length: SCORE_CAP }, (_, i) => values[Math.min(values.length - 1, Math.round(i * step))]);
}

export function macroMetricsFromMatrix(matrix: number[][]): {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
} {
  const accuracy = accuracyFromMatrix(matrix);
  const n = matrix.length;
  if (!n) return { accuracy, precision: 0, recall: 0, f1: 0 };
  let precision = 0;
  let recall = 0;
  let f1 = 0;
  for (let k = 0; k < n; k += 1) {
    const item = metricsFromMatrix(matrix, k);
    precision += item.precision;
    recall += item.recall;
    f1 += item.f1;
  }
  return { accuracy, precision: precision / n, recall: recall / n, f1: f1 / n };
}

export function ovrForTarget(
  result: Ex2Result,
  target: string,
): { scores: { pos: number[]; neg: number[] }; illustrated: boolean } {
  const name = classLabel(result.classes, target);
  const live = result.probsByClass?.[name] || result.probsByClass?.[target];
  if (live && live.pos.length && live.neg.length) {
    return { scores: live, illustrated: false };
  }
  const match = Object.entries(result.probsByClass || {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  if (match && match[1].pos.length && match[1].neg.length) {
    return { scores: match[1], illustrated: false };
  }
  return { scores: syntheticOvR(result.packId, name), illustrated: true };
}

export function toEx2Result(input: {
  packId: string;
  packLabel: string;
  classes: string[];
  matrix: number[][];
  testProbs?: TfidfTestProb[];
  threshold?: number;
}): Ex2Result | null {
  const classes = input.classes.filter((name) => name.trim());
  const matrix = input.matrix.filter((row) => Array.isArray(row));
  if (!input.packId || classes.length < 2 || matrix.length !== classes.length) return null;
  if (matrix.some((row) => row.length !== classes.length)) return null;
  const threshold = Number(input.threshold);
  return {
    packId: input.packId,
    packLabel: input.packLabel || input.packId,
    classes,
    matrix,
    ...(Number.isFinite(threshold) ? { threshold } : {}),
    probsByClass: buildProbsByClass(classes, input.testProbs || []),
  };
}

export function serializeEx2Result(result: Ex2Result): Record<string, unknown> {
  const size = result.classes.length;
  return {
    packId: result.packId,
    packLabel: result.packLabel,
    classes: result.classes,
    matrixSize: size,
    matrixCells: result.matrix.flatMap((row) => row.slice(0, size).map((cell) => Number(cell) || 0)),
    ...(Number.isFinite(result.threshold) ? { threshold: result.threshold } : {}),
    probsByClass: result.probsByClass,
  };
}

function readMatrix(raw: Record<string, unknown>, classCount: number): number[][] | null {
  if (Array.isArray(raw.matrix) && raw.matrix.every((row) => Array.isArray(row))) {
    return raw.matrix
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) => row.map((cell) => Number(cell) || 0));
  }
  const size = Number.isInteger(Number(raw.matrixSize)) ? Number(raw.matrixSize) : classCount;
  const cells = raw.matrixCells;
  if (!Number.isInteger(size) || size < 2 || !Array.isArray(cells) || cells.length < size * size) {
    return null;
  }
  const matrix: number[][] = [];
  for (let row = 0; row < size; row += 1) {
    matrix.push(cells.slice(row * size, (row + 1) * size).map((cell) => Number(cell) || 0));
  }
  return matrix;
}

export function parseEx2Result(value: unknown): Ex2Result | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.packId !== 'string' || !Array.isArray(raw.classes)) {
    return null;
  }
  const classes = raw.classes.filter((item): item is string => typeof item === 'string');
  const matrix = readMatrix(raw, classes.length);
  if (!matrix) return null;
  const threshold = Number(raw.threshold);
  return toEx2Result({
    packId: raw.packId,
    packLabel: typeof raw.packLabel === 'string' ? raw.packLabel : raw.packId,
    classes,
    matrix,
    testProbs: [],
  })
    ? {
        packId: raw.packId,
        packLabel: typeof raw.packLabel === 'string' ? raw.packLabel : raw.packId,
        classes,
        matrix,
        ...(Number.isFinite(threshold) ? { threshold } : {}),
        probsByClass: isProbsByClass(raw.probsByClass) ? raw.probsByClass : undefined,
      }
    : null;
}

function isProbsByClass(value: unknown): value is NonNullable<Ex2Result['probsByClass']> {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, { pos?: unknown; neg?: unknown }>).every(
    (item) => Array.isArray(item?.pos) && Array.isArray(item?.neg),
  );
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussianLike(rand: () => number, mean: number, spread: number): number {
  const u = Math.max(1e-6, rand());
  const v = Math.max(1e-6, rand());
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(0.99, Math.max(0.01, mean + n * spread));
}

export function syntheticOvR(packId: string, target: string): { pos: number[]; neg: number[] } {
  const rand = mulberry32(hashSeed(`${packId}:${target}`));
  const pos = Array.from({ length: 80 }, () => gaussianLike(rand, 0.74, 0.14));
  const neg = Array.from({ length: 120 }, () => gaussianLike(rand, 0.28, 0.14));
  return { pos, neg };
}

export function sliceAtThreshold(
  scores: { pos: number[]; neg: number[] },
  threshold: number,
  illustrated: boolean,
): ThresholdSlice {
  const tau = Number.isFinite(threshold) ? Math.min(0.95, Math.max(0.05, threshold)) : 0.5;
  const tp = scores.pos.filter((value) => value >= tau).length;
  const fn = scores.pos.length - tp;
  const fp = scores.neg.filter((value) => value >= tau).length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = ratio(2 * precision * recall, precision + recall);
  return { tp, fp, fn, precision, recall, f1, illustrated };
}

export function metricValue(metrics: ClassMetrics, metric: MetricChoice): number {
  switch (metric) {
    case 'precision':
      return metrics.precision;
    case 'recall':
      return metrics.recall;
    case 'f1':
      return metrics.f1;
    default: {
      const _never: never = metric;
      return _never;
    }
  }
}

export function scenariosForPack(packId: string) {
  return METRIC_JUDGE_SCENARIOS.filter((item) => item.packId === packId);
}

export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
