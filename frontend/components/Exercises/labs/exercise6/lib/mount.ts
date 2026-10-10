import { bindHostFullscreen, FS_ICON_ENTER, FS_ICON_EXIT } from '../../../fullscreen';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';
import { embedViaPlayground, type HostedEmbedModel } from './api';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

type Slot = 'A' | 'B';
type Metric = 'cos' | 'euc' | 'dot';
type DisView = 'nn' | 'pairs';
type SortKey = 'A' | 'B' | 'gap';
type ModelGroup = 'browser' | 'page' | 'api';

interface ModelDef {
  name: string;
  group: ModelGroup;
  about: string;
  hf?: string;
  pooling?: 'mean' | 'cls';
  api?: HostedEmbedModel;
}

interface LoadState {
  state: 'loading' | 'error';
  p?: number;
  msg: string;
}

interface EmbedBundle {
  vecs: number[][];
  vocab?: string[];
  ms: number;
  simulated?: boolean;
}

interface RunState {
  texts: string[];
  sig: string;
  Akey: string;
  Bkey: string;
  A: EmbedBundle;
  B: EmbedBundle;
  cache?: Computed;
}

interface Pair {
  i: number;
  j: number;
  v: number;
}

interface SideComputed {
  M: number[][];
  ps: Pair[];
  rank: Record<string, number>;
  lo: number;
  hi: number;
}

interface Computed {
  metric: Metric;
  A: SideComputed;
  B: SideComputed;
}

interface PairSel {
  i: number;
  j: number;
}

interface LabState {
  rows: { id: number; t: string }[];
  A: string;
  B: string;
  metric: Metric;
  dis: DisView;
  sort: SortKey;
  load: Partial<Record<Slot, LoadState | null>>;
  run: RunState | null;
  busy: boolean;
  sel: PairSel | null;
  hov: PairSel | null;
  markedComplete: boolean;
}

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean' | 'cls'; normalize: boolean },
) => Promise<{ tolist: () => number[][] }>;

type TransformersMod = {
  env: { allowLocalModels: boolean; remoteHost?: string };
  pipeline: (
    task: string,
    model: string,
    opts: { dtype: string; progress_callback?: (d: ProgressEvent) => void },
  ) => Promise<FeatureExtractor>;
};

type ProgressEvent = {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
};

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL_HOST = '';

const MODELS: Record<string, ModelDef> = {
  minilm: {
    name: 'MiniLM-L6',
    group: 'browser',
    hf: 'Xenova/all-MiniLM-L6-v2',
    pooling: 'mean',
    about: '',
  },
  bge: {
    name: 'BGE small',
    group: 'browser',
    hf: 'Xenova/bge-small-en-v1.5',
    pooling: 'cls',
    about: '',
  },
  multi: {
    name: 'Multilingual MiniLM',
    group: 'browser',
    hf: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    pooling: 'mean',
    about: '',
  },
  words: {
    name: 'Word counts',
    group: 'page',
    about: '',
  },
  te005: {
    name: 'text-embedding-005',
    group: 'api',
    api: 'text-embedding-005',
    about: '',
  },
  te004: {
    name: 'text-embedding-004',
    group: 'api',
    api: 'text-embedding-004',
    about: '',
  },
  tmulti: {
    name: 'Multilingual embedding-002',
    group: 'api',
    api: 'text-multilingual-embedding-002',
    about: '',
  },
  gem: {
    name: 'Gemini embedding-001',
    group: 'api',
    api: 'gemini-embedding-001',
    about: '',
  },
};
const METRICS: Record<Metric, { name: string; short: string; higher: boolean; help: string }> = {
  cos: {
    name: 'Cosine similarity',
    short: 'cos',
    higher: true,
    help: 'The angle between two vectors. 1 = same direction, 0 = unrelated. Higher is closer.',
  },
  euc: {
    name: 'Euclidean distance',
    short: 'dist',
    higher: false,
    help: 'The straight-line distance between two vectors. 0 = identical. Lower is closer.',
  },
  dot: {
    name: 'Dot product',
    short: 'dot',
    higher: true,
    help: 'Multiply matching numbers and add them up. Higher is closer.',
  },
};

const EXAMPLE = [
  'The beam failed under the heavy load.',
  'The girder collapsed after it was overloaded.',
  'The beam did not fail under the heavy load.',
  'A laser beam cuts thin steel sheets.',
  'Concrete gets stronger as it cures.',
  'கான்கிரீட் காலப்போக்கில் வலுவாகிறது.',
  'Steel expands when it is heated.',
  'Metal grows longer at high temperatures.',
];

const PLACEHOLDERS = [
  'e.g. The beam failed under the heavy load.',
  'e.g. The girder collapsed after it was overloaded.',
  'e.g. The beam did not fail under the heavy load.',
  'e.g. A laser beam cuts thin steel sheets.',
];

const MIN_S = 3;
const MAX_S = 12;
const COLOR: Record<Slot, [number, number, number]> = {
  A: [188, 108, 211],
  B: [143, 184, 255],
};

const IC = {
  go: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 11 15.7 7M8.3 13l7.4 4"/></svg>',
};

const SHELL = `
<header>
  ${exerciseBrandHtml(6, 'Exercise - 6 : Two Embedding Models')}
  <div class="hr">
    ${THEME_TOGGLE_HTML}
    <button class="icon" id="fsBtn" type="button" title="Full screen" aria-label="Full screen">${FS_ICON_ENTER}</button>
  </div>
</header>
<main>
  <div class="col">
    <section class="card batch">
      <div class="chead"><span class="n">1</span><div class="ct"><b>Batch</b><span>The sentences both models will embed</span></div>
        <button class="mini li" type="button" data-act="example" title="Fill the batch with example sentences">Example</button></div>
      <div class="rows" id="rows"></div>
      <div class="batchfoot"><button class="mini" type="button" data-act="addRow" id="addRowBtn">+ Sentence</button><span class="grow"></span><span id="batchCount"></span></div>
    </section>
    <section class="card models">
      <div class="chead"><span class="n">2</span><div class="ct"><b>Two models</b><span>Each turns every sentence into a list of numbers</span></div></div>
      <div id="slots"></div>
      <div class="same" id="goNote" hidden></div>
      <button class="go" type="button" id="goBtn"></button>
    </section>
  </div>
  <div class="col right">
    <section class="card maps">
      <div class="chead"><span class="n">3</span><div class="ct"><b>How close each pair is</b><span id="metricHelp"></span></div>
        <div class="seg" role="group" aria-label="Measure" id="metricSeg">
          <button type="button" data-metric="cos">Cosine similarity</button>
          <button type="button" data-metric="euc">Euclidean distance</button>
          <button type="button" data-metric="dot">Dot product</button>
        </div></div>
      <div class="stale" id="stale" hidden>The batch or the models changed. Embed again to update the numbers.</div>
      <div id="mapsBody"></div>
      <div class="hover" id="hover"></div>
    </section>
    <div class="lower">
      <section class="card calc">
        <div class="chead"><span class="n">4</span><div class="ct"><b>The calculation</b><span>Pick a cell or a row to see how its number was worked out</span></div></div>
        <div class="calcbody" id="calcBody"></div>
      </section>
      <section class="card dis">
        <div class="chead"><span class="n">5</span><div class="ct"><b>Compare the models</b><span id="disHelp">What each model puts closest</span></div>
          <div class="seg" role="tablist" id="disSeg">
            <button type="button" data-dis="nn">Closest match</button>
            <button type="button" data-dis="pairs">All pairs</button>
          </div></div>
        <div class="disbody" id="disBody"></div>
      </section>
    </div>
  </div>
</main>
<div class="toasts" id="toasts"></div>
<div class="sr" aria-live="polite" id="live"></div>
`;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function len(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function euc(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function cos(a: number[], b: number[]): number {
  const n = len(a) * len(b);
  return n ? dot(a, b) / n : 0;
}

const MEASURE: Record<Metric, (a: number[], b: number[]) => number> = { cos, euc, dot };

function matrix(vecs: number[][], metric: Metric): number[][] {
  const f = MEASURE[metric];
  return vecs.map((a) => vecs.map((b) => f(a, b)));
}

function pairsRanked(M: number[][], metric: Metric): { ps: Pair[]; rank: Record<string, number> } {
  const ps: Pair[] = [];
  for (let i = 0; i < M.length; i += 1) {
    for (let j = i + 1; j < M.length; j += 1) ps.push({ i, j, v: M[i][j] });
  }
  ps.sort((p, q) => (METRICS[metric].higher ? q.v - p.v : p.v - q.v));
  const rank: Record<string, number> = {};
  ps.forEach((p, k) => {
    rank[`${p.i}-${p.j}`] = k + 1;
  });
  return { ps, rank };
}

function nearest(M: number[][], i: number, metric: Metric): number {
  let best = -1;
  for (let j = 0; j < M.length; j += 1) {
    if (j === i) continue;
    if (
      best < 0 ||
      (METRICS[metric].higher ? M[i][j] > M[i][best] : M[i][j] < M[i][best])
    ) {
      best = j;
    }
  }
  return best;
}

function wordsOf(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [];
}

function loadTransformers(): Promise<TransformersMod> {
  const importer = new Function('u', 'return import(u)') as (u: string) => Promise<TransformersMod>;
  return importer(TRANSFORMERS_URL).then((m) => {
    m.env.allowLocalModels = false;
    if (MODEL_HOST.trim()) m.env.remoteHost = MODEL_HOST.trim().replace(/\/?$/, '/');
    return m;
  });
}

export function mountExercise6(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  const cleanups: Array<() => void> = [];
  let uid = 1;

  const S: LabState = {
    rows: [
      { id: uid++, t: '' },
      { id: uid++, t: '' },
      { id: uid++, t: '' },
      { id: uid++, t: '' },
    ],
    A: 'minilm',
    B: 'bge',
    metric: 'cos',
    dis: 'nn',
    sort: 'A',
    load: {},
    run: null,
    busy: false,
    sel: null,
    hov: null,
    markedComplete: false,
  };

  let tjs: Promise<TransformersMod> | null = null;
  const extractors: Partial<Record<string, Promise<FeatureExtractor>>> = {};

  host.innerHTML = SHELL;
  host.classList.remove('is-booting');

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T | null;
  const $$ = <T extends Element = Element>(sel: string) => [...host.querySelectorAll(sel)] as T[];

  const toast = (msg: string) => {
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    box.appendChild(t);
    window.setTimeout(() => t.remove(), 4200);
  };

  const announce = (m: string) => {
    const live = $('#live');
    if (live) live.textContent = m;
  };

  const sentences = () => S.rows.map((r) => r.t.trim()).filter(Boolean);
  const sig = () => JSON.stringify([sentences(), S.A, S.B]);
  const isStale = () => !!S.run && S.run.sig !== sig();

  const nonEmptyIndex = () => {
    const m = new Map<number, number>();
    let n = 0;
    S.rows.forEach((r) => {
      if (r.t.trim()) m.set(r.id, n++);
    });
    return m;
  };

  async function transformers(): Promise<TransformersMod> {
    if (!tjs) {
      tjs = loadTransformers().catch((e) => {
        tjs = null;
        throw e;
      });
    }
    try {
      return await tjs;
    } catch {
      throw new Error(
        "Couldn't load Transformers.js. Check the internet connection (cdn.jsdelivr.net), then try again.",
      );
    }
  }

  function extractor(key: string, onProgress: (p: number, l: number, t: number) => void) {
    const existing = extractors[key];
    if (existing) return existing;
    const m = MODELS[key];
    const files: Record<string, { l: number; t: number }> = {};
    const pending = (async () => {
      const { pipeline } = await transformers();
      return pipeline('feature-extraction', m.hf!, {
        dtype: 'q8',
        progress_callback: (d) => {
          if (d.status === 'progress' && d.file) {
            files[d.file] = { l: d.loaded || 0, t: d.total || 0 };
            const v = Object.values(files);
            const l = v.reduce((a, x) => a + x.l, 0);
            const t = v.reduce((a, x) => a + x.t, 0);
            onProgress(t ? l / t : 0, l, t);
          }
        },
      });
    })();
    extractors[key] = pending;
    pending.catch(() => {
      delete extractors[key];
    });
    return pending;
  }

  function setLoad(slot: Slot, v: LoadState | null) {
    S.load[slot] = v;
    renderSlot(slot);
  }

  async function embedWith(key: string, texts: string[], slot: Slot): Promise<EmbedBundle> {
    const m = MODELS[key];
    const t0 = performance.now();
    if (key === 'words') {
      const vocab = [...new Set(texts.flatMap(wordsOf))];
      const idx = new Map(vocab.map((w, i) => [w, i]));
      const vecs = texts.map((s) => {
        const v = new Array(vocab.length).fill(0) as number[];
        wordsOf(s).forEach((w) => {
          const i = idx.get(w);
          if (i != null) v[i] += 1;
        });
        return v;
      });
      return { vecs, vocab, ms: performance.now() - t0 };
    }
    if (m.group === 'api' && m.api) {
      setLoad(slot, { state: 'loading', p: 0.35, msg: 'Embedding via Playground…' });
      const res = await embedViaPlayground(sessionId, projectId, texts, m.api);
      if (res.embeddings.length !== texts.length) {
        throw new Error('The embeddings service returned the wrong number of vectors.');
      }
      return {
        vecs: res.embeddings,
        ms: performance.now() - t0,
        simulated: res.simulated,
      };
    }
    setLoad(slot, {
      state: 'loading',
      p: 0,
      msg: extractors[key] ? 'Loading the model…' : 'Downloading the model… 0%',
    });
    let ex: FeatureExtractor;
    try {
      ex = await extractor(key, (p, l, t) =>
        setLoad(slot, {
          state: 'loading',
          p,
          msg: `Downloading the model… ${Math.round(p * 100)}% (${(l / 1e6).toFixed(1)} of ${(t / 1e6).toFixed(1)} MB)`,
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        /Transformers\.js/.test(msg)
          ? msg
          : "Couldn't download the model. Check the internet connection (huggingface.co), then try again.",
      );
    }
    setLoad(slot, { state: 'loading', p: 1, msg: 'Embedding…' });
    const t1 = performance.now();
    const out = await ex(texts, { pooling: m.pooling || 'mean', normalize: true });
    return { vecs: out.tolist(), ms: performance.now() - t1 };
  }

  function fmtV(v: number, metric: Metric, key: string, prec?: number): string {
    if (key === 'words' && metric === 'dot') return String(Math.round(v));
    return v.toFixed(prec ?? 2);
  }

  function tint(s: Slot, t: number): string {
    const [r, g, b] = COLOR[s];
    return `rgba(${r},${g},${b},${(0.08 + 0.8 * t).toFixed(3)})`;
  }

  function computed(): Computed | null {
    if (!S.run) return null;
    if (S.run.cache && S.run.cache.metric === S.metric) return S.run.cache;
    const out = { metric: S.metric } as Computed;
    (['A', 'B'] as Slot[]).forEach((s) => {
      const M = matrix(S.run![s].vecs, S.metric);
      const R = pairsRanked(M, S.metric);
      const off = R.ps.map((p) => p.v);
      out[s] = { M, ...R, lo: Math.min(...off), hi: Math.max(...off) };
    });
    S.run.cache = out;
    return out;
  }

  function optionsHTML(sel: string): string {
    return Object.entries(MODELS)
      .map(
        ([k, m]) =>
          `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(m.name)}</option>`,
      )
      .join('');
  }

  function renderBatchFoot() {
    const n = sentences().length;
    const count = $('#batchCount');
    if (count) count.textContent = `${n} sentence${n === 1 ? '' : 's'} · ${(n * (n - 1)) / 2} pairs`;
    const add = $('#addRowBtn') as HTMLButtonElement | null;
    if (add) add.disabled = S.busy || S.rows.length >= MAX_S;
    renderGo();
  }

  function renderRows() {
    const hot = new Set(S.hov ? [S.hov.i, S.hov.j] : S.sel ? [S.sel.i, S.sel.j] : []);
    const idxOf = nonEmptyIndex();
    const rows = $('#rows');
    if (!rows) return;
    rows.innerHTML = S.rows
      .map((r, k) => {
        const n = idxOf.get(r.id);
        return `<div class="row ${n != null && hot.has(n) && S.run && !isStale() ? 'hot' : ''}" data-row="${r.id}">
          <span class="sid">${n != null ? `S${n + 1}` : '–'}</span>
          <input type="text" data-in="${r.id}" value="${esc(r.t)}" placeholder="${esc(PLACEHOLDERS[k] || 'e.g. Another sentence')}" maxlength="300" spellcheck="false" aria-label="Sentence ${k + 1}" ${S.busy ? 'disabled' : ''}>
          <button class="x" type="button" data-act="delRow" data-r="${r.id}" title="Remove" aria-label="Remove sentence" ${S.rows.length <= MIN_S || S.busy ? 'disabled' : ''}>×</button>
        </div>`;
      })
      .join('');
    renderBatchFoot();
  }

  function refreshIds() {
    const m = nonEmptyIndex();
    $$('.row').forEach((el) => {
      const n = m.get(Number((el as HTMLElement).dataset.row));
      const sid = el.querySelector('.sid');
      if (sid) sid.textContent = n != null ? `S${n + 1}` : '–';
    });
  }

  function renderSlot(s: Slot) {
    const el = host.querySelector(`#slot${s} .slotinfo`);
    if (!el) return;
    const L = S.load[s];
    const r = S.run && !isStale() ? S.run[s] : null;
    if (L && L.state === 'loading') {
      el.innerHTML = `<div class="st">${esc(L.msg)}</div><div class="bar"><i style="width:${Math.round((L.p || 0) * 100)}%"></i></div>`;
      return;
    }
    if (L && L.state === 'error') {
      el.innerHTML = `<div class="st bad">${esc(L.msg)}</div>`;
      return;
    }
    if (r) {
      const sim = r.simulated ? ' · classroom fallback' : '';
      el.innerHTML = `<div class="st">${r.vecs.length} vectors × ${r.vecs[0].length.toLocaleString('en-IN')} · ${r.ms < 1000 ? `${Math.round(r.ms)} ms` : `${(r.ms / 1000).toFixed(1)} s`}${sim}</div>`;
      return;
    }
    el.innerHTML = '';
  }

  function renderSlots() {
    const slots = $('#slots');
    if (!slots) return;
    slots.innerHTML = (['A', 'B'] as Slot[])
      .map(
        (s) => `<div class="slot" id="slot${s}" style="--c:var(--${s});margin-bottom:${s === 'A' ? '8px' : '0'}">
      <div class="slotrow"><span class="tag${s}">${s}</span><select data-slot="${s}" aria-label="Model ${s}" ${S.busy ? 'disabled' : ''}>${optionsHTML(S[s])}</select></div>
      <div class="slotinfo"></div></div>`,
      )
      .join('');
    renderSlot('A');
    renderSlot('B');
  }

  function renderGo() {
    const b = $('#goBtn') as HTMLButtonElement | null;
    if (!b) return;
    const n = sentences().length;
    const same = S.A === S.B;
    b.disabled = S.busy || n < MIN_S || same;
    b.innerHTML = S.busy
      ? 'Embedding…'
      : `${IC.go} ${S.run ? 'Embed again with both models' : 'Embed with both models'}`;
    b.title = same ? 'Pick two different models' : n < MIN_S ? `Add at least ${MIN_S} sentences` : '';
    const note = $('#goNote');
    if (note) {
      note.textContent = same ? 'Pick two different models to compare.' : '';
      note.hidden = !same;
    }
  }

  function mapHTML(s: Slot, C: Computed): string {
    if (!S.run) return '';
    const n = S.run.texts.length;
    const d = C[s];
    const m = MODELS[S.run[`${s}key` as 'Akey' | 'Bkey']];
    const higher = METRICS[S.metric].higher;
    const hot = S.hov || S.sel;
    let h = `<div class="hm"><div class="hmh"><span class="tag${s}">${s}</span><span class="nm">${esc(m.name)}</span><small>${n}×${n}</small></div>
      <div class="grid" style="grid-template-columns:26px repeat(${n},minmax(0,1fr))"><span></span>${S.run.texts
        .map(
          (_, j) =>
            `<span class="gl ${hot && (hot.i === j || hot.j === j) ? 'hot' : ''}" title="${esc(S.run!.texts[j])}">S${j + 1}</span>`,
        )
        .join('')}`;
    for (let i = 0; i < n; i += 1) {
      h += `<span class="gl ${hot && (hot.i === i || hot.j === i) ? 'hot' : ''}" title="${esc(S.run.texts[i])}">S${i + 1}</span>`;
      for (let j = 0; j < n; j += 1) {
        if (i === j) {
          h += `<span class="cell diag">${fmtV(d.M[i][j], S.metric, S.run[`${s}key` as 'Akey' | 'Bkey'])}</span>`;
          continue;
        }
        const v = d.M[i][j];
        const span = d.hi - d.lo || 1;
        const t = higher ? (v - d.lo) / span : (d.hi - v) / span;
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const isH = S.hov && S.hov.i === a && S.hov.j === b;
        const isS = S.sel && S.sel.i === a && S.sel.j === b;
        h += `<span class="cell ${isH ? 'hov' : ''} ${isS ? 'sel' : ''}" data-i="${a}" data-j="${b}" style="background:${tint(s, t)};color:${t > 0.55 ? '#fff' : 'var(--mu)'}" title="S${i + 1} ↔ S${j + 1}: ${fmtV(v, S.metric, S.run[`${s}key` as 'Akey' | 'Bkey'], 4)}">${fmtV(v, S.metric, S.run[`${s}key` as 'Akey' | 'Bkey'])}</span>`;
      }
    }
    const [r, g, b] = COLOR[s];
    h += `</div><div class="legend"><span>farther</span><i style="background:linear-gradient(90deg,rgba(${r},${g},${b},.08),rgba(${r},${g},${b},.88))"></i><span>closer</span></div></div>`;
    return h;
  }

  function renderHover() {
    const el = $('#hover');
    if (!el) return;
    const p = S.hov || S.sel;
    if (!S.run || !p) {
      el.innerHTML = S.run
        ? '<span>Hover over a cell to compare the same pair in both models.</span>'
        : '';
      return;
    }
    const C = computed();
    if (!C) return;
    el.innerHTML = `<b>S${p.i + 1} ↔ S${p.j + 1}</b><span><span class="tagA" style="width:16px;height:16px;font-size:9.5px">A</span> <span class="vA">${fmtV(C.A.M[p.i][p.j], S.metric, S.run.Akey, 3)}</span> · rank #${C.A.rank[`${p.i}-${p.j}`]}</span><span><span class="tagB" style="width:16px;height:16px;font-size:9.5px">B</span> <span class="vB">${fmtV(C.B.M[p.i][p.j], S.metric, S.run.Bkey, 3)}</span> · rank #${C.B.rank[`${p.i}-${p.j}`]}</span><span>of ${C.A.ps.length} pairs</span>`;
  }

  function renderMetric() {
    $$('[data-metric]').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.metric === S.metric),
    );
    const help = $('#metricHelp');
    if (help) help.textContent = METRICS[S.metric].help;
  }

  function renderMaps() {
    renderMetric();
    const body = $('#mapsBody');
    const stale = $('#stale');
    if (stale) stale.hidden = !isStale();
    if (!body) return;
    if (!S.run) {
      body.innerHTML = `<div class="empty">Add at least ${MIN_S} sentences, pick two models, then embed. Each model's numbers for every pair of sentences appear here, side by side.</div>`;
      const hover = $('#hover');
      if (hover) hover.innerHTML = '';
      return;
    }
    const C = computed();
    if (!C) return;
    body.innerHTML = `<div class="pair" style="${isStale() ? 'opacity:.45' : ''}">${mapHTML('A', C)}${mapHTML('B', C)}</div>`;
    renderHover();
  }

  const neg = (s: string) => s.replace(/^-/, '−');
  const f4 = (x: number) =>
    neg(
      Math.abs(x) >= 1000 || (Math.abs(x) < 0.0005 && x !== 0)
        ? x.toExponential(2)
        : x.toFixed(4),
    );
  const f3 = (x: number) => neg(x.toFixed(3));
  const sgn = (x: number) => (x < 0 ? `(${f3(x)})` : f3(x));

  function termsNeural(a: number[], b: number[], kind: 'dot' | 'sq' | 'diff'): string {
    const k = 3;
    const n = a.length;
    const parts: string[] = [];
    for (let i = 0; i < Math.min(k, n); i += 1) {
      if (kind === 'dot') parts.push(`${sgn(a[i])}×${sgn(b[i])}`);
      else if (kind === 'sq') parts.push(`${sgn(a[i])}²`);
      else parts.push(`(${sgn(a[i])}−${sgn(b[i])})²`);
    }
    return (
      parts.join(' + ') +
      (n > k ? ` <span class="more">+ … ${(n - k).toLocaleString('en-IN')} more</span>` : '')
    );
  }

  function termsWords(
    a: number[],
    b: number[],
    vocab: string[],
    kind: 'dot' | 'sq' | 'diff',
  ): string {
    const idx: number[] = [];
    for (let i = 0; i < vocab.length; i += 1) {
      if (kind === 'dot' ? a[i] && b[i] : kind === 'sq' ? a[i] : a[i] !== b[i]) idx.push(i);
    }
    if (!idx.length) return kind === 'dot' ? '<span class="more">no word appears in both</span>' : '0';
    const show = idx.slice(0, 6);
    const rest = idx.length - show.length;
    const t = show.map((i) =>
      kind === 'dot'
        ? `<span class="w">${esc(vocab[i])}</span> ${a[i]}×${b[i]}`
        : kind === 'sq'
          ? `<span class="w">${esc(vocab[i])}</span> ${a[i]}²`
          : `<span class="w">${esc(vocab[i])}</span> (${a[i]}−${b[i]})²`,
    );
    return (
      t.join(' + ') +
      (rest ? ` <span class="more">+ … ${rest} more word${rest === 1 ? '' : 's'}</span>` : '')
    );
  }

  function calcFor(s: Slot, p: PairSel, C: Computed): string {
    if (!S.run) return '';
    const key = S.run[`${s}key` as 'Akey' | 'Bkey'];
    const vecs = S.run[s].vecs;
    const a = vecs[p.i];
    const b = vecs[p.j];
    const words = key === 'words';
    const vocab = S.run[s].vocab || [];
    const T = (kind: 'dot' | 'sq' | 'diff', x: number[], y: number[]) =>
      words ? termsWords(x, y, vocab, kind) : termsNeural(x, y, kind);
    const d = dot(a, b);
    const la = len(a);
    const lb = len(b);
    const e = euc(a, b);
    const c = la * lb ? d / (la * lb) : 0;
    const R = C[s].rank[`${p.i}-${p.j}`];
    const row = (l: string, r: string) =>
      `<div><span class="lhs">${l}</span><span>${r}</span></div>`;
    let eq = '';
    if (S.metric === 'cos') {
      eq =
        row('a · b', `= ${T('dot', a, b)} = <b>${words ? d : f4(d)}</b>`) +
        row('|a|', `= √( ${T('sq', a, a)} ) = <b>${f4(la)}</b>`) +
        row('|b|', `= √( ${T('sq', b, b)} ) = <b>${f4(lb)}</b>`) +
        row(
          'cos',
          `= ${words ? d : f4(d)} ÷ (${f4(la)} × ${f4(lb)}) = <span class="res">${f4(c)}</span>`,
        );
    } else if (S.metric === 'euc') {
      eq =
        row('distance', `= √( ${T('diff', a, b)} )`) +
        row('', `= √${f4(e * e)} = <span class="res">${f4(e)}</span>`);
    } else {
      eq =
        row('a · b', `= ${T('dot', a, b)}`) +
        row('', `= <span class="res">${words ? d : f4(d)}</span>`);
    }
    return `<div class="mcalc" style="--c:var(--${s})"><div class="mch"><span class="tag${s}">${s}</span>${esc(MODELS[key].name)}<span class="rk">rank <b>#${R}</b> of ${C[s].ps.length} pairs</span></div>
      <div class="eq">${eq}</div></div>`;
  }

  function renderCalc() {
    const el = $('#calcBody');
    if (!el) return;
    if (!S.run) {
      el.innerHTML =
        '<div class="empty">After embedding, pick any pair to see its number worked out from the two vectors, one step at a time.</div>';
      return;
    }
    if (!S.sel) {
      el.innerHTML = '<div class="empty">Click a cell in either grid, or a row on the right.</div>';
      return;
    }
    const C = computed();
    if (!C) return;
    const p = S.sel;
    const t = S.run.texts;
    el.innerHTML = `<div class="sents"><div class="sent"><span class="sid">S${p.i + 1}</span><span><b style="color:var(--tx);font-weight:600">a</b> · ${esc(t[p.i])}</span></div><div class="sent"><span class="sid">S${p.j + 1}</span><span><b style="color:var(--tx);font-weight:600">b</b> · ${esc(t[p.j])}</span></div></div>
      ${calcFor('A', p, C)}${calcFor('B', p, C)}`;
  }

  function renderDis() {
    $$('[data-dis]').forEach((b) =>
      b.classList.toggle('on', (b as HTMLElement).dataset.dis === S.dis),
    );
    const el = $('#disBody');
    const help = $('#disHelp');
    if (help) {
      help.textContent =
        S.dis === 'nn'
          ? 'For each sentence, the one each model puts closest'
          : "Every pair, with each model's number and rank";
    }
    if (!el) return;
    if (!S.run) {
      el.innerHTML =
        '<div class="empty">After embedding, see which sentence each model puts closest to each one.</div>';
      return;
    }
    const C = computed();
    if (!C) return;
    const t = S.run.texts;
    const n = t.length;
    const mk = S.metric;
    if (S.dis === 'nn') {
      let diff = 0;
      const rows = t
        .map((s, i) => {
          const a = nearest(C.A.M, i, mk);
          const b = nearest(C.B.M, i, mk);
          const d = a !== b;
          if (d) diff += 1;
          const sel =
            S.sel &&
            ((S.sel.i === i && (S.sel.j === a || S.sel.j === b)) ||
              (S.sel.j === i && (S.sel.i === a || S.sel.i === b)));
          return `<tr class="${sel ? 'on' : ''}"><td><span class="nb"><span class="sid">S${i + 1}</span></span></td><td class="txt" title="${esc(s)}">${esc(s)}</td>
            <td><button class="mini" type="button" style="padding:2px 7px" data-pi="${i}" data-pj="${a}" title="${esc(t[a])}"><span class="tagA" style="width:14px;height:14px;font-size:9px">A</span>S${a + 1} <small style="color:var(--fa)">${fmtV(C.A.M[i][a], mk, S.run!.Akey)}</small></button></td>
            <td><button class="mini" type="button" style="padding:2px 7px" data-pi="${i}" data-pj="${b}" title="${esc(t[b])}"><span class="tagB" style="width:14px;height:14px;font-size:9px">B</span>S${b + 1} <small style="color:var(--fa)">${fmtV(C.B.M[i][b], mk, S.run!.Bkey)}</small></button></td>
            <td><span class="chip ${d ? 'diff' : ''}">${d ? 'Different' : 'Same'}</span></td></tr>`;
        })
        .join('');
      el.innerHTML = `<div class="dsum">The two models pick a different closest sentence for <b>${diff} of ${n}</b> sentences.</div>
        <table class="nn"><colgroup><col class="c1"><col><col class="c3"><col class="c4"><col class="c5"></colgroup><thead><tr><th></th><th>Sentence</th><th>A's closest</th><th>B's closest</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      const all = C.A.ps.map((p) => {
        const k = `${p.i}-${p.j}`;
        return {
          i: p.i,
          j: p.j,
          va: C.A.M[p.i][p.j],
          vb: C.B.M[p.i][p.j],
          ra: C.A.rank[k],
          rb: C.B.rank[k],
        };
      });
      all.sort((x, y) =>
        S.sort === 'A'
          ? x.ra - y.ra
          : S.sort === 'B'
            ? x.rb - y.rb
            : Math.abs(y.ra - y.rb) - Math.abs(x.ra - x.rb) || x.ra - y.ra,
      );
      const span = (s: Slot) => {
        const d = C[s];
        return d.hi - d.lo || 1;
      };
      const w = (s: Slot, v: number) => {
        const d = C[s];
        const tNorm = METRICS[mk].higher ? (v - d.lo) / span(s) : (d.hi - v) / span(s);
        return Math.round(8 + tNorm * 70);
      };
      el.innerHTML = `<div class="dsum" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">Order by <span class="seg" role="group" aria-label="Order pairs by">
          <button type="button" data-sort="A" class="${S.sort === 'A' ? 'on' : ''}">A's ranking</button>
          <button type="button" data-sort="B" class="${S.sort === 'B' ? 'on' : ''}">B's ranking</button>
          <button type="button" data-sort="gap" class="${S.sort === 'gap' ? 'on' : ''}">Rank gap</button></span></div>
        <table class="ap"><colgroup><col class="c1"><col><col class="c3"></colgroup><thead><tr><th>Pair</th><th>Numbers</th><th>Rank A / B</th></tr></thead><tbody>${all
          .map((r) => {
            const on = S.sel && S.sel.i === r.i && S.sel.j === r.j;
            return `<tr class="pick ${on ? 'on' : ''}" data-pi="${r.i}" data-pj="${r.j}" title="S${r.i + 1}: ${esc(t[r.i])}&#10;S${r.j + 1}: ${esc(t[r.j])}"><td><span class="nb"><span class="sid">S${r.i + 1}</span>·<span class="sid">S${r.j + 1}</span></span></td>
              <td><div class="bars"><span class="b1" style="--c:var(--A)"><i style="width:${w('A', r.va)}px"></i>${fmtV(r.va, mk, S.run!.Akey)}</span><span class="b1" style="--c:var(--B)"><i style="width:${w('B', r.vb)}px"></i>${fmtV(r.vb, mk, S.run!.Bkey)}</span></div></td>
              <td class="rks"><span class="a">#${r.ra}</span> / <span class="b">#${r.rb}</span></td></tr>`;
          })
          .join('')}</tbody></table>`;
    }
  }

  function renderResults() {
    renderMaps();
    renderCalc();
    renderDis();
    renderRows();
    renderSlot('A');
    renderSlot('B');
  }

  function selectPair(i: number, j: number) {
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    S.sel = S.sel && S.sel.i === a && S.sel.j === b ? S.sel : { i: a, j: b };
    renderResults();
  }

  function maybeComplete() {
    if (S.markedComplete || !onComplete || !S.run) return;
    S.markedComplete = true;
    onComplete();
  }

  async function embedBoth() {
    if (S.busy) return;
    const texts = sentences();
    if (texts.length < MIN_S) {
      toast(`Add at least ${MIN_S} sentences first.`);
      return;
    }
    if (S.A === S.B) return;
    S.busy = true;
    S.load = {};
    renderRows();
    renderSlots();
    renderGo();
    const run = {
      texts,
      sig: sig(),
      Akey: S.A,
      Bkey: S.B,
    } as RunState;
    let ok = true;
    for (const s of ['A', 'B'] as Slot[]) {
      try {
        run[s] = await embedWith(S[s], texts, s);
        S.load[s] = null;
      } catch (e) {
        ok = false;
        S.load[s] = {
          state: 'error',
          msg: e instanceof Error ? e.message : 'Embedding failed.',
        };
      }
      renderSlot(s);
    }
    S.busy = false;
    if (ok) {
      S.run = run;
      if (!S.sel || S.sel.j >= texts.length) S.sel = null;
      announce('Both models embedded the batch.');
      maybeComplete();
      if (run.A.simulated || run.B.simulated) {
        toast('One or both hosted models used classroom fallback embeddings.');
      }
    }
    renderSlots();
    renderGo();
    renderResults();
  }

  const onInput = (e: Event) => {
    const t = e.target as HTMLElement;
    const id = t.dataset?.in;
    if (!id) return;
    const r = S.rows.find((x) => x.id === +id);
    if (!r) return;
    const was = nonEmptyIndex().size;
    r.t = (t as HTMLInputElement).value;
    renderBatchFoot();
    if (nonEmptyIndex().size !== was) refreshIds();
    if (S.run) {
      renderMaps();
      renderSlot('A');
      renderSlot('B');
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    const t = e.target as HTMLElement;
    if (!t.dataset?.in) return;
    const text = e.clipboardData?.getData('text') || '';
    const lines = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const k = S.rows.findIndex((x) => x.id === +t.dataset.in!);
    S.rows[k].t = lines[0];
    const room = MAX_S - S.rows.length;
    const extra = lines.slice(1, 1 + Math.max(0, room));
    S.rows.splice(
      k + 1,
      0,
      ...extra.map((l) => ({ id: uid++, t: l })),
    );
    renderRows();
    if (S.run) renderMaps();
    if (lines.length - 1 > extra.length) {
      toast(`The batch holds at most ${MAX_S} sentences, so the rest were left out.`);
    }
  };

  const onChange = (e: Event) => {
    const t = e.target as HTMLElement;
    const slot = t.dataset?.slot as Slot | undefined;
    if (!slot) return;
    S[slot] = (t as HTMLSelectElement).value;
    S.load[slot] = null;
    renderSlot(slot);
    renderGo();
    if (S.run) {
      const stale = $('#stale');
      if (stale) stale.hidden = !isStale();
      renderMaps();
    }
  };

  const onMouseOver = (e: MouseEvent) => {
    const c = (e.target as HTMLElement).closest('.cell[data-i]') as HTMLElement | null;
    const nh = c ? { i: +c.dataset.i!, j: +c.dataset.j! } : null;
    if (JSON.stringify(nh) === JSON.stringify(S.hov)) return;
    if (!c && !(e.target as HTMLElement).closest('.grid') && S.hov === null) return;
    S.hov = nh;
    $$('.cell[data-i]').forEach((el) => {
      const node = el as HTMLElement;
      el.classList.toggle(
        'hov',
        !!nh && +node.dataset.i! === nh.i && +node.dataset.j! === nh.j,
      );
    });
    const hot = nh || S.sel;
    $$('.grid').forEach((g) => {
      const ls = [...g.querySelectorAll('.gl')];
      const n = S.run ? S.run.texts.length : 0;
      ls.forEach((l, k) => {
        const idx = k < n ? k : k - n;
        l.classList.toggle('hot', !!hot && (idx === hot.i || idx === hot.j));
      });
    });
    renderHover();
    const m = nonEmptyIndex();
    const hs = new Set(hot ? [hot.i, hot.j] : []);
    $$('.row').forEach((el) => {
      const n = m.get(Number((el as HTMLElement).dataset.row));
      el.classList.toggle('hot', !!S.run && !isStale() && n != null && hs.has(n));
    });
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const c = target.closest('.cell[data-i]') as HTMLElement | null;
    if (c) {
      selectPair(+c.dataset.i!, +c.dataset.j!);
      return;
    }
    const pp = target.closest('[data-pi]') as HTMLElement | null;
    if (pp) {
      selectPair(+pp.dataset.pi!, +pp.dataset.pj!);
      return;
    }
    const m = target.closest('[data-metric]') as HTMLElement | null;
    if (m) {
      S.metric = m.dataset.metric as Metric;
      if (S.run) S.run.cache = undefined;
      renderResults();
      return;
    }
    const d = target.closest('[data-dis]') as HTMLElement | null;
    if (d) {
      S.dis = d.dataset.dis as DisView;
      renderDis();
      return;
    }
    const so = target.closest('[data-sort]') as HTMLElement | null;
    if (so) {
      S.sort = so.dataset.sort as SortKey;
      renderDis();
      return;
    }
    const a = target.closest('[data-act]') as HTMLElement | null;
    if (a) {
      const act = a.dataset.act;
      if (act === 'example') {
        if (sentences().length && !window.confirm('Replace the batch with the example sentences?')) {
          return;
        }
        S.rows = EXAMPLE.map((t) => ({ id: uid++, t }));
        renderRows();
        if (S.run) renderMaps();
      } else if (act === 'addRow') {
        if (S.rows.length < MAX_S) {
          S.rows.push({ id: uid++, t: '' });
          renderRows();
          $$<HTMLInputElement>('.row input').pop()?.focus();
        }
      } else if (act === 'delRow') {
        S.rows = S.rows.filter((x) => x.id !== +a.dataset.r!);
        renderRows();
        if (S.run) renderMaps();
      }
      return;
    }
    if (target.closest('#goBtn')) void embedBoth();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (!t.dataset?.in || e.key !== 'Enter') return;
    e.preventDefault();
    const k = S.rows.findIndex((x) => x.id === +t.dataset.in!);
    const inputs = $$<HTMLInputElement>('.row input');
    if (k < S.rows.length - 1) inputs[k + 1]?.focus();
    else if (S.rows.length < MAX_S) {
      S.rows.push({ id: uid++, t: '' });
      renderRows();
      $$<HTMLInputElement>('.row input').pop()?.focus();
    } else {
      const go = $('#goBtn') as HTMLButtonElement | null;
      if (go && !go.disabled) void embedBoth();
    }
  };

  cleanups.push(bindExerciseTheme(host));
  cleanups.push(bindHostFullscreen(host, $('#fsBtn')));

  const syncFsIcon = () => {
    const btn = $('#fsBtn');
    if (!btn) return;
    const on = document.fullscreenElement === host || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement === host;
    btn.innerHTML = on ? FS_ICON_EXIT : FS_ICON_ENTER;
    btn.title = on ? 'Exit full screen' : 'Full screen';
  };
  document.addEventListener('fullscreenchange', syncFsIcon);
  cleanups.push(() => document.removeEventListener('fullscreenchange', syncFsIcon));

  host.addEventListener('input', onInput);
  host.addEventListener('paste', onPaste);
  host.addEventListener('change', onChange);
  host.addEventListener('mouseover', onMouseOver);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKeyDown);
  cleanups.push(() => {
    host.removeEventListener('input', onInput);
    host.removeEventListener('paste', onPaste);
    host.removeEventListener('change', onChange);
    host.removeEventListener('mouseover', onMouseOver);
    host.removeEventListener('click', onClick);
    host.removeEventListener('keydown', onKeyDown);
  });

  renderSlots();
  renderRows();
  renderResults();

  return () => {
    cleanups.forEach((fn) => fn());
    host.innerHTML = '';
  };
}
