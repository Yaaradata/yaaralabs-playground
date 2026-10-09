"""Exercise 4 HTTP routes. Registered on the exercises router."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.datastructures import UploadFile as StarletteUpload
from pydantic import BaseModel, Field

from ..services import exercises_vision_service as vision

logger = logging.getLogger(__name__)


class SampleBody(BaseModel):
    department: str = Field(min_length=2, max_length=20)


class DepartmentBody(BaseModel):
    department: str = Field(min_length=2, max_length=20)


class PoolBody(BaseModel):
    mode: str


class ShareBody(BaseModel):
    percent: int = Field(ge=0, le=90)


class KeepBody(BaseModel):
    name: str
    kept: bool


class TrainBody(BaseModel):
    model: str
    params: dict[str, object] | None = None
    frac: float = 1


class PredictBody(BaseModel):
    runId: str
    index: int


def _path_list(field: object) -> list[str]:
    if not isinstance(field, str):
        return []
    text = field.strip()
    if text.startswith("["):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            return [item.strip() for item in parsed if isinstance(item, str) and item.strip()]
    return [item.strip() for item in field.split("\n") if item.strip()]


def _fail(exc: Exception) -> HTTPException:
    if isinstance(exc, vision.VisionError):
        return HTTPException(status_code=exc.status, detail=str(exc))
    logger.error("Exercise 4 failed: %s", exc, exc_info=True)
    return HTTPException(status_code=500, detail=str(exc))


def register_vision_routes(
    router: APIRouter,
    validate_session: Callable,
    get_project_service: Callable,
    assert_project: Callable,
) -> None:
    @router.get("/session/{session_id}/projects/{project_id}/vision/catalog")
    async def vision_catalog(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return vision.catalog()

    @router.get("/session/{session_id}/projects/{project_id}/vision/state")
    async def vision_state(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        return vision.state(session_id, project_id)

    @router.post("/session/{session_id}/projects/{project_id}/vision/ingest")
    async def vision_ingest(
        session_id: str,
        project_id: str,
        request: Request,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        # A class folder can hold thousands of images, and the path list is one part.
        form = await request.form(max_files=8000, max_fields=8100, max_part_size=8 * 1024 * 1024)
        forced_raw = form.get("forced")
        force = forced_raw if isinstance(forced_raw, str) and forced_raw in ("train", "test") else None
        replace_raw = form.get("replace")
        replace = force is None and isinstance(replace_raw, str) and replace_raw in ("1", "true", "yes")
        try:
            zip_item = form.get("zip_file")
            if isinstance(zip_item, StarletteUpload) and zip_item.filename:
                raw = await zip_item.read()
                return await asyncio.to_thread(vision.ingest_zip, session_id, project_id, raw, force, replace)
            names_field = form.get("paths")
            names = _path_list(names_field)
            payload: list[tuple[str, bytes]] = []
            for index, item in enumerate(form.getlist("files")):
                if not isinstance(item, StarletteUpload):
                    continue
                raw = await item.read()
                path = names[index].strip() if index < len(names) and names[index].strip() else (item.filename or f"image-{index}.png")
                payload.append((path, raw))
            if not payload:
                raise vision.VisionError("Choose a folder or a zip file.")
            return await asyncio.to_thread(vision.ingest_files, session_id, project_id, payload, force, replace)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/department")
    async def vision_department(
        session_id: str,
        project_id: str,
        body: DepartmentBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.set_department(session_id, project_id, body.department)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/sample")
    async def vision_sample(
        session_id: str,
        project_id: str,
        body: SampleBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return await asyncio.to_thread(vision.load_sample, session_id, project_id, body.department)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/pool")
    async def vision_pool(
        session_id: str,
        project_id: str,
        body: PoolBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.apply_pool(session_id, project_id, body.mode)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/share")
    async def vision_share(
        session_id: str,
        project_id: str,
        body: ShareBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.set_test_share(session_id, project_id, body.percent)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/keep")
    async def vision_keep(
        session_id: str,
        project_id: str,
        body: KeepBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.set_class_kept(session_id, project_id, body.name, body.kept)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/fixtest")
    async def vision_fixtest(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.fix_test(session_id, project_id)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/prepare")
    async def vision_prepare(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return await asyncio.to_thread(vision.prepare, session_id, project_id)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/clear")
    async def vision_clear(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.clear(session_id, project_id)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/train")
    async def vision_train(
        session_id: str,
        project_id: str,
        body: TrainBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.start_train(session_id, project_id, body.model, body.params, body.frac, background=True)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.get("/session/{session_id}/projects/{project_id}/vision/runs/{run_id}")
    async def vision_run(
        session_id: str,
        project_id: str,
        run_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.run_snapshot(session_id, project_id, run_id)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/runs/{run_id}/stop")
    async def vision_stop(
        session_id: str,
        project_id: str,
        run_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.stop_train(session_id, project_id, run_id)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/predict")
    async def vision_predict(
        session_id: str,
        project_id: str,
        body: PredictBody,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            return vision.predict_index(session_id, project_id, body.runId, body.index)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.post("/session/{session_id}/projects/{project_id}/vision/predict-file")
    async def vision_predict_file(
        session_id: str,
        project_id: str,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
        run_id: str = Form(...),
        file: UploadFile = File(...),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            raw = await file.read()
            return await asyncio.to_thread(vision.predict_upload, session_id, project_id, run_id, raw)
        except Exception as exc:
            raise _fail(exc) from exc

    @router.get("/session/{session_id}/projects/{project_id}/vision/images/{index}")
    async def vision_image(
        session_id: str,
        project_id: str,
        index: int,
        session: dict = Depends(validate_session),
        project_service=Depends(get_project_service),
    ):
        await assert_project(session_id, project_id, project_service)
        try:
            blob = vision.image_bytes(session_id, project_id, index)
        except Exception as exc:
            raise _fail(exc) from exc
        return Response(
            content=blob,
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=3600"},
        )
