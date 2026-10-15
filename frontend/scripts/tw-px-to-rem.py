"""
Convert Tailwind arbitrary px values in .tsx files to rem, the same rules as px-to-rem.py:

  w-[300px] -> w-[18.75rem]          (1rem = 16px: unchanged at viewport 5, scales elsewhere)
  text-[12px] -> text-[length:max(0.75rem,13.5px)]   (readable floor for text under 14px)
  border-[1px], ring-[2px] ...        kept (hairlines <= 2px)

Usage (from frontend/):  python scripts/tw-px-to-rem.py <file.tsx> ...
"""

import re
import sys

CLS = re.compile(r"(?P<pre>(?<![\w-])(?:[a-z]+:)*)(?P<util>-?[a-z][a-z0-9-]*)-\[(?P<val>-?\d*\.?\d+)px\]")


def rem(v: float) -> str:
    return f"{v / 16:.4f}".rstrip("0").rstrip(".") + "rem"


def sub(m: re.Match) -> str:
    v = float(m.group("val"))
    util = m.group("util")
    if abs(v) <= 2:
        return m.group(0)
    if util == "text":
        value = f"length:max({rem(v)},13.5px)" if v < 14 else rem(v)
        return f"{m.group('pre')}text-[{value}]"
    return f"{m.group('pre')}{util}-[{rem(v)}]"


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8", newline="") as f:
            src = f.read()
        new, n = CLS.subn(sub, src)
        changed = sum(1 for a, b in zip(CLS.finditer(src), CLS.finditer(src)) if sub(a) != a.group(0))
        if new != src:
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(new)
        print(f"{changed:4d}  {path}")
