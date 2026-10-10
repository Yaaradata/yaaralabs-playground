'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useExerciseSession } from '../ExerciseContext';
import type { ExerciseId } from '../types';
import { getExerciseIntroPack } from './content';
import ExerciseIntroDeck from './ExerciseIntroDeck';
import { clearIntroSeen, hasIntroSeen, markIntroSeen } from './seen';

type WithExerciseIntroProps = {
  exerciseId: ExerciseId;
  children: ReactNode;
};

/**
 * Wraps a lab and shows the shared Ex2-style introduction on first open
 * (and again after a full progress reset). Exercise 2 keeps its own ConceptDeck.
 */
export default function WithExerciseIntro({ exerciseId, children }: WithExerciseIntroProps) {
  const { sessionId, projectId, resetEpoch } = useExerciseSession();
  const pack = getExerciseIntroPack(exerciseId);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!pack || !sessionId || !projectId) return;
    setIndex(0);
    if (resetEpoch > 0) {
      clearIntroSeen(sessionId, projectId, exerciseId);
      setOpen(true);
      return;
    }
    if (!hasIntroSeen(sessionId, projectId, exerciseId)) setOpen(true);
  }, [exerciseId, pack, projectId, resetEpoch, sessionId]);

  const close = useCallback(() => {
    setOpen(false);
    markIntroSeen(sessionId, projectId, exerciseId);
  }, [exerciseId, projectId, sessionId]);

  if (!pack) return <>{children}</>;

  return (
    <div className="ex-intro-frame">
      {children}
      <ExerciseIntroDeck
        open={open}
        pack={pack}
        index={index}
        onIndex={setIndex}
        onClose={close}
        onStart={close}
      />
    </div>
  );
}
