'use client';

import type { CSSProperties } from 'react';
import { LAB_BUDDY_SVG } from './labBuddySvg';

export type LabBuddyMood =
  | 'sleep'
  | 'idle'
  | 'listen'
  | 'type'
  | 'think'
  | 'speak'
  | 'cheer'
  | 'wait';

const MOODS: readonly LabBuddyMood[] = [
  'sleep',
  'idle',
  'listen',
  'type',
  'think',
  'speak',
  'cheer',
  'wait',
] as const;

function isMood(value: string): value is LabBuddyMood {
  return (MOODS as readonly string[]).includes(value);
}

/** Map coach / agent face labels used across labs onto LabBuddy moods. */
export function toLabBuddyMood(raw: string | undefined | null): LabBuddyMood {
  const key = String(raw || 'idle').toLowerCase();
  if (isMood(key)) return key;
  switch (key) {
    case 'look':
      return 'idle';
    case 'happy':
      return 'cheer';
    case 'sad':
      return 'wait';
    case 'using':
    case 'busy':
      return 'type';
    case 'still':
      return 'idle';
    default:
      return 'idle';
  }
}

export interface LabBuddyProps {
  mood?: LabBuddyMood | string;
  className?: string;
  size?: number;
  /** Accessible name; decorative by default. */
  label?: string;
}

/** Floating white lab robot — shared mascot with mood faces. */
export default function LabBuddy({ mood = 'idle', className = '', size, label }: LabBuddyProps) {
  const face = toLabBuddyMood(String(mood));
  const classes = ['lab-buddy', className].filter(Boolean).join(' ');
  const style: CSSProperties | undefined = size
    ? ({ width: size, height: size, ['--lab-buddy-size' as string]: `${size}px` } as CSSProperties)
    : undefined;
  return (
    <div
      className={classes}
      data-mood={face}
      style={style}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      // SVG string is authored in-repo (no user input).
      dangerouslySetInnerHTML={{ __html: LAB_BUDDY_SVG }}
    />
  );
}

/** HTML snippet for mount labs (vanilla DOM mounts). */
export function labBuddyHtml(opts?: {
  id?: string;
  mood?: string;
  className?: string;
  size?: number;
}): string {
  const id = opts?.id ? ` id="${opts.id}"` : '';
  const mood = toLabBuddyMood(opts?.mood);
  const extra = opts?.className ? ` ${opts.className}` : '';
  const size =
    opts?.size != null
      ? ` style="width:${opts.size}px;height:${opts.size}px;--lab-buddy-size:${opts.size}px"`
      : '';
  return `<div class="lab-buddy${extra}"${id} data-mood="${mood}"${size} aria-hidden="true">${LAB_BUDDY_SVG}</div>`;
}
