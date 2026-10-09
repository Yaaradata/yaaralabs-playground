"""Exercise 13 — build an agent and give it a tool.

One model step: the student defines instruction + tool schemas; the model
returns either text or tool calls. Tools themselves run in the browser
(calculator, unit convert, Pyodide). The model never sees tool code.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import re
import time
import uuid
from typing import Any, Dict, List, Optional, Sequence

from . import exercises_compare_service as compare
from .exercises_vertex_models import (
    DEFAULT_FAMILY_ID,
    normalize_family_id,
    resolve_vertex_model,
    thinking_config,
    vertex_chat_service,
    vertex_max_output_tokens,
)

logger = logging.getLogger(__name__)

EXAMPLE = {
    "name": "SiteCalc",
    "desc": (
        "Answers engineering questions for students and does exact "
        "calculations and unit conversions."
    ),
    "instr": (
        "You are SiteCalc, an assistant for civil and mechanical engineering students.\n"
        "Answer briefly and show the key numbers.\n"
        "For any arithmetic, use the calculator tool. Do not work numbers out in your head.\n"
        "For unit conversions, use the unit converter tool.\n"
        "If a tool gives an error, say so instead of guessing."
    ),
}

MSG_EXAMPLES = [
    "e.g. What is 48,371 × 9,284?",
    "e.g. Work out 12.5 × 7.2² ÷ 8 for the bending moment in kN·m.",
    "e.g. Convert 250 psi to MPa, then multiply the result by 1.5.",
]

BUILTIN_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "calculator",
        "title": "Exact arithmetic",
        "desc": (
            "Evaluates an arithmetic expression exactly and returns the number. "
            "Supports + - * / ^ ( ), sqrt(), sin() cos() tan() in degrees, log10(), "
            "ln(), abs() and the constant pi. A % means percent: 15% = 0.15, "
            "200 + 10% = 220, 20% of 150 = 30. Use it for every calculation."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The expression to evaluate, e.g. 48371*9284 or 12.5*7.2^2/8",
                }
            },
            "required": ["expression"],
        },
    },
    {
        "name": "unit_convert",
        "title": "Unit converter",
        "desc": (
            "Converts a value between units of length (mm, cm, m, km, in, ft, yd, mi), "
            "force (N, kN, MN, lbf, kgf), pressure (Pa, kPa, MPa, GPa, bar, atm, psi, N/mm2), "
            "mass (g, kg, t, lb, oz) and temperature (C, F, K)."
        ),
        "schema": {
            "type": "object",
            "properties": {
                "value": {"type": "number"},
                "from_unit": {"type": "string"},
                "to_unit": {"type": "string"},
            },
            "required": ["value", "from_unit", "to_unit"],
        },
    },
    {
        "name": "today",
        "title": "Today's date",
        "desc": "Returns the current date, day of the week and time on the student's computer.",
        "schema": {"type": "object", "properties": {}},
    },
]

OWN_EXAMPLE = """def beam_max_moment(w: float, L: float) -> float:
    \"\"\"Maximum bending moment (kN·m) of a simply supported
    beam under a uniform load.

    Args:
        w: Uniform load in kN/m.
        L: Span in metres.
    \"\"\"
    return w * L**2 / 8
"""

DEFAULTS: Dict[str, Any] = {
    "temp": 0.2,
    "topp": 1.0,
    "cap": 800,
    "maxSteps": 5,
    "prov": DEFAULT_FAMILY_ID,
}


def catalog() -> Dict[str, Any]:
    base = compare.catalog()
    return {
        "models": base["models"],
        "defaults": {**DEFAULTS, "inrPerUsd": compare.INR_PER_USD},
        "example": EXAMPLE,
        "messages": MSG_EXAMPLES,
        "tools": BUILTIN_TOOLS,
        "ownExample": OWN_EXAMPLE,
        "maxTools": 8,
        "maxOwnCodeChars": 8000,
    }


def _est_tokens(text: str) -> int:
    cleaned = (text or "").strip()
    if not cleaned:
        return 0
    return max(1, int(round(len(cleaned) / 4)))


def _clamp_params(model: str, temp: float, topp: float, cap: int) -> Dict[str, float]:
    meta = compare._model_meta(model)  # noqa: SLF001 — shared clamp helpers
    t = max(0.0, min(float(meta["tempMax"]), float(temp)))
    p = max(0.05, min(1.0, float(topp)))
    c = max(100, min(2000, int(cap)))
    return {"temp": t, "topp": p, "cap": float(c)}


def _normalize_tools(tools: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for raw in tools or []:
        name = re.sub(r"[^A-Za-z0-9_]", "", str(raw.get("name") or "").strip())
        if not name or name in seen or name.startswith("_"):
            continue
        if len(name) > 64:
            continue
        desc = str(raw.get("desc") or raw.get("description") or "").strip()
        if len(desc) > 2000:
            desc = desc[:2000]
        schema = raw.get("schema") or raw.get("input_schema") or {"type": "object", "properties": {}}
        if not isinstance(schema, dict):
            schema = {"type": "object", "properties": {}}
        schema = dict(schema)
        schema.setdefault("type", "object")
        if "properties" not in schema or not isinstance(schema["properties"], dict):
            schema["properties"] = {}
        seen.add(name)
        out.append({"name": name, "desc": desc, "schema": schema})
        if len(out) >= 12:
            break
    return out


def _normalize_messages(messages: Optional[Sequence[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for raw in messages or []:
        role = str(raw.get("role") or "").strip().lower()
        if role == "user":
            text = str(raw.get("text") or raw.get("content") or "").strip()
            if not text:
                continue
            if len(text) > 8000:
                raise ValueError("A user message is too long (max 8000 characters)")
            out.append({"role": "user", "text": text})
        elif role == "assistant":
            text = str(raw.get("text") or "").strip()
            calls_in = raw.get("calls") or []
            calls: List[Dict[str, Any]] = []
            for c in calls_in:
                name = str(c.get("name") or "").strip()
                if not name:
                    continue
                cid = str(c.get("id") or f"call_{uuid.uuid4().hex[:10]}")
                inp = c.get("input") if isinstance(c.get("input"), dict) else {}
                calls.append({"id": cid, "name": name, "input": inp})
            if not text and not calls:
                continue
            out.append({"role": "assistant", "text": text, "calls": calls})
        elif role == "tool":
            name = str(raw.get("name") or "").strip()
            cid = str(raw.get("id") or raw.get("callId") or "").strip() or f"call_{uuid.uuid4().hex[:10]}"
            if raw.get("error"):
                out.append(
                    {
                        "role": "tool",
                        "id": cid,
                        "name": name,
                        "error": str(raw.get("error"))[:4000],
                    }
                )
            else:
                output = str(raw.get("output") or raw.get("content") or "")
                if len(output) > 8000:
                    output = output[:8000]
                out.append({"role": "tool", "id": cid, "name": name, "output": output})
        if len(out) > 60:
            raise ValueError("Conversation is too long (max 60 messages)")
    if not out:
        raise ValueError("Conversation is empty")
    if out[-1]["role"] not in {"user", "tool"}:
        raise ValueError("Last message must be from the user or a tool result")
    return out


def _looks_like_math(q: str) -> bool:
    s = (q or "").lower()
    if re.search(r"\d[\d,]*\s*[×x*]\s*[\d,]", s):
        return True
    if re.search(r"\d[\d.]*\s*[+\-*/^÷]\s*[\d.(]", s):
        return True
    if any(w in s for w in ("calculate", "compute", "work out", "multiply", "divided by", "convert")):
        return True
    return False


def _math_expr_guess(q: str) -> Optional[str]:
    s = " " + str(q).replace(",", "") + " "
    s = (
        s.replace("×", "*")
        .replace("✕", "*")
        .replace("·", "*")
        .replace("÷", "/")
        .replace("²", "^2")
        .replace("³", "^3")
        .replace("−", "-")
        .replace("–", "-")
    )
    s = re.sub(r"(\d)\s*[x×]\s*(?=\d)", r"\1*", s, flags=re.I)
    cands: List[str] = []
    for m in re.finditer(r"[\d.()+\-*/^%\s]+", s):
        x = m.group(0).strip().strip("+-*/^%(").strip()
        if len(re.findall(r"\d+(?:\.\d+)?", x)) < 2:
            continue
        if not re.search(r"\d\s*[+\-*/^]\s*[\d(]", x):
            continue
        cands.append(x)
    cands.sort(key=len, reverse=True)
    return cands[0] if cands else None


def _wrong_arithmetic_answer(q: str) -> str:
    """Intentionally approximate — teaches why LLMs need tools for exact maths."""
    expr = _math_expr_guess(q)
    if expr and "*" in expr.replace("**", ""):
        nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", expr)]
        if len(nums) >= 2:
            approx = int(round(nums[0] * nums[1] * (0.97 + random.random() * 0.05)))
            return (
                f"Working that out roughly, I get about **{approx:,}**. "
                "(This is from the language model alone — not an exact calculator.)"
            )
    return (
        "I'd estimate that as roughly **450 million**, but without a calculator tool "
        "I can't guarantee the exact digits."
    )


def _simulated_step(
    system: str,
    messages: Sequence[Dict[str, Any]],
    tools: Sequence[Dict[str, Any]],
    final: bool,
    model: str,
    temp: float,
    cap: int,
    nonce: int,
) -> Dict[str, Any]:
    seed = int(hashlib.sha256(f"{system}|{json.dumps(messages, sort_keys=True)}|{nonce}".encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    tool_names = {t["name"] for t in tools}
    last = messages[-1]

    # After tool results → answer from them
    if last["role"] == "tool" or any(m["role"] == "tool" for m in messages[-4:]):
        results = [m for m in messages if m["role"] == "tool"]
        bits = []
        for r in results[-3:]:
            if r.get("error"):
                bits.append(f"{r.get('name')}: error — {r['error']}")
            else:
                bits.append(f"{r.get('name')} → {r.get('output')}")
        text = "Using the tool results: " + "; ".join(bits) + "."
        if any(r.get("name") == "calculator" and not r.get("error") for r in results):
            calc = next(r for r in reversed(results) if r.get("name") == "calculator" and not r.get("error"))
            text = f"The exact result is **{calc.get('output')}**."
        return {
            "text": text,
            "calls": [],
            "inTok": _est_tokens(system) + sum(_est_tokens(json.dumps(m)) for m in messages),
            "outTok": _est_tokens(text),
            "stop": "end",
            "simulated": True,
        }

    last_user = next((m["text"] for m in reversed(messages) if m["role"] == "user"), "")
    if tools and not final and _looks_like_math(last_user):
        # Prefer unit_convert when the question asks to convert
        if "unit_convert" in tool_names and re.search(r"\bconvert\b|\bpsi\b|\bmpa\b|\bkpa\b", last_user, re.I):
            m = re.search(r"([\d.,]+)\s*(psi|kpa|mpa|gpa|bar|atm|mm|cm|m|km|in|ft|n|kn)\b", last_user, re.I)
            to_m = re.search(r"\bto\s+(psi|kpa|mpa|gpa|bar|atm|mm|cm|m|km|in|ft|n|kn)\b", last_user, re.I)
            if m:
                val = float(m.group(1).replace(",", ""))
                fr = m.group(2)
                to = to_m.group(1) if to_m else ("MPa" if fr.lower() == "psi" else "m")
                return {
                    "text": "",
                    "calls": [
                        {
                            "id": f"call_{uuid.uuid4().hex[:10]}",
                            "name": "unit_convert",
                            "input": {"value": val, "from_unit": fr, "to_unit": to},
                        }
                    ],
                    "inTok": _est_tokens(system) + _est_tokens(last_user) + 40,
                    "outTok": 24,
                    "stop": "tool",
                    "simulated": True,
                }
        if "calculator" in tool_names:
            expr = _math_expr_guess(last_user) or "1+1"
            return {
                "text": "I'll use the calculator for an exact answer.",
                "calls": [
                    {
                        "id": f"call_{uuid.uuid4().hex[:10]}",
                        "name": "calculator",
                        "input": {"expression": expr},
                    }
                ],
                "inTok": _est_tokens(system) + _est_tokens(last_user) + 40,
                "outTok": 28,
                "stop": "tool",
                "simulated": True,
            }
        # First enabled tool as a fallback teaching path
        t0 = tools[0]
        props = (t0.get("schema") or {}).get("properties") or {}
        inp: Dict[str, Any] = {}
        for key, sch in list(props.items())[:3]:
            typ = (sch or {}).get("type")
            if typ == "number":
                inp[key] = 1
            elif typ == "integer":
                inp[key] = 1
            else:
                inp[key] = "demo"
        return {
            "text": f"Calling `{t0['name']}`…",
            "calls": [{"id": f"call_{uuid.uuid4().hex[:10]}", "name": t0["name"], "input": inp}],
            "inTok": _est_tokens(system) + _est_tokens(last_user) + 40,
            "outTok": 20,
            "stop": "tool",
            "simulated": True,
        }

    if _looks_like_math(last_user) and not tools:
        text = _wrong_arithmetic_answer(last_user)
    elif "today" in last_user.lower() and "today" in tool_names and not final:
        return {
            "text": "",
            "calls": [{"id": f"call_{uuid.uuid4().hex[:10]}", "name": "today", "input": {}}],
            "inTok": _est_tokens(system) + _est_tokens(last_user) + 20,
            "outTok": 12,
            "stop": "tool",
            "simulated": True,
        }
    else:
        name_hint = "assistant"
        m = re.search(r"you are\s+([A-Za-z0-9_-]+)", system or "", re.I)
        if m:
            name_hint = m.group(1)
        text = (
            f"As {name_hint}, here's a short answer: {last_user[:120] or 'your question'} — "
            f"I can go deeper if you switch a tool on or ask for exact numbers."
        )
        if temp > 1.0 and rng.random() < 0.3:
            text += " (Higher temperature: I may vary this wording.)"

    return {
        "text": text,
        "calls": [],
        "inTok": _est_tokens(system) + sum(_est_tokens(json.dumps(m)) for m in messages),
        "outTok": _est_tokens(text),
        "stop": "end",
        "simulated": True,
    }


def _schema_for_gemini(schema: Dict[str, Any]) -> Dict[str, Any]:
    """Uppercase JSON-schema types for Gemini function declarations."""

    def walk(node: Any) -> Any:
        if isinstance(node, list):
            return [walk(x) for x in node]
        if isinstance(node, dict):
            out: Dict[str, Any] = {}
            for k, v in node.items():
                if k == "type" and isinstance(v, str):
                    out[k] = v.upper()
                else:
                    out[k] = walk(v)
            return out
        return node

    return walk(schema)


def _build_gemini_tools(tools: Sequence[Dict[str, Any]], types: Any) -> Optional[List[Any]]:
    if not tools:
        return None
    decls = []
    for t in tools:
        props = (t["schema"].get("properties") or {})
        kwargs: Dict[str, Any] = {
            "name": t["name"],
            "description": t["desc"] or t["name"],
        }
        if props:
            kwargs["parameters"] = _schema_for_gemini(t["schema"])
        try:
            decls.append(types.FunctionDeclaration(**kwargs))
        except TypeError:
            # Older / stricter SDKs: pass parameters as a Schema-like dict only
            try:
                decls.append(
                    types.FunctionDeclaration(
                        name=t["name"],
                        description=t["desc"] or t["name"],
                        parameters=kwargs.get("parameters"),
                    )
                )
            except Exception:
                continue
    if not decls:
        return None
    try:
        return [types.Tool(function_declarations=decls)]
    except Exception:
        return None


def _messages_to_gemini(messages: Sequence[Dict[str, Any]], types: Any) -> List[Any]:
    contents: List[Any] = []
    i = 0
    while i < len(messages):
        msg = messages[i]
        if msg["role"] == "user":
            try:
                contents.append(
                    types.Content(role="user", parts=[types.Part.from_text(text=msg["text"])])
                )
            except Exception:
                contents.append({"role": "user", "parts": [{"text": msg["text"]}]})
            i += 1
        elif msg["role"] == "assistant":
            parts: List[Any] = []
            if msg.get("text"):
                try:
                    parts.append(types.Part.from_text(text=msg["text"]))
                except Exception:
                    parts.append({"text": msg["text"]})
            for c in msg.get("calls") or []:
                try:
                    parts.append(
                        types.Part.from_function_call(name=c["name"], args=c.get("input") or {})
                    )
                except Exception:
                    try:
                        parts.append(
                            types.Part(function_call=types.FunctionCall(name=c["name"], args=c.get("input") or {}))
                        )
                    except Exception:
                        parts.append({"function_call": {"name": c["name"], "args": c.get("input") or {}}})
            try:
                contents.append(types.Content(role="model", parts=parts))
            except Exception:
                contents.append({"role": "model", "parts": parts})
            i += 1
        elif msg["role"] == "tool":
            # Bundle consecutive tool results into one user turn
            parts = []
            while i < len(messages) and messages[i]["role"] == "tool":
                r = messages[i]
                response = {"error": r["error"]} if r.get("error") else {"result": r.get("output", "")}
                try:
                    parts.append(
                        types.Part.from_function_response(name=r.get("name") or "tool", response=response)
                    )
                except Exception:
                    try:
                        parts.append(
                            types.Part(
                                function_response=types.FunctionResponse(
                                    name=r.get("name") or "tool",
                                    response=response,
                                )
                            )
                        )
                    except Exception:
                        parts.append(
                            {
                                "function_response": {
                                    "name": r.get("name") or "tool",
                                    "response": response,
                                }
                            }
                        )
                i += 1
            try:
                contents.append(types.Content(role="user", parts=parts))
            except Exception:
                contents.append({"role": "user", "parts": parts})
        else:
            i += 1
    return contents


def _extract_calls_and_text(response: Any) -> tuple[str, List[Dict[str, Any]]]:
    text_parts: List[str] = []
    calls: List[Dict[str, Any]] = []
    try:
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                piece = getattr(part, "text", None)
                if piece:
                    text_parts.append(piece)
                fc = getattr(part, "function_call", None)
                if fc:
                    name = getattr(fc, "name", None) or ""
                    args = getattr(fc, "args", None) or {}
                    if hasattr(args, "items"):
                        args = dict(args)
                    elif not isinstance(args, dict):
                        try:
                            args = dict(args)
                        except Exception:
                            args = {}
                    calls.append(
                        {
                            "id": f"call_{uuid.uuid4().hex[:10]}",
                            "name": str(name),
                            "input": args,
                        }
                    )
    except Exception:
        pass
    if not text_parts:
        try:
            t = (getattr(response, "text", None) or "").strip()
            if t:
                text_parts.append(t)
        except Exception:
            pass
    return "".join(text_parts).strip(), calls


def step(
    system: str,
    messages: Optional[Sequence[Dict[str, Any]]] = None,
    tools: Optional[Sequence[Dict[str, Any]]] = None,
    model: str = DEFAULT_FAMILY_ID,
    temp: float = 0.2,
    topp: float = 1.0,
    cap: int = 800,
    final: bool = False,
    nonce: int = 0,
) -> Dict[str, Any]:
    """One agent model step: may return text and/or tool calls."""
    cleaned_sys = (system or "").strip()
    if len(cleaned_sys) > 8000:
        raise ValueError("Instruction is too long (max 8000 characters)")
    history = _normalize_messages(messages)
    tool_defs = _normalize_tools(tools)
    if final:
        # Cap reached: model must answer in text only
        pass

    chosen = normalize_family_id(model)
    vertex_model = resolve_vertex_model(model)
    params = _clamp_params(chosen, temp, topp, cap)
    meta = compare._model_meta(chosen)  # noqa: SLF001
    t0 = time.perf_counter()
    simulated = False
    text = ""
    calls: List[Dict[str, Any]] = []
    in_tok = 0
    out_tok = 0
    stop = "end"

    try:
        from google.genai import types

        vertex = vertex_chat_service()
        contents = _messages_to_gemini(history, types)
        gemini_tools = None if final else _build_gemini_tools(tool_defs, types)

        cfg_kwargs: Dict[str, Any] = {
            "temperature": float(params["temp"]),
            "max_output_tokens": vertex_max_output_tokens(vertex_model, int(params["cap"])),
        }
        if cleaned_sys:
            cfg_kwargs["system_instruction"] = cleaned_sys
        if params["topp"] < 0.999:
            cfg_kwargs["top_p"] = float(params["topp"])
        if gemini_tools:
            cfg_kwargs["tools"] = gemini_tools
        if final and tool_defs:
            try:
                cfg_kwargs["tool_config"] = types.ToolConfig(
                    function_calling_config=types.FunctionCallingConfig(mode="NONE")
                )
            except Exception:
                pass
        tc = thinking_config(types)
        if tc is not None:
            cfg_kwargs["thinking_config"] = tc

        try:
            config = types.GenerateContentConfig(**cfg_kwargs)
        except TypeError:
            for key in ("thinking_config", "tool_config", "top_p", "system_instruction", "tools"):
                cfg_kwargs.pop(key, None)
                try:
                    config = types.GenerateContentConfig(**cfg_kwargs)
                    break
                except TypeError:
                    continue
            else:
                config = types.GenerateContentConfig(
                    temperature=float(params["temp"]),
                    max_output_tokens=int(params["cap"]),
                )
            # Re-attach tools if we had to rebuild config
            if gemini_tools and not getattr(config, "tools", None):
                try:
                    config = types.GenerateContentConfig(
                        temperature=float(params["temp"]),
                        max_output_tokens=int(params["cap"]),
                        tools=gemini_tools,
                        system_instruction=cleaned_sys or None,
                    )
                except Exception:
                    pass

        response = vertex.client.models.generate_content(
            model=vertex_model,
            contents=contents,
            config=config,
        )
        text, calls = _extract_calls_and_text(response)
        if final:
            calls = []
        # Drop unknown tool names
        allowed = {t["name"] for t in tool_defs}
        calls = [c for c in calls if c["name"] in allowed]
        if not text and not calls:
            sim = _simulated_step(
                cleaned_sys, history, tool_defs, final, chosen, float(params["temp"]), int(params["cap"]), nonce
            )
            text = sim["text"]
            calls = [] if final else list(sim["calls"])
            in_tok = int(sim["inTok"])
            out_tok = int(sim["outTok"])
            stop = str(sim["stop"])
            simulated = True
        else:
            in_tok, out_tok = compare._usage_tokens(response, cleaned_sys, [], text)  # noqa: SLF001
            stop = "tool" if calls else compare._finish_reason(response)  # noqa: SLF001
    except Exception as e:
        logger.warning("Exercise 13 agent step fell back to simulator: %s", e)
        sim = _simulated_step(
            cleaned_sys, history, tool_defs, final, chosen, float(params["temp"]), int(params["cap"]), nonce
        )
        text = sim["text"]
        calls = [] if final else list(sim["calls"])
        in_tok = int(sim["inTok"])
        out_tok = int(sim["outTok"])
        stop = str(sim["stop"])
        simulated = True

    ms = (time.perf_counter() - t0) * 1000.0
    cost = compare.cost_of(in_tok, out_tok, chosen)
    return {
        "text": text,
        "calls": calls,
        "model": vertex_model,
        "modelId": vertex_model,
        "vendor": meta.get("vendor") or "",
        "name": meta.get("name") or chosen,
        "temp": params["temp"],
        "topp": params["topp"],
        "cap": int(params["cap"]),
        "inTok": in_tok,
        "outTok": out_tok,
        "tok": in_tok + out_tok,
        "stop": stop,
        "ms": round(ms, 1),
        "cost": cost,
        "costInr": cost * compare.INR_PER_USD,
        "simulated": simulated,
        "final": bool(final),
        "nonce": nonce,
    }
