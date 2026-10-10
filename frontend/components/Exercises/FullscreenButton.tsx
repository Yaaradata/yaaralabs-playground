'use client';

import { useEffect, useState, type ButtonHTMLAttributes, type RefObject } from 'react';
import {
  canRequestFullscreen,
  isElementFullscreen,
  subscribeFullscreen,
  toggleElementFullscreen,
} from './fullscreen';

type FullscreenButtonProps = {
  targetRef: RefObject<HTMLElement | null>;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'children' | 'title' | 'aria-label'>;

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}

/** Icon button that toggles native fullscreen on `targetRef` (same as Rule Based Classifier). */
export default function FullscreenButton({ targetRef, className, ...rest }: FullscreenButtonProps) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(canRequestFullscreen(targetRef.current));
    setActive(isElementFullscreen(targetRef.current));
    return subscribeFullscreen(() => {
      setActive(isElementFullscreen(targetRef.current));
    });
  }, [targetRef]);

  if (!supported) return null;

  const label = active ? 'Exit full screen' : 'Full screen';

  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => {
        const el = targetRef.current;
        if (!el) return;
        void toggleElementFullscreen(el).catch(() => undefined);
      }}
      {...rest}
    >
      {active ? <CompressIcon /> : <ExpandIcon />}
    </button>
  );
}
