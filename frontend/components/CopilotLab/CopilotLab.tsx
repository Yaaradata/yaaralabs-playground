'use client';

export interface CopilotLabProps {
  activity: 'ethics' | 'document-ai';
  projectName: string;
  sessionId: string;
  projectId: string;
}

/** Copilot labs (Ex 9, Ex 10). Filled in by part B. */
export default function CopilotLab({ projectName }: CopilotLabProps) {
  return <div className="p-6 text-fg">{projectName}</div>;
}
