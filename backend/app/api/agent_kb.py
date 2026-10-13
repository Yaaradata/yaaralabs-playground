"""Day 2 Agent Studio routes: knowledge base (RAG Chatbot, AI Agent), tools (AI Agent), sample questions (all).

Every route takes session_id and checks that the agent belongs to it (403). The knowledge base is only for stages
rag and agent, tools only for agent (400 otherwise).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from ..config import gcp_clients
from ..services import agent_kb_service as kbs
from ..services import agent_stages
from ..services import agent_studio_service as studio
from ..services.agent_service import AgentService

router = APIRouter(prefix="/agent", tags=["agent-studio"])


def _agent(agent_id: str, session_id: str, need: str = ""):
    agent = AgentService().get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.session_id != session_id:
        raise HTTPException(status_code=403, detail="That agent belongs to another session.")
    caps = agent_stages.capabilities(agent.stage)
    if need and not (caps or {}).get(need):
        what = "a knowledge base" if need == "knowledge_base" else "tools"
        raise HTTPException(status_code=400, detail=f"This agent's stage has no {what}.")
    return agent


async def _run(fn, *args):
    try:
        return await asyncio.get_running_loop().run_in_executor(None, fn, *args)
    except kbs.KbError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except kbs.KbNotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (kbs.KbModelError, studio.StudioModelError) as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── knowledge base ─────────────────────────────────────────────


class LibraryAdd(BaseModel):
    library_ids: List[str] = Field(..., min_length=1, max_length=kbs.MAX_DOCUMENTS)


@router.get("/{agent_id}/kb/library")
async def kb_library(agent_id: str, session_id: str = Query(...)):
    _agent(agent_id, session_id, "knowledge_base")
    return {"library": await _run(kbs.AgentKbService().library)}


@router.get("/{agent_id}/kb/documents")
async def kb_documents(agent_id: str, session_id: str = Query(...)):
    _agent(agent_id, session_id, "knowledge_base")
    return {"documents": await _run(kbs.AgentKbService().documents, agent_id)}


@router.post("/{agent_id}/kb/library")
async def kb_add_library(agent_id: str, body: LibraryAdd, session_id: str = Query(...)):
    _agent(agent_id, session_id, "knowledge_base")
    return {"documents": await _run(kbs.AgentKbService().add_library, agent_id, body.library_ids)}


@router.post("/{agent_id}/kb/upload")
async def kb_upload(agent_id: str, session_id: str = Query(...), file: UploadFile = File(...)):
    _agent(agent_id, session_id, "knowledge_base")
    data = await file.read(kbs.MAX_UPLOAD_BYTES + 1)
    return {"documents": await _run(kbs.AgentKbService().upload, agent_id, file.filename or "document.pdf", data)}


@router.get("/{agent_id}/kb/documents/{doc_id}/pdf")
async def kb_pdf(agent_id: str, doc_id: str, session_id: str = Query(...)):
    _agent(agent_id, session_id, "knowledge_base")
    path, data = await _run(kbs.AgentKbService().pdf, agent_id, doc_id)
    if path is not None:
        return FileResponse(path, media_type="application/pdf", filename=path.name, content_disposition_type="inline",
                            headers={"Cache-Control": "public, max-age=86400"})
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc_id}.pdf"', "Cache-Control": "private, max-age=3600"})


@router.get("/{agent_id}/kb/documents/{doc_id}/chunks")
async def kb_chunks(agent_id: str, doc_id: str, session_id: str = Query(...), offset: int = Query(0, ge=0),
                    limit: int = Query(50, ge=1, le=200)):
    _agent(agent_id, session_id, "knowledge_base")
    return await _run(kbs.AgentKbService().chunks, agent_id, doc_id, offset, limit)


@router.delete("/{agent_id}/kb/documents/{doc_id}")
async def kb_delete(agent_id: str, doc_id: str, session_id: str = Query(...)):
    _agent(agent_id, session_id, "knowledge_base")
    return {"documents": await _run(kbs.AgentKbService().delete, agent_id, doc_id)}


# ── tools ──────────────────────────────────────────────────────


class ToolsUpdate(BaseModel):
    enabled: List[str] = Field(..., max_length=len(studio.ALL_TOOLS))


def _tools_doc(agent_id: str):
    return gcp_clients.get_firestore_client().collection("agent_tools_state").document(agent_id)


def _guard_on(agent_id: str) -> bool:
    g = AgentService().get_guardrails(agent_id)
    return bool(g and g.block_instruction_changes)


@router.get("/{agent_id}/tools")
async def get_tools(agent_id: str, session_id: str = Query(...)):
    _agent(agent_id, session_id, "tools")
    snap = _tools_doc(agent_id).get()
    enabled = (snap.to_dict() or {}).get("enabled") if snap.exists else None
    return studio.tools_catalog(enabled, _guard_on(agent_id))


@router.put("/{agent_id}/tools")
async def put_tools(agent_id: str, body: ToolsUpdate, session_id: str = Query(...)):
    _agent(agent_id, session_id, "tools")
    unknown = [t for t in body.enabled if t not in studio.ALL_TOOLS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown tool: {', '.join(unknown)}")
    enabled = studio.enabled_tools(body.enabled)
    _tools_doc(agent_id).set({"enabled": enabled, "updated_at": datetime.now(timezone.utc)})
    return studio.tools_catalog(enabled, _guard_on(agent_id))


# ── sample questions ───────────────────────────────────────────


@router.get("/{agent_id}/sample-questions")
async def sample_questions(agent_id: str, session_id: str = Query(...)):
    agent = _agent(agent_id, session_id)
    if not agent.stage:
        raise HTTPException(status_code=400, detail="Sample questions are for Day 2 agents.")
    return studio.sample_questions(agent.stage)
