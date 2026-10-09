"""Check whether Gemini models return complete answers under classroom caps."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.exercises_vertex_models import (  # noqa: E402
    _CATALOG_ORDER,
    VERTEX_CHAT_MODELS,
    thinking_config,
    vertex_chat_service,
    vertex_max_output_tokens,
)

PROMPT = (
    "Explain in 2-3 complete sentences how ABS prevents wheel lock during hard braking. "
    "Do not stop mid-sentence."
)


def finish_reason(response) -> str:
    try:
        cands = getattr(response, "candidates", None) or []
        if not cands:
            return "NO_CANDIDATE"
        return str(getattr(cands[0], "finish_reason", "") or "?")
    except Exception:
        return "?"


def usage(response) -> tuple[int, int, int]:
    um = getattr(response, "usage_metadata", None)
    if not um:
        return 0, 0, 0
    inn = int(getattr(um, "prompt_token_count", 0) or 0)
    out = int(getattr(um, "candidates_token_count", 0) or 0)
    thoughts = int(getattr(um, "thoughts_token_count", 0) or 0)
    return inn, out, thoughts


def extract_text(response) -> str:
    try:
        text = (getattr(response, "text", None) or "").strip()
    except Exception:
        text = ""
    if text:
        return text
    parts = []
    for cand in getattr(response, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            piece = getattr(part, "text", None)
            if piece:
                parts.append(piece)
    return "".join(parts).strip()


def looks_truncated(text: str, stop: str) -> bool:
    if not text:
        return True
    if "MAX" in stop.upper() or "LENGTH" in stop.upper():
        return True
    words = text.split()
    if len(words) <= 8:
        return True
    if text[-1] not in ".!?\"')]" and len(words) < 40:
        return True
    return False


def call(vertex_id: str, requested_cap: int) -> dict:
    from google.genai import types

    api_cap = vertex_max_output_tokens(vertex_id, requested_cap)
    cfg_kwargs = {
        "temperature": 0.35,
        "max_output_tokens": api_cap,
    }
    tc = thinking_config(types)
    if tc is not None:
        cfg_kwargs["thinking_config"] = tc
    try:
        config = types.GenerateContentConfig(**cfg_kwargs)
    except TypeError:
        cfg_kwargs.pop("thinking_config", None)
        config = types.GenerateContentConfig(**cfg_kwargs)

    vertex = vertex_chat_service()
    response = vertex.client.models.generate_content(
        model=vertex_id,
        contents=PROMPT,
        config=config,
    )
    text = extract_text(response)
    stop = finish_reason(response)
    inn, out, thoughts = usage(response)
    return {
        "requested": requested_cap,
        "api_cap": api_cap,
        "stop": stop,
        "in": inn,
        "out": out,
        "thoughts": thoughts,
        "words": len(text.split()) if text else 0,
        "truncated": looks_truncated(text, stop),
        "text": text.replace("\n", " ")[:180],
    }


def main() -> int:
    caps = [15, 60, 100, 256]
    bad = 0
    for vertex_id in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vertex_id]
        print(f"\n=== {meta['name']} ({vertex_id}) thinking={meta.get('thinking')} ===")
        for cap in caps:
            try:
                row = call(vertex_id, cap)
                mark = "TRUNC" if row["truncated"] else "OK"
                if row["truncated"]:
                    bad += 1
                print(
                    f"  {mark} req={row['requested']:>3} api={row['api_cap']:>3} "
                    f"stop={row['stop']:<12} words={row['words']:>3} "
                    f"outTok={row['out']:>3} thinkTok={row['thoughts']:>3} "
                    f"text={row['text']!r}"
                )
            except Exception as e:
                bad += 1
                print(f"  FAIL req={cap}: {type(e).__name__}: {e}")

    # Exercise 5 path
    print("\n=== Exercise 5 tokeniser.answer() per model ===")
    from app.services.exercises_tokeniser_service import answer

    q = "How does ABS stop the wheels from locking during hard braking?"
    for vertex_id in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vertex_id]
        try:
            out = answer(q, "en", words=100, model=meta["id"])
            text = (out.get("text") or "").replace("\n", " ")
            words = out.get("words") or len(text.split())
            trunc = looks_truncated(text, "end" if words > 8 else "MAX")
            mark = "TRUNC" if trunc else "OK"
            if trunc:
                bad += 1
            print(
                f"  {mark} {meta['name']}: words={words} simulated={out.get('simulated')} "
                f"text={text[:160]!r}"
            )
        except Exception as e:
            bad += 1
            print(f"  FAIL {meta['name']}: {type(e).__name__}: {e}")

    print(f"\nIssues found: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
