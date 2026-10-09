"""Generate scoped exercise11.css from the RAG HTML prototype."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / "exercise-11-rag-chatbot.html").read_text(encoding="utf-8")
raw = html[html.index("<style>") + 7 : html.index("</style>")]

SKIP = {
    ":root",
    "html,body",
    "*{",
    "body{",
    "button,input",
    "button{cursor",
    "button:disabled",
    "::selection",
    "::-webkit-scrollbar",
}


def prefix_selectors(sel: str, root: str = ".ex11-root") -> str:
    parts = []
    for piece in sel.split(","):
        s = piece.strip()
        if not s:
            continue
        if s.startswith("@") or s.startswith(root):
            parts.append(s)
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
            if name and not name.group(1).startswith("ex11-"):
                block = block.replace(f"@keyframes {name.group(1)}", f"@keyframes ex11-{name.group(1)}", 1)
            out.append(block)
            i = k
            continue
        if css.startswith("@media", i):
            j = css.find("{", i)
            depth = 0
            k = j + 1
            start_inner = k
            while k < n:
                if css[k] == "{":
                    depth += 1
                elif css[k] == "}":
                    if depth == 0:
                        inner = css[start_inner:k]
                        out.append(css[i : j + 1] + scope_rules(inner) + "}")
                        k += 1
                        break
                    depth -= 1
                k += 1
            i = k
            continue
        j = css.find("{", i)
        if j < 0:
            out.append(css[i:])
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
        body = css[j + 1 : k - 1]
        if any(sel.startswith(s) for s in SKIP):
            i = k
            continue
        if sel.startswith(":root"):
            i = k
            continue
        for anim in ("fadein", "flash", "shimmer", "dl"):
            body = re.sub(rf"\b{anim}\b", f"ex11-{anim}", body)
        out.append(f"{prefix_selectors(sel)}{{{body}}}")
        i = k
    return "".join(out)


header = """@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap");
.ex11-root {
  --bg:#1c1c1c; --s0:#222222; --s1:#2a2a2a; --s2:#313131; --b1:#3a3a3a; --b2:#4a4a4a;
  --pu:#bc6cd3; --li:#dcfc84; --bl:#8fb8ff; --am:#ffc36b; --tx:#ffffff; --mu:rgba(255,255,255,.76); --fa:rgba(255,255,255,.5); --fa2:rgba(255,255,255,.3);
  --bad:#ff6b6b; --mono:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden; position:relative;
  box-sizing:border-box; background:var(--bg); color:var(--tx);
  font:13.5px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.ex11-root *, .ex11-root *::before, .ex11-root *::after { box-sizing:border-box; }
.ex11-root button, .ex11-root input, .ex11-root select, .ex11-root textarea { font:inherit; color:inherit; }
.ex11-root button { cursor:pointer; }
.ex11-root button:disabled { cursor:not-allowed; opacity:.4; }
.ex11-root button:focus-visible, .ex11-root select:focus-visible, .ex11-root textarea:focus-visible, .ex11-root input:focus-visible { outline:2px solid var(--li); outline-offset:2px; }
.ex11-root svg { display:block; }
.ex11-root ::selection { background:rgba(188,108,211,.45); }
.ex11-root .boot{
  display:none; position:absolute; inset:0; z-index:40; place-items:center; align-content:center;
  gap:12px; background:var(--bg); color:var(--mu); font-weight:600; font-size:14px;
}
.ex11-root.is-booting .boot{display:grid}
.ex11-root.is-booting > header,
.ex11-root.is-booting > main{visibility:hidden; pointer-events:none}
.ex11-root .boot .spin{
  width:22px; height:22px; border-radius:50%;
  border:2.5px solid rgba(220,252,132,.35);
  border-top-color:var(--li);
  animation:ex11-spin .7s linear infinite;
}
@keyframes ex11-spin{to{transform:rotate(360deg)}}
.ex11-root .modal[hidden]{display:none !important;}
"""

scoped = scope_rules(raw)
scoped = scoped.replace(".ex11-root .modal{position:fixed;", ".ex11-root .modal{position:absolute;")
scoped = scoped.replace(".ex11-root #toasts{position:fixed;", ".ex11-root #toasts{position:absolute;")
scoped = scoped.replace(
    "@media (min-width:1181px) and (min-height:620px){.ex11-root body{height:100vh;overflow:hidden;display:flex;flex-direction:column}",
    "@media (min-width:1181px) and (min-height:620px){.ex11-root{height:100%;overflow:hidden;display:flex;flex-direction:column}",
)
scoped = re.sub(r"\.ex11-root body\{", ".ex11-root{", scoped)
scoped = scoped.replace("animation:fadein", "animation:ex11-fadein")
scoped = scoped.replace("animation:flash", "animation:ex11-flash")
scoped = scoped.replace("animation:shimmer", "animation:ex11-shimmer")
scoped = scoped.replace("animation:dl", "animation:ex11-dl")

out = ROOT / "frontend/components/Exercises/labs/exercise11/exercise11.css"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(header + scoped, encoding="utf-8")
print("wrote", out, out.stat().st_size)
