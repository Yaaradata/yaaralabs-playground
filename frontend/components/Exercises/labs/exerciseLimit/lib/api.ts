import config from '../../../../../lib/config';

export interface LimitModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  model: string;
  tempMax: number;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface LimitCatalog {
  models: LimitModel[];
  limits: number[];
  defaults: {
    temp: number;
    topp: number;
    cap: number;
    limit: number;
    keep: number;
    prov: string;
    inrPerUsd: number;
  };
  sample: {
    sys: string;
    longText: string;
    messages: string[];
  };
  msgOverhead: number;
}

export interface LimitTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface LimitRunResult {
  text: string;
  model: string;
  inTok: number;
  outTok: number;
  simulated: boolean;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/limit`;
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

export function loadLimitCatalog(sessionId: string, projectId: string): Promise<LimitCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runLimitChat(
  sessionId: string,
  projectId: string,
  body: {
    system: string;
    turns: LimitTurn[];
    model?: string;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<LimitRunResult> {
  return send(`${base(sessionId, projectId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: body.system,
      turns: body.turns,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 300),
    }),
    signal,
  });
}

export function runLimitCompact(
  sessionId: string,
  projectId: string,
  body: {
    transcript: string;
    model?: string;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<LimitRunResult> {
  return send(`${base(sessionId, projectId)}/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: body.transcript,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 300),
    }),
    signal,
  });
}
