/**
 * Responsive screen test: every route (scripts/responsive-routes.ts) at every size of the test matrix
 * (docs/responsive.md, part A). Screenshots each page and checks it; writes a contact sheet.
 *
 *   npm run test:responsive                      all routes, all sizes
 *   npm run test:responsive -- --routes=home,lod --sizes=1,5,8 --out=responsive-report/before
 *
 * Needs the frontend (BASE_URL, default http://localhost:3000) and the backend the seed was made on
 * (npx tsx scripts/responsive-seed.ts writes responsive-report/seed.json). Uses Chrome, or the
 * Chromium at /opt/pw-browsers/chromium when it exists. Windows-style 17 px scrollbars on every run.
 *
 * Exit code 1 when a "must look right" size (1-9) fails any check, or a "usable" size (10-13) has a
 * horizontal scroll or an off-screen element.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { ROUTES, type Route } from './responsive-routes';
import type { Seed } from './responsive-seed';

/* ───────── the matrix ───────── */

export interface Size {
  n: number;
  name: string;
  width: number;
  height: number;
  dpr: number;
  must: boolean; // 1-9 must look right; 10-13 must be usable
}

export const MATRIX: Size[] = [
  { n: 1, name: '1920x1080 @150%', width: 1280, height: 600, dpr: 1.5, must: true },
  { n: 2, name: '1920x1200 @150%', width: 1280, height: 680, dpr: 1.5, must: true },
  { n: 3, name: '1366x768 @100%', width: 1366, height: 640, dpr: 1, must: true },
  { n: 4, name: 'MacBook', width: 1440, height: 790, dpr: 2, must: true },
  { n: 5, name: '1920x1080 @125%', width: 1536, height: 740, dpr: 1.25, must: true },
  { n: 6, name: '1600x900 @100%', width: 1600, height: 780, dpr: 1, must: true },
  { n: 7, name: '2560x1440 @150%', width: 1707, height: 840, dpr: 1.5, must: true },
  { n: 8, name: '1920x1080 @100%', width: 1920, height: 950, dpr: 1, must: true },
  { n: 9, name: '2560x1440 @100%', width: 2560, height: 1300, dpr: 1, must: true },
  { n: 10, name: 'half of 1920', width: 960, height: 950, dpr: 1, must: false },
  { n: 11, name: '1024x768 window', width: 1024, height: 640, dpr: 1, must: false },
  { n: 12, name: 'zoom 125% on #5', width: 1229, height: 592, dpr: 1.25, must: false },
  { n: 13, name: 'zoom 90% on #3', width: 1518, height: 711, dpr: 0.9, must: false },
  { n: 14, name: 'small window (review, 15 Oct)', width: 870, height: 830, dpr: 1, must: false },
];

export const READABLE_PX = 13.5;

/* ───────── options ───────── */

const ROOT = join(__dirname, '..');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const OUT = join(ROOT, arg('out') || 'responsive-report');
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const pickRoutes = arg('routes')?.split(',');
const pickSizes = arg('sizes')?.split(',').map(Number);
const THEME = arg('theme') || 'light';
const WORKERS = Number(arg('workers') || 3);

/* ───────── checks (run in the page) ───────── */

interface Failure {
  check: string;
  detail: string;
}
interface Measure {
  failures: Failure[];
  columns: number; // columns of the main grid (for the 5 vs 8 comparison)
  cardPad: number; // first card's left padding in px
  scrollHeight: number;
}

/** Runs in the browser. Kept self-contained: Playwright serialises it. */
function measurePage(input: { primary: string[]; mustNotClip: string[]; workspace: boolean; checkPrimary: boolean; minFont: number }): Measure {
  const failures: { check: string; detail: string }[] = [];
  const fail = (check: string, detail: string) => failures.push({ check, detail });
  const W = window.innerWidth;
  const H = window.innerHeight;
  const sc = document.scrollingElement as HTMLElement;
  const body = document.body;
  // the page scrolls inside body (html, body { height: 100% }): use the larger of the two
  const scroller = body.scrollHeight > body.clientHeight + 1 ? body : sc;
  const clientW = Math.min(document.documentElement.clientWidth, body.clientWidth || W);
  const name = (e: Element) => {
    const id = e.id ? `#${e.id}` : '';
    const cls = typeof (e as HTMLElement).className === 'string' ? `.${(e as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = ((e as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `${e.tagName.toLowerCase()}${id}${cls === '.' ? '' : cls}${text ? ` "${text}"` : ''}`;
  };
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  // inside something that scrolls or clips sideways on purpose (tables, code, Blockly, carousels)
  // (overflow-y: auto makes overflow-x compute to auto too, so only count containers that really
  // scroll or clip sideways)
  const inScroller = (e: Element) => {
    for (let p = e.parentElement; p && p !== body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'hidden' || s.overflowX === 'clip') return true;
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  // 1. horizontal scroll
  const sw = Math.max(sc.scrollWidth, body.scrollWidth);
  if (sw > W + 1) fail('horizontal-scroll', `page is ${sw}px wide in a ${W}px window`);

  // 2. nothing off-screen
  const all = [...body.querySelectorAll('*')].filter((e) => !(e instanceof SVGElement && !(e instanceof SVGSVGElement)));
  const off = all.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.right > clientW + 1 && r.width > 2 && visible(e) && !inScroller(e) && getComputedStyle(e).position !== 'fixed';
  });
  // report the outermost offenders only
  const outer = off.filter((e) => !off.some((o) => o !== e && o.contains(e)));
  for (const e of outer.slice(0, 4)) fail('off-screen', `${name(e)} right edge ${Math.round(e.getBoundingClientRect().right)} > ${clientW}`);

  // 3. main action on the first screen
  if (input.checkPrimary) {
    for (const sel of input.primary) {
      const els = [...document.querySelectorAll(sel)].filter(visible);
      if (!els.length) {
        fail('primary-missing', sel);
        continue;
      }
      const r = els[0].getBoundingClientRect();
      if (r.bottom > H + 1) fail('primary-below-fold', `${sel} bottom ${Math.round(r.bottom)} > ${H}`);
    }
  }

  // 4. no clipped text in titles, tables and score lines
  for (const sel of input.mustNotClip) {
    for (const e of [...document.querySelectorAll(sel)].filter(visible).slice(0, 12) as HTMLElement[]) {
      const s = getComputedStyle(e);
      const hidden = (o: string) => o === 'hidden' || o === 'clip';
      const clamp = s.getPropertyValue('-webkit-line-clamp');
      if ((hidden(s.overflowX) || s.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1) fail('clipped', `${name(e)} ${e.scrollWidth} > ${e.clientWidth} wide`);
      else if ((hidden(s.overflowY) || (clamp && clamp !== 'none')) && e.scrollHeight > e.clientHeight + 1) fail('clipped', `${name(e)} ${e.scrollHeight} > ${e.clientHeight} tall`);
    }
  }

  // 5. readable: every visible text node's font size
  const small = new Map<string, string>();
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !(n.textContent || '').trim() || el.closest('[data-small],script,style,noscript,[aria-hidden="true"],.sr-only')) continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.right < 0) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < input.minFont - 0.05) {
      const key = `${fs.toFixed(1)}px ${name(el).split(' ')[0]}`;
      if (!small.has(key)) small.set(key, (n.textContent || '').trim().slice(0, 24));
    }
  }
  for (const [k, t] of [...small].slice(0, 6)) fail('small-text', `${k} "${t}"`);
  if (small.size > 6) fail('small-text', `…and ${small.size - 6} more`);

  // cards: bordered or filled boxes of a useful size
  const cards = all.filter((e) => {
    if (!visible(e) || inScroller(e)) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 160 || r.height < 70 || r.width > W * 0.98) return false;
    const s = getComputedStyle(e);
    const border = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none';
    const filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent' && s.backgroundColor !== getComputedStyle(body).backgroundColor;
    return (border || filled) && parseFloat(s.borderRadius) >= 6;
  });
  // the outermost cards (not nested in another card)
  const top = cards.filter((c) => !cards.some((o) => o !== c && o.contains(c)));

  // 6. no huge gaps between neighbouring cards in the same row; content width on wide screens
  const maxGap = Math.max(64, W * 0.04);
  const rects = top.map((c) => ({ c, r: c.getBoundingClientRect() })).filter(({ r }) => r.top < H * 2);
  for (const a of rects) {
    const right = rects
      .filter((b) => b !== a && b.r.left >= a.r.right - 1 && Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 30)
      .sort((x, y) => x.r.left - y.r.left)[0];
    if (right && right.r.left - a.r.right > maxGap) {
      fail('huge-gap', `${Math.round(right.r.left - a.r.right)}px between ${name(a.c)} and ${name(right.c)} (max ${Math.round(maxGap)})`);
    }
  }
  if (input.workspace && W >= 1536 && rects.length) {
    const left = Math.min(...rects.map(({ r }) => r.left));
    const right = Math.max(...rects.map(({ r }) => r.right));
    const share = (right - left) / clientW;
    if (share < 0.6) fail('narrow-content', `content spans ${Math.round(share * 100)}% of ${clientW}px (min 60%)`);
  }

  // 7. no dead space under the last card when everything fits on one screen
  const scrollHeight = scroller.scrollHeight;
  if (input.workspace && scrollHeight <= H + 1 && rects.length) {
    const bottom = Math.max(...rects.map(({ r }) => r.bottom));
    const empty = H - bottom;
    if (empty > H * 0.35) fail('dead-space', `${Math.round(empty)}px empty under the content (max ${Math.round(H * 0.35)})`);
  }

  // 8. inputs for the 5 vs 8 comparison: columns of the main grid, first card's padding
  let columns = 1;
  const grids = all.filter((e) => {
    const s = getComputedStyle(e);
    return (s.display === 'grid' || (s.display === 'flex' && s.flexDirection.startsWith('row'))) && visible(e) && e.getBoundingClientRect().width > W * 0.5;
  });
  for (const g of grids) {
    const kids = [...g.children].filter((k) => visible(k) && k.getBoundingClientRect().width > 120 && k.getBoundingClientRect().height > 60);
    const lefts = new Set(kids.map((k) => Math.round(k.getBoundingClientRect().left / 8)));
    columns = Math.max(columns, lefts.size);
  }
  const cardPad = top.length ? parseFloat(getComputedStyle(top[0]).paddingLeft) : 0;
  return { failures, columns, cardPad, scrollHeight };
}

/* ───────── running ───────── */

interface Result {
  route: string;
  size: number;
  ok: boolean;
  failures: Failure[];
  columns: number;
  cardPad: number;
  shot: string;
  full: string;
  seconds?: number;
  error?: string;
}

function storage(seed: Seed): Record<string, string> {
  const s: Record<string, string> = {
    yaaralabs_current_masked_id: seed.masked,
    yaaralabs_playground_session_id: seed.sessionId,
    [`yaaralabs_masked_${seed.masked}`]: seed.sessionId,
    yaaralabs_playground_session_created: String(Date.now()),
    yaaralabs_playground_session_expires: String(Date.now() + 6 * 864e5),
    yaaralabs_playground_session_last_activity: String(Date.now()),
    'yaaralabs-theme': THEME,
  };
  for (const p of Object.values(seed.projects)) s[`yaaralabs_project_${p.masked}`] = p.id;
  return s;
}

async function context(browser: Browser, size: Size, seed: Seed): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.dpr });
  // Some pages delete the whole guest session when a session check fails (e.g. a slow local backend
  // under several test browsers). Never let a test run delete the seed.
  await ctx.route(/\/api\/guests\/session\/[^/?]+$/, (r) =>
    r.request().method() === 'DELETE' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }) : r.continue(),
  );
  // tsx (esbuild) wraps named functions in __name(); measurePage runs in the page, so define it there
  await ctx.addInitScript('globalThis.__name = (f) => f;');
  await ctx.addInitScript((s: Record<string, string>) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    // Windows-style classic scrollbars (17 px) on every scroller
    const style = () => {
      const el = document.createElement('style');
      el.dataset.responsiveTest = '';
      el.textContent = '::-webkit-scrollbar{width:17px!important;height:17px!important}::-webkit-scrollbar-thumb{background:#a0a0a0!important}::-webkit-scrollbar-track{background:#f0f0f0!important}';
      document.documentElement.appendChild(el);
    };
    if (document.documentElement) style();
    else document.addEventListener('DOMContentLoaded', style);
  }, storage(seed));
  return ctx;
}

async function visit(page: Page, route: Route, size: Size, seed: Seed): Promise<Result> {
  const dir = join(OUT, route.id);
  mkdirSync(dir, { recursive: true });
  const shot = join(dir, `${size.n}.png`);
  const full = join(dir, `${size.n}-full.png`);
  const base: Result = { route: route.id, size: size.n, ok: false, failures: [], columns: 0, cardPad: 0, shot, full };
  try {
    await page.goto(`${BASE}${route.path(seed)}`, { waitUntil: 'domcontentloaded' });
    await page.locator(route.ready).first().waitFor({ timeout: 45000 });
    if (route.steps) await route.steps(page);
    await page.waitForTimeout(route.settle ?? 700);
    await page.evaluate(() => {
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    // Playwright selectors (text=, :has-text) only resolve through Playwright: tag the matches first
    const tag = async (sels: string[], attr: string) => {
      for (const [i, sel] of sels.entries()) {
        await page.locator(sel).evaluateAll((els, [a, v]) => els.forEach((e) => e.setAttribute(a, v)), [attr, String(i)] as const).catch(() => {});
      }
      return sels.map((_, i) => `[${attr}="${i}"]`);
    };
    const primary = await tag(route.primary, 'data-rt-primary');
    const mustNotClip = await tag(route.mustNotClip, 'data-rt-clip');
    const m = await page.evaluate(measurePage, {
      primary,
      mustNotClip,
      workspace: !!route.workspace,
      checkPrimary: size.must,
      minFont: READABLE_PX,
    });
    await page.screenshot({ path: shot });
    // full page: release the body scroller so the whole page renders at the same viewport (vh unchanged)
    await page.addStyleTag({ content: 'html,body{height:auto!important;overflow:visible!important}' });
    await page.screenshot({ path: full, fullPage: true });
    for (const f of m.failures) {
      f.detail = f.detail.replace(/\[data-rt-primary="(\d+)"\]/g, (_, i) => route.primary[Number(i)]).replace(/\[data-rt-clip="(\d+)"\]/g, (_, i) => route.mustNotClip[Number(i)]);
    }
    const failures = size.must ? m.failures : m.failures.filter((f) => f.check === 'horizontal-scroll' || f.check === 'off-screen');
    return { ...base, ok: failures.length === 0, failures: m.failures, columns: m.columns, cardPad: m.cardPad };
  } catch (e) {
    await page.screenshot({ path: shot }).catch(() => {});
    return { ...base, error: e instanceof Error ? e.message.split('\n')[0] : String(e), failures: [{ check: 'error', detail: e instanceof Error ? e.message.split('\n')[0] : String(e) }] };
  }
}

/** 5 vs 8: the same layout (main grid columns) and card padding that scales. */
function consistency(results: Result[]) {
  for (const route of new Set(results.map((r) => r.route))) {
    const a = results.find((r) => r.route === route && r.size === 5);
    const b = results.find((r) => r.route === route && r.size === 8);
    if (!a || !b || a.error || b.error) continue;
    if (a.columns !== b.columns) {
      b.failures.push({ check: 'layout-changed', detail: `main grid has ${a.columns} columns at size 5 and ${b.columns} at size 8` });
      b.ok = false;
    }
    if (a.cardPad > 0 && Math.abs(a.cardPad - b.cardPad) < 0.5) {
      b.failures.push({ check: 'fixed-padding', detail: `card padding is ${a.cardPad}px at both sizes 5 and 8 (should scale)` });
      b.ok = false;
    }
  }
}

function contactSheet(results: Result[], routes: Route[], sizes: Size[]) {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rel = (p: string) => relative(OUT, p).replace(/\\/g, '/');
  const rows = routes
    .map((route) => {
      const cells = sizes
        .map((size) => {
          const r = results.find((x) => x.route === route.id && x.size === size.n);
          if (!r) return '<td></td>';
          const list = r.failures.map((f) => `<li><b>${esc(f.check)}</b> ${esc(f.detail)}</li>`).join('');
          return `<td class="${r.ok ? 'ok' : size.must ? 'bad' : 'warn'}"><a href="${rel(r.full)}"><img loading="lazy" src="${rel(r.shot)}"></a>
            <div class="sz">${size.n}. ${size.width}×${size.height} · ${r.ok ? 'pass' : `${r.failures.length} issue${r.failures.length === 1 ? '' : 's'}`}</div><ul>${list}</ul></td>`;
        })
        .join('');
      return `<tr><th>${esc(route.title)}<small>${esc(route.id)}</small></th>${cells}</tr>`;
    })
    .join('');
  const failing = results.filter((r) => !r.ok);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Responsive report</title><style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#f7f5fa;color:#111}
table{border-collapse:separate;border-spacing:6px}th{text-align:left;vertical-align:top;width:160px;font-size:13px}th small{display:block;color:#888;font-weight:400}
td{vertical-align:top;width:220px;background:#fff;border:2px solid #e3dbeb;border-radius:8px;padding:6px}td.ok{border-color:#3f6212}td.bad{border-color:#e11d48}td.warn{border-color:#f59e0b}
img{width:100%;border-radius:4px;display:block}.sz{font-size:12px;margin-top:4px;color:#555}ul{margin:4px 0 0;padding-left:16px;font-size:11.5px;color:#9f1239}
</style></head><body><h1>Responsive report</h1><p>${results.length - failing.length} of ${results.length} pass · ${new Date().toLocaleString()} · theme ${THEME}.
Green: pass. Red: a must-look-right size (1-9) fails. Amber: a usable size (10-13) has notes. Click a thumbnail for the full page.</p>
<div style="overflow-x:auto"><table>${rows}</table></div></body></html>`;
  writeFileSync(join(OUT, 'index.html'), html);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}

async function main() {
  const seedFile = join(ROOT, 'responsive-report', 'seed.json');
  if (!existsSync(seedFile)) throw new Error('Run "npx tsx scripts/responsive-seed.ts" first.');
  const seed = JSON.parse(readFileSync(seedFile, 'utf8')) as Seed;
  const routes = ROUTES.filter((r) => !pickRoutes || pickRoutes.includes(r.id));
  const sizes = MATRIX.filter((s) => !pickSizes || pickSizes.includes(s.n));
  mkdirSync(OUT, { recursive: true });

  const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    args: ['--disable-features=OverlayScrollbar', '--hide-scrollbars=false'],
  });
  const results: Result[] = [];
  const jobs = sizes.map((size) => async () => {
    const ctx = await context(browser, size, seed);
    const page = await ctx.newPage();
    for (const route of routes) {
      const started = Date.now();
      const r = await visit(page, route, size, seed);
      r.seconds = Math.round((Date.now() - started) / 100) / 10;
      results.push(r);
      console.log(`${r.ok ? 'PASS' : size.must ? 'FAIL' : 'NOTE'} ${route.id} @${size.n} ${r.seconds}s${r.failures.length ? `  ${r.failures.map((f) => f.check).join(', ')}` : ''}`);
    }
    await ctx.close();
  });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(WORKERS, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
  await browser.close();

  results.sort((a, b) => routes.findIndex((r) => r.id === a.route) - routes.findIndex((r) => r.id === b.route) || a.size - b.size);
  consistency(results);
  contactSheet(results, routes, sizes);

  const must = results.filter((r) => !r.ok && MATRIX.find((s) => s.n === r.size)?.must);
  const usable = results.filter((r) => !MATRIX.find((s) => s.n === r.size)?.must && r.failures.some((f) => ['horizontal-scroll', 'off-screen', 'error'].includes(f.check)));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} pass. Failing: ${must.length} on sizes 1-9, ${usable.length} usable-size problems on 10-13.`);
  console.log(`Report: ${join(OUT, 'index.html')}`);
  process.exit(must.length || usable.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
