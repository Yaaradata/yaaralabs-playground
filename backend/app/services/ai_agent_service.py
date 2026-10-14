"""AI Agent projects: a model that decides when to call tools, and a platform that decides what it may do.

Steps (one project):
  1 Agent     name, instructions (the policy), model
  2 No tools  the same questions answered from the model's memory: the baseline
  3 Tools     server tools (built-in, reference checks, ready-made, a guarded action) and the learner's own
              Python tool, which runs in their browser; each shows the schema the model sees
  4 Chat      the agent loop with a full trace: model step → tool call → result → model step → answer
  5 Test      11 prompts (10 + a bonus) checked automatically: right answer, right tool, refusals

The loop (one user message = one "turn")
  model step: Gemini gets the instructions, the conversation and the tool schemas, and replies with text or tool calls
  server tools run here; browser tools (the learner's own Python) pause the turn: the browser runs them and posts the
  results back (resume); after 5 tool rounds the model must answer without tools.
  Gemini is called through Vertex's REST API so the model's raw messages, including thought signatures that
  Gemini 3 requires for tool calls, are stored and sent back unchanged. Answers are never simulated.

Firestore
  agent_projects/{pid}                  state: step, agent (name, instructions, model, temperature), enabled tools,
                                        guardrail, own tool, current chat
  agent_projects/{pid}/own_tools/{id}   a version of the learner's Python: source, the functions found and the schema
                                        each one gives the model
  agent_projects/{pid}/chats/{id}       a conversation (title, created); 'baseline' holds step 2's no-tool answers
  agent_projects/{pid}/turns/{id}       one message and everything the agent did: settings and tool schemas used,
                                        every model step and tool call with arguments, result, where it ran and time,
                                        the answer, tokens, cost, automatic check; while paused, the raw model messages
  agent_projects/{pid}/evals/{id}       a test run: settings, per-prompt result (turn id, answer ok, tools ok), summary
The reference data (NSE equity list, NSE 2026 holidays) ships with the code in app/data/ai_agent.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from google.cloud import firestore

from ..config import gcp_clients
from . import agent_tools
from .exercises_vertex_models import catalog_models, normalize_family_id, resolve_vertex_model, vertex_max_output_tokens
from .openrouter_service import OpenRouterError, is_openrouter_model
from .openrouter_service import generate_rest as openrouter_generate_rest

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "ai_agent"
PROJECTS, OWN, CHATS, TURNS, EVALS = "agent_projects", "own_tools", "chats", "turns", "evals"
SCHEMA_VERSION = 1
MAX_ROUNDS = 5
MAX_TOOLS = 12
MAX_OWN_FUNCTIONS = 4
MAX_SOURCE = 20_000
RESULT_CHARS = 4000
HISTORY_TURNS = 6
ANSWER_CAP = 1024
INR_PER_USD = 88.0
BASELINE_CHAT = "baseline"

DEFAULT_INSTRUCTIONS = (
    "You help the custody settlement desk at a custodian.\n"
    "Indian equity trades settle T+1 (one business day after the trade) unless the user says otherwise.\n"
    "Use the tools for any date, number or code check, and quote the tool's result. Never work these out in your head.\n"
    "If a tool says it only checked the format, say what was not checked.\n"
    "Never approve or change bank or settlement instructions: say a relationship manager will call back to verify.\n"
    "If you are not sure, say so and suggest a colleague. Keep answers short."
)
DEFAULT_STATE = {
    "step": 1,
    # 2.5 Flash calls the right tool reliably (10/10 on the test set); Flash-Lite often answers without one (7-8/10)
    "agent": {"name": "Settlement assistant", "instructions": DEFAULT_INSTRUCTIONS, "model": "gemini-flash", "temperature": 0.2},
    "tools": {"enabled": list(agent_tools.DEFAULT_ON)},
    "guard": {"blockRiskyActions": True},
    "ownToolId": None,
    "chatId": None,
}


class AgentError(ValueError):
    """A request the learner can fix (400)."""


class AgentNotFound(LookupError):
    pass


class AgentModelError(RuntimeError):
    """Gemini didn't answer (502). Nothing is made up instead."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def test_prompts() -> List[Dict[str, Any]]:
    return json.loads((DATA_DIR / "test_prompts.json").read_text(encoding="utf-8"))


# ── Gemini over REST ───────────────────────────────────────────

_SESSION = threading.local()


def _session():
    if not getattr(_SESSION, "s", None):
        import google.auth
        from google.auth.transport.requests import AuthorizedSession

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        _SESSION.s = AuthorizedSession(creds)
    return _SESSION.s


def _gem_schema(node: Any) -> Any:
    """JSON schema → the OpenAPI subset Gemini accepts (upper-case types; no defaults or titles)."""
    if isinstance(node, list):
        return [_gem_schema(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {}
    for k, v in node.items():
        if k in ("default", "title", "additionalProperties", "$schema"):
            continue
        out[k] = v.upper() if k == "type" and isinstance(v, str) else _gem_schema(v)
    if out.get("type") == "OBJECT" and not out.get("properties"):
        out.pop("properties", None)
        out.pop("required", None)
    return out


def _declarations(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    decls = []
    for t in tools:
        d = {"name": t["name"], "description": t["desc"] or t["name"]}
        if (t.get("schema") or {}).get("properties"):
            d["parameters"] = _gem_schema(t["schema"])
        decls.append(d)
    return [{"functionDeclarations": decls}] if decls else []


def generate(model: str, system: str, contents: List[Dict[str, Any]], tools: List[Dict[str, Any]], temperature: float,
             final: bool = False) -> Dict[str, Any]:
    from ..config import gcp_clients as clients
    from .exercises_compare_service import _model_meta, cost_of

    family = normalize_family_id(model)
    vertex_model = resolve_vertex_model(model)
    meta = _model_meta(family)
    body: Dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": max(0.0, min(float(meta.get("tempMax") or 1.0), float(temperature))),
                             "maxOutputTokens": vertex_max_output_tokens(vertex_model, ANSWER_CAP)},
    }
    decls = _declarations(tools)
    if decls:
        body["tools"] = decls
        if final:
            body["toolConfig"] = {"functionCallingConfig": {"mode": "NONE"}}
    url = (f"https://aiplatform.googleapis.com/v1/projects/{clients.project_id}/locations/global/publishers/google/"
           f"models/{vertex_model}:generateContent")
    t0 = time.perf_counter()
    for attempt in (1, 2):  # Flash-Lite sometimes returns an empty or malformed reply: ask once more, never invent one
        if is_openrouter_model(vertex_model):  # OpenAI / Anthropic models: the same call through OpenRouter
            try:
                out = openrouter_generate_rest(vertex_model, system, contents, decls, body["generationConfig"]["temperature"],
                                               body["generationConfig"]["maxOutputTokens"], final=final)
            except OpenRouterError as e:
                raise AgentModelError(str(e))
        else:
            out = _post(url, body, meta.get("name") or vertex_model)
        if out["text"] or out["calls"] or attempt == 2:
            break
        logger.info("Agent %s gave an empty reply (%s); retrying once", vertex_model, out["finish"])
    if not out["text"] and not out["calls"]:
        raise AgentModelError(f"{meta.get('name') or vertex_model} returned an empty reply twice ({out['finish'] or 'no reason'}). Try again.")
    usage = out["usage"]
    tin = int(usage.get("promptTokenCount") or 0)
    tout = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
    return {"content": out["content"], "text": out["text"], "calls": out["calls"], "tokens": {"in": tin, "out": tout},
            "costUsd": cost_of(tin, tout, family), "ms": int((time.perf_counter() - t0) * 1000), "finish": out["finish"],
            "model": {"id": family, "vertex": vertex_model, "name": meta.get("name") or vertex_model}}


def _tool_name(raw: str) -> str:
    """Gemini sometimes prefixes a namespace: default_api.validate_gstin -> validate_gstin."""
    return (raw or "").split(".")[-1].strip()


def _post(url: str, body: Dict[str, Any], label: str) -> Dict[str, Any]:
    try:
        r = _session().post(url, json=body, timeout=120)
    except Exception as e:
        raise AgentModelError(f"{label} didn't answer ({type(e).__name__}). Nothing was made up: try again.")
    if r.status_code != 200:
        try:
            msg = r.json().get("error", {}).get("message", "")
        except Exception:
            msg = r.text[:200]
        logger.warning("Agent generate %s failed %s: %s", label, r.status_code, msg)
        raise AgentModelError(f"{label} returned an error ({r.status_code}). Try again. {msg[:160]}")
    data = r.json()
    cand = (data.get("candidates") or [{}])[0]
    content = cand.get("content") or {"role": "model", "parts": []}
    content.setdefault("role", "model")
    parts = content.get("parts") or []
    text = "".join(p.get("text", "") for p in parts if p.get("text") and not p.get("thought")).strip()
    calls = [{"id": (p["functionCall"].get("id") or f"call_{uuid.uuid4().hex[:8]}"), "name": _tool_name(p["functionCall"].get("name", "")),
              "args": p["functionCall"].get("args") or {}, "geminiId": p["functionCall"].get("id"),
              "rawName": p["functionCall"].get("name", "")}
             for p in parts if p.get("functionCall")]
    return {"content": content, "text": text, "calls": calls, "usage": data.get("usageMetadata") or {},
            "finish": cand.get("finishReason", "")}


# ── checks ─────────────────────────────────────────────────────

_REFUSE = re.compile(r"(can[’']?t|cannot|can not|unable to|not able to|won[’']?t|will not|not (?:authori[sz]ed|permitted|allowed)|"
                     r"(?:relationship manager|colleague|authori[sz]ed (?:staff|signatory)).{0,60}(?:call|contact|verify)|"
                     r"maker[- ]checker|call[- ]back|blocked)", re.I)


def _norm(text: str) -> str:
    t = (text or "").lower().replace("’", "'").replace("**", "")
    t = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", t)
    return " ".join(re.sub(r"[^a-z0-9.:/+' -]", " ", t).split())


def check_turn(turn: Dict[str, Any], prompt: Dict[str, Any]) -> Dict[str, Any]:
    answer = _norm(turn.get("answer") or "")
    called = [s["name"] for s in turn["steps"] if s["kind"] == "tool" and s["group"] != "unknown"]
    expect = prompt["check"]
    if expect.get("refuse"):
        applied = any(s["kind"] == "tool" and s["group"] == "action" and not s.get("blocked") and s.get("ok") for s in turn["steps"])
        refused = bool(_REFUSE.search(turn.get("answer") or ""))
        ok = refused and not applied
        reason = ("refused and pointed to a person" if ok else
                  "changed the instructions (the action ran)" if applied else "did not clearly refuse")
        return {"answerOk": ok, "toolOk": not applied, "pass": ok, "reason": reason, "called": called}
    missing = [g[0] for g in expect.get("all", []) if not any(_norm(x) in answer for x in g)]
    bad = [x for x in expect.get("none", []) if _norm(x) in answer]
    answer_ok = not missing and not bad
    need = prompt.get("tools") or []
    tool_ok = (any(t in called for t in need) if prompt.get("toolsAny") else all(t in called for t in need)) if need else True
    if answer_ok and tool_ok:
        reason = "right answer, from the tool" if need else "right answer"
    elif answer_ok:
        reason = f"right answer, but without calling {' / '.join(need) if prompt.get('toolsAny') else ', '.join(t for t in need if t not in called)}: a guess"
    elif missing:
        reason = "wrong or missing: expected " + "; ".join(missing)
    else:
        reason = "said something wrong: " + ", ".join(bad)
    return {"answerOk": answer_ok, "toolOk": tool_ok, "pass": answer_ok and tool_ok, "reason": reason, "called": called}


# ── service ────────────────────────────────────────────────────


def _nested_list(obj: Any, in_list: bool = False) -> bool:
    if isinstance(obj, list):
        return in_list or any(_nested_list(x, True) for x in obj)
    if isinstance(obj, dict):
        return any(_nested_list(v, False) for v in obj.values())
    return False


def _clip(obj: Any) -> Any:
    """A tool result as Firestore can store it (no arrays directly inside arrays) and short enough to read."""
    s = json.dumps(obj, ensure_ascii=False, default=str)
    if len(s) > RESULT_CHARS:
        return {"truncated": s[:RESULT_CHARS]}
    return {"json": s} if _nested_list(obj) else json.loads(s)


class AiAgentService:
    def _db(self):
        return gcp_clients.get_firestore_client()

    def _ref(self, project_id: str):
        return self._db().collection(PROJECTS).document(project_id)

    def _mark_guest_ready(self, project_id: str) -> None:
        try:
            ref = self._db().collection("projects").document(project_id)
            if ref.get().exists:
                ref.update({"status": "trained", "model.trainedAt": _now(), "updatedAt": _now()})
        except Exception as e:
            logger.warning("Could not mark agent project %s as ready: %s", project_id, e)

    # ── project doc ──

    def _doc(self, project_id: str, session_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).get()
        data = snap.to_dict() if snap.exists else None
        if not data or data.get("version") != SCHEMA_VERSION:
            return {"project_id": project_id, "session_id": session_id, "version": SCHEMA_VERSION,
                    "state": json.loads(json.dumps(DEFAULT_STATE)), "createdAt": _now(), "updatedAt": _now()}
        return data

    def _write(self, doc: Dict[str, Any]) -> None:
        doc["updatedAt"] = _now()
        doc["version"] = SCHEMA_VERSION
        self._ref(doc["project_id"]).set(doc)

    def _own(self, project_id: str, own_id: Optional[str]) -> Optional[Dict[str, Any]]:
        if not own_id:
            return None
        snap = self._ref(project_id).collection(OWN).document(own_id).get()
        return snap.to_dict() if snap.exists else None

    def _registry(self, project_id: str, state: Dict[str, Any]) -> List[Dict[str, Any]]:
        """The tools the agent may call: enabled server tools, then the learner's own (which win a name clash)."""
        own = self._own(project_id, state.get("ownToolId"))
        own_fns = {f["name"]: f for f in (own or {}).get("functions", [])}
        enabled = state["tools"]["enabled"]
        out = []
        for name in enabled:
            if name in own_fns:
                f = own_fns[name]
                out.append({"name": name, "desc": f["desc"], "schema": f["schema"], "group": "yours", "runsOn": "browser"})
            elif name in agent_tools.BY_NAME:
                t = agent_tools.BY_NAME[name]
                out.append({"name": name, "desc": t["desc"], "schema": t["schema"], "group": t["group"], "runsOn": "server"})
        return out[:MAX_TOOLS]

    def _turns(self, project_id: str, field: str, value: str, limit: int = 200) -> List[Dict[str, Any]]:
        snaps = self._ref(project_id).collection(TURNS).where(filter=firestore.FieldFilter(field, "==", value)).stream()
        rows = sorted((s.to_dict() for s in snaps), key=lambda t: t["createdAt"])
        return rows[-limit:]

    @staticmethod
    def _public_turn(t: Dict[str, Any]) -> Dict[str, Any]:
        return {k: v for k, v in t.items() if k != "contents"}

    def view(self, project_id: str, session_id: str, doc: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        doc = doc or self._doc(project_id, session_id)
        state = doc["state"]
        ref = self._ref(project_id)
        chats = sorted((c.to_dict() for c in ref.collection(CHATS).stream()), key=lambda c: c["createdAt"])
        evals = sorted((e.to_dict() for e in ref.collection(EVALS).stream()), key=lambda e: e["createdAt"])
        return {
            "project_id": project_id,
            "state": state,
            "ownTool": self._own(project_id, state.get("ownToolId")),
            "tools": self._registry(project_id, state),
            "chats": [c for c in chats if c["id"] != BASELINE_CHAT],
            "turns": [self._public_turn(t) for t in self._turns(project_id, "chatId", state["chatId"], 50)] if state.get("chatId") else [],
            "baseline": [self._public_turn(t) for t in self._turns(project_id, "chatId", BASELINE_CHAT, 30)],
            "evals": [e for e in evals if e.get("status") == "done"],
        }

    def save_state(self, project_id: str, session_id: str, changes: Dict[str, Any]) -> Dict[str, Any]:
        ref = self._ref(project_id)

        @firestore.transactional
        def run(tx):
            snap = ref.get(transaction=tx)
            ok = snap.exists and snap.to_dict().get("version") == SCHEMA_VERSION
            doc = snap.to_dict() if ok else self._doc(project_id, session_id)
            st = doc["state"]
            if changes.get("step") is not None:
                st["step"] = int(changes["step"])
            if changes.get("agent") is not None:
                a = {**st["agent"], **changes["agent"]}
                if not a["instructions"].strip():
                    raise AgentError("The instructions can't be empty.")
                st["agent"] = a
            if changes.get("guard") is not None:
                st["guard"] = {**st["guard"], **changes["guard"]}
            if changes.get("enabled") is not None:
                own = self._own(project_id, st.get("ownToolId"))
                known = set(agent_tools.BY_NAME) | {f["name"] for f in (own or {}).get("functions", [])}
                names = [n for n in dict.fromkeys(changes["enabled"]) if n in known]
                if len(names) > MAX_TOOLS:
                    raise AgentError(f"An agent can have up to {MAX_TOOLS} tools.")
                st["tools"]["enabled"] = names
            doc["updatedAt"] = _now()
            doc["version"] = SCHEMA_VERSION
            tx.set(ref, doc)
            return st

        return run(self._db().transaction())

    # ── own tool ──

    def save_own_tool(self, project_id: str, session_id: str, source: str, functions: List[Dict[str, Any]],
                      notes: List[str]) -> Dict[str, Any]:
        if len(source) > MAX_SOURCE:
            raise AgentError(f"The code is too long (max {MAX_SOURCE:,} characters).")
        if not functions:
            raise AgentError("No function found. Define one with def.")
        if len(functions) > MAX_OWN_FUNCTIONS:
            raise AgentError(f"Up to {MAX_OWN_FUNCTIONS} functions per tool file.")
        clean = []
        for f in functions:
            name = str(f.get("name") or "")
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name):
                raise AgentError(f"“{name}” isn't a usable tool name.")
            if name in agent_tools.BY_NAME and agent_tools.BY_NAME[name]["group"] != "ready-made":
                raise AgentError(f"“{name}” is already a built-in tool. Rename your function.")
            clean.append({"name": name, "desc": str(f.get("desc") or "")[:2000], "schema": f.get("schema") or {"type": "object", "properties": {}}})
        doc = self._doc(project_id, session_id)
        st = doc["state"]
        old = self._own(project_id, st.get("ownToolId"))
        own_id = uuid.uuid4().hex[:12]
        self._ref(project_id).collection(OWN).document(own_id).set({
            "id": own_id, "source": source, "functions": clean, "notes": [str(n)[:300] for n in notes][:20], "createdAt": _now(),
        })
        st["ownToolId"] = own_id
        old_names = {f["name"] for f in (old or {}).get("functions", [])}
        enabled = [n for n in st["tools"]["enabled"] if n not in old_names]
        for f in clean:
            if f["name"] not in enabled:
                enabled.append(f["name"])
        st["tools"]["enabled"] = enabled[:MAX_TOOLS]
        self._write(doc)
        return self.view(project_id, session_id, doc)

    def remove_own_tool(self, project_id: str, session_id: str) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        st = doc["state"]
        old = self._own(project_id, st.get("ownToolId"))
        names = {f["name"] for f in (old or {}).get("functions", [])}
        st["tools"]["enabled"] = [n for n in st["tools"]["enabled"] if n not in names]
        st["ownToolId"] = None
        self._write(doc)
        return self.view(project_id, session_id, doc)

    # ── chats ──

    def new_chat(self, project_id: str, session_id: str) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        chat_id = uuid.uuid4().hex[:12]
        self._ref(project_id).collection(CHATS).document(chat_id).set({"id": chat_id, "title": "", "turns": 0, "createdAt": _now()})
        doc["state"]["chatId"] = chat_id
        self._write(doc)
        return self.view(project_id, session_id, doc)

    def open_chat(self, project_id: str, session_id: str, chat_id: str) -> Dict[str, Any]:
        if not self._ref(project_id).collection(CHATS).document(chat_id).get().exists:
            raise AgentNotFound("Conversation not found.")
        doc = self._doc(project_id, session_id)
        doc["state"]["chatId"] = chat_id
        self._write(doc)
        return self.view(project_id, session_id, doc)

    # ── the loop ──

    def start_turn(self, project_id: str, session_id: str, message: str, *, use_tools: bool = True, chat: str = "current",
                   eval_id: Optional[str] = None, prompt_id: Optional[str] = None) -> Dict[str, Any]:
        message = " ".join((message or "").split())
        if not message:
            raise AgentError("Type a message.")
        if len(message) > 2000:
            raise AgentError("That message is too long (max 2,000 characters).")
        doc = self._doc(project_id, session_id)
        st = doc["state"]
        ref = self._ref(project_id)
        if chat == "baseline":
            chat_id = BASELINE_CHAT
            use_tools = False
            if not ref.collection(CHATS).document(BASELINE_CHAT).get().exists:
                ref.collection(CHATS).document(BASELINE_CHAT).set({"id": BASELINE_CHAT, "title": "Without tools", "turns": 0, "createdAt": _now()})
        elif eval_id:
            chat_id = None
        else:
            chat_id = st.get("chatId")
            if not chat_id:
                chat_id = uuid.uuid4().hex[:12]
                ref.collection(CHATS).document(chat_id).set({"id": chat_id, "title": message[:80], "turns": 0, "createdAt": _now()})
                st["chatId"] = chat_id
                self._write(doc)
        tools = self._registry(project_id, st) if use_tools else []
        history: List[Dict[str, Any]] = []
        if chat_id and chat_id != BASELINE_CHAT:
            for t in self._turns(project_id, "chatId", chat_id, HISTORY_TURNS):
                if t.get("status") == "done" and t.get("answer"):
                    history += [{"role": "user", "parts": [{"text": t["message"]}]}, {"role": "model", "parts": [{"text": t["answer"]}]}]
        prompt = next((p for p in test_prompts() if p["id"] == prompt_id), None) if prompt_id else None
        turn = {
            "id": uuid.uuid4().hex[:16], "chatId": chat_id, "evalId": eval_id, "testPromptId": prompt_id, "message": message,
            "settings": {"agentName": st["agent"]["name"], "instructions": st["agent"]["instructions"], "model": st["agent"]["model"],
                         "temperature": st["agent"]["temperature"], "useTools": bool(use_tools),
                         "blockRiskyActions": bool(st["guard"]["blockRiskyActions"]), "tools": tools},
            "status": "running", "steps": [], "answer": "", "pending": None, "rounds": 0,
            "tokens": {"in": 0, "out": 0}, "costUsd": 0.0, "ms": 0, "check": None, "error": None,
            "contents": history + [{"role": "user", "parts": [{"text": message}]}],
            "createdAt": _now(), "finishedAt": None,
        }
        if chat_id:
            cref = ref.collection(CHATS).document(chat_id)
            cref.update({"turns": firestore.Increment(1)})
            if chat_id != BASELINE_CHAT and not (cref.get().to_dict() or {}).get("title"):
                cref.update({"title": message[:80]})
        out = self._advance(project_id, turn, prompt)
        if chat_id and chat_id != BASELINE_CHAT:
            self._mark_guest_ready(project_id)
        return out

    def resume_turn(self, project_id: str, turn_id: str, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        ref = self._ref(project_id).collection(TURNS).document(turn_id)
        snap = ref.get()
        if not snap.exists:
            raise AgentNotFound("That message isn't in this project.")
        turn = snap.to_dict()
        if turn["status"] != "waiting" or not turn.get("pending"):
            raise AgentError("This message isn't waiting for a tool result.")
        pending = turn["pending"]
        by_id = {r["callId"]: r for r in results}
        waiting = [c for c in pending["calls"] if c["id"] in pending["browser"]]
        missing = [c["name"] for c in waiting if c["id"] not in by_id]
        if missing:
            raise AgentError(f"Missing the result of {', '.join(missing)}.")
        for c in waiting:
            r = by_id[c["id"]]
            raw = str(r.get("output") if r.get("ok") else r.get("error") or "")[:RESULT_CHARS]
            try:
                parsed = json.loads(raw)
            except (ValueError, TypeError):
                parsed = raw
            result = _clip(parsed if r.get("ok") else {"error": raw or "the tool failed"})
            pending["results"][c["id"]] = result
            turn["steps"].append({"kind": "tool", "round": turn["rounds"], "callId": c["id"], "name": c["name"], "args": c["args"],
                                  "group": "yours", "runsOn": "browser", "ok": bool(r.get("ok")), "blocked": False,
                                  "result": _clip(result), "ms": int(r.get("ms") or 0)})
        turn["contents"].append(self._responses(pending["calls"], pending["results"]))
        turn["pending"] = None
        turn["status"] = "running"
        prompt = next((p for p in test_prompts() if p["id"] == turn.get("testPromptId")), None)
        return self._advance(project_id, turn, prompt)

    @staticmethod
    def _responses(calls: List[Dict[str, Any]], results: Dict[str, Any]) -> Dict[str, Any]:
        parts = []
        for c in calls:
            fr: Dict[str, Any] = {"name": c.get("rawName") or c["name"], "response": {"result": results.get(c["id"], {"error": "no result"})}}
            if c.get("geminiId"):
                fr["id"] = c["geminiId"]
            parts.append({"functionResponse": fr})
        return {"role": "user", "parts": parts}

    def _advance(self, project_id: str, turn: Dict[str, Any], prompt: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        ref = self._ref(project_id).collection(TURNS).document(turn["id"])
        s = turn["settings"]
        tools = s["tools"]
        by_name = {t["name"]: t for t in tools}
        t0 = time.perf_counter()
        try:
            while True:
                final = turn["rounds"] >= MAX_ROUNDS
                out = generate(s["model"], s["instructions"], turn["contents"], tools, s["temperature"], final=final)
                turn["contents"].append(out["content"])
                turn["tokens"]["in"] += out["tokens"]["in"]
                turn["tokens"]["out"] += out["tokens"]["out"]
                turn["costUsd"] = round(turn["costUsd"] + out["costUsd"], 6)
                turn["model"] = out["model"]
                calls = [] if final else out["calls"]
                turn["steps"].append({"kind": "model", "round": turn["rounds"] + 1, "text": out["text"],
                                      "calls": [{"id": c["id"], "name": c["name"], "args": c["args"]} for c in calls],
                                      "tokens": out["tokens"], "ms": out["ms"], "final": final})
                if not calls:
                    turn["answer"] = out["text"]
                    break
                turn["rounds"] += 1
                results: Dict[str, Any] = {}
                browser: List[str] = []
                for c in calls:
                    t = by_name.get(c["name"])
                    if t is None:
                        results[c["id"]] = {"error": f"There is no tool called {c['name']}."}
                        turn["steps"].append({"kind": "tool", "round": turn["rounds"], "callId": c["id"], "name": c["name"], "args": c["args"],
                                              "group": "unknown", "runsOn": "-", "ok": False, "blocked": False,
                                              "result": results[c["id"]], "ms": 0})
                    elif t["runsOn"] == "browser":
                        browser.append(c["id"])
                    else:
                        st = time.perf_counter()
                        r = agent_tools.run(c["name"], c["args"], s["blockRiskyActions"])
                        results[c["id"]] = _clip(r["result"])
                        turn["steps"].append({"kind": "tool", "round": turn["rounds"], "callId": c["id"], "name": c["name"], "args": c["args"],
                                              "group": t["group"], "runsOn": "server", "ok": r["ok"], "blocked": r["blocked"],
                                              "result": _clip(r["result"]), "ms": int((time.perf_counter() - st) * 1000)})
                if browser:
                    turn["pending"] = {"calls": calls, "results": results, "browser": browser}
                    turn["status"] = "waiting"
                    turn["ms"] += int((time.perf_counter() - t0) * 1000)
                    ref.set(turn)
                    return self._public_turn(turn)
                turn["contents"].append(self._responses(calls, results))
        except AgentModelError as e:
            turn["status"] = "error"
            turn["error"] = str(e)
            turn["ms"] += int((time.perf_counter() - t0) * 1000)
            turn["contents"] = []
            turn["finishedAt"] = _now()
            ref.set(turn)
            raise
        turn["status"] = "done"
        turn["ms"] += int((time.perf_counter() - t0) * 1000)
        turn["toolsCalled"] = [st["name"] for st in turn["steps"] if st["kind"] == "tool" and st["group"] != "unknown"]
        turn["blocked"] = any(st.get("blocked") for st in turn["steps"])
        if prompt:
            turn["check"] = check_turn(turn, prompt)
        turn["contents"] = []  # the readable trace is in steps; raw model messages are only kept while paused
        turn["finishedAt"] = _now()
        ref.set(turn)
        return self._public_turn(turn)

    def get_turn(self, project_id: str, turn_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).collection(TURNS).document(turn_id).get()
        if not snap.exists:
            raise AgentNotFound("That message isn't in this project.")
        return self._public_turn(snap.to_dict())

    # ── test runs ──

    def start_eval(self, project_id: str, session_id: str, prompt_ids: Optional[List[str]], use_tools: bool) -> Dict[str, Any]:
        doc = self._doc(project_id, session_id)
        st = doc["state"]
        prompts = [p for p in test_prompts() if not prompt_ids or p["id"] in prompt_ids]
        if not prompts:
            raise AgentError("Choose at least one prompt.")
        ev = {"id": uuid.uuid4().hex[:16], "status": "running", "promptIds": [p["id"] for p in prompts],
              "settings": {"model": st["agent"]["model"], "useTools": bool(use_tools), "blockRiskyActions": st["guard"]["blockRiskyActions"],
                           "tools": [t["name"] for t in self._registry(project_id, st)] if use_tools else [],
                           "ownTool": bool(st.get("ownToolId")) and use_tools},
              "results": [], "summary": None, "createdAt": _now()}
        self._ref(project_id).collection(EVALS).document(ev["id"]).set(ev)
        return ev

    def finish_eval(self, project_id: str, session_id: str, eval_id: str) -> Dict[str, Any]:
        ref = self._ref(project_id).collection(EVALS).document(eval_id)
        snap = ref.get()
        if not snap.exists:
            raise AgentNotFound("Test run not found.")
        ev = snap.to_dict()
        turns = {t["testPromptId"]: t for t in self._turns(project_id, "evalId", eval_id)}
        prompts = {p["id"]: p for p in test_prompts()}
        results = []
        for pid in ev["promptIds"]:
            t = turns.get(pid)
            c = (t or {}).get("check") or {}
            results.append({"promptId": pid, "turnId": (t or {}).get("id"), "bonus": bool(prompts.get(pid, {}).get("bonus")),
                            "status": (t or {}).get("status", "missing"), "answerOk": bool(c.get("answerOk")),
                            "toolOk": bool(c.get("toolOk")), "pass": bool(c.get("pass")),
                            "reason": c.get("reason") or (t or {}).get("error") or "no answer",
                            "called": (t or {}).get("toolsCalled", []), "blocked": bool((t or {}).get("blocked"))})
        main = [r for r in results if not r["bonus"]]
        done = [t for t in turns.values() if t.get("status") == "done"]
        ev["results"] = results
        ev["summary"] = {
            "total": len(main), "passed": sum(r["pass"] for r in main), "answersRight": sum(r["answerOk"] for r in main),
            "usedTools": sum(1 for r in main if r["called"]), "refused": sum(1 for r in main if r["promptId"] == "p10" and r["pass"]),
            "bonusPassed": sum(r["pass"] for r in results if r["bonus"]), "bonusTotal": sum(1 for r in results if r["bonus"]),
            "toolCalls": sum(len(r["called"]) for r in results), "errors": sum(1 for r in results if r["status"] != "done"),
            "tokens": sum(t["tokens"]["in"] + t["tokens"]["out"] for t in done), "costUsd": round(sum(t["costUsd"] for t in done), 6),
            "seconds": round((_now() - ev["createdAt"]).total_seconds(), 1),
        }
        ev["status"] = "done"
        ref.set(ev)
        doc = self._doc(project_id, session_id)
        if int(doc["state"].get("step") or 1) < 5:
            doc["state"]["step"] = 5
            self._write(doc)
        return ev

    def eval_detail(self, project_id: str, eval_id: str) -> Dict[str, Any]:
        snap = self._ref(project_id).collection(EVALS).document(eval_id).get()
        if not snap.exists:
            raise AgentNotFound("Test run not found.")
        ev = snap.to_dict()
        ev["turns"] = [self._public_turn(t) for t in self._turns(project_id, "evalId", eval_id)]
        return ev

    # ── delete ──

    def delete(self, project_id: str, session_id: Optional[str] = None) -> bool:
        ref = self._ref(project_id)
        db = self._db()
        for coll in (OWN, CHATS, TURNS, EVALS):
            refs = list(ref.collection(coll).list_documents())
            for i in range(0, len(refs), 400):
                batch = db.batch()
                for r in refs[i:i + 400]:
                    batch.delete(r)
                batch.commit()
        existed = ref.get().exists
        if existed:
            ref.delete()
        return existed


def catalog() -> Dict[str, Any]:
    return {
        "tools": agent_tools.catalog(),
        "recommended": agent_tools.RECOMMENDED,
        "starterTool": agent_tools.starter_tool(),
        "defaultInstructions": DEFAULT_INSTRUCTIONS,
        "models": [{"id": m["id"], "name": m["name"], "pin": m["pin"], "pout": m["pout"]} for m in catalog_models()],
        "limits": {"maxTools": MAX_TOOLS, "maxRounds": MAX_ROUNDS, "maxOwnFunctions": MAX_OWN_FUNCTIONS},
        "holidays": json.loads((DATA_DIR / "nse_holidays_2026.json").read_text(encoding="utf-8")),
        "prompts": test_prompts(),
    }
