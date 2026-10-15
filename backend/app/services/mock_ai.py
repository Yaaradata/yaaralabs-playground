"""
Mock AI for load tests (docs/hardening.md, part B): with MOCK_AI=1, and only when NODE_ENV is not
production, every model call (Gemini through the google-genai client, the agent loop's REST calls,
OpenRouter through the routed client, Vertex and RAG embeddings) returns a canned reply after a
realistic 1.5-6 s delay. No cost, and the server's own work (threads, Firestore, locks) is real.

    MOCK_AI=1 NODE_ENV=development uvicorn app.main:app ...
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import time
from types import SimpleNamespace
from typing import Any, Iterator, List, Sequence

import numpy as np

REPLY = ("Thanks for your message. This looks like a corporate action query: the dividend is paid on the "
         "payment date after the record date. A colleague from the Corporate Actions desk will confirm.")
SPEC = {"name": "Custody Desk Assistant", "role": "Answers client questions for a custody desk",
        "tone": "Professional", "language": "English", "response_length": "Short",
        "guidelines": "Be precise. Hand complaints to a person."}


def enabled() -> bool:
    if os.getenv("MOCK_AI", "").strip() != "1":
        return False
    return os.getenv("NODE_ENV", "").strip().lower() != "production"


def delay(lo: float = 1.5, hi: float = 6.0) -> None:
    time.sleep(random.uniform(lo, hi))


def _wants_json(*parts: Any) -> bool:
    text = " ".join(str(p) for p in parts if p is not None)[:20000].lower()
    return "json" in text


def reply_text(*prompt_parts: Any) -> str:
    return json.dumps(SPEC) if _wants_json(*prompt_parts) else REPLY


def genai_response(text: str) -> SimpleNamespace:
    """What google-genai's client.models.generate_content returns, as far as the app reads it."""
    part = SimpleNamespace(text=text, function_call=None, thought=None)
    cand = SimpleNamespace(content=SimpleNamespace(parts=[part], role="model"), finish_reason=SimpleNamespace(name="STOP"),
                           grounding_metadata=None)
    usage = SimpleNamespace(prompt_token_count=120, candidates_token_count=45, total_token_count=165, thoughts_token_count=0)
    return SimpleNamespace(text=text, candidates=[cand], usage_metadata=usage, function_calls=None)


def generate_content(*args: Any, **kwargs: Any) -> SimpleNamespace:
    delay()
    return genai_response(reply_text(kwargs.get("contents"), kwargs.get("config"), args[1:] if len(args) > 1 else None))


def generate_content_stream(*args: Any, **kwargs: Any) -> Iterator[SimpleNamespace]:
    text = reply_text(kwargs.get("contents"), kwargs.get("config"))
    words = text.split(" ")
    delay(1.0, 3.0)  # time to first token
    for i in range(0, len(words), 6):
        time.sleep(0.08)
        yield genai_response(" ".join(words[i:i + 6]) + " ")


def count_tokens(*args: Any, **kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(total_tokens=120)


def rest_out(system: str = "", contents: Any = None) -> dict:
    """What ai_agent_service._post returns."""
    delay()
    text = reply_text(system, contents)
    return {"content": {"role": "model", "parts": [{"text": text}]}, "text": text, "calls": [],
            "usage": {"promptTokenCount": 120, "candidatesTokenCount": 45}, "finish": "STOP"}


def stream_pieces(system: str = "", contents: Any = None) -> Iterator[str]:
    delay(1.0, 3.0)
    for w in reply_text(system, contents).split(" "):
        time.sleep(0.04)
        yield w + " "


def vectors(texts: Sequence[str], dims: int) -> np.ndarray:
    """Deterministic unit vectors (the same text always gets the same vector)."""
    out: List[np.ndarray] = []
    for t in texts:
        seed = int.from_bytes(hashlib.sha1(str(t).encode("utf-8")).digest()[:4], "big")
        v = np.random.default_rng(seed).standard_normal(dims).astype(np.float32)
        out.append(v / (np.linalg.norm(v) or 1.0))
    time.sleep(min(0.4, 0.05 + 0.002 * len(texts)))
    return np.vstack(out) if out else np.zeros((0, dims), dtype=np.float32)
