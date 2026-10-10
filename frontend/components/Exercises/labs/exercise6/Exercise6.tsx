'use client';

import { useEffect, useRef } from 'react';
import './exercise6.css';
import { useExerciseSession } from '../../ExerciseContext';
import { mountExercise6 } from './lib/mount';

export interface Exercise6Props {
  sessionId: string;
  projectId: string;
  onComplete: () => void;
}

export default function Exercise6({ sessionId, projectId, onComplete }: Exercise6Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { theme } = useExerciseSession();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !sessionId || !projectId) return undefined;
    return mountExercise6(host, {
      sessionId,
      projectId,
      onComplete: () => onCompleteRef.current(),
    });
  }, [sessionId, projectId]);

  return (
    <div className="ex6-root is-booting" data-theme={theme} ref={hostRef}>
      <div className="boot" role="status" aria-live="polite" aria-busy="true">
        <span className="spin" aria-hidden="true" />
        <span className="boot-t">Loading embedding lab…</span>
      </div>
    </div>
  );
}
