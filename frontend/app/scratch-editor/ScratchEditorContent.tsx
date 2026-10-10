'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import ScratchEditorLauncher from '../../components/ScratchEditor/ScratchEditorLauncher';

export default function ScratchEditorContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId');
  const sessionId = searchParams.get('sessionId');

  return (
    <ScratchEditorLauncher
      projectId={projectId || undefined}
      sessionId={sessionId || undefined}
    />
  );
}
