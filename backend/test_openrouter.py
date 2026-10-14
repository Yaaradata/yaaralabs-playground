"""OpenRouter routing and translation, offline: no request leaves the machine (requests.post is mocked).

    python -m unittest test_openrouter
"""

from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest import mock

from google.genai import types

from app.services import openrouter_service as orr
from app.services.exercises_vertex_models import catalog_models, resolve_vertex_model


def reply(content="Hello", tool_calls=None, annotations=None, finish="stop"):
    msg = {"role": "assistant", "content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    if annotations:
        msg["annotations"] = annotations
    return {"model": "openai/gpt-6-luna", "choices": [{"message": msg, "finish_reason": finish}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}}


class FakePost:
    """Stands in for requests.post: records the body, answers with `data`."""

    def __init__(self, data, status=200):
        self.data, self.status, self.bodies, self.headers = data, status, [], []

    def __call__(self, url, json=None, stream=False, timeout=None, headers=None):
        self.bodies.append(json)
        self.headers.append(headers)
        return SimpleNamespace(status_code=self.status, json=lambda: self.data, text=str(self.data))


class Catalog(unittest.TestCase):
    def test_pickers_list_the_three_models(self):
        rows = catalog_models()
        self.assertEqual([r["model"] for r in rows], ["gemini-3.8-flash", "openai/gpt-6-luna", "anthropic/claude-haiku-5.5"])
        self.assertEqual([(r["pin"], r["pout"]) for r in rows], [(0.75, 3.75), (0.10, 0.50), (0.10, 0.50)])
        self.assertEqual([r["provider"] for r in rows], ["vertex", "openrouter", "openrouter"])

    def test_old_ids_still_resolve(self):
        self.assertEqual(resolve_vertex_model("gemini-2.5-flash-lite"), "gemini-3.8-flash")
        self.assertEqual(resolve_vertex_model("gemini-flash-lite"), "gemini-3.8-flash")
        self.assertEqual(resolve_vertex_model("claude-haiku-55"), "anthropic/claude-haiku-5.5")

    def test_which_models_go_to_openrouter(self):
        self.assertTrue(orr.is_openrouter_model("openai/gpt-6-luna"))
        self.assertTrue(orr.is_openrouter_model("anthropic/claude-haiku-5.5"))
        self.assertFalse(orr.is_openrouter_model("gemini-3.8-flash"))


class Translate(unittest.TestCase):
    def setUp(self):
        self.key = mock.patch.object(orr, "_api_key", return_value="sk-test")
        self.key.start()

    def tearDown(self):
        self.key.stop()

    def test_genai_call_becomes_a_chat_completion(self):
        fake = FakePost(reply("Hi there"))
        config = types.GenerateContentConfig(system_instruction="Be brief.", temperature=0.2, max_output_tokens=300, top_p=0.9)
        with mock.patch.object(orr.requests, "post", fake):
            res = orr.generate_content("openai/gpt-6-luna", [types.Content(role="user", parts=[types.Part.from_text(text="Hello?")])], config)
        body = fake.bodies[0]
        self.assertEqual(body["model"], "openai/gpt-6-luna")
        self.assertEqual(body["messages"], [{"role": "system", "content": "Be brief."}, {"role": "user", "content": "Hello?"}])
        self.assertEqual((body["temperature"], body["max_tokens"], body["top_p"]), (0.2, 300, 0.9))
        self.assertEqual(fake.headers[0]["Authorization"], "Bearer sk-test")
        self.assertEqual(res.text, "Hi there")
        self.assertEqual(res.candidates[0].content.parts[0].text, "Hi there")
        self.assertEqual(res.usage_metadata.prompt_token_count, 11)
        self.assertEqual(str(res.candidates[0].finish_reason), "STOP")

    def test_tools_and_tool_results(self):
        decl = types.FunctionDeclaration(name="settlement_date", description="Settlement date",
                                         parameters=types.Schema(type="OBJECT", properties={"trade_date": types.Schema(type="STRING")},
                                                                 required=["trade_date"]))
        contents = [
            types.Content(role="user", parts=[types.Part.from_text(text="T+1 for 9 Oct?")]),
            types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name="settlement_date", args={"trade_date": "2026-10-09"}, id="c1"))]),
            types.Content(role="user", parts=[types.Part(function_response=types.FunctionResponse(name="settlement_date", response={"result": "2026-10-12"}, id="c1"))]),
        ]
        fake = FakePost(reply(None, tool_calls=[{"id": "c2", "type": "function", "function": {"name": "settlement_date", "arguments": "{\"trade_date\": \"2026-10-12\"}"}}], finish="tool_calls"))
        with mock.patch.object(orr.requests, "post", fake):
            res = orr.generate_content("anthropic/claude-haiku-5.5", contents, types.GenerateContentConfig(tools=[types.Tool(function_declarations=[decl])]))
        body = fake.bodies[0]
        tool = body["tools"][0]["function"]
        self.assertEqual(tool["name"], "settlement_date")
        self.assertEqual(tool["parameters"]["type"], "object")
        self.assertEqual(tool["parameters"]["properties"]["trade_date"]["type"], "string")
        msgs = body["messages"]
        self.assertEqual(msgs[1]["tool_calls"][0]["id"], "c1")
        self.assertEqual(msgs[2], {"role": "tool", "tool_call_id": "c1", "content": json.dumps({"result": "2026-10-12"})})
        call = res.candidates[0].content.parts[0].function_call
        self.assertEqual((call.name, call.args, call.id), ("settlement_date", {"trade_date": "2026-10-12"}, "c2"))

    def test_google_search_becomes_the_providers_own_search(self):
        fake = FakePost(reply("It is 3 Sep.", annotations=[{"type": "url_citation", "url_citation": {"url": "https://nseindia.com/x", "title": "NSE"}}]))
        with mock.patch.object(orr.requests, "post", fake):
            res = orr.generate_content("openai/gpt-6-luna", "Record date?", types.GenerateContentConfig(tools=[types.Tool(google_search=types.GoogleSearch())]))
        self.assertEqual(fake.bodies[0]["plugins"], [{"id": "web", "engine": "native"}])
        chunk = res.candidates[0].grounding_metadata.grounding_chunks[0]
        self.assertEqual((chunk.web.uri, chunk.web.title), ("https://nseindia.com/x", "NSE"))

    def test_agent_tool_loop_rest_call(self):
        contents = [{"role": "user", "parts": [{"text": "Is this ISIN valid?"}]}]
        decls = [{"functionDeclarations": [{"name": "validate_isin", "description": "Check an ISIN",
                                            "parameters": {"type": "OBJECT", "properties": {"isin": {"type": "STRING"}}}}]}]
        fake = FakePost(reply(None, tool_calls=[{"id": "t1", "type": "function", "function": {"name": "validate_isin", "arguments": "{\"isin\": \"INE002A01018\"}"}}]))
        with mock.patch.object(orr.requests, "post", fake):
            out = orr.generate_rest("openai/gpt-6-luna", "You are an agent.", contents, decls, 0.2, 800, final=False)
        self.assertEqual(out["calls"][0]["name"], "validate_isin")
        self.assertEqual(out["content"]["parts"][0]["functionCall"]["id"], "t1")
        self.assertEqual(fake.bodies[0]["tools"][0]["function"]["parameters"]["properties"]["isin"]["type"], "string")
        with mock.patch.object(orr.requests, "post", FakePost(reply("Valid."))) as f2:
            orr.generate_rest("openai/gpt-6-luna", "You are an agent.", contents, decls, 0.2, 800, final=True)
        self.assertEqual(f2.bodies[0]["tool_choice"], "none")

    def test_errors_are_plain_words(self):
        with mock.patch.object(orr.requests, "post", FakePost({"error": {"message": "Invalid API key"}}, status=401)):
            with self.assertRaises(orr.OpenRouterError) as e:
                orr.generate_content("openai/gpt-6-luna", "hi")
        self.assertIn("401", str(e.exception))
        self.assertIn("Invalid API key", str(e.exception))


class Router(unittest.TestCase):
    def test_gemini_goes_to_vertex_and_others_to_openrouter(self):
        vertex = mock.MagicMock()
        client = orr.RoutedClient(SimpleNamespace(models=vertex, other="kept"))
        with mock.patch.object(orr, "generate_content", return_value="openrouter") as g:
            self.assertEqual(client.models.generate_content(model="openai/gpt-6-luna", contents="hi"), "openrouter")
            g.assert_called_once()
        client.models.generate_content(model="gemini-3.8-flash", contents="hi")
        vertex.generate_content.assert_called_once_with(model="gemini-3.8-flash", contents="hi")
        self.assertEqual(client.other, "kept")


if __name__ == "__main__":
    unittest.main()
