'use client';

/** Rule Based Process projects built in the external Scratch editor keep opening there. */

import config from '../../lib/config';

interface Props {
  projectName: string;
  sessionId: string | null;
  projectId: string;
}

export default function ScratchLauncher({ projectName, sessionId, projectId }: Props) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-2xl font-semibold text-fg">{projectName}</h2>
      <p className="max-w-md text-fg/70">
        This project is built in Scratch. Your work is saved automatically and opens where you left off.
      </p>
      <button
        onClick={() => {
          if (!sessionId) return;
          window.open(
            `${config.scratchEditor.gui}?sessionId=${encodeURIComponent(sessionId)}&projectId=${encodeURIComponent(projectId)}&mode=rbp`,
            '_blank'
          );
        }}
        className="bg-purple-brand text-white px-8 py-4 rounded-lg text-lg font-medium hover:scale-105 transition-all duration-300"
      >
        Open in Scratch
      </button>
    </div>
  );
}
