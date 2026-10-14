"""Exercise 11 — RAG chatbot HTTP routes."""

from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_rag_service as rag

logger = logging.getLogger(__name__)


class ChunkBody(BaseModel):
    document: str = Field(..., max_length=200_000)
    mode: str = Field(default="words", max_length=16)
    size: int = Field(default=60, ge=20, le=400)
    overlap: int = Field(default=10, ge=0, le=100)


class SearchBody(BaseModel):
    chunks: List[str] = Field(..., min_length=1, max_length=800)
    query: str = Field(..., min_length=1, max_length=4000)
    k: int = Field(default=3, ge=1, le=10)
    minScore: float = Field(default=0.0, ge=0.0, le=0.5)


class AskBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    document: str = Field(default="", max_length=200_000)
    chunks: Optional[List[str]] = Field(default=None, max_length=800)
    mode: str = Field(default="words", max_length=16)
    size: int = Field(default=60, ge=20, le=400)
    overlap: int = Field(default=10, ge=0, le=100)
    k: int = Field(default=3, ge=1, le=10)
    minScore: float = Field(default=0.0, ge=0.0, le=0.5)
    strict: bool = True
    useDoc: bool = True
    model: Optional[str] = Field(default="gemini-38-flash", max_length=64)
    temp: float = Field(default=0.2, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=400, ge=50, le=1000)


def register_rag_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/rag/catalog")
    async def rag_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return rag.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/rag/chunk")
    async def rag_chunk(
        session_id: str,
        project_id: str,
        body: ChunkBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.mode not in rag.CHUNK_MODES:
            raise HTTPException(status_code=400, detail="mode must be words, sentences, or sections")
        try:
            chunks = rag.chunk_document(body.document, mode=body.mode, size=body.size, overlap=body.overlap)
            return {
                "chunks": chunks,
                "count": len(chunks),
                "mode": body.mode if body.mode in rag.CHUNK_MODES else "words",
                "size": body.size,
                "overlap": 0 if body.mode == "sections" else body.overlap,
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 11 chunk failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/rag/search")
    async def rag_search(
        session_id: str,
        project_id: str,
        body: SearchBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            cleaned = [c for c in body.chunks if str(c).strip()]
            if not cleaned:
                raise ValueError("No chunks to search")
            if len(cleaned) > 800:
                raise ValueError("Too many chunks (max 800)")
            for i, c in enumerate(cleaned):
                if len(c) > 20_000:
                    raise ValueError(f"Chunk {i + 1} is too long (max 20000 characters)")
            return rag.search_chunks(cleaned, body.query, k=body.k, min_score=body.minScore)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 11 search failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/rag/ask")
    async def rag_ask(
        session_id: str,
        project_id: str,
        body: AskBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.mode not in rag.CHUNK_MODES:
            raise HTTPException(status_code=400, detail="mode must be words, sentences, or sections")
        try:
            return rag.ask(
                body.question,
                model=body.model or "gemini-38-flash",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
                use_doc=body.useDoc,
                strict=body.strict,
                k=body.k,
                min_score=body.minScore,
                document=body.document,
                mode=body.mode,
                size=body.size,
                overlap=body.overlap,
                chunks=body.chunks,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 11 ask failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
