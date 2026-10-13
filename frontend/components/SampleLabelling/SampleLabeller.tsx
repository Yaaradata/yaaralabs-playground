'use client';

/**
 * Label a sample dataset, then "Finish": every chosen label becomes a project label with its
 * queries inside, exactly like labels added by hand. Choices are kept in this browser as a draft.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MIN_PER_LABEL,
  SAMPLE_SOURCES,
  canGroup,
  countByLabel,
  examplesToAdd,
  inOtherLabel,
  validateDataset,
  type Choices,
  type NewExample,
  type SampleDataset,
  type SampleSource,
} from './sample';

/* ───────── "Use sample data" dropdown ───────── */

export function SampleDataButton({ onPick, compact }: { onPick: (s: SampleSource) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`border-2 border-purple-brand text-purple-brand hover:bg-purple-brand/10 rounded-lg transition-all duration-300 inline-flex items-center gap-2 text-sm font-medium ${compact ? 'px-4 py-2' : 'px-4 py-4'}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h10" />
        </svg>
        Use sample data
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-80 bg-card border border-magenta-brand/30 rounded-lg shadow-xl z-40 overflow-hidden">
          {SAMPLE_SOURCES.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(s);
              }}
              className="w-full text-left px-4 py-3 hover:bg-purple-brand/10 focus:bg-purple-brand/10 focus:outline-none"
            >
              <span className="block text-sm font-medium text-fg">{s.name}</span>
              <span className="block text-xs text-fg/60 mt-0.5">20 client messages to sort into 4 labels</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── Labelling table ───────── */

interface Props {
  source: SampleSource;
  draftKey: string; // per project, so each project keeps its own draft
  existing: { label: string; texts: string[] }[];
  onClose: () => void;
  /** Adds the examples to the project; resolves when the page has them. */
  onGroup: (items: NewExample[]) => Promise<void>;
}

function readDraft(key: string): Choices {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Choices) : {};
  } catch {
    return {};
  }
}
function writeDraft(key: string, choices: Choices) {
  try {
    localStorage.setItem(key, JSON.stringify(choices));
  } catch {
    /* a draft is only a convenience */
  }
}

export default function SampleLabeller({ source, draftKey, existing, onClose, onGroup }: Props) {
  const [data, setData] = useState<SampleDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(source.url)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the sample data (${r.status}).`);
        return r.json();
      })
      .then((raw) => {
        if (!alive) return;
        setData(validateDataset(raw));
        setChoices(readDraft(draftKey));
      })
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : 'Could not load the sample data.'));
    return () => {
      alive = false;
    };
  }, [source.url, draftKey]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [busy, onClose]);

  const choose = (id: number, label: string) => {
    setChoices((c) => {
      const next = { ...c, [id]: label };
      if (!label) delete next[id];
      writeDraft(draftKey, next);
      return next;
    });
    setNotice(null);
  };

  const counts = useMemo(() => (data ? countByLabel(data.labels, choices) : {}), [data, choices]);
  const ready = !!data && canGroup(data.labels, choices);

  const group = async () => {
    if (!data || !ready) return;
    const items = examplesToAdd(data.queries, choices, existing);
    const moved = inOtherLabel(data.queries, choices, existing);
    if (items.length === 0) {
      setNotice(
        moved.length
          ? `Nothing new to add. ${moved.length} ${moved.length === 1 ? 'query is' : 'queries are'} already under another label in your project: ${moved.map((m) => `"${m.text}" (in ${m.current})`).join(', ')}. To move ${moved.length === 1 ? 'it' : 'them'}, delete ${moved.length === 1 ? 'it' : 'them'} from that label first.`
          : 'All of these are already in your project. Nothing new to add.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onGroup(items);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the examples. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sample-title">
      <div className="bg-card text-fg border border-magenta-brand/30 rounded-xl w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl">
        {/* header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-fg/10 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-pink-brand">Sample data</p>
            <h2 id="sample-title" className="text-xl font-semibold mt-1">{source.name}</h2>
            <p className="text-sm text-fg/70 mt-1">
              Pick a label for each query. You need at least {MIN_PER_LABEL} per label to train.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-fg/60 hover:text-fg p-1 rounded disabled:opacity-40" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {loadError && <p className="px-6 py-8 text-sm text-pink-brand" role="alert">{loadError}</p>}
        {!data && !loadError && <p className="px-6 py-8 text-sm text-fg/60">Loading the queries…</p>}

        {data && (
          <>
            {/* table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="text-left text-xs uppercase tracking-wider text-fg/50">
                    <th className="px-5 sm:px-6 py-2.5 w-12 font-semibold border-b border-fg/10">#</th>
                    <th className="px-3 py-2.5 font-semibold border-b border-fg/10">Customer query</th>
                    <th className="px-5 sm:px-6 py-2.5 w-64 font-semibold border-b border-fg/10">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queries.map((q) => (
                    <tr key={q.id} className="align-top border-b border-fg/5">
                      <td className="px-5 sm:px-6 py-3 text-fg/50 tabular-nums">{q.id}</td>
                      <td className="px-3 py-3">
                        <p className="text-fg leading-relaxed">{q.text}</p>
                      </td>
                      <td className="px-5 sm:px-6 py-3">
                        <select
                          aria-label={`Label for query ${q.id}`}
                          value={choices[q.id] ?? ''}
                          onChange={(e) => choose(q.id, e.target.value)}
                          disabled={busy}
                          className={`w-full bg-canvas border rounded px-2 py-2 text-sm focus:outline-none focus:border-pink-brand ${
                            choices[q.id] ? 'border-magenta-brand/50 text-fg' : 'border-fg/20 text-fg/60'
                          }`}
                        >
                          <option value="">Choose…</option>
                          {data.labels.map((l) => (
                            <option key={l.label} value={l.label}>{l.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-fg/10 space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex flex-nowrap items-center gap-1.5 flex-1 min-w-0 overflow-x-auto" aria-label="Examples per label">
                  {data.labels.map((l) => {
                    const n = counts[l.label] ?? 0;
                    const ok = n >= MIN_PER_LABEL;
                    return (
                      <span
                        key={l.label}
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 ${
                          ok ? 'border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10' : 'border-fg/20 text-fg/80'
                        }`}
                      >
                        {ok && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {l.label} <span className="tabular-nums">{n} / {MIN_PER_LABEL}</span>
                      </span>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={group}
                  disabled={!ready || busy}
                  className="bg-purple-brand hover:bg-purple-brand/90 text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2 shrink-0"
                >
                  {busy ? 'Finishing…' : 'Finish'}
                </button>
              </div>
              {notice && <p className="text-sm text-fg/70" role="status">{notice}</p>}
              {error && <p className="text-sm text-pink-brand" role="alert">{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
