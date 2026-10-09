"""Workspace persistence helpers for Firestore nested-array constraints."""

from app.services.exercises_service import (
    decode_from_firestore,
    encode_for_firestore,
    firestore_workspace_payload,
)
from app.models import ExercisesWorkspace, ExercisesWorkspaceState


def _contains_nested_array(value) -> bool:
    if isinstance(value, list):
        if any(isinstance(item, list) for item in value):
            return True
        return any(_contains_nested_array(item) for item in value)
    if isinstance(value, dict):
        return any(_contains_nested_array(item) for item in value.values())
    return False


def test_encode_unwraps_confusion_matrix():
    state = {
        "version": 1,
        "progress": {},
        "activeId": 2,
        "ex2Result": {
            "packId": "cse",
            "packLabel": "CSE",
            "classes": ["Bug", "Feature"],
            "matrix": [[10, 2], [1, 11]],
            "probsByClass": {"Bug": {"pos": [0.8, 0.7], "neg": [0.2]}},
        },
    }
    encoded = encode_for_firestore(state)
    assert not _contains_nested_array(encoded)
    restored = decode_from_firestore(encoded)
    assert restored["ex2Result"]["matrix"] == [[10, 2], [1, 11]]
    assert restored["ex2Result"]["classes"] == ["Bug", "Feature"]
    assert restored["ex2Result"]["probsByClass"]["Bug"]["pos"] == [0.8, 0.7]


def test_workspace_payload_strips_nested_matrix():
    workspace = ExercisesWorkspace(
        project_id="p1",
        session_id="s1",
        state=ExercisesWorkspaceState(
            version=1,
            progress={},
            activeId=2,
            ex2Result={
                "packId": "cse",
                "classes": ["A", "B"],
                "matrix": [[1, 0], [0, 1]],
            },
        ),
    )
    payload = firestore_workspace_payload(workspace)
    assert not _contains_nested_array(payload["state"])
    restored = decode_from_firestore(payload["state"])
    assert restored["ex2Result"]["matrix"] == [[1, 0], [0, 1]]
