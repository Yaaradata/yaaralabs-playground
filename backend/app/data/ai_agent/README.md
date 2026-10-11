# AI Agent data

Built by `backend/scripts/build_agent_data.py RAW_DIR` from NSE's own files.

| File | What | Source |
|---|---|---|
| `nse_equity_list.csv` | 2,603 listed equities: symbol, company, series, listing date, face value, ISIN. Every ISIN passes the check-digit test | https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv |
| `nse_holidays_2026.json` | 2026 capital-market holidays on weekdays: **trading** (16) and **settlement / clearing** (20) | https://www.nseindia.com/resources/exchange-communication-holidays (holiday-master API, types `trading` and `clearing`) |
| `settlement_date_tool.py` | The starter tool learners edit: the curriculum's `settlement_date`, using trading holidays | Curriculum |
| `test_prompts.json` | The curriculum's 10 prompts plus one bonus, with expected answers, expected tools and automatic checks | Curriculum; answers verified with the tools |

**Trading vs settlement holidays.** Four 2026 dates are trading days but not settlement days: 19 Feb, 19 Mar, 1 Apr (annual bank closing) and 26 Aug. A T+1 trade the day before settles one business day later. The curriculum's tool uses trading holidays only, so it gets these wrong. The bonus prompt (a trade on 25 Aug) shows this: the right answer is 27 Aug, not 26 Aug.

## Where tools run

- **Server (trusted code):** `services/agent_tools.py`, covering built-in tools, reference checks, the ready-made settlement date and the guarded `request_ssi_change`.
- **Browser (the learner's code):** Pyodide. Learner code never runs on the server.

## Firestore layout

See `services/ai_agent_service.py` for the full layout. In short:

| Path | What it holds |
|---|---|
| `agent_projects/{pid}` | Agent settings, enabled tools, guardrail, own tool, current chat |
| `…/own_tools/{id}` | Each saved version of the learner's Python, with the schema derived from it |
| `…/chats/{id}` | Conversations; `baseline` holds the answers given without tools |
| `…/turns/{id}` | Each message: the tool schemas the model saw, every model step and tool call (inputs, result, where it ran, time), the answer, tokens, cost and the automatic check. While a turn waits for a browser tool, the raw model messages, including Gemini's thought signatures, are kept so the loop can resume exactly |
| `…/evals/{id}` | Each test run and its scores |

Deleting the project, or its guest session, removes everything under `agent_projects/{pid}`.
