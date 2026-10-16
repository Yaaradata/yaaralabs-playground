# Day 2 release test report (L1 / L2 / L3 Custody Service Agent)

Run on 16–17 Oct 2026 against the uncommitted working tree, before deploying backend + frontend.
Real models: Gemini 3.8 Flash (Vertex AI), GPT-6 Luna and Claude Haiku 5.5 (OpenRouter).

**Verdict: ready to deploy.** Every failure found was fixed and re-tested, except one search limitation (follow-up 1).

## 1. Changes made during testing (all uncommitted)

| Change | Why |
|---|---|
| New `backend/app/services/llm_retry.py`: retries 408/425/429/5xx/529 and dropped connections, 5 tries, exponential backoff with jitter, honours `Retry-After` | No model call retried a rate limit before: one 429 went straight to the learner |
| Retries wired into Gemini REST + streaming (`ai_agent_service`), OpenRouter incl. 429 inside a 200 body (`openrouter_service`), Google SDK calls (`agent_studio_service.genai_generate`), embeddings (`rag_embeddings`), web search | Every model call path for L1/L2/L3 |
| Per-try timeout 10 s connect / 50 s read (Gemini), 90 s (OpenRouter); retry budget 100 s | Load test: Gemini held a call 118 s then 429, using the whole budget, so it was never retried |
| Web search capped at 2 per question (`WEB_MAX_PER_TURN`) | GPT made 4 searches for one question: 107 s |
| Thread pool 40 → 200 (`main.py`, `THREADPOOL_SIZE`) | Each model call holds a thread; 20 learners + page loads could queue behind 40 |
| OpenRouter errors inside a streamed answer (429/5xx before any text) retried with the same backoff (`openrouter_service.generate_content_stream`) | Load-test re-run: a Haiku L2 answer got `{"code": 502, "message": "Network connection lost."}` inside the 200 stream and the learner saw an error |
| Empty reply cut off at the output cap: retry with 4× the cap, up to 4096 (`ai_agent_service.generate`) | Load test: Claude Haiku 5.5 L3 turns used all 1024 tokens with no text or tool call, and the retry hit the same limit (about 1 in 8 Haiku L3 turns errored) |
| Streamed replies decoded as UTF-8 (`r.encoding = "utf-8"` in `ai_agent_service.stream_text` and `openrouter_service.generate_content_stream`) | Browser check: "—" showed as "â▯▯" (streams have no charset, so they were read as Latin-1) |
| Agent Studio sidebar becomes a scrollable tab strip below the `md` breakpoint (`AgentStudio.tsx`) | Browser check: at 375 px the fixed 279 px sidebar squeezed the editor to ~95 px |
| Stale tests updated (model catalog, TF-IDF test isolation) | See section 2 |

## 2. Backend automated tests

| Test module | Checks | Result | Failed first? Reason / fix |
|---|---|---|---|
| test_agent_studio (30) | L1/L2/L3 answers, streaming, KB, tools, web-search cap | PASSED | New test for the web cap added |
| test_agent_guardrails (12) | guardrails, masking, hand-off | PASSED | |
| test_llm_retry (20) | 429/503/529 retried, Retry-After, 400/401/404 not retried, budget, jitter, OpenRouter 429-in-body, in-stream 502/429 retried before text (not after), MAX_TOKENS retry gets a bigger cap | PASSED | New |
| test_openrouter (9) | GPT / Haiku request shaping | PASSED | |
| test_openfigi (12) | ISIN lookup fallback to OpenFIGI | PASSED | Added by another session |
| test_stream_encoding (2) | streamed text with no charset is read as UTF-8 | PASSED | New (encoding fix) |
| test_hardening (49, 3 skipped) | security / abuse guards | PASSED | |
| test_rbp_scratch_api (19) | Rule Based Scratch API | PASSED | |
| test_copilot_lab (10), test_exercises_build_rag (6), ex2_to_ex3 (3), limit (5), metric (7), metric_grid (3), rag (10), tfidf (21), vision (15), image_models (7), lod_production (11), text_embed_model (11), text_evaluate (28) | Day 1 / Day 2 exercises | PASSED | |
| test_exercises_compare (10) | Ex 10 compare | PASSED after fix | Reason: expected the old models `claude/gpt/gemini`. Fix: expect the current 3 models (`gemini-38-flash`, `gpt-6-luna`, `claude-haiku-55`) |
| test_exercises_dials (10) | Ex 8 dials | PASSED after fix | Reason: old model list and "Claude dearer than Gemini" (old prices). Fix: current models; cost checked against the price table |
| test_exercises_persona (10) | persona exercise | PASSED after fix | Reason: default model `gemini` renamed. Fix: expect `gemini-38-flash` |
| test_exercises_tokeniser (8) | tokeniser exercise | PASSED after fix | Reason: old 7-model list. Fix: current 3 models |
| test_exercises_tfidf_api (9) | TF-IDF train/predict API | PASSED after fix | Reason: tests trained one project within 3 s and hit the real "wait before training again" guard. Fix: reset that project's last-train time in `setUp` (guard unchanged) |
| test_examples_add_options (4), test_exercises_ethics (6), test_exercises_workspace (2) | pytest-style functions | PASSED | Run with a small runner (pytest not installed) |
| test_api, test_api_endpoints, test_delete_*, test_demo_projects, test_gcp_setup, test_new_label_apis, test_teacher_system | old scripts against a live server on :8080 | NOT RUN | Need a server on :8080 and real data; not part of Day 2 |

## 3. Frontend checks

| Check | Result | Notes |
|---|---|---|
| Production build (`npm ci` + `npm run build` on a copy, like the Dockerfile) | PASSED | 151 s, compile + type check OK |
| TypeScript, app code | PASSED | 0 errors (27 only in `scripts/`, missing local `playwright-core`; `npm ci` in Docker installs it) |
| `next lint` | PASSED | warnings only |
| test:agent-studio (7), exercises (100), sample-labelling (12), evaluate (20), copilot-lab (9), session-check (14), labels (4), error-screens (4) | PASSED | |
| test-xss, test-rbp-safe-load, test-rbp-model-limit, test-learn-retry | NOT RUN | Playwright browser tests; `playwright-core` not installed locally (Day 1 screens) |

## 4. End-to-end: L1 / L2 / L3 × 3 models (real API, 9 agents at once)

Created from the prefilled description, chatted through `/chat/stream` (same as the browser). **60 / 63 checks passed.**

| Check (each × Gemini, GPT, Haiku) | Result |
|---|---|
| Create agent: description saved on persona, Instructions empty; model setting saved | PASSED ×9 |
| L2/L3: 4 library documents added to the Knowledge Base | PASSED ×6 |
| L1: greeting, "what is T+1", refuses stock advice, off-topic with guardrails on | PASSED ×12 |
| L2: T+0 custodian cut-off "2:45 PM" with citation; "500 scrips" with citation; weather → not in documents | PASSED ×9 |
| L2: "From when must custodians have systems ready for T+0?" (answer 1 May 2025) | **FAILED ×3, not fixed**: search limitation, see follow-up 1 |
| L3: settlement 19 Oct 2026 → 21 Oct (Dussehra) via tool; ISIN INE002A01019 invalid; IFSC HDFC000001 has 10 chars | PASSED ×9 |
| L3: web search for the RBI repo rate with sources | PASSED ×3 (after the cap: Gemini 20 s, Haiku 19 s, GPT 57–63 s; before: GPT 107 s) |
| L3: bank-detail (SSI) change refused with guardrails on | PASSED ×3 |

## 5. Load test: 20–21 learners at once

Two independent runs: mine (21 users, all first messages at the same instant, real models) and the
"Day 2 load test" session's (20 users, `backend/scripts/load_test.py --day2`, its own backend on :8790; report `load-test-report.md` in the shared notes).

| Run | Messages | Errors reaching users | Reply p50 / p95 | /health worst |
|---|---|---|---|---|
| Burst, real models, before timeout fix | 63 | **2** (Gemini L3: 429 after 118 s; ReadTimeout after 128 s) | 8.5 s / 12.9 s | 12 s |
| Burst, real models, **after timeout fix** | 63 | **0** | 8.8 s / 15.4 s | 2 s |
| load_test.py, real models, 2 min (with timeout fix) | 286 requests | **0** (0 × 429, 0 × 5xx) | L1 4–6 s, L2 6–7 s, L3 9–15 s | 4.5 s |
| load_test.py, real models, 2 min, re-run with Haiku fix | 20 users | 1 (Haiku L2: in-stream 502 "Network connection lost") → **fixed**, see below; Haiku MAX_TOKENS: 2 recovered, 0 L3 errors | | |
| load_test.py, mock models, 5 min | 703 requests | 3 (Haiku L3 "empty reply twice (MAX_TOKENS)") → **fixed**, see below | L3 up to 34 s (real OpenRouter calls) | 2.8 s |

Fixed failures:
- **Gemini burst.** Reason: a stuck call took 118–128 s and used up the 45 s retry budget, so it was never retried. Fix: 50 s read timeout per try and a 100 s budget; the log then shows `ReadTimeout, retry 1/4` followed by the answer.
- **Haiku L3 MAX_TOKENS.** Reason: Haiku sometimes spends the whole 1024-token cap before writing, and the retry used the same cap. Fix: on a MAX_TOKENS empty reply the retry gets 4× the cap (4096); 2 unit tests; confirmed in the live re-run (2 empty first replies, both recovered).
- **OpenRouter in-stream error.** Reason: OpenRouter put a provider 502 inside the 200 stream and only non-streamed calls retried body errors. Fix: a 429/5xx in the stream before any text is retried with the same backoff and budget; after text has started it is still raised; 4 unit tests. (Not re-run live yet.)

Other session's checks, all PASSED: agent setup 20/20 in each run; L2 answers came from the documents (32/32); L3 tool turns 26/26 completed.

## 6. Browser check of the Day 2 screens

Built-in browser, localhost:3000 + :8765, by the "Day 2 browser check" session (`browser-check-report.md` in the shared notes).

| Check | Result | Failed first? Reason / fix |
|---|---|---|
| Create form: L1/L2/L3 names, no "Start from", description pre-fill and swap | PASSED | |
| Create L1/L2/L3 opens the studio | PASSED | Slow: 12–16 s each |
| Studio sidebar per stage (L2 adds Knowledge Base, L3 adds Tools) | PASSED | |
| AI Persona: Description saved and used by the model; model dropdown (3 models) | PASSED | |
| Rules & Guardrails: Instructions start empty; Stay on topic saves | PASSED | |
| Knowledge Base: 4-circular picker, list scrolls in its panel, PDF fits width, save (89 passages), View, See the passages | PASSED | PDF shows a grey box for 5–10 s before loading (minor) |
| Tools (L3): all 12 in groups, toggles save | PASSED | Very fast repeat clicks can be ignored while a save runs (minor) |
| Chat L3 × Gemini / GPT-6 Luna / Haiku: settlement 21 Oct, ISIN, T+0 cut-off 2:45 PM with citations | PASSED | GPT used web search instead of the documents for the cut-off (~45 s) |
| Chat L2 Gemini with citations | PASSED | |
| Chat L1 Gemini: special characters | **FIXED** | Reason: streams have no charset, so "—" was decoded as Latin-1 ("â▯▯"). Fix: decode streams as UTF-8 (Gemini + OpenRouter); 2 tests added |
| Mobile 375 px: create form | PASSED | |
| Mobile 375 px: studio | **FIXED** | Reason: fixed 279 px sidebar at every width squeezed the editor to ~95 px. Fix: horizontal tab strip below `md`; checked at 375 px (no overflow) and 1024 px (unchanged) |
| Console errors | PASSED | Only connection-refused while the backend was down |

## Open points before tomorrow

1. **Run the workshop backend without `--reload`.** The local :8765 worker hung (idle, 14 sockets in CLOSE_WAIT) after a reload during testing; Cloud Run doesn't use `--reload`.
2. **Warm the backend before people join** (open one session, or Cloud Run `--min-instances=1`): the first sessions on a just-started backend took 11.5 s each (0.6 s warm).
3. **GPT-6 Luna web search is slow** (~45–60 s; each OpenRouter search takes 25–30 s). Gemini and Haiku take about 20 s.

## Follow-ups (after the workshop)

1. **Semantic search misses a date in a separate paragraph.** In SEBI's Dec 2024 T+0 circular, para 3.4 (custodians) and para 6.2 ("3.3, 3.4 and 3.5 apply from 1 May 2025") are separate; for "From when must custodians have systems ready for T+0?" the date passage ranks **30th of 89**, so all 3 models honestly said the date isn't in the passages (the 3 failed E2E checks). Fix: hybrid keyword + vector search, or pull in passages a hit refers to ("paragraphs 3.3, 3.4…").
2. **MOCK_AI doesn't cover the OpenRouter tool loop** (`openrouter_service.generate_rest` has no mock check), so mock load tests still make paid GPT/Haiku L3 calls. Load tests only.
3. **/health spikes of 2.8–12 s** during agent creation / library add bursts on this laptop: some sync work briefly holds the event loop. Watch it on Cloud Run.
4. **Investigate the :8765 hang** (worker idle with 14 CLOSE_WAIT sockets after a `--reload` under load).
5. **Install Playwright locally** (`npm ci` in `frontend/`) to run the 4 browser tests that were skipped.
6. Minor: unused `components/Project-comp/GuestProjectManager.tsx` lists L2/L3 but not L1 in its Day 2 options (nothing imports it); PDF viewer needs a "Loading…" placeholder; IFSC tool example shows raw JSON.
