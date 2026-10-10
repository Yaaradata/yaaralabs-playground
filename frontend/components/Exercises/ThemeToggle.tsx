'use client';

import React, { useEffect, useState } from 'react';
import {
  readExerciseTheme,
  subscribeExerciseTheme,
  writeExerciseTheme,
  type ExerciseTheme,
} from './theme';
import './ThemeToggle.css';

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5z" />
    </svg>
  );
}

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ExerciseTheme>(() => readExerciseTheme());

  useEffect(() => subscribeExerciseTheme(setTheme), []);

  const pick = (next: ExerciseTheme) => {
    if (next !== theme) writeExerciseTheme(next);
  };

  return (
    <div className={`np-theme${className ? ` ${className}` : ''}`} role="group" aria-label="Theme" data-theme={theme}>
      <button
        type="button"
        className={`np-theme-opt np-theme-light${theme === 'light' ? ' on' : ''}`}
        data-theme-set="light"
        aria-pressed={theme === 'light'}
        title="Light theme"
        aria-label="Light theme"
        onClick={() => pick('light')}
      >
        <SunIcon />
      </button>
      <button
        type="button"
        className={`np-theme-opt np-theme-dark${theme === 'dark' ? ' on' : ''}`}
        data-theme-set="dark"
        aria-pressed={theme === 'dark'}
        title="Dark theme"
        aria-label="Dark theme"
        onClick={() => pick('dark')}
      >
        <MoonIcon />
      </button>
    </div>
  );
}
