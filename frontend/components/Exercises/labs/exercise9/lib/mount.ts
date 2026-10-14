import {
  loadPersonaCatalog,
  runPersonaGeneration,
  type PersonaCatalog,
  type PersonaCondition,
  type PersonaExample,
  type PersonaModel,
  type PersonaType,
} from './api';
import { bindHostFullscreen } from '../../../fullscreen';
import { defaultVersionOf } from '../../../modelVersions';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { createUndoStack, syncUndoButton, UNDO_BUTTON_HTML } from '../../../undoHistory';
import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

type CondKey = 'zero' | 'one' | 'few';

interface TestRow {
  id: number;
  type: string;
  q: string;
}

interface CellResult {
  status: 'running' | 'done' | 'error';
  q: string;
  labels: string[];
  prov: string;
  model: string;
  text?: string;
  inTok?: number;
  outTok?: number;
  stop?: string;
  ms?: number;
  cost?: number;
  held?: boolean | null;
  fmtTotal?: number;
  fmtHits?: number;
  error?: string;
  simulated?: boolean;
}

interface LogEntry {
  id: number;
  time: string;
  prov: string;
  model: string;
  temp: number;
  topp: number;
  cap: number;
  sys: string;
  examples: PersonaExample[];
  tests: TestRow[];
  results: Record<number, Partial<Record<CondKey, CellResult>>>;
  labels: string[];
  nEx: number;
}

interface LabState {
  prov: string;
  ver: string;
  temp: number;
  topp: number;
  cap: number;
  sys: string;
  examples: PersonaExample[];
  tests: TestRow[];
  results: Record<number, Partial<Record<CondKey, CellResult>>>;
  running: boolean;
  stop: boolean;
  done: number;
  total: number;
  log: LogEntry[];
  active: number | null;
  exIdx: number;
  inrPerUsd: number;
  markedComplete: boolean;
}

const IC = {
  gear: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
};

const TEMPLATE = `
<header>
  ${exerciseBrandHtml(8, 'Exercise - 8 : Write a Persona &amp; Prompt It')}
  <div class="hr">
    <label class="msel" title="The same model answers every cell, so only the prompt changes">
      <span>Models</span>
      <select id="provSel"></select>
    </label>
    <button type="button" class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
    ${UNDO_BUTTON_HTML}
    <button type="button" class="icon" id="settingsBtn" title="Model parameters: temperature, top-p, output cap"></button>
    ${THEME_TOGGLE_HTML}
  </div>
</header>
<main>
  <aside class="col">
    <div class="card">
      <div class="chead"><span class="n">1</span><div class="ct"><b>Persona</b><span>The system prompt</span></div>
        <div class="cacts"><button type="button" class="mini" data-act="template" title="Insert a blank structure to fill in">Template</button><button type="button" class="mini li" data-act="samplePersona" title="Load the materials-science persona">Example</button></div>
      </div>
      <div class="help">Who the assistant is, what it helps with, and what it refuses. Sent on every call.</div>
      <textarea id="sys" spellcheck="false" placeholder="You are … a materials selection advisor for engineering students.&#10;&#10;You help with: …&#10;You do not help with: …&#10;&#10;Rules:&#10;- …&#10;&#10;If asked something outside your scope: …"></textarea>
      <button type="button" class="cta runfull" id="runBtn"></button>
    </div>
    <div class="card">
      <div class="chead"><span class="n">2</span><div class="ct"><b>Examples</b><span>Question + ideal answer</span></div>
        <div class="cacts"><button type="button" class="plus" data-act="addEx" id="addExBtn" title="Add an example" aria-label="Add an example"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button></div>
      </div>
      <div class="help">One-shot uses example 1. Few-shot uses all of them.</div>
      <div id="exList"></div>
    </div>
  </aside>
  <section class="col">
    <div class="card tcard">
      <div class="matrix" id="matrix"></div>
      <div class="legend">
        <span><span class="fm f-all">4/5</span>Format: labels from the examples that the answer used</span>
        <span><span class="hb ok on">Held</span><span class="hb no on">Broke</span>Your call: did it stay in character?</span>
        <span>Click any answer to see it in full, with exactly what the model received</span>
      </div>
    </div>
  </section>
</main>
<div class="modal" id="cellModal"><div class="mbox" id="cellBox"></div></div>
<div class="modal" id="prevModal"><div class="mbox" id="prevBox"></div></div>
<div class="modal" id="setModal"><div class="mbox" style="width:min(440px,96vw)">
  <div class="mt"><span>Model parameters</span><button type="button" class="x" data-close>×</button></div>
  <div class="prm"><div class="prh"><span>Temperature</span><b id="vTemp"></b></div>
    <input type="range" id="temp" min="0" max="2" step="0.05"><div class="prd">Low = focused and repeatable. High = varied and creative.</div></div>
  <div class="prm"><div class="prh"><span>Top-p</span><b id="vTopp"></b></div>
    <input type="range" id="topp" min="0.05" max="1" step="0.05"><div class="prd">Keeps only the most likely words until their odds add up to p. 1 = off.</div></div>
  <div class="prm"><div class="prh"><span>Output cap</span><b id="vCap"></b></div>
    <input type="range" id="cap" min="50" max="1000" step="10"><div class="prd">The longest answer allowed, in tokens. Also caps the cost.</div></div>
  <div class="note">These stay the same for all three columns, so the only thing that changes between columns is the examples.</div>
  <div class="btns" style="margin-top:14px"><button type="button" class="mini" data-act="resetParams" style="padding:6px 12px">Reset to defaults</button></div>
</div></div>
<div id="toasts"></div>
`;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c,
  );
}

function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function estTok(s: string): number {
  return Math.ceil((s || '').length / 4);
}

function words(s: string): number {
  return ((s || '').trim().match(/\S+/g) || []).length;
}

function mdLite(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>');
}

function labelsOf(text: string): string[] {
  const out: string[] = [];
  (text || '').split('\n').forEach((l) => {
    const m = l.replace(/^[\s>*_#-]+/, '').match(/^([A-Za-z][A-Za-z0-9 /()&'\-]{0,32}?)\s*[*_]*\s*:/);
    if (m) out.push(m[1].trim());
  });
  return [...new Set(out)];
}

export function mountExercise9(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  let catalog: PersonaCatalog | null = null;
  let models: Record<string, PersonaModel> = {};
  let CONDS: PersonaCondition[] = [];
  let COND: Record<string, PersonaCondition> = {};
  let TYPES: Record<string, PersonaType> = {};
  let SAMPLE_SYS = '';
  let TEMPLATE_TEXT = '';
  let UID = 1;
  let aborted = false;
  let unbindFs: (() => void) | undefined;
  let unbindTheme: (() => void) | undefined;
  let PREV: CondKey = 'zero';
  let OPEN: { tid: number; k: CondKey } | null = null;
  let controllers: AbortController[] = [];

  type UndoSnapshot = Pick<
    LabState,
    'prov' | 'ver' | 'temp' | 'topp' | 'cap' | 'sys' | 'examples' | 'tests' | 'results'
  > & { exIdx: number };

  const undoStack = createUndoStack<UndoSnapshot>({ max: 40 });
  let sysUndoPushed = false;
  let exFieldUndoPushed = false;
  let testUndoPushed = false;

  const S: LabState = {
    prov: 'gemini-38-flash',
    ver: '',
    temp: 0.3,
    topp: 1,
    cap: 300,
    sys: '',
    examples: [{ q: '', a: '' }],
    tests: [],
    results: {},
    running: false,
    stop: false,
    done: 0,
    total: 0,
    log: [],
    active: null,
    exIdx: 0,
    inrPerUsd: 88,
    markedComplete: false,
  };

  host.classList.add('is-booting');

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T | null;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    [...host.querySelectorAll(sel)] as T[];
  const P = () => models[S.prov] || Object.values(models)[0];
  const syncVer = () => {
    S.ver = defaultVersionOf(P());
  };
  const usd = (c: number) => `$${(c < 0.01 ? c.toFixed(6) : c.toFixed(4))}`;

  const captureUndoSnapshot = (): UndoSnapshot => ({
    prov: S.prov,
    ver: S.ver,
    temp: S.temp,
    topp: S.topp,
    cap: S.cap,
    sys: S.sys,
    examples: JSON.parse(JSON.stringify(S.examples)) as PersonaExample[],
    tests: JSON.parse(JSON.stringify(S.tests)) as TestRow[],
    results: JSON.parse(JSON.stringify(S.results)) as Record<number, Partial<Record<CondKey, CellResult>>>,
    exIdx: S.exIdx,
  });

  const syncUndoUi = () => {
    syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undoStack.canUndo && !S.running);
  };

  const pushUndo = () => {
    if (S.running) return;
    undoStack.push(captureUndoSnapshot());
    syncUndoUi();
  };

  const restoreUndoSnapshot = (snap: UndoSnapshot) => {
    S.prov = snap.prov;
    S.temp = snap.temp;
    S.topp = snap.topp;
    S.cap = snap.cap;
    S.sys = snap.sys;
    S.examples = JSON.parse(JSON.stringify(snap.examples)) as PersonaExample[];
    S.tests = JSON.parse(JSON.stringify(snap.tests)) as TestRow[];
    S.results = JSON.parse(JSON.stringify(snap.results)) as Record<
      number,
      Partial<Record<CondKey, CellResult>>
    >;
    S.exIdx = snap.exIdx;
    const sel = $('#provSel') as HTMLSelectElement | null;
    if (sel) sel.value = snap.prov;
    syncVer();
    const sys = $('#sys') as HTMLTextAreaElement | null;
    if (sys) sys.value = snap.sys;
  };

  const undoLast = () => {
    if (S.running) return;
    const snap = undoStack.undo();
    if (!snap) return;
    restoreUndoSnapshot(snap);
    renderAll();
    syncUndoUi();
  };

  function toast(msg: string) {
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    box.appendChild(t);
    window.setTimeout(() => t.remove(), 3600);
  }

  function showBootError(msg: string) {
    host.innerHTML = `<div class="boot" style="display:grid" role="alert"><span class="boot-t">${esc(msg)}</span></div>`;
    host.classList.remove('is-booting');
  }

  function testsAreBlank() {
    return S.tests.every((t) => !t.q.trim());
  }

  function loadSampleTests() {
    if (!catalog?.sample.tests?.length) return;
    S.tests = catalog.sample.tests.map((t) => ({
      id: UID++,
      type: TYPES[t.type] ? t.type : 'task',
      q: t.q,
    }));
    S.results = {};
  }

  const usableEx = (exs = S.examples) => exs.filter((e) => e.q.trim() && e.a.trim());
  function examplesFor(k: CondKey, exs = S.examples) {
    const u = usableEx(exs);
    if (k === 'zero') return [];
    if (k === 'one') return u.slice(0, 1);
    return u;
  }
  const available = (k: CondKey, exs = S.examples) => usableEx(exs).length >= (COND[k]?.need ?? 0);

  function formatLabels(exs = S.examples): string[] {
    const u = usableEx(exs);
    if (!u.length) return [];
    const sets = u.map((e) => labelsOf(e.a).map((x) => x.toLowerCase()));
    return labelsOf(u[0].a).filter((l) => sets.every((s) => s.includes(l.toLowerCase())));
  }

  function formatHits(text: string, labels: string[]) {
    return labels.map((l) => ({
      l,
      ok: new RegExp(`(^|\\n)[\\s>*_#-]*${reEsc(l)}\\s*[*_]*\\s*:`, 'i').test(text || ''),
    }));
  }

  function buildTurns(k: CondKey, q: string, sys = S.sys, exs = S.examples) {
    const turns: { role: string; text: string; ex?: boolean; fin?: boolean }[] = [];
    examplesFor(k, exs).forEach((e) => {
      turns.push({ role: 'user', text: e.q, ex: true });
      turns.push({ role: 'assistant', text: e.a, ex: true });
    });
    turns.push({ role: 'user', text: q, fin: true });
    return { system: sys.trim(), turns };
  }

  const inTokEst = (k: CondKey) =>
    estTok(S.sys) + examplesFor(k).reduce((a, e) => a + estTok(e.q) + estTok(e.a) + 8, 0);

  function stats(k: CondKey) {
    const cells = S.tests.map((t) => S.results[t.id]?.[k]).filter((c): c is CellResult => !!c && c.status === 'done');
    if (!cells.length) return null;
    const n = cells.length;
    const held = cells.filter((c) => c.held === true).length;
    const broke = cells.filter((c) => c.held === false).length;
    const f = cells.filter((c) => (c.fmtTotal || 0) > 0);
    return {
      n,
      held,
      broke,
      judged: held + broke,
      fmt: f.length ? f.reduce((a, c) => a + (c.fmtHits || 0) / (c.fmtTotal || 1), 0) / f.length : null,
      inTok: cells.reduce((a, c) => a + (c.inTok || 0), 0) / n,
      outTok: cells.reduce((a, c) => a + (c.outTok || 0), 0) / n,
      words: cells.reduce((a, c) => a + words(c.text || ''), 0) / n,
      cost: cells.reduce((a, c) => a + (c.cost || 0), 0) / n,
      ms: cells.reduce((a, c) => a + (c.ms || 0), 0) / n,
    };
  }

  function maybeComplete() {
    if (S.markedComplete || !onComplete) return;
    const judged = S.tests.reduce((n, t) => {
      return (
        n +
        CONDS.reduce((m, c) => {
          const cell = S.results[t.id]?.[c.k];
          return m + (cell && cell.status === 'done' && cell.held != null ? 1 : 0);
        }, 0)
      );
    }, 0);
    if (judged >= 3) {
      S.markedComplete = true;
      onComplete();
    }
  }

  function renderExamples(dir?: 'next' | 'prev') {
    S.exIdx = Math.max(0, Math.min(S.exIdx || 0, S.examples.length - 1));
    const i = S.exIdx;
    const e = S.examples[i];
    const n = S.examples.length;
    const list = $('#exList');
    if (!list) return;
    list.innerHTML = `
      <div class="ex ${dir ? `slide-${dir}` : ''}">
        <div class="exh"><b>Example ${i + 1}</b><span class="of">of ${n}</span>
          <button type="button" class="x" data-act="delEx" data-i="${i}" title="Remove this example" ${S.running ? 'disabled' : ''}>×</button></div>
        <label>User asks</label><textarea class="exq" data-i="${i}" placeholder="A question like the ones your users ask">${esc(e.q)}</textarea>
        <label>Ideal answer</label><textarea class="exa" data-i="${i}" spellcheck="false" placeholder="Label: value&#10;Label: value&#10;…the exact shape you want back">${esc(e.a)}</textarea>
      </div>
      <div class="exnav">
        <button type="button" class="arrow" data-act="exPrev" title="Previous example" ${i === 0 ? 'disabled' : ''}>${IC.left}</button>
        <div class="dots" id="exDots"></div>
        <button type="button" class="arrow" data-act="exNext" title="Next example" ${i === n - 1 ? 'disabled' : ''}>${IC.right}</button>
      </div>`;
    renderExDots();
    const add = $('#addExBtn') as HTMLButtonElement | null;
    if (add) add.disabled = S.examples.length >= 5 || S.running;
  }

  function renderExDots() {
    const d = $('#exDots');
    if (!d) return;
    d.innerHTML =
      S.examples
        .map(
          (x, j) =>
            `<button type="button" class="dot ${j === S.exIdx ? 'on' : ''} ${x.q.trim() && x.a.trim() ? 'ok' : ''}" data-exgo="${j}" title="Example ${j + 1}${x.q.trim() && x.a.trim() ? '' : ' (not filled in yet)'}"></button>`,
        )
        .join('') + `<span class="dcount">${S.exIdx + 1} / ${S.examples.length}</span>`;
  }

  function renderRun() {
    const avail = CONDS.filter((c) => available(c.k));
    const calls = S.tests.filter((t) => t.q.trim()).length * avail.length;
    const btn = $('#runBtn');
    if (!btn) return;
    btn.className = `cta runfull${S.running ? ' stop' : ''}`;
    btn.innerHTML = S.running
      ? `${IC.stop} Stop · ${S.done}/${S.total}`
      : calls
        ? `${IC.play} Run ${calls} call${calls === 1 ? '' : 's'}`
        : `${IC.play} Run`;
    btn.title = 'Ctrl+Enter';
    const sel = $('#provSel') as HTMLSelectElement | null;
    const sys = $('#sys') as HTMLTextAreaElement | null;
    if (sel) sel.disabled = S.running;
    if (sys) sys.disabled = S.running;
    $$('#exList textarea, .tq, .tsel, [data-act=addTest], [data-act=samplePersona], [data-act=template]').forEach(
      (x) => {
        (x as HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement).disabled = S.running;
      },
    );
    syncUndoUi();
  }

  function condHead(c: PersonaCondition) {
    const st = stats(c.k);
    const ok = available(c.k);
    const nEx = examplesFor(c.k).length;
    const tag = c.k === 'zero' ? 'persona only' : ok ? `+${nEx} example${nEx > 1 ? 's' : ''}` : `needs ${c.need}`;
    const pct = st?.fmt != null ? Math.round(st.fmt * 100) : null;
    return `<div class="cond ${ok ? '' : 'na'}" style="--c:${c.col}">
      <div class="cn"><i></i><b>${c.name}</b><span class="ctag">${tag}</span></div>
      <div class="big">
        <div title="Answers marked Held, out of those judged"><span>Held</span><b>${st && st.judged ? `${st.held}<small>/${st.judged}</small>` : '–'}</b><div class="bar"><i style="width:${st && st.judged ? (st.held / st.judged) * 100 : 0}%"></i></div></div>
        <div title="Share of the examples' labels that appeared in the answers"><span>Format</span><b>${pct == null ? '–' : `${pct}<small>%</small>`}</b><div class="bar"><i style="width:${pct ?? 0}%"></i></div></div>
      </div>
      <div class="sm"><span title="Input tokens per call">${st ? `<b>${Math.round(st.inTok)}</b>` : `≈<b>${ok ? inTokEst(c.k) : '–'}</b>`} tok in</span><span title="Cost of 1,000 calls (USD)"><b>${st ? usd(st.cost * 1000) : '–'}</b> /1k</span><span title="Average response time"><b>${st ? `${(st.ms / 1000).toFixed(1)}s` : '–'}</b></span></div>
    </div>`;
  }

  function exampleFor(t: TestRow) {
    const ex = TYPES[t.type]?.ex || [];
    const nth = S.tests.filter((x) => x.type === t.type).indexOf(t);
    return `e.g. ${ex[Math.max(0, nth) % Math.max(1, ex.length)] || 'Write a test question'}`;
  }

  function qHead() {
    const n = S.tests.length;
    const cnt = (k: string) => S.tests.filter((t) => t.type === k).length;
    const parts = Object.entries(TYPES)
      .filter(([k]) => cnt(k))
      .map(([k, v]) => `<i style="--c:${v.col}">${cnt(k)} ${v.label.toLowerCase()}</i>`)
      .join('');
    return `<div class="qhead"><div><b>Test questions <span class="qn">${n}</span></b><div class="qchips">${parts}</div><div class="qguide">Write your own questions. Mix all three types; the grey text shows an example of each.</div></div>
      <div class="qacts"><button type="button" class="mini" data-act="addTest" id="addTestBtn">+ Add</button><button type="button" class="mini" data-act="preview" title="See the exact messages sent for each column">What it receives</button><button type="button" class="mini li" data-act="sampleTests" title="Load sample on-task, off-topic and pressure questions">Sample Qs</button></div></div>`;
  }

  function cellHTML(t: TestRow, c: PersonaCondition) {
    if (!available(c.k) && !S.results[t.id]?.[c.k]) {
      return `<div class="cell na" style="--c:${c.col}" data-cell="${t.id}|${c.k}">Add ${c.need} example${c.need > 1 ? 's' : ''}<br>to run ${c.name.toLowerCase()}</div>`;
    }
    const r = S.results[t.id]?.[c.k];
    if (!r) {
      return `<div class="cell" style="--c:${c.col}" data-cell="${t.id}|${c.k}"><div class="wait">${S.running ? 'waiting…' : '–'}</div></div>`;
    }
    if (r.status === 'running') {
      return `<div class="cell run" style="--c:${c.col}" data-cell="${t.id}|${c.k}"><span class="dotsld"><i></i><i></i><i></i></span></div>`;
    }
    if (r.status === 'error') {
      return `<div class="cell" style="--c:${c.col}" data-cell="${t.id}|${c.k}"><div class="err">${esc(r.error)}</div>
        <button type="button" class="mini rr" data-act="rerun" data-t="${t.id}" data-c="${c.k}" title="Run this cell again" style="opacity:1">${IC.redo}</button></div>`;
    }
    const fm = r.fmtTotal
      ? `<span class="fm ${r.fmtHits === r.fmtTotal ? 'f-all' : r.fmtHits ? 'f-some' : 'f-none'}" title="Format labels used">${r.fmtHits}/${r.fmtTotal}</span>`
      : '';
    return `<div class="cell done ${r.held === true ? 'held' : r.held === false ? 'broke' : ''}" style="--c:${c.col}" data-cell="${t.id}|${c.k}" data-open="${t.id}|${c.k}">
      <div class="ans">${mdLite(r.text || '') || '<span class="wait">(empty answer)</span>'}</div>
      <div class="cf">${fm}<span title="Input → output tokens">${r.inTok}→${r.outTok}</span><span class="grow"></span>
        <button type="button" class="hb ok ${r.held === true ? 'on' : ''}" data-held="1" data-t="${t.id}" data-c="${c.k}">Held</button>
        <button type="button" class="hb no ${r.held === false ? 'on' : ''}" data-held="0" data-t="${t.id}" data-c="${c.k}">Broke</button></div>
      ${S.running ? '' : `<button type="button" class="mini rr" data-act="rerun" data-t="${t.id}" data-c="${c.k}" title="Run this cell again">${IC.redo}</button>`}
    </div>`;
  }

  function renderMatrix() {
    const matrix = $('#matrix');
    if (!matrix) return;
    let h = `<div class="mh">${qHead()}</div>${CONDS.map((c) => `<div class="mh">${condHead(c)}</div>`).join('')}`;
    S.tests.forEach((t, i) => {
      const ty = TYPES[t.type] || { label: t.type, col: '#e3dbeb', tip: '', ex: [] };
      h += `<div class="q">
        <div class="qt"><span class="num">${i + 1}</span>
          <select class="tsel" data-t="${t.id}" style="--c:${ty.col}" title="${esc(ty.tip)}">${Object.entries(TYPES)
            .map(([k, v]) => `<option value="${k}" ${k === t.type ? 'selected' : ''}>${v.label}</option>`)
            .join('')}</select>
          <button type="button" class="x" data-act="delTest" data-t="${t.id}" title="Remove question" ${S.running || S.tests.length <= 1 ? 'disabled' : ''}>×</button></div>
        <textarea class="tq" data-t="${t.id}" rows="2" placeholder="${esc(exampleFor(t))}">${esc(t.q)}</textarea>
      </div>`;
      CONDS.forEach((c) => {
        h += cellHTML(t, c);
      });
    });
    matrix.innerHTML = h;
    $$('.tq').forEach(autosize);
    const add = $('#addTestBtn') as HTMLButtonElement | null;
    if (add) add.disabled = S.tests.length >= 10 || S.running;
  }

  function renderCell(tid: number, k: CondKey) {
    const t = S.tests.find((x) => x.id === tid);
    const cond = COND[k];
    if (!t || !cond) return;
    const el = $(`[data-cell="${tid}|${k}"]`);
    if (el) el.outerHTML = cellHTML(t, cond);
    $$('.mh')
      .slice(1)
      .forEach((m, i) => {
        if (CONDS[i]) m.innerHTML = condHead(CONDS[i]);
      });
  }

  function renderQHead() {
    const m = $('.mh');
    if (m) m.innerHTML = qHead();
    const add = $('#addTestBtn') as HTMLButtonElement | null;
    if (add) add.disabled = S.tests.length >= 10 || S.running;
  }

  function renderAll() {
    renderExamples();
    renderMatrix();
    renderRun();
  }

  function autosize(el: HTMLElement) {
    const ta = el as HTMLTextAreaElement;
    ta.style.height = 'auto';
    let hgt = ta.scrollHeight;
    if (!ta.value) {
      const v = ta.value;
      ta.value = ta.placeholder;
      hgt = ta.scrollHeight;
      ta.value = v;
    }
    ta.style.height = `${Math.max(44, hgt)}px`;
  }

  function stackHTML(k: CondKey, q: string, sys = S.sys, exs = S.examples) {
    const { system, turns } = buildTurns(k, q, sys, exs);
    const R: Record<string, string> = { system: '#9333EA', user: '#B90ABD', assistant: '#dbfe87' };
    let total = 0;
    let h = '';
    if (system) {
      total += estTok(system);
      h += `<div class="msg" style="--r:${R.system}"><div class="msgh">SYSTEM <span>your persona</span><em>≈${estTok(system)} tok</em></div><div class="msgb">${esc(system)}</div></div>`;
    } else {
      h += `<div class="msg" style="--r:#555"><div class="msgh" style="color:var(--fa)">NO SYSTEM MESSAGE <span>the persona box is empty</span></div></div>`;
    }
    let exn = 0;
    turns.forEach((t) => {
      total += estTok(t.text);
      if (t.ex && t.role === 'user') exn += 1;
      const tag = t.ex
        ? `example ${exn} · ${t.role === 'user' ? 'question' : 'ideal answer'}`
        : 'the real test question';
      h += `<div class="msg ${t.ex ? 'exm' : 'fin'}" style="--r:${R[t.role]}"><div class="msgh">${t.role.toUpperCase()} <span>${tag}</span><em>≈${estTok(t.text)} tok</em></div><div class="msgb">${esc(t.text)}</div></div>`;
    });
    return `<div class="stack">${h}</div><div class="tot">≈<b>${total}</b> tokens sent on this call · the model then writes the next <b style="color:var(--li)">ASSISTANT</b> turn</div>`;
  }

  function openPreview(k?: CondKey) {
    PREV = k || PREV;
    const q = (S.tests.find((t) => t.q.trim()) || { q: '(your test question)' }).q;
    const box = $('#prevBox');
    if (!box) return;
    box.innerHTML = `<div class="mt">What the model receives<button type="button" class="x" data-close>×</button></div>
      <div class="help" style="margin-bottom:12px">The model only sees this stack of messages. Examples are fake earlier turns: the model thinks it already answered them this way.</div>
      <div class="tabs">${CONDS.map(
        (c) =>
          `<button type="button" class="${PREV === c.k ? 'on' : ''}" style="--c:${c.col}" data-prev="${c.k}" ${available(c.k) ? '' : 'disabled'}><i></i>${c.name}</button>`,
      ).join('')}</div>
      ${stackHTML(PREV, q)}`;
    $('#prevModal')?.classList.add('open');
  }

  function openCell(tid: number, k: CondKey) {
    OPEN = { tid, k };
    const t = S.tests.find((x) => x.id === tid);
    const r = S.results[tid]?.[k];
    const c = COND[k];
    if (!t || !r || !c) return;
    const idx = S.tests.indexOf(t);
    const ty = TYPES[t.type] || { label: t.type, col: '#e3dbeb' };
    const hits = r.fmtTotal ? formatHits(r.text || '', r.labels || []) : [];
    const box = $('#cellBox');
    if (!box) return;
    box.innerHTML = `
      <div class="mt"><span class="tag" style="--c:${c.col}">${c.name}</span>Test ${idx + 1}<span class="tag" style="--c:${ty.col}">${ty.label}</span><button type="button" class="x" data-close>×</button></div>
      <div class="sec">Answer<span class="grow"></span></div>
      <div class="full">${mdLite(r.text || '') || '(empty)'}</div>
      ${hits.length ? `<div class="chips" style="margin-top:9px">${hits.map((x) => `<span class="chip ${x.ok ? '' : 'miss'}">${x.ok ? '✓' : '✗'} ${esc(x.l)}</span>`).join('')}</div>` : ''}
      <div class="mm"><span>tokens in <b>${r.inTok}</b></span><span>out <b>${r.outTok}</b>${r.stop === 'max_tokens' ? ' <span style="color:var(--warn)">(hit cap)</span>' : ''}</span><span>words <b>${words(r.text || '')}</b></span><span><b>${((r.ms || 0) / 1000).toFixed(2)}s</b></span><span><b>${usd(r.cost || 0)}</b></span>
        <span style="flex:1"></span>
        <button type="button" class="hb ok ${r.held === true ? 'on' : ''}" data-held="1" data-t="${tid}" data-c="${k}" style="padding:4px 12px;font-size:12px">Held</button>
        <button type="button" class="hb no ${r.held === false ? 'on' : ''}" data-held="0" data-t="${tid}" data-c="${k}" style="padding:4px 12px;font-size:12px">Broke</button></div>
      <div class="sec">What the model received<span class="grow"></span></div>
      ${stackHTML(k, r.q, S.sys, S.examples)}`;
    $('#cellModal')?.classList.add('open');
  }

  function fillSettings() {
    const t = $('#temp') as HTMLInputElement | null;
    const meta = P();
    if (!t || !meta) return;
    t.max = String(meta.tempMax);
    t.value = String(S.temp);
    ($('#topp') as HTMLInputElement).value = String(S.topp);
    ($('#cap') as HTMLInputElement).value = String(S.cap);
    const vTemp = $('#vTemp');
    const vTopp = $('#vTopp');
    const vCap = $('#vCap');
    if (vTemp) {
      vTemp.textContent =
        S.temp.toFixed(2) + (meta.tempMax < 2 ? `  (max ${meta.tempMax} for ${meta.name})` : '');
    }
    if (vTopp) vTopp.textContent = S.topp >= 0.999 ? 'off' : S.topp.toFixed(2);
    if (vCap) vCap.textContent = `${S.cap} tok`;
  }

  function openSettings() {
    if (S.running) return;
    fillSettings();
    $('#setModal')?.classList.add('open');
  }

  function closeModals() {
    $$('.modal').forEach((m) => m.classList.remove('open'));
    OPEN = null;
  }

  async function runCell(tid: number, k: CondKey, ctx: { sys: string; examples: PersonaExample[]; labels: string[] }) {
    const t = S.tests.find((x) => x.id === tid);
    if (!t) return null;
    const cell: CellResult = {
      status: 'running',
      q: t.q.trim(),
      labels: ctx.labels,
      prov: S.prov,
      model: S.ver || P()?.id || S.prov,
    };
    (S.results[tid] ||= {})[k] = cell;
    renderCell(tid, k);
    const ac = new AbortController();
    controllers.push(ac);
    try {
      const res = await runPersonaGeneration(
        sessionId,
        projectId,
        {
          system: ctx.sys,
          examples: ctx.examples,
          question: t.q.trim(),
          condition: k,
          model: S.ver || P()?.defaultVersion || S.prov,
          temp: S.temp,
          topp: S.topp,
          cap: S.cap,
        },
        ac.signal,
      );
      cell.text = res.text;
      cell.inTok = res.inTok;
      cell.outTok = res.outTok;
      cell.stop = res.stop;
      cell.ms = res.ms;
      cell.cost = res.cost;
      cell.simulated = res.simulated;
      cell.labels = res.labels?.length ? res.labels : ctx.labels;
      cell.status = 'done';
      cell.held = null;
      const h = formatHits(cell.text || '', cell.labels);
      cell.fmtTotal = h.length;
      cell.fmtHits = h.filter((x) => x.ok).length;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const stopped =
        ac.signal.aborted ||
        err.name === 'AbortError' ||
        /aborted|abort/i.test(err.message);
      cell.status = 'error';
      cell.error = stopped ? 'Stopped' : err.message || 'Request failed';
    }
    renderCell(tid, k);
    return cell;
  }

  async function runAll() {
    if (S.running) {
      S.stop = true;
      controllers.forEach((c) => c.abort());
      return;
    }
    if (!S.sys.trim()) {
      toast('Write a persona first, or click <b>Example</b> to load one');
      $('#sys')?.focus();
      return;
    }
    const tests = S.tests.filter((t) => t.q.trim());
    if (!tests.length) {
      toast('Type at least one test question in the table first');
      $('.tq')?.focus();
      return;
    }
    const conds = CONDS.filter((c) => available(c.k));
    if (!conds.length) {
      toast('Nothing to run yet — check your persona and examples');
      return;
    }
    const ctx = {
      sys: S.sys.trim(),
      examples: JSON.parse(JSON.stringify(S.examples)) as PersonaExample[],
      labels: formatLabels(),
    };
    const entry: LogEntry = {
      id: S.log.length + 1,
      time: new Date().toTimeString().slice(0, 5),
      prov: S.prov,
      model: S.ver || P()?.id || S.prov,
      temp: S.temp,
      topp: S.topp,
      cap: S.cap,
      sys: ctx.sys,
      examples: ctx.examples,
      tests: JSON.parse(JSON.stringify(S.tests)) as TestRow[],
      results: {},
      labels: ctx.labels,
      nEx: usableEx().length,
    };
    S.results = entry.results;
    S.active = entry.id;
    const jobs: [number, CondKey][] = [];
    tests.forEach((t) => conds.forEach((c) => jobs.push([t.id, c.k])));
    S.running = true;
    S.stop = false;
    S.done = 0;
    S.total = jobs.length;
    controllers = [];
    renderAll();
    closeModals();
    let ok = 0;
    let fatal: string | null = null;
    const worker = async () => {
      while (jobs.length && !S.stop && !aborted) {
        const next = jobs.shift();
        if (!next) break;
        const [tid, k] = next;
        const cell = await runCell(tid, k, ctx);
        if (cell?.status === 'done') ok += 1;
        else if (ok === 0 && !fatal && cell?.error && cell.error !== 'Stopped') {
          fatal = cell.error;
          S.stop = true;
        }
        S.done += 1;
        renderRun();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    S.running = false;
    if (ok) S.log.push(entry);
    else S.active = null;
    if (fatal) toast(esc(fatal));
    else if (S.stop) toast('Stopped');
    else toast(`Run #${entry.id} done. Now mark each answer <b>Held</b> or <b>Broke</b>.`);
    renderAll();
  }

  async function rerun(tid: number, k: CondKey) {
    if (S.running) return;
    const ctx = {
      sys: S.sys.trim(),
      examples: S.examples,
      labels: formatLabels(),
    };
    const cell = await runCell(tid, k, ctx);
    if (cell?.status === 'error') toast(esc(cell.error || 'Error'));
  }

  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal') || target.closest('[data-close]')) {
      closeModals();
      return;
    }
    const hb = target.closest('[data-held]') as HTMLElement | null;
    if (hb) {
      e.stopPropagation();
      const r = S.results[+hb.dataset.t!]?.[hb.dataset.c as CondKey];
      if (!r) return;
      pushUndo();
      const v = hb.dataset.held === '1';
      r.held = r.held === v ? null : v;
      renderCell(+hb.dataset.t!, hb.dataset.c as CondKey);
      if (OPEN) openCell(OPEN.tid, OPEN.k);
      maybeComplete();
      return;
    }
    const act = target.closest('[data-act]') as HTMLElement | null;
    if (act) {
      const a = act.dataset.act;
      if (a === 'template') {
        if (!S.sys.trim() || window.confirm('Replace your persona with the blank template?')) {
          pushUndo();
          S.sys = TEMPLATE_TEXT;
          const sys = $('#sys') as HTMLTextAreaElement | null;
          if (sys) sys.value = TEMPLATE_TEXT;
          renderRun();
          sys?.focus();
        }
      } else if (a === 'samplePersona') {
        if (!S.sys.trim() || window.confirm('Replace your persona with the materials-science example?')) {
          pushUndo();
          S.sys = SAMPLE_SYS;
          const sys = $('#sys') as HTMLTextAreaElement | null;
          if (sys) sys.value = SAMPLE_SYS;
          if (catalog?.sample.examples?.length) {
            S.examples = catalog.sample.examples.map((ex) => ({ q: ex.q, a: ex.a }));
            S.exIdx = 0;
          }
          // First-time path: also fill the empty test table so Run is one click away.
          if (testsAreBlank()) loadSampleTests();
          renderAll();
          toast('Example persona loaded. Review the questions, then Run.');
        }
      } else if (a === 'sampleTests') {
        if (catalog?.sample.tests?.length) {
          pushUndo();
          loadSampleTests();
          renderAll();
          toast('Sample test questions loaded');
        }
      } else if (a === 'addEx') {
        pushUndo();
        S.examples.push({ q: '', a: '' });
        S.exIdx = S.examples.length - 1;
        renderExamples('next');
        ($('.exq') as HTMLTextAreaElement | null)?.focus();
      } else if (a === 'exPrev') {
        if (S.exIdx > 0) {
          S.exIdx -= 1;
          renderExamples('prev');
        }
      } else if (a === 'exNext') {
        if (S.exIdx < S.examples.length - 1) {
          S.exIdx += 1;
          renderExamples('next');
        }
      } else if (a === 'delEx') {
        pushUndo();
        S.examples.splice(+act.dataset.i!, 1);
        if (!S.examples.length) S.examples.push({ q: '', a: '' });
        S.exIdx = Math.min(S.exIdx, S.examples.length - 1);
        renderExamples();
        renderMatrix();
        renderRun();
      } else if (a === 'addTest') {
        pushUndo();
        const t = { id: UID++, type: 'task', q: '' };
        S.tests.push(t);
        renderMatrix();
        renderRun();
        ($(`.tq[data-t="${t.id}"]`) as HTMLTextAreaElement | null)?.focus();
      } else if (a === 'delTest') {
        pushUndo();
        S.tests = S.tests.filter((x) => x.id !== +act.dataset.t!);
        renderMatrix();
        renderRun();
      } else if (a === 'rerun') {
        e.stopPropagation();
        void rerun(+act.dataset.t!, act.dataset.c as CondKey);
      } else if (a === 'preview') {
        openPreview();
      } else if (a === 'resetParams') {
        pushUndo();
        S.temp = 0.3;
        S.topp = 1;
        S.cap = 300;
        fillSettings();
        renderRun();
      }
      return;
    }
    const dg = target.closest('[data-exgo]') as HTMLElement | null;
    if (dg) {
      const j = +dg.dataset.exgo!;
      if (j !== S.exIdx) {
        const dir = j > S.exIdx ? 'next' : 'prev';
        S.exIdx = j;
        renderExamples(dir);
      }
      return;
    }
    const pv = target.closest('[data-prev]') as HTMLElement | null;
    if (pv) {
      openPreview(pv.dataset.prev as CondKey);
      return;
    }
    const op = target.closest('[data-open]') as HTMLElement | null;
    if (op) {
      const [tid, k] = op.dataset.open!.split('|');
      openCell(+tid, k as CondKey);
      return;
    }
    const b = target.closest('button');
    if (!b) return;
    if (b.id === 'runBtn') void runAll();
    else if (b.id === 'settingsBtn') openSettings();
    else if (b.id === 'undoBtn') undoLast();
  }

  function onInput(e: Event) {
    const t = e.target as HTMLElement;
    if (t.id === 'sys') {
      if (!sysUndoPushed && !S.running) {
        pushUndo();
        sysUndoPushed = true;
      }
      S.sys = (t as HTMLTextAreaElement).value;
      renderRun();
      $$('.mh')
        .slice(1)
        .forEach((m, i) => {
          m.innerHTML = condHead(CONDS[i]);
        });
    } else if (t.classList.contains('exq') || t.classList.contains('exa')) {
      if (!exFieldUndoPushed && !S.running) {
        pushUndo();
        exFieldUndoPushed = true;
      }
      const i = +(t as HTMLTextAreaElement).dataset.i!;
      const before = CONDS.map((c) => available(c.k)).join();
      S.examples[i][t.classList.contains('exq') ? 'q' : 'a'] = (t as HTMLTextAreaElement).value;
      renderExDots();
      renderRun();
      if (before !== CONDS.map((c) => available(c.k)).join()) renderMatrix();
      else
        $$('.mh')
          .slice(1)
          .forEach((m, i2) => {
            m.innerHTML = condHead(CONDS[i2]);
          });
    } else if (t.classList.contains('tq')) {
      if (!testUndoPushed && !S.running) {
        pushUndo();
        testUndoPushed = true;
      }
      const row = S.tests.find((x) => x.id === +(t as HTMLTextAreaElement).dataset.t!);
      if (row) row.q = (t as HTMLTextAreaElement).value;
      autosize(t);
      renderRun();
    } else if (t.id === 'temp') {
      S.temp = Math.min(P()?.tempMax ?? 2, parseFloat((t as HTMLInputElement).value));
      fillSettings();
      renderRun();
    } else if (t.id === 'topp') {
      S.topp = parseFloat((t as HTMLInputElement).value);
      fillSettings();
      renderRun();
    } else if (t.id === 'cap') {
      S.cap = parseInt((t as HTMLInputElement).value, 10);
      fillSettings();
      renderRun();
    }
  }

  function onChange(e: Event) {
    const t = e.target as HTMLElement;
    if (t.id === 'provSel') {
      pushUndo();
      S.prov = (t as HTMLSelectElement).value;
      syncVer();
      S.temp = Math.min(S.temp, P()?.tempMax ?? 2);
      renderRun();
    } else if (t.classList.contains('tsel')) {
      const row = S.tests.find((x) => x.id === +(t as HTMLSelectElement).dataset.t!);
      if (!row) return;
      pushUndo();
      row.type = (t as HTMLSelectElement).value;
      (t as HTMLElement).style.setProperty('--c', TYPES[row.type]?.col || '#e3dbeb');
      renderQHead();
      $$('.tq').forEach((x) => {
        const tt = S.tests.find((y) => y.id === +(x as HTMLTextAreaElement).dataset.t!);
        if (tt) {
          (x as HTMLTextAreaElement).placeholder = exampleFor(tt);
          autosize(x);
        }
      });
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeModals();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !host.querySelector('.modal.open')) {
      e.preventDefault();
      void runAll();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !S.running) {
      const active = document.activeElement as HTMLElement | null;
      const inTextarea = active?.tagName === 'TEXTAREA';
      if (!inTextarea) {
        e.preventDefault();
        undoLast();
      }
    }
  }

  const onFieldBlur = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.id === 'sys') sysUndoPushed = false;
    else if (t.classList.contains('exq') || t.classList.contains('exa')) exFieldUndoPushed = false;
    else if (t.classList.contains('tq')) testUndoPushed = false;
  };

  const onPointerDown = (e: Event) => {
    const t = e.target as HTMLElement;
    if (S.running) return;
    if (t.id === 'temp' || t.id === 'topp' || t.id === 'cap') pushUndo();
  };

  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('blur', onFieldBlur, true);
  host.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKey);

  void (async () => {
    try {
      catalog = await loadPersonaCatalog(sessionId, projectId);
      if (aborted) return;
      models = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
      CONDS = catalog.conditions;
      COND = Object.fromEntries(CONDS.map((c) => [c.k, c]));
      TYPES = catalog.types;
      SAMPLE_SYS = catalog.sample.sys;
      TEMPLATE_TEXT = catalog.sample.template;
      S.prov = catalog.defaults.model;
      S.ver = defaultVersionOf(models[S.prov]);
      S.temp = catalog.defaults.temp;
      S.topp = catalog.defaults.topp;
      S.cap = catalog.defaults.cap;
      S.inrPerUsd = catalog.defaults.inrPerUsd;
      S.tests = (catalog.defaults.tests || []).map((t) => ({
        id: UID++,
        type: TYPES[t.type] ? t.type : 'task',
        q: t.q || '',
      }));
      if (!S.tests.length) {
        S.tests = [
          { id: UID++, type: 'task', q: '' },
          { id: UID++, type: 'off', q: '' },
          { id: UID++, type: 'press', q: '' },
        ];
      }

      // Keep the React boot spinner until catalog is ready, then mount the lab DOM.
      host.innerHTML = TEMPLATE;
      unbindFs?.();
      unbindTheme?.();
      unbindFs = bindHostFullscreen(host, $('#fsBtn'));
      unbindTheme = bindExerciseTheme(host);
      const sel = $('#provSel') as HTMLSelectElement | null;
      if (sel) {
        sel.innerHTML = catalog.models.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
        sel.value = S.prov;
      }
      syncVer();
      const settingsBtn = $('#settingsBtn');
      if (settingsBtn) settingsBtn.innerHTML = IC.gear;
      const sys = $('#sys') as HTMLTextAreaElement | null;
      if (sys) sys.value = S.sys;
      renderAll();
      host.classList.remove('is-booting');
    } catch (err) {
      if (aborted) return;
      showBootError(err instanceof Error ? err.message : 'Failed to load persona lab');
    }
  })();

  return () => {
    aborted = true;
    S.stop = true;
    controllers.forEach((c) => c.abort());
    host.removeEventListener('click', onClick);
    host.removeEventListener('input', onInput);
    host.removeEventListener('change', onChange);
    host.removeEventListener('blur', onFieldBlur, true);
    host.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKey);
    undoStack.clear();
    unbindFs?.();
    unbindTheme?.();
    host.innerHTML = '';
  };
}
