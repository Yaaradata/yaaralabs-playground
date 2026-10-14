"""Copilot labs (Ex 9 AI Ethics, Ex 10 Document AI): save and load the participant's worksheet answers.

The labs run in Microsoft Copilot. This router stores ticks, choices and short notes only; no AI calls happen here.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from ..services.copilot_lab_service import ACTIVITY_BY_TYPE, MAX_ANSWERS_BYTES, CopilotLabError, CopilotLabService
from ..services.project_service import ProjectService
from .exercises import get_project_service, validate_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/copilot-lab", tags=["copilot-lab"])

PROJECT_PATH = "/session/{session_id}/projects/{project_id}"
MAX_BODY_BYTES = MAX_ANSWERS_BYTES + 4 * 1024  # answers plus the step list


def get_copilot_service() -> CopilotLabService:
    return CopilotLabService()


async def _assert_copilot_project(session_id: str, project_id: str, project_service: ProjectService) -> str:
    """The project's activity ('ethics' or 'document-ai') once it belongs to this session and is a Copilot lab."""
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    kind = str(getattr(project.type, "value", project.type))
    if kind not in ACTIVITY_BY_TYPE:
        raise HTTPException(status_code=400, detail="This endpoint is only for Copilot lab projects")
    return ACTIVITY_BY_TYPE[kind]


@router.get(PROJECT_PATH)
async def get_lab(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: CopilotLabService = Depends(get_copilot_service),
):
    """Saved answers and finished steps; empty answers when nothing has been saved."""
    activity = await _assert_copilot_project(session_id, project_id, project_service)
    return {"success": True, "data": await asyncio.to_thread(service.get, project_id, session_id, activity)}


@router.put(PROJECT_PATH)
async def save_lab(
    session_id: str,
    project_id: str,
    request: Request,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: CopilotLabService = Depends(get_copilot_service),
):
    """Save {answers, completedSteps}. Answers up to 20 KB of JSON; each note up to 300 characters, trimmed."""
    activity = await _assert_copilot_project(session_id, project_id, project_service)
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Answers are too large.")
    try:
        body: Dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Send JSON: {answers, completedSteps}.")
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Send JSON: {answers, completedSteps}.")
    answers: Any = body.get("answers", {})
    steps: Optional[List[str]] = body.get("completedSteps", [])
    try:
        data = await asyncio.to_thread(service.save, project_id, session_id, activity, answers, steps)
    except CopilotLabError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "data": data}


@router.delete(PROJECT_PATH)
async def clear_lab(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    service: CopilotLabService = Depends(get_copilot_service),
):
    """Start again: clear this lab's answers."""
    await _assert_copilot_project(session_id, project_id, project_service)
    await asyncio.to_thread(service.delete, project_id, session_id)
    return {"success": True}
