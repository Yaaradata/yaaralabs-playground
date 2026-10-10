'use client';

import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import Exercise13Lab from './exercise13/index';

export default function Exercise13() {
  const meta = EXERCISE_CATALOG.find((item) => item.id === 13)!;
  const { sessionId, projectId, markComplete } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <Exercise13Lab
            sessionId={sessionId}
            projectId={projectId}
            onComplete={() => markComplete(meta.id)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
