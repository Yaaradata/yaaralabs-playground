import config from '../../../../../lib/config';

export interface DialModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  tempMax: number;
  topk: boolean;
  pin: number;
  pout: number;
  hint: string;
  est?: boolean;
  model?: string;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface DialDef {
  key: 'temp' | 'topk' | 'topp' | 'cap';
  label: string;
  short?: string;
  min: number;
  max: number;
  step: number;
  desc: string;
}

export interface DialValues {
  temp: number;
  topk: number;
  topp: number;
  cap: number;
}

export interface DialPreset {
  base: Partial<DialValues>;
  A: Partial<DialValues>;
  B: Partial<DialValues>;
}

export interface DialsCatalog {
  models: DialModel[];
  dials: DialDef[];
  presets: Record<string, DialPreset>;
  defaults: {
    model: string;
    view: DialDef['key'];
    runs: number;
    prompt: string;
    inrPerUsd: number;
    A: DialValues;
    B: DialValues;
  };
  explain: Record<string, string>;
}

export interface DialRunResult {
  text: string;
  model: string;
  dials: DialValues;
  inTok: number;
  outTok: number;
  stop: string;
  ms: number;
  cost: number;
  costInr: number;
  simulated: boolean;
  index: number;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/dials`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
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

export function loadDialsCatalog(sessionId: string, projectId: string): Promise<DialsCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runDialGeneration(
  sessionId: string,
  projectId: string,
  body: {
    prompt: string;
    model?: string;
    dials: DialValues;
    index?: number;
  },
  signal?: AbortSignal,
): Promise<DialRunResult> {
  const dials: DialValues = {
    temp: Math.round(Number(body.dials.temp) * 100) / 100,
    topk: Math.round(Number(body.dials.topk) || 0),
    topp: Math.round(Number(body.dials.topp) * 100) / 100,
    cap: Math.round(Number(body.dials.cap) || 60),
  };
  return send(`${base(sessionId, projectId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, dials }),
    signal,
  });
}
