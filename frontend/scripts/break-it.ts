/**
 * The "naughty participant" (docs/hardening.md, part A): hostile text in every visible field, odd file
 * uploads, double-clicks on the main buttons, two tabs on one project, a reload mid-training, and another
 * session's project in the URL, on every project type.
 *
 * Pass rule per check: no uncaught page error, no white screen, no "Application error", no visible stack
 * trace. Screenshots of failures and index.html go to break-it-report/.
 *
 * Needs the frontend (BASE_URL), the backend and a seed (npx tsx scripts/responsive-seed.ts).
 * Run: npm run test:break-it
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import type { Seed } from './responsive-seed';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const OUT = join(__dirname, '..', 'break-it-report');

const HOSTILE = [
  '',
  '     ',
  'x'.repeat(10_000),
  '😀🔥🙏'.repeat(30),
  'கட்டணம் शिकायत مرحبا',
  '<script>window.__pwned=1</script>',
  '<img src=x onerror="window.__pwned=1">',
  '{{7*7}} ${7*7}',
  '../../etc/passwd',
  "' OR 1=1 --",
  'a,'.repeat(2500),
  'a\u0000b 9.49.12 AM',
];

interface Result {
  page: string;
  check: string;
  ok: boolean;
  problems: string[];
  shot?: string;
}
const results: Result[] = [];

async function verdict(page: Page, errors: string[], name: string, check: string) {
  const problems = [...errors];
  const state = await page
    .evaluate(() => ({
      text: (document.body?.innerText || '').trim(),
      pwned: (window as unknown as { __pwned?: number }).__pwned ?? 0,
    }))
    .catch(() => ({ text: '', pwned: 0 }));
  if (state.text.length < 20) problems.push('white screen');
  if (/Application error|Unhandled Runtime Error/i.test(state.text)) problems.push('"Application error" on screen');
  if (/Traceback \(most recent call|\n\s+at [\w.$<>]+ \(.*:\d+:\d+\)|\.tsx?:\d+:\d+/.test(state.text)) problems.push('stack trace on screen');
  if (state.pwned) problems.push('a script from user input ran');
  const ok = problems.length === 0;
  let shot: string | undefined;
  if (!ok) {
    mkdirSync(OUT, { recursive: true });
    shot = `${name}-${check}`.replace(/[^a-z0-9-]+/gi, '_') + '.png';
    await page.screenshot({ path: join(OUT, shot), fullPage: false }).catch(() => {});
  }
  results.push({ page: name, check, ok, problems, shot });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${check}${ok ? '' : ` -> ${problems.join('; ')}`}`);
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message.slice(0, 140)}`));
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));
  return errors;
}

async function open(ctx: BrowserContext, path: string, ready = 'body') {
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator(ready).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { page, errors };
}

async function fillEverything(page: Page) {
  const fields = page.locator('input[type=text]:visible, input:not([type]):visible, textarea:visible, input[type=search]:visible');
  const n = Math.min(await fields.count(), 12);
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    for (const v of HOSTILE) {
      await f.fill(v, { timeout: 3000 }).catch(() => {});
    }
    await f.press('Tab').catch(() => {});
  }
  await page.waitForTimeout(1500);
}

async function main() {
  const seed = JSON.parse(readFileSync(join(__dirname, '..', 'responsive-report', 'seed.json'), 'utf8')) as Seed;
  const P = seed.projects;
  const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 740 } });
  const store: Record<string, string> = {
    yaaralabs_current_masked_id: seed.masked,
    yaaralabs_playground_session_id: seed.sessionId,
    [`yaaralabs_masked_${seed.masked}`]: seed.sessionId,
    yaaralabs_playground_session_created: String(Date.now()),
    yaaralabs_playground_session_expires: String(Date.now() + 5 * 864e5),
  };
  for (const p of Object.values(P)) store[`yaaralabs_project_${p.masked}`] = p.id;
  await ctx.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, store);
  const proj = (k: string, sub = '') => `/projects/${seed.masked}/${P[k].masked}${sub}`;

  // 1. hostile text in every visible field, on every project type
  const pages: [string, string][] = [
    ['projects list', `/projects/${seed.masked}`],
    ['text collect', proj('text', '/train')],
    ['text train and test', proj('text', '/learn')],
    ['text evaluate', proj('text', '/evaluate')],
    ['image collect', proj('image', '/train')],
    ['rule based process', proj('rbp')],
    ['live object detection', proj('lod')],
    ['custom ai agent', proj('assistant')],
    ['rag chatbot', proj('rag')],
    ['ai agent', proj('agent')],
    ['copilot ethics', proj('ethics')],
    ['copilot document ai', proj('docai')],
  ];
  for (const [name, path] of pages) {
    const { page, errors } = await open(ctx, path);
    await fillEverything(page);
    await verdict(page, errors, name, 'hostile text in every field');
    await page.close();
  }

  // 2. odd files on Image Collect
  {
    const { page, errors } = await open(ctx, proj('image', '/train'), 'input[type=file]');
    await page.locator('#image-label').fill('Odd files').catch(() => {});
    const big = Buffer.alloc(15 * 1024 * 1024, 0xff);
    big.write('\xff\xd8\xff\xe0', 0, 'binary');
    const files = [
      { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
      { name: 'setup.exe.png', mimeType: 'image/png', buffer: Buffer.from('MZ\x90\x00 this is not an image', 'binary') },
      { name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('\x00\x00\x00\x18ftypheic', 'binary') },
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: big },
      ...Array.from({ length: 25 }, (_, i) => ({ name: `img${i}.png`, mimeType: 'image/png', buffer: Buffer.from('not really a png') })),
    ];
    const input = page.locator('input[type=file]').first();
    for (const batch of [files.slice(0, 1), files.slice(1, 2), files.slice(2, 3), files.slice(3, 4), files.slice(4)]) {
      await input.setInputFiles(batch).catch((e) => errors.push(`setInputFiles: ${String(e).slice(0, 80)}`));
      await page.waitForTimeout(3000);
    }
    await verdict(page, errors, 'image collect', 'odd files (empty, .exe as .png, HEIC, 15 MB, 25 at once)');
    await page.close();
  }

  // 3. double-clicks on the main buttons
  for (const [name, path, button] of [
    ['text train and test', proj('text', '/learn'), 'button:has-text("Train again"), button:has-text("Train")'],
    ['text evaluate', proj('text', '/evaluate'), 'button:has-text("Run the exam")'],
    ['custom ai agent', proj('assistant'), 'button:has-text("Save Persona")'],
  ] as const) {
    const { page, errors } = await open(ctx, path, button);
    await page.locator(button).first().dblclick({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(6000);
    await verdict(page, errors, name, 'double-click the main button');
    await page.close();
  }

  // 4. the same project in two tabs, edited in both
  {
    const a = await open(ctx, proj('ethics'), '.rail-item');
    const b = await open(ctx, proj('ethics'), '.rail-item');
    for (const t of [a, b]) {
      const box = t.page.locator('textarea:visible').first();
      await box.fill(`edited in tab ${t === a ? 'A' : 'B'}`).catch(() => {});
    }
    await a.page.waitForTimeout(2500);
    await verdict(a.page, a.errors, 'copilot ethics', 'two tabs, tab A');
    await verdict(b.page, b.errors, 'copilot ethics', 'two tabs, tab B');
    await a.page.close();
    await b.page.close();
  }

  // 5. reload in the middle of training
  {
    const { page, errors } = await open(ctx, proj('text', '/learn'), 'button:has-text("Train")');
    await page.locator('button:has-text("Train again"), button:has-text("Train")').first().click().catch(() => {});
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);
    await verdict(page, errors, 'text train and test', 'reload mid-training');
    const status = await (await fetch(`${API}/api/guests/session/${seed.sessionId}/projects/${P.text.id}`)).json().catch(() => ({}));
    const kept = Boolean(status?.data?.dataset?.examples?.length);
    results.push({ page: 'text train and test', check: 'examples still there after the reload', ok: kept, problems: kept ? [] : ['examples lost'] });
    console.log(`${kept ? 'PASS' : 'FAIL'} text train and test: examples still there after the reload`);
    await page.close();
  }

  // 6. another session's project in the URL
  {
    const other = await (await fetch(`${API}/api/guests/session`, { method: 'POST' })).json();
    const osid = other.data.session_id;
    const op = await (
      await fetch(`${API}/api/guests/session/${osid}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Not yours', type: 'text-recognition' }),
      })
    ).json();
    const pm = `p${String(op.data.id).slice(-12).replace(/[^a-zA-Z0-9]/g, '').slice(-7).toLowerCase()}`;
    const { page, errors } = await open(ctx, `/projects/${seed.masked}/${pm}`);
    await page.waitForTimeout(4000);
    const body = await page.locator('body').innerText().catch(() => '');
    if (/Not yours/.test(body)) errors.push("another session's project opened");
    await verdict(page, errors, 'url edit', "another session's project id");
    await page.close();
  }

  await browser.close();
  mkdirSync(OUT, { recursive: true });
  const rows = results
    .map((r) => `<tr class="${r.ok ? 'ok' : 'bad'}"><td>${r.page}</td><td>${r.check}</td><td>${r.ok ? 'pass' : r.problems.join('<br>')}</td><td>${r.shot ? `<a href="${r.shot}">screenshot</a>` : ''}</td></tr>`)
    .join('');
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Break-it report</title><style>body{font:14px system-ui;margin:16px}td{padding:4px 8px;border-bottom:1px solid #ddd}.bad{background:#fde8ec}.ok{background:#eef6e6}</style><h1>Break-it report</h1><p>${results.filter((r) => r.ok).length} of ${results.length} pass</p><table>${rows}</table>`);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} pass. Report: ${join(OUT, 'index.html')}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
