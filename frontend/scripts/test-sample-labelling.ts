/**
 * Tests for the sample labelling logic (components/SampleLabelling/sample.ts).
 * Run: npm run test:sample-labelling
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MIN_PER_LABEL,
  batches,
  canGroup,
  countByLabel,
  examplesToAdd,
  fillAllLabels,
  isValidLabelName,
  labelledCount,
  projectLabelName,
  usesSampleLabels,
  validateDataset,
  type Choices,
} from '../components/SampleLabelling/sample';

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

const data = validateDataset(JSON.parse(readFileSync(join(__dirname, '..', 'public', 'datasets', 'nuvama_custody_queries.json'), 'utf8')));
const L = data.labels;
const byLabel = (label: string) => data.queries.filter((q) => q.label === label);
/** Choices that follow the trainer's key for the first n queries of every label. */
const answerKey = (n = 6): Choices =>
  Object.fromEntries(L.flatMap((l) => byLabel(l.label).slice(0, n).map((q) => [q.id, q.label])));

test('file: 6 labels, 36 queries (6 each), 12 test messages', () => {
  assert.equal(L.length, 6);
  assert.equal(data.queries.length, 36);
  for (const l of L) assert.equal(byLabel(l.label).length, 6, l.label);
  assert.equal(data.test.length, 12);
  assert.equal(data.test.filter((t) => t.expected === 'None of these').length, 2);
});

test('label names: readable and allowed by the label rules', () => {
  assert.deepEqual(L.map((l) => projectLabelName(l.label)), [
    'Statement request', 'Corporate action', 'Settlement status', 'Fees and billing', 'Onboarding and KYC',
    'Complaint or escalation',
  ]);
  for (const l of L) assert.ok(isValidLabelName(projectLabelName(l.label)), l.label);
  assert.equal(projectLabelName('  A  &  B / C!  '), 'A and B or C');
});

test('counter: counts per label and labelled total, ignoring cleared rows', () => {
  const choices: Choices = { 1: 'Statement request', 2: 'Statement request', 6: 'Corporate action', 9: '' };
  const counts = countByLabel(L, choices);
  assert.equal(counts['Statement request'], 2);
  assert.equal(counts['Corporate action'], 1);
  assert.equal(counts['Fees & billing'], 0);
  assert.equal(labelledCount(choices), 3);
});

test('Group it: enabled only when every label has at least 5', () => {
  assert.equal(MIN_PER_LABEL, 5);
  assert.equal(canGroup(L, {}), false);
  assert.equal(canGroup(L, answerKey(4)), false, '4 per label is not enough');
  const almost = answerKey(5);
  delete almost[byLabel('Fees & billing')[0].id];
  assert.equal(canGroup(L, almost), false, 'one label at 4 blocks it');
  assert.equal(canGroup(L, answerKey(5)), true, '5 per label is enough');
  assert.equal(canGroup(L, answerKey(6)), true);
});

test('Fill labels: every query gets its sample answer key', () => {
  const filled = fillAllLabels(data.queries);
  assert.equal(Object.keys(filled).length, 36);
  for (const q of data.queries) assert.equal(filled[q.id], q.label);
  assert.equal(canGroup(L, filled), true);
});

test('add: one example per labelled row, under the project label name; unlabelled rows skipped', () => {
  const choices: Choices = { 2: 'Statement request', 19: 'Fees & billing' };
  const items = examplesToAdd(data.queries, choices, []);
  assert.deepEqual(items, [
    { label: 'Statement request', text: data.queries.find((x) => x.id === 2)!.text },
    { label: 'Fees and billing', text: data.queries.find((x) => x.id === 19)!.text },
  ]);
});

test('add: idempotent - texts already under the label are skipped, others are kept', () => {
  const choices = answerKey(6);
  const first = examplesToAdd(data.queries, choices, []);
  assert.equal(first.length, 36);
  // the project after the first add, plus a learner's own example
  const project = [...new Set(first.map((i) => i.label))].map((label) => ({
    label,
    texts: first.filter((i) => i.label === label).map((i) => i.text),
  }));
  project[0].texts.push('my own example');
  assert.deepEqual(examplesToAdd(data.queries, choices, project), [], 'grouping twice adds nothing');
  // spacing and case do not make a duplicate new
  const spaced = [{ label: 'Statement request', texts: [`  ${data.queries[1].text.toUpperCase()}  `] }];
  assert.ok(!examplesToAdd(data.queries, { [data.queries[1].id]: 'Statement request' }, spaced).length);
  // the same text under a different label is a different example
  const elsewhere = [{ label: 'Corporate action', texts: [data.queries[1].text] }];
  assert.equal(examplesToAdd(data.queries, { [data.queries[1].id]: 'Statement request' }, elsewhere).length, 1);
});

test('add: texts with commas stay whole (no splitting on the client)', () => {
  const q = data.queries.find((x) => x.text.includes('5,000'))!;
  const [item] = examplesToAdd(data.queries, { [q.id]: q.label }, []);
  assert.equal(item.text, q.text);
});

test('batches of at most 50 (the server limit per request)', () => {
  assert.deepEqual(batches([1, 2, 3], 50), [[1, 2, 3]]);
  assert.deepEqual(batches(Array.from({ length: 120 }, (_, i) => i), 50).map((b) => b.length), [50, 50, 20]);
});

test('test messages show only when the project uses the sample labels', () => {
  assert.equal(usesSampleLabels(data, ['happy', 'sad']), false);
  assert.equal(usesSampleLabels(data, ['Statement request', 'Fees and billing']), true);
});

test('bad file is rejected with a clear message', () => {
  assert.throws(() => validateDataset({}), /expected format/);
  assert.throws(() => validateDataset({ labels: [{ label: 'A', desk: '', covers: '' }], queries: [{ id: 1, text: 'x', label: 'B', difficulty: '', note: '' }], test: [] }), /unknown label/);
});

console.log(`\n${passed} tests passed`);
