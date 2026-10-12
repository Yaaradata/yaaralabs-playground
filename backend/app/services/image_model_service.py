"""The trained model of a Live Object Detection project (custom mode), saved after every training.

Training happens in the browser; after each training the browser uploads the result here so the
project opens with its model and samples next time.

  GCS        gs://<bucket>/image-models/<session_id>/<project_id>/{model.json, weights.bin, metadata.json,
             samples.json, samples/<classIndex>/<n>.jpg}
  Firestore  image_models/<project_id>  {owner_id, project_id, labels, colors, accuracy, status, files,
             has_samples, saved_at, expires_at}

One model per project: a new save replaces the old one. The model goes when the project or the
session is deleted, and the bucket's 7-day lifecycle rule removes the files of an abandoned session
(a record whose files are gone reads as "no saved model"). Files go straight from the browser to
GCS with V4 signed URLs (15 minutes, fixed content type); when the server's credentials cannot sign
(a user login on a laptop), the routes hand out URLs to a small backend proxy with the same checks.
"""

from __future__ import annotations

import datetime as dt
import logging
import re
from typing import Any, Dict, List, Optional

from ..config import gcp_clients, settings

logger = logging.getLogger(__name__)

COLLECTION = "image_models"
PREFIX = "image-models"
URL_TTL = dt.timedelta(minutes=15)
KEEP = dt.timedelta(days=7)  # the bucket's lifecycle rule deletes files after 7 days
MAX_MODEL_BYTES = 25 * 1024 * 1024  # model.json + weights.bin + metadata.json
MAX_SAMPLE_BYTES = 200 * 1024  # one 224 px JPEG thumbnail
MAX_SAMPLES = 500
MODEL_FILES = ("model.json", "weights.bin", "metadata.json")
SAMPLE_RE = re.compile(r"^samples/(\d{1,3})/(\d{1,4})\.jpg$")
CONTENT_TYPES = {".json": "application/json", ".bin": "application/octet-stream", ".jpg": "image/jpeg"}


class ImageModelError(ValueError):
    pass


class ImageModelNotFound(LookupError):
    pass


def content_type_for(name: str) -> str:
    for ext, ctype in CONTENT_TYPES.items():
        if name.endswith(ext):
            return ctype
    raise ImageModelError(f"File type not allowed: {name}")


def check_file_names(files: List[str]) -> List[str]:
    names = list(dict.fromkeys(files))
    missing = [f for f in MODEL_FILES if f not in names]
    if missing:
        raise ImageModelError(f"Missing files: {', '.join(missing)}")
    for f in names:
        if f in MODEL_FILES or f == "samples.json" or SAMPLE_RE.match(f):
            continue
        raise ImageModelError(f"File not allowed: {f}")
    samples = [f for f in names if SAMPLE_RE.match(f)]
    if samples and "samples.json" not in names:
        raise ImageModelError("samples.json is required with sample images.")
    if len(samples) > MAX_SAMPLES:
        raise ImageModelError(f"At most {MAX_SAMPLES} sample images per model.")
    return names


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class ImageModelService:
    def __init__(self):
        self.db = gcp_clients.get_projects_collection()._client
        self.bucket = gcp_clients.get_bucket()

    # ── helpers ──

    def _doc(self, project_id: str):
        return self.db.collection(COLLECTION).document(project_id)

    def _own(self, owner_id: str, project_id: str) -> Optional[Dict[str, Any]]:
        snap = self._doc(project_id).get()
        data = snap.to_dict() if snap.exists else None
        return data if data and data.get("owner_id") == owner_id else None

    @staticmethod
    def _path(owner_id: str, project_id: str, name: str = "") -> str:
        return f"{PREFIX}/{owner_id}/{project_id}/{name}"

    def _sign(self, path: str, method: str, content_type: Optional[str] = None) -> Optional[str]:
        """A V4 signed URL, or None to use the backend proxy: when IMAGE_MODELS_SIGNED_URLS is off (the
        default, until the bucket has a CORS rule for the site) or these credentials cannot sign."""
        if not settings.image_models_signed_urls:
            return None
        blob = self.bucket.blob(path)
        kwargs: Dict[str, Any] = {"version": "v4", "expiration": URL_TTL, "method": method}
        if content_type:
            kwargs["content_type"] = content_type
        if method == "PUT":
            kwargs["headers"] = {"x-goog-content-length-range": f"0,{self._limit(path)}"}
        try:
            return blob.generate_signed_url(**kwargs)
        except Exception:
            pass
        # Cloud Run credentials have no private key: sign through the IAM API instead
        try:
            import google.auth
            import google.auth.transport.requests

            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            creds.refresh(google.auth.transport.requests.Request())
            email = getattr(creds, "service_account_email", None)
            if not email or email == "default":
                return None
            return blob.generate_signed_url(service_account_email=email, access_token=creds.token, **kwargs)
        except Exception as e:
            logger.info("Signed URL unavailable, using the proxy: %s", e)
            return None

    @staticmethod
    def _limit(name: str) -> int:
        return MAX_SAMPLE_BYTES if name.endswith(".jpg") else MAX_MODEL_BYTES

    def _delete_files(self, owner_id: str, project_id: str) -> int:
        n = 0
        for b in self.bucket.list_blobs(prefix=self._path(owner_id, project_id)):
            b.delete()
            n += 1
        return n

    # ── API ──

    def start_save(self, owner_id: str, project_id: str, files: List[str], labels: List[str], colors: List[str],
                   accuracy: Optional[float], proxy_url) -> Dict[str, Any]:
        """Replace the project's saved model: clear the old files, hand out upload URLs."""
        names = check_file_names(files)
        self._delete_files(owner_id, project_id)
        urls: Dict[str, str] = {}
        direct = True
        for f in names:
            url = self._sign(self._path(owner_id, project_id, f), "PUT", content_type_for(f))
            if url is None:
                direct = False
                url = proxy_url(project_id, f)
            urls[f] = url
        now = _now()
        self._doc(project_id).set({
            "id": project_id,
            "owner_id": owner_id,
            "project_id": project_id,
            "labels": [str(l)[:60] for l in labels][:50],
            "colors": [str(c)[:16] for c in colors][:50],
            "accuracy": accuracy,
            "files": names,
            "has_samples": any(SAMPLE_RE.match(f) for f in names),
            "status": "pending",
            "saved_at": now.isoformat(),
            "expires_at": (now + KEEP).isoformat(),
        })
        headers = {}
        for f in names:
            h = {"Content-Type": content_type_for(f)}
            if direct:  # signed into the URL, so the browser must send it too
                h["x-goog-content-length-range"] = f"0,{self._limit(f)}"
            headers[f] = h
        return {"uploadUrls": urls, "headers": headers, "direct": direct}

    def put_file(self, owner_id: str, project_id: str, name: str, data: bytes, content_type: str) -> None:
        """Proxy upload, used only when signed URLs are unavailable. Same rules as a signed PUT."""
        d = self._own(owner_id, project_id)
        if not d:
            raise ImageModelNotFound("Model not found")
        if d.get("status") != "pending" or name not in d.get("files", []):
            raise ImageModelError("This file is not part of the upload.")
        expected = content_type_for(name)
        if content_type.split(";")[0].strip() != expected:
            raise ImageModelError(f"{name} must be sent as {expected}.")
        if len(data) > self._limit(name):
            raise ImageModelError(f"{name} is too large.")
        self.bucket.blob(self._path(owner_id, project_id, name)).upload_from_string(data, content_type=expected)

    def complete(self, owner_id: str, project_id: str) -> Dict[str, Any]:
        d = self._own(owner_id, project_id)
        if not d:
            raise ImageModelNotFound("Model not found")
        prefix = self._path(owner_id, project_id)
        blobs = {b.name[len(prefix):]: b for b in self.bucket.list_blobs(prefix=prefix)}
        missing = [f for f in d.get("files", []) if f not in blobs]
        if missing:
            raise ImageModelError(f"These files did not arrive: {', '.join(missing[:5])}")
        if sum(blobs[f].size or 0 for f in MODEL_FILES) > MAX_MODEL_BYTES:
            self.delete(owner_id, project_id)
            raise ImageModelError("The model is larger than 25 MB.")
        self._doc(project_id).update({"status": "ready", "bytes": sum(b.size or 0 for b in blobs.values())})
        return {"saved_at": d.get("saved_at"), "hasSamples": bool(d.get("has_samples"))}

    def open(self, owner_id: str, project_id: str, proxy_url) -> Optional[Dict[str, Any]]:
        """The saved model with 15-minute read URLs, or None (never saved, unfinished, or expired)."""
        d = self._own(owner_id, project_id)
        if not d or d.get("status") != "ready":
            return None
        if not self.bucket.blob(self._path(owner_id, project_id, "model.json")).exists():
            # the lifecycle rule removed the files: forget the record too
            self._doc(project_id).delete()
            return None
        urls = {f: self._sign(self._path(owner_id, project_id, f), "GET") or proxy_url(project_id, f)
                for f in d.get("files", [])}
        return {"labels": d.get("labels", []), "colors": d.get("colors", []), "accuracy": d.get("accuracy"),
                "hasSamples": bool(d.get("has_samples")), "saved_at": d.get("saved_at"), "urls": urls}

    def get_file(self, owner_id: str, project_id: str, name: str):
        d = self._own(owner_id, project_id)
        if not d or name not in d.get("files", []):
            raise ImageModelNotFound("File not found")
        blob = self.bucket.blob(self._path(owner_id, project_id, name))
        if not blob.exists():
            raise ImageModelNotFound("File not found")
        return blob.download_as_bytes(), content_type_for(name)

    def delete(self, owner_id: str, project_id: str) -> Dict[str, Any]:
        """Files and record. Safe to call when nothing was saved (project delete)."""
        n = self._delete_files(owner_id, project_id)
        d = self._own(owner_id, project_id)
        if d:
            self._doc(project_id).delete()
        return {"deleted": project_id, "files": n}

    def delete_owner(self, owner_id: str) -> int:
        """Session cleanup: every saved model of this session, records and files."""
        n = 0
        for s in self.db.collection(COLLECTION).where("owner_id", "==", owner_id).stream():
            s.reference.delete()
            n += 1
        for b in self.bucket.list_blobs(prefix=f"{PREFIX}/{owner_id}/"):
            b.delete()
        return n
