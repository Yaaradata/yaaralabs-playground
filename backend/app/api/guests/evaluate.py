"""POST /api/guests/session/{session_id}/projects/{project_id}/evaluate: the Evaluate step of a Text
Recognition project. See app/services/text_evaluate_service.py.

With ?stream=1 the reply is NDJSON: a {"stage", "done", "total"} line after each message, so the page
can show "Tested 6 of 14", then {"result": ...} or {"error": ..., "status": ...} as the last line."""

import asyncio
import json
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ...config import gcp_clients
from ...services.guest_service import GuestService
from ...services.text_evaluate_service import (
    MAX_ITEMS,
    MAX_TEXT,
    EvaluateError,
    deployed_scorer,
    evaluate,
    project_examples,
)
from ..off_loop import off_loop
from .guests import get_guest_service, validate_session_dependency

logger = logging.getLogger(__name__)

router = APIRouter()  # included in the guests router, so it shares the /api/guests prefix


class EvaluateItem(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT)
    expected: str = Field(..., min_length=1, max_length=100)


class EvaluateRequest(BaseModel):
    items: List[EvaluateItem] = Field(default_factory=list, max_length=MAX_ITEMS)


@router.post("/session/{session_id}/projects/{project_id}/evaluate", response_model=dict)
async def evaluate_guest_text(
    session_id: str,
    project_id: str,
    request: EvaluateRequest,
    stream: bool = False,
    session: dict = Depends(validate_session_dependency),
    guest_service: GuestService = Depends(get_guest_service),
):
    """Score the exam messages (or the learner's own examples, held out one at a time) with the trained model."""
    guest_project = await off_loop(guest_service.get_guest_project_by_id, project_id)
    if not guest_project:
        raise HTTPException(status_code=404, detail="Guest project not found")
    if guest_project.get("createdBy") != f"guest:{session_id}":
        raise HTTPException(status_code=404, detail="Project not found in this session")
    if guest_project.get("type", "text-recognition") != "text-recognition":
        raise HTTPException(status_code=400, detail="Evaluate is available for Text recognition projects.")
    if guest_project.get("status") != "trained":
        raise HTTPException(status_code=400, detail="Project is not trained yet. Train the model first.")

    model_info = guest_project.get("model", {}) or {}
    model_type = model_info.get("modelType", "logistic_regression")
    gcs_path = model_info.get("gcsPath")
    if not gcs_path:
        raise HTTPException(status_code=400, detail="Model not found. Please train the model again.")

    examples = project_examples(guest_project)
    labels = list(model_info.get("labels") or sorted({ex["label"] for ex in examples}))
    items = [item.model_dump() for item in request.items]

    def run(progress=None):
        score, own_examples, cleanup = deployed_scorer(model_type, labels, gcp_clients.get_bucket(), gcs_path)
        try:
            return evaluate(score, model_type, labels, examples, items, own_examples, progress)
        finally:
            cleanup()

    if stream:
        return StreamingResponse(_stream(run, project_id), media_type="application/x-ndjson")
    try:
        return await asyncio.get_event_loop().run_in_executor(None, run)
    except Exception as e:  # noqa: BLE001
        status, detail = _failure(e, project_id)
        raise HTTPException(status_code=status, detail=detail)


def _failure(e: Exception, project_id: str):
    if isinstance(e, EvaluateError):
        return 400, str(e)
    if isinstance(e, FileNotFoundError):
        return 404, "Your model was not found. Train it again on the training page."
    logger.exception("Evaluate failed for project %s", project_id, exc_info=e)
    return 500, str(e)


async def _stream(run, project_id: str):
    """Run the exam in a thread; yield a progress line after each message, then the result."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def progress(stage: str, done: int, total: int) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, {"stage": stage, "done": done, "total": total})

    task = loop.run_in_executor(None, run, progress)
    task.add_done_callback(lambda _: loop.call_soon_threadsafe(queue.put_nowait, None))
    yield _line({"stage": "loading", "done": 0, "total": 0})
    while (line := await queue.get()) is not None:
        yield _line(line)
    try:
        yield _line({"result": task.result()})
    except Exception as e:  # noqa: BLE001
        status, detail = _failure(e, project_id)
        yield _line({"error": detail, "status": status})


def _line(obj) -> str:
    return json.dumps(obj) + chr(10)
