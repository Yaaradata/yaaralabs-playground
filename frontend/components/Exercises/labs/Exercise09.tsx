'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import Exercise9 from './exercise9';

export default function Exercise09() {
  const meta = EXERCISE_CATALOG[8];
  const { sessionId, projectId, markComplete } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <Exercise9
            sessionId={sessionId}
            projectId={projectId}
            onComplete={() => markComplete(meta.id)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
