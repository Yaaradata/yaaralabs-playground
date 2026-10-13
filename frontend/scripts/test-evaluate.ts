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
  deskAtLean,
  examItems,
  grid,
  hiddenWeakDeskLine,
  mostMissesLine,
  offTopicLine,
  orderLabels,
  shortName,
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

test('block 2: off-topic line (the bot was 0% sure, so no desk is named)', () => {
  assert.equal(
    offTopicLine(res.items),
    "2 off-topic messages (“What's the weather in Mumbai?”, “Hello”): the bot has no ‘none of these’ answer, so it still had to pick a desk, but it was only 0% and 0% sure. Below 50% means it doesn’t recognise them.",
  );
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
    'Overall it scores 83%, but it caught only 2 of 3 complaints. One overall score can hide a weak desk.',
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

test('practice 20 of 20', () => {
  assert.deepEqual(res.practice, { correct: 20, total: 20 });
});

console.log(`\n${passed} tests passed`);
