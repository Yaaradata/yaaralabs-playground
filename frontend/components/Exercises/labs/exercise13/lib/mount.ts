/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import {
  loadAgentCatalog,
  runAgentStep,
  type AgentCatalog,
  type AgentModel,
  type AgentMessage,
  type AgentToolCall,
  type AgentStepResult,
} from './api';
import { calc, fmtNum, groupNum, convert, exactFor, answerMatches } from './tools';
import { ensurePython, defineOwn, callOwn, pyErr, hlPython } from './ownTool';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { defaultVersionOf } from '../../../modelVersions';
import { cloneState, createUndoStack, syncUndoButton, UNDO_BUTTON_HTML } from '../../../undoHistory';
import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';
import { bindHostFullscreen } from '../../../fullscreen';
import { labBuddyHtml, toLabBuddyMood } from '../../../labBuddy';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

const TEMPLATE = `<header>
  ${exerciseBrandHtml(13, 'Exercise - 13 : Build an agent and give it a tool')}
  ${THEME_TOGGLE_HTML}
  ${UNDO_BUTTON_HTML}
  <label class="msel" title="The model that powers the agent">
    <span>Model</span>
    <select id="provSel"></select>
  </label>
  <button class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
  <button class="icon" id="settingsBtn" title="Model parameters: temperature, top-p, output cap" aria-label="Model parameters"></button>
</header>

<main>
  <div class="col side">
    <section class="card agent">
      <div class="chead"><span class="n">1</span><div class="ct"><b>Agent</b><span>What the agent is told</span></div>
        <button class="mini li" data-act="example" title="Load an example agent">Example</button></div>
      <div class="fl">Name</div>
      <input type="text" id="name" aria-label="Agent name" placeholder="e.g. SiteCalc" maxlength="40" spellcheck="false">
      <div class="fl">Description <i>not sent to the model here</i></div>
      <textarea id="desc" aria-label="Agent description" placeholder="e.g. Answers engineering questions and does exact calculations."></textarea>
      <div class="hint">Other agents read this to decide whether to hand work to this one.</div>
      <div class="fl">Instruction <i>sent on every call</i></div>
      <textarea id="instr" aria-label="Agent instruction" spellcheck="false" placeholder="e.g.&#10;You are an assistant for engineering students.&#10;Answer briefly and show the key numbers.&#10;Use your tools for anything exact."></textarea>
      <div class="agentfoot"><button class="mini" data-act="preview">What the model receives</button><span class="grow"></span></div>
    </section>

    <section class="card tools">
      <div class="chead"><span class="n">2</span><div class="ct"><b>Tools</b><span>What the agent is allowed to call</span></div>
        <button class="mini pu" id="ownToggle" data-act="toggleOwn" aria-expanded="false" aria-controls="own" title="Write your own tool in Python">+ Your tool</button></div>
      <div class="own" id="own" hidden>
        <div class="ownbody" id="ownBody">
          <div class="ownrow"><span>The function's name, docstring and type hints are what the model sees. Names starting with _ stay private helpers.</span><span class="grow"></span><button class="mini li" data-act="ownExample">Example</button></div>
          <div class="ed"><pre class="hl" aria-hidden="true"></pre><textarea id="ownCode" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Your tool in Python" placeholder="e.g.
def beam_max_moment(w: float, L: float) -> float:
    &quot;&quot;&quot;Maximum bending moment (kN·m) of a simply
    supported beam under a uniform load.

    Args:
        w: Uniform load in kN/m.
        L: Span in metres.
    &quot;&quot;&quot;
    return w * L**2 / 8"></textarea></div>
          <button class="addtool" data-act="addOwn" id="addOwnBtn">Add to the agent</button>
          <div class="ownmsg" id="ownMsg" aria-live="polite"></div>
        </div>
      </div>
      <div class="tcar">
        <div class="tstage">
          <button class="rnd" data-act="tPrev" aria-label="Previous tool"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
          <div class="tlist" id="tlist" aria-roledescription="carousel" aria-label="Tools"></div>
          <button class="rnd" data-act="tNext" aria-label="Next tool"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></button>
        </div>
        <div class="tdots" id="tDots"></div>
      </div>
    </section>
  </div>

  <div class="col">
    <section class="card chat">
      <div class="chead"><span class="n">3</span><div class="ct"><b id="chatTitle">Chat</b><span>Each answer shows the steps the agent took</span></div>
        <div class="chatbar" id="chatTools"></div>
        <button class="mini" data-act="newChat" id="newChatBtn">New chat</button></div>
      <div class="msgs" id="msgs"></div>
      <div class="composer">
        <textarea id="msg" aria-label="Message to the agent"></textarea>
        <button class="send" id="sendBtn"></button>
      </div>
    </section>
  </div>
</main>

<div class="modal" id="setModal" role="dialog" aria-modal="true" aria-label="Model parameters"><div class="mbox">
  <div class="mtitle"><span>Model parameters</span><button class="x" data-close aria-label="Close">×</button></div>
  <div class="prm"><div class="prh"><span>Temperature</span><b id="vTemp"></b></div>
    <input type="range" id="temp" min="0" max="2" step="0.05"><div class="prd">Low = focused and repeatable. High = varied and creative.</div></div>
  <div class="prm"><div class="prh"><span>Top-p</span><b id="vTopp"></b></div>
    <input type="range" id="topp" min="0.05" max="1" step="0.05"><div class="prd">Keeps only the most likely words until their odds add up to p. 1 = off.</div></div>
  <div class="prm"><div class="prh"><span>Output cap</span><b id="vCap"></b></div>
    <input type="range" id="cap" min="100" max="2000" step="50"><div class="prd">The longest reply allowed per step, in tokens.</div></div>
  <div class="note">Claude accepts temperatures up to 1, so higher values are capped at 1 for Claude.</div>
  <div style="margin-top:14px"><button class="mini" data-act="resetParams" style="padding:6px 12px">Reset to defaults</button></div>
</div></div>
<div class="modal" id="viewModal" role="dialog" aria-modal="true" aria-label="Details"><div class="mbox wide" id="viewBox"></div></div>

<div id="toasts"></div>
<div class="sr" aria-live="polite" id="live"></div>`;

const IC = {
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
};

const DOTS = '<span class="dots"><i></i><i></i><i></i></span>';

function todayStr() {
  const d = new Date();
  return `${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}

function attachBuiltinRunner(t: { name: string; title?: string; desc: string; schema: any }) {
  if (t.name === 'calculator') {
    return {
      ...t,
      run: (i: Record<string, unknown>) => fmtNum(calc(String(i.expression ?? ''))),
    };
  }
  if (t.name === 'unit_convert') {
    return {
      ...t,
      run: (i: Record<string, unknown>) => convert(+i.value, String(i.from_unit), String(i.to_unit)),
    };
  }
  if (t.name === 'today') {
    return { ...t, run: () => todayStr() };
  }
  return {
    ...t,
    run: async () => {
      throw new Error(`Tool "${t.name}" is not available in this lab.`);
    },
  };
}

export function mountExercise13(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const unbindTheme = bindExerciseTheme(host);
  let unbindFs: (() => void) | undefined;

  const $ = (s: string) => host.querySelector(s) as any;
  const $$ = (s: string) => [...host.querySelectorAll(s)] as any[];
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
  const waitOrStop = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((res, rej) => {
      const t = setTimeout(res, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          rej(new Error('Stopped.'));
        },
        { once: true },
      );
    });

  let catalog: AgentCatalog | null = null;
  let models: AgentModel[] = [];
  let builtins: any[] = [];
  let EXAMPLE = { name: 'SiteCalc', desc: '', instr: '' };
  let MSG_EXAMPLES = [
    'e.g. What is 48,371 × 9,284?',
    'e.g. Work out 12.5 × 7.2² ÷ 8 for the bending moment in kN·m.',
    'e.g. Convert 250 psi to MPa, then multiply the result by 1.5.',
  ];
  let OWN_EXAMPLE = '';
  let DEFAULTS = { temp: 0.2, topp: 1, cap: 800, maxSteps: 5, prov: 'gemini-38-flash' };
  let maxTools = 8;
  let maxOwnCodeChars = 8000;
  let UID = 1;
  let PH = 0;
  let completed = false;
  let tScrollT: ReturnType<typeof setTimeout> | null = null;
  let agentFieldUndoPushed = false;
  let descUndoPushed = false;
  let ownCodeUndoPushed = false;

  const S = {
    prov: 'gemini-38-flash',
    ver: '',
    temp: 0.2,
    topp: 1,
    cap: 800,
    maxSteps: 5,
    on: {} as Record<string, boolean>,
    descs: {} as Record<string, string>,
    openSchema: {} as Record<string, boolean>,
    own: [] as any[],
    ownOpen: false,
    ownBusy: false,
    turns: [] as any[],
    running: false,
    ctrl: null as AbortController | null,
    tIdx: 0,
    bot: { state: 'idle', html: '' },
  };

  type UndoSnap = {
    prov: string;
    ver: string;
    temp: number;
    topp: number;
    cap: number;
    maxSteps: number;
    on: Record<string, boolean>;
    descs: Record<string, string>;
    openSchema: Record<string, boolean>;
    own: any[];
    ownOpen: boolean;
    ownCode: string;
    turns: any[];
    name: string;
    desc: string;
    instr: string;
    uid: number;
    tIdx: number;
  };

  const undo = createUndoStack<UndoSnap>({ max: 40 });

  const allTools = () => [...builtins, ...S.own];
  const P = () => models.find((m) => m.id === S.prov) || models[0];
  const enabledTools = () =>
    allTools()
      .filter((t) => S.on[t.name])
      .map((t) => ({ ...t, desc: S.descs[t.name] ?? t.desc }));
  const agentName = () => ($('#name') as HTMLInputElement).value.trim() || 'Agent';

  function snapshotUndo(): UndoSnap {
    return {
      prov: S.prov,
      ver: S.ver,
      temp: S.temp,
      topp: S.topp,
      cap: S.cap,
      maxSteps: S.maxSteps,
      on: { ...S.on },
      descs: { ...S.descs },
      openSchema: { ...S.openSchema },
      own: cloneState(
        S.own.map((t) => ({
          name: t.name,
          title: t.title,
          desc: t.desc,
          schema: t.schema,
          own: true,
        })),
      ),
      ownOpen: S.ownOpen,
      ownCode: (($('#ownCode') as HTMLTextAreaElement)?.value ?? ''),
      turns: cloneState(
        S.turns.map((t) => ({
          ...t,
          steps: t.steps?.map((s: any) => ({ ...s })) || [],
          tools: [...(t.tools || [])],
        })),
      ),
      name: (($('#name') as HTMLInputElement)?.value ?? ''),
      desc: (($('#desc') as HTMLTextAreaElement)?.value ?? ''),
      instr: (($('#instr') as HTMLTextAreaElement)?.value ?? ''),
      uid: UID,
      tIdx: S.tIdx,
    };
  }

  function pushUndo() {
    if (S.running) return;
    undo.push(snapshotUndo());
    syncUndoUi();
  }

  function syncUndoUi() {
    syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undo.canUndo && !S.running);
  }

  async function restoreUndo(snap: UndoSnap) {
    S.prov = snap.prov;
    S.ver = snap.ver;
    S.temp = snap.temp;
    S.topp = snap.topp;
    S.cap = snap.cap;
    S.maxSteps = snap.maxSteps;
    S.on = { ...snap.on };
    S.descs = { ...snap.descs };
    S.openSchema = { ...snap.openSchema };
    S.ownOpen = snap.ownOpen;
    S.turns = cloneState(snap.turns);
    S.tIdx = snap.tIdx;
    UID = snap.uid;
    ($('#name') as HTMLInputElement).value = snap.name;
    ($('#desc') as HTMLTextAreaElement).value = snap.desc;
    ($('#instr') as HTMLTextAreaElement).value = snap.instr;
    ($('#ownCode') as HTMLTextAreaElement).value = snap.ownCode;
    ($('#provSel') as HTMLSelectElement).value = S.prov;
    syncVer();
    paintOwn();
    if (snap.ownCode.trim() && snap.own.length) {
      try {
        const res = await defineOwn(
          snap.ownCode,
          builtins.map((t) => t.name),
        );
        S.own = res.tools.map((t) => ({
          name: t.name,
          title: 'Your function',
          desc: t.desc,
          schema: t.schema,
          own: true,
          run: (i: Record<string, unknown>) => callOwn(t.name, i),
        }));
      } catch {
        S.own = snap.own.map((t) => ({
          ...t,
          run: (i: Record<string, unknown>) => callOwn(t.name, i),
        }));
      }
    } else {
      S.own = [];
    }
    renderAll(false);
    botIdle();
  }

  function performUndo() {
    if (S.running || !undo.canUndo) return;
    const prev = undo.undo();
    if (prev) void restoreUndo(prev);
    syncUndoUi();
  }

  const syncVer = () => {
    S.ver = defaultVersionOf(P());
  };

  function toast(msg: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }
  function announce(m: string) {
    $('#live').textContent = m;
  }
  function md(s: string) {
    return esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>')
      .replace(/^(\s*)[-*•]\s+/gm, '$1• ');
  }

  function robotSVG(state: string, id?: string) {
    return labBuddyHtml({
      id,
      mood: state === 'still' ? 'idle' : state,
      className: state === 'still' ? 'bot still' : 'bot',
    });
  }
  function bot(state: string, html: string) {
    S.bot = { state, html };
    const b = $('#liveBot');
    if (b) {
      b.setAttribute('class', state === 'still' ? 'lab-buddy bot still' : 'lab-buddy bot');
      b.setAttribute('data-mood', toLabBuddyMood(state === 'still' ? 'idle' : state));
    }
    const say = $('#liveSay');
    if (say) say.innerHTML = S.turns.length ? html : `<span class="who">${esc(agentName())}</span>${html}`;
  }
  function botIdle() {
    if (S.running) return;
    const v = ($('#msg') as HTMLTextAreaElement).value.trim();
    if (v) bot('listen', `I'm listening${DOTS}`);
    else
      bot(
        S.turns.length && ['happy', 'sad'].includes(S.bot.state) ? S.bot.state : 'idle',
        `Hi, I'm <b>${esc(agentName())}</b>. Ask me something.`,
      );
  }
  function keepBot(render: () => void) {
    const old = $('#liveBot');
    render();
    const nb = $('#liveBot');
    if (old && nb && old !== nb && old.isConnected === false) {
      nb.replaceWith(old);
      old.setAttribute('class', S.bot.state === 'still' ? 'lab-buddy bot still' : 'lab-buddy bot');
      old.setAttribute('data-mood', toLabBuddyMood(S.bot.state === 'still' ? 'idle' : S.bot.state));
    }
  }
  const shortVal = (v: unknown) => {
    const t = String(v ?? '');
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  };

  function paintOwn() {
    const ta = $('#ownCode') as HTMLTextAreaElement;
    if (!ta) return;
    const pre = ta.previousElementSibling as HTMLElement;
    if (!pre) return;
    pre.innerHTML = hlPython(ta.value, esc) + '\n ';
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  function resetBtnHTML(name: string) {
    return `<button class="mini" data-act="resetDesc" data-t="${esc(name)}" style="padding:1px 7px;font-size:10.5px">Reset</button>`;
  }
  function auto(t: HTMLTextAreaElement) {
    t.style.height = 'auto';
    t.style.height = Math.min(96, Math.max(40, t.scrollHeight + 2)) + 'px';
    if (t.classList.contains('tdesc')) fitCarousel();
  }

  function renderTools() {
    $('#tlist').innerHTML = allTools()
      .map((t) => {
        const on = !!S.on[t.name];
        return `<div class="tool ${on ? 'on' : ''}" data-card="${esc(t.name)}">
      <div class="th"><label class="swl" title="${on ? 'Take this tool away' : 'Give the agent this tool'}"><input type="checkbox" data-tool="${esc(t.name)}" aria-label="Give the agent ${esc(t.name)}" ${on ? 'checked' : ''} ${!S.running ? '' : 'disabled'}><span class="sw"></span></label>
        <span class="tname"><code title="${esc(t.name)}">${esc(t.name)}</code>${t.own ? `<span class="yours">yours</span>` : `<span class="tt">${esc(t.title || '')}</span>`}</span>
        <button class="mini" data-act="schema" data-t="${esc(t.name)}">${S.openSchema[t.name] ? 'Hide' : 'Inputs'}</button>${t.own ? `<button class="x" data-act="removeOwn" data-t="${esc(t.name)}" title="Remove this tool" aria-label="Remove ${esc(t.name)}" ${S.running ? 'disabled' : ''} style="width:24px;height:24px;font-size:16px">×</button>` : ''}</div>
      <textarea class="tdesc" data-tdesc="${esc(t.name)}" rows="3" spellcheck="false" aria-label="Description of ${esc(t.name)}" ${S.running ? 'disabled' : ''}>${esc(S.descs[t.name] ?? t.desc)}</textarea>
      <div class="tmeta"><span>The model reads this to decide when to call it</span><span class="grow"></span>${(S.descs[t.name] ?? t.desc) !== t.desc ? resetBtnHTML(t.name) : ''}</div>
      <pre class="schema" ${S.openSchema[t.name] ? '' : 'hidden'}>${esc(JSON.stringify(t.schema, null, 2))}</pre>
    </div>`;
      })
      .join('');
    $$('.tdesc').forEach(auto);
    renderCarousel(true);
    renderChips();
  }

  function renderCarousel(jump: boolean) {
    const list = allTools();
    const n = list.length;
    S.tIdx = Math.max(0, Math.min(S.tIdx || 0, Math.max(0, n - 1)));
    $('#tDots').innerHTML = list
      .map(
        (t, i) =>
          `<button class="tdot ${i === S.tIdx ? 'cur' : ''} ${S.on[t.name] ? 'on' : ''}" data-act="tGo" data-i="${i}" aria-label="${esc(t.name)}${S.on[t.name] ? ' (on)' : ''}" title="${esc(t.name)}"></button>`,
      )
      .join('');
    const prev = $$('[data-act="tPrev"]')[0] as HTMLButtonElement;
    const next = $$('[data-act="tNext"]')[0] as HTMLButtonElement;
    if (prev) prev.disabled = S.tIdx <= 0;
    if (next) next.disabled = S.tIdx >= n - 1 || n === 0;
    if (jump) {
      const tl = $('#tlist');
      tl.style.scrollBehavior = 'auto';
      tl.scrollLeft = S.tIdx * (tl.clientWidth + 10);
      tl.style.scrollBehavior = '';
    }
    fitCarousel();
  }
  function fitCarousel() {
    const tl = $('#tlist');
    if (!tl) return;
    const card = tl.children[S.tIdx || 0];
    if (card) tl.style.height = (card as HTMLElement).offsetHeight + 'px';
  }
  function goTool(i: number) {
    const tl = $('#tlist');
    S.tIdx = Math.max(0, Math.min(i, allTools().length - 1));
    tl.scrollTo({ left: S.tIdx * (tl.clientWidth + 10), behavior: 'smooth' });
    renderCarousel(false);
  }
  function renderChips() {
    const on = enabledTools();
    $('#chatTools').innerHTML = on.length
      ? on.map((t) => `<span class="tchip">${esc(t.name)}</span>`).join('')
      : `<span class="tchip none">no tools</span>`;
    $('#chatTitle').textContent = `Chat with ${agentName()}`;
  }

  function stepHTML(s: any, i: number) {
    if (s.type === 'model') {
      const what = s.running
        ? s.final
          ? 'Answering (no more tool rounds)…'
          : 'Thinking…'
        : s.final && !s.calls
          ? 'Answered (tool-round limit reached)'
          : s.calls
            ? `Decided to call ${s.calls.map((c: string) => `<code style="font-family:var(--mono);color:var(--li)">${esc(c)}</code>`).join(', ')}`
            : 'Wrote the answer';
      return `<li class="st model ${s.running ? 'run' : ''}"><span class="dotn">${i + 1}</span><div class="sb">Model · ${what}${s.ms != null ? `<small>${(s.ms / 1000).toFixed(1)}s${s.tok ? ` · ${fmt(s.tok)} tok` : ''}</small>` : ''}${s.text && s.calls ? `<div class="thought">“${esc(s.text.slice(0, 240))}${s.text.length > 240 ? '…' : ''}”</div>` : ''}</div></li>`;
    }
    return `<li class="st tstep ${s.running ? 'run' : ''} ${s.error ? 'fail' : ''}"><span class="dotn">${i + 1}</span><div class="sb">Tool · ran <b style="color:var(--tx)">${esc(s.name)}</b>${s.ms != null ? `<small>${s.ms < 1 ? '<1' : Math.round(s.ms)} ms</small>` : ''}
    <div class="call"><span class="fn">${esc(s.name)}</span>(${esc(JSON.stringify(s.input))})<span class="arr">→</span>${s.running ? '…' : s.error ? `<span class="bad">${esc(s.error)}</span>` : `<span class="res">${esc(s.output)}</span>`}</div></div></li>`;
  }

  function turnHTML(t: any) {
    let h = `<div class="um">${esc(t.q)}</div>`;
    const nTool = t.steps.filter((s: any) => s.type === 'tool').length;
    const tok = t.steps.reduce((a: number, s: any) => a + (s.tok || 0), 0);
    const summary =
      t.status === 'running'
        ? `<b>Working…</b> ${t.steps.length} step${t.steps.length === 1 ? '' : 's'} so far`
        : `<b>${t.steps.length} step${t.steps.length === 1 ? '' : 's'}</b> · ${nTool ? `${nTool} tool call${nTool === 1 ? '' : 's'}` : 'no tools used'} · ${(t.ms / 1000).toFixed(1)}s${tok ? ` · ${fmt(tok)} tokens` : ''}`;
    let check = '';
    if (t.status === 'done' && t.exact) {
      const ok = answerMatches(t.text, t.exact);
      const val = groupNum(fmtNum(t.exact.value));
      check = ok
        ? `<div class="check ok" title="Worked out exactly by the page from ${esc(t.exact.expr)}">✓ Matches the exact result <b>${val}</b></div>`
        : `<div class="check no" title="Worked out exactly by the page from ${esc(t.exact.expr)}">✗ The exact result of ${esc(t.exact.expr)} is <b>${val}</b></div>`;
    }
    const last = t === S.turns[S.turns.length - 1];
    const modelName = models.find((m) => m.id === t.prov)?.name || t.prov;
    const body =
      t.status === 'error'
        ? `<div class="errt">${esc(t.error)}</div>`
        : t.status === 'running'
          ? `<div class="typing" ${last ? 'id="liveSay"' : ''}>${last ? S.bot.html : `Thinking${DOTS}`}</div>`
          : `<div class="amt">${md(t.text) || '<span style="color:var(--fa2)">(no answer)</span>'}</div>`;
    h += `<div class="arow"><div class="av">${last ? robotSVG(S.bot.state, 'liveBot') : robotSVG('still')}</div><div class="am ${t.status === 'error' ? 'err' : ''}" id="t${t.id}">
    <div class="amh"><b>${esc(t.agent)}</b><span>${esc(modelName)}${t.tools.length ? ` · tools: ${t.tools.join(', ')}` : ' · no tools'}</span></div>
    ${body}
    ${t.status !== 'running' ? `<div class="amfoot">${check}<span class="grow"></span><button class="mini" data-act="again" data-t="${t.id}" ${S.running ? 'disabled' : ''} title="Ask the same question again, with the tools that are on now">↻ Ask again</button></div>` : ''}
    ${t.steps.length ? `<details class="trace" ${t.open ? 'open' : ''} data-trace="${t.id}"><summary>${summary}</summary><ol class="steps">${t.steps.map(stepHTML).join('')}</ol></details>` : ''}
  </div></div>`;
    return `<div class="turnwrap" data-turn="${t.id}" style="display:flex;flex-direction:column;gap:10px">${h}</div>`;
  }

  function renderChat(scroll?: boolean) {
    const box = $('#msgs');
    keepBot(() => {
      box.innerHTML = S.turns.length
        ? S.turns.map(turnHTML).join('')
        : `<div class="hero"><div class="herobot">${robotSVG(S.bot.state, 'liveBot')}</div>
        <div class="herosay" id="liveSay"><span class="who">${esc(agentName())}</span>${S.bot.html || `Hi, I'm <b>${esc(agentName())}</b>. Ask me something.`}</div></div>`;
    });
    if (scroll) box.scrollTop = box.scrollHeight;
    ($('#newChatBtn') as HTMLButtonElement).disabled = S.running || !S.turns.length;
  }
  function renderTurn(t: any) {
    const el = host.querySelector(`[data-turn="${t.id}"]`);
    const box = $('#msgs');
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    keepBot(() => {
      if (el) el.outerHTML = turnHTML(t);
      else renderChat(true);
    });
    if (atEnd) box.scrollTop = box.scrollHeight;
  }
  function renderSend() {
    const b = $('#sendBtn') as HTMLButtonElement;
    b.className = 'send' + (S.running ? ' stop' : '');
    b.innerHTML = S.running ? `${IC.stop} Stop` : `${IC.send} Send <kbd>Enter</kbd>`;
    b.title = S.running ? 'Stop the agent' : 'Enter to send · Shift+Enter for a new line';
    ['#provSel', '#name', '#desc', '#instr'].forEach((s) => {
      const el = $(s);
      if (el) el.disabled = S.running;
    });
    syncUndoUi();
  }
  function renderOwn() {
    $('#own').classList.toggle('open', S.ownOpen);
    $('#own').hidden = !S.ownOpen;
    const tg = $('#ownToggle');
    tg.setAttribute('aria-expanded', String(S.ownOpen));
    tg.textContent = S.ownOpen ? 'Close' : '+ Your tool';
    tg.classList.toggle('on', S.ownOpen);
    const b = $('#addOwnBtn') as HTMLButtonElement;
    b.disabled = S.ownBusy || S.running;
    b.textContent = S.ownBusy ? 'Starting Python…' : S.own.length ? "Update the agent's tools" : 'Add to the agent';
  }
  function renderAll(scroll?: boolean) {
    renderTools();
    renderChat(scroll);
    renderSend();
    renderOwn();
  }

  function fillSettings() {
    ($('#temp') as HTMLInputElement).value = String(S.temp);
    ($('#topp') as HTMLInputElement).value = String(S.topp);
    ($('#cap') as HTMLInputElement).value = String(S.cap);
    $('#vTemp').textContent = S.temp.toFixed(2);
    $('#vTopp').textContent = S.topp >= 0.999 ? 'off' : S.topp.toFixed(2);
    $('#vCap').textContent = S.cap + ' tok';
  }
  function openSettings() {
    if (S.running) return;
    fillSettings();
    $('#setModal').classList.add('open');
    ($('#setModal [data-close]') as HTMLElement)?.focus();
  }
  function closeModals() {
    $$('.modal').forEach((m) => m.classList.remove('open'));
  }
  function openPreview() {
    const tools = enabledTools();
    const sys = ($('#instr') as HTMLTextAreaElement).value.trim();
    $('#viewBox').innerHTML = `<div class="mtitle">What the model receives<button class="x" data-close aria-label="Close">×</button></div>
    <div class="note" style="margin-top:0">On every call, the model gets the instruction, the list of tools it may call, and the conversation. It never sees the tools' code, only their names, descriptions and inputs.</div>
    <div class="pm" style="--r:var(--pu)"><div class="ph">INSTRUCTION (SYSTEM)</div><div class="pb">${sys ? esc(sys) : '<span style="color:var(--fa2)">(empty)</span>'}</div></div>
    <div class="pm" style="--r:var(--li)"><div class="ph">TOOLS · ${tools.length}</div><div class="pb">${tools.length ? esc(JSON.stringify(tools.map((t) => ({ name: t.name, description: t.desc, input_schema: t.schema })), null, 2)) : '<span style="color:var(--fa2)">(no tools: the model can only write text)</span>'}</div></div>`;
    $('#viewModal').classList.add('open');
    ($('#viewModal [data-close]') as HTMLElement)?.focus();
  }

  async function runTool(name: string, input: Record<string, unknown>, tools: any[], signal?: AbortSignal) {
    const t = tools.find((x) => x.name === name);
    if (!t) return { error: `The agent does not have a tool called "${name}".` };
    try {
      if (signal?.aborted) throw new Error('Stopped.');
      return { output: String(await t.run(input || {}, signal)) };
    } catch (e: any) {
      return { error: e.message || String(e) };
    }
  }

  function markCompleteOnce() {
    if (completed) return;
    completed = true;
    onComplete?.();
  }

  async function send(again?: string | null, fromId?: number | null) {
    if (S.running) return;
    const q = (again ?? ($('#msg') as HTMLTextAreaElement).value).trim();
    if (!q) {
      ($('#msg') as HTMLTextAreaElement).focus();
      return;
    }
    pushUndo();
    const tools = enabledTools();
    const system = ($('#instr') as HTMLTextAreaElement).value.trim();
    const cut = fromId != null ? S.turns.findIndex((x) => x.id === fromId) : S.turns.length;
    const history = S.turns
      .slice(0, cut < 0 ? S.turns.length : cut)
      .filter((t) => t.status === 'done')
      .flatMap((t) => [
        { role: 'user' as const, text: t.q },
        { role: 'assistant' as const, text: t.text || '(no answer)' },
      ]);
    const t: any = {
      id: UID++,
      q,
      agent: agentName(),
      prov: S.prov,
      tools: tools.map((x) => x.name),
      steps: [],
      status: 'running',
      t0: performance.now(),
      open: true,
      exact: exactFor(q),
    };
    S.turns.forEach((x) => (x.open = false));
    S.turns.push(t);
    S.running = true;
    const ctrl = new AbortController();
    S.ctrl = ctrl;
    if (again == null) {
      ($('#msg') as HTMLTextAreaElement).value = '';
      rotatePlaceholder();
    }
    renderAll(true);
    bot('think', `Thinking${DOTS}`);

    const messages: AgentMessage[] = [...history, { role: 'user', text: q }];
    const toolSchemas = tools.map((x) => ({ name: x.name, desc: x.desc, schema: x.schema }));

    try {
      for (let round = 0; ; round++) {
        const final = round >= S.maxSteps;
        const ms: any = { type: 'model', running: true, final };
        t.steps.push(ms);
        renderTurn(t);
        if (round > 0) bot('think', final ? `Writing my answer${DOTS}` : `Got the result. Thinking${DOTS}`);
        const t0 = performance.now();
        let r: AgentStepResult;
        try {
          r = await runAgentStep(
            sessionId,
            projectId,
            {
              system,
              messages,
              tools: toolSchemas,
              model: S.ver || P()?.defaultVersion || S.prov,
              temp: S.temp,
              topp: S.topp,
              cap: S.cap,
              final: final && tools.length > 0,
            },
            ctrl.signal,
          );
        } catch (e: any) {
          if (e?.name === 'AbortError' || /abort|stopped/i.test(String(e?.message || e))) {
            throw new Error('Stopped.');
          }
          throw e;
        }
        Object.assign(ms, {
          running: false,
          ms: performance.now() - t0,
          tok: r.tok,
          text: r.text,
          calls: !final && r.calls?.length ? r.calls.map((c) => c.name) : null,
        });
        renderTurn(t);
        if (!r.calls?.length || final) {
          t.text = r.text;
          if (final && r.calls?.length && !r.text) {
            t.text = `(The agent reached its limit of ${S.maxSteps} tool round${S.maxSteps === 1 ? '' : 's'} before it could answer.)`;
          }
          break;
        }
        messages.push({
          role: 'assistant',
          text: r.text,
          calls: r.calls as AgentToolCall[],
        });
        for (const c of r.calls) {
          if (ctrl.signal.aborted) throw new Error('Stopped.');
          const ts: any = { type: 'tool', name: c.name, input: c.input, running: true };
          t.steps.push(ts);
          renderTurn(t);
          bot(
            'using',
            `Using <code>${esc(c.name)}</code> ${esc(shortVal(Object.values(c.input || {}).join(', ')))}${DOTS}`,
          );
          const s0 = performance.now();
          const out = await runTool(c.name, c.input || {}, tools, ctrl.signal);
          const toolMs = performance.now() - s0;
          if (toolMs < 650) {
            await waitOrStop(650 - toolMs, ctrl.signal).catch(() => {});
          }
          Object.assign(ts, { running: false, ms: toolMs, output: out.output, error: out.error });
          renderTurn(t);
          if (out.error) {
            messages.push({ role: 'tool', id: c.id, name: c.name, error: out.error });
          } else {
            messages.push({ role: 'tool', id: c.id, name: c.name, output: out.output });
          }
        }
        if (ctrl.signal.aborted) throw new Error('Stopped.');
      }
      t.status = 'done';
    } catch (e: any) {
      t.status = 'error';
      t.error = e.message || String(e);
      t.steps = t.steps.filter((s: any) => !s.running);
    }
    t.ms = performance.now() - t.t0;
    S.running = false;
    S.ctrl = null;
    if (t.status === 'done') t.open = false;
    renderAll(true);
    const nT = t.steps.filter((x: any) => x.type === 'tool').length;
    if (t.status === 'done') {
      bot(
        'happy',
        `Done. ${nT ? `I used ${nT === 1 ? '1 tool call' : nT + ' tool calls'}.` : 'I answered without any tools.'} The steps are under my answer.`,
      );
      markCompleteOnce();
    } else {
      bot('sad', t.error === 'Stopped.' ? 'Stopped.' : `Something went wrong: ${esc(shortVal(t.error))}`);
    }
    announce(t.status === 'done' ? 'The agent answered.' : 'The agent stopped with an error.');
    ($('#msg') as HTMLTextAreaElement).focus();
  }

  function rotatePlaceholder() {
    PH = (PH + 1) % MSG_EXAMPLES.length;
    ($('#msg') as HTMLTextAreaElement).placeholder = MSG_EXAMPLES[PH];
  }

  async function addOwn() {
    const code = ($('#ownCode') as HTMLTextAreaElement).value;
    if (!code.trim()) {
      ($('#ownCode') as HTMLTextAreaElement).focus();
      return;
    }
    if (S.running) return;
    if (code.length > maxOwnCodeChars) {
      $('#ownMsg').innerHTML = `<span class="bad">Code is too long (max ${maxOwnCodeChars} characters).</span>`;
      return;
    }
    const msg = $('#ownMsg');
    S.ownBusy = true;
    renderOwn();
    msg.innerHTML = `<span style="color:var(--fa)">Starting Python in this page. The first time takes a few seconds…</span>`;
    try {
      void ensurePython();
      const res = await defineOwn(
        code,
        builtins.map((t) => t.name),
      );
      if (builtins.length + res.tools.length > maxTools) {
        msg.innerHTML = `<span class="bad">Too many tools (max ${maxTools} including built-ins).</span>`;
        S.ownBusy = false;
        renderOwn();
        return;
      }
      pushUndo();
      const before = new Set(S.own.map((t) => t.name));
      S.own.forEach((t) => {
        if (!res.tools.some((n) => n.name === t.name)) delete S.on[t.name];
      });
      S.own = res.tools.map((t) => ({
        name: t.name,
        title: 'Your function',
        desc: t.desc,
        schema: t.schema,
        own: true,
        run: (i: Record<string, unknown>) => callOwn(t.name, i),
      }));
      S.own.forEach((t) => {
        S.descs[t.name] = t.desc;
        if (!before.has(t.name)) S.on[t.name] = true;
      });
      msg.innerHTML =
        (S.own.length
          ? `<span class="ok">✓ ${S.own.length === 1 ? '1 tool' : S.own.length + ' tools'} ready: ${S.own.map((t) => `<b>${esc(t.name)}</b>`).join(', ')}</span>`
          : '') + res.notes.map((n) => `<span class="warn">${esc(n)}</span>`).join('');
    } catch (e) {
      msg.innerHTML = `<span class="bad">${esc(pyErr(e))}</span>`;
    }
    S.ownBusy = false;
    renderOwn();
    renderTools();
    if (S.own.length) goTool(builtins.length);
  }

  const onInput = (e: Event) => {
    const t = e.target as HTMLElement & { dataset: DOMStringMap; id: string; value: string };
    if (t.dataset?.tdesc) {
      if (!descUndoPushed) {
        pushUndo();
        descUndoPushed = true;
      }
      S.descs[t.dataset.tdesc] = (t as HTMLTextAreaElement).value;
      auto(t as HTMLTextAreaElement);
      const m = t.parentElement!.querySelector('.tmeta')!;
      const tool = allTools().find((x) => x.name === t.dataset.tdesc);
      const btn = m.querySelector('[data-act=resetDesc]');
      const want = (t as HTMLTextAreaElement).value !== tool?.desc;
      if (want && !btn) m.insertAdjacentHTML('beforeend', resetBtnHTML(tool.name));
      else if (!want && btn) btn.remove();
    } else if (t.id === 'name' || t.id === 'desc' || t.id === 'instr') {
      if (!agentFieldUndoPushed) {
        pushUndo();
        agentFieldUndoPushed = true;
      }
      if (t.id === 'name') {
        renderChips();
        botIdle();
      }
    } else if (t.id === 'msg') {
      botIdle();
    } else if (t.id === 'ownCode') {
      if (!ownCodeUndoPushed) {
        pushUndo();
        ownCodeUndoPushed = true;
      }
      paintOwn();
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
    const t = e.target as HTMLElement & { dataset: DOMStringMap; id: string; checked?: boolean; value: string };
    descUndoPushed = false;
    agentFieldUndoPushed = false;
    ownCodeUndoPushed = false;
    if (t.dataset?.tool) {
      pushUndo();
      S.on[t.dataset.tool] = !!(t as HTMLInputElement).checked;
      const card = t.closest('.tool')!;
      card.classList.toggle('on', !!(t as HTMLInputElement).checked);
      (t.closest('.swl') as HTMLElement).title = (t as HTMLInputElement).checked
        ? 'Take this tool away'
        : 'Give the agent this tool';
      renderChips();
      renderCarousel(false);
    } else if (t.id === 'provSel') {
      pushUndo();
      S.prov = (t as HTMLSelectElement).value;
      syncVer();
    } else if (t.id === 'temp' || t.id === 'topp' || t.id === 'cap') {
      pushUndo();
    }
  };

  const onToggle = (e: Event) => {
    const d = e.target as HTMLDetailsElement;
    if (d.dataset?.trace) {
      const turn = S.turns.find((x) => x.id === +d.dataset.trace!);
      if (turn) turn.open = d.open;
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('modal') || target.closest('[data-close]')) {
      closeModals();
      return;
    }
    const undoBtn = target.closest('#undoBtn');
    if (undoBtn) {
      performUndo();
      return;
    }
    const a = target.closest('[data-act]') as HTMLElement | null;
    if (a) {
      const act = a.dataset.act;
      if (act === 'example') {
        if (S.running) return;
        const has =
          ($('#name') as HTMLInputElement).value.trim() ||
          ($('#desc') as HTMLTextAreaElement).value.trim() ||
          ($('#instr') as HTMLTextAreaElement).value.trim();
        if (!has || confirm("Replace the agent's name, description and instruction with the example?")) {
          pushUndo();
          ($('#name') as HTMLInputElement).value = EXAMPLE.name;
          ($('#desc') as HTMLTextAreaElement).value = EXAMPLE.desc;
          ($('#instr') as HTMLTextAreaElement).value = EXAMPLE.instr;
          renderTools();
          botIdle();
        }
      } else if (act === 'schema') {
        S.openSchema[a.dataset.t!] = !S.openSchema[a.dataset.t!];
        renderTools();
      } else if (act === 'resetDesc') {
        pushUndo();
        const tool = allTools().find((x) => x.name === a.dataset.t);
        if (tool) {
          S.descs[tool.name] = tool.desc;
          renderTools();
        }
      } else if (act === 'preview') {
        openPreview();
      } else if (act === 'tPrev') {
        goTool(S.tIdx - 1);
      } else if (act === 'tNext') {
        goTool(S.tIdx + 1);
      } else if (act === 'tGo') {
        goTool(+a.dataset.i!);
      } else if (act === 'again') {
        const turn = S.turns.find((x) => x.id === +a.dataset.t!);
        if (turn && !S.running) void send(turn.q, turn.id);
      } else if (act === 'toggleOwn') {
        S.ownOpen = !S.ownOpen;
        renderOwn();
        if (S.ownOpen) ($('#ownCode') as HTMLTextAreaElement).focus();
      } else if (act === 'ownExample') {
        const ta = $('#ownCode') as HTMLTextAreaElement;
        if (!ta.value.trim() || confirm('Replace your code with the example?')) {
          pushUndo();
          ta.value = OWN_EXAMPLE;
          paintOwn();
          ta.focus();
        }
      } else if (act === 'addOwn') {
        void addOwn();
      } else if (act === 'removeOwn') {
        pushUndo();
        S.own = S.own.filter((x) => x.name !== a.dataset.t);
        delete S.on[a.dataset.t!];
        renderTools();
      } else if (act === 'newChat') {
        if (confirm('Clear the conversation?')) {
          pushUndo();
          S.turns = [];
          renderAll(false);
          botIdle();
        }
      } else if (act === 'resetParams') {
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
    if (b.id === 'sendBtn') {
      if (S.running) S.ctrl?.abort();
      else void send(null);
    } else if (b.id === 'settingsBtn') {
      openSettings();
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModals();
      return;
    }
    const t = e.target as HTMLElement;
    if (t.id === 'msg' && e.key === 'Enter' && !e.shiftKey && !(e as any).isComposing) {
      e.preventDefault();
      if (!S.running) void send(null);
    }
    if (t.id === 'ownCode') {
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const ta = t as HTMLTextAreaElement;
        const p = ta.selectionStart;
        ta.setRangeText('    ', p, ta.selectionEnd, 'end');
        paintOwn();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void addOwn();
      }
    }
  };

  const onScroll = (e: Event) => {
    const t = e.target as HTMLElement;
    if (t.id === 'ownCode') {
      const pre = t.previousElementSibling as HTMLElement;
      if (pre) {
        pre.scrollTop = t.scrollTop;
        pre.scrollLeft = t.scrollLeft;
      }
    }
  };

  const onTlistScroll = () => {
    if (tScrollT) clearTimeout(tScrollT);
    tScrollT = setTimeout(() => {
      const tl = $('#tlist');
      const i = Math.round(tl.scrollLeft / Math.max(1, tl.clientWidth + 10));
      if (i !== S.tIdx) {
        S.tIdx = i;
        renderCarousel(false);
      }
    }, 80);
  };

  const onResize = () => renderCarousel(true);

  host.addEventListener('input', onInput);
  host.addEventListener('change', onChange);
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  host.addEventListener('toggle', onToggle, true);
  host.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);

  void (async () => {
    try {
      catalog = await loadAgentCatalog(sessionId, projectId);
      models = catalog.models || [];
      EXAMPLE = catalog.example || EXAMPLE;
      MSG_EXAMPLES = catalog.messages?.length ? catalog.messages : MSG_EXAMPLES;
      OWN_EXAMPLE = catalog.ownExample || OWN_EXAMPLE;
      DEFAULTS = {
        temp: catalog.defaults?.temp ?? 0.2,
        topp: catalog.defaults?.topp ?? 1,
        cap: catalog.defaults?.cap ?? 800,
        maxSteps: catalog.defaults?.maxSteps ?? 5,
        prov: catalog.defaults?.prov || models[0]?.id || 'gemini-38-flash',
      };
      maxTools = catalog.maxTools ?? 8;
      maxOwnCodeChars = catalog.maxOwnCodeChars ?? 8000;
      builtins = (catalog.tools || []).map(attachBuiltinRunner);
      S.descs = Object.fromEntries(builtins.map((t) => [t.name, t.desc]));
      S.temp = DEFAULTS.temp;
      S.topp = DEFAULTS.topp;
      S.cap = DEFAULTS.cap;
      S.maxSteps = DEFAULTS.maxSteps;
      S.prov = DEFAULTS.prov;
      S.ver = defaultVersionOf(P());

      $('#settingsBtn').innerHTML = IC.gear;
      unbindFs = bindHostFullscreen(host, $('#fsBtn'));
      ($('#provSel') as HTMLSelectElement).innerHTML = models
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
        .join('');
      ($('#provSel') as HTMLSelectElement).value = S.prov;
      syncVer();
      ($('#msg') as HTMLTextAreaElement).placeholder = MSG_EXAMPLES[0];
      renderAll(false);
      paintOwn();
      botIdle();
      $('#tlist')?.addEventListener('scroll', onTlistScroll);
      host.classList.remove('is-booting');
    } catch (e: any) {
      host.classList.remove('is-booting');
      toast(esc(e?.message || 'Could not load the agent lab.'));
    }
  })();

  return () => {
    host.removeEventListener('input', onInput);
    host.removeEventListener('change', onChange);
    host.removeEventListener('click', onClick);
    host.removeEventListener('keydown', onKey);
    host.removeEventListener('toggle', onToggle, true);
    host.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    $('#tlist')?.removeEventListener('scroll', onTlistScroll);
    if (tScrollT) clearTimeout(tScrollT);
    S.ctrl?.abort();
    unbindFs?.();
    unbindTheme();
    host.innerHTML = '';
    host.classList.remove('is-booting');
  };
}
