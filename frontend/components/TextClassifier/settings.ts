/** Presets, setting options and wording for the Text Classification lab. */

import type { Params, Preset, Representation } from './types';

export const DEFAULTS: Params = { threshold: 0.5, testSplit: 0.2, C: 1, ngrams: 2, maxFeatures: 5000, maxIter: 100 };

export const PRESETS: Record<Exclude<Preset, 'custom'>, { name: string; note: string; params: Params }> = {
  quick: {
    name: 'Quick',
    note: 'Single words, a 1,000-word vocabulary, 20 learning steps. Fast, a little rough.',
    params: { threshold: 0.5, testSplit: 0.2, C: 1, ngrams: 1, maxFeatures: 1000, maxIter: 20 },
  },
  balanced: {
    name: 'Balanced',
    note: 'Words and two-word phrases, 5,000-word vocabulary, 100 steps. The one to use in Ex 2.',
    params: { ...DEFAULTS },
  },
  thorough: {
    name: 'Thorough',
    note: 'Words and phrases, 20,000-word vocabulary, 300 steps, a looser fit. Slower; watch for overfitting.',
    params: { threshold: 0.5, testSplit: 0.2, C: 4, ngrams: 2, maxFeatures: 20000, maxIter: 300 },
  },
};

export const REPRESENTATIONS: Record<Representation, { name: string; tag: string; what: string; good: string; limit: string }> = {
  tfidf: {
    name: 'TF-IDF words',
    tag: 'Recommended',
    what: 'Counts the words and two-word phrases in each text, giving more weight to words that are rare across the dataset.',
    good: 'You can see which words pushed each decision. Exercise 3 opens this model.',
    limit: 'Knows only words it saw in training: a misspelling or a new word counts for nothing.',
  },
  hashed: {
    name: 'Hashed character vector',
    tag: 'Comparison',
    what: 'Cuts each text into 3–5 letter pieces and hashes them into 32,768 slots. Not a neural model and not a sentence embedding: it reads spelling, not meaning.',
    good: 'Copes with typos and word endings (“transfer”, “transferred”).',
    limit: 'You can’t see which words mattered, and Exercise 3 can’t open it.',
  },
};

type Opt = { v: number; l: string };
export const OPTIONS: Record<keyof Params, { label: string; help: string; opts: Opt[] }> = {
  testSplit: {
    label: 'Test data held back',
    help: 'The share of rows the model never sees while learning. The scorecard is measured only on these.',
    opts: [{ v: 0.1, l: '10%' }, { v: 0.2, l: '20%' }, { v: 0.3, l: '30%' }],
  },
  threshold: {
    label: 'Decision threshold',
    help: 'How sure the model must be before it says the class we care about. Exercise 3 is all about moving this.',
    opts: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((v) => ({ v, l: v.toFixed(1) })),
  },
  C: {
    label: 'Fit strength (C)',
    help: 'Higher follows the training data more closely (risk: memorising). Lower keeps the model simple.',
    opts: [{ v: 0.01, l: '0.01 · very simple' }, { v: 0.1, l: '0.1' }, { v: 1, l: '1 · default' }, { v: 4, l: '4' }, { v: 10, l: '10' }, { v: 100, l: '100 · very close fit' }],
  },
  ngrams: {
    label: 'Phrases',
    help: 'Two-word phrases catch things like “not received” that single words miss.',
    opts: [{ v: 1, l: 'Single words' }, { v: 2, l: 'Words + two-word phrases' }],
  },
  maxFeatures: {
    label: 'Vocabulary size',
    help: 'How many of the most frequent words and phrases the model may use.',
    opts: [{ v: 500, l: '500' }, { v: 1000, l: '1,000' }, { v: 5000, l: '5,000' }, { v: 20000, l: '20,000' }],
  },
  maxIter: {
    label: 'Learning steps',
    help: 'How many times the model adjusts its weights. Too few and it stops before it has learned.',
    opts: [{ v: 5, l: '5' }, { v: 20, l: '20' }, { v: 50, l: '50' }, { v: 100, l: '100' }, { v: 300, l: '300' }, { v: 1000, l: '1,000' }],
  },
};

export const ADVANCED_ORDER: (keyof Params)[] = ['testSplit', 'threshold', 'C', 'ngrams', 'maxFeatures', 'maxIter'];

/** Step 5 prompts per pack (curriculum Ex 2 step 5: 2 + 2 + 1 ambiguous). */
export const TRY_HINTS: Record<string, { brief: string; examples: string[] }> = {
  cfpb_complaint_routing: {
    brief: 'Write 5 messages of your own: 2 about payments, 2 about accounts, 1 that could be either.',
    examples: [
      'I sent money to my brother through the app and it never arrived.',
      'The bank closed my savings account without telling me why.',
      'My salary was deposited but the money disappeared from my account.',
    ],
  },
  banking77_payment_vs_kyc: {
    brief: 'Write 5 short chat messages: 2 chasing a payment, 2 about proving who you are, 1 that mixes both.',
    examples: ['My transfer is still pending after two days', 'Why do you need a photo of my passport?', 'The transfer failed because my ID is not verified'],
  },
  cfpb_prepaid_vs_bank: {
    brief: 'Write 5 complaints: 2 about a prepaid card, 2 about a bank account, 1 that could be either.',
    examples: ['I loaded $200 on my prepaid card and the balance shows zero.', 'They charged me an overdraft fee on my checking account.', 'My card was frozen and I cannot get my money back.'],
  },
  fin_news_bearish_bullish: {
    brief: 'Write 5 headlines: 2 clearly bad news, 2 clearly good news, 1 mixed.',
    examples: ['Shares slump after the company cuts its profit forecast', 'Stock jumps 8% on record quarterly earnings', 'Revenue beats estimates but margins shrink'],
  },
  custody_breaks: {
    brief: 'Describe 5 breaks: 2 that are only timing, 2 that need someone to chase them, 1 unclear.',
    examples: ['Dividend booked by the registrar today, our ledger posts tomorrow.', 'Quantity mismatch of 500 shares of Infosys with the depository.', 'Cash difference of INR 12,000 found this morning.'],
  },
  custody_client_emails: {
    brief: 'Write 5 client emails: 2 routine requests, 2 that need a senior person today, 1 in between.',
    examples: ['Please send the March holding statement for our records.', 'The dividend is still missing and our auditors sign off tomorrow.', 'Could you check why the bonus shares have not been credited?'],
  },
};

export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const num = (v: number) => v.toLocaleString();
export const sameParams = (a: Params, b: Params) =>
  (Object.keys(DEFAULTS) as (keyof Params)[]).every((k) => Number(a[k]) === Number(b[k]));
export const presetOf = (p: Params): Preset =>
  (Object.keys(PRESETS) as Exclude<Preset, 'custom'>[]).find((k) => sameParams(PRESETS[k].params, p)) || 'custom';
export const summary = (r: { representation: Representation; params: Params }) =>
  r.representation === 'hashed'
    ? `hashed · C ${r.params.C} · ${r.params.maxIter} steps`
    : `${r.params.ngrams === 2 ? '1–2 words' : 'words'} · ${num(r.params.maxFeatures)} vocab · C ${r.params.C} · ${r.params.maxIter} steps`;
