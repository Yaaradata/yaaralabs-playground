// Utility functions for session ID masking and management

/**
 * Generate a short, user-friendly ID from a session ID
 * Uses the last 8 characters and converts to a more readable format
 */
export function generateMaskedId(sessionId: string): string {
  // Take last 8 characters and convert to base36 for shorter representation
  const suffix = sessionId.slice(-12);
  const hash = suffix.replace(/[^a-zA-Z0-9]/g, '');
  return hash.slice(-8).toLowerCase();
}

/**
 * Store the mapping between masked ID and real session ID
 * Only stores if mapping doesn't already exist to prevent duplicates
 */
export function storeMaskedIdMapping(maskedId: string, sessionId: string): void {
  try {
    const existingMapping = localStorage.getItem(`yaaralabs_masked_${maskedId}`);
    if (!existingMapping || existingMapping !== sessionId) {
      localStorage.setItem(`yaaralabs_masked_${maskedId}`, sessionId);
      localStorage.setItem('yaaralabs_current_masked_id', maskedId);
      console.log('🔗 Stored new masked ID mapping:', maskedId);
    } else {
      console.log('🔗 Masked ID mapping already exists:', maskedId);
    }
  } catch (error) {
    console.error('Error storing masked ID mapping:', error);
  }
}

/**
 * Retrieve the real session ID from a masked ID
 */
export function getSessionIdFromMaskedId(maskedId: string): string | null {
  try {
    return localStorage.getItem(`yaaralabs_masked_${maskedId}`);
  } catch (error) {
    console.error('Error retrieving session ID from masked ID:', error);
    return null;
  }
}

/**
 * Get the current masked ID
 */
export function getCurrentMaskedId(): string | null {
  try {
    return localStorage.getItem('yaaralabs_current_masked_id');
  } catch (error) {
    console.error('Error getting current masked ID:', error);
    return null;
  }
}

/**
 * Find existing masked ID for a session ID
 * Returns existing masked ID if found, null otherwise
 */
export function findExistingMaskedId(sessionId: string): string | null {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith('yaaralabs_masked_') && localStorage.getItem(key) === sessionId) {
        const maskedId = key.replace('yaaralabs_masked_', '');
        console.log('🔍 Found existing masked ID for session:', maskedId);
        return maskedId;
      }
    }
    return null;
  } catch (error) {
    console.error('Error finding existing masked ID:', error);
    return null;
  }
}

/**
 * Get or create masked ID for a session
 * Reuses existing mapping if available, creates new one if not
 */
export function getOrCreateMaskedId(sessionId: string): string {
  // First check if we already have a masked ID for this session
  const existingMaskedId = findExistingMaskedId(sessionId);
  if (existingMaskedId) {
    // Update current masked ID to this one
    localStorage.setItem('yaaralabs_current_masked_id', existingMaskedId);
    return existingMaskedId;
  }

  // Generate new masked ID if none exists
  const newMaskedId = generateMaskedId(sessionId);
  storeMaskedIdMapping(newMaskedId, sessionId);
  return newMaskedId;
}

/**
 * Clean up old masked ID mappings (optional, for cleanup)
 */
export function cleanupMaskedIdMappings(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('yaaralabs_masked_') && key !== `yaaralabs_masked_${getCurrentMaskedId()}`) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('Error cleaning up masked ID mappings:', error);
  }
}

/**
 * Check if a string looks like a masked ID (8 chars, alphanumeric)
 */
export function isMaskedId(id: string): boolean {
  return /^[a-z0-9]{8}$/.test(id);
}

/**
 * Check if a string looks like a full session ID
 */
export function isSessionId(id: string): boolean {
  return id.startsWith('session_') && id.length > 20;
}

// Project ID masking functions
/**
 * Generate a short, user-friendly ID from a project ID
 */
export function generateMaskedProjectId(projectId: string): string {
  // Take last 8 characters and convert to a more readable format
  const suffix = projectId.slice(-12);
  const hash = suffix.replace(/[^a-zA-Z0-9]/g, '');
  return `p${hash.slice(-7).toLowerCase()}`;
}

/**
 * Store the mapping between masked project ID and real project ID
 */
export function storeMaskedProjectIdMapping(maskedProjectId: string, projectId: string): void {
  try {
    localStorage.setItem(`yaaralabs_project_${maskedProjectId}`, projectId);
  } catch (error) {
    console.error('Error storing masked project ID mapping:', error);
  }
}

/**
 * Retrieve the real project ID from a masked project ID
 */
export function getProjectIdFromMaskedId(maskedProjectId: string): string | null {
  try {
    return localStorage.getItem(`yaaralabs_project_${maskedProjectId}`);
  } catch (error) {
    console.error('Error retrieving project ID from masked ID:', error);
    return null;
  }
}

/**
 * Check if a string looks like a masked project ID (starts with 'p' + 7 chars)
 */
export function isMaskedProjectId(id: string): boolean {
  return /^p[a-z0-9]{7}$/.test(id);
}

/**
 * Check if a string looks like a full project ID
 */
export function isProjectId(id: string): boolean {
  // Older ids contain "project"; current ones are plain UUIDs (e.g. links the Use the AI page used to write)
  return (id.length > 10 && (id.includes('project') || id.includes('proj'))) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Clean up old project ID mappings for a specific session
 */
export function cleanupProjectIdMappings(): void {
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('yaaralabs_project_')) {
        // Keep only recent mappings (optional cleanup logic)
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('Error cleaning up project ID mappings:', error);
  }
}
