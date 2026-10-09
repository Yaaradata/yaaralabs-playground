"""Exercise 8 HTTP routes. Registered on the exercises router."""

from __future__ import annotations

import logging
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_dials_service as dials

logger = logging.getLogger(__name__)


class DialValues(BaseModel):
    temp: float = Field(default=0.7, ge=0.0, le=2.0)
    topk: int = Field(default=0, ge=0, le=100)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=60, ge=5, le=400)


class DialRunBody(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    dials: DialValues = Field(default_factory=DialValues)
    index: int = Field(default=0, ge=0, le=20)


def register_dials_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/dials/catalog")
    async def dials_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return dials.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/dials/run")
    async def dials_run(
        session_id: str,
        project_id: str,
        body: DialRunBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return dials.generate_once(
                prompt=body.prompt,
                model=body.model or "gemini-flash-lite",
                dials=body.dials.model_dump(),
                index=body.index,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 8 dials run failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
