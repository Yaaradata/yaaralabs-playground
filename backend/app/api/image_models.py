"""The saved model of a Live Object Detection project (custom mode).

  GET    /api/image-models/session/{sid}/projects/{pid}                 null, or the model with 15-min read URLs
  POST   /api/image-models/session/{sid}/projects/{pid}/save            {files, labels, colors, accuracy}
                                                                        -> {uploadUrls, headers, direct}
  POST   /api/image-models/session/{sid}/projects/{pid}/complete        files arrived -> saved
  DELETE /api/image-models/session/{sid}/projects/{pid}                 files + record
  PUT    /api/image-models/session/{sid}/projects/{pid}/files/{name}    proxy upload (only when URLs can't be signed)
  GET    /api/image-models/session/{sid}/projects/{pid}/files/{name}    proxy download (same)

Every route checks the session and that the project belongs to it; anything else answers 404.
Proxy URLs are returned relative ("/api/..."); the browser prefixes the API base URL.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..services.image_model_service import ImageModelError, ImageModelNotFound, ImageModelService
from ..services.project_service import ProjectService
from .exercises import get_project_service, validate_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/image-models", tags=["image-models"])
P = "/session/{session_id}/projects/{project_id}"
PROJECT_TYPES = ("live-object-detection", "live-video-classification")


class SaveImageModelRequest(BaseModel):
    files: List[str] = Field(..., min_length=3, max_length=600)
    labels: List[str] = Field(default_factory=list, max_length=50)
    colors: List[str] = Field(default_factory=list, max_length=50)
    accuracy: Optional[float] = None


def get_service() -> ImageModelService:
    return ImageModelService()


def _http(e: Exception) -> HTTPException:
    if isinstance(e, HTTPException):
        return e
    if isinstance(e, ImageModelNotFound):
        return HTTPException(status_code=404, detail="Model not found")
    if isinstance(e, ImageModelError):
        return HTTPException(status_code=400, detail=str(e))
    logger.error("Image model request failed: %s", e, exc_info=True)
    return HTTPException(status_code=500, detail="Something went wrong. Please try again.")


async def _run(fn, *args):
    try:
        return {"success": True, "data": await asyncio.to_thread(fn, *args)}
    except Exception as e:
        raise _http(e)


class _Ctx:
    """Session check + 'this project is the caller's Live Object Detection project' (else 404)."""

    def __init__(self, session_id: str, project_id: str, _s: dict = Depends(validate_session),
                 projects: ProjectService = Depends(get_project_service), svc: ImageModelService = Depends(get_service)):
        self.sid, self.pid, self.projects, self.svc = session_id, project_id, projects, svc

    async def check(self) -> "_Ctx":
        project = await self.projects.get_project(self.pid)
        kind = str(getattr(project.type, "value", project.type)) if project else ""
        if not project or project.student_id != self.sid or kind not in PROJECT_TYPES:
            raise HTTPException(status_code=404, detail="Project not found")
        return self

    def proxy(self, project_id: str, name: str) -> str:
        return f"/api/image-models/session/{self.sid}/projects/{project_id}/files/{name}"


@router.get(P)
async def open_model(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.svc.open, ctx.sid, ctx.pid, ctx.proxy)


@router.post(P + "/save")
async def start_save(body: SaveImageModelRequest, ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.svc.start_save, ctx.sid, ctx.pid, body.files, body.labels, body.colors, body.accuracy, ctx.proxy)


@router.post(P + "/complete")
async def complete(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.svc.complete, ctx.sid, ctx.pid)


@router.delete(P)
async def delete_model(ctx: _Ctx = Depends()):
    await ctx.check()
    return await _run(ctx.svc.delete, ctx.sid, ctx.pid)


@router.put(P + "/files/{name:path}")
async def put_file(name: str, request: Request, ctx: _Ctx = Depends()):
    await ctx.check()
    data = await request.body()
    return await _run(ctx.svc.put_file, ctx.sid, ctx.pid, name, data, request.headers.get("content-type", ""))


@router.get(P + "/files/{name:path}")
async def get_file(name: str, ctx: _Ctx = Depends()):
    await ctx.check()
    try:
        data, ctype = await asyncio.to_thread(ctx.svc.get_file, ctx.sid, ctx.pid, name)
    except Exception as e:
        raise _http(e)
    return Response(content=data, media_type=ctype, headers={"Cache-Control": "private, max-age=300"})
