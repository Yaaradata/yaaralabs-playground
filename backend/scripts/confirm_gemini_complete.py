"""Small live confirm: all catalog models return a complete sentence."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.exercises_dials_service import generate_once  # noqa: E402
from app.services.exercises_tokeniser_service import answer  # noqa: E402
from app.services.exercises_vertex_models import (  # noqa: E402
    VERTEX_CHAT_MODELS,
    _CATALOG_ORDER,
    vertex_max_output_tokens,
)

PROMPT = "Explain in 2 complete sentences how ABS prevents wheel lock. Finish the sentences."


def ok_text(text: str, min_words: int = 20) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return False
    words = cleaned.split()
    if len(words) < min_words:
        return False
    return cleaned[-1] in ".!?\"')]"


def main() -> int:
    print("API budgets (classroom cap 100):")
    for vid in _CATALOG_ORDER:
        print(f"  {vid}: {vertex_max_output_tokens(vid, 100)}")

    failed = 0
    print("\n1) Direct dials generate_once (cap=100)")
    for vid in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vid]
        out = generate_once(
            PROMPT,
            model=meta["id"],
            dials={"temp": 0.35, "topk": 0, "topp": 1.0, "cap": 100},
            index=0,
        )
        text = (out.get("text") or "").replace("\n", " ").strip()
        words = len(text.split()) if text else 0
        good = ok_text(text) and not out.get("simulated")
        mark = "PASS" if good else "FAIL"
        if not good:
            failed += 1
        print(
            f"  {mark} {meta['name']}: words={words} stop={out.get('stop')} "
            f"sim={out.get('simulated')} text={text[:140]!r}"
        )

    print("\n2) Exercise 5 answer() path")
    q = "How does ABS stop the wheels from locking during hard braking?"
    for vid in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vid]
        out = answer(q, "en", words=100, model=meta["id"])
        text = (out.get("text") or "").replace("\n", " ").strip()
        words = int(out.get("words") or (len(text.split()) if text else 0))
        good = ok_text(text) and not out.get("simulated")
        mark = "PASS" if good else "FAIL"
        if not good:
            failed += 1
        print(
            f"  {mark} {meta['name']}: words={words} sim={out.get('simulated')} "
            f"text={text[:140]!r}"
        )

    print(f"\nResult: {'ALL PASS' if failed == 0 else f'{failed} FAILED'}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
