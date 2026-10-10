// Scratch Editor Configuration
export const SCRATCH_EDITOR_CONFIG = {
  // Production URL (Cloud Run)
  PRODUCTION_URL: 'https://scratch-editor-773717965404.us-central1.run.app',
  
  // Development URL (localhost)
  DEVELOPMENT_URL: 'http://localhost:8601',
  
  // Get the appropriate URL based on environment
  getUrl: () => {
    if (process.env.NODE_ENV === 'production') {
      return SCRATCH_EDITOR_CONFIG.PRODUCTION_URL;
    }
    return SCRATCH_EDITOR_CONFIG.DEVELOPMENT_URL;
  }
};

// Export the current URL for direct use
export const SCRATCH_EDITOR_URL = SCRATCH_EDITOR_CONFIG.getUrl();
