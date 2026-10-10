'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import Exercise5 from './exercise5';

export default function Exercise05() {
  const meta = EXERCISE_CATALOG[5];
  const { sessionId, projectId, markComplete } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <Exercise5
            sessionId={sessionId}
            projectId={projectId}
            onComplete={() => markComplete(meta.id)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
