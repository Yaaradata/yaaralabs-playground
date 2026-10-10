'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import Exercise11Lab from './exercise11/index';

export default function Exercise11() {
  const meta = EXERCISE_CATALOG.find((item) => item.id === 11)!;
  const { sessionId, projectId, markComplete } = useExerciseSession();

  return (
    <ExerciseShell
      meta={meta}
      bare
      workspace={
        <Exercise11Lab
          sessionId={sessionId}
          projectId={projectId}
          onComplete={() => markComplete(meta.id)}
        />
      }
    />
  );
}
