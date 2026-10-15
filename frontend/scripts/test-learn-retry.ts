/**
 * Learn page: a failed project load shows Retry instead of sending the learner back to the project
 * list (docs/hardening.md, P1). Needs the frontend, the backend and a seed (responsive-seed.ts).
 * Run: npm run test:learn-retry
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { Seed } from './responsive-seed';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

(async () => {
  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'responsive-report', 'seed.json'), 'utf8')) as Seed;
  const text = seed.projects.text;
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
    [`yaaralabs_project_${text.masked}`]: text.id,
  });
  let fail = true;
  await ctx.route(new RegExp(`/api/guests/session/[^/]+/projects/${text.id}$`), (route) =>
    fail && route.request().method() === 'GET'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"busy"}' })
      : route.continue(),
  );
  const page = await ctx.newPage();
  const url = `${BASE}/projects/${seed.masked}/${text.masked}/learn`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 60000 });
  assert.ok(page.url().endsWith('/learn'), `stayed on the Learn page (now ${page.url()})`);
  console.log('PASS a failed load shows Retry and stays on the page');

  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByText('Train your model').first().waitFor({ timeout: 60000 });
  console.log('PASS Retry loads the page once the server answers');
  await browser.close();
  console.log('\n2 tests passed');
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
