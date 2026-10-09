"""Exercise 9 HTTP routes. Registered on the exercises router."""

from __future__ import annotations

import logging
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_persona_service as persona

logger = logging.getLogger(__name__)


class ExamplePair(BaseModel):
    q: str = Field(default="", max_length=2000)
    a: str = Field(default="", max_length=4000)


class PersonaRunBody(BaseModel):
    system: str = Field(..., min_length=1, max_length=8000)
    examples: List[ExamplePair] = Field(default_factory=list, max_length=5)
    question: str = Field(..., min_length=1, max_length=2000)
    condition: str = Field(default="zero", max_length=8)
    model: Optional[str] = Field(default="gemini-flash-lite", max_length=64)
    temp: float = Field(default=0.3, ge=0.0, le=2.0)
    topp: float = Field(default=1.0, ge=0.05, le=1.0)
    cap: int = Field(default=300, ge=50, le=1000)


def register_persona_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/persona/catalog")
    async def persona_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return persona.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/persona/run")
    async def persona_run(
        session_id: str,
        project_id: str,
        body: PersonaRunBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        if body.condition not in {"zero", "one", "few"}:
            raise HTTPException(status_code=400, detail="condition must be zero, one, or few")
        try:
            return persona.generate_once(
                system=body.system,
                examples=[ex.model_dump() for ex in body.examples],
                question=body.question,
                condition=body.condition,
                model=body.model or "gemini-flash-lite",
                temp=body.temp,
                topp=body.topp,
                cap=body.cap,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except Exception as e:
            logger.error("Exercise 9 persona run failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=str(e)) from e
