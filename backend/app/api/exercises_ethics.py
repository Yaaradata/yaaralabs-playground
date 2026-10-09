"""Exercise 14 — AI ethics lab HTTP routes."""

from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from ..services import exercises_ethics_service as ethics

logger = logging.getLogger(__name__)


class EthicsMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str = Field(..., min_length=1, max_length=16)
    content: Optional[str] = Field(default=None, max_length=12000)
    text: Optional[str] = Field(default=None, max_length=12000)


class EthicsChatBody(BaseModel):
    system: str = Field(default="", max_length=8000)
    messages: List[EthicsMessage] = Field(..., min_length=1, max_length=40)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    temp: float = Field(default=0.7, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=400, ge=50, le=1500)


def register_ethics_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/ethics/catalog")
    async def ethics_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return ethics.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/ethics/chat")
    async def ethics_chat(
        session_id: str,
        project_id: str,
        body: EthicsChatBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return ethics.chat(
                system=body.system,
                messages=[m.model_dump(exclude_none=True) for m in body.messages],
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 14 ethics chat failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
