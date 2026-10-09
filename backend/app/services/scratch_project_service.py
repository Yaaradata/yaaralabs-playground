"""Saved Scratch projects (.sb3) for Rule Based Process projects.

The file lives in Cloud Storage at scratch_projects/{project_id}/project.sb3, with the save
version stamped on the object's own metadata so a download always pairs content with the
version it was saved as. The project document in Firestore holds the current version and a
summary (scratchSavedAt, scratchSizeBytes, ...); saves are checked against it in a
transaction so an outdated editor tab can't overwrite newer work.
"""

from __future__ import annotations

import io
import json
import logging
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Tuple

from ..config import gcp_clients

logger = logging.getLogger(__name__)

SCRATCH_PREFIX = "scratch_projects"
SB3_CONTENT_TYPE = "application/x.scratch.sb3"
MAX_SB3_BYTES = 20 * 1024 * 1024
MAX_PROJECT_JSON_BYTES = 5 * 1024 * 1024

EDITOR_SCRATCH = "scratch"
EDITOR_LEGACY = "legacy"
LEGACY_WORKSPACE_COLLECTION = "rule_based_workspaces"


class InvalidScratchProject(ValueError):
    """The uploaded bytes are not a usable Scratch project."""


class ScratchVersionConflict(Exception):
    """The save was based on an older version than the one stored (another tab saved since)."""

    def __init__(self, current_version: int):
        super().__init__(f"Project was saved from another tab (current version {current_version})")
        self.current_version = current_version


@dataclass
class ScratchMeta:
    version: int = 0
    saved_at: Optional[datetime] = None
    size_bytes: Optional[int] = None


def next_version(current: int, active_client: Optional[str], if_match: int, client_id: Optional[str]) -> int:
    """Version a save gets, or ScratchVersionConflict if it must not overwrite the stored project.

    Each editor tab claims the project when it opens it (see claim()), so the most recently
    opened tab is the active one:
    - the active tab may always save; its in-memory project already contains its own
      earlier saves, even ones whose response it never received
    - any other tab is outdated and gets a conflict, even if it loaded the current version
    - if no tab has claimed the project yet, a save based on the current version is accepted
    """
    if client_id and client_id == active_client:
        return current + 1
    if not active_client and if_match == current:
        return current + 1
    raise ScratchVersionConflict(current)


def object_path(project_id: str) -> str:
    return f"{SCRATCH_PREFIX}/{project_id}/project.sb3"


def validate_sb3(data: bytes) -> None:
    """Accept only a zip that contains a readable Scratch project.json."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            try:
                info = zf.getinfo("project.json")
            except KeyError:
                raise InvalidScratchProject("The file is a zip but has no project.json, so it isn't a Scratch project")
            if info.file_size > MAX_PROJECT_JSON_BYTES:
                raise InvalidScratchProject("project.json inside the file is too large")
            validate_project_json(zf.read("project.json"))
    except zipfile.BadZipFile:
        raise InvalidScratchProject("The body is not a Scratch project file (.sb3)")


def validate_project_json(raw: bytes) -> dict:
    try:
        project = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise InvalidScratchProject("project.json is not valid JSON")
    if not isinstance(project, dict) or not isinstance(project.get("targets"), list) or not project["targets"]:
        raise InvalidScratchProject("project.json has no targets, so it isn't a Scratch 3 project")
    return project


def replace_project_json(sb3: Optional[bytes], project_json: bytes) -> bytes:
    """Return a new .sb3 with project.json replaced and every other file (costumes, sounds) kept."""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        if sb3:
            with zipfile.ZipFile(io.BytesIO(sb3)) as src:
                for item in src.infolist():
                    if item.filename != "project.json":
                        dst.writestr(item, src.read(item.filename))
        dst.writestr("project.json", project_json)
    return out.getvalue()


class ScratchProjectStore:
    """Cloud Storage + Firestore access. Tests replace this with an in-memory version."""

    def _bucket(self):
        return gcp_clients.get_bucket()

    def _projects(self):
        return gcp_clients.get_firestore_client().collection("projects")

    def get_meta(self, project_id: str) -> ScratchMeta:
        snap = self._projects().document(project_id).get()
        data = (snap.to_dict() or {}) if snap.exists else {}
        return ScratchMeta(
            version=int(data.get("scratchVersion") or 0),
            saved_at=data.get("scratchSavedAt"),
            size_bytes=data.get("scratchSizeBytes"),
        )

    def claim_version(self, project_id: str, if_match: int, client_id: Optional[str]) -> int:
        """Check the save is based on the current version, and reserve the next one."""
        from google.cloud import firestore

        ref = self._projects().document(project_id)

        @firestore.transactional
        def _claim(transaction):
            snap = ref.get(transaction=transaction)
            data = snap.to_dict() or {}
            new_version = next_version(
                int(data.get("scratchVersion") or 0), data.get("scratchClientId"), if_match, client_id
            )
            transaction.update(ref, {"scratchVersion": new_version, "scratchClientId": client_id})
            return new_version

        return _claim(gcp_clients.get_firestore_client().transaction())

    def claim(self, project_id: str, client_id: str, loaded_version: Optional[int]) -> Optional[int]:
        """Make client_id the active editor tab. Returns the claimed version.

        With loaded_version, only claims if that's still the current version (returns None
        otherwise, so the caller re-reads); with None, claims whatever is current.
        """
        from google.cloud import firestore

        ref = self._projects().document(project_id)

        @firestore.transactional
        def _claim(transaction):
            snap = ref.get(transaction=transaction)
            current = int((snap.to_dict() or {}).get("scratchVersion") or 0)
            if loaded_version is not None and loaded_version != current:
                return None
            transaction.update(ref, {"scratchVersion": current, "scratchClientId": client_id})
            return current

        return _claim(gcp_clients.get_firestore_client().transaction())

    def record_saved(self, project_id: str, size_bytes: int, saved_at: datetime) -> None:
        self._projects().document(project_id).update({
            "scratchProjectPath": object_path(project_id),
            "scratchSavedAt": saved_at,
            "scratchSizeBytes": size_bytes,
            "rbpEditor": EDITOR_SCRATCH,
        })

    def upload(self, project_id: str, data: bytes, version: int) -> None:
        blob = self._bucket().blob(object_path(project_id))
        blob.metadata = {"scratchVersion": str(version)}
        blob.upload_from_string(data, content_type=SB3_CONTENT_TYPE)

    def download(self, project_id: str) -> Optional[Tuple[bytes, int]]:
        """Return (sb3 bytes, version saved with them), or None if nothing is saved."""
        from google.api_core.exceptions import NotFound, PreconditionFailed

        bucket = self._bucket()
        for _ in range(3):
            blob = bucket.get_blob(object_path(project_id))
            if blob is None:
                return None
            version = int((blob.metadata or {}).get("scratchVersion") or 0)
            try:
                # Pin the generation so content and version come from the same save
                return blob.download_as_bytes(if_generation_match=blob.generation), version
            except (PreconditionFailed, NotFound):
                continue  # replaced between the two calls; read again
        raise RuntimeError("Saved project kept changing while it was being read; try again")

    def delete(self, project_id: str) -> int:
        deleted = 0
        for blob in self._bucket().list_blobs(prefix=f"{SCRATCH_PREFIX}/{project_id}/"):
            blob.delete()
            deleted += 1
        return deleted

    def resolve_editor(self, project_id: str, current: Optional[str]) -> str:
        """Pick (once) which editor a Rule Based Process project uses.

        Projects created before Scratch support that already have a built-in editor
        workspace keep that editor so no work is lost; everything else uses Scratch.
        """
        if current in (EDITOR_SCRATCH, EDITOR_LEGACY):
            return current
        client = gcp_clients.get_firestore_client()
        has_workspace = client.collection(LEGACY_WORKSPACE_COLLECTION).document(project_id).get().exists
        editor = EDITOR_LEGACY if has_workspace else EDITOR_SCRATCH
        self._projects().document(project_id).update({"rbpEditor": editor})
        logger.info("Rule Based Process project %s uses the %s editor", project_id, editor)
        return editor


class ScratchProjectService:
    def __init__(self, store: Optional[ScratchProjectStore] = None):
        self.store = store or ScratchProjectStore()

    def load(self, project_id: str, client_id: Optional[str] = None) -> Tuple[Optional[bytes], int]:
        """Return (sb3 or None, version). The version is what the next save must send as If-Match.

        With client_id, that editor tab also becomes the active one (older tabs can no
        longer save), checked against the version it actually received.
        """
        for attempt in range(3):
            saved = self.store.download(project_id)
            data, version = saved if saved else (None, self.store.get_meta(project_id).version)
            if not client_id:
                return data, version
            # Last attempt: claim whatever is current. Content and version only differ if a
            # save's upload failed, and the stored file is then the latest that exists.
            claimed = self.store.claim(project_id, client_id, None if attempt == 2 else version)
            if claimed is not None:
                return data, claimed
        raise RuntimeError("unreachable")

    def meta(self, project_id: str) -> ScratchMeta:
        return self.store.get_meta(project_id)

    def save(self, project_id: str, data: bytes, if_match: int, client_id: Optional[str]) -> ScratchMeta:
        validate_sb3(data)
        return self._commit(project_id, data, if_match, client_id)

    def save_project_json(self, project_id: str, project_json: bytes, if_match: int, client_id: Optional[str]) -> ScratchMeta:
        """Save only project.json (sent by a closing tab, where a full .sb3 is too big to send).

        Costumes and sounds already in the saved file are kept.
        """
        validate_project_json(project_json)
        saved = self.store.download(project_id)
        merged = replace_project_json(saved[0] if saved else None, project_json)
        return self._commit(project_id, merged, if_match, client_id)

    def _commit(self, project_id: str, data: bytes, if_match: int, client_id: Optional[str]) -> ScratchMeta:
        version = self.store.claim_version(project_id, if_match, client_id)
        self.store.upload(project_id, data, version)
        saved_at = datetime.now(timezone.utc)
        self.store.record_saved(project_id, len(data), saved_at)
        logger.info("Saved Scratch project %s v%s (%s bytes)", project_id, version, len(data))
        return ScratchMeta(version=version, saved_at=saved_at, size_bytes=len(data))

    def delete(self, project_id: str) -> int:
        return self.store.delete(project_id)

    def resolve_editor(self, project_id: str, current: Optional[str]) -> str:
        return self.store.resolve_editor(project_id, current)
