import type { Dataset, Level, ModelId, Params } from './types';

export const LEVELS: { id: Level; label: string }[] = [
  { id: 'basic', label: 'Basic' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

/** Every setting, both models; each model uses its own fields plus threshold and test split. */
export const DEFAULTS: Params = {
  threshold: 0.5, testSplit: 0.2,
  C: 1, ngrams: 2, maxFeatures: 5000, maxIter: 100,
  maxLen: 64, epochs: 5, lr: 0.01, batch: 16,
};

export const MODELS: Record<ModelId, { name: string; blurb: string }> = {
  lr: { name: 'Logistic regression', blurb: 'Counts the words in each text and weighs them. Fast and explainable.' },
  bert: { name: 'DistilBERT', blurb: 'A pretrained language model that reads whole sentences. Slower, understands context.' },
};
export const BERT_MAX_ITEMS = 5000; // matches cm_bert.MAX_ITEMS on the server

interface Option {
  v: number;
  l: string;
}

export interface ParamDef {
  key: keyof Params;
  label: string;
  hint: (d: Dataset) => string;
  options: Option[];
}

const THRESHOLDS: Option[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((v) => ({
  v,
  l: v.toFixed(1) + (v === 0.5 ? '  (default)' : ''),
}));
const THRESHOLD: ParamDef = {
  key: 'threshold', label: 'Decision threshold',
  hint: (d) => `How sure the model must be before it says “${d.classes[0]}”. Lower catches more; higher flags less.`,
  options: THRESHOLDS,
};
const TEST_SPLIT: ParamDef = {
  key: 'testSplit', label: 'Test data held back', hint: () => 'Examples kept aside to score the model. It never learns from them.',
  options: [{ v: 0.1, l: '10%' }, { v: 0.2, l: '20%  (default)' }, { v: 0.3, l: '30%' }],
};

// Option lists are checked by backend/scripts/check_cm_datasets.py: every option changes the result.
export const PARAMS: Record<ModelId, ParamDef[]> = {
  lr: [
    THRESHOLD,
    TEST_SPLIT,
    { key: 'C', label: 'Model flexibility', hint: () => 'Simple models stay cautious; flexible ones fit the training examples closely.', options: [{ v: 0.1, l: 'Very simple (C = 0.1)' }, { v: 0.5, l: 'Simple (C = 0.5)' }, { v: 1, l: 'Balanced (C = 1, default)' }, { v: 10, l: 'Flexible (C = 10)' }, { v: 100, l: 'Very flexible (C = 100)' }] },
    { key: 'ngrams', label: 'What it reads', hint: () => 'Two-word phrases tell “not urgent” from “now urgent”.', options: [{ v: 1, l: 'Single words' }, { v: 2, l: 'Words and 2-word phrases (default)' }] },
    { key: 'maxFeatures', label: 'Vocabulary size', hint: () => 'How many words and phrases the model keeps. Too few and rare but telling phrases are dropped.', options: [{ v: 500, l: '500' }, { v: 1000, l: '1,000' }, { v: 2000, l: '2,000' }, { v: 5000, l: '5,000 (default)' }] },
    { key: 'maxIter', label: 'Training iterations', hint: () => 'Too few and training stops before the model settles. Once it has settled, more changes nothing.', options: [{ v: 3, l: '3' }, { v: 5, l: '5' }, { v: 10, l: '10' }, { v: 100, l: '100 (default)' }] },
  ],
  bert: [
    THRESHOLD,
    TEST_SPLIT,
    { key: 'maxLen', label: 'Text read per example', hint: () => 'The model reads only the start of each text. The rest is cut off.', options: [{ v: 16, l: 'About 10 words' }, { v: 24, l: 'About 16 words' }, { v: 32, l: 'About 22 words' }, { v: 64, l: 'The whole text (default)' }] },
    { key: 'epochs', label: 'Training rounds', hint: () => 'How many times it studies the training examples.', options: [{ v: 1, l: '1 round' }, { v: 3, l: '3 rounds' }, { v: 5, l: '5 rounds (default)' }, { v: 10, l: '10 rounds' }, { v: 20, l: '20 rounds' }] },
    { key: 'lr', label: 'Learning rate', hint: () => 'Step size while learning. Too small is slow; too big overshoots.', options: [{ v: 0.001, l: '0.001' }, { v: 0.01, l: '0.01 (default)' }, { v: 0.1, l: '0.1' }] },
    { key: 'batch', label: 'Batch size', hint: () => 'Examples per learning step.', options: [{ v: 8, l: '8' }, { v: 16, l: '16 (default)' }, { v: 32, l: '32' }] },
  ],
};

/** What each level changes on top of the Basic settings (checked: each level beats the one before). */
export const LEVEL_PLAN: Record<ModelId, Record<Exclude<Level, 'basic'>, { why: string; change: (b: Params) => Partial<Params> }>> = {
  lr: {
    intermediate: {
      why: 'A more flexible model, so it can use more of what it reads.',
      change: (b) => ({ C: Math.min(100, Math.max(10, b.C * 10)) }),
    },
    advanced: {
      why: 'The flexible model, plus a lower decision line so fewer real cases are missed.',
      change: (b) => ({ C: Math.min(100, Math.max(10, b.C * 10)), threshold: Math.max(0.1, Math.round((b.threshold - 0.1) * 10) / 10) }),
    },
  },
  bert: {
    intermediate: {
      why: 'Smaller, steadier learning steps and twice the training rounds.',
      change: () => ({ epochs: 10, lr: 0.001 }),
    },
    advanced: {
      why: 'Small learning steps with four times the training rounds, so it settles fully.',
      change: () => ({ epochs: 20, lr: 0.001 }),
    },
  },
};

export function presetFor(model: ModelId, level: Level, basic: Params): Params {
  return level === 'basic' ? basic : { ...basic, ...LEVEL_PLAN[model][level].change(basic) };
}

/** Options for a setting, plus the current value and the starting value when they are not in the list. */
export function optionsFor(def: ParamDef, current?: number, start?: number, startLabel = 'start'): Option[] {
  const opts = [...def.options];
  for (const v of [current, start]) {
    if (v !== undefined && v !== null && !Number.isNaN(v) && !opts.some((o) => o.v === v)) {
      const text = def.key === 'C' ? `C = ${v}` : def.key === 'testSplit' ? `${Math.round(v * 100)}%` : v.toLocaleString('en-IN');
      opts.push({ v, l: v === start ? `${text} (${startLabel})` : `${text} (earlier run)` });
    }
  }
  return opts.sort((a, b) => a.v - b.v);
}

export const fmt = (n: number) => n.toLocaleString('en-IN');
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const pct0 = (x: number) => `${Math.round(x * 100)}%`;
export const signed = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0');

/** Same settings for this model (only its own fields count). */
export const same = (model: ModelId, a: Params, b: Params) =>
  PARAMS[model].every((d) => Number(a[d.key] ?? DEFAULTS[d.key]) === Number(b[d.key] ?? DEFAULTS[d.key]));

export const labelOf = (model: ModelId, key: keyof Params, v: number) =>
  PARAMS[model].find((d) => d.key === key)?.options.find((o) => o.v === v)?.l.replace(/\s*\(.*\)/, '') ?? String(v);

export function summary(model: ModelId, raw: Params): string {
  const p = { ...DEFAULTS, ...raw };
  if (model === 'bert') {
    return `${p.maxLen === 64 ? 'whole text' : `${p.maxLen} tokens`} · ${p.epochs} rounds${p.lr !== 0.01 ? ` · rate ${p.lr}` : ''}${p.batch !== 16 ? ` · batch ${p.batch}` : ''}`;
  }
  const c = labelOf('lr', 'C', p.C);
  return `${c === String(p.C) ? `C = ${p.C}` : c} · ${p.ngrams === 2 ? 'words + phrases' : 'single words'}${p.maxFeatures !== 5000 ? ` · ${fmt(p.maxFeatures)} vocab` : ''}${p.maxIter !== 100 ? ` · ${p.maxIter} iter` : ''}`;
}

type MetricId = 'accuracy' | 'precision' | 'recall' | 'f1';
type Counts = { tp: number; fn: number; fp: number; tn: number; n: number };
/** False when the score has nothing to measure: precision when nothing was flagged, recall when
 *  none of the class were tested. The server reports 0 in those cases; the page shows "—". */
export function metricDefined(m: Counts, id: MetricId): boolean {
  if (id === 'precision') return m.tp + m.fp > 0;
  if (id === 'recall') return m.tp + m.fn > 0;
  if (id === 'f1') return m.tp + m.fp > 0 && m.tp + m.fn > 0;
  return m.n > 0;
}
export const metricText = (m: Counts & Record<MetricId, number>, id: MetricId) => (metricDefined(m, id) ? pct(m[id]) : '—');
