"""
One training at a time per project (docs/hardening.md, item 6).

A double-click on Train, or a second tab, used to start the same training twice: two models racing
on the training pool and overwriting each other. Before training, a lock is taken on the project in
a Firestore transaction; a second request while it is held gets 409 "Already training". The lock is a
separate field (trainingLock), so the project's status values keep their meaning, and it is always
released when training ends. A lock older than STALE_SECONDS (a crashed instance) is ignored.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import HTTPException

LOCK_FIELD = "trainingLock"
STALE_SECONDS = 15 * 60
ALREADY = "Already training. Wait for it to finish."


def lock_is_held(lock: Optional[dict], now: float) -> bool:
    """A lock counts while it is younger than STALE_SECONDS."""
    try:
        return bool(lock) and now - float(lock.get("at", 0)) < STALE_SECONDS
    except (TypeError, ValueError, AttributeError):
        return False


def _project_ref(db, project_id: str):
    for snap in db.collection("projects").where("id", "==", project_id).limit(1).stream():
        return snap.reference
    raise HTTPException(status_code=404, detail="Guest project not found")


def acquire(project_id: str, db: Any = None):
    """Take the project's training lock or raise 409. Blocking: call with asyncio.to_thread."""
    from google.cloud import firestore

    if db is None:
        from ...config import gcp_clients

        db = gcp_clients.get_firestore_client()
    ref = _project_ref(db, project_id)

    @firestore.transactional
    def take(transaction):
        snap = ref.get(transaction=transaction)
        data = snap.to_dict() or {}
        now = time.time()
        if lock_is_held(data.get(LOCK_FIELD), now):
            raise HTTPException(status_code=409, detail=ALREADY)
        transaction.update(ref, {LOCK_FIELD: {"at": now}})

    take(db.transaction())
    return ref


def release(ref) -> None:
    """Drop the lock (never raises: a failed release only means the lock goes stale)."""
    if ref is None:
        return
    try:
        from google.cloud import firestore

        ref.update({LOCK_FIELD: firestore.DELETE_FIELD})
    except Exception:  # noqa: BLE001
        pass
