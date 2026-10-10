'use client';

import { useEffect, useRef } from 'react';
import './exercise8.css';
import { useExerciseSession } from '../../ExerciseContext';
import { mountExercise8 } from './lib/mount';

export interface Exercise8Props {
  sessionId: string;
  projectId: string;
  onComplete: () => void;
}

export default function Exercise8({ sessionId, projectId, onComplete }: Exercise8Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const { theme } = useExerciseSession();

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !sessionId || !projectId) return undefined;
    return mountExercise8(host, {
      sessionId,
      projectId,
      onComplete: () => onCompleteRef.current(),
    });
  }, [sessionId, projectId]);

  return (
    <div className="ex8-root is-booting" data-theme={theme} ref={hostRef}>
      <div className="boot" role="status" aria-live="polite" aria-busy="true">
        <span className="spin" aria-hidden="true" />
        <span className="boot-t">Loading dial lab…</span>
      </div>
    </div>
  );
}
