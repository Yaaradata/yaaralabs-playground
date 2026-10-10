const PREFIX = 'np-ex-concept-seen';

function key(sessionId: string, projectId: string, exerciseId: number) {
  return `${PREFIX}:${sessionId}:${projectId}:${exerciseId}`;
}

export function markIntroSeen(sessionId: string, projectId: string, exerciseId: number) {
  if (!sessionId || !projectId) return;
  try {
    window.localStorage.setItem(key(sessionId, projectId, exerciseId), '1');
  } catch {
    return;
  }
}

export function clearIntroSeen(sessionId: string, projectId: string, exerciseId: number) {
  if (!sessionId || !projectId) return;
  try {
    window.localStorage.removeItem(key(sessionId, projectId, exerciseId));
  } catch {
    return;
  }
}

export function hasIntroSeen(sessionId: string, projectId: string, exerciseId: number) {
  if (!sessionId || !projectId) return false;
  try {
    return window.localStorage.getItem(key(sessionId, projectId, exerciseId)) === '1';
  } catch {
    return false;
  }
}
