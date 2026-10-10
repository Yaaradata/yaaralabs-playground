import config from '../../../../../lib/config';

export type EncId = 'o200k' | 'cl100k' | 'gpt2';

export interface TokeniserModel {
  id: string;
  name: string;
  short: string;
  enc: EncId;
  pin: number;
  pout: number;
  est?: boolean;
  legacy?: boolean;
  versions?: { id: string; label: string }[];
  defaultVersion?: string;
}

export interface TokeniserLang {
  id: string;
  name: string;
  prompt: string;
  c: string;
}

export interface TokeniserDept {
  name: string;
  question: string;
}

export interface TokeniserCatalog {
  models: TokeniserModel[];
  encodings: Record<string, { label: string; short: string }>;
  langs: TokeniserLang[];
  depts: TokeniserDept[];
  ref: Record<string, string>;
  lengths: number[];
  defaults: {
    models: string[];
    langs: string[];
    words: number;
    inr: number;
    question: string;
  };
}

export interface TokenSegment {
  text: string;
  ids: number[];
}

export interface TokeniseResult {
  enc: string;
  count: number;
  segments: TokenSegment[];
  simulated?: boolean;
}

export interface AnswerResult {
  lang: string;
  text: string;
  prompt: string;
  model: string;
  simulated: boolean;
  words: number;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/tokeniser`;
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

export function loadTokeniserCatalog(sessionId: string, projectId: string): Promise<TokeniserCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function loadRefTpw(sessionId: string, projectId: string): Promise<{ tpw: Record<string, Record<string, number>> }> {
  return send(`${base(sessionId, projectId)}/ref-tpw`);
}

export function tokeniseTexts(
  sessionId: string,
  projectId: string,
  items: { enc: string; text: string }[],
  segments = false,
): Promise<{ results: TokeniseResult[] }> {
  return send(`${base(sessionId, projectId)}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, segments }),
  });
}

export function generateLanguageAnswer(
  sessionId: string,
  projectId: string,
  body: { question: string; lang: string; words: number; model?: string },
  signal?: AbortSignal,
): Promise<AnswerResult> {
  return send(`${base(sessionId, projectId)}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
