"""Rules Bot persistence (Firestore).

rules_bot_samples/{sampleId}   ready-made rule sets for the Samples menu
rules_bot_boards/{projectId}   a Rule Based Process project's rules and fallback reply

Routing itself runs in the browser (a pure keyword match), so the API only stores
boards and serves samples.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..config import gcp_clients
from ..models import (
    RULES_BOT_DEFAULT_REPLY,
    RulesBotBoard,
    RulesBotBoardState,
    RulesBotRule,
    RulesBotSample,
)

logger = logging.getLogger(__name__)

SAMPLES_COLLECTION = "rules_bot_samples"
BOARDS_COLLECTION = "rules_bot_boards"

# Rule colours, brand first. Keep in sync with PALETTE in frontend/components/RulesBot.
PALETTE = ["#9333EA", "#EC4899", "#B90ABD", "#3B82F6", "#06B6D4", "#F59E0B", "#10B981", "#F97316", "#6366F1", "#14B8A6"]


class SampleNotFound(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rule_id() -> str:
    return "r" + uuid.uuid4().hex[:10]


class RulesBotService:
    def _db(self):
        return gcp_clients.get_firestore_client()

    # ── samples ────────────────────────────────────────────────

    def list_samples(self) -> List[RulesBotSample]:
        docs = self._db().collection(SAMPLES_COLLECTION).stream()
        samples = [RulesBotSample(id=d.id, **{k: v for k, v in d.to_dict().items() if k != "id"}) for d in docs]
        return sorted(samples, key=lambda s: (s.order, s.name))

    def get_sample(self, sample_id: str) -> RulesBotSample:
        doc = self._db().collection(SAMPLES_COLLECTION).document(sample_id).get()
        if not doc.exists:
            raise SampleNotFound(sample_id)
        data = doc.to_dict()
        data.pop("id", None)
        return RulesBotSample(id=doc.id, **data)

    def upsert_sample(self, sample: Dict[str, Any]) -> None:
        """Create or replace a sample (used by the seed script)."""
        clean = RulesBotSample(**sample).model_dump()
        sample_id = clean.pop("id")
        ref = self._db().collection(SAMPLES_COLLECTION).document(sample_id)
        existing = ref.get()
        clean["updatedAt"] = _now()
        clean["createdAt"] = existing.to_dict().get("createdAt", clean["updatedAt"]) if existing.exists else clean["updatedAt"]
        ref.set(clean)

    # ── boards ─────────────────────────────────────────────────

    def _board_ref(self, project_id: str):
        return self._db().collection(BOARDS_COLLECTION).document(project_id)

    def get_board(self, project_id: str, session_id: str) -> RulesBotBoard:
        """Saved board, or an empty one (not written until the first save)."""
        doc = self._board_ref(project_id).get()
        if doc.exists:
            return RulesBotBoard(**doc.to_dict())
        return RulesBotBoard(project_id=project_id, session_id=session_id)

    def _write(self, project_id: str, session_id: str, state: RulesBotBoardState) -> RulesBotBoard:
        ref = self._board_ref(project_id)
        existing = ref.get()
        now = _now()
        board = RulesBotBoard(
            project_id=project_id,
            session_id=session_id,
            rules=state.rules,
            reply=state.reply,
            sampleId=state.sampleId,
            createdAt=existing.to_dict().get("createdAt", now) if existing.exists else now,
            updatedAt=now,
        )
        ref.set(board.model_dump())
        return board

    def save_board(self, project_id: str, session_id: str, state: RulesBotBoardState) -> RulesBotBoard:
        return self._write(project_id, session_id, state)

    def load_sample(self, project_id: str, session_id: str, sample_id: str) -> RulesBotBoard:
        """Replace the board with a copy of a sample; the sample itself is never edited."""
        sample = self.get_sample(sample_id)
        rules = [
            RulesBotRule(id=_rule_id(), desk=r.desk, color=PALETTE[i % len(PALETTE)], keywords=list(r.keywords))
            for i, r in enumerate(sample.rules)
        ]
        return self._write(project_id, session_id, RulesBotBoardState(rules=rules, reply=sample.reply, sampleId=sample.id))

    def reset_board(self, project_id: str, session_id: str) -> RulesBotBoard:
        return self._write(project_id, session_id, RulesBotBoardState(reply=RULES_BOT_DEFAULT_REPLY))

    def delete_board(self, project_id: str) -> bool:
        ref = self._board_ref(project_id)
        if not ref.get().exists:
            return False
        ref.delete()
        return True
