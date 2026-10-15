/**
 * The screens the responsive test visits (scripts/responsive-audit.ts), one entry per screen.
 *
 *   path        the URL, built from the seed (responsive-report/seed.json)
 *   ready       a selector that shows the page has loaded its data
 *   steps       clicks to reach a state (a dialog, a tab, after "Run the exam")
 *   primary     the main button or input: must be on the first screen at matrix sizes 1-9
 *   mustNotClip titles, tables and score lines: must not be cut off
 *   workspace   a full-width work page (checked for wide-screen use and dead space)
 *
 * Selectors are Playwright selectors (CSS, or text= / role= forms).
 */

import type { Page } from 'playwright-core';
import type { Seed } from './responsive-seed';

export interface Route {
  id: string;
  title: string;
  path: (s: Seed) => string;
  ready: string;
  steps?: (page: Page) => Promise<void>;
  primary: string[];
  mustNotClip: string[];
  workspace?: boolean;
  /** extra wait after the steps (charts, Blockly) */
  settle?: number;
}

const proj = (key: string, sub = '') => (s: Seed) => `/projects/${s.masked}/${s.projects[key].masked}${sub}`;
const click = (selector: string, wait = 800) => async (page: Page) => {
  await page.locator(selector).first().click();
  await page.waitForTimeout(wait);
};
const chain = (...fns: ((p: Page) => Promise<void>)[]) => async (page: Page) => {
  for (const f of fns) await f(page);
};

/** Agent Studio: open a sidebar section by its title. */
const studioTab = (name: string) => click(`button:has-text("${name}")`, 1200);
const useAi = click('button:text-is("USE AI")', 2500);

export const ROUTES: Route[] = [
  /* ── start ── */
  { id: 'home', title: 'Home', path: () => '/', ready: 'a:has-text("Go to your projects")', primary: ['a:has-text("Go to your projects")'], mustNotClip: ['h1'] },
  {
    id: 'projects', title: 'Project list', path: (s) => `/projects/${s.masked}`, ready: 'button:has-text("Launch")',
    primary: ['button:has-text("Add a new project")'], mustNotClip: ['h3'], workspace: true,
  },
  {
    id: 'create', title: 'Create project dialog', path: (s) => `/projects/${s.masked}`, ready: 'button:has-text("Launch")',
    steps: click('button:has-text("Add a new project")', 1200),
    primary: ['button:has-text("Create Project")', 'input[placeholder="Enter project name"]'], mustNotClip: ['h1'],
  },

  /* ── Day 1 ── */
  {
    id: 'rbp-board', title: 'Rule Based Process: board', path: proj('rbp'), ready: 'button.tab >> visible=true', settle: 2500,
    primary: ['button.tab'], mustNotClip: ['h1'], workspace: true,
  },
  {
    id: 'rbp-test', title: 'Rule Based Process: test panel', path: proj('rbp'), ready: 'button.tab >> visible=true', settle: 2500,
    steps: async (page) => {
      const test = page.locator('button:has-text("Test"), button:has-text("Run")').first();
      if (await test.count()) await test.click();
      await page.waitForTimeout(1200);
    },
    primary: ['button.tab'], mustNotClip: ['h1'], workspace: true,
  },
  {
    id: 'text-project', title: 'Text Recognition: project', path: proj('text'), ready: 'h2',
    primary: ['button:has-text("Collect Data")', 'button:has-text("Evaluate")'], mustNotClip: ['h1', 'h2'],
  },
  {
    id: 'text-collect', title: 'Text Recognition: collect data', path: proj('text', '/train'), ready: 'h3',
    primary: ['button:has-text("Add new label")'], mustNotClip: ['h1', 'h3'], workspace: true,
  },
  {
    id: 'text-train', title: 'Text Recognition: train and test', path: proj('text', '/learn'), ready: 'h2',
    primary: ['button:has-text("Train again"), button:has-text("Train")', 'input[placeholder^="enter a test text"]'], mustNotClip: ['h1', 'h2'], workspace: true,
  },
  {
    id: 'text-use', title: 'Text Recognition: use the AI', path: proj('text', '/make'), ready: 'button.tab >> visible=true', settle: 2000,
    primary: ['button:has-text("Run")'], mustNotClip: ['h1'], workspace: true,
  },
  {
    id: 'text-evaluate', title: 'Text Recognition: evaluate (before)', path: proj('text', '/evaluate'), ready: 'button:has-text("Run the exam")',
    primary: ['button:has-text("Run the exam")'], mustNotClip: ['h1', '[aria-label="The exam"]'],
  },
  {
    id: 'text-evaluate-done', title: 'Text Recognition: evaluate (after)', path: proj('text', '/evaluate'), ready: 'button:has-text("Run the exam")',
    steps: async (page) => {
      await page.locator('button:has-text("Run the exam")').click();
      await page.locator('text=✓ Exam done').waitFor({ timeout: 180000 });
      await page.waitForTimeout(600);
    },
    primary: ['section[aria-labelledby="b1"]'], mustNotClip: ['h1', 'h2', 'table'], workspace: true,
  },
  {
    id: 'image-project', title: 'Image Recognition: project', path: proj('image'), ready: 'h2',
    primary: ['button:has-text("Collect Data")', 'button:has-text("Evaluate")'], mustNotClip: ['h1', 'h2'],
  },
  {
    id: 'image-collect', title: 'Image Recognition: collect data', path: proj('image', '/train'), ready: 'h3',
    primary: ['button:has-text("Use sample data")', 'button:has-text("Upload")'], mustNotClip: ['h1', 'h2'], workspace: true,
  },
  {
    id: 'image-sample', title: 'Image Recognition: sample images dialog', path: proj('image', '/train'), ready: 'h3',
    steps: click('button:has-text("Use sample data")', 1500),
    primary: ['[role=dialog] button:has-text("Add"), .fixed button:has-text("Add")'], mustNotClip: ['.fixed h2'],
  },
  {
    id: 'image-train', title: 'Image Recognition: train and test', path: proj('image', '/learn'), ready: 'h2', settle: 1500,
    primary: ['button:has-text("Train again"), button:has-text("Train")'], mustNotClip: ['h1', 'h2'], workspace: true,
  },
  {
    id: 'image-evaluate', title: 'Image Recognition: evaluate', path: proj('image', '/evaluate'), ready: 'button:has-text("Run the exam")',
    primary: ['button:has-text("Run the exam")'], mustNotClip: ['h1', '[aria-label="The exam"]'],
  },
  {
    id: 'lod', title: 'Live Object Detection', path: proj('lod'), ready: 'h2',
    primary: ['button:has-text("Custom live object detection")'], mustNotClip: ['h1', 'h2', 'h3'],
  },

  /* ── Day 2: Agent Studio ── */
  ...(['assistant', 'rag', 'agent'] as const).flatMap((key) => {
    const name = { assistant: 'Custom AI Agent', rag: 'RAG Chatbot', agent: 'AI Agent' }[key];
    const tabs: [string, string][] = [
      ['persona', 'AI PERSONA'],
      ['rules', 'RULES & GUARDRAILS'],
      ['actions', 'ACTIONS'],
      ...(key !== 'assistant' ? ([['knowledge', 'KNOWLEDGE BASE']] as [string, string][]) : []),
      ...(key === 'agent' ? ([['tools', 'TOOLS']] as [string, string][]) : []),
    ];
    return [
      ...tabs.map(([id, tab]): Route => ({
        id: `${key}-${id}`, title: `${name}: ${tab.toLowerCase()}`, path: proj(key), ready: 'button:text-is("USE AI")',
        steps: id === 'persona' ? undefined : studioTab(tab),
        primary: ['button:text-is("USE AI")'], mustNotClip: ['h2'], workspace: true,
      })),
      {
        id: `${key}-use`, title: `${name}: use AI`, path: proj(key), ready: 'button:text-is("USE AI")',
        steps: chain(useAi, async (page) => {
          // one sample question, then wait for the answer (the page keeps working without an AI key)
          let q = page.locator('li > button.text-left').first();
          if (!(await q.isVisible().catch(() => false))) {
            await page.locator('button:has-text("Sample questions")').first().click().catch(() => {});
            await page.waitForTimeout(2500);
            q = page.locator('li > button.text-left').first();
          }
          if (await q.isVisible().catch(() => false)) {
            await q.click().catch(() => {});
            await page.waitForTimeout(12000);
          }
        }),
        primary: ['input[placeholder="Type your message…"]'], mustNotClip: ['h2'], workspace: true,
      },
    ];
  }),

  /* ── Day 2: Copilot labs ── */
  ...(['ethics', 'docai'] as const).flatMap((key): Route[] => {
    const name = key === 'ethics' ? 'Copilot AI Ethics' : 'Copilot Document AI';
    return [
      { id: `${key}-step`, title: `${name}: step 1`, path: proj(key), ready: '.rail-item', primary: ['button:has-text("Next →")'], mustNotClip: ['h1', '.rail-item'], workspace: true },
      { id: `${key}-result`, title: `${name}: result card`, path: proj(key), ready: '.rail-item', steps: click('.rail-item:has-text("Your result")', 1200), primary: ['.rail-item:has-text("Your result")'], mustNotClip: ['h1'], workspace: true },
      { id: `${key}-check`, title: `${name}: AI check`, path: proj(key), ready: '.rail-item', steps: click('.rail-item:has-text("Your AI check")', 1200), primary: ['.rail-item:has-text("Your AI check")'], mustNotClip: ['h1'], workspace: true },
    ];
  }),
];
