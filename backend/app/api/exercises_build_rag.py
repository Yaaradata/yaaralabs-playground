"""Exercise 12 — Build a RAG end-to-end HTTP routes."""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_build_rag_service as build_rag

logger = logging.getLogger(__name__)


class CleanOpts(BaseModel):
    headers: bool = True
    hyphen: bool = True
    wraps: bool = True
    spaces: bool = True


class CleanBody(BaseModel):
    document: str = Field(..., max_length=200_000)
    headers: bool = True
    hyphen: bool = True
    wraps: bool = True
    spaces: bool = True
    clean: Optional[CleanOpts] = None


class ChunkBody(BaseModel):
    document: str = Field(default="", max_length=200_000)
    text: str = Field(default="", max_length=200_000)
    mode: str = Field(default="sentences", max_length=16)
    size: int = Field(default=60, ge=20, le=400)
    overlap: int = Field(default=10, ge=0, le=100)


class EmbedBody(BaseModel):
    chunks: List[str] = Field(..., min_length=1, max_length=800)
    model: str = Field(default="minilm", max_length=16)


class RetrieveBody(BaseModel):
    chunks: List[str] = Field(..., min_length=1, max_length=800)
    query: str = Field(..., min_length=1, max_length=4000)
    model: str = Field(default="minilm", max_length=16)
    k: int = Field(default=3, ge=1, le=10)
    minScore: float = Field(default=0.0, ge=0.0, le=0.9)
    vecs: Optional[List[List[float]]] = None


class GenerateBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    document: str = Field(default="", max_length=200_000)
    chunks: Optional[List[str]] = Field(default=None, max_length=800)
    headers: bool = True
    hyphen: bool = True
    wraps: bool = True
    spaces: bool = True
    clean: Optional[CleanOpts] = None
    mode: str = Field(default="sentences", max_length=16)
    size: int = Field(default=60, ge=20, le=400)
    overlap: int = Field(default=10, ge=0, le=100)
    embedModel: str = Field(default="minilm", max_length=16)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    k: int = Field(default=3, ge=1, le=10)
    minScore: float = Field(default=0.0, ge=0.0, le=0.9)
    template: str = Field(default=build_rag.DEFAULT_TEMPLATE, max_length=8000)
    numbered: bool = True
    compare: bool = False
    temp: float = Field(default=0.2, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=400, ge=50, le=1500)


class EvalTest(BaseModel):
    q: str = Field(..., min_length=1, max_length=4000)
    expect: str = Field(default="", max_length=2000)
    source: str = Field(default="", max_length=2000)


class EvaluateBody(BaseModel):
    document: str = Field(default="", max_length=200_000)
    chunks: Optional[List[str]] = Field(default=None, max_length=800)
    headers: bool = True
    hyphen: bool = True
    wraps: bool = True
    spaces: bool = True
    clean: Optional[CleanOpts] = None
    mode: str = Field(default="sentences", max_length=16)
    size: int = Field(default=60, ge=20, le=400)
    overlap: int = Field(default=10, ge=0, le=100)
    embedModel: str = Field(default="minilm", max_length=16)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    k: int = Field(default=3, ge=1, le=10)
    minScore: float = Field(default=0.0, ge=0.0, le=0.9)
    template: str = Field(default=build_rag.DEFAULT_TEMPLATE, max_length=8000)
    numbered: bool = True
    tests: List[EvalTest] = Field(..., min_length=1, max_length=30)
    evalGen: bool = True
    temp: float = Field(default=0.2, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=400, ge=50, le=1500)


def _clean_opts(body: Any) -> Dict[str, bool]:
    if getattr(body, "clean", None) is not None:
        c = body.clean
        return {
            "headers": bool(c.headers),
            "hyphen": bool(c.hyphen),
            "wraps": bool(c.wraps),
            "spaces": bool(c.spaces),
        }
    return {
        "headers": bool(getattr(body, "headers", True)),
        "hyphen": bool(getattr(body, "hyphen", True)),
        "wraps": bool(getattr(body, "wraps", True)),
        "spaces": bool(getattr(body, "spaces", True)),
    }


def register_build_rag_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/build-rag/catalog")
    async def build_rag_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return build_rag.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/build-rag/clean")
    async def build_rag_clean(
        session_id: str,
        project_id: str,
        body: CleanBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            opts = _clean_opts(body)
            return build_rag.clean(body.document, **opts)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 12 clean failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/build-rag/chunk")
    async def build_rag_chunk(
        session_id: str,
        project_id: str,
        body: ChunkBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.mode not in build_rag.CHUNK_MODES:
            raise HTTPException(status_code=400, detail="mode must be words, sentences, or sections")
        try:
            text = (body.text or body.document or "").strip()
            if not text:
                raise ValueError("Document text is empty")
            return build_rag.chunk(text, mode=body.mode, size=body.size, overlap=body.overlap)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 12 chunk failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/build-rag/embed")
    async def build_rag_embed(
        session_id: str,
        project_id: str,
        body: EmbedBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.model not in build_rag.EMBED_MODELS:
            raise HTTPException(status_code=400, detail="model must be minilm or tfidf")
        try:
            cleaned = [c for c in body.chunks if str(c).strip()]
            if not cleaned:
                raise ValueError("No chunks to embed")
            return build_rag.embed(cleaned, model=body.model)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 12 embed failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/build-rag/retrieve")
    async def build_rag_retrieve(
        session_id: str,
        project_id: str,
        body: RetrieveBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.model not in build_rag.EMBED_MODELS:
            raise HTTPException(status_code=400, detail="model must be minilm or tfidf")
        try:
            cleaned = [c for c in body.chunks if str(c).strip()]
            if not cleaned:
                raise ValueError("No chunks to search")
            return build_rag.retrieve(
                cleaned,
                body.query,
                model=body.model,
                k=body.k,
                min_score=body.minScore,
                vecs=body.vecs,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 12 retrieve failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/build-rag/generate")
    async def build_rag_generate(
        session_id: str,
        project_id: str,
        body: GenerateBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.mode not in build_rag.CHUNK_MODES:
            raise HTTPException(status_code=400, detail="mode must be words, sentences, or sections")
        if body.embedModel not in build_rag.EMBED_MODELS:
            raise HTTPException(status_code=400, detail="embedModel must be minilm or tfidf")
        try:
            return build_rag.generate(
                body.question,
                document=body.document,
                chunks=body.chunks,
                clean_opts=_clean_opts(body),
                mode=body.mode,
                size=body.size,
                overlap=body.overlap,
                embed_model=body.embedModel,
                k=body.k,
                min_score=body.minScore,
                template=body.template,
                numbered=body.numbered,
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
                compare_bare=body.compare,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 12 generate failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/build-rag/evaluate")
    async def build_rag_evaluate(
        session_id: str,
        project_id: str,
        body: EvaluateBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.mode not in build_rag.CHUNK_MODES:
            raise HTTPException(status_code=400, detail="mode must be words, sentences, or sections")
        if body.embedModel not in build_rag.EMBED_MODELS:
            raise HTTPException(status_code=400, detail="embedModel must be minilm or tfidf")
        try:
            return build_rag.evaluate(
                document=body.document,
                chunks=body.chunks,
                clean_opts=_clean_opts(body),
                mode=body.mode,
                size=body.size,
                overlap=body.overlap,
                embed_model=body.embedModel,
                k=body.k,
                min_score=body.minScore,
                template=body.template,
                numbered=body.numbered,
                tests=[t.model_dump() for t in body.tests],
                eval_gen=body.evalGen,
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 12 evaluate failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
