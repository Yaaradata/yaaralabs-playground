/**
 * XSS check for chat messages (components/TeachYourAgent/formatContent.ts): hostile text is rendered
 * the way ChatMessage renders it (innerHTML of formatContent) in a real browser page, and the page
 * must contain no element other than the <strong>/<br> the formatter adds, and run no script.
 * Run: npm run test:xss
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { formatContent } from '../components/TeachYourAgent/formatContent';

const PAYLOADS = [
  '<img src=x onerror=alert(1)>',
  '<style>body{display:none}</style>',
  '<script>window.__pwned=1</script>',
  '**<img src=x onerror="window.__pwned=1">**',
  '<svg onload=window.__pwned=1>',
  '"><iframe src=javascript:window.__pwned=1>',
  'First rule. <img src=x onerror=window.__pwned=1>. Last rule.',
  "' onmouseover='window.__pwned=1",
];

(async () => {
  let passed = 0;
  const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chrome' });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body><div id="m"></div></body>');
  for (const p of PAYLOADS) {
    const html = formatContent(p);
    const r = await page.evaluate((h) => {
      const m = document.getElementById('m')!;
      m.innerHTML = h;
      const tags = [...m.querySelectorAll('*')].map((e) => e.tagName.toLowerCase());
      return { tags, pwned: (window as unknown as { __pwned?: number }).__pwned ?? 0, text: m.textContent };
    }, html);
    await page.waitForTimeout(50);
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? 0);
    const stray = r.tags.filter((t) => t !== 'strong' && t !== 'br');
    assert.deepEqual(stray, [], `elements created from ${JSON.stringify(p)}: ${stray.join(', ')}`);
    assert.equal(pwned, 0, `script ran for ${JSON.stringify(p)}`);
    assert.ok((r.text || '').includes('<') || !p.includes('<'), `the text is shown, not swallowed: ${JSON.stringify(p)}`);
    passed += 1;
    console.log(`PASS ${JSON.stringify(p)}`);
  }
  assert.equal(formatContent('Say **hello** & bye'), 'Say <strong>hello</strong> &amp; bye');
  passed += 1;
  console.log('PASS **bold** still works, & is escaped');
  await browser.close();
  console.log(`\n${passed} tests passed`);
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
