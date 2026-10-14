/**
 * Evaluate step for Text Recognition projects: everything the page shows, computed from the
 * endpoint's scored items. Pure functions (no React), tested in scripts/test-evaluate.ts.
 *
 * Plain words for senior learners: accuracy, precision, recall. Nothing else.
 */

import { STANDARD_LABELS, projectLabelName, type SampleDataset } from '../SampleLabelling/sample';

export const NONE = 'None of these';

export interface EvalItem {
  text: string;
  expected: string; // a project label, or NONE
  predicted: string; // the bot's normal choice (highest score)
  scores: Record<string, number>; // every label, 0-1
  image?: string; // Image Recognition: the test image (shown instead of text)
}

export interface EvalResponse {
  success: boolean;
  source: 'test-set' | 'own-examples';
  modelType: string;
  labels: string[];
  items: EvalItem[];
  practice: { correct: number; total: number };
}

/* ───────── what to send ───────── */

/**
 * The sample's test messages with `expected` as the project's label names, or [] when the project's
 * labels don't cover them (renamed labels, own data): then the backend uses the learner's own examples.
 */
export function examItems(dataset: SampleDataset, projectLabels: string[]): { text: string; expected: string }[] {
  const have = new Set(projectLabels);
  const items = dataset.test.map((t) => ({ text: t.text, expected: t.expected === NONE ? NONE : projectLabelName(t.expected) }));
  return items.every((i) => i.expected === NONE || have.has(i.expected)) ? items : [];
}

/* ───────── labels ───────── */

const STANDARD = STANDARD_LABELS.map(projectLabelName);

/** Grid order: the standard desks first (Fees, Corporate action, KYC, Complaint), then the rest in the order given. */
export function orderLabels(labels: string[]): string[] {
  const std = STANDARD.filter((l) => labels.includes(l));
  return [...std, ...labels.filter((l) => !std.includes(l))];
}

const SHORT: Record<string, string> = {
  'Fees and billing': 'Fees',
  'Corporate action': 'Corporate action',
  'Onboarding and KYC': 'KYC',
  'Complaint or escalation': 'Complaint',
};
export const shortName = (label: string) => SHORT[label] ?? label;

/** What one test item is: a message (Text Recognition) or an image (Image Recognition). */
export type Unit = 'messages' | 'images';

/** "complaints", "KYC messages", "Invoice images": how a desk's items are named in a sentence. */
export function deskNoun(label: string, n = 2, unit: Unit = 'messages'): string {
  const s = shortName(label);
  if (s === 'Complaint' && unit === 'messages') return n === 1 ? 'complaint' : 'complaints';
  return `${s} ${n === 1 ? unit.slice(0, -1) : unit}`;
}

export function defaultDesk(labels: string[]): string {
  return labels.find((l) => /complain|escalat/i.test(l)) ?? labels[0] ?? '';
}

/* ───────── before the exam: what is in it ───────── */

/** Count pills for the exam card: "Fees 3", "Corporate action 3", ..., "Off-topic 2". In `labels` order. */
export function examCounts(items: { expected: string }[], labels: string[]): { name: string; n: number }[] {
  const out = labels.map((l) => ({ name: shortName(l), n: items.filter((i) => i.expected === l).length })).filter((c) => c.n > 0);
  const off = items.filter((i) => i.expected === NONE).length;
  return off ? [...out, { name: 'Off-topic', n: off }] : out;
}

/* ───────── block 1: accuracy ───────── */

export const deskItems = (items: EvalItem[]) => items.filter((i) => i.expected !== NONE);

export function accuracy(items: EvalItem[]): { right: number; total: number; pct: number } {
  const desk = deskItems(items);
  const right = desk.filter((i) => i.predicted === i.expected).length;
  return { right, total: desk.length, pct: pct(right, desk.length) };
}

export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/* ───────── block 2: where it got confused ───────── */

/** rows = really was, cols = bot said, in `labels` order. Desk messages only. */
export function grid(items: EvalItem[], labels: string[]): number[][] {
  return labels.map((r) => labels.map((c) => deskItems(items).filter((i) => i.expected === r && i.predicted === c).length));
}

export function cellItems(items: EvalItem[], really: string, said: string): EvalItem[] {
  return deskItems(items).filter((i) => i.expected === really && i.predicted === said);
}

/** "Most mistakes: Complaint messages sent to other desks (2 of 3)." or null when there are none. */
export function mostMissesLine(items: EvalItem[], labels: string[], unit: Unit = 'messages'): string | null {
  let best: { label: string; missed: number; total: number } | null = null;
  for (const label of labels) {
    const mine = deskItems(items).filter((i) => i.expected === label);
    const missed = mine.filter((i) => i.predicted !== label).length;
    if (missed > 0 && (!best || missed > best.missed || (missed === best.missed && missed / mine.length > best.missed / best.total))) {
      best = { label, missed, total: mine.length };
    }
  }
  if (!best) return null;
  return `Most mistakes: ${shortName(best.label)} ${unit} sent to other desks (${best.missed} of ${best.total}).`;
}

const sure = (i: EvalItem) => Math.round((i.scores[i.predicted] ?? 0) * 100);

/** Below this the bot is unsure (the same line as the training page's test table). */
export const LOW_CONFIDENCE = 50;

const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * One line about the off-topic messages. When the bot was unsure about all of them (below 50%) the
 * desk it picked means nothing, so the line says how sure it was instead, e.g. 2 off-topic messages
 * ("What's the weather in Mumbai?", "Hello"): the bot has no 'none of these' answer, so it still had
 * to pick a desk, but it was only 0% and 0% sure. Otherwise: ... so it still sent them to Corporate
 * action (41%, 24% sure).
 */
export function offTopicLine(items: EvalItem[]): string | null {
  const off = items.filter((i) => i.expected === NONE);
  if (!off.length) return null;
  const quoted = off.map((i) => `“${i.text}”`).join(', ');
  const them = off.length === 1 ? 'it' : 'them';
  const intro = `${off.length} off-topic ${off.length === 1 ? 'message' : 'messages'} (${quoted}): the bot has no ‘none of these’ answer, so it still`;
  if (off.every((i) => sure(i) < LOW_CONFIDENCE)) {
    return `${intro} had to pick a desk, but it was only ${andList(off.map((i) => `${sure(i)}%`))} sure. Below ${LOW_CONFIDENCE}% means it doesn’t recognise ${them}.`;
  }
  const head = `${intro} sent ${them} to`;
  const desks = [...new Set(off.map((i) => i.predicted))];
  if (desks.length === 1) return `${head} ${desks[0]} (${off.map((i) => `${sure(i)}%`).join(', ')} sure).`;
  return `${head} ${off.map((i) => `${i.predicted} (${sure(i)}% sure)`).join(', ')}.`;
}

/* ───────── blocks 4-5: one desk, and the lean slider ───────── */

export interface DeskResult {
  caught: number; // real desk messages the bot flagged
  total: number; // real desk messages
  flagged: number; // messages the bot called this desk
  falseAlarms: number; // flagged but really another desk
  recall: number; // %
  precision: number; // %
}

/**
 * The bot's calls for one desk with a lean toward it (-50..+50). At 0 this is exactly the bot's normal
 * choice. A message is called this desk when score[desk] - best other score >= -lean/100.
 * Desk messages only (off-topic messages are left out).
 */
export function deskAtLean(items: EvalItem[], labels: string[], desk: string, lean = 0): DeskResult {
  let caught = 0;
  let total = 0;
  let falseAlarms = 0;
  for (const i of deskItems(items)) {
    const mine = i.scores[desk] ?? 0;
    const other = Math.max(0, ...labels.filter((l) => l !== desk).map((l) => i.scores[l] ?? 0));
    const flagged = lean === 0 ? i.predicted === desk : mine - other >= -lean / 100;
    if (i.expected === desk) {
      total += 1;
      if (flagged) caught += 1;
    } else if (flagged) {
      falseAlarms += 1;
    }
  }
  const flagged = caught + falseAlarms;
  return { caught, total, flagged, falseAlarms, recall: pct(caught, total), precision: pct(caught, flagged) };
}

/** Block 4's closing line: only says "one score can hide a weak desk" when it really does. */
export function hiddenWeakDeskLine(acc: { pct: number }, desk: string, r: DeskResult, unit: Unit = 'messages'): string {
  if (r.total === 0) return `There were no ${deskNoun(desk, 2, unit)} in this exam.`;
  if (r.recall < acc.pct) {
    return `Overall it scores ${acc.pct}%, but it caught only ${r.caught} of ${r.total} ${deskNoun(desk, r.total, unit)}. One overall score can hide a weak desk.`;
  }
  return `Overall it scores ${acc.pct}%, and it caught ${r.caught} of ${r.total} ${deskNoun(desk, r.total, unit)}.`;
}

/* ───────── graph: right per desk ───────── */

export interface DeskBar {
  label: string;
  total: number; // real messages for this desk
  right: number; // the bot sent them to this desk
  missed: EvalItem[]; // sent to another desk
}

/** One bar per desk, in `labels` order. Desk messages only. */
export function perDesk(items: EvalItem[], labels: string[]): DeskBar[] {
  return labels.map((label) => {
    const mine = deskItems(items).filter((i) => i.expected === label);
    return { label, total: mine.length, right: mine.filter((i) => i.predicted === label).length, missed: mine.filter((i) => i.predicted !== label) };
  });
}

/* ───────── one desk as dots (recall and precision) ───────── */

/**
 * Recall row: every real message for the desk (caught or missed).
 * Precision row: every message the bot called this desk (really the desk, or a false alarm).
 * Desk messages only, the same as deskAtLean(items, labels, desk, 0).
 */
export function deskDots(items: EvalItem[], desk: string) {
  const desks = deskItems(items);
  return {
    real: desks.filter((i) => i.expected === desk).map((item) => ({ item, ok: item.predicted === desk })),
    flagged: desks.filter((i) => i.predicted === desk).map((item) => ({ item, ok: item.expected === desk })),
  };
}
