'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import ExerciseLimitLab from './exerciseLimit/index';

export default function ExerciseLimit() {
  const meta = EXERCISE_CATALOG.find((item) => item.id === 10)!;
  const { sessionId, projectId, markComplete } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <ExerciseLimitLab
            sessionId={sessionId}
            projectId={projectId}
            onComplete={() => markComplete(meta.id)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
