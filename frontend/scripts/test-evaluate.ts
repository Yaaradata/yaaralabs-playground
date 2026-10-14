/**
 * Tests for the Evaluate page logic (components/ProjectEvaluate/evaluate.ts).
 * The fixture is the backend's /evaluate response for the default model (sentence_embed_lr) trained on
 * the 20 sample custody queries and scored on the sample's 14 test messages (see backend/test_text_evaluate.py).
 * Run: npm run test:evaluate
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NONE,
  accuracy,
  cellItems,
  defaultDesk,
  deskNoun,
  deskAtLean,
  deskDots,
  examCounts,
  examItems,
  grid,
  hiddenWeakDeskLine,
  mostMissesLine,
  offTopicLine,
  orderLabels,
  perDesk,
  shortName,
  surePct,
  termRows,
  type EvalResponse,
} from '../components/ProjectEvaluate/evaluate';
import { validateDataset } from '../components/SampleLabelling/sample';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const res = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'evaluate-sample.json'), 'utf8')) as EvalResponse;
const sample = validateDataset(JSON.parse(readFileSync(join(__dirname, '..', 'public', 'datasets', 'nuvama_custody_queries.json'), 'utf8')));
const labels = orderLabels(res.labels);
const COMPLAINT = 'Complaint or escalation';

test('grid order and short names', () => {
  assert.deepEqual(labels, ['Fees and billing', 'Corporate action', 'Onboarding and KYC', COMPLAINT]);
  assert.deepEqual(labels.map(shortName), ['Fees', 'Corporate action', 'KYC', 'Complaint']);
});

test('exam items: sample test with project label names', () => {
  const items = examItems(sample, labels);
  assert.equal(items.length, 14);
  assert.ok(items.some((i) => i.expected === 'Fees and billing'));
  assert.equal(items.filter((i) => i.expected === NONE).length, 2);
});

test('exam items: renamed label sends nothing (own examples)', () => {
  assert.deepEqual(examItems(sample, ['Billing', 'Corporate action', 'Onboarding and KYC', COMPLAINT]), []);
});

test('block 1: 10 of 12 desk messages, 83%', () => {
  assert.deepEqual(accuracy(res.items), { right: 10, total: 12, pct: 83 });
});

test('block 2: grid and most mistakes', () => {
  assert.deepEqual(grid(res.items, labels), [
    [3, 0, 0, 0],
    [0, 3, 0, 0],
    [0, 0, 2, 1],
    [1, 0, 0, 2],
  ]);
  assert.equal(mostMissesLine(res.items, labels), 'Most mistakes: KYC messages sent to other desks (1 of 3).');
  assert.deepEqual(
    cellItems(res.items, COMPLAINT, 'Fees and billing').map((i) => i.text),
    ['You charged us twice and nobody has fixed it in a month. Escalate this now.'],
  );
  assert.deepEqual(
    cellItems(res.items, 'Onboarding and KYC', COMPLAINT).map((i) => i.text),
    ['Our authorised signatory has left the company. Please remove her.'],
  );
});

test('block 2: off-topic line (under 1% sure, so no desk is named)', () => {
  assert.equal(
    offTopicLine(res.items),
    "2 off-topic messages (“What's the weather in Mumbai?”, “Hello”): it was only under 1% and under 1% sure, so they go to a person.",
  );
});

test('surePct: under 1% instead of a rounded 0%', () => {
  assert.equal(surePct(0.004), 'under 1%');
  assert.equal(surePct(0), 'under 1%');
  assert.equal(surePct(0.01), '1%');
  assert.equal(surePct(0.674), '67%');
});

test('block 2: off-topic line when the bot was sure of a desk', () => {
  const item = (text: string, s: number) => ({ text, expected: NONE, predicted: 'Corporate action', scores: { 'Corporate action': s } });
  assert.equal(
    offTopicLine([item('Hello', 0.62), item('Weather', 0.7)]),
    '2 off-topic messages (“Hello”, “Weather”): the bot has no ‘none of these’ answer, so it still sent them to Corporate action (62%, 70% sure).',
  );
});

test('block 4: Complaint caught 2 of 3, 2 of 3 right', () => {
  assert.equal(defaultDesk(labels), COMPLAINT);
  const r = deskAtLean(res.items, labels, COMPLAINT, 0);
  assert.deepEqual(r, { caught: 2, total: 3, flagged: 3, falseAlarms: 1, recall: 67, precision: 67 });
  assert.equal(
    hiddenWeakDeskLine(accuracy(res.items), COMPLAINT, r),
    'Overall it scores 83%, but it caught only 2 of 3 complaint messages. One overall score can hide a weak desk.',
  );
});

test('block 5: lean slider for Complaint', () => {
  const at = (lean: number) => {
    const r = deskAtLean(res.items, labels, COMPLAINT, lean);
    return [r.caught, r.falseAlarms];
  };
  assert.deepEqual(at(-10), [2, 1]);
  assert.deepEqual(at(0), [2, 1]);
  assert.deepEqual(at(10), [2, 1]);
  assert.deepEqual(at(25), [2, 1]);
  assert.deepEqual(at(40), [3, 2]);
});

test('block 4: neutral line when the desk is not weaker than overall', () => {
  const r = deskAtLean(res.items, labels, 'Fees and billing', 0);
  assert.equal(r.recall, 100);
  assert.ok(!hiddenWeakDeskLine(accuracy(res.items), 'Fees and billing', r).includes('hide a weak desk'));
});

test('graph: right per desk', () => {
  assert.deepEqual(
    perDesk(res.items, labels).map((b) => [shortName(b.label), b.right, b.total, b.missed.length]),
    [['Fees', 3, 3, 0], ['Corporate action', 3, 3, 0], ['KYC', 2, 3, 1], ['Complaint', 2, 3, 1]],
  );
});

test('dots: Complaint recall row and precision row agree with the numbers', () => {
  const { real, flagged } = deskDots(res.items, COMPLAINT);
  const r = deskAtLean(res.items, labels, COMPLAINT, 0);
  assert.equal(real.length, r.total);
  assert.equal(real.filter((d) => d.ok).length, r.caught);
  assert.equal(flagged.length, r.flagged);
  assert.equal(flagged.filter((d) => !d.ok).length, r.falseAlarms);
  assert.deepEqual(flagged.filter((d) => !d.ok).map((d) => d.item.text), ['Our authorised signatory has left the company. Please remove her.']);
});

test('images: wording uses images, not messages or complaints', () => {
  assert.equal(deskNoun('Invoice', 2, 'images'), 'Invoice images');
  assert.equal(deskNoun('Invoice', 1, 'images'), 'Invoice image');
  assert.equal(deskNoun(COMPLAINT, 2, 'images'), 'Complaint images');
  assert.equal(deskNoun(COMPLAINT, 2), 'complaint messages');
  assert.equal(deskNoun('Onboarding and KYC', 1), 'KYC message');
  const items = [
    { text: 'Deep 01', expected: 'KYC', predicted: 'KYC', scores: { KYC: 0.9, Invoice: 0.1 }, image: '/x.jpg' },
    { text: 'Deep 02', expected: 'Invoice', predicted: 'KYC', scores: { KYC: 0.6, Invoice: 0.4 }, image: '/y.jpg' },
  ];
  assert.equal(mostMissesLine(items, ['KYC', 'Invoice'], 'images'), 'Most mistakes: Invoice images sent to other desks (1 of 1).');
  const r = deskAtLean(items, ['KYC', 'Invoice'], 'Invoice', 0);
  assert.ok(hiddenWeakDeskLine(accuracy(items), 'Invoice', r, 'images').includes('0 of 1 Invoice image.'));
});

test('labels outside the standard desks keep their given order', () => {
  assert.deepEqual(orderLabels(['KYC', 'Invoice', 'Cheque']), ['KYC', 'Invoice', 'Cheque']);
});

test('practice 20 of 20', () => {
  assert.deepEqual(res.practice, { correct: 20, total: 20 });
});

test('exam card: count pills from the sample', () => {
  const pills = examCounts(examItems(sample, labels), labels).map((c) => `${c.name} ${c.n}`);
  assert.deepEqual(pills, ['Fees 3', 'Corporate action 3', 'KYC 3', 'Complaint 3', 'Off-topic 2']);
});

const yours = (rows: { term: string; yours: string }[]) => Object.fromEntries(rows.map((r) => [r.term, r.yours]));

test('terms table: Complaint', () => {
  const rows = termRows(res.items, labels, COMPLAINT, res.practice);
  assert.deepEqual(rows.map((r) => r.term), [
    'Test set', 'Ground truth', 'Accuracy', 'Confusion matrix', 'Recall', 'Precision',
    'False negative', 'False positive', 'Confidence score', 'Overfitting',
  ]);
  const y = yours(rows);
  assert.equal(y['Test set'], '14 messages');
  assert.equal(y['Ground truth'], 'Every message');
  assert.equal(y.Accuracy, '10 of 12 (83%)');
  assert.equal(y['Confusion matrix'], '2 mistakes');
  assert.equal(y.Recall, '2 of 3 (67%)');
  assert.equal(y.Precision, '2 of 3 (67%)');
  assert.equal(y['False negative'], '1');
  assert.equal(y['False positive'], '1');
  assert.equal(y['Confidence score'], 'Off-topic: under 1%');
  assert.equal(y.Overfitting, '20 of 20 vs 10 of 12');
  const m = Object.fromEntries(rows.map((r) => [r.term, r.meaning]));
  assert.equal(m.Recall, 'Catch rate: of the real complaint messages, how many it found');
  assert.equal(m['False negative'], 'A miss: a real complaint message sent to another desk');
  assert.equal(m['Ground truth'], 'The answer key: labels a person gave');
});

test('terms table: KYC', () => {
  const rows = termRows(res.items, labels, 'Onboarding and KYC', res.practice);
  const y = yours(rows);
  assert.equal(y.Precision, '2 of 2 (100%)');
  assert.equal(y['False positive'], '0');
  assert.equal(rows.find((r) => r.term === 'Precision')?.meaning, 'Alert quality: when it said KYC, how often it was right');
});

test('terms table: images (no practice score, no Overfitting row) and own labels', () => {
  const items = [
    { text: 'Test 01', expected: 'Cheque', predicted: 'Cheque', scores: { Cheque: 0.9, Invoice: 0.1 }, image: '/a.jpg' },
    { text: 'Test 02', expected: 'Cheque', predicted: 'Invoice', scores: { Cheque: 0.3, Invoice: 0.7 }, image: '/b.jpg' },
    { text: 'Test 03', expected: 'Invoice', predicted: 'Invoice', scores: { Cheque: 0.2, Invoice: 0.8 }, image: '/c.jpg' },
  ];
  const rows = termRows(items, ['Invoice', 'Cheque'], 'Cheque', { correct: 0, total: 0 }, 'images');
  assert.ok(!rows.some((r) => r.term === 'Overfitting'));
  const y = yours(rows);
  assert.equal(y['Test set'], '3 images');
  assert.equal(y['Ground truth'], 'Every image');
  assert.equal(y['Confusion matrix'], '1 mistake');
  assert.equal(y['Confidence score'], 'Lowest: 70%');
  assert.equal(rows.find((r) => r.term === 'Recall')?.meaning, 'Catch rate: of the real Cheque images, how many it found');
  assert.equal(rows.find((r) => r.term === 'False negative')?.meaning, 'A miss: a real Cheque image sent to another label');
  const own = termRows(res.items, labels, COMPLAINT, res.practice, 'messages', true);
  assert.equal(own.find((r) => r.term === 'Ground truth')?.meaning, 'The answer key: your own labels');
  assert.equal(yours(termRows(res.items, labels, COMPLAINT, { correct: 0, total: 0 })).Overfitting, undefined);
});

console.log(`\n${passed} tests passed`);
