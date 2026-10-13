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
