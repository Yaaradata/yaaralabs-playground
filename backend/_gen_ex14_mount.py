"""Generate exercise14/lib/mount.ts from the AI ethics lab HTML prototype."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "exercise-14-ai-ethics-lab.html").read_text(encoding="utf-8")

body_start = html.index("<header>")
body_end = html.index('<div class="sr" aria-live="polite" id="live"></div>') + len(
    '<div class="sr" aria-live="polite" id="live"></div>'
)
template_raw = html[body_start:body_end]

template_raw = re.sub(
    r'<div class="brand"><span class="dot"></span><b>Exercise 14 · AI ethics lab</b></div>\n',
    "${exerciseBrandHtml(14, 'Exercise - 14 : AI ethics lab')}\n"
    "  ${THEME_TOGGLE_HTML}\n",
    template_raw,
    count=1,
)


def escape_tpl(s: str) -> str:
    placeholders: list[str] = []

    def keep(m: re.Match[str]) -> str:
        placeholders.append(m.group(0))
        return f"__KEEP_{len(placeholders) - 1}__"

    s = re.sub(
        r"\$\{(?:exerciseBrandHtml\(14, [^}]+\)|THEME_TOGGLE_HTML)\}",
        keep,
        s,
    )
    s = s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    for i, p in enumerate(placeholders):
        s = s.replace(f"__KEEP_{i}__", p)
    return s


TEMPLATE = escape_tpl(template_raw)

script = html[html.index("<script>") + 8 : html.rindex("</script>")]

# Drop instructor CONFIG / direct keys — Playground proxies every call.
script = re.sub(
    r"/\* ============ SETUP \(for the instructor\) ============.*?const CONFIG = \{.*?\};\n\n",
    "",
    script,
    flags=re.S,
)

script = re.sub(
    r"const PROVIDERS = \{.*?\};\nconst DEFAULTS = \{temp:0\.7, topp:1, cap:400\};\n",
    "let PROVIDERS = {};\nlet DEFAULTS = {temp:0.7, topp:1, cap:400};\nlet ETHICS_ENDPOINT = 'ethics/chat';\n",
    script,
    flags=re.S,
)

script = script.replace(
    "const connected = () => !!(CONFIG.proxyUrl.trim() || CONFIG.testKeys[S.prov]);",
    "const connected = () => Object.keys(PROVIDERS).length > 0;",
)
script = script.replace(
    "const connectedFor = k => !!(CONFIG.proxyUrl.trim() || CONFIG.testKeys[k]);",
    "const connectedFor = k => !!(PROVIDERS[k]);",
)
script = script.replace(
    "const P = () => PROVIDERS[S.prov];",
    "const P = () => PROVIDERS[S.prov] || PROVIDERS[defaultProv] || Object.values(PROVIDERS)[0] || {name:'Model', tempMax:2, model:'model'};",
)

# "useModelHTML" trips react-hooks/rules-of-hooks (name starts with "use").
script = script.replace("function useModelHTML(", "function modelUseNoteHTML(")
script = script.replace("useModelHTML(", "modelUseNoteHTML(")


# Replace low-level fetch + callModel with Playground ethics/chat.
script = re.sub(r"async function post\(url,headers,body,signal\)\{.*?\n\}\n", "", script, flags=re.S)

CALL_MODEL = r"""/* Builds the request body the Privacy case shows, and the body sent to the Playground. */
function buildRequest(opts){
  const prov=opts.prov||S.prov, p=PROVIDERS[prov]||P();
  const temp=Math.min(opts.temp??S.temp, p.tempMax??2), cap=opts.cap??S.cap, topp=opts.temp===0?1:S.topp;
  const messages=(opts.messages||[]).map(m=>({role:m.role, content:m.content}));
  const body={model:prov, system:opts.system||'', messages, temp, topp, cap};
  const url=`/api/exercises/.../${ETHICS_ENDPOINT}`;
  return {url, headers:{"content-type":"application/json"}, body, p, prov, ok:true};
}
async function callModel(opts,signal){
  const prov=opts.prov||S.prov, p=PROVIDERS[prov]||P();
  if(!PROVIDERS[prov]) throw new Error(`${p.name} isn't available in this lab yet. Pick another model at the top.`);
  const temp=Math.min(opts.temp??S.temp, p.tempMax??2), cap=opts.cap??S.cap, topp=opts.temp===0?1:S.topp;
  S.calls++; renderCalls();
  const t0=performance.now();
  try{
    const out=await runEthicsChat(sessionId, projectId, {
      system: opts.system||'',
      messages: opts.messages||[],
      model: prov,
      temp, topp, cap,
    }, signal);
    const text=(out.text||'').trim();
    if(!text) throw new Error("The model sent back no text (it may have stopped for safety reasons).");
    return {text, ms: out.ms ?? (performance.now()-t0), simulated: !!out.simulated};
  }catch(e){
    if(e && (e.name==="AbortError" || e.message==="Stopped.")) throw new Error("Stopped.");
    throw e;
  }
}
"""

script = re.sub(
    r"/\* opts: \{system, messages:\[\{role:\"user\"\|\"assistant\", content\}\], cap, temp\} \*/.*?async function callModel\(opts,signal,retry\)\{.*?\n\}\n",
    CALL_MODEL,
    script,
    flags=re.S,
)

# Scope DOM helpers and listeners to the host element.
script = script.replace("const $ = s => document.querySelector(s);\n", "")
script = script.replace("const $$ = s => [...document.querySelectorAll(s)];\n", "")

for ev in ("input", "change", "click", "keydown", "fullscreenchange"):
    script = script.replace(
        f'document.addEventListener("{ev}"',
        f'host.addEventListener("{ev}"',
    )

# Fullscreen is owned by bindHostFullscreen.
script = script.replace(
    'function toggleFs(){ if(document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(()=>toast("Full screen isn\'t available in this browser")); }',
    "function toggleFs(){ /* bindHostFullscreen owns the button */ }",
)
script = script.replace(
    "function renderFs(){ const on=!!document.fullscreenElement, b=$(\"#fsBtn\"); b.innerHTML=on?IC.fsOff:IC.fsOn; b.title=on?\"Exit full screen\":\"Full screen\"; }",
    "function renderFs(){ /* bindHostFullscreen owns the button */ }",
)

# Drop the prototype's own start block — boot() in the footer owns init.
script = re.sub(
    r"/\* ============ Start ============ \*/.*?renderCalls\(\);\n\n",
    "",
    script,
    flags=re.S,
)
script = re.sub(
    r"/\* ============ Start the lab ============ \*/\nrenderCases\(\);.*$",
    "",
    script,
    flags=re.S,
)

# Guard PROVIDERS lookups when a model id is missing after catalog load.
script = script.replace(
    "esc(PROVIDERS[m].name)",
    "esc((PROVIDERS[m]||{name:m}).name)",
)
script = script.replace(
    "PROVIDERS[m].name",
    "(PROVIDERS[m]||{name:m}).name",
)

HEADER = f"""/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any */
// @ts-nocheck
import {{
  loadEthicsCatalog,
  runEthicsChat,
  type EthicsCatalog,
}} from './api';
import {{ THEME_TOGGLE_HTML, bindExerciseTheme }} from '../../../theme';
import {{ exerciseBrandHtml }} from '../../../exerciseHeaderIcons';
import {{ bindHostFullscreen }} from '../../../fullscreen';

export interface MountOptions {{
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}}

const TEMPLATE = `{TEMPLATE}`;

export function mountExercise14(host: HTMLElement, opts: MountOptions): () => void {{
  const {{ sessionId, projectId, onComplete }} = opts;
  host.classList.add('is-booting');
  host.innerHTML = TEMPLATE;
  const unbindTheme = bindExerciseTheme(host);

  const $ = (s: string) => host.querySelector(s) as any;
  const $$ = (s: string) => [...host.querySelectorAll(s)] as any[];

  let catalog: EthicsCatalog | null = null;
  let defaultProv = 'claude';
  let completed = false;
  let unbindFs: (() => void) | null = null;
  let aborted = false;

  function maybeComplete() {{
    if (completed || !onComplete) return;
    // Mark complete once the student has run at least two different cases.
    const ran = [
      typeof PT !== 'undefined' && PT.res,
      typeof B !== 'undefined' && B.res,
      typeof PV !== 'undefined' && PV.reply && !PV.reply.error,
      typeof H !== 'undefined' && H.runs.length,
      typeof R !== 'undefined' && R.res,
    ].filter(Boolean).length;
    if (ran < 2) return;
    completed = true;
    onComplete();
  }}

"""

FOOTER = """
  function startUi() {
    $('#settingsBtn').innerHTML = IC.gear;
    unbindFs = bindHostFullscreen(host, $('#fsBtn'));
    const sel = $('#provSel') as HTMLSelectElement;
    if (sel) {
      sel.innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${(p as any).name}</option>`).join('');
      sel.value = S.prov;
    }
    fillSettings();
    renderCases();
    renderPtList();
    renderPtOut();
    renderBiasLeft();
    renderBiasOut();
    renderPrivacy();
    renderPvReply();
    renderHList();
    renderHOut();
    renderRList();
    renderROut();
    renderCalls();
    host.classList.remove('is-booting');
  }

  async function boot() {
    try {
      catalog = await loadEthicsCatalog(sessionId, projectId);
      if (aborted) return;
      PROVIDERS = Object.fromEntries(
        (catalog.models || []).map((m) => [
          m.id,
          {
            name: m.name,
            short: m.short || m.name,
            vendor: m.vendor,
            model: m.model || m.defaultVersion || m.id,
            tempMax: m.tempMax ?? 2,
            endpoint: catalog.endpoint || 'ethics/chat',
          },
        ]),
      );
      defaultProv = catalog.defaults?.prov || catalog.models?.[0]?.id || 'claude';
      DEFAULTS = {
        temp: catalog.defaults?.temp ?? 0.7,
        topp: catalog.defaults?.topp ?? 1,
        cap: catalog.defaults?.cap ?? 400,
      };
      ETHICS_ENDPOINT = catalog.endpoint || 'ethics/chat';
      S.prov = defaultProv;
      S.temp = DEFAULTS.temp;
      S.topp = DEFAULTS.topp;
      S.cap = DEFAULTS.cap;
      // Prefer catalog examples when present (keeps FE/BE in sync).
      const ex = catalog.examples || {};
      if (ex.pressure?.questions?.length) {
        /* keep prototype EX_* as fallbacks; Example buttons still use local constants */
      }
      startUi();
    } catch (e: any) {
      host.classList.remove('is-booting');
      toast(esc(e?.message || 'Could not load the ethics lab.'));
    }
  }

  // Completion hook: after any successful case run settles.
  host.addEventListener('click', (e: any) => {
    const a = e.target?.closest?.('[data-act]');
    if (!a) return;
    const act = a.dataset?.act;
    if (['ptRun', 'bRun', 'pvSend', 'hRun', 'rRun'].includes(act)) {
      setTimeout(() => { try { maybeComplete(); } catch (_e) {} }, 1200);
    }
  });

  void boot();

  return () => {
    aborted = true;
    try { PT.ctrl?.abort(); } catch (_e) {}
    try { B.ctrl?.abort(); } catch (_e) {}
    try { PV.ctrl?.abort(); } catch (_e) {}
    try { H.ctrl?.abort(); } catch (_e) {}
    try { R.ctrl?.abort(); } catch (_e) {}
    unbindFs?.();
    unbindTheme();
    host.innerHTML = '';
    host.classList.remove('is-booting');
  };
}
"""

out_text = HEADER + script + "\n" + FOOTER

OUT = ROOT / "frontend/components/Exercises/labs/exercise14/lib/mount.ts"
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(out_text, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")

for needle in (
    "mountExercise14",
    "runEthicsChat",
    "host.addEventListener(\"click\"",
    "CONFIG.",
    "document.querySelector",
    "callModel",
    "buildRequest",
):
    print(f"  {needle}: {needle in out_text}")
