import config from '../../../../../lib/config';

export interface AgentModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  model: string;
  tempMax: number;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface AgentToolDef {
  name: string;
  title?: string;
  desc: string;
  schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface AgentCatalog {
  models: AgentModel[];
  defaults: {
    temp: number;
    topp: number;
    cap: number;
    maxSteps: number;
    prov: string;
    inrPerUsd: number;
  };
  example: { name: string; desc: string; instr: string };
  messages: string[];
  tools: AgentToolDef[];
  ownExample: string;
  maxTools: number;
  maxOwnCodeChars: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  gid?: string;
}

export type AgentMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; calls?: AgentToolCall[] }
  | { role: 'tool'; id: string; name: string; output?: string; error?: string };

export interface AgentStepResult {
  text: string;
  calls: AgentToolCall[];
  model: string;
  modelId: string;
  name?: string;
  vendor?: string;
  temp: number;
  topp: number;
  cap: number;
  inTok: number;
  outTok: number;
  tok: number;
  stop: string;
  ms: number;
  simulated: boolean;
  final: boolean;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/agent`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      const parts = body.detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'msg' in item) {
            return String((item as { msg: unknown }).msg);
          }
          return '';
        })
        .filter(Boolean);
      if (parts.length) return parts.join('; ');
    }
    return res.statusText || 'Request failed';
  } catch {
    return res.statusText || 'Request failed';
  }
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

export function loadAgentCatalog(sessionId: string, projectId: string): Promise<AgentCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runAgentStep(
  sessionId: string,
  projectId: string,
  body: {
    system: string;
    messages: AgentMessage[];
    tools: Array<{ name: string; desc: string; schema: AgentToolDef['schema'] }>;
    model?: string;
    temp: number;
    topp: number;
    cap: number;
    final?: boolean;
    nonce?: number;
  },
  signal?: AbortSignal,
): Promise<AgentStepResult> {
  return send(`${base(sessionId, projectId)}/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: body.system,
      messages: body.messages,
      tools: body.tools,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 800),
      final: Boolean(body.final),
      nonce: Math.round(Number(body.nonce) || 0),
    }),
    signal,
  });
}
