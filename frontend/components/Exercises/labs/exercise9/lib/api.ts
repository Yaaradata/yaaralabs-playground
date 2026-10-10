import config from '../../../../../lib/config';

export interface PersonaModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  tempMax: number;
  pin: number;
  pout: number;
  hint: string;
  est?: boolean;
  model?: string;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface PersonaCondition {
  k: 'zero' | 'one' | 'few';
  name: string;
  sub: string;
  col: string;
  need: number;
}

export interface PersonaType {
  label: string;
  col: string;
  tip: string;
  ex: string[];
}

export interface PersonaExample {
  q: string;
  a: string;
}

export interface PersonaTest {
  type: string;
  q: string;
}

export interface PersonaCatalog {
  models: PersonaModel[];
  conditions: PersonaCondition[];
  types: Record<string, PersonaType>;
  defaults: {
    model: string;
    temp: number;
    topp: number;
    cap: number;
    inrPerUsd: number;
    sys: string;
    examples: PersonaExample[];
    tests: PersonaTest[];
  };
  sample: {
    sys: string;
    template: string;
    examples: PersonaExample[];
    tests: PersonaTest[];
  };
  explain: Record<string, string>;
}

export interface PersonaRunResult {
  text: string;
  model: string;
  condition: string;
  examplesSent: number;
  labels: string[];
  temp: number;
  topp: number;
  cap: number;
  inTok: number;
  outTok: number;
  stop: string;
  ms: number;
  cost: number;
  costInr: number;
  simulated: boolean;
  question: string;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/persona`;
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

export function loadPersonaCatalog(sessionId: string, projectId: string): Promise<PersonaCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runPersonaGeneration(
  sessionId: string,
  projectId: string,
  body: {
    system: string;
    examples: PersonaExample[];
    question: string;
    condition: 'zero' | 'one' | 'few';
    model?: string;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<PersonaRunResult> {
  return send(`${base(sessionId, projectId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: body.system,
      examples: body.examples,
      question: body.question,
      condition: body.condition,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 300),
    }),
    signal,
  });
}
