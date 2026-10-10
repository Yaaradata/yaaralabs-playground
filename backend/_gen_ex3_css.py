"""Generate scoped exercise3.css from the confusion-matrix HTML prototype."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "exercise-3-confusion-matrix.html").read_text(encoding="utf-8")
raw = html[html.index("<style>") + 7 : html.index("</style>")]
ROOT_SEL = ".ex3-root"
PREFIX = "ex3-"
ANIMS = ("inNext", "inPrev", "invite", "nudge", "shake", "bump", "beat", "fly", "pop")


def map_piece(piece: str) -> str:
    s = piece.strip()
    if not s or s.startswith("@") or s.startswith(ROOT_SEL):
        return s
    if s in {":root", "html", "body"} or s.startswith("html"):
        return ROOT_SEL
    if s == "*":
        return f"{ROOT_SEL}, {ROOT_SEL} *"
    return f"{ROOT_SEL} {s}"


def prefix_selectors(sel: str) -> str:
    parts = [map_piece(piece) for piece in sel.split(",") if piece.strip()]
    # Drop duplicate root mappings from html,body.
    seen: list[str] = []
    for part in parts:
        if part not in seen:
            seen.append(part)
    return ", ".join(seen)


def prefix_anims(body: str) -> str:
    for anim in ANIMS:
        body = re.sub(
            rf"\banimation\s*:\s*([^{{;]*?)\b{anim}\b",
            lambda m, a=anim: m.group(0).replace(a, f"{PREFIX}{a}"),
            body,
        )
    return body


def scope_rules(css: str) -> str:
    out: list[str] = []
    i = 0
    n = len(css)
    while i < n:
        while i < n and css[i].isspace():
            i += 1
        if i >= n:
            break
        if css.startswith("/*", i):
            j = css.find("*/", i)
            if j < 0:
                break
            out.append(css[i : j + 2])
            i = j + 2
            continue
        if css.startswith("@keyframes", i):
            j = css.find("{", i)
            depth = 0
            k = j
            while k < n:
                if css[k] == "{":
                    depth += 1
                elif css[k] == "}":
                    depth -= 1
                    if depth == 0:
                        k += 1
                        break
                k += 1
            block = css[i:k]
            name = re.match(r"@keyframes\s+(\w+)", block)
            if name and not name.group(1).startswith(PREFIX):
                block = block.replace(
                    f"@keyframes {name.group(1)}",
                    f"@keyframes {PREFIX}{name.group(1)}",
                    1,
                )
            out.append(block)
            i = k
            continue
        if css.startswith("@media", i) or css.startswith("@supports", i):
            j = css.find("{", i)
            header = css[i:j]
            depth = 0
            k = j
            while k < n:
                if css[k] == "{":
                    depth += 1
                elif css[k] == "}":
                    depth -= 1
                    if depth == 0:
                        k += 1
                        break
                k += 1
            inner = css[j + 1 : k - 1]
            out.append(f"{header}{{{scope_rules(inner)}}}")
            i = k
            continue
        j = css.find("{", i)
        if j < 0:
            break
        sel = css[i:j].strip()
        depth = 0
        k = j
        while k < n:
            if css[k] == "{":
                depth += 1
            elif css[k] == "}":
                depth -= 1
                if depth == 0:
                    k += 1
                    break
            k += 1
        body = prefix_anims(css[j:k])
        if sel in {"html,body", "html", "body"}:
            body = body.replace("min-height:100vh", "min-height:0").replace("height:100vh", "height:100%")
        out.append(f"{prefix_selectors(sel)}{body}")
        i = k
    return "".join(out)


HEADER = f"""@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap");
{ROOT_SEL} {{
  height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden; position:relative;
  box-sizing:border-box; background:var(--bg); color:var(--tx);
  font:13.5px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}}
{ROOT_SEL} *, {ROOT_SEL} *::before, {ROOT_SEL} *::after {{ box-sizing:border-box; }}
{ROOT_SEL} button, {ROOT_SEL} input {{ font:inherit; color:inherit; }}
{ROOT_SEL} button {{ cursor:pointer; }}
{ROOT_SEL} button:disabled {{ cursor:not-allowed; opacity:.4; }}
{ROOT_SEL} button:focus-visible, {ROOT_SEL} input:focus-visible, {ROOT_SEL} .cell:focus-visible {{ outline:2px solid var(--li); outline-offset:2px; }}
{ROOT_SEL} svg {{ display:block; }}
{ROOT_SEL} ::selection {{ background:rgba(147,51,234,.45); }}
{ROOT_SEL} .boot {{
  display:none; position:absolute; inset:0; z-index:40; place-items:center; align-content:center;
  gap:12px; background:var(--bg); color:var(--mu); font-weight:600; font-size:14px;
}}
{ROOT_SEL}.is-booting .boot {{ display:grid; }}
{ROOT_SEL}.is-booting > header,
{ROOT_SEL}.is-booting > main {{ visibility:hidden; pointer-events:none; }}
{ROOT_SEL} .boot .spin {{
  width:22px; height:22px; border-radius:50%;
  border:2.5px solid rgba(219,254,135,.35);
  border-top-color:var(--li);
  animation:{PREFIX}boot-spin .7s linear infinite;
}}
@keyframes {PREFIX}boot-spin {{ to {{ transform:rotate(360deg); }} }}
{ROOT_SEL}:fullscreen, {ROOT_SEL}:-webkit-full-screen {{
  width:100%; height:100%; background:var(--bg);
}}
{ROOT_SEL} .ex-lab-brand-title {{
  margin:0; font-size:20px; font-weight:700; letter-spacing:-.025em; line-height:1.15;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}}
{ROOT_SEL} header .np-theme {{ flex:none; }}
"""

EXTRA = f"""
{ROOT_SEL} {{
  height:100%;
  max-height:100%;
  min-height:0 !important;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}}
{ROOT_SEL} > header {{ flex:none; }}
{ROOT_SEL} > main {{
  flex:1 1 auto;
  min-height:0;
  overflow:auto;
}}
{ROOT_SEL}[data-theme='light'] {{
  --bg:#f3f5f8; --s0:#ffffff; --s1:#ffffff; --s2:#eef1f6; --b1:#d5dce6; --b2:#c3ccd8;
  --tx:#152033; --mu:rgba(21,32,51,.78); --fa:rgba(21,32,51,.55); --fa2:rgba(21,32,51,.36);
  --pu:#9333EA; --li:#3f6b00; --bl:#1d4ed8; --am:#b45309; --bad:#dc2626;
  --tp:#3f6b00; --tn:#1d4ed8; --fp:#c2410c; --fn:#dc2626; --pr:#9333EA;
  color:var(--tx); background:var(--bg);
}}
{ROOT_SEL}[data-theme='light'] header {{ background:#ffffff !important; border-bottom-color:var(--b1); }}
{ROOT_SEL}[data-theme='light'] .card {{ background:#ffffff; }}
{ROOT_SEL}[data-theme='light'] .cell.tot {{ background:#f3f5f8; }}
{ROOT_SEL}[data-theme='light'] .stg,
{ROOT_SEL}[data-theme='light'] .lockcard {{
  background:#ffffff;
}}
{ROOT_SEL}[data-theme='light'] .stg {{
  background:radial-gradient(120% 80% at 100% 0%,rgba(147,51,234,.08),transparent 55%),radial-gradient(90% 70% at 0% 100%,rgba(63,107,0,.06),transparent 60%),#ffffff;
}}
{ROOT_SEL}[data-theme='light'] .go,
{ROOT_SEL}[data-theme='light'] .chead .n,
{ROOT_SEL}[data-theme='light'] .num.sel,
{ROOT_SEL}[data-theme='light'] .lv.cur .dot,
{ROOT_SEL}[data-theme='light'] .circ.go2:not(:disabled),
{ROOT_SEL}[data-theme='light'] .win .ck,
{ROOT_SEL}[data-theme='light'] .sh .big,
{ROOT_SEL}[data-theme='light'] .opt.yes {{
  background:#dbfe87; color:#010101; border-color:#dbfe87;
}}
{ROOT_SEL}[data-theme='light'] .stg.won .sh .big {{
  background:rgba(63,107,0,.12); color:#3f6b00; border-color:rgba(63,107,0,.45);
}}
{ROOT_SEL}[data-theme='light'] .ghost {{ color:#010101; }}
@media (max-width:1100px){{
  {ROOT_SEL} > main{{
    display:flex;
    flex-direction:column;
    overflow:auto;
  }}
  {ROOT_SEL} #cScen,
  {ROOT_SEL} #cMatrix,
  {ROOT_SEL} #cMetrics{{
    flex:none;
    min-height:auto;
    width:100%;
  }}
}}
@media (max-width:720px){{
  {ROOT_SEL} header{{
    height:auto;
    min-height:56px;
    flex-wrap:wrap;
    padding:8px 12px 10px;
    row-gap:8px;
  }}
  {ROOT_SEL} header .brand{{
    flex:1 1 100%;
    margin-right:0;
  }}
  {ROOT_SEL} .ex-lab-brand-title{{
    white-space:normal;
    overflow:visible;
    text-overflow:unset;
    font-size:16px;
  }}
}}
{ROOT_SEL} .map{{overflow-x:auto}}
{ROOT_SEL} .pips{{display:flex;gap:6px;flex:none}}
{ROOT_SEL} .pips i{{width:8px;height:8px;border-radius:50%;background:var(--b2);display:block}}
{ROOT_SEL} .pips i.on,{ROOT_SEL} .pips i.cur{{background:var(--li)}}
{ROOT_SEL} .rapid-q{{margin:2px 0 0;font-size:15.5px;line-height:1.45;color:var(--tx)}}
{ROOT_SEL} .opts.words .opt{{font-family:inherit;font-size:14px;font-weight:700;letter-spacing:-.01em;padding:14px 8px}}
{ROOT_SEL} .rapid-list{{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}}
{ROOT_SEL} .rapid-list li{{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border:1px solid var(--b1);border-radius:12px;background:var(--s0)}}
{ROOT_SEL} .rapid-list b{{display:block;color:var(--li);font-size:13px}}
{ROOT_SEL} .rapid-list span{{color:var(--mu);font-size:12.5px}}
{ROOT_SEL} .rapid-list .ck{{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--li);color:#010101;font-weight:800;font-size:12px}}
"""

OUT = ROOT / "frontend/components/Exercises/labs/exercise3/exercise3.css"
scoped = scope_rules(raw)
scoped = scoped.replace("min-height:100vh", "min-height:0").replace("height:100vh", "height:100%")
OUT.write_text(HEADER + scoped + EXTRA, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
