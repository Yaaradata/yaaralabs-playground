/**
 * Label names (lib/labels.ts) and label URLs (lib/config.ts): docs/hardening.md, item 9.
 * Run: npm run test:labels
 */

import assert from 'node:assert/strict';
import config from '../lib/config';
import { labelProblem } from '../lib/labels';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test('labels with / ? # % \\ or only spaces are refused', () => {
  for (const bad of ['cats/dogs', 'Q&A?', '#1', '100%', 'a\\b', '   ', 'x'.repeat(51)]) assert.ok(labelProblem(bad), bad);
});

test('Tamil, Hindi and normal labels are fine', () => {
  for (const ok of ['கட்டணம்', 'शिकायत', 'Fees & billing', 'Onboarding and KYC', 'Desk-2_b']) assert.equal(labelProblem(ok), null, ok);
});

test('a case-only duplicate is refused', () => {
  assert.ok(labelProblem('fees', ['Fees']));
  assert.equal(labelProblem('Fees', ['Fees']), null);
});

test('labels are encoded in delete URLs', () => {
  const g = config.api.guests;
  assert.ok(g.deleteLabel('s', 'p', 'cats/dogs').endsWith('/labels/cats%2Fdogs'));
  assert.ok(g.deleteImageLabel('s', 'p', 'Q&A?').endsWith('/images/labels/Q%26A%3F'));
  assert.ok(g.deleteEmptyLabel('s', 'p', '#1').includes('/labels/%231/empty'));
  assert.ok(g.deleteSpecificImageExample('s', 'p', 'கட்டணம்', 0).includes(encodeURIComponent('கட்டணம்')));
});

console.log(`\n${passed} tests passed`);
