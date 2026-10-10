'use client';

import type { ExerciseId } from './types';
import { exerciseHeaderIconSvg } from './exerciseHeaderIcons';

type ExerciseHeaderIconProps = {
  id: ExerciseId;
  className?: string;
};

/** React wrapper for the per-exercise header glyph. */
export default function ExerciseHeaderIcon({ id, className }: ExerciseHeaderIconProps) {
  return (
    <span
      className={className ? `ex-lab-brand-icon ${className}` : 'ex-lab-brand-icon'}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: exerciseHeaderIconSvg(id) }}
    />
  );
}
