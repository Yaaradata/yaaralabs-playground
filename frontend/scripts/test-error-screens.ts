/**
 * Error boundaries (docs/hardening.md, item 11): a render error shows "Something went wrong on this
 * screen. Your work is saved." with Reload and Back to projects, not Next's white "Application error".
 * Run: npm run test:error-screens
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// tsx compiles JSX to React.createElement (Next's own compiler doesn't need the import)
(globalThis as unknown as { React: typeof React }).React = React;

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

(async () => {
  const app = join(__dirname, '..', 'app');
  test('the three error boundaries are where Next looks for them', () => {
    for (const f of ['error.tsx', 'global-error.tsx', join('projects', '[userid]', '[projectid]', 'error.tsx')]) {
      assert.ok(existsSync(join(app, f)), f);
    }
  });

  const error = Object.assign(new Error('boom'), { digest: 'abc123' });
  const screens = [
    ['app/error.tsx', (await import('../app/error')).default],
    ['app/global-error.tsx', (await import('../app/global-error')).default],
    ['projects/[userid]/[projectid]/error.tsx', (await import('../app/projects/[userid]/[projectid]/error')).default],
  ] as const;
  for (const [name, Comp] of screens) {
    test(`${name} shows the message, Reload and Back to projects`, () => {
      const html = renderToStaticMarkup(React.createElement(Comp as never, { error, reset: () => {} }));
      assert.match(html, /Something went wrong on this screen\./);
      assert.match(html, /Your work is saved\./);
      assert.match(html, />Reload</);
      assert.match(html, />Back to projects</);
      assert.doesNotMatch(html, /boom|at Object\.|\.tsx:/, 'no error text or stack trace on screen');
    });
  }

  console.log(`\n${passed} tests passed`);
})().catch((e) => {
  console.error(`FAIL ${e.message}`);
  process.exit(1);
});
