"""Deployed models: a trained Text / Image Recognition or custom Live Object Detection model at its own URL.

Export on the training page (POST .../projects/{id}/deploy) gives the URL. Any app or website can
call it (main.py opens CORS for these routes), and the Use the AI page calls it too. No session is
needed: the URL itself is the key, like a deployed model endpoint.

    GET  /api/deployed/{deploy_id}           the model's name, type, labels and when it was trained
    POST /api/deployed/{deploy_id}/predict   -> label, confidence, alternatives
         text models (txt-...):   JSON {"text": "..."}
         image models (img-...):  an image upload (multipart field "file"), or JSON {"imageUrl": "https://..."}

Live Object Detection models (vid-...) run in the browser, like Teachable Machine: the URL serves the
model files instead of a predict route.
    GET  /api/deployed/{deploy_id}/model.json | metadata.json | weights.bin
         e.g. tmImage.load(url + "/model.json", url + "/metadata.json")
"""

import asyncio
import logging
import mimetypes
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from starlette.datastructures import UploadFile

from ..config import gcp_clients
from ..models import PredictionResponse
from ..services.guest_service import GuestService
from ..services.image_url_fetcher import ImageUrlError, fetch_image_from_url
from ..services.image_model_service import MODEL_FILES, ImageModelService
from .guests.guests import BROWSER_MODEL_TYPES, DEPLOYABLE_TYPES, browser_model_ready, get_guest_service, predict_with_project

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/deployed", tags=["deployed-models"])

DEPLOY_ID = re.compile(r"^(txt|img|vid)-[0-9a-f]{16}$")
IMAGE_TYPES = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024


async def _deployed_project(deploy_id: str, guest_service: GuestService) -> dict:
    if not DEPLOY_ID.match(deploy_id):
        raise HTTPException(status_code=404, detail="No deployed model at this URL.")
    docs = guest_service.projects_collection.where("deployment.id", "==", deploy_id).limit(1).stream()
    project = next((d.to_dict() for d in docs), None)
    if not project or project.get("type") not in DEPLOYABLE_TYPES:
        raise HTTPException(status_code=404, detail="No deployed model at this URL. Export it again from the training page.")
    if project.get("type") in BROWSER_MODEL_TYPES:
        record = await asyncio.to_thread(browser_model_ready, project.get("student_id", ""), project.get("id", ""))
        if not record:
            raise HTTPException(status_code=409, detail="This model was deleted. Train it again on the project page.")
        return {**project, "browserModel": record}
    if project.get("status") == "training":
        raise HTTPException(status_code=409, detail="This model is being trained again. Try again when training finishes.")
    if project.get("status") != "trained":
        raise HTTPException(status_code=409, detail="This model was deleted. Train it again on the Train the AI page.")
    return project


async def _read_json(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        body = None
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Send JSON, e.g. {\"text\": \"...\"}.")
    return body


async def _image_to_gcs(request: Request, project: dict) -> str:
    """The image sent to an image model (upload or imageUrl), stored as a prediction-only file
    (predictions/{project}/, not training data). Returns its gs:// URL for the model."""
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file") or form.get("image")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=400, detail="Send the image in a form field named \"file\".")
        content_type = (upload.content_type or "").lower()
        if content_type not in IMAGE_TYPES:  # some apps send no type: go by the file name
            content_type = (mimetypes.guess_type(upload.filename or "")[0] or "").lower()
        if content_type not in IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="Only JPEG, PNG, GIF and WebP images are allowed.")
        content = await upload.read()
    else:
        image_url = str((await _read_json(request)).get("imageUrl") or "").strip()
        if not image_url:
            raise HTTPException(status_code=400, detail="Send an image as a \"file\" upload, or JSON {\"imageUrl\": \"https://...\"}.")
        try:
            content, content_type, _ = await fetch_image_from_url(image_url)
        except ImageUrlError as e:
            raise HTTPException(status_code=400, detail=str(e))
        content_type = (content_type or "image/jpeg").lower()
    if not content:
        raise HTTPException(status_code=400, detail="The image is empty.")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="The image is too large. Maximum size is 10 MB.")
    bucket = gcp_clients.get_bucket()
    path = f"predictions/{project['id']}/deployed-{uuid.uuid4().hex[:12]}.{IMAGE_TYPES.get(content_type, 'jpg')}"
    bucket.blob(path).upload_from_string(content, content_type=content_type)
    return f"gs://{bucket.name}/{path}"


@router.get("/{deploy_id}", response_model=dict)
async def deployed_model_info(deploy_id: str, guest_service: GuestService = Depends(get_guest_service)):
    project = await _deployed_project(deploy_id, guest_service)
    browser = project.get("browserModel")
    if browser:
        return {
            "success": True,
            "name": project.get("name", ""),
            "type": project.get("type"),
            "modelType": "teachable_machine_image",
            "labels": [str(label) for label in browser.get("labels", [])],
            "colors": browser.get("colors", []),
            "trainedAt": browser.get("saved_at"),
            "input": "video",
            "files": list(MODEL_FILES),
        }
    model = project.get("model") or {}
    labels = model.get("labels") or (project.get("dataset") or {}).get("labels") or []
    return {
        "success": True,
        "name": project.get("name", ""),
        "type": project.get("type"),
        "modelType": model.get("modelType"),
        "labels": [str(label) for label in labels],
        "trainedAt": model.get("trainedAt"),
        "input": "image" if project.get("type") == "image-recognition" else "text",
    }


@router.post("/{deploy_id}/predict", response_model=PredictionResponse)
async def deployed_model_predict(
    deploy_id: str,
    request: Request,
    guest_service: GuestService = Depends(get_guest_service),
):
    project = await _deployed_project(deploy_id, guest_service)
    if project.get("browserModel"):
        raise HTTPException(status_code=400, detail="This model runs in the browser: load its model.json and metadata.json from this URL.")
    if project.get("type") == "image-recognition":
        return await predict_with_project(project, await _image_to_gcs(request, project))
    text = str((await _read_json(request)).get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Send the message as JSON: {\"text\": \"...\"}.")
    return await predict_with_project(project, text)


@router.get("/{deploy_id}/{name}")
async def deployed_model_file(deploy_id: str, name: str, guest_service: GuestService = Depends(get_guest_service)):
    """Live Object Detection: the model's files (Teachable Machine layout), for any app to load."""
    if name not in MODEL_FILES:
        raise HTTPException(status_code=404, detail="Not found")
    project = await _deployed_project(deploy_id, guest_service)
    if not project.get("browserModel"):
        raise HTTPException(status_code=404, detail="Not found")
    try:
        data, content_type = await asyncio.to_thread(ImageModelService().get_file, project.get("student_id", ""), project.get("id", ""), name)
    except Exception:
        raise HTTPException(status_code=404, detail="This model's files were removed. Train it again on the project page.")
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "public, max-age=60"})
