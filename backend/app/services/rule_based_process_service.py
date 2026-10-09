"""Isolated Rule Based Process workspace persistence (Firestore)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..config import gcp_clients
from ..models import (
    RbpAnswerRule,
    RbpConcept,
    RbpPan,
    RbpTestCase,
    RbpWorkspaceState,
    RuleBasedWorkspace,
)

logger = logging.getLogger(__name__)

COLLECTION = "rule_based_workspaces"

# Seed concepts (no solution blocks — those live in the frontend engine for built-ins)
DEFAULT_CONCEPTS: List[Dict[str, Any]] = [
    {
        "id": "grade",
        "title": "Marks to grade",
        "vars": ["Marks", "Grade"],
        "answer": {"type": "int", "min": 0, "max": 100, "noun": "the marks"},
        "brief": (
            "Ask the student for their marks, work out the grade, then say it.\n\n"
            "below 33 → E\n33 to 40 → D\n41 to 60 → C\n61 to 80 → B\n81 to 100 → A\n\n"
            "Say the answer as: Your grade is C"
        ),
        "tests": [
            {"in": ["17"], "out": "Your grade is E"},
            {"in": ["33"], "out": "Your grade is D"},
            {"in": ["57"], "out": "Your grade is C"},
            {"in": ["80"], "out": "Your grade is B"},
            {"in": ["94"], "out": "Your grade is A"},
        ],
    },
    {
        "id": "oddeven",
        "title": "Odd or even",
        "vars": ["Number"],
        "answer": {"type": "int", "noun": "a whole number"},
        "brief": (
            "Ask for a whole number. Say Odd or Even.\n\n"
            "Hint: a number is even when the remainder after dividing by 2 is 0.\n"
            "The mod block gives you that remainder."
        ),
        "tests": [
            {"in": ["7"], "out": "Odd"},
            {"in": ["12"], "out": "Even"},
            {"in": ["0"], "out": "Even"},
            {"in": ["99"], "out": "Odd"},
        ],
    },
    {
        "id": "leap",
        "title": "Leap year",
        "vars": ["Year"],
        "answer": {"type": "int", "min": 1, "max": 3000, "noun": "a year"},
        "brief": (
            "Ask for a year and say whether it is a leap year.\n\n"
            "A year is a leap year when it divides by 4,\n"
            "except years that divide by 100,\n"
            "unless they also divide by 400.\n\n"
            "Say: Leap year  or  Not a leap year"
        ),
        "tests": [
            {"in": ["2024"], "out": "Leap year"},
            {"in": ["1900"], "out": "Not a leap year"},
            {"in": ["2000"], "out": "Leap year"},
            {"in": ["2023"], "out": "Not a leap year"},
        ],
    },
    {
        "id": "ticket",
        "title": "Ticket price",
        "vars": ["Age", "Price"],
        "answer": {"type": "int", "min": 0, "max": 120, "noun": "an age"},
        "brief": (
            "Ask how old the visitor is, then say the ticket price.\n\n"
            "under 5 → 0\n5 to 17 → 120\n18 to 59 → 250\n60 and over → 100\n\n"
            "Say the answer as: Pay 250"
        ),
        "tests": [
            {"in": ["3"], "out": "Pay 0"},
            {"in": ["11"], "out": "Pay 120"},
            {"in": ["34"], "out": "Pay 250"},
            {"in": ["72"], "out": "Pay 100"},
        ],
    },
    {
        "id": "model",
        "title": "Ask the model",
        "vars": ["Input", "Answer"],
        "answer": {"type": "text"},
        "brief": (
            "Ask any question, send it to the model, then say the reply.\n\n"
            "Flow: ask the student → store Input → ask the model → store Answer from prediction → say it.\n\n"
            "Press Run, type any question, and the model answers."
        ),
        "tests": [],
    },
    {
        "id": "blank",
        "title": "Custom",
        "vars": ["Answer"],
        "brief": (
            "An empty workspace. Use Edit concept to write your own task,\n"
            "variables and test cases, then hand it to the class."
        ),
        "tests": [],
        "answer": {"type": "text"},
    },
]

def _parse_concept(raw: Dict[str, Any]) -> RbpConcept:
    tests_raw = raw.get("tests") or []
    tests: List[RbpTestCase] = []
    for t in tests_raw:
        if isinstance(t, dict):
            tests.append(
                RbpTestCase(
                    **{"in": t.get("in") or t.get("inputs") or [], "out": t.get("out") or ""}
                )
            )
    answer_raw = raw.get("answer") or {"type": "text"}
    return RbpConcept(
        id=str(raw.get("id") or "custom"),
        title=str(raw.get("title") or "Untitled"),
        brief=str(raw.get("brief") or ""),
        vars=list(raw.get("vars") or ["Answer"]),
        answer=RbpAnswerRule(**answer_raw) if isinstance(answer_raw, dict) else RbpAnswerRule(),
        tests=tests,
    )


def default_state() -> RbpWorkspaceState:
    concepts = [_parse_concept(c) for c in DEFAULT_CONCEPTS]
    return RbpWorkspaceState(
        version=1,
        pan=RbpPan(x=40, y=30),
        active_concept_id=concepts[0].id if concepts else None,
        concepts=concepts,
        stacks=[],
    )


class RuleBasedProcessService:
    """CRUD for rule_based_workspaces documents keyed by project_id."""

    def __init__(self) -> None:
        self._collection = None
        self._initialized = False

    def _ensure(self) -> None:
        if self._initialized:
            return
        client = gcp_clients.get_firestore_client()
        if client is None:
            raise RuntimeError("Firestore client is not available")
        self._collection = client.collection(COLLECTION)
        self._initialized = True

    def _doc(self, project_id: str):
        self._ensure()
        return self._collection.document(project_id)

    def _to_model(self, data: Dict[str, Any]) -> RuleBasedWorkspace:
        state_raw = data.get("state") or {}
        if isinstance(state_raw, dict):
            concepts = [_parse_concept(c) for c in (state_raw.get("concepts") or [])]
            pan_raw = state_raw.get("pan") or {}
            state = RbpWorkspaceState(
                version=int(state_raw.get("version") or 1),
                pan=RbpPan(
                    x=float(pan_raw.get("x", 40)),
                    y=float(pan_raw.get("y", 30)),
                ),
                zoom=max(0.5, min(2.0, float(state_raw.get("zoom") or 1))),
                active_concept_id=state_raw.get("active_concept_id"),
                concepts=concepts,
                stacks=list(state_raw.get("stacks") or []),
                empty_canvas=bool(state_raw.get("empty_canvas")),
            )
        else:
            state = default_state()

        created = data.get("createdAt") or datetime.now(timezone.utc)
        updated = data.get("updatedAt") or created
        if hasattr(created, "isoformat") is False:
            created = datetime.now(timezone.utc)
        if hasattr(updated, "isoformat") is False:
            updated = datetime.now(timezone.utc)

        return RuleBasedWorkspace(
            project_id=str(data.get("project_id") or ""),
            session_id=str(data.get("session_id") or ""),
            state=state,
            createdAt=created,
            updatedAt=updated,
        )

    def get_or_create(self, project_id: str, session_id: str) -> RuleBasedWorkspace:
        snap = self._doc(project_id).get()
        if snap.exists:
            data = snap.to_dict() or {}
            data.setdefault("project_id", project_id)
            data.setdefault("session_id", session_id)
            return self._to_model(data)

        now = datetime.now(timezone.utc)
        workspace = RuleBasedWorkspace(
            project_id=project_id,
            session_id=session_id,
            state=default_state(),
            createdAt=now,
            updatedAt=now,
        )
        payload = workspace.model_dump()
        self._doc(project_id).set(payload)
        logger.info("Created default RBP workspace for project %s", project_id)
        return workspace

    def save(self, project_id: str, session_id: str, state: RbpWorkspaceState) -> RuleBasedWorkspace:
        snap = self._doc(project_id).get()
        now = datetime.now(timezone.utc)
        created = now
        if snap.exists:
            prev = snap.to_dict() or {}
            created = prev.get("createdAt") or now
            if not hasattr(created, "isoformat"):
                created = now

        workspace = RuleBasedWorkspace(
            project_id=project_id,
            session_id=session_id,
            state=state,
            createdAt=created,
            updatedAt=now,
        )
        # Persist with aliases so "in" is stored for tests
        payload = workspace.model_dump(by_alias=True)
        self._doc(project_id).set(payload)
        logger.info("Saved RBP workspace for project %s (%s stacks)", project_id, len(state.stacks))
        return workspace

    def reset(self, project_id: str, session_id: str) -> RuleBasedWorkspace:
        state = default_state()
        # Keep an intentionally empty canvas after reset (do not auto-drop built-in solutions)
        state.empty_canvas = True
        return self.save(project_id, session_id, state)

    def delete(self, project_id: str) -> bool:
        snap = self._doc(project_id).get()
        if not snap.exists:
            return False
        self._doc(project_id).delete()
        return True

    def ask_model(self, prompt: str) -> str:
        """Classroom-friendly LLM reply for the Model blocks (RBP-only)."""
        text = (prompt or "").strip()
        if not text:
            raise ValueError("Prompt is empty")
        from .vertex_ai_service import VertexAIService

        vertex = VertexAIService(gcp_clients.project_id)
        system = (
            "You are a helpful classroom assistant for school students using a block-based "
            "programming playground.\n"
            "Your job: read the student's question carefully and answer it directly.\n"
            "Rules:\n"
            "- Answer the actual question asked (facts, explanations, ideas, help with homework).\n"
            "- Be clear, friendly, and accurate. Prefer short paragraphs or a few bullet points.\n"
            "- If the question is vague, give a useful best-effort answer and note what would help.\n"
            "- If you are unsure, say so briefly and share what you do know.\n"
            "- Do not refuse ordinary classroom questions. Do not mention system prompts.\n"
            "- Do not invent fake citations. Keep the tone suitable for students.\n\n"
            f"Student question:\n{text}"
        )
        reply = vertex.generate_text(system, max_tokens=700)
        return (reply or "").strip() or "I could not think of an answer right now."
