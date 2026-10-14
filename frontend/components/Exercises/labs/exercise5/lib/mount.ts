import {
  generateLanguageAnswer,
  loadTokeniserCatalog,
  tokeniseTexts,
  type EncId,
  type TokeniserCatalog,
  type TokeniserModel,
  type TokenSegment,
} from './api';
import {
  CFG_IDS,
  CFG_NAMES,
  DEFAULT_EDGES,
  LANG_COLORS,
  STORAGE_KEY,
  charCount,
  esc,
  fmt,
  usd,
  wordCount,
  type CfgId,
} from './format';
import { bindHostFullscreen } from '../../../fullscreen';
import { createUndoStack, syncUndoButton, UNDO_ICON_SVG } from '../../../undoHistory';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { exerciseHeaderIconHtml } from '../../../exerciseHeaderIcons';
import { defaultVersionOf } from '../../../modelVersions';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

type LangId = string;

interface AnswerRes {
  text: string;
  busy?: boolean;
  done?: boolean;
  prompt?: string;
  err?: string;
  /** Per selected-model answer text when multiple models ran. */
  byModel?: Record<string, { text: string; model: string; err?: string }>;
}

interface LabState {
  models: string[];
  /** Selected API version id per model family id. */
  versions: Record<string, string>;
  q: string;
  words: number;
  langs: LangId[];
  res: Record<string, AnswerRes>;
  tokView: Record<string, EncId | ''>;
  prices: Record<string, { pin?: number; pout?: number }>;
  inr: number;
  students: number;
  perDay: number;
  days: number;
  pos: Record<string, { x: number; y: number }>;
  size: Record<string, { w?: number; bh?: number }>;
  edges: [string, string][];
  view: { x: number; y: number; z: number } | null;
  mw: number;
  metric: 'tok' | 'x' | 'cost' | 'tpw';
  base?: LangId;
  lastRunLang?: LangId | null;
}

interface UndoSnapshot {
  models: string[];
  versions: Record<string, string>;
  q: string;
  words: number;
  langs: LangId[];
  edges: [string, string][];
  prices: Record<string, { pin?: number; pout?: number }>;
  students: number;
  perDay: number;
  days: number;
  metric: LabState['metric'];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TEMPLATE = `
<div class="boot" id="boot" role="status" aria-live="polite" aria-busy="true">
  <span class="spin" aria-hidden="true"></span>
  <span class="boot-t">Loading workspace…</span>
</div>
<header class="top">
  <div class="top-row">
    <div class="ex-lab-brand">
      ${exerciseHeaderIconHtml(5)}
      <h1 class="ex-title">Exercise - 5 : Tokeniser and cost</h1>
    </div>
    <div class="actions">
      ${THEME_TOGGLE_HTML}
      <button type="button" class="ibtn" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
      <button type="button" class="ibtn" id="undo" disabled title="Undo the last change (Ctrl+Z)" aria-label="Undo the last change">${UNDO_ICON_SVG}</button>
      <button type="button" class="btn run" id="run"><svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg><span>Run workflow</span></button>
    </div>
  </div>
</header>
<div class="work" id="work">
  <div class="vp" id="vp">
    <div class="world" id="world">
      <svg id="wires" aria-hidden="true"></svg>
      <div class="node" id="n-model" style="--c:var(--cyan);width:460px">
        <div class="nh"><span class="ic"><svg width="14" height="14" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><div><div class="t">Models</div><div class="s">Pick models to run</div></div><span class="st"></span></div>
        <div class="nb"><div id="mlist"></div></div>
        <span class="rz" data-rz="n-model" title="Drag to resize"></span>
      </div>
      <div class="node" id="n-q" style="--c:var(--lime);width:250px">
        <div class="nh"><span class="ic"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 3h12v8H7l-3 3v-3H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span><div><div class="t">Question</div><div class="s">What students ask</div></div><span class="st"></span></div>
        <div class="nb">
          <textarea id="q" rows="5" aria-label="Your question" placeholder="Type your question"></textarea>
        </div>
        <span class="rz" data-rz="n-q" title="Drag to resize"></span>
      </div>
      <div class="node" id="n-len" style="--c:var(--amber);width:210px">
        <div class="nh"><span class="ic"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M1 11L11 1l4 4L5 15z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 7l1.5 1.5M7 5l1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><div><div class="t">Answer length</div><div class="s">Word budget</div></div><span class="st"></span></div>
        <div class="nb"><div class="pills" id="len" role="group" aria-label="Answer length in words"></div></div>
        <span class="rz" data-rz="n-len" title="Drag to resize"></span>
      </div>
      <div class="node" id="n-lang" style="--c:var(--mag);width:250px">
        <div class="nh"><span class="ic"><svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.8 8h12.4M8 1.7c1.8 2 2.7 4.1 2.7 6.3S9.8 12.3 8 14.3C6.2 12.3 5.3 10.2 5.3 8S6.2 3.7 8 1.7z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span><div><div class="t">Languages</div><div class="s">Drop languages here</div></div><span class="st"></span></div>
        <div class="nb"><div class="dz" id="dz" aria-label="Languages in the flow"></div></div>
        <span class="rz" data-rz="n-lang" title="Drag to resize"></span>
      </div>
      <div id="answers"></div>
    </div>
    <div class="dock palette" id="dock" aria-label="Languages to add"></div>
    <span class="warnpill" id="warn" role="status"></span>
    <div class="toast" id="toast" role="status" hidden></div>
    <div class="zoom" aria-label="Canvas zoom">
      <button type="button" id="zout" aria-label="Zoom out">−</button><span id="zval">100%</span><button type="button" id="zin" aria-label="Zoom in">+</button>
      <button type="button" class="fit" id="zfit">Fit</button><button type="button" class="fit" id="tidy">Tidy</button>
    </div>
  </div>
  <div class="split" id="split" role="separator" aria-orientation="vertical" aria-label="Resize metrics panel" tabindex="0"></div>
  <aside class="metrics" id="metrics" aria-live="polite"></aside>
</div>
`;

const HANDLES =
  '<span class="h" data-s="t"></span><span class="h" data-s="r"></span><span class="h" data-s="b"></span><span class="h" data-s="l"></span>';

const METRICS: Record<string, string> = {
  tok: 'Output tokens',
  x: '×',
  cost: 'Cost per answer',
  tpw: 'Tokens per word',
};

const SIDE: Record<string, [number, number]> = {
  l: [-1, 0],
  r: [1, 0],
  t: [0, -1],
  b: [0, 1],
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function mountExercise5(host: HTMLElement, opts: MountOptions): () => void {
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const root = host;
  const revealLab = () => {
    host.classList.remove('is-booting');
    const boot = $('#boot');
    if (boot) {
      boot.setAttribute('aria-busy', 'false');
      boot.hidden = true;
    }
  };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector(sel) as T | null;
  const $$ = (sel: string) => Array.from(root.querySelectorAll(sel));

  let catalog: TokeniserCatalog | null = null;
  let langMeta: Record<string, { name: string; prompt: string; c: string }> = {};
  let encShort: Record<string, string> = { o200k: 'o200k', cl100k: 'cl100k', gpt2: 'GPT-2' };
  let encLabel: Record<string, string> = {
    o200k: 'o200k (2024)',
    cl100k: 'cl100k (2023)',
    gpt2: 'GPT-2 (2019)',
  };
  const countCache = new Map<string, number>();
  const segCache = new Map<string, TokenSegment[]>();
  let running = false;
  let abort: AbortController | null = null;
  let menuOpen = false;
  let hoverEdge = -1;
  let toastT: ReturnType<typeof setTimeout> | null = null;
  let qTokTimer: ReturnType<typeof setTimeout> | null = null;
  const undoStack = createUndoStack<UndoSnapshot>({ max: 40 });
  const undoBtn = () => $('#undo') as HTMLButtonElement | null;
  let act: { type: string; id?: string; sx: number; sy: number; x?: number; y?: number; w?: number; bh?: number } | null =
    null;
  let link: { id: string; side: string; from: { x: number; y: number }; to: { x: number; y: number } | null } | null =
    null;
  let zTop = 10;
  let lastTarget: HTMLElement | null = null;
  let completed = false;
  const cleanups: Array<() => void> = [];
  cleanups.push(bindExerciseTheme(host));
  cleanups.push(bindHostFullscreen(host, $('#fsBtn')));

  const S: LabState = {
    models: ['gemini-38-flash', 'gpt-6-luna', 'claude-haiku-55'],
    versions: {},
    q: '',
    words: 100,
    langs: ['en', 'ta'],
    res: {},
    tokView: {},
    prices: {},
    inr: 88,
    students: 600,
    perDay: 5,
    days: 30,
    pos: {},
    size: {},
    edges: DEFAULT_EDGES.map((e) => [...e] as [string, string]),
    view: null,
    mw: 420,
    metric: 'tok',
    lastRunLang: null,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(S, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  // Soft-validate persisted state so a corrupt localStorage blob cannot crash the lab.
  if (!Array.isArray(S.models)) S.models = ['gemini-38-flash', 'gpt-6-luna', 'claude-haiku-55'];
  if (!Array.isArray(S.langs)) S.langs = ['en', 'ta'];
  if (!Array.isArray(S.edges) || !S.edges.every((e) => Array.isArray(e) && e.length === 2)) {
    S.edges = DEFAULT_EDGES.map((e) => [...e] as [string, string]);
  }
  if (!S.res || typeof S.res !== 'object') S.res = {};
  if (!S.pos || typeof S.pos !== 'object') S.pos = {};
  if (!S.size || typeof S.size !== 'object') S.size = {};
  if (!S.prices || typeof S.prices !== 'object') S.prices = {};
  if (!S.versions || typeof S.versions !== 'object') S.versions = {};
  if (!S.tokView || typeof S.tokView !== 'object') S.tokView = {};
  if (![50, 100, 150].includes(S.words)) S.words = 100;
  if (!Number.isFinite(S.inr) || S.inr <= 0) S.inr = 88;
  if (!Number.isFinite(S.mw)) S.mw = 420;
  if (!['tok', 'x', 'cost', 'tpw'].includes(S.metric)) S.metric = 'tok';
  if (typeof S.q !== 'string') S.q = '';
  // Drop stale answer text on boot — prompts may have changed since last visit.
  Object.keys(S.res).forEach((lang) => {
    const row = S.res[lang];
    if (!row || typeof row !== 'object') {
      delete S.res[lang];
      return;
    }
    S.res[lang] = { ...row, busy: false };
  });

  const on = (el: EventTarget | null, type: string, fn: EventListener, options?: AddEventListenerOptions) => {
    if (!el) return;
    el.addEventListener(type, fn, options);
    cleanups.push(() => el.removeEventListener(type, fn, options));
  };

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
    } catch {
      /* ignore */
    }
  };

  const models = (): TokeniserModel[] => (catalog?.models || []).filter((m) => S.models.includes(m.id));

  const versionOf = (m: TokeniserModel) => S.versions[m.id] || defaultVersionOf(m);

  const price = (m: TokeniserModel) => ({ pin: m.pin, pout: m.pout });

  const stacked = () => window.innerWidth <= 760;

  const colorOf = (lang: string) => LANG_COLORS[langMeta[lang]?.c || 'cyan'] || 'var(--cyan)';

  const promptFor = (lang: string) =>
    `You are a study assistant for engineering college students.\nAnswer the question below in ${langMeta[lang]?.prompt || lang} only.\nUse fewer than ${S.words} words. Plain text, no markdown, no heading, no preamble.\n\nQuestion: ${S.q.trim()}`;

  /** Freshness key — includes selected model versions so switching versions requires a re-run. */
  const runKey = (lang: string) =>
    `${promptFor(lang)}\0${models()
      .map((m) => `${m.id}:${versionOf(m)}`)
      .join(',')}`;

  const answerTextFor = (l: string, m: TokeniserModel) => {
    const r = S.res[l];
    if (!r) return '';
    return r.byModel?.[m.id]?.text || r.text || '';
  };

  const cachedCount = (text: string, enc: string) => {
    if (!text) return 0;
    const key = `${enc}\0${text}`;
    return countCache.get(key) ?? 0;
  };

  const ensureCounts = async (pairs: { text: string; enc: string }[], withSeg = false) => {
    const need = pairs.filter((p) => p.text && !countCache.has(`${p.enc}\0${p.text}`));
    const needSeg = withSeg
      ? pairs.filter((p) => p.text && !segCache.has(`${p.enc}\0${p.text}`))
      : [];
    const uniq = new Map<string, { enc: string; text: string }>();
    [...need, ...needSeg].forEach((p) => uniq.set(`${p.enc}\0${p.text}`, p));
    if (!uniq.size) return;
    // Evict before insert so a large batch cannot wipe the counts we just stored.
    if (countCache.size + uniq.size > 500) countCache.clear();
    if (segCache.size + uniq.size > 80) segCache.clear();
    try {
      const { results } = await tokeniseTexts(
        opts.sessionId,
        opts.projectId,
        [...uniq.values()],
        withSeg || needSeg.length > 0,
      );
      const keys = [...uniq.keys()];
      results.forEach((r, i) => {
        const key = keys[i];
        if (!key) return;
        countCache.set(key, r.count);
        if (r.segments?.length) segCache.set(key, r.segments);
      });
    } catch {
      /* keep zeros / estimates */
    }
  };

  const fresh = (l: string) => {
    const r = S.res[l];
    if (!r || !r.done || r.prompt !== runKey(l)) return false;
    if (r.text) return true;
    return Object.values(r.byModel || {}).some((row) => Boolean(row.text));
  };

  const stat = (l: string, m: TokeniserModel) => {
    const p = price(m);
    const f = fresh(l);
    const r = S.res[l];
    const prompt = promptFor(l);
    const outText = answerTextFor(l, m);
    // Metrics only use real token counts from generated text — never word-budget guesses.
    const inT = f ? cachedCount(prompt, m.enc) : 0;
    const outT = f && outText ? cachedCount(outText, m.enc) : 0;
    const w = f && outText ? wordCount(outText) : 0;
    const costUsd = f ? (inT * p.pin) / 1e6 + (outT * p.pout) / 1e6 : 0;
    return {
      inT,
      outT,
      w,
      f,
      usd: costUsd,
      inr: costUsd * S.inr,
      tpw: w ? outT / w : 0,
      cpt: f && outText && outT ? charCount(outText) / outT : 0,
    };
  };

  const vp = $('#vp')!;
  const world = $('#world')!;
  const svg = $('#wires')!;

  const nodeIds = () => [...CFG_IDS, ...S.langs.map((l) => `a-${l}`)];

  const defaultPos = (id: string) => {
    const row: Record<string, [number, number]> = {
      'n-model': [40, 30],
      'n-q': [420, 40],
      'n-len': [720, 40],
      'n-lang': [980, 30],
    };
    if (row[id]) return { x: row[id][0], y: row[id][1] };
    const i = S.langs.indexOf(id.slice(2));
    const n = S.langs.length;
    const per = Math.min(4, n);
    const w = 290;
    const g = 24;
    const r = Math.floor(i / per);
    const c = i % per;
    const inRow = Math.min(per, n - r * per);
    const x0 = 625 - (inRow * w + (inRow - 1) * g) / 2;
    const top =
      Math.max(
        ...CFG_IDS.map((k) => {
          const p = S.pos[k] || (row[k] ? { y: row[k][1] } : { y: 0 });
          const el = $(`#${k}`);
          return p.y + (el ? el.offsetHeight : 200);
        }),
      ) + 70;
    return { x: x0 + c * (w + g), y: top + r * 250 };
  };

  const applyNodeSize = (id: string) => {
    const n = $(`#${id}`);
    if (!n) return;
    const sz = S.size[id];
    let width = sz?.w;
    // Models table: checkbox | name | in | out rates.
    if (id === 'n-model') width = Math.max(width || 460, 420);
    if (width) n.style.width = `${width}px`;
    if (sz?.bh) {
      n.style.setProperty('--bh', `${sz.bh}px`);
      const nb = n.querySelector('.nb') as HTMLElement | null;
      if (nb) {
        nb.style.maxHeight = `${sz.bh}px`;
        nb.style.overflow = 'auto';
      }
    }
  };

  const place = (id: string) => {
    const n = $(`#${id}`);
    if (!n) return;
    if (!S.pos[id]) S.pos[id] = defaultPos(id);
    n.style.left = `${S.pos[id].x}px`;
    n.style.top = `${S.pos[id].y}px`;
    if (!S.size[id]?.w && id.startsWith('a-')) n.style.width = '290px';
    applyNodeSize(id);
  };

  const applyView = () => {
    const v = S.view || (S.view = { x: 0, y: 0, z: 1 });
    world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`;
    vp.style.backgroundSize = `${22 * v.z}px ${22 * v.z}px`;
    vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
    const zval = $('#zval');
    if (zval) zval.textContent = `${Math.round(v.z * 100)}%`;
  };

  const box = (id: string): Box | null => {
    const n = $(`#${id}`);
    const p = S.pos[id];
    return n && p ? { x: p.x, y: p.y, w: n.offsetWidth, h: n.offsetHeight } : null;
  };

  const fit = () => {
    if (stacked()) return;
    const bs = nodeIds().map(box).filter(Boolean) as Box[];
    if (!bs.length) return;
    const x0 = Math.min(...bs.map((b) => b.x));
    const y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w));
    const y1 = Math.max(...bs.map((b) => b.y + b.h));
    const W = vp.clientWidth;
    const H = vp.clientHeight - 44;
    const z = Math.max(0.3, Math.min(1.1, (W - 48) / (x1 - x0), (H - 72) / (y1 - y0)));
    S.view = { z, x: (W - (x1 - x0) * z) / 2 - x0 * z, y: 52 + (H - 52 - (y1 - y0) * z) / 2 - y0 * z };
    applyView();
    save();
  };

  const zoomAt = (f: number, cx: number, cy: number) => {
    const v = S.view || (S.view = { x: 0, y: 0, z: 1 });
    const z = Math.max(0.25, Math.min(2, v.z * f));
    v.x = cx - ((cx - v.x) * z) / v.z;
    v.y = cy - ((cy - v.y) * z) / v.z;
    v.z = z;
    applyView();
    save();
  };

  const toWorld = (cx: number, cy: number) => {
    const r = vp.getBoundingClientRect();
    const v = S.view || { x: 0, y: 0, z: 1 };
    return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z };
  };

  const anchor = (b: Box, s: string) =>
    s === 'l'
      ? { x: b.x, y: b.y + b.h / 2 }
      : s === 'r'
        ? { x: b.x + b.w, y: b.y + b.h / 2 }
        : s === 't'
          ? { x: b.x + b.w / 2, y: b.y }
          : { x: b.x + b.w / 2, y: b.y + b.h };

  const pickSides = (a: Box, b: Box): [string, string] => {
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
    const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
    if (gapX >= gapY) return bx > ax ? ['r', 'l'] : ['l', 'r'];
    return by > ay ? ['b', 't'] : ['t', 'b'];
  };

  const curve = (p: { x: number; y: number }, sp: string, q: { x: number; y: number }, sq: string | null) => {
    const d = Math.max(36, Math.hypot(q.x - p.x, q.y - p.y) / 2.6);
    const c1 = { x: p.x + SIDE[sp][0] * d, y: p.y + SIDE[sp][1] * d };
    const c2 = sq ? { x: q.x + SIDE[sq][0] * d, y: q.y + SIDE[sq][1] * d } : q;
    return `M${p.x},${p.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${q.x},${q.y}`;
  };

  const edgePath = (a: string, b: string) => {
    const A = box(a);
    const B = box(b);
    if (!A || !B) return null;
    const [sa, sb] = pickSides(A, B);
    const p = anchor(A, sa);
    const q = anchor(B, sb);
    return { d: curve(p, sa, q, sb), m: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
  };

  const drawWires = () => {
    if (stacked()) {
      svg.innerHTML = '';
      return;
    }
    let h = '';
    S.edges.forEach(([a, b], i) => {
      const e = edgePath(a, b);
      if (!e) return;
      h += `<path class="hit" data-e="${i}" d="${e.d}"><title>Click to remove this wire</title></path><path class="wire${running ? ' on' : ''}${hoverEdge === i ? ' hov' : ''}" d="${e.d}"/>`;
      if (hoverEdge === i) {
        h += `<g class="cut" data-e="${i}" transform="translate(${e.m.x},${e.m.y})"><circle r="9"/><path d="M-3.5,-3.5L3.5,3.5M3.5,-3.5L-3.5,3.5"/></g>`;
      }
    });
    S.langs.forEach((l) => {
      const e = edgePath('n-lang', `a-${l}`);
      const r = S.res[l];
      if (e) h += `<path class="wire lang${r && r.busy ? ' on' : ''}" style="--c:${colorOf(l)}" d="${e.d}"/>`;
    });
    if (link && link.to) h += `<path class="wire temp" d="${curve(link.from, link.side, link.to, null)}"/>`;
    svg.innerHTML = h;
  };

  const layoutAll = () => {
    nodeIds().forEach(place);
    drawWires();
  };

  const missing = () => {
    const adj: Record<string, string[]> = {};
    CFG_IDS.forEach((id) => {
      adj[id] = [];
    });
    S.edges.forEach(([a, b]) => {
      if (adj[a] && adj[b]) {
        adj[a].push(b);
        adj[b].push(a);
      }
    });
    const seen = new Set<string>(['n-lang']);
    const st = ['n-lang'];
    while (st.length) {
      const x = st.pop()!;
      adj[x].forEach((y) => {
        if (!seen.has(y)) {
          seen.add(y);
          st.push(y);
        }
      });
    }
    return CFG_IDS.filter((id) => !seen.has(id));
  };

  const checkFlow = (show: boolean) => {
    const miss = stacked() ? [] : missing();
    CFG_IDS.forEach((id) => $(`#${id}`)?.classList.toggle('warn', show && miss.includes(id)));
    const warn = $('#warn');
    if (warn) {
      warn.textContent =
        miss.length && show ? `Connect ${miss.map((id) => CFG_NAMES[id as CfgId]).join(', ')} to the flow` : '';
    }
    return miss;
  };

  const captureUndo = (): UndoSnapshot => ({
    models: [...S.models],
    versions: { ...S.versions },
    q: S.q,
    words: S.words,
    langs: [...S.langs],
    edges: S.edges.map((e) => [...e] as [string, string]),
    prices: { ...S.prices },
    students: S.students,
    perDay: S.perDay,
    days: S.days,
    metric: S.metric,
  });

  const pushUndo = () => {
    undoStack.push(captureUndo());
    syncUndoButton(undoBtn(), undoStack.canUndo);
  };

  const applyUndoSnapshot = (snap: UndoSnapshot) => {
    S.models = [...snap.models];
    S.versions = { ...(snap.versions || {}) };
    S.q = snap.q;
    S.words = snap.words;
    S.langs = [...snap.langs];
    S.edges = snap.edges.map((e) => [...e] as [string, string]);
    S.prices = { ...snap.prices };
    S.students = snap.students;
    S.perDay = snap.perDay;
    S.days = snap.days;
    S.metric = snap.metric;
    Object.keys(S.res).forEach((l) => {
      if (!S.langs.includes(l)) {
        delete S.res[l];
        delete S.tokView[l];
        delete S.pos[`a-${l}`];
        delete S.size[`a-${l}`];
      }
    });
    if (S.lastRunLang && !S.langs.includes(S.lastRunLang)) S.lastRunLang = null;
    const qEl = $('#q') as HTMLTextAreaElement | null;
    if (qEl) qEl.value = S.q;
  };

  const hideToast = () => {
    const t = $('#toast');
    if (t) t.hidden = true;
  };

  const toast = (msg: string) => {
    const t = $('#toast');
    if (!t) return;
    t.innerHTML = `<span>${msg}</span><button type="button" class="lk" id="toastUndo">Undo</button>`;
    t.hidden = false;
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(hideToast, 6000);
  };

  const undo = () => {
    const snap = undoStack.undo();
    if (!snap) return;
    applyUndoSnapshot(snap);
    hoverEdge = -1;
    menuOpen = false;
    syncUndoButton(undoBtn(), undoStack.canUndo);
    hideToast();
    refresh();
    requestAnimationFrame(drawWires);
  };

  const hl = (text: string, enc: string) => {
    const segs = segCache.get(`${enc}\0${text}`) || [];
    if (!segs.length) return esc(text);
    return segs
      .map(
        (s, i) =>
          `<span class="tok k${i % 4}${s.ids.length > 1 ? ' multi' : ''}" title="${s.ids.length} token${s.ids.length > 1 ? 's' : ''}">${esc(s.text).replace(/ /g, '<span class="ws">·</span>').replace(/\n/g, '<span class="ws">↵</span>\n')}</span>`,
      )
      .join('');
  };

  const ansHTML = (l: string) => {
    const sz = S.size[`a-${l}`] || {};
    const name = langMeta[l]?.name || l;
    return `<div class="node ans" id="a-${l}" style="--c:${colorOf(l)};${sz.bh ? `--bh:${sz.bh}px;` : ''}">
      <div class="nh"><span class="ic"><svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span><div><div class="t">${esc(name)} answer</div><div class="s" id="as-${l}">Output</div></div><button type="button" class="ans-close" data-rm="${l}" aria-label="Remove ${esc(name)} answer" title="Remove">×</button><span class="st"></span></div>
      <div class="nb"><div class="body" id="ab-${l}"></div><div class="err" id="ae-${l}"></div></div>
      <div class="foot" id="af-${l}"></div><span class="rz" data-rz="a-${l}" title="Drag to resize"></span></div>`;
  };

  const updateAnswer = (l: string) => {
    const r = S.res[l];
    const b = $(`#ab-${l}`);
    const f = $(`#af-${l}`);
    const node = $(`#a-${l}`);
    if (!b || !f || !node) return;
    const ok = fresh(l);
    node.classList.toggle('done', ok);
    node.classList.toggle('busy', !!(r && r.busy));
    const encs = [...new Set(models().map((m) => m.enc))];
    if (S.tokView[l] && !encs.includes(S.tokView[l] as EncId)) S.tokView[l] = '';
    const stale = r && r.done && !ok;
    const byModelEntries = r?.byModel
      ? models()
          .map((m) => {
            const row = r.byModel?.[m.id];
            return row ? { m, row } : null;
          })
          .filter((x): x is { m: TokeniserModel; row: { text: string; model: string; err?: string } } => Boolean(x))
      : [];
    if (!r || (!r.text && !r.busy && !byModelEntries.length)) {
      b.className = 'body ph';
      b.textContent = 'Run the workflow to get this answer.';
    } else if (r.busy && !r.text && !byModelEntries.length) {
      b.className = 'body ph';
      b.textContent = 'Thinking…';
    } else if (byModelEntries.length > 1) {
      b.className = 'body multi';
      b.innerHTML =
        (stale ? '<div class="stale">The question, length, or model version changed. Run again.</div>' : '') +
        byModelEntries
          .map(({ m, row }) => {
            const body =
              S.tokView[l] && r.done && row.text ? hl(row.text, S.tokView[l] as string) : esc(row.text || '');
            return `<div class="ans-model"><div class="ans-model-h">${esc(m.name)}</div><div class="ans-model-b">${body}</div>${row.err ? `<div class="ans-model-err">${esc(row.err)}</div>` : ''}</div>`;
          })
          .join('');
    } else {
      const only = byModelEntries[0];
      const displayText = only?.row.text || r.text || '';
      const modelLabel = only ? only.m.name : '';
      b.className = 'body';
      b.innerHTML =
        (stale ? '<div class="stale">The question, length, or model version changed. Run again.</div>' : '') +
        (modelLabel ? `<div class="ans-model-h solo">${esc(modelLabel)}</div>` : '') +
        (S.tokView[l] && r.done && displayText ? hl(displayText, S.tokView[l] as string) : esc(displayText));
    }
    const ae = $(`#ae-${l}`);
    if (ae) ae.textContent = (r && r.err) || '';
    const as = $(`#as-${l}`);
    if (as) {
      const primaryText = r?.text || byModelEntries[0]?.row.text || '';
      as.textContent = ok && primaryText
        ? `${wordCount(primaryText)} words, ${charCount(primaryText)} characters`
        : r && r.busy
          ? 'Generating…'
          : 'Output';
    }
    f.innerHTML = ok
      ? models()
          .map((m) => `<span class="mc">${esc(m.short)} <b>${fmt(stat(l, m).outT)}</b></span>`)
          .join('') +
        (r && r.text
          ? `<select class="tv" data-tv="${l}" aria-label="Highlight tokens"><option value="">Tokens off</option>${encs
              .map(
                (e) =>
                  `<option value="${e}"${S.tokView[l] === e ? ' selected' : ''}>Show ${encShort[e] || e}</option>`,
              )
              .join('')}</select>`
          : '')
      : '';
  };

  const renderAnswers = () => {
    const boxEl = $('#answers');
    if (!boxEl) return;
    if (
      [...boxEl.children]
        .map((n) => n.id.slice(2))
        .join() !== S.langs.join()
    ) {
      boxEl.innerHTML = S.langs.map(ansHTML).join('');
    }
    S.langs.forEach(updateAnswer);
  };

  const renderModels = () => {
    const list = $('#mlist');
    if (!list || !catalog) return;
    list.innerHTML =
      `<div class="mrow mhd" aria-hidden="true"><span></span><span class="mh-model">Model</span><span class="mh-in">In $/1M</span><span class="mh-out">Out $/1M</span></div>` +
      catalog.models
        .map((m) => {
          const onM = S.models.includes(m.id);
          const p = price(m);
          const rateHint = `${encShort[m.enc] || m.enc}${m.est ? ' · example rates' : ' · list rates'}${m.legacy ? ', 2019' : ''}`;
          return `<div class="mrow${onM ? ' on' : ''}" data-row="${m.id}">
  <input type="checkbox" data-m="${m.id}"${onM ? ' checked' : ''} aria-label="Select ${esc(m.name)}">
  <span class="mn" title="${esc(rateHint)}"><span class="mn-name">${esc(m.name)}</span><small>${esc(rateHint)}</small></span>
  <span class="pv" title="Input USD per 1M tokens">${p.pin}</span>
  <span class="pv" title="Output USD per 1M tokens">${p.pout}</span>
</div>`;
        })
        .join('') +
      `<div class="meta price-note"><span>${S.models.length} selected</span><span>Input / output rates are list prices in USD per 1M tokens.</span></div>`;
  };

  const renderLen = () => {
    $$('#len .pill').forEach((b) => {
      const btn = b as HTMLElement;
      btn.setAttribute('aria-pressed', String(+(btn.dataset.w || 0) === S.words));
    });
  };

  const renderDock = () => {
    const dock = $('#dock');
    if (!dock) return;
    dock.innerHTML =
      `<span class="lab">Drag or tap to add</span>` +
      Object.keys(langMeta)
        .map((l) => {
          const used = S.langs.includes(l);
          return `<span class="lchip" draggable="${!used}" data-l="${l}" role="button" tabindex="${used ? -1 : 0}" aria-disabled="${used}" style="--c:${colorOf(l)}" title="${used ? 'Already in the flow' : 'Drag into Languages, or press to add'}"><em>⋮⋮</em><i></i>${esc(langMeta[l].name)}</span>`;
        })
        .join('');
  };

  const renderDZ = () => {
    const dz = $('#dz');
    if (!dz) return;
    dz.innerHTML = S.langs.length
      ? S.langs
          .map(
            (l) =>
              `<span class="lchip" style="--c:${colorOf(l)}"><i></i>${esc(langMeta[l]?.name || l)}<button type="button" class="x" data-rm="${l}" aria-label="Remove ${esc(langMeta[l]?.name || l)}">×</button></span>`,
          )
          .join('')
      : `<span class="empty">Drop languages here</span>`;
  };

  const focusAnswer = (l: string) => {
    const n = $(`#a-${l}`);
    if (!n) return;
    if (stacked()) n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else {
      const b = box(`a-${l}`);
      const v = S.view || (S.view = { x: 0, y: 0, z: 1 });
      if (b) {
        v.x = vp.clientWidth / 2 - (b.x + b.w / 2) * v.z;
        v.y = vp.clientHeight / 2 - (b.y + b.h / 2) * v.z;
        world.style.transition = 'transform .35s ease';
        applyView();
        setTimeout(() => {
          world.style.transition = '';
        }, 380);
        save();
      }
    }
    n.style.zIndex = String(++zTop);
    n.classList.remove('flash');
    void n.offsetWidth;
    n.classList.add('flash');
  };

  const renderMetrics = () => {
    const panel = $('#metrics');
    if (!panel) return;
    const ms = models();
    const allLangs = S.langs;
    const L = allLangs.filter(fresh);
    if (!allLangs.length) {
      panel.innerHTML = `
   <div class="mh"><h2>Run metrics</h2></div>
   <p class="note">Drag at least one language into the flow, then run the workflow.</p>`;
      return;
    }
    if (!ms.length) {
      panel.innerHTML = `
   <div class="mh"><h2>Run metrics</h2></div>
   <p class="note">Select at least one model to compare costs.</p>`;
      return;
    }
    if (!L.length) {
      panel.innerHTML = `
   <div class="mh"><h2>Run metrics</h2></div>
   <p class="note">Run the workflow to generate answers. Metrics appear here only for languages that finished.</p>`;
      return;
    }
    // Drop rows that still have no token counts (tokenize still in flight).
    const rows = L.filter((l) => ms.some((m) => stat(l, m).outT > 0 || stat(l, m).inT > 0));
    if (!rows.length) {
      panel.innerHTML = `
   <div class="mh"><h2>Run metrics</h2></div>
   <p class="note">Counting tokens for the finished answers…</p>`;
      void refreshCountsThenUi();
      return;
    }
    const grid: Record<string, Record<string, ReturnType<typeof stat>>> = {};
    ms.forEach((m) => {
      grid[m.id] = {};
      rows.forEach((l) => {
        grid[m.id][l] = stat(l, m);
      });
    });
    const run = ms
      .map((m) => ({
        m,
        usd: rows.reduce((a, l) => a + grid[m.id][l].usd, 0),
        outT: rows.reduce((a, l) => a + grid[m.id][l].outT, 0),
      }))
      .sort((a, b) => a.usd - b.usd);
    const cheap = run[0];
    const dear = run[run.length - 1];
    const maxRun = Math.max(1e-12, ...run.map((r) => r.usd));
    if (!rows.includes(S.base || '')) S.base = rows.includes('en') ? 'en' : rows[0];
    const baseL = S.base || rows[0];
    if (!cheap || !baseL) {
      panel.innerHTML = `
   <div class="mh"><h2>Run metrics</h2></div>
   <p class="note">Run the workflow to compare tokens and cost.</p>`;
      return;
    }
    const val = (m: TokeniserModel, l: string) => {
      const s = grid[m.id][l];
      if (S.metric === 'tok') return { v: s.outT, t: fmt(s.outT) };
      if (S.metric === 'x') {
        const b = grid[m.id][baseL].outT || 1;
        const r = s.outT / b;
        return { v: r, t: `${r < 1 ? r.toFixed(2) : r.toFixed(1)}×` };
      }
      if (S.metric === 'cost') return { v: s.usd, t: usd(s.usd) };
      return { v: s.tpw, t: s.tpw.toFixed(2) };
    };
    const all: number[] = [];
    ms.forEach((m) => rows.forEach((l) => all.push(val(m, l).v)));
    const hmax = Math.max(1e-12, ...all);
    const hmin = Math.min(...all);
    const cm = cheap.m;
    const worstL = rows.filter((l) => l !== baseL).sort((a, b) => grid[cm.id][b].outT - grid[cm.id][a].outT)[0];
    let encLine = '';
    if (worstL && ms.length > 1) {
      const byTok = ms.slice().sort((a, b) => grid[a.id][worstL].outT - grid[b.id][worstL].outT);
      const lo = byTok[0];
      const hi = byTok[byTok.length - 1];
      if (lo.enc !== hi.enc) {
        encLine = ` The same ${esc(langMeta[worstL]?.name || worstL)} answer takes <b>${fmt(grid[hi.id][worstL].outT)}</b> tokens on ${esc(hi.short)} but <b>${fmt(grid[lo.id][worstL].outT)}</b> on ${esc(lo.short)}.`;
      }
    }
    const pending = allLangs.length - rows.length;

    const latestLang =
      (S.lastRunLang && rows.includes(S.lastRunLang) ? S.lastRunLang : null) || rows[rows.length - 1];
    const latestStat = latestLang ? grid[cm.id][latestLang] : null;

    panel.innerHTML = `
   <div class="mh"><h2>Run metrics</h2><span class="badge m">Measured</span></div>
   ${pending ? `<p class="note">${pending} language${pending === 1 ? '' : 's'} not run yet — only finished answers are counted below.</p>` : ''}
   <div class="cards3">
     <div class="kc" style="--k:var(--lime)"><span class="kl">Cheapest</span><b class="kv kn">${esc(cheap.m.name)}</b><span class="ks">${esc(encLabel[cheap.m.enc] || cheap.m.enc)}</span></div>
     <div class="kc" style="--k:var(--mag)"><span class="kl">Most expensive</span><b class="kv kn">${ms.length > 1 ? esc(dear.m.name) : '–'}</b><span class="ks">${ms.length > 1 ? esc(encLabel[dear.m.enc] || dear.m.enc) : 'Tick more models'}</span></div>
     <div class="kc" style="--k:${latestLang ? colorOf(latestLang) : 'var(--cyan)'}"><span class="kl">Latest Run</span><b class="kv kn">${latestLang ? esc(langMeta[latestLang]?.name || latestLang) : '–'}</b><span class="ks">${latestLang && latestStat ? `${latestStat.w} words · ${fmt(latestStat.outT)} tok` : 'Run the workflow'}</span></div>
   </div>
   <div class="sec"><h3>Run cost by model <span>${rows.length} finished language${rows.length === 1 ? '' : 's'}, &lt;${S.words} words</span></h3>
     ${run
       .map(
         (r, i) =>
           `<div class="crow${i === 0 ? ' best' : ''}"><span class="n">${esc(r.m.short)}</span><span class="bar"><i style="width:${Math.max(2, (r.usd / maxRun) * 100).toFixed(1)}%"></i></span><span class="r">${usd(r.usd)}</span><span class="t">${fmt(r.outT)} tok</span></div>`,
       )
       .join('')}
   </div>
   <div class="sec"><h3>Language × model</h3>
     <div class="tabs" role="tablist">${Object.keys(METRICS)
       .map((k) =>
         k === 'x'
           ? `<span class="tabwrap"><button type="button" role="tab" aria-selected="${S.metric === k}" aria-haspopup="menu" aria-expanded="${menuOpen && S.metric === 'x'}" data-mt="x" title="Choose the language to compare with"><i class="dot" style="background:${colorOf(baseL)}"></i>× ${esc(langMeta[baseL]?.name || baseL)}<span class="caret">▾</span></button>${
               menuOpen && S.metric === 'x'
                 ? `<div class="bmenu" role="menu">${rows
                     .map(
                       (l) =>
                         `<button type="button" role="menuitemradio" aria-checked="${l === baseL}" data-base="${l}" style="--c:${colorOf(l)}"><i></i>${esc(langMeta[l]?.name || l)}${l === baseL ? '<span class="ck">✓</span>' : ''}</button>`,
                     )
                     .join('')}</div>`
                 : ''
             }</span>`
           : `<button type="button" role="tab" aria-selected="${S.metric === k}" data-mt="${k}">${METRICS[k]}</button>`,
       )
       .join('')}</div>
     <div class="tw"><table class="heat"><thead><tr><th></th>${ms.map((m) => `<th>${esc(m.short)}</th>`).join('')}</tr></thead><tbody>
       ${rows
         .map((l) => {
           return `<tr${S.metric === 'x' && l === baseL ? ' class="basey"' : ''}><td><button type="button" class="lname" data-go="${l}" title="Show the ${esc(langMeta[l]?.name || l)} answer"><i style="background:${colorOf(l)}"></i>${esc(langMeta[l]?.name || l)}</button></td>${ms
             .map((m) => {
               const x = val(m, l);
               const a = hmax > hmin ? (x.v - hmin) / (hmax - hmin) : 0;
               return `<td style="--a:${Math.round(8 + a * 52)}%">${x.t}</td>`;
             })
             .join('')}</tr>`;
         })
         .join('')}
     </tbody></table></div>
     ${
       worstL
         ? `<div class="tax">${(() => {
             const r = grid[cm.id][worstL].outT / Math.max(1, grid[cm.id][baseL].outT);
             return r >= 1.05
               ? `<b>${esc(langMeta[worstL]?.name || worstL)}</b> needs <b>${r.toFixed(1)}×</b> the tokens of ${esc(langMeta[baseL]?.name || baseL)} on ${esc(cm.short)}.`
               : `On ${esc(cm.short)}, no language needs more tokens than ${esc(langMeta[baseL]?.name || baseL)}.`;
           })()}${encLine}</div>`
         : `<p class="note">Run more languages to compare them with ${esc(langMeta[rows[0]]?.name || rows[0])}.</p>`
     }
   </div>
`;
  };

  const refreshCountsThenUi = async () => {
    const pairs: { text: string; enc: string }[] = [];
    models().forEach((m) => {
      pairs.push({ text: S.q, enc: m.enc });
      S.langs.forEach((l) => {
        pairs.push({ text: promptFor(l), enc: m.enc });
        const text = answerTextFor(l, m);
        if (text) pairs.push({ text, enc: m.enc });
      });
    });
    await ensureCounts(pairs);
    S.langs.forEach(updateAnswer);
    renderMetrics();
  };

  const refresh = () => {
    renderModels();
    renderLen();
    renderDock();
    renderDZ();
    renderAnswers();
    renderMetrics();
    layoutAll();
    checkFlow(false);
    save();
    void refreshCountsThenUi();
  };

  const resetAnswerPos = () => {
    Object.keys(S.pos).forEach((k) => {
      if (k.startsWith('a-')) delete S.pos[k];
    });
  };

  const langsChanged = () => {
    resetAnswerPos();
    refresh();
    requestAnimationFrame(() => {
      resetAnswerPos();
      layoutAll();
      fit();
    });
  };

  const addLang = (l: string) => {
    if (!langMeta[l] || S.langs.includes(l)) return;
    pushUndo();
    S.langs.push(l);
    langsChanged();
  };

  const removeLang = (l: string) => {
    if (!l || !S.langs.includes(l)) return;
    pushUndo();
    S.langs = S.langs.filter((x) => x !== l);
    delete S.res[l];
    delete S.tokView[l];
    delete S.pos[`a-${l}`];
    delete S.size[`a-${l}`];
    if (S.lastRunLang === l) S.lastRunLang = null;
    langsChanged();
  };

  const setMw = (w: number) => {
    S.mw = Math.max(340, Math.min(700, w));
    root.style.setProperty('--mw', `${S.mw}px`);
  };

  const setRunBtn = () => {
    const b = $('#run');
    if (!b) return;
    b.classList.toggle('stop', running);
    const span = b.querySelector('span');
    if (span) span.textContent = running ? 'Stop' : 'Run workflow';
  };

  const order = () => {
    const adj: Record<string, string[]> = {};
    CFG_IDS.forEach((id) => {
      adj[id] = [];
    });
    S.edges.forEach(([a, b]) => {
      if (adj[a] && adj[b]) {
        adj[a].push(b);
        adj[b].push(a);
      }
    });
    const out: string[] = [];
    const seen = new Set<string>();
    const q = ['n-model'];
    while (q.length) {
      const x = q.shift()!;
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
      adj[x].forEach((y) => q.push(y));
    }
    return out.length === 4 ? out : [...CFG_IDS];
  };

  const run = async () => {
    if (running) {
      abort?.abort();
      running = false;
      setRunBtn();
      return;
    }
    if (checkFlow(true).length) return;
    if (!S.q.trim()) {
      ($('#q') as HTMLTextAreaElement | null)?.focus();
      $('#n-q')?.classList.add('warn');
      setTimeout(() => $('#n-q')?.classList.remove('warn'), 900);
      return;
    }
    if (!S.langs.length) {
      $('#n-lang')?.classList.add('warn');
      const warn = $('#warn');
      if (warn) warn.textContent = 'Drop at least one language into Languages';
      setTimeout(() => {
        $('#n-lang')?.classList.remove('warn');
        if (warn) warn.textContent = '';
      }, 1800);
      return;
    }
    running = true;
    setRunBtn();
    CFG_IDS.forEach((id) => $(`#${id}`)?.classList.remove('done'));
    drawWires();
    for (const id of order()) {
      if (!running) break;
      $(`#${id}`)?.classList.add('busy');
      await wait(160);
      $(`#${id}`)?.classList.remove('busy');
      if (!running) break;
      $(`#${id}`)?.classList.add('done');
    }
    for (const l of S.langs.slice()) {
      if (!running) break;
      const key = runKey(l);
      if (fresh(l)) continue;
      const selected = models();
      if (!selected.length) break;
      S.res[l] = { text: '', busy: true, done: false, prompt: key, err: '', byModel: {} };
      updateAnswer(l);
      drawWires();
      const byModel: NonNullable<AnswerRes['byModel']> = {};
      const errs: string[] = [];
      try {
        for (const m of selected) {
          if (!running) break;
          abort = new AbortController();
          const ver = versionOf(m);
          try {
            const out = await generateLanguageAnswer(
              opts.sessionId,
              opts.projectId,
              { question: S.q, lang: l, words: S.words, model: ver },
              abort.signal,
            );
            byModel[m.id] = {
              text: out.text.trim(),
              model: out.model || ver,
              err: out.simulated
                ? 'Classroom simulator (live model unavailable). Metrics still compare tokenisers.'
                : undefined,
            };
            if (out.simulated) {
              errs.push(`${m.short}: simulator`);
            }
          } catch (err) {
            const cancelled =
              (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
            if (cancelled) {
              S.res[l] = {
                text: byModel[selected[0]?.id]?.text || '',
                byModel: { ...byModel },
                busy: false,
                done: Object.keys(byModel).length > 0,
                prompt: key,
                err: 'Stopped.',
              };
              updateAnswer(l);
              throw err;
            }
            byModel[m.id] = {
              text: '',
              model: ver,
              err: err instanceof Error ? err.message : 'The answer could not be generated.',
            };
            errs.push(`${m.short}: failed`);
          }
        }
        if (!running) {
          S.res[l] = {
            text: byModel[selected[0]?.id]?.text || '',
            byModel,
            busy: false,
            done: false,
            prompt: key,
            err: 'Stopped.',
          };
          updateAnswer(l);
          break;
        }
        const primary = byModel[selected[0].id];
        S.res[l] = {
          text: primary?.text || Object.values(byModel).find((row) => row.text)?.text || '',
          byModel,
          busy: false,
          done: Object.values(byModel).some((row) => Boolean(row.text)),
          prompt: key,
          err: errs.length === selected.length
            ? 'Classroom simulator (live model unavailable). Metrics still compare tokenisers.'
            : errs.length
              ? errs.join(' · ')
              : '',
        };
        S.lastRunLang = l;
        await ensureCounts(
          [
            ...selected.map((m) => ({ text: byModel[m.id]?.text || '', enc: m.enc })),
            ...selected.map((m) => ({ text: promptFor(l), enc: m.enc })),
          ],
          false,
        );
      } catch (err) {
        const cancelled =
          (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
        if (!cancelled) {
          const keep = S.res[l]?.text || '';
          S.res[l] = {
            text: keep,
            byModel: S.res[l]?.byModel,
            busy: false,
            done: !!keep,
            prompt: key,
            err: err instanceof Error ? err.message : 'The answer could not be generated. Run again.',
          };
          updateAnswer(l);
        }
        if (cancelled || !running) break;
      }
      updateAnswer(l);
      renderMetrics();
      drawWires();
    }
    running = false;
    abort = null;
    setRunBtn();
    S.langs.forEach(updateAnswer);
    drawWires();
    renderMetrics();
    save();
    if (!completed && S.langs.some(fresh)) {
      completed = true;
      opts.onComplete?.();
    }
  };

  // --- wire events ---
  on($('#toast'), 'click', (e) => {
    if ((e.target as HTMLElement).id === 'toastUndo') undo();
  });
  on($('#undo'), 'click', () => undo());
  on(document, 'keydown', (e) => {
    const ke = e as KeyboardEvent;
    if ((ke.ctrlKey || ke.metaKey) && !ke.shiftKey && ke.key.toLowerCase() === 'z' && !(ke.target as HTMLElement).closest?.('input,textarea,select')) {
      ke.preventDefault();
      undo();
    }
    if (menuOpen && ke.key === 'Escape') {
      menuOpen = false;
      renderMetrics();
    }
  });

  on(vp, 'pointerdown', (e) => {
    const pe = e as PointerEvent;
    if (stacked() || pe.button !== 0) return;
    const target = pe.target as HTMLElement;
    if (target.closest('.ans-close,[data-rm]')) return;
    const handle = target.closest('.h') as HTMLElement | null;
    const rz = target.closest('.rz') as HTMLElement | null;
    const head = target.closest('.nh') as HTMLElement | null;
    const nodeEl = target.closest('.node') as HTMLElement | null;
    const blocking = target.closest(
      'input,textarea,select,button,a,label,.h,.rz,.pill,.mrow,.dz,.lchip,.ans-close,.tv,.pv,.body',
    );
    if (handle) {
      const n = handle.parentElement!;
      const b = box(n.id);
      const s = handle.dataset.s || 'r';
      if (!b) return;
      link = { id: n.id, side: s, from: anchor(b, s), to: null };
      vp.classList.add('linking');
      vp.setPointerCapture(pe.pointerId);
      pe.preventDefault();
      return;
    }
    if (rz) {
      const id = rz.dataset.rz || '';
      const n = $(`#${id}`);
      if (!n) return;
      const nb = n.querySelector('.nb') as HTMLElement | null;
      const body = n.querySelector('.body') as HTMLElement | null;
      const measured =
        (body && parseFloat(getComputedStyle(body).maxHeight)) ||
        (nb && (parseFloat(getComputedStyle(nb).maxHeight) || nb.clientHeight)) ||
        S.size[id]?.bh ||
        160;
      act = {
        type: 'rz',
        id,
        sx: pe.clientX,
        sy: pe.clientY,
        w: n.offsetWidth,
        bh: Number.isFinite(measured) && measured > 0 ? measured : 160,
      };
      n.classList.add('resizing');
      vp.setPointerCapture(pe.pointerId);
      pe.preventDefault();
      return;
    }
    if (head || (nodeEl && !blocking)) {
      const n = (head?.parentElement || nodeEl) as HTMLElement;
      if (!n?.id || !S.pos[n.id]) {
        if (n?.id && !S.pos[n.id]) S.pos[n.id] = defaultPos(n.id);
      }
      const p = S.pos[n.id];
      if (!p) return;
      act = { type: 'node', id: n.id, sx: pe.clientX, sy: pe.clientY, x: p.x, y: p.y };
      n.classList.add('dragging');
      n.style.zIndex = String(++zTop);
      vp.setPointerCapture(pe.pointerId);
      pe.preventDefault();
      return;
    }
    if (target.closest('.node,.zoom,.hint,.cut,.hit,.toast,.palette')) return;
    act = { type: 'pan', sx: pe.clientX, sy: pe.clientY, x: S.view?.x || 0, y: S.view?.y || 0 };
    vp.classList.add('panning');
    vp.setPointerCapture(pe.pointerId);
  });

  on(vp, 'pointermove', (e) => {
    const pe = e as PointerEvent;
    if (link) {
      link.to = toWorld(pe.clientX, pe.clientY);
      const t = document.elementFromPoint(pe.clientX, pe.clientY);
      const n = t?.closest('.node') as HTMLElement | null;
      const tgt = n && (CFG_IDS as readonly string[]).includes(n.id) && n.id !== link.id ? n : null;
      if (lastTarget && lastTarget !== tgt) lastTarget.classList.remove('target');
      if (tgt) tgt.classList.add('target');
      lastTarget = tgt;
      drawWires();
      return;
    }
    if (!act) return;
    const z = S.view?.z || 1;
    if (act.type === 'pan' && S.view) {
      S.view.x = (act.x || 0) + pe.clientX - act.sx;
      S.view.y = (act.y || 0) + pe.clientY - act.sy;
      applyView();
    }
    if (act.type === 'node' && act.id) {
      S.pos[act.id] = { x: (act.x || 0) + (pe.clientX - act.sx) / z, y: (act.y || 0) + (pe.clientY - act.sy) / z };
      place(act.id);
      drawWires();
    }
    if (act.type === 'rz' && act.id) {
      const w = Math.max(180, Math.min(920, (act.w || 290) + (pe.clientX - act.sx) / z));
      const bh = Math.max(72, Math.min(720, (act.bh || 160) + (pe.clientY - act.sy) / z));
      S.size[act.id] = { w, bh };
      applyNodeSize(act.id);
      drawWires();
    }
  });

  const endPointer = () => {
    if (link) {
      if (lastTarget) {
        const a = link.id;
        const b = lastTarget.id;
        if (!S.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) {
          pushUndo();
          S.edges.push([a, b]);
        }
        lastTarget.classList.remove('target');
        lastTarget = null;
      }
      link = null;
      vp.classList.remove('linking');
      checkFlow(false);
      drawWires();
      save();
      return;
    }
    if (act) {
      if (act.id) {
        $(`#${act.id}`)?.classList.remove('dragging', 'resizing');
      }
      vp.classList.remove('panning');
      act = null;
      save();
    }
  };
  on(vp, 'pointerup', endPointer);
  on(vp, 'pointercancel', endPointer);

  on(
    vp,
    'wheel',
    (e) => {
      const we = e as WheelEvent;
      if (stacked()) return;
      const scrollable = (we.target as HTMLElement).closest('.body,#mlist') as HTMLElement | null;
      if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return;
      we.preventDefault();
      if (we.ctrlKey || we.metaKey) {
        const r = vp.getBoundingClientRect();
        zoomAt(Math.exp(-we.deltaY * 0.01), we.clientX - r.left, we.clientY - r.top);
      } else if (S.view) {
        S.view.x -= we.deltaX;
        S.view.y -= we.deltaY;
        applyView();
        save();
      }
    },
    { passive: false },
  );

  on(svg, 'pointerover', (e) => {
    const t = (e.target as HTMLElement).closest('[data-e]') as HTMLElement | null;
    if (t) {
      const i = +t.dataset.e!;
      if (i !== hoverEdge) {
        hoverEdge = i;
        drawWires();
      }
    }
  });
  on(svg, 'pointerout', (e) => {
    const pe = e as PointerEvent;
    const rel = pe.relatedTarget as HTMLElement | null;
    if (!rel || !rel.closest?.('[data-e]')) {
      if (hoverEdge !== -1) {
        hoverEdge = -1;
        drawWires();
      }
    }
  });
  on(svg, 'click', (e) => {
    const t = (e.target as HTMLElement).closest('[data-e]') as HTMLElement | null;
    if (!t) return;
    const idx = +t.dataset.e!;
    const [a, b] = S.edges[idx] || [];
    pushUndo();
    S.edges.splice(idx, 1);
    hoverEdge = -1;
    toast(`Removed the wire between ${CFG_NAMES[a as CfgId] || a} and ${CFG_NAMES[b as CfgId] || b}.`);
    checkFlow(false);
    drawWires();
    save();
  });

  on($('#zin'), 'click', () => zoomAt(1.2, vp.clientWidth / 2, vp.clientHeight / 2));
  on($('#zout'), 'click', () => zoomAt(1 / 1.2, vp.clientWidth / 2, vp.clientHeight / 2));
  on($('#zfit'), 'click', () => fit());
  on($('#tidy'), 'click', () => {
    S.pos = {};
    S.size = {};
    const answers = $('#answers');
    if (answers) answers.innerHTML = '';
    renderAnswers();
    layoutAll();
    requestAnimationFrame(() => {
      layoutAll();
      fit();
    });
    save();
  });
  on($('#run'), 'click', () => {
    void run();
  });

  const split = $('#split');
  on(split, 'pointerdown', (e) => {
    const pe = e as PointerEvent;
    split?.setPointerCapture(pe.pointerId);
    split?.classList.add('on');
  });
  on(split, 'pointermove', (e) => {
    const pe = e as PointerEvent;
    if (split?.classList.contains('on')) setMw(window.innerWidth - pe.clientX - 3);
  });
  on(split, 'pointerup', () => {
    split?.classList.remove('on');
    drawWires();
    save();
  });
  on(split, 'keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'ArrowLeft') {
      setMw(S.mw + 20);
      save();
    }
    if (ke.key === 'ArrowRight') {
      setMw(S.mw - 20);
      save();
    }
  });

  on($('#dock'), 'dragstart', (e) => {
    const de = e as DragEvent;
    const c = (de.target as HTMLElement).closest('.lchip') as HTMLElement | null;
    if (c) de.dataTransfer?.setData('text/plain', c.dataset.l || '');
  });
  on($('#dock'), 'click', (e) => {
    const c = (e.target as HTMLElement).closest('.lchip') as HTMLElement | null;
    if (c && c.getAttribute('aria-disabled') !== 'true') addLang(c.dataset.l || '');
  });
  on($('#dock'), 'keydown', (e) => {
    const ke = e as KeyboardEvent;
    const c = (ke.target as HTMLElement).closest('.lchip') as HTMLElement | null;
    if (c && (ke.key === 'Enter' || ke.key === ' ')) {
      ke.preventDefault();
      addLang(c.dataset.l || '');
    }
  });
  const langNode = $('#n-lang');
  on(langNode, 'dragover', (e) => {
    e.preventDefault();
    langNode?.classList.add('drop');
  });
  on(langNode, 'dragleave', () => langNode?.classList.remove('drop'));
  on(langNode, 'drop', (e) => {
    const de = e as DragEvent;
    de.preventDefault();
    langNode?.classList.remove('drop');
    addLang(de.dataTransfer?.getData('text/plain') || '');
  });
  on($('#dz'), 'click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-rm]') as HTMLElement | null;
    if (b) {
      e.preventDefault();
      e.stopPropagation();
      removeLang(b.dataset.rm || '');
    }
  });
  on($('#answers'), 'click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-rm]') as HTMLElement | null;
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    removeLang(b.dataset.rm || '');
  });

  on($('#mlist'), 'click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input[type=checkbox], .mhd')) return;
    const row = t.closest('.mrow[data-row]') as HTMLElement | null;
    if (!row) return;
    const box = row.querySelector('input[type=checkbox]') as HTMLInputElement | null;
    if (!box) return;
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });

  on($('#mlist'), 'change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.dataset.m) {
      if (!t.checked && S.models.length === 1) {
        t.checked = true;
        const warn = $('#warn');
        if (warn) {
          warn.textContent = 'Keep at least one model selected';
          setTimeout(() => {
            warn.textContent = '';
          }, 1800);
        }
        return;
      }
      if (!catalog) return;
      pushUndo();
      S.models = catalog.models
        .filter((m) => (m.id === t.dataset.m ? t.checked : S.models.includes(m.id)))
        .map((m) => m.id);
      refresh();
      requestAnimationFrame(drawWires);
    }
  });

  on($('#q'), 'input', (e) => {
    S.q = (e.target as HTMLTextAreaElement).value;
    S.langs.forEach(updateAnswer);
    renderMetrics();
    save();
    if (qTokTimer) clearTimeout(qTokTimer);
    qTokTimer = setTimeout(() => {
      void refreshCountsThenUi();
    }, 280);
  });

  on($('#len'), 'click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-w]') as HTMLElement | null;
    if (b) {
      const w = +b.dataset.w!;
      if (w === S.words) return;
      pushUndo();
      S.words = w;
      refresh();
    }
  });

  on($('#answers'), 'change', (e) => {
    const t = e.target as HTMLSelectElement;
    const lang = t.dataset?.tv;
    if (!lang) return;
    S.tokView[lang] = (t.value || '') as EncId | '';
    const row = S.res[lang];
    const enc = S.tokView[lang];
    if (enc && row) {
      const texts = [
        row.text,
        ...Object.values(row.byModel || {}).map((item) => item.text),
      ].filter(Boolean);
      if (texts.length) {
        void ensureCounts(
          texts.map((text) => ({ text, enc: enc as string })),
          true,
        ).then(() => {
          updateAnswer(lang);
          drawWires();
          save();
        });
        return;
      }
    }
    updateAnswer(lang);
    drawWires();
    save();
  });

  on(document, 'click', (e) => {
    if (menuOpen && !(e.target as HTMLElement).closest?.('.tabwrap')) {
      menuOpen = false;
      renderMetrics();
    }
  });

  on($('#metrics'), 'click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-mt]') as HTMLElement | null;
    if (b) {
      const k = b.dataset.mt as LabState['metric'];
      menuOpen = k === 'x' ? !(S.metric === 'x' && menuOpen) && S.langs.length > 1 : false;
      if (k !== S.metric) pushUndo();
      S.metric = k;
      renderMetrics();
      save();
      return;
    }
    const c = (e.target as HTMLElement).closest('[data-base]') as HTMLElement | null;
    if (c) {
      S.base = c.dataset.base;
      menuOpen = false;
      renderMetrics();
      save();
      focusAnswer(c.dataset.base || '');
      return;
    }
    const g = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
    if (g) focusAnswer(g.dataset.go || '');
  });

  let lastW = window.innerWidth;
  on(window, 'resize', () => {
    layoutAll();
    if (Math.abs(window.innerWidth - lastW) > 80) {
      lastW = window.innerWidth;
      fit();
    }
  });

  const answersEl = $('#answers');
  const ro = answersEl ? new ResizeObserver(() => drawWires()) : null;
  if (answersEl && ro) ro.observe(answersEl);
  cleanups.push(() => ro?.disconnect());

  // boot — keep the loading screen up until catalog + first layout are ready
  void (async () => {
    try {
      catalog = await loadTokeniserCatalog(opts.sessionId, opts.projectId);
      langMeta = Object.fromEntries(
        catalog.langs.map((l) => [l.id, { name: l.name, prompt: l.prompt, c: l.c }]),
      );
      encShort = Object.fromEntries(
        Object.entries(catalog.encodings).map(([k, v]) => [k, v.short]),
      );
      encLabel = Object.fromEntries(
        Object.entries(catalog.encodings).map(([k, v]) => [k, v.label]),
      );
      S.models = S.models.filter((id) => catalog!.models.some((m) => m.id === id));
      if (!S.models.length) S.models = [...catalog.defaults.models];
      // Drop prices keyed to removed model ids from older lab versions.
      Object.keys(S.prices).forEach((id) => {
        if (!catalog!.models.some((m) => m.id === id)) delete S.prices[id];
      });
      // Seed the Vertex model id for each family (one version each).
      catalog.models.forEach((m) => {
        S.versions[m.id] = defaultVersionOf(m);
      });
      Object.keys(S.versions).forEach((id) => {
        if (!catalog!.models.some((m) => m.id === id)) delete S.versions[id];
      });
      S.langs = S.langs.filter((l) => langMeta[l]);
      if (!S.langs.length) S.langs = [...catalog.defaults.langs];
      S.inr = S.inr || catalog.defaults.inr;

      const len = $('#len');
      if (len) {
        len.innerHTML = catalog.lengths
          .map(
            (n) =>
              `<button type="button" class="pill" data-w="${n}" aria-label="Less than ${n} words">&lt;${n}<small>words</small></button>`,
          )
          .join('');
      }
      CFG_IDS.forEach((id) => $(`#${id}`)?.insertAdjacentHTML('beforeend', HANDLES));
      setMw(S.mw || 420);
      const q = $('#q') as HTMLTextAreaElement | null;
      if (q) q.value = S.q;
      refresh();
      requestAnimationFrame(() => {
        layoutAll();
        if (!S.view) fit();
        else applyView();
        // Second frame so node geometry is committed before we uncover the canvas.
        requestAnimationFrame(revealLab);
      });
      if (document.fonts?.ready) void document.fonts.ready.then(() => layoutAll());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load Exercise 5.';
      const bootT = root.querySelector('.boot-t');
      if (bootT) bootT.textContent = message;
      const spin = root.querySelector('.boot .spin');
      if (spin instanceof HTMLElement) spin.style.display = 'none';
      const warn = $('#warn');
      if (warn) warn.textContent = message;
      // Keep the boot screen visible so the unfinished canvas never flashes.
    }
  })();

  return () => {
    if (running) abort?.abort();
    if (toastT) clearTimeout(toastT);
    if (qTokTimer) clearTimeout(qTokTimer);
    cleanups.forEach((fn) => fn());
    host.classList.remove('is-booting');
    host.innerHTML = '';
  };
}
