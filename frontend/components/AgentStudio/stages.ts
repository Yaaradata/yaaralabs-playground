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
  assistant: 'Ex 6 · Custom AI Agent',
  rag: 'Ex 7 · RAG Chatbot',
  agent: 'Ex 8 · AI Agent',
};

/** Day 2 options on the create screen, in order. */
export const DAY2_OPTIONS: [string, string][] = [
  ['custom-ai-agent', 'Custom AI Agent (Ex 6)'],
  ['rag-chatbot', 'RAG Chatbot (Ex 7)'],
  ['ai-agent', 'AI Agent (Ex 8)'],
];

export const DEFAULT_MODEL: Record<Stage, string> = {
  assistant: 'gemini-2.5-flash-lite',
  rag: 'gemini-2.5-flash-lite',
  agent: 'gemini-2.5-flash',
};

export const MODEL_OPTIONS: [string, string][] = [
  ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite (fast, cheapest)'],
  ['gemini-2.5-flash', 'Gemini 2.5 Flash (stronger with tools)'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro (strongest, slowest)'],
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

/** Agents a new project can start from: previous stage first (newest first); AI Agent also lists assistants. */
export function startFromOptions<T extends StagedAgentRef>(agents: T[], stage: Stage): T[] {
  const order: Stage[] = stage === 'rag' ? ['assistant'] : stage === 'agent' ? ['rag', 'assistant'] : [];
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
