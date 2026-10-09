"""Exercise 5 HTTP routes. Registered on the exercises router."""

from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_tokeniser_service as tokeniser

logger = logging.getLogger(__name__)


class TokenItem(BaseModel):
    enc: str = Field(min_length=2, max_length=16)
    text: str = Field(default="", max_length=20000)


class TokenizeBody(BaseModel):
    items: List[TokenItem] = Field(default_factory=list, max_length=48)
    segments: bool = False


class AnswerBody(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    lang: str = Field(min_length=2, max_length=8)
    words: int = Field(default=100, ge=20, le=300)
    model: Optional[str] = Field(default="gemini-2.5-flash-lite", max_length=64)


def register_tokeniser_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/tokeniser/catalog")
    async def tokeniser_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return tokeniser.catalog()

    @router.get("/session/{session_id}/projects/{project_id}/tokeniser/ref-tpw")
    async def tokeniser_ref_tpw(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return {"tpw": tokeniser.ref_tpw()}

    @router.post("/session/{session_id}/projects/{project_id}/tokeniser/tokenize")
    async def tokeniser_tokenize(
        session_id: str,
        project_id: str,
        body: TokenizeBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if not body.items:
            raise HTTPException(status_code=400, detail="Provide at least one text to tokenise")
        try:
            results = tokeniser.tokenize_batch(
                [{"enc": item.enc, "text": item.text} for item in body.items],
                want_segments=body.segments,
            )
            return {"results": results}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 5 tokenize failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/tokeniser/answer")
    async def tokeniser_answer(
        session_id: str,
        project_id: str,
        body: AnswerBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.lang not in tokeniser.LANGS:
            raise HTTPException(status_code=400, detail=f"Unknown language '{body.lang}'")
        try:
            return tokeniser.answer(
                question=body.question,
                lang=body.lang,
                words=body.words,
                model=body.model or "gemini-2.5-flash-lite",
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 5 answer failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
