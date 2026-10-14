/** Saving the Copilot labs' answers (ticks, choices, short notes only: never Copilot's output). */
import config from '../../lib/config';
import type { ActivityId, Answers, LabState } from './types';

const url = (sessionId: string, projectId: string) => `${config.apiBaseUrl}${config.api.copilotLab.project(sessionId, projectId)}`;

async function fail(res: Response): Promise<never> {
  let detail = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') detail = body.detail;
  } catch {
    /* not JSON */
  }
  throw new Error(detail);
}

export async function loadLab(sessionId: string, projectId: string): Promise<LabState> {
  const res = await fetch(url(sessionId, projectId));
  if (!res.ok) return fail(res);
  return (await res.json()).data as LabState;
}

export async function saveLab(sessionId: string, projectId: string, answers: Answers, completedSteps: string[]): Promise<LabState> {
  const res = await fetch(url(sessionId, projectId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, completedSteps }),
    keepalive: true, // also used when leaving the page
  });
  if (!res.ok) return fail(res);
  return (await res.json()).data as LabState;
}

export async function clearLab(sessionId: string, projectId: string): Promise<void> {
  const res = await fetch(url(sessionId, projectId), { method: 'DELETE' });
  if (!res.ok) return fail(res);
}

/** Fallback when the backend can't be reached: answers stay in this browser until the next save works. */
const localKey = (projectId: string) => `copilot-lab:${projectId}`;

export function readLocal(projectId: string): { activity: ActivityId; answers: Answers } | null {
  try {
    const raw = localStorage.getItem(localKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeLocal(projectId: string, activity: ActivityId, answers: Answers): void {
  try {
    localStorage.setItem(localKey(projectId), JSON.stringify({ activity, answers }));
  } catch {
    /* storage unavailable */
  }
}

export function clearLocal(projectId: string): void {
  try {
    localStorage.removeItem(localKey(projectId));
  } catch {
    /* storage unavailable */
  }
}
