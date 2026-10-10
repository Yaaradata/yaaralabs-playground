import React, { Suspense } from 'react';
import ScratchEditorContent from './ScratchEditorContent';

export default function ScratchEditorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ScratchEditorContent />
    </Suspense>
  );
}