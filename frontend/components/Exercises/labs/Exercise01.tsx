'use client';

import { useCallback, useRef } from 'react';
import RuleBasedProcess from '../../RuleBasedProcess';
import ExerciseShell from '../ExerciseShell';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';

export default function Exercise01() {
  const meta = EXERCISE_CATALOG[0];
  const { projectName, sessionId, projectId, generate, resetEpoch } = useExerciseSession();
  const storageKey = `np-ex1-rbp:${sessionId}:${projectId}`;
  const toolbarHostRef = useRef<HTMLDivElement>(null);
  const clearedOnMount = useRef(false);

  if (!clearedOnMount.current) {
    clearedOnMount.current = true;
    if (resetEpoch > 0 && typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore quota / private mode
      }
    }
  }

  const askModel = useCallback(
    async (prompt: string) => {
      const result = await generate({
        prompt,
        temperature: 0.3,
        n: 1,
        max_tokens: 400,
      });
      return result.outputs[0]?.trim() || 'I could not think of an answer right now.';
    },
    [generate]
  );

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        enableFullscreen={false}
        showMetaBadges={false}
        headerActions={<div ref={toolbarHostRef} className="rbp-shell-toolbar" />}
        workspace={
          <RuleBasedProcess
            projectName={projectName}
            localStorageKey={storageKey}
            askModel={askModel}
            toolbarHostRef={toolbarHostRef}
          />
        }
      />
    </WithExerciseIntro>
  );
}
