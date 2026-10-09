"""Re-check Exercise 5 answers after thinking-overhead fix."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.exercises_tokeniser_service import answer  # noqa: E402
from app.services.exercises_vertex_models import (  # noqa: E402
    VERTEX_CHAT_MODELS,
    _CATALOG_ORDER,
    vertex_max_output_tokens,
)


def main() -> int:
    for mid in _CATALOG_ORDER:
        print(mid, "req60->", vertex_max_output_tokens(mid, 60), "req300->", vertex_max_output_tokens(mid, 300))

    q = "How does ABS stop the wheels from locking during hard braking?"
    bad = 0
    print("\n=== Exercise 5 ===")
    for vid in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vid]
        out = answer(q, "en", words=100, model=meta["id"])
        text = (out.get("text") or "").replace("\n", " ")
        words = int(out.get("words") or (len(text.split()) if text else 0))
        ends_ok = bool(text) and text[-1] in ".!?\"')]"
        ok = words >= 20 and ends_ok and not out.get("simulated")
        mark = "OK" if ok else "BAD"
        if not ok:
            bad += 1
        print(
            f"  {mark} {meta['name']}: words={words} simulated={out.get('simulated')} "
            f"text={text[:170]!r}"
        )
    print(f"\nBad: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
