'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EXERCISE_CATALOG } from '../catalog';
import type { ExerciseId } from '../types';
import LabBuddy, { type LabBuddyMood } from '../labBuddy';
import '../labBuddy/labBuddy.css';
import './ExerciseLoading.css';

const MAX_MS = 12000;
const BOOT_GRACE_MS = 120;
const MOOD_TICK_MS = 780;
const REDUCE_MOTION_MIN_MS = 720;

/** Show every LabBuddy face once before the lab can open. */
const LOAD_MOODS: readonly LabBuddyMood[] = [
  'idle',
  'listen',
  'think',
  'type',
  'speak',
  'wait',
  'cheer',
  'sleep',
];

/** First mood at t=0, then one tick per remaining face (full dwell on the last). */
const MOOD_TOUR_MS = LOAD_MOODS.length * MOOD_TICK_MS;

type Phase = 'covering' | 'leaving' | 'done';

type WithExerciseLoadingProps = {
  exerciseId: ExerciseId;
  children: ReactNode;
};

function waitFonts(): Promise<void> {
  try {
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      return Promise.race([
        document.fonts.ready.then(() => undefined),
        new Promise<void>((r) => window.setTimeout(r, 2500)),
      ]);
    }
  } catch {
    /* ignore */
  }
  return Promise.resolve();
}

function waitFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function hasBooting(root: HTMLElement): boolean {
  return Boolean(root.querySelector('.is-booting'));
}

function waitBootClear(root: HTMLElement, signal: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    let observer: MutationObserver | null = null;
    let intervalId = 0;
    let graceId = 0;
    let settled = false;

    const cleanup = () => {
      if (observer) observer.disconnect();
      observer = null;
      if (intervalId) window.clearInterval(intervalId);
      intervalId = 0;
      if (graceId) window.clearTimeout(graceId);
      graceId = 0;
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const armWatch = () => {
      if (signal.cancelled || !hasBooting(root)) {
        finish();
        return;
      }
      observer = new MutationObserver(() => {
        if (!hasBooting(root) || signal.cancelled) finish();
      });
      observer.observe(root, {
        attributes: true,
        subtree: true,
        attributeFilter: ['class'],
        childList: true,
      });
      intervalId = window.setInterval(() => {
        if (!hasBooting(root) || signal.cancelled) finish();
      }, 80);
    };

    // Mount labs paint with is-booting; React labs never do.
    // Brief grace so a late-mounting host can attach the class before we proceed.
    if (hasBooting(root)) {
      armWatch();
      return;
    }
    graceId = window.setTimeout(armWatch, BOOT_GRACE_MS);
  });
}

export default function WithExerciseLoading({ exerciseId, children }: WithExerciseLoadingProps) {
  const meta = EXERCISE_CATALOG.find((item) => item.id === exerciseId);
  const frameRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('covering');
  const [progress, setProgress] = useState(6);
  const [status, setStatus] = useState('Preparing lab…');
  const [buddyMood, setBuddyMood] = useState<LabBuddyMood>(LOAD_MOODS[0]);

  useEffect(() => {
    setPhase('covering');
    setProgress(6);
    setStatus('Preparing lab…');
    setBuddyMood(LOAD_MOODS[0]);

    const signal = { cancelled: false };
    const started = performance.now();
    const frame = frameRef.current;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const minCoverMs = reduceMotion ? REDUCE_MOTION_MIN_MS : MOOD_TOUR_MS;

    if (reduceMotion) setBuddyMood('think');

    const bump = (value: number, message?: string) => {
      if (signal.cancelled) return;
      setProgress((cur) => Math.max(cur, value));
      if (message) setStatus(message);
    };

    const runMoodTour = async () => {
      if (reduceMotion) {
        await waitMs(minCoverMs);
        return;
      }

      for (let index = 0; index < LOAD_MOODS.length; index += 1) {
        if (signal.cancelled) return;
        setBuddyMood(LOAD_MOODS[index]);
        // Keep the bar moving with the tour so fast labs don't sit at 100% early.
        const tourProgress = 12 + Math.round(((index + 1) / LOAD_MOODS.length) * 76);
        bump(tourProgress);
        await waitMs(MOOD_TICK_MS);
      }
    };

    const runAssets = async () => {
      if (!frame) return;

      bump(18, 'Loading type…');
      await waitFonts();
      if (signal.cancelled) return;

      bump(40, 'Building workspace…');
      await waitFrames();
      if (signal.cancelled) return;

      bump(58, 'Loading lab assets…');
      await Promise.race([waitBootClear(frame, signal), waitMs(MAX_MS)]);
      if (signal.cancelled) return;

      bump(88, 'Almost ready…');
      await waitFrames();
    };

    const run = async () => {
      await Promise.all([runMoodTour(), runAssets()]);
      if (signal.cancelled) return;

      const elapsed = performance.now() - started;
      if (elapsed < minCoverMs) await waitMs(minCoverMs - elapsed);
      if (signal.cancelled) return;

      setBuddyMood('cheer');
      bump(100, 'Ready');
      setPhase('leaving');
    };

    void run();

    // Hard cap still waits out the emotion tour first.
    const hardCap = window.setTimeout(() => {
      if (signal.cancelled) return;
      setBuddyMood('cheer');
      bump(100, 'Ready');
      setPhase((cur) => (cur === 'done' ? cur : 'leaving'));
    }, Math.max(MAX_MS, minCoverMs));

    return () => {
      signal.cancelled = true;
      window.clearTimeout(hardCap);
    };
  }, [exerciseId]);

  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    setBuddyMood('cheer');
    const fallback = window.setTimeout(() => setPhase('done'), 520);
    return () => window.clearTimeout(fallback);
  }, [phase]);

  const covering = phase === 'covering' || phase === 'leaving';
  const exerciseLabel =
    typeof exerciseId === 'number' && exerciseId % 1 !== 0
      ? String(exerciseId)
      : String(Math.floor(Number(exerciseId)));

  return (
    <div
      ref={frameRef}
      className={`ex-load-frame${covering ? ' is-covering' : ''}`}
      data-exercise={String(exerciseId)}
    >
      {covering ? (
        <div
          className={`ex-load-screen${phase === 'leaving' ? ' is-leaving' : ''}`}
          role="status"
          aria-live="polite"
          aria-busy={phase === 'covering'}
          aria-label="Loading exercise"
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            if (phase === 'leaving' && event.propertyName === 'opacity') {
              setPhase('done');
            }
          }}
        >
          <div className="ex-load-aura" aria-hidden="true" />
          <div className="ex-load-grid" aria-hidden="true" />
          <div className="ex-load-scan" aria-hidden="true" />
          <span className="ex-load-watermark" aria-hidden="true">
            {exerciseLabel}
          </span>

          <div className="ex-load-hero">
            <div className="ex-load-buddy-wrap" aria-hidden="true">
              <span className="ex-load-halo" />
              <span className="ex-load-ring" />
              <LabBuddy mood={buddyMood} size={168} />
            </div>

            <p className="ex-load-kicker">
              <span>Exercise {exerciseLabel}</span>
              {meta?.difficulty ? <span className="ex-load-dot" /> : null}
              {meta?.difficulty ? <span>{meta.difficulty}</span> : null}
              {meta?.minutes != null ? <span className="ex-load-dot" /> : null}
              {meta?.minutes != null ? <span>{meta.minutes} min</span> : null}
            </p>

            <h2 className="ex-load-title">{meta?.title ?? 'Exercise'}</h2>
            {meta?.outcome ? <p className="ex-load-outcome">{meta.outcome}</p> : null}

            <p className="ex-load-status">{status}</p>

            <div className="ex-load-meter" aria-hidden="true">
              <div className="ex-load-bar">
                <i style={{ width: `${progress}%` }} />
              </div>
              <b>{Math.round(progress)}%</b>
            </div>
          </div>
        </div>
      ) : null}
      <div className="ex-load-body">{children}</div>
    </div>
  );
}
