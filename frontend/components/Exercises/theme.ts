// Exercises share the app-wide theme (lib/theme.ts); these names are kept for the labs
import {
  THEME_STORAGE_KEY,
  readTheme,
  subscribeTheme,
  writeTheme,
  type AppTheme,
} from '../../lib/theme';

export type ExerciseTheme = AppTheme;

export { THEME_STORAGE_KEY };

export const readExerciseTheme = readTheme;

export const writeExerciseTheme = writeTheme;

export const subscribeExerciseTheme = subscribeTheme;

export function applyThemeAttr(el: HTMLElement | null | undefined, theme: ExerciseTheme): void {
  if (!el) return;
  el.setAttribute('data-theme', theme);
  el.classList.toggle('e2-light', theme === 'light' && el.classList.contains('e2'));
}

export const THEME_TOGGLE_HTML = `
<div class="np-theme" role="group" aria-label="Theme">
  <button type="button" class="np-theme-opt np-theme-light" data-theme-set="light" title="Light theme" aria-label="Light theme">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
  </button>
  <button type="button" class="np-theme-opt np-theme-dark" data-theme-set="dark" title="Dark theme" aria-label="Dark theme">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z"/></svg>
  </button>
</div>
`.trim();

function paintThemeToggle(host: HTMLElement, theme: ExerciseTheme): void {
  host.querySelectorAll<HTMLElement>('[data-theme-set]').forEach((btn) => {
    const on = btn.getAttribute('data-theme-set') === theme;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** Apply theme to a lab host, keep toggle buttons in sync, and react to shared changes. */
export function bindExerciseTheme(host: HTMLElement): () => void {
  const paint = (theme: ExerciseTheme) => {
    applyThemeAttr(host, theme);
    paintThemeToggle(host, theme);
  };
  paint(readExerciseTheme());
  const unsub = subscribeExerciseTheme(paint);
  const onClick = (event: Event) => {
    const target = (event.target as HTMLElement | null)?.closest?.('[data-theme-set]');
    if (!target || !host.contains(target)) return;
    const next = target.getAttribute('data-theme-set');
    if (next === 'light' || next === 'dark') writeExerciseTheme(next);
  };
  host.addEventListener('click', onClick);
  return () => {
    unsub();
    host.removeEventListener('click', onClick);
  };
}
