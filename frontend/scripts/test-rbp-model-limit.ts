/**
 * Rule Based Process: "ask the model" in a forever loop stops after 20 model calls per Run
 * (docs/hardening.md, item 13). Without the cap one Run could call the server 20,000 times (GUARD).
 *
 * Needs the frontend, the backend and a seed (npx tsx scripts/responsive-seed.ts).
 * Run: npm run test:rbp-model-limit
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Seed } from './responsive-seed';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');

const block = (id: string, op: string, extra: Record<string, unknown> = {}) => ({ id, op, body: [], body2: [], items: null, fields: {}, inputs: {}, ...extra });

(async () => {
  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'responsive-report', 'seed.json'), 'utf8')) as Seed;
  const rbp = seed.projects.rbp;
  const real = await (await fetch(`${API}/api/rbp/session/${seed.sessionId}/projects/${rbp.id}/workspace`)).json();
  // when flag clicked -> forever { ask the model "Which desk?" }
  const state = {
    ...real.data.state,
    stacks: [{ x: 40, y: 20, blocks: [block('t1', 'when_flag'), block('t2', 'forever', { body: [block('t3', 'ask_model', { inputs: { PROMPT: 'Which desk?' } })] })] }],
  };

  const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 740 } });
  await ctx.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, {
    yaaralabs_current_masked_id: seed.masked,
    yaaralabs_playground_session_id: seed.sessionId,
    [`yaaralabs_masked_${seed.masked}`]: seed.sessionId,
    yaaralabs_playground_session_created: String(Date.now()),
    yaaralabs_playground_session_expires: String(Date.now() + 5 * 864e5),
    [`yaaralabs_project_${rbp.masked}`]: rbp.id,
  });
  let asks = 0;
  await ctx.route(/\/api\/rbp\/session\/[^/]+\/projects\/[^/]+\/workspace(\?|$)/, (route) => {
    const m = route.request().method();
    if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...real.data, state } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }); // don't save the test script
  });
  await ctx.route(/\/api\/rbp\/session\/[^/]+\/projects\/[^/]+\/ask(\?|$)/, (route) => {
    asks += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Corporate action', prompt: 'Which desk?' }) });
  });

  const page = await ctx.newPage();
  await page.goto(`${BASE}/projects/${seed.masked}/${rbp.masked}`, { waitUntil: 'domcontentloaded' });
  // the visible Run on the board; #run (in the moved toolbar) is disabled while a script runs
  await page.locator('#canvasrun').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.locator('#canvasrun').click();

  // let the loop run until it stops (or 25 s: the old code would still be calling)
  const started = Date.now();
  while (Date.now() - started < 25000 && (await page.locator('#run').isDisabled())) await page.waitForTimeout(250);
  await page.waitForTimeout(1000);

  assert.equal(asks, 20, `the server got ${asks} model calls in one Run (the limit is 20)`);
  console.log('PASS one Run calls the model at most 20 times');
  const text = await page.locator('.rbp-root').innerText();
  assert.match(text, /Model limit reached for this run/);
  console.log('PASS the learner sees "Model limit reached for this run"');
  assert.ok(await page.locator('#run').isEnabled(), 'the run has stopped (Run is enabled again)');
  console.log('PASS the run stopped');

  await browser.close();
  console.log('\n3 tests passed');
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
