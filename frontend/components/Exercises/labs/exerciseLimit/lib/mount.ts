/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import {
  loadLimitCatalog,
  runLimitChat,
  runLimitCompact,
  type LimitCatalog,
  type LimitModel,
} from './api';
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
  ${exerciseBrandHtml(10, 'Exercise - 10 : Hit the Limit, Then Manage It')}
  ${THEME_TOGGLE_HTML}
  ${UNDO_BUTTON_HTML}
  <label class="msel" title="The model that answers in this chat">
    <span>Models</span>
    <select id="provSel"></select>
  </label>
  <button class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
  <button class="icon" id="settingsBtn" title="Model parameters: temperature, top-p, output cap" aria-label="Model parameters"></button>
</header>

<main>
  <!-- Left: persona + conversation -->
  <div class="col">
    <section class="card persona" id="personaCard">
      <div class="chead"><span class="n">1</span><div class="ct"><b>Persona</b><span>Sits in the context window on every call</span></div>
        <div class="psum" id="psum"></div>
        <button class="mini" data-act="togglePersona" id="pToggle"></button></div>
      <textarea id="sys" spellcheck="false" placeholder="Paste or write your persona…"></textarea>
    </section>

    <section class="card convo">
      <div class="chead"><span class="n">2</span><div class="ct"><b>Conversation</b><span id="convoSub"></span></div>
        <button class="mini" data-act="newChat" id="newChatBtn" title="Clear the whole conversation">New chat</button></div>
      <div class="chat" id="chat" aria-live="polite"></div>
      <div class="composer">
        <div class="compose-row">
          <div class="compose-box">
            <textarea id="msg" rows="1" placeholder="Type your message here…"></textarea>
            <span class="draft" id="draftTok"></span>
          </div>
          <button class="send" id="sendBtn"></button>
        </div>
      </div>
    </section>
  </div>

  <!-- Right: the window + the tools -->
  <div class="col side">
    <section class="card">
      <div class="chead"><span class="n">3</span><div class="ct"><b>Context window</b><span>Everything the model reads on the next call</span></div></div>
      <div class="ctxgrid">
        <div class="beaker" id="beaker" role="img" aria-label="Context window fill level"></div>
        <div>
          <div class="bignum" id="bigNum"></div>
          <div class="pct" id="pctBar"><i></i></div>
          <div class="status" id="status"></div>
          <ul class="legend" id="legend"></ul>
          <div class="fine" id="fine"></div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="chead"><span class="n">4</span><div class="ct"><b>Manage the window</b><span>Get back under the limit</span></div></div>
      <div class="sec" style="margin-top:14px">
        <div class="sl">Window size</div>
        <div class="sd">The most tokens this chat may send in one call.</div>
        <div class="segctl" id="limitCtl"></div>
      </div>
      <div class="sec">
        <div class="sl">Prune</div>
        <div class="sd">Drop messages from the window. Use ✂ on any message, or:</div>
        <div class="brow">
          <button class="act" data-act="dropOldest" id="dropOldestBtn"></button>
          <button class="act" data-act="restoreDropped" id="restoreBtn"></button>
        </div>
      </div>
      <div class="sec">
        <div class="sl">Compact</div>
        <div class="sd">Replace older messages with a short summary the model writes.</div>
        <div class="keep">Keep the last
          <span class="stepper"><button data-act="keepDown" aria-label="Keep fewer">−</button><b id="keepN"></b><button data-act="keepUp" aria-label="Keep more">+</button></span>
          messages as they are</div>
        <div class="brow">
          <button class="act blue" data-act="compact" id="compactBtn"></button>
          <button class="act" data-act="undoSummary" id="undoSumBtn">Undo summary</button>
        </div>
        <div id="compactInfo"></div>
      </div>
    </section>
  </div>
</main>

<!-- Parameters -->
<div class="modal" id="setModal"><div class="mbox">
  <div class="mtitle"><span>Model parameters</span><button class="x" data-close>×</button></div>
  <div class="prm"><div class="prh"><span>Temperature</span><b id="vTemp"></b></div>
    <input type="range" id="temp" min="0" max="2" step="0.05"><div class="prd">Low = focused and repeatable. High = varied and creative.</div></div>
  <div class="prm"><div class="prh"><span>Top-p</span><b id="vTopp"></b></div>
    <input type="range" id="topp" min="0.05" max="1" step="0.05"><div class="prd">Keeps only the most likely words until their odds add up to p. 1 = off.</div></div>
  <div class="prm"><div class="prh"><span>Output cap</span><b id="vCap"></b></div>
    <input type="range" id="cap" min="50" max="1000" step="10"><div class="prd">The longest reply allowed, in tokens. This room is kept free in the window for the reply.</div></div>
  <div class="note">Claude accepts temperatures up to 1, so higher values are capped at 1 for Claude.</div>
  <div style="margin-top:14px"><button class="mini" data-act="resetParams" style="padding:6px 12px">Reset to defaults</button></div>
</div></div>

<div class="sr" aria-live="polite" id="live"></div>
<div id="toasts"></div>`;

export function mountExerciseLimit(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;

  host.innerHTML = TEMPLATE;
  host.classList.add('is-booting');
  const unbindTheme = bindExerciseTheme(host);

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T | null;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...host.querySelectorAll(sel)] as T[];

  let MSG_OVERHEAD = 4;
  const PARAM_DEFAULTS = { temp: 0.3, topp: 1, cap: 300 };





           /* each message costs a few tokens for its role label */





const MSG_PLACEHOLDER = 'Type your message here…';

/* ============ State ============ */
let UID = 1;
  let aborted = false;
  let markedComplete = false;
  let LIMITS: number[] = [1000, 2000, 4000, 8000];
  let models: Record<string, LimitModel> = {};
  let defaultProv = 'gemini';
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
const S: {
    prov: string; ver: string; temp: number; topp: number; cap: number; limit: number; keep: number;
    msgs: Array<{ id: number; role: string; text: string; state: string; open?: boolean; retry?: boolean }>;
    summary: { text: string; ids: number[]; before: number; after: number } | null;
    running: boolean; compacting: boolean; pending: { t0: number; note?: string } | null;
    ctrl: AbortController | null;
    lastCall: { est: number; real: number } | null;
    personaOpen: boolean; showSummed: boolean;
  } = {
  prov: 'gemini', ver: '', temp: PARAM_DEFAULTS.temp, topp: PARAM_DEFAULTS.topp, cap: PARAM_DEFAULTS.cap,
  limit:2000, keep:2,
  msgs:[],              /* {id, role:"user"|"assistant"|"error", text, state:"in"|"dropped"|"summed", open} */
  summary:null,         /* {text, ids:[], before, after} */
  running:false, compacting:false, pending:null, ctrl:null,
  lastCall:null,        /* {est, real} */
  personaOpen:true, showSummed:false
};

type UndoSnap = {
  msgs: typeof S.msgs;
  summary: typeof S.summary;
  showSummed: boolean;
  limit: number;
  keep: number;
  prov: string;
  ver: string;
  temp: number;
  topp: number;
  cap: number;
  sys: string;
  uid: number;
};

const undo = createUndoStack<UndoSnap>({ max: 40 });

function snapshotUndo(): UndoSnap {
  return {
    msgs: cloneState(S.msgs),
    summary: S.summary ? cloneState(S.summary) : null,
    showSummed: S.showSummed,
    limit: S.limit,
    keep: S.keep,
    prov: S.prov,
    ver: S.ver,
    temp: S.temp,
    topp: S.topp,
    cap: S.cap,
    sys: ($("#sys") as HTMLTextAreaElement).value,
    uid: UID,
  };
}

function restoreUndo(s: UndoSnap) {
  S.msgs = cloneState(s.msgs);
  S.summary = s.summary ? cloneState(s.summary) : null;
  S.showSummed = s.showSummed;
  S.limit = s.limit;
  S.keep = s.keep;
  S.prov = s.prov;
  S.ver = s.ver;
  S.temp = s.temp;
  S.topp = s.topp;
  S.cap = s.cap;
  UID = s.uid;
  ($("#sys") as HTMLTextAreaElement).value = s.sys;
  ($("#provSel") as HTMLSelectElement).value = S.prov;
  syncVer();
  renderAll(false);
}

function pushUndo() {
  if (S.running || S.compacting) return;
  undo.push(snapshotUndo());
  syncUndoButton($("#undoBtn") as HTMLButtonElement | null, undo.canUndo);
}

function performUndo() {
  if (S.running || S.compacting || !undo.canUndo) return;
  const prev = undo.undo();
  if (prev) restoreUndo(prev);
  syncUndoButton($("#undoBtn") as HTMLButtonElement | null, undo.canUndo);
}

function syncUndoUi() {
  syncUndoButton($("#undoBtn") as HTMLButtonElement | null, undo.canUndo && !S.running && !S.compacting);
}

/* ============ Helpers ============ */


const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = n => Math.round(n).toLocaleString("en-IN");
const estTok = s => Math.ceil((s||"").length/4);
const msgTok = m => estTok(m.text)+MSG_OVERHEAD;
const words = s => ((s||"").trim().match(/\S+/g)||[]).length;
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const P = () => models[S.prov] || models[defaultProv] || Object.values(models)[0];
const syncVer = () => {
  S.ver = defaultVersionOf(P());
};
const chatMsgs = () => S.msgs.filter(m=>m.role==="user"||m.role==="assistant");
const inCtx = () => chatMsgs().filter(m=>m.state==="in");
const connected = () => true;
function md(s){
  return esc(s).replace(/`([^`\n]+)`/g,"<b>$1</b>").replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")
    .replace(/^#{1,4}\s+(.+)$/gm,"<b>$1</b>").replace(/^(\s*)[-*•]\s+/gm,"$1• ");
}
function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.innerHTML=msg; $("#toasts").appendChild(t); setTimeout(()=>t.remove(),3600); }
function announce(msg){ $("#live").textContent=msg; }
const summaryBlock = () => S.summary ? "Summary of the earlier conversation:\n"+S.summary.text : "";
function systemText(){
  const sys=$("#sys").value.trim(), sb=summaryBlock();
  return [sys,sb].filter(Boolean).join("\n\n");
}
/* What the next call would contain, piece by piece */
function usage(includeDraft){
  const persona=estTok($("#sys").value.trim());
  const summary=S.summary?estTok(summaryBlock()):0;
  const kept=inCtx();
  const user=kept.filter(m=>m.role==="user").reduce((a,m)=>a+msgTok(m),0);
  const asst=kept.filter(m=>m.role==="assistant").reduce((a,m)=>a+msgTok(m),0);
  const d=$("#msg").value.trim();
  const draft=includeDraft && d ? estTok(d)+MSG_OVERHEAD : 0;
  const reply=S.cap;
  const total=persona+summary+user+asst+draft+reply;
  return {persona,summary,user,asst,draft,reply,total,sent:total-reply-draft};
}
/* The messages actually sent: kept messages, same-role neighbours merged, starting with the user */
function contextMessages(){
  const out=[];
  inCtx().forEach(m=>{ const last=out[out.length-1]; if(last&&last.role===m.role) last.text+="\n\n"+m.text; else out.push({role:m.role,text:m.text}); });
  if(out.length && out[0].role==="assistant") out.unshift({role:"user",text:"(The earlier conversation is not included.)"});
  return out;
}

/* ============ Icons ============ */
const IC = {
  gear:'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  fsOn:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fsOff:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  send:'<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  stop:'<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
  cut:'<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg>',
  keep:'<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  compress:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 14 6 0 0 6"/><path d="m20 10-6 0 0-6"/><path d="M14 10 21 3"/><path d="M3 21l7-7"/></svg>'
};

/* ============ Render ============ */
function renderPersona(){
  const card=$("#personaCard"), sys=$("#sys").value.trim();
  card.classList.toggle("collapsed",!S.personaOpen);
  $("#pToggle").textContent = S.personaOpen ? "Collapse" : "Edit";
  $("#pToggle").disabled = !sys && S.personaOpen;
  const first=sys.split("\n").find(l=>l.trim())||"";
  $("#psum").innerHTML = sys ? `${esc(first)} <i>· ≈${fmt(estTok(sys))} tok</i>` : `<i>No persona</i>`;
}
function msgHTML(m){
  if(m.role==="error") return `<div class="msg error" id="m${m.id}"><div class="mh"><span class="role">Not sent</span></div>
    <div class="mt">${esc(m.text)}</div>${m.retry?`<button class="mini retry" data-act="retry" data-m="${m.id}" ${S.running?"disabled":""}>Try again</button>`:""}</div>`;
  const long = m.text.length>700 || m.text.split("\n").length>9;
  const tag = m.state==="dropped" ? `<span class="tag">dropped</span>` : m.state==="summed" ? `<span class="tag">in summary</span>` : "";
  const btn = m.state==="summed" ? "" : m.state==="dropped"
    ? `<button class="cut" data-act="keepMsg" data-m="${m.id}" title="Put this message back in the window" ${S.running||S.compacting?"disabled":""}>${IC.keep} Keep</button>`
    : `<button class="cut" data-act="dropMsg" data-m="${m.id}" title="Remove this message from the window" ${S.running||S.compacting?"disabled":""}>${IC.cut} Drop</button>`;
  const avatar = m.role==="assistant"
    ? labBuddyHtml({ mood: 'speak', size: 56, className: 'msg-buddy' })
    : `<span class="msg-you" aria-hidden="true">You</span>`;
  return `<div class="msg ${m.role} ${m.state}" id="m${m.id}">
    <div class="msg-row">${avatar}<div class="msg-body">
    <div class="mh"><span class="role">${m.role==="user"?"You":esc(P().name)}</span><span class="tok">≈${fmt(msgTok(m))} tok</span>${tag}<span class="grow"></span>${btn}</div>
    <div class="mt ${long&&!m.open?"long":""}">${md(m.text)}</div>
    ${long?`<button class="more" data-act="more" data-m="${m.id}">${m.open?"Show less":"Show more"}</button>`:""}
    </div></div>
  </div>`;
}
function emptyChatHtml(){
  return `<div class="empty empty-buddy">
    ${labBuddyHtml({ mood: 'idle', size: 108, className: 'ex-empty-buddy' })}
    <div class="empty-copy">
      <b>Start chatting</b>
      <p>Type a message below. Replies appear here with the robot.</p>
    </div>
  </div>`;
}
function renderChat(scroll){
  const box=$("#chat"), all=S.msgs;
  if(!all.length && !S.pending){
    box.innerHTML=emptyChatHtml();
  } else {
    let h="", sumShown=false;
    const summed=all.filter(m=>m.state==="summed");
    all.forEach(m=>{
      if(m.state==="summed"){
        if(!sumShown && S.summary){
          sumShown=true;
          h+=`<div class="sumcard" id="sumcard"><div class="msg-row">${labBuddyHtml({ mood: 'think', size: 56, className: 'msg-buddy' })}<div class="msg-body"><div class="mh"><span class="role">Summary</span><span class="tok">≈${fmt(estTok(summaryBlock()))} tok</span><span class="tag" style="border-color:rgba(185, 10, 189,.5)">replaces ${summed.length} message${summed.length===1?"":"s"}</span></div>
            <div class="mt">${md(S.summary.text)}</div>
            <button class="linkish" data-act="showSummed">${S.showSummed?"Hide":"Show"} the ${summed.length} original message${summed.length===1?"":"s"}</button></div></div></div>`;
        }
        if(S.showSummed) h+=msgHTML(m);
        return;
      }
      h+=msgHTML(m);
    });
    if(S.pending) h+=`<div class="msg assistant pending"><div class="msg-row">${labBuddyHtml({ mood: 'think', size: 56, className: 'msg-buddy' })}<div class="msg-body"><div class="mh"><span class="role">${esc(P().name)}</span><span class="tok">${S.pending.note?esc(S.pending.note):"writing a reply"}</span><span class="elapsed" id="elapsed">0.0s</span></div><div class="skel"><i style="width:92%"></i><i style="width:76%"></i><i style="width:58%"></i></div></div></div></div>`;
    box.innerHTML=h;
  }
  const n=chatMsgs().length, k=inCtx().length;
  $("#convoSub").textContent = n ? `${n} message${n===1?"":"s"} · ${k} in the window` : "Type below — messages build up in the window";
  $("#newChatBtn").disabled = S.running||S.compacting||!S.msgs.length;
  if(scroll) box.scrollTop=box.scrollHeight;
}
function renderMeter(){
  const u=usage(true), lim=S.limit, over=u.total>lim, max=Math.max(lim,u.total);
  const H=$("#beaker").clientHeight||330;
  const px=t=>t/max*H;
  const segs=[];
  const push=(cls,tok,title,mid)=>{ if(tok>0) segs.push({cls,tok,title,mid}); };
  push("persona",u.persona,`Persona · ≈${fmt(u.persona)} tokens`);
  push("summary",u.summary,`Summary · ≈${fmt(u.summary)} tokens`);
  inCtx().forEach((m,i)=>push(m.role,msgTok(m),`${m.role==="user"?"You":P().name} · ≈${fmt(msgTok(m))} tokens · click to find it`,m.id));
  push("draft",u.draft,`The message you are typing · ≈${fmt(u.draft)} tokens`);
  push("reply",u.reply,`Room kept for the reply (output cap) · ${fmt(u.reply)} tokens`);
  let y=0, html="";
  segs.forEach(s=>{ const hgt=Math.max(2,px(s.tok)); html+=`<div class="seg ${s.cls}" style="bottom:${y}px;height:${hgt}px" title="${esc(s.title)}" ${s.mid?`data-seg="${s.mid}"`:""}></div>`; y+=px(s.tok); });
  const ly=px(lim);
  if(over) html+=`<div class="overband" style="height:${H-ly}px"></div>`;
  html+=`<div class="limitline" style="bottom:${ly}px"><span>${fmt(lim)} limit</span></div>`;
  const b=$("#beaker"); if(!b) return; b.innerHTML=html; b.classList.toggle("over",over);
  b.style.borderColor = over ? "rgba(236, 72, 153,.7)" : "";
  $("#bigNum").innerHTML=`${fmt(u.total)} <small>/ ${fmt(lim)}</small>`;
  $("#pctBar").classList.toggle("over",over);
  $("#pctBar").firstElementChild.style.width=Math.min(100,u.total/lim*100)+"%";
  const st=$("#status");
  st.className="status "+(over?"bad":"ok");
  st.textContent = over ? `Over the limit by ${fmt(u.total-lim)} tokens` : `Fits · ${fmt(lim-u.total)} tokens free`;
  const row=(cls,label,v)=>`<li><span class="sw ${cls}"></span>${label}<b>${fmt(v)}</b></li>`;
  $("#legend").innerHTML = row("persona","Persona",u.persona) + row("summary","Summary",u.summary)
    + row("user","Your messages",u.user) + row("assistant","Model replies",u.asst)
    + row("draft","Message being typed",u.draft) + row("reply","Room for the reply",u.reply);
  $("#fine").innerHTML = `Counts are estimates: about 4 characters per token.`
    + (S.lastCall ? `<br>Last call: the page estimated <b>≈${fmt(S.lastCall.est)}</b>, the model counted <b>${fmt(S.lastCall.real)}</b> tokens in.` : "");
  const draftEl = $("#draftTok");
  if(draftEl){
    draftEl.textContent = u.draft ? `≈${fmt(u.draft)} tok` : "";
    draftEl.hidden = !u.draft;
  }
}
function renderManage(){
  const busy=S.running||S.compacting;
  $("#limitCtl").innerHTML = LIMITS.map(l=>`<button class="${l===S.limit?"on":""}" data-limit="${l}" ${busy?"disabled":""}>${l>=1000?(l/1000)+"k":l}</button>`).join("");
  const kept=inCtx(), dropped=chatMsgs().filter(m=>m.state==="dropped");
  const oldest=kept[0];
  const pairTok = oldest ? msgTok(oldest)+((kept[1]&&kept[1].role==="assistant"&&oldest.role==="user")?msgTok(kept[1]):0) : 0;
  $("#dropOldestBtn").innerHTML=`${IC.cut} Drop oldest exchange ${oldest?`<small>−${fmt(pairTok)}</small>`:""}`;
  $("#dropOldestBtn").disabled=busy||!oldest;
  $("#restoreBtn").innerHTML=`${IC.keep} Restore dropped ${dropped.length?`<small>${dropped.length}</small>`:""}`;
  $("#restoreBtn").disabled=busy||!dropped.length;
  $("#keepN").textContent=S.keep;
  const cand=compactCandidates(), candTok=cand.reduce((a,m)=>a+msgTok(m),0)+(S.summary?estTok(summaryBlock()):0);
  $("#compactBtn").innerHTML = `${IC.compress} Summarise the rest ${cand.length?`<small>${cand.length} msg · ≈${fmt(candTok)} tok</small>`:""}`;
  $("#compactBtn").disabled = busy || !cand.length;
  $("#undoSumBtn").disabled = busy || !S.summary;
  $$("[data-act=keepDown]").forEach(b=>b.disabled=busy||S.keep<=0);
  $$("[data-act=keepUp]").forEach(b=>b.disabled=busy||S.keep>=10);
  $("#compactInfo").innerHTML = S.compacting
    ? `<div class="working"><span class="dotsld"><i></i><i></i><i></i></span>The model is writing the summary…</div>`
    : S.summary ? `<div class="result">Summary covers ${S.summary.ids.length} message${S.summary.ids.length===1?"":"s"}: <b>≈${fmt(S.summary.before)}</b> → <b>≈${fmt(S.summary.after)}</b> tokens</div>` : "";
}
function renderSend(){
  const btn=$("#sendBtn");
  btn.className="send"+(S.running?" stop":"");
  const again = !$("#msg").value.trim() && pendingQuestion() && S.msgs.some(m=>m.role==="error");
  btn.innerHTML = S.running ? `${IC.stop}<span>Stop</span>` : again ? `${IC.send}<span>Retry</span>` : `${IC.send}<span>Send</span>`;
  btn.title = S.running ? "Stop waiting for the reply" : again ? "Send the waiting question again (Enter)" : "Send message (Enter)";
  btn.disabled = S.compacting || (!S.running && !$("#msg").value.trim() && !again);
  $("#provSel").disabled = S.running||S.compacting;
  $("#sys").disabled = S.running||S.compacting;
  btn.setAttribute('aria-label', S.running ? 'Stop' : again ? 'Retry send' : 'Send');
}
function renderAll(scroll){ renderPersona(); renderChat(scroll); renderMeter(); renderManage(); renderSend(); sizeMsg(); syncUndoUi(); }

/* ============ Parameters & full screen ============ */
function fillSettings(){
  $("#temp").value=S.temp; $("#topp").value=S.topp; $("#cap").value=S.cap;
  $("#vTemp").textContent=S.temp.toFixed(2);
  $("#vTopp").textContent=S.topp>=0.999?"off":S.topp.toFixed(2);
  $("#vCap").textContent=S.cap+" tok";
}
function openSettings(){ if(S.running||S.compacting) return; fillSettings(); $("#setModal").classList.add("open"); }
function closeModals(){ $$(".modal").forEach(m=>m.classList.remove("open")); }
function renderFs(){ const on=!!document.fullscreenElement, b=$("#fsBtn"); b.innerHTML=on?IC.fsOff:IC.fsOn; b.title=on?"Exit full screen":"Full screen"; }
function toggleFs(){
  if(document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(()=>toast("Full screen isn't available in this browser"));
}

/* ============ Calling the model ============ */
async function callModel(system: string, turns: { role: string; text: string }[], cap: number, signal?: AbortSignal, onRetry?: (n: number) => void){
  void onRetry;
  const out = await runLimitChat(sessionId, projectId, {
    system,
    turns: turns.map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text })),
    model: S.ver || defaultVersionOf(P()) || S.prov,
    temp: Math.min(S.temp, P().tempMax),
    topp: S.topp,
    cap,
  }, signal);
  return { text: out.text, inTok: out.inTok };
}

/* ============ Sending ============ */
function removeErrors(){ S.msgs=S.msgs.filter(m=>m.role!=="error"); }
function flashOver(){ const b=$("#beaker"); b.classList.remove("over"); void b.offsetWidth; b.classList.add("over"); }
async function ask(){
  /* Everything in the window must fit: persona + summary + kept messages + room for the reply */
  removeErrors();
  const kept=inCtx();
  if(!kept.length || kept[kept.length-1].role!=="user"){
    S.msgs.push({id:UID++, role:"error", text:"Your latest message is not in the window, so there is nothing to answer. Keep it, or send a new one."});
    renderAll(true); return;
  }
  const u=usage(false);
  if(u.total>S.limit){
    S.msgs.push({id:UID++, role:"error", retry:true,
      text:`Prompt is too long: ${fmt(u.total)} tokens > ${fmt(S.limit)} token window (${fmt(u.sent)} to send + ${fmt(u.reply)} kept for the reply). Nothing was sent to the model.`});
    renderAll(true); flashOver(); announce("Over the limit. Nothing was sent.");
    return;
  }
  
  S.running=true; S.pending={t0:performance.now()};
  const ctrl=new AbortController(); S.ctrl=ctrl;
  renderAll(true);
  try{
    const out=await callModel(systemText(), contextMessages(), S.cap, ctrl.signal, n=>{ S.pending.note=`busy, trying again (${n}/3)`; renderChat(false); });
    S.msgs.push({id:UID++, role:"assistant", text:out.text||"(empty reply)", state:"in"});
    S.lastCall = out.inTok ? {est:u.sent, real:out.inTok} : S.lastCall;
  }catch(e){
    S.msgs.push({id:UID++, role:"error", retry:e.message!=="Stopped", text:e.message==="Stopped"?"Stopped before the reply arrived.":e.message});
  }
  S.running=false; S.pending=null; S.ctrl=null;
  renderAll(true);
  announce("Reply received.");
    maybeComplete();
}
async function send(){
  if(S.running){ S.ctrl?.abort(); return; }
  const q=$("#msg").value.trim();
  if(!q){ if(pendingQuestion()) await ask(); else $("#msg").focus(); return; }
  S.msgs.push({id:UID++, role:"user", text:q, state:"in"});
  $("#msg").value="";
  $("#msg").placeholder = MSG_PLACEHOLDER;
  S.personaOpen=false;
  await ask();
  $("#msg").focus();
}
/* Keep the message box a comfortable typing height; grow with content up to a modest max */
const appLayout = () => matchMedia("(min-width:1101px) and (min-height:620px)").matches;
function sizeMsg(){
  const el=$("#msg"), card=$(".convo"), empty=!S.msgs.length && !S.pending;
  card.classList.toggle("is-empty",empty);
  el.style.height="auto";
  const minH = 40;
  const maxH = 88;
  el.style.height = Math.min(Math.max(minH, el.scrollHeight + 2), maxH) + "px";
}
/* ============ Pruning & compacting ============ */
function dropOldest(){
  const kept=inCtx(); if(!kept.length) return;
  pushUndo();
  kept[0].state="dropped";
  if(kept[0].role==="user" && kept[1] && kept[1].role==="assistant") kept[1].state="dropped";
  renderAll(false);
}
function pendingQuestion(){ const k=inCtx(); const last=k[k.length-1]; return last && last.role==="user" ? last : null; }
function compactCandidates(){
  const kept=inCtx(), pq=pendingQuestion();
  const base = pq ? kept.slice(0,-1) : kept;        /* the unanswered question always stays */
  return base.slice(0, Math.max(0, base.length-S.keep));
}
async function compact(){
  const cand=compactCandidates(); if(!cand.length || S.compacting) return;
  pushUndo();
  S.compacting=true; renderAll(false);
  const transcript=(S.summary?`Earlier summary: ${S.summary.text}\n\n`:"") + cand.map(m=>`${m.role==="user"?"User":"Assistant"}: ${m.text}`).join("\n\n");
  const before=cand.reduce((a,m)=>a+msgTok(m),0)+(S.summary?estTok(summaryBlock()):0);
  try{
    const out=await runLimitCompact(sessionId, projectId, {
      transcript,
      model: S.ver || defaultVersionOf(P()) || S.prov,
      temp: Math.min(S.temp, P().tempMax),
      topp: S.topp,
      cap: Math.min(S.cap, 300),
    });
    const text=(out.text||"").trim();
    if(!text) throw new Error("The model returned an empty summary. Try again.");
    const ids=[...(S.summary?.ids||[]), ...cand.map(m=>m.id)];
    cand.forEach(m=>m.state="summed");
    S.summary={text, ids, before, after:estTok("Summary of the earlier conversation:\n"+text)};
    announce("Summary written.");
  }catch(e){ toast(esc(e.message)); }
  S.compacting=false; renderAll(false);
}
function undoSummary(){
  if(!S.summary) return;
  pushUndo();
  S.msgs.forEach(m=>{ if(m.state==="summed") m.state="in"; });
  S.summary=null; S.showSummed=false; renderAll(false);
}

/* ============ Events ============ */
host.addEventListener("input",e=>{
  const t=e.target;
  if(t.id==="msg"){ sizeMsg(); renderMeter(); renderSend(); }
  else if(t.id==="sys"){ renderPersona(); renderMeter(); }
  else if(t.id==="temp"){ const next=parseFloat(t.value); if(next!==S.temp) pushUndo(); S.temp=next; fillSettings(); }
  else if(t.id==="topp"){ const next=parseFloat(t.value); if(next!==S.topp) pushUndo(); S.topp=next; fillSettings(); }
  else if(t.id==="cap"){ const next=parseInt(t.value); if(next!==S.cap) pushUndo(); S.cap=next; fillSettings(); renderMeter(); }
});
host.addEventListener("change",e=>{
  if(e.target.id==="provSel"){
    S.prov=e.target.value;
    syncVer();
    S.temp=Math.min(S.temp,P().tempMax);
    renderAll(false);
  }
});
host.addEventListener("click",e=>{
  if(e.target.classList.contains("modal") || e.target.closest("[data-close]")){ closeModals(); return; }
  const lim=e.target.closest("[data-limit]"); if(lim){ pushUndo(); S.limit=+lim.dataset.limit; renderAll(false); return; }
  const seg=e.target.closest("[data-seg]");
  if(seg){ const el=host.querySelector("#m"+seg.dataset.seg); if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.classList.remove("flash"); void (el as HTMLElement).offsetWidth; el.classList.add("flash"); } return; }
  const act=e.target.closest("[data-act]");
  if(act){ const a=act.dataset.act, m=S.msgs.find(x=>x.id===+act.dataset.m);
    if(a==="togglePersona"){ S.personaOpen=!S.personaOpen; renderPersona(); if(S.personaOpen) $("#sys").focus(); }
    else if(a==="newChat"){ if(confirm("Clear the whole conversation?")){ pushUndo(); S.msgs=[]; S.summary=null; S.lastCall=null; S.showSummed=false; renderAll(false); } }
    else if(a==="dropMsg" && m){ pushUndo(); m.state="dropped"; renderAll(false); }
    else if(a==="keepMsg" && m){ pushUndo(); m.state="in"; renderAll(false); }
    else if(a==="more" && m){ m.open=!m.open; renderChat(false); }
    else if(a==="retry"){ if(!S.running) ask(); }
    else if(a==="dropOldest"){ dropOldest(); }
    else if(a==="restoreDropped"){ pushUndo(); S.msgs.forEach(x=>{ if(x.state==="dropped") x.state="in"; }); renderAll(false); }
    else if(a==="keepDown"){ pushUndo(); S.keep=Math.max(0,S.keep-1); renderManage(); }
    else if(a==="keepUp"){ pushUndo(); S.keep=Math.min(10,S.keep+1); renderManage(); }
    else if(a==="compact"){ compact(); }
    else if(a==="undoSummary"){ undoSummary(); }
    else if(a==="showSummed"){ S.showSummed=!S.showSummed; renderChat(false); }
    else if(a==="resetParams"){ pushUndo(); S.temp=PARAM_DEFAULTS.temp; S.topp=PARAM_DEFAULTS.topp; S.cap=PARAM_DEFAULTS.cap; fillSettings(); renderMeter(); }
    return; }
  const b=e.target.closest("button"); if(!b) return;
  if(b.id==="sendBtn") send();
  else if(b.id==="undoBtn") performUndo();
  else if(b.id==="settingsBtn") openSettings();
  else if(b.id==="fsBtn") toggleFs();
});
host.addEventListener("keydown",e=>{
  if(e.key==="Escape"){ closeModals(); return; }
  if(e.target.id==="msg" && e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); if(!S.compacting) send(); }
});
document.addEventListener('fullscreenchange', renderFs);
const onResize = () => { renderMeter(); sizeMsg(); };
window.addEventListener('resize', onResize);
elapsedTimer = setInterval(() => {
  if (S.pending) {
    const el = $('#elapsed');
    if (el) el.textContent = `${((performance.now() - S.pending.t0) / 1000).toFixed(1)}s`;
  }
}, 100);


  function maybeComplete() {
    if (markedComplete || !onComplete) return;
    if (!S.msgs.some((m) => m.role === 'assistant' && m.state === 'in')) return;
    markedComplete = true;
    onComplete();
  }

  async function boot() {
    try {
      const cat: LimitCatalog = await loadLimitCatalog(sessionId, projectId);
      LIMITS = cat.limits;
      MSG_OVERHEAD = cat.msgOverhead;
      models = Object.fromEntries(cat.models.map((m) => [m.id, m]));
      defaultProv = cat.defaults.prov;
      S.prov = cat.defaults.prov;
      syncVer();
      S.limit = cat.defaults.limit;
      S.keep = cat.defaults.keep;
      S.temp = cat.defaults.temp;
      S.topp = cat.defaults.topp;
      S.cap = cat.defaults.cap;
      if ($('#provSel')) {
        $('#provSel')!.innerHTML = cat.models.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
        ($('#provSel') as HTMLSelectElement).value = S.prov;
      }
      if ($('#msg')) ($('#msg') as HTMLTextAreaElement).placeholder = MSG_PLACEHOLDER;
      const settingsBtn = $('#settingsBtn');
      if (settingsBtn) settingsBtn.innerHTML = IC.gear;
      if (!document.documentElement.requestFullscreen) {
        const fsBtn = $('#fsBtn');
        if (fsBtn) fsBtn.hidden = true;
      }
      renderFs();
      renderAll(false);
      host.classList.remove('is-booting');
      requestAnimationFrame(() => {
        const msg = $('#msg') as HTMLTextAreaElement | null;
        if (msg && !S.msgs.length) msg.focus();
      });
    } catch (e) {
      toast(esc(e instanceof Error ? e.message : 'Could not load lab'));
      host.classList.remove('is-booting');
    }
  }

  void boot();
  return () => {
    aborted = true;
    S.ctrl?.abort();
    if (elapsedTimer) clearInterval(elapsedTimer);
    document.removeEventListener('fullscreenchange', renderFs);
    window.removeEventListener('resize', onResize);
    unbindTheme();
    host.innerHTML = '';
    host.classList.remove('is-booting');
  };
}
