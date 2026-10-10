'use client';

import React, { useEffect, useRef } from 'react';
import './Exercises.css';
import './ThemeToggle.css';
import './theme-labs.css';
import './exerciseHeader.css';
import { EXERCISE_CATALOG } from './catalog';
import { ExerciseProvider, useExerciseSession } from './ExerciseContext';
import { WithExerciseLoading } from './loading';
import ThemeToggle from './ThemeToggle';
import type { ExerciseId, ExerciseStatus, ExercisesProps } from './types';
import Exercise01 from './labs/Exercise01';
import Exercise02 from './labs/Exercise02';
import Exercise03 from './labs/Exercise03';
import Exercise04 from './labs/Exercise04';
import Exercise045 from './labs/Exercise045';
import Exercise05 from './labs/Exercise05';
import Exercise06 from './labs/Exercise06';
import Exercise08 from './labs/Exercise08';
import Exercise09 from './labs/Exercise09';
import Exercise10 from './labs/Exercise10';
import ExerciseLimit from './labs/ExerciseLimit';
import Exercise11 from './labs/Exercise11';
import Exercise12 from './labs/Exercise12';
import Exercise13 from './labs/Exercise13';
import Exercise14 from './labs/Exercise14';

const STATUS_LABEL: Record<ExerciseStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

function ExerciseView({ id }: { id: ExerciseId }) {
  switch (id) {
    case 1:
      return <Exercise01 />;
    case 2:
      return <Exercise02 />;
    case 3:
      return <Exercise03 />;
    case 4:
      return <Exercise04 />;
    case 4.5:
      return <Exercise045 />;
    case 5:
      return <Exercise05 />;
    case 6:
      return <Exercise06 />;
    case 7:
      return <Exercise08 />;
    case 8:
      return <Exercise09 />;
    case 9:
      return <Exercise10 />;
    case 10:
      return <ExerciseLimit />;
    case 11:
      return <Exercise11 />;
    case 12:
      return <Exercise12 />;
    case 13:
      return <Exercise13 />;
    case 14:
      return <Exercise14 />;
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

function ExercisesLanding({
  onOpenChange,
  onStatusChange,
}: {
  onOpenChange?: (open: boolean) => void;
  onStatusChange?: (status: ExerciseStatus | null) => void;
}) {
  const { projectName, getProgress, setActiveId, markInProgress, persist, resetAll } = useExerciseSession();

  return (
    <div className="ex-scroll">
      <div className="ex-landing">
        <div className="ex-kicker">AI laboratory</div>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold">
              <span className="text-pink-brand">Exercises</span>
              <span className="text-fg/40"> · </span>
              {projectName}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => void resetAll()}
              className="text-sm font-semibold text-[#ffb020] hover:text-[#ffc14d] border border-[#ffb020]/40 rounded-lg px-3 py-2"
            >
              Reset all progress
            </button>
          </div>
        </div>
        <div className="ex-grid">
          {EXERCISE_CATALOG.map((item) => {
            const progress = getProgress(item.id);
            return (
              <article key={item.id} className="ex-card">
                <div className="ex-card-top">
                  <span className="ex-num">Exercise {item.id}</span>
                  <span className={`ex-status ex-status-${progress.status}`}>{STATUS_LABEL[progress.status]}</span>
                </div>
                <h2 className="text-lg font-semibold leading-snug">{item.title}</h2>
                {item.outcome ? (
                  <p className="text-sm text-fg/60 flex-1">{item.outcome}</p>
                ) : (
                  <div className="flex-1" />
                )}
                <div className="flex items-center justify-between text-xs text-fg/50">
                  <span>{item.difficulty}</span>
                  <span>{item.minutes} min</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    markInProgress(item.id);
                    void persist();
                    onOpenChange?.(true);
                    onStatusChange?.(progress.status === 'completed' ? 'completed' : 'in_progress');
                    setActiveId(item.id);
                  }}
                  className="mt-1 bg-purple-brand text-white py-2 rounded-lg text-sm font-semibold hover:bg-[#e8ff9e] transition-colors"
                >
                  Open Exercise
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ExercisesWorkspace({
  onOpenChange,
  onStatusChange,
  onBackLabelChange,
  backToListRef,
}: {
  onOpenChange?: (open: boolean) => void;
  onStatusChange?: (status: ExerciseStatus | null) => void;
  onBackLabelChange?: (label: string | null) => void;
  backToListRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const { activeId, setActiveId, markInProgress, getProgress, resetEpoch, chromeBack } =
    useExerciseSession();
  const chromeBackRef = useRef(chromeBack);
  chromeBackRef.current = chromeBack;

  useEffect(() => {
    if (activeId) markInProgress(activeId);
  }, [activeId, markInProgress]);

  useEffect(() => {
    onOpenChange?.(activeId != null);
    onStatusChange?.(activeId ? getProgress(activeId).status : null);
    onBackLabelChange?.(chromeBack?.label ?? (activeId != null ? "All Exercise" : null));
    if (!backToListRef) return undefined;
    backToListRef.current = () => {
      const override = chromeBackRef.current;
      if (override) {
        override.run();
        return;
      }
      setActiveId(null);
      onOpenChange?.(false);
      onStatusChange?.(null);
      onBackLabelChange?.(null);
    };
    return () => {
      backToListRef.current = null;
    };
  }, [
    activeId,
    backToListRef,
    chromeBack,
    getProgress,
    onBackLabelChange,
    onOpenChange,
    onStatusChange,
    setActiveId,
  ]);

  if (!activeId) return <ExercisesLanding onOpenChange={onOpenChange} onStatusChange={onStatusChange} />;
  return (
    <WithExerciseLoading key={`${activeId}-${resetEpoch}`} exerciseId={activeId}>
      <ExerciseView id={activeId} />
    </WithExerciseLoading>
  );
}

export default function Exercises({
  onOpenChange,
  onStatusChange,
  onBackLabelChange,
  backToListRef,
  ...session
}: ExercisesProps & {
  onOpenChange?: (open: boolean) => void;
  onStatusChange?: (status: ExerciseStatus | null) => void;
  onBackLabelChange?: (label: string | null) => void;
  backToListRef?: React.MutableRefObject<(() => void) | null>;
}) {
  return (
    <ExerciseProvider {...session}>
      <ExercisesThemedRoot>
        <ExercisesWorkspace
          onOpenChange={onOpenChange}
          onStatusChange={onStatusChange}
          onBackLabelChange={onBackLabelChange}
          backToListRef={backToListRef}
        />
      </ExercisesThemedRoot>
    </ExerciseProvider>
  );
}

function ExercisesThemedRoot({ children }: { children: React.ReactNode }) {
  const { theme } = useExerciseSession();
  return (
    <div className="ex-root" data-theme={theme}>
      {children}
    </div>
  );
}
