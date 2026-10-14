"""Day 2 Agent Studio stages: the same custody assistant growing up across three exercises.

  assistant  Ex 6  Custom AI Agent  persona, rules & guardrails, actions; answers from the model's own knowledge
  rag        Ex 7  RAG Chatbot      + knowledge base: answers only from the saved documents, with citations
  agent      Ex 8  AI Agent         + tools: decides which tools to use (documents, web, dates, ID checks)

Agents created before stages existed have no stage ("legacy"): they keep ChatService.chat and the old inline UI.

Pure functions only (no Firestore, no Vertex), shared by the API, the chat path and the tests.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

STAGES = ("assistant", "rag", "agent")
PREVIOUS = {"assistant": None, "rag": "assistant", "agent": "rag"}
STAGE_TYPE = {"assistant": "custom-ai-agent", "rag": "rag-chatbot", "agent": "ai-agent"}
STAGE_LABEL = {"assistant": "Ex 6 · Custom AI Agent", "rag": "Ex 7 · RAG Chatbot", "agent": "Ex 8 · AI Agent"}

# Flash-Lite answers well from documents; with tools, Flash calls the right one far more reliably
DEFAULT_MODEL = {"assistant": "gemini-2.5-flash-lite", "rag": "gemini-2.5-flash-lite", "agent": "gemini-2.5-flash"}
MODEL_CHOICES = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro"]
DEFAULT_EMBEDDING = "text-embedding-005"
DEFAULT_SIMILARITY = "Cosine similarity"


def normalize_stage(stage: Optional[str]) -> Optional[str]:
    return stage if stage in STAGES else None


def capabilities(stage: Optional[str]) -> Optional[Dict[str, bool]]:
    """What a stage can use. None for legacy agents (no stage)."""
    stage = normalize_stage(stage)
    if stage is None:
        return None
    return {"knowledge_base": stage in ("rag", "agent"), "tools": stage == "agent", "web_search": stage == "agent"}


def project_type(stage: Optional[str]) -> str:
    """The project type a staged agent shows as; legacy agents are custom-ai-agent."""
    return STAGE_TYPE.get(normalize_stage(stage) or "assistant", "custom-ai-agent")


def start_from_options(agents: List[Dict[str, Any]], stage: str) -> List[Dict[str, Any]]:
    """Agents a new stage can start from: only the previous stage (Ex 6 -> Ex 7 -> Ex 8), newest first."""
    order = {"rag": ["assistant"], "agent": ["rag"]}.get(stage, [])
    out: List[Dict[str, Any]] = []
    for want in order:
        group = [a for a in agents if a.get("stage") == want]
        group.sort(key=lambda a: str(a.get("created_at") or ""), reverse=True)
        out.extend(group)
    return out


def _now() -> datetime:
    return datetime.now(timezone.utc)


def plan_copy(source: Dict[str, Any], new_agent_id: str, new_stage: str, new_rule_id: Callable[[], str]) -> Dict[str, Any]:
    """Everything a new staged agent copies from the one it starts from, as documents ready to write.

    source = {"agent": {...}, "persona": {...}, "settings": {...} | None, "guardrails": {...} | None,
              "rules": [rule docs], "kb": {"documents": [...], "chunks": [{"id", ...}]} | None}
    Copied: persona, model, guardrails, actions (new rule ids, same on/off). The knowledge base too when the new
    stage is "agent" (same document ids, so an action pointing at a document keeps working; vectors included, so
    nothing is re-embedded). Tool state is never copied: the new agent gets the stage's default tools.
    """
    now = _now()
    src_agent = source.get("agent") or {}
    src_stage = normalize_stage(src_agent.get("stage")) or "assistant"

    persona = {k: v for k, v in (source.get("persona") or {}).items() if k not in ("agent_id", "created_at", "updated_at")}
    persona.update({"agent_id": new_agent_id, "created_at": now, "updated_at": now})

    src_model = (source.get("settings") or {}).get("model")
    # A model the participant chose is kept; the previous stage's default becomes this stage's default
    model = src_model if src_model and src_model != DEFAULT_MODEL.get(src_stage) else DEFAULT_MODEL[new_stage]
    settings = {"agent_id": new_agent_id, "model": model,
                "embedding_model": (source.get("settings") or {}).get("embedding_model") or DEFAULT_EMBEDDING,
                "similarity": (source.get("settings") or {}).get("similarity") or DEFAULT_SIMILARITY,
                "created_at": now, "updated_at": now}

    guardrails = None
    if source.get("guardrails"):
        guardrails = {**source["guardrails"], "agent_id": new_agent_id, "updated_at": now}

    rules = []
    for r in source.get("rules") or []:
        rules.append({**r, "rule_id": new_rule_id(), "agent_id": new_agent_id, "active": bool(r.get("active", True)),
                      "created_at": now, "updated_at": now})

    kb_documents: List[Dict[str, Any]] = []
    kb_chunks: List[Dict[str, Any]] = []
    blob_copies: List[Dict[str, str]] = []
    kb = source.get("kb") or {}
    if new_stage == "agent" and kb.get("documents"):
        for d in kb["documents"]:
            d = dict(d)
            if d.get("gcs_path"):
                new_path = f"agents/{new_agent_id}/kb/{d['doc_id']}.pdf"
                blob_copies.append({"from": d["gcs_path"], "to": new_path})
                d["gcs_path"] = new_path
            kb_documents.append(d)
        kb_chunks = [dict(c) for c in kb.get("chunks") or []]

    return {
        "persona": persona, "settings": settings, "guardrails": guardrails, "rules": rules,
        "kb_documents": kb_documents, "kb_chunks": kb_chunks, "blob_copies": blob_copies,
        "copied_from": {"agent_id": src_agent.get("agent_id"), "name": src_agent.get("project_name") or src_agent.get("name"),
                        "stage": src_stage},
    }
