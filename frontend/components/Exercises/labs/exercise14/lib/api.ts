import config from '../../../../../lib/config';

export interface EthicsModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  model: string;
  tempMax: number;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface EthicsCatalog {
  models: EthicsModel[];
  defaults: {
    temp: number;
    topp: number;
    cap: number;
    prov: string;
    inrPerUsd: number;
  };
  examples: Record<string, unknown>;
  endpoint: string;
}

export interface EthicsChatResult {
  text: string;
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
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/ethics`;
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

export function loadEthicsCatalog(sessionId: string, projectId: string): Promise<EthicsCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runEthicsChat(
  sessionId: string,
  projectId: string,
  body: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    model?: string;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<EthicsChatResult> {
  return send(`${base(sessionId, projectId)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: body.system,
      messages: body.messages,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 400),
    }),
    signal,
  });
}
