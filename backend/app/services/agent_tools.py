"""AI Agent tools that run on the server: trusted code written for the course (never learners' code).

Each tool has two faces:
  for the model    name, description, JSON schema: all it ever sees, so the description decides when it is called
  for the learner  why it exists, what goes wrong without it, an example, and the Python source

Groups
  built-in   today, calculator
  reference  validators (ISIN, PAN, IFSC, GSTIN), ISIN lookup on NSE's equity list, NSE calendar
  ready-made settlement_date (the learner normally writes this one; this copy is for when Python can't load)
  action     request_ssi_change: changes bank / settlement instructions; blocked by the platform's guardrail
Learners' own tools run in their browser (Pyodide) and never on the server.
"""

from __future__ import annotations

import ast
import csv
import inspect
import json
import math
import operator
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "ai_agent"
IST = timezone(timedelta(hours=5, minutes=30))
_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


# ── reference data ─────────────────────────────────────────────


@lru_cache(maxsize=1)
def _calendar() -> Dict[str, Any]:
    doc = json.loads((DATA_DIR / "nse_holidays_2026.json").read_text(encoding="utf-8"))
    doc["_trading"] = {h["date"]: h["name"] for h in doc["trading"]}
    doc["_settlement"] = {h["date"]: h["name"] for h in doc["settlement"]}
    return doc


@lru_cache(maxsize=1)
def _equities() -> Dict[str, Dict[str, str]]:
    with (DATA_DIR / "nse_equity_list.csv").open(encoding="utf-8", newline="") as fh:
        return {r["isin"]: r for r in csv.DictReader(fh)}


# ── built-in ───────────────────────────────────────────────────


def today() -> dict:
    """Today's date and weekday in India (IST)."""
    now = datetime.now(IST)
    return {"date": now.date().isoformat(), "weekday": now.strftime("%A"), "time_ist": now.strftime("%H:%M")}


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.Mod: operator.mod, ast.FloorDiv: operator.floordiv}
_FUNCS = {"sqrt": math.sqrt, "abs": abs, "round": round, "min": min, "max": max, "log10": math.log10, "ln": math.log}


def calculator(expression: str) -> dict:
    """Evaluates an arithmetic expression exactly: + - * / ** % ( ), sqrt, abs, round, min, max, log10, ln."""
    expr = (expression or "").replace("^", "**").replace("×", "*").replace("÷", "/").replace(",", "")
    if len(expr) > 300:
        return {"error": "Expression is too long."}

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            right = ev(n.right)
            if isinstance(n.op, ast.Pow) and abs(right) > 100:
                raise ValueError("exponent too large")
            return _OPS[type(n.op)](ev(n.left), right)
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
            return -ev(n.operand) if isinstance(n.op, ast.USub) else ev(n.operand)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FUNCS and not n.keywords:
            return _FUNCS[n.func.id](*[ev(a) for a in n.args])
        raise ValueError("only numbers, + - * / ** % ( ) and sqrt, abs, round, min, max, log10, ln are allowed")

    try:
        value = ev(ast.parse(expr, mode="eval"))
    except ZeroDivisionError:
        return {"expression": expression, "error": "division by zero"}
    except Exception as e:
        return {"expression": expression, "error": str(e)}
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e15:
        value = int(value)
    return {"expression": expression, "result": value}


# ── reference checks ───────────────────────────────────────────


def validate_isin(isin: str) -> dict:
    """ISO 6166 check: 2 letters, 9 letters/digits, 1 check digit (Luhn on the letters-as-numbers string)."""
    s = (isin or "").strip().upper()
    if len(s) != 12 or not s[:2].isalpha() or not s[2:11].isalnum() or not s[11].isdigit():
        return {"isin": s, "valid": False, "reason": "An ISIN is 2 letters + 9 letters/digits + 1 check digit (12 characters)."}
    digits = "".join(str(_ALNUM.index(c)) for c in s[:11])
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:  # double every second digit, starting from the right
            d *= 2
            if d > 9:
                d -= 9
        total += d
    check = (10 - total % 10) % 10
    ok = check == int(s[11])
    return {"isin": s, "valid": ok, "country": s[:2], "expected_check_digit": check,
            "reason": "check digit matches" if ok else f"check digit should be {check}, not {s[11]}"}


def lookup_isin(isin: str) -> dict:
    """Finds the company for an ISIN in NSE's list of listed equities."""
    s = (isin or "").strip().upper()
    row = _equities().get(s)
    if not row:
        return {"isin": s, "found": False, "note": "Not in NSE's equity list. It could be a bond, an MF unit, unlisted, or a typo."}
    return {"isin": s, "found": True, "symbol": row["symbol"], "company": row["company"], "series": row["series"],
            "face_value": row["face_value"], "listed_on": row["listed_on"], "source": "NSE equity list (EQUITY_L.csv)"}


PAN_HOLDER = {"P": "Individual", "C": "Company", "H": "Hindu Undivided Family", "F": "Firm / LLP", "A": "Association of Persons",
              "T": "Trust", "B": "Body of Individuals", "L": "Local authority", "J": "Artificial juridical person", "G": "Government"}


def validate_pan(pan: str) -> dict:
    """PAN format: 5 letters, 4 digits, 1 letter; the 4th letter is the holder type. Format only."""
    s = (pan or "").strip().upper()
    ok = len(s) == 10 and s[:5].isalpha() and s[5:9].isdigit() and s[9].isalpha() and s[3] in PAN_HOLDER
    return {"pan": s, "valid_format": ok, "holder_type": PAN_HOLDER.get(s[3]) if len(s) > 3 else None,
            "note": "Format check only. Whether this PAN exists needs the Income Tax / KRA verification service."}


def validate_ifsc(ifsc: str) -> dict:
    """IFSC format: 4-letter bank code, a zero, a 6-character branch code (11 characters). Format only."""
    s = (ifsc or "").strip().upper()
    ok = len(s) == 11 and s[:4].isalpha() and s[4] == "0" and s[5:].isalnum()
    problems = []
    if len(s) != 11:
        problems.append(f"has {len(s)} characters, should be 11")
    if len(s) >= 4 and not s[:4].isalpha():
        problems.append("first 4 characters must be letters (the bank code)")
    if len(s) >= 5 and s[4] != "0":
        problems.append("5th character must be 0")
    return {"ifsc": s, "valid_format": ok, "bank_code": s[:4] if ok else None, "problems": problems,
            "note": "Format check only. Whether the branch exists needs the RBI IFSC directory."}


GST_STATES = {"01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
              "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
              "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
              "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
              "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
              "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
              "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh"}


def validate_gstin(gstin: str) -> dict:
    """GSTIN: 2-digit state code, the holder's PAN, entity number, Z, check character (mod-36 checksum)."""
    s = (gstin or "").strip().upper()
    if len(s) != 15 or not s[:2].isdigit() or any(c not in _ALNUM for c in s):
        return {"gstin": s, "valid": False, "reason": "A GSTIN is 15 characters: state code, PAN, entity number, Z, check character."}
    total = 0
    for i, c in enumerate(s[:14]):
        p = _ALNUM.index(c) * (1 if i % 2 == 0 else 2)
        total += p // 36 + p % 36
    check = _ALNUM[(36 - total % 36) % 36]
    pan = validate_pan(s[2:12])
    ok = check == s[14] and pan["valid_format"]
    return {"gstin": s, "valid": ok, "state_code": s[:2], "state": GST_STATES.get(s[:2], "unknown state code"),
            "pan": s[2:12], "expected_check_char": check,
            "reason": "ok" if ok else ("embedded PAN format is wrong" if not pan["valid_format"] else f"check character should be {check}")}


def nse_calendar(day: str) -> dict:
    """Is this date a trading day and a settlement day on NSE (2026 capital-market calendar)?"""
    try:
        d = date.fromisoformat((day or "").strip())
    except ValueError:
        return {"error": "Give the date as YYYY-MM-DD."}
    cal = _calendar()
    if d.year != cal["year"]:
        return {"date": d.isoformat(), "error": f"This calendar covers {cal['year']} only."}
    weekend = d.weekday() >= 5
    iso = d.isoformat()
    return {"date": iso, "weekday": d.strftime("%A"), "weekend": weekend,
            "trading_day": not weekend and iso not in cal["_trading"], "trading_holiday": cal["_trading"].get(iso),
            "settlement_day": not weekend and iso not in cal["_settlement"], "settlement_holiday": cal["_settlement"].get(iso),
            "source": "NSE holiday master 2026 (CM segment)"}


# ── ready-made ─────────────────────────────────────────────────


def settlement_date(trade_date: str, t_plus: int = 1, calendar: str = "settlement") -> dict:
    """T+N settlement date: counts N business days after the trade, skipping weekends and holidays.
    calendar='settlement' uses NSE's clearing holidays (correct for settlement); 'trading' uses trading holidays."""
    try:
        d = date.fromisoformat((trade_date or "").strip())
    except ValueError:
        return {"error": "Give the trade date as YYYY-MM-DD."}
    cal = _calendar()
    if d.year != cal["year"]:
        return {"error": f"This calendar covers {cal['year']} only."}
    trading = cal["_trading"]
    closed = cal["_settlement"] if calendar == "settlement" else trading
    if d.weekday() >= 5 or d.isoformat() in trading:
        return {"trade_date": d.isoformat(), "error": "the trade date is not a trading day"}
    skipped, n = [], 0
    while n < max(0, int(t_plus)):
        d += timedelta(days=1)
        if d.weekday() >= 5:
            continue
        if d.isoformat() in closed:
            skipped.append({"date": d.isoformat(), "holiday": closed[d.isoformat()]})
            continue
        n += 1
    return {"trade_date": trade_date, "t_plus": int(t_plus), "calendar": calendar, "settlement_date": d.isoformat(),
            "weekday": d.strftime("%A"), "holidays_skipped": skipped}


# ── action (guarded) ───────────────────────────────────────────


def request_ssi_change(account_id: str, new_bank_account: str, ifsc: str, reason: str = "") -> dict:
    """Would change a client's standing settlement instructions (bank account). Only reached with the guardrail off."""
    return {"status": "APPLIED (sandbox)", "account_id": account_id, "new_bank_account": new_bank_account, "ifsc": ifsc,
            "warning": "Sandbox: nothing real changed. In production this would have redirected the client's money."}


GUARD_BLOCK = {
    "status": "BLOCKED by the platform",
    "reason": "Changing bank or settlement instructions needs maker-checker approval by authorised staff and a call-back to "
              "the client's authorised signatory. Agents may not perform this action.",
    "next_step": "Tell the client a relationship manager will contact them to verify the request.",
}


# ── catalog ────────────────────────────────────────────────────


def _schema(props: Dict[str, Dict[str, Any]], required: List[str]) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required}


TOOLS: List[Dict[str, Any]] = [
    {"name": "today", "fn": today, "group": "built-in", "title": "Today's date",
     "desc": "Returns today's date, weekday and time in India (IST). Use it whenever the question depends on today.",
     "why": "A model has no clock: it only knows the date its training data ended. Ask “what's today?” without this tool and it guesses.",
     "without": "Says a date from its training period, confidently.",
     "schema": _schema({}, []), "example": {}},
    {"name": "calculator", "fn": calculator, "group": "built-in", "title": "Exact arithmetic",
     "desc": "Evaluates an arithmetic expression exactly and returns the number. Supports + - * / ** % ( ), sqrt, abs, round, "
             "min, max, log10, ln. Use it for every calculation, including amounts like 1000 * 6.75.",
     "why": "Models predict digits like words, so long multiplications and percentages come out nearly right, which in money is wrong.",
     "without": "Gets 48,371 × 9,284 close but not exact.",
     "schema": _schema({"expression": {"type": "string", "description": "for example: 1000 * 6.75"}}, ["expression"]),
     "example": {"expression": "48371 * 9284"}},
    {"name": "validate_isin", "fn": validate_isin, "group": "reference", "title": "ISIN check digit",
     "desc": "Checks whether an ISIN is well formed and its check digit is correct (ISO 6166). Returns the expected check digit.",
     "why": "The 12th digit of an ISIN is computed from the other 11. One wrong digit means a different security or none.",
     "without": "Says an ISIN “looks valid”, or silently “corrects” a typo.",
     "schema": _schema({"isin": {"type": "string", "description": "the 12-character ISIN, e.g. INE002A01018"}}, ["isin"]),
     "example": {"isin": "INE002A01019"}},
    {"name": "lookup_isin", "fn": lookup_isin, "group": "reference", "title": "ISIN → company (NSE list)",
     "desc": "Looks up an ISIN in NSE's list of listed equities and returns the company, symbol, face value and listing date.",
     "why": "Which company an ISIN belongs to is a fact to look up, not to remember. The model's memory is old and incomplete.",
     "without": "Names a plausible company, sometimes the wrong one.",
     "schema": _schema({"isin": {"type": "string", "description": "the 12-character ISIN"}}, ["isin"]),
     "example": {"isin": "INE002A01018"}},
    {"name": "validate_pan", "fn": validate_pan, "group": "reference", "title": "PAN format",
     "desc": "Checks the format of an Indian PAN (5 letters, 4 digits, 1 letter) and returns the holder type from the 4th letter. "
             "Format only: it cannot confirm the PAN exists.",
     "why": "KYC forms are full of PANs. The format and holder type can be checked exactly; existence needs the tax department.",
     "without": "Calls a PAN “valid” without saying what it actually checked.",
     "schema": _schema({"pan": {"type": "string", "description": "10-character PAN"}}, ["pan"]), "example": {"pan": "AAACR5055K"}},
    {"name": "validate_ifsc", "fn": validate_ifsc, "group": "reference", "title": "IFSC format",
     "desc": "Checks the format of an Indian bank IFSC: 4-letter bank code, a zero, 6-character branch code (11 characters).",
     "why": "A mistyped IFSC in a bank-detail change sends money nowhere, or somewhere else. People skim past a missing character.",
     "without": "Reads HDFC000001 as fine: it has only 10 characters.",
     "schema": _schema({"ifsc": {"type": "string", "description": "the IFSC code"}}, ["ifsc"]), "example": {"ifsc": "HDFC000001"}},
    {"name": "validate_gstin", "fn": validate_gstin, "group": "reference", "title": "GSTIN check",
     "desc": "Checks a 15-character GSTIN: state code, embedded PAN, and the mod-36 check character. Returns the state.",
     "why": "Invoices carry GSTINs. The last character is a checksum, so a typo is detectable exactly.",
     "without": "Can't compute a mod-36 checksum reliably in its head.",
     "schema": _schema({"gstin": {"type": "string", "description": "15-character GSTIN"}}, ["gstin"]),
     "example": {"gstin": "27AAPFU0939F1ZV"}},
    {"name": "nse_calendar", "fn": nse_calendar, "group": "reference", "title": "NSE trading / settlement day",
     "desc": "For a date in 2026, says whether NSE is open for trading and whether trades settle that day, with the holiday name.",
     "why": "Trading holidays and settlement (bank) holidays are different lists. 26 Aug 2026 is a trading day but not a settlement day.",
     "without": "Doesn't know 2026's holiday list at all.",
     "schema": _schema({"day": {"type": "string", "description": "date as YYYY-MM-DD"}}, ["day"]), "example": {"day": "2026-08-26"}},
    {"name": "settlement_date", "fn": settlement_date, "group": "ready-made", "title": "Settlement date (ready-made)",
     "desc": "Settlement date for an NSE trade: counts T+N business days after the trade date, skipping weekends and holidays. "
             "Use calendar='settlement' (default) for when money and shares actually move.",
     "why": "The tool you write yourself in this step. This ready-made copy is for when Python can't load in the browser, and it "
            "uses the settlement calendar, which the simple version doesn't.",
     "without": "Says Tuesday 20 Oct for a Monday 19 Oct trade: 20 Oct 2026 is Dussehra.",
     "schema": _schema({"trade_date": {"type": "string", "description": "trade date as YYYY-MM-DD"},
                        "t_plus": {"type": "integer", "description": "business days to settlement, 1 for T+1"},
                        "calendar": {"type": "string", "enum": ["settlement", "trading"], "description": "which holiday list"}},
                       ["trade_date"]),
     "example": {"trade_date": "2026-10-19", "t_plus": 1}},
    {"name": "request_ssi_change", "fn": request_ssi_change, "group": "action", "title": "Change bank / settlement instructions",
     "desc": "Changes a client's standing settlement instructions (SSI): the bank account and IFSC their money is paid to.",
     "why": "An action, not a lookup: it changes something real, and bank-detail change requests are the most common fraud in "
            "asset servicing. With the guardrail on, the platform blocks it whatever the model decides.",
     "without": "",
     "schema": _schema({"account_id": {"type": "string"}, "new_bank_account": {"type": "string"}, "ifsc": {"type": "string"},
                        "reason": {"type": "string"}}, ["account_id", "new_bank_account", "ifsc"]),
     "example": {"account_id": "F12345", "new_bank_account": "50100123456789", "ifsc": "HDFC0000001"}},
]
BY_NAME = {t["name"]: t for t in TOOLS}
RECOMMENDED = ["today", "calculator", "validate_isin", "lookup_isin", "validate_pan", "validate_ifsc", "validate_gstin",
               "nse_calendar", "request_ssi_change"]
DEFAULT_ON = ["today", "calculator"]


def catalog() -> List[Dict[str, Any]]:
    out = []
    for t in TOOLS:
        out.append({k: t[k] for k in ("name", "group", "title", "desc", "why", "without", "schema", "example")}
                   | {"runsOn": "server", "source": inspect.getsource(t["fn"]), "exampleResult": t["fn"](**t["example"])})
    return out


def run(name: str, args: Dict[str, Any], guard: bool) -> Dict[str, Any]:
    """Run a server tool. Returns {"ok", "result", "blocked"}; errors are results the model can read."""
    tool = BY_NAME.get(name)
    if not tool:
        return {"ok": False, "result": {"error": f"Unknown tool {name}."}, "blocked": False}
    if tool["group"] == "action" and guard:
        return {"ok": False, "result": GUARD_BLOCK, "blocked": True}
    params = inspect.signature(tool["fn"]).parameters
    clean = {k: v for k, v in (args or {}).items() if k in params}
    missing = [k for k, p in params.items() if p.default is inspect.Parameter.empty and k not in clean]
    if missing:
        return {"ok": False, "result": {"error": f"Missing argument: {', '.join(missing)}."}, "blocked": False}
    try:
        return {"ok": True, "result": tool["fn"](**clean), "blocked": False}
    except Exception as e:
        return {"ok": False, "result": {"error": f"{type(e).__name__}: {e}"}, "blocked": False}


def starter_tool() -> str:
    return (DATA_DIR / "settlement_date_tool.py").read_text(encoding="utf-8")
