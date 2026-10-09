"""Exercise 3 HTTP routes. Registered on the exercises router."""

from __future__ import annotations

import logging
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..services import exercises_metric_service

logger = logging.getLogger(__name__)


class ScoreBody(BaseModel):
    department: str = Field(min_length=2, max_length=20)
    method: str
    focus: str | None = None
    pos: list[float] | None = None
    neg: list[float] | None = None
    matrix: list[list[int]] | None = None
    classes: list[str] | None = None
    baseline: float | None = Field(default=None, ge=0, le=1)


class AnswerBody(BaseModel):
    runId: str
    index: int
    raw: str = ""


class ChoiceBody(BaseModel):
    runId: str
    round: int
    metric: str
    reasonId: str


class LockBody(BaseModel):
    runId: str
    round: int
    threshold: int


class RunBody(BaseModel):
    runId: str
    readScore: int = 0


def register_metric_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/metric/catalog")
    async def metric_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return exercises_metric_service.catalog()

    @router.post("/session/{session_id}/projects/{project_id}/metric/score")
    async def metric_score(
        session_id: str,
        project_id: str,
        body: ScoreBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return exercises_metric_service.score_model(
                session_id,
                project_id,
                body.department,
                body.method,
                body.pos,
                body.neg,
                body.focus,
                body.matrix,
                body.classes,
                body.baseline,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.error("Exercise 3 score failed: %s", exc, exc_info=True)
            raise HTTPException(status_code=500, detail="Could not score the model.") from exc

    @router.post("/session/{session_id}/projects/{project_id}/metric/answer")
    async def metric_answer(
        session_id: str,
        project_id: str,
        body: AnswerBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return exercises_metric_service.grade_answer(session_id, project_id, body.runId, body.index, body.raw)
        except LookupError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/session/{session_id}/projects/{project_id}/metric/choice")
    async def metric_choice(
        session_id: str,
        project_id: str,
        body: ChoiceBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return exercises_metric_service.grade_choice(
                session_id, project_id, body.runId, body.round, body.metric, body.reasonId
            )
        except LookupError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/session/{session_id}/projects/{project_id}/metric/lock")
    async def metric_lock(
        session_id: str,
        project_id: str,
        body: LockBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return exercises_metric_service.lock_threshold(
                session_id, project_id, body.runId, body.round, body.threshold
            )
        except LookupError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/session/{session_id}/projects/{project_id}/metric/round")
    async def metric_round(
        session_id: str,
        project_id: str,
        body: RunBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return exercises_metric_service.next_round(session_id, project_id, body.runId)
        except LookupError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/session/{session_id}/projects/{project_id}/metric/finish")
    async def metric_finish(
        session_id: str,
        project_id: str,
        body: RunBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return exercises_metric_service.finish(session_id, project_id, body.runId, body.readScore)
        except LookupError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
