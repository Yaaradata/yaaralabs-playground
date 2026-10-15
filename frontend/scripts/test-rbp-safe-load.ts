/**
 * Rule Based Process: a failed load must never overwrite saved work (docs/hardening.md, item 7).
 * With GET /workspace answering 500, the board must not mount, nothing may be PUT (no autosave, no
 * save on leaving), and Retry must load the real work once the server answers.
 *
 * Needs the frontend (BASE_URL, default http://localhost:3000), the backend and a seed:
 *   npx tsx scripts/responsive-seed.ts   then   npm run test:rbp-safe-load
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Seed } from './responsive-seed';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

(async () => {
  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'responsive-report', 'seed.json'), 'utf8')) as Seed;
  const rbp = seed.projects.rbp;
  const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 740 } });
  const store: Record<string, string> = {
    yaaralabs_current_masked_id: seed.masked,
    yaaralabs_playground_session_id: seed.sessionId,
    [`yaaralabs_masked_${seed.masked}`]: seed.sessionId,
    yaaralabs_playground_session_created: String(Date.now()),
    yaaralabs_playground_session_expires: String(Date.now() + 5 * 864e5),
    [`yaaralabs_project_${rbp.masked}`]: rbp.id,
  };
  await ctx.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, store);

  let failGet = true;
  const puts: string[] = [];
  await ctx.route(/\/api\/rbp\/session\/[^/]+\/projects\/[^/]+\/workspace(\?|$)/, (route) => {
    const m = route.request().method();
    if (m === 'PUT') {
      puts.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    }
    if (m === 'GET' && failGet) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal error"}' });
    return route.continue();
  });

  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/projects/${seed.masked}/${rbp.masked}`, { waitUntil: 'domcontentloaded' });

  // 1. the load failed: a Retry message, and no board
  await page.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 60000 });
  assert.ok(await page.getByText('Couldn’t load your work').isVisible(), 'the failed-load message is shown');
  assert.equal(await page.locator('.rbp-root button.tab').count(), 0, 'the board must not mount after a failed load');
  console.log('PASS a failed load shows Retry and does not mount the board');

  // 2. click and type where the board would be, wait past the 2.5 s autosave: nothing is saved
  await page.mouse.click(700, 400);
  await page.keyboard.type('x');
  await page.waitForTimeout(3500);
  assert.deepEqual(puts, [], 'no PUT after a failed load');
  console.log('PASS no autosave after a failed load');

  // 3. leaving the page (unmount) must not save either
  await page.goto(`${BASE}/projects/${seed.masked}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  assert.deepEqual(puts, [], 'no PUT when leaving after a failed load');
  console.log('PASS no save on leaving after a failed load');

  // 4. the server answers again: Retry loads the board
  await page.goto(`${BASE}/projects/${seed.masked}/${rbp.masked}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 60000 });
  failGet = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.locator('.rbp-root button.tab >> visible=true').first().waitFor({ timeout: 60000 });
  console.log('PASS Retry loads the board once the server answers');

  assert.deepEqual(errors, [], `uncaught errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('\n4 tests passed');
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
