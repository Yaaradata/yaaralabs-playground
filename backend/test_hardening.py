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


# ── 3. a slow model call doesn't stall everyone else ─────────────────────


class EventLoopNotBlocked(unittest.TestCase):
    """While one request waits 1 s on the model, a quick request must still answer at once."""

    SLOW = 1.0

    def ping_during(self, app, slow_request):
        import asyncio
        import time

        import httpx

        @app.get("/ping")
        async def ping():
            return {"ok": True}

        async def run():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
                t0 = time.perf_counter()
                slow = asyncio.create_task(slow_request(c))
                await asyncio.sleep(0.15)  # the slow request is now inside the model call
                await c.get("/ping")
                # from the slow request's start: about 0.15 s if the loop is free, over 1 s if it's blocked
                ping = time.perf_counter() - t0
                await slow
                return ping

        return asyncio.run(run())

    def test_rbp_ask_model_runs_off_the_loop(self):
        import time

        from app.api import rule_based_process as rbp

        app = FastAPI()
        app.include_router(rbp.router)
        app.dependency_overrides[rbp.validate_session] = lambda: {"session_id": A}
        slow_service = SimpleNamespace(ask_model=lambda prompt: (time.sleep(self.SLOW), "Corporate action")[1])
        app.dependency_overrides[rbp.get_rbp_service] = lambda: slow_service
        app.dependency_overrides[rbp.get_project_service] = lambda: None

        async def noop(*a, **k):
            return None

        with mock.patch.object(rbp, "_assert_rbp_project", noop):
            ping = self.ping_during(app, lambda c: c.post(f"/api/rbp/session/{A}/projects/p1/ask", json={"prompt": "Which desk?"}))
        self.assertLess(ping, 0.6, f"/ping answered {ping:.2f}s after the model call started (blocked)")

    def test_agent_chat_runs_off_the_loop(self):
        import time

        app = FastAPI()
        app.include_router(chat.router)
        slow_chat = SimpleNamespace(chat=lambda *a, **k: (time.sleep(self.SLOW), {"response": "ok", "trace": {}, "chat_id": "C"})[1])
        app.dependency_overrides[chat.get_chat_service] = lambda: slow_chat
        legacy = SimpleNamespace(agent_id=AGENT_A, session_id=A, stage=None)
        with mock.patch.object(agent_access.AgentService, "get_agent", return_value=legacy), \
                mock.patch.object(chat, "AgentService") as svc:
            svc.return_value.get_agent.return_value = legacy
            ping = self.ping_during(app, lambda c: c.post("/chat", json={"agent_id": AGENT_A, "session_id": A, "message": "hi"}))
        self.assertLess(ping, 0.6, f"/ping answered {ping:.2f}s after the chat call started (blocked)")

    def test_no_async_handler_without_await_in_agent_routers(self):
        import importlib.util
        from pathlib import Path

        spec = importlib.util.spec_from_file_location("fbh", Path(__file__).parent / "scripts" / "find_blocking_handlers.py")
        fbh = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fbh)
        blocking = []
        for f in ("chat", "agents", "knowledge", "training_chat", "rules"):
            blocking += [f"{f}.{n}" for n, _, awaits in fbh.handlers(Path(__file__).parent / "app" / "api" / f"{f}.py") if awaits == 0]
        self.assertEqual(blocking, [], "async handlers that never await run blocking calls on the event loop")


# ── 4. calculator tool: nested powers can't tie up a thread ──────────────


class CalculatorBomb(unittest.TestCase):
    def run_with_limit(self, expr, seconds=2.0):
        import threading
        import time

        from app.services.agent_tools import calculator

        out = {}

        def go():
            t0 = time.perf_counter()
            out["r"] = calculator(expr)
            out["ms"] = (time.perf_counter() - t0) * 1000

        th = threading.Thread(target=go, daemon=True)  # daemon: a runaway old version can't hang the test run
        th.start()
        th.join(seconds)
        self.assertFalse(th.is_alive(), f"{expr} still running after {seconds}s")
        return out

    def test_nested_power_is_refused_fast(self):
        out = self.run_with_limit("(((9**100)**100)**100)**100")
        self.assertEqual(out["r"].get("error"), "Number too large")
        self.assertLess(out["ms"], 100)

    def test_huge_products_are_refused(self):
        self.assertEqual(self.run_with_limit("(2**100)*(2**100)")["r"].get("error"), "Number too large")
        self.assertEqual(self.run_with_limit("9**100**100")["r"].get("error"), "exponent too large")

    def test_normal_arithmetic_still_works(self):
        from app.services.agent_tools import calculator

        self.assertEqual(calculator("2*3+4")["result"], 10)
        self.assertEqual(calculator("4500 * 1.5")["result"], 6750)
        self.assertEqual(calculator("sqrt(16)+2**10")["result"], 1028)
        self.assertEqual(calculator("1e12*5")["result"], 5000000000000)
        self.assertEqual(len(str(calculator("9**100")["result"])), 96)


# ── 5. separate slots per feature; a clear "busy" instead of waiting forever ─────


class FeatureSlots(unittest.TestCase):
    def test_agent_turns_run_while_cpu_training_is_full(self):
        import asyncio

        from app.api.slots import AGENT_TURNS, CPU_TRAINING

        async def run():
            hold = asyncio.Event()
            running = []

            async def train():
                async with CPU_TRAINING():
                    await hold.wait()

            async def turn(i):
                async with AGENT_TURNS():
                    running.append(i)
                    await asyncio.sleep(0.05)

            trainings = [asyncio.create_task(train()) for _ in range(CPU_TRAINING.size)]
            await asyncio.sleep(0.01)  # every CPU slot is now taken
            await asyncio.wait_for(asyncio.gather(*(turn(i) for i in range(16))), timeout=1.0)
            hold.set()
            await asyncio.gather(*trainings)
            return running

        self.assertEqual(len(asyncio.run(run())), 16, "16 agent turns must not wait for training")

    def test_waiting_too_long_returns_busy(self):
        import asyncio

        from fastapi import HTTPException

        from app.api.slots import BUSY, Slots

        one = Slots("test", 1, wait=0.2)

        async def run():
            async with one():
                try:
                    async with one():
                        return None
                except HTTPException as e:
                    return e

        e = asyncio.run(run())
        self.assertIsNotNone(e)
        self.assertEqual((e.status_code, e.detail), (503, BUSY))

    def test_no_feature_uses_one_shared_semaphore(self):
        import app.api.exercises as ex

        self.assertFalse(hasattr(ex, "_TRAIN_SLOTS"), "agent turns, RAG and training must not share one semaphore")


if __name__ == "__main__":
    unittest.main()
