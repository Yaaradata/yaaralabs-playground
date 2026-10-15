"""RAG Chatbot projects: documents → chunks → search → grounded answers → test set.

  GET    /library                                  public documents (SEBI circulars), seeded into Firestore
  GET    /library/{docId}/pdf                      the official PDF, served by us (sebi.gov.in refuses to be framed)
  GET    /models                                   chat and embedding models
  GET    /test-questions                           the built-in test set
  GET    /session/{sid}/projects/{pid}             state, documents, index, questions, test runs
  PUT    …/state                                   step, chunking, embedding model, retrieval and answer settings
  POST   …/documents/library                       add a library document
  POST   …/documents/upload                        upload a PDF, TXT or MD (multipart, field "file")
  DELETE …/documents/{docId}                       remove a document
  GET    …/documents/{docId}/pages                 the text, page by page
  POST   …/chunks/preview                          what a chunking choice produces (nothing is embedded)
  POST   …/index                                   build (or reuse) the index for the current choices
  GET    …/indexes/{indexId}/chunks?offset&limit   the chunks of an index
  POST   …/search                                  keyword and meaning search side by side (no model call)
  POST   …/ask                                     retrieve, answer with citations, store
  GET    …/asks/{askId}                            one question in full, with the prompt sent
  PATCH  …/asks/{askId}                            the learner's verdict: grounded | made-up | refused
  DELETE …/asks/{askId}
  POST   …/evals                                   run the test set with the current settings
  GET    …/evals/{evalId}                          a test run with its answers
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from .rate_limits import CHAT_PER_MINUTE, rate_limit
from ..models import (
    ProjectType,
    RagAskRequest,
    RagEvalRequest,
    RagLibraryRequest,
    RagPreviewRequest,
    RagSearchRequest,
    RagStateRequest,
    RagVerdictRequest,
)
from ..services import rag_chatbot_service as rag
from ..services.project_service import ProjectService
from ..services.rag_text import TextError
from .exercises import get_project_service, validate_session
from .slots import RAG_WORK

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rag-chatbot", tags=["rag-chatbot"])
P = "/session/{session_id}/projects/{project_id}"


def get_rag_service() -> rag.RagChatbotService:
    return rag.RagChatbotService()


async def _assert_project(session_id: str, project_id: str, project_service: ProjectService):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    if project.type != ProjectType.RAG_CHATBOT and str(project.type) != "rag-chatbot":
        raise HTTPException(status_code=400, detail="This endpoint is only for RAG chatbot projects")
    return project


def _http(e: Exception) -> HTTPException:
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, rag.RagNotFound):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, rag.RagBusy):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, rag.RagModelError):
        return HTTPException(status_code=502, detail=str(e))
    if isinstance(e, (rag.RagError, TextError, ValueError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, LookupError):
        return HTTPException(status_code=404, detail=str(e))
    logger.error("RAG chatbot request failed: %s", e, exc_info=True)
    return HTTPException(status_code=500, detail="Something went wrong. Please try again.")


async def _run(fn, *args):
    try:
        return {"success": True, "data": await asyncio.to_thread(fn, *args)}
    except Exception as e:
        raise _http(e)


# ── public ──────────────────────────────────────────────────────


@router.get("/library")
async def library(service: rag.RagChatbotService = Depends(get_rag_service)):
    return await _run(service.library)


@router.get("/library/{doc_id}/pdf")
async def library_pdf(doc_id: str):
    """The official PDF of a library document, for the viewer. Only known library ids are served."""
    known = {d["id"] for d in rag._library_files()}
    path = rag.DATA_DIR / "library" / f"{doc_id}.pdf"
    if doc_id not in known or not path.is_file():
        raise HTTPException(status_code=404, detail="No PDF for that document.")
    return FileResponse(path, media_type="application/pdf", filename=f"{doc_id}.pdf",
                        content_disposition_type="inline", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/models")
async def models():
    return await _run(rag.models)


@router.get("/test-questions")
async def test_questions():
    return await _run(lambda: [{k: q[k] for k in ("id", "type", "question", "answer", "where", "doc")} | {"trap": bool(q["check"].get("trap"))}
                               for q in rag.test_questions()])


# ── project ─────────────────────────────────────────────────────


class _Ctx:
    """Session check + project check, shared by every project route."""

    def __init__(self, session_id: str, project_id: str, session: dict = Depends(validate_session),
                 project_service: ProjectService = Depends(get_project_service),
                 service: rag.RagChatbotService = Depends(get_rag_service)):
        self.sid, self.pid, self.project_service, self.service = session_id, project_id, project_service, service

    async def check(self):
        await _assert_project(self.sid, self.pid, self.project_service)
        return self


@router.get(P)
async def get_project(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.view, ctx.pid, ctx.sid)


@router.put(P + "/state")
async def save_state(body: RagStateRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.save_state, ctx.pid, ctx.sid, body.model_dump(exclude_none=True))


@router.post(P + "/documents/library")
async def add_library(body: RagLibraryRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.add_library, ctx.pid, ctx.sid, body.libraryId)


@router.post(P + "/documents/upload")
async def upload(file: UploadFile = File(...), ctx: _Ctx = Depends()):
    await ctx.check()
    data = await file.read(rag.MAX_UPLOAD_BYTES + 1)
    return await _run(ctx.service.upload, ctx.pid, ctx.sid, file.filename or "document", data)


@router.delete(P + "/documents/{doc_id}")
async def remove_document(doc_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.remove_document, ctx.pid, ctx.sid, doc_id)


@router.get(P + "/documents/{doc_id}/pages")
async def pages(doc_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.pages, ctx.pid, doc_id)


@router.post(P + "/chunks/preview")
async def preview(body: RagPreviewRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.preview_chunks, ctx.pid, body.chunking.model_dump())


@router.post(P + "/index")
async def build_index(ctx: _Ctx = Depends()):
    await ctx.check()
    async with RAG_WORK():
        return await _run(ctx.service.build_index, ctx.pid, ctx.sid)


@router.get(P + "/indexes/{index_id}/chunks")
async def index_chunks(index_id: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=400),
                       ctx: _Ctx = Depends()):
    await ctx.check()
    try:
        rows, total = await asyncio.to_thread(ctx.service.chunks, ctx.pid, index_id, offset, limit)
        return {"success": True, "data": rows, "total": total}
    except Exception as e:
        raise _http(e)


@router.post(P + "/search")
async def search(body: RagSearchRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.search, ctx.pid, ctx.sid, body.question, body.k, body.minScore)


def _over(body) -> dict:
    out = {}
    if body.retrieval:
        out.update(body.retrieval.model_dump())
    if body.answer:
        out.update(body.answer.model_dump())
    return out


@router.post(P + "/ask", dependencies=[Depends(rate_limit("rag ask", CHAT_PER_MINUTE))])
async def ask(body: RagAskRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.ask, ctx.pid, ctx.sid, body.question, _over(body), body.testQuestionId)


@router.get(P + "/asks/{ask_id}")
async def ask_detail(ask_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.ask_detail, ctx.pid, ask_id)


@router.patch(P + "/asks/{ask_id}")
async def set_verdict(ask_id: str, body: RagVerdictRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.set_verdict, ctx.pid, ask_id, body.verdict)


@router.delete(P + "/asks/{ask_id}")
async def delete_ask(ask_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.delete_ask, ctx.pid, ask_id)


@router.post(P + "/evals")
async def run_eval(body: RagEvalRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    async with RAG_WORK():
        return await _run(ctx.service.run_eval, ctx.pid, ctx.sid, body.questionIds, _over(body))


@router.get(P + "/evals/{eval_id}")
async def eval_detail(eval_id: str, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.service.eval_detail, ctx.pid, eval_id)
