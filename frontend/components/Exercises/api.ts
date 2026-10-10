import config from '../../lib/config';
import type {
  EmbedResult,
  ExercisesWorkspaceState,
  GenerateResult,
  TfidfDatasetInfo,
  TfidfDatasetPayload,
  TfidfPredictResult,
  TfidfReviewRow,
  TfidfTrainConfig,
  TfidfTrainResult,
} from './types';
import { DEFAULT_TFIDF_TRAIN_CONFIG } from './types';
import { serializeEx2Result } from './ex2Result';

const DEFAULT_TIMEOUT_MS = 20000;
const GENERATE_TIMEOUT_MS = 45000;

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d: { msg?: string }) => d.msg || '').join(' ');
    return body.message || res.statusText;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? 2;
  let lastError: Error = new Error('Request failed');
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`Server error ${res.status}`);
        await wait(300 * (attempt + 1));
        continue;
      }
      return res;
    } catch (error) {
      clearTimeout(timer);
      const err = error instanceof Error ? error : new Error('Network error');
      lastError = err.name === 'AbortError' ? new Error('Request timed out. Try again.') : err;
      if (attempt < retries) {
        await wait(300 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastError;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadExercisesWorkspace(
  sessionId: string,
  projectId: string,
): Promise<ExercisesWorkspaceState | null> {
  try {
    const res = await fetchWithRetry(
      `${config.apiBaseUrl}${config.api.exercises.workspace(sessionId, projectId)}`,
      { method: 'GET' },
      { timeoutMs: 8000, retries: 1 },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.state ?? null;
  } catch {
    return null;
  }
}

export async function saveExercisesWorkspace(
  sessionId: string,
  projectId: string,
  state: ExercisesWorkspaceState,
): Promise<boolean> {
  try {
    const res = await fetchWithRetry(
      `${config.apiBaseUrl}${config.api.exercises.workspace(sessionId, projectId)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: {
            ...state,
            ex2Result: state.ex2Result ? serializeEx2Result(state.ex2Result) : state.ex2Result ?? null,
          },
        }),
      },
      { timeoutMs: 8000, retries: 1 },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function resetExercisesWorkspace(
  sessionId: string,
  projectId: string,
): Promise<ExercisesWorkspaceState | null> {
  try {
    const res = await fetchWithRetry(
      `${config.apiBaseUrl}${config.api.exercises.resetWorkspace(sessionId, projectId)}`,
      { method: 'POST' },
      { timeoutMs: 8000, retries: 1 },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.state ?? null;
  } catch {
    return null;
  }
}

export async function generateLab(
  sessionId: string,
  projectId: string,
  payload: {
    prompt: string;
    system?: string;
    examples?: { user: string; assistant: string }[];
    model?: string;
    temperature?: number;
    n?: number;
    max_tokens?: number;
  },
): Promise<GenerateResult> {
  const res = await fetchWithRetry(
    `${config.apiBaseUrl}${config.api.exercises.generate(sessionId, projectId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { timeoutMs: GENERATE_TIMEOUT_MS, retries: 1 },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const body = await res.json();
  if (!Array.isArray(body.outputs) || body.outputs.length === 0) {
    throw new Error('Model returned no outputs.');
  }
  return body;
}

export async function embedLab(
  sessionId: string,
  projectId: string,
  texts: string[],
  model: string,
): Promise<EmbedResult> {
  const cleaned = texts.map((t) => t.trim()).filter(Boolean).slice(0, 12);
  if (cleaned.length === 0) {
    throw new Error('No phrases to embed.');
  }
  const res = await fetchWithRetry(
    `${config.apiBaseUrl}${config.api.exercises.embed(sessionId, projectId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: cleaned, model }),
    },
    { timeoutMs: 60000, retries: 1 },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const body = await res.json();
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== cleaned.length) {
    throw new Error('Embedding count did not match the phrases.');
  }
  return body;
}

export async function listTfidfDatasets(
  sessionId: string,
  projectId: string,
): Promise<TfidfDatasetInfo[]> {
  const res = await fetchWithRetry(
    `${config.apiBaseUrl}${config.api.exercises.tfidfDatasets(sessionId, projectId)}`,
    { method: 'GET' },
    { timeoutMs: 12000, retries: 1 },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const body = await res.json();
  return Array.isArray(body?.datasets) ? body.datasets : [];
}

export async function loadTfidfDataset(
  sessionId: string,
  projectId: string,
  datasetId: string,
  options: { offset?: number; limit?: number; full?: boolean; inspect?: boolean } = {},
): Promise<TfidfDatasetPayload> {
  const params = new URLSearchParams();
  if (options.full) {
    params.set('full', 'true');
  } else {
    params.set('offset', String(Math.max(0, options.offset ?? 0)));
    params.set('limit', String(Math.max(1, options.limit ?? 4)));
  }
  if (options.inspect) params.set('inspect', 'true');
  const query = params.toString();
  const res = await fetchWithRetry(
    `${config.apiBaseUrl}${config.api.exercises.tfidfDataset(sessionId, projectId, datasetId)}${query ? `?${query}` : ''}`,
    { method: 'GET' },
    { timeoutMs: options.full ? 90000 : options.inspect ? 30000 : 12000, retries: 1 },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const body = await res.json();
  if (!Array.isArray(body?.rows)) {
    throw new Error('That department file does not have enough labeled texts.');
  }
  return body;
}

export async function trainTfidfLab(
  sessionId: string,
  projectId: string,
  rows: TfidfReviewRow[],
  trainConfig: TfidfTrainConfig = DEFAULT_TFIDF_TRAIN_CONFIG,
  datasetId?: string,
): Promise<TfidfTrainResult> {
  const res = await fetchWithRetry(
    `${config.apiBaseUrl}${config.api.exercises.tfidfTrain(sessionId, projectId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: datasetId ? [] : rows,
        dataset_id: datasetId || undefined,
        test_size: trainConfig.test_size,
        seed: trainConfig.seed,
        max_features: trainConfig.max_features,
        ngram_min: trainConfig.ngram_min,
        ngram_max: trainConfig.ngram_max,
        min_df: trainConfig.min_df,
        regularization_c: trainConfig.regularization_c,
        solver: trainConfig.solver,
        max_iter: trainConfig.max_iter,
        epochs: trainConfig.epochs,
        threshold: trainConfig.threshold,
        representation: trainConfig.representation || 'tfidf',
        text_prep: trainConfig.textPrep
          ? {
              drop_missing: trainConfig.textPrep.dropMissing,
              drop_duplicates: trainConfig.textPrep.dropDuplicates,
              lowercase: trainConfig.textPrep.lowercase,
              strip_noise: trainConfig.textPrep.stripNoise,
              stopwords: trainConfig.textPrep.stopwords,
              lemmatize: trainConfig.textPrep.lemmatize,
            }
          : undefined,
      }),
    },
    { timeoutMs: 180000, retries: 0 },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const body = await res.json();
  if (!body?.model?.vocab?.length) {
    throw new Error('Training returned an empty model.');
  }
  return body;
}

export async function predictTfidfLab(
  sessionId: string,
  projectId: string,
  text: string,
): Promise<TfidfPredictResult> {
  const res = await fetchWithRetry(
    `${config.apiBaseUrl}${config.api.exercises.tfidfPredict(sessionId, projectId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
    { timeoutMs: 12000, retries: 0 },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return res.json();
}
