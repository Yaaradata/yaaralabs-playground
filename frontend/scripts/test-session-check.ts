/**
 * Tests for the guest-session check (lib/session-cleanup.ts): a session is only cleaned up when the
 * backend says it is gone. A server error or a network failure must keep it, with every project in it.
 * Run: npm run test:session-check
 */

import assert from 'node:assert/strict';
import { classifySessionCheck, SessionCleanupReason } from '../lib/session-cleanup';

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

const now = new Date('2026-10-15T10:00:00Z');
const body = (active: boolean, expiresAt: string) => ({ success: true, data: { active, expiresAt } });
const tomorrow = '2026-10-16T10:00:00Z';
const yesterday = '2026-10-14T10:00:00Z';

test('200, active, not expired: valid', () => {
  const r = classifySessionCheck(200, body(true, tomorrow), now);
  assert.equal(r.kind, 'valid');
});

test('200, inactive: gone (inactive)', () => {
  const r = classifySessionCheck(200, body(false, tomorrow), now);
  assert.deepEqual([r.kind, r.kind === 'gone' && r.reason], ['gone', SessionCleanupReason.INACTIVE_BACKEND]);
});

test('200, expired: gone (expired)', () => {
  const r = classifySessionCheck(200, body(true, yesterday), now);
  assert.deepEqual([r.kind, r.kind === 'gone' && r.reason], ['gone', SessionCleanupReason.EXPIRED_BACKEND]);
});

test('404: gone (not found)', () => {
  const r = classifySessionCheck(404, null, now);
  assert.deepEqual([r.kind, r.kind === 'gone' && r.reason], ['gone', SessionCleanupReason.NOT_FOUND_BACKEND]);
});

for (const status of [500, 502, 503, 504, 429, 408, 401, 0]) {
  test(`${status}: unknown, keep the session`, () => {
    assert.equal(classifySessionCheck(status, null, now).kind, 'unknown');
  });
}

test('network failure (fetch threw): unknown, keep the session', () => {
  assert.equal(classifySessionCheck(null, null, now).kind, 'unknown');
});

test('200 with an unreadable or unexpected body: unknown, keep the session', () => {
  assert.equal(classifySessionCheck(200, null, now).kind, 'unknown');
  assert.equal(classifySessionCheck(200, { success: false, data: null }, now).kind, 'unknown');
  assert.equal(classifySessionCheck(200, { success: true, data: { active: true, expiresAt: 'not a date' } }, now).kind, 'unknown');
});

console.log(`\n${passed} tests passed`);
