import config from '../../../../../lib/config';

export interface RagModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  model: string;
  tempMax: number;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface RagCatalog {
  models: RagModel[];
  defaults: {
    temp: number;
    topp: number;
    cap: number;
    mode: string;
    size: number;
    overlap: number;
    k: number;
    minScore: number;
    strict: boolean;
    useDoc: boolean;
    prov: string;
    inrPerUsd: number;
  };
  sample: {
    doc: string;
    docName: string;
    questions: string[];
  };
  prompts: {
    strict: string;
    loose: string;
    nodoc: string;
  };
  searchKind: string;
  methodLabel: string;
}

export interface RagHit {
  i: number;
  score: number;
  text: string;
}

export interface RagAskResult {
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
  sentEst: number;
  ms: number;
  stop: string;
  simulated: boolean;
  useDoc: boolean;
  strict: boolean;
  k: number;
  minScore: number;
  kind: string;
  methodLabel: string;
  chunkCount: number;
  chunks: string[];
  hits: RagHit[];
  dropped: number;
  cites: number[];
  missingCites: number[];
  prompt: { system: string; user: string };
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/rag`;
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

export function loadRagCatalog(sessionId: string, projectId: string): Promise<RagCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runRagAsk(
  sessionId: string,
  projectId: string,
  body: {
    question: string;
    document?: string;
    chunks?: string[];
    mode?: string;
    size?: number;
    overlap?: number;
    k?: number;
    minScore?: number;
    strict?: boolean;
    useDoc?: boolean;
    model?: string;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<RagAskResult> {
  return send(`${base(sessionId, projectId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: body.question,
      document: body.document ?? '',
      chunks: body.chunks,
      mode: body.mode ?? 'words',
      size: Math.round(Number(body.size) || 60),
      overlap: Math.round(Number(body.overlap) || 0),
      k: Math.round(Number(body.k) || 3),
      minScore: Math.round(Number(body.minScore) * 100) / 100,
      strict: body.strict !== false,
      useDoc: body.useDoc !== false,
      model: body.model,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 400),
    }),
    signal,
  });
}
