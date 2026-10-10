'use client';

import { useEffect, useRef } from 'react';
import './exerciseLimit.css';
import '../../labBuddy/labBuddy.css';
import { useExerciseSession } from '../../ExerciseContext';
import { mountExerciseLimit } from './lib/mount';

export interface ExerciseLimitProps {
  sessionId: string;
  projectId: string;
  onComplete: () => void;
}

export default function ExerciseLimitLab({ sessionId, projectId, onComplete }: ExerciseLimitProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { theme } = useExerciseSession();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !sessionId || !projectId) return undefined;
    return mountExerciseLimit(host, {
      sessionId,
      projectId,
      onComplete: () => onCompleteRef.current(),
    });
  }, [sessionId, projectId]);

  return (
    <div className="exLimit-root is-booting" data-theme={theme} ref={hostRef}>
      <div className="boot" role="status" aria-live="polite" aria-busy="true">
        <span className="spin" aria-hidden="true" />
        <span className="boot-t">Loading context window lab...</span>
      </div>
    </div>
  );
}
