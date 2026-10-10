import config from '../../../../../lib/config';

export interface CompareModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  model: string;
  tempMax: number;
  pin: number;
  pout: number;
  hint: string;
  est?: boolean;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface CompareCatalog {
  models: CompareModel[];
  defaults: {
    lanes: string[];
    temp: number;
    topp: number;
    cap: number;
    inrPerUsd: number;
    sys: string;
    minLanes: number;
    maxLanes: number;
  };
  sample: {
    sys: string;
    messages: string[];
  };
  explain: Record<string, string>;
}

export interface CompareTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CompareRunResult {
  text: string;
  model: string;
  modelId: string;
  vendor: string;
  name: string;
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
  nonce: number;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/compare`;
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

export function loadCompareCatalog(sessionId: string, projectId: string): Promise<CompareCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runCompareGeneration(
  sessionId: string,
  projectId: string,
  body: {
    system: string;
    turns: CompareTurn[];
    model?: string;
    temp: number;
    topp: number;
    cap: number;
    nonce?: number;
  },
  signal?: AbortSignal,
): Promise<CompareRunResult> {
  return send(`${base(sessionId, projectId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: body.system,
      turns: body.turns,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 300),
      nonce: Math.round(Number(body.nonce) || 0),
    }),
    signal,
  });
}
