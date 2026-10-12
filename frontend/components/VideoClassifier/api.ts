/**
 * The project's saved model: uploaded after every training, opened when the project opens.
 * Files go from the browser straight to GCS with the signed URLs the backend returns (or to the
 * backend's proxy when the server cannot sign). Training and preview never need the backend.
 */

import config from '../../lib/config';

export interface SavedModel {
  labels: string[];
  colors: string[];
  accuracy: number | null;
  hasSamples: boolean;
  saved_at: string;
  urls: Record<string, string>;
}

const abs = (url: string) => (url.startsWith('/') ? `${config.apiBaseUrl}${url}` : url);

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let body: { data?: T; detail?: string } = {};
  try {
    body = await r.json();
  } catch {
    /* no body */
  }
  if (!r.ok) throw new Error(body.detail || `Request failed (${r.status})`);
  return body.data as T;
}

export async function openSavedModel(sessionId: string, projectId: string): Promise<SavedModel | null> {
  const m = await call<SavedModel | null>(config.api.imageModels.project(sessionId, projectId));
  if (!m) return null;
  return { ...m, urls: Object.fromEntries(Object.entries(m.urls).map(([k, v]) => [k, abs(v)])) };
}

/** Replace the project's saved model with these files. */
export async function saveModel(
  sessionId: string,
  projectId: string,
  body: { labels: string[]; colors: string[]; accuracy: number | null },
  files: Record<string, Blob>,
): Promise<void> {
  const base = config.api.imageModels.project(sessionId, projectId);
  const started = await call<{ uploadUrls: Record<string, string>; headers: Record<string, Record<string, string>> }>(
    `${base}/save`,
    { method: 'POST', body: JSON.stringify({ ...body, files: Object.keys(files) }) },
  );
  const queue = Object.keys(files);
  const worker = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const r = await fetch(abs(started.uploadUrls[name]), { method: 'PUT', headers: started.headers[name], body: files[name] });
      if (!r.ok) throw new Error(`Could not save ${name} (${r.status}).`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
  await call(`${base}/complete`, { method: 'POST' });
}
