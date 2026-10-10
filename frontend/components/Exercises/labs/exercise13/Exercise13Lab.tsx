'use client';

import { useEffect, useRef } from 'react';
import './exercise13.css';
import '../../labBuddy/labBuddy.css';
import { useExerciseSession } from '../../ExerciseContext';
import { mountExercise13 } from './lib/mount';

export interface Exercise13Props {
  sessionId: string;
  projectId: string;
  onComplete: () => void;
}

export default function Exercise13Lab({ sessionId, projectId, onComplete }: Exercise13Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { theme } = useExerciseSession();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !sessionId || !projectId) return undefined;
    return mountExercise13(host, {
      sessionId,
      projectId,
      onComplete: () => onCompleteRef.current(),
    });
  }, [sessionId, projectId]);

  return (
    <div className="ex13-root is-booting" data-theme={theme} ref={hostRef}>
      <div className="boot" role="status" aria-live="polite" aria-busy="true">
        <span className="spin" aria-hidden="true" />
        <span className="boot-t">Loading agent lab…</span>
      </div>
    </div>
  );
}
