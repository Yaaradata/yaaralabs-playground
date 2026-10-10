'use client';

import React from 'react';
import type { NamedExample } from './examples';

export function Alert({
  kind,
  children,
}: {
  kind: 'error' | 'warn' | 'info';
  children: React.ReactNode;
}) {
  const cls =
    kind === 'error'
      ? 'border-red-400/40 bg-red-400/10 text-red-200'
      : kind === 'warn'
        ? 'border-amber-300/40 bg-amber-300/10 text-amber-200'
        : 'border-fg/15 bg-fg/5 text-fg/70';
  return <div className={`rounded-lg border px-3 py-2 text-xs ${cls}`}>{children}</div>;
}

export function ExampleBar({
  examples,
  activeId,
  onPick,
}: {
  examples: NamedExample[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-fg/50">10 real-world examples</div>
      <div className="flex flex-wrap gap-1.5">
        {examples.map((example, index) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onPick(example.id)}
            title={example.hint}
            className={`px-2 py-1 rounded-full text-[11px] border ${
              activeId === example.id
                ? 'border-pink-brand text-pink-brand bg-purple-brand/10'
                : 'border-fg/15 text-fg/70 hover:text-fg'
            }`}
          >
            {index + 1}
          </button>
        ))}
      </div>
      {examples.find((e) => e.id === activeId) ? (
        <p className="text-xs text-fg/55">
          <span className="text-pink-brand">
            {examples.find((e) => e.id === activeId)?.title}
          </span>
          {' — '}
          {examples.find((e) => e.id === activeId)?.hint}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-fg/45 text-sm">{children}</p>;
}
