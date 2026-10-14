"""Tests for the Copilot labs' saved answers (app/api/copilot_lab.py, app/services/copilot_lab_service.py).

Offline: the session check, the project lookup and Firestore are replaced by small fakes.

Run from backend/:  .venv/Scripts/python.exe -m unittest test_copilot_lab -v
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import copilot_lab
from app.api.exercises import get_project_service, validate_session
from app.services.copilot_lab_service import CopilotLabService, clean_answers

S, P = "session_abc", "proj-1"
URL = f"/api/copilot-lab/session/{S}/projects/{P}"


# ── a tiny in-memory Firestore ────────────────────────────────


class Snap:
    def __init__(self, ref):
        self.reference, self.id = ref, ref.id
        self.exists = ref.id in ref.store

    def to_dict(self):
        return dict(self.reference.store[self.id]) if self.exists else None


class Doc:
    def __init__(self, store, id_):
        self.store, self.id = store, id_

    def get(self):
        return Snap(self)

    def set(self, data):
        self.store[self.id] = dict(data)

    def update(self, data):
        self.store[self.id].update(data)

    def delete(self):
        self.store.pop(self.id, None)


class Query:
    def __init__(self, store, field, value):
        self.store, self.field, self.value = store, field, value

    def stream(self):
        return [Snap(Doc(self.store, k)) for k, v in list(self.store.items()) if v.get(self.field) == self.value]


class Coll:
    def __init__(self, store):
        self.store = store

    def document(self, id_):
        return Doc(self.store, id_)

    def where(self, field, op, value):
        return Query(self.store, field, value)


class FakeDb:
    def __init__(self):
        self.colls = {}

    def collection(self, name):
        return Coll(self.colls.setdefault(name, {}))


# ── the app under test ────────────────────────────────────────


def make_client(project_type="copilot-ethics", owner=S):
    db = FakeDb()
    db.collection("projects").document(P).set({"status": "draft"})
    projects = SimpleNamespace(get_project=None)

    async def get_project(pid):
        return SimpleNamespace(id=pid, student_id=owner, type=project_type) if pid == P else None

    projects.get_project = get_project
    app = FastAPI()
    app.include_router(copilot_lab.router)
    app.dependency_overrides[validate_session] = lambda: {"session_id": S}
    app.dependency_overrides[get_project_service] = lambda: projects
    app.dependency_overrides[copilot_lab.get_copilot_service] = lambda: CopilotLabService(db=db)
    return TestClient(app), db


class CopilotLabApi(unittest.TestCase):
    def test_get_empty(self):
        client, _ = make_client()
        r = client.get(URL)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["data"], {"activity": "ethics", "answers": {}, "completedSteps": [], "updatedAt": None})

    def test_put_then_get_and_card_ready(self):
        client, db = make_client("copilot-document-ai")
        answers = {"amount": 0, "traps": {"ticked": [0, 1], "done": True}, "decide": ["  Check the ISIN with the RTA  "]}
        r = client.put(URL, json={"answers": answers, "completedSteps": ["s1"]})
        self.assertEqual(r.status_code, 200)
        data = client.get(URL).json()["data"]
        self.assertEqual(data["activity"], "document-ai")
        self.assertEqual(data["completedSteps"], ["s1"])
        self.assertEqual(data["answers"]["decide"], ["Check the ISIN with the RTA"])  # trimmed
        self.assertEqual(data["answers"]["traps"], {"ticked": [0, 1], "done": True})
        self.assertTrue(data["updatedAt"])
        self.assertEqual(db.colls["projects"][P]["status"], "trained")  # the card shows ready
        self.assertIn(f"{P}_{S}", db.colls["copilot_labs"])

    def test_no_finished_step_leaves_the_card_as_is(self):
        client, db = make_client()
        client.put(URL, json={"answers": {"overhide": 0}, "completedSteps": []})
        self.assertEqual(db.colls["projects"][P]["status"], "draft")

    def test_notes_capped_at_300(self):
        self.assertEqual(len(clean_answers({"decide": ["x" * 500]})["decide"][0]), 300)

    def test_wrong_session_is_403(self):
        client, _ = make_client(owner="someone_else")
        self.assertEqual(client.get(URL).status_code, 403)
        self.assertEqual(client.put(URL, json={"answers": {}}).status_code, 403)

    def test_wrong_project_type_is_400(self):
        client, _ = make_client("rag-chatbot")
        self.assertEqual(client.get(URL).status_code, 400)

    def test_oversize_body_is_refused(self):
        client, db = make_client()
        big = {f"k{i}": "y" * 290 for i in range(80)}  # ~24 KB of answers
        r = client.put(URL, json={"answers": big, "completedSteps": []})
        self.assertIn(r.status_code, (400, 413))
        self.assertNotIn(f"{P}_{S}", db.colls.get("copilot_labs", {}))

    def test_bad_shapes_are_400(self):
        client, _ = make_client()
        self.assertEqual(client.put(URL, json={"answers": [1, 2]}).status_code, 400)
        self.assertEqual(client.put(URL, json={"answers": {}, "completedSteps": "s1"}).status_code, 400)

    def test_delete(self):
        client, db = make_client()
        client.put(URL, json={"answers": {"overhide": 0}, "completedSteps": ["s1"]})
        self.assertEqual(client.delete(URL).status_code, 200)
        self.assertNotIn(f"{P}_{S}", db.colls["copilot_labs"])
        self.assertEqual(client.get(URL).json()["data"]["answers"], {})

    def test_service_delete_without_session_removes_every_copy(self):
        db = FakeDb()
        svc = CopilotLabService(db=db)
        svc.save(P, S, "ethics", {"overhide": 0}, [])
        svc.save(P, "session_other", "ethics", {"overhide": 1}, [])
        svc.delete(P)
        self.assertEqual(db.colls["copilot_labs"], {})


if __name__ == "__main__":
    unittest.main()
