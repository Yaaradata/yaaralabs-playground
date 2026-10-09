"""Exercise 8 — change one generation dial at a time.

Runs the same prompt under controlled temperature / top-k / top-p / output-cap
settings so students can separate dial effects from chance (baseline) and cost.
"""

from __future__ import annotations

import hashlib
import logging
import random
import re
import time
from typing import Any, Dict, List, Optional

from .exercises_vertex_models import (
    DEFAULT_FAMILY_ID,
    DEFAULT_VERTEX_MODEL,
    normalize_family_id,
    resolve_vertex_model,
    thinking_config,
    vertex_chat_service,
    vertex_max_output_tokens,
)

logger = logging.getLogger(__name__)

INR_PER_USD = 88.0
_VERTEX_MODEL = DEFAULT_VERTEX_MODEL


def _build_models() -> List[Dict[str, Any]]:
    from .exercises_tokeniser_service import MODELS as TOKENISER_MODELS

    rows: List[Dict[str, Any]] = []
    for row in TOKENISER_MODELS:
        default_version = str(row.get("defaultVersion") or row.get("model") or row["id"])
        rows.append(
            {
                "id": row["id"],
                "name": row["name"],
                "short": row.get("short") or row["name"],
                "vendor": row.get("vendor") or "Google Vertex AI",
                "tempMax": float(row.get("tempMax") or 2.0),
                "topk": bool(row.get("topk", True)),
                "pin": float(row["pin"]),
                "pout": float(row["pout"]),
                "hint": row.get("hint") or "Classroom Vertex",
                "est": bool(row.get("est")),
                "versions": list(row.get("versions") or []),
                "defaultVersion": default_version,
                "model": default_version,
            }
        )
    return rows


MODELS: List[Dict[str, Any]] = _build_models()

DIALS: List[Dict[str, Any]] = [
    {
        "key": "temp",
        "label": "Temperature",
        "min": 0,
        "max": 2,
        "step": 0.05,
        "desc": "Sharpens or flattens the odds of every next word.",
    },
    {
        "key": "topk",
        "label": "Top-k",
        "min": 0,
        "max": 100,
        "step": 1,
        "desc": "Keeps only the k most likely next words.",
    },
    {
        "key": "topp",
        "label": "Top-p",
        "min": 0.05,
        "max": 1,
        "step": 0.05,
        "desc": "Keeps top words until their odds add up to p.",
    },
    {
        "key": "cap",
        "label": "Output cap",
        "short": "Cap",
        "min": 5,
        "max": 400,
        "step": 1,
        "desc": "Hard stop on output length — and on cost.",
    },
]

PRESETS: Dict[str, Dict[str, Any]] = {
    "temp": {
        "base": {"topk": 0, "topp": 1, "cap": 60},
        "A": {"temp": 0.1},
        "B": {"temp": 1.4},
    },
    "topk": {
        "base": {"temp": 1, "topp": 1, "cap": 60},
        "A": {"topk": 2},
        "B": {"topk": 50},
    },
    "topp": {
        "base": {"temp": 1, "topk": 0, "cap": 60},
        "A": {"topp": 0.2},
        "B": {"topp": 1},
    },
    "cap": {
        "base": {"temp": 0.7, "topk": 0, "topp": 1},
        "A": {"cap": 15},
        "B": {"cap": 150},
    },
}

DEFAULT_PROMPT = (
    "Write a one-line shift handover note for Line 3 after a brief stoppage."
)

_MODEL_BY_ID = {row["id"]: row for row in MODELS}


def catalog() -> Dict[str, Any]:
    return {
        "models": MODELS,
        "dials": DIALS,
        "presets": PRESETS,
        "defaults": {
            "model": DEFAULT_FAMILY_ID,
            "view": "temp",
            "runs": 5,
            "prompt": DEFAULT_PROMPT,
            "inrPerUsd": INR_PER_USD,
            "A": {"temp": 0.1, "topk": 0, "topp": 1, "cap": 60},
            "B": {"temp": 1.4, "topk": 0, "topp": 1, "cap": 60},
        },
        "explain": {
            "temp": "Temperature sharpens or flattens next-token odds. Low → steady factual answers; high → more variety.",
            "topk": "Top-k keeps only the k most likely next tokens. Narrow k → safer, more repetitive wording.",
            "topp": "Top-p keeps tokens until cumulative probability reaches p. Narrow p → fewer surprising words.",
            "cap": "Output cap is a hard stop on length (and cost). Short caps cut answers mid-thought.",
            "factual": "For factual tasks prefer low temperature, narrow top-k/top-p, and a modest cap.",
            "creative": "For creative tasks prefer higher temperature and wider top-k/top-p; watch the cost of a long cap.",
        },
    }


def _model_meta(model: str) -> Dict[str, Any]:
    return _MODEL_BY_ID.get(normalize_family_id(model)) or MODELS[0]


def _clamp_dials(model: str, dials: Dict[str, Any]) -> Dict[str, float]:
    meta = _model_meta(model)
    temp = float(dials.get("temp", 0.7))
    temp = max(0.0, min(float(meta["tempMax"]), temp))
    topk = int(dials.get("topk", 0) or 0)
    if not meta.get("topk"):
        topk = 0
    topk = max(0, min(100, topk))
    topp = float(dials.get("topp", 1.0))
    topp = max(0.05, min(1.0, topp))
    cap = int(dials.get("cap", 60) or 60)
    cap = max(5, min(400, cap))
    return {"temp": temp, "topk": float(topk), "topp": topp, "cap": float(cap)}


def cost_of(in_tok: int, out_tok: int, model: str) -> float:
    meta = _model_meta(model)
    return in_tok * float(meta["pin"]) / 1e6 + out_tok * float(meta["pout"]) / 1e6


def _est_tokens(text: str) -> int:
    cleaned = (text or "").strip()
    if not cleaned:
        return 0
    return max(1, int(round(len(cleaned) / 4)))


def _trim_to_cap(text: str, cap: int) -> tuple[str, bool]:
    """Approximate token trim so the simulator still teaches the output-cap dial."""
    words = (text or "").split()
    # ~1.3 tokens per English word for classroom estimates
    budget = max(1, int(cap / 1.3))
    if len(words) <= budget:
        return (text or "").strip(), False
    return " ".join(words[:budget]).strip(), True


def _simulated_completion(
    prompt: str,
    model: str,
    dials: Dict[str, float],
    index: int,
) -> Dict[str, Any]:
    """Classroom-safe reply that still reacts to each dial."""
    temp = float(dials["temp"])
    topk = int(dials["topk"])
    topp = float(dials["topp"])
    cap = int(dials["cap"])

    # Narrow sampling → less run-to-run variety (same seed bucket).
    narrow = (topk > 0 and topk <= 5) or topp <= 0.35
    variety_key = 0 if temp <= 0.25 else (0 if narrow and temp < 0.9 else index)
    seed_src = f"{prompt}|{model}|{temp:.3f}|{topk}|{topp:.3f}|{cap}|{variety_key}"
    rng = random.Random(int(hashlib.md5(seed_src.encode("utf-8")).hexdigest()[:8], 16))

    topic = re.sub(r"\s+", " ", (prompt or "").strip())[:120] or "the task"
    bases = [
        f"Handover: {topic} — status stable, no open blockers.",
        f"Note: completed work on “{topic}”; next shift should verify readings.",
        f"Summary for next shift: {topic}. Keep monitoring for 30 minutes.",
        f"Update: {topic}. All clear unless alarms resume.",
        f"Line note: {topic}. Documented stoppage; resume checklist done.",
    ]
    creative = [
        "Colour the margin with a metaphor: the line slept, then woke on cue.",
        "Optional flourish: imagine the handover as a brief radio call.",
        "Wilder draft: add one unexpected but still relevant detail.",
        "Playful variant: thank the previous shift in one witty clause.",
        "Less consistent wording wandered in because sampling is wide.",
    ]

    if temp <= 0.2:
        text = bases[0]
    elif temp < 0.8:
        text = bases[rng.randrange(0, min(3, len(bases)))]
    else:
        text = bases[rng.randrange(len(bases))]
        picks = rng.sample(creative, k=min(2 if temp >= 1.2 else 1, len(creative)))
        text = text + " " + " ".join(picks)

    if narrow and temp > 0.2:
        text = bases[min(1, len(bases) - 1)]

    if normalize_family_id(model).startswith("gemini"):
        text = "Reasoned lab note — " + text

    text, hit_cap = _trim_to_cap(text, cap)
    in_tok = _est_tokens(prompt) + 8
    out_tok = _est_tokens(text)
    if hit_cap:
        out_tok = min(out_tok, cap)
    return {
        "text": text,
        "inTok": in_tok,
        "outTok": out_tok,
        "stop": "max_tokens" if hit_cap else "end",
        "simulated": True,
    }


def _usage_tokens(response: Any, prompt: str, text: str) -> tuple[int, int]:
    usage = getattr(response, "usage_metadata", None)
    in_tok = getattr(usage, "prompt_token_count", None) if usage else None
    out_tok = getattr(usage, "candidates_token_count", None) if usage else None
    thoughts = getattr(usage, "thoughts_token_count", None) if usage else None
    if in_tok is None:
        in_tok = _est_tokens(prompt) + 8
    if out_tok is None:
        out_tok = _est_tokens(text)
    else:
        out_tok = int(out_tok) + int(thoughts or 0)
    return int(in_tok), int(out_tok)


def _finish_reason(response: Any) -> str:
    try:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return "end"
        reason = str(getattr(candidates[0], "finish_reason", "") or "").upper()
        if "MAX" in reason or reason in {"LENGTH", "MAX_TOKENS"}:
            return "max_tokens"
    except Exception:
        return "end"
    return "end"


def generate_once(
    prompt: str,
    model: str = DEFAULT_FAMILY_ID,
    dials: Optional[Dict[str, Any]] = None,
    index: int = 0,
) -> Dict[str, Any]:
    """One completion with the chosen dials. Falls back to the classroom simulator."""
    cleaned = (prompt or "").strip()
    if not cleaned:
        raise ValueError("Prompt is empty")
    if len(cleaned) > 4000:
        raise ValueError("Prompt is too long (max 4000 characters)")

    chosen = normalize_family_id(model)
    vertex_model = resolve_vertex_model(model)
    d = _clamp_dials(chosen, dials or {})
    # Only apply top-k when the selected vendor supports it.
    if not _model_meta(chosen).get("topk"):
        d = {**d, "topk": 0.0}
    t0 = time.perf_counter()
    simulated = False
    text = ""
    in_tok = 0
    out_tok = 0
    stop = "end"

    try:
        from google.genai import types

        vertex = vertex_chat_service()
        cfg_kwargs: Dict[str, Any] = {
            "temperature": float(d["temp"]),
            "max_output_tokens": vertex_max_output_tokens(vertex_model, int(d["cap"])),
        }
        if d["topk"] > 0:
            cfg_kwargs["top_k"] = int(d["topk"])
        if d["topp"] < 0.999:
            cfg_kwargs["top_p"] = float(d["topp"])
        tc = thinking_config(types)
        if tc is not None:
            cfg_kwargs["thinking_config"] = tc

        try:
            config = types.GenerateContentConfig(**cfg_kwargs)
        except TypeError:
            # Older SDKs may reject thinking_config / top_k — peel unsupported fields.
            for key in ("thinking_config", "top_k", "top_p"):
                cfg_kwargs.pop(key, None)
                try:
                    config = types.GenerateContentConfig(**cfg_kwargs)
                    break
                except TypeError:
                    continue
            else:
                config = types.GenerateContentConfig(
                    temperature=float(d["temp"]),
                    max_output_tokens=int(d["cap"]),
                )

        response = vertex.client.models.generate_content(
            model=vertex_model,
            contents=cleaned,
            config=config,
        )
        try:
            text = (getattr(response, "text", None) or "").strip()
        except Exception:
            # google-genai raises when candidates are empty / blocked
            text = ""
            try:
                parts = []
                for cand in getattr(response, "candidates", None) or []:
                    content = getattr(cand, "content", None)
                    for part in getattr(content, "parts", None) or []:
                        piece = getattr(part, "text", None)
                        if piece:
                            parts.append(piece)
                text = "".join(parts).strip()
            except Exception:
                text = ""
        if not text:
            sim = _simulated_completion(cleaned, chosen, d, index)
            text = sim["text"]
            in_tok = int(sim["inTok"])
            out_tok = int(sim["outTok"])
            stop = str(sim["stop"])
            simulated = True
        else:
            in_tok, out_tok = _usage_tokens(response, cleaned, text)
            stop = _finish_reason(response)
            if out_tok >= int(d["cap"]) and stop == "end":
                stop = "max_tokens"
    except Exception as e:
        logger.warning("Exercise 8 generate fell back to simulator: %s", e)
        sim = _simulated_completion(cleaned, chosen, d, index)
        text = sim["text"]
        in_tok = int(sim["inTok"])
        out_tok = int(sim["outTok"])
        stop = str(sim["stop"])
        simulated = True

    ms = (time.perf_counter() - t0) * 1000.0
    cost = cost_of(in_tok, out_tok, chosen)
    return {
        "text": text,
        "model": vertex_model,
        "dials": {
            "temp": d["temp"],
            "topk": int(d["topk"]),
            "topp": d["topp"],
            "cap": int(d["cap"]),
        },
        "inTok": in_tok,
        "outTok": out_tok,
        "stop": stop,
        "ms": round(ms, 1),
        "cost": cost,
        "costInr": cost * INR_PER_USD,
        "simulated": simulated,
        "index": index,
    }
