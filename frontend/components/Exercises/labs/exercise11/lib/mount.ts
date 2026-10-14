/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import { loadRagCatalog, runRagAsk, type RagCatalog, type RagModel } from './api';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { defaultVersionOf } from '../../../modelVersions';
import { cloneState, createUndoStack, syncUndoButton, UNDO_BUTTON_HTML } from '../../../undoHistory';
import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';
import { labBuddyHtml } from '../../../labBuddy';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

const TEMPLATE = `<header>
  ${exerciseBrandHtml(11, 'Exercise - 11 : RAG Chatbot')}
  ${THEME_TOGGLE_HTML}
  ${UNDO_BUTTON_HTML}
  <label class="msel" title="The model that writes the answers">
    <span>Models</span>
    <select id="provSel"></select>
  </label>
  <button class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
  <button class="icon" id="settingsBtn" title="Model parameters: temperature, top-p, output cap" aria-label="Model parameters"></button>
</header>

<main>
  <div class="col">
    <section class="card doc">
      <div class="chead"><span class="n">1</span><div class="ct"><b>Document</b><span>The chatbot's only source</span></div>
        <button class="mini" data-act="upload" title="Upload a .pdf, .txt or .md file">Upload</button>
        <button class="mini li" data-act="sampleDoc" title="Load a sample building code written for this class">Example</button></div>
      <div class="docwrap" id="docwrap">
        <textarea id="doc" spellcheck="false" placeholder="Paste the text of a building code or IS standard here, or upload a .pdf, .txt or .md file. You can also drop a file here."></textarea>
        <div class="dropnote">Drop the file to load it</div>
      </div>
      <div class="docmeta" id="docMeta"></div>
      <input type="file" id="fileIn" accept=".pdf,.txt,.md,text/plain,application/pdf" hidden>
    </section>

    <section class="card chunks">
      <div class="chead"><span class="n">2</span><div class="ct"><b>Chunks</b><span id="chunkSub">How the document is cut up for search</span></div></div>
      <div class="segctl" id="modeCtl" role="group" aria-label="How to split the document">
        <button data-mode="words" title="A fixed window of words that slides along the text">Fixed words</button>
        <button data-mode="sentences" title="Whole sentences, packed up to the chunk size">Sentences</button>
        <button data-mode="sections" title="Whole paragraphs and sections, packed up to the chunk size">Sections</button>
      </div>
      <div class="sl"><span>Chunk size</span><input type="range" id="size" min="20" max="400" step="10" aria-label="Chunk size in words"><b id="vSize"></b></div>
      <div class="sl"><span>Overlap</span><input type="range" id="overlap" min="0" max="100" step="5" aria-label="Overlap in words"><b id="vOverlap"></b></div>
      <div class="strip" id="strip" aria-label="Chunks of the document"></div>
      <div class="istat" id="istat"></div>
    </section>
  </div>

  <div class="col mid">
    <section class="card ask">
      <div class="chead"><span class="n">3</span><div class="ct"><b>Ask</b><span>Each question is answered on its own, from the chunks found for it</span></div></div>
      <div class="opts">
        <span class="opt" style="cursor:default">Chunks
          <span class="stepper"><button data-act="kDown" aria-label="Fewer chunks">−</button><b id="kVal"></b><button data-act="kUp" aria-label="More chunks">+</button></span></span>
        <span class="opt" style="cursor:default" title="Drop retrieved chunks whose similarity is below this score">Min. match
          <span class="stepper"><button data-act="minDown" aria-label="Lower minimum">−</button><b id="minVal" style="min-width:40px"></b><button data-act="minUp" aria-label="Higher minimum">+</button></span></span>
        <label class="opt" title="Tell the model to use only the retrieved chunks, and to say so when they don't contain the answer"><input type="checkbox" id="strict"><span class="sw"></span>Strict: chunks only</label>
        <label class="opt" title="Turn off to ask the model with no document at all"><input type="checkbox" id="useDoc"><span class="sw"></span>Use the document</label>
      </div>
      <textarea id="q"></textarea>
      <div class="pvline" id="pvline"></div>
      <button class="send" id="askBtn"></button>
    </section>

    <section class="card answers">
      <div class="ahead"><div class="ct"><b>Answers</b><span id="ansSub">Newest first · click an answer to see its chunks</span></div>
        <div class="tally" id="tally"></div>
        <button class="mini" data-act="clearAnswers" id="clearBtn">Clear</button></div>
      <div class="alist" id="alist" aria-live="polite"></div>
    </section>
  </div>

  <div class="col">
    <section class="card evid">
      <div class="chead"><span class="n">4</span><div class="ct"><b>Retrieved chunks</b><span>What the model was given for the selected answer</span></div></div>
      <div id="evq"></div>
      <div class="hits" id="hits"></div>
      <div class="evfoot"><span id="method"></span><span class="grow"></span><button class="mini" data-act="prompt" id="promptBtn">What the model received</button></div>
    </section>
  </div>
</main>

<div class="modal" id="setModal"><div class="mbox">
  <div class="mtitle"><span>Model parameters</span><button class="x" data-close>×</button></div>
  <div class="prm"><div class="prh"><span>Temperature</span><b id="vTemp"></b></div>
    <input type="range" id="temp" min="0" max="2" step="0.05"><div class="prd">Low = focused and repeatable. High = varied and creative.</div></div>
  <div class="prm"><div class="prh"><span>Top-p</span><b id="vTopp"></b></div>
    <input type="range" id="topp" min="0.05" max="1" step="0.05"><div class="prd">Keeps only the most likely words until their odds add up to p. 1 = off.</div></div>
  <div class="prm"><div class="prh"><span>Output cap</span><b id="vCap"></b></div>
    <input type="range" id="cap" min="50" max="1000" step="10"><div class="prd">The longest answer allowed, in tokens.</div></div>
  <div class="note">Claude accepts temperatures up to 1, so higher values are capped at 1 for Claude.</div>
  <div style="margin-top:14px"><button class="mini" data-act="resetParams" style="padding:6px 12px">Reset to defaults</button></div>
</div></div>
<div class="modal" id="viewModal"><div class="mbox wide" id="viewBox"></div></div>

<div id="toasts"></div>
<div class="sr" aria-live="polite" id="live"></div>`;

const STOP = new Set(
  'a an and are as at be been but by can could did do does for from had has have how i if in into is it its may more most must no not of on or other our shall should so such than that the their them then there these they this those to under up upon was we were what when where which while who why will with within would you your'.split(
    ' ',
  ),
);

const IC = {
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  fsOn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fsOff: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  ask: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
};

export function mountExercise11(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const unbindTheme = bindExerciseTheme(host);

  const $ = (s: string) => host.querySelector(s) as HTMLElement;
  const $$ = (s: string) => [...host.querySelectorAll(s)] as HTMLElement[];
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
  const estTok = (s: string) => Math.ceil((s || '').length / 4);
  const docText = () => (($('#doc') as HTMLTextAreaElement).value || '');

  let catalog: RagCatalog | null = null;
  let models: RagModel[] = [];
  let methodLabel = 'Exact KNN · keyword vectors (TF-IDF)';
  let sampleDoc = '';
  let sampleName = 'Sample campus code';
  let qExamples = [
    'e.g. What is the minimum nominal cover for a column?',
    'e.g. How long must props stay under a 5 m slab?',
    'e.g. What seismic zone factor should I use for a building in Chennai?',
  ];
  let UID = 1;
  let PH = 0;
  let completed = false;
  let pdfjsReady: Promise<any> | null = null;
  let docTimer: ReturnType<typeof setTimeout> | null = null;
  let pvTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const S = {
    prov: 'gemini-38-flash',
    ver: '',
    temp: 0.2,
    topp: 1,
    cap: 400,
    mode: 'words',
    size: 60,
    overlap: 10,
    k: 3,
    minScore: 0,
    preview: null as { i: number; score: number }[] | null,
    docSource: null as { name: string; pages?: number } | null,
    strict: true,
    useDoc: true,
    chunks: [] as string[],
    chunkSig: '',
    index: null as any,
    answers: [] as any[],
    sel: null as number | null,
    running: false,
    ctrl: null as AbortController | null,
    parsing: false as false | string,
  };

  type UndoSnap = {
    prov: string;
    ver: string;
    temp: number;
    topp: number;
    cap: number;
    mode: string;
    size: number;
    overlap: number;
    k: number;
    minScore: number;
    strict: boolean;
    useDoc: boolean;
    answers: typeof S.answers;
    sel: number | null;
    doc: string;
    docSource: typeof S.docSource;
    uid: number;
  };

  const undo = createUndoStack<UndoSnap>({ max: 40 });

  function snapshotUndo(): UndoSnap {
    return {
      prov: S.prov,
      ver: S.ver,
      temp: S.temp,
      topp: S.topp,
      cap: S.cap,
      mode: S.mode,
      size: S.size,
      overlap: S.overlap,
      k: S.k,
      minScore: S.minScore,
      strict: S.strict,
      useDoc: S.useDoc,
      answers: cloneState(S.answers),
      sel: S.sel,
      doc: (($('#doc') as HTMLTextAreaElement).value || ''),
      docSource: S.docSource ? { ...S.docSource } : null,
      uid: UID,
    };
  }

  function restoreUndo(s: UndoSnap) {
    S.prov = s.prov;
    S.ver = s.ver;
    S.temp = s.temp;
    S.topp = s.topp;
    S.cap = s.cap;
    S.mode = s.mode;
    S.size = s.size;
    S.overlap = s.overlap;
    S.k = s.k;
    S.minScore = s.minScore;
    S.strict = s.strict;
    S.useDoc = s.useDoc;
    S.answers = cloneState(s.answers);
    S.sel = s.sel;
    S.docSource = s.docSource ? { ...s.docSource } : null;
    UID = s.uid;
    ($('#doc') as HTMLTextAreaElement).value = s.doc;
    S.chunkSig = '';
    S.index = null;
    S.preview = null;
    ($('#provSel') as HTMLSelectElement).value = S.prov;
    syncVer();
    renderAll();
    renderPreviewLine();
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

  const P = () => models.find((m) => m.id === S.prov) || models[0];
  const syncVer = () => {
    S.ver = defaultVersionOf(P());
  };
  const toast = (msg: string) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3800);
  };
  const announce = (msg: string) => {
    $('#live').textContent = msg;
  };
  const md = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>')
      .replace(/^(\s*)[-*•]\s+/gm, '$1• ');

  const wc = (s: string) => (s.match(/\S+/g) || []).length;
  function sentencesOf(text: string) {
    const out: string[] = [];
    text.split(/\n+/).forEach((line) => {
      line = line.trim();
      if (!line) return;
      (line.match(/.+?(?:[.!?](?=\s|$)|$)/g) || [line]).forEach((s) => {
        s = s.trim();
        if (s) out.push(s);
      });
    });
    return out;
  }
  function pack(units: string[], size: number, overlap: number, sep: string) {
    const out: string[] = [];
    let cur: string[] = [];
    let n = 0;
    units.forEach((u) => {
      const w = wc(u);
      if (n + w > size && cur.length) {
        out.push(cur.join(sep));
        const carry: string[] = [];
        let cw = 0;
        for (let i = cur.length - 1; i >= 0; i--) {
          const x = wc(cur[i]);
          if (cw + x > overlap) break;
          carry.unshift(cur[i]);
          cw += x;
        }
        cur = carry;
        n = cw;
      }
      cur.push(u);
      n += w;
    });
    if (cur.length) out.push(cur.join(sep));
    return out;
  }
  function chunkText(text: string, size: number, overlap: number) {
    const words = text.match(/\S+/g) || [];
    if (!words.length) return [];
    const step = Math.max(1, size - overlap);
    const out: string[] = [];
    for (let i = 0; i < words.length; i += step) {
      out.push(words.slice(i, i + size).join(' '));
      if (i + size >= words.length) break;
    }
    return out;
  }
  function chunkBy(mode: string, text: string, size: number, overlap: number) {
    if (mode === 'sentences') return pack(sentencesOf(text), size, overlap, ' ');
    if (mode === 'sections')
      return pack(
        text
          .split(/\n\s*\n/)
          .map((s) => s.trim())
          .filter(Boolean),
        size,
        0,
        '\n\n',
      );
    return chunkText(text, size, overlap);
  }
  function hash(s: string) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }
  function rechunk() {
    const t = docText();
    const sig = `${S.mode}|${S.size}|${S.overlap}|${t.length}|${hash(t)}`;
    if (sig === S.chunkSig) return;
    S.chunkSig = sig;
    S.chunks = chunkBy(S.mode, t, S.size, S.overlap);
    S.index = null;
  }
  const indexReady = () => S.index && S.index.sig === S.chunkSig;

  const terms = (s: string) =>
    (s.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) || [])
      .filter((w) => !STOP.has(w) && w.length > 1)
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
  function tfidfVec(ts: string[], idf: Map<string, number>) {
    const tf = new Map<string, number>();
    ts.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    const v = new Map<string, number>();
    let n = 0;
    tf.forEach((c, t) => {
      const w = (1 + Math.log(c)) * (idf.get(t) || 0);
      if (w > 0) {
        v.set(t, w);
        n += w * w;
      }
    });
    n = Math.sqrt(n) || 1;
    v.forEach((w, t) => v.set(t, w / n));
    return v;
  }
  function buildTfidf() {
    const docs = S.chunks.map(terms);
    const df = new Map<string, number>();
    docs.forEach((ts) => new Set(ts).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
    const N = docs.length;
    const idf = new Map<string, number>();
    df.forEach((d, t) => idf.set(t, Math.log((N + 1) / (d + 1)) + 1));
    return { sig: S.chunkSig, kind: 'tfidf', idf, vecs: docs.map((ts) => tfidfVec(ts, idf)) };
  }

  function renderDoc() {
    const t = docText();
    const words = (t.match(/\S+/g) || []).length;
    $('#docMeta').innerHTML = S.parsing
      ? `<span class="parsing"><span class="dotsld"><i></i><i></i><i></i></span>${esc(S.parsing)}</span>`
      : words
        ? `<span>${S.docSource ? `${esc(S.docSource.name)}${S.docSource.pages ? ` · ${S.docSource.pages} page${S.docSource.pages === 1 ? '' : 's'}` : ''} · ` : ''}${fmt(words)} words · ≈${fmt(estTok(t))} tokens</span><span class="grow"></span><button class="mini" data-act="clearDoc">Clear</button>`
        : '';
  }
  function renderChunks() {
    rechunk();
    $('#vSize').textContent = `${S.size} w`;
    $('#vOverlap').textContent = S.mode === 'sections' ? 'none' : `${S.overlap} w`;
    ($('#size') as HTMLInputElement).value = String(S.size);
    ($('#overlap') as HTMLInputElement).value = String(S.overlap);
    ($('#overlap') as HTMLInputElement).disabled = S.mode === 'sections';
    $$('#modeCtl [data-mode]').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === S.mode);
      (b as HTMLButtonElement).disabled = S.running;
    });
    const pv = new Set((S.preview || []).map((h) => h.i));
    const big = S.chunks.length <= 60;
    const a = S.answers.find((x) => x.id === S.sel);
    const hits = new Map((a && a.hits ? a.hits : []).map((h: any, r: number) => [h.i, r + 1]));
    const cited = new Set(a ? a.cites || [] : []);
    $('#strip').innerHTML = S.chunks
      .map((c, i) => {
        const r = hits.get(i);
        return `<button class="cq ${big ? 'big' : ''} ${r ? 'got' : ''} ${r === 1 ? 'r1' : ''} ${cited.has(i) ? 'cited' : ''} ${pv.has(i) ? 'pv' : ''}" data-chunk="${i}" title="Chunk ${i + 1}${r ? ` · retrieved #${r}` : ''}${pv.has(i) ? ' · would be retrieved for the question you are typing' : ''}: ${esc(c.slice(0, 120))}…" aria-label="Chunk ${i + 1}">${big ? i + 1 : ''}</button>`;
      })
      .join('');
    const n = S.chunks.length;
    const avg = n ? S.chunks.reduce((a, c) => a + estTok(c), 0) / n : 0;
    $('#chunkSub').textContent = n
      ? `${fmt(n)} chunk${n === 1 ? '' : 's'} · ≈${fmt(avg)} tokens on average`
      : 'How the document is cut up for search';
    const st = $('#istat');
    if (!n) st.innerHTML = '';
    else if (indexReady())
      st.innerHTML = `<span class="pill ok">Index ready</span><span>${fmt(n)} chunks searchable</span>`;
    else st.innerHTML = `<span class="pill warn">Not indexed yet</span><span>Indexed on your next question</span>`;
  }
  function renderAsk() {
    $('#kVal').textContent = String(S.k);
    $('#minVal').textContent = S.minScore.toFixed(2);
    $$('[data-act=minDown],[data-act=minUp]').forEach((b) => {
      (b as HTMLButtonElement).disabled = !S.useDoc || S.running;
    });
    const minDown = $$('[data-act=minDown]')[0] as HTMLButtonElement | undefined;
    const minUp = $$('[data-act=minUp]')[0] as HTMLButtonElement | undefined;
    if (minDown) minDown.disabled = minDown.disabled || S.minScore <= 0;
    if (minUp) minUp.disabled = minUp.disabled || S.minScore >= 0.5;
    ($('#strict') as HTMLInputElement).checked = S.strict;
    ($('#useDoc') as HTMLInputElement).checked = S.useDoc;
    ($('#strict') as HTMLInputElement).disabled = !S.useDoc || S.running;
    $$('[data-act=kDown],[data-act=kUp]').forEach((b) => {
      (b as HTMLButtonElement).disabled = !S.useDoc || S.running;
    });
    const kDown = $$('[data-act=kDown]')[0] as HTMLButtonElement | undefined;
    const kUp = $$('[data-act=kUp]')[0] as HTMLButtonElement | undefined;
    if (kDown) kDown.disabled = kDown.disabled || S.k <= 1;
    if (kUp) kUp.disabled = kUp.disabled || S.k >= 10;
    ($('#useDoc') as HTMLInputElement).disabled = S.running;
    const b = $('#askBtn');
    b.className = 'send' + (S.running ? ' stop' : '');
    b.innerHTML = S.running ? `${IC.stop} Stop` : `${IC.ask} Ask <kbd>Enter</kbd>`;
    b.title = S.running ? 'Stop waiting for the answer' : 'Enter to ask · Shift+Enter for a new line';
    ($('#provSel') as HTMLSelectElement).disabled = S.running;
  }
  function citesOf(text: string) {
    const out: number[] = [];
    (text.match(/\[(\s*\d+\s*(?:[,–-]\s*\d+\s*)*)\]/g) || []).forEach((g) =>
      g.replace(/\d+/g, (d) => {
        out.push(+d - 1);
        return d;
      }),
    );
    return [...new Set(out)];
  }
  function withCites(a: any) {
    const got = new Set((a.hits || []).map((h: any) => h.i));
    return md(a.text || '').replace(/\[(\s*\d+\s*(?:[,–-]\s*\d+\s*)*)\]/g, (g) =>
      g
        .replace(/\d+/g, (d) => {
          const i = +d - 1;
          const ok = got.has(i);
          return `<span class="cite ${ok ? '' : 'missing'}" data-cite="${i}" title="${ok ? `Chunk ${d} was retrieved for this question` : `Chunk ${d} was not given to the model for this question`}">${d}</span>`;
        })
        .replace(/^\[|\]$/g, ''),
    );
  }
  function variants(a: any) {
    if (!a.useDoc) return [{ v: 'doc', label: 'with the document' }];
    const out = [
      { v: 'strict', label: a.strict ? 'strict off' : 'strict on' },
      { v: 'nodoc', label: 'without the document' },
    ];
    if (a.k <= 8) out.push({ v: 'more', label: `with ${a.k + 2} chunks` });
    return out;
  }
  function ansHTML(a: any, idx: number) {
    const modelName = models.find((m) => m.id === a.prov)?.name || a.prov;
    const tags = [
      a.via ? `<span class="tag via">${esc(a.via)}</span>` : '',
      a.useDoc
        ? `<span class="tag">${a.k} chunk${a.k === 1 ? '' : 's'}${a.minScore ? ` · min ${a.minScore.toFixed(2)}` : ''}</span>`
        : `<span class="tag off">no document</span>`,
      a.useDoc ? `<span class="tag ${a.strict ? '' : 'off'}">${a.strict ? 'strict' : 'not strict'}</span>` : '',
      `<span class="tag">${esc(modelName)}</span>${a.model ? `<span class="tag">${esc(a.model)}</span>` : ''}`,
    ].join('');
    let body: string;
    if (a.status === 'running')
      body = `<div class="skel"><i style="width:92%"></i><i style="width:74%"></i><i style="width:55%"></i></div><div class="waiting"><span class="dotsld"><i></i><i></i><i></i></span>${a.note ? esc(a.note) : a.stage || 'Writing the answer'}<span class="elapsed" data-t0="${a.t0}">0.0s</span></div>`;
    else if (a.status === 'error') body = `<div class="err">${esc(a.error)}</div>`;
    else
      body = `<div class="atext">${withCites(a) || '<span style="color:var(--fa2)">(empty answer)</span>'}</div>
    <div class="af"><span>${(a.ms / 1000).toFixed(1)}s</span>${a.sent ? `<span>≈${fmt(a.sent)} tokens sent</span>` : ''}<span class="grow"></span>
      <button class="jb ok ${a.judge === true ? 'on' : ''}" data-judge="1" data-a="${a.id}" title="Everything in the answer is backed by the document">Grounded</button>
      <button class="jb no ${a.judge === false ? 'on' : ''}" data-judge="0" data-a="${a.id}" title="The answer states things the document does not say">Made up</button></div>
    <div class="again"><span>Ask again</span>${variants(a)
      .map((v) => `<button class="vbtn" data-again="${a.id}" data-v="${v.v}" ${S.running ? 'disabled' : ''}>${v.label}</button>`)
      .join('')}</div>`;
    const cls = [a.id === S.sel ? 'sel' : '', a.judge === true ? 'good' : a.judge === false ? 'bad' : ''].join(' ');
    return `<div class="ans ${cls}" data-sel="${a.id}" id="a${a.id}">
    <div class="aq"><span class="an">#${idx + 1}</span><div class="aqt">${esc(a.q)}</div></div>
    <div class="tags">${tags}</div>${body}</div>`;
  }
  function renderAnswers() {
    const box = $('#alist');
    if (!S.answers.length)
      box.innerHTML = `<div class="empty empty-buddy">${labBuddyHtml({ mood: 'idle', size: 72, className: 'ex-empty-buddy' })}<div class="empty-copy">Ask a question about the document. Each answer shows which chunks it was built from, and you judge whether it stayed true to the document.</div></div>`;
    else box.innerHTML = S.answers.map((a, i) => ansHTML(a, i)).reverse().join('');
    const g = S.answers.filter((a) => a.judge === true).length;
    const m = S.answers.filter((a) => a.judge === false).length;
    $('#tally').innerHTML =
      g || m ? `<span class="g">Grounded <b>${g}</b></span><span class="m">Made up <b>${m}</b></span>` : '';
    ($('#clearBtn') as HTMLButtonElement).disabled = S.running || !S.answers.length;
    if (!completed && S.answers.some((a) => a.status === 'done' && a.judge != null)) {
      completed = true;
      onComplete?.();
    }
  }
  function highlight(text: string, q: string) {
    const ts = new Set(terms(q));
    if (!ts.size) return esc(text);
    return esc(text).replace(/[A-Za-z0-9]+(?:\.[0-9]+)?/g, (w) => {
      const t = terms(w)[0];
      return t && ts.has(t) ? `<mark>${w}</mark>` : w;
    });
  }
  function renderEvidence() {
    const a = S.answers.find((x) => x.id === S.sel);
    ($('#promptBtn') as HTMLButtonElement).disabled = !a || !a.prompt;
    $('#method').textContent = a
      ? a.useDoc
        ? a.methodLabel || methodLabel
        : 'No search: document off'
      : methodLabel;
    if (!a) {
      $('#evq').innerHTML = '';
      $('#hits').innerHTML = `<div class="empty empty-buddy">${labBuddyHtml({ mood: 'listen', size: 64, className: 'ex-empty-buddy' })}<div class="empty-copy">Ask a question to see which chunks were found for it, and how closely each one matched.</div></div>`;
      return;
    }
    $('#evq').innerHTML = `<div class="evq">For <b>#${S.answers.indexOf(a) + 1}</b> · ${esc(a.q)}</div>`;
    if (!a.useDoc) {
      $('#hits').innerHTML = `<div class="nodoc">The document was switched off for this question, so the model got no chunks, only the question.</div>`;
      return;
    }
    if (!a.hits) {
      $('#hits').innerHTML = `<div class="empty">Searching…</div>`;
      return;
    }
    const max = Math.max(...a.hits.map((h: any) => h.score), 1e-9);
    const cited = new Set(a.cites || []);
    $('#hits').innerHTML =
      a.hits
        .map((h: any, r: number) => {
          const t =
            S.chunks[h.i] != null && a.chunkSig === S.chunkSig
              ? S.chunks[h.i]
              : a.chunkText?.[h.i] || h.text || '';
          const open = a.open?.[h.i];
          return `<div class="hit" id="h${h.i}">
      <div class="hh"><span class="rank">${r + 1}</span><b>Chunk ${h.i + 1}</b>${cited.has(h.i) ? '<span class="cited">cited</span>' : ''}
        <span class="score" title="Similarity to the question">${h.score.toFixed(2)}<i style="--w:${Math.max(3, (h.score / max) * 100)}%"></i></span></div>
      <div class="ht ${open ? '' : 'clamp'}">${highlight(t, a.q)}</div>
      ${t.length > 380 ? `<button class="more" data-act="openHit" data-i="${h.i}">${open ? 'Show less' : 'Show all'}</button>` : ''}
    </div>`;
        })
        .join('') +
      (a.hits.length
        ? ''
        : `<div class="nodoc">No chunk scored above the minimum match of ${a.minScore.toFixed(2)}, so the model got the question with no passages.</div>`) +
      (a.dropped
        ? `<div class="dropnote2">${a.dropped} more chunk${a.dropped === 1 ? '' : 's'} scored below the minimum match of ${a.minScore.toFixed(2)} and ${a.dropped === 1 ? 'was' : 'were'} not sent.</div>`
        : '');
  }
  function renderPreviewLine() {
    const el = $('#pvline');
    const p = S.preview;
    if (!p) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = p.length
      ? `<span class="pvdot"></span>Would retrieve ${p.map((h) => `<b>${h.i + 1}</b>`).join(' · ')} <span class="pvs">best match ${p[0].score.toFixed(2)}</span>`
      : `<span class="pvdot off"></span>No chunk matches this question${S.minScore ? ` above ${S.minScore.toFixed(2)}` : ''}`;
  }
  function updatePreview() {
    const q = (($('#q') as HTMLTextAreaElement).value || '').trim();
    if (!q || !S.useDoc || !docText().trim()) {
      S.preview = null;
      renderChunks();
      renderPreviewLine();
      return;
    }
    rechunk();
    if (!indexReady()) S.index = buildTfidf();
    const qv = tfidfVec(terms(q), S.index.idf);
    S.preview = S.index.vecs
      .map((v: Map<string, number>, i: number) => {
        let s = 0;
        qv.forEach((w, t) => {
          const x = v.get(t);
          if (x) s += w * x;
        });
        return { i, score: s };
      })
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, S.k)
      .filter((h: any) => h.score >= S.minScore && h.score > 0);
    renderChunks();
    renderPreviewLine();
  }
  const schedulePreview = () => {
    if (pvTimer) clearTimeout(pvTimer);
    pvTimer = setTimeout(updatePreview, 160);
  };
  function renderAll() {
    renderDoc();
    renderChunks();
    renderAsk();
    renderAnswers();
    renderEvidence();
    syncUndoUi();
  }
  function renderOne(a: any) {
    const el = host.querySelector(`#a${a.id}`);
    if (el) el.outerHTML = ansHTML(a, S.answers.indexOf(a));
    else renderAnswers();
  }

  function fillSettings() {
    ($('#temp') as HTMLInputElement).value = String(S.temp);
    ($('#topp') as HTMLInputElement).value = String(S.topp);
    ($('#cap') as HTMLInputElement).value = String(S.cap);
    $('#vTemp').textContent = S.temp.toFixed(2);
    $('#vTopp').textContent = S.topp >= 0.999 ? 'off' : S.topp.toFixed(2);
    $('#vCap').textContent = `${S.cap} tok`;
  }
  function openSettings() {
    if (S.running) return;
    fillSettings();
    $('#setModal').classList.add('open');
  }
  function closeModals() {
    $$('.modal').forEach((m) => m.classList.remove('open'));
  }
  function openChunk(i: number) {
    const t = S.chunks[i];
    if (t == null) return;
    $('#viewBox').innerHTML = `<div class="mtitle">Chunk ${i + 1} of ${S.chunks.length}<span class="pill">${(t.match(/\S+/g) || []).length} words · ≈${fmt(estTok(t))} tokens</span><button class="x" data-close>×</button></div>
    <div class="pm" style="--r:var(--li)"><div class="pb" style="font-family:Inter,sans-serif;font-size:13px">${esc(t)}</div></div>`;
    $('#viewModal').classList.add('open');
  }
  function openPrompt() {
    const a = S.answers.find((x) => x.id === S.sel);
    if (!a || !a.prompt) return;
    $('#viewBox').innerHTML = `<div class="mtitle">What the model received for #${S.answers.indexOf(a) + 1}<button class="x" data-close>×</button></div>
    <div class="note" style="margin-top:0">The model sees only these two messages. It has no other access to the document.</div>
    <div class="stack">
      <div class="pm" style="--r:var(--pu)"><div class="ph">SYSTEM <span>≈${fmt(estTok(a.prompt.system))} tokens</span></div><div class="pb">${esc(a.prompt.system)}</div></div>
      <div class="pm" style="--r:var(--bl)"><div class="ph">USER <span>≈${fmt(estTok(a.prompt.user))} tokens</span></div><div class="pb">${esc(a.prompt.user)}</div></div>
    </div>`;
    $('#viewModal').classList.add('open');
  }
  function renderFs() {
    const on = !!document.fullscreenElement;
    const b = $('#fsBtn');
    b.innerHTML = on ? IC.fsOff : IC.fsOn;
    b.title = on ? 'Exit full screen' : 'Full screen';
  }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      document.documentElement.requestFullscreen?.().catch(() => toast("Full screen isn't available in this browser"));
  }

  function loadPdfjs() {
    if (pdfjsReady) return pdfjsReady;
    pdfjsReady = new Promise((res, rej) => {
      const w = window as any;
      if (w.pdfjsLib) {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res(w.pdfjsLib);
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        w.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        res(w.pdfjsLib);
      };
      s.onerror = () => {
        pdfjsReady = null;
        rej(new Error("Couldn't load the PDF reader. Check the connection, or paste the text instead."));
      };
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }
  async function loadFile(file: File) {
    if (!file) return;
    if (docText().trim() && !confirm(`Replace the current document with "${file.name}"?`)) return;
    pushUndo();
    try {
      let text: string;
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        S.parsing = `Reading ${file.name}…`;
        renderDoc();
        const lib = await loadPdfjs();
        const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages: string[] = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          S.parsing = `Reading page ${p} of ${pdf.numPages}…`;
          renderDoc();
          const tc = await (await pdf.getPage(p)).getTextContent();
          pages.push(
            tc.items
              .map((it: any) => it.str + (it.hasEOL ? '\n' : ' '))
              .join('')
              .replace(/[ \t]+/g, ' ')
              .trim(),
          );
        }
        text = pages.join('\n\n');
        S.docSource = { name: file.name, pages: pdf.numPages };
        if (!text.trim()) throw new Error('No text found in this PDF. It may be a scanned image; paste the text instead.');
      } else {
        text = await file.text();
        S.docSource = { name: file.name };
      }
      ($('#doc') as HTMLTextAreaElement).value = text;
    } catch (e: any) {
      toast(esc(e.message || "Couldn't read that file."));
    }
    S.parsing = false;
    renderAll();
  }

  function rotatePlaceholder() {
    PH = (PH + 1) % qExamples.length;
    ($('#q') as HTMLTextAreaElement).placeholder = qExamples[PH];
  }

  function askVariant(a: any, v: string) {
    const o: any = { q: a.q, k: a.k, strict: a.strict, useDoc: a.useDoc, minScore: a.minScore };
    if (v === 'strict') {
      o.strict = !a.strict;
      o.via = `#${S.answers.indexOf(a) + 1}, ${a.strict ? 'strict off' : 'strict on'}`;
    }
    if (v === 'nodoc') {
      o.useDoc = false;
      o.via = `#${S.answers.indexOf(a) + 1}, no document`;
    }
    if (v === 'doc') {
      o.useDoc = true;
      o.via = `#${S.answers.indexOf(a) + 1}, with document`;
    }
    if (v === 'more') {
      o.k = Math.min(10, a.k + 2);
      o.via = `#${S.answers.indexOf(a) + 1}, ${o.k} chunks`;
    }
    void ask(o);
  }

  async function ask(over?: any) {
    if (S.running) {
      S.ctrl?.abort();
      return;
    }
    const fromBox = !over;
    const q = over ? over.q : (($('#q') as HTMLTextAreaElement).value || '').trim();
    const set = Object.assign({ k: S.k, strict: S.strict, useDoc: S.useDoc, minScore: S.minScore }, over || {});
    if (!q) {
      ($('#q') as HTMLTextAreaElement).focus();
      return;
    }
    if (set.useDoc && !docText().trim()) {
      toast('Add a document first: paste it, upload a file, or click <b>Example</b>');
      ($('#doc') as HTMLTextAreaElement).focus();
      return;
    }
    const a: any = {
      id: UID++,
      q,
      k: set.k,
      strict: set.strict,
      useDoc: set.useDoc,
      minScore: set.minScore,
      via: over?.via || '',
      prov: S.prov,
      model: S.ver || P()?.id || S.prov,
      status: 'running',
      t0: performance.now(),
      judge: null,
      stage: set.useDoc ? 'Searching the chunks' : 'Writing the answer',
    };
    S.answers.push(a);
    S.sel = a.id;
    S.running = true;
    const ctrl = new AbortController();
    S.ctrl = ctrl;
    if (fromBox) {
      ($('#q') as HTMLTextAreaElement).value = '';
      rotatePlaceholder();
      S.preview = null;
      renderPreviewLine();
    }
    renderAll();
    ($('#alist') as HTMLElement).scrollTop = 0;
    try {
      rechunk();
      if (a.useDoc) {
        a.stage = 'Indexing the chunks';
        renderOne(a);
        if (!indexReady()) S.index = buildTfidf();
        renderChunks();
        a.stage = 'Writing the answer';
        renderOne(a);
      }
      const result = await runRagAsk(
        sessionId,
        projectId,
        {
          question: q,
          document: a.useDoc ? docText() : '',
          chunks: a.useDoc ? S.chunks : undefined,
          mode: S.mode,
          size: S.size,
          overlap: S.overlap,
          k: a.k,
          minScore: a.minScore,
          strict: a.strict,
          useDoc: a.useDoc,
          model: S.ver || P()?.defaultVersion || S.prov,
          temp: S.temp,
          topp: S.topp,
          cap: S.cap,
        },
        ctrl.signal,
      );
      a.text = result.text;
      a.hits = result.hits || [];
      a.dropped = result.dropped || 0;
      a.kind = result.kind;
      a.methodLabel = result.methodLabel;
      a.chunkSig = S.chunkSig;
      a.chunkText = Object.fromEntries(a.hits.map((h: any) => [h.i, h.text || S.chunks[h.i] || '']));
      a.prompt = result.prompt;
      a.sent = result.sentEst || result.inTok;
      a.cites = result.cites?.length ? result.cites : citesOf(a.text);
      a.ms = result.ms || performance.now() - a.t0;
      a.simulated = result.simulated;
      a.status = 'done';
    } catch (e: any) {
      if (e?.name === 'AbortError') a.error = 'Stopped before the answer arrived.';
      else a.error = e?.message || 'The question could not be answered.';
      a.status = 'error';
    }
    S.running = false;
    S.ctrl = null;
    renderAll();
    announce(a.status === 'done' ? 'Answer ready.' : 'The question could not be answered.');
    if (fromBox) ($('#q') as HTMLTextAreaElement).focus();
  }

  const onInput = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.id === 'doc') {
      renderDoc();
      if (docTimer) clearTimeout(docTimer);
      docTimer = setTimeout(() => {
        renderChunks();
        schedulePreview();
      }, 250);
    } else if (t.id === 'q') schedulePreview();
    else if (t.id === 'size') {
      const next = +(t as HTMLInputElement).value;
      if (next !== S.size) pushUndo();
      S.size = next;
      if (S.overlap >= S.size) S.overlap = Math.max(0, S.size - 10);
      renderChunks();
      schedulePreview();
    } else if (t.id === 'overlap') {
      const next = Math.min(+(t as HTMLInputElement).value, S.size - 10);
      if (next !== S.overlap) pushUndo();
      S.overlap = next;
      renderChunks();
      schedulePreview();
    } else if (t.id === 'temp') {
      S.temp = parseFloat((t as HTMLInputElement).value);
      fillSettings();
    } else if (t.id === 'topp') {
      S.topp = parseFloat((t as HTMLInputElement).value);
      fillSettings();
    } else if (t.id === 'cap') {
      S.cap = parseInt((t as HTMLInputElement).value, 10);
      fillSettings();
    }
  };
  const onChange = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'provSel') {
      S.prov = t.value;
      syncVer();
      const p = P();
      if (p?.tempMax != null) S.temp = Math.min(S.temp, p.tempMax);
    } else if (t.id === 'strict') {
      if (t.checked !== S.strict) pushUndo();
      S.strict = t.checked;
    } else if (t.id === 'useDoc') {
      if (t.checked !== S.useDoc) pushUndo();
      S.useDoc = t.checked;
      renderAsk();
      schedulePreview();
    } else if (t.id === 'fileIn' && t.files?.[0]) {
      void loadFile(t.files[0]);
      t.value = '';
    }
  };
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal') || target.closest('[data-close]')) {
      closeModals();
      return;
    }
    const j = target.closest('[data-judge]') as HTMLElement | null;
    if (j) {
      e.stopPropagation();
      const a = S.answers.find((x) => x.id === +j.dataset.a!);
      if (a) {
        pushUndo();
        const v = j.dataset.judge === '1';
        a.judge = a.judge === v ? null : v;
        renderAnswers();
      }
      return;
    }
    const c = target.closest('[data-cite]') as HTMLElement | null;
    if (c) {
      e.stopPropagation();
      const ans = c.closest('[data-sel]') as HTMLElement | null;
      if (ans) {
        S.sel = +ans.dataset.sel!;
        renderAnswers();
        renderChunks();
        renderEvidence();
      }
      const el = host.querySelector(`#h${c.dataset.cite}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.remove('flash');
        void (el as HTMLElement).offsetWidth;
        el.classList.add('flash');
      } else openChunk(+c.dataset.cite!);
      return;
    }
    const ch = target.closest('[data-chunk]') as HTMLElement | null;
    if (ch) {
      openChunk(+ch.dataset.chunk!);
      return;
    }
    const mdBtn = target.closest('[data-mode]') as HTMLElement | null;
    if (mdBtn && !S.running) {
      pushUndo();
      S.mode = mdBtn.dataset.mode!;
      renderChunks();
      schedulePreview();
      return;
    }
    const ag = target.closest('[data-again]') as HTMLElement | null;
    if (ag) {
      e.stopPropagation();
      const a = S.answers.find((x) => x.id === +ag.dataset.again!);
      if (a && !S.running) askVariant(a, ag.dataset.v!);
      return;
    }
    const act = target.closest('[data-act]') as HTMLElement | null;
    if (act) {
      const a = act.dataset.act;
      if (a === 'sampleDoc') {
        if (!docText().trim() || confirm('Replace the current document with the sample building code?')) {
          pushUndo();
          ($('#doc') as HTMLTextAreaElement).value = sampleDoc;
          S.docSource = { name: sampleName };
          renderAll();
        }
      } else if (a === 'upload') ($('#fileIn') as HTMLInputElement).click();
      else if (a === 'clearDoc') {
        if (confirm('Clear the document?')) {
          pushUndo();
          ($('#doc') as HTMLTextAreaElement).value = '';
          S.docSource = null;
          S.preview = null;
          renderAll();
          renderPreviewLine();
        }
      } else if (a === 'kDown') {
        pushUndo();
        S.k = Math.max(1, S.k - 1);
        renderAsk();
        schedulePreview();
      } else if (a === 'kUp') {
        pushUndo();
        S.k = Math.min(10, S.k + 1);
        renderAsk();
        schedulePreview();
      } else if (a === 'minDown') {
        pushUndo();
        S.minScore = Math.max(0, +(S.minScore - 0.05).toFixed(2));
        renderAsk();
        schedulePreview();
      } else if (a === 'minUp') {
        pushUndo();
        S.minScore = Math.min(0.5, +(S.minScore + 0.05).toFixed(2));
        renderAsk();
        schedulePreview();
      } else if (a === 'clearAnswers') {
        if (S.answers.length && confirm('Clear all answers?')) {
          pushUndo();
          S.answers = [];
          S.sel = null;
          renderAll();
        }
      } else if (a === 'prompt') openPrompt();
      else if (a === 'openHit') {
        const ans = S.answers.find((x) => x.id === S.sel);
        if (ans) {
          ans.open = ans.open || {};
          ans.open[act.dataset.i!] = !ans.open[act.dataset.i!];
          renderEvidence();
        }
      } else if (a === 'resetParams') {
        S.temp = catalog?.defaults.temp ?? 0.2;
        S.topp = catalog?.defaults.topp ?? 1;
        S.cap = catalog?.defaults.cap ?? 400;
        fillSettings();
      }
      return;
    }
    const s = target.closest('[data-sel]') as HTMLElement | null;
    if (s) {
      S.sel = +s.dataset.sel!;
      renderAnswers();
      renderChunks();
      renderEvidence();
      return;
    }
    const b = target.closest('button') as HTMLButtonElement | null;
    if (!b) return;
    if (b.id === 'askBtn') void ask();
    else if (b.id === 'undoBtn') performUndo();
    else if (b.id === 'settingsBtn') openSettings();
    else if (b.id === 'fsBtn') toggleFs();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModals();
      return;
    }
    if ((e.target as HTMLElement).id === 'q' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void ask();
    }
  };
  const dw = $('#docwrap');
  const onDrag = (e: DragEvent) => {
    e.preventDefault();
    dw.classList.add('drag');
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dw.classList.remove('drag');
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dw.classList.remove('drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  };

  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  ['dragenter', 'dragover'].forEach((ev) => dw.addEventListener(ev, onDrag as any));
  ['dragleave', 'drop'].forEach((ev) => dw.addEventListener(ev, onDragLeave as any));
  dw.addEventListener('drop', onDrop);
  const onFs = () => renderFs();
  document.addEventListener('fullscreenchange', onFs);
  tickTimer = setInterval(() => {
    if (!S.running) return;
    const now = performance.now();
    $$('.elapsed').forEach((el) => {
      el.textContent = `${((now - +el.dataset.t0!) / 1000).toFixed(1)}s`;
    });
  }, 100);

  void (async () => {
    try {
      catalog = await loadRagCatalog(sessionId, projectId);
      models = catalog.models || [];
      methodLabel = catalog.methodLabel || methodLabel;
      sampleDoc = catalog.sample?.doc || '';
      sampleName = catalog.sample?.docName || sampleName;
      if (catalog.sample?.questions?.length) qExamples = catalog.sample.questions;
      S.temp = catalog.defaults.temp ?? 0.2;
      S.topp = catalog.defaults.topp ?? 1;
      S.cap = catalog.defaults.cap ?? 400;
      S.mode = catalog.defaults.mode || 'words';
      S.size = catalog.defaults.size ?? 60;
      S.overlap = catalog.defaults.overlap ?? 10;
      S.k = catalog.defaults.k ?? 3;
      S.minScore = catalog.defaults.minScore ?? 0;
      S.strict = catalog.defaults.strict !== false;
      S.useDoc = catalog.defaults.useDoc !== false;
      S.prov = catalog.defaults.prov || models[0]?.id || 'gemini-38-flash';
      S.ver = defaultVersionOf(P());
      $('#settingsBtn').innerHTML = IC.gear;
      if (!document.documentElement.requestFullscreen) ($('#fsBtn') as HTMLElement).hidden = true;
      renderFs();
      ($('#provSel') as HTMLSelectElement).innerHTML = models
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
        .join('');
      ($('#provSel') as HTMLSelectElement).value = S.prov;
      syncVer();
      ($('#q') as HTMLTextAreaElement).placeholder = qExamples[0];
      renderAll();
      host.classList.remove('is-booting');
    } catch (e: any) {
      host.classList.remove('is-booting');
      toast(esc(e?.message || 'Could not load the RAG lab.'));
    }
  })();

  return () => {
    host.removeEventListener('input', onInput);
    host.removeEventListener('change', onChange);
    host.removeEventListener('click', onClick);
    host.removeEventListener('keydown', onKey);
    ['dragenter', 'dragover'].forEach((ev) => dw.removeEventListener(ev, onDrag as any));
    ['dragleave', 'drop'].forEach((ev) => dw.removeEventListener(ev, onDragLeave as any));
    dw.removeEventListener('drop', onDrop);
    document.removeEventListener('fullscreenchange', onFs);
    if (tickTimer) clearInterval(tickTimer);
    if (docTimer) clearTimeout(docTimer);
    if (pvTimer) clearTimeout(pvTimer);
    S.ctrl?.abort();
    unbindTheme();
    host.innerHTML = '';
  };
}
