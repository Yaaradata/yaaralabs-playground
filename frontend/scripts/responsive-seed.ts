/**
 * Seed for the responsive screen test: one guest session with a project of every course type, using
 * only the app's own APIs. Writes the ids to responsive-report/seed.json for responsive-audit.ts.
 *
 *   Rule Based Process      a new board (it opens with the custody rules)
 *   Text Recognition        the 20 sample custody queries, trained (default model)
 *   Image Recognition       the Indian sample document set, trained (MobileNet)
 *   Live Object Detection   created
 *   Custom AI Agent         stage "assistant" with the custody desk description
 *   RAG Chatbot             stage "rag", the sample library added (empty state if the backend can't embed)
 *   AI Agent                stage "agent"
 *   Copilot labs            AI Ethics (Ex 9) and Document AI (Ex 10)
 *
 * A step that can't run locally (no Gemini / Vertex) is recorded as "empty": the page is still tested.
 *
 * Run (backend on API_URL, default http://127.0.0.1:8765):  npx tsx scripts/responsive-seed.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const API = (process.env.API_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'responsive-report');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SeedProject {
  id: string;
  masked: string; // the project id in URLs (generateMaskedProjectId)
  type: string;
  empty?: string; // why the sample data could not be added
}
export interface Seed {
  sessionId: string;
  masked: string; // the session id in URLs
  projects: Record<string, SeedProject>;
}

/** Same as lib/session-utils generateMaskedProjectId. */
export const maskProject = (id: string) => `p${id.slice(-12).replace(/[^a-zA-Z0-9]/g, '').slice(-7).toLowerCase()}`;

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const r = await fetch(`${API}${path}`, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const projectLabel = (l: string) =>
  l.replace(/\s*&\s*/g, ' and ').replace(/\s*\/\s*/g, ' or ').replace(/[^a-zA-Z0-9\s\-_]/g, ' ').replace(/\s+/g, ' ').trim();

async function waitTrained(sid: string, pid: string) {
  for (let i = 0; i < 200; i++) {
    const g = await call<{ data?: { status?: string } }>('GET', `/api/guests/session/${sid}/projects/${pid}`);
    if (g.data?.status === 'trained') return;
    if (g.data?.status === 'failed') throw new Error('training failed');
    await sleep(3000);
  }
  throw new Error('training timed out');
}

async function main() {
  const s = await call<{ data: { session_id: string } }>('POST', '/api/guests/session');
  const sid = s.data.session_id;
  const seed: Seed = { sessionId: sid, masked: sid.slice(-8), projects: {} };
  const add = (key: string, id: string, type: string, empty?: string) => {
    seed.projects[key] = { id, masked: maskProject(id), type, ...(empty ? { empty } : {}) };
    console.log(`${key.padEnd(10)} ${type.padEnd(22)} ${id}${empty ? `  (empty: ${empty})` : ''}`);
  };
  const project = async (name: string, type: string) =>
    (await call<{ data: { id: string } }>('POST', `/api/guests/session/${sid}/projects`, { name, type })).data.id;
  const attempt = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      return undefined;
    } catch (e) {
      return `${what}: ${e instanceof Error ? e.message.slice(0, 120) : e}`;
    }
  };

  // Rule Based Process: a new board shows the custody rules
  add('rbp', await project('Custody rules', 'rule-based-process'), 'rule-based-process');

  // Text Recognition: the sample queries, trained with the default model
  const text = await project('Custody queries', 'text-recognition');
  const queries = JSON.parse(readFileSync(join(ROOT, 'public/datasets/nuvama_custody_queries.json'), 'utf8')).queries as { text: string; label: string }[];
  const textEmpty = await attempt('train', async () => {
    await call('POST', `/api/guests/session/${sid}/projects/${text}/examples`, {
      examples: queries.map((q) => ({ text: q.text, label: projectLabel(q.label) })),
      split: false,
      skip_existing: true,
    });
    await call('POST', `/api/guests/session/${sid}/projects/${text}/train`, { modelType: 'logistic_regression' });
    await waitTrained(sid, text);
  });
  add('text', text, 'text-recognition', textEmpty);

  // Image Recognition: the Indian document set, trained
  const image = await project('Custody documents', 'image-recognition');
  const imageEmpty = await attempt('train', async () => {
    const dir = join(ROOT, 'public/datasets/nuvama_documents');
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { labels: { label: string; files: string[] }[] };
    const form = new FormData();
    for (const l of manifest.labels) {
      for (const f of l.files) {
        form.append('files', new Blob([readFileSync(join(dir, f))], { type: 'image/jpeg' }), basename(f));
        form.append('labels', l.label);
      }
    }
    await call('POST', `/api/guests/session/${sid}/projects/${image}/images`, form);
    await call('POST', `/api/guests/session/${sid}/projects/${image}/train`, { modelType: 'mobilenet' });
    await waitTrained(sid, image);
  });
  add('image', image, 'image-recognition', imageEmpty);

  add('lod', await project('Desk camera', 'live-object-detection'), 'live-object-detection');

  // Day 2: three agents (one Agent Studio, three stages)
  const agent = async (stage: string, name: string, extra: Record<string, unknown>) =>
    (await call<{ data: { agent_id: string } }>('POST', '/agent/create', { session_id: sid, stage, project_name: name, ...extra })).data.agent_id;
  const assistant = await agent('assistant', 'Custody desk assistant', {
    agent_description:
      'A client-service assistant for a custody desk at Nuvama Asset Services. It answers questions about fees, corporate actions, KYC and settlement, and hands complaints to a person.',
  });
  add('assistant', assistant, 'custom-ai-agent');
  const rag = await agent('rag', 'Custody policy chatbot', { copy_from_agent_id: assistant });
  const ragEmpty = await attempt('sample library', async () => {
    const lib = await call<{ library: { id: string }[] }>('GET', `/agent/${rag}/kb/library?session_id=${sid}`);
    if (!lib.library?.length) throw new Error('no sample library');
    await call('POST', `/agent/${rag}/kb/library?session_id=${sid}`, { library_ids: lib.library.map((d) => d.id) });
  });
  add('rag', rag, 'rag-chatbot', ragEmpty);
  add('agent', await agent('agent', 'Custody desk agent', { copy_from_agent_id: rag }), 'ai-agent');

  add('ethics', await project('AI Ethics', 'copilot-ethics'), 'copilot-ethics');
  add('docai', await project('Document AI', 'copilot-document-ai'), 'copilot-document-ai');

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'seed.json'), JSON.stringify(seed, null, 2));
  console.log(`\nwrote ${join(OUT, 'seed.json')}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
