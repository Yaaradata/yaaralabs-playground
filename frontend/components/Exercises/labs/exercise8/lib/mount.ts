import {
  loadDialsCatalog,
  runDialGeneration,
  type DialDef,
  type DialModel,
  type DialRunResult,
  type DialValues,
  type DialsCatalog,
} from './api';
import { bindHostFullscreen } from '../../../fullscreen';
import { defaultVersionOf } from '../../../modelVersions';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { createUndoStack, syncUndoButton, UNDO_BUTTON_HTML } from '../../../undoHistory';
import { exerciseHeaderIconHtml } from '../../../exerciseHeaderIcons';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

type BatchId = 'A' | 'B';
type DialKey = DialDef['key'];

interface RunRow {
  i: number;
  status: 'running' | 'done' | 'error';
  dials: DialValues;
  prov: string;
  model: string;
  prompt: string;
  text?: string;
  inTok?: number;
  outTok?: number;
  stop?: string;
  ms?: number;
  cost?: number;
  error?: string;
  simulated?: boolean;
}

interface BatchStats {
  n: number;
  unique: number;
  overlap: number;
  avgOut: number;
  capHits: number;
  avgCost: number;
  total: number;
  avgMs: number;
}

interface LogEntry {
  id: number;
  time: string;
  test: DialKey;
  diff: number;
  A: DialValues;
  B: DialValues;
  prompt: string;
  prov: string;
  model: string;
  results: { A: RunRow[]; B: RunRow[] };
  a: BatchStats;
  b: BatchStats;
  runs: number;
}

interface LabState {
  prov: string;
  ver: string;
  view: DialKey;
  A: DialValues;
  B: DialValues;
  runs: number;
  results: { A: RunRow[]; B: RunRow[] };
  run: { A: boolean; B: boolean };
  stop: { A: boolean; B: boolean };
  prog: { A: number; B: number };
  log: LogEntry[];
  active: number | null;
  inrPerUsd: number;
}

const IC = {
  play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  base: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/></svg>',
  reset: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
};

const WORDS: Record<DialKey, [string, string]> = {
  temp: ['Low temperature', 'High temperature'],
  topk: ['Narrow top-k', 'Wide top-k'],
  topp: ['Narrow top-p', 'Wide top-p'],
  cap: ['Short cap', 'Long cap'],
};

const GROUP = [
  '#6cc7d3',
  '#EC4899',
  '#ff8fb1',
  '#8fa8ff',
  '#7fe0a8',
  '#e0a37f',
  '#5fb3ff',
  '#ffe08a',
  '#c9c9c9',
  '#f59f9f',
];

const STORE = 'dial-lab-ex8';

const TEMPLATE = `
<header>
  <div class="hleft">
    <h1 class="title">${exerciseHeaderIconHtml(7)}<span class="ex">Exercise - 7</span><span class="sep">:</span>Change One Dial at a Time</h1>
    <div class="hctl">
      <div class="runs"><span class="rlg">Runs per batch</span><span class="rsh">Runs</span>
        <div class="stepper"><button type="button" data-step="-1" title="Fewer runs">−</button><b id="nRuns">5</b><button type="button" data-step="1" title="More runs">+</button></div>
      </div>
      <button type="button" class="hbtn" id="baseBtn" title="Make Batch B identical to Batch A — run both to see how much answers vary by chance alone"></button>
      <button type="button" class="hbtn" id="resetBtn" title="Reset dials to the starting values for the dial you are viewing"></button>
    </div>
  </div>
  <div class="hr">
    <label class="msel" title="Model — the same model runs both batches">
      <span>Models</span>
      <select id="provSel"></select>
    </label>
    <button type="button" class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
    ${UNDO_BUTTON_HTML}
    ${THEME_TOGGLE_HTML}
  </div>
</header>
<main>
  <section class="col work">
    <div class="card pcard">
      <div class="lab">Prompt <button type="button" class="lnk" id="explainBtn">What do the dials do?</button></div>
      <textarea id="prompt" placeholder="Type a short-answer prompt — e.g. “Write a one-line shift handover note for Line 3.” Short answers make the dial's effect easy to see."></textarea>
    </div>
    <div class="batches">
      <div class="card batch" id="batchA" data-b="A"></div>
      <div class="card batch" id="batchB" data-b="B"></div>
    </div>
  </section>
  <aside class="col">
    <div class="card ccard">
      <div class="lab">Compare</div>
      <div id="compare"></div>
    </div>
    <div class="card logc">
      <div class="lab"><span>Experiment log <span id="logN"></span></span><button type="button" class="lnk" id="exportBtn" hidden>Export CSV</button></div>
      <div class="log" id="log"></div>
    </div>
  </aside>
</main>
<div id="toasts"></div>
<div class="modal" id="explainModal" hidden>
  <div class="mbox" role="dialog" aria-modal="true" aria-labelledby="explainTitle">
    <div class="mh"><span id="explainTitle">Generation dials</span><button type="button" class="x" data-close aria-label="Close">×</button></div>
    <div id="explainBody"></div>
  </div>
</div>
`;

function fmtDial(D: DialDef, v: number): string {
  if (D.key === 'temp') return v.toFixed(2);
  if (D.key === 'topk') return v === 0 ? 'off' : String(v);
  if (D.key === 'topp') return v >= 0.999 ? 'off' : v.toFixed(2);
  return `${v} tok`;
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c,
  );
}

function norm(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Keep dial values typed and in-range (sliders / localStorage can drift). */
function normalizeDials(raw: Partial<DialValues> | null | undefined, tempMax = 2): DialValues {
  const src = raw || {};
  return {
    temp: clamp(Number(src.temp ?? 0.7) || 0, 0, tempMax),
    topk: Math.round(clamp(Number(src.topk ?? 0) || 0, 0, 100)),
    topp: clamp(Number(src.topp ?? 1) || 1, 0.05, 1),
    cap: Math.round(clamp(Number(src.cap ?? 60) || 60, 5, 400)),
  };
}

function parseDialValue(k: DialKey, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return k === 'topp' ? 1 : k === 'temp' ? 0.7 : 0;
  if (k === 'topk' || k === 'cap') return Math.round(n);
  if (k === 'temp') return Math.round(n * 100) / 100;
  return Math.round(n * 100) / 100;
}

export function mountExercise8(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  let catalog: DialsCatalog | null = null;
  let models: Record<string, DialModel> = {};
  let dialList: DialDef[] = [];
  let dialByKey: Record<string, DialDef> = {};
  let aborted = false;
  let unbindFs: (() => void) | undefined;
  let unbindTheme: (() => void) | undefined;
  const controllers: { A: AbortController | null; B: AbortController | null } = { A: null, B: null };

  type UndoSnapshot = Pick<
    LabState,
    'prov' | 'ver' | 'view' | 'A' | 'B' | 'runs' | 'results' | 'log' | 'active'
  > & { prompt: string };

  const undoStack = createUndoStack<UndoSnapshot>({ max: 40 });
  let promptUndoPushed = false;

  const S: LabState = {
    prov: 'gemini-flash-lite',
    ver: '',
    view: 'temp',
    A: { temp: 0.1, topk: 0, topp: 1, cap: 60 },
    B: { temp: 1.4, topk: 0, topp: 1, cap: 60 },
    runs: 5,
    results: { A: [], B: [] },
    run: { A: false, B: false },
    stop: { A: false, B: false },
    prog: { A: 0, B: 0 },
    log: [],
    active: null,
    inrPerUsd: 88,
  };

  const busy = () => S.run.A || S.run.B;
  const P = () => models[S.prov] || Object.values(models)[0];

  const captureUndoSnapshot = (): UndoSnapshot => ({
    prov: S.prov,
    ver: S.ver,
    view: S.view,
    A: { ...S.A },
    B: { ...S.B },
    runs: S.runs,
    results: JSON.parse(JSON.stringify(S.results)) as { A: RunRow[]; B: RunRow[] },
    log: JSON.parse(JSON.stringify(S.log)) as LogEntry[],
    active: S.active,
    prompt: ($('#prompt') as HTMLTextAreaElement | null)?.value ?? '',
  });

  const syncUndoUi = () => {
    syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undoStack.canUndo && !busy());
  };

  const pushUndo = () => {
    if (busy()) return;
    undoStack.push(captureUndoSnapshot());
    syncUndoUi();
  };

  const restoreUndoSnapshot = (snap: UndoSnapshot) => {
    S.prov = snap.prov;
    S.view = snap.view;
    S.runs = snap.runs;
    S.active = snap.active;
    const tempMax = P()?.tempMax ?? 2;
    S.A = normalizeDials(snap.A, tempMax);
    S.B = normalizeDials(snap.B, tempMax);
    S.results = JSON.parse(JSON.stringify(snap.results)) as { A: RunRow[]; B: RunRow[] };
    S.log = JSON.parse(JSON.stringify(snap.log)) as LogEntry[];
    const provSel = $('#provSel') as HTMLSelectElement | null;
    if (provSel) provSel.value = snap.prov;
    syncVer();
    const prompt = $('#prompt') as HTMLTextAreaElement | null;
    if (prompt) prompt.value = snap.prompt;
  };

  const undoLast = () => {
    if (busy()) return;
    const snap = undoStack.undo();
    if (!snap) return;
    restoreUndoSnapshot(snap);
    renderAll();
    syncUndoUi();
    save();
  };
  const syncVer = () => {
    S.ver = defaultVersionOf(P());
  };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T | null;
  const getPrompt = () => ($('#prompt') as HTMLTextAreaElement | null)?.value.trim() || '';
  const maxFor = (D: DialDef) => (D.key === 'temp' ? P()?.tempMax ?? D.max : D.max);
  const supported = (k: DialKey) => k !== 'topk' || Boolean(P()?.topk);
  const effective = (k: DialKey, v: number) => (k === 'topk' && v === 0 ? 1e9 : v);
  const usd = (c: number) => `$${(c < 0.01 ? c.toFixed(6) : c.toFixed(4))}`;

  function toast(msg: string) {
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    box.appendChild(t);
    window.setTimeout(() => t.remove(), 3200);
  }

  function applyPreset(k: DialKey = 'temp') {
    const tempMax = P()?.tempMax ?? 2;
    const Pr = catalog?.presets[k];
    const base = { temp: 0.7, topk: 0, topp: 1, cap: 60 };
    if (!Pr) {
      S.A = normalizeDials({ ...base, ...catalog?.defaults.A }, tempMax);
      S.B = normalizeDials({ ...base, ...catalog?.defaults.B }, tempMax);
      return;
    }
    const hi = Math.min(1.4, tempMax);
    // Spread preset first, then override temp so model tempMax wins over catalog B.temp
    const patchB = k === 'temp' ? { ...Pr.B, temp: hi } : Pr.B;
    S.A = normalizeDials({ ...base, ...Pr.base, ...Pr.A }, tempMax);
    S.B = normalizeDials({ ...base, ...Pr.base, ...patchB }, tempMax);
  }

  function stale(b: BatchId) {
    const r = S.results[b][0];
    if (!r) return false;
    const tempMax = P()?.tempMax ?? 2;
    return (
      JSON.stringify(normalizeDials(r.dials, tempMax)) !== JSON.stringify(normalizeDials(S[b], tempMax)) ||
      r.prompt !== getPrompt() ||
      r.prov !== S.prov
    );
  }

  function diffDials(): DialDef[] {
    return dialList.filter(
      (D) => supported(D.key) && Math.abs(S.A[D.key] - S.B[D.key]) > 1e-9,
    );
  }

  function groupsOf(b: BatchId) {
    const map: Record<string, number> = {};
    const idx: Array<number | null> = [];
    let n = 0;
    S.results[b].forEach((r) => {
      if (r.status !== 'done') {
        idx.push(null);
        return;
      }
      const k = norm(r.text || '');
      if (!(k in map)) map[k] = n++;
      idx.push(map[k]);
    });
    return { idx, unique: n };
  }

  function stats(b: BatchId): BatchStats | null {
    const R = S.results[b].filter((r) => r.status === 'done');
    if (!R.length) return null;
    const texts = R.map((r) => (r.text || '').trim());
    const ws = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9À-￿']+/g) || []));
    const jac = (x: string, y: string) => {
      const A = ws(x);
      const B = ws(y);
      if (!A.size && !B.size) return 1;
      let n = 0;
      A.forEach((w) => {
        if (B.has(w)) n += 1;
      });
      return n / (A.size + B.size - n);
    };
    let pairs = 0;
    let sum = 0;
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        sum += jac(texts[i], texts[j]);
        pairs += 1;
      }
    }
    const total = R.reduce((a, r) => a + (r.cost || 0), 0);
    return {
      n: R.length,
      unique: new Set(texts.map(norm)).size,
      overlap: pairs ? sum / pairs : 1,
      avgOut: R.reduce((a, r) => a + (r.outTok || 0), 0) / R.length,
      capHits: R.filter((r) => r.stop === 'max_tokens').length,
      avgCost: total / R.length,
      total,
      avgMs: R.reduce((a, r) => a + (r.ms || 0), 0) / R.length,
    };
  }

  function viewList() {
    return dialList.filter((D) => supported(D.key));
  }

  function hiddenByTemp(k: DialKey) {
    return (k === 'topp' || k === 'topk') && (S.A.temp < 0.7 || S.B.temp < 0.7);
  }

  function renderFair() {
    const diff = diffDials();
    for (const b of ['A', 'B'] as BatchId[]) {
      const sub = $(`#sub${b}`);
      if (!sub) continue;
      if (diff.length === 1) {
        const k = diff[0].key;
        const o: BatchId = b === 'A' ? 'B' : 'A';
        sub.textContent =
          WORDS[k][effective(k, S[b][k]) < effective(k, S[o][k]) ? 0 : 1];
      } else {
        sub.textContent = diff.length ? 'Mixed dials' : 'Same dials';
      }
    }
    host.querySelectorAll('.dial[data-k]').forEach((node) => {
      const elDial = node as HTMLElement;
      elDial.classList.toggle(
        'diff',
        diff.some((d) => d.key === elDial.dataset.k),
      );
    });
    const hidden = diff.filter((d) => d.key !== S.view);
    host.querySelectorAll('.arr').forEach((node) => {
      const elArr = node as HTMLElement;
      elArr.classList.toggle('hint', hidden.length > 0);
      elArr.title = hidden.length
        ? `${hidden.map((d) => d.label).join(' and ')} also ${hidden.length > 1 ? 'differ' : 'differs'} — use the arrows to check`
        : elArr.dataset.nav === '1'
          ? 'Next dial'
          : 'Previous dial';
    });
  }

  function renderSlots(b: BatchId) {
    const el = $(`#slots${b}`);
    if (!el) return;
    const R = S.results[b];
    const G = groupsOf(b);
    let html = '';
    for (let i = 0; i < S.runs; i += 1) {
      const r = R[i];
      if (!r) {
        html += `<div class="slot wait"><span class="sn">${i + 1}</span><div class="st" style="color:var(--fa2)">${S.run[b] ? 'waiting…' : '—'}</div><div class="sm"></div></div>`;
        continue;
      }
      let body = '';
      let meta = '';
      let badge = '';
      if (r.status === 'error') body = `<div class="st err">${esc(r.error || 'Error')}</div>`;
      else if (r.status === 'running') {
        body = '<div class="st"><span class="dotsld"><i></i><i></i><i></i></span></div>';
      } else {
        body = `<div class="st" title="${esc(r.text || '')}">${esc(r.text || '') || '<span style="color:var(--fa)">(empty)</span>'}</div>`;
      }
      if (r.status === 'done') {
        meta = `<b title="Output tokens">${r.outTok ?? 0} tok</b>${r.stop === 'max_tokens' ? '<span class="capd">cap</span>' : ''} <span style="color:var(--fa2)">· ${((r.ms || 0) / 1000).toFixed(1)}s</span><br>${usd(r.cost || 0)}`;
        const c = GROUP[(G.idx[i] ?? 0) % GROUP.length];
        badge = `style="background:${c}2e;color:${c};border-color:${c}66" title="Same colour = identical answer"`;
      }
      html += `<div class="slot ${r.status === 'running' ? 'live' : ''}"><span class="sn" ${badge}>${i + 1}</span>${body}<div class="sm">${meta}</div></div>`;
    }
    el.innerHTML = html;
    const st = stale(b) && !S.run[b];
    el.classList.toggle('stale', st);
    const uq = $(`#uq${b}`);
    const done = R.filter((r) => r.status === 'done').length;
    if (uq) {
      const dots: string[] = [];
      for (let i = 0; i < S.runs; i += 1) {
        const g = G.idx[i];
        dots.push(
          g == null
            ? '<span class="d"></span>'
            : `<span class="d" style="background:${GROUP[g % GROUP.length]};border-color:${GROUP[g % GROUP.length]}"></span>`,
        );
      }
      uq.innerHTML = st
        ? '<span class="stl">dials changed · re-run</span>'
        : `<span class="ds" title="Same colour = identical answer">${dots.join('')}</span>${done ? `<span><b>${G.unique}</b> unique</span>` : ''}`;
    }
  }

  function renderRunBtn(b: BatchId) {
    const btn = $(`#run${b}`);
    if (!btn) return;
    const on = S.run[b];
    btn.className = `cta brun${on ? ' stop' : ''}`;
    btn.innerHTML = on
      ? `${IC.stop} Stop · ${S.prog[b]}/${S.runs}`
      : `${IC.play} Run Batch ${b} <span class="rx">${S.runs}×</span>`;
    const bp = $(`#bp${b}`);
    if (bp) bp.style.width = on ? `${(S.prog[b] / S.runs) * 100}%` : '0';
  }

  function renderBatch(b: BatchId) {
    const d = S[b];
    const list = viewList();
    if (!supported(S.view)) S.view = 'temp';
    const D = dialByKey[S.view];
    if (!D) return;
    const diff = diffDials();
    const df = diff.some((x) => x.key === D.key);
    const pos = list.findIndex((x) => x.key === D.key);
    const batch = $(`#batch${b}`);
    if (!batch) return;
    batch.innerHTML = `
      <div class="bh"><div><span class="bt">Batch ${b}</span><span class="bs" id="sub${b}"></span></div><div class="spread" id="uq${b}"></div></div>
      <div class="dcar">
        <button type="button" class="arr" data-nav="-1" title="Previous dial" ${busy() ? 'disabled' : ''}>${IC.left}</button>
        <div class="dial big ${df ? 'diff' : ''}" data-k="${D.key}">
          <div class="dl"><span>${D.label}</span><b id="v${b}${D.key}">${fmtDial(D, d[D.key])}</b></div>
          <input type="range" min="${D.min}" max="${maxFor(D)}" step="${D.step}" value="${d[D.key]}" data-b="${b}" data-k="${D.key}" ${busy() ? 'disabled' : ''}>
          <div class="dfoot">${
            hiddenByTemp(D.key)
              ? '<button type="button" class="fix" data-fix="temp1" title="Top-p and top-k only matter when there is randomness to trim">Temperature is too low to see this dial · set both to 1.0</button>'
              : `<span class="dh">${D.desc}</span>`
          }<span class="pos">${pos + 1} / ${list.length}</span></div>
        </div>
        <button type="button" class="arr" data-nav="1" title="Next dial" ${busy() ? 'disabled' : ''}>${IC.right}</button>
      </div>
      <div class="brunw"><button type="button" class="cta brun" id="run${b}" data-run="${b}"></button><div class="bprog"><i id="bp${b}"></i></div></div>
      <div class="slots" id="slots${b}"></div>`;
    renderSlots(b);
    renderRunBtn(b);
  }

  function renderCompare() {
    const a = stats('A');
    const b = stats('B');
    const n = Math.max(a?.n || 0, b?.n || 0, S.runs);
    const sA = stale('A');
    const sB = stale('B');
    const va = (f: (s: BatchStats) => number) => (a && !sA ? f(a) : null);
    const vb = (f: (s: BatchStats) => number) => (b && !sB ? f(b) : null);
    const card = (
      label: string,
      hint: string,
      x: number | null,
      y: number | null,
      fmt: (v: number) => string,
      max: number,
    ) => {
      const w = (v: number | null) => (v != null && max > 0 && v > 0 ? Math.max(4, (v / max) * 100) : 0);
      const row = (tag: string, v: number | null) =>
        `<div class="cr"><div class="crt"><span class="tg ${tag}">${tag}</span><span class="cv ${tag}">${v == null ? '—' : fmt(v)}</span></div><div class="track"><i class="${tag === 'A' ? 'fa' : 'fb'}" style="width:${w(v)}%"></i></div></div>`;
      return `<div class="cc" title="${hint}"><div class="kl">${label}</div>${row('A', x)}${row('B', y)}</div>`;
    };
    const mx = (x: number | null, y: number | null) => Math.max(x || 0, y || 0);
    const U: [number | null, number | null] = [va((s) => s.unique), vb((s) => s.unique)];
    const C: [number | null, number | null] = [va((s) => s.overlap), vb((s) => s.overlap)];
    const K: [number | null, number | null] = [va((s) => s.avgCost * 1000), vb((s) => s.avgCost * 1000)];
    const T: [number | null, number | null] = [va((s) => s.avgOut), vb((s) => s.avgOut)];
    const X: [number | null, number | null] = [va((s) => s.capHits), vb((s) => s.capHits)];
    const M: [number | null, number | null] = [va((s) => s.avgMs), vb((s) => s.avgMs)];
    const el = $('#compare');
    if (!el) return;
    el.innerHTML = `<div class="cgrid">
      ${card('Unique', 'How many different answers each batch gave', U[0], U[1], (v) => `${v}/${n}`, n)}
      ${card('Consistency', 'Average word overlap between runs', C[0], C[1], (v) => `${Math.round(v * 100)}%`, 1)}
      ${card('Cost / 1k runs', 'Actual cost of the runs, scaled to 1,000 runs (USD)', K[0], K[1], (v) => usd(v), mx(K[0], K[1]))}
      ${card('Tokens out', 'Average output length in tokens', T[0], T[1], (v) => v.toFixed(1), mx(T[0], T[1]))}
      ${card('Cut by cap', 'Answers stopped by the output cap', X[0], X[1], (v) => `${v}/${n}`, n)}
      ${card('Response time', 'Average seconds per answer — small differences are mostly network noise', M[0], M[1], (v) => `${(v / 1000).toFixed(2)}s`, mx(M[0], M[1]))}
    </div>`;
  }

  function renderLog() {
    const logN = $('#logN');
    const exportBtn = $('#exportBtn') as HTMLButtonElement | null;
    const log = $('#log');
    if (!logN || !log) return;
    logN.textContent = S.log.length ? String(S.log.length) : '';
    if (exportBtn) exportBtn.hidden = !S.log.length;
    if (!S.log.length) {
      log.innerHTML = '<div class="empty">Finished experiments appear here</div>';
      return;
    }
    log.innerHTML = S.log
      .slice()
      .reverse()
      .map((e) => {
        const D = dialByKey[e.test];
        const mixed = e.diff !== 1;
        return `<button type="button" class="lg ${S.active === e.id ? 'on' : ''}" data-log="${e.id}">
          <div class="l1"><span>#${e.id} ${e.diff === 0 ? 'Baseline' : mixed ? 'Mixed dials' : D?.label || e.test}</span><i>${e.time}</i></div>
          <div class="l2">${mixed || !D ? '' : `<span class="a">${fmtDial(D, e.A[e.test])}</span> → <span class="b">${fmtDial(D, e.B[e.test])}</span> · `}unique <span class="a">${e.a.unique}</span>/<span class="b">${e.b.unique}</span> · ${esc(models[e.prov]?.name || e.prov)}</div>
        </button>`;
      })
      .join('');
  }

  function renderGlobal() {
    const nRuns = $('#nRuns');
    if (nRuns) nRuns.textContent = String(S.runs);
    host.querySelectorAll('[data-step],#resetBtn,#baseBtn').forEach((node) => {
      (node as HTMLButtonElement).disabled = busy();
    });
    const provSel = $('#provSel') as HTMLSelectElement | null;
    const prompt = $('#prompt') as HTMLTextAreaElement | null;
    if (provSel) provSel.disabled = busy();
    if (prompt) prompt.disabled = busy();
    syncUndoUi();
  }

  function renderAll() {
    renderBatch('A');
    renderBatch('B');
    renderFair();
    renderGlobal();
    renderCompare();
    renderLog();
  }

  function setView(k: DialKey) {
    S.view = k;
    renderBatch('A');
    renderBatch('B');
    renderFair();
    save();
  }

  function syncSlider(b: BatchId, k: DialKey) {
    const el = host.querySelector(`input[data-b="${b}"][data-k="${k}"]`) as HTMLInputElement | null;
    if (el) el.value = String(S[b][k]);
    const lab = $(`#v${b}${k}`);
    if (lab && dialByKey[k]) lab.textContent = fmtDial(dialByKey[k], S[b][k]);
  }

  function clearResults() {
    S.results = { A: [], B: [] };
    S.active = null;
  }

  function setProvider(k: string) {
    if (k === S.prov) return;
    pushUndo();
    S.prov = k;
    syncVer();
    const tempMax = P()?.tempMax ?? 2;
    for (const b of ['A', 'B'] as BatchId[]) {
      S[b] = normalizeDials(S[b], tempMax);
      if (!P()?.topk) S[b].topk = 0;
    }
    clearResults();
    renderAll();
  }

  function save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          prompt: ($('#prompt') as HTMLTextAreaElement | null)?.value || '',
          prov: S.prov,
          ver: S.ver,
          view: S.view,
          runs: S.runs,
          A: S.A,
          B: S.B,
          log: S.log.slice(-30),
        }),
      );
    } catch {
      /* ignore quota */
    }
  }

  function load(): boolean {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const d = JSON.parse(raw) as Partial<LabState> & { prompt?: string };
      if (d.prov && models[d.prov]) S.prov = d.prov;
      syncVer();
      const tempMax = P()?.tempMax ?? 2;
      if (d.A && d.B) {
        S.A = normalizeDials(d.A, tempMax);
        S.B = normalizeDials(d.B, tempMax);
        if (!P()?.topk) {
          S.A.topk = 0;
          S.B.topk = 0;
        }
      }
      if (d.view && dialByKey[d.view]) S.view = d.view;
      if (typeof d.runs === 'number' && Number.isFinite(d.runs)) {
        S.runs = Math.min(10, Math.max(2, Math.round(d.runs)));
      }
      S.log = Array.isArray(d.log) ? d.log : [];
      const prompt = $('#prompt') as HTMLTextAreaElement | null;
      const provSel = $('#provSel') as HTMLSelectElement | null;
      if (prompt) prompt.value = d.prompt || catalog?.defaults.prompt || '';
      if (provSel) provSel.value = S.prov;
      return true;
    } catch {
      return false;
    }
  }

  function pushLog(a: BatchStats, b: BatchStats) {
    const id = S.log.length + 1;
    const t = new Date();
    const dd = diffDials();
    S.log.push({
      id,
      time: t.toTimeString().slice(0, 5),
      test: dd[0]?.key || 'temp',
      diff: dd.length,
      A: normalizeDials(S.A, P()?.tempMax ?? 2),
      B: normalizeDials(S.B, P()?.tempMax ?? 2),
      prompt: getPrompt(),
      prov: S.prov,
      model: S.ver || P()?.id || S.prov,
      results: JSON.parse(JSON.stringify(S.results)) as { A: RunRow[]; B: RunRow[] },
      a,
      b,
      runs: S.runs,
    });
    S.active = id;
    save();
    if (S.log.length >= 1) onComplete?.();
  }

  function restoreLog(id: number) {
    const e = S.log.find((x) => x.id === id);
    if (!e) return;
    S.prov = e.prov;
    const provSel = $('#provSel') as HTMLSelectElement | null;
    if (provSel) provSel.value = e.prov;
    const tempMax = P()?.tempMax ?? 2;
    S.A = normalizeDials(e.A, tempMax);
    S.B = normalizeDials(e.B, tempMax);
    S.runs = Math.min(10, Math.max(2, e.runs || 5));
    S.results = JSON.parse(JSON.stringify(e.results)) as { A: RunRow[]; B: RunRow[] };
    S.active = id;
    const prompt = $('#prompt') as HTMLTextAreaElement | null;
    if (prompt) prompt.value = e.prompt;
    renderAll();
  }

  function exportCSV() {
    if (!S.log.length) {
      toast('Finish an experiment first');
      return;
    }
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows: string[][] = [
      [
        'experiment',
        'time',
        'type',
        'dials_different',
        'model',
        'prompt',
        'batch',
        'run',
        'temperature',
        'top_k',
        'top_p',
        'output_cap',
        'input_tokens',
        'output_tokens',
        'cut_by_cap',
        'seconds',
        'cost_usd',
        'output',
        'error',
      ],
    ];
    for (const e of S.log) {
      for (const b of ['A', 'B'] as BatchId[]) {
        for (const r of e.results[b]) {
          rows.push([
            String(e.id),
            e.time,
            e.diff === 0 ? 'Baseline' : e.diff === 1 ? dialByKey[e.test]?.label || e.test : 'Mixed',
            String(e.diff),
            e.model,
            e.prompt,
            b,
            String(r.i),
            String(r.dials.temp),
            models[e.prov]?.topk ? String(r.dials.topk) : 'n/a',
            String(r.dials.topp),
            String(r.dials.cap),
            String(r.inTok ?? ''),
            String(r.outTok ?? ''),
            r.stop === 'max_tokens' ? 'yes' : 'no',
            r.ms != null ? (r.ms / 1000).toFixed(2) : '',
            r.cost != null ? r.cost.toFixed(8) : '',
            r.text ?? '',
            r.error ?? '',
          ]);
        }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }),
    );
    a.download = 'exercise8_results.csv';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function callModel(run: RunRow, signal: AbortSignal): Promise<DialRunResult> {
    return runDialGeneration(
      sessionId,
      projectId,
      {
        prompt: run.prompt,
        model: S.ver || P()?.defaultVersion || S.prov,
        dials: run.dials,
        index: run.i - 1,
      },
      signal,
    );
  }

  async function runBatch(b: BatchId) {
    if (S.run[b]) {
      S.stop[b] = true;
      controllers[b]?.abort();
      return;
    }
    if (!getPrompt()) {
      toast('Type a prompt first');
      ($('#prompt') as HTMLTextAreaElement | null)?.focus();
      return;
    }
    S.run[b] = true;
    S.stop[b] = false;
    S.results[b] = [];
    S.prog[b] = 0;
    S.active = null;
    const ac = new AbortController();
    controllers[b] = ac;
    renderAll();
    let fatal: string | null = null;
    for (let i = 0; i < S.runs; i += 1) {
      if (S.stop[b] || aborted) break;
      const run: RunRow = {
        i: i + 1,
        status: 'running',
        dials: normalizeDials(S[b], P()?.tempMax ?? 2),
        prov: S.prov,
        model: S.ver || P()?.id || S.prov,
        prompt: getPrompt(),
      };
      S.results[b].push(run);
      renderSlots(b);
      try {
        const out = await callModel(run, ac.signal);
        run.text = out.text;
        run.inTok = out.inTok;
        run.outTok = out.outTok;
        run.stop = out.stop;
        run.ms = out.ms;
        run.cost = out.cost;
        run.simulated = out.simulated;
        run.status = 'done';
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        const abortedRun = name === 'AbortError' || S.stop[b] || aborted;
        if (abortedRun) {
          run.status = 'error';
          run.error = 'Stopped';
          break;
        }
        run.status = 'error';
        run.error = err instanceof Error ? err.message : 'Request failed';
        if (i === 0) {
          fatal = run.error;
          S.stop[b] = true;
        }
      }
      S.prog[b] = i + 1;
      renderSlots(b);
      renderRunBtn(b);
      renderCompare();
    }
    const stopped = S.stop[b];
    S.run[b] = false;
    controllers[b] = null;
    if (fatal) toast(esc(fatal));
    else if (stopped) toast(`Batch ${b} stopped`);
    const a = stats('A');
    const bb = stats('B');
    if (!fatal && !stopped && a && bb && !busy() && !stale('A') && !stale('B')) pushLog(a, bb);
    const me = stats(b);
    if (!fatal && me && me.avgOut > 60 && me.unique === me.n) {
      toast('Long answers are almost always unique — ask for one line, or read Consistency instead');
    }
    if (!fatal && !stopped && S.results[b].some((r) => r.status === 'done' && r.simulated)) {
      toast('Classroom simulator used for one or more runs');
    }
    renderAll();
  }

  function openExplain() {
    const modal = $('#explainModal');
    const body = $('#explainBody');
    if (!modal || !body || !catalog) return;
    const ex = catalog.explain;
    body.innerHTML = `
      <p class="note" style="margin-top:0">${esc(ex.temp || '')}</p>
      <p class="note">${esc(ex.topk || '')}</p>
      <p class="note">${esc(ex.topp || '')}</p>
      <p class="note">${esc(ex.cap || '')}</p>
      <div class="take" style="margin-top:12px"><b>Factual:</b> ${esc(ex.factual || '')}</div>
      <div class="take" style="margin-top:8px"><b>Creative:</b> ${esc(ex.creative || '')}</div>
      <p class="note">Tip: use <b>Baseline</b> so both batches match, run them, then change only one dial.</p>`;
    modal.hidden = false;
    modal.classList.add('open');
  }

  function closeExplain() {
    const modal = $('#explainModal');
    if (!modal) return;
    modal.hidden = true;
    modal.classList.remove('open');
  }

  const onInput = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.matches('input[type=range][data-k]')) {
      const input = t as HTMLInputElement;
      const b = input.dataset.b as BatchId;
      const k = input.dataset.k as DialKey;
      if (!b || !k || !dialByKey[k]) return;
      const v = parseDialValue(k, input.value);
      S[b][k] = v;
      // Keep the slider thumb and label in sync with the coerced value
      if (String(v) !== input.value) input.value = String(v);
      syncSlider(b, k);
      renderFair();
      renderCompare();
      renderSlots('A');
      renderSlots('B');
      save();
      if (k === 'temp' && (S.view === 'topp' || S.view === 'topk')) renderAll();
    } else if (t.id === 'prompt') {
      if (!promptUndoPushed && !busy()) {
        pushUndo();
        promptUndoPushed = true;
      }
      renderCompare();
      renderSlots('A');
      renderSlots('B');
      save();
    }
  };

  const onChange = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.id === 'provSel') {
      setProvider((t as HTMLSelectElement).value);
      save();
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal') || target.closest('[data-close]')) {
      closeExplain();
      return;
    }
    // Clicks inside the dialog content should not fall through to lab controls
    if (target.closest('#explainModal .mbox')) return;

    const btn = target.closest('button');
    if (!btn || !host.contains(btn)) return;
    closeExplain();
    if (btn.dataset.nav) {
      if (busy()) return;
      const L = viewList();
      const i = L.findIndex((x) => x.key === S.view);
      const next = L[(i + Number(btn.dataset.nav) + L.length) % L.length];
      if (next) setView(next.key);
    } else if (btn.id === 'undoBtn') {
      undoLast();
    } else if (btn.dataset.step) {
      if (busy()) return;
      pushUndo();
      S.runs = Math.min(10, Math.max(2, S.runs + Number(btn.dataset.step)));
      clearResults();
      renderAll();
      save();
    } else if (btn.dataset.log) {
      if (!busy()) restoreLog(Number(btn.dataset.log));
    } else if (btn.dataset.run) {
      void runBatch(btn.dataset.run as BatchId);
    } else if (btn.id === 'resetBtn') {
      if (!busy()) {
        pushUndo();
        applyPreset(S.view);
        clearResults();
        renderAll();
        save();
      }
    } else if (btn.id === 'baseBtn') {
      if (!busy()) {
        pushUndo();
        S.B = normalizeDials(S.A, P()?.tempMax ?? 2);
        clearResults();
        renderAll();
        save();
        toast('Baseline: Batch B now matches Batch A — run both');
      }
    } else if (btn.dataset.fix === 'temp1') {
      if (!busy()) {
        pushUndo();
        const v = Math.min(1, P()?.tempMax ?? 1);
        S.A.temp = v;
        S.B.temp = v;
        clearResults();
        renderAll();
        save();
      }
    } else if (btn.id === 'exportBtn') {
      exportCSV();
    } else if (btn.id === 'explainBtn') {
      openExplain();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeExplain();
      return;
    }
    // Ignore shortcuts that belong to another exercise / page region
    if (!host.isConnected) return;
    const active = document.activeElement as HTMLElement | null;
    const focusInside = !active || active === document.body || host.contains(active);
    if (!focusInside) return;
    const inField = Boolean(active && /INPUT|TEXTAREA|SELECT/.test(active.tagName));
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inField && !busy()) {
      const L = viewList();
      const i = L.findIndex((x) => x.key === S.view);
      const next = L[(i + (e.key === 'ArrowRight' ? 1 : -1) + L.length) % L.length];
      if (next) setView(next.key);
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy()) {
      e.preventDefault();
      void (async () => {
        await runBatch('A');
        if (stats('A') && !S.stop.A) await runBatch('B');
      })();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !busy()) {
      const inTextarea = active?.tagName === 'TEXTAREA';
      if (!inTextarea) {
        e.preventDefault();
        undoLast();
      }
    }
  };

  const onPromptBlur = () => {
    promptUndoPushed = false;
  };

  const onPointerDown = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.matches('input[type=range][data-k]') && !busy()) pushUndo();
  };

  async function boot() {
    host.classList.add('is-booting');
    try {
      catalog = await loadDialsCatalog(sessionId, projectId);
    } catch (err) {
      host.classList.remove('is-booting');
      host.innerHTML = `<div class="boot" style="display:grid"><span class="boot-t">${esc(err instanceof Error ? err.message : 'Could not load Exercise 7.')}</span></div>`;
      return;
    }
    if (aborted) return;

    models = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
    dialList = catalog.dials;
    dialByKey = Object.fromEntries(dialList.map((d) => [d.key, d]));
    S.prov = catalog.defaults.model;
    S.ver = defaultVersionOf(models[S.prov]);
    S.view = catalog.defaults.view;
    S.runs = catalog.defaults.runs;
    S.inrPerUsd = catalog.defaults.inrPerUsd;
    S.A = normalizeDials(catalog.defaults.A, models[catalog.defaults.model]?.tempMax ?? 2);
    S.B = normalizeDials(catalog.defaults.B, models[catalog.defaults.model]?.tempMax ?? 2);

    host.innerHTML = TEMPLATE;

    const resetBtn = $('#resetBtn');
    const baseBtn = $('#baseBtn');
    if (resetBtn) resetBtn.innerHTML = `${IC.reset}<span>Reset</span>`;
    if (baseBtn) baseBtn.innerHTML = `${IC.base}<span>Baseline</span>`;
    const provSel = $('#provSel') as HTMLSelectElement | null;
    if (provSel) {
      provSel.innerHTML = catalog.models
        .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`)
        .join('');
    }
    applyPreset('temp');
    const prompt = $('#prompt') as HTMLTextAreaElement | null;
    if (prompt) prompt.value = catalog.defaults.prompt;
    load();
    if (provSel) provSel.value = S.prov;
    syncVer();

    host.addEventListener('input', onInput);
    host.addEventListener('change', onChange);
    host.addEventListener('click', onClick);
    host.addEventListener('pointerdown', onPointerDown, true);
    $('#prompt')?.addEventListener('blur', onPromptBlur);
    document.addEventListener('keydown', onKey);
    unbindFs = bindHostFullscreen(host, $('#fsBtn'));
    unbindTheme = bindExerciseTheme(host);

    renderAll();
    host.classList.remove('is-booting');
  }

  void boot();

  return () => {
    aborted = true;
    controllers.A?.abort();
    controllers.B?.abort();
    host.removeEventListener('input', onInput);
    host.removeEventListener('change', onChange);
    host.removeEventListener('click', onClick);
    host.removeEventListener('pointerdown', onPointerDown, true);
    $('#prompt')?.removeEventListener('blur', onPromptBlur);
    document.removeEventListener('keydown', onKey);
    undoStack.clear();
    unbindFs?.();
    unbindTheme?.();
  };
}
