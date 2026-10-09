"""HTTP tests for the Rule Based Process Scratch project endpoints, without GCS or Firestore."""

from __future__ import annotations

import io
import json
import unittest
import zipfile
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.rule_based_process import (
    get_project_service,
    get_scratch_service,
    router,
    validate_session,
)
from app.models import ProjectType
from app.services.scratch_project_service import (
    MAX_SB3_BYTES,
    ScratchMeta,
    ScratchProjectService,
    ScratchProjectStore,
    next_version,
)


SESSION_ID = "sess-rbp"
OTHER_SESSION_ID = "sess-other"
PROJECT_ID = "proj-rbp"
TEXT_PROJECT_ID = "proj-text"
BASE = f"/api/rbp/session/{SESSION_ID}/projects/{PROJECT_ID}/scratch"


def make_sb3(sprite_name: str = "Sprite1", extra_files: Optional[dict] = None) -> bytes:
    project = {
        "targets": [
            {"isStage": True, "name": "Stage", "variables": {}, "blocks": {}, "costumes": [], "sounds": []},
            {"isStage": False, "name": sprite_name, "variables": {}, "blocks": {}, "costumes": [], "sounds": []},
        ],
        "monitors": [],
        "extensions": [],
        "meta": {"semver": "3.0.0"},
    }
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        zf.writestr("project.json", json.dumps(project))
        for name, data in (extra_files or {}).items():
            zf.writestr(name, data)
    return out.getvalue()


def read_sb3(data: bytes) -> tuple[dict, set]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return json.loads(zf.read("project.json")), set(zf.namelist())


class FakeProject:
    def __init__(self, project_id: str, session_id: str, project_type: ProjectType) -> None:
        self.id = project_id
        self.student_id = session_id
        self.type = project_type
        self.rbpEditor = None


class FakeProjectService:
    projects = {
        PROJECT_ID: FakeProject(PROJECT_ID, SESSION_ID, ProjectType.RULE_BASED_PROCESS),
        TEXT_PROJECT_ID: FakeProject(TEXT_PROJECT_ID, SESSION_ID, ProjectType.TEXT_RECOGNITION),
    }

    async def get_project(self, project_id: str):
        return self.projects.get(project_id)


class MemoryStore(ScratchProjectStore):
    """Same contract as the GCS/Firestore store, kept in memory."""

    def __init__(self) -> None:
        self.files: dict = {}
        self.meta: dict = {}
        self.legacy_workspaces: set = set()

    def get_meta(self, project_id: str) -> ScratchMeta:
        m = self.meta.get(project_id, {})
        return ScratchMeta(version=m.get("version", 0), saved_at=m.get("saved_at"), size_bytes=m.get("size"))

    def claim_version(self, project_id: str, if_match: int, client_id: Optional[str]) -> int:
        m = self.meta.setdefault(project_id, {})
        m["version"] = next_version(m.get("version", 0), m.get("client"), if_match, client_id)
        m["client"] = client_id
        return m["version"]

    def claim(self, project_id: str, client_id: str, loaded_version: Optional[int]) -> Optional[int]:
        m = self.meta.setdefault(project_id, {})
        current = m.get("version", 0)
        if loaded_version is not None and loaded_version != current:
            return None
        m["client"] = client_id
        return current

    def record_saved(self, project_id: str, size_bytes: int, saved_at: datetime) -> None:
        self.meta[project_id].update({"saved_at": saved_at, "size": size_bytes})

    def upload(self, project_id: str, data: bytes, version: int) -> None:
        self.files[project_id] = (data, version)

    def download(self, project_id: str):
        return self.files.get(project_id)

    def delete(self, project_id: str) -> int:
        return 1 if self.files.pop(project_id, None) else 0

    def resolve_editor(self, project_id: str, current: Optional[str]) -> str:
        return current or ("legacy" if project_id in self.legacy_workspaces else "scratch")


async def fake_session(session_id: str):
    if session_id != SESSION_ID and session_id != OTHER_SESSION_ID:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id}


class RbpScratchApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = MemoryStore()
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[validate_session] = fake_session
        app.dependency_overrides[get_project_service] = FakeProjectService
        app.dependency_overrides[get_scratch_service] = lambda: ScratchProjectService(self.store)
        self.client = TestClient(app)

    def put(self, body: bytes, version, client: str = "tab-a", path: str = BASE):
        headers = {"Content-Type": "application/x.scratch.sb3", "X-Client-Id": client}
        if version is not None:
            headers["If-Match"] = str(version)
        return self.client.put(path, content=body, headers=headers)

    def test_nothing_saved_returns_204_with_version_0(self) -> None:
        res = self.client.get(BASE)
        self.assertEqual(res.status_code, 204, res.text)
        self.assertEqual(res.headers["X-Scratch-Version"], "0")

    def test_save_then_load_round_trip(self) -> None:
        sb3 = make_sb3("Cat", {"abc.svg": b"<svg/>"})
        res = self.put(sb3, 0)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["version"], 1)
        self.assertEqual(body["sizeBytes"], len(sb3))
        self.assertIn("savedAt", body)

        loaded = self.client.get(BASE)
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.content, sb3)
        self.assertEqual(loaded.headers["X-Scratch-Version"], "1")
        self.assertEqual(loaded.headers["content-type"], "application/x.scratch.sb3")

        meta = self.client.get(BASE + "/meta").json()
        self.assertEqual(meta["version"], 1)
        self.assertEqual(meta["sizeBytes"], len(sb3))
        self.assertEqual(meta["editor"], "scratch")

    def open_tab(self, client: str) -> int:
        res = self.client.get(BASE, params={"clientId": client})
        self.assertIn(res.status_code, (200, 204), res.text)
        return int(res.headers["X-Scratch-Version"])

    def test_outdated_tab_gets_409_and_cannot_overwrite(self) -> None:
        v = self.open_tab("tab-a")
        self.assertEqual(self.put(make_sb3("A1"), v, client="tab-a").status_code, 200)
        # Tab B opens the project and saves
        v = self.open_tab("tab-b")
        self.assertEqual(v, 1)
        self.assertEqual(self.put(make_sb3("B1"), v, client="tab-b").status_code, 200)
        # Tab A was opened earlier
        res = self.put(make_sb3("A2"), 1, client="tab-a")
        self.assertEqual(res.status_code, 409, res.text)
        self.assertEqual(res.json()["detail"]["currentVersion"], 2)
        project, _ = read_sb3(self.client.get(BASE).content)
        self.assertEqual(project["targets"][1]["name"], "B1")

    def test_older_tab_loses_even_before_newer_tab_saves(self) -> None:
        self.open_tab("tab-a")
        self.open_tab("tab-b")
        # Both loaded version 0; the older tab A must not overwrite what B is editing
        self.assertEqual(self.put(make_sb3("A1"), 0, client="tab-a").status_code, 409)
        self.assertEqual(self.put(make_sb3("B1"), 0, client="tab-b").status_code, 200)

    def test_same_tab_can_replace_its_own_save_after_lost_response(self) -> None:
        self.open_tab("tab-a")
        self.assertEqual(self.put(make_sb3("A1"), 0, client="tab-a").status_code, 200)
        # Response to the first save never arrived, so the tab retries with the old version
        res = self.put(make_sb3("A2"), 0, client="tab-a")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["version"], 2)

    def test_project_json_save_keeps_costumes_and_sounds(self) -> None:
        self.put(make_sb3("Cat", {"cat.svg": b"<svg/>", "meow.wav": b"RIFF"}), 0)
        new_json = json.loads(json.dumps(read_sb3(make_sb3("Renamed"))[0]))
        # Sent like a closing tab does: plain-text POST, version and client in the query
        res = self.client.post(
            BASE + "/project-json",
            params={"version": "1", "clientId": "tab-a"},
            content=json.dumps(new_json).encode(),
            headers={"Content-Type": "text/plain;charset=UTF-8"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["version"], 2)
        project, names = read_sb3(self.client.get(BASE).content)
        self.assertEqual(project["targets"][1]["name"], "Renamed")
        self.assertEqual(names, {"project.json", "cat.svg", "meow.wav"})

    def test_project_json_save_rejects_invalid_json(self) -> None:
        res = self.client.post(BASE + "/project-json", params={"version": "0"}, content=b"{not json")
        self.assertEqual(res.status_code, 400, res.text)

    def test_missing_if_match_is_428(self) -> None:
        self.assertEqual(self.put(make_sb3(), None).status_code, 428)

    def test_bad_if_match_is_400(self) -> None:
        self.assertEqual(self.put(make_sb3(), "abc").status_code, 400)

    def test_quoted_if_match_is_accepted(self) -> None:
        self.assertEqual(self.put(make_sb3(), '"0"').status_code, 200)

    def test_non_zip_body_is_400(self) -> None:
        res = self.put(b"this is not a zip file", 0)
        self.assertEqual(res.status_code, 400, res.text)
        self.assertEqual(self.store.files, {})

    def test_zip_without_project_json_is_400(self) -> None:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as zf:
            zf.writestr("readme.txt", "hello")
        self.assertEqual(self.put(out.getvalue(), 0).status_code, 400)

    def test_empty_body_is_400(self) -> None:
        self.assertEqual(self.put(b"", 0).status_code, 400)

    def test_oversized_body_is_413(self) -> None:
        res = self.put(b"0" * (MAX_SB3_BYTES + 1), 0)
        self.assertEqual(res.status_code, 413, res.text)
        self.assertEqual(self.store.files, {})

    def test_other_session_is_403(self) -> None:
        path = f"/api/rbp/session/{OTHER_SESSION_ID}/projects/{PROJECT_ID}/scratch"
        self.assertEqual(self.client.get(path).status_code, 403)
        self.assertEqual(self.put(make_sb3(), 0, path=path).status_code, 403)

    def test_unknown_session_is_404(self) -> None:
        path = f"/api/rbp/session/nope/projects/{PROJECT_ID}/scratch"
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_unknown_project_is_404(self) -> None:
        path = f"/api/rbp/session/{SESSION_ID}/projects/missing/scratch"
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_wrong_project_type_is_400(self) -> None:
        path = f"/api/rbp/session/{SESSION_ID}/projects/{TEXT_PROJECT_ID}/scratch"
        self.assertEqual(self.client.get(path).status_code, 400)
        self.assertEqual(self.put(make_sb3(), 0, path=path).status_code, 400)

    def test_meta_reports_legacy_editor(self) -> None:
        self.store.legacy_workspaces.add(PROJECT_ID)
        self.assertEqual(self.client.get(BASE + "/meta").json()["editor"], "legacy")


if __name__ == "__main__":
    unittest.main()
