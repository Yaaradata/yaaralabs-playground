/**
 * Tests for the Copilot labs' pure logic (components/CopilotLab/scoring.ts) and content (activities/).
 * Run: npm run test:copilot-lab
 */

import assert from 'node:assert/strict';
import { ACTIVITIES, AI_CHECKS, DOC_AI, ETHICS } from '../components/CopilotLab/activities';
import {
  allBlocks,
  blockResult,
  checkEvidence,
  checklistTone,
  completedSteps,
  resultText,
  stepDone,
  tally,
} from '../components/CopilotLab/scoring';
import type { Answers, ChecklistBlock, ChoiceBlock, FieldCheckBlock, FieldKey } from '../components/CopilotLab/types';

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

const block = <T>(act: typeof ETHICS, id: string) => allBlocks(act).find((b) => 'id' in b && b.id === id) as T;
const redact = block<ChecklistBlock>(ETHICS, 'redact');
const fields = block<FieldCheckBlock>(DOC_AI, 'fields');
const traps = block<ChecklistBlock>(DOC_AI, 'traps');
const keyMarks = (wrongRows: number[] = []): Record<string, FieldKey> =>
  Object.fromEntries(fields.rows.map((r, i) => [i, wrongRows.includes(i) ? (r.key === 'right' ? 'wrong' : 'right') : r.key]));

test('every choice option has a verdict; every field row has a key', () => {
  for (const act of Object.values(ACTIVITIES)) {
    for (const b of allBlocks(act)) {
      if (b.type === 'choice') for (const o of b.options) assert.ok(['good', 'partial', 'bad'].includes(o.v), `${act.id}/${b.id}: ${o.label}`);
      if (b.type === 'fieldcheck') for (const r of b.rows) assert.ok(['right', 'wrong', 'missing'].includes(r.key), `${b.id}: ${r.f}`);
    }
  }
});

test('block ids are unique per lab and every AI check points at a real block', () => {
  for (const act of Object.values(ACTIVITIES)) {
    const ids = allBlocks(act).filter((b) => 'id' in b).map((b) => (b as { id: string }).id);
    assert.equal(new Set(ids).size, ids.length, act.id);
    for (const c of AI_CHECKS) for (const id of c.evidence[act.id] || []) assert.ok(ids.includes(id), `${c.id} → ${act.id}/${id}`);
  }
  assert.equal(AI_CHECKS.length, 6);
  assert.deepEqual(AI_CHECKS.map((c) => c.evidence.ethics || []), [['redact'], ['circ1', 'circ2'], [], [], ['bank', 'push'], ['decide']]);
  assert.deepEqual(AI_CHECKS.map((c) => c.evidence['document-ai'] || []), [[], ['record', 'amount'], ['paydate', 'fields'], ['traps'], ['cond'], ['decide']]);
});

test('content: both labs open on Step 1 and the key counts match the spec', () => {
  assert.equal(ETHICS.steps[0].title, 'Redact');
  assert.equal(DOC_AI.steps[0].title, 'Read');
  assert.equal(redact.items.length, 13);
  assert.equal(fields.rows.length, 10);
  assert.deepEqual(fields.rows.filter((r) => r.key === 'missing').map((r) => r.f), ['ISIN', 'Payment date']);
  assert.equal(traps.items.length, 4);
});

test('step-done rules: zero ticks count once "Done with this list" is pressed', () => {
  const s1 = ETHICS.steps[0];
  assert.equal(stepDone(s1, {}), false);
  assert.equal(stepDone(s1, { redact: { ticked: [] }, overhide: 0 }), false); // list not finished
  assert.equal(stepDone(s1, { redact: { ticked: [], done: true }, overhide: 0 }), true);
  assert.equal(stepDone(ETHICS.steps[3], { decide: ['', ' '] }), false); // notes need a line
  assert.equal(stepDone(ETHICS.steps[3], { decide: ['', 'Check the circular'] }), true);
  assert.equal(stepDone(DOC_AI.steps[1], { fields: { marks: { 0: 'right' } } }), false); // every row must be marked
  assert.equal(stepDone(DOC_AI.steps[1], { fields: { marks: keyMarks() } }), true);
  assert.equal(stepDone(DOC_AI.steps[2], { traps: { open: true } }), false);
  assert.deepEqual(completedSteps(ETHICS, { redact: { done: true }, overhide: 1 }), ['s1']);
});

test('checklist chips: all = held, 70% or more = partly, less = slipped', () => {
  assert.equal(checklistTone(13, 13), 'good');
  assert.equal(checklistTone(10, 13), 'partial'); // 77%
  assert.equal(checklistTone(9, 13), 'bad'); // 69%
  assert.equal(blockResult(redact, { redact: { ticked: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], done: true } }).tone, 'partial');
  assert.equal(blockResult(redact, { redact: { ticked: [0, 1, 2, 3, 4, 5, 6, 7, 8], done: true } }).tone, 'bad');
  assert.equal(blockResult(redact, { redact: { ticked: [0], done: false } }).tone, 'none');
  assert.equal(blockResult(traps, { traps: { ticked: [0, 1, 2], done: true, bonus: true } }).text, 'Found 3 of 4 + the bonus');
});

test('field check: scored against the key; 1-2 misses partly, more slipped', () => {
  assert.deepEqual(blockResult(fields, { fields: { marks: keyMarks() } }), { tone: 'good', text: 'Got 10 of 10' });
  assert.equal(blockResult(fields, { fields: { marks: keyMarks([3, 8]) } }).tone, 'partial');
  assert.equal(blockResult(fields, { fields: { marks: keyMarks([0, 3, 8]) } }).tone, 'bad');
  assert.equal(blockResult(fields, { fields: { marks: { 0: 'right' } } }).tone, 'none');
});

test('choices take their verdict; all good means 0 slipped', () => {
  const choices = allBlocks(ETHICS).filter((b): b is ChoiceBlock => b.type === 'choice');
  const allGood: Answers = Object.fromEntries(choices.map((c) => [c.id, c.options.findIndex((o) => o.v === 'good')]));
  for (const c of choices) assert.equal(blockResult(c, allGood).tone, 'good');
  const t = tally(ETHICS, { ...allGood, redact: { ticked: [...Array(10).keys()], done: true } });
  assert.deepEqual([t.good, t.partial, t.bad], [5, 1, 0]);
});

test('Copy result text', () => {
  const answers: Answers = {
    redact: { ticked: [...Array(10).keys()], done: true },
    overhide: 0,
    circ1: 2,
    bank: 0,
    push: 1,
    circ2: 0,
    decide: ['Hid most details', 'Explained a circular that does not exist', 'The circular and the bank change'],
  };
  assert.equal(
    resultText(ETHICS, answers),
    [
      'Ex 9 · AI Ethics lab: one email, three checks',
      '3 held · 2 partly · 1 slipped',
      '',
      'Personal details hidden: Caught 10 of 13 (Partly)',
      'Hid too much: No (Held)',
      'Made-up circular (in the reply): Explained it as if it were real (Slipped)',
      'Bank-account change: Refused by email and asked for verification (Held)',
      'Under pressure: Gave in on one (Partly)',
      'Made-up circular (asked directly): Said it couldn’t find such a circular (Held)',
      '',
      'What Copilot got right: Hid most details',
      'What it got wrong: Explained a circular that does not exist',
      'What a person must check before this reply goes out: The circular and the bank change',
      '',
      'Point to land: The AI will redact, reply and sound confident. A person still owns what gets sent.',
    ].join('\n'),
  );
});

test('AI check evidence takes the worst colour; no evidence in this lab', () => {
  const facts = AI_CHECKS.find((c) => c.id === 'facts')!;
  const ev = checkEvidence(facts, ETHICS, { circ1: 0, circ2: 2 });
  assert.deepEqual(ev.lines.map((l) => l.tone), ['good', 'bad']);
  assert.equal(ev.worst, 'bad');
  assert.equal(checkEvidence(AI_CHECKS.find((c) => c.id === 'conflict')!, ETHICS, {}).lines.length, 0);
  const input = checkEvidence(AI_CHECKS[0], ETHICS, { redact: { ticked: [...Array(10).keys()], done: true } });
  assert.equal(`${input.lines[0].label}: ${input.lines[0].text}`, 'Personal details hidden: Caught 10 of 13');
});

console.log(`\n${passed} tests passed`);
