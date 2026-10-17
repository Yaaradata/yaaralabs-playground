"""The chat models in every model picker (Exercises labs, Agent Studio, agents).

    gemini-3.8-flash            Google, on Vertex AI (google-genai client, global endpoint)
    openai/gpt-6-luna           OpenAI, through OpenRouter
    anthropic/claude-haiku-5.5  Anthropic, through OpenRouter

The keys below are the ids the code passes as `model`. Ids with a "/" go to OpenRouter (see
openrouter_service.RoutedClient); the rest go to Vertex. Older saved ids (Gemini 2.5 / 3.5, old
family ids) still work: they map to Gemini 3.8 Flash.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Newer Gemini 3.x ids need the global endpoint; 2.5 also works there.
VERTEX_CHAT_LOCATION = "global"

DEFAULT_VERTEX_MODEL = "gemini-3.8-flash"

# id -> picker metadata. Prices are list prices, USD per 1M tokens (input / output).
VERTEX_CHAT_MODELS: Dict[str, Dict[str, Any]] = {
    "gemini-3.8-flash": {
        "id": "gemini-38-flash",
        "name": "Gemini 3.8 Flash",
        "short": "3.8 Flash",
        "vendor": "Google · Vertex AI",
        "provider": "vertex",
        "vertexModel": "gemini-3.8-flash",
        "enc": "o200k",
        "pin": 0.75,
        "pout": 3.75,
        "est": False,
        "tempMax": 2.0,
        "topk": True,
        "hint": "Vertex AI · Google Search grounding",
        "label": "3.8 Flash",
        "webSearch": "Google Search grounding",
        "thinking": True,
        # Internal reasoning counts against max_output_tokens before visible text.
        "thinkingOverhead": 1024,
    },
    "openai/gpt-6-luna": {
        "id": "gpt-6-luna",
        "name": "GPT-6 Luna",
        "short": "GPT-6 Luna",
        "vendor": "OpenAI · OpenRouter",
        "provider": "openrouter",
        "vertexModel": "openai/gpt-6-luna",
        "enc": "o200k",
        "pin": 0.10,
        "pout": 0.50,
        "est": False,
        "tempMax": 2.0,
        "topk": False,
        "hint": "OpenRouter · OpenAI's own web search",
        "label": "GPT-6 Luna",
        "webSearch": "OpenAI's own search, through OpenRouter",
        # reasons before it answers: a 800-token cap went entirely to reasoning and the answer came back empty
        "thinking": True,
        "thinkingOverhead": 2048,
    },
    "anthropic/claude-haiku-5.5": {
        "id": "claude-haiku-55",
        "name": "Claude Haiku 5.5",
        "short": "Haiku 5.5",
        "vendor": "Anthropic · OpenRouter",
        "provider": "openrouter",
        "vertexModel": "anthropic/claude-haiku-5.5",
        # no public tokenizer: o200k is the classroom estimate
        "enc": "o200k",
        "pin": 0.10,
        "pout": 0.50,
        "est": True,
        "tempMax": 1.0,
        "topk": False,
        "hint": "OpenRouter · Anthropic's own web search",
        "label": "Haiku 5.5",
        "webSearch": "Anthropic's own search, through OpenRouter",
        # reasons before it answers: a 800-token cap went entirely to reasoning and the answer came back empty
        "thinking": True,
        "thinkingOverhead": 2048,
    },
}

_CATALOG_ORDER = (
    "gemini-3.8-flash",
    "openai/gpt-6-luna",
    "anthropic/claude-haiku-5.5",
)

# Older saved lab state used fake multi-vendor family ids.
_LEGACY_FAMILY_ALIASES: Dict[str, str] = {
    # fake multi-vendor family ids from early labs
    "gpt": "gpt-6-luna",
    "claude": "claude-haiku-55",
    "gemini": "gemini-38-flash",
    "deepseek": "gemini-38-flash",
    "grok": "gemini-38-flash",
    "phi": "gemini-38-flash",
    "qwen": "gemini-38-flash",
    # the Gemini models these pickers used to offer
    "gemini-flash-lite": "gemini-38-flash",
    "gemini-35-flash-lite": "gemini-38-flash",
    "gemini-flash": "gemini-38-flash",
    "gemini-pro": "gemini-38-flash",
    "gemini-2.5-flash-lite": "gemini-38-flash",
    "gemini-3.5-flash-lite": "gemini-38-flash",
    "gemini-2.5-flash": "gemini-38-flash",
    "gemini-2.5-pro": "gemini-38-flash",
}

_FAMILY_BY_ID: Dict[str, Dict[str, Any]] = {}
_VERSION_TO_FAMILY: Dict[str, str] = {}


def _build_family_index() -> None:
    _FAMILY_BY_ID.clear()
    _VERSION_TO_FAMILY.clear()
    for vertex_id, meta in VERTEX_CHAT_MODELS.items():
        family_id = str(meta["id"])
        row = {
            **meta,
            "versions": [{"id": vertex_id, "label": str(meta.get("label") or vertex_id)}],
            "defaultVersion": vertex_id,
            "model": vertex_id,
        }
        _FAMILY_BY_ID[family_id] = row
        _VERSION_TO_FAMILY[vertex_id] = family_id


_build_family_index()


def catalog_models() -> List[Dict[str, Any]]:
    """Stable catalog rows for Exercise 5 and shared dial/compare pickers."""
    rows: List[Dict[str, Any]] = []
    for vertex_id in _CATALOG_ORDER:
        meta = VERTEX_CHAT_MODELS[vertex_id]
        rows.append(
            {
                "id": meta["id"],
                "name": meta["name"],
                "short": meta["short"],
                "enc": meta["enc"],
                "pin": float(meta["pin"]),
                "pout": float(meta["pout"]),
                "est": bool(meta.get("est")),
                "versions": [{"id": vertex_id, "label": str(meta.get("label") or vertex_id)}],
                "defaultVersion": vertex_id,
                "vendor": meta["vendor"],
                "tempMax": float(meta["tempMax"]),
                "topk": bool(meta.get("topk")),
                "hint": meta.get("hint") or "",
                "model": vertex_id,
                "vertexModel": vertex_id,
                "provider": meta.get("provider") or "vertex",
                "webSearch": meta.get("webSearch") or "",
            }
        )
    return rows


DEFAULT_FAMILY_IDS: List[str] = [row["id"] for row in catalog_models()]
DEFAULT_FAMILY_ID = DEFAULT_FAMILY_IDS[0]
# Default selections for side-by-side labs (keep call count reasonable).
DEFAULT_SELECTED_FAMILY_IDS: List[str] = [
    "gemini-38-flash",
    "gpt-6-luna",
    "claude-haiku-55",
]


def normalize_family_id(selection: Optional[str]) -> str:
    """Map family id, Vertex model id, or legacy alias → catalog family id."""
    raw = (selection or "").strip()
    if not raw:
        return DEFAULT_FAMILY_ID
    if raw in _FAMILY_BY_ID:
        return raw
    if raw in _VERSION_TO_FAMILY:
        return _VERSION_TO_FAMILY[raw]
    if raw in _LEGACY_FAMILY_ALIASES:
        return _LEGACY_FAMILY_ALIASES[raw]
    return DEFAULT_FAMILY_ID


def resolve_vertex_model(selection: Optional[str]) -> str:
    """Return the Vertex model id to pass to generate_content."""
    raw = (selection or "").strip()
    if raw in VERTEX_CHAT_MODELS:
        return raw
    family = normalize_family_id(raw)
    meta = _FAMILY_BY_ID.get(family)
    if meta:
        return str(meta["defaultVersion"])
    return DEFAULT_VERTEX_MODEL


def family_meta(selection: Optional[str]) -> Dict[str, Any]:
    family = normalize_family_id(selection)
    return dict(_FAMILY_BY_ID.get(family) or next(iter(_FAMILY_BY_ID.values())))


def resolve_selection(selection: Optional[str]) -> Tuple[str, str]:
    """Return (family_id, vertex_model_id) for pricing + live calls."""
    family = normalize_family_id(selection)
    vertex = resolve_vertex_model(selection)
    return family, vertex


def vertex_chat_service() -> Any:
    """Vertex client pointed at the chat location that hosts Gemini 3.x."""
    from ..config import gcp_clients
    from .vertex_ai_service import VertexAIService

    return VertexAIService(gcp_clients.project_id, location=VERTEX_CHAT_LOCATION)


def vertex_max_output_tokens(vertex_model: str, requested_cap: int) -> int:
    """Map a classroom visible-token cap to the Vertex max_output_tokens budget.

    Gemini Flash/Pro thinking models spend internal reasoning tokens against
    max_output_tokens *before* emitting visible text. Without an overhead
    pad, classroom caps (Ex5 ~300, dials ~60) return 1–8 words and stop with
    MAX_TOKENS. Overhead values were measured live on this project.
    """
    requested = max(1, int(requested_cap))
    meta = VERTEX_CHAT_MODELS.get(vertex_model) or {}
    overhead = int(meta.get("thinkingOverhead") or 0)
    if overhead <= 0 and meta.get("thinking"):
        # Safe fallback if a thinking model omits an explicit overhead.
        overhead = 2048 if "pro" in vertex_model else 1024 if "3.8" in vertex_model else 512
    if overhead <= 0:
        return requested
    return requested + overhead


def thinking_config(types_module: Any) -> Any:
    """Build a ThinkingConfig the installed google-genai SDK accepts."""
    thinking = getattr(types_module, "ThinkingConfig", None)
    if thinking is None:
        return None
    try:
        return thinking(include_thoughts=False)
    except Exception:
        try:
            return thinking()
        except Exception:
            return None
