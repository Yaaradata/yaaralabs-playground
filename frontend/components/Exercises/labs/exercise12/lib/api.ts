import config from '../../../../../lib/config';

export interface BuildRagModel {
  id: string;
  name: string;
  short?: string;
  vendor: string;
  model: string;
  tempMax: number;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface BuildRagTest {
  q: string;
  expect: string;
  source: string;
}

export interface BuildRagCatalog {
  models: BuildRagModel[];
  defaults: {
    temp: number;
    topp: number;
    cap: number;
    mode: string;
    size: number;
    overlap: number;
    k: number;
    minScore: number;
    numbered: boolean;
    compare: boolean;
    evalGen: boolean;
    model: string;
    store: string;
    prov: string;
    clean: {
      headers: boolean;
      hyphen: boolean;
      wraps: boolean;
      spaces: boolean;
    };
    inrPerUsd: number;
  };
  sample: {
    doc: string;
    docName: string;
    tests: BuildRagTest[];
    template: string;
    questions: string[];
  };
  stages: { id: string; name: string; what: string }[];
  embedders: Record<string, { name: string; long?: string; about?: string; hf?: string }>;
  cleanDefaults: {
    headers: boolean;
    hyphen: boolean;
    wraps: boolean;
    spaces: boolean;
  };
  chunkModes: string[];
  embedModels: string[];
}

export interface BuildRagCleanResult {
  text: string;
  removed: string[];
  counts: Record<string, number>;
}

export interface BuildRagChunkResult {
  chunks: string[];
  mode: string;
  size: number;
  overlap: number;
  count: number;
}

export interface BuildRagEmbedResult {
  kind: string;
  dims: number;
  vecs: number[][];
  map: { pts: number[][]; mean?: number[]; dirs?: number[][] } | null;
  ms: number;
  chunkCount: number;
  vocabSize?: number;
}

export interface BuildRagRetrieveResult {
  ranked: { i: number; s: number }[];
  kept: number[];
  k: number;
  minScore: number;
  kind: string;
  dims: number;
  qpt: number[] | null;
  ms: number;
  query: string;
}

export interface BuildRagGenerateResult {
  text: string;
  answer?: string;
  model?: string;
  modelId?: string;
  name?: string;
  vendor?: string;
  temp: number;
  topp: number;
  cap: number;
  inTok: number;
  outTok: number;
  tok?: number;
  sentEst?: number;
  ms: number;
  stop?: string;
  simulated: boolean;
  ids: number[];
  kept: number[];
  prompt: string;
  bare: { text: string; inTok?: number; outTok?: number; ms?: number; tok?: number; simulated?: boolean } | null;
  hits?: unknown[];
  ranked?: { i: number; s: number }[];
  kind?: string;
  dims?: number;
  chunkCount?: number;
  embedModel?: string;
  k?: number;
  minScore?: number;
  numbered?: boolean;
}

export interface BuildRagEvalRow {
  q: string;
  expect: string;
  source: string;
  ids?: number[];
  hit?: boolean | null;
  answer?: string;
  ok?: boolean | null;
  simulated?: boolean;
  error?: string;
}

export interface BuildRagEvaluateResult {
  rows: BuildRagEvalRow[];
  gen: boolean;
  summary: {
    tests: number;
    retrievalHits: number;
    retrievalFound: number;
    genOk: number;
    genTotal: number;
  };
  kind?: string;
  dims?: number;
  chunkCount?: number;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/build-rag`;
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

export function loadBuildRagCatalog(sessionId: string, projectId: string): Promise<BuildRagCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function runBuildRagClean(
  sessionId: string,
  projectId: string,
  body: {
    document: string;
    headers?: boolean;
    hyphen?: boolean;
    wraps?: boolean;
    spaces?: boolean;
  },
  signal?: AbortSignal,
): Promise<BuildRagCleanResult> {
  return send(`${base(sessionId, projectId)}/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function runBuildRagChunk(
  sessionId: string,
  projectId: string,
  body: {
    document?: string;
    text?: string;
    mode?: string;
    size?: number;
    overlap?: number;
  },
  signal?: AbortSignal,
): Promise<BuildRagChunkResult> {
  return send(`${base(sessionId, projectId)}/chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: body.document ?? '',
      text: body.text ?? '',
      mode: body.mode ?? 'sentences',
      size: Math.round(Number(body.size) || 60),
      overlap: Math.round(Number(body.overlap) || 10),
    }),
    signal,
  });
}

export function runBuildRagEmbed(
  sessionId: string,
  projectId: string,
  body: { chunks: string[]; model: string },
  signal?: AbortSignal,
): Promise<BuildRagEmbedResult> {
  return send(`${base(sessionId, projectId)}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunks: body.chunks,
      model: body.model || 'minilm',
    }),
    signal,
  });
}

export function runBuildRagRetrieve(
  sessionId: string,
  projectId: string,
  body: {
    chunks: string[];
    query: string;
    model: string;
    k: number;
    minScore: number;
    vecs?: number[][];
  },
  signal?: AbortSignal,
): Promise<BuildRagRetrieveResult> {
  return send(`${base(sessionId, projectId)}/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chunks: body.chunks,
      query: body.query,
      model: body.model || 'minilm',
      k: Math.round(Number(body.k) || 3),
      minScore: Math.round(Number(body.minScore) * 100) / 100,
      vecs: body.vecs,
    }),
    signal,
  });
}

export function runBuildRagGenerate(
  sessionId: string,
  projectId: string,
  body: {
    question: string;
    document?: string;
    chunks?: string[];
    headers?: boolean;
    hyphen?: boolean;
    wraps?: boolean;
    spaces?: boolean;
    mode?: string;
    size?: number;
    overlap?: number;
    embedModel?: string;
    model?: string;
    k?: number;
    minScore?: number;
    template?: string;
    numbered?: boolean;
    compare?: boolean;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<BuildRagGenerateResult> {
  return send(`${base(sessionId, projectId)}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: body.question,
      document: body.document ?? '',
      chunks: body.chunks,
      headers: body.headers !== false,
      hyphen: body.hyphen !== false,
      wraps: body.wraps !== false,
      spaces: body.spaces !== false,
      mode: body.mode ?? 'sentences',
      size: Math.round(Number(body.size) || 60),
      overlap: Math.round(Number(body.overlap) || 10),
      embedModel: body.embedModel ?? 'minilm',
      model: body.model,
      k: Math.round(Number(body.k) || 3),
      minScore: Math.round(Number(body.minScore) * 100) / 100,
      template: body.template,
      numbered: body.numbered !== false,
      compare: Boolean(body.compare),
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 400),
    }),
    signal,
  });
}

export function runBuildRagEvaluate(
  sessionId: string,
  projectId: string,
  body: {
    document?: string;
    chunks?: string[];
    headers?: boolean;
    hyphen?: boolean;
    wraps?: boolean;
    spaces?: boolean;
    mode?: string;
    size?: number;
    overlap?: number;
    embedModel?: string;
    model?: string;
    k?: number;
    minScore?: number;
    template?: string;
    numbered?: boolean;
    tests: BuildRagTest[];
    evalGen?: boolean;
    temp: number;
    topp: number;
    cap: number;
  },
  signal?: AbortSignal,
): Promise<BuildRagEvaluateResult> {
  return send(`${base(sessionId, projectId)}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: body.document ?? '',
      chunks: body.chunks,
      headers: body.headers !== false,
      hyphen: body.hyphen !== false,
      wraps: body.wraps !== false,
      spaces: body.spaces !== false,
      mode: body.mode ?? 'sentences',
      size: Math.round(Number(body.size) || 60),
      overlap: Math.round(Number(body.overlap) || 10),
      embedModel: body.embedModel ?? 'minilm',
      model: body.model,
      k: Math.round(Number(body.k) || 3),
      minScore: Math.round(Number(body.minScore) * 100) / 100,
      template: body.template,
      numbered: body.numbered !== false,
      tests: body.tests,
      evalGen: body.evalGen !== false,
      temp: Math.round(Number(body.temp) * 100) / 100,
      topp: Math.round(Number(body.topp) * 100) / 100,
      cap: Math.round(Number(body.cap) || 400),
    }),
    signal,
  });
}
