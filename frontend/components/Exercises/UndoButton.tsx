'use client';

import type { ButtonHTMLAttributes } from 'react';

type UndoButtonProps = {
  canUndo: boolean;
  onUndo: () => void;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'disabled' | 'children' | 'title' | 'aria-label'>;

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.9L3 13" />
    </svg>
  );
}

/** Shared Undo control for React exercise labs. Icon-only; disabled when the stack is empty. */
export default function UndoButton({ canUndo, onUndo, className, ...rest }: UndoButtonProps) {
  const tip = canUndo ? 'Undo the last change' : 'Nothing to undo';
  return (
    <button
      type="button"
      className={className}
      disabled={!canUndo}
      title={tip}
      aria-label={tip}
      onClick={() => {
        if (!canUndo) return;
        onUndo();
      }}
      {...rest}
    >
      <UndoIcon />
    </button>
  );
}
