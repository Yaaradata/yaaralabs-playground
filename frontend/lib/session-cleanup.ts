import config from './config';

/**
 * Clean up masked ID mappings for a specific session
 */
function cleanupMaskedIdMappingsForSession(sessionId: string): void {
  try {
    const keys = Object.keys(localStorage);
    let cleanedCount = 0;
    
    keys.forEach(key => {
      if (key.startsWith('yaaralabs_masked_') || key.startsWith('yaaralabs_project_')) {
        const value = localStorage.getItem(key);
        if (value === sessionId || (key.startsWith('yaaralabs_masked_') && value === sessionId)) {
          localStorage.removeItem(key);
          cleanedCount++;
        }
      }
    });
    
    // Also remove current masked ID reference
    localStorage.removeItem('yaaralabs_current_masked_id');
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} masked ID mappings`);
    }
  } catch (error) {
    console.error('Error cleaning up masked ID mappings:', error);
  }
}

/**
 * Utility function to delete a guest session from the backend
 * @param sessionId - The session ID to delete
 * @returns Promise<boolean> - True if successful, false otherwise
 */
export const deleteSessionFromBackend = async (sessionId: string): Promise<boolean> => {
  try {
    console.log('🗑️ Deleting session from backend:', sessionId.substring(0, 8) + '...');
    
    const response = await fetch(`${config.apiBaseUrl}${config.api.guests.deleteSession(sessionId)}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      console.log('✅ Session successfully deleted from backend');
      return true;
    } else {
      console.log('⚠️ Failed to delete session from backend:', response.status);
      
      // Log error details if available
      try {
        const errorText = await response.text();
        console.log('Delete error details:', errorText);
      } catch {
        console.log('Could not read delete error response');
      }
      
      return false;
    }
  } catch (error) {
    console.error('❌ Error deleting session from backend:', error);
    return false;
  }
};

/**
 * Comprehensive session cleanup - removes from backend and localStorage
 * @param sessionId - Optional session ID, will get from localStorage if not provided
 * @returns Promise<void>
 */
export const cleanupSession = async (sessionId?: string): Promise<void> => {
  const currentSessionId = sessionId || localStorage.getItem('yaaralabs_playground_session_id');
  
  if (currentSessionId) {
    // Delete from backend first (don't block on success/failure)
    await deleteSessionFromBackend(currentSessionId);
  }

  // Always clean up localStorage regardless of backend success
  localStorage.removeItem('yaaralabs_playground_session_id');
  localStorage.removeItem('yaaralabs_playground_session_created');
  localStorage.removeItem('yaaralabs_playground_session_expires');
  localStorage.removeItem('yaaralabs_playground_session_last_activity');
  
  // Clean up masked ID mappings for this session
  if (currentSessionId) {
    cleanupMaskedIdMappingsForSession(currentSessionId);
  }
  
  console.log('🧹 Session cleanup complete');
};

/**
 * Check if localStorage appears to have been cleared
 * This can help detect when users clear their browser data
 */
export const detectStorageCleared = (): boolean => {
  // Check if other expected localStorage items are missing
  // This is a heuristic - not 100% reliable but can help detect clearing
  try {
    const hasSessionId = !!localStorage.getItem('yaaralabs_playground_session_id');
    const hasCreatedTime = !!localStorage.getItem('yaaralabs_playground_session_created');
    
    // If we had a session before but now localStorage is completely empty,
    // it might have been cleared
    return !hasSessionId && !hasCreatedTime && localStorage.length === 0;
  } catch {
    // localStorage might not be available
    return false;
  }
};

/**
 * Session cleanup reasons for logging and debugging
 */
export enum SessionCleanupReason {
  EXPIRED_7_DAYS = 'expired_7_days',
  EXPIRED_BACKEND = 'expired_backend', 
  INACTIVE_BACKEND = 'inactive_backend',
  NOT_FOUND_BACKEND = 'not_found_backend',
  STORAGE_CLEARED = 'storage_cleared',
  MANUAL_LOGOUT = 'manual_logout',
  ERROR_FALLBACK = 'error_fallback'
}

/**
 * Enhanced cleanup with reason tracking
 */
export const cleanupSessionWithReason = async (
  reason: SessionCleanupReason, 
  sessionId?: string
): Promise<void> => {
  // "Could not check the session" (server restarting, network blip, a 5xx) is not "the session is
  // gone": deleting it here wiped every project of a learner who opened a page at the wrong moment.
  // Keep everything; the page sends the learner back to /projects and they can carry on.
  if (reason === SessionCleanupReason.ERROR_FALLBACK) {
    console.warn('⚠️ Could not check the session; keeping it (no cleanup).');
    return;
  }
  console.log(`🧹 Cleaning up session. Reason: ${reason}`);
  await cleanupSession(sessionId);
};

/* ───────── checking the session (one place for every page) ───────── */

interface GuestSessionBody {
  success?: boolean;
  data?: { active?: boolean; expiresAt?: string } | null;
}

/**
 * What a session check found:
 *   valid    the backend has the session and it is active and not expired
 *   gone     the backend says it really is gone: 404, or a 200 that says inactive / expired
 *   unknown  we could not tell (5xx, 429, a timeout, a network error, an unreadable body):
 *            keep the session and every project in it
 */
export type SessionCheck<R> =
  | { kind: 'valid'; response: R }
  | { kind: 'gone'; reason: SessionCleanupReason; detail: string }
  | { kind: 'unknown'; detail: string };

/** Classify a session check from its HTTP status (null = the request itself failed) and parsed body. */
export function classifySessionCheck<R extends GuestSessionBody>(
  status: number | null,
  body: R | null,
  now: Date = new Date(),
): SessionCheck<R> {
  if (status === null) return { kind: 'unknown', detail: 'the request failed (network)' };
  if (status === 404) return { kind: 'gone', reason: SessionCleanupReason.NOT_FOUND_BACKEND, detail: 'not found (404)' };
  if (status < 200 || status >= 300) return { kind: 'unknown', detail: `the server answered ${status}` };
  if (!body || body.success !== true || !body.data) return { kind: 'unknown', detail: 'unreadable session response' };
  if (!body.data.active) return { kind: 'gone', reason: SessionCleanupReason.INACTIVE_BACKEND, detail: 'inactive' };
  const expires = new Date(body.data.expiresAt ?? '');
  if (Number.isNaN(expires.getTime())) return { kind: 'unknown', detail: 'session has no expiry date' };
  if (now >= expires) return { kind: 'gone', reason: SessionCleanupReason.EXPIRED_BACKEND, detail: 'expired' };
  return { kind: 'valid', response: body };
}

/** GET the session from the backend and classify it. Never throws. */
export async function checkGuestSession<R extends GuestSessionBody>(sessionId: string): Promise<SessionCheck<R>> {
  let res: Response;
  try {
    res = await fetch(`${config.apiBaseUrl}${config.api.guests.sessionById(sessionId)}`);
  } catch {
    return classifySessionCheck<R>(null, null);
  }
  const body = res.ok ? ((await res.json().catch(() => null)) as R | null) : null;
  return classifySessionCheck<R>(res.status, body);
}

/**
 * After a check that wasn't valid: clean up only when the session is really gone, then go back to
 * /projects. "Unknown" keeps everything (ERROR_FALLBACK), so a slow or restarting server can't wipe
 * a learner's projects.
 */
export async function leaveAfterFailedCheck(check: Exclude<SessionCheck<unknown>, { kind: 'valid' }>): Promise<void> {
  if (check.kind === 'gone') {
    console.error(`Session ${check.detail}`);
    await cleanupSessionWithReason(check.reason);
  } else {
    console.warn(`Could not check the session (${check.detail}); keeping it.`);
    await cleanupSessionWithReason(SessionCleanupReason.ERROR_FALLBACK);
  }
  window.location.href = '/projects';
}

/**
 * Update session activity timestamp to extend the 7-day window
 */
export const updateSessionActivity = (): void => {
  const sessionId = localStorage.getItem('yaaralabs_playground_session_id');
  if (sessionId) {
    const now = Date.now();
    localStorage.setItem('yaaralabs_playground_session_last_activity', now.toString());
    console.log('⏰ Updated session activity timestamp');
  }
};

/**
 * Check if current session is within the 7-day active window
 */
export const isSessionWithinActiveWindow = (): boolean => {
  const sessionExpiresAt = localStorage.getItem('yaaralabs_playground_session_expires');
  const sessionCreatedAt = localStorage.getItem('yaaralabs_playground_session_created');
  const now = Date.now();
  
  // First check explicit expiry time
  if (sessionExpiresAt) {
    const expiryTime = parseInt(sessionExpiresAt);
    return now <= expiryTime;
  }
  
  // Fallback to creation time check
  if (sessionCreatedAt) {
    const createdTime = parseInt(sessionCreatedAt);
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    return (now - createdTime) < sevenDaysInMs;
  }
  
  return false;
};

/**
 * Manual cleanup function to remove old/orphaned localStorage entries
 * Can be called from browser console: window.cleanupNeuraStorage()
 */
export const cleanupAllNeuraStorage = (): number => {
  try {
    const keys = Object.keys(localStorage);
    let cleanedCount = 0;
    
    keys.forEach(key => {
      if (key.startsWith('yaaralabs_masked_') || 
          key.startsWith('yaaralabs_project_') || 
          key === 'yaaralabs_current_masked_id' ||
          key === 'yaaralabs_playground_session_id' ||
          key === 'yaaralabs_playground_session_created' ||
          key === 'yaaralabs_playground_session_expires' ||
          key === 'yaaralabs_playground_session_last_activity') {
        localStorage.removeItem(key);
        cleanedCount++;
        console.log(`Removed: ${key}`);
      }
    });
    
    console.log(`🧹 Manual cleanup: Removed ${cleanedCount} YaaraLabs Playground storage entries`);
    console.log('🔄 Please refresh the page to start fresh');
    
    return cleanedCount;
  } catch (error) {
    console.error('Error during manual cleanup:', error);
    return 0;
  }
};

// Make cleanup function available globally for manual use
declare global {
  interface Window {
    cleanupNeuraStorage?: () => number;
  }
}

if (typeof window !== 'undefined') {
  window.cleanupNeuraStorage = cleanupAllNeuraStorage;
}
