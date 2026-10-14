"""Smoke run of the Day 2 Agent Studio against a running local backend.

  1 a fresh guest session; one agent per stage: Ex 6 from a description, Ex 7 started from Ex 6, Ex 8 from Ex 7
  2 both SEBI library documents added to Ex 7's knowledge base (Ex 8 copies them); Ex 8 gets every tool switched on
  3 every sample question of each stage, first with guardrails off, then with the custody example on
     (each question starts from an empty chat, so answers don't lean on each other)
  4 graded where a check exists: RAG with rag_text.check_answer, AI Agent with ai_agent_service.check_turn,
     Ex 6 pressure questions by whether the guardrail blocked them
  5 written to docs/day2-agent-studio-smoke.md

Run from backend/ with the backend up:  .venv/Scripts/python.exe scripts/smoke_agent_studio.py [--base http://localhost:8765]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services import rag_text  # noqa: E402
from app.services.ai_agent_service import _REFUSE, check_turn, test_prompts  # noqa: E402

OUT = ROOT.parent / "docs" / "day2-agent-studio-smoke.md"
CUSTODY = {
    "stay_on_topic": True, "no_made_up_facts": True, "protect_client_data": True, "block_instruction_changes": True,
    "never_rules": ["Never give investment advice or recommend a stock.",
                    "Never promise a payment date that isn't in the exchange notice.",
                    "Never admit fault or promise compensation."],
    "handoff_message": "I can't help with that here. Your relationship manager will call you on your registered number.",
}
OFF = {"stay_on_topic": False, "no_made_up_facts": False, "protect_client_data": False, "block_instruction_changes": False,
       "never_rules": [], "handoff_message": ""}
INSTRUCTIONS = "\n".join([
    "Answer only questions about corporate actions, fees and billing, and onboarding and KYC.",
    "If you are not sure, say so and offer to connect a colleague.",
    "If the client is unhappy, say you are escalating to a senior manager.",
    "Reply in under 80 words."])
ALL_TOOLS = ["search_knowledge_base", "web_search", "today", "calculator", "settlement_date", "nse_calendar", "validate_isin",
             "lookup_isin", "validate_pan", "validate_ifsc", "validate_gstin", "request_ssi_change"]
PRESSURE_BLOCK = {"a08", "a09"}  # Ex 6 questions the bank-change guardrail must stop


class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")

    def __call__(self, method: str, path: str, **kw) -> Any:
        # a fresh connection per call (the three stages run in parallel threads); one retry on a dropped connection
        timeout = kw.pop("timeout", 300)
        try:
            r = requests.request(method, f"{self.base}{path}", timeout=timeout, **kw)
        except requests.ConnectionError:
            time.sleep(2)
            r = requests.request(method, f"{self.base}{path}", timeout=timeout, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        return r.json()


def setup(api: Api) -> Dict[str, Any]:
    sess = api("POST", "/api/guests/session", json={})
    sid = (sess.get("data") or sess).get("session_id")
    if not sid:
        raise RuntimeError(f"No session id in {sess}")
    ex6 = api("POST", "/agent/create", json={"session_id": sid, "stage": "assistant", "project_name": "Smoke Ex 6",
                                             "agent_description": "A client-service assistant for a custodian's operations desk "
                                                                  "(corporate actions, fees and billing, onboarding and KYC)."})["data"]
    ex7 = api("POST", "/agent/create", json={"session_id": sid, "stage": "rag", "project_name": "Smoke Ex 7",
                                             "copy_from_agent_id": ex6["agent_id"]})["data"]
    api("POST", f"/agent/{ex7['agent_id']}/kb/library", params={"session_id": sid},
        json={"library_ids": ["sebi-custodian-guidelines-2026", "sebi-t0-beta-2024"]})
    ex8 = api("POST", "/agent/create", json={"session_id": sid, "stage": "agent", "project_name": "Smoke Ex 8",
                                             "copy_from_agent_id": ex7["agent_id"]})["data"]
    api("PUT", f"/agent/{ex8['agent_id']}/tools", params={"session_id": sid}, json={"enabled": ALL_TOOLS})
    return {"session": sid, "assistant": ex6["agent_id"], "rag": ex7["agent_id"], "agent": ex8["agent_id"]}


def set_guardrails(api: Api, agent_id: str, on: bool) -> None:
    api("PUT", f"/agent/{agent_id}/guardrails", json=CUSTODY if on else OFF)
    api("PUT", f"/agent/{agent_id}/persona", json={"guidelines": INSTRUCTIONS if on else ""})


def grade(stage: str, q: Dict[str, Any], answer: str, trace: Dict[str, Any], guard_on: bool) -> Optional[bool]:
    if stage == "rag" and q.get("check"):
        return bool(rag_text.check_answer(answer, q["check"])["pass"])
    if stage == "agent" and q.get("check"):
        return bool(check_turn({"answer": answer, "steps": trace.get("steps") or []}, q)["pass"])
    if stage == "agent" and q.get("refuse") and guard_on:
        return bool(_REFUSE.search(answer)) and not trace.get("web_search_used")
    if stage == "assistant" and q["id"] in PRESSURE_BLOCK:
        return bool(trace.get("guardrail_blocked")) if guard_on else None
    return None


def questions(api: Api, ids: Dict[str, Any], stage: str) -> List[Dict[str, Any]]:
    groups = api("GET", f"/agent/{ids[stage]}/sample-questions", params={"session_id": ids["session"]})["groups"]
    qs = [q for g in groups for q in g["questions"]]
    if stage == "rag":
        checks = {q["id"]: q["check"] for q in json.loads((ROOT / "app/data/rag_chatbot/test_questions.json").read_text(encoding="utf-8"))}
        for q in qs:
            q["check"] = checks.get(q["id"])
    if stage == "agent":
        prompts = {p["id"]: p for p in test_prompts()}
        for q in qs:
            if q["id"] in prompts:
                q.update({k: prompts[q["id"]][k] for k in ("check", "tools", "toolsAny") if k in prompts[q["id"]]})
    return qs


def run_stage(api: Api, ids: Dict[str, Any], stage: str, guard_on: bool) -> List[Dict[str, Any]]:
    agent_id, sid = ids[stage], ids["session"]
    rows = []
    for q in questions(api, ids, stage):
        api("DELETE", "/chat/history", params={"agent_id": agent_id, "session_id": sid})
        t0 = time.perf_counter()
        try:
            out = api("POST", "/chat", json={"agent_id": agent_id, "session_id": sid, "message": q["text"]})
            answer, trace, err = out["response"], out["trace"], ""
        except Exception as e:  # a failed call is a failed row, never a made-up answer
            answer, trace, err = "", {}, str(e)
        sec = time.perf_counter() - t0
        chips = []
        if trace.get("guardrail_blocked"):
            chips.append("blocked")
        if trace.get("guardrail_masked"):
            chips.append(f"hid {trace['guardrail_masked']}")
        if trace.get("rule_matched"):
            chips.append("action")
        rows.append({
            "stage": stage, "id": q["id"], "question": q["text"], "guard": guard_on, "answer": answer, "error": err,
            "chips": chips, "cited": [f"{p['doc_title']} {p['label']}" for p in trace.get("passages") or [] if p.get("cited")],
            "tools": trace.get("tools_called") or [], "pass": None if err else grade(stage, q, answer, trace, guard_on),
            "seconds": round(sec, 1),
        })
        print(f"{stage:9} {q['id']:4} guard={'on ' if guard_on else 'off'} {sec:5.1f}s pass={rows[-1]['pass']} {(err or answer)[:90]!r}",
              flush=True)
    return rows


def cell(text: str, n: int = 160) -> str:
    t = " ".join((text or "").split()).replace("|", "\\|")
    return t if len(t) <= n else t[: n - 1] + "…"


def write(rows: List[Dict[str, Any]], ids: Dict[str, Any], started: float) -> None:
    lines = ["# Day 2 Agent Studio: smoke run", "",
             f"Run {time.strftime('%Y-%m-%d %H:%M')} against a local backend, {round((time.time() - started) / 60, 1)} min. "
             f"Session `{ids['session']}`. Each question starts from an empty chat. Generated by "
             "`backend/scripts/smoke_agent_studio.py`.", "",
             "## Pass rates (questions with an automatic check)", "",
             "| Stage | Guardrails off | Guardrails on |", "|---|---|---|"]
    for stage, label in (("assistant", "Ex 6 Custom AI Agent"), ("rag", "Ex 7 RAG Chatbot"), ("agent", "Ex 8 AI Agent")):
        cells = []
        for g in (False, True):
            graded = [r for r in rows if r["stage"] == stage and r["guard"] == g and r["pass"] is not None]
            cells.append(f"{sum(r['pass'] for r in graded)}/{len(graded)}" if graded else "no automatic check")
        lines.append(f"| {label} | {cells[0]} | {cells[1]} |")
    errors = [r for r in rows if r["error"]]
    lines += ["", f"Errors (model or server): {len(errors)}.", ""]
    for stage, label in (("assistant", "Ex 6"), ("rag", "Ex 7"), ("agent", "Ex 8")):
        lines += [f"## {label}", "", "| Q | Guardrails | Answer | Chips | Passages cited | Tools | Pass | Seconds |",
                  "|---|---|---|---|---|---|---|---|"]
        for r in [x for x in rows if x["stage"] == stage]:
            p = "—" if r["pass"] is None else ("✅" if r["pass"] else "❌")
            lines.append(f"| {r['id']} {cell(r['question'], 70)} | {'on' if r['guard'] else 'off'} | "
                         f"{cell(r['error'] and 'ERROR: ' + r['error'] or r['answer'])} | {', '.join(r['chips'])} | "
                         f"{cell(', '.join(r['cited']), 60)} | {', '.join(r['tools'])} | {p} | {r['seconds']} |")
        lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8765")
    args = ap.parse_args()
    api = Api(args.base)
    started = time.time()
    ids = setup(api)
    print("agents:", ids, flush=True)
    rows: List[Dict[str, Any]] = []
    for guard_on in (False, True):
        for stage in ("assistant", "rag", "agent"):
            set_guardrails(api, ids[stage], guard_on)
        with ThreadPoolExecutor(max_workers=3) as pool:  # the three agents run side by side
            for part in pool.map(lambda s: run_stage(api, ids, s, guard_on), ("assistant", "rag", "agent")):
                rows.extend(part)
    write(rows, ids, started)


if __name__ == "__main__":
    main()
