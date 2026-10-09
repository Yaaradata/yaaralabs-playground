"""Exercise 10 — hit the limit HTTP routes."""

from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_limit_service as limit_lab

logger = logging.getLogger(__name__)


class LimitTurn(BaseModel):
    role: str = Field(..., max_length=16)
    text: str = Field(..., min_length=1, max_length=12000)


class LimitChatBody(BaseModel):
    system: str = Field(..., min_length=1, max_length=8000)
    turns: List[LimitTurn] = Field(..., min_length=1, max_length=40)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    temp: float = Field(default=0.3, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=300, ge=50, le=1000)


class LimitCompactBody(BaseModel):
    transcript: str = Field(..., min_length=1, max_length=120000)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    temp: float = Field(default=0.3, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=300, ge=50, le=1000)


def register_limit_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/limit/catalog")
    async def limit_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return limit_lab.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/limit/chat")
    async def limit_chat(
        session_id: str,
        project_id: str,
        body: LimitChatBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return limit_lab.generate_chat(
                system=body.system,
                turns=[t.model_dump() for t in body.turns],
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 11 chat failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e

    @router.post("/session/{session_id}/projects/{project_id}/limit/compact")
    async def limit_compact(
        session_id: str,
        project_id: str,
        body: LimitCompactBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return limit_lab.generate_compact(
                transcript=body.transcript,
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 11 compact failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
