"""Isolated Live Object Detection API — does not alter other project-type flows."""

from __future__ import annotations

import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException

from ..models import (
    LodCaptionRequest,
    LodCaptionResponse,
    LodDetectRequest,
    LodDetectResponse,
    ProjectType,
)
from ..services.guest_service import GuestService
from ..services.live_object_detection_service import LiveObjectDetectionService
from ..services.lod_limiter import (
    CAPTION_MAX_HITS,
    CAPTION_WINDOW_S,
    DETECT_MAX_HITS,
    DETECT_WINDOW_S,
    lod_limiter,
)
from ..services.project_service import ProjectService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lod", tags=["live-object-detection"])


def get_guest_service() -> GuestService:
    return GuestService()


def get_project_service() -> ProjectService:
    return ProjectService()


def get_lod_service() -> LiveObjectDetectionService:
    return LiveObjectDetectionService()


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


async def _assert_lod_project(session_id: str, project_id: str, project_service: ProjectService):
    project = await project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.student_id != session_id:
        raise HTTPException(status_code=403, detail="Project not accessible for this session")
    # Standalone LOD projects and Exercise 4.5 (exercises workspace) both use these routes.
    allowed = {
        ProjectType.LIVE_OBJECT_DETECTION,
        ProjectType.EXERCISES,
        "live-object-detection",
        "exercises",
    }
    if project.type not in allowed and str(project.type) not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Live object detection is only available for Live Object Detection or Exercises projects",
        )
    return project


def _enforce_limit(session_id: str, action: str, max_hits: int, window_s: float) -> None:
    if not lod_limiter.allow(session_id, action, max_hits, window_s):
        raise HTTPException(
            status_code=429,
            detail="Too many live detection requests. Wait a moment and try again.",
        )


@router.post(
    "/session/{session_id}/projects/{project_id}/detect",
    response_model=LodDetectResponse,
)
async def detect_objects(
    session_id: str,
    project_id: str,
    body: LodDetectRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    lod_service: LiveObjectDetectionService = Depends(get_lod_service),
):
    """Run Cloud Vision object localization on a live webcam frame."""
    await _assert_lod_project(session_id, project_id, project_service)
    _enforce_limit(session_id, "detect", DETECT_MAX_HITS, DETECT_WINDOW_S)
    try:
        objects = await asyncio.to_thread(lod_service.detect, body.image_base64)
        return LodDetectResponse(objects=objects)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("LOD Cloud Vision detect failed: %s", e, exc_info=True)
        # the vision service failed, not our server: 502 with the same friendly message
        raise HTTPException(status_code=502, detail="Could not detect objects in this frame")


@router.post(
    "/session/{session_id}/projects/{project_id}/caption",
    response_model=LodCaptionResponse,
)
async def caption_scene(
    session_id: str,
    project_id: str,
    body: LodCaptionRequest,
    session: dict = Depends(validate_session),
    project_service: ProjectService = Depends(get_project_service),
    lod_service: LiveObjectDetectionService = Depends(get_lod_service),
):
    """Generate a one-sentence live action caption from a camera frame."""
    await _assert_lod_project(session_id, project_id, project_service)
    _enforce_limit(session_id, "caption", CAPTION_MAX_HITS, CAPTION_WINDOW_S)
    try:
        caption, objects = await asyncio.to_thread(lod_service.caption, body)
        return LodCaptionResponse(caption=caption, objects=objects)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("LOD caption failed: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="Could not generate a caption")  # the model failed, not our server
