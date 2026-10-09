"""Generate exercise10/lib/mount.ts from the HTML prototype."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "exercise-10-hit-the-limit.html").read_text(encoding="utf-8")

body_start = html.index("<header>")
body_end = html.index('<div id="toasts"></div>') + len('<div id="toasts"></div>')
template = html[body_start:body_end]
template = template.replace('class="beaker over"', 'class="beaker"')  # avoid invalid class in template

script = html[html.index("<script>") + 8 : html.rindex("</script>")]
# Drop instructor CONFIG / PROVIDERS / static catalog
script = re.sub(r"/\* ============ SETUP.*?const CONFIG = \{.*?\};", "", script, flags=re.S)
script = re.sub(r"/\* ============ Models ============ \*/.*?const LIMITS = \[.*?\];", "", script, flags=re.S)
script = re.sub(r"const DEFAULTS = \{.*?\};", "", script, flags=re.S)
script = re.sub(r"const MSG_OVERHEAD = .*?;", "", script, flags=re.S)
script = re.sub(r"const SAMPLE_SYS = `.*?`;", "", script, flags=re.S)
script = re.sub(r"const SAMPLE_LONG = `.*?`;", "", script, flags=re.S)
script = re.sub(r"const MSG_EXAMPLES = \[.*?\];", "", script, flags=re.S)
script = re.sub(r"const COMPACT_SYS = `.*?`;", "", script, flags=re.S)
script = re.sub(r"/\* ============ Start ============ \*/.*?renderAll\(false\);\s*$", "", script, flags=re.S)

# Replace callModel with backend API version
call_model_ts = r"""
async function callModel(system: string, turns: { role: string; text: string }[], cap: number, signal?: AbortSignal, onRetry?: (n: number) => void){
  void onRetry;
  const out = await runLimitChat(sessionId, projectId, {
    system,
    turns: turns.map((t) => ({ role: t.role as 'user' | 'assistant', text: t.text })),
    model: S.prov,
    temp: Math.min(S.temp, P().tempMax),
    topp: S.topp,
    cap,
  }, signal);
  return { text: out.text, inTok: out.inTok };
}
"""
script = re.sub(r"async function callModel\(system, turns, cap, signal, onRetry, retry\)\{.*?\n\}", call_model_ts.strip(), script, flags=re.S)

script = script.replace("const connected = () => !!(CONFIG.proxyUrl.trim() || CONFIG.testKeys[S.prov]);", "const connected = () => true;")
script = script.replace("if(!connected()){ toast(`${esc(P().name)} isn't connected on this page yet. Ask your instructor.`); return; }", "")
script = script.replace("if(!connected()){ toast(`${esc(P().name)} isn't connected on this page yet. Ask your instructor.`); return; }", "")

# compact uses separate endpoint
compact_call = """
  try{
    const out=await runLimitCompact(sessionId, projectId, {
      transcript,
      model: S.prov,
      temp: Math.min(S.temp, P().tempMax),
      topp: S.topp,
      cap: Math.min(S.cap, 300),
    });
    const text=(out.text||"").trim();
"""
script = re.sub(
    r"try\{\s*const out=await callModel\(COMPACT_SYS, \[\{role:\"user\",text:\"Conversation to summarise:\\n\\n\"\+transcript\}\], Math\.min\(S\.cap,300\), undefined, null\);",
    compact_call.strip(),
    script,
)

# Scope queries to host
script = script.replace("const $ = s => document.querySelector(s);", "")
script = script.replace("const $$ = s => [...document.querySelectorAll(s)];", "")

# P() uses models map
script = script.replace(
    "const P = () => PROVIDERS[S.prov];",
    "const P = () => models[S.prov] || models[defaultProv] || Object.values(models)[0];",
)

# MSG_OVERHEAD from catalog
script = "let MSG_OVERHEAD = 4;\n" + script

header = """import {
  loadLimitCatalog,
  runLimitChat,
  runLimitCompact,
  type LimitCatalog,
  type LimitModel,
} from './api';

export interface MountOptions {
  sessionId: string;
  projectId: string;
  onComplete?: () => void;
}

"""

footer_init = """
  host.innerHTML = TEMPLATE;
  host.classList.add('is-booting');

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T | null;
  const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...host.querySelectorAll(sel)] as T[];

  void boot();
  return () => {
    aborted = true;
    S.ctrl?.abort();
    if (elapsedTimer) clearInterval(elapsedTimer);
    host.innerHTML = '';
    host.classList.remove('is-booting');
  };
}
"""

# Wrap script inside mount function
inner = script
inner = inner.replace("let UID=1;", "let UID = 1;\n  let aborted = false;\n  let markedComplete = false;\n  let LIMITS: number[] = [1000, 2000, 4000, 8000];\n  let SAMPLE_SYS = '';\n  let SAMPLE_LONG = '';\n  let MSG_EXAMPLES: string[] = [];\n  let models: Record<string, LimitModel> = {};\n  let defaultProv = 'gemini';\n  let elapsedTimer: ReturnType<typeof setInterval> | null = null;")
inner = inner.replace(
    "const S = {",
    "const S: {\n    prov: string; temp: number; topp: number; cap: number; limit: number; keep: number;\n    msgs: Array<{ id: number; role: string; text: string; state: string; open?: boolean; retry?: boolean }>;\n    summary: { text: string; ids: number[]; before: number; after: number } | null;\n    running: boolean; compacting: boolean; pending: { t0: number; note?: string } | null;\n    ctrl: AbortController | null;\n    lastCall: { est: number; real: number } | null;\n    personaOpen: boolean; showSummed: boolean;\n  } = {",
)

# Add boot + maybeComplete in ask success
inner = inner.replace(
    'announce("Reply received.");',
    'announce("Reply received.");\n    maybeComplete();',
)
inner += """
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
      SAMPLE_SYS = cat.sample.sys;
      SAMPLE_LONG = cat.sample.longText;
      MSG_EXAMPLES = cat.sample.messages;
      MSG_OVERHEAD = cat.msgOverhead;
      models = Object.fromEntries(cat.models.map((m) => [m.id, m]));
      defaultProv = cat.defaults.prov;
      S.prov = cat.defaults.prov;
      S.limit = cat.defaults.limit;
      S.keep = cat.defaults.keep;
      S.temp = cat.defaults.temp;
      S.topp = cat.defaults.topp;
      S.cap = cat.defaults.cap;
      if ($('#provSel')) {
        $('#provSel')!.innerHTML = cat.models.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
        ($('#provSel') as HTMLSelectElement).value = S.prov;
      }
      if ($('#msg')) ($('#msg') as HTMLTextAreaElement).placeholder = MSG_EXAMPLES[0] || '';
      renderAll(false);
      host.classList.remove('is-booting');
    } catch (e) {
      toast(esc(e instanceof Error ? e.message : 'Could not load lab'));
      host.classList.remove('is-booting');
    }
  }
"""

# document listeners -> host where appropriate
inner = inner.replace("document.addEventListener(", "host.addEventListener(")
inner = inner.replace("document.addEventListener('fullscreenchange',renderFs);", "document.addEventListener('fullscreenchange', renderFs);")
inner = inner.replace("window.addEventListener('resize',()=>{ renderMeter(); sizeMsg(); });", "window.addEventListener('resize', onResize);")
inner += "\n  function onResize(){ renderMeter(); sizeMsg(); }\n"

# Start block from HTML -> in boot
inner = re.sub(r'\$\("#settingsBtn"\)\.innerHTML=IC\.gear;.*?renderAll\(false\);', '', inner, flags=re.S)

template_escaped = template.replace('`', '\\`').replace('${', '\\${')

mount = (
    header
    + f"const TEMPLATE = `{template_escaped}`;\n\n"
    + "export function mountExercise10(host: HTMLElement, opts: MountOptions): () => void {\n"
    + "  const { sessionId, projectId, onComplete } = opts;\n"
    + inner
    + footer_init
)

out = ROOT / "frontend/components/Exercises/labs/exercise10/lib/mount.ts"
out.write_text(mount, encoding="utf-8")
print("wrote", out, out.stat().st_size)
