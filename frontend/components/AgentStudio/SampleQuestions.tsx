'use client';

import { useEffect, useState } from 'react';
import { sampleQuestions } from './api';
import type { SampleGroup } from './types';
import { Spinner } from './ui';

/** Sample questions drawer: clicking a question sends it. The trainer answer hides behind "Show answer". */
export default function SampleQuestions({ agentId, sessionId, onAsk, onClose, disabled }: {
  agentId: string; sessionId: string; onAsk: (text: string) => void; onClose: () => void; disabled?: boolean;
}) {
  const [groups, setGroups] = useState<SampleGroup[] | null>(null);
  const [err, setErr] = useState('');
  const [shown, setShown] = useState<Record<string, boolean>>({});

  useEffect(() => {
    sampleQuestions(agentId, sessionId).then(setGroups).catch((e: Error) => setErr(e.message));
  }, [agentId, sessionId]);

  return (
    <aside className="as-drawer" aria-label="Sample questions">
      <div className="flex items-center justify-between px-4 py-3 border-b border-magenta-brand/15">
        <h3 className="font-semibold text-fg">Sample questions</h3>
        <button type="button" onClick={onClose} className="text-fg/60 hover:text-fg" aria-label="Close sample questions">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {err && <p className="text-sm text-red-500">{err}</p>}
        {!groups && !err && <div className="flex items-center gap-2 text-sm text-fg/60"><Spinner /> Loading…</div>}
        {groups?.map((g) => (
          <section key={g.title}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-fg/60 mb-2">{g.title}</h4>
            <ul className="space-y-2">
              {g.questions.map((q) => (
                <li key={q.id} className="rounded-lg border border-magenta-brand/15 bg-card p-2.5">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onAsk(q.text)}
                    className="text-left text-sm text-fg hover:text-pink-brand disabled:opacity-50 w-full"
                  >
                    {q.text}
                  </button>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {q.note && <span className="as-chip">{q.note}</span>}
                    {q.answer && (
                      <button
                        type="button"
                        className="text-xs text-fg/50 hover:text-fg underline-offset-2 hover:underline"
                        onClick={() => setShown({ ...shown, [q.id]: !shown[q.id] })}
                        aria-expanded={Boolean(shown[q.id])}
                      >
                        {shown[q.id] ? 'Hide answer' : 'Show answer'}
                      </button>
                    )}
                  </div>
                  {shown[q.id] && (
                    <p className="text-xs text-fg/70 mt-1.5">
                      {q.answer}
                      {q.where && q.where !== '—' ? <span className="text-fg/50"> ({q.where})</span> : null}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}
