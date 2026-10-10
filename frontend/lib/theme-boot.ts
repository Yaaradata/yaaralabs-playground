// Theme constants and the pre-paint boot script. No React here, so the root layout
// (a server component) can import it; the client store lives in ./theme.ts.

export type AppTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'yaaralabs-theme';
export const DEFAULT_THEME: AppTheme = 'dark';

// Earlier keys (Exercises labs); read once and migrated
export const LEGACY_KEYS = ['np-exercises-theme', 'np-ex2-theme', 'ex3-theme', 'ex4-theme'] as const;

/**
 * Inline script for <head>: sets data-theme before first paint so a light-theme
 * user never sees a dark flash.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},l=${JSON.stringify(LEGACY_KEYS)},t=localStorage.getItem(k);if(t!=='light'&&t!=='dark'){for(var i=0;i<l.length&&t!=='light'&&t!=='dark';i++){t=localStorage.getItem(l[i]);}}if(t!=='light'&&t!=='dark'){t=${JSON.stringify(DEFAULT_THEME)};}document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.setAttribute('data-theme',${JSON.stringify(DEFAULT_THEME)});}})();`;
