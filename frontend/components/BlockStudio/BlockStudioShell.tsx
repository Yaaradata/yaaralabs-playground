'use client';

/**
 * The frame around the block editor (components/RuleBasedProcess) wherever it appears outside the
 * Exercises: Rule Based Process projects and Text / Image Recognition "Use the AI". Same look as
 * the Exercise 1 shell: themed root, a header with the title, an optional status line and the
 * Run / Stop toolbar (the editor moves its run bar into `toolbarHostRef`), then the workspace.
 */

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { readExerciseTheme, subscribeExerciseTheme } from '../Exercises/theme';
import '../Exercises/Exercises.css';
import '../Exercises/ThemeToggle.css';
import '../Exercises/theme-labs.css';
import '../Exercises/exerciseHeader.css';

interface Props {
  title: string;
  /** A line under the title (status, hints). */
  subtitle?: ReactNode;
  /** Shows a back button before the title. Leave out when the page already has one. */
  backHref?: string;
  backLabel?: string;
  /** The workspace; receives the ref of the header slot that holds the editor's run bar. */
  children: (toolbarHostRef: RefObject<HTMLDivElement | null>) => ReactNode;
  /** Rendered after the shell (dialogs). */
  overlay?: ReactNode;
  /** Extra header buttons, next to the run bar (e.g. "Move to next"). */
  actions?: ReactNode;
}

export default function BlockStudioShell({ title, subtitle, backHref, backLabel = 'Back', children, overlay, actions }: Props) {
  const [theme, setTheme] = useState(() => readExerciseTheme());
  const toolbarHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => subscribeExerciseTheme(setTheme), []);

  return (
    <div className="ex-root h-full" data-theme={theme}>
      <div className="ex-shell ex-shell-fill">
        <div className="ex-shell-head">
          <div className="min-w-0 flex items-center gap-3">
            {backHref && (
              <Link href={backHref} className="ex-fs-btn shrink-0" aria-label={backLabel} title={backLabel}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="ex-lab-brand-title truncate">{title}</h1>
              {subtitle && (
                <p className="text-xs mt-0.5" role="status">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div ref={toolbarHostRef} className="rbp-shell-toolbar" />
            {actions}
          </div>
        </div>
        <div className="ex-workspace">{children(toolbarHostRef)}</div>
      </div>
      {overlay}
    </div>
  );
}
