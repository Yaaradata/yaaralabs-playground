"""
One arrangement for every laptop and monitor: in Tailwind class strings, layout utilities that switch
at lg / xl / 2xl (1024 / 1280 / 1536 px) take the value they have on a 1920 px screen and apply it
from md (768 px). So a page on a 1280, 1366 or 1536 px laptop has the same columns as on 1920; it is
smaller, not rearranged. Below 768 px (phones) the mobile layout stays.

  "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" -> "grid gap-4 md:grid-cols-4"
  "lg:sticky lg:top-24"                                     -> "md:sticky md:top-24"

Only layout utilities move (columns, spans, display, position, sizes of panels, overflow, borders
between panes, wrapping). Spacing such as lg:px-8 is left alone: the fluid root size scales it.
Usage (from frontend/):  python scripts/tw-desktop-from-md.py <file.tsx> ...
"""

import re
import sys

BPS = ["sm", "md", "lg", "xl", "2xl"]  # min-width 640, 768, 1024, 1280, 1536
ACTIVE_AT_1920 = set(BPS)
LAYOUT = re.compile(
    r"^(grid-cols|grid-rows|col-span|row-span|flex-row|flex-col|flex-wrap|flex-nowrap|hidden|block|flex|grid|inline-flex|inline-block|"
    r"sticky|static|relative|absolute|fixed|top|bottom|left|right|max-h|min-h|h|w|max-w|min-w|overflow-y|overflow-x|overflow|"
    r"border-r|border-l|border-b|border-t|whitespace|order|items|justify|self|basis|grow|shrink)(-|$)"
)
# utilities that are alternatives of each other (only one may win)
GROUPS = {
    "display": {"hidden", "block", "flex", "grid", "inline-flex", "inline-block"},
    "position": {"sticky", "static", "relative", "absolute", "fixed"},
    "flexdir": {"flex-row", "flex-col"},
    "wrap": {"flex-wrap", "flex-nowrap"},
}


def key_of(util: str) -> str:
    for name, members in GROUPS.items():
        if util in members:
            return name
    m = LAYOUT.match(util)
    if not m:
        return ""
    base = m.group(1)
    # border-r vs border-r-0 are the same property
    return base


def convert(classes: str) -> str:
    tokens = classes.split()
    by_key: dict[str, list[tuple[int, str, str]]] = {}
    for i, t in enumerate(tokens):
        m = re.fullmatch(r"(?:(sm|md|lg|xl|2xl):)?(-?[\w\[\]/.%()#,:+-]+)", t)
        if not m:
            continue
        bp, util = m.group(1) or "", m.group(2)
        k = key_of(util)
        if k:
            by_key.setdefault(k, []).append((i, bp, util))
    drop, replace = set(), {}
    for k, items in by_key.items():
        big = [it for it in items if it[1] in ("lg", "xl", "2xl")]
        if not big:
            continue
        # the value on a 1920 screen: the largest breakpoint that is active there
        winner = max(big, key=lambda it: BPS.index(it[1]))
        for it in items:
            if it[1] in ("md", "lg", "xl", "2xl") and it is not winner:
                drop.add(it[0])
        replace[winner[0]] = f"md:{winner[2]}"
    out = [replace.get(i, t) for i, t in enumerate(tokens) if i not in drop]
    return " ".join(out)


CLASSNAME = re.compile(r"""(className=)(["'`])(.*?)(\2)""", re.S)


def process(src: str) -> tuple[str, int]:
    n = 0

    def sub(m: re.Match) -> str:
        nonlocal n
        body = m.group(3)
        if "${" in body:  # template literal: convert the static parts only
            parts = re.split(r"(\$\{.*?\})", body)
            new = "".join(p if p.startswith("${") else _keep_space(p, convert(p)) for p in parts)
        else:
            new = _keep_space(body, convert(body))
        if new != body:
            n += 1
        return f"{m.group(1)}{m.group(2)}{new}{m.group(4)}"

    return CLASSNAME.sub(sub, src), n


def _keep_space(old: str, new: str) -> str:
    lead = old[: len(old) - len(old.lstrip())]
    trail = old[len(old.rstrip()):]
    return f"{lead}{new}{trail}" if new else old


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8", newline="") as f:
            src = f.read()
        new, n = process(src)
        if new != src:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(new)
        print(f"{n:4d}  {path}")
