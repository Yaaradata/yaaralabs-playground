'use client';

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ExerciseMeta } from './types';
import { useExerciseSession } from './ExerciseContext';
import FullscreenButton from './FullscreenButton';
import ThemeToggle from './ThemeToggle';
import ExerciseHeaderIcon from './ExerciseHeaderIcon';
import { Alert } from './ui';
import './exerciseHeader.css';

interface ExerciseShellProps {
  meta: ExerciseMeta;
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  workspace?: React.ReactNode;
  bare?: boolean;
  /** Show a Full Screen control in the shell header. Defaults on when not bare. */
  enableFullscreen?: boolean;
  onRun?: () => void | Promise<void>;
  running?: boolean;
  runLabel?: string;
  canRun?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Extra controls in the shell header (e.g. Undo). */
  headerActions?: ReactNode;
  /** Difficulty / minutes / progress chips under the title. Defaults on. */
  showMetaBadges?: boolean;
}

export function useExerciseWorkspaceNotes(meta: ExerciseMeta) {
  const { getProgress, saveNotes, resetExercise } = useExerciseSession();
  const progress = getProgress(meta.id);
  const [notes, setNotes] = useState(progress.notes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    setNotes(progress.notes);
  }, [progress.notes]);

  const tabs = (
    <>
      <button
        type="button"
        className={`ex-ptab${notesOpen ? ' on' : ''}`}
        onClick={() => setNotesOpen((open) => !open)}
      >
        Student notes
      </button>
      <button
        type="button"
        className="ex-ptab"
        onClick={() => {
          setNotes('');
          setNotesOpen(false);
          resetExercise(meta.id);
        }}
      >
        Reset exercise
      </button>
    </>
  );

  const panel = notesOpen ? (
    <div className="ex-side-notes">
      <label className="block text-sm">
        <span className="text-fg/70">Student notes & findings</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-2 w-full px-3 py-2 rounded-lg bg-canvas border border-magenta-brand/20 text-fg text-sm"
          placeholder="What failed? What changed when you edited an input?"
        />
      </label>
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={async () => {
            setSaveState('saving');
            const ok = await saveNotes(meta.id, notes);
            setSaveState(ok ? 'saved' : 'local');
            window.setTimeout(() => setSaveState('idle'), 1600);
          }}
          className="px-3 py-1.5 rounded-lg bg-purple-brand/20 text-white text-xs border border-magenta-brand/40"
        >
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
              ? 'Saved'
              : saveState === 'local'
                ? 'Saved on this device'
                : 'Save Notes'}
        </button>
      </div>
    </div>
  ) : null;

  return { tabs, panel };
}

export default function ExerciseShell({
  meta,
  left,
  center,
  right,
  workspace,
  bare = false,
  enableFullscreen,
  onRun,
  running = false,
  runLabel = 'Run',
  canRun = true,
  error,
  onRetry,
  headerActions,
  showMetaBadges = true,
}: ExerciseShellProps) {
  const { getProgress, saveNotes, resetExercise } = useExerciseSession();
  const progress = getProgress(meta.id);
  const [notes, setNotes] = useState(progress.notes);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'local'>('idle');
  const shellRef = useRef<HTMLDivElement>(null);
  const showFullscreen = enableFullscreen ?? !bare;

  useEffect(() => {
    setNotes(progress.notes);
  }, [progress.notes]);

  return (
    <div
      ref={shellRef}
      className={`ex-shell${workspace ? ' ex-shell-fill' : ''}${bare ? ' ex-shell-bare' : ''}`}
    >
      {bare ? null : (
      <div className="ex-shell-head">
        <div className="min-w-0">
          <div className="ex-lab-brand">
            <ExerciseHeaderIcon id={meta.id} />
            <h1 className="ex-lab-brand-title">
              Exercise - {meta.id} : {meta.title}
            </h1>
          </div>
          {showMetaBadges ? (
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-magenta-brand/40 text-[#e2b7f3]">
                {meta.difficulty}
              </span>
              <span className="text-[11px] text-fg/50">{meta.minutes} min</span>
              <span className={`ex-status ex-status-${progress.status}`}>
                {progress.status === 'completed'
                  ? 'Completed'
                  : progress.status === 'in_progress'
                    ? 'In Progress'
                    : 'Not Started'}
              </span>
            </div>
          ) : null}
          {!workspace && meta.outcome ? (
            <p className="text-sm text-fg/60 truncate">{meta.outcome}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 justify-end items-center">
          {headerActions}
          {!workspace ? <ThemeToggle /> : null}
          {showFullscreen ? (
            <FullscreenButton targetRef={shellRef} className="ex-fs-btn" />
          ) : null}
          {onRun ? (
            <button
              type="button"
              onClick={() => void onRun()}
              disabled={running || !canRun}
              className="bg-purple-brand text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {running ? 'Running…' : runLabel}
            </button>
          ) : null}
        </div>
      </div>
      )}

      {error ? (
        <div className="px-3 pt-3">
          <Alert kind="error">
            <div className="flex items-center justify-between gap-3">
              <span>{error}</span>
              {onRetry ? (
                <button type="button" onClick={onRetry} className="underline">
                  Retry
                </button>
              ) : null}
            </div>
          </Alert>
        </div>
      ) : null}

      {workspace ? (
        <div className="ex-workspace">{workspace}</div>
      ) : (
        <div className="ex-body">
          <section className="ex-panel">
            <div className="ex-panel-h">Instructions & inputs</div>
            <div className="ex-panel-b">{left}</div>
          </section>
          <section className="ex-panel">
            <div className="ex-panel-h">Experiment workspace</div>
            <div className="ex-panel-b">{center}</div>
          </section>
          <section className="ex-panel">
            <div className="ex-panel-h">Live outputs</div>
            <div className="ex-panel-b">{right}</div>
          </section>
        </div>
      )}

      {workspace ? null : (
      <div className="ex-notes">
        <label className="block text-sm">
          <span className="text-fg/70">Student notes & findings</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-2 w-full px-3 py-2 rounded-lg bg-canvas border border-magenta-brand/20 text-fg text-sm"
            placeholder="What failed? What changed when you edited an input?"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={async () => {
              setSaveState('saving');
              const ok = await saveNotes(meta.id, notes);
              setSaveState(ok ? 'saved' : 'local');
              window.setTimeout(() => setSaveState('idle'), 1600);
            }}
            className="px-4 py-2 rounded-lg bg-purple-brand/20 text-white text-sm border border-magenta-brand/40"
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'local' ? 'Saved on this device' : 'Save Notes'}
          </button>
          <button
            type="button"
            onClick={() => {
              setNotes('');
              resetExercise(meta.id);
            }}
            className="px-4 py-2 rounded-lg border border-fg/20 text-fg/80 text-sm"
          >
            Reset exercise
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
