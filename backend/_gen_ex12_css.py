"""Generate scoped exercise12.css from the Exercise 12 Build-a-RAG HTML prototype."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "exercise-12-build-a-rag.html").read_text(encoding="utf-8")
raw = html[html.index("<style>") + 7 : html.index("</style>")]
ROOT_SEL = ".ex12-root"
PREFIX = "ex12-"


def prefix_selectors(sel: str, root: str = ROOT_SEL) -> str:
    parts: list[str] = []
    for piece in sel.split(","):
        s = piece.strip()
        if not s:
            continue
        if s.startswith("@") or s.startswith(root):
            parts.append(s)
        elif s.startswith(":root"):
            parts.append(root)
        elif s.startswith("body.nopy") or s == "body.nopy":
            parts.append(s.replace("body.nopy", f"{root}.nopy", 1))
        elif s.startswith("body "):
            parts.append(f"{root} {s[5:].lstrip()}")
        elif s == "body":
            parts.append(root)
        else:
            parts.append(f"{root} {s}")
    return ", ".join(parts)


def scope_rules(css: str) -> str:
    out: list[str] = []
    i = 0
    n = len(css)
    while i < n:
        while i < n and css[i].isspace():
            i += 1
        if i >= n:
            break
        if css[i] == "/":
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
            scoped_inner = scope_rules(inner)
            out.append(f"{header}{{{scoped_inner}}}")
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
        body = css[j:k]
        if sel in ("html,body", "*") or sel.startswith("html") or sel == "body":
            i = k
            continue
        if sel == ":root":
            out.append(f"{ROOT_SEL}{body}")
            i = k
            continue
        body2 = body
        for anim in (
            "fadein",
            "flash",
            "shimmer",
            "dl",
            "spin",
            "ring",
            "spinA",
            "pop",
            "packet",
            "pulse",
            "rise",
            "fadeout",
            "rowin",
        ):
            body2 = re.sub(
                rf"\banimation\s*:\s*([^{{;]*?)\b{anim}\b",
                lambda m, a=anim: m.group(0).replace(a, f"{PREFIX}{a}"),
                body2,
            )
        out.append(f"{prefix_selectors(sel)}{body2}")
        i = k
    return "".join(out)


HEADER = f"""@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap");
{ROOT_SEL} {{
  height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden; position:relative;
  box-sizing:border-box; background:var(--bg); color:var(--tx);
  font:13.5px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}}
{ROOT_SEL} *, {ROOT_SEL} *::before, {ROOT_SEL} *::after {{ box-sizing:border-box; }}
{ROOT_SEL} button, {ROOT_SEL} input, {ROOT_SEL} select, {ROOT_SEL} textarea {{ font:inherit; color:inherit; }}
{ROOT_SEL} button {{ cursor:pointer; }}
{ROOT_SEL} button:disabled {{ cursor:not-allowed; opacity:.4; }}
{ROOT_SEL} button:focus-visible, {ROOT_SEL} select:focus-visible, {ROOT_SEL} textarea:focus-visible, {ROOT_SEL} input:focus-visible {{ outline:2px solid var(--li); outline-offset:2px; }}
{ROOT_SEL} svg {{ display:block; }}
{ROOT_SEL} ::selection {{ background:rgba(188,108,211,.45); }}
{ROOT_SEL} .boot{{
  display:none; position:absolute; inset:0; z-index:40; place-items:center; align-content:center;
  gap:12px; background:var(--bg); color:var(--mu); font-weight:600; font-size:14px;
}}
{ROOT_SEL}.is-booting .boot{{display:grid}}
{ROOT_SEL}.is-booting > header,
{ROOT_SEL}.is-booting > main{{visibility:hidden; pointer-events:none}}
{ROOT_SEL} .boot .spin{{
  width:22px; height:22px; border-radius:50%;
  border:2.5px solid rgba(220,252,132,.35);
  border-top-color:var(--li);
  animation:{PREFIX}boot-spin .7s linear infinite;
}}
@keyframes {PREFIX}boot-spin{{to{{transform:rotate(360deg)}}}}
{ROOT_SEL} .modal{{position:absolute;}}
{ROOT_SEL} #toasts{{position:absolute;}}
"""

EXTRA = f"""
{ROOT_SEL}.nopy main{{grid-template-columns:minmax(0,1fr)}}
{ROOT_SEL}.nopy .py{{display:none}}
@media (min-width:1181px) and (min-height:620px){{
  {ROOT_SEL}{{overflow:hidden}}
  {ROOT_SEL} main{{flex:1;min-height:0}}
}}
{ROOT_SEL}{{
  height:100%;
  max-height:100%;
  min-height:0 !important;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}}
{ROOT_SEL} > header{{flex:none}}
{ROOT_SEL} > main{{
  flex:1 1 auto;
  min-height:0;
  overflow:hidden;
}}
"""

scoped = scope_rules(raw)
scoped = scoped.replace(f"{ROOT_SEL} .modal{{position:fixed;", f"{ROOT_SEL} .modal{{position:absolute;")
scoped = scoped.replace(f"{ROOT_SEL} #toasts{{position:fixed;", f"{ROOT_SEL} #toasts{{position:absolute;")
scoped = re.sub(rf"{re.escape(ROOT_SEL)} body\{{", f"{ROOT_SEL}{{", scoped)

OUT = ROOT / "frontend/components/Exercises/labs/exercise12/exercise12.css"
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(HEADER + scoped + EXTRA, encoding="utf-8")
print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")
