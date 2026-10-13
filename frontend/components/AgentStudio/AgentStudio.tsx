'use client';

import { STAGE_BADGE, type Stage } from './stages';

export interface AgentStudioProps {
  agentId: string;
  sessionId: string;
  stage: Stage;
  projectName: string;
  copiedFrom: { agent_id: string; name: string; stage: string } | null;
  backHref: string;
}

/** Day 2 Agent Studio shell (filled in by Phase 3). */
export default function AgentStudio({ stage, projectName }: AgentStudioProps) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-fg">{projectName}</h1>
      <p className="text-fg/60">{STAGE_BADGE[stage]}</p>
    </div>
  );
}
