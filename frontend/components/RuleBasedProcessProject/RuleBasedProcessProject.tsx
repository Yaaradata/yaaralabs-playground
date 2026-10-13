'use client';

/**
 * A Rule Based Process project. Opens in the block editor (the Exercise 1 editor), saved to the
 * project through the Rule Based Process API; "Ask the model" uses the project's model endpoint.
 * See ./editors.ts for which projects open where, and how to bring back the Rules Bot board.
 */

import dynamic from 'next/dynamic';
import BlockStudioShell from '../BlockStudio/BlockStudioShell';
import RuleBasedProcess from '../RuleBasedProcess';
import ScratchLauncher from './ScratchLauncher';
import { resolveRbpEditor } from './editors';

// Parked: loaded only when RULES_BOT_ENABLED routes a project to it (not in the bundle otherwise)
const RulesBot = dynamic(() => import('../RulesBot'), { ssr: false });

interface Props {
  projectName: string;
  sessionId: string | null;
  projectId: string;
  /** The project's stored `rbpEditor` value. */
  editor?: string | null;
}

export default function RuleBasedProcessProject({ projectName, sessionId, projectId, editor }: Props) {
  const view = resolveRbpEditor(editor);

  if (view === 'scratch') {
    return <ScratchLauncher projectName={projectName} sessionId={sessionId} projectId={projectId} />;
  }

  if (view === 'rules-bot') {
    return <RulesBot projectName={projectName} sessionId={sessionId ?? ''} projectId={projectId} />;
  }

  return (
    <BlockStudioShell title={`Rule Based Process : ${projectName}`}>
      {(toolbarHostRef) =>
        sessionId ? (
          <RuleBasedProcess
            projectName={projectName}
            sessionId={sessionId}
            projectId={projectId}
            toolbarHostRef={toolbarHostRef}
          />
        ) : null
      }
    </BlockStudioShell>
  );
}
