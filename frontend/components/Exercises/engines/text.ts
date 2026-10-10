import type { ClassifierRule, LabeledText, MetricBundle } from '../types';

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0b80-\u0bff\u0900-\u097f]+/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function applyRules(text: string, rules: ClassifierRule[], fallback = 'unknown'): string {
  const source = text ?? '';
  const lower = source.toLowerCase();
  const words = tokenizeWords(source);
  for (const rule of rules) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (!pattern && rule.kind !== 'wordCount') continue;
    switch (rule.kind) {
      case 'contains':
        if (lower.includes(pattern)) return rule.label;
        break;
      case 'startsWith':
        if (lower.startsWith(pattern)) return rule.label;
        break;
      case 'endsWith':
        if (lower.endsWith(pattern)) return rule.label;
        break;
      case 'wordCount': {
        const n = Number(pattern);
        if (Number.isFinite(n) && words.length >= n) return rule.label;
        break;
      }
      default: {
        const _never: never = rule.kind;
        return _never;
      }
    }
  }
  return fallback;
}

export function uniqueLabels(rows: LabeledText[]): string[] {
  return Array.from(new Set(rows.map((row) => row.label).filter(Boolean)));
}

export function fitTfIdf(docs: string[]): { vectors: number[][]; vocab: string[]; idf: number[] } {
  const tokenized = (docs.length ? docs : ['']).map(tokenizeWords);
  const df = new Map<string, number>();
  tokenized.forEach((tokens) => {
    new Set(tokens).forEach((token) => df.set(token, (df.get(token) || 0) + 1));
  });
  const vocab = Array.from(df.keys()).sort();
  const n = docs.length || 1;
  const idf = vocab.map((term) => Math.log((1 + n) / (1 + (df.get(term) || 0))) + 1);
  const vectors = tokenized.map((tokens) => {
    const tf = new Map<string, number>();
    tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
    const len = tokens.length || 1;
    return vocab.map((term, i) => ((tf.get(term) || 0) / len) * idf[i]);
  });
  return { vectors, vocab, idf };
}

export function transformTfIdf(text: string, vocab: string[], idf: number[]): number[] {
  const tokens = tokenizeWords(text);
  const tf = new Map<string, number>();
  tokens.forEach((token) => tf.set(token, (tf.get(token) || 0) + 1));
  const len = tokens.length || 1;
  return vocab.map((term, i) => ((tf.get(term) || 0) / len) * idf[i]);
}

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const SENTENCE_EMBED_DIM = 384;

export function sentenceEmbed(text: string, dim = SENTENCE_EMBED_DIM): number[] {
  const safeDim = Math.max(8, dim);
  const vec = new Array(safeDim).fill(0);
  const blob = ` ${(text || '').toLowerCase()} `;
  if (!blob.trim()) return vec;
  for (const n of [3, 4, 5]) {
    for (let i = 0; i <= blob.length - n; i += 1) {
      const gram = blob.slice(i, i + n);
      const h = hash32(`c${n}:${gram}`);
      vec[h % safeDim] += (h & 1) === 0 ? 1 : -1;
    }
  }
  tokenizeWords(text).forEach((word) => {
    const h = hash32(`w:${word}`);
    vec[h % safeDim] += (h & 1) === 0 ? 1.5 : -1.5;
  });
  return l2norm(vec);
}

export function embedText(text: string, dim = 48, ngram = 3): number[] {
  const safeDim = Math.max(8, dim);
  const safeN = Math.max(1, ngram);
  const vec = new Array(safeDim).fill(0);
  const blob = ` ${(text || '').toLowerCase()} `;
  if (blob.trim().length === 0) return vec;
  for (let i = 0; i <= blob.length - safeN; i += 1) {
    const gram = blob.slice(i, i + safeN);
    const h = hash32(gram);
    const idx = h % safeDim;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  return l2norm(vec);
}

export function embedWords(text: string, dim = 48): number[] {
  const vec = new Array(dim).fill(0);
  tokenizeWords(text).forEach((word) => {
    const h = hash32(`w:${word}`);
    vec[h % dim] += (h & 1) === 0 ? 1 : -1;
  });
  return l2norm(vec);
}

export function l2norm(vec: number[]): number[] {
  const n = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => v / n);
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function trainLogistic(
  X: number[][],
  y: number[],
  classCount: number,
  lr = 0.4,
  epochs = 90,
): number[][] {
  const dim = X[0]?.length || 0;
  const safeClasses = Math.max(1, classCount);
  if (!X.length || X.length !== y.length) return [];
  const weights = Array.from({ length: safeClasses }, () => new Array(dim + 1).fill(0));
  const rate = Math.max(0.01, lr);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const step = rate / (1 + epoch / 40);
    X.forEach((row, i) => {
      const scores = weights.map((w) => w[0] + row.reduce((sum, v, j) => sum + v * (w[j + 1] || 0), 0));
      const maxScore = Math.max(...scores);
      const exps = scores.map((s) => Math.exp(Math.min(20, s - maxScore)));
      const z = exps.reduce((sum, v) => sum + v, 0) || 1;
      const probs = exps.map((v) => v / z);
      const target = Math.max(0, Math.min(safeClasses - 1, y[i] || 0));
      for (let c = 0; c < safeClasses; c += 1) {
        const err = (c === target ? 1 : 0) - probs[c];
        weights[c][0] += step * err;
        for (let j = 0; j < dim; j += 1) {
          weights[c][j + 1] += step * err * row[j];
        }
      }
    });
  }
  return weights;
}

export function predictLogistic(row: number[], weights: number[][]): { label: number; probs: number[] } {
  if (!weights.length) return { label: 0, probs: [1] };
  const scores = weights.map((w) => w[0] + row.reduce((sum, v, j) => sum + v * (w[j + 1] || 0), 0));
  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - maxScore));
  const z = exps.reduce((sum, v) => sum + v, 0) || 1;
  const probs = exps.map((v) => v / z);
  let best = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i] > probs[best]) best = i;
  }
  return { label: best, probs };
}

export function binaryMetrics(truth: number[], pred: number[]): MetricBundle {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  truth.forEach((t, i) => {
    const p = pred[i];
    if (t === 1 && p === 1) tp += 1;
    else if (t === 0 && p === 1) fp += 1;
    else if (t === 0 && p === 0) tn += 1;
    else fn += 1;
  });
  const precision = tp / (tp + fp || 1);
  const recall = tp / (tp + fn || 1);
  const f1 = (2 * precision * recall) / (precision + recall || 1);
  const accuracy = (tp + tn) / (truth.length || 1);
  return { accuracy, precision, recall, f1, tp, fp, tn, fn };
}

export function accuracyScore(truth: string[], pred: string[]): number {
  if (truth.length === 0) return 0;
  let ok = 0;
  truth.forEach((t, i) => {
    if (t === pred[i]) ok += 1;
  });
  return ok / truth.length;
}

export interface TokenPiece {
  text: string;
  kind: 'word' | 'subword' | 'punct' | 'script';
}

const LATIN_SUFFIXES = ['tion', 'ness', 'ment', 'ing', 'ers', 'ed', 'ly', 'es'];

export function tokenizeForCost(text: string): TokenPiece[] {
  const pieces: TokenPiece[] = [];
  const source = text || '';
  if (!source.trim()) return pieces;
  const regex = /(\s+)|([A-Za-z]+)|([\u0B80-\u0BFF]+)|([\u0900-\u097F]+)|([0-9]+)|([^\s])/g;
  let match: RegExpExecArray | null = regex.exec(source);
  while (match) {
    const [, space, latin, tamil, hindi, digits, other] = match;
    if (space) {
      match = regex.exec(source);
      continue;
    }
    if (latin) {
      let matchedSuffix = false;
      for (const suffix of LATIN_SUFFIXES) {
        if (latin.length > suffix.length + 2 && latin.toLowerCase().endsWith(suffix)) {
          pieces.push({ text: latin.slice(0, latin.length - suffix.length), kind: 'word' });
          pieces.push({ text: latin.slice(latin.length - suffix.length), kind: 'subword' });
          matchedSuffix = true;
          break;
        }
      }
      if (!matchedSuffix) pieces.push({ text: latin, kind: 'word' });
    } else if (tamil) {
      splitScript(tamil).forEach((ch) => pieces.push({ text: ch, kind: 'script' }));
    } else if (hindi) {
      splitScript(hindi).forEach((ch) => pieces.push({ text: ch, kind: 'script' }));
    } else if (digits) {
      pieces.push({ text: digits, kind: 'word' });
    } else if (other) {
      pieces.push({ text: other, kind: 'punct' });
    }
    match = regex.exec(source);
  }
  return pieces;
}

function splitScript(chunk: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(chunk), (s) => s.segment);
    } catch {
      return Array.from(chunk);
    }
  }
  return Array.from(chunk);
}

export function estimateCostUsd(tokenCount: number, usdPerMillion = 0.15): number {
  const tokens = Math.max(0, tokenCount);
  const rate = Math.max(0, usdPerMillion);
  return (tokens / 1_000_000) * rate;
}

export function pruneContext(text: string): string {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with']);
  const seen = new Set<string>();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      const key = line.toLowerCase();
      if (!line || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((line) =>
      line
        .split(/\s+/)
        .filter((w) => !stop.has(w.toLowerCase()))
        .join(' '),
    )
    .join('\n');
}

export function recoverWithinLimit(text: string, limit: number): string {
  let current = compactContext(pruneContext(text || ''));
  let guard = 0;
  while (tokenizeForCost(current).length > limit && guard < 80) {
    guard += 1;
    const lines = current.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) {
      const pieces = tokenizeForCost(current);
      current = pieces.slice(0, Math.max(1, limit)).map((piece) => piece.text).join(pieceJoin(pieces));
      break;
    }
    const dropAt = lines.findIndex((line, i) => i > 0 && !/^(task|style|constraint):/i.test(line));
    const index = dropAt >= 0 ? dropAt : Math.max(0, lines.length - 1);
    lines.splice(index, 1);
    current = lines.join('\n');
  }
  return current;
}

function pieceJoin(pieces: TokenPiece[]): string {
  return pieces.some((p) => p.kind === 'script') ? '' : ' ';
}

export function compactContext(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, i, arr) => arr.indexOf(line) === i)
    .map((line) => {
      const sentence = line.split(/[.!?]/)[0];
      return sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence;
    })
    .join('\n');
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function knnPredict(features: number[], trainX: number[][], trainY: string[], k = 3): string {
  if (!trainX.length || !trainY.length) return 'unknown';
  const scored = trainX.map((row, i) => ({
    d: row.reduce((sum, v, j) => sum + (v - (features[j] || 0)) ** 2, 0),
    y: trainY[i],
  }));
  scored.sort((a, b) => a.d - b.d);
  const votes = new Map<string, number>();
  scored.slice(0, k).forEach((item) => votes.set(item.y, (votes.get(item.y) || 0) + 1));
  let best = trainY[0] || 'unknown';
  let bestN = -1;
  votes.forEach((n, label) => {
    if (n > bestN) {
      best = label;
      bestN = n;
    }
  });
  return best;
}
