"""Day 2 Agent Studio: how a staged agent answers one message.

Every stage, in order:
  1 load      persona, model, guardrails, the last 6 turns (each capped at 500 characters)
  2 guardrail deterministic pre-check: a bank / settlement change request gets the hand-off message, no model call
  3 actions   the existing rules engine (conditions → evaluate → execute). "Say exact message" ends the turn with no
              model call; other actions add instructions; "Answer Using Knowledge Base" forces (and can filter) it
  4 system    persona, tone, length, instructions, guardrails, action constraints
  5 stage     assistant: one model call, no knowledge base, no web
              rag:       find 4 passages, answer only from them with [n] citations
              agent:     a tool loop (≤ 5 rounds, ≤ 12 tool calls) over the enabled tools, every step recorded
  6 mask      client data hidden when the guardrail is on; every turn is logged to chat_logs (history, Reset Chat)

Model calls are never simulated: if one fails the participant sees an error, not a made-up answer.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence

from . import agent_guardrails, agent_stages, agent_tools, rag_text
from .chat_service import RESPONSE_LENGTH_INSTRUCTIONS, TONE_INSTRUCTIONS, rule_constraints_block

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
HISTORY_TURNS = 6
HISTORY_CHARS = 500
TEMPERATURE = 0.2
ANSWER_CAP = 800
KB_K = 4
MAX_ROUNDS = 5
MAX_TOOLS = 12
RESULT_CHARS = 4000
WEB_MODEL = "gemini-2.5-flash"

RAG_RULE = ("Answer using only the numbered passages. Cite every passage you use with its number in square brackets, "
            "right after the sentence it supports. If the passages don't contain the answer, say: 'The documents don't "
            "cover this.' and give the hand-off message. Greetings and small talk need no passages.")
TOOL_RULE = ("Use your tools when they help. Use search_knowledge_base for SEBI or company documents, web_search for "
             "anything current or not in the documents, and the calculators for any date or number. Say which source "
             "you used.")
FORCE_KB_RULE = "An action requires it: call search_knowledge_base before you answer, and answer from what it returns."
EMPTY_KB_REPLY = "Add documents in Knowledge Base first."
WEB_PROMPT = "Search the web for: {query}. Reply with 3-6 short factual bullet points and nothing else."


class StudioModelError(RuntimeError):
    """The model didn't answer (502). Nothing is made up instead."""


# ── tools catalogue ────────────────────────────────────────────

NEW_TOOLS: Dict[str, Dict[str, Any]] = {
    "search_knowledge_base": {
        "name": "search_knowledge_base", "group": "lookup", "title": "Search your documents",
        "desc": "Searches your saved documents and returns the most relevant passages.",
        "schema": {"type": "object", "properties": {"query": {"type": "string", "description": "what to look for"}},
                   "required": ["query"]},
        "example": {"query": "wind-down framework deadline"},
    },
    "web_search": {
        "name": "web_search", "group": "lookup", "title": "Search the web",
        "desc": "Searches the web and returns a short summary with its sources.",
        "schema": {"type": "object", "properties": {"query": {"type": "string", "description": "what to search for"}},
                   "required": ["query"]},
        "example": {"query": "SEBI custodian circular this month"},
        "note": "Results come from Google Search and are summarised by the model. Check the sources.",
    },
}
# Display groups, in order (names as the Tools tab shows them)
TOOL_GROUPS: List[Dict[str, Any]] = [
    {"title": "Look things up", "tools": ["search_knowledge_base", "web_search"]},
    {"title": "Work it out", "tools": ["today", "calculator", "settlement_date", "nse_calendar"]},
    {"title": "Check IDs", "tools": ["validate_isin", "lookup_isin", "validate_pan", "validate_ifsc", "validate_gstin"]},
    {"title": "Take action", "tools": ["request_ssi_change"]},
]
ALL_TOOLS = [t for g in TOOL_GROUPS for t in g["tools"]]
DEFAULT_TOOLS = ["search_knowledge_base", "web_search", "today", "calculator"]
TOOL_LABEL = {"search_knowledge_base": "Search your documents", "web_search": "Search the web", "today": "Today's date",
              "calculator": "Calculator", "settlement_date": "Settlement date", "nse_calendar": "NSE calendar",
              "validate_isin": "ISIN check", "lookup_isin": "ISIN lookup", "validate_pan": "PAN check",
              "validate_ifsc": "IFSC check", "validate_gstin": "GSTIN check",
              "request_ssi_change": "Change bank / settlement instructions"}


def tool_spec(name: str) -> Dict[str, Any]:
    if name in NEW_TOOLS:
        return NEW_TOOLS[name]
    return agent_tools.BY_NAME[name]


def enabled_tools(enabled: Optional[Sequence[str]]) -> List[str]:
    """Known tools in display order; None (never saved) means the stage defaults."""
    want = DEFAULT_TOOLS if enabled is None else list(enabled)
    return [t for t in ALL_TOOLS if t in want]


def declarations_for(enabled: Sequence[str]) -> List[Dict[str, Any]]:
    """What the model is told about: only the enabled tools (name, description, schema)."""
    return [{"name": n, "desc": tool_spec(n)["desc"], "schema": tool_spec(n)["schema"]} for n in enabled_tools(enabled)]


def tools_catalog(enabled: Optional[Sequence[str]], guard_on: bool) -> Dict[str, Any]:
    on = set(enabled_tools(enabled))
    groups = []
    for g in TOOL_GROUPS:
        cards = []
        for name in g["tools"]:
            spec = tool_spec(name)
            card = {"name": name, "title": TOOL_LABEL[name], "desc": spec["desc"], "enabled": name in on,
                    "example": spec.get("example") or {}, "note": spec.get("note")}
            if name in agent_tools.BY_NAME and name != "request_ssi_change":
                try:
                    card["exampleResult"] = agent_tools.run(name, spec["example"], True)["result"]
                except Exception:
                    card["exampleResult"] = None
            if name == "request_ssi_change":
                card["blockedByGuardrail"] = bool(guard_on)
            cards.append(card)
        groups.append({"title": g["title"], "tools": cards})
    return {"groups": groups, "enabled": sorted(on, key=ALL_TOOLS.index)}


# ── pure helpers ───────────────────────────────────────────────


def _get(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def system_instruction(persona: Any, guardrails: Any, rule_constraints: Optional[Dict[str, Any]] = None,
                       stage_rule: str = "") -> str:
    name, role = _get(persona, "name", "Assistant"), _get(persona, "role", "assistant")
    tone = (_get(persona, "tone") or "friendly").lower()
    length = _get(persona, "response_length") or "short"
    out = [f"You are {name}, a {role}.", "",
           f"TONE: {tone} - {TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS['friendly'])}",
           f"RESPONSE LENGTH: {length} - {RESPONSE_LENGTH_INSTRUCTIONS.get(length, RESPONSE_LENGTH_INSTRUCTIONS['short'])}",
           f"LANGUAGE: {_get(persona, 'language') or 'English'}"]
    guidelines = (_get(persona, "guidelines") or "").strip()
    if guidelines:
        out += ["", "=== INSTRUCTIONS ===", guidelines]
    text = "\n".join(out) + "\n"
    text += agent_guardrails.build_guardrail_prompt(guardrails, persona)
    text += rule_constraints_block(rule_constraints)
    if stage_rule:
        text += f"\n=== HOW TO ANSWER ===\n{stage_rule}\n"
    return text


def history_turns(history: Sequence[Dict[str, Any]]) -> List[Dict[str, str]]:
    """The last HISTORY_TURNS turns as user/model messages, each capped at HISTORY_CHARS."""
    msgs = [{"role": "user" if m.get("role") == "user" else "model", "text": (m.get("content") or "")[:HISTORY_CHARS]}
            for m in history if (m.get("content") or "").strip()]
    return msgs[-HISTORY_TURNS * 2:]


def mark_citations(answer: str, hits: List[Dict[str, Any]]) -> Dict[str, Any]:
    cites = rag_text.citations(answer)
    valid = [c for c in cites if 1 <= c <= len(hits)]
    passages = [{**h, "cited": h["n"] in valid} for h in hits]
    return {"passages": passages, "citations": valid, "invalid_citations": [c for c in cites if c not in valid]}


def shape_web_result(text: str, sources: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """The web_search tool result the model sees: a summary and its sources, at most RESULT_CHARS long."""
    srcs = [{"title": s.get("title") or s.get("uri") or "", "uri": s.get("uri") or ""} for s in sources if s.get("uri")]
    if not srcs:
        return {"summary": "", "sources": [], "note": "No web results."}
    out = {"summary": (text or "").strip(), "sources": srcs}
    while len(json.dumps(out, ensure_ascii=False)) > RESULT_CHARS and out["sources"]:
        if len(out["summary"]) > 600:
            out["summary"] = out["summary"][: len(out["summary"]) - 400].rstrip() + "…"
        else:
            out["sources"] = out["sources"][:-1]
    return out


def clip(obj: Any) -> Any:
    """A tool result short enough to read and safe to store (Firestore: no arrays directly inside arrays)."""
    s = json.dumps(obj, ensure_ascii=False, default=str)
    if len(s) > RESULT_CHARS:
        return {"truncated": s[:RESULT_CHARS]}
    return {"json": s} if _nested_list(obj) else json.loads(s)


def _nested_list(obj: Any, in_list: bool = False) -> bool:
    if isinstance(obj, list):
        return in_list or any(_nested_list(x, True) for x in obj)
    if isinstance(obj, dict):
        return any(_nested_list(v, False) for v in obj.values())
    return False


def kb_doc_filter(rule_constraints: Optional[Dict[str, Any]]) -> Optional[str]:
    src = (rule_constraints or {}).get("kb_source") or {}
    return src.get("name") if src.get("type") == "file" else None


# ── default model calls (google-genai, as the RAG Chatbot lab) ─


def genai_generate(system: str, contents: List[Dict[str, str]], model: str) -> Dict[str, Any]:
    from google.genai import types

    from .exercises_vertex_models import resolve_vertex_model, thinking_config, vertex_chat_service, vertex_max_output_tokens

    vertex_model = resolve_vertex_model(model)
    cfg: Dict[str, Any] = {"temperature": TEMPERATURE, "max_output_tokens": vertex_max_output_tokens(vertex_model, ANSWER_CAP),
                           "system_instruction": system}
    tc = thinking_config(types)
    if tc is not None:
        cfg["thinking_config"] = tc
    t0 = time.perf_counter()
    try:
        resp = vertex_chat_service().client.models.generate_content(
            model=vertex_model,
            contents=[types.Content(role=m["role"], parts=[types.Part.from_text(text=m["text"])]) for m in contents],
            config=types.GenerateContentConfig(**cfg))
    except Exception as e:
        logger.warning("Studio generate failed (%s): %s", vertex_model, e)
        raise StudioModelError(f"{vertex_model} didn't answer ({type(e).__name__}). Nothing was made up: try again.")
    from .exercises_compare_service import _extract_text

    text = (_extract_text(resp) or "").strip()
    if not text:
        raise StudioModelError(f"{vertex_model} returned an empty answer. Try again.")
    return {"text": text, "model": vertex_model, "ms": int((time.perf_counter() - t0) * 1000)}


def rest_generate(model: str, system: str, contents: List[Dict[str, Any]], tools: List[Dict[str, Any]], final: bool) -> Dict[str, Any]:
    from .ai_agent_service import AgentModelError, generate

    try:
        return generate(model, system, contents, tools, TEMPERATURE, final=final)
    except AgentModelError as e:
        raise StudioModelError(str(e))


def google_web_search(query: str) -> Dict[str, Any]:
    from ..config import gcp_clients
    from .vertex_ai_service import VertexAIService

    try:
        out = VertexAIService(gcp_clients.get_project_id(), location="global").generate_text_with_search(
            WEB_PROMPT.format(query=query), enable_search=True, model_name=WEB_MODEL)
    except Exception as e:
        return {"summary": "", "sources": [], "note": f"Web search failed ({type(e).__name__}). Nothing was made up."}
    return shape_web_result(out.get("response") or "", out.get("sources") or [])


# ── sample questions ───────────────────────────────────────────


def sample_questions(stage: str) -> Dict[str, Any]:
    if stage == "assistant":
        data = json.loads((DATA_DIR / "agent_studio" / "sample_questions_assistant.json").read_text(encoding="utf-8"))
        return {"groups": data["groups"]}
    if stage == "rag":
        qs = json.loads((DATA_DIR / "rag_chatbot" / "test_questions.json").read_text(encoding="utf-8"))
        normal = [q for q in qs if not q.get("check", {}).get("trap")]
        traps = [q for q in qs if q.get("check", {}).get("trap")]
        conv = lambda q, note=None: {"id": q["id"], "text": q["question"], "answer": q["answer"],  # noqa: E731
                                     "where": q.get("where"), "note": note}
        return {"groups": [{"title": "From the documents", "questions": [conv(q) for q in normal]},
                           {"title": "Traps", "questions": [conv(q, "Trap: not in the documents") for q in traps]}]}
    ps = json.loads((DATA_DIR / "ai_agent" / "test_prompts.json").read_text(encoding="utf-8"))
    web = json.loads((DATA_DIR / "agent_studio" / "sample_questions_agent_web.json").read_text(encoding="utf-8"))
    conv = lambda p: {"id": p["id"], "text": p["prompt"], "answer": p["answer"],  # noqa: E731
                      "note": "Bonus" if p.get("bonus") else None, "tools": p.get("tools") or []}
    return {"groups": [{"title": "Tools", "questions": [conv(p) for p in ps if not p.get("bonus")]},
                       {"title": "Bonus", "questions": [conv(p) for p in ps if p.get("bonus")]},
                       {"title": "Web", "questions": web["questions"]}]}


# ── the answer ─────────────────────────────────────────────────


class AgentStudioService:
    """Everything external is injectable, so the whole pipeline runs offline in tests."""

    def __init__(self, agent_service=None, chat_service=None, rules_service=None, kb=None,
                 generate: Optional[Callable[..., Dict[str, Any]]] = None,
                 agent_generate: Optional[Callable[..., Dict[str, Any]]] = None,
                 web_search: Optional[Callable[[str], Dict[str, Any]]] = None,
                 tools_state: Optional[Callable[[str], Optional[List[str]]]] = None):
        self._agents = agent_service
        self._chat = chat_service
        self._rules = rules_service
        self._kb = kb
        self._generate = generate or genai_generate
        self._agent_generate = agent_generate or rest_generate
        self._web = web_search or google_web_search
        self._tools_state = tools_state

    # lazy defaults (real services need GCP)
    @property
    def agents(self):
        if self._agents is None:
            from .agent_service import AgentService
            self._agents = AgentService()
        return self._agents

    @property
    def chat(self):
        if self._chat is None:
            from .chat_service import ChatService
            self._chat = ChatService()
        return self._chat

    @property
    def rules(self):
        if self._rules is None:
            from .rules_service import RulesService
            self._rules = RulesService()
        return self._rules

    @property
    def kb(self):
        if self._kb is None:
            from .agent_kb_service import AgentKbService
            self._kb = AgentKbService()
        return self._kb

    def enabled(self, agent_id: str) -> List[str]:
        if self._tools_state is not None:
            return enabled_tools(self._tools_state(agent_id))
        from ..config import gcp_clients

        snap = gcp_clients.get_firestore_client().collection("agent_tools_state").document(agent_id).get()
        return enabled_tools((snap.to_dict() or {}).get("enabled") if snap.exists else None)

    def answer(self, agent: Any, message: str, session_id: str) -> Dict[str, Any]:
        stage = agent_stages.normalize_stage(_get(agent, "stage"))
        if stage is None:
            raise ValueError("Legacy agents answer through ChatService.chat.")
        agent_id = _get(agent, "agent_id")
        t0 = time.perf_counter()
        trace: Dict[str, Any] = {"agent_id": agent_id, "stage": stage, "message": message, "rule_matched": None,
                                 "kb_used": [], "llm_used": False, "response": "", "images": [], "conditions_detected": []}

        # 1 load
        persona = self.agents.get_persona(agent_id)
        settings = self.agents.get_settings(agent_id)
        model = _get(settings, "model") or agent_stages.DEFAULT_MODEL[stage]
        trace["model"] = model
        try:
            guardrails = self.agents.get_guardrails(agent_id)
        except Exception as e:
            logger.warning("Could not load guardrails for %s: %s", agent_id, e)
            guardrails = None
        trace["guardrails_on"] = agent_guardrails.active_switches(guardrails)

        def finish(response: str) -> Dict[str, Any]:
            # 6 mask, log, return
            if "protect_client_data" in trace["guardrails_on"]:
                response, masked = agent_guardrails.mask_client_data(response)
                if masked:
                    trace["guardrail_masked"] = masked
            trace["response"] = response
            trace["ms"] = int((time.perf_counter() - t0) * 1000)
            log = self.chat._log_chat(_Req(agent_id, session_id, message), response, trace)
            return {"response": response, "trace": trace, "chat_id": getattr(log, "chat_id", None), "images": []}

        # 2 guardrail pre-check: no model call at all
        blocked = agent_guardrails.check_blocked_request(guardrails, message)
        if blocked:
            trace["guardrail_blocked"] = "block_instruction_changes"
            return finish(blocked)

        # 3 actions (skipped entirely when no action is switched on: nothing could fire)
        constraints: Optional[Dict[str, Any]] = None
        if any(getattr(r, "active", True) for r in self.rules.get_rules(agent_id)):
            rule_context, trace["conditions_detected"] = self.chat.detect_rule_context(agent_id, session_id, message, model)
            rule = self.rules.evaluate_rules(agent_id, message, rule_context)
            if rule:
                trace["rule_matched"] = {"rule_id": rule.rule_id, "name": rule.name}
                constraints = self.rules.execute_actions(rule, message, rule_context)
                if constraints.get("exact_response"):
                    return finish(constraints["exact_response"])
        if stage == "assistant" and constraints:
            constraints = {**constraints, "use_kb": False, "kb_source": None}  # no knowledge base in Ex 6

        history = history_turns(self.chat._get_recent_conversation(agent_id, session_id, limit=HISTORY_TURNS * 2))

        # 4 + 5 stage
        if stage == "assistant":
            system = system_instruction(persona, guardrails, constraints)
            out = self._generate(system, history + [{"role": "user", "text": message}], model)
            trace["llm_used"] = True
            return finish(out["text"])

        if stage == "rag":
            if self.kb.is_empty(agent_id):
                return finish(EMPTY_KB_REPLY)
            hits = self.kb.search(agent_id, message, k=KB_K, doc_title=kb_doc_filter(constraints))
            trace["kb_used"] = [f"{h['doc_id']}#{h['label']}" for h in hits]
            system = system_instruction(persona, guardrails, constraints, RAG_RULE)
            passages = agent_kb_format(hits) or "(No passage matched the question.)"
            user = f"Passages:\n\n{passages}\n\nQuestion: {message}"
            out = self._generate(system, history + [{"role": "user", "text": user}], model)
            trace["llm_used"] = True
            trace.update(mark_citations(out["text"], hits))
            return finish(out["text"])

        return finish(self._agent_loop(agent_id, persona, guardrails, constraints, history, message, model, trace))

    # ── stage agent: the tool loop ──

    def _agent_loop(self, agent_id: str, persona: Any, guardrails: Any, constraints: Optional[Dict[str, Any]],
                    history: List[Dict[str, str]], message: str, model: str, trace: Dict[str, Any]) -> str:
        enabled = self.enabled(agent_id)
        force_kb = bool((constraints or {}).get("use_kb")) and "search_knowledge_base" in enabled
        rule = TOOL_RULE + ("\n" + FORCE_KB_RULE if force_kb else "")
        system = system_instruction(persona, guardrails, {**(constraints or {}), "use_kb": False} if constraints else None, rule)
        tools = declarations_for(enabled)
        guard = "block_instruction_changes" in agent_guardrails.active_switches(guardrails)
        doc_filter = kb_doc_filter(constraints)
        contents: List[Dict[str, Any]] = [{"role": m["role"], "parts": [{"text": m["text"]}]} for m in history]
        contents.append({"role": "user", "parts": [{"text": message}]})
        steps: List[Dict[str, Any]] = []
        passages: List[Dict[str, Any]] = []
        web_sources: List[Dict[str, str]] = []
        rounds = calls_made = 0
        answer = ""
        trace["llm_used"] = True
        while True:
            final = rounds >= MAX_ROUNDS or calls_made >= MAX_TOOLS
            out = self._agent_generate(model, system, contents, tools, final)
            contents.append(out["content"])
            calls = [] if final else list(out.get("calls") or [])
            calls = calls[: max(0, MAX_TOOLS - calls_made)] if calls else []
            steps.append({"kind": "model", "round": rounds + 1, "text": out.get("text") or "",
                          "calls": [{"name": c["name"], "args": clip(c.get("args") or {})} for c in calls],
                          "ms": out.get("ms", 0), "final": final})
            if not calls:
                answer = out.get("text") or ""
                break
            rounds += 1
            parts = []
            for c in calls:
                calls_made += 1
                st = time.perf_counter()
                name, args = c["name"], c.get("args") or {}
                step: Dict[str, Any] = {"kind": "tool", "round": rounds, "name": name, "args": clip(args), "ok": True,
                                        "blocked": False}
                if name not in enabled:
                    result: Any = {"error": f"There is no tool called {name}."}
                    step.update(group="unknown", ok=False)
                elif name == "search_knowledge_base":
                    hits = self.kb.search(agent_id, str(args.get("query") or message), k=KB_K, doc_title=doc_filter)
                    for h in hits:
                        h["n"] = len(passages) + 1
                        passages.append(h)
                    result = {"passages": agent_kb_format(hits) or "No passage matched.",
                              "how_to_cite": "Cite a passage you use by its number in square brackets, like [2]."}
                    step.update(group="lookup", passages=[h["n"] for h in hits], query=str(args.get("query") or ""))
                elif name == "web_search":
                    result = self._web(str(args.get("query") or message))
                    for s in result.get("sources") or []:
                        if not any(x["uri"] == s["uri"] for x in web_sources):
                            web_sources.append(s)
                    step.update(group="lookup", query=str(args.get("query") or ""), sources=result.get("sources") or [])
                else:
                    r = agent_tools.run(name, args, guard)
                    result = r["result"]
                    step.update(group=agent_tools.BY_NAME[name]["group"], ok=r["ok"], blocked=r["blocked"])
                result = clip(result)
                step["result"] = result
                step["ms"] = int((time.perf_counter() - st) * 1000)
                steps.append(step)
                fr: Dict[str, Any] = {"name": c.get("rawName") or name, "response": {"result": result}}
                if c.get("geminiId"):
                    fr["id"] = c["geminiId"]
                parts.append({"functionResponse": fr})
            contents.append({"role": "user", "parts": parts})
        cites = mark_citations(answer, passages) if passages else {"passages": [], "citations": [], "invalid_citations": []}
        trace.update(cites)
        trace["steps"] = steps
        trace["web_sources"] = web_sources
        trace["web_search_used"] = bool(web_sources)
        trace["tools_called"] = [s["name"] for s in steps if s["kind"] == "tool" and s.get("group") != "unknown"]
        trace["blocked"] = any(s.get("blocked") for s in steps)
        trace["kb_used"] = [f"{h['doc_id']}#{h['label']}" for h in passages]
        return answer


def agent_kb_format(hits: Sequence[Dict[str, Any]]) -> str:
    from .agent_kb_service import format_passages

    return format_passages(hits)


class _Req:
    """The shape ChatService._log_chat reads."""

    def __init__(self, agent_id: str, session_id: str, message: str):
        self.agent_id, self.session_id, self.message, self.user_id = agent_id, session_id, message, None
