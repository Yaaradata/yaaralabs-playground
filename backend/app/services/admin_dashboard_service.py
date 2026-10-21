"""What the /admin dashboard reads and clears: projects, guest sessions and the models in the bucket.

  Firestore  projects/<project_id>          every project (guest ones carry student_id = session id)
             guest_sessions/<session_id>     {session_id, createdAt, expiresAt, active, ip_address, ...}
             image_models/<project_id>       saved Live Object Detection models
             admin_audit_log/<auto>          one row per destructive admin action
  GCS        models/<project_id>/...                     trained text / image models
             image-models/<session_id>/<project_id>/...  Live Object Detection models (browser-trained)

Deleting a project also runs the same companion cleanup the guest delete route does (RAG chunks,
agent runs, Scratch workspace, ...) and removes the project's files in the bucket. Admin accounts
(admin_users) are never touched by any clear action.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from ..config import gcp_clients

logger = logging.getLogger(__name__)

PROJECTS = "projects"
SESSIONS = "guest_sessions"
IMAGE_MODELS = "image_models"
AUDIT_LOG = "admin_audit_log"

MODEL_PREFIXES = {"models/": "text", "image-models/": "image"}
# Per-project file folders in the bucket
PROJECT_FILE_PREFIXES = ("models", "datasets", "images", "predictions", "scratch_projects")
# Everything "clear everything" removes from the bucket
CLEAR_ALL_PREFIXES = ("models/", "image-models/", "datasets/", "images/", "predictions/", "scratch_projects/")
PROJECT_FIELDS = ["id", "name", "type", "status", "createdAt", "updatedAt", "createdBy", "student_id",
                  "expiryTimestamp", "model.accuracy", "model.trainedAt"]
BATCH = 400
# Listing the bucket takes seconds (image-models/ holds thousands of sample images), so the grouped
# model list is kept for a minute; any delete through this service drops it.
MODELS_TTL_S = 60.0
LIST_FIELDS = "items(name,size,updated),nextPageToken"
# Bulk deletes run this many calls at once; up to SMALL_BATCH projects list their own folders
WORKERS = 16
DELETE_CHUNK = 100
SMALL_BATCH = 20
_models_cache: Dict[int, Any] = {}
_models_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            d = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _iso(value: Any) -> Optional[str]:
    d = _dt(value)
    return d.isoformat() if d else None


def _in_range(value: Any, date_from: Optional[datetime], date_to: Optional[datetime]) -> bool:
    if not date_from and not date_to:
        return True
    d = _dt(value)
    if not d:
        return False
    return (not date_from or d >= date_from) and (not date_to or d <= date_to)


def session_of(project: Dict[str, Any]) -> str:
    sid = project.get("student_id") or ""
    created_by = project.get("createdBy") or ""
    if not sid and created_by.startswith("guest:"):
        sid = created_by[len("guest:"):]
    return sid


def _page(items: List[Any], limit: int, offset: int) -> Dict[str, Any]:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    return {"total": len(items), "limit": limit, "offset": offset, "items": items[offset:offset + limit]}


def companion_cleanup(kind: str, project_id: str, session_id: str) -> None:
    """The per-type cleanup guests.delete_guest_project does: collections each project type keeps apart."""
    from .ai_agent_service import AiAgentService
    from .confusion_matrix_service import ConfusionMatrixService
    from .copilot_lab_service import CopilotLabService
    from .exercises_service import ExercisesService
    from .image_model_service import ImageModelService
    from .rag_chatbot_service import RagChatbotService
    from .rule_based_process_service import RuleBasedProcessService
    from .rules_bot_service import RulesBotService
    from .scratch_project_service import ScratchProjectService

    steps = {
        "rule-based-process": [lambda: RuleBasedProcessService().delete(project_id),
                               lambda: ScratchProjectService().delete(project_id),
                               lambda: RulesBotService().delete_board(project_id)],
        "confusion-matrix": [lambda: ConfusionMatrixService().delete(project_id, session_id)],
        "copilot-ethics": [lambda: CopilotLabService().delete(project_id, session_id)],
        "copilot-document-ai": [lambda: CopilotLabService().delete(project_id, session_id)],
        "rag-chatbot": [lambda: RagChatbotService().delete(project_id, session_id)],
        "ai-agent": [lambda: AiAgentService().delete(project_id, session_id)],
        "live-object-detection": [lambda: ImageModelService().delete(session_id, project_id)],
        "live-video-classification": [lambda: ImageModelService().delete(session_id, project_id)],
        "exercises": [lambda: ExercisesService().delete(project_id)],
    }.get(kind, [])
    for step in steps:
        try:
            step()
        except Exception as e:
            logger.warning("Admin cleanup of %s project %s failed: %s", kind, project_id, e)


class AdminDashboardService:
    def __init__(self, db=None, bucket=None, cleanup=None):
        self._db = db
        self._bucket = bucket
        self._cleanup = cleanup or companion_cleanup

    @property
    def db(self):
        return self._db or gcp_clients.get_firestore_client()

    @property
    def bucket(self):
        return self._bucket or gcp_clients.get_bucket()

    # ── reading ──

    def _projects(self) -> List[Dict[str, Any]]:
        out = []
        for snap in self.db.collection(PROJECTS).select(PROJECT_FIELDS).stream():
            d = snap.to_dict() or {}
            model = d.get("model") or {}
            out.append({
                "id": d.get("id") or snap.id,
                "name": d.get("name") or "",
                "type": str(d.get("type") or "unknown"),
                "status": str(d.get("status") or "unknown"),
                "session_id": session_of(d),
                "created_by": d.get("createdBy") or "",
                "created_at": _iso(d.get("createdAt")),
                "updated_at": _iso(d.get("updatedAt")),
                "expires_at": _iso(d.get("expiryTimestamp")),
                "accuracy": model.get("accuracy"),
                "trained_at": _iso(model.get("trainedAt")),
            })
        return out

    def _sessions(self) -> List[Dict[str, Any]]:
        now = _now()
        out = []
        for snap in self.db.collection(SESSIONS).stream():
            d = snap.to_dict() or {}
            expires = _dt(d.get("expiresAt"))
            if not d.get("active", True):
                status = "inactive"
            elif expires and expires <= now:
                status = "expired"
            else:
                status = "active"
            out.append({
                "session_id": d.get("session_id") or snap.id,
                "status": status,
                "created_at": _iso(d.get("createdAt")),
                "expires_at": _iso(expires),
                "last_active": _iso(d.get("last_active")),
                "ip_address": d.get("ip_address") or "",
                "user_agent": d.get("user_agent") or "",
            })
        return out

    def _forget_models(self) -> None:
        with _models_lock:
            _models_cache.pop(id(self.bucket), None)

    def _models(self) -> List[Dict[str, Any]]:
        cache_key = id(self.bucket)
        with _models_lock:
            hit = _models_cache.get(cache_key)
        if hit and time.monotonic() - hit[0] < MODELS_TTL_S:
            return [dict(m) for m in hit[1]]
        with ThreadPoolExecutor(max_workers=len(MODEL_PREFIXES)) as pool:
            listings = list(pool.map(lambda p: list(self.bucket.list_blobs(prefix=p, fields=LIST_FIELDS)), MODEL_PREFIXES))
        groups: Dict[str, Dict[str, Any]] = {}
        for (prefix, kind), blobs in zip(MODEL_PREFIXES.items(), listings):
            for blob in blobs:
                parts = blob.name[len(prefix):].split("/")
                if kind == "text":
                    if len(parts) < 2 or not parts[0]:
                        continue
                    session_id, project_id = "", parts[0]
                    key = f"{prefix}{project_id}/"
                else:
                    if len(parts) < 3 or not parts[0] or not parts[1]:
                        continue
                    session_id, project_id = parts[0], parts[1]
                    key = f"{prefix}{session_id}/{project_id}/"
                g = groups.setdefault(key, {"key": key, "kind": kind, "project_id": project_id,
                                            "session_id": session_id, "files": 0, "bytes": 0, "updated_at": None})
                g["files"] += 1
                g["bytes"] += int(blob.size or 0)
                updated = _dt(getattr(blob, "updated", None))
                if updated and (not g["updated_at"] or updated > _dt(g["updated_at"])):
                    g["updated_at"] = updated.isoformat()
        models = list(groups.values())
        with _models_lock:
            _models_cache[cache_key] = (time.monotonic(), models)
        return [dict(m) for m in models]

    def stats(self) -> Dict[str, Any]:
        with ThreadPoolExecutor(max_workers=3) as pool:
            projects_f, sessions_f, models_f = pool.submit(self._projects), pool.submit(self._sessions), pool.submit(self._models)
            projects, sessions, models = projects_f.result(), sessions_f.result(), models_f.result()
        day_ago = _now().timestamp() - 86400

        def recent(items):
            return sum(1 for i in items if (_dt(i["created_at"]) or datetime.min.replace(tzinfo=timezone.utc)).timestamp() >= day_ago)

        return {
            "projects": {
                "total": len(projects),
                "last_24h": recent(projects),
                "guest": sum(1 for p in projects if p["session_id"]),
                "by_type": dict(Counter(p["type"] for p in projects).most_common()),
                "by_status": dict(Counter(p["status"] for p in projects).most_common()),
            },
            "sessions": {
                "total": len(sessions),
                "active": sum(1 for s in sessions if s["status"] == "active"),
                "expired": sum(1 for s in sessions if s["status"] == "expired"),
                "inactive": sum(1 for s in sessions if s["status"] == "inactive"),
                "last_24h": recent(sessions),
            },
            "models": {
                "total": len(models),
                "files": sum(m["files"] for m in models),
                "bytes": sum(m["bytes"] for m in models),
                "by_kind": dict(Counter(m["kind"] for m in models)),
            },
            "admins": sum(1 for _ in self.db.collection("admin_users").stream()),
            "generated_at": _now().isoformat(),
        }

    def list_projects(self, *, type: Optional[str] = None, status: Optional[str] = None,
                      session_id: Optional[str] = None, owner: Optional[str] = None,
                      search: Optional[str] = None, date_from: Optional[datetime] = None,
                      date_to: Optional[datetime] = None, sort: str = "newest",
                      limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        all_projects = self._projects()
        q = (search or "").strip().lower()
        items = [
            p for p in all_projects
            if (not type or p["type"] == type)
            and (not status or p["status"] == status)
            and (not session_id or p["session_id"] == session_id.strip())
            and (owner not in ("guest", "other") or bool(p["session_id"]) == (owner == "guest"))
            and (not q or q in p["name"].lower() or q in p["id"].lower() or q in p["session_id"].lower())
            and _in_range(p["created_at"], date_from, date_to)
        ]
        _sort(items, sort, "created_at", "name")
        result = _page(items, limit, offset)
        result["types"] = sorted({p["type"] for p in all_projects})
        result["statuses"] = sorted({p["status"] for p in all_projects})
        return result

    def list_sessions(self, *, status: Optional[str] = None, search: Optional[str] = None,
                      date_from: Optional[datetime] = None, date_to: Optional[datetime] = None,
                      sort: str = "newest", limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        counts = Counter(p["session_id"] for p in self._projects() if p["session_id"])
        q = (search or "").strip().lower()
        items = []
        for s in self._sessions():
            if status and status != "all" and s["status"] != status:
                continue
            if q and q not in s["session_id"].lower() and q not in s["ip_address"].lower() \
                    and q not in s["user_agent"].lower():
                continue
            if not _in_range(s["created_at"], date_from, date_to):
                continue
            items.append({**s, "project_count": counts.get(s["session_id"], 0)})
        _sort(items, sort, "created_at", "session_id")
        return _page(items, limit, offset)

    def list_models(self, *, kind: Optional[str] = None, search: Optional[str] = None,
                    orphaned: Optional[bool] = None, date_from: Optional[datetime] = None,
                    date_to: Optional[datetime] = None, sort: str = "newest",
                    limit: int = 50, offset: int = 0) -> Dict[str, Any]:
        project_ids = {snap.id for snap in self.db.collection(PROJECTS).select(["id"]).stream()}
        q = (search or "").strip().lower()
        items = []
        for m in self._models():
            m["orphaned"] = m["project_id"] not in project_ids
            if kind and m["kind"] != kind:
                continue
            if orphaned is not None and m["orphaned"] != orphaned:
                continue
            if q and q not in m["key"].lower():
                continue
            if not _in_range(m["updated_at"], date_from, date_to):
                continue
            items.append(m)
        _sort(items, sort, "updated_at", "key")
        return _page(items, limit, offset)

    def audit_log(self, limit: int = 50) -> List[Dict[str, Any]]:
        rows = [snap.to_dict() or {} for snap in self.db.collection(AUDIT_LOG).stream()]
        rows.sort(key=lambda r: _dt(r.get("at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        return [{**r, "at": _iso(r.get("at"))} for r in rows[:max(1, min(limit, 200))]]

    # ── clearing ──

    def record(self, admin_email: str, action: str, details: Dict[str, Any]) -> None:
        try:
            self.db.collection(AUDIT_LOG).add({"at": _now(), "admin": admin_email, "action": action, "details": details})
        except Exception as e:
            logger.warning("Could not write admin audit log for %s: %s", action, e)

    def _delete_refs(self, refs: Iterable[Any]) -> int:
        count, batch, pending = 0, self.db.batch(), 0
        for ref in refs:
            batch.delete(ref)
            pending += 1
            if pending >= BATCH:
                batch.commit()
                count += pending
                batch, pending = self.db.batch(), 0
        if pending:
            batch.commit()
            count += pending
        return count

    def _list(self, prefix: str) -> List[Any]:
        return list(self.bucket.list_blobs(prefix=prefix, fields=LIST_FIELDS))

    def _list_many(self, prefixes: List[str]) -> List[Any]:
        if not prefixes:
            return []
        with ThreadPoolExecutor(max_workers=min(WORKERS, len(prefixes))) as pool:
            return [b for blobs in pool.map(self._list, prefixes) for b in blobs]

    def _delete_blobs(self, blobs: List[Any]) -> int:
        """Delete files in parallel chunks: one by one, a few thousand files take minutes."""
        if not blobs:
            return 0
        self._forget_models()
        chunks = [blobs[i:i + DELETE_CHUNK] for i in range(0, len(blobs), DELETE_CHUNK)]

        def delete(chunk):
            self.bucket.delete_blobs(chunk, on_error=lambda b: logger.warning("Could not delete %s", b.name))

        with ThreadPoolExecutor(max_workers=min(WORKERS, len(chunks))) as pool:
            list(pool.map(delete, chunks))
        return len(blobs)

    def _delete_prefix(self, prefix: str) -> int:
        return self._delete_blobs(self._list(prefix))

    def _project_blobs(self, projects: List[Dict[str, Any]]) -> List[Any]:
        """The bucket files of these projects. A few: list each project's folders. Many: list each
        top-level folder once and pick their files, instead of six listings per project."""
        if len(projects) <= SMALL_BATCH:
            prefixes = [f"{p}/{pr['id']}/" for pr in projects for p in PROJECT_FILE_PREFIXES]
            prefixes += [f"image-models/{pr['session_id']}/{pr['id']}/" for pr in projects if pr["session_id"]]
            return self._list_many(prefixes)
        ids = {pr["id"] for pr in projects}
        blobs = []
        for blob in self._list_many([f"{p}/" for p in PROJECT_FILE_PREFIXES] + ["image-models/"]):
            parts = blob.name.split("/")
            pid = parts[2] if parts[0] == "image-models" and len(parts) > 3 else parts[1] if len(parts) > 2 else ""
            if pid in ids:
                blobs.append(blob)
        return blobs

    def _delete_project_records(self, projects: List[Dict[str, Any]]) -> Dict[str, int]:
        """Delete known projects (dicts with id, type, session_id): companion data, files, documents."""
        if not projects:
            return {"deleted_projects": 0, "deleted_files": 0}
        with ThreadPoolExecutor(max_workers=min(WORKERS, len(projects))) as pool:
            list(pool.map(lambda pr: self._cleanup(pr["type"], pr["id"], pr["session_id"]), projects))
        files = self._delete_blobs(self._project_blobs(projects))
        self._delete_refs(self.db.collection(IMAGE_MODELS).document(pr["id"]) for pr in projects)
        deleted = self._delete_refs(self.db.collection(PROJECTS).document(pr["id"]) for pr in projects)
        return {"deleted_projects": deleted, "deleted_files": files}

    def delete_projects(self, project_ids: List[str]) -> Dict[str, Any]:
        col = self.db.collection(PROJECTS)
        ids = list(dict.fromkeys(p.strip() for p in project_ids if p and p.strip()))
        if not ids:
            return {"deleted_projects": 0, "deleted_files": 0, "not_found": []}
        with ThreadPoolExecutor(max_workers=min(WORKERS, len(ids))) as pool:
            snaps = list(pool.map(lambda pid: col.document(pid).get(), ids))
        found, missing = [], []
        for pid, snap in zip(ids, snaps):
            if not snap.exists:
                missing.append(pid)
                continue
            d = snap.to_dict() or {}
            found.append({"id": pid, "type": str(d.get("type") or ""), "session_id": session_of(d)})
        return {**self._delete_project_records(found), "not_found": missing}

    def delete_all_projects(self) -> Dict[str, Any]:
        snaps = list(self.db.collection(PROJECTS).select(["type", "student_id", "createdBy"]).stream())
        projects = [{"id": s.id, "type": str((s.to_dict() or {}).get("type") or ""), "session_id": session_of(s.to_dict() or {})}
                    for s in snaps]
        if projects:
            with ThreadPoolExecutor(max_workers=min(WORKERS, len(projects))) as pool:
                list(pool.map(lambda pr: self._cleanup(pr["type"], pr["id"], pr["session_id"]), projects))
        deleted = self._delete_refs(s.reference for s in snaps)
        self._delete_refs(s.reference for s in self.db.collection(IMAGE_MODELS).stream())
        files = self._delete_blobs(self._list_many(list(CLEAR_ALL_PREFIXES)))
        return {"deleted_projects": deleted, "deleted_files": files}

    def clear_sessions(self, session_ids: Optional[List[str]] = None, *, expired_only: bool = False,
                       include_projects: bool = True) -> Dict[str, Any]:
        """Clear the given sessions, or every session (only the expired ones with expired_only).

        Clearing every session with include_projects removes all guest data: also guest projects whose
        session record is already gone, every saved image model, and model folders whose project is gone.
        """
        sessions = self._sessions()
        clear_all = session_ids is None and not expired_only
        if session_ids is not None:
            wanted = {s.strip() for s in session_ids if s and s.strip()}
            sessions = [s for s in sessions if s["session_id"] in wanted]
        if expired_only:
            sessions = [s for s in sessions if s["status"] != "active"]
        ids = {s["session_id"] for s in sessions}
        result: Dict[str, Any] = {"deleted_sessions": 0, "deleted_projects": 0, "deleted_files": 0}
        if include_projects and (ids or clear_all):
            projects = self._projects()
            owned = [p for p in projects if p["session_id"] and (clear_all or p["session_id"] in ids)]
            result.update(self._delete_project_records(owned))
            if clear_all:
                kept = {p["id"] for p in projects} - {p["id"] for p in owned}
                leftovers = self._list("image-models/") + [
                    b for b in self._list("models/") if b.name.split("/")[1] not in kept]
                self._delete_refs(s.reference for s in self.db.collection(IMAGE_MODELS).stream())
            elif len(ids) <= SMALL_BATCH:  # saved image models of projects already gone
                leftovers = self._list_many([f"image-models/{sid}/" for sid in ids])
            else:
                leftovers = [b for b in self._list("image-models/") if b.name.split("/")[1] in ids]
            result["deleted_files"] += self._delete_blobs(leftovers)
        col = self.db.collection(SESSIONS)
        result["deleted_sessions"] = self._delete_refs(col.document(sid) for sid in ids)
        return result

    def delete_models(self, keys: List[str]) -> Dict[str, Any]:
        files, deleted, rejected = 0, 0, []
        for key in dict.fromkeys(k.strip() for k in keys if k and k.strip()):
            if not _valid_model_key(key):
                rejected.append(key)
                continue
            n = self._delete_prefix(key)
            if n:
                deleted += 1
                files += n
            if key.startswith("image-models/"):
                project_id = key.rstrip("/").split("/")[-1]
                self.db.collection(IMAGE_MODELS).document(project_id).delete()
        return {"deleted_models": deleted, "deleted_files": files, "rejected": rejected}

    def delete_all_models(self) -> Dict[str, Any]:
        files = self._delete_blobs(self._list_many(list(MODEL_PREFIXES)))
        self._delete_refs(s.reference for s in self.db.collection(IMAGE_MODELS).stream())
        return {"deleted_files": files}

    def clear_everything(self) -> Dict[str, Any]:
        projects = self.delete_all_projects()
        sessions = self._delete_refs(s.reference for s in self.db.collection(SESSIONS).stream())
        return {**projects, "deleted_sessions": sessions}


def _valid_model_key(key: str) -> bool:
    """Only whole model folders (models/<project>/ or image-models/<session>/<project>/), never a parent."""
    if ".." in key or not key.endswith("/"):
        return False
    parts = key[:-1].split("/")
    if parts[0] == "models":
        return len(parts) == 2 and all(parts)
    if parts[0] == "image-models":
        return len(parts) == 3 and all(parts)
    return False


def _sort(items: List[Dict[str, Any]], sort: str, date_key: str, name_key: str) -> None:
    if sort in ("name", "name_desc"):
        items.sort(key=lambda i: (i.get(name_key) or "").lower(), reverse=sort == "name_desc")
    elif sort in ("size", "files"):
        items.sort(key=lambda i: i.get("bytes" if sort == "size" else "files") or 0, reverse=True)
    else:
        oldest = datetime.min.replace(tzinfo=timezone.utc)
        items.sort(key=lambda i: _dt(i.get(date_key)) or oldest, reverse=sort != "oldest")
