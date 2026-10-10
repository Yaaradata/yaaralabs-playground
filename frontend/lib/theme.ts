'use client';

/**
 * App-wide light/dark theme.
 *
 * One stored preference drives <html data-theme>, which flips the semantic colour
 * tokens in app/globals.css. Exercises, the Rules Bot and the header toggle all use
 * this store, so every toggle changes the same theme. Default: dark (the brand look).
 */

import { useEffect, useState } from 'react';

import { DEFAULT_THEME, LEGACY_KEYS, THEME_STORAGE_KEY, type AppTheme } from './theme-boot';

export { DEFAULT_THEME, THEME_STORAGE_KEY, type AppTheme };
const EVENT = 'yaaralabs-theme';

type Listener = (theme: AppTheme) => void;
const listeners = new Set<Listener>();

const parse = (raw: string | null): AppTheme | null => (raw === 'light' || raw === 'dark' ? raw : null);

export function readTheme(): AppTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const current = parse(window.localStorage.getItem(THEME_STORAGE_KEY));
    if (current) return current;
    for (const key of LEGACY_KEYS) {
      const legacy = parse(window.localStorage.getItem(key));
      if (legacy) {
        window.localStorage.setItem(THEME_STORAGE_KEY, legacy);
        return legacy;
      }
    }
  } catch {
    /* private mode / blocked storage */
  }
  return DEFAULT_THEME;
}

export function applyDocumentTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

export function writeTheme(theme: AppTheme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  applyDocumentTheme(theme);
  listeners.forEach((listener) => listener(theme));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
  }
}

export function subscribeTheme(listener: Listener): () => void {
  listeners.add(listener);
  const onWindow = (event: Event) => {
    const detail = (event as CustomEvent<AppTheme>).detail;
    if (detail === 'light' || detail === 'dark') listener(detail);
  };
  // Other tabs
  const onStorage = (event: StorageEvent) => {
    const next = event.key === THEME_STORAGE_KEY ? parse(event.newValue) : null;
    if (next) {
      applyDocumentTheme(next);
      listener(next);
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(EVENT, onWindow);
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener(EVENT, onWindow);
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Current theme plus a setter; re-renders when any toggle changes it. */
export function useAppTheme(): [AppTheme, (theme: AppTheme) => void] {
  // Start from the default so server and first client render match; sync after mount
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);
  useEffect(() => {
    setTheme(readTheme());
    return subscribeTheme(setTheme);
  }, []);
  return [theme, writeTheme];
}
