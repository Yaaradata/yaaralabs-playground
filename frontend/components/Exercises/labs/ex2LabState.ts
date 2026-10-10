import type {
  ExerciseId,
  TextPrepConfig,
  TextRepresentation,
  TfidfTrainConfig,
  TfidfTrainResult,
} from '../types';
import { parseTextPrep } from './ex2TextPrep';

export const EX2_LAB_PREFIX = 'np-ex2-lab';

export type Ex2LabSnapshot = {
  v: 1;
  datasetId: string;
  representation: TextRepresentation;
  repChosen: boolean;
  inspectApplied: boolean;
  textPrep: TextPrepConfig | null;
  appliedConfig: TfidfTrainConfig | null;
  draftConfig: Record<string, string> | null;
  setupPreset?: 'quick' | 'balanced' | 'thorough' | null;
  trained: boolean;
  training: boolean;
  reviewText: string;
};

export type Ex2LabBlob = {
  v: 1;
  datasetId?: string;
  trainResult: TfidfTrainResult | null;
};

function labKey(sessionId: string, projectId: string, exerciseId: number) {
  return `${EX2_LAB_PREFIX}:${sessionId}:${projectId}:${exerciseId}`;
}

export function snapshotRank(snapshot: Record<string, unknown> | null | undefined): number {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  if (snapshot.trained === true && snapshot.datasetId) return 4;
  if (snapshot.training === true && snapshot.datasetId) return 3;
  if (snapshot.repChosen === true && snapshot.inspectApplied === true && snapshot.datasetId) return 2;
  if (typeof snapshot.datasetId === 'string' && snapshot.datasetId) return 1;
  return 0;
}

export function canTrainEx2(input: {
  hasData: boolean;
  inspectApplied: boolean;
  repChosen: boolean;
}): boolean {
  return Boolean(input.hasData && input.inspectApplied && input.repChosen);
}

export function parseEx2LabSnapshot(value: unknown): Ex2LabSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Ex2LabSnapshot>;
  if (raw.v !== 1) return null;
  const datasetId = typeof raw.datasetId === 'string' ? raw.datasetId.trim() : '';
  if (!datasetId) return null;
  const representation: TextRepresentation = raw.representation === 'embeddings' ? 'embeddings' : 'tfidf';
  const setupPreset =
    raw.setupPreset === 'quick' || raw.setupPreset === 'balanced' || raw.setupPreset === 'thorough'
      ? raw.setupPreset
      : null;
  return {
    v: 1,
    datasetId,
    representation,
    repChosen: raw.repChosen === true,
    inspectApplied: raw.inspectApplied === true || raw.trained === true,
    textPrep: parseTextPrep(raw.textPrep),
    appliedConfig: isTrainConfig(raw.appliedConfig) ? raw.appliedConfig : null,
    draftConfig:
      raw.draftConfig && typeof raw.draftConfig === 'object' ? { ...raw.draftConfig } : null,
    setupPreset,
    trained: raw.trained === true,
    training: raw.training === true,
    reviewText: typeof raw.reviewText === 'string' ? raw.reviewText : '',
  };
}

/** Keep every class. A prefix of the holdout is one class, because the split is grouped. */
export function sampleTestProbs(rows: TfidfTrainResult['test_probs'], cap: number): TfidfTrainResult['test_probs'] {
  const list = rows || [];
  if (list.length <= cap) return list;
  const groups = new Map<number, typeof list>();
  list.forEach((row) => {
    const bucket = groups.get(row.y);
    if (bucket) bucket.push(row);
    else groups.set(row.y, [row]);
  });
  const keys = [...groups.keys()];
  const per = Math.max(1, Math.floor(cap / Math.max(1, keys.length)));
  const picked: typeof list = [];
  keys.forEach((key) => {
    const bucket = groups.get(key) || [];
    if (bucket.length <= per) {
      picked.push(...bucket);
      return;
    }
    const step = bucket.length / per;
    for (let i = 0; i < per; i += 1) {
      picked.push(bucket[Math.min(bucket.length - 1, Math.round(i * step))]);
    }
  });
  return picked.slice(0, cap);
}

export function compactTrainResult(result: TfidfTrainResult): TfidfTrainResult {
  const curve = (result.curve || []).map((point, index, all) =>
    index === all.length - 1
      ? point
      : { ...point, pos_words: [], neg_words: [], class_words: [] },
  );
  return {
    ...result,
    test_probs: sampleTestProbs(result.test_probs, 4000),
    word_weights: (result.word_weights || []).slice(0, 24),
    curve,
  };
}

export function readEx2LabBlob(
  sessionId: string,
  projectId: string,
  exerciseId: number,
): Ex2LabBlob | null {
  if (typeof window === 'undefined' || !sessionId || !projectId) return null;
  try {
    const raw = window.localStorage.getItem(labKey(sessionId, projectId, exerciseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Ex2LabBlob>;
    if (parsed?.v !== 1) return null;
    const trainResult = isTrainResult(parsed.trainResult) ? parsed.trainResult : null;
    const datasetId = typeof parsed.datasetId === 'string' ? parsed.datasetId : '';
    return { v: 1, datasetId, trainResult };
  } catch {
    return null;
  }
}

export function writeEx2LabBlob(
  sessionId: string,
  projectId: string,
  exerciseId: number,
  blob: Ex2LabBlob,
): void {
  if (typeof window === 'undefined' || !sessionId || !projectId) return;
  try {
    window.localStorage.setItem(labKey(sessionId, projectId, exerciseId), JSON.stringify(blob));
  } catch {
    try {
      const slim: Ex2LabBlob = {
        v: 1,
        datasetId: blob.datasetId,
        trainResult: blob.trainResult
          ? {
              ...blob.trainResult,
              curve: blob.trainResult.curve?.slice(-8) || [],
              word_weights: (blob.trainResult.word_weights || []).slice(0, 16),
              test_probs: sampleTestProbs(blob.trainResult.test_probs, 800),
            }
          : null,
      };
      window.localStorage.setItem(labKey(sessionId, projectId, exerciseId), JSON.stringify(slim));
    } catch {
      return;
    }
  }
}

export function clearEx2LabState(sessionId: string, projectId: string, exerciseId?: number): void {
  if (typeof window === 'undefined') return;
  try {
    if (exerciseId) {
      window.localStorage.removeItem(labKey(sessionId, projectId, exerciseId));
      return;
    }
    const needle = `${EX2_LAB_PREFIX}:${sessionId}:${projectId}:`;
    Object.keys(window.localStorage).forEach((key) => {
      if (key.startsWith(needle)) window.localStorage.removeItem(key);
    });
  } catch {
    return;
  }
}

export function parseActiveId(value: unknown): ExerciseId | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const allowed: ExerciseId[] = [1, 2, 3, 4, 4.5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  return allowed.includes(n as ExerciseId) ? (n as ExerciseId) : null;
}

const RESUME_COOKIE = 'np_ex_resume';

export function writeResumeCookie(sessionId: string, projectId: string, activeId: ExerciseId | null): void {
  if (typeof document === 'undefined') return;
  try {
    const token = encodeURIComponent(`${sessionId}|${projectId}|${activeId ?? ''}`);
    document.cookie = `${RESUME_COOKIE}=${token}; path=/; max-age=${60 * 60 * 24 * 14}; SameSite=Lax`;
  } catch {
    return;
  }
}

export function readResumeCookie(
  sessionId: string,
  projectId: string,
): ExerciseId | null {
  if (typeof document === 'undefined') return null;
  try {
    const match = document.cookie.split('; ').find((row) => row.startsWith(`${RESUME_COOKIE}=`));
    if (!match) return null;
    const raw = decodeURIComponent(match.slice(`${RESUME_COOKIE}=`.length));
    const [sid, pid, id] = raw.split('|');
    if (sid !== sessionId || pid !== projectId) return null;
    return parseActiveId(id);
  } catch {
    return null;
  }
}

export function clearResumeCookie(): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${RESUME_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    return;
  }
}

function isTrainConfig(value: unknown): value is TfidfTrainConfig {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Partial<TfidfTrainConfig>;
  return (
    Number.isFinite(raw.test_size) &&
    Number.isFinite(raw.seed) &&
    Number.isFinite(raw.max_features) &&
    Number.isFinite(raw.ngram_min) &&
    Number.isFinite(raw.ngram_max) &&
    Number.isFinite(raw.min_df) &&
    Number.isFinite(raw.regularization_c) &&
    Number.isFinite(raw.max_iter) &&
    Number.isFinite(raw.epochs) &&
    Number.isFinite(raw.threshold)
  );
}

function isTrainResult(value: unknown): value is TfidfTrainResult {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Partial<TfidfTrainResult>;
  return Boolean(raw.model && Array.isArray(raw.model.vocab) && raw.model.vocab.length);
}
