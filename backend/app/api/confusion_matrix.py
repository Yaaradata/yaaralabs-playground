"""Confusion Matrix projects (Exercise 3): open a trained model, retrain it, compare runs.

Source: the learner's Exercise 2 model (retrained with its exact settings) or a shared
pre-trained model on one of the sample datasets. Models: logistic regression and DistilBERT.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models import (
    CMDatasetListResponse,
    CMEx2RunListResponse,
    CMExamplesResponse,
    CMOpenRequest,
    CMProjectResponse,
    CMSampleResponse,
    CMStateRequest,
    CMTrainRequest,
    ProjectType,
)
from ..services import cm_datasets
from ..services.confusion_matrix_service import CMBusy, CMError, CMNotFound, ConfusionMatrixService
from ..services.project_service import ProjectService
from .exercises import _TRAIN_SLOTS, get_project_service, validate_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/confusion-matrix", tags=["confusion-matrix"])

PROJECT_PATH = "/session/{session_id}/projects/{project_id}"


def get_cm_service() -> ConfusionMatrixService:
    return ConfusionMatrixService()


async def _assert_cm_project(session_id: str, project_id: str, project_service: ProjectService):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    if project.type != ProjectType.CONFUSION_MATRIX and str(project.type) != "confusion-matrix":
        raise HTTPException(status_code=400, detail="This endpoint is only for confusion matrix projects")
    return project


def _http(e: Exception) -> HTTPException:
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, CMNotFound):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, CMBusy):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, (CMError, ValueError)):
        return HTTPException(status_code=400, detail=str(e))
    logger.error("Confusion matrix request failed: %s", e, exc_info=True)
    return HTTPException(status_code=500, detail="Something went wrong. Please try again.")


# ── public: sample datasets ─────────────────────────────────────


@router.get("/datasets", response_model=CMDatasetListResponse)
async def list_datasets():
    """The built-in sample datasets (each has a shared pre-trained model)."""
    try:
        data = await asyncio.to_thread(lambda: [cm_datasets.load_sample(i).info() for i in cm_datasets.SAMPLE_IDS])
        return CMDatasetListResponse(data=data)
    except Exception as e:
        raise _http(e)


# ── session ─────────────────────────────────────────────────────


@router.get("/session/{session_id}/ex2-runs", response_model=CMEx2RunListResponse)
async def list_ex2_runs(
    session_id: str,
    session: dict = Depends(validate_session),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """Exercise 2 runs in this session, newest first, with whether Exercise 3 can open them."""
    try:
        return CMEx2RunListResponse(data=await asyncio.to_thread(service.list_ex2_runs, session_id))
    except Exception as e:
        raise _http(e)


# ── project ─────────────────────────────────────────────────────


@router.get(PROJECT_PATH, response_model=CMProjectResponse)
async def get_project(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """State, the current dataset and every run (without per-item arrays)."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        return CMProjectResponse(data=await asyncio.to_thread(service.view, project_id, session_id))
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/open", response_model=CMProjectResponse)
async def open_source(
    session_id: str,
    project_id: str,
    body: CMOpenRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """Open the Ex 2 model or a pre-trained model. The first visit trains/copies Run 1; later visits reopen."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        async with _TRAIN_SLOTS:
            data = await asyncio.to_thread(service.open, project_id, session_id, body.source, body.datasetId, body.ex2ProjectId, body.target)
        return CMProjectResponse(data=data)
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/train", response_model=CMProjectResponse)
async def train(
    session_id: str,
    project_id: str,
    body: CMTrainRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """Retrain logistic regression with these settings; the run and the model are saved."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        async with _TRAIN_SLOTS:
            data = await asyncio.to_thread(service.train, project_id, session_id, body.params.model_dump(), body.model)
        return CMProjectResponse(data=data)
    except Exception as e:
        raise _http(e)


@router.put(PROJECT_PATH + "/state")
async def save_state(
    session_id: str,
    project_id: str,
    body: CMStateRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """Remember the learner's place: detail level, unsaved settings, the open run."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        state = await asyncio.to_thread(
            service.save_state, project_id, session_id, body.level,
            body.params.model_dump() if body.params else None, body.selectedRunId, body.model,
        )
        return {"success": True, "data": state}
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/start-over", response_model=CMProjectResponse)
async def start_over(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """Back to the start screen. Runs are kept; reopening a source shows them again."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        return CMProjectResponse(data=await asyncio.to_thread(service.start_over, project_id, session_id))
    except Exception as e:
        raise _http(e)


@router.get(PROJECT_PATH + "/sample", response_model=CMSampleResponse)
async def sample(
    session_id: str,
    project_id: str,
    page: int = Query(0, ge=0, le=100000),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """Four sample rows from the current dataset (two per class), rotating with the page."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        return CMSampleResponse(data=await asyncio.to_thread(service.sample, project_id, session_id, page))
    except Exception as e:
        raise _http(e)


@router.get(PROJECT_PATH + "/runs/{run_id}/examples", response_model=CMExamplesResponse)
async def examples(
    session_id: str,
    project_id: str,
    run_id: str,
    cell: str = Query(..., pattern=r"^(tp|fn|fp|tn)$"),
    limit: int = Query(5, ge=1, le=50),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: ConfusionMatrixService = Depends(get_cm_service),
):
    """The held-out items that landed in one box of a run's matrix, most decisive first."""
    await _assert_cm_project(session_id, project_id, project_service)
    try:
        items, total = await asyncio.to_thread(service.examples, project_id, session_id, run_id, cell, limit)
        return CMExamplesResponse(data=items, total=total)
    except Exception as e:
        raise _http(e)
