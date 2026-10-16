"""Retries for model calls (app/services/llm_retry.py) and where they are used. Offline: no network, no sleeping.

  .venv/Scripts/python.exe -m pytest test_llm_retry.py -q
"""

from __future__ import annotations

import unittest
from unittest import mock

import requests

from app.services import llm_retry, openrouter_service


def resp(status: int, headers=None, body=None) -> mock.Mock:
    r = mock.Mock(spec=requests.Response)
    r.status_code = status
    r.headers = headers or {}
    r.json.return_value = body if body is not None else {}
    r.text = ""
    return r


class NoSleep(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(llm_retry.time, "sleep")
        self.sleep = p.start()
        self.addCleanup(p.stop)


class SendTests(NoSleep):
    def test_429_then_ok(self):
        calls = iter([resp(429), resp(503), resp(200)])
        r = llm_retry.send(lambda: next(calls), "t")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.sleep.call_count, 2)

    def test_retry_after_is_used(self):
        calls = iter([resp(429, {"Retry-After": "3"}), resp(200)])
        llm_retry.send(lambda: next(calls), "t")
        waited = self.sleep.call_args[0][0]
        self.assertGreaterEqual(waited, 3)
        self.assertLess(waited, 3.6)

    def test_bad_request_is_not_retried(self):
        n = {"c": 0}

        def do():
            n["c"] += 1
            return resp(400)
        self.assertEqual(llm_retry.send(do, "t").status_code, 400)
        self.assertEqual(n["c"], 1)

    def test_auth_and_not_found_not_retried(self):
        for code in (401, 403, 404):
            calls = iter([resp(code), resp(200)])
            self.assertEqual(llm_retry.send(lambda: next(calls), "t").status_code, code)

    def test_gives_up_after_attempts_and_returns_last(self):
        n = {"c": 0}

        def do():
            n["c"] += 1
            return resp(429)
        self.assertEqual(llm_retry.send(do, "t").status_code, 429)
        self.assertEqual(n["c"], llm_retry.ATTEMPTS)

    def test_connection_error_retried_then_raised(self):
        def do():
            raise requests.ConnectionError("reset")
        with self.assertRaises(requests.ConnectionError):
            llm_retry.send(do, "t")
        self.assertEqual(self.sleep.call_count, llm_retry.ATTEMPTS - 1)

    def test_budget_stops_retrying(self):
        n = {"c": 0}

        def do():
            n["c"] += 1
            return resp(503)
        with mock.patch.object(llm_retry.time, "monotonic", side_effect=[0, 100, 200, 300, 400, 500]):
            self.assertEqual(llm_retry.send(do, "t", budget=10).status_code, 503)
        self.assertEqual(n["c"], 1)

    def test_529_anthropic_overloaded_is_retried(self):
        calls = iter([resp(529), resp(200)])
        self.assertEqual(llm_retry.send(lambda: next(calls), "t").status_code, 200)

    def test_waits_are_jittered_and_capped(self):
        waits = {round(llm_retry.wait_for(3), 3) for _ in range(30)}
        self.assertGreater(len(waits), 5)  # people limited together don't all come back together
        self.assertTrue(all(w <= llm_retry.CAP for w in waits))


class CallTests(NoSleep):
    def test_sdk_resource_exhausted_retried(self):
        class ResourceExhausted(Exception):
            pass
        seq = iter([ResourceExhausted("quota"), "ok"])

        def fn():
            v = next(seq)
            if isinstance(v, Exception):
                raise v
            return v
        self.assertEqual(llm_retry.call(fn, "t"), "ok")

    def test_sdk_error_with_code_429_retried_and_400_not(self):
        class APIError(Exception):
            def __init__(self, code):
                super().__init__(code)
                self.code = code
        seq = iter([APIError(429), "ok"])

        def fn():
            v = next(seq)
            if isinstance(v, Exception):
                raise v
            return v
        self.assertEqual(llm_retry.call(fn, "t"), "ok")
        with self.assertRaises(APIError):
            llm_retry.call(lambda: (_ for _ in ()).throw(APIError(400)), "t")


class OpenRouterTests(NoSleep):
    def setUp(self):
        super().setUp()
        k = mock.patch.object(openrouter_service, "_api_key", return_value="k")
        k.start()
        self.addCleanup(k.stop)

    def test_http_429_retried(self):
        ok = resp(200, body={"choices": [{"message": {"content": "hi"}}]})
        with mock.patch.object(openrouter_service.requests, "post", side_effect=[resp(429), ok]) as post:
            data = openrouter_service.chat("anthropic/claude-haiku-5.5", [{"role": "user", "content": "x"}])
        self.assertEqual(post.call_count, 2)
        self.assertEqual(data["choices"][0]["message"]["content"], "hi")

    def test_rate_limit_inside_200_body_retried(self):
        limited = resp(200, body={"error": {"code": 429, "message": "Rate limit exceeded upstream"}})
        ok = resp(200, body={"choices": [{"message": {"content": "hi"}}]})
        with mock.patch.object(openrouter_service.requests, "post", side_effect=[limited, ok]) as post:
            openrouter_service.chat("openai/gpt-6-luna", [{"role": "user", "content": "x"}])
        self.assertEqual(post.call_count, 2)

    def test_body_error_400_not_retried(self):
        bad = resp(200, body={"error": {"code": 400, "message": "bad"}})
        with mock.patch.object(openrouter_service.requests, "post", side_effect=[bad]) as post:
            with self.assertRaises(openrouter_service.OpenRouterError):
                openrouter_service.chat("openai/gpt-6-luna", [{"role": "user", "content": "x"}])
        self.assertEqual(post.call_count, 1)


def sse(*events) -> mock.Mock:
    """A 200 OpenRouter stream whose lines are the given JSON events (no charset, like the real one)."""
    import json as _json
    r = resp(200)
    lines = [f"data: {_json.dumps(e)}" for e in events] + ["data: [DONE]"]
    r.iter_lines.return_value = iter(lines)
    r.__enter__ = lambda self: self
    r.__exit__ = lambda self, *a: False
    return r


class StreamErrorTests(NoSleep):
    """openrouter_service.generate_content_stream: a provider error inside the 200 stream."""

    def setUp(self):
        super().setUp()
        k = mock.patch.object(openrouter_service, "_api_key", return_value="k")
        k.start()
        self.addCleanup(k.stop)

    def _text(self, *responses):
        with mock.patch.object(openrouter_service.requests, "post", side_effect=list(responses)) as post:
            out = "".join(c.text for c in openrouter_service.generate_content_stream(
                "anthropic/claude-haiku-5.5", [{"role": "user", "parts": [{"text": "q"}]}]))
        return out, post.call_count

    def test_error_before_any_text_is_retried(self):
        lost = sse({"error": {"code": 502, "message": "Network connection lost."}})
        ok = sse({"choices": [{"delta": {"content": "Cut-off is 2:45 PM."}}]})
        out, calls = self._text(lost, ok)
        self.assertEqual(out, "Cut-off is 2:45 PM.")
        self.assertEqual(calls, 2)

    def test_rate_limit_in_stream_is_retried(self):
        limited = sse({"error": {"code": 429, "message": "Rate limit exceeded"}})
        ok = sse({"choices": [{"delta": {"content": "Hi"}}]})
        self.assertEqual(self._text(limited, ok), ("Hi", 2))

    def test_error_after_text_is_raised_not_repeated(self):
        broken = sse({"choices": [{"delta": {"content": "Cut-off is "}}]}, {"error": {"code": 502, "message": "lost"}})
        ok = sse({"choices": [{"delta": {"content": "never used"}}]})
        with self.assertRaises(openrouter_service.OpenRouterError):
            self._text(broken, ok)

    def test_bad_request_in_stream_is_not_retried(self):
        bad = sse({"error": {"code": 400, "message": "bad"}})
        ok = sse({"choices": [{"delta": {"content": "never used"}}]})
        with self.assertRaises(openrouter_service.OpenRouterError):
            self._text(bad, ok)


class EmptyReplyCapTests(unittest.TestCase):
    """ai_agent_service.generate: an empty reply cut off at the output cap is retried with room to finish."""

    def _run(self, finish):
        from app.services import ai_agent_service as agent
        caps = []

        def fake(model, system, contents, decls, temp, max_tokens, final=False):
            caps.append(max_tokens)
            empty = len(caps) == 1
            return {"content": {"role": "model", "parts": [] if empty else [{"text": "Settles on 21 Oct."}]},
                    "text": "" if empty else "Settles on 21 Oct.", "calls": [], "finish": finish if empty else "STOP",
                    "usage": {"promptTokenCount": 10, "candidatesTokenCount": 5}}
        with mock.patch.object(agent, "openrouter_generate_rest", side_effect=fake):
            out = agent.generate("anthropic/claude-haiku-5.5", "sys", [{"role": "user", "parts": [{"text": "q"}]}], [], 0.2,
                                 quick=True)
        return out, caps

    def test_max_tokens_retry_gets_a_bigger_cap(self):
        out, caps = self._run("MAX_TOKENS")
        self.assertEqual(out["text"], "Settles on 21 Oct.")
        self.assertEqual(len(caps), 2)
        self.assertGreater(caps[1], caps[0])
        self.assertLessEqual(caps[1], max(caps[0], 4096))

    def test_other_empty_reply_retries_with_the_same_cap(self):
        out, caps = self._run("OTHER")
        self.assertEqual(out["text"], "Settles on 21 Oct.")
        self.assertEqual(caps[0], caps[1])


if __name__ == "__main__":
    unittest.main()
