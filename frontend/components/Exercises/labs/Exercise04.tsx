'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import Exercise4 from './exercise4/Exercise4';

export default function Exercise04() {
  const meta = EXERCISE_CATALOG[3];
  const { sessionId, projectId, markComplete, ex2Result } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <Exercise4
            sessionId={sessionId}
            projectId={projectId}
            ex2Result={ex2Result}
            onComplete={() => markComplete(meta.id)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
