/**
 * Day 2 Agent Studio stages: the same custody assistant growing up across Ex 6 → Ex 7 → Ex 8.
 * Pure data and functions (no React), shared by the create screen, the project page, the studio and the tests.
 * Mirrors backend/app/services/agent_stages.py.
 */

export type Stage = 'assistant' | 'rag' | 'agent';
export type Section = 'persona' | 'guardrails' | 'actions' | 'knowledge' | 'tools';

export const STAGES: Stage[] = ['assistant', 'rag', 'agent'];

/** Create-screen project type for each stage, and back. */
export const STAGE_TYPE: Record<Stage, string> = {
  assistant: 'custom-ai-agent',
  rag: 'rag-chatbot',
  agent: 'ai-agent',
};

export const TYPE_STAGE: Record<string, Stage> = {
  'custom-ai-agent': 'assistant',
  'rag-chatbot': 'rag',
  'ai-agent': 'agent',
};

export const STAGE_BADGE: Record<Stage, string> = {
  assistant: 'L1 · LLM - Custody Service Agent',
  rag: 'L2 · LLM + RAG - Custody Service Agent',
  agent: 'L3 · Agentic LLM - Custody Service Agent',
};

/** Day 2 options on the create screen, in order. */
export const DAY2_OPTIONS: [string, string][] = [
  ['custom-ai-agent', STAGE_BADGE.assistant],
  ['rag-chatbot', STAGE_BADGE.rag],
  ['ai-agent', STAGE_BADGE.agent],
];

/**
 * The description each stage starts with on the create screen (the learner can edit it). It drafts the agent's
 * name, role and tone, and is kept as its persona description (AI PERSONA), sent to the model in every reply.
 */
export const STAGE_DESCRIPTION: Record<Stage, string> = {
  assistant:
    'You are the Custody Service Agent of an Indian custodian, serving the operations teams of its institutional clients: mutual funds/AMCs, AIFs, PMS and FPIs.\n' +
    'What you do: answer questions on custody services: trade settlement, corporate actions, holdings statements, fees, and how to raise a service request.\n' +
    'How you behave: accuracy over speed. Use Indian market terms. Give information, never investment, tax or legal advice. Never discuss any client\'s holdings or transactions. If you are not sure, say so and offer to connect them to their relationship manager. Never invent a circular, date or figure.\n' +
    'Audience: client operations and fund accounting teams.',
  rag:
    'You are the Custody Service Agent of an Indian custodian, serving the operations teams of mutual funds/AMCs, AIFs, PMS and FPIs, with a library of SEBI and NSE documents.\n' +
    'What you do: answer custody and regulatory questions from those documents.\n' +
    'How you behave: base every regulatory statement on a retrieved passage and cite it. If the documents do not cover it, say "Not in the documents provided. I\'ll connect you to your relationship manager." If two documents disagree, show both and say which is more recent. Give information, never advice. Never discuss any client\'s holdings or transactions.\n' +
    'Audience: client operations and fund accounting teams.',
  agent:
    'You are the Custody Service Agent of an Indian custodian, serving the operations teams of mutual funds/AMCs, AIFs, PMS and FPIs, with SEBI/NSE documents and tools.\n' +
    'What you do: answer custody questions, work out settlement dates and cut-offs, and raise service requests.\n' +
    'How you behave: use the documents for rules and the tools for dates. Never calculate a date yourself. You never execute an instruction: every request goes to the custody team for approval, and you tell the client that. Give information, never advice. Never discuss any client\'s holdings or transactions.\n' +
    'Audience: client operations and fund accounting teams.',
};

/** True when the text is one of the ready-made descriptions (safe to swap when the project type changes). */
export function isStageDescription(text: string): boolean {
  return STAGES.some((s) => STAGE_DESCRIPTION[s] === text);
}

export const DEFAULT_MODEL: Record<Stage, string> = {
  assistant: 'gemini-3.8-flash',
  rag: 'gemini-3.8-flash',
  agent: 'gemini-3.8-flash',
};

export const MODEL_OPTIONS: [string, string][] = [
  // Gemini runs on Vertex AI; the "provider/model" ids go through OpenRouter (backend openrouter_service)
  ['gemini-3.8-flash', 'Gemini 3.8 Flash · Google'],
  ['openai/gpt-6-luna', 'GPT-6 Luna · OpenAI'],
  ['anthropic/claude-haiku-5.5', 'Claude Haiku 5.5 · Anthropic'],
];

export function isStage(value: unknown): value is Stage {
  return value === 'assistant' || value === 'rag' || value === 'agent';
}

/** Project type an agent shows as. Agents without a stage (legacy) are Custom AI Agents. */
export function stageToType(stage: string | null | undefined): string {
  return isStage(stage) ? STAGE_TYPE[stage] : 'custom-ai-agent';
}

/** Sidebar entries (TRAIN) for a stage, in order. No Settings or Teach in any stage. */
export function sidebarFor(stage: Stage): { id: Section; label: string; hint: string }[] {
  const items: { id: Section; label: string; hint: string }[] = [
    { id: 'persona', label: 'AI PERSONA', hint: 'How the agent talks' },
    { id: 'guardrails', label: 'RULES & GUARDRAILS', hint: 'What it must always do, and never do' },
    { id: 'actions', label: 'ACTIONS', hint: 'When this happens, do that' },
  ];
  if (stage === 'rag' || stage === 'agent') items.push({ id: 'knowledge', label: 'KNOWLEDGE BASE', hint: 'The documents it answers from' });
  if (stage === 'agent') items.push({ id: 'tools', label: 'TOOLS', hint: 'What it can look up and work out' });
  return items;
}

export interface StagedAgentRef {
  agent_id: string;
  stage?: string | null;
  name: string;
  created_at?: string;
}

/** Agents a new project can start from: only the previous stage (Ex 6 -> Ex 7 -> Ex 8), newest first. */
export function startFromOptions<T extends StagedAgentRef>(agents: T[], stage: Stage): T[] {
  const order: Stage[] = stage === 'rag' ? ['assistant'] : stage === 'agent' ? ['rag'] : [];
  const out: T[] = [];
  for (const want of order) {
    const group = agents.filter((a) => a.stage === want);
    group.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    out.push(...group);
  }
  return out;
}

/** The default "Start from": the newest agent of the previous stage, else start fresh (''). */
export function defaultStartFrom<T extends StagedAgentRef>(agents: T[], stage: Stage): string {
  const prev: Stage | null = stage === 'rag' ? 'assistant' : stage === 'agent' ? 'rag' : null;
  if (!prev) return '';
  const first = startFromOptions(agents, stage).find((a) => a.stage === prev);
  return first ? first.agent_id : '';
}
