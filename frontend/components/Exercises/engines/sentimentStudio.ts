import type {
  TextRepresentation,
  TfidfClassBelief,
  TfidfCurvePoint,
  TfidfExportedModel,
  TfidfPredictResult,
  TfidfReviewRow,
  TfidfTestProb,
  TfidfTrainConfig,
  TfidfTrainResult,
  TfidfWordWeight,
} from '../types';
import { DEFAULT_TFIDF_TRAIN_CONFIG, SENTENCE_EMBED_DIM } from '../types';
import { sentenceEmbed } from './text';

export const STOP_WORDS = new Set(
  'a an and are as at be by for from has have i in is it its of on or that the this to was were will with you your my me we our us they them their all every very just so also really even still more most some any only first actually'.split(
    ' ',
  ),
);

export const DATASET_CSV = `review,sentiment
"This product exceeded my expectations, absolutely love it!",positive
"Terrible quality, broke after just two days.",negative
"Fast shipping and the item works perfectly.",positive
"Worst purchase I have ever made, complete waste of money.",negative
"Great value for the price, highly recommend.",positive
"The packaging was damaged and the product was defective.",negative
"Customer service was friendly and very helpful.",positive
"I waited three weeks and it never arrived.",negative
"Comfortable, well made, and looks fantastic.",positive
"Cheap material that felt flimsy and fell apart.",negative
"Exactly as described, I am very happy with it.",positive
"Stopped working within a week, very disappointed.",negative
"Easy to set up and works like a charm.",positive
"The instructions were confusing and nothing fit properly.",negative
"Beautiful design and excellent build quality.",positive
"Overpriced for what you actually get.",negative
"My whole family loves this, we use it every day.",positive
"It arrived in the wrong color and size.",negative
"Superb performance and the battery lasts all day.",positive
"Battery drains fast and it overheats constantly.",negative
"Five stars, would buy again without hesitation.",positive
"Do not buy this, it is a total scam.",negative
"The fabric is soft and the fit is perfect.",positive
"Poor stitching and the zipper broke immediately.",negative
"Incredible sound quality for such a small speaker.",positive
"The screen cracked on the very first day of use.",negative
"Reliable, sturdy, and worth every penny.",positive
"Slow, buggy, and it crashed multiple times.",negative
"Delicious taste and genuinely fresh ingredients.",positive
"Stale, bland, and clearly past its expiry date.",negative
`;

export interface StudioReview {
  review: string;
  y: number;
  label: string;
}

export interface StudioModel {
  vocab: string[];
  idf: number[];
  weights: number[];
  bias: number;
  weightRows?: number[][];
  biasRows?: number[];
  classes?: string[];
  index: Map<string, number>;
  ngramMin: number;
  ngramMax: number;
  representation: TextRepresentation;
}

const POSITIVE_LABELS = new Set(['positive', 'pos', '1', 'good', '+', '1.0']);
const NEGATIVE_LABELS = new Set(['negative', 'neg', '0', 'bad', '-', '0.0']);
const REVIEW_HEADERS = [
  'review',
  'reviews',
  'text',
  'sentence',
  'comment',
  'feedback',
  'document',
  'abstract',
  'description',
  'narrative',
  'complaint',
  'summary',
  'headline',
  'transcription',
  'hazard_description',
  'report',
  'event_description',
];
const LABEL_HEADERS = [
  'sentiment',
  'label',
  'class',
  'target',
  'rating',
  'topic_group',
  'topic',
  'category',
  'queue',
  'product',
  'specialty',
  'medical_specialty',
  'component',
  'intent',
  'event',
  'failure_type',
  'hazard_bucket',
  'cause',
  'cause_txt',
  'gen_cause_txt',
  'part_failure',
  'occurence_nature_condition',
];

export function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

export function canClassifyText(text: string): boolean {
  return tokenize(text).length >= 1;
}

export function ngramTokens(tokens: string[], ngramMin = 1, ngramMax = 1): string[] {
  const minN = Math.max(1, Math.min(3, ngramMin));
  const maxN = Math.max(minN, Math.min(3, ngramMax));
  const features: string[] = [];
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      features.push(tokens.slice(i, i + n).join(' '));
    }
  }
  return features;
}

export function featuresFromText(text: string, ngramMin = 1, ngramMax = 1): string[] {
  return ngramTokens(tokenize(text), ngramMin, ngramMax);
}

function detectCsvDelimiter(text: string): ',' | '\t' | ';' {
  const first = (text || '').split(/\r?\n/).find((line) => line.trim()) || '';
  const commas = (first.match(/,/g) || []).length;
  const tabs = (first.match(/\t/g) || []).length;
  const semis = (first.match(/;/g) || []).length;
  if (tabs > commas && tabs >= semis) return '\t';
  if (semis > commas && semis > tabs) return ';';
  return ',';
}

export function parseCSV(text: string, delimiter = detectCsvDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let i = 0;
  const blob = text || '';
  while (i < blob.length) {
    const ch = blob[i];
    if (quoted) {
      if (ch === '"') {
        if (blob[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0].trim() === ''));
}

export function encodeLabeledRows(pairs: Array<{ review: string; label: string }>): StudioReview[] {
  const cleaned = pairs
    .map((row) => ({
      review: (row.review || '').trim(),
      label: (row.label || '').trim(),
    }))
    .filter((row) => row.review && row.label && tokenize(row.review).length > 0);
  if (cleaned.length < 4) {
    throw new Error('Need a few labeled rows with text + label columns.');
  }
  const names: string[] = [];
  cleaned.forEach((row) => {
    if (!names.includes(row.label)) names.push(row.label);
  });
  const lowered = new Set(names.map((name) => name.toLowerCase()));
  const hasPos = [...lowered].some((name) => POSITIVE_LABELS.has(name));
  const hasNeg = [...lowered].some((name) => NEGATIVE_LABELS.has(name));
  if (hasPos && hasNeg && [...lowered].every((name) => POSITIVE_LABELS.has(name) || NEGATIVE_LABELS.has(name))) {
    return cleaned.map((row) => {
      const positive = POSITIVE_LABELS.has(row.label.toLowerCase());
      return { review: row.review, y: positive ? 1 : 0, label: positive ? 'positive' : 'negative' };
    });
  }
  const classes = [...names].sort();
  const index = new Map(classes.map((name, i) => [name, i]));
  return cleaned.map((row) => ({
    review: row.review,
    y: index.get(row.label) ?? 0,
    label: row.label,
  }));
}

function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s/]+/g, '_');
}

function meanCellLength(table: string[][], col: number, limit = 12): number {
  const rows = table.slice(0, Math.min(table.length, limit));
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + String(row[col] || '').trim().length, 0) / rows.length;
}

const GITHUB_ISSUE_LABELS: Record<string, string> = {
  '0': 'Bug',
  '1': 'Feature',
  '2': 'Question',
};

function cellText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function reviewsFromPairs(pairs: Array<{ review: string; label: string }>): StudioReview[] {
  const cleaned = pairs
    .map((row) => ({ review: (row.review || '').trim(), label: (row.label || '').trim() }))
    .filter((row) => row.review && row.label);
  const labelSet = new Set(cleaned.map((row) => row.label));
  const githubStyle =
    labelSet.has('0') &&
    labelSet.has('1') &&
    labelSet.has('2') &&
    [...labelSet].every((name) => Boolean(GITHUB_ISSUE_LABELS[name]));
  const remapped = githubStyle
    ? cleaned.map((row) => ({ ...row, label: GITHUB_ISSUE_LABELS[row.label] || row.label }))
    : cleaned;
  return encodeLabeledRows(remapped);
}

function pairFromRecord(record: Record<string, unknown>): { review: string; label: string } | null {
  const map: Record<string, string> = {};
  Object.entries(record).forEach(([key, value]) => {
    map[normalizeHeader(key)] = cellText(value);
  });
  const title = map.title || '';
  const body = map.body || '';
  let review = title && body ? `${title} ${body}`.trim() : '';
  if (!review) {
    const key = REVIEW_HEADERS.find((name) => map[name]);
    review = key ? map[key] : '';
  }
  const labelKey = LABEL_HEADERS.find((name) => map[name]);
  const label = labelKey ? map[labelKey] : '';
  if (!review || !label) return null;
  return { review, label };
}

function recordsFromJson(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
  }
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const nested = root.rows || root.data || root.records || root.articles;
  if (Array.isArray(nested)) return recordsFromJson(nested);
  if (pairFromRecord(root)) return [root];
  return [];
}

export function loadJsonDataset(text: string): StudioReview[] {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The file looks empty.');
  let records: Record<string, unknown>[] = [];
  try {
    if (trimmed.startsWith('[')) {
      records = recordsFromJson(JSON.parse(trimmed) as unknown);
    } else if (trimmed.startsWith('{') && !trimmed.includes('\n{')) {
      records = recordsFromJson(JSON.parse(trimmed) as unknown);
    } else {
      trimmed.split(/\r?\n/).forEach((line) => {
        const next = line.trim();
        if (!next) return;
        try {
          const parsed = JSON.parse(next) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            records.push(parsed as Record<string, unknown>);
          } else if (Array.isArray(parsed)) {
            records.push(...recordsFromJson(parsed));
          }
        } catch {
          return;
        }
      });
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('That JSON file could not be parsed. Upload valid JSON or JSONL with text and label.');
    }
    throw error;
  }
  const pairs = records.map(pairFromRecord).filter((row): row is { review: string; label: string } => Boolean(row));
  if (!pairs.length) {
    throw new Error('Need JSON or JSONL rows with text and label (or Title, Body, and Label).');
  }
  return reviewsFromPairs(pairs);
}

export function loadLabFile(text: string, fileName = ''): StudioReview[] {
  const trimmed = (text || '').replace(/^\uFEFF/, '');
  if (!trimmed.trim()) throw new Error('The file looks empty.');
  if (/\.xlsx?$/i.test(fileName) || trimmed.startsWith('PK')) {
    throw new Error('Excel workbooks are not supported. Save the sheet as CSV or JSON, then upload.');
  }
  const namedJson = /\.jsonl?$/i.test(fileName);
  const looksJson = namedJson || trimmed.trim().startsWith('{') || trimmed.trim().startsWith('[');
  if (looksJson) {
    try {
      return loadJsonDataset(trimmed);
    } catch (error) {
      if (namedJson) throw error;
    }
  }
  try {
    return loadDataset(trimmed);
  } catch (csvError) {
    try {
      return loadJsonDataset(trimmed);
    } catch {
      throw csvError;
    }
  }
}

export function loadDataset(text: string): StudioReview[] {
  const table = parseCSV(text);
  if (!table.length) throw new Error('The file looks empty.');
  const header = table[0].map(normalizeHeader);
  const titleIndex = header.findIndex((name) => name === 'title');
  const bodyIndex = header.findIndex((name) => name === 'body');
  const useTitleBody = titleIndex >= 0 && bodyIndex >= 0;
  let reviewIndex = header.findIndex((name) => REVIEW_HEADERS.includes(name));
  let labelIndex = header.findIndex((name) => LABEL_HEADERS.includes(name));
  let start = 1;
  const named = reviewIndex >= 0 || labelIndex >= 0 || useTitleBody;
  if (!named) {
    if (header.length < 2) throw new Error('Need a CSV with columns named text and label.');
    start = 0;
    if (meanCellLength(table, 1) > meanCellLength(table, 0) * 2.5) {
      labelIndex = 0;
      reviewIndex = 1;
    } else {
      reviewIndex = 0;
      labelIndex = 1;
    }
  } else {
    if (reviewIndex < 0 && !useTitleBody) reviewIndex = labelIndex === 0 ? 1 : 0;
    if (labelIndex < 0) labelIndex = reviewIndex === 0 ? 1 : Math.min(1, header.length - 1);
  }
  const pairs = table.slice(start).map((row) => ({
    review: useTitleBody
      ? `${row[titleIndex] || ''} ${row[bodyIndex] || ''}`.trim()
      : (row[reviewIndex] || '').trim(),
    label: (row[labelIndex] || '').trim(),
  }));
  return reviewsFromPairs(pairs);
}

export function toTrainRows(data: StudioReview[]): TfidfReviewRow[] {
  return data.map((row) => ({
    review: row.review,
    sentiment: row.label,
    label: row.label,
    y: row.y,
  }));
}

export function modelFromExport(exported: TfidfExportedModel): StudioModel {
  const multi = Array.isArray(exported.weights[0]);
  const weightRows = multi ? (exported.weights as number[][]) : undefined;
  const biasRows = Array.isArray(exported.bias) ? exported.bias : undefined;
  const representation: TextRepresentation = exported.representation === 'embeddings' ? 'embeddings' : 'tfidf';
  return {
    vocab: exported.vocab,
    idf: exported.idf,
    weights: multi ? (exported.weights as number[][])[0] : (exported.weights as number[]),
    bias: Array.isArray(exported.bias) ? exported.bias[0] : exported.bias,
    weightRows,
    biasRows,
    classes: exported.classes && exported.classes.length ? exported.classes : ['negative', 'positive'],
    index: new Map(exported.vocab.map((word, i) => [word, i])),
    ngramMin: exported.ngram_min || 1,
    ngramMax: exported.ngram_max || exported.ngram_min || 1,
    representation,
  };
}

function vectorize(tokens: string[], model: StudioModel): { vector: Float64Array; known: number } {
  const vector = new Float64Array(model.index.size);
  const counts = new Map<string, number>();
  tokens.forEach((token) => {
    if (!model.index.has(token)) return;
    counts.set(token, (counts.get(token) || 0) + 1);
  });
  counts.forEach((count, token) => {
    const i = model.index.get(token);
    if (i === undefined) return;
    vector[i] = (1 + Math.log(count)) * model.idf[i];
  });
  let norm = 0;
  for (let i = 0; i < vector.length; i += 1) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
  }
  return { vector, known: counts.size };
}

function sigmoid(z: number): number {
  if (z > 30) return 1;
  if (z < -30) return 0;
  return 1 / (1 + Math.exp(-z));
}

function probability(vector: Float64Array, model: StudioModel): number {
  let z = model.bias;
  for (let i = 0; i < vector.length; i += 1) z += model.weights[i] * vector[i];
  return sigmoid(z);
}

function softmax(logits: number[]): number[] {
  const peak = Math.max(...logits);
  const exps = logits.map((value) => Math.exp(value - peak));
  const sum = exps.reduce((total, value) => total + value, 0) || 1;
  return exps.map((value) => value / sum);
}

function embeddingVector(text: string, dim = SENTENCE_EMBED_DIM): Float64Array {
  return Float64Array.from(sentenceEmbed(text, dim));
}

function scoreFromVector(vector: Float64Array, model: StudioModel, known: number): TfidfPredictResult {
  const classes = model.classes && model.classes.length ? model.classes : ['negative', 'positive'];
  const rows = model.weightRows;
  let pred = classes.length === 2 && probability(vector, model) >= 0.5 ? 1 : 0;
  let probs: number[] = [];
  if (rows && rows.length > 1) {
    const logits = rows.map((weights, row) => {
      let score = (model.biasRows && model.biasRows[row]) || 0;
      for (let i = 0; i < vector.length; i += 1) score += weights[i] * vector[i];
      return score;
    });
    probs = softmax(logits);
    pred = probs.reduce((best, value, i) => (value > probs[best] ? i : best), 0);
  } else {
    const p1 = probability(vector, model);
    probs = classes.length === 2 ? [1 - p1, p1] : [p1];
    pred = p1 >= 0.5 ? Math.min(1, classes.length - 1) : 0;
  }
  const activeWeights = rows && rows[pred] ? rows[pred] : model.weights;
  const chips: TfidfPredictResult['chips'] = [];
  for (let i = 0; i < Math.min(vector.length, activeWeights.length, model.vocab.length); i += 1) {
    chips.push({
      word: model.vocab[i] || `dim ${i}`,
      contribution: activeWeights[i] * vector[i],
      tfidf: vector[i],
    });
  }
  chips.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const features = chips
    .slice()
    .sort((a, b) => Math.abs(b.tfidf) - Math.abs(a.tfidf))
    .slice(0, 8);
  const label = classes[pred] || classes[0];
  return {
    success: true,
    probability: classes.length === 2 ? (probs[1] ?? probability(vector, model)) : (probs[pred] ?? 0),
    label,
    classes,
    probs: classes.map((name, i) => ({ label: name, p: probs[i] ?? 0 })),
    known_tokens: known,
    chips: chips.slice(0, 12),
    features,
  };
}

export function scoreWithModel(text: string, model: StudioModel): TfidfPredictResult {
  if (model.representation === 'embeddings') {
    const tokens = tokenize(text);
    return scoreFromVector(embeddingVector(text), model, Math.max(1, tokens.length));
  }
  const tokens = featuresFromText(text, model.ngramMin, model.ngramMax);
  const { vector, known } = vectorize(tokens, model);
  const classes = model.classes && model.classes.length ? model.classes : ['negative', 'positive'];
  const rows = model.weightRows;
  let pred = classes.length === 2 && probability(vector, model) >= 0.5 ? 1 : 0;
  let probs: number[] = [];
  if (rows && rows.length > 1) {
    const logits = rows.map((weights, row) => {
      let score = (model.biasRows && model.biasRows[row]) || 0;
      for (let i = 0; i < vector.length; i += 1) score += weights[i] * vector[i];
      return score;
    });
    probs = softmax(logits);
    pred = probs.reduce((best, value, i) => (value > probs[best] ? i : best), 0);
  } else {
    const p1 = probability(vector, model);
    probs = classes.length === 2 ? [1 - p1, p1] : [p1];
    pred = p1 >= 0.5 ? Math.min(1, classes.length - 1) : 0;
  }
  const activeWeights = rows && rows[pred] ? rows[pred] : model.weights;
  const seen = new Set<string>();
  const chips: TfidfPredictResult['chips'] = [];
  const features: TfidfPredictResult['features'] = [];
  tokens.forEach((token) => {
    const i = model.index.get(token);
    if (i === undefined || seen.has(token)) return;
    seen.add(token);
    chips.push({
      word: token,
      contribution: activeWeights[i] * vector[i],
      tfidf: vector[i],
    });
    features.push({ word: token, contribution: 0, tfidf: vector[i] });
  });
  chips.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  features.sort((a, b) => b.tfidf - a.tfidf);
  const label = classes[pred] || classes[0];
  return {
    success: true,
    probability: classes.length === 2 ? (probs[1] ?? probability(vector, model)) : (probs[pred] ?? 0),
    label,
    classes,
    probs: classes.map((name, i) => ({ label: name, p: probs[i] ?? 0 })),
    known_tokens: known,
    chips: chips.slice(0, 12),
    features: features.slice(0, 8),
  };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function splitData(data: StudioReview[], frac: number, seed: number): { train: StudioReview[]; test: StudioReview[] } {
  const rand = mulberry(seed);
  const grouped = new Map<number, StudioReview[]>();
  data.forEach((row) => {
    const bucket = grouped.get(row.y) || [];
    bucket.push(row);
    grouped.set(row.y, bucket);
  });
  const test: StudioReview[] = [];
  const train: StudioReview[] = [];
  grouped.forEach((items) => {
    const shuffled = shuffle(items, rand);
    const nTest = Math.max(1, Math.min(Math.round(shuffled.length * frac), shuffled.length - 1));
    test.push(...shuffled.slice(0, nTest));
    train.push(...shuffled.slice(nTest));
  });
  return { train, test };
}

function buildTfidf(
  docs: string[][],
  maxFeatures = 1000,
  minDf = 1,
): { index: Map<string, number>; idf: number[]; vocab: string[] } {
  const df = new Map<string, number>();
  docs.forEach((tokens) => {
    new Set(tokens).forEach((token) => df.set(token, (df.get(token) || 0) + 1));
  });
  const vocab = Array.from(df.entries())
    .filter(([, count]) => count >= minDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFeatures)
    .map(([token]) => token);
  return {
    vocab,
    index: new Map(vocab.map((token, i) => [token, i])),
    idf: vocab.map((token) => Math.log((1 + docs.length) / (1 + (df.get(token) || 0))) + 1),
  };
}

type WeightList = Array<number> | Float64Array;

const SEED_POS = new Set('love great perfect excellent happy fantastic amazing wonderful best superb'.split(' '));
const SEED_NEG = new Set('broke waste terrible worst damaged disappointed cracked cheap flimsy scam'.split(' '));

function pickBeliefs(ranked: string[], seeds: Set<string>, k: number): string[] {
  const chosen: string[] = [];
  ranked.forEach((word) => {
    if (seeds.has(word) && !chosen.includes(word) && chosen.length < 3) chosen.push(word);
  });
  ranked.forEach((word) => {
    if (!chosen.includes(word) && chosen.length < k) chosen.push(word);
  });
  return chosen;
}

function beliefWords(weights: WeightList, vocab: string[], k = 8): { pos: string[]; neg: string[] } {
  const scored = vocab.map((word, i) => ({ word, weight: Number(weights[i] || 0) }));
  const posRanked = scored
    .filter((item) => item.weight > 1e-4)
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.word);
  const negRanked = scored
    .filter((item) => item.weight < -1e-4)
    .sort((a, b) => a.weight - b.weight)
    .map((item) => item.word);
  return {
    pos: pickBeliefs(posRanked, SEED_POS, k),
    neg: pickBeliefs(negRanked, SEED_NEG, k),
  };
}

export function beliefsFromWeights(items: TfidfWordWeight[], k = 8): { pos: string[]; neg: string[] } {
  const posRanked = items
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map((item) => item.word);
  const negRanked = items
    .filter((item) => item.weight < 0)
    .sort((a, b) => a.weight - b.weight)
    .map((item) => item.word);
  return {
    pos: pickBeliefs(posRanked, SEED_POS, k),
    neg: pickBeliefs(negRanked, SEED_NEG, k),
  };
}

function labelsMetrics(pred: number[], y: number[], nClasses: number) {
  const size = Math.max(1, nClasses);
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  let correct = 0;
  for (let i = 0; i < y.length; i += 1) {
    const actual = y[i];
    const guessed = pred[i];
    if (actual >= 0 && actual < size && guessed >= 0 && guessed < size) {
      matrix[actual][guessed] += 1;
    }
    if (actual === guessed) correct += 1;
  }
  let precSum = 0;
  let recSum = 0;
  let f1Sum = 0;
  for (let i = 0; i < size; i += 1) {
    const tp = matrix[i][i];
    let fp = 0;
    let fn = 0;
    for (let j = 0; j < size; j += 1) {
      if (j === i) continue;
      fp += matrix[j][i];
      fn += matrix[i][j];
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    precSum += prec;
    recSum += rec;
    f1Sum += f1;
  }
  return {
    acc: y.length ? correct / y.length : 0,
    prec: precSum / size,
    rec: recSum / size,
    f1: f1Sum / size,
  };
}

function trainLogistic(
  matrix: Float64Array[],
  labels: number[],
  lr: number,
  epochs: number,
  lambda: number,
  vocab: string[] = [],
  testMatrix: Float64Array[] = [],
  testLabels: number[] = [],
  threshold = 0.5,
): { weights: Float64Array; bias: number; curve: TfidfCurvePoint[]; trainAcc: number } {
  const m = matrix.length;
  const n = matrix[0]?.length || 0;
  const weights = new Float64Array(n);
  let bias = 0;
  const recordEvery = Math.max(1, Math.floor(epochs / 96));
  const stepLr = Math.min(lr, Math.max(0.022, 2.6 / Math.max(10, epochs)));
  const curve: TfidfCurvePoint[] = [];
  const holdoutX = testMatrix.length ? testMatrix : matrix;
  const holdoutY = testLabels.length ? testLabels : labels;

  const predictOk = (rows: Float64Array[], ys: number[]) => {
    let ok = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const xi = rows[i];
      let z = bias;
      for (let j = 0; j < n; j += 1) z += weights[j] * xi[j];
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
      if ((p >= threshold ? 1 : 0) === ys[i]) ok += 1;
    }
    return ok / Math.max(1, rows.length);
  };

  const snapshot = (epoch: number) => {
    let loss = 0;
    const trainPred: number[] = [];
    for (let i = 0; i < m; i += 1) {
      const xi = matrix[i];
      let z = bias;
      for (let j = 0; j < n; j += 1) z += weights[j] * xi[j];
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
      loss += -(labels[i] * Math.log(p) + (1 - labels[i]) * Math.log(1 - p));
      trainPred.push(p >= threshold ? 1 : 0);
    }
    const testPred: number[] = [];
    for (let i = 0; i < holdoutX.length; i += 1) {
      const xi = holdoutX[i];
      let z = bias;
      for (let j = 0; j < n; j += 1) z += weights[j] * xi[j];
      const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(z)));
      testPred.push(p >= threshold ? 1 : 0);
    }
    const beliefs = beliefWords(weights, vocab);
    const testM = labelsMetrics(testPred, holdoutY, 2);
    const trainM = labelsMetrics(trainPred, labels, 2);
    curve.push({
      epoch,
      loss: loss / Math.max(1, m),
      acc: testM.acc,
      train_acc: trainM.acc,
      prec: testM.prec,
      rec: testM.rec,
      f1: testM.f1,
      pos_words: beliefs.pos,
      neg_words: beliefs.neg,
    });
  };

  snapshot(0);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Float64Array(n);
    let gradB = 0;
    for (let i = 0; i < m; i += 1) {
      const xi = matrix[i];
      let z = bias;
      for (let j = 0; j < n; j += 1) z += weights[j] * xi[j];
      const delta = sigmoid(z) - labels[i];
      for (let j = 0; j < n; j += 1) grad[j] += delta * xi[j];
      gradB += delta;
    }
    for (let j = 0; j < n; j += 1) weights[j] -= stepLr * (grad[j] / m + lambda * weights[j]);
    bias -= stepLr * (gradB / m);
    if ((epoch + 1) % recordEvery === 0 || epoch === epochs - 1) snapshot(epoch + 1);
  }
  return { weights, bias, curve, trainAcc: predictOk(matrix, labels) };
}

function classBeliefsFromRows(weightRows: number[][], vocab: string[], classNames: string[], k = 6): TfidfClassBelief[] {
  return classNames.map((label, row) => {
    const scored = vocab
      .map((word, i) => ({ word, weight: weightRows[row]?.[i] ?? 0 }))
      .sort((a, b) => b.weight - a.weight);
    return {
      label,
      words: scored.filter((item) => item.weight > 1e-4).slice(0, k).map((item) => item.word),
    };
  });
}

function trainSoftmax(
  matrix: Float64Array[],
  labels: number[],
  nClasses: number,
  lr: number,
  epochs: number,
  lambda: number,
  vocab: string[],
  classNames: string[],
  testMatrix: Float64Array[] = [],
  testLabels: number[] = [],
): { weights: number[][]; bias: number[]; curve: TfidfCurvePoint[]; trainAcc: number } {
  const m = matrix.length;
  const n = matrix[0]?.length || 0;
  const weights = Array.from({ length: nClasses }, () => new Float64Array(n));
  const bias = new Float64Array(nClasses);
  const recordEvery = Math.max(1, Math.floor(epochs / 96));
  const stepLr = Math.min(lr, Math.max(0.022, 2.6 / Math.max(10, epochs)));
  const curve: TfidfCurvePoint[] = [];
  const holdoutX = testMatrix.length ? testMatrix : matrix;
  const holdoutY = testLabels.length ? testLabels : labels;

  const logitsFor = (xi: Float64Array) =>
    weights.map((row, k) => {
      let score = bias[k];
      for (let j = 0; j < n; j += 1) score += row[j] * xi[j];
      return score;
    });

  const predictOk = (rows: Float64Array[], ys: number[]) => {
    let ok = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const probs = softmax(logitsFor(rows[i]));
      const pred = probs.reduce((best, value, idx) => (value > probs[best] ? idx : best), 0);
      if (pred === ys[i]) ok += 1;
    }
    return ok / Math.max(1, rows.length);
  };

  const snapshot = (epoch: number) => {
    let loss = 0;
    const trainPred: number[] = [];
    for (let i = 0; i < m; i += 1) {
      const probs = softmax(logitsFor(matrix[i]));
      const pTrue = Math.min(1 - 1e-9, Math.max(1e-9, probs[labels[i]] ?? 1e-9));
      loss += -Math.log(pTrue);
      trainPred.push(probs.reduce((best, value, idx) => (value > probs[best] ? idx : best), 0));
    }
    const testPred: number[] = [];
    for (let i = 0; i < holdoutX.length; i += 1) {
      const probs = softmax(logitsFor(holdoutX[i]));
      testPred.push(probs.reduce((best, value, idx) => (value > probs[best] ? idx : best), 0));
    }
    const rows = weights.map((row) => Array.from(row));
    const beliefs = classBeliefsFromRows(rows, vocab, classNames);
    const testM = labelsMetrics(testPred, holdoutY, nClasses);
    const trainM = labelsMetrics(trainPred, labels, nClasses);
    curve.push({
      epoch,
      loss: loss / Math.max(1, m),
      acc: testM.acc,
      train_acc: trainM.acc,
      prec: testM.prec,
      rec: testM.rec,
      f1: testM.f1,
      pos_words: beliefs[1]?.words || [],
      neg_words: beliefs[0]?.words || [],
      class_words: beliefs,
    });
  };

  snapshot(0);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = Array.from({ length: nClasses }, () => new Float64Array(n));
    const gradB = new Float64Array(nClasses);
    for (let i = 0; i < m; i += 1) {
      const xi = matrix[i];
      const probs = softmax(logitsFor(xi));
      for (let k = 0; k < nClasses; k += 1) {
        const delta = probs[k] - (k === labels[i] ? 1 : 0);
        gradB[k] += delta;
        for (let j = 0; j < n; j += 1) gradW[k][j] += delta * xi[j];
      }
    }
    for (let k = 0; k < nClasses; k += 1) {
      for (let j = 0; j < n; j += 1) weights[k][j] -= stepLr * (gradW[k][j] / m + lambda * weights[k][j]);
      bias[k] -= stepLr * (gradB[k] / m);
    }
    if ((epoch + 1) % recordEvery === 0 || epoch === epochs - 1) snapshot(epoch + 1);
  }
  return {
    weights: weights.map((row) => Array.from(row)),
    bias: Array.from(bias),
    curve,
    trainAcc: predictOk(matrix, labels),
  };
}

function orderedClassNames(data: StudioReview[]): string[] {
  const names: string[] = [];
  const seen = new Set<number>();
  data
    .slice()
    .sort((a, b) => a.y - b.y)
    .forEach((row) => {
      if (seen.has(row.y)) return;
      seen.add(row.y);
      names.push(row.label);
    });
  return names;
}

function blankVectorModel(
  vocab: string[],
  idf: number[],
  index: Map<string, number>,
  ngramMin = 1,
  ngramMax = 1,
  representation: TextRepresentation = 'tfidf',
): StudioModel {
  return {
    vocab,
    idf,
    weights: new Array(vocab.length).fill(0),
    bias: 0,
    index,
    classes: [],
    ngramMin,
    ngramMax,
    representation,
  };
}

function resolveTrainConfig(
  testSizeOrConfig: number | TfidfTrainConfig = DEFAULT_TFIDF_TRAIN_CONFIG,
  seed = DEFAULT_TFIDF_TRAIN_CONFIG.seed,
): TfidfTrainConfig {
  if (typeof testSizeOrConfig === 'object') {
    return { ...DEFAULT_TFIDF_TRAIN_CONFIG, ...testSizeOrConfig };
  }
  return { ...DEFAULT_TFIDF_TRAIN_CONFIG, test_size: testSizeOrConfig, seed };
}

export function trainLocal(
  data: StudioReview[],
  testSizeOrConfig: number | TfidfTrainConfig = DEFAULT_TFIDF_TRAIN_CONFIG,
  seed = DEFAULT_TFIDF_TRAIN_CONFIG.seed,
): TfidfTrainResult {
  const trainConfig = resolveTrainConfig(testSizeOrConfig, seed);
  const classNames = orderedClassNames(data);
  const nClasses = classNames.length;
  const counts = classNames.map((_, i) => data.filter((row) => row.y === i).length);
  if (nClasses < 2 || counts.some((count) => count < 2)) {
    throw new Error('Each class needs at least 2 labeled texts to train.');
  }
  const { train, test } = splitData(data, trainConfig.test_size, trainConfig.seed);
  const representation: TextRepresentation = trainConfig.representation === 'embeddings' ? 'embeddings' : 'tfidf';
  let evalModel: { vocab: string[]; idf: number[]; index: Map<string, number> };
  let xTrain: Float64Array[];
  let xTest: Float64Array[];
  if (representation === 'embeddings') {
    evalModel = {
      vocab: Array.from({ length: SENTENCE_EMBED_DIM }, (_, i) => `dim ${i}`),
      idf: Array.from({ length: SENTENCE_EMBED_DIM }, () => 1),
      index: new Map(Array.from({ length: SENTENCE_EMBED_DIM }, (_, i) => [`dim ${i}`, i])),
    };
    xTrain = train.map((row) => embeddingVector(row.review));
    xTest = test.map((row) => embeddingVector(row.review));
  } else {
    const featurize = (text: string) => featuresFromText(text, trainConfig.ngram_min, trainConfig.ngram_max);
    const trainTokens = train.map((row) => featurize(row.review));
    evalModel = buildTfidf(trainTokens, trainConfig.max_features, trainConfig.min_df);
    if (!evalModel.vocab.length) {
      throw new Error('No usable words left after tokenization. Add more descriptive reviews.');
    }
    const blank = blankVectorModel(
      evalModel.vocab,
      evalModel.idf,
      evalModel.index,
      trainConfig.ngram_min,
      trainConfig.ngram_max,
      representation,
    );
    xTrain = trainTokens.map((tokens) => vectorize(tokens, blank).vector);
    xTest = test.map((row) => vectorize(featurize(row.review), blank).vector);
  }
  const binary = nClasses === 2;
  const epochs = Math.max(10, Math.min(2000, Math.round(trainConfig.epochs)));
  const lambda = 0.004 / Math.max(0.1, trainConfig.regularization_c);
  const exportNgrams = { ngram_min: trainConfig.ngram_min, ngram_max: trainConfig.ngram_max };
  const pinCurveMetrics = (
    points: TfidfCurvePoint[],
    finals: { acc: number; train_acc: number; prec: number; rec: number; f1: number },
  ): TfidfCurvePoint[] => {
    if (!points.length) return points;
    const last = points[points.length - 1];
    return [
      ...points.slice(0, -1),
      {
        ...last,
        acc: finals.acc,
        train_acc: finals.train_acc,
        prec: finals.prec,
        rec: finals.rec,
        f1: finals.f1,
      },
    ];
  };

  if (binary) {
    const evalLr = trainLogistic(
      xTrain,
      train.map((row) => row.y),
      0.35,
      epochs,
      lambda,
      evalModel.vocab,
      xTest,
      test.map((row) => row.y),
      trainConfig.threshold,
    );
    const trainedModel = {
      vocab: evalModel.vocab,
      idf: evalModel.idf,
      weights: Array.from(evalLr.weights),
      bias: evalLr.bias,
      index: evalModel.index,
      ngramMin: trainConfig.ngram_min,
      ngramMax: trainConfig.ngram_max,
      representation,
    };
    const testProbs: TfidfTestProb[] = test.map((row, i) => {
      const p = probability(xTest[i], trainedModel);
      const pred = p >= trainConfig.threshold ? 1 : 0;
      return { y: row.y, p, pred, label: classNames[row.y], pred_label: classNames[pred], probs: [1 - p, p] };
    });
    const wordWeights: TfidfWordWeight[] = evalModel.vocab.map((word, i) => ({
      word,
      weight: evalLr.weights[i],
      label: evalLr.weights[i] >= 0 ? classNames[1] : classNames[0],
    }));
    wordWeights.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    const holdout = metricsAt(testProbs, trainConfig.threshold);
    const majority = Math.max(...counts);
    return {
      success: true,
      simulated: true,
      n_train: train.length,
      n_test: test.length,
      n_features: evalModel.vocab.length,
      n_classes: 2,
      classes: classNames,
      n_positive: counts[1] || 0,
      n_negative: counts[0] || 0,
      baseline: majority / data.length,
      n_epochs: evalLr.curve[evalLr.curve.length - 1]?.epoch || epochs,
      train_accuracy: evalLr.trainAcc,
      test_accuracy: holdout.acc,
      test_precision: holdout.prec,
      test_recall: holdout.rec,
      test_f1: holdout.f1,
      solver: trainConfig.solver,
      regularization_c: trainConfig.regularization_c,
      max_features: trainConfig.max_features,
      ngram_min: trainConfig.ngram_min,
      ngram_max: trainConfig.ngram_max,
      min_df: trainConfig.min_df,
      max_iter: trainConfig.max_iter,
      epochs: trainConfig.epochs,
      test_size: trainConfig.test_size,
      seed: trainConfig.seed,
      threshold: trainConfig.threshold,
      representation,
      curve_kind: 'holdout',
      test_probs: testProbs,
      confusion_matrix: [
        [holdout.tn, holdout.fp],
        [holdout.fn, holdout.tp],
      ],
      word_weights: wordWeights,
      class_beliefs: [
        { label: classNames[0], words: beliefWords(evalLr.weights, evalModel.vocab).neg },
        { label: classNames[1], words: beliefWords(evalLr.weights, evalModel.vocab).pos },
      ],
      curve: pinCurveMetrics(evalLr.curve, {
        acc: holdout.acc,
        train_acc: evalLr.trainAcc,
        prec: holdout.prec,
        rec: holdout.rec,
        f1: holdout.f1,
      }),
      model: {
        vocab: evalModel.vocab,
        idf: evalModel.idf,
        weights: Array.from(evalLr.weights),
        bias: evalLr.bias,
        classes: classNames,
        representation,
        ...exportNgrams,
      },
    };
  }

  const evalLr = trainSoftmax(
    xTrain,
    train.map((row) => row.y),
    nClasses,
    0.8,
    epochs,
    lambda,
    evalModel.vocab,
    classNames,
    xTest,
    test.map((row) => row.y),
  );
  const testProbs: TfidfTestProb[] = test.map((row, i) => {
    const logits = evalLr.weights.map((weights, k) => {
      let score = evalLr.bias[k];
      for (let j = 0; j < xTest[i].length; j += 1) score += weights[j] * xTest[i][j];
      return score;
    });
    const probs = softmax(logits);
    const pred = probs.reduce((best, value, idx) => (value > probs[best] ? idx : best), 0);
    return {
      y: row.y,
      p: probs[pred] ?? 0,
      pred,
      label: classNames[row.y],
      pred_label: classNames[pred],
      probs,
    };
  });
  const wordWeights: TfidfWordWeight[] = evalModel.vocab.map((word, i) => {
    let best = 0;
    for (let k = 1; k < nClasses; k += 1) {
      if ((evalLr.weights[k][i] ?? 0) > (evalLr.weights[best][i] ?? 0)) best = k;
    }
    return { word, weight: evalLr.weights[best][i] ?? 0, label: classNames[best] };
  });
  wordWeights.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const derived = macroMetricsFromProbs(testProbs, nClasses);
  const majority = Math.max(...counts);
  return {
    success: true,
    simulated: true,
    n_train: train.length,
    n_test: test.length,
    n_features: evalModel.vocab.length,
    n_classes: nClasses,
    classes: classNames,
    class_counts: Object.fromEntries(classNames.map((name, i) => [name, counts[i]])),
    n_positive: majority,
    n_negative: data.length - majority,
    baseline: majority / data.length,
    n_epochs: evalLr.curve[evalLr.curve.length - 1]?.epoch || epochs,
    train_accuracy: evalLr.trainAcc,
    test_accuracy: derived.acc,
    test_precision: derived.prec,
    test_recall: derived.rec,
    test_f1: derived.f1,
    solver: trainConfig.solver,
    regularization_c: trainConfig.regularization_c,
    max_features: trainConfig.max_features,
    ngram_min: trainConfig.ngram_min,
    ngram_max: trainConfig.ngram_max,
    min_df: trainConfig.min_df,
    max_iter: trainConfig.max_iter,
    epochs: trainConfig.epochs,
    test_size: trainConfig.test_size,
    seed: trainConfig.seed,
    threshold: trainConfig.threshold,
    representation,
    curve_kind: 'holdout',
    test_probs: testProbs,
    confusion_matrix: derived.matrix,
    word_weights: wordWeights,
    class_beliefs: classBeliefsFromRows(evalLr.weights, evalModel.vocab, classNames),
    curve: pinCurveMetrics(evalLr.curve, {
      acc: derived.acc,
      train_acc: evalLr.trainAcc,
      prec: derived.prec,
      rec: derived.rec,
      f1: derived.f1,
    }),
    model: {
      vocab: evalModel.vocab,
      idf: evalModel.idf,
      weights: evalLr.weights,
      bias: evalLr.bias,
      classes: classNames,
      representation,
      ...exportNgrams,
    },
  };
}

export function metricsAt(probs: TfidfTestProb[], threshold: number): {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  acc: number;
  prec: number;
  rec: number;
  f1: number;
  correct: number;
  total: number;
  matrix?: number[][];
} {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  probs.forEach((item) => {
    const pred = item.p >= threshold ? 1 : 0;
    if (pred && item.y) tp += 1;
    else if (pred && !item.y) fp += 1;
    else if (!pred && item.y) fn += 1;
    else tn += 1;
  });
  const total = tp + fp + fn + tn;
  const acc = total ? (tp + tn) / total : 0;
  const prec = tp + fp ? tp / (tp + fp) : 0;
  const rec = tp + fn ? tp / (tp + fn) : 0;
  const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
  return { tp, fp, fn, tn, acc, prec, rec, f1, correct: tp + tn, total };
}

export function confusionFromProbs(probs: TfidfTestProb[], nClasses: number): number[][] {
  const size = Math.max(0, nClasses);
  const matrix = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  probs.forEach((item) => {
    const actual = item.y;
    const pred = typeof item.pred === 'number' ? item.pred : item.p >= 0.5 ? 1 : 0;
    if (actual >= 0 && actual < size && pred >= 0 && pred < size) {
      matrix[actual][pred] += 1;
    }
  });
  return matrix;
}

export function macroMetricsFromProbs(probs: TfidfTestProb[], nClasses: number) {
  const matrix = confusionFromProbs(probs, nClasses);
  const total = probs.length;
  let correct = 0;
  let precSum = 0;
  let recSum = 0;
  let f1Sum = 0;
  for (let i = 0; i < nClasses; i += 1) {
    const tp = matrix[i]?.[i] ?? 0;
    correct += tp;
    let fp = 0;
    let fn = 0;
    for (let j = 0; j < nClasses; j += 1) {
      if (j === i) continue;
      fp += matrix[j]?.[i] ?? 0;
      fn += matrix[i]?.[j] ?? 0;
    }
    const prec = tp + fp ? tp / (tp + fp) : 0;
    const rec = tp + fn ? tp / (tp + fn) : 0;
    const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
    precSum += prec;
    recSum += rec;
    f1Sum += f1;
  }
  const denom = nClasses || 1;
  return {
    acc: total ? correct / total : 0,
    prec: precSum / denom,
    rec: recSum / denom,
    f1: f1Sum / denom,
    correct,
    total,
    matrix,
  };
}
