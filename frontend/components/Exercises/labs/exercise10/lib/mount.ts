import {
  loadCompareCatalog,
  runCompareGeneration,
  type CompareCatalog,
  type CompareModel,
  type CompareTurn,
} from './api';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { defaultVersionOf } from '../../../modelVersions';
import { cloneState, createUndoStack, syncUndoButton, UNDO_BUTTON_HTML } from '../../../undoHistory';
import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

const LANE_COLS = ['#9333EA', '#dbfe87', '#B90ABD', '#EC4899'];
const LETTERS = 'ABCD';

interface Lane {
  id: number;
  prov: string;
  ver: string;
}

interface Reply {
  status: 'running' | 'done' | 'error';
  prov: string;
  model: string;
  text?: string;
  inTok?: number;
  outTok?: number;
  stop?: string;
  ms?: number;
  cost?: number;
  costInr?: number;
  simulated?: boolean;
  error?: string;
  note?: string;
  t0?: number;
  open?: boolean;
}

interface Turn {
  id: number;
  q: string;
  sys: string;
  time: string;
  replies: Record<number, Reply>;
  best: number | null;
  guess: Record<number, string | undefined>;
  revealed: boolean;
  options: string[];
  nonce: number;
}

interface LabState {
  lanes: Lane[];
  turns: Turn[];
  running: boolean;
  ctrls: Set<AbortController>;
  blind: boolean;
  personaOpen: boolean;
  temp: number;
  topp: number;
  cap: number;
  inrPerUsd: number;
  minLanes: number;
  maxLanes: number;
  markedComplete: boolean;
  revealedBlindOnce: boolean;
}

const IC = {
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  fsOn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fsOff: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10 10 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 4.1-5.1M9.9 5.2A9 9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-2.2 3.2M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>',
  again: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
};

const TEMPLATE = `
<header>
  ${exerciseBrandHtml(9, 'Exercise - 9 : Same Prompt, Different Models')}
  ${THEME_TOGGLE_HTML}
  ${UNDO_BUTTON_HTML}
  <button type="button" class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
  <button type="button" class="icon" id="settingsBtn" title="Model parameters: temperature, top-p, output cap" aria-label="Model parameters"></button>
</header>
<main>
  <section class="composer" id="composer">
    <div class="pane persona">
      <div class="chead"><span class="n">1</span><div class="ct"><b>Persona</b><span>The system prompt you wrote in Exercise 8</span></div>
        <div class="psum" id="psum"></div>
        <button type="button" class="mini li" data-act="samplePersona" title="Load the materials-science persona">Example</button>
        <button type="button" class="mini" data-act="togglePersona" id="pToggle"></button></div>
      <textarea id="sys" spellcheck="false" placeholder="Paste your persona from Exercise 8.&#10;&#10;You are … a materials selection advisor for engineering students.&#10;You help with: …&#10;You do not help with: …&#10;&#10;Rules:&#10;- …"></textarea>
    </div>
    <div class="pane msgp">
      <div class="chead"><span class="n">2</span><div class="ct"><b>Message</b><span>Every model below gets this, with the same persona</span></div></div>
      <textarea id="msg"></textarea>
      <button type="button" class="send" id="sendBtn"></button>
    </div>
  </section>
  <section class="arena">
    <div class="atop">
      <div class="ct"><b>Models <span class="mode" id="modeTag" hidden>Blind round</span></b><span id="arenaSub"></span></div>
      <div class="aacts">
        <span class="scorechip" id="scoreChip" hidden></span>
        <button type="button" class="mini" data-act="blind" id="blindBtn" title="Hide which model wrote each answer and shuffle their positions"></button>
        <button type="button" class="mini" data-act="shuffle" id="shuffleBtn" title="Shuffle the order of the model columns"></button>
        <button type="button" class="mini" data-act="newChat" id="newChatBtn" title="Clear the conversation in every column">New chat</button>
        <button type="button" class="plus" data-act="addLane" id="addLaneBtn" title="Add a model column" aria-label="Add a model column"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>
      </div>
    </div>
    <div class="scroll" id="scroll">
      <div class="lhwrap"><div class="lanes" id="lanesHead"></div></div>
      <div id="turns" style="display:flex;flex-direction:column;gap:18px"></div>
    </div>
  </section>
</main>
<div class="modal" id="setModal"><div class="mbox">
  <div class="mt"><span>Model parameters</span><button type="button" class="x" data-close>×</button></div>
  <div class="prm"><div class="prh"><span>Temperature</span><b id="vTemp"></b></div>
    <input type="range" id="temp" min="0" max="2" step="0.05"><div class="prd">Low = focused and repeatable. High = varied and creative.</div></div>
  <div class="prm"><div class="prh"><span>Top-p</span><b id="vTopp"></b></div>
    <input type="range" id="topp" min="0.05" max="1" step="0.05"><div class="prd">Keeps only the most likely words until their odds add up to p. 1 = off.</div></div>
  <div class="prm"><div class="prh"><span>Output cap</span><b id="vCap"></b></div>
    <input type="range" id="cap" min="50" max="1000" step="10"><div class="prd">The longest answer allowed, in tokens. Also caps the cost.</div></div>
  <div class="note">Every model gets these same settings. Claude accepts temperatures up to 1, so higher values are capped at 1 for Claude.</div>
  <div style="margin-top:14px"><button type="button" class="mini" data-act="resetParams" style="padding:6px 12px">Reset to defaults</button></div>
</div></div>
<div id="toasts"></div>
<div class="sr" aria-live="polite" id="live"></div>
`;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c,
  );
}

function words(s: string): number {
  return ((s || '').trim().match(/\S+/g) || []).length;
}

function md(s: string): string {
  return esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/^(\s*)[-*•]\s+/gm, '$1• ');
}

function shortModel(m: string): string {
  return m.replace(/^.*\//, '').replace(/-\d{8}$/, '');
}

export function mountExercise10(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  let catalog: CompareCatalog | null = null;
  let models: Record<string, CompareModel> = {};
  let SAMPLE_SYS = '';
  let MSG_EXAMPLES: string[] = [];
  let DEFAULTS = { temp: 0.3, topp: 1, cap: 300 };
  let UID = 1;
  let aborted = false;
  let unbindTheme: (() => void) | undefined;
  let phIdx = 0;

  const S: LabState = {
    lanes: [],
    turns: [],
    running: false,
    ctrls: new Set(),
    blind: false,
    personaOpen: true,
    temp: DEFAULTS.temp,
    topp: DEFAULTS.topp,
    cap: DEFAULTS.cap,
    inrPerUsd: 88,
    minLanes: 2,
    maxLanes: 4,
    markedComplete: false,
    revealedBlindOnce: false,
  };

  type UndoSnap = {
    lanes: Lane[];
    turns: Turn[];
    blind: boolean;
    temp: number;
    topp: number;
    cap: number;
    sys: string;
    msg: string;
    personaOpen: boolean;
    uid: number;
  };

  const undo = createUndoStack<UndoSnap>({ max: 40 });

  function snapshotUndo(): UndoSnap {
    const sysEl = $('#sys') as HTMLTextAreaElement | null;
    const msgEl = $('#msg') as HTMLTextAreaElement | null;
    return {
      lanes: S.lanes.map((l) => ({ ...l })),
      turns: cloneState(S.turns),
      blind: S.blind,
      temp: S.temp,
      topp: S.topp,
      cap: S.cap,
      sys: sysEl?.value ?? '',
      msg: msgEl?.value ?? '',
      personaOpen: S.personaOpen,
      uid: UID,
    };
  }

  function restoreUndo(s: UndoSnap) {
    S.lanes = s.lanes.map((l) => ({ ...l }));
    S.turns = cloneState(s.turns);
    S.blind = s.blind;
    S.temp = s.temp;
    S.topp = s.topp;
    S.cap = s.cap;
    S.personaOpen = s.personaOpen;
    UID = s.uid;
    const sysEl = $('#sys') as HTMLTextAreaElement | null;
    if (sysEl) sysEl.value = s.sys;
    const msgEl = $('#msg') as HTMLTextAreaElement | null;
    if (msgEl) msgEl.value = s.msg;
    renderAll();
  }

  function pushUndo() {
    if (S.running) return;
    undo.push(snapshotUndo());
    syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undo.canUndo);
  }

  function performUndo() {
    if (S.running || !undo.canUndo) return;
    const prev = undo.undo();
    if (prev) restoreUndo(prev);
    syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undo.canUndo);
  }

  function syncUndoUi() {
    syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undo.canUndo && !S.running);
  }

  host.classList.add('is-booting');

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T | null;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...host.querySelectorAll(sel)] as T[];

  const P = (id: string) => models[id] || Object.values(models)[0];
  const usd = (c: number) => `$${(c < 0.01 ? c.toFixed(6) : c < 1 ? c.toFixed(4) : c.toFixed(2))}`;
  const usdDisplay = (r: Reply) => usd(r.cost ?? 0);

  function toast(msg: string) {
    const box = $('#toasts');
    if (!box) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    box.appendChild(t);
    window.setTimeout(() => t.remove(), 3600);
  }

  function announce(msg: string) {
    const live = $('#live');
    if (live) live.textContent = msg;
  }

  function showBootError(msg: string) {
    host.innerHTML = `<div class="boot" style="display:grid" role="alert"><span class="boot-t">${esc(msg)}</span></div>`;
    host.classList.remove('is-booting');
  }

  function addLane(prov: string) {
    S.lanes.push({ id: UID++, prov, ver: defaultVersionOf(models[prov]) });
  }

  function letter(l: Lane): string {
    return LETTERS[Math.max(0, S.lanes.indexOf(l))] || '?';
  }

  function colOf(l: Lane): string {
    return LANE_COLS[Math.max(0, S.lanes.indexOf(l))] || LANE_COLS[0];
  }

  function hiddenIn(turn: Turn): boolean {
    return S.blind && !turn.revealed;
  }

  function isLong(t: string): boolean {
    return (t || '').length > 720 || (t || '').split('\n').length > 12;
  }

  function doneLanes(turn: Turn): Lane[] {
    return S.lanes.filter((l) => turn.replies[l.id]?.status === 'done');
  }

  function turnScore(turn: Turn): { right: number; total: number } {
    const ls = doneLanes(turn).filter((l) => turn.guess?.[l.id]);
    return {
      right: ls.filter((l) => turn.guess[l.id] === turn.replies[l.id].prov).length,
      total: ls.length,
    };
  }

  function historyFor(l: Lane, turnIndex: number): CompareTurn[] {
    const out: CompareTurn[] = [];
    S.turns.slice(0, turnIndex).forEach((t) => {
      const r = t.replies[l.id];
      if (r && r.status === 'done') {
        out.push({ role: 'user', text: t.q });
        out.push({ role: 'assistant', text: r.text || '' });
      }
    });
    out.push({ role: 'user', text: S.turns[turnIndex].q });
    return out;
  }

  function hasFullRound(): boolean {
    return S.turns.some((t) =>
      S.lanes.every((l) => t.replies[l.id]?.status === 'done'),
    );
  }

  function maybeComplete() {
    if (S.markedComplete || !onComplete) return;
    if (!hasFullRound()) return;
    const markedBest = S.turns.some((t) => t.best != null);
    if (markedBest || S.revealedBlindOnce) {
      S.markedComplete = true;
      onComplete();
    }
  }

  function laneStats(l: Lane) {
    const rs = S.turns.map((t) => t.replies[l.id]).filter((r): r is Reply => !!r && r.status === 'done');
    if (!rs.length) return null;
    return {
      n: rs.length,
      words: rs.reduce((a, r) => a + words(r.text || ''), 0) / rs.length,
      ms: rs.reduce((a, r) => a + (r.ms || 0), 0) / rs.length,
      cost: rs.reduce((a, r) => a + (r.cost || 0), 0),
      best: S.turns.filter((t) => t.best === l.id).length,
    };
  }

  function renderComposer() {
    const c = $('#composer');
    const sysEl = $('#sys') as HTMLTextAreaElement | null;
    const sys = sysEl?.value.trim() || '';
    if (c) c.classList.toggle('collapsed', !S.personaOpen);
    const toggle = $('#pToggle');
    if (toggle) {
      toggle.textContent = S.personaOpen ? 'Collapse' : 'Edit';
      (toggle as HTMLButtonElement).disabled = !sys && S.personaOpen;
    }
    const first = sys.split('\n').find((l) => l.trim()) || '';
    const psum = $('#psum');
    if (psum) {
      psum.innerHTML = sys
        ? `${esc(first)} <i>· ${words(sys)} words</i>`
        : '<i>No persona yet</i>';
    }
  }

  function renderSend() {
    const n = S.lanes.length;
    const btn = $('#sendBtn');
    if (!btn) return;
    btn.className = `send${S.running ? ' stop' : ''}`;
    btn.innerHTML = S.running
      ? `${IC.stop} Stop`
      : `${IC.send} Send to ${n} model${n === 1 ? '' : 's'} <kbd>Enter</kbd>`;
    btn.title = S.running ? 'Stop waiting for answers' : 'Enter to send · Shift+Enter for a new line';
    const sys = $('#sys') as HTMLTextAreaElement | null;
    if (sys) sys.disabled = S.running;
    const newChat = $('#newChatBtn') as HTMLButtonElement | null;
    if (newChat) newChat.disabled = S.running || !S.turns.length;
    const addLane = $('#addLaneBtn') as HTMLButtonElement | null;
    if (addLane) addLane.disabled = S.running || S.lanes.length >= S.maxLanes;
    $$('.msel select, [data-act=samplePersona], [data-act=again], [data-act=best]').forEach((x) => {
      (x as HTMLButtonElement).disabled = S.running;
    });
    $$('[data-act=delLane]').forEach((x) => {
      (x as HTMLButtonElement).disabled = S.running || S.lanes.length <= S.minLanes;
    });
    const shuffleBtn = $('#shuffleBtn');
    if (shuffleBtn) {
      shuffleBtn.innerHTML = `${IC.shuffle} Shuffle`;
      (shuffleBtn as HTMLButtonElement).disabled = S.running;
    }
    const blindBtn = $('#blindBtn');
    if (blindBtn) {
      blindBtn.innerHTML = S.blind ? `${IC.eye} Reveal models` : `${IC.eyeOff} Hide model names`;
      blindBtn.classList.toggle('on', S.blind);
      (blindBtn as HTMLButtonElement).disabled = S.running;
    }
  }

  function guessHTML(turn: Turn, l: Lane): string {
    const g = turn.guess?.[l.id];
    return `<div class="guess"><div class="gl">Which model wrote this?</div>
    <div class="gchips">${(turn.options || [])
      .map(
        (k) =>
          `<button type="button" class="gchip ${g === k ? 'on' : ''}" data-act="guess" data-t="${turn.id}" data-l="${l.id}" data-p="${k}">${esc(models[k]?.name || k)}</button>`,
      )
      .join('')}</div></div>`;
  }

  function cellHTML(turn: Turn, l: Lane): string {
    const r = turn.replies[l.id];
    const c = colOf(l);
    const si = `--i:${S.lanes.indexOf(l)}`;
    if (!r) {
      return `<div class="rc gap" style="--c:${c};${si}">Column added after this message</div>`;
    }
    const p = models[r.prov] || P(r.prov);
    const hid = hiddenIn(turn);
    const g = turn.guess?.[l.id];
    const showRes = turn.revealed && g;
    const res = showRes
      ? g === r.prov
        ? '<span class="gres ok">✓ You guessed right</span>'
        : `<span class="gres no">✗ You guessed ${esc(models[g!]?.name || g)}</span>`
      : '';
    const sim = r.status === 'done' && r.simulated ? '<span class="sim-pill">Simulated</span>' : '';
    const who = hid
      ? `<b>Model ${letter(l)}</b>${sim}`
      : `<b>${esc(p?.name || r.prov)}</b><code>${esc(shortModel(r.model))}</code>${sim}${res}`;
    const head = `<div class="rch"><span class="lb" style="background:${c}">${letter(l)}</span>${who}</div>`;
    const id = `c${turn.id}_${l.id}`;
    if (r.status === 'running') {
      return `<div class="rc run" id="${id}" style="--c:${c};${si}">${head}
    <div class="skel"><i style="width:94%"></i><i style="width:81%"></i><i style="width:88%"></i><i style="width:52%"></i></div>
    <div class="waiting"><span class="dotsld"><i></i><i></i><i></i></span><span>${r.note ? esc(r.note) : 'Writing an answer'}</span><span class="elapsed" data-t0="${r.t0}">${(((performance.now() - (r.t0 || 0)) / 1000).toFixed(1))}s</span></div></div>`;
    }
    if (r.status === 'error') {
      return `<div class="rc" id="${id}" style="--c:${c};${si}">${head}<div class="err">${esc(r.error)}</div>
    <button type="button" class="mini retry" data-act="retry" data-t="${turn.id}" data-l="${l.id}" ${S.running ? 'disabled' : ''}>Try again</button></div>`;
    }
    const isBest = turn.best === l.id;
    return `<div class="rc ${isBest ? 'best' : ''} ${showRes ? (g === r.prov ? 'right' : 'wrong') : ''}" id="${id}" style="--c:${c};${si}">${head}
    <div class="rtext ${isLong(r.text || '') && !r.open ? 'clamp' : ''}">${md(r.text || '') || '<span style="color:var(--fa2)">(empty answer)</span>'}</div>
    ${isLong(r.text || '') ? `<button type="button" class="more" data-act="more" data-t="${turn.id}" data-l="${l.id}">${r.open ? 'Show less' : 'Show more'}</button>` : ''}
    ${hid ? guessHTML(turn, l) : ''}
    <div class="rf"><span><b>${words(r.text || '')}</b> words</span>${hid ? '' : `<span title="Tokens in → tokens out"><b>${r.inTok}</b>→<b>${r.outTok}</b> tok</span>`}<span><b>${((r.ms || 0) / 1000).toFixed(1)}</b>s</span>${hid ? '' : `<span><b>${usdDisplay(r)}</b></span>`}${r.stop === 'max_tokens' ? '<span title="The answer hit the output cap">cut at cap</span>' : ''}
      <span class="grow"></span><button type="button" class="bestbtn ${isBest ? 'on' : ''}" data-act="best" data-t="${turn.id}" data-l="${l.id}" title="Mark this as the best answer to this message" ${S.running ? 'disabled' : ''}>${IC.star} Best</button></div>
  </div>`;
  }

  function stripHTML(turn: Turn, i: number): string {
    const prev = S.turns[i - 1];
    const changed = prev && prev.sys !== turn.sys;
    let rv = '';
    if (hiddenIn(turn)) {
      const need = doneLanes(turn);
      const have = need.filter((l) => turn.guess?.[l.id]).length;
      const ready = need.length > 0 && have === need.length && !S.running;
      rv = ready
        ? `<button type="button" class="revealbtn ready" data-act="revealTurn" data-t="${turn.id}">${IC.unlock} Reveal answers</button>`
        : `<button type="button" class="revealbtn" disabled title="Guess every answer first">${IC.lock} ${need.length ? `Guess ${need.length - have} more to reveal` : 'Waiting for answers'}</button>`;
    } else if (turn.revealed) {
      const s = turnScore(turn);
      if (s.total) {
        rv =
          s.right === s.total
            ? `<span class="score perfect">✦ All ${s.total} guessed right</span>`
            : `<span class="score">${s.right} of ${s.total} guessed right</span>`;
      }
    }
    return `<div class="tq"><span class="tn">#${i + 1}</span><div class="tqt">${esc(turn.q)}</div>
      <div class="tr">${changed ? '<span class="ptag" title="You edited the persona before sending this">persona edited</span>' : ''}<span>${turn.time}</span>
        <button type="button" class="mini" data-act="again" data-t="${turn.id}" title="Send this same message again to every model" ${S.running ? 'disabled' : ''}>${IC.again} Ask again</button>${rv}</div></div>`;
  }

  function turnHTML(turn: Turn, i: number, still?: boolean): string {
    return `<div class="turn ${still ? 'still' : ''}" id="t${turn.id}">${stripHTML(turn, i)}
    <div class="lanes" style="--n:${S.lanes.length}">${S.lanes.map((l) => cellHTML(turn, l)).join('')}</div>
  </div>`;
  }

  function renderLanes() {
    const n = S.lanes.length;
    const head = $('#lanesHead');
    if (!head) return;
    head.style.setProperty('--n', String(n));
    head.innerHTML = S.lanes
      .map((l) => {
        const p = models[l.prov];
        const st = laneStats(l);
        const picker = S.blind
          ? `<div class="hidden-name">Model ${letter(l)} <small>hidden</small></div>`
          : `<div class="mpick">
          <div class="msel" title="Model"><select data-lane="${l.id}" aria-label="Model for column ${letter(l)}">${Object.keys(models)
              .map(
                (k) =>
                  `<option value="${k}" ${k === l.prov ? 'selected' : ''}>${esc(models[k].name)}</option>`,
              )
              .join('')}</select></div>
        </div>`;
        const modelLabel = p?.name || l.prov;
        return `<div class="lh" style="--c:${colOf(l)};--i:${S.lanes.indexOf(l)}">
      <div class="lhr"><span class="lb">${letter(l)}</span>${picker}
        <button type="button" class="x" data-act="delLane" data-l="${l.id}" title="Remove this column" aria-label="Remove column ${letter(l)}">×</button></div>
      <div class="lmeta" title="${S.blind ? '' : esc(modelLabel)}">${S.blind ? 'Guess each answer, then reveal' : `${esc(p?.vendor || '')} · ${esc(modelLabel)}`}</div>
      <div class="lstat">${st ? `<span><b>${st.n}</b> repl${st.n === 1 ? 'y' : 'ies'}</span><span>avg <b>${Math.round(st.words)}</b> words</span><span>avg <b>${(st.ms / 1000).toFixed(1)}</b>s</span>${S.blind ? '' : `<span><b>${usd(st.cost)}</b></span>`}${st.best ? `<span class="star">★ <b>${st.best}</b> best</span>` : ''}` : '<span>No replies yet</span>'}</div>
    </div>`;
      })
      .join('');
    const sc = S.turns
      .filter((t) => t.revealed)
      .map(turnScore)
      .reduce((a, s) => ({ right: a.right + s.right, total: a.total + s.total }), { right: 0, total: 0 });
    const modeTag = $('#modeTag');
    if (modeTag) modeTag.hidden = !S.blind;
    const scoreChip = $('#scoreChip');
    if (scoreChip) {
      scoreChip.hidden = !sc.total;
      scoreChip.innerHTML = `Score <b>${sc.right}</b>/${sc.total}`;
    }
    const scroll = $('#scroll');
    if (scroll) scroll.classList.toggle('blindmode', S.blind);
    const arenaSub = $('#arenaSub');
    if (arenaSub) {
      arenaSub.textContent = S.blind
        ? 'Names hidden · columns shuffle before every message · guess which model wrote each answer'
        : `${n} columns · same persona, message and settings for every model`;
    }
    renderSend();
    syncUndoUi();
  }

  function renderTurns() {
    const box = $('#turns');
    if (!box) return;
    if (!S.turns.length) {
      box.innerHTML = `<div class="turn"><div class="lanes" style="--n:${S.lanes.length}">${S.lanes
        .map(
          (l) =>
            `<div class="rc idle" style="--c:${colOf(l)};--i:${S.lanes.indexOf(l)}"><div><b>${S.blind ? `Model ${letter(l)}` : esc(models[l.prov]?.name || l.prov)}</b><br>Its answers appear here</div></div>`,
        )
        .join('')}</div>
      <div class="hint">Write a message and press Send. The newest message always appears at the top.</div></div>`;
      return;
    }
    box.innerHTML = S.turns
      .map((t, i) => turnHTML(t, i))
      .reverse()
      .join('');
  }

  function renderTurn(turn: Turn) {
    const el = document.getElementById(`t${turn.id}`);
    if (el) {
      el.outerHTML = turnHTML(turn, S.turns.indexOf(turn), true);
    } else {
      renderTurns();
    }
  }

  function renderStrip(turn: Turn) {
    const el = host.querySelector(`#t${turn.id} > .tq`);
    if (el) el.outerHTML = stripHTML(turn, S.turns.indexOf(turn));
  }

  function renderCell(turn: Turn, l: Lane) {
    const el = document.getElementById(`c${turn.id}_${l.id}`);
    if (el) {
      el.outerHTML = cellHTML(turn, l);
      renderStrip(turn);
    } else {
      renderTurns();
    }
  }

  function renderAll() {
    renderComposer();
    renderLanes();
    renderTurns();
    syncUndoUi();
  }

  function shuffleLanes() {
    if (S.lanes.length < 2) return;
    const before = S.lanes.map((l) => l.id).join();
    let next: Lane[];
    do {
      next = S.lanes.slice();
      for (let i = next.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
    } while (next.map((l) => l.id).join() === before);
    S.lanes = next;
    renderAll();
    const sc = $('#scroll');
    if (sc) {
      sc.classList.remove('shuffled');
      void sc.offsetWidth;
      sc.classList.add('shuffled');
      window.setTimeout(() => sc.classList.remove('shuffled'), 1000);
    }
  }

  function minTempMax(): number {
    const caps = S.lanes.map((l) => models[l.prov]?.tempMax ?? 2);
    return caps.length ? Math.min(...caps) : 2;
  }

  function fillSettings() {
    const tempMax = minTempMax();
    S.temp = Math.min(S.temp, tempMax);
    const temp = $('#temp') as HTMLInputElement | null;
    const topp = $('#topp') as HTMLInputElement | null;
    const cap = $('#cap') as HTMLInputElement | null;
    if (temp) {
      temp.max = String(tempMax);
      temp.value = String(S.temp);
    }
    if (topp) topp.value = String(S.topp);
    if (cap) cap.value = String(S.cap);
    const vTemp = $('#vTemp');
    const vTopp = $('#vTopp');
    const vCap = $('#vCap');
    if (vTemp) {
      vTemp.textContent =
        S.temp.toFixed(2) + (tempMax < 2 ? `  (max ${tempMax} with current columns)` : '');
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
  }

  function renderFs() {
    const on = document.fullscreenElement === host;
    const b = $('#fsBtn');
    if (!b) return;
    b.innerHTML = on ? IC.fsOff : IC.fsOn;
    b.title = on ? 'Exit full screen' : 'Full screen';
  }

  function toggleFs() {
    if (document.fullscreenElement === host) {
      void document.exitFullscreen();
    } else {
      host.requestFullscreen?.().catch(() => toast("Full screen isn't available in this browser"));
    }
  }

  function rotatePlaceholder() {
    if (!MSG_EXAMPLES.length) return;
    phIdx = (phIdx + 1) % MSG_EXAMPLES.length;
    const msg = $('#msg') as HTMLTextAreaElement | null;
    if (msg) msg.placeholder = MSG_EXAMPLES[phIdx];
  }

  async function runReply(turn: Turn, l: Lane) {
    const idx = S.turns.indexOf(turn);
    const p = models[l.prov];
    const r: Reply = {
      status: 'running',
      prov: l.prov,
      model: l.ver || p?.defaultVersion || p?.model || l.prov,
      t0: performance.now(),
    };
    turn.replies[l.id] = r;
    renderCell(turn, l);
    const ctrl = new AbortController();
    S.ctrls.add(ctrl);
    try {
      const hist = historyFor(l, idx);
      const out = await runCompareGeneration(
        sessionId,
        projectId,
        {
          system: turn.sys,
          turns: hist,
          model: l.ver || p?.defaultVersion || l.prov,
          temp: S.temp,
          topp: S.topp,
          cap: S.cap,
          nonce: turn.nonce,
        },
        ctrl.signal,
      );
      Object.assign(r, {
        text: out.text,
        inTok: out.inTok,
        outTok: out.outTok,
        stop: out.stop,
        ms: out.ms,
        cost: out.cost,
        costInr: out.costInr,
        simulated: out.simulated,
        model: out.model,
        status: 'done' as const,
      });
    } catch (e) {
      if (ctrl.signal.aborted) {
        r.status = 'error';
        r.error = 'Stopped';
      } else {
        r.status = 'error';
        r.error = e instanceof Error ? e.message : 'Request failed';
      }
    }
    S.ctrls.delete(ctrl);
    renderCell(turn, l);
    renderLanes();
    maybeComplete();
  }

  async function sendText(q: string, nonce = 0) {
    const sysEl = $('#sys') as HTMLTextAreaElement | null;
    const sys = sysEl?.value.trim() || '';
    if (!sys) {
      toast('Add a persona first: paste yours from Exercise 8, or click <b>Example</b>');
      S.personaOpen = true;
      renderComposer();
      sysEl?.focus();
      return;
    }
    if (!q) {
      toast('Type a message to send');
      $('#msg')?.focus();
      return;
    }
    if (S.blind) shuffleLanes();
    const options = [...new Set(S.lanes.map((l) => l.prov))].sort((a, b) =>
      (models[a]?.name || a).localeCompare(models[b]?.name || b),
    );
    const turn: Turn = {
      id: UID++,
      q,
      sys,
      time: new Date().toTimeString().slice(0, 5),
      replies: {},
      best: null,
      guess: {},
      revealed: !S.blind,
      options,
      nonce,
    };
    S.turns.push(turn);
    S.personaOpen = false;
    S.running = true;
    renderAll();
    $('#scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    await Promise.all(S.lanes.map((l) => runReply(turn, l)));
    S.running = false;
    renderAll();
    announce(`All ${S.lanes.length} answers are in for message ${S.turns.length}.`);
    maybeComplete();
  }

  async function send() {
    if (S.running) {
      S.ctrls.forEach((c) => c.abort());
      S.ctrls.clear();
      S.running = false;
      renderAll();
      return;
    }
    const msgEl = $('#msg') as HTMLTextAreaElement | null;
    const q = msgEl?.value.trim() || '';
    const sysEl = $('#sys') as HTMLTextAreaElement | null;
    if (q && sysEl?.value.trim()) {
      msgEl!.value = '';
      rotatePlaceholder();
    }
    await sendText(q);
    msgEl?.focus();
  }

  async function retryTurn(turnId: number, laneId: number) {
    if (S.running) return;
    const turn = S.turns.find((t) => t.id === turnId);
    const l = S.lanes.find((x) => x.id === laneId);
    if (!turn || !l) return;
    S.running = true;
    renderSend();
    await runReply(turn, l);
    S.running = false;
    renderAll();
  }

  function onClick(e: Event) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal') || target.closest('[data-close]')) {
      closeModals();
      return;
    }
    const act = target.closest('[data-act]') as HTMLElement | null;
    if (act) {
      const a = act.dataset.act;
      if (a === 'samplePersona') {
        const sysEl = $('#sys') as HTMLTextAreaElement | null;
        if (!sysEl?.value.trim() || window.confirm('Replace your persona with the materials-science example?')) {
          pushUndo();
          if (sysEl) sysEl.value = SAMPLE_SYS;
          S.personaOpen = true;
          renderComposer();
        }
      } else if (a === 'togglePersona') {
        S.personaOpen = !S.personaOpen;
        renderComposer();
        if (S.personaOpen) $('#sys')?.focus();
      } else if (a === 'addLane') {
        if (S.lanes.length < S.maxLanes) {
          pushUndo();
          const used = new Set(S.lanes.map((l) => l.prov));
          const next =
            Object.keys(models).find((k) => !used.has(k)) || Object.keys(models)[0] || 'gemini-38-flash';
          addLane(next);
          renderAll();
        }
      } else if (a === 'delLane') {
        if (S.lanes.length > S.minLanes) {
          pushUndo();
          const lid = +act.dataset.l!;
          S.lanes = S.lanes.filter((l) => l.id !== lid);
          S.turns.forEach((t) => {
            if (t.best === lid) t.best = null;
          });
          renderAll();
        }
      } else if (a === 'newChat') {
        if (S.turns.length && window.confirm('Clear the conversation in every column?')) {
          pushUndo();
          S.turns = [];
          renderAll();
          $('#msg')?.focus();
        }
      } else if (a === 'blind') {
        if (S.running) return;
        pushUndo();
        S.blind = !S.blind;
        if (S.blind) {
          S.turns.forEach((t) => {
            t.revealed = false;
            t.guess = {};
          });
          shuffleLanes();
        } else {
          S.turns.forEach((t) => {
            t.revealed = true;
          });
          if (S.turns.length) S.revealedBlindOnce = true;
          renderAll();
          toast(
            S.turns.some((t) => t.best != null)
              ? 'Models revealed. Check the ★ best counts in each column.'
              : 'Models revealed.',
          );
          maybeComplete();
        }
      } else if (a === 'shuffle') {
        if (!S.running) shuffleLanes();
      } else if (a === 'more') {
        const t = S.turns.find((x) => x.id === +act.dataset.t!);
        const l = S.lanes.find((x) => x.id === +act.dataset.l!);
        const r = t && l ? t.replies[l.id] : undefined;
        if (r) {
          r.open = !r.open;
          renderCell(t!, l!);
        }
      } else if (a === 'guess') {
        const t = S.turns.find((x) => x.id === +act.dataset.t!);
        const lid = +act.dataset.l!;
        if (t && !t.revealed) {
          t.guess[lid] = t.guess[lid] === act.dataset.p ? undefined : act.dataset.p;
          renderTurn(t);
        }
      } else if (a === 'revealTurn') {
        const t = S.turns.find((x) => x.id === +act.dataset.t!);
        if (t) {
          t.revealed = true;
          S.revealedBlindOnce = true;
          renderTurn(t);
          renderLanes();
          const el = document.getElementById(`t${t.id}`);
          el?.classList.add('revealing');
          maybeComplete();
        }
      } else if (a === 'best') {
        const t = S.turns.find((x) => x.id === +act.dataset.t!);
        const lid = +act.dataset.l!;
        if (t) {
          t.best = t.best === lid ? null : lid;
          S.lanes.forEach((l) => renderCell(t, l));
          renderLanes();
          maybeComplete();
        }
      } else if (a === 'again') {
        const t = S.turns.find((x) => x.id === +act.dataset.t!);
        if (t && !S.running) void sendText(t.q, (t.nonce ?? 0) + 1);
      } else if (a === 'retry') {
        void retryTurn(+act.dataset.t!, +act.dataset.l!);
      } else if (a === 'resetParams') {
        pushUndo();
        S.temp = DEFAULTS.temp;
        S.topp = DEFAULTS.topp;
        S.cap = DEFAULTS.cap;
        fillSettings();
      }
      return;
    }
    const b = target.closest('button');
    if (!b) return;
    if (b.id === 'sendBtn') void send();
    else if (b.id === 'undoBtn') performUndo();
    else if (b.id === 'settingsBtn') openSettings();
    else if (b.id === 'fsBtn') toggleFs();
  }

  function onInput(e: Event) {
    const t = e.target as HTMLElement;
    if (t.id === 'sys') renderComposer();
    else if (t.id === 'temp') {
      const next = Math.min(minTempMax(), parseFloat((t as HTMLInputElement).value));
      if (next !== S.temp) pushUndo();
      S.temp = next;
      fillSettings();
    } else if (t.id === 'topp') {
      const next = parseFloat((t as HTMLInputElement).value);
      if (next !== S.topp) pushUndo();
      S.topp = next;
      fillSettings();
    } else if (t.id === 'cap') {
      const next = parseInt((t as HTMLInputElement).value, 10);
      if (next !== S.cap) pushUndo();
      S.cap = next;
      fillSettings();
    }
  }

  function onChange(e: Event) {
    const t = e.target as HTMLElement;
    if (t.dataset.lane) {
      const l = S.lanes.find((x) => x.id === +t.dataset.lane!);
      if (l) {
        pushUndo();
        l.prov = (t as HTMLSelectElement).value;
        l.ver = defaultVersionOf(models[l.prov]);
        renderAll();
      }
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      closeModals();
      return;
    }
    const msg = $('#msg');
    if (e.target === msg && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  host.addEventListener('click', onClick);
  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', renderFs);

  const elapsedTimer = window.setInterval(() => {
    if (!S.running) return;
    const now = performance.now();
    $$('.elapsed').forEach((el) => {
      const t0 = +(el as HTMLElement).dataset.t0!;
      el.textContent = `${((now - t0) / 1000).toFixed(1)}s`;
    });
  }, 100);

  void (async () => {
    try {
      catalog = await loadCompareCatalog(sessionId, projectId);
      if (aborted) return;
      models = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
      DEFAULTS = {
        temp: catalog.defaults.temp,
        topp: catalog.defaults.topp,
        cap: catalog.defaults.cap,
      };
      SAMPLE_SYS = catalog.sample.sys;
      MSG_EXAMPLES = catalog.sample.messages?.length ? catalog.sample.messages : [];
      S.temp = catalog.defaults.temp;
      S.topp = catalog.defaults.topp;
      S.cap = catalog.defaults.cap;
      S.inrPerUsd = catalog.defaults.inrPerUsd;
      S.minLanes = catalog.defaults.minLanes;
      S.maxLanes = catalog.defaults.maxLanes;
      catalog.defaults.lanes.forEach((prov) => addLane(prov));
      while (S.lanes.length < S.minLanes) {
        addLane(Object.keys(models)[S.lanes.length] || 'gemini-38-flash');
      }

      host.innerHTML = TEMPLATE;
      unbindTheme?.();
      unbindTheme = bindExerciseTheme(host);
      const settingsBtn = $('#settingsBtn');
      if (settingsBtn) settingsBtn.innerHTML = IC.gear;
      const fsBtn = $('#fsBtn');
      if (fsBtn && !host.requestFullscreen) fsBtn.hidden = true;
      renderFs();
      const msg = $('#msg') as HTMLTextAreaElement | null;
      if (msg && MSG_EXAMPLES[0]) msg.placeholder = MSG_EXAMPLES[0];
      const sys = $('#sys') as HTMLTextAreaElement | null;
      if (sys && catalog.defaults.sys) sys.value = catalog.defaults.sys;
      renderAll();
      host.classList.remove('is-booting');
    } catch (err) {
      if (aborted) return;
      showBootError(err instanceof Error ? err.message : 'Failed to load compare lab');
    }
  })();

  return () => {
    aborted = true;
    S.ctrls.forEach((c) => c.abort());
    window.clearInterval(elapsedTimer);
    host.removeEventListener('click', onClick);
    host.removeEventListener('input', onInput);
    host.removeEventListener('change', onChange);
    host.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', renderFs);
    unbindTheme?.();
    host.innerHTML = '';
  };
}
