"""Smoke-test the five Gemini models in the exercises catalog."""

from __future__ import annotations

import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.exercises_vertex_models import (  # noqa: E402
    VERTEX_CHAT_MODELS,
    _CATALOG_ORDER,
    catalog_models,
    resolve_vertex_model,
    vertex_chat_service,
    vertex_max_output_tokens,
)


def call_gemini(vertex_id: str) -> str:
    from google.genai import types

    vertex = vertex_chat_service()
    response = vertex.client.models.generate_content(
        model=vertex_id,
        contents="Reply with exactly: OK",
        config=types.GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=vertex_max_output_tokens(vertex_id, 32),
        ),
    )
    try:
        text = (getattr(response, "text", None) or "").strip()
    except Exception:
        text = ""
    if not text:
        parts = []
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                piece = getattr(part, "text", None)
                if piece:
                    parts.append(piece)
        text = "".join(parts).strip()
    return text


def main() -> int:
    rows = catalog_models()
    print("Catalog:")
    for r in rows:
        print(f"  - {r['name']} ({r['id']} -> {r['vertexModel']})")
    print("---")

    ok = 0
    fail = 0
    for vertex_id in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vertex_id]
        label = f"{meta['name']} ({vertex_id})"
        try:
            # Also prove family id resolution works the way exercises call it.
            resolved = resolve_vertex_model(meta["id"])
            if resolved != vertex_id:
                raise RuntimeError(f"resolve mismatch: {meta['id']} -> {resolved}")
            text = call_gemini(vertex_id)
            preview = text.replace("\n", " ")[:120]
            if text:
                print(f"PASS  {label}")
                print(f"      text={preview!r}")
                ok += 1
            else:
                print(f"FAIL  {label}")
                print("      empty response")
                fail += 1
        except Exception as e:
            print(f"FAIL  {label}")
            print(f"      {type(e).__name__}: {e}")
            traceback.print_exc(limit=1)
            fail += 1
        print("---")

    # Exercise-style generate path (dials)
    try:
        from app.services.exercises_dials_service import generate_once

        out = generate_once(
            "Reply with exactly: OK",
            model="gemini-flash-lite",
            dials={"temp": 0.1, "topk": 0, "topp": 1.0, "cap": 32},
            index=0,
        )
        print(
            "Exercise dials path:",
            "PASS" if (out.get("text") or "").strip() else "FAIL",
            f"model={out.get('model')} simulated={out.get('simulated')} text={(out.get('text') or '')[:40]!r}",
        )
    except Exception as e:
        print("Exercise dials path: FAIL", type(e).__name__, e)

    print(f"Result: {ok} passed, {fail} failed, {ok + fail} total")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
