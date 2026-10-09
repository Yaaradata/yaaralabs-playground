"""Generate exercise12/lib/mount.ts from the Build-a-RAG HTML prototype."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "exercise-12-build-a-rag.html").read_text(encoding="utf-8")

body_start = html.index("<header>")
body_end = html.index('<div class="sr" aria-live="polite" id="live"></div>') + len(
    '<div class="sr" aria-live="polite" id="live"></div>'
)
template_raw = html[body_start:body_end]

template_raw = re.sub(
    r'<div class="brand"><span class="dot"></span><b>Exercise 12 · Build a RAG, end to end</b></div>\n',
    "${exerciseBrandHtml(12, 'Exercise - 12 : Build a RAG, end to end')}\n"
    "  ${THEME_TOGGLE_HTML}\n"
    "  ${UNDO_BUTTON_HTML}\n",
    template_raw,
    count=1,
)


def escape_tpl(s: str) -> str:
    placeholders: list[str] = []

    def keep(m: re.Match[str]) -> str:
        placeholders.append(m.group(0))
        return f"__KEEP_{len(placeholders) - 1}__"

    s = re.sub(
        r"\$\{(?:exerciseBrandHtml\(12, [^}]+\)|THEME_TOGGLE_HTML|UNDO_BUTTON_HTML)\}",
        keep,
        s,
    )
    s = s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    for i, p in enumerate(placeholders):
        s = s.replace(f"__KEEP_{i}__", p)
    return s


TEMPLATE = escape_tpl(template_raw)

script = html[html.index("<script>") + 8 : html.rindex("</script>")]

script = re.sub(
    r"/\* ============ SETUP \(for the instructor\) ============.*?const CONFIG = \{.*?\};\n\n",
    "",
    script,
    flags=re.S,
)

script = re.sub(
    r"/\* ============ Models that write the answer ============ \*/\nconst PROVIDERS = \{.*?\};\n",
    "/* Models from catalog */\nlet PROVIDERS = {};\n",
    script,
    flags=re.S,
)

script = script.replace(
    "const DEFAULTS = {temp:0.2, topp:1, cap:400};",
    "let DEFAULTS = {temp:0.2, topp:1, cap:400};",
)
script = script.replace("const EXAMPLE_DOC =", "let EXAMPLE_DOC =")
script = script.replace("const EXAMPLE_TESTS =", "let EXAMPLE_TESTS =")
script = script.replace("const DEFAULT_TEMPLATE =", "let DEFAULT_TEMPLATE =")
script = script.replace("const QUERY_EXAMPLES =", "let QUERY_EXAMPLES =")
script = script.replace("const EMBEDDERS =", "let EMBEDDERS =")
script = script.replace("const STAGES =", "let STAGES =")

script = re.sub(
    r"let TJS=null, EXTRACTOR=null;\nfunction extractor\(onProgress\)\{.*?\n\}\n",
    "",
    script,
    flags=re.S,
)

script = script.replace(
    "const connected = () => !!(CONFIG.proxyUrl.trim() || CONFIG.testKeys[S.prov]);",
    "const connected = () => true;",
)

script = script.replace(
    "const P = () => PROVIDERS[S.prov];",
    "const P = () => PROVIDERS[S.prov] || PROVIDERS[defaultProv] || Object.values(PROVIDERS)[0] || {name:'Model',tempMax:2};",
)

EMBED_FN = r"""async function embed(){
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
}"""

script = re.sub(r"async function embed\(\)\{.*?\n\}", EMBED_FN, script, count=1, flags=re.S)

RETRIEVE_FN = r"""async function retrieve(q){
  q=(q??S.query).trim(); if(!q) return null;
  if(!(await ensureEmbedded())) return null;
  const list=chunks().list;
  const out=await runBuildRagRetrieve(sessionId, projectId, {
    chunks:list, query:q, model:S.model||S.emb.kind||"minilm", k:S.k, minScore:S.minScore, vecs:S.emb.vecs
  });
  return {q, ranked:out.ranked||[], embSig:S.emb.sig, qpt:out.qpt||null};
}"""

script = re.sub(r"async function retrieve\(q\)\{.*?\n\}", RETRIEVE_FN, script, count=1, flags=re.S)

script = re.sub(r"async function post\(url,headers,body,signal\)\{.*?\n\}\n", "", script, flags=re.S)
script = re.sub(r"async function callModel\(userText,signal,retry\)\{.*?\n\}\n", "", script, flags=re.S)

ASK_FN = r"""async function ask(){
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
}"""

script = re.sub(r"async function ask\(\)\{.*?\n\}", ASK_FN, script, count=1, flags=re.S)

EVAL_FN = r"""async function runEval(){
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
}"""

script = re.sub(r"async function runEval\(\)\{.*?\n\}", EVAL_FN, script, count=1, flags=re.S)

script = script.replace(
    "esc(PROVIDERS[g.prov].name)",
    "esc((PROVIDERS[g.prov]||P()).name)",
)

script = script.replace(
    'const off=document.body.classList.toggle("nopy");',
    'const off=host.classList.toggle("nopy");',
)

script = script.replace("const $ = s => document.querySelector(s);\n", "")
script = script.replace("const $$ = s => [...document.querySelectorAll(s)];\n", "")

for ev in (
    "input",
    "change",
    "click",
    "mouseover",
    "mouseout",
    "mousemove",
    "keydown",
    "dragover",
    "dragleave",
    "drop",
):
    script = script.replace(
        f'document.addEventListener("{ev}"',
        f'host.addEventListener("{ev}"',
    )

script = re.sub(
    r"/\* ============ Start ============ \*/.*?renderAll\(\);\s*$",
    "",
    script,
    flags=re.S,
)

script = script.replace(
    'function toggleFs(){ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(()=>toast("Full screen isn\'t available in this browser")); }',
    "function toggleFs(){ /* bindHostFullscreen owns the button */ }",
)

script = script.replace(
    "if(!connected()){ goStage(6); pulseNode(6); toast(`The prompt is ready. ${esc(P().name)} isn't connected on this page yet, so the run stops here. Ask your instructor.`); throw 0; }\n    await hop(6);",
    "await hop(6);",
)

# mapBox may use S.emb.map.proj — backend map only has pts/mean/dirs. Patch map usage for qpt.
# HTML: S.emb.map.proj(qv) was client-side; retrieve now returns qpt. mapBox uses map.pts.
# pca2 still exists for unused path — leave it.

HEADER = f"""/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import {{
  loadBuildRagCatalog,
  runBuildRagEmbed,
  runBuildRagRetrieve,
  runBuildRagGenerate,
  runBuildRagEvaluate,
  type BuildRagCatalog,
}} from './api';
import {{ THEME_TOGGLE_HTML, bindExerciseTheme }} from '../../../theme';
import {{ cloneState, createUndoStack, syncUndoButton, UNDO_BUTTON_HTML }} from '../../../undoHistory';
import {{ exerciseBrandHtml }} from '../../../exerciseHeaderIcons';
import {{ bindHostFullscreen }} from '../../../fullscreen';

export interface MountOptions {{
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}}

const TEMPLATE = `{TEMPLATE}`;

export function mountExercise12(host: HTMLElement, opts: MountOptions): () => void {{
  const {{ sessionId, projectId, onComplete }} = opts;
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const unbindTheme = bindExerciseTheme(host);

  const $ = (s: string) => host.querySelector(s) as any;
  const $$ = (s: string) => [...host.querySelectorAll(s)] as any[];

  let catalog: BuildRagCatalog | null = null;
  let defaultProv = 'claude';
  let completed = false;
  let unbindFs: (() => void) | null = null;
  let aborted = false;

  function maybeComplete() {{
    if (completed || !onComplete) return;
    completed = true;
    onComplete();
  }}

"""

FOOTER = """
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
      defaultProv = catalog.defaults?.prov || catalog.models?.[0]?.id || 'claude';
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
  const onResize = () => { clearTimeout((window as any).__ex12rsT); (window as any).__ex12rsT = setTimeout(() => { scrollNodeIntoView(); }, 150); };

  void boot();

  return () => {
    aborted = true;
    S.ctrl?.abort();
    S.evalCtrl?.abort();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', renderFs);
    unbindFs?.();
    unbindTheme();
    host.innerHTML = '';
    host.classList.remove('is-booting', 'nopy');
  };
}
"""

# The prototype uses bare `addEventListener("resize"...` — leave it; cleanup tries to remove our onResize which isn't attached.
# Replace the bare resize listener to use a named handler we can remove.
script = re.sub(
    r'let rsT=null; addEventListener\("resize",\(\)=>\{ clearTimeout\(rsT\); rsT=setTimeout\(\(\)=>\{ scrollNodeIntoView\(\); \},150\); \}\);',
    'let rsT=null; const onWinResize=()=>{ clearTimeout(rsT); rsT=setTimeout(()=>{ scrollNodeIntoView(); },150); }; window.addEventListener("resize", onWinResize);',
    script,
)

FOOTER = FOOTER.replace(
    "window.removeEventListener('resize', onResize);",
    "window.removeEventListener('resize', onWinResize);",
).replace(
    "  const onResize = () => { clearTimeout((window as any).__ex12rsT); (window as any).__ex12rsT = setTimeout(() => { scrollNodeIntoView(); }, 150); };\n\n",
    "",
)

# pushUndo is used in changed() before FOOTER defines it — in JS function declarations are hoisted for `function`,
# but const pushUndo is NOT hoisted. changed() only runs on user interaction after boot, so pushUndo exists by then.
# However changed() is called during renderAll before boot finishes pushUndo definition...
# Order in file: script (defines changed that calls pushUndo) then FOOTER (defines pushUndo).
# When changed() runs at runtime after boot, pushUndo exists. During startUi→renderAll→changed?, check if changed is called at init.
# protect with try/catch already.

out_text = HEADER + script + "\n" + FOOTER

OUT = ROOT / "frontend/components/Exercises/labs/exercise12/lib/mount.ts"
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(out_text, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")

# Sanity checks
for needle in (
    "mountExercise12",
    "runBuildRagEmbed",
    "runBuildRagGenerate",
    "runBuildRagEvaluate",
    "host.addEventListener(\"click\"",
    "Transformers",
    "CONFIG.",
    "document.querySelector",
):
    print(f"  {needle}: {needle in out_text}")
