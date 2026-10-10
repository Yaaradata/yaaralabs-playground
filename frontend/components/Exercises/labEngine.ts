import type { ClassifierRule, LabeledText, MetricBundle } from './types';
import {
  DEFAULT_RULES,
  DEFAULT_TEXT_DATASET,
  SCORED_DATASET,
  type MetricExample,
} from './examples';
import { simulateGenerate, uniqueness } from './engines/llm';
import {
  accuracyScore,
  applyRules,
  binaryMetrics,
  compactContext,
  cosine,
  embedText,
  estimateCostUsd,
  fitTfIdf,
  knnPredict,
  predictLogistic,
  pruneContext,
  recoverWithinLimit,
  tokenizeForCost,
  trainLogistic,
  transformTfIdf,
  uniqueLabels,
} from './engines/text';

export type LabResult<T> = { ok: true; data: T } | { ok: false; error: string };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function runRuleLab(
  rules: ClassifierRule[],
  cases: Array<{ text: string; expected: string }>,
  fallback = 'unknown',
): LabResult<{
  rows: Array<{ text: string; expected: string; actual: string; match: boolean }>;
  hits: number;
  total: number;
}> {
  const usable = rules.filter((r) => r.label.trim() && (r.kind === 'wordCount' || r.pattern.trim()));
  if (usable.length === 0) {
    return { ok: false, error: 'Add at least one complete rule (pattern + label).' };
  }
  const rows = cases.map((row) => {
    const actual = applyRules(row.text, usable, fallback.trim() || 'unknown');
    return { ...row, actual, match: actual === row.expected };
  });
  return { ok: true, data: { rows, hits: rows.filter((r) => r.match).length, total: rows.length } };
}

export function runTextClassifierLab(
  rows: LabeledText[],
  query: string,
  mode: 'tfidf' | 'embed',
): LabResult<{
  accuracy: number;
  vocab: number;
  predicted: string;
  probs: number[];
  labels: string[];
  misses: Array<{ text: string; expected: string; actual: string }>;
}> {
  const cleaned = rows.filter((r) => r.text.trim() && r.label.trim());
  if (cleaned.length < 2) {
    return { ok: false, error: 'Need at least two labelled examples to train.' };
  }
  const labels = uniqueLabels(cleaned);
  if (labels.length < 2) {
    return { ok: false, error: 'Need at least two different labels.' };
  }
  const y = cleaned.map((r) => labels.indexOf(r.label));
  if (y.some((v) => v < 0)) {
    return { ok: false, error: 'Every example needs a label.' };
  }
  let vectors: number[][];
  let vocabCount = 0;
  let queryVec: number[];
  if (mode === 'tfidf') {
    const fitted = fitTfIdf(cleaned.map((r) => r.text));
    if (fitted.vocab.length === 0) {
      return { ok: false, error: 'Dataset has no usable words. Add real sentences.' };
    }
    vectors = fitted.vectors;
    vocabCount = fitted.vocab.length;
    queryVec = transformTfIdf(query, fitted.vocab, fitted.idf);
  } else {
    vectors = cleaned.map((r) => embedText(r.text, 48, 3));
    vocabCount = 48;
    queryVec = embedText(query, 48, 3);
  }
  const weights = trainLogistic(vectors, y, labels.length, 0.35, 90);
  if (weights.length === 0) {
    return { ok: false, error: 'Training failed. Check the dataset.' };
  }
  const preds = vectors.map((vec) => labels[predictLogistic(vec, weights).label] || 'unknown');
  const misses = cleaned
    .map((row, i) => ({ text: row.text, expected: row.label, actual: preds[i] }))
    .filter((row) => row.expected !== row.actual);
  const live = predictLogistic(queryVec, weights);
  const probs = live.probs.map(clamp01);
  const sum = probs.reduce((a, b) => a + b, 0) || 1;
  return {
    ok: true,
    data: {
      accuracy: clamp01(accuracyScore(cleaned.map((r) => r.label), preds)),
      vocab: vocabCount,
      predicted: labels[live.label] || 'unknown',
      probs: probs.map((p) => p / sum),
      labels,
      misses,
    },
  };
}

export function runMetricLab(
  scores: Array<{ y: number; s: number }>,
  threshold: number,
): LabResult<MetricBundle & { n: number }> {
  if (scores.length === 0) {
    return { ok: false, error: 'Score dataset is empty.' };
  }
  const t = Number.isFinite(threshold) ? Math.min(0.99, Math.max(0.01, threshold)) : 0.5;
  const pred = scores.map((row) => (row.s >= t ? 1 : 0));
  const metrics = binaryMetrics(
    scores.map((row) => row.y),
    pred,
  );
  return {
    ok: true,
    data: {
      ...metrics,
      accuracy: clamp01(metrics.accuracy),
      precision: clamp01(metrics.precision),
      recall: clamp01(metrics.recall),
      f1: clamp01(metrics.f1),
      n: scores.length,
    },
  };
}

export function preferMetric(example: MetricExample, metrics: MetricBundle): number {
  switch (example.prefer) {
    case 'Recall':
      return metrics.recall;
    case 'Precision':
      return metrics.precision;
    case 'F1':
      return metrics.f1;
    default: {
      const _never: never = example.prefer;
      return _never;
    }
  }
}

export function syntheticShapeFeatures(label: 'circle' | 'square' | 'triangle', jitter = 0): number[] {
  const table: Record<typeof label, number[]> = {
    circle: [0.52, 1.02, 0.88, 0.12, 0.45, 0.55, 0.4],
    square: [0.68, 0.98, 0.58, 0.2, 0.5, 0.4, 0.35],
    triangle: [0.38, 0.72, 0.32, 0.36, 0.55, 0.35, 0.3],
  };
  return table[label].map((v, i) => v + ((i % 2 === 0 ? 1 : -1) * jitter) * 0.04);
}

export function runImageKnnLab(
  train: Array<{ label: string; features: number[] }>,
  test: Array<{ id?: string; label: string; features: number[] }>,
): LabResult<{
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  predictions: Array<{ label: string; predicted: string }>;
}> {
  if (train.length === 0) {
    return { ok: false, error: 'Train set is empty. Load the dataset first.' };
  }
  if (test.length === 0) {
    return { ok: false, error: 'Test set is empty.' };
  }
  const trainX = train.map((s) => s.features);
  const trainY = train.map((s) => s.label);
  const predictions = test.map((sample) => ({
    label: sample.label,
    predicted: knnPredict(sample.features, trainX, trainY, Math.min(3, train.length)),
  }));
  const labels = Array.from(new Set([...trainY, ...test.map((t) => t.label)]));
  let precisionSum = 0;
  let recallSum = 0;
  labels.forEach((label) => {
    const truth = predictions.map((p) => (p.label === label ? 1 : 0));
    const pred = predictions.map((p) => (p.predicted === label ? 1 : 0));
    const m = binaryMetrics(truth, pred);
    precisionSum += m.precision;
    recallSum += m.recall;
  });
  const precision = clamp01(precisionSum / (labels.length || 1));
  const recall = clamp01(recallSum / (labels.length || 1));
  const f1 = clamp01((2 * precision * recall) / (precision + recall || 1));
  return {
    ok: true,
    data: {
      accuracy: clamp01(accuracyScore(predictions.map((p) => p.label), predictions.map((p) => p.predicted))),
      precision,
      recall,
      f1,
      predictions,
    },
  };
}

export function runTokenizerLab(
  text: string,
  usdPerMillion = 0.15,
): LabResult<{
  count: number;
  cost: number;
  pieces: ReturnType<typeof tokenizeForCost>;
}> {
  const rate = Number.isFinite(usdPerMillion) ? Math.max(0, usdPerMillion) : 0.15;
  const pieces = tokenizeForCost(text || '');
  const count = pieces.length;
  const cost = estimateCostUsd(count, rate);
  if (cost < 0 || !Number.isFinite(cost)) {
    return { ok: false, error: 'Cost calculation failed. Check the price field.' };
  }
  return { ok: true, data: { count, cost, pieces } };
}

export function runSimilarityLab(phrases: string[]): LabResult<{
  matrixA: number[][];
  matrixB: number[][];
  disagreements: string[];
}> {
  const texts = phrases.map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (texts.length < 2) {
    return { ok: false, error: 'Enter at least two phrases (one per line).' };
  }
  const vecA = texts.map((t) => embedText(t, 48, 5));
  const vecB = texts.map((t) => embedText(t, 48, 3));
  const matrixA = texts.map((_, i) => texts.map((__, j) => cosine(vecA[i], vecA[j])));
  const matrixB = texts.map((_, i) => texts.map((__, j) => cosine(vecB[i], vecB[j])));
  const disagreements: string[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    if (Math.abs(matrixA[i][i] - 1) > 0.02) {
      return { ok: false, error: 'Self-similarity should be 1. Embedding pipeline is invalid.' };
    }
    for (let j = i + 1; j < texts.length; j += 1) {
      const delta = Math.abs(matrixA[i][j] - matrixB[i][j]);
      if (delta > 0.12) {
        disagreements.push(`“${texts[i]}” vs “${texts[j]}”  Δ=${delta.toFixed(2)}`);
      }
    }
  }
  return { ok: true, data: { matrixA, matrixB, disagreements } };
}

export function runTemperatureLab(prompt: string): LabResult<{
  low: string[];
  high: string[];
  lowUnique: number;
  highUnique: number;
}> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter a prompt before running.' };
  }
  const low = simulateGenerate({ prompt: trimmed, temperature: 0.1, n: 5, model: 'gemini-2.5-flash-lite' });
  const high = simulateGenerate({ prompt: trimmed, temperature: 1, n: 5, model: 'gemini-2.5-flash-lite' });
  if (low.length !== 5 || high.length !== 5) {
    return { ok: false, error: 'Expected 10 outputs (5 + 5).' };
  }
  return {
    ok: true,
    data: {
      low,
      high,
      lowUnique: uniqueness(low),
      highUnique: uniqueness(high),
    },
  };
}

export function runPersonaLab(args: {
  prompt: string;
  system?: string;
  examples?: { user: string; assistant: string }[];
}): LabResult<{ before: string[]; after: string[]; beforeUnique: number; afterUnique: number }> {
  const prompt = args.prompt.trim();
  if (!prompt) {
    return { ok: false, error: 'Enter an evaluation prompt.' };
  }
  const before = simulateGenerate({ prompt, temperature: 0.4, n: 3 });
  const after = simulateGenerate({
    prompt,
    system: args.system,
    examples: args.examples?.filter((ex) => ex.user.trim() || ex.assistant.trim()),
    temperature: 0.4,
    n: 3,
  });
  return {
    ok: true,
    data: {
      before,
      after,
      beforeUnique: uniqueness(before),
      afterUnique: uniqueness(after),
    },
  };
}

export function runDualModelLab(prompt: string): LabResult<{ lite: string; pro: string }> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter a shared prompt.' };
  }
  const lite = simulateGenerate({ prompt: trimmed, model: 'gemini-2.5-flash-lite', temperature: 0.3, n: 1 });
  const pro = simulateGenerate({ prompt: trimmed, model: 'gemini-2.5-pro', temperature: 0.3, n: 1 });
  if (!lite[0] || !pro[0]) {
    return { ok: false, error: 'One of the models returned an empty reply.' };
  }
  return { ok: true, data: { lite: lite[0], pro: pro[0] } };
}

export const CONTEXT_LIMIT = 180;

export function runContextLab(
  text: string,
  limit = CONTEXT_LIMIT,
): LabResult<{
  used: number;
  overflow: boolean;
  pruned: string;
  compacted: string;
  recovered: string;
  recoveredCount: number;
  recoveredFits: boolean;
}> {
  const used = tokenizeForCost(text || '').length;
  const pruned = pruneContext(text || '');
  const compacted = compactContext(text || '');
  const recovered = recoverWithinLimit(text || '', limit);
  const recoveredCount = tokenizeForCost(recovered).length;
  return {
    ok: true,
    data: {
      used,
      overflow: used > limit,
      pruned,
      compacted,
      recovered,
      recoveredCount,
      recoveredFits: recoveredCount <= limit,
    },
  };
}

export const LAB_DEFAULTS = {
  rules: DEFAULT_RULES,
  dataset: DEFAULT_TEXT_DATASET,
  scores: SCORED_DATASET,
};
