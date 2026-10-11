"""Text Classification projects (Day 1, Ex 2): finance packs, inspect and clean, train, type + Enter.

  GET    /datasets                                   the six packs
  GET    /datasets/{id}/sample?page=                 ten rows of a pack, as in the file
  GET    /session/{sid}/projects/{pid}               state, runs (with curves and scorecards), typed messages
  POST   …/dataset                                   step 1: choose a pack
  POST   …/inspect                                   step 2: the checks, and the dataset after cleaning
  PUT    …/state                                     remember the step, representation, settings, open run
  POST   …/train                                     step 4: train; the run and the model are saved
  POST   …/predict                                   step 5: label and confidence for a typed message
  PATCH  …/tries/{id}   DELETE …/tries/{id}           mark a message right/wrong, or delete it
  GET    …/runs/{runId}/examples?cell=tp|fn|fp|tn     held-out items in one box of the scorecard
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from ..models import (
    ProjectType,
    TCDatasetListResponse,
    TCDatasetRequest,
    TCExamplesResponse,
    TCInspectRequest,
    TCInspectResponse,
    TCPredictRequest,
    TCProjectResponse,
    TCSampleResponse,
    TCStateRequest,
    TCTrainRequest,
    TCTryPatch,
    TCTryResponse,
)
from ..services import tc_datasets
from ..services.project_service import ProjectService
from ..services.text_classification_service import TCBusy, TCError, TCNotFound, TextClassificationService
from .exercises import _TRAIN_SLOTS, get_project_service, validate_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/text-classification", tags=["text-classification"])

PROJECT_PATH = "/session/{session_id}/projects/{project_id}"


def get_tc_service() -> TextClassificationService:
    return TextClassificationService()


async def _assert_tc_project(session_id: str, project_id: str, project_service: ProjectService):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    if project.type != ProjectType.TEXT_CLASSIFICATION and str(project.type) != "text-classification":
        raise HTTPException(status_code=400, detail="This endpoint is only for text classification projects")
    return project


def _http(e: Exception) -> HTTPException:
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, TCNotFound):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, TCBusy):
        return HTTPException(status_code=409, detail=str(e))
    if isinstance(e, (TCError, ValueError)):
        return HTTPException(status_code=400, detail=str(e))
    if isinstance(e, LookupError):
        return HTTPException(status_code=404, detail=str(e))
    logger.error("Text classification request failed: %s", e, exc_info=True)
    return HTTPException(status_code=500, detail="Something went wrong. Please try again.")


# ── public: the packs ───────────────────────────────────────────


@router.get("/datasets", response_model=TCDatasetListResponse)
async def list_datasets():
    try:
        data = await asyncio.to_thread(lambda: [tc_datasets.info(i) for i in tc_datasets.PACK_IDS])
        return TCDatasetListResponse(data=data)
    except Exception as e:
        raise _http(e)


@router.get("/datasets/{dataset_id}/sample", response_model=TCSampleResponse)
async def dataset_sample(dataset_id: str, page: int = Query(0, ge=0, le=100000), size: int = Query(10, ge=1, le=50)):
    try:
        rows = await asyncio.to_thread(tc_datasets.sample, dataset_id, page, size)
        return TCSampleResponse(data=rows, total=tc_datasets.info(dataset_id)["n"])
    except Exception as e:
        raise _http(e)


# ── project ─────────────────────────────────────────────────────


@router.get(PROJECT_PATH, response_model=TCProjectResponse)
async def get_project(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        return TCProjectResponse(data=await asyncio.to_thread(service.view, project_id, session_id))
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/dataset", response_model=TCProjectResponse)
async def choose_dataset(
    session_id: str,
    project_id: str,
    body: TCDatasetRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        return TCProjectResponse(data=await asyncio.to_thread(service.choose_dataset, project_id, session_id, body.datasetId))
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/inspect", response_model=TCInspectResponse)
async def inspect(
    session_id: str,
    project_id: str,
    body: TCInspectRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        clean = body.clean.model_dump() if body.clean else None
        return TCInspectResponse(data=await asyncio.to_thread(service.inspect, project_id, session_id, clean))
    except Exception as e:
        raise _http(e)


@router.put(PROJECT_PATH + "/state")
async def save_state(
    session_id: str,
    project_id: str,
    body: TCStateRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        changes = body.model_dump(exclude_none=True)
        return {"success": True, "data": await asyncio.to_thread(service.save_state, project_id, session_id, changes)}
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/train", response_model=TCProjectResponse)
async def train(
    session_id: str,
    project_id: str,
    body: TCTrainRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        async with _TRAIN_SLOTS:
            data = await asyncio.to_thread(service.train, project_id, session_id, body.params.model_dump(),
                                           body.representation, body.preset, body.level)
        return TCProjectResponse(data=data)
    except Exception as e:
        raise _http(e)


@router.post(PROJECT_PATH + "/predict", response_model=TCTryResponse)
async def predict(
    session_id: str,
    project_id: str,
    body: TCPredictRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        return TCTryResponse(data=await asyncio.to_thread(service.predict, project_id, session_id, body.text, body.runId))
    except Exception as e:
        raise _http(e)


@router.patch(PROJECT_PATH + "/tries/{try_id}", response_model=TCTryResponse)
async def mark_try(
    session_id: str,
    project_id: str,
    try_id: str,
    body: TCTryPatch,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        return TCTryResponse(data=await asyncio.to_thread(service.mark_try, project_id, try_id, body.verdict))
    except Exception as e:
        raise _http(e)


@router.delete(PROJECT_PATH + "/tries/{try_id}")
async def delete_try(
    session_id: str,
    project_id: str,
    try_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        await asyncio.to_thread(service.delete_try, project_id, try_id)
        return {"success": True}
    except Exception as e:
        raise _http(e)


@router.get(PROJECT_PATH + "/runs/{run_id}/examples", response_model=TCExamplesResponse)
async def examples(
    session_id: str,
    project_id: str,
    run_id: str,
    cell: str = Query(..., pattern=r"^(tp|fn|fp|tn)$"),
    limit: int = Query(5, ge=1, le=50),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: TextClassificationService = Depends(get_tc_service),
):
    await _assert_tc_project(session_id, project_id, project_service)
    try:
        items, total = await asyncio.to_thread(service.examples, project_id, run_id, cell, limit)
        return TCExamplesResponse(data=items, total=total)
    except Exception as e:
        raise _http(e)
