"""Isolated Exercises workspace persistence and classroom LLM helpers.

Does not alter other project-type flows.
"""

from __future__ import annotations

import hashlib
import logging
import math
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from ..config import gcp_clients
from ..models import (
    ExerciseProgress,
    ExercisesChatExample,
    ExercisesWorkspace,
    ExercisesWorkspaceState,
)
from .exercises_vertex_models import (
    DEFAULT_VERTEX_MODEL,
    VERTEX_CHAT_MODELS,
    resolve_vertex_model,
    vertex_chat_service,
    vertex_max_output_tokens,
)

logger = logging.getLogger(__name__)

COLLECTION = "exercises_workspaces"
# Firestore reserves field names like __x__, so the old "__arr__" marker made every save
# with a list fail. "_arr" is allowed; decoding also accepts the old name.
_ARR_MARK = "_arr"
_LEGACY_ARR_MARKS = ("__arr__",)
_NUMS_MARK = "_nums"
_NUMS_MIN = 64


def encode_for_firestore(value: Any) -> Any:
    """Rewrite nested arrays so Firestore will accept the document.

    Firestore rejects list-of-lists (for example a confusion matrix). Every
    Python list becomes a one-key map so inner rows stay maps, not arrays.
    """
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return 0.0
        return value
    if isinstance(value, dict):
        return {
            str(key): encode_for_firestore(item)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, (list, tuple)):
        # Long number lists (Ex 2 held-out scores) as one string: Firestore indexes every
        # array element and caps a document at 40,000 index entries, which a 4+ class
        # model's scores would exceed.
        if len(value) > _NUMS_MIN and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value):
            if all(isinstance(v, int) for v in value):
                return {_NUMS_MARK: "i|" + ",".join(str(v) for v in value)}
            return {_NUMS_MARK: "f|" + ",".join(repr(float(v)) if math.isfinite(v) else "0.0" for v in value)}
        return {_ARR_MARK: [encode_for_firestore(item) for item in value]}
    return value


def decode_from_firestore(value: Any) -> Any:
    """Restore lists that encode_for_firestore wrapped for Firestore."""
    if isinstance(value, dict):
        if len(value) == 1:
            (key, inner), = value.items()
            if key in (_ARR_MARK, *_LEGACY_ARR_MARKS) and isinstance(inner, list):
                return [decode_from_firestore(item) for item in inner]
            if key == _NUMS_MARK and isinstance(inner, str):
                kind, _, body = inner.partition("|")
                if not body:
                    return []
                cast = int if kind == "i" else float
                return [cast(x) for x in body.split(",")]
        return {key: decode_from_firestore(item) for key, item in value.items()}
    if isinstance(value, list):
        return [decode_from_firestore(item) for item in value]
    return value


def firestore_workspace_payload(workspace: ExercisesWorkspace) -> Dict[str, Any]:
    payload = workspace.model_dump()
    payload["state"] = encode_for_firestore(payload.get("state") or {})
    return payload


VALID_MODELS = tuple(VERTEX_CHAT_MODELS.keys())
VALID_EMBED_MODELS = (
    "text-embedding-005",
    "text-embedding-004",
    "text-multilingual-embedding-002",
    "gemini-embedding-001",
)

# Classroom hash-embed shapes so two models still differ when Vertex is offline.
_EMBED_FALLBACK_SHAPE = {
    "text-embedding-004": (48, 3),
    "text-embedding-005": (64, 5),
    "text-multilingual-embedding-002": (96, 4),
    "gemini-embedding-001": (128, 2),
}


def default_state() -> ExercisesWorkspaceState:
    return ExercisesWorkspaceState(version=1, progress={})


def _hash_embed(text: str, dim: int = 48, ngram: int = 3) -> List[float]:
    """Educational fallback embedding (character n-grams). Not a production model."""
    vec = [0.0] * dim
    blob = (text or "").lower()
    if not blob:
        return vec
    padded = f" {blob} "
    for i in range(max(1, len(padded) - ngram + 1)):
        gram = padded[i : i + ngram]
        digest = hashlib.md5(gram.encode("utf-8")).hexdigest()
        idx = int(digest[:8], 16) % dim
        sign = 1.0 if int(digest[8:10], 16) % 2 == 0 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def _simulated_completion(
    prompt: str,
    system: Optional[str],
    examples: List[ExercisesChatExample],
    model: str,
    temperature: float,
    index: int,
) -> str:
    """Classroom-safe local reply when Vertex is unavailable."""
    seed = hashlib.md5(f"{prompt}|{system}|{model}|{temperature}|{index}".encode("utf-8")).hexdigest()
    rng = random.Random(int(seed[:8], 16))
    persona = (system or "").strip()
    few_shot_hint = ""
    if examples:
        last = examples[-1].assistant.strip()
        if last:
            few_shot_hint = last.split(".")[0][:160]

    base = (
        f"Here is a direct answer to: {prompt.strip()[:280]}\n\n"
        "Key points:\n"
        "- Stay on the student's question.\n"
        "- Use the given instructions if they exist.\n"
        "- Keep the tone suitable for a classroom lab."
    )
    if persona:
        base = f"[Persona applied] {persona[:180]}\n\n{base}"
    if few_shot_hint:
        base += f"\n\nFollowing the style of the examples: {few_shot_hint}."

    if model == "gemini-2.5-pro":
        base += (
            "\n\nReasoning sketch:\n"
            "1. Restate the task.\n"
            "2. Apply the instructions.\n"
            "3. Give a complete, formatted answer."
        )
    else:
        base += "\n\nConcise lab note: this is the shorter model style."

    if temperature <= 0.2:
        return base
    extras = [
        "A playful extra sentence wandered in because temperature is high.",
        "Optional tangent: imagine explaining this to a 12-year-old.",
        "Creative variant: rewrite the last line as a metaphor.",
        "Wilder take: add an unexpected but still relevant analogy.",
        "Slightly messy draft: some wording may feel less consistent.",
    ]
    extra_count = 1 if temperature < 0.8 else 2
    picks = rng.sample(extras, k=min(extra_count, len(extras)))
    return base + "\n\n" + "\n".join(picks)


class ExercisesService:
    """CRUD for exercises_workspaces documents keyed by project_id."""

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

    def _to_model(self, data: Dict[str, Any]) -> ExercisesWorkspace:
        state_raw = data.get("state") or {}
        progress: Dict[str, ExerciseProgress] = {}
        raw_progress = state_raw.get("progress") or {}
        if isinstance(raw_progress, dict):
            for key, value in raw_progress.items():
                if isinstance(value, dict):
                    status = str(value.get("status") or "not_started")
                    if status not in ("not_started", "in_progress", "completed"):
                        status = "not_started"
                    progress[str(key)] = ExerciseProgress(
                        status=status,
                        notes=str(value.get("notes") or ""),
                        snapshot=dict(value.get("snapshot") or {}),
                    )
        state = ExercisesWorkspaceState(
            version=int(state_raw.get("version") or 1),
            progress=progress,
            activeId=state_raw.get("activeId"),
            ex2Result=state_raw.get("ex2Result") if isinstance(state_raw.get("ex2Result"), dict) else None,
        )
        created = data.get("createdAt") or datetime.now(timezone.utc)
        updated = data.get("updatedAt") or created
        if hasattr(created, "isoformat") is False:
            created = datetime.now(timezone.utc)
        if hasattr(updated, "isoformat") is False:
            updated = datetime.now(timezone.utc)
        return ExercisesWorkspace(
            project_id=str(data.get("project_id") or ""),
            session_id=str(data.get("session_id") or ""),
            state=state,
            createdAt=created,
            updatedAt=updated,
        )

    def _read_doc(self, data: Dict[str, Any]) -> ExercisesWorkspace:
        state_raw = data.get("state")
        if isinstance(state_raw, dict):
            data = {**data, "state": decode_from_firestore(state_raw)}
        return self._to_model(data)

    def get_or_create(self, project_id: str, session_id: str) -> ExercisesWorkspace:
        snap = self._doc(project_id).get()
        if snap.exists:
            data = snap.to_dict() or {}
            workspace = self._read_doc(data)
            if workspace.session_id and workspace.session_id != session_id:
                raise PermissionError("Workspace belongs to another session")
            return workspace
        now = datetime.now(timezone.utc)
        workspace = ExercisesWorkspace(
            project_id=project_id,
            session_id=session_id,
            state=default_state(),
            createdAt=now,
            updatedAt=now,
        )
        self._doc(project_id).set(firestore_workspace_payload(workspace))
        return workspace

    def save(
        self,
        project_id: str,
        session_id: str,
        state: ExercisesWorkspaceState,
    ) -> ExercisesWorkspace:
        existing = self.get_or_create(project_id, session_id)
        now = datetime.now(timezone.utc)
        workspace = ExercisesWorkspace(
            project_id=project_id,
            session_id=session_id,
            state=state,
            createdAt=existing.createdAt,
            updatedAt=now,
        )
        self._doc(project_id).set(firestore_workspace_payload(workspace))
        return workspace

    def reset(self, project_id: str, session_id: str) -> ExercisesWorkspace:
        return self.save(project_id, session_id, default_state())

    def delete(self, project_id: str) -> bool:
        try:
            snap = self._doc(project_id).get()
        except Exception:
            return False
        if not snap.exists:
            return False
        self._doc(project_id).delete()
        return True

    def generate(
        self,
        prompt: str,
        system: Optional[str],
        examples: List[ExercisesChatExample],
        model: str,
        temperature: float,
        n: int,
        max_tokens: int,
    ) -> Dict[str, Any]:
        chosen = resolve_vertex_model(model)
        if chosen not in VALID_MODELS:
            chosen = DEFAULT_VERTEX_MODEL
        outputs: List[str] = []
        simulated = False
        try:
            from google.genai import types

            vertex = vertex_chat_service()
            messages: List[str] = []
            if system:
                messages.append(f"System instructions:\n{system.strip()}")
            for ex in examples[:6]:
                if ex.user:
                    messages.append(f"Example user:\n{ex.user.strip()}")
                if ex.assistant:
                    messages.append(f"Example assistant:\n{ex.assistant.strip()}")
            messages.append(f"User:\n{prompt.strip()}")
            packed = "\n\n".join(messages)
            for i in range(n):
                response = vertex.client.models.generate_content(
                    model=chosen,
                    contents=packed,
                    config=types.GenerateContentConfig(
                        temperature=float(temperature),
                        max_output_tokens=vertex_max_output_tokens(chosen, int(max_tokens)),
                    ),
                )
                text = (getattr(response, "text", None) or "").strip()
                if not text:
                    text = _simulated_completion(prompt, system, examples, chosen, temperature, i)
                    simulated = True
                outputs.append(text)
        except Exception as e:
            logger.warning("Exercises generate fell back to simulator: %s", e)
            simulated = True
            outputs = [
                _simulated_completion(prompt, system, examples, chosen, temperature, i)
                for i in range(n)
            ]
        return {
            "outputs": outputs,
            "model": chosen,
            "temperature": temperature,
            "simulated": simulated,
        }

    def embed(self, texts: List[str], model: str) -> Dict[str, Any]:
        chosen = model if model in VALID_EMBED_MODELS else "text-embedding-005"
        cleaned = [str(t)[:2000] for t in texts[:12]]
        simulated = False
        embeddings: List[List[float]] = []
        try:
            from .vertex_ai_service import VertexAIService

            vertex = VertexAIService(gcp_clients.project_id)
            embeddings = vertex.generate_embeddings_batch(cleaned, embedding_model_name=chosen)
        except Exception as e:
            logger.warning("Exercises embed fell back to hashed vectors: %s", e)
            simulated = True
            dim, ngram = _EMBED_FALLBACK_SHAPE.get(chosen, (64, 5))
            embeddings = [_hash_embed(t, dim=dim, ngram=ngram) for t in cleaned]
        dims = len(embeddings[0]) if embeddings else 0
        return {
            "embeddings": embeddings,
            "model": chosen,
            "simulated": simulated,
            "dimensions": dims,
        }
