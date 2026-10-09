"""Exercise 11 — fill the context window, prune, and compact."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from . import exercises_compare_service as compare

LIMITS = [1000, 2000, 4000, 8000]
MSG_OVERHEAD = 4

_HTML_PATH = Path(__file__).resolve().parents[3] / "exercise-10-hit-the-limit.html"
_HTML = _HTML_PATH.read_text(encoding="utf-8") if _HTML_PATH.is_file() else ""


def _js_backtick_const(name: str, fallback: str = "") -> str:
    if not _HTML:
        return fallback
    marker = f"const {name} = `"
    try:
        start = _HTML.index(marker) + len(marker)
        end = _HTML.index("`", start)
        return _HTML[start:end]
    except ValueError:
        return fallback


def _js_string_array(name: str, fallback: List[str]) -> List[str]:
    if not _HTML:
        return fallback
    m = re.search(rf"const {name}\s*=\s*\[(.*?)\];", _HTML, re.S)
    if not m:
        return fallback
    return re.findall(r'"((?:\\.|[^"\\])*)"', m.group(1)) or fallback


SAMPLE_SYS = _js_backtick_const("SAMPLE_SYS", compare.SAMPLE_SYS)
SAMPLE_LONG = _js_backtick_const("SAMPLE_LONG", "Long sample text for filling the window.")
MSG_EXAMPLES = _js_string_array(
    "MSG_EXAMPLES",
    [
        "e.g. I'm designing a lightweight drone arm that must carry a 2 kg payload. Which material should I start with?",
        "e.g. What would change if the arm had to survive salt spray near the sea?",
        "e.g. Remind me: what payload did I say the arm must carry?",
    ],
)

COMPACT_SYS = _js_backtick_const(
    "COMPACT_SYS",
    "You compress conversations so they fit in a small context window.\n"
    "Write a short summary in at most 80 words. Keep facts, numbers, and decisions.",
)

DEFAULTS: Dict[str, Any] = {
    "temp": 0.3,
    "topp": 1.0,
    "cap": 300,
    "limit": 2000,
    "keep": 2,
    "prov": "gemini-flash-lite",
}


def catalog() -> Dict[str, Any]:
    base = compare.catalog()
    return {
        "models": base["models"],
        "limits": LIMITS,
        "defaults": {**DEFAULTS, "inrPerUsd": compare.INR_PER_USD},
        "sample": {
            "sys": SAMPLE_SYS,
            "longText": SAMPLE_LONG,
            "messages": MSG_EXAMPLES,
        },
        "msgOverhead": MSG_OVERHEAD,
    }


def generate_chat(
    system: str,
    turns: Optional[Sequence[Dict[str, Any]]] = None,
    model: str = "gemini-flash-lite",
    temp: float = 0.3,
    topp: float = 1.0,
    cap: int = 300,
) -> Dict[str, Any]:
    """Chat turn for Exercise 11 (same stack as Exercise 10)."""
    return compare.generate_once(
        system=system,
        turns=turns,
        model=model,
        temp=temp,
        topp=topp,
        cap=cap,
        nonce=0,
    )


def generate_compact(
    transcript: str,
    model: str = "gemini-flash-lite",
    temp: float = 0.3,
    topp: float = 1.0,
    cap: int = 300,
) -> Dict[str, Any]:
    cleaned = (transcript or "").strip()
    if not cleaned:
        raise ValueError("Nothing to summarise")
    if len(cleaned) > 120_000:
        raise ValueError("Transcript is too long to summarise in one call")
    compact_cap = max(50, min(300, int(cap)))
    return compare.generate_once(
        system=COMPACT_SYS,
        turns=[{"role": "user", "text": f"Conversation to summarise:\n\n{cleaned}"}],
        model=model,
        temp=temp,
        topp=topp,
        cap=compact_cap,
    )
