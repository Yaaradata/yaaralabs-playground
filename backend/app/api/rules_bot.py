"""Rules Bot API: samples and per-project rule boards for Rule Based Process projects."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from ..models import (
    RulesBotBoardResponse,
    RulesBotBoardState,
    RulesBotLoadSampleRequest,
    RulesBotSampleListResponse,
    RulesBotSampleResponse,
)
from ..services.project_service import ProjectService
from ..services.rules_bot_service import RulesBotService, SampleNotFound
from .rule_based_process import _assert_rbp_project, get_project_service, validate_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rules-bot", tags=["rules-bot"])

BOARD_PATH = "/session/{session_id}/projects/{project_id}/board"


def get_rules_bot_service() -> RulesBotService:
    return RulesBotService()


# ── samples (public: no project data) ───────────────────────────

@router.get("/samples", response_model=RulesBotSampleListResponse)
async def list_samples(service: RulesBotService = Depends(get_rules_bot_service)):
    """Ready-made rule sets for the Samples menu."""
    try:
        return RulesBotSampleListResponse(data=await run_in_threadpool(service.list_samples))
    except Exception as e:
        logger.error("Rules Bot list_samples failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Could not load samples")


@router.get("/samples/{sample_id}", response_model=RulesBotSampleResponse)
async def get_sample(sample_id: str, service: RulesBotService = Depends(get_rules_bot_service)):
    try:
        return RulesBotSampleResponse(data=await run_in_threadpool(service.get_sample, sample_id))
    except SampleNotFound:
        raise HTTPException(status_code=404, detail="Sample not found")


# ── a project's board ───────────────────────────────────────────

@router.get(BOARD_PATH, response_model=RulesBotBoardResponse)
async def get_board(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: RulesBotService = Depends(get_rules_bot_service),
):
    """The project's rules (an empty board until first saved)."""
    await _assert_rbp_project(session_id, project_id, project_service)
    return RulesBotBoardResponse(data=await run_in_threadpool(service.get_board, project_id, session_id))


@router.put(BOARD_PATH, response_model=RulesBotBoardResponse)
async def save_board(
    session_id: str,
    project_id: str,
    body: RulesBotBoardState,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: RulesBotService = Depends(get_rules_bot_service),
):
    """Save the whole board: rules in order, the fallback reply and the sample it came from."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        return RulesBotBoardResponse(data=await run_in_threadpool(service.save_board, project_id, session_id, body))
    except Exception as e:
        logger.error("Rules Bot save_board failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Could not save rules")


@router.post(BOARD_PATH + "/load-sample", response_model=RulesBotBoardResponse)
async def load_sample(
    session_id: str,
    project_id: str,
    body: RulesBotLoadSampleRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: RulesBotService = Depends(get_rules_bot_service),
):
    """Replace the board with a copy of a sample."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        return RulesBotBoardResponse(
            data=await run_in_threadpool(service.load_sample, project_id, session_id, body.sampleId)
        )
    except SampleNotFound:
        raise HTTPException(status_code=404, detail="Sample not found")


@router.post(BOARD_PATH + "/reset", response_model=RulesBotBoardResponse)
async def reset_board(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: RulesBotService = Depends(get_rules_bot_service),
):
    """Clear all rules and restore the default fallback reply."""
    await _assert_rbp_project(session_id, project_id, project_service)
    return RulesBotBoardResponse(data=await run_in_threadpool(service.reset_board, project_id, session_id))
