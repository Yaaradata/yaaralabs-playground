"""Admin area API (app/api/admin_portal.py): signup/login/JWT, stats, filters and clear actions.
Offline: an in-memory Firestore and bucket stand in for the real project, so nothing real is touched.

  .venv/Scripts/python.exe -m unittest test_admin_portal -v
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import admin_portal
from app.config import settings
from app.services import admin_auth
from app.services.admin_auth import AdminUserStore
from app.services import admin_dashboard_service
from app.services.admin_dashboard_service import AdminDashboardService

NOW = datetime.now(timezone.utc)
SECRET = "x" * 40
CODE = "let-me-in"


# ── fakes ──

class Snap:
    def __init__(self, ref, data):
        self.reference, self.id, self._data = ref, ref.id, data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class DocRef:
    def __init__(self, store, col, doc_id):
        self.store, self.col, self.id = store, col, doc_id

    def get(self):
        return Snap(self, self.store.data.get(self.col, {}).get(self.id))

    def set(self, data):
        self.store.data.setdefault(self.col, {})[self.id] = dict(data)

    def update(self, data):
        self.store.data[self.col][self.id].update(data)

    def delete(self):
        self.store.data.get(self.col, {}).pop(self.id, None)


class Collection:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def document(self, doc_id):
        return DocRef(self.store, self.name, doc_id)

    def select(self, fields):
        return self

    def stream(self):
        return [DocRef(self.store, self.name, k).get() for k in list(self.store.data.get(self.name, {}))]

    def add(self, data):
        self.document(f"auto{len(self.store.data.get(self.name, {}))}").set(data)


class Batch:
    def __init__(self):
        self.refs = []

    def delete(self, ref):
        self.refs.append(ref)

    def commit(self):
        for r in self.refs:
            r.delete()


class FakeDB:
    def __init__(self):
        self.data = {}

    def collection(self, name):
        return Collection(self, name)

    def batch(self):
        return Batch()


class FakeBucket:
    def __init__(self, names):
        self.blobs = {n: SimpleNamespace(name=n, size=100, updated=NOW) for n in names}

    def list_blobs(self, prefix="", fields=None):
        return [b for n, b in sorted(self.blobs.items()) if n.startswith(prefix)]

    def delete_blobs(self, blobs, on_error=None):
        for b in blobs:
            self.blobs.pop(b.name, None)


# ── setup ──

def seed(db: FakeDB):
    def project(pid, kind, sid, created):
        db.collection("projects").document(pid).set({
            "id": pid, "name": f"Project {pid}", "type": kind, "status": "draft", "student_id": sid,
            "createdBy": f"guest:{sid}" if sid else "teacher:t1", "createdAt": created, "model": {}})

    project("p1", "text-recognition", "session_a", NOW - timedelta(hours=1))
    project("p2", "rag-chatbot", "session_a", NOW - timedelta(days=3))
    project("p3", "live-object-detection", "session_b", NOW - timedelta(days=10))
    project("p4", "text-recognition", "", NOW - timedelta(days=2))
    for sid, created, expires, active in [
        ("session_a", NOW - timedelta(hours=2), NOW + timedelta(days=5), True),
        ("session_b", NOW - timedelta(days=10), NOW - timedelta(days=3), True),
        ("session_c", NOW - timedelta(days=1), NOW + timedelta(days=6), False),
    ]:
        db.collection("guest_sessions").document(sid).set({
            "session_id": sid, "createdAt": created, "expiresAt": expires, "active": active,
            "ip_address": "10.0.0.1", "user_agent": "test"})


BLOBS = [
    "models/p1/model.pkl", "models/p1/vectorizer.pkl", "models/gone/model.pkl",
    "image-models/session_b/p3/model.json", "image-models/session_b/p3/weights.bin",
    "datasets/p1/data.csv", "images/p3/cat/1.jpg", "other/keep.txt",
]


class AdminTestCase(unittest.TestCase):
    def setUp(self):
        for name, value in (("admin_jwt_secret", SECRET), ("admin_signup_code", CODE)):
            p = mock.patch.object(settings, name, value)
            p.start()
            self.addCleanup(p.stop)
        admin_portal._login_limiter = admin_portal.SlidingWindowLimiter()
        admin_dashboard_service._models_cache.clear()
        self.db = FakeDB()
        seed(self.db)
        self.bucket = FakeBucket(BLOBS)
        self.cleanups = []
        self.svc = AdminDashboardService(self.db, self.bucket, cleanup=lambda *a: self.cleanups.append(a))
        app = FastAPI()
        app.include_router(admin_portal.router)
        app.dependency_overrides[admin_portal.get_user_store] = lambda: AdminUserStore(self.db)
        app.dependency_overrides[admin_portal.get_dashboard] = lambda: self.svc
        self.client = TestClient(app)

    def signup(self, email="Admin@Example.com", password="secret123", code=CODE):
        return self.client.post("/api/admin/signup", json={
            "email": email, "name": "Ada", "password": password, "signup_code": code})

    def auth(self):
        token = self.signup().json()["access_token"]
        return {"Authorization": f"Bearer {token}"}


class AuthTests(AdminTestCase):
    def test_signup_stores_hashed_password_in_admin_users(self):
        r = self.signup()
        self.assertEqual(r.status_code, 201, r.text)
        stored = self.db.data["admin_users"]["admin@example.com"]
        self.assertNotEqual(stored["password_hash"], "secret123")
        self.assertTrue(stored["password_hash"].startswith("$2"))
        self.assertEqual(stored["role"], "admin")
        self.assertNotIn("password_hash", r.json()["admin"])

    def test_signup_needs_the_code(self):
        self.assertEqual(self.signup(code="wrong").status_code, 403)
        with mock.patch.object(settings, "admin_signup_code", ""):
            self.assertEqual(self.signup().status_code, 403)
        self.assertNotIn("admin_users", self.db.data)

    def test_signup_validates_and_rejects_duplicates(self):
        self.assertEqual(self.signup(password="short1").status_code, 400)
        self.assertEqual(self.signup(password="lettersonly").status_code, 400)
        self.assertEqual(self.signup(email="not-an-email").status_code, 400)
        self.assertEqual(self.signup().status_code, 201)
        self.assertEqual(self.signup(email="admin@example.com").status_code, 409)

    def test_login_and_me(self):
        self.signup()
        bad = self.client.post("/api/admin/login", json={"email": "admin@example.com", "password": "nope12345"})
        self.assertEqual(bad.status_code, 401)
        unknown = self.client.post("/api/admin/login", json={"email": "who@example.com", "password": "secret123"})
        self.assertEqual(unknown.status_code, 401)
        r = self.client.post("/api/admin/login", json={"email": " ADMIN@example.com ", "password": "secret123"})
        self.assertEqual(r.status_code, 200, r.text)
        me = self.client.get("/api/admin/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
        self.assertEqual(me.json()["email"], "admin@example.com")
        self.assertIsNotNone(self.db.data["admin_users"]["admin@example.com"]["last_login_at"])

    def test_every_admin_route_needs_a_valid_token(self):
        routes = [("get", "/api/admin/stats"), ("get", "/api/admin/projects"), ("get", "/api/admin/sessions"),
                  ("get", "/api/admin/models"), ("get", "/api/admin/me"), ("get", "/api/admin/audit"),
                  ("delete", "/api/admin/projects/p1"), ("post", "/api/admin/clear-everything")]
        for method, path in routes:
            self.assertEqual(getattr(self.client, method)(path).status_code, 401, path)
            r = getattr(self.client, method)(path, headers={"Authorization": "Bearer garbage"})
            self.assertEqual(r.status_code, 401, path)
        self.assertIn("p1", self.db.data["projects"])

    def test_token_signed_with_another_secret_or_expired_is_refused(self):
        headers = self.auth()
        with mock.patch.object(settings, "admin_jwt_secret", "y" * 40):
            self.assertEqual(self.client.get("/api/admin/me", headers=headers).status_code, 401)
        with mock.patch.object(admin_auth, "_now", return_value=NOW - timedelta(hours=9)):
            old = admin_auth.create_token({"email": "admin@example.com"})["access_token"]
        self.assertEqual(self.client.get("/api/admin/me", headers={"Authorization": f"Bearer {old}"}).status_code, 401)

    def test_deleted_or_deactivated_admin_loses_access(self):
        headers = self.auth()
        self.db.data["admin_users"]["admin@example.com"]["active"] = False
        self.assertEqual(self.client.get("/api/admin/me", headers=headers).status_code, 401)
        del self.db.data["admin_users"]["admin@example.com"]
        self.assertEqual(self.client.get("/api/admin/me", headers=headers).status_code, 401)

    def test_no_secret_means_admin_is_off(self):
        with mock.patch.object(settings, "admin_jwt_secret", "short"):
            self.assertEqual(self.signup().status_code, 503)
            self.assertFalse(self.client.get("/api/admin/config").json()["login_enabled"])

    def test_login_is_rate_limited(self):
        codes = [self.client.post("/api/admin/login", json={"email": "a@b.co", "password": "x"}).status_code
                 for _ in range(12)]
        self.assertEqual(codes[-1], 429)


class DashboardTests(AdminTestCase):
    def test_stats(self):
        s = self.client.get("/api/admin/stats", headers=self.auth()).json()
        self.assertEqual(s["projects"]["total"], 4)
        self.assertEqual(s["projects"]["by_type"]["text-recognition"], 2)
        self.assertEqual(s["projects"]["guest"], 3)
        self.assertEqual(s["projects"]["last_24h"], 1)
        self.assertEqual((s["sessions"]["active"], s["sessions"]["expired"], s["sessions"]["inactive"]), (1, 1, 1))
        self.assertEqual(s["models"]["total"], 3)  # models/p1, models/gone, image-models/session_b/p3
        self.assertEqual(s["models"]["files"], 5)
        self.assertEqual(s["models"]["by_kind"], {"text": 2, "image": 1})
        self.assertEqual(s["admins"], 1)

    def test_project_filters(self):
        h = self.auth()

        def ids(**params):
            return [p["id"] for p in self.client.get("/api/admin/projects", headers=h, params=params).json()["items"]]

        self.assertEqual(ids(), ["p1", "p4", "p2", "p3"])
        self.assertEqual(ids(type="text-recognition"), ["p1", "p4"])
        self.assertEqual(ids(session_id="session_a"), ["p1", "p2"])
        self.assertEqual(ids(owner="other"), ["p4"])
        self.assertEqual(ids(search="P3"), ["p3"])
        self.assertEqual(ids(date_from=(NOW - timedelta(days=5)).isoformat(), sort="oldest"), ["p2", "p4", "p1"])
        page = self.client.get("/api/admin/projects", headers=h, params={"limit": 2, "offset": 2}).json()
        self.assertEqual((page["total"], [p["id"] for p in page["items"]]), (4, ["p2", "p3"]))
        self.assertIn("rag-chatbot", page["types"])

    def test_session_filters(self):
        h = self.auth()
        r = self.client.get("/api/admin/sessions", headers=h, params={"status": "active"}).json()
        self.assertEqual([s["session_id"] for s in r["items"]], ["session_a"])
        self.assertEqual(r["items"][0]["project_count"], 2)
        r = self.client.get("/api/admin/sessions", headers=h, params={"search": "SESSION_B"}).json()
        self.assertEqual(r["items"][0]["status"], "expired")

    def test_model_filters(self):
        h = self.auth()
        r = self.client.get("/api/admin/models", headers=h, params={"orphaned": "true"}).json()
        self.assertEqual([m["key"] for m in r["items"]], ["models/gone/"])
        r = self.client.get("/api/admin/models", headers=h, params={"kind": "image"}).json()
        self.assertEqual(r["items"][0]["session_id"], "session_b")
        self.assertEqual(r["items"][0]["bytes"], 200)


    def test_model_listing_is_cached_between_requests(self):
        h = self.auth()
        with mock.patch.object(self.bucket, "list_blobs", wraps=self.bucket.list_blobs) as listing:
            self.client.get("/api/admin/stats", headers=h)
            self.client.get("/api/admin/models", headers=h)
        self.assertEqual(listing.call_count, 2)  # one per model prefix, then served from the cache


class ClearTests(AdminTestCase):
    def test_delete_one_project_cleans_files_and_logs(self):
        h = self.auth()
        r = self.client.delete("/api/admin/projects/p1", headers=h)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn("p1", self.db.data["projects"])
        self.assertFalse([n for n in self.bucket.blobs if "/p1/" in n])
        self.assertIn(("text-recognition", "p1", "session_a"), self.cleanups)
        self.assertEqual(self.client.delete("/api/admin/projects/p1", headers=h).status_code, 404)
        log = self.client.get("/api/admin/audit", headers=h).json()["items"]
        self.assertEqual(log[0]["action"], "delete_project")
        self.assertEqual(log[0]["admin"], "admin@example.com")

    def test_delete_all_projects_needs_the_phrase(self):
        h = self.auth()
        r = self.client.post("/api/admin/projects/delete-all", headers=h, json={"confirm": "yes"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(len(self.db.data["projects"]), 4)
        r = self.client.post("/api/admin/projects/delete-all", headers=h, json={"confirm": "DELETE ALL PROJECTS"})
        self.assertEqual(r.json()["deleted_projects"], 4)
        self.assertEqual(self.db.data["projects"], {})
        self.assertEqual(list(self.bucket.blobs), ["other/keep.txt"])
        self.assertEqual(len(self.db.data["guest_sessions"]), 3)

    def test_delete_one_session_with_its_projects(self):
        h = self.auth()
        r = self.client.delete("/api/admin/sessions/session_a", headers=h).json()
        self.assertEqual((r["deleted_sessions"], r["deleted_projects"]), (1, 2))
        self.assertEqual(sorted(self.db.data["projects"]), ["p3", "p4"])
        self.assertEqual(self.client.delete("/api/admin/sessions/nope", headers=h).status_code, 404)

    def test_clear_expired_sessions_keeps_active_ones(self):
        h = self.auth()
        r = self.client.post("/api/admin/sessions/clear", headers=h,
                             json={"expired_only": True, "include_projects": False}).json()
        self.assertEqual(r["deleted_sessions"], 2)
        self.assertEqual(list(self.db.data["guest_sessions"]), ["session_a"])
        self.assertEqual(len(self.db.data["projects"]), 4)

    def test_clear_all_sessions_needs_the_phrase(self):
        h = self.auth()
        self.assertEqual(self.client.post("/api/admin/sessions/clear", headers=h, json={}).status_code, 400)
        # A guest project whose session record is already gone, and a model of a non-guest project
        self.db.data["projects"]["p5"] = {"id": "p5", "type": "text-recognition", "student_id": "session_gone"}
        self.bucket.blobs.update({n: SimpleNamespace(name=n, size=1, updated=NOW)
                                  for n in ("models/p5/m.pkl", "models/p4/m.pkl", "image-models/session_gone/x/m.json")})
        r = self.client.post("/api/admin/sessions/clear", headers=h, json={"confirm": "CLEAR ALL SESSIONS"}).json()
        self.assertEqual((r["deleted_sessions"], r["deleted_projects"]), (3, 4))
        self.assertEqual(list(self.db.data["projects"]), ["p4"])  # not a guest project
        self.assertEqual(self.db.data["guest_sessions"], {})
        # Every guest file and orphaned model went; the non-guest project's model and other files stay
        self.assertEqual(sorted(self.bucket.blobs), ["models/p4/m.pkl", "other/keep.txt"])

    def test_clear_all_sessions_without_projects_keeps_them(self):
        h = self.auth()
        r = self.client.post("/api/admin/sessions/clear", headers=h,
                             json={"confirm": "CLEAR ALL SESSIONS", "include_projects": False}).json()
        self.assertEqual((r["deleted_sessions"], r["deleted_projects"]), (3, 0))
        self.assertEqual(len(self.db.data["projects"]), 4)
        self.assertEqual(len(self.bucket.blobs), len(BLOBS))

    def test_many_projects_use_one_listing_per_folder(self):
        h = self.auth()
        with mock.patch.object(admin_dashboard_service, "SMALL_BATCH", 0),                 mock.patch.object(self.bucket, "list_blobs", wraps=self.bucket.list_blobs) as listing:
            r = self.client.post("/api/admin/projects/delete", headers=h, json={"ids": ["p1", "p3", "nope"]}).json()
        self.assertEqual((r["deleted_projects"], r["deleted_files"], r["not_found"]), (2, 6, ["nope"]))
        self.assertEqual(listing.call_count, 6)  # five project folders + image-models/, not six per project
        self.assertEqual(sorted(self.bucket.blobs), ["models/gone/model.pkl", "other/keep.txt"])
        self.assertEqual(sorted(self.db.data["projects"]), ["p2", "p4"])

    def test_delete_models_only_accepts_model_folders(self):
        h = self.auth()
        self.assertEqual(self.client.get("/api/admin/stats", headers=h).json()["models"]["total"], 3)
        bad = self.client.post("/api/admin/models/delete", headers=h, json={"keys": ["models/", "other/", "models/../x/"]})
        self.assertEqual(bad.status_code, 400)
        r = self.client.post("/api/admin/models/delete", headers=h,
                             json={"keys": ["models/gone/", "image-models/session_b/p3/"]}).json()
        self.assertEqual((r["deleted_models"], r["deleted_files"]), (2, 3))
        self.assertIn("models/p1/model.pkl", self.bucket.blobs)
        self.assertEqual(self.client.get("/api/admin/stats", headers=h).json()["models"]["total"], 1)  # cache dropped

    def test_clear_everything_spares_admins_and_other_files(self):
        h = self.auth()
        self.assertEqual(self.client.post("/api/admin/clear-everything", headers=h, json={"confirm": "clear"}).status_code, 400)
        r = self.client.post("/api/admin/clear-everything", headers=h, json={"confirm": "CLEAR EVERYTHING"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.db.data["projects"], {})
        self.assertEqual(self.db.data["guest_sessions"], {})
        self.assertEqual(list(self.bucket.blobs), ["other/keep.txt"])
        self.assertIn("admin@example.com", self.db.data["admin_users"])
        self.assertEqual(self.client.get("/api/admin/me", headers=h).status_code, 200)


if __name__ == "__main__":
    unittest.main()
