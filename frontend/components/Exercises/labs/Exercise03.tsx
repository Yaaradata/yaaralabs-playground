'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import Exercise3 from './exercise3';

export default function Exercise03() {
  const meta = EXERCISE_CATALOG.find((item) => item.id === 3)!;
  const { sessionId, projectId, markComplete } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <Exercise3
            sessionId={sessionId}
            projectId={projectId}
            onComplete={() => markComplete(meta.id)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
