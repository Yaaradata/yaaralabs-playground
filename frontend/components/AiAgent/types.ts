/** AI Agent projects. Mirrors backend/app/services/ai_agent_service.py and agent_tools.py. */

export type Step = 1 | 2 | 3 | 4 | 5;
export type ToolGroup = 'built-in' | 'reference' | 'ready-made' | 'action' | 'yours' | 'unknown';

export interface JsonSchema {
  type: string;
  properties?: Record<string, { type?: string; description?: string; enum?: unknown[]; default?: unknown }>;
  required?: string[];
}

export interface CatalogTool {
  name: string;
  group: Exclude<ToolGroup, 'yours' | 'unknown'>;
  title: string;
  desc: string; // what the model reads
  why: string; // why it exists (for the learner)
  without: string; // what goes wrong without it
  schema: JsonSchema;
  example: Record<string, unknown>;
  exampleResult: unknown;
  runsOn: 'server';
  source: string;
}

export interface Holiday {
  date: string;
  day: string;
  name: string;
}

export interface TestPrompt {
  id: string;
  prompt: string;
  answer: string;
  tests: string;
  tools: string[];
  toolsAny?: boolean;
  bonus?: boolean;
}

export interface Catalog {
  tools: CatalogTool[];
  recommended: string[];
  starterTool: string;
  defaultInstructions: string;
  models: { id: string; name: string; pin: number; pout: number }[];
  limits: { maxTools: number; maxRounds: number; maxOwnFunctions: number };
  holidays: { year: number; source: string; note: string; trading: Holiday[]; settlement: Holiday[]; settlementOnly: Holiday[] };
  prompts: TestPrompt[];
}

export interface AgentSettings {
  name: string;
  instructions: string;
  model: string;
  temperature: number;
}

export interface State {
  step: Step;
  agent: AgentSettings;
  tools: { enabled: string[] };
  guard: { blockRiskyActions: boolean };
  ownToolId: string | null;
  chatId: string | null;
}

export interface OwnFunction {
  name: string;
  desc: string;
  schema: JsonSchema;
}

export interface OwnTool {
  id: string;
  source: string;
  functions: OwnFunction[];
  notes: string[];
  createdAt: string;
}

export interface ActiveTool {
  name: string;
  desc: string;
  schema: JsonSchema;
  group: ToolGroup;
  runsOn: 'server' | 'browser';
}

export interface ModelStep {
  kind: 'model';
  round: number;
  text: string;
  calls: { id: string; name: string; args: Record<string, unknown> }[];
  tokens: { in: number; out: number };
  ms: number;
  final: boolean;
}

export interface ToolStep {
  kind: 'tool';
  round: number;
  callId: string;
  name: string;
  args: Record<string, unknown>;
  group: ToolGroup;
  runsOn: 'server' | 'browser' | '-';
  ok: boolean;
  blocked: boolean;
  result: unknown;
  ms: number;
}

export type TraceStep = ModelStep | ToolStep;

export interface Check {
  answerOk: boolean;
  toolOk: boolean;
  pass: boolean;
  reason: string;
  called: string[];
}

export interface Turn {
  id: string;
  chatId: string | null;
  evalId: string | null;
  testPromptId: string | null;
  message: string;
  settings: { agentName: string; instructions: string; model: string; temperature: number; useTools: boolean; blockRiskyActions: boolean; tools: ActiveTool[] };
  status: 'running' | 'waiting' | 'done' | 'error';
  steps: TraceStep[];
  answer: string;
  pending: { calls: { id: string; name: string; args: Record<string, unknown> }[]; browser: string[] } | null;
  rounds: number;
  tokens: { in: number; out: number };
  costUsd: number;
  ms: number;
  check: Check | null;
  error: string | null;
  toolsCalled?: string[];
  blocked?: boolean;
  model?: { id: string; vertex: string; name: string };
  createdAt: string;
}

export interface Chat {
  id: string;
  title: string;
  turns: number;
  createdAt: string;
}

export interface EvalResult {
  promptId: string;
  turnId: string | null;
  bonus: boolean;
  status: string;
  answerOk: boolean;
  toolOk: boolean;
  pass: boolean;
  reason: string;
  called: string[];
  blocked: boolean;
}

export interface Eval {
  id: string;
  status: 'running' | 'done';
  promptIds: string[];
  settings: { model: string; useTools: boolean; blockRiskyActions: boolean; tools: string[]; ownTool: boolean };
  results: EvalResult[];
  summary: {
    total: number; passed: number; answersRight: number; usedTools: number; refused: number;
    bonusPassed: number; bonusTotal: number; toolCalls: number; errors: number; tokens: number; costUsd: number; seconds: number;
  } | null;
  createdAt: string;
  turns?: Turn[];
}

export interface Project {
  project_id: string;
  state: State;
  ownTool: OwnTool | null;
  tools: ActiveTool[];
  chats: Chat[];
  turns: Turn[];
  baseline: Turn[];
  evals: Eval[];
}
