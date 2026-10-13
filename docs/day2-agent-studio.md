# Day 2 Agent Studio

One UI for the three Day 2 Playground exercises: the custody client-service assistant growing up.

| Exercise | Create-screen type | Stage | TRAIN sidebar | USE AI |
|---|---|---|---|---|
| Ex 6 | Custom AI Agent (Ex 6) | `assistant` | AI Persona · Rules & Guardrails · Actions | Model's own knowledge, inside persona, guardrails and actions. No knowledge base, no web search |
| Ex 7 | RAG Chatbot (Ex 7) | `rag` | + Knowledge Base | Answers only from the saved SEBI passages, with citations and the PDF |
| Ex 8 | AI Agent (Ex 8) | `agent` | + Tools | Decides which tools to use (documents, web, dates, calculators, ID checks) and shows each step |

Agents created before this change have no `stage`: they keep the old inline UI and `ChatService.chat`.
Old `rag-chatbot` / `ai-agent` guest projects keep opening in `RagChatbotLab` / `AiAgentLab`.

## Decisions

- Legacy custom agents keep the inline UI exactly as at `7e5d22e` (with Project Settings and Teach Your Agent). The
  earlier branch `feat/agent-persona-guardrails` had changed that inline UI; those UI changes were reverted and its
  Rules & Guardrails UI moved into `AgentStudio/GuardrailsPanel.tsx`. Its backend (guardrails store and enforcement
  in `ChatService.chat`) stays: legacy agents never have a guardrails document, so they behave as before.
- `RulesService.evaluate_rules` now skips switched-off rules. Before, the on/off switch on an action only changed the
  list; the rule still fired. This affects legacy agents too, as a bug fix.
- Copying into a new stage keeps the source's model only if the participant changed it; the earlier stage's default
  (Flash-Lite) becomes the new stage's default (Flash for AI Agent), so Ex 8 starts on the model that calls tools well.
- A copied knowledge base copies uploaded PDFs to the new agent's own GCS path, so removing a document in one agent
  never breaks the other.
- "Ready" on the projects list for a staged agent means its persona has been saved at least once (persona
  `updated_at` later than `created_at`). Legacy agents still show no status.
- Pseudo-project names use the project name the participant typed (`project_name`), falling back to the agent name.
- Actions: when the model-based rule matcher answers "no rule applies", the keyword fallback no longer overrides it.
  The fallback matched substrings (the word "or" inside "for custodians" fired the bank-change action on a SEBI
  question). The fallback still runs if the model call fails. This affects legacy agents too, as a bug fix.
- The existing rule matcher understands meaning, so the rephrased bank request ("Our payout should now go to a
  different bank") is caught by the action too. The Ex 6 lesson "a rule only catches the wording it knows" does not
  show with this engine; the deterministic guardrail is the better place to show that contrast.
- Staged agents skip condition detection (intent, sentiment) when no action is switched on, since nothing could
  fire; that saves two model calls per message.
- AI Agent: the search_knowledge_base tool result carries a one-line "cite a passage by its number, like [2]" note, so
  answers link back to passages and the PDF (the system rule keeps the spec's wording). Passages are numbered across
  the whole turn.
- p10 (approve an SSI change) with "Block bank and settlement changes" on is stopped by the guardrail pre-check
  before the agent loop, so request_ssi_change is never even offered to the model. With the switch off, the tool
  runs (sandbox) and the card shows it.
- AI Agent's tool rule also says "Indian equity trades settle T+1 unless the user says otherwise" (the AI Agent lab's
  instructions carry the same line). Without it the model sometimes called settlement_date with T+2 for p01.
- Agent steps show a tool's result as its key fields in words (settlement date, weekday, valid…), not raw JSON.
