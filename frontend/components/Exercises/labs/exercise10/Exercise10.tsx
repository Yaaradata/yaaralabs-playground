'use client';

import { useEffect, useRef } from 'react';
import './exercise10.css';
import { useExerciseSession } from '../../ExerciseContext';
import { mountExercise10 } from './lib/mount';

export interface Exercise10Props {
  sessionId: string;
  projectId: string;
  onComplete: () => void;
}

export default function Exercise10({ sessionId, projectId, onComplete }: Exercise10Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { theme } = useExerciseSession();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !sessionId || !projectId) return undefined;
    return mountExercise10(host, {
      sessionId,
      projectId,
      onComplete: () => onCompleteRef.current(),
    });
  }, [sessionId, projectId]);

  return (
    <div className="ex10-root is-booting" data-theme={theme} ref={hostRef}>
      <div className="boot" role="status" aria-live="polite" aria-busy="true">
        <span className="spin" aria-hidden="true" />
        <span className="boot-t">Loading model compare lab…</span>
      </div>
    </div>
  );
}
