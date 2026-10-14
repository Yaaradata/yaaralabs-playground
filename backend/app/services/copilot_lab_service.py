"""Copilot labs (Ex 9 AI Ethics, Ex 10 Document AI): the participant's worksheet answers.

The labs run in Microsoft Copilot; the Playground only keeps what the participant ticked, chose and wrote down.
Copilot's own output is never stored here.

Firestore
  copilot_labs/{project_id}_{session_id}   {project_id, session_id, activity, answers, completedSteps,
                                            createdAt, updatedAt}
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..config import gcp_clients

logger = logging.getLogger(__name__)

COLLECTION = "copilot_labs"
ACTIVITY_BY_TYPE = {"copilot-ethics": "ethics", "copilot-document-ai": "document-ai"}
MAX_ANSWERS_BYTES = 20 * 1024
NOTE_MAX = 300
MAX_STEPS = 20


class CopilotLabError(ValueError):
    """A request the participant can fix (400)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def doc_id(project_id: str, session_id: str) -> str:
    return f"{project_id}_{session_id}"


def clean_answers(answers: Any) -> Dict[str, Any]:
    """Answers as stored: a JSON object of at most 20 KB; every note trimmed to 300 characters."""
    if not isinstance(answers, dict):
        raise CopilotLabError("answers must be an object.")
    out: Dict[str, Any] = {}
    for key, value in answers.items():
        if not isinstance(key, str) or len(key) > 40:
            raise CopilotLabError("Unknown answer.")
        if isinstance(value, list) and all(isinstance(x, str) for x in value):  # notes
            value = [x.strip()[:NOTE_MAX] for x in value[:5]]
        out[key] = value
    size = len(json.dumps(out, ensure_ascii=False).encode("utf-8"))
    if size > MAX_ANSWERS_BYTES:
        raise CopilotLabError(f"Answers are too large ({size:,} bytes; the limit is {MAX_ANSWERS_BYTES:,}).")
    return out


def clean_steps(steps: Any) -> List[str]:
    if steps is None:
        return []
    if not isinstance(steps, list) or len(steps) > MAX_STEPS or not all(isinstance(s, str) and len(s) <= 20 for s in steps):
        raise CopilotLabError("completedSteps must be a short list of step ids.")
    return list(dict.fromkeys(steps))


class CopilotLabService:
    def __init__(self, db=None):
        self._db_client = db

    def _db(self):
        return self._db_client or gcp_clients.get_firestore_client()

    def _ref(self, project_id: str, session_id: str):
        return self._db().collection(COLLECTION).document(doc_id(project_id, session_id))

    def get(self, project_id: str, session_id: str, activity: str) -> Dict[str, Any]:
        snap = self._ref(project_id, session_id).get()
        data = snap.to_dict() if snap.exists else None
        if not data:
            return {"activity": activity, "answers": {}, "completedSteps": [], "updatedAt": None}
        updated = data.get("updatedAt")
        return {"activity": data.get("activity", activity), "answers": data.get("answers") or {},
                "completedSteps": data.get("completedSteps") or [],
                "updatedAt": updated.isoformat() if hasattr(updated, "isoformat") else updated}

    def save(self, project_id: str, session_id: str, activity: str, answers: Any, completed: Any) -> Dict[str, Any]:
        answers = clean_answers(answers)
        steps = clean_steps(completed)
        ref = self._ref(project_id, session_id)
        snap = ref.get()
        now = _now()
        doc = {"project_id": project_id, "session_id": session_id, "activity": activity, "answers": answers,
               "completedSteps": steps, "updatedAt": now,
               "createdAt": (snap.to_dict() or {}).get("createdAt", now) if snap.exists else now}
        ref.set(doc)
        if steps:
            self._mark_guest_trained(project_id)
        return self.get(project_id, session_id, activity)

    def delete(self, project_id: str, session_id: Optional[str] = None) -> bool:
        db = self._db()
        if session_id:
            db.collection(COLLECTION).document(doc_id(project_id, session_id)).delete()
        else:
            for d in db.collection(COLLECTION).where("project_id", "==", project_id).stream():
                d.reference.delete()
        return True

    def _mark_guest_trained(self, project_id: str) -> None:
        """Set the workspace project status, as ConfusionMatrixService does, so the card shows ready."""
        try:
            ref = self._db().collection("projects").document(project_id)
            snap = ref.get()
            if not snap.exists or (snap.to_dict() or {}).get("status") == "trained":
                return
            ref.update({"status": "trained", "model.trainedAt": _now(), "updatedAt": _now()})
        except Exception as e:
            logger.warning("Could not mark Copilot lab project %s as trained: %s", project_id, e)
