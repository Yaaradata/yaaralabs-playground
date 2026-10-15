"""
Convert a lab's component CSS from px to rem so it scales with the fluid root size (globals.css).

  1rem = 16px, the root size at viewport 5 (1536 wide), so each lab looks the same there as before.
  Kept in px: hairlines (<= 2px: borders, outlines, focus rings) and @media / @container queries.
  font-size under 14px becomes max(<rem>, 13.5px): readable on a projector at every size.

Usage (from frontend/):  python scripts/px-to-rem.py components/AgentStudio/agentStudio.css ...
Prints how many values changed per file. Safe to re-run (only px values are touched).
"""

import re
import sys

PX = re.compile(r"(?<![\w.#-])(-?\d*\.?\d+)px\b")
READABLE = 13.5


def rem(v: float) -> str:
    r = f"{v / 16:.4f}".rstrip("0").rstrip(".")
    return f"{r}rem" if r not in ("0", "-0") else "0"


def convert_value(prop: str, value: str) -> tuple[str, int]:
    count = 0
    first = True  # in the font shorthand the first length is the size

    def sub(m: re.Match) -> str:
        nonlocal count, first
        v = float(m.group(1))
        is_size = prop == "font-size" or (prop == "font" and first)
        first = False
        if abs(v) <= 2:
            return m.group(0)
        count += 1
        if is_size and v < 14:
            return f"max({rem(v)}, {READABLE}px)"
        return rem(v)

    return PX.sub(sub, value), count


DECL = re.compile(r"(?P<prop>[a-zA-Z-]+)\s*:\s*(?P<value>[^;{}]+)")


def convert(css: str) -> tuple[str, int]:
    out, total = [], 0
    for line in css.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped.startswith("@media") or stripped.startswith("@container"):
            # the query keeps px; rules written on the same line after "{" are converted
            head, brace, rest = line.partition("{")
            if not brace:
                out.append(line)
                continue
            body, n = convert(rest)
            total += n
            out.append(head + brace + body)
            continue

        def decl(m: re.Match) -> str:
            nonlocal total
            prop = m.group("prop").lower()
            value, n = convert_value(prop, m.group("value"))
            total += n
            return f"{m.group('prop')}{m.group(0)[len(m.group('prop')):m.start('value') - m.start()]}{value}"

        out.append(DECL.sub(decl, line))
    return "".join(out), total


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8", newline="") as f:
            css = f.read()
        new, n = convert(css)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new)
        print(f"{n:5d}  {path}")
