"""Break-it tests before the Nuvama training (docs/hardening.md). One section per item.

Offline: the agent lookup and Firestore are replaced by small fakes; model calls are never made.

Run from backend/:  .venv/Scripts/python.exe -m unittest test_hardening -v
"""

from __future__ import annotations

import re
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import agent_access, agents, chat, knowledge, rules, training_chat
from app.models import Agent

A, B = "session_aaaa", "session_bbbb"
AGENT_A = "AGENT_A"
ITEMS = {"rule_id": "R_A", "knowledge_id": "K_A", "message_id": "M_A", "change_id": "C_A", "chat_id": "CH_A"}


def agent_of(session: str, agent_id: str = AGENT_A) -> Agent:
    return Agent(agent_id=agent_id, user_id=session, session_id=session, name="Desk", role="r", tone="t",
                 language="English", description="d", stage="assistant")


def app_with_agent_routers() -> FastAPI:
    app = FastAPI()
    for r in (agents.router, rules.router, chat.router, knowledge.router, training_chat.router):
        app.include_router(r)
    return app


# ── 1. agent routes check ownership; session ids don't leak ───────────────


class AgentOwnership(unittest.TestCase):
    def setUp(self):
        self.app = app_with_agent_routers()
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.patches = [
            mock.patch.object(agent_access.AgentService, "get_agent", side_effect=lambda aid: agent_of(A) if aid == AGENT_A else None),
            mock.patch.object(agent_access, "_item_agent_id", side_effect=lambda coll, iid: AGENT_A if iid in ITEMS.values() else None),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def routes(self):
        for r in self.app.routes:
            for method in sorted(getattr(r, "methods", []) or []):
                if method in ("HEAD", "OPTIONS") or (method, r.path) == ("POST", "/agent/create") or not r.path.startswith(("/agent", "/rules", "/chat", "/kb", "/training")):
                    continue
                yield method, r.path

    def call(self, method, path, session):
        url = path.replace("{agent_id}", AGENT_A)
        for param, value in ITEMS.items():
            url = url.replace("{" + param + "}", value)
        params = {"session_id": session, "agent_id": AGENT_A} if session else {"agent_id": AGENT_A}
        body = {"agent_id": AGENT_A, **({"session_id": session} if session else {})}
        if method in ("GET", "DELETE"):
            return self.client.request(method, url, params=params)
        return self.client.request(method, url, params=params, json=body)

    def test_every_route_refuses_another_sessions_agent(self):
        wrong = []
        for method, path in self.routes():
            r = self.call(method, path, B)
            if r.status_code != 403:
                wrong.append(f"{method} {path} -> {r.status_code}")
        self.assertEqual(wrong, [], "routes that let session B use session A's agent")

    def test_every_route_requires_a_session(self):
        wrong = []
        for method, path in self.routes():
            r = self.client.request(method, path.replace("{agent_id}", AGENT_A).replace("{rule_id}", "R_A")
                                    .replace("{knowledge_id}", "K_A").replace("{message_id}", "M_A")
                                    .replace("{change_id}", "C_A").replace("{chat_id}", "CH_A"),
                                    params={"agent_id": AGENT_A})
            if r.status_code not in (400, 422):
                wrong.append(f"{method} {path} -> {r.status_code}")
        self.assertEqual(wrong, [], "routes that run without a session_id")

    def test_list_without_session_is_400(self):
        self.assertIn(self.client.get("/agent").status_code, (400, 422))

    def test_agent_responses_carry_no_session_or_user_id(self):
        with mock.patch.object(agents.AgentService, "get_agents_by_session", return_value=[agent_of(A)]):
            r = self.client.get("/agent", params={"session_id": A})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("session_id", r.text)
        self.assertNotIn("user_id", r.text)
        with mock.patch.object(agents.AgentService, "create_agent", return_value=agent_of(A)):
            r = self.client.post("/agent/create", json={"session_id": A, "agent_description": "A custody desk helper", "stage": "assistant"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertNotIn(A, r.text)

    def test_owner_gets_through_the_guard(self):
        # The owner's request reaches the route (whatever the route then does offline, it is not 400/403)
        r = self.call("GET", "/agent/{agent_id}/persona", A)
        self.assertNotIn(r.status_code, (400, 403))


if __name__ == "__main__":
    unittest.main()
