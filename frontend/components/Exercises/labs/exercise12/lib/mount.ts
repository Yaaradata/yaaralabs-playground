/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import {
  loadBuildRagCatalog,
  runBuildRagEmbed,
  runBuildRagRetrieve,
  runBuildRagGenerate,
  runBuildRagEvaluate,
  type BuildRagCatalog,
} from './api';
import { THEME_TOGGLE_HTML, bindExerciseTheme } from '../../../theme';
import { cloneState, createUndoStack, syncUndoButton, UNDO_BUTTON_HTML } from '../../../undoHistory';
import { exerciseBrandHtml } from '../../../exerciseHeaderIcons';
import { bindHostFullscreen } from '../../../fullscreen';
import { labBuddyHtml } from '../../../labBuddy';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

const TEMPLATE = `<header>
  ${exerciseBrandHtml(12, 'Exercise - 12 : Build a RAG, end to end')}
  ${THEME_TOGGLE_HTML}
  ${UNDO_BUTTON_HTML}
  <button class="run" id="runBtn" data-act="runAll"></button>
  <button class="pyt on" id="pyBtn" data-act="togglePy" title="Show or hide the Python" aria-pressed="true">&lt;/&gt; Python</button>
  <label class="msel" title="The model that writes the answer in stage 8">
    <span>Model</span>
    <select id="provSel"></select>
  </label>
  <button class="icon" id="fsBtn" title="Full screen" aria-label="Full screen"></button>
  <button class="icon" id="settingsBtn" title="Model parameters: temperature, top-p, output cap" aria-label="Model parameters"></button>
</header>

<main>
  <!-- 1 The pipeline, as a flow you can click through -->
  <section class="card flow" aria-label="Pipeline">
    <nav class="nodes" id="nodes" aria-label="Pipeline stages"></nav>
  </section>

  <!-- 2 The stage you're working on -->
  <section class="card stage" id="stage" aria-live="off"></section>

  <!-- 3 The same stage in Python -->
  <section class="card py" aria-label="Python">
    <div class="hrow"><span class="n">&lt;/&gt;</span><b>Python</b>
      <div class="seg" role="tablist" aria-label="Code view"><button data-py="stage" class="on">This stage</button><button data-py="all">Whole pipeline</button></div></div>
    <div class="codewrap"><button class="mini" data-act="copyPy" id="copyBtn">Copy</button><pre class="code" id="code"></pre></div>
    <span id="pySub" hidden></span>
    <div class="pynote" id="pyNote"></div>
  </section>
</main>

<!-- Parameters -->
<div class="modal" id="setModal" role="dialog" aria-modal="true" aria-label="Model parameters"><div class="mbox">
  <div class="mtitle"><span>Model parameters</span><button class="x" data-close aria-label="Close">×</button></div>
  <div class="prm"><div class="prh"><span>Temperature</span><b id="vTemp"></b></div>
    <input type="range" id="temp" min="0" max="2" step="0.05"><div class="prd">Low = focused and repeatable. High = varied and creative.</div></div>
  <div class="prm"><div class="prh"><span>Top-p</span><b id="vTopp"></b></div>
    <input type="range" id="topp" min="0.05" max="1" step="0.05"><div class="prd">Keeps only the most likely words until their odds add up to p. 1 = off.</div></div>
  <div class="prm"><div class="prh"><span>Output cap</span><b id="vCap"></b></div>
    <input type="range" id="cap" min="100" max="1500" step="50"><div class="prd">The longest answer allowed, in tokens.</div></div>
  <div class="note">Claude accepts temperatures up to 1, so higher values are capped at 1 for Claude.</div>
  <div style="margin-top:14px"><button class="mini" data-act="resetParams" style="padding:6px 12px">Reset to defaults</button></div>
</div></div>

<input type="file" id="fileIn" accept=".txt,.md,.pdf,text/plain,application/pdf" hidden>
<div class="tip" id="tip" hidden></div>
<div id="toasts"></div>
<div class="sr" aria-live="polite" id="live"></div>`;

export function mountExercise12(host: HTMLElement, opts: MountOptions): () => void {
  const { sessionId, projectId, onComplete } = opts;
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const unbindTheme = bindExerciseTheme(host);

  const $ = (s: string) => host.querySelector(s) as any;
  const $$ = (s: string) => [...host.querySelectorAll(s)] as any[];

  let catalog: BuildRagCatalog | null = null;
  let defaultProv = 'gemini-flash-lite';
  let completed = false;
  let unbindFs: (() => void) | null = null;
  let aborted = false;

  function maybeComplete() {
    if (completed || !onComplete) return;
    completed = true;
    onComplete();
  }


/* Models from catalog */
let PROVIDERS = {};
let DEFAULTS = {temp:0.2, topp:1, cap:400};

/* ============ Example document: as it comes out of a PDF, page headers and all ============ */
let EXAMPLE_DOC = `Campus Building Code - Class Sample - Rev 2
CAMPUS BUILDING CODE (sample written for this class, not an official IS standard)

Part 1. Scope
1.1 This code applies to new teaching blocks, hostels, laboratories and workshops
built on the campus.
1.2 Where this code is silent, the designer shall follow the relevant national standard and
record the reference in the design basis report.

Part 2. Concrete
2.1 The minimum grade of concrete for reinforced concrete work shall be M20. Where members
are exposed to severe conditions, such as coastal air or wet foundations, the minimum grade shall be M25.
2.2 The maximum water-cement ratio shall be 0.50 for moderate exposure and 0.45 for severe exposure.
2.3 Concrete shall be placed within 30 minutes of mixing when mixed on site, and within 90 minutes when supplied as ready-mixed concrete.
2.4 Concrete shall be com-
pacted with needle vibrators. Hand rodding is allowed only for small repairs.

Part 3. Nominal cover to reinforcement
3.1 Slabs: 20 mm.
3.2 Beams: 25 mm for moderate exposure and 30 mm for severe exposure.
3.3 Columns: 40 mm.
3.4 Footings and other members cast against earth: 50 mm.
3.5 Cover blocks shall be of the same strength as the surrounding concrete and shall be tied in place
before concreting.

Page 1 of 3

Campus Building Code - Class Sample - Rev 2
Part 4. Curing
4.1 Exposed concrete surfaces shall be kept continuously moist for at least 7 days when ordinary Portland cement is used.
4.2 When blended cements such as fly-ash or slag cement are used, curing shall continue for at least
10 days.
4.3 In hot weather, above 35 °C, curing shall start as soon as the surface can take it without damage, and wet hessian shall be used on slabs.

Part 5. Removal of formwork
5.1 Vertical faces of beams, columns and walls: 24 hours.
5.2 Soffits of slabs, with props left under: 3 days.
5.3 Props under slabs spanning up to 4.5 m: 7 days.
5.4 Props under beams spanning up to 6 m: 14 days.
5.5 Props under beams spanning over 6 m: 21 days.

Part 6. Staircases
6.1 The riser of a step shall not exceed 175 mm, and the tread shall be at least 250 mm.
6.2 The clear width of a staircase shall be at least 1.0 m in residential blocks and 1.5 m in teaching blocks.
6.3 A flight shall not have more than 12 risers without a landing.
6.4 Handrails shall be provided on both sides of every staircase wider than 1.5 m, at a height of
900 mm above the nosing.

Page 2 of 3

Campus Building Code - Class Sample - Rev 2
Part 7. Fire safety and exits
7.1 Every floor of a teaching block shall have at least two separate exits.
7.2 The travel distance from any point on a floor to the nearest exit shall not exceed 30 m.
7.3 Exit doors shall open outwards, in the direction of escape, and shall be at least 1.0 m wide.
7.4 Fire extinguishers shall be placed so that no point on a floor is more than 15 m from one.

Part 8. Ramps and access
8.1 Ramps for wheelchair users shall have a slope not steeper than 1 in 12.
8.2 A level landing of at least 1.5 m length shall be provided at the top and bottom of every ramp and after every 9 m of ramp length.
8.3 Ramps shall have handrails on both sides at a height of 800 to 900 mm.

Page 3 of 3`;
let EXAMPLE_TESTS = [
  {q:"What is the minimum grade of concrete for severe exposure?", expect:"M25", source:"M25"},
  {q:"How long must concrete be cured when fly-ash cement is used?", expect:"10 days", source:"blended cements"},
  {q:"What nominal cover is needed for footings?", expect:"50 mm", source:"Footings"},
  {q:"When can the props under a 7 m beam be removed?", expect:"21 days", source:"over 6 m"},
  {q:"What is the maximum riser height of a step?", expect:"175 mm", source:"riser"},
  {q:"How far can any point on a floor be from the nearest exit?", expect:"30 m", source:"travel distance"},
  {q:"What slope is allowed for a wheelchair ramp?", expect:"1 in 12", source:"1 in 12"},
  {q:"What fire rating do the exit doors need?", expect:"doesn't say", source:""}
];
let DEFAULT_TEMPLATE = `Answer the question using only the context below.
If the context does not contain the answer, say "The document doesn't say."
Cite the chunks you used, like [1].

Context:
{context}

Question: {question}`;
let QUERY_EXAMPLES = ["e.g. What nominal cover is needed for footings?","e.g. When can the props under a 7 m beam be removed?","e.g. How long must concrete be cured with fly-ash cement?"];

let EMBEDDERS = {
  minilm:{name:"MiniLM", long:"all-MiniLM-L6-v2 (sentence-transformers)", hf:"Xenova/all-MiniLM-L6-v2", about:"A neural embedding model. 384 numbers per chunk, runs in this browser. About 23 MB, downloaded once."},
  tfidf: {name:"TF-IDF", long:"TF-IDF (scikit-learn)", about:"Keyword vectors: one number per word in the document, weighted by how rare the word is. Instant, nothing to download."}
};

let STAGES = [
  {id:"load",    name:"Load",            what:"Bring the document into the pipeline"},
  {id:"clean",   name:"Clean",           what:"Fix what PDF extraction breaks, before anything else sees the text"},
  {id:"chunk",   name:"Chunk",           what:"Cut the text into pieces small enough to search and to send"},
  {id:"embed",   name:"Embed",           what:"Turn every chunk into a vector of numbers"},
  {id:"store",   name:"Store",           what:"Keep the vectors in an index you can search"},
  {id:"retrieve",name:"Retrieve",        what:"Embed the question and find the closest chunks"},
  {id:"prompt",  name:"Build the prompt",what:"Put the retrieved chunks and the question into one prompt"},
  {id:"generate",name:"Generate",        what:"Send the prompt to the model and get a grounded answer"},
  {id:"evaluate",name:"Evaluate",        what:"Test the whole pipeline on questions with known answers"}
];

/* ============ State ============ */
let UID=1;
const S = {
  stage:0, prov:"gemini-flash-lite", temp:DEFAULTS.temp, topp:DEFAULTS.topp, cap:DEFAULTS.cap, py:"stage",
  src:null, parsing:false,
  clean:{headers:true, hyphen:true, wraps:true, spaces:true},
  mode:"sentences", size:60, overlap:10, openTile:null,
  model:"minilm", emb:null, embBusy:false, embMsg:"",
  store:"numpy",
  query:"", k:3, minScore:0, ret:null, retBusy:false,
  template:DEFAULT_TEMPLATE, numbered:true,
  compare:false, gen:null, genBusy:false, ctrl:null,
  tests:[{q:"",expect:"",source:""}], evalGen:true, evalRes:null, evalBusy:false, evalCtrl:null
};
const esc = s => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt = n => Math.round(n).toLocaleString("en-IN");
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const P = () => PROVIDERS[S.prov] || PROVIDERS[defaultProv] || Object.values(PROVIDERS)[0] || {name:'Model',tempMax:2};
const connected = () => true;
const wc = s => (s.match(/\S+/g)||[]).length;
const tokEst = s => Math.ceil(String(s).length/4);
function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return h; }
function toast(msg){ const t=document.createElement("div"); t.className="toast"; t.innerHTML=msg; $("#toasts").appendChild(t); setTimeout(()=>t.remove(),3800); }
function announce(m){ $("#live").textContent=m; }
function md(s){ return esc(s).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/^#{1,4}\s+(.+)$/gm,"<b>$1</b>").replace(/^(\s*)[-*•]\s+/gm,"$1• "); }

/* ============ 1 Load ============ */
const docRaw = () => ($("#doc")?.value ?? S.raw ?? "");
S.raw="";
let pdfjsReady=null;
function loadPdfjs(){
  if(pdfjsReady) return pdfjsReady;
  pdfjsReady=new Promise((res,rej)=>{
    const s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload=()=>{ window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(window.pdfjsLib); };
    s.onerror=()=>{ pdfjsReady=null; rej(new Error("Couldn't load the PDF reader. Check the connection, or paste the text instead.")); };
    document.head.appendChild(s);
  });
  return pdfjsReady;
}
async function loadFile(file){
  if(!file) return;
  if(S.raw.trim() && !confirm(`Replace the current document with "${file.name}"?`)) return;
  try{
    let text;
    if(/\.pdf$/i.test(file.name) || file.type==="application/pdf"){
      S.parsing=`Reading ${file.name}…`; renderStage();
      const lib=await loadPdfjs(), pdf=await lib.getDocument({data:await file.arrayBuffer()}).promise, pages=[];
      for(let p=1;p<=pdf.numPages;p++){
        S.parsing=`Reading page ${p} of ${pdf.numPages}…`; const bl=$("#busy"); if(bl) bl.textContent=S.parsing;
        const tc=await (await pdf.getPage(p)).getTextContent();
        pages.push(tc.items.map(it=>it.str+(it.hasEOL?"\n":" ")).join("").replace(/[ \t]+/g," ").trim()+`\n\nPage ${p} of ${pdf.numPages}`);
      }
      text=pages.join("\n\n"); S.src={name:file.name, pages:pdf.numPages};
      if(!text.replace(/Page \d+ of \d+/g,"").trim()) throw new Error("No text found in this PDF. It may be a scanned image; paste the text instead.");
    } else { text=await file.text(); S.src={name:file.name}; }
    S.raw=text; S.pin=null;
  }catch(e){ toast(esc(e.message||"Couldn't read that file.")); }
  S.parsing=false; changed(); renderStage();
}

/* ============ 2 Clean (the same rules as the Python on the right) ============ */
const PAGE_RE=/^\s*(page\s*\d+(\s*(of|\/)\s*\d+)?|\d+)\s*$/i;
let CLEAN=null;
function cleaned(){
  const raw=S.raw, o=S.clean, sig=hash(raw)+"|"+JSON.stringify(o);
  if(CLEAN&&CLEAN.sig===sig) return CLEAN;
  let text=raw; const removed=[], n={headers:0,hyphen:0,wraps:0,spaces:0};
  if(o.headers){
    const lines=text.split("\n"), counts={};
    lines.forEach(l=>{ const t=l.trim(); if(t) counts[t]=(counts[t]||0)+1; });
    const keep=[];
    lines.forEach(l=>{ const t=l.trim();
      if(t && (PAGE_RE.test(l) || (counts[t]>=3 && t.length<=80))){ removed.push(t); n.headers++; } else keep.push(l); });
    text=keep.join("\n");
  }
  if(o.hyphen) text=text.replace(/(\w)-\n(\w)/g,(m,a,b)=>{ n.hyphen++; return a+b; });
  if(o.wraps) text=text.replace(/(?<![.:;])\n(?=[a-z])/g,()=>{ n.wraps++; return " "; });
  if(o.spaces){
    const before=text;
    text=text.replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
    n.spaces=before.length-text.length;
  }
  CLEAN={sig,text,removed,n}; return CLEAN;
}

/* ============ 3 Chunk ============ */
function sentencesOf(text){
  const out=[];
  text.split(/\n+/).forEach(line=>{ line=line.trim(); if(!line) return;
    (line.match(/.+?(?:[.!?](?=\s|$)|$)/g)||[line]).forEach(s=>{ s=s.trim(); if(s) out.push(s); }); });
  return out;
}
function pack(units,size,overlap,sep){
  const out=[]; let cur=[], n=0;
  units.forEach(u=>{
    const w=wc(u);
    if(n+w>size && cur.length){
      out.push(cur.join(sep));
      const carry=[]; let cw=0;
      for(let i=cur.length-1;i>=0;i--){ const x=wc(cur[i]); if(cw+x>overlap) break; carry.unshift(cur[i]); cw+=x; }
      cur=carry; n=cw;
    }
    cur.push(u); n+=w;
  });
  if(cur.length) out.push(cur.join(sep));
  return out;
}
function byWords(text,size,overlap){
  const words=text.match(/\S+/g)||[]; if(!words.length) return [];
  const step=Math.max(1,size-overlap), out=[];
  for(let i=0;i<words.length;i+=step){ out.push(words.slice(i,i+size).join(" ")); if(i+size>=words.length) break; }
  return out;
}
let CHUNKS=null;
function chunks(){
  const c=cleaned(), sig=c.sig+"|"+S.mode+"|"+S.size+"|"+S.overlap;
  if(CHUNKS&&CHUNKS.sig===sig) return CHUNKS;
  const t=c.text;
  const list = S.mode==="sentences" ? pack(sentencesOf(t),S.size,S.overlap," ")
             : S.mode==="sections" ? pack(t.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean),S.size,0,"\n\n")
             : byWords(t,S.size,S.overlap);
  CHUNKS={sig,list}; return CHUNKS;
}

/* ============ 4 Embed ============ */
function wordsOf(s){ return (s.toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[]).filter(w=>[...w].length>=2); }   /* scikit-learn's default tokens */
function tfidfFit(docs){
  const toks=docs.map(wordsOf), vocab=[...new Set(toks.flat())].sort(), idx=new Map(vocab.map((w,i)=>[w,i])), n=docs.length;
  const df=new Array(vocab.length).fill(0); toks.forEach(t=>new Set(t).forEach(w=>df[idx.get(w)]++));
  const idf=df.map(d=>Math.log((1+n)/(1+d))+1);
  const vec=t=>{ const v=new Array(vocab.length).fill(0); t.forEach(w=>{ const k=idx.get(w); if(k!=null) v[k]++; }); for(let k=0;k<v.length;k++) v[k]*=idf[k]; const L=Math.sqrt(v.reduce((a,x)=>a+x*x,0)); return L?v.map(x=>x/L):v; };
  return {vocab, idf, vecs:toks.map(vec), embedQuery:q=>vec(wordsOf(q))};
}
const embSig = () => chunks().sig+"|"+S.model;
function embState(){ if(!S.emb) return "wait"; return S.emb.sig===embSig() ? "done" : "stale"; }
async function embed(){
  if(S.embBusy) return;
  const list=chunks().list; if(!list.length){ toast("There are no chunks yet. Load a document first."); return false; }
  S.embBusy=true; S.embMsg=""; setBusy("Embedding…"); renderNav();
  const t0=performance.now(), sig=embSig();
  try{
    const out=await runBuildRagEmbed(sessionId, projectId, {chunks:list, model:S.model});
    const e={kind:out.kind, vecs:out.vecs, dims:out.dims, map:out.map||null, sig, ms:out.ms??(performance.now()-t0), fresh:true};
    S.emb=e; S.ret=null;
    announce(`Embedded ${list.length} chunks.`);
  }catch(err){ S.embMsg=err.message||String(err); S.embBusy=false; setBusy(""); renderAll(); return false; }
  S.embBusy=false; setBusy(""); renderAll(); return true;
}
async function ensureEmbedded(){ if(embState()==="done") return true; return await embed(); }

/* Flatten the vectors to 2D (principal component analysis) so the chunks can be drawn as a map */
function pca2(vecs){
  const n=vecs.length, d=vecs[0]?.length||0;
  if(n<2||!d) return null;
  const mean=new Array(d).fill(0); vecs.forEach(v=>v.forEach((x,k)=>mean[k]+=x/n));
  const X=vecs.map(v=>v.map((x,k)=>x-mean[k]));
  const G=X.map(a=>X.map(b=>{ let s=0; for(let k=0;k<d;k++) s+=a[k]*b[k]; return s; }));
  const comps=[];
  for(let c=0;c<2;c++){
    let u=Array.from({length:n},(_, i)=>Math.sin(i*1.7+c*2.1)+1.1);
    for(let it=0;it<80;it++){
      let w=G.map(row=>row.reduce((a,x,j)=>a+x*u[j],0));
      comps.forEach(pc=>{ const dot=w.reduce((a,x,j)=>a+x*pc.u[j],0); w=w.map((x,j)=>x-dot*pc.u[j]); });
      const L=Math.sqrt(w.reduce((a,x)=>a+x*x,0))||1; u=w.map(x=>x/L);
    }
    const dir=new Array(d).fill(0); X.forEach((row,i)=>row.forEach((x,k)=>dir[k]+=x*u[i]));
    const L=Math.sqrt(dir.reduce((a,x)=>a+x*x,0))||1;
    comps.push({u, dir:dir.map(x=>x/L)});
  }
  const proj=v=>comps.map(pc=>v.reduce((a,x,k)=>a+(x-mean[k])*pc.dir[k],0));
  return {proj, pts:vecs.map(proj)};
}

/* ============ 6 Retrieve ============ */
const dot=(a,b)=>{ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; };
function topOf(r){ return r.ranked.filter(x=>x.s>=S.minScore).slice(0,S.k).map(x=>x.i); }
function retState(){ if(!S.ret) return "wait"; return S.ret.embSig===embSig() && S.ret.q===S.query.trim() ? "done" : "stale"; }
async function retrieve(q){
  q=(q??S.query).trim(); if(!q) return null;
  if(!(await ensureEmbedded())) return null;
  const list=chunks().list;
  const out=await runBuildRagRetrieve(sessionId, projectId, {
    chunks:list, query:q, model:S.model||S.emb.kind||"minilm", k:S.k, minScore:S.minScore, vecs:S.emb.vecs
  });
  return {q, ranked:out.ranked||[], embSig:S.emb.sig, qpt:out.qpt||null};
}
/* ============ 7 Build the prompt ============ */
function contextOf(ids){ const L=chunks().list; return ids.map((i,n)=> S.numbered ? `[${n+1}] ${L[i]}` : L[i]).join("\n\n"); }
function buildPrompt(q,ids){ return S.template.split("{context}").join(contextOf(ids)).split("{question}").join(q); }

/* ============ 8 Generate ============ */
function genState(){ if(!S.gen) return "wait"; return S.gen.embSig===embSig() && S.gen.q===S.query.trim() && S.gen.tmpl===S.template && S.gen.k===S.k && S.gen.min===S.minScore && S.gen.numbered===S.numbered && S.gen.prov===S.prov ? "done" : "stale"; }
/* Runs the whole pipeline for one question: embed (if needed) → retrieve → build the prompt → generate */
async function ask(){
  if(S.genBusy){ S.ctrl?.abort(); return; }
  const q=S.query.trim(); if(!q){ $("#query")?.focus(); return; }
  if(!chunks().list.length){ toast("Load a document first (stage 1)."); return; }
  S.genBusy=true; S.ctrl=new AbortController(); const signal=S.ctrl.signal; renderStage(); renderNav();
  const g={q, prov:S.prov, tmpl:S.template, k:S.k, min:S.minScore, numbered:S.numbered, compare:S.compare};
  try{
    setBusy(`Asking ${P().name}…`);
    const list=chunks().list;
    const out=await runBuildRagGenerate(sessionId, projectId, {
      question:q, chunks:list, headers:S.clean.headers, hyphen:S.clean.hyphen, wraps:S.clean.wraps, spaces:S.clean.spaces,
      mode:S.mode, size:S.size, overlap:S.overlap, embedModel:S.model, model:S.prov, k:S.k, minScore:S.minScore,
      template:S.template, numbered:S.numbered, compare:S.compare, temp:Math.min(S.temp,P().tempMax), topp:S.topp, cap:S.cap
    }, signal);
    g.embSig=embSig();
    g.ids=out.ids||out.kept||[];
    g.prompt=out.prompt||buildPrompt(q,g.ids);
    const tok=out.tok!=null?out.tok:((out.inTok||0)+(out.outTok||0));
    g.answer={text:out.text||out.answer||"", ms:out.ms||0, tok};
    if(out.bare){
      const bt=out.bare.tok!=null?out.bare.tok:((out.bare.inTok||0)+(out.bare.outTok||0));
      g.bare={text:out.bare.text||"", ms:out.bare.ms||0, tok:bt};
    } else g.bare=null;
    if(out.ranked){ S.ret={q, ranked:out.ranked, embSig:g.embSig, qpt:null}; }
    maybeComplete();
  }catch(e){ g.error=e.name==="AbortError"?"Stopped.":(e.message||String(e)); }
  g.fresh=true; S.gen=g; S.genBusy=false; S.ctrl=null; setBusy(""); renderAll();
  $("#genOut")?.scrollIntoView({block:"nearest",behavior:"smooth"});
  announce(g.error?"The answer failed.":"The answer is ready.");
}

/* ============ 9 Evaluate ============ */
const norm = s => String(s).toLowerCase().replace(/[’']/g,"'").replace(/\s+/g," ").trim();
function evalState(){ if(!S.evalRes) return "wait"; return S.evalRes.sig===evalSig() ? "done" : "stale"; }
const evalSig = () => [embSig(),S.template,S.k,S.minScore,S.numbered,S.prov,S.evalGen,JSON.stringify(S.tests)].join("|");
async function runEval(){
  if(S.evalBusy){ S.evalCtrl?.abort(); return; }
  const tests=S.tests.filter(t=>t.q.trim());
  if(!tests.length){ toast("Add at least one test question, or click <b>Example</b>."); return; }
  if(!chunks().list.length){ toast("Load a document first (stage 1)."); return; }
  S.evalBusy=true; S.evalCtrl=new AbortController(); const signal=S.evalCtrl.signal;
  const res={sig:evalSig(), rows:[], gen:S.evalGen};
  S.evalRes=res; renderStage(); renderNav();
  try{
    setBusy(S.evalGen?"Running tests (retrieve + generate)…":"Running retrieval tests…");
    const list=chunks().list;
    const out=await runBuildRagEvaluate(sessionId, projectId, {
      chunks:list, headers:S.clean.headers, hyphen:S.clean.hyphen, wraps:S.clean.wraps, spaces:S.clean.spaces,
      mode:S.mode, size:S.size, overlap:S.overlap, embedModel:S.model, model:S.prov, k:S.k, minScore:S.minScore,
      template:S.template, numbered:S.numbered, tests, evalGen:S.evalGen,
      temp:Math.min(S.temp,P().tempMax), topp:S.topp, cap:S.cap
    }, signal);
    res.rows=(out.rows||[]).map(r=>({...r, fresh:true}));
    res.gen=out.gen!=null?out.gen:S.evalGen;
    res.fresh=true;
    maybeComplete();
  }catch(e){
    if(e.name!=="AbortError") toast(esc(e.message||String(e)));
    else announce("Stopped.");
  }
  S.evalBusy=false; S.evalCtrl=null; setBusy(""); renderAll();
  $("#evalOut")?.scrollIntoView({block:"start",behavior:"smooth"});
  announce("The tests finished.");
}

/* ============ Python for every stage (it follows your settings) ============ */
const pyStr = s => JSON.stringify(String(s));
function pyFor(id){
  const L=chunks().list, dims=S.emb?S.emb.dims:(S.model==="minilm"?384:"n_words"), fname=S.src?.name||"campus_code.txt";
  const isPdf=/\.pdf$/i.test(fname);
  const q=S.query.trim()||"What nominal cover is needed for footings?";
  switch(id){
  case "load": return String.raw`# 1 · Load the document
from pathlib import Path
`+(isPdf?String.raw`from pypdf import PdfReader          # pip install pypdf

pages = PdfReader(${pyStr(fname)}).pages
text = "\n\n".join(p.extract_text() for p in pages)
`:String.raw`
text = Path(${pyStr(fname)}).read_text(encoding="utf-8")

# A PDF instead?   pip install pypdf
# from pypdf import PdfReader
# text = "\n\n".join(p.extract_text() for p in PdfReader("campus_code.pdf").pages)
`)+String.raw`
print(len(text), "characters,", len(text.split()), "words")`;
  case "clean": {
    const o=S.clean, parts=[String.raw`# 2 · Clean the text
import re
from collections import Counter
`];
    if(o.headers) parts.push(String.raw`
# page numbers, and header/footer lines that repeat on every page
lines = text.splitlines()
counts = Counter(l.strip() for l in lines if l.strip())
page_no = re.compile(r"\s*(page\s*\d+(\s*(of|/)\s*\d+)?|\d+)\s*", re.I)
lines = [l for l in lines
         if not (l.strip() and (page_no.fullmatch(l) or (counts[l.strip()] >= 3 and len(l.strip()) <= 80)))]
text = "\n".join(lines)
`);
    if(o.hyphen) parts.push(String.raw`
# words split with a hyphen at the end of a line: "com-\npacted" -> "compacted"
text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
`);
    if(o.wraps) parts.push(String.raw`
# sentences broken across lines: join when the next line starts in lower case
text = re.sub(r"(?<![.:;])\n(?=[a-z])", " ", text)
`);
    if(o.spaces) parts.push(String.raw`
# extra spaces and blank lines
text = re.sub(r"[ \t]+", " ", text)
text = re.sub(r"\n{3,}", "\n\n", text).strip()
`);
    if(!Object.values(o).some(Boolean)) parts.push("\n# (no cleaning rules are switched on)\n");
    return parts.join("");
  }
  case "chunk":
    if(S.mode==="words") return String.raw`# 3 · Chunk: windows of ${S.size} words; each starts ${Math.max(1,S.size-S.overlap)} words after the last (${S.overlap} overlap)
words = text.split()
size, overlap = ${S.size}, ${S.overlap}
chunks = []
for i in range(0, len(words), max(1, size - overlap)):
    chunks.append(" ".join(words[i:i + size]))
    if i + size >= len(words):
        break

print(len(chunks), "chunks")    # ${L.length}`;
    return String.raw`# 3 · Chunk: pack whole ${S.mode==="sections"?"sections":"sentences"} into chunks of about ${S.size} words${S.mode==="sections"?"":` (${S.overlap} words overlap)`}
import re

def pack(units, size, overlap, sep=" "):
    chunks, cur, n = [], [], 0
    for u in units:
        w = len(u.split())
        if n + w > size and cur:
            chunks.append(sep.join(cur))
            carry, cw = [], 0                     # carry the last few units forward
            for x in reversed(cur):
                if cw + len(x.split()) > overlap:
                    break
                carry.insert(0, x)
                cw += len(x.split())
            cur, n = carry, cw
        cur.append(u)
        n += w
    if cur:
        chunks.append(sep.join(cur))
    return chunks
`+(S.mode==="sections"?String.raw`
sections = [s.strip() for s in re.split(r"\n\s*\n", text) if s.strip()]
chunks = pack(sections, size=${S.size}, overlap=0, sep="\n\n")
`:String.raw`
sentences = [s.strip()
             for line in text.splitlines() if line.strip()
             for s in re.findall(r".+?(?:[.!?](?=\s|$)|$)", line.strip()) if s.strip()]
chunks = pack(sentences, size=${S.size}, overlap=${S.overlap})
`)+`
print(len(chunks), "chunks")    # ${L.length}`;
  case "embed":
    return S.model==="minilm" ? String.raw`# 4 · Embed every chunk          pip install sentence-transformers
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")
vectors = model.encode(chunks, normalize_embeddings=True)

print(vectors.shape)    # (${L.length}, 384): one row of 384 numbers per chunk`
    : String.raw`# 4 · Embed every chunk with TF-IDF          pip install scikit-learn
from sklearn.feature_extraction.text import TfidfVectorizer

vectorizer = TfidfVectorizer()          # lower-case words of 2+ letters, l2-normalised rows
vectors = vectorizer.fit_transform(chunks).toarray()

print(vectors.shape)    # (${L.length}, ${S.emb&&S.emb.kind==="tfidf"?S.emb.dims:"one column per word"})`;
  case "store": {
    const kb=S.emb?((L.length*S.emb.dims*4)/1024).toFixed(1):"?";
    if(S.store==="faiss") return String.raw`# 5 · Store: a FAISS index          pip install faiss-cpu
import faiss
import numpy as np

vectors = np.asarray(vectors, dtype="float32")
index = faiss.IndexFlatIP(vectors.shape[1])   # exact search by inner product (= cosine for normalised vectors)
index.add(vectors)
print(index.ntotal, "vectors")    # ${L.length}`;
    if(S.store==="chroma") return String.raw`# 5 · Store: a Chroma collection          pip install chromadb
import chromadb

db = chromadb.Client()                         # chromadb.PersistentClient("db/") keeps it on disk
col = db.create_collection("campus_code", metadata={"hnsw:space": "cosine"})
col.add(ids=[str(i) for i in range(len(chunks))],
        documents=chunks,
        embeddings=[list(map(float, v)) for v in vectors])`;
    if(S.store==="pgvector") return String.raw`# 5 · Store: Postgres with pgvector          pip install "psycopg[binary]"
# Once, in SQL:
#   CREATE EXTENSION IF NOT EXISTS vector;
#   CREATE TABLE chunks (id int PRIMARY KEY, text text, embedding vector(${dims}));
import psycopg

with psycopg.connect(DB_URL) as conn:
    for i, (c, v) in enumerate(zip(chunks, vectors)):
        conn.execute("INSERT INTO chunks VALUES (%s, %s, %s)",
                     (i, c, "[" + ",".join(map(str, v)) + "]"))`;
    return String.raw`# 5 · Store: a NumPy matrix is already an index (exact, "flat" search)
import numpy as np

index = np.asarray(vectors, dtype="float32")
print(index.shape, index.nbytes // 1024, "KB")    # (${L.length}, ${dims}), about ${kb} KB`;
  }
  case "retrieve": {
    const qe = S.model==="minilm" ? `q = model.encode([question], normalize_embeddings=True)[0]` : `q = vectorizer.transform([question]).toarray()[0]`;
    const head=String.raw`# 6 · Retrieve: embed the question, then find the closest chunks
question = ${pyStr(q)}
${qe}
k, min_score = ${S.k}, ${S.minScore}
`;
    if(S.store==="faiss") return head+String.raw`
scores, ids = index.search(np.asarray([q], dtype="float32"), k)
top = [int(i) for i, s in zip(ids[0], scores[0]) if s >= min_score]`;
    if(S.store==="chroma") return head+String.raw`
res = col.query(query_embeddings=[list(map(float, q))], n_results=k)
top = [int(i) for i, d in zip(res["ids"][0], res["distances"][0]) if 1 - d >= min_score]`;
    if(S.store==="pgvector") return head+String.raw`
rows = conn.execute("""SELECT id, 1 - (embedding <=> %s) AS score
                       FROM chunks ORDER BY embedding <=> %s LIMIT %s""",
                    (str(list(q)), str(list(q)), k)).fetchall()
top = [i for i, score in rows if score >= min_score]`;
    return head+String.raw`
scores = index @ q                        # cosine similarity with every chunk
order = scores.argsort()[::-1]            # best first
top = [int(i) for i in order if scores[i] >= min_score][:k]
for i in top:
    print(f"chunk {i + 1}  {scores[i]:.3f}  {chunks[i][:60]}")`;
  }
  case "prompt": return `# 7 · Build the prompt
template = """${S.template.replace(/\\/g,"\\\\").replace(/"""/g,'\\"\\"\\"')}"""

context = "\\n\\n".join(${S.numbered?`f"[{n}] {chunks[i]}" for n, i in enumerate(top, 1)`:`chunks[i] for i in top`})
prompt = template.replace("{context}", context).replace("{question}", question)
print(prompt)`;
  case "generate": {
    const p=P();
    if(p.style==="anthropic") return String.raw`# 8 · Generate          pip install anthropic
import anthropic

client = anthropic.Anthropic()          # reads ANTHROPIC_API_KEY
reply = client.messages.create(
    model=${pyStr(p.model)},
    max_tokens=${S.cap},
    temperature=${Math.min(S.temp,p.tempMax)},
    messages=[{"role": "user", "content": prompt}],
)
print(reply.content[0].text)`;
    if(p.style==="gemini") return String.raw`# 8 · Generate          pip install google-genai
from google import genai

client = genai.Client()                 # reads GEMINI_API_KEY
reply = client.models.generate_content(model=${pyStr(p.model)}, contents=prompt)
print(reply.text)`;
    return String.raw`# 8 · Generate          pip install openai
from openai import OpenAI

client = OpenAI(${p.base?`base_url=${pyStr(p.base)}`:""})${p.base?"      # the same client works for this provider":"          # reads OPENAI_API_KEY"}
reply = client.chat.completions.create(
    model=${pyStr(p.model)},
    max_tokens=${S.cap},
    temperature=${Math.min(S.temp,p.tempMax)},
    messages=[{"role": "user", "content": prompt}],
)
print(reply.choices[0].message.content)`;
  }
  case "evaluate": {
    const tests=S.tests.filter(t=>t.q.trim());
    const list=(tests.length?tests:EXAMPLE_TESTS.slice(0,2)).map(t=>`    {"q": ${pyStr(t.q)},\n     "expect": ${pyStr(t.expect)}, "source": ${pyStr(t.source)}},`).join("\n");
    return String.raw`# 9 · Evaluate the whole pipeline on questions with known answers
tests = [
${list}
]

hits = found = right = answered = 0
for t in tests:
    top = retrieve(t["q"], k=${S.k})                                  # stage 6
    if t["source"]:
        found += 1
        hits += any(t["source"].lower() in chunks[i].lower() for i in top)
`+(S.evalGen?String.raw`    answer = generate(build_prompt(t["q"], top))                    # stages 7 and 8
    if t["expect"]:
        answered += 1
        right += t["expect"].lower() in answer.lower()
`:"")+String.raw`
print(f"Retrieval found the right chunk: {hits}/{found}")`+(S.evalGen?String.raw`
print(f"Answers contained the expected text: {right}/{answered}")`:"");
  }
  }
  return "";
}
/* The whole pipeline as one script, with retrieve / build_prompt / generate as functions */
function pyAll(){
  const strip = s => s.replace(/^# \d · .*\n/,"");
  const sec = (n,title,body) => `# ${"=".repeat(64)}\n# ${n?n+" · ":""}${title}\n# ${"=".repeat(64)}\n${body.trim()}\n`;
  const store=S.store; S.store="numpy";
  const q=S.query.trim()||"What nominal cover is needed for footings?";
  const qe = S.model==="minilm" ? `model.encode([question], normalize_embeddings=True)[0]` : `vectorizer.transform([question]).toarray()[0]`;
  const gen = strip(pyFor("generate")).replace(/reply = /,"    reply = ").split("\n");
  const imports = gen.filter(l=>/^(import|from) /.test(l)), client = gen.filter(l=>/^client = /.test(l));
  const call = gen.filter(l=>!/^(import|from) |^client = |^print\(/.test(l) && l.trim()).map(l=>l.startsWith("    reply")?l:"    "+l).join("\n");
  const out=[
    `"""A complete RAG pipeline, as built in Exercise 12.\nRun it top to bottom (for example in Colab)."""\n`,
    sec(1,"Load",strip(pyFor("load"))),
    sec(2,"Clean",strip(pyFor("clean"))),
    sec(3,"Chunk",strip(pyFor("chunk"))),
    sec(4,"Embed",strip(pyFor("embed"))),
    sec(5,"Store",strip(pyFor("store"))),
    sec(6,"Retrieve",String.raw`def retrieve(question, k=${S.k}, min_score=${S.minScore}):
    q = ${qe}
    scores = index @ q
    order = scores.argsort()[::-1]
    return [int(i) for i in order if scores[i] >= min_score][:k]`),
    sec(7,"Build the prompt",`template = """${S.template.replace(/\\/g,"\\\\").replace(/"""/g,'\\"\\"\\"')}"""

def build_prompt(question, top):
    context = "\\n\\n".join(${S.numbered?`f"[{n}] {chunks[i]}" for n, i in enumerate(top, 1)`:`chunks[i] for i in top`})
    return template.replace("{context}", context).replace("{question}", question)`),
    sec(8,"Generate",`${imports.join("\n")}\n\n${client.join("\n")}\n\ndef generate(prompt):\n${call}\n    return ${P().style==="anthropic"?"reply.content[0].text":P().style==="gemini"?"reply.text":"reply.choices[0].message.content"}`),
    sec("","Try it: ask one question",String.raw`question = ${pyStr(q)}
top = retrieve(question)
print(generate(build_prompt(question, top)))`),
    sec(9,"Evaluate",strip(pyFor("evaluate")))
  ];
  S.store=store;
  return out.join("\n");
}

/* ---- syntax colours ---- */
const PY_KW=new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const PY_BI=new Set("print len range int float str list dict set tuple bool open abs min max sum round sorted enumerate zip map filter isinstance any all".split(" "));
const TOK=/(#[^\n]*)|([rbfuRBFU]{0,2}(?:"""[\s\S]*?(?:"""|$(?![\s\S]))|'''[\s\S]*?(?:'''|$(?![\s\S]))|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?\b)|(@[A-Za-z_][\w.]*)|([A-Za-z_]\w*)/g;
function hlPython(src){
  let out="", last=0, prev="";
  src.replace(TOK,(m,com,str,num,dec,id,i)=>{
    out+=esc(src.slice(last,i)); last=i+m.length;
    const cls=com?"k-com":str?"k-str":num?"k-num":dec?"k-dec":PY_KW.has(id)?"k-kw":(prev==="def"||prev==="class")?"k-fn":PY_BI.has(id)&&src[i+m.length]==="("?"k-bi":"";
    out+=cls?`<span class="${cls}">${esc(m)}</span>`:esc(m); prev=id||""; return m;
  });
  return out+esc(src.slice(last));
}


/* ============ Icons ============ */
const SV = (d,w=20) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  load:SV('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 18v-6M9 15l3-3 3 3"/>'),
  clean:SV('<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
  chunk:SV('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>'),
  embed:SV('<circle cx="5" cy="17" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="14" r="2"/><path d="M6.3 15.2l4.5-7.4M13.6 7.4l4 5"/>'),
  store:SV('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
  retrieve:SV('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  prompt:SV('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6M7 17h8"/>'),
  generate:SV('<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M12 11h.01M15 11h.01" stroke-width="2.6"/>'),
  evaluate:SV('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>')
};
const ARROW_L = SV('<path d="M15 18l-6-6 6-6"/>',17), ARROW_R = SV('<path d="M9 18l6-6-6-6"/>',17);
const SHORT = ["Load","Clean","Chunk","Embed","Store","Retrieve","Prompt","Generate","Evaluate"];
Object.assign(S,{cleanView:"changes", chunkView:"text", pin:null, flowBusy:false, flowStop:false});

/* ============ Render: the flow bar ============ */
function stageStatus(id){
  const hasDoc=!!S.raw.trim(), hasChunks=hasDoc&&chunks().list.length>0;
  switch(id){
    case "load": return hasDoc?"done":"wait";
    case "clean": case "chunk": return hasChunks?"done":"wait";
    case "embed": case "store": return S.embBusy?"busy":hasChunks?embState():"wait";
    case "retrieve": return S.retBusy?"busy":retState();
    case "prompt": return S.ret?retState():"wait";
    case "generate": return S.genBusy?"busy":genState();
    case "evaluate": return S.evalBusy?"busy":evalState();
  }
}
function stageSummary(id){
  const c=S.raw.trim()?cleaned():null, L=c?chunks().list:[];
  switch(id){
    case "load": return c?`${fmt(wc(S.raw))} words${S.src?.pages?` · ${S.src.pages} pages`:""}`:"No document yet";
    case "clean": { if(!c) return "Waiting for a document"; const f=Object.entries(c.n).filter(([k,v])=>S.clean[k]&&v>0).length; return `${f} kind${f===1?"":"s"} of fix · ${fmt(wc(c.text))} words`; }
    case "chunk": return c?`${L.length} chunks · ~${L.length?Math.round(L.reduce((a,x)=>a+wc(x),0)/L.length):0} words each`:"Waiting for a document";
    case "embed": return !S.emb?(S.embBusy?"Embedding…":"Not embedded yet"):embState()==="stale"?"Out of date: embed again":`${(EMBEDDERS[S.emb.kind]||{name:S.emb.kind}).name} · ${S.emb.vecs.length} × ${fmt(S.emb.dims)}`;
    case "store": return S.emb&&embState()==="done"?`${S.emb.vecs.length} vectors · ${((S.emb.vecs.length*S.emb.dims*4)/1024).toFixed(1)} KB`:"Needs the vectors";
    case "retrieve": return S.ret?`top ${topOf(S.ret).length} · best ${S.ret.ranked[0].s.toFixed(2)}`:"No search yet";
    case "prompt": return S.ret?`≈ ${fmt(tokEst(buildPrompt(S.ret.q,topOf(S.ret))))} tokens`:"Needs a search";
    case "generate": return S.genBusy?"Answering…":S.gen?(S.gen.error?"Failed":`Answered in ${(S.gen.answer.ms/1000).toFixed(1)} s`):"No answer yet";
    case "evaluate": { const r=S.evalRes; if(!r) return "No tests run"; const h=r.rows.filter(x=>x.hit!=null), a=r.rows.filter(x=>x.ok!=null);
      return `Found ${h.filter(x=>x.hit).length}/${h.length}`+(r.gen?` · right ${a.filter(x=>x.ok).length}/${a.length}`:""); }
  }
}
function stageStat(id){   /* the few words under each node */
  const c=S.raw.trim()?cleaned():null, L=c?chunks().list:[];
  switch(id){
    case "load": return c?`${fmt(wc(S.raw))} words`:"no document";
    case "clean": { if(!c) return "–"; const f=Object.entries(c.n).filter(([k,v])=>S.clean[k]&&v>0).reduce((a,[k,v])=>a+(k==="spaces"?0:v),0); return `${fmt(f)} fixes`; }
    case "chunk": return c?`${L.length} chunks`:"–";
    case "embed": return S.embBusy?"working…":S.emb?`${S.emb.vecs.length} × ${fmt(S.emb.dims)}`:"not yet";
    case "store": return S.emb&&embState()==="done"?`${((S.emb.vecs.length*S.emb.dims*4)/1024).toFixed(1)} KB`:"–";
    case "retrieve": return S.retBusy?"searching…":S.ret?`best ${S.ret.ranked[0].s.toFixed(2)}`:"no search";
    case "prompt": return S.ret?`≈ ${fmt(tokEst(buildPrompt(S.ret.q,topOf(S.ret))))} tok`:"–";
    case "generate": return S.genBusy?"answering…":S.gen?(S.gen.error?"failed":`${(S.gen.answer.ms/1000).toFixed(1)} s`):"no answer";
    case "evaluate": { const r=S.evalRes; if(!r) return "no tests"; const h=r.rows.filter(x=>x.hit!=null); return `${h.filter(x=>x.hit).length}/${h.length} found`; }
  }
}
function buildNav(){
  $("#nodes").innerHTML=STAGES.map((st,i)=>`${i?`<span class="wire" data-w="${i-1}" aria-hidden="true"><i></i></span>`:""}<button class="node" data-stage="${i}"><span class="ni">${ICON[st.id]}<span class="num">${i+1}</span></span><span class="nn">${SHORT[i]}</span><span class="ns"></span></button>`).join("");
}
function renderNav(){
  const nodes=$$("#nodes .node"), st=STAGES.map(x=>stageStatus(x.id));
  nodes.forEach((n,i)=>{
    ["done","stale","wait","busy"].forEach(k=>n.classList.toggle(k,st[i]===k));
    n.classList.toggle("on",S.stage===i);
    n.setAttribute("aria-current",S.stage===i?"step":"false");
    n.querySelector(".ns").textContent=stageStat(STAGES[i].id);
    n.title=`${i+1} · ${STAGES[i].name}: ${stageSummary(STAGES[i].id)} (${st[i]==="done"?"up to date":st[i]==="stale"?"needs a re-run":st[i]==="busy"?"working":"not run yet"})`;
  });
  $$("#nodes .wire").forEach((w,i)=>w.classList.toggle("lit",st[i]==="done"&&st[i+1]==="done"));
  renderRunBtn();
}
function renderRunBtn(){
  const b=$("#runBtn"); if(!b) return;
  b.innerHTML=S.flowBusy?`■ <span class="rl">Stop</span>`:`${SV('<path d="M7 4v16l13-8z" fill="currentColor"/>',14)} <span class="rl">Run end to end</span>`;
  b.title=S.flowBusy?"Stop the run":"Run every stage for one question, from the document to the answer";
  b.style.background=S.flowBusy?"var(--bad)":"";
  b.style.color=S.flowBusy?"#fff":"";
}
function pulseNode(i){ const n=$$("#nodes .node")[i]; if(!n) return; n.classList.remove("pulse"); void n.offsetWidth; n.classList.add("pulse"); }
function flowWire(i){ const w=$$("#nodes .wire")[i]; if(!w) return; w.classList.remove("zip"); void w.offsetWidth; w.classList.add("zip"); }
function scrollNodeIntoView(){
  const bar=$("#nodes"), n=$$("#nodes .node")[S.stage]; if(!bar||!n) return;
  const l=n.offsetLeft-bar.offsetLeft, r=l+n.offsetWidth;
  if(l<bar.scrollLeft+10) bar.scrollTo({left:Math.max(0,l-40),behavior:"smooth"});
  else if(r>bar.scrollLeft+bar.clientWidth-10) bar.scrollTo({left:r-bar.clientWidth+40,behavior:"smooth"});
}

/* ============ Run the whole pipeline, stage by stage, for one question ============ */
async function runAll(){
  if(S.flowBusy){ S.flowStop=true; S.ctrl?.abort(); return; }
  if(!S.raw.trim()){ goStage(0); toast("Load a document first: paste one, drop a file, or click <b>Example</b>."); return; }
  if(!chunks().list.length){ goStage(2); toast("There are no chunks to work with. Check the chunk settings."); return; }
  S.flowBusy=true; S.flowStop=false; renderRunBtn();
  const hop=async i=>{ if(S.flowStop) throw 0; goStage(i); pulseNode(i); await sleep(760); if(S.flowStop) throw 0; flowWire(i); await sleep(280); };
  try{
    await hop(0); await hop(1); await hop(2);
    goStage(3); pulseNode(3);
    if(!(await ensureEmbedded())) throw 0;
    await sleep(700); if(S.flowStop) throw 0; flowWire(3); await sleep(280);
    await hop(4);
    if(!S.query.trim()) S.query=EXAMPLE_TESTS[2].q;
    goStage(5); pulseNode(5);
    if(retState()!=="done"){ S.retBusy=true; renderNav(); const r=await retrieve(S.query.trim()); S.retBusy=false; if(!r) throw 0; S.ret=r; updateRet(); renderNav(); }
    await sleep(1100); if(S.flowStop) throw 0; flowWire(5); await sleep(280);
    await hop(6);
    goStage(7); pulseNode(7);
    await ask();
    if(S.gen&&!S.gen.error) pulseNode(7);
  }catch(e){ if(e&&e!==0) toast(esc(e.message||String(e))); }
  S.flowBusy=false; S.flowStop=false; S.retBusy=false; renderNav();
}

/* ============ Render: the stage ============ */
function setBusy(msg){
  S.busyMsg=msg; const b=$("#busy"); if(b) b.textContent=msg;
  const pb=$("#pbar"); if(pb){ const m=/(\d+)%/.exec(msg||""); pb.parentElement.hidden=!m; if(m) pb.style.width=m[1]+"%"; }
  renderNav();
}
function empty(msg,btn){ return `<div class="box empty empty-buddy">${labBuddyHtml({mood:'idle',size:72,className:'ex-empty-buddy'})}<div class="empty-copy">${msg}${btn?`<div style="margin-top:10px">${btn}</div>`:""}</div></div>`; }
const goBtn = (i,label) => `<button class="mini li" data-stage="${i}">${label}</button>`;
const toggle = (key,label,on) => `<button class="rule ${on?"on":""}" data-toggle="${key}" aria-pressed="${on}"><span class="tg"></span>${label}</button>`;
const staleChip = msg => `<div class="chip am" style="align-self:flex-start;display:inline-block;margin-bottom:8px">${msg}</div>`;

function renderStage(){
  const i=S.stage, st=STAGES[i];
  $("#stage").innerHTML=`<div class="shead"><span class="big">${ICON[st.id]}</span><div class="tt"><b>${i+1} · ${st.name}</b><span>${st.what}</span></div>
      <button class="rnd" data-stage="${i-1}" ${i?"":"disabled"} aria-label="Previous stage${i?": "+STAGES[i-1].name:""}" title="${i?"‹ "+STAGES[i-1].name:""}">${ARROW_L}</button>
      <button class="rnd" data-stage="${i+1}" ${i<STAGES.length-1?"":"disabled"} aria-label="Next stage${i<8?": "+STAGES[i+1].name:""}" title="${i<8?STAGES[i+1].name+" ›":""}">${ARROW_R}</button></div>
    <div class="sbody" id="sbody">${stageBody(st.id)}</div>`;
  postRender();
}
function postRender(){
  const id=STAGES[S.stage].id;
  if(id==="load") renderLoadStats();
  if(id==="chunk"){ HOT=null; showChunk(S.pin); }
  if(id==="retrieve") paintQuery();
  if((id==="embed"||id==="retrieve") && S.emb) S.emb.fresh=false;
  if(id==="generate") startTyping();
  if(id==="evaluate") animRings();
}
function goStage(i){
  i=Math.max(0,Math.min(STAGES.length-1,i)); if(i===S.stage && $("#sbody")) { renderNav(); return; }
  S.stage=i; S.pin=null; hideTip(); renderAll(); scrollNodeIntoView();
  if(window.innerWidth<=1100) $("#stage").scrollIntoView?.({block:"nearest"});
}

function stageBody(id){
  const c=S.raw.trim()?cleaned():null, L=c?chunks().list:[];
  switch(id){
  case "load": return `
    <div class="row"><button class="mini li" data-act="example">Example</button><button class="mini" data-act="upload">Upload .txt, .md or .pdf</button><span class="grow"></span><span class="chips" id="loadStats"></span></div>
    <div class="drop" id="drop">
      <textarea id="doc" spellcheck="false" aria-label="Document text">${esc(S.raw)}</textarea>
      <div class="drophint" id="dropHint" ${S.raw?"hidden":""}><div>${SV('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/>',34)}<b>Drop a PDF or text file here</b>or paste the text, or click Example</div></div>
    </div>
    <div class="busyline" id="busy">${S.parsing?esc(S.parsing):""}</div>`;
  case "clean": {
    if(!c) return empty("Load a document first.",goBtn(0,"Go to Load"));
    return `
    <div class="rules" id="rules">${rulePills()}</div>
    <div class="row"><div class="seg" role="group" aria-label="View">${[["changes","Changes"],["text","Clean text"]].map(([k,t])=>`<button data-cview="${k}" class="${S.cleanView===k?"on":""}">${t}</button>`).join("")}</div>
      <span class="grow"></span><span class="chips" id="cleanChips">${cleanChips()}</span></div>
    <div id="cleanOut">${cleanOut()}</div>`;
  }
  case "chunk": {
    if(!c) return empty("Load a document first.",goBtn(0,"Go to Load"));
    return `
    <div class="ctl">
      <span class="lbl">Split by</span><div><div class="seg" role="group" aria-label="Split by">${[["words","Words"],["sentences","Sentences"],["sections","Sections"]].map(([k,t])=>`<button data-mode="${k}" class="${S.mode===k?"on":""}">${t}</button>`).join("")}</div></div>
    </div>
    <div class="sl"><span>Chunk size</span><input type="range" id="size" min="20" max="300" step="10" value="${S.size}" aria-label="Chunk size in words"><b id="vSize">${S.size}</b></div>
    <div class="sl" ${S.mode==="sections"?'style="opacity:.4"':""}><span>Overlap</span><input type="range" id="overlap" min="0" max="${Math.floor(S.size/2)}" step="5" value="${Math.min(S.overlap,Math.floor(S.size/2))}" ${S.mode==="sections"?"disabled":""} aria-label="Overlap in words"><b id="vOverlap">${S.overlap}</b></div>
    <div class="row"><div class="seg" role="group" aria-label="View">${[["text","On the text"],["cards","As cards"]].map(([k,t])=>`<button data-chview="${k}" class="${S.chunkView===k?"on":""}">${t}</button>`).join("")}</div><span class="grow"></span><span class="chips" id="chunkChips">${chunkChips()}</span></div>
    <div class="chunkinfo" id="chunkInfo"></div>
    <div id="chunkOut">${chunkOut()}</div>`;
  }
  case "embed": {
    if(!L.length) return empty("Load a document first.",goBtn(0,"Go to Load"));
    const st=embState();
    return `
    <div class="models">${Object.entries(EMBEDDERS).map(([k,m])=>`<button class="mcard ${S.model===k?"on":""}" data-model="${k}" aria-pressed="${S.model===k}"><span class="mi">${k==="minilm"?SV('<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M8 6.8l8 4.4M8 17.2l8-4.4"/>',19):SV('<path d="M4 7h16M4 12h10M4 17h13"/>',19)}</span><span><b>${m.long}</b><small>${m.about}</small></span></button>`).join("")}</div>
    <button class="go" data-act="embed" ${S.embBusy?"disabled":""}>${S.embBusy?"Embedding…":st==="done"?`Embed the ${L.length} chunks again`:`Embed the ${L.length} chunks`}</button>
    <div class="busyline" id="busy">${S.embBusy?esc(S.busyMsg||""):""}</div>
    <div class="pbar" ${S.embBusy&&/\d+%/.test(S.busyMsg||"")?"":"hidden"}><i id="pbar"></i></div>
    <div class="errline">${esc(S.embMsg)}</div>
    ${S.emb?`${st==="stale"?staleChip("The chunks or the model changed since this. Embed again to update."):""}
      <div class="chips"><span class="chip li"><b>${S.emb.vecs.length}</b> vectors</span><span class="chip">× <b>${fmt(S.emb.dims)}</b> numbers each</span><span class="chip">length <b>${Math.sqrt(dot(S.emb.vecs[0],S.emb.vecs[0])).toFixed(2)}</b></span><span class="chip">${S.emb.ms<1000?Math.round(S.emb.ms)+" ms":(S.emb.ms/1000).toFixed(1)+" s"}</span></div>
      ${mapBox(false)}
      <div class="chunkinfo box" id="pick" hidden></div>`:""}`;
  }
  case "store": {
    if(!S.emb||embState()!=="done") return empty("Embed the chunks first.",`<button class="mini li" data-act="embed">Embed now</button> ${goBtn(3,"Go to Embed")}`);
    const kb=((S.emb.vecs.length*S.emb.dims*4)/1024).toFixed(1), n=Math.min(32,S.emb.dims);
    const mx=Math.max(1e-9,...S.emb.vecs.flatMap(v=>v.slice(0,n).map(Math.abs)));
    const cell=x=>{ const a=Math.min(1,Math.abs(x)/mx); return `<i style="background:${x>=0?`rgba(219, 254, 135,${(a*.95).toFixed(2)})`:`rgba(147, 51, 234,${(a*.95).toFixed(2)})`}"></i>`; };
    return `
    <div class="row"><span class="lbl">Show the Python for</span><div class="seg" role="group" aria-label="Vector store">${[["numpy","NumPy"],["faiss","FAISS"],["chroma","Chroma"],["pgvector","pgvector"]].map(([k,t])=>`<button data-store="${k}" class="${S.store===k?"on":""}">${t}</button>`).join("")}</div></div>
    <div class="chips"><span class="chip">Index: <b>exact search</b> over every vector</span><span class="chip"><b>${S.emb.vecs.length}</b> × <b>${fmt(S.emb.dims)}</b> × 4 bytes = <b>${kb} KB</b></span></div>
    <div class="legend"><span><i style="background:var(--li)"></i>positive</span><span><i style="background:var(--pu)"></i>negative</span><span><i style="background:var(--s2)"></i>zero</span><span>first ${n} of the ${fmt(S.emb.dims)} numbers in each vector</span></div>
    <div class="box" style="padding:4px 6px"><table><colgroup><col style="width:44px"><col><col style="width:46%"></colgroup>
      <thead><tr><th>id</th><th>Chunk</th><th>Vector</th></tr></thead>
      <tbody>${L.map((t,i)=>`<tr data-tipchunk="${i}"><td class="mono">${i+1}</td><td class="trunc">${esc(t)}</td><td><div class="heat" title="${S.emb.vecs[i].slice(0,6).map(x=>x.toFixed(3)).join(", ")}, …">${S.emb.vecs[i].slice(0,n).map(cell).join("")}</div></td></tr>`).join("")}</tbody></table></div>`;
  }
  case "retrieve": {
    const hasMap=S.emb&&S.emb.map&&embState()==="done";
    return `
    ${queryBox("search")}
    <div class="row"><span class="lbl">Chunks to keep (k)</span><span class="stepper"><button data-act="kDown" aria-label="Fewer chunks">−</button><b id="kVal">${S.k}</b><button data-act="kUp" aria-label="More chunks">+</button></span></div>
    <div class="sl"><span>Minimum score</span><input type="range" id="minScore" min="0" max="0.9" step="0.05" value="${S.minScore}" aria-label="Minimum score"><b id="vMin">${S.minScore.toFixed(2)}</b></div>
    <div class="busyline" id="busy">${S.retBusy||S.embBusy?esc(S.busyMsg||""):""}</div>
    <div class="pbar" hidden><i id="pbar"></i></div>
    <div class="errline">${esc(S.embMsg)}</div>
    <div id="retInfo">${retInfo()}</div>
    <div class="rgrid">
      <div id="retMap">${hasMap?mapBox(true):empty(L.length?"The map of the chunks appears after they are embedded. The first search embeds them.":"Load a document first.")}</div>
      <div class="ranked" id="retList">${rankList()}</div>
    </div>`;
  }
  case "prompt": {
    const has=S.ret&&S.ret.embSig===embSig();
    return `
    <div class="row"><span class="lbl">Template</span><span class="grow"></span>${toggle("numbered","Number the chunks [1] [2]",S.numbered)}${S.template!==DEFAULT_TEMPLATE?`<button class="mini" data-act="resetTmpl">Reset</button>`:""}</div>
    <textarea id="tmpl" spellcheck="false" aria-label="Prompt template">${esc(S.template)}</textarea>
    <div class="note" style="margin-top:0">{context} becomes the retrieved chunks, and {question} becomes the question.</div>
    <div id="promptOut">${has?promptOut():empty("Search in stage 6 first, so there are chunks to put in the prompt.",goBtn(5,"Go to Retrieve"))}</div>`;
  }
  case "generate": return `
    ${queryBox("ask")}
    <div class="row">${toggle("compare","Also ask without the document",S.compare)}</div>
    <div class="busyline" id="busy">${S.genBusy?esc(S.busyMsg||""):""}</div>
    <div class="pbar" hidden><i id="pbar"></i></div>
    <div id="genOut">${genOut()}</div>`;
  case "evaluate": {
    const n=S.tests.filter(t=>t.q.trim()).length;
    return `
    <div class="row"><span class="lbl">Test questions</span><span class="grow"></span><button class="mini li" data-act="exampleTests">Example</button></div>
    <div class="box tests" style="padding:6px 8px"><table><colgroup><col><col style="width:22%"><col style="width:22%"><col style="width:30px"></colgroup>
      <thead><tr><th>Question</th><th>Answer should contain</th><th>Right chunk contains</th><th></th></tr></thead>
      <tbody>${S.tests.map((t,i)=>`<tr><td><input type="text" data-test="${i}" data-f="q" value="${esc(t.q)}" placeholder="${i===0?"e.g. What nominal cover is needed for footings?":""}" aria-label="Question ${i+1}"></td><td><input type="text" data-test="${i}" data-f="expect" value="${esc(t.expect)}" placeholder="${i===0?"e.g. 50 mm":""}" aria-label="Expected answer ${i+1}"></td><td><input type="text" data-test="${i}" data-f="source" value="${esc(t.source)}" placeholder="${i===0?"e.g. Footings":""}" aria-label="Source text ${i+1}"></td><td><button class="x" data-act="delTest" data-i="${i}" aria-label="Remove test" ${S.tests.length<=1?"disabled":""}>×</button></td></tr>`).join("")}</tbody></table>
      <button class="mini" data-act="addTest" style="margin:6px 0 2px">+ Test</button></div>
    <div class="row">${toggle("evalGen","Also generate answers (one model call per test)",S.evalGen)}</div>
    <button class="go ${S.evalBusy?"stop":""}" data-act="runEval" id="evalBtn">${S.evalBusy?"■ Stop":`Run ${n||""} test${n===1?"":"s"}`}</button>
    <div class="busyline" id="busy">${S.evalBusy?esc(S.busyMsg||""):""}</div>
    <div class="pbar" hidden><i id="pbar"></i></div>
    <div id="evalOut">${evalOut()}</div>`;
  }
  }
}
function queryBox(mode){
  const busy=mode==="ask"&&S.genBusy, live=mode==="search"&&embState()==="done";
  return `<div class="row"><span class="lbl">Question</span><button class="mini li" data-act="exampleQ">Example</button><span class="grow"></span>${mode==="search"?`<span class="live" id="liveTag">${live?"<i></i>Searches as you type":"The first search embeds the chunks"}</span>`:""}</div>
    <textarea id="query" rows="2" style="min-height:58px" placeholder="${esc(QUERY_EXAMPLES[UID%QUERY_EXAMPLES.length])}" aria-label="Question">${esc(S.query)}</textarea>
    <button class="go ${busy?"stop":""}" data-act="${mode}">${busy?"■ Stop":mode==="ask"?`${SV('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',16)} Ask`:`${SV('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',16)} Search`}</button>`;
}
function renderLoadStats(){
  const el=$("#loadStats"); if(!el) return;
  el.innerHTML=S.raw.trim()?`<span class="chip"><b>${fmt(S.raw.length)}</b> characters</span><span class="chip"><b>${fmt(wc(S.raw))}</b> words</span><span class="chip"><b>${fmt(S.raw.split("\n").length)}</b> lines</span>${S.src?.name?`<span class="chip li">${esc(S.src.name)}${S.src.pages?` · ${S.src.pages} pages`:""}</span>`:""}`:"";
  const h=$("#dropHint"); if(h) h.hidden=!!S.raw;
  const b=$("#busy"); if(b&&S.stage===0) b.textContent=S.parsing||"";
}

/* ---- 2 Clean: rule switches and a view of every change ---- */
const RULES=[["headers","Page headers & numbers","lines"],["hyphen","Hyphen splits","words"],["wraps","Broken lines","lines"],["spaces","Extra spaces","characters"]];
const RULE_TIP={headers:"Lines like “Page 2 of 3”, and any short line seen 3 or more times",hyphen:"com-⏎pacted → compacted",wraps:"A line break before a lower-case word becomes a space",spaces:"Runs of spaces become one; 3+ line breaks become one blank line"};
function rulePills(){ const c=cleaned(); return RULES.map(([k,t,u])=>`<button class="rule ${S.clean[k]?"on":""}" data-rule="${k}" aria-pressed="${S.clean[k]}" title="${RULE_TIP[k]}"><span class="tg"></span>${t}<b>${S.clean[k]?fmt(c.n[k]):"off"}</b></button>`).join(""); }
function cleanChips(){ const c=cleaned(); return `<span class="chip">Before <b>${fmt(wc(S.raw))}</b> words</span><span class="chip li">After <b>${fmt(wc(c.text))}</b> words</span>`; }
function cleanOut(){
  const c=cleaned();
  if(S.cleanView==="text") return `<div class="box"><div class="pre" style="max-height:52vh">${esc(c.text)}</div></div>`;
  return `<div class="legend" style="margin-bottom:6px"><span><i style="background:rgba(236, 72, 153,.5)"></i>line removed</span><span><i style="background:var(--li)"></i>hyphen rejoined</span><span><i style="background:transparent;border:1px solid var(--li)"></i>line joined to the next</span><span><i style="background:rgba(185, 10, 189,.4)"></i>extra spaces</span></div>
    <div class="box diff">${cleanDiff()}</div>`;
}
function cleanDiff(){
  const o=S.clean, lines=S.raw.split("\n"), counts={}, MAX=1500;
  if(o.headers) lines.forEach(l=>{ const t=l.trim(); if(t) counts[t]=(counts[t]||0)+1; });
  const rm=lines.map(l=>{ const t=l.trim(); return !!(o.headers && t && (PAGE_RE.test(l)||(counts[t]>=3&&t.length<=80))); });
  const next=new Array(lines.length).fill(null); let nk=null;
  for(let i=lines.length-1;i>=0;i--){ next[i]=nk; if(!rm[i]) nk=i; }
  const out=[]; let blanks=0;
  for(let i=0;i<Math.min(lines.length,MAX);i++){
    const l=lines[i];
    if(rm[i]){ out.push(`<div class="dl rm" title="Removed">${esc(l)}</div>`); continue; }
    if(l===""){ blanks++; out.push(o.spaces&&blanks>=2?`<div class="dl rm" title="Extra blank line, removed">¶</div>`:`<div class="dl"></div>`); continue; }
    blanks=0;
    let body=o.spaces?esc(l).replace(/[ \t]{2,}|\t/g,m=>`<span class="sp">${m.replace(/\t/g,"→")}</span>`):esc(l), tail="";
    const nx=next[i]!=null?lines[next[i]]:null;
    if(nx!=null){
      if(o.hyphen && /\w-$/.test(l) && /^\w/.test(nx)){ body=body.replace(/-$/,'<span class="jn">-⏎</span>'); tail='<span class="jm">rejoined</span>'; }
      else if(o.wraps && !/[.:;]$/.test(l) && /^[a-z]/.test(nx)) tail='<span class="jm">↵ joined</span>';
    }
    out.push(`<div class="dl">${body}${tail}</div>`);
  }
  if(lines.length>MAX) out.push(`<div class="dl" style="color:var(--fa)">… ${fmt(lines.length-MAX)} more lines (switch to Clean text to see them all)</div>`);
  return out.join("");
}
function refreshClean(){ const r=$("#rules"); if(!r) return; r.innerHTML=rulePills(); $("#cleanChips").innerHTML=cleanChips(); $("#cleanOut").innerHTML=cleanOut(); }

/* ---- 3 Chunk: every chunk drawn on the text ---- */
let BANDS=null;
function chunkRanges(){
  const ch=chunks(), sig=ch.sig;
  if(BANDS&&BANDS.sig===sig) return BANDS;
  const text=cleaned().text, words=[]; let m; const re=/\S+/g;
  while((m=re.exec(text))) words.push({w:m[0],i:m.index});
  const ranges=[]; let from=0;
  ch.list.forEach(c=>{
    const cw=c.match(/\S+/g)||[]; let s=-1;
    for(let k=from;k<=words.length-cw.length;k++){
      if(words[k].w!==cw[0]) continue;
      let ok=true; for(let j=1;j<Math.min(cw.length,10);j++) if(words[k+j].w!==cw[j]){ ok=false; break; }
      if(ok){ s=k; break; }
    }
    if(s<0){ ranges.push(null); return; }
    ranges.push([s,s+cw.length]); from=s+1;
  });
  BANDS={sig,text,words,ranges}; return BANDS;
}
function bandsHTML(){
  const {text,words,ranges}=chunkRanges(), cover=words.map(()=>[]), starts={}, MAXW=6000;
  ranges.forEach((r,j)=>{ if(!r) return; (starts[r[0]]=starts[r[0]]||[]).push(j); for(let k=r[0];k<r[1];k++) cover[k].push(j); });
  let h="", last=0, k=0; const n=Math.min(words.length,MAXW);
  while(k<n){
    const key=cover[k].join(" "); let e=k+1;
    while(e<n && !starts[e] && cover[e].join(" ")===key && !/\n/.test(text.slice(words[e-1].i+words[e-1].w.length,words[e].i))) e++;
    h+=esc(text.slice(last,words[k].i));
    (starts[k]||[]).forEach(j=>{ h+=`<span class="cmark" data-c="${j}">${j+1}</span>`; });
    const cv=cover[k], end=words[e-1].i+words[e-1].w.length;
    h+=`<span class="w ${cv.length>1?"ov":cv.length?"c"+(cv[0]%6):""}" data-c="${key}">${esc(text.slice(words[k].i,end))}</span>`;
    last=end; k=e;
  }
  if(words.length>MAXW) h+=`\n\n… ${fmt(words.length-MAXW)} more words (switch to As cards to see every chunk)`;
  return h;
}
function chunkChips(){
  const L=chunks().list; if(!L.length) return "";
  const avg=Math.round(L.reduce((a,x)=>a+wc(x),0)/L.length), mx=Math.max(...L.map(wc)), mn=Math.min(...L.map(wc));
  return `<span class="chip li"><b>${L.length}</b> chunks</span><span class="chip">average <b>${avg}</b> words</span><span class="chip">${mn}–${mx}</span>`;
}
function tileHTML(i,txt){ return `<button class="tile ${S.pin===i?"open":""}" data-tile="${i}" title="Click to show the whole chunk"><div class="th"><b>#${i+1}</b><span>${wc(txt)} words · ≈ ${fmt(tokEst(txt))} tokens</span></div><div class="tt">${esc(txt)}</div></button>`; }
function chunkOut(){
  const L=chunks().list;
  if(!L.length) return empty("No text to chunk.");
  if(S.chunkView==="cards") return `<div class="tiles">${L.map((t,i)=>tileHTML(i,t)).join("")}</div>`;
  return `<div class="box bands" id="bands">${bandsHTML()}</div>`;
}
function refreshChunks(){ const o=$("#chunkOut"); if(!o) return; o.innerHTML=chunkOut(); $("#chunkChips").innerHTML=chunkChips(); if(S.pin!=null&&S.pin>=chunks().list.length) S.pin=null; showChunk(S.pin); }
let HOT=null;
function showChunk(j){
  if(HOT!==j){ $$("#bands .w.hot").forEach(x=>x.classList.remove("hot")); if(j!=null) $$(`#bands .w[data-c~="${j}"]`).forEach(x=>x.classList.add("hot")); HOT=j; }
  const info=$("#chunkInfo"); if(!info) return;
  if(j==null){ info.innerHTML=S.chunkView==="text"?`<span style="color:var(--fa)">Point at the text to see which chunk each word lands in. Click to pin a chunk.</span>`:""; return; }
  const L=chunks().list, {ranges}=chunkRanges(), r=ranges[j], p=ranges[j-1], n=ranges[j+1];
  const ovPrev=r&&p?Math.max(0,p[1]-r[0]):0, ovNext=r&&n?Math.max(0,r[1]-n[0]):0;
  info.innerHTML=`<span class="chips"><span class="chip li">Chunk <b>${j+1}</b> of ${L.length}${S.pin===j?" · pinned":""}</span><span class="chip"><b>${wc(L[j])}</b> words</span><span class="chip">≈ <b>${fmt(tokEst(L[j]))}</b> tokens</span>${ovPrev?`<span class="chip">shares <b>${ovPrev}</b> words with chunk ${j}</span>`:""}${ovNext?`<span class="chip">shares <b>${ovNext}</b> words with chunk ${j+2}</span>`:""}</span>`;
}

/* ---- 4 Embed & 6 Retrieve: the map of the chunks ---- */
let MAPX=null;
function mapBox(withQuery){
  const e=S.emb; if(!e||!e.map) return "";
  const pts=e.map.pts, xs=pts.map(p=>p[0]), ys=pts.map(p=>p[1]);
  let x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys);
  const dx=(x1-x0)||1, dy=(y1-y0)||1; x0-=dx*.1; x1+=dx*.1; y0-=dy*.12; y1+=dy*.12;
  const W=600, H=280, pad=14, cl=(v,a,b)=>Math.max(a,Math.min(b,v));
  const X=x=>pad+(cl(x,x0,x1)-x0)/(x1-x0)*(W-2*pad), Y=y=>pad+(cl(y,y0,y1)-y0)/(y1-y0)*(H-2*pad);
  MAPX={X,Y,sig:e.sig};
  const anim=e.fresh, labels=pts.length<=60;
  let h=`<div class="mapwrap"><svg class="map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-sig="${esc(String(e.sig))}" role="img" aria-label="Map of the chunks${withQuery?" and the question":""}"><g class="lns"></g>`;
  pts.forEach((p,i)=>{ h+=`<g class="${anim?"pin":""}" ${anim?`style="animation-delay:${Math.min(i*35,1200)}ms"`:""}><circle class="pt" data-pt="${i}" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="5.5"/>${labels?`<text x="${(X(p[0])+8).toFixed(1)}" y="${(Y(p[1])+3.5).toFixed(1)}">${i+1}</text>`:""}</g>`; });
  if(withQuery) h+=`<g class="star" id="qstar" style="opacity:0"><path d="M0 -11 l3.2 6.8 7.4.8-5.5 5 1.6 7.3-6.7-3.8-6.7 3.8 1.6-7.3-5.5-5 7.4-.8z"/></g>`;
  return h+`</svg></div><div class="mapnote">Every chunk as a point, flattened from ${fmt(e.dims)} numbers to 2${withQuery?". ★ is your question":""}. Point at a dot to read the chunk. Flattening bends distances, so the scores are the real measure.</div>`;
}
function paintQuery(){
  const svg=$("#retMap svg"); if(!svg||!MAPX||!S.emb) return;
  const r=S.ret, ok=!!(r&&r.embSig===S.emb.sig&&r.qpt&&MAPX.sig===S.emb.sig), top=ok?topOf(r):[], set=new Set(top);
  svg.querySelectorAll(".pt").forEach(c=>{ const i=+c.dataset.pt; c.classList.toggle("top",set.has(i)); c.setAttribute("r",set.has(i)?7.5:5.5); });
  const lns=svg.querySelector(".lns"), star=svg.querySelector("#qstar"); if(!star) return;
  if(!ok){ lns.innerHTML=""; star.style.opacity=0; return; }
  const qx=MAPX.X(r.qpt[0]), qy=MAPX.Y(r.qpt[1]), pts=S.emb.map.pts;
  lns.innerHTML=top.map(i=>`<line class="ln" x1="${qx.toFixed(1)}" y1="${qy.toFixed(1)}" x2="${MAPX.X(pts[i][0]).toFixed(1)}" y2="${MAPX.Y(pts[i][1]).toFixed(1)}"/>`).join("");
  const tr=`translate(${qx.toFixed(1)}px,${qy.toFixed(1)}px)`;
  if(star.style.opacity!=="1"){ star.style.transition="none"; star.style.transform=tr; star.getBoundingClientRect(); star.style.transition=""; star.style.opacity=1; }
  else star.style.transform=tr;
  star.innerHTML=star.innerHTML.replace(/<title>.*<\/title>/,"")+`<title>${esc(r.q)}</title>`;
}
function retInfo(){
  if(!S.ret) return "";
  const r=S.ret, stale=retState()==="stale";
  return `${stale&&!S.retBusy?staleChip("The question, the chunks or the model changed since this search. Search again to update."):""}
    <div class="chips"><span class="chip">Question: <b>${esc(r.q)}</b></span><span class="chip li">kept <b>${topOf(r).length}</b> of ${r.ranked.length}</span></div>`;
}
function rankList(){
  if(!S.ret) return empty("Type a question and search. The page embeds the question with the same model, then scores every chunk against it.");
  const r=S.ret, L=chunks().list, top=new Set(topOf(r)), show=r.ranked.slice(0,Math.max(10,S.k+2));
  return `<div class="lbl" style="margin-bottom:2px">Closest chunks, by cosine similarity</div>`+show.map(x=>`<div class="rank ${top.has(x.i)?"top":x.s<S.minScore?"low":""}" data-rk="${x.i}" data-tipchunk="${x.i}"><span class="rid">#${x.i+1}</span><span class="rt">${esc(L[x.i]??"")}</span><span class="rs"><i style="--w:${(Math.max(0,Math.min(1,x.s))*100).toFixed(1)}%"></i>${x.s.toFixed(3)}</span></div>`).join("")
    +(r.ranked.length>show.length?`<div class="mapnote">+ ${r.ranked.length-show.length} more chunks, further away</div>`:"");
}
function flip(el,html){
  const old={}; el.querySelectorAll("[data-rk]").forEach(x=>old[x.dataset.rk]=x.getBoundingClientRect().top);
  el.innerHTML=html;
  if(!el.animate) return;
  el.querySelectorAll("[data-rk]").forEach(x=>{
    const o=old[x.dataset.rk];
    if(o==null){ x.animate([{opacity:0,transform:"translateY(10px)"},{opacity:1,transform:"none"}],{duration:320,easing:"ease-out"}); return; }
    const d=o-x.getBoundingClientRect().top; if(Math.abs(d)>1) x.animate([{transform:`translateY(${d}px)`},{transform:"none"}],{duration:450,easing:"cubic-bezier(.2,.8,.2,1)"});
  });
}
function updateRet(){
  if(S.stage!==5) return;
  const list=$("#retList"); if(!list){ renderStage(); return; }
  const svg=$("#retMap svg");
  if(S.emb&&embState()==="done"&&(!svg||svg.dataset.sig!==String(S.emb.sig))){ $("#retMap").innerHTML=mapBox(true); S.emb.fresh=false; }
  $("#retInfo").innerHTML=retInfo(); flip(list,rankList()); paintQuery();
  const lt=$("#liveTag"); if(lt) lt.innerHTML=embState()==="done"?"<i></i>Searches as you type":"The first search embeds the chunks";
}
let searchT=null;
async function doSearch(quiet){
  const q=S.query.trim(); if(!q){ if(!quiet) $("#query")?.focus(); return; }
  if(S.retBusy){ S.searchAgain=true; return; }
  S.retBusy=true; renderNav(); if(!quiet) setBusy("Searching…");
  let r=null; try{ r=await retrieve(q); }catch(e){ S.embMsg=e.message; }
  S.retBusy=false; if(!quiet||S.busyMsg==="Searching…") setBusy("");
  if(r){ S.ret=r; announce(`Found the top ${topOf(r).length} chunks.`); }
  updateRet(); changed();
  if(S.searchAgain){ S.searchAgain=false; if(S.query.trim()&&S.query.trim()!==r?.q) doSearch(true); }
}

/* ---- 7 Prompt: what goes into the prompt, and how big each part is ---- */
function promptOut(){
  const r=S.ret, ids=topOf(r), q=r.q, L=chunks().list, p=buildPrompt(q,ids);
  const parts=S.template.split(/(\{context\}|\{question\})/);
  const instr=parts.filter(x=>x&&x!=="{context}"&&x!=="{question}").join("");
  const nCtx=parts.filter(x=>x==="{context}").length, nQ=parts.filter(x=>x==="{question}").length;
  const chunkTxt=ids.map((i,n)=>S.numbered?`[${n+1}] ${L[i]}`:L[i]);
  const segs=[{k:"i",cls:"tb-i",tok:tokEst(instr),lab:"Instructions"}]
    .concat(nCtx?chunkTxt.map((t,n)=>({k:"c"+n,cls:"tb-"+(n%6),tok:tokEst(t)*nCtx,lab:`#${ids[n]+1}`})):[])
    .concat(nQ?[{k:"q",cls:"tb-q",tok:tokEst(q)*nQ,lab:"Q"}]:[]);
  const total=segs.reduce((a,s)=>a+s.tok,0)||1;
  const bar=`<div class="tbar" id="tbar">${segs.map(s=>`<span class="${s.cls}" data-sg="${s.k}" style="flex-grow:${s.tok}" title="${esc(s.lab)}: ≈ ${fmt(s.tok)} tokens (${Math.round(100*s.tok/total)}%)">${s.tok/total>.07?esc(s.lab):""}</span>`).join("")}</div>`;
  const ctxHTML=chunkTxt.map((t,n)=>`<span class="seg-c" data-sg="c${n}">${esc(t)}</span>`).join("\n\n");
  const html=parts.map(x=>x==="{context}"?ctxHTML:x==="{question}"?`<span class="seg-q" data-sg="q">${esc(q)}</span>`:x?`<span class="seg-i" data-sg="i">${esc(x)}</span>`:"").join("");
  return `<div class="chips" style="margin-bottom:8px"><span class="chip li"><b>${ids.length}</b> chunk${ids.length===1?"":"s"}: ${ids.map(i=>"#"+(i+1)).join(", ")||"none"}</span><span class="chip">≈ <b>${fmt(tokEst(p))}</b> tokens</span><span class="chip">${fmt(p.length)} characters</span></div>
    ${bar}
    <div class="legend" style="margin:6px 0 10px"><span><i style="background:#6d7383"></i>instructions</span><span><i style="background:#dbfe87"></i>retrieved chunks</span><span><i style="background:#d59bea"></i>question</span></div>
    <div class="box"><div class="lbl" style="margin-bottom:4px">The prompt the model receives</div><div class="pre prompt" style="max-height:none">${html}</div></div>`;
}

/* ---- 8 Generate: the answer, typed out, with its sources beside it ---- */
function withCites(text,ids){
  const L=chunks().list;
  return md(text).replace(/\[(\d{1,2})\]/g,(m,n)=>{ const i=ids?.[+n-1]; return i!=null?`<span class="cite" data-src="${n}" title="Chunk #${i+1}">${n}</span>`:m; });
}
function genOut(){
  const g=S.gen;
  if(!g) return empty("Ask a question. The page runs every stage for it: embeds it, retrieves the closest chunks, builds the prompt, and sends it to the model.");
  if(g.error) return `<div class="answer err"><div class="ah"><b style="color:#EC4899">Error</b></div><div class="errline">${esc(g.error)}</div></div>`;
  const stale=genState()==="stale", L=chunks().list;
  const scoreOf=i=>S.ret&&S.ret.q===g.q?S.ret.ranked.find(x=>x.i===i)?.s:null;
  const a=`<div class="answer"><div class="ah"><b>With the document</b><span>${esc((PROVIDERS[g.prov]||P()).name)} · ${(g.answer.ms/1000).toFixed(1)} s${g.answer.tok?` · ${fmt(g.answer.tok)} tokens`:""}</span></div><div class="at" id="ansA">${withCites(g.answer.text,g.ids)||'<span style="color:var(--fa2)">(no answer)</span>'}</div></div>`;
  const b=g.bare?`<div class="answer bare"><div class="ah"><b>Without the document</b><span>${(g.bare.ms/1000).toFixed(1)} s${g.bare.tok?` · ${fmt(g.bare.tok)} tokens`:""}</span></div><div class="at" id="ansB">${md(g.bare.text)||'<span style="color:var(--fa2)">(no answer)</span>'}</div></div>`:"";
  const srcs=`<div class="srcs"><div class="lbl">Sources sent with the question</div>${g.ids.length?g.ids.map((i,n)=>{ const s=scoreOf(i); return `<div class="src" data-src="${n+1}"><div class="sh"><b>[${n+1}] chunk #${i+1}</b><span>${s!=null?s.toFixed(3):""}</span></div><div class="st">${esc(L[i]??"")}</div></div>`; }).join(""):`<div class="box empty" style="padding:10px">No chunk passed the minimum score.</div>`}</div>`;
  return `${stale?staleChip("Something upstream changed since this answer. Ask again to update."):""}
    <div class="chips" style="margin-bottom:8px"><span class="chip">Question: <b>${esc(g.q)}</b></span></div>
    <div class="agrid"><div style="display:flex;flex-direction:column;gap:10px;min-width:0">${a}${b}</div>${srcs}</div>`;
}
function typeInto(el,text,render){
  const total=text.length, step=Math.max(2,Math.ceil(total/75)); let n=0;
  const tick=()=>{ if(!el.isConnected) return; n=Math.min(total,n+step); el.innerHTML=render(text.slice(0,n))+(n<total?'<span class="caret"></span>':""); if(n<total) requestAnimationFrame(tick); };
  tick();
}
function startTyping(){
  const g=S.gen; if(!g||!g.fresh) return; g.fresh=false; if(g.error) return;
  const a=$("#ansA"); if(a&&g.answer.text) typeInto(a,g.answer.text,t=>withCites(t,g.ids));
  const b=$("#ansB"); if(b&&g.bare?.text) typeInto(b,g.bare.text,md);
}

/* ---- 9 Evaluate: score rings and a row per test ---- */
const RC=2*Math.PI*26, RINGS={};
function ringHTML(key,n,d,label,color){
  const v=d?n/d:0, prev=RINGS[key]??0;
  return `<div class="ringc"><svg class="ring" viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26" style="stroke:${color};stroke-dasharray:${RC.toFixed(2)};stroke-dashoffset:${(RC*(1-prev)).toFixed(2)}" data-ring="${key}" data-v="${v}"/><text x="32" y="33">${d?Math.round(v*100)+"%":"–"}</text></svg><div><b>${n}/${d}</b><span>${label}</span></div></div>`;
}
function animRings(){
  const rs=$$("[data-ring]"); if(!rs.length) return;
  rs.forEach(c=>getComputedStyle(c).strokeDashoffset);
  requestAnimationFrame(()=>rs.forEach(c=>{ const v=+c.dataset.v; c.style.strokeDashoffset=(RC*(1-v)).toFixed(2); RINGS[c.dataset.ring]=v; }));
}
function evalOut(){
  const r=S.evalRes; if(!r) return empty("Add questions whose answers you know, then run the tests. Each one goes through the whole pipeline.");
  const h=r.rows.filter(x=>x.hit!=null), a=r.rows.filter(x=>x.ok!=null);
  const mark=v=>v==null?`<span class="res na">–</span>`:v?`<span class="res ok">✓</span>`:`<span class="res no">✗</span>`;
  const html=`${evalState()==="stale"&&!S.evalBusy?staleChip("Something changed since these results. Run the tests again to update."):""}
    <div class="rings">${ringHTML("hit",h.filter(x=>x.hit).length,h.length,"Retrieval found the right chunk","#dbfe87")}${r.gen?ringHTML("ok",a.filter(x=>x.ok).length,a.length,"Answers contained the expected text","#B90ABD"):""}</div>
    <div class="box" style="padding:4px 6px;margin-top:10px"><table><colgroup><col><col style="width:84px"><col style="width:52px">${r.gen?'<col style="width:52px">':""}</colgroup>
      <thead><tr><th>Question</th><th>Chunks</th><th>Found</th>${r.gen?"<th>Right</th>":""}</tr></thead>
      <tbody>${r.rows.map((x,n)=>`<tr class="${x.fresh?"fresh":""}"><td><button class="qlink" data-act="inspect" data-i="${n}" title="Open this question in Retrieve">${esc(x.q)}</button>${x.error?`<div class="errline">${esc(x.error)}</div>`:x.answer!=null?`<details><summary style="cursor:pointer;font-size:11px;color:var(--fa)">answer</summary><div class="at" style="font-size:12px;color:var(--mu);white-space:pre-wrap">${withCites(x.answer,x.ids)}</div></details>`:""}</td>
        <td class="mono">${(x.ids||[]).map(i=>"#"+(i+1)).join(" ")}</td><td>${mark(x.hit)}</td>${r.gen?`<td>${mark(x.ok)}</td>`:""}</tr>`).join("")}
        ${S.evalBusy?`<tr><td colspan="${r.gen?4:3}" style="color:var(--bl);font-size:12px">Running test ${r.rows.length+1}…</td></tr>`:""}</tbody></table></div>`;
  r.rows.forEach(x=>x.fresh=false);
  requestAnimationFrame(animRings);
  return html;
}


/* ============ Python ============ */
function splitHL(html){
  const out=[]; let cur="", open=null, m; const re=/(<span class="[^"]*">)|(<\/span>)|(\n)|([^<\n]+)/g;
  while((m=re.exec(html))){ if(m[1]){ open=m[1]; cur+=m[1]; } else if(m[2]){ open=null; cur+=m[2]; } else if(m[3]){ if(open) cur+="</span>"; out.push(cur); cur=open||""; } else cur+=m[4]; }
  out.push(cur); return out;
}
let PYLAST={key:"",code:""};
function renderPy(){
  const id=STAGES[S.stage].id, code=S.py==="all"?pyAll():pyFor(id), key=S.py+"|"+S.stage;
  $$("[data-py]").forEach(b=>b.classList.toggle("on",b.dataset.py===S.py));
  $("#code").title=S.py==="all"?"Every stage as one script you could run in Colab.":`Stage ${S.stage+1}, ${STAGES[S.stage].name}, as code you could run in Colab.`;
  $("#pyNote").textContent = id==="store"&&S.py==="stage" ? "The page keeps its vectors in memory and searches all of them (a flat index). FAISS, Chroma and pgvector do the same job at larger scale." : id==="generate"&&S.py==="stage" ? "In class the page sends this through the Playground, so you don't need a key here." : "";
  if(PYLAST.key===key&&PYLAST.code===code) return;
  const prev=PYLAST.key===key?new Set(PYLAST.code.split("\n")):null, src=code.split("\n"), el=$("#code");
  PYLAST={key,code};
  el.innerHTML=splitHL(hlPython(code)).map((h,i)=>prev&&src[i].trim()&&!prev.has(src[i])?`<span class="chg">${h}</span>`:h).join("\n");
  if(!prev) el.scrollTop=0;
  const first=el.querySelector(".chg");
  if(first&&(first.offsetTop<el.scrollTop||first.offsetTop>el.scrollTop+el.clientHeight-30)) el.scrollTo({top:Math.max(0,first.offsetTop-el.clientHeight/3),behavior:"smooth"});
}
function renderAll(){ renderNav(); renderStage(); renderPy(); }
/* Anything upstream changed: refresh what depends on it, without rebuilding the box being typed in */
function changed(){ renderNav(); renderPy(); }

/* ============ Hover: read a chunk anywhere ============ */
function showTip(i,ev){
  const L=chunks().list, t=$("#tip"); if(i==null||L[i]==null){ hideTip(); return; }
  t.innerHTML=`<b>#${i+1}</b> · ${wc(L[i])} words<br>${esc(L[i].length>280?L[i].slice(0,280)+"…":L[i])}`; t.hidden=false; moveTip(ev);
}
function moveTip(ev){ const t=$("#tip"); if(t.hidden) return; const w=t.offsetWidth, h=t.offsetHeight; let x=ev.clientX+14, y=ev.clientY+16; if(x+w>innerWidth-8) x=ev.clientX-w-14; if(y+h>innerHeight-8) y=ev.clientY-h-12; t.style.left=Math.max(8,x)+"px"; t.style.top=Math.max(8,y)+"px"; }
function hideTip(){ const t=$("#tip"); if(t) t.hidden=true; }
function hotPoint(i,on){ $$(`#retMap .pt[data-pt="${i}"], #sbody .map .pt[data-pt="${i}"]`).forEach(c=>c.classList.toggle("hot",on)); $$(`#retList .rank[data-rk="${i}"]`).forEach(r=>r.classList.toggle("hot",on)); }

/* ============ Parameters & full screen ============ */
function fillSettings(){ $("#temp").value=S.temp; $("#topp").value=S.topp; $("#cap").value=S.cap; $("#vTemp").textContent=S.temp.toFixed(2); $("#vTopp").textContent=S.topp>=0.999?"off":S.topp.toFixed(2); $("#vCap").textContent=S.cap+" tok"; }
function openSettings(){ fillSettings(); $("#setModal").classList.add("open"); $("#setModal [data-close]").focus(); }
function closeModals(){ $$(".modal").forEach(m=>m.classList.remove("open")); }
const IC={
  gear:'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  fsOn:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fsOff:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>'
};
function renderFs(){ const on=!!document.fullscreenElement, b=$("#fsBtn"); b.innerHTML=on?IC.fsOff:IC.fsOn; b.title=on?"Exit full screen":"Full screen"; }
function toggleFs(){ /* bindHostFullscreen owns the button */ }

/* ============ Events ============ */
host.addEventListener("input",e=>{
  const t=e.target;
  if(t.id==="doc"){ S.raw=t.value; S.pin=null; renderLoadStats(); changed(); }
  else if(t.id==="size"){ S.size=+t.value; S.overlap=Math.min(S.overlap,Math.floor(S.size/2)); $("#vSize").textContent=S.size; const o=$("#overlap"); if(o){ o.max=Math.floor(S.size/2); o.value=S.overlap; $("#vOverlap").textContent=S.overlap; } refreshChunks(); changed(); }
  else if(t.id==="overlap"){ S.overlap=+t.value; $("#vOverlap").textContent=S.overlap; refreshChunks(); changed(); }
  else if(t.id==="query"){ S.query=t.value; changed();
    if(S.stage===5){ clearTimeout(searchT); if(embState()==="done"&&S.query.trim()) searchT=setTimeout(()=>doSearch(true),320); else $("#retInfo").innerHTML=retInfo(); } }
  else if(t.id==="minScore"){ S.minScore=+t.value; $("#vMin").textContent=S.minScore.toFixed(2); updateRet(); changed(); }
  else if(t.id==="tmpl"){ S.template=t.value; const po=$("#promptOut"); if(po&&S.ret&&S.ret.embSig===embSig()) po.innerHTML=promptOut(); changed(); }
  else if(t.dataset.test!=null){ S.tests[+t.dataset.test][t.dataset.f]=t.value; const n=S.tests.filter(x=>x.q.trim()).length, b=$("#evalBtn"); if(b&&!S.evalBusy) b.textContent=`Run ${n||""} test${n===1?"":"s"}`; changed(); }
  else if(t.id==="temp"){ S.temp=parseFloat(t.value); fillSettings(); renderPy(); }
  else if(t.id==="topp"){ S.topp=parseFloat(t.value); fillSettings(); }
  else if(t.id==="cap"){ S.cap=parseInt(t.value); fillSettings(); renderPy(); }
});
host.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="provSel"){ S.prov=t.value; changed(); if(S.stage===7) { const go=$("#genOut"); if(go) go.innerHTML=genOut(); } }
  else if(t.id==="fileIn"){ loadFile(t.files[0]); t.value=""; }
});
host.addEventListener("click",e=>{
  if(e.target.classList.contains("modal") || e.target.closest("[data-close]")){ closeModals(); return; }
  const sb=e.target.closest("[data-stage]"); if(sb){ goStage(+sb.dataset.stage); return; }
  const ru=e.target.closest("[data-rule]"); if(ru){ const k=ru.dataset.rule; S.clean[k]=!S.clean[k]; refreshClean(); changed(); return; }
  const cv=e.target.closest("[data-cview]"); if(cv){ S.cleanView=cv.dataset.cview; $$("[data-cview]").forEach(b=>b.classList.toggle("on",b===cv)); $("#cleanOut").innerHTML=cleanOut(); return; }
  const chv=e.target.closest("[data-chview]"); if(chv){ S.chunkView=chv.dataset.chview; $$("[data-chview]").forEach(b=>b.classList.toggle("on",b===chv)); HOT=null; refreshChunks(); return; }
  const tg=e.target.closest("[data-toggle]"); if(tg){ const k=tg.dataset.toggle; S[k]=!S[k]; tg.classList.toggle("on",S[k]); tg.setAttribute("aria-pressed",S[k]);
    if(k==="numbered"){ const po=$("#promptOut"); if(po&&S.ret&&S.ret.embSig===embSig()) po.innerHTML=promptOut(); }
    changed(); return; }
  const w=e.target.closest("#bands [data-c]"); if(w){ const c=w.dataset.c; if(c!==""){ const j=+c.split(" ").pop(); S.pin=S.pin===j?null:j; HOT=undefined; showChunk(S.pin??j); } return; }
  const tl=e.target.closest("[data-tile]"); if(tl){ const i=+tl.dataset.tile; S.pin=S.pin===i?null:i; $$(".tile").forEach(x=>x.classList.toggle("open",+x.dataset.tile===S.pin)); showChunk(S.pin); return; }
  const pt=e.target.closest("[data-pt]"); if(pt){ const i=+pt.dataset.pt, pk=$("#pick"); if(pk){ pk.hidden=false; pk.innerHTML=`<div class="lbl" style="margin-bottom:4px">Chunk #${i+1}</div>${esc(chunks().list[i])}`; } else if(S.stage===5){ const row=$(`#retList [data-rk="${i}"]`); row?.scrollIntoView({block:"nearest",behavior:"smooth"}); } return; }
  const md_=e.target.closest("[data-mode]"); if(md_){ S.mode=md_.dataset.mode; S.pin=null; renderAll(); return; }
  const mo=e.target.closest("[data-model]"); if(mo){ S.model=mo.dataset.model; S.embMsg=""; renderAll(); return; }
  const so=e.target.closest("[data-store]"); if(so){ S.store=so.dataset.store; $$("[data-store]").forEach(b=>b.classList.toggle("on",b===so)); renderPy(); return; }
  const py=e.target.closest("[data-py]"); if(py){ S.py=py.dataset.py; renderPy(); return; }
  const a=e.target.closest("[data-act]");
  if(a){ const act=a.dataset.act;
    if(act==="example"){ if(S.raw.trim() && S.raw!==EXAMPLE_DOC && !confirm("Replace the document with the example?")) return; S.raw=EXAMPLE_DOC; S.src={name:"campus_code.pdf", pages:3}; S.pin=null; renderAll(); }
    else if(act==="upload"){ $("#fileIn").click(); }
    else if(act==="embed"){ embed(); }
    else if(act==="search"){ doSearch(false); }
    else if(act==="ask"){ ask(); }
    else if(act==="exampleQ"){ const i=(UID++)%EXAMPLE_TESTS.length; S.query=EXAMPLE_TESTS[i===7?0:i].q; const qb=$("#query"); if(qb){ qb.value=S.query; qb.focus(); } changed(); if(S.stage===5&&embState()==="done") doSearch(true); }
    else if(act==="kDown"){ S.k=Math.max(1,S.k-1); $("#kVal").textContent=S.k; updateRet(); changed(); }
    else if(act==="kUp"){ S.k=Math.min(10,S.k+1); $("#kVal").textContent=S.k; updateRet(); changed(); }
    else if(act==="resetTmpl"){ S.template=DEFAULT_TEMPLATE; renderAll(); }
    else if(act==="exampleTests"){ if(S.tests.some(t=>t.q.trim()) && !confirm("Replace the test questions with the example set?")) return; S.tests=EXAMPLE_TESTS.map(t=>({...t})); renderAll(); }
    else if(act==="addTest"){ S.tests.push({q:"",expect:"",source:""}); renderStage(); $$('[data-f="q"]').pop()?.focus(); }
    else if(act==="delTest"){ S.tests.splice(+a.dataset.i,1); renderAll(); }
    else if(act==="runEval"){ runEval(); }
    else if(act==="inspect"){ const row=S.evalRes?.rows[+a.dataset.i]; if(!row) return; S.query=row.q; goStage(5); doSearch(false); }
    else if(act==="runAll"){ runAll(); }
    else if(act==="togglePy"){ const off=host.classList.toggle("nopy"); a.classList.toggle("on",!off); a.setAttribute("aria-pressed",!off); }
    else if(act==="copyPy"){ const txt=S.py==="all"?pyAll():pyFor(STAGES[S.stage].id); navigator.clipboard?.writeText(txt).then(()=>{ a.textContent="Copied"; setTimeout(()=>a.textContent="Copy",1200); },()=>toast("Couldn't copy. Select the code and copy it by hand.")); }
    else if(act==="resetParams"){ Object.assign(S,DEFAULTS); fillSettings(); renderPy(); }
    return; }
  if(e.target.closest("#settingsBtn")) openSettings();
  else if(e.target.closest("#fsBtn")) toggleFs();
});
host.addEventListener("mouseover",e=>{
  const w=e.target.closest?.("#bands [data-c]"); if(w){ const c=w.dataset.c; if(c!=="") showChunk(+c.split(" ").pop()); return; }
  const tile=e.target.closest?.("[data-tile]"); if(tile){ showChunk(+tile.dataset.tile); return; }
  const pt=e.target.closest?.("[data-pt]"); if(pt){ const i=+pt.dataset.pt; showTip(i,e); hotPoint(i,true); return; }
  const rk=e.target.closest?.("[data-rk]"); if(rk){ hotPoint(+rk.dataset.rk,true); showTip(+rk.dataset.rk,e); return; }
  const tc=e.target.closest?.("[data-tipchunk]"); if(tc){ showTip(+tc.dataset.tipchunk,e); }
  const ci=e.target.closest?.(".cite[data-src], .src[data-src]"); if(ci){ const n=ci.dataset.src; $$(`#genOut [data-src="${n}"]`).forEach(x=>x.classList.add("hot")); }
  const sg=e.target.closest?.("[data-sg]"); if(sg){ $$(`#promptOut [data-sg="${sg.dataset.sg}"]`).forEach(x=>x.classList.add("hot")); }
});
host.addEventListener("mouseout",e=>{
  const w=e.target.closest?.("#bands"); if(w&&!w.contains(e.relatedTarget)) showChunk(S.pin);
  const tile=e.target.closest?.(".tiles"); if(tile&&!tile.contains(e.relatedTarget)) showChunk(S.pin);
  const pt=e.target.closest?.("[data-pt]"); if(pt){ hideTip(); hotPoint(+pt.dataset.pt,false); }
  const rk=e.target.closest?.("[data-rk]"); if(rk&&!rk.contains(e.relatedTarget)) hotPoint(+rk.dataset.rk,false);
  const tc=e.target.closest?.("[data-tipchunk]"); if(tc&&!tc.contains(e.relatedTarget)) hideTip();
  const ci=e.target.closest?.(".cite[data-src], .src[data-src]"); if(ci&&!ci.contains(e.relatedTarget)) $$("#genOut .hot").forEach(x=>x.classList.remove("hot"));
  const sg=e.target.closest?.("[data-sg]"); if(sg&&!sg.contains(e.relatedTarget)) $$("#promptOut .hot").forEach(x=>x.classList.remove("hot"));
});
host.addEventListener("mousemove",e=>{ if(!$("#tip").hidden) moveTip(e); });
host.addEventListener("keydown",e=>{
  if(e.key==="Escape"){ closeModals(); hideTip(); return; }
  if(e.target.id==="query" && e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); if(S.stage===5) doSearch(false); else if(!S.genBusy) ask(); return; }
  const typing=e.target.closest?.("input,textarea,select,[contenteditable]");
  if(!typing && !e.altKey && !e.ctrlKey && !e.metaKey && !$(".modal.open")){
    if(e.key==="ArrowRight"){ e.preventDefault(); goStage(S.stage+1); }
    else if(e.key==="ArrowLeft"){ e.preventDefault(); goStage(S.stage-1); }
  }
});
/* drop a file on the document box */
host.addEventListener("dragover",e=>{ const d=e.target.closest?.("#drop"); if(d){ e.preventDefault(); d.classList.add("drag"); } });
host.addEventListener("dragleave",e=>{ const d=e.target.closest?.("#drop"); if(d&&!d.contains(e.relatedTarget)) d.classList.remove("drag"); });
host.addEventListener("drop",e=>{ const d=e.target.closest?.("#drop"); if(d){ e.preventDefault(); d.classList.remove("drag"); loadFile(e.dataTransfer.files[0]); } });
document.addEventListener("fullscreenchange",renderFs);
let rsT=null; const onWinResize=()=>{ clearTimeout(rsT); rsT=setTimeout(()=>{ scrollNodeIntoView(); },150); }; window.addEventListener("resize", onWinResize);



  type UndoSnap = {
    stage: number; prov: string; temp: number; topp: number; cap: number; py: string;
    mode: string; size: number; overlap: number; model: string; store: string;
    query: string; k: number; minScore: number; template: string; numbered: boolean; compare: boolean;
    evalGen: boolean; clean: {headers:boolean;hyphen:boolean;wraps:boolean;spaces:boolean};
  };
  const undo = createUndoStack<UndoSnap>({ max: 40 });
  const snap = (): UndoSnap => ({
    stage: S.stage, prov: S.prov, temp: S.temp, topp: S.topp, cap: S.cap, py: S.py,
    mode: S.mode, size: S.size, overlap: S.overlap, model: S.model, store: S.store,
    query: S.query, k: S.k, minScore: S.minScore, template: S.template, numbered: S.numbered,
    compare: S.compare, evalGen: S.evalGen, clean: { ...S.clean },
  });
  const syncUndoUi = () => syncUndoButton($('#undoBtn') as HTMLButtonElement | null, undo.canUndo);
  const pushUndo = () => { undo.push(snap()); syncUndoUi(); };
  const applyUndo = (u: UndoSnap) => {
    Object.assign(S, {
      stage: u.stage, prov: u.prov, temp: u.temp, topp: u.topp, cap: u.cap, py: u.py,
      mode: u.mode, size: u.size, overlap: u.overlap, model: u.model, store: u.store,
      query: u.query, k: u.k, minScore: u.minScore, template: u.template, numbered: u.numbered,
      compare: u.compare, evalGen: u.evalGen, clean: { ...u.clean },
    });
    if ($('#provSel')) ($('#provSel') as HTMLSelectElement).value = S.prov;
    renderAll();
    syncUndoUi();
  };

  function startUi() {
    $('#settingsBtn').innerHTML = IC.gear;
    unbindFs = bindHostFullscreen(host, $('#fsBtn'));
    const sel = $('#provSel') as HTMLSelectElement;
    if (sel) {
      sel.innerHTML = Object.entries(PROVIDERS).map(([k,p]) => `<option value="${k}">${(p as any).name}</option>`).join('');
      sel.value = S.prov;
    }
    buildNav();
    renderAll();
    syncUndoUi();
    host.classList.remove('is-booting');
  }

  async function boot() {
    try {
      catalog = await loadBuildRagCatalog(sessionId, projectId);
      if (aborted) return;
      PROVIDERS = Object.fromEntries((catalog.models || []).map((m) => [m.id, m]));
      defaultProv = catalog.defaults?.prov || catalog.models?.[0]?.id || 'gemini-flash-lite';
      DEFAULTS = {
        temp: catalog.defaults?.temp ?? 0.2,
        topp: catalog.defaults?.topp ?? 1,
        cap: catalog.defaults?.cap ?? 400,
      };
      if (catalog.sample?.doc) EXAMPLE_DOC = catalog.sample.doc;
      if (catalog.sample?.tests?.length) EXAMPLE_TESTS = catalog.sample.tests.map((t) => ({ ...t }));
      if (catalog.sample?.template) DEFAULT_TEMPLATE = catalog.sample.template;
      if (catalog.sample?.questions?.length) QUERY_EXAMPLES = catalog.sample.questions;
      if (catalog.stages?.length) STAGES = catalog.stages;
      if (catalog.embedders) EMBEDDERS = { ...EMBEDDERS, ...catalog.embedders };
      S.prov = defaultProv;
      S.temp = DEFAULTS.temp;
      S.topp = DEFAULTS.topp;
      S.cap = DEFAULTS.cap;
      S.mode = catalog.defaults?.mode || S.mode;
      S.size = catalog.defaults?.size ?? S.size;
      S.overlap = catalog.defaults?.overlap ?? S.overlap;
      S.k = catalog.defaults?.k ?? S.k;
      S.minScore = catalog.defaults?.minScore ?? S.minScore;
      S.model = catalog.defaults?.model || S.model;
      S.store = catalog.defaults?.store || S.store;
      S.numbered = catalog.defaults?.numbered ?? S.numbered;
      S.compare = catalog.defaults?.compare ?? S.compare;
      S.evalGen = catalog.defaults?.evalGen ?? S.evalGen;
      if (catalog.defaults?.clean) S.clean = { ...S.clean, ...catalog.defaults.clean };
      S.template = DEFAULT_TEMPLATE;
      pushUndo();
      startUi();
    } catch (e: any) {
      host.classList.remove('is-booting');
      toast(esc(e?.message || 'Could not load the RAG lab.'));
    }
  }

  host.addEventListener('click', (e: any) => {
    const btn = e.target?.closest?.('#undoBtn, [data-act="undo"]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const prev = undo.undo();
    if (prev) applyUndo(prev);
  }, true);

  // Snapshot before major pipeline mutations
  host.addEventListener('click', (e: any) => {
    const a = e.target?.closest?.('[data-act]');
    if (!a) return;
    const act = a.dataset?.act;
    if (['example','exampleTests','resetTmpl','resetParams','addTest','delTest','embed','ask','runEval','runAll'].includes(act)) {
      try { pushUndo(); } catch (_e) {}
    }
  }, true);

  // Capture resize listener from prototype (addEventListener without target = window)
  void boot();

  return () => {
    aborted = true;
    S.ctrl?.abort();
    S.evalCtrl?.abort();
    window.removeEventListener('resize', onWinResize);
    document.removeEventListener('fullscreenchange', renderFs);
    unbindFs?.();
    unbindTheme();
    host.innerHTML = '';
    host.classList.remove('is-booting', 'nopy');
  };
}
