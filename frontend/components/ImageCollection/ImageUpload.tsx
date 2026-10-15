'use client';

import { useState } from 'react';
import { labelProblem, LABEL_MAX } from '../../lib/labels';

interface ImageUploadProps {
  /** Labels the project already has (case-only duplicates are refused). */
  existingLabels: string[];
  /** Create the (still empty) label; its card on the right then takes images with "Add images". */
  onAddLabel: (label: string) => void;
  projectType: string;
}

/** "Add labels": name a label first; images are added per label in the list on the right. */
export default function ImageUpload({ existingLabels, onAddLabel, projectType }: ImageUploadProps) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (projectType !== 'image-recognition') {
    return (
      <div className="text-center py-8">
        <p className="text-fg/70">Image upload is only available for Image Recognition projects.</p>
      </div>
    );
  }

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    const problem = labelProblem(name, existingLabels);
    if (problem) {
      setError(problem);
      return;
    }
    onAddLabel(name);
    setLabel('');
    setError(null);
  };

  return (
    <form onSubmit={add} className="space-y-3" noValidate>
      <div>
        <label htmlFor="image-label" className="sr-only">Label name</label>
        <input
          id="image-label"
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); setError(null); }}
          maxLength={LABEL_MAX}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'image-label-error' : undefined}
          placeholder="e.g. Invoice"
          className="w-full px-3 py-2 bg-canvas border border-magenta-brand/30 rounded-lg text-sm text-fg placeholder-fg/50 focus:border-pink-brand focus:outline-none"
        />
        {error && <p id="image-label-error" className="mt-1 text-sm text-pink-brand" role="alert">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={!label.trim()}
        className="w-full bg-purple-brand text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-purple-brand/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add label
      </button>
      <p className="text-xs text-fg/50">
        Then use <span className="font-medium text-fg/70">Add images</span> on the label. JPEG, PNG, GIF, WebP · 10 MB each.
      </p>
    </form>
  );
}
