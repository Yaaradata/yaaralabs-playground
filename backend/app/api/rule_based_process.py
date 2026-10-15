"""Isolated Rule Based Process API — does not alter other project-type flows."""

from __future__ import annotations

import asyncio

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from starlette.concurrency import run_in_threadpool

from .rate_limits import rate_limit
from ..models import (
    ProjectType,
    RuleBasedAskRequest,
    RuleBasedAskResponse,
    RuleBasedWorkspaceDeleteResponse,
    RuleBasedWorkspaceResponse,
    RuleBasedWorkspaceUpdate,
    ScratchProjectMetaResponse,
    ScratchProjectSaveResponse,
)
from ..services.guest_service import GuestService
from ..services.project_service import ProjectService
from ..services.rule_based_process_service import RuleBasedProcessService
from ..services.scratch_project_service import (
    MAX_PROJECT_JSON_BYTES,
    MAX_SB3_BYTES,
    SB3_CONTENT_TYPE,
    InvalidScratchProject,
    ScratchProjectService,
    ScratchVersionConflict,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rbp", tags=["rule-based-process"])


def get_guest_service() -> GuestService:
    return GuestService()


def get_project_service() -> ProjectService:
    return ProjectService()


def get_rbp_service() -> RuleBasedProcessService:
    return RuleBasedProcessService()


def get_scratch_service() -> ScratchProjectService:
    return ScratchProjectService()


async def validate_session(session_id: str, guest_service: GuestService = Depends(get_guest_service)):
    try:
        return await guest_service.validate_session(session_id)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=msg)
        if "expired" in msg:
            raise HTTPException(status_code=410, detail=msg)
        if "inactive" in msg:
            raise HTTPException(status_code=403, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Session validation error: {e}")


async def _assert_rbp_project(
    session_id: str,
    project_id: str,
    project_service: ProjectService,
):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    if project.type != ProjectType.RULE_BASED_PROCESS and str(project.type) != "rule-based-process":
        raise HTTPException(
            status_code=400,
            detail="This endpoint is only for rule-based-process projects",
        )
    return project


@router.get(
    "/session/{session_id}/projects/{project_id}/workspace",
    response_model=RuleBasedWorkspaceResponse,
)
async def get_workspace(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    rbp_service: RuleBasedProcessService = Depends(get_rbp_service),
):
    """Load (or lazily create) the Rule Based Process workspace for a project."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        workspace = await asyncio.to_thread(rbp_service.get_or_create, project_id, session_id)
        return RuleBasedWorkspaceResponse(data=workspace)
    except Exception as e:
        logger.error("RBP get_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.put(
    "/session/{session_id}/projects/{project_id}/workspace",
    response_model=RuleBasedWorkspaceResponse,
)
async def save_workspace(
    session_id: str,
    project_id: str,
    body: RuleBasedWorkspaceUpdate,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    rbp_service: RuleBasedProcessService = Depends(get_rbp_service),
):
    """Persist concepts, block stacks, and pan for a Rule Based Process project."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        workspace = await asyncio.to_thread(rbp_service.save, project_id, session_id, body.state)
        return RuleBasedWorkspaceResponse(data=workspace)
    except Exception as e:
        logger.error("RBP save_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/workspace/reset",
    response_model=RuleBasedWorkspaceResponse,
)
async def reset_workspace(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    rbp_service: RuleBasedProcessService = Depends(get_rbp_service),
):
    """Reset workspace to default concepts and an empty block canvas."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        workspace = await asyncio.to_thread(rbp_service.reset, project_id, session_id)
        return RuleBasedWorkspaceResponse(data=workspace)
    except Exception as e:
        logger.error("RBP reset_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/session/{session_id}/projects/{project_id}/ask",
    dependencies=[Depends(rate_limit("rbp ask"))],
    response_model=RuleBasedAskResponse,
)
async def ask_model(
    session_id: str,
    project_id: str,
    body: RuleBasedAskRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    rbp_service: RuleBasedProcessService = Depends(get_rbp_service),
):
    """Ask the classroom LLM for a short answer (Model blocks)."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        reply = await asyncio.to_thread(rbp_service.ask_model, body.prompt)  # 2-10 s model call: off the event loop
        return RuleBasedAskResponse(reply=reply, prompt=body.prompt.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("RBP ask_model failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete(
    "/session/{session_id}/projects/{project_id}/workspace",
    response_model=RuleBasedWorkspaceDeleteResponse,
)
async def delete_workspace(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    rbp_service: RuleBasedProcessService = Depends(get_rbp_service),
):
    """Delete persisted workspace document (project shell remains)."""
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        deleted = await asyncio.to_thread(rbp_service.delete, project_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Workspace not found")
        return RuleBasedWorkspaceDeleteResponse()
    except HTTPException:
        raise
    except Exception as e:
        logger.error("RBP delete_workspace failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Scratch editor project (.sb3) — Rule Based Process projects edited in Scratch
# ---------------------------------------------------------------------------

SCRATCH_PATH = "/session/{session_id}/projects/{project_id}/scratch"


def _parse_if_match(if_match: Optional[str]) -> int:
    """If-Match carries the version the editor loaded (0 when nothing was saved yet)."""
    if if_match is None or not if_match.strip():
        raise HTTPException(
            status_code=428,
            detail="If-Match header with the loaded project version is required",
        )
    value = if_match.strip()
    if value.startswith("W/"):
        value = value[2:]
    value = value.strip('"')
    try:
        version = int(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="If-Match must be the project version number")
    if version < 0:
        raise HTTPException(status_code=400, detail="If-Match must be the project version number")
    return version


async def _read_body(request: Request, limit: int, what: str) -> bytes:
    """Read the raw request body, refusing anything over `limit` bytes without buffering it all."""
    too_large = HTTPException(
        status_code=413,
        detail=f"{what} is too large (limit {limit // (1024 * 1024)} MB)",
    )
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise too_large
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_large
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(status_code=400, detail=f"{what} is empty")
    return b"".join(chunks)


def _version_headers(version: int) -> dict:
    return {
        "X-Scratch-Version": str(version),
        "ETag": f'"{version}"',
        "Cache-Control": "no-store",
    }


def _save_response(meta) -> ScratchProjectSaveResponse:
    return ScratchProjectSaveResponse(savedAt=meta.saved_at, sizeBytes=meta.size_bytes, version=meta.version)


def _conflict(e: ScratchVersionConflict) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "message": "This project was saved from another tab or window. Reload to get the latest version.",
            "currentVersion": e.current_version,
        },
    )


@router.get(SCRATCH_PATH)
async def get_scratch_project(
    session_id: str,
    project_id: str,
    client_id: Optional[str] = Query(None, alias="clientId"),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    scratch_service: ScratchProjectService = Depends(get_scratch_service),
):
    """Download the saved Scratch project (.sb3). 204 when nothing has been saved yet.

    The X-Scratch-Version header is the version to send back as If-Match when saving.
    With ?clientId=, the calling editor tab becomes the one allowed to save; tabs that
    opened the project earlier get 409 on their next save.
    """
    await _assert_rbp_project(session_id, project_id, project_service)
    try:
        data, version = await run_in_threadpool(scratch_service.load, project_id, client_id)
    except Exception as e:
        logger.error("RBP get_scratch_project failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    if data is None:
        return Response(status_code=204, headers=_version_headers(version))
    return Response(content=data, media_type=SB3_CONTENT_TYPE, headers=_version_headers(version))


@router.get(SCRATCH_PATH + "/meta", response_model=ScratchProjectMetaResponse)
async def get_scratch_project_meta(
    session_id: str,
    project_id: str,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    scratch_service: ScratchProjectService = Depends(get_scratch_service),
):
    """Saved time, size and version of the Scratch project, plus which editor the project uses."""
    project = await _assert_rbp_project(session_id, project_id, project_service)
    try:
        meta = await run_in_threadpool(scratch_service.meta, project_id)
        editor = await run_in_threadpool(scratch_service.resolve_editor, project_id, getattr(project, "rbpEditor", None))
    except Exception as e:
        logger.error("RBP get_scratch_project_meta failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    return ScratchProjectMetaResponse(
        savedAt=meta.saved_at, sizeBytes=meta.size_bytes, version=meta.version, editor=editor
    )


@router.put(SCRATCH_PATH, response_model=ScratchProjectSaveResponse)
async def save_scratch_project(
    session_id: str,
    project_id: str,
    request: Request,
    if_match: Optional[str] = Header(None),
    x_client_id: Optional[str] = Header(None),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    scratch_service: ScratchProjectService = Depends(get_scratch_service),
):
    """Save the whole Scratch project. Body: the raw .sb3 file. Header If-Match: loaded version."""
    await _assert_rbp_project(session_id, project_id, project_service)
    expected = _parse_if_match(if_match)
    data = await _read_body(request, MAX_SB3_BYTES, "Scratch project")
    try:
        meta = await run_in_threadpool(scratch_service.save, project_id, data, expected, x_client_id)
    except InvalidScratchProject as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ScratchVersionConflict as e:
        raise _conflict(e)
    except Exception as e:
        logger.error("RBP save_scratch_project failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    return _save_response(meta)


@router.post(SCRATCH_PATH + "/project-json", response_model=ScratchProjectSaveResponse)
async def save_scratch_project_json(
    session_id: str,
    project_id: str,
    request: Request,
    version: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None, alias="clientId"),
    if_match: Optional[str] = Header(None),
    x_client_id: Optional[str] = Header(None),
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    scratch_service: ScratchProjectService = Depends(get_scratch_service),
):
    """Save only project.json (blocks, sprites, variables), keeping saved costumes and sounds.

    Used by the editor while its tab is closing or reloading: that request must be small and
    must not need a CORS preflight, so it is a plain-text POST and the loaded version and
    client id may be sent as ?version= and ?clientId= instead of headers.
    """
    await _assert_rbp_project(session_id, project_id, project_service)
    expected = _parse_if_match(version if version is not None else if_match)
    x_client_id = client_id or x_client_id
    data = await _read_body(request, MAX_PROJECT_JSON_BYTES, "project.json")
    try:
        meta = await run_in_threadpool(scratch_service.save_project_json, project_id, data, expected, x_client_id)
    except InvalidScratchProject as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ScratchVersionConflict as e:
        raise _conflict(e)
    except Exception as e:
        logger.error("RBP save_scratch_project_json failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    return _save_response(meta)
