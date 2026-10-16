"""OpenRouter: the OpenAI and Anthropic chat models in the model pickers.

Gemini models go to Vertex AI as before. Every other model in the pickers has a "provider/model" id
(openai/gpt-6-luna, anthropic/claude-haiku-5.5) and goes to OpenRouter's chat completions API with
the OPENROUTER_API_KEY from backend/.env.

The rest of the backend calls models the google-genai way (client.models.generate_content(...)).
RoutedClient (used by VertexAIService) sends "provider/model" ids here instead, and this module
translates both ways, so no exercise or agent needs its own OpenRouter code:

    genai contents / config  ->  OpenAI-style messages, tools, temperature, max_tokens
    OpenRouter reply          ->  an object shaped like a genai response (.text, .candidates[0]
                                 .content.parts with text / function_call, .usage_metadata, and
                                 .grounding_metadata for web search sources)

Web search: a Google Search tool in the config (Gemini's grounding) becomes OpenRouter's web plugin
with engine "native", so OpenAI and Anthropic models use their own provider's search.

Gemini REST-style contents ({"role", "parts": [{"text"} | {"functionCall"} | {"functionResponse"}]})
are accepted too (the AI Agent tool loop builds those); see generate_rest().
"""

from __future__ import annotations

import json
import re
import logging
import time
import uuid
from collections import defaultdict, deque
from types import SimpleNamespace
from typing import Any, Deque, Dict, Iterator, List, Optional, Tuple

import requests

from . import llm_retry

logger = logging.getLogger(__name__)

API_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT = (10.0, 90.0)  # connect, read: a stuck call is dropped and retried (llm_retry); web search answers take ~25 s
# OpenRouter asks apps to identify themselves (shown on openrouter.ai)
APP_HEADERS = {"HTTP-Referer": "https://yaaralabs.ai", "X-Title": "YaaraLabs Playground"}


class OpenRouterError(Exception):
    """The model could not answer: the message says why, in plain words."""


def is_openrouter_model(model: Optional[str]) -> bool:
    """OpenRouter ids are "provider/model"; Vertex Gemini ids have no slash."""
    return "/" in str(model or "")


def _api_key() -> str:
    from ..config import settings

    key = (settings.openrouter_api_key or "").strip()
    if not key:
        raise OpenRouterError("OPENROUTER_API_KEY is not set in backend/.env, so OpenAI and Anthropic models can't answer.")
    return key


# ── reading genai-style inputs ─────────────────────────────────


def _get(obj: Any, *names: str) -> Any:
    """First present attribute / key of `obj` among `names` (genai objects use snake_case, REST dicts camelCase)."""
    for n in names:
        v = obj.get(n) if isinstance(obj, dict) else getattr(obj, n, None)
        if v is not None:
            return v
    return None


def _plain(value: Any) -> Any:
    """genai / pydantic objects -> plain JSON values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        return _plain(dump(exclude_none=True))
    name = getattr(value, "name", None)  # enums (Type.OBJECT)
    return name if isinstance(name, str) else str(value)


def _json_schema(schema: Any) -> Dict[str, Any]:
    """A Gemini parameter schema (OBJECT / STRING types, genai Schema objects) -> JSON Schema."""
    node = _plain(schema)

    def fix(n: Any) -> Any:
        if isinstance(n, list):
            return [fix(x) for x in n]
        if not isinstance(n, dict):
            return n
        out = {}
        for k, v in n.items():
            if k == "type" and isinstance(v, str):
                out[k] = v.lower()
            elif k in ("property_ordering", "propertyOrdering", "nullable"):
                continue
            else:
                out[k] = fix(v)
        return out

    node = fix(node) if isinstance(node, dict) else {}
    node.setdefault("type", "object")
    if node["type"] == "object":
        node.setdefault("properties", {})
    return node


def _parts(content: Any) -> List[Any]:
    if isinstance(content, str):
        return [{"text": content}]
    parts = _get(content, "parts")
    return list(parts or [])


def to_messages(system: Any, contents: Any) -> List[Dict[str, Any]]:
    """genai or Gemini REST contents (+ system instruction) -> OpenAI chat messages."""
    messages: List[Dict[str, Any]] = []
    sys_text = _text_of(system)
    if sys_text:
        messages.append({"role": "system", "content": sys_text})
    if contents is None:
        return messages
    if isinstance(contents, (str, dict)) or not isinstance(contents, (list, tuple)):
        contents = [contents]
    pending: Dict[str, Deque[str]] = defaultdict(deque)  # tool name -> call ids not yet answered
    for content in contents:
        role = str(_get(content, "role") or "user") if not isinstance(content, str) else "user"
        texts: List[str] = []
        calls: List[Dict[str, Any]] = []
        results: List[Dict[str, Any]] = []
        for part in _parts(content):
            if isinstance(part, str):
                texts.append(part)
                continue
            if _get(part, "thought"):
                continue
            call = _get(part, "function_call", "functionCall")
            response = _get(part, "function_response", "functionResponse")
            text = _get(part, "text")
            if call is not None:
                name = str(_get(call, "name") or "")
                cid = str(_get(call, "id") or f"call_{uuid.uuid4().hex[:12]}")
                pending[name].append(cid)
                calls.append({"id": cid, "type": "function",
                              "function": {"name": name, "arguments": json.dumps(_plain(_get(call, "args")) or {})}})
            elif response is not None:
                name = str(_get(response, "name") or "")
                cid = _get(response, "id")
                if cid and cid in pending[name]:
                    pending[name].remove(cid)
                elif pending[name]:
                    cid = pending[name].popleft()
                results.append({"role": "tool", "tool_call_id": str(cid or f"call_{uuid.uuid4().hex[:12]}"),
                                "content": json.dumps(_plain(_get(response, "response")), default=str)})
            elif text:
                texts.append(str(text))
        if role == "model":
            msg: Dict[str, Any] = {"role": "assistant", "content": "\n".join(texts) if texts else None}
            if calls:
                msg["tool_calls"] = calls
            if texts or calls:
                messages.append(msg)
        else:
            messages.extend(results)
            if texts:
                messages.append({"role": "user", "content": "\n".join(texts)})
    return messages


def _text_of(value: Any) -> str:
    """A system instruction given as text, a Content, or a list of parts."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "\n".join(_text_of(v) for v in value if v is not None)
    text = _get(value, "text")
    if text:
        return str(text)
    return "\n".join(str(_get(p, "text") or "") for p in _parts(value) if not isinstance(p, str) or p)


def _tools(tools: Any) -> Tuple[List[Dict[str, Any]], bool]:
    """genai / REST tools -> (OpenAI function tools, web search wanted)."""
    out: List[Dict[str, Any]] = []
    web = False
    for tool in tools or []:
        if _get(tool, "google_search", "googleSearch", "google_search_retrieval", "googleSearchRetrieval") is not None:
            web = True
        for decl in _get(tool, "function_declarations", "functionDeclarations") or []:
            fn: Dict[str, Any] = {"name": str(_get(decl, "name") or ""), "description": str(_get(decl, "description") or "")}
            params = _get(decl, "parameters", "parameters_json_schema", "parametersJsonSchema")
            fn["parameters"] = _json_schema(params) if params is not None else {"type": "object", "properties": {}}
            out.append({"type": "function", "function": fn})
    return out, web


def _tool_choice(tool_config: Any) -> Optional[str]:
    fcc = _get(tool_config, "function_calling_config", "functionCallingConfig") if tool_config is not None else None
    mode = str(_plain(_get(fcc, "mode")) or "").upper() if fcc is not None else ""
    return {"NONE": "none", "ANY": "required", "AUTO": "auto"}.get(mode.split(".")[-1])


def _body(model: str, messages: List[Dict[str, Any]], config: Any) -> Dict[str, Any]:
    body: Dict[str, Any] = {"model": model, "messages": messages}
    if config is not None:
        for src, dst in (("temperature", "temperature"), ("top_p", "top_p"), ("max_output_tokens", "max_tokens"),
                         ("maxOutputTokens", "max_tokens"), ("seed", "seed")):
            v = _get(config, src)
            if v is not None:
                body[dst] = v
        stops = _get(config, "stop_sequences", "stopSequences")
        if stops:
            body["stop"] = list(stops)
        tools, web = _tools(_get(config, "tools"))
        if tools:
            body["tools"] = tools
            choice = _tool_choice(_get(config, "tool_config", "toolConfig"))
            if choice:
                body["tool_choice"] = choice
        if web:
            body["plugins"] = [{"id": "web", "engine": "native"}]  # the provider's own web search
    return body


# ── calling OpenRouter ─────────────────────────────────────────


def _post(body: Dict[str, Any], stream: bool = False) -> requests.Response:
    headers = {"Authorization": f"Bearer {_api_key()}", **APP_HEADERS}
    try:
        # 429 rate limits and 5xx (Anthropic's 529 "overloaded" too) retried with backoff before giving up
        r = llm_retry.send(lambda: requests.post(API_URL, json=body, stream=stream, timeout=TIMEOUT, headers=headers),
                           f"OpenRouter {body['model']}")
    except requests.RequestException as e:
        raise OpenRouterError(f"{body['model']} didn't answer ({type(e).__name__}). Nothing was made up: try again.")
    if r.status_code != 200:
        try:
            err = r.json().get("error") or {}
            msg = err.get("message") if isinstance(err, dict) else str(err)
        except Exception:
            msg = r.text[:200]
        logger.warning("OpenRouter %s failed %s: %s", body["model"], r.status_code, msg)
        raise OpenRouterError(f"{body['model']} returned an error ({r.status_code}). {str(msg or '')[:200]}".strip())
    return r


def _body_error_code(err: Any) -> Optional[int]:
    try:
        return int(err.get("code")) if isinstance(err, dict) else None
    except (TypeError, ValueError):
        return None


def _complete(body: Dict[str, Any]) -> Dict[str, Any]:
    """One non-streamed completion's JSON. OpenRouter can answer 200 with the provider's error in the body
    (e.g. {"error": {"code": 429}} when the upstream model is rate limited): those are retried too."""
    def once() -> Dict[str, Any]:
        data = _post(body).json()
        err = data.get("error")
        if err:
            e = OpenRouterError(f"{body['model']} returned an error. {str(err)[:200]}")
            e.code = _body_error_code(err)  # type: ignore[attr-defined]
            raise e
        return data
    return llm_retry.call(once, f"OpenRouter {body['model']}",
                          temporary=lambda e: getattr(e, "code", None) in llm_retry.RETRY_STATUS)


def chat(model: str, messages: List[Dict[str, Any]], **params: Any) -> Dict[str, Any]:
    """One chat completion: the raw OpenRouter JSON."""
    return _complete({"model": model, "messages": messages, **{k: v for k, v in params.items() if v is not None}})


# ── genai-shaped results ───────────────────────────────────────


class _Finish(str):
    """A finish reason that reads like genai's enum (str() and .name)."""

    @property
    def name(self) -> str:
        return str(self)


_FINISH = {"stop": "STOP", "length": "MAX_TOKENS", "tool_calls": "STOP", "content_filter": "SAFETY", "error": "OTHER"}


def _part(text: Optional[str] = None, call: Optional[SimpleNamespace] = None) -> SimpleNamespace:
    return SimpleNamespace(text=text, function_call=call, function_response=None, thought=None,
                           inline_data=None, executable_code=None, code_execution_result=None)


def _usage(u: Dict[str, Any]) -> SimpleNamespace:
    tin, tout = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
    return SimpleNamespace(prompt_token_count=tin, candidates_token_count=tout, total_token_count=int(u.get("total_tokens") or tin + tout),
                           thoughts_token_count=0, cached_content_token_count=0)


def _grounding(annotations: Any) -> Optional[SimpleNamespace]:
    """OpenRouter web citations -> genai grounding_metadata (grounding_chunks[i].web.uri / .title)."""
    chunks = []
    for a in annotations or []:
        cite = (a or {}).get("url_citation") or {}
        if cite.get("url") and not any(c.web.uri == cite["url"] for c in chunks):
            chunks.append(SimpleNamespace(web=SimpleNamespace(uri=cite["url"], title=cite.get("title") or cite["url"])))
    if not chunks:
        return None
    return SimpleNamespace(grounding_chunks=chunks, grounding_supports=None, search_entry_point=None, web_search_queries=None)


_MARKER = re.compile("\ue200.*?\ue201", re.S)
_PRIVATE = re.compile("[\ue000-\uf8ff]")


def clean_text(text: str) -> str:
    """OpenAI models can leave their own citation markers (private-use characters, e.g. U+E200 cite U+E202 turn0search0
    U+E201) in the text: remove them."""
    return _PRIVATE.sub("", _MARKER.sub("", text or ""))


def _response(data: Dict[str, Any], model: str) -> SimpleNamespace:
    choice = (data.get("choices") or [{}])[0]
    msg = choice.get("message") or {}
    text = msg.get("content") or ""
    if isinstance(text, list):  # some providers send content parts
        text = "".join(p.get("text", "") for p in text if isinstance(p, dict))
    text = clean_text(text)
    parts = [_part(text=text)] if text else []
    calls = []
    for tc in msg.get("tool_calls") or []:
        fn = tc.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except ValueError:
            args = {}
        call = SimpleNamespace(name=fn.get("name", ""), args=args if isinstance(args, dict) else {}, id=tc.get("id"))
        calls.append(call)
        parts.append(_part(call=call))
    candidate = SimpleNamespace(
        content=SimpleNamespace(role="model", parts=parts),
        finish_reason=_Finish(_FINISH.get(str(choice.get("finish_reason") or "stop"), "STOP")),
        grounding_metadata=_grounding(msg.get("annotations")),
        safety_ratings=None, citation_metadata=None, avg_logprobs=None, logprobs_result=None, index=0,
    )
    return SimpleNamespace(text=text, candidates=[candidate], usage_metadata=_usage(data.get("usage") or {}),
                           function_calls=calls or None, model_version=data.get("model") or model, prompt_feedback=None,
                           automatic_function_calling_history=None, parsed=None)


def generate_content(model: str, contents: Any, config: Any = None) -> SimpleNamespace:
    """client.models.generate_content for an OpenRouter model."""
    body = _body(model, to_messages(_get(config, "system_instruction") if config is not None else None, contents), config)
    return _response(_complete(body), model)


def generate_content_stream(model: str, contents: Any, config: Any = None) -> Iterator[SimpleNamespace]:
    """client.models.generate_content_stream for an OpenRouter model: one genai-like chunk per text delta."""
    body = _body(model, to_messages(_get(config, "system_instruction") if config is not None else None, contents), config)
    body.pop("tools", None)  # streamed answers are plain text
    body.pop("tool_choice", None)
    body["stream"] = True
    # OpenRouter can send the provider's error inside a 200 stream ({"error": {"code": 502, "message": "Network
    # connection lost."}}, or a 429). Before any text has reached the learner that is retried like any other
    # temporary failure (llm_retry backoff and budget); once text has been sent it is raised (never shown twice).
    t0 = time.monotonic()
    for attempt in range(1, llm_retry.ATTEMPTS + 1):
        sent = False
        try:
            for chunk in _stream_once(body, model):
                sent = True
                yield chunk
            return
        except OpenRouterError as e:
            pause = llm_retry.wait_for(attempt)
            if (sent or getattr(e, "code", None) not in llm_retry.RETRY_STATUS or attempt == llm_retry.ATTEMPTS
                    or time.monotonic() - t0 + pause >= llm_retry.BUDGET):
                raise
            logger.warning("OpenRouter %s: in-stream error %s, retry %d/%d in %.1fs", model, e.code, attempt,
                           llm_retry.ATTEMPTS - 1, pause)
            time.sleep(pause)


def _stream_once(body: Dict[str, Any], model: str) -> Iterator[SimpleNamespace]:
    """One streamed completion; an error event raises OpenRouterError with its code (.code)."""
    r = _post(body, stream=True)
    held = ""  # text that may hold the start of a citation marker split across chunks
    with r:
        # the stream says no charset, so requests would decode it as Latin-1 ("—" became "â€”"): it is UTF-8
        r.encoding = "utf-8"
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue  # keep-alive comments (": OPENROUTER PROCESSING")
            payload = raw[5:].strip()
            if payload == "[DONE]":
                break
            try:
                data = json.loads(payload)
            except ValueError:
                continue
            if data.get("error"):
                e = OpenRouterError(f"{model} returned an error. {str(data['error'])[:200]}")
                e.code = _body_error_code(data["error"])  # type: ignore[attr-defined]
                raise e
            delta = held + (((data.get("choices") or [{}])[0].get("delta") or {}).get("content") or "")
            open_at = delta.rfind("\ue200")
            if open_at > -1 and "\ue201" not in delta[open_at:]:
                delta, held = delta[:open_at], delta[open_at:]  # wait for the marker's end
            else:
                held = ""
            delta = clean_text(delta)
            if delta:
                yield SimpleNamespace(text=delta, candidates=[SimpleNamespace(
                    content=SimpleNamespace(role="model", parts=[_part(text=delta)]), finish_reason=None,
                    grounding_metadata=None)], usage_metadata=None)


def count_tokens(model: str, contents: Any, config: Any = None) -> SimpleNamespace:
    """An estimate (OpenRouter has no token counting endpoint): about 4 characters per token."""
    chars = sum(len(str(m.get("content") or "")) for m in to_messages(None, contents))
    return SimpleNamespace(total_tokens=max(1, round(chars / 4)), cached_content_token_count=0)


def generate_rest(model: str, system: str, contents: List[Dict[str, Any]], tools: List[Dict[str, Any]],
                  temperature: float, max_tokens: int, final: bool = False) -> Dict[str, Any]:
    """The AI Agent tool loop's call (Gemini REST-style contents and functionDeclarations) for an
    OpenRouter model. Returns what ai_agent_service._post returns: content (REST-style, so the next
    round can send it back), text, calls, usage (Gemini field names), finish."""
    body = _body(model, to_messages(system, contents), {"temperature": temperature, "max_output_tokens": max_tokens,
                                                         "tools": tools,
                                                         "tool_config": {"functionCallingConfig": {"mode": "NONE"}} if final and tools else None})
    data = chat(model, body.pop("messages"), **{k: v for k, v in body.items() if k != "model"})
    res = _response(data, model)
    parts: List[Dict[str, Any]] = []
    calls: List[Dict[str, Any]] = []
    for p in res.candidates[0].content.parts:
        if p.text:
            parts.append({"text": p.text})
        if p.function_call is not None:
            fc = p.function_call
            cid = fc.id or f"call_{uuid.uuid4().hex[:8]}"
            parts.append({"functionCall": {"name": fc.name, "args": fc.args, "id": cid}})
            calls.append({"id": cid, "name": fc.name.split(".")[-1], "args": fc.args, "geminiId": cid, "rawName": fc.name})
    u = res.usage_metadata
    return {"content": {"role": "model", "parts": parts}, "text": res.text.strip(), "calls": calls,
            "usage": {"promptTokenCount": u.prompt_token_count, "candidatesTokenCount": u.candidates_token_count},
            "finish": str(res.candidates[0].finish_reason)}


def web_search(model: str, query: str, prompt: str) -> Dict[str, Any]:
    """A web search with the model's own provider search (OpenRouter web plugin, engine native).
    Returns the text and its sources, like VertexAIService.generate_text_with_search."""
    data = chat(model, [{"role": "user", "content": prompt}], plugins=[{"id": "web", "engine": "native"}])
    res = _response(data, model)
    meta = res.candidates[0].grounding_metadata
    sources = [{"title": c.web.title, "uri": c.web.uri} for c in (meta.grounding_chunks if meta else [])]
    return {"response": res.text.strip(), "grounding_used": bool(sources), "sources": sources}


# ── the router VertexAIService uses ────────────────────────────


def _model_arg(args: Tuple[Any, ...], kwargs: Dict[str, Any]) -> str:
    return str(kwargs.get("model") if "model" in kwargs else (args[0] if args else ""))


class RoutedModels:
    """client.models: OpenRouter ids go to OpenRouter, everything else to the real (Vertex) client."""

    def __init__(self, models: Any):
        self._models = models

    def _route(self, method: str, args: Tuple[Any, ...], kwargs: Dict[str, Any]) -> Any:
        from . import mock_ai

        if mock_ai.enabled():  # load tests: canned replies, never outside development (mock_ai.py)
            return getattr(mock_ai, method)(*args, **kwargs)
        model = _model_arg(args, kwargs)
        if is_openrouter_model(model):
            fn = {"generate_content": generate_content, "generate_content_stream": generate_content_stream,
                  "count_tokens": count_tokens}[method]
            return fn(model, kwargs.get("contents", args[1] if len(args) > 1 else None), kwargs.get("config"))
        return getattr(self._models, method)(*args, **kwargs)

    def generate_content(self, *args: Any, **kwargs: Any) -> Any:
        return self._route("generate_content", args, kwargs)

    def generate_content_stream(self, *args: Any, **kwargs: Any) -> Any:
        return self._route("generate_content_stream", args, kwargs)

    def count_tokens(self, *args: Any, **kwargs: Any) -> Any:
        return self._route("count_tokens", args, kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._models, name)


class RoutedClient:
    """A google-genai Client whose .models also reaches OpenRouter (see RoutedModels)."""

    def __init__(self, client: Any):
        self._client = client
        self.models = RoutedModels(client.models)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._client, name)

