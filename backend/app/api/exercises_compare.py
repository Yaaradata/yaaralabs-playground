"""Exercise 10 HTTP routes. Registered on the exercises router."""

from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_compare_service as compare

logger = logging.getLogger(__name__)


class CompareTurn(BaseModel):
    role: str = Field(..., max_length=16)
    text: str = Field(..., min_length=1, max_length=4000)


class CompareRunBody(BaseModel):
    system: str = Field(..., min_length=1, max_length=8000)
    turns: List[CompareTurn] = Field(..., min_length=1, max_length=40)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    temp: float = Field(default=0.3, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=300, ge=50, le=1000)
    nonce: int = Field(default=0, ge=0, le=10_000)


def register_compare_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/compare/catalog")
    async def compare_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return compare.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/compare/run")
    async def compare_run(
        session_id: str,
        project_id: str,
        body: CompareRunBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            turns = []
            for t in body.turns:
                role = (t.role or "").strip().lower()
                if role not in {"user", "assistant"}:
                    raise HTTPException(status_code=400, detail="turn role must be user or assistant")
                turns.append({"role": role, "text": t.text})
            return compare.generate_once(
                system=body.system,
                turns=turns,
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
                nonce=body.nonce,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 10 compare run failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
