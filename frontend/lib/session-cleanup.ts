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
  console.log(`🧹 Cleaning up session. Reason: ${reason}`);
  await cleanupSession(sessionId);
};

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
