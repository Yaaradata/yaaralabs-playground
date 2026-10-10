'use client';

import LiveObjectDetection from '../../LiveObjectDetection';
import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';

export default function Exercise045() {
  const meta = EXERCISE_CATALOG.find((item) => item.id === 4.5)!;
  const { projectName, sessionId, projectId, setActiveId } = useExerciseSession();

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        bare
        workspace={
          <LiveObjectDetection
            projectName={projectName}
            sessionId={sessionId}
            projectId={projectId}
            onClose={() => setActiveId(null)}
          />
        }
      />
    </WithExerciseIntro>
  );
}
