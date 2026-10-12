'use client';

/**
 * Label a sample dataset, then "Group it": every chosen label becomes a project label with its
 * queries inside, exactly like labels added by hand. Choices are kept in this browser as a draft.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MIN_PER_LABEL,
  SAMPLE_SOURCES,
  canGroup,
  countByLabel,
  examplesToAdd,
  fillAllLabels,
  labelledCount,
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
              <span className="block text-xs text-fg/60 mt-0.5">36 client messages to sort into 6 labels</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────── Labelling table ───────── */

type Filter = 'all' | 'unlabelled' | string;

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
  const [filter, setFilter] = useState<Filter>('all');
  const [showGuide, setShowGuide] = useState(false);
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

  const fillLabels = () => {
    if (!data) return;
    const next = fillAllLabels(data.queries);
    setChoices(next);
    writeDraft(draftKey, next);
    setNotice(null);
  };

  const counts = useMemo(() => (data ? countByLabel(data.labels, choices) : {}), [data, choices]);
  const done = data ? labelledCount(choices) : 0;
  const ready = !!data && canGroup(data.labels, choices);
  const rows = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data.queries;
    if (filter === 'unlabelled') return data.queries.filter((q) => !choices[q.id]);
    return data.queries.filter((q) => choices[q.id] === filter);
  }, [data, filter, choices]);
  const short = data
    ? data.labels.filter((l) => (counts[l.label] ?? 0) < MIN_PER_LABEL).map((l) => `${l.label} (${counts[l.label] ?? 0})`)
    : [];

  const group = async () => {
    if (!data || !ready) return;
    const items = examplesToAdd(data.queries, choices, existing);
    if (items.length === 0) {
      setNotice('All of these are already in your project. Nothing new to add.');
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
            {/* progress + filter */}
            <div className="px-5 sm:px-6 py-3 border-b border-fg/10 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-sm font-semibold">
                  Labelled {done} of {data.queries.length}
                </span>
                <button type="button" className="text-xs text-pink-brand hover:underline" onClick={() => setShowGuide((v) => !v)} aria-expanded={showGuide}>
                  {showGuide ? 'Hide what each label means' : 'What each label means'}
                </button>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={fillLabels}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-magenta-brand/50 text-fg hover:bg-purple-brand/10 text-sm font-medium disabled:opacity-40"
                >
                  Fill labels
                </button>
                <label className="text-sm text-fg/70 inline-flex items-center gap-2">
                  Show
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="bg-canvas border border-magenta-brand/40 rounded px-2 py-1.5 text-sm text-fg focus:outline-none focus:border-pink-brand"
                  >
                    <option value="all">All queries</option>
                    <option value="unlabelled">Unlabelled</option>
                    {data.labels.map((l) => (
                      <option key={l.label} value={l.label}>{l.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Examples per label">
                {data.labels.map((l) => {
                  const n = counts[l.label] ?? 0;
                  const ok = n >= MIN_PER_LABEL;
                  return (
                    <button
                      type="button"
                      key={l.label}
                      onClick={() => setFilter(filter === l.label ? 'all' : l.label)}
                      title={`Show only ${l.label}`}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        ok ? 'border-[var(--success)] text-[var(--success)] bg-[var(--success)]/10' : 'border-fg/20 text-fg/80'
                      } ${filter === l.label ? 'ring-2 ring-pink-brand/50' : ''}`}
                    >
                      {ok && (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {l.label} <span className="tabular-nums">{n} / {MIN_PER_LABEL}</span>
                    </button>
                  );
                })}
              </div>
              {showGuide && (
                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs bg-surface border border-fg/10 rounded-lg p-3">
                  {data.labels.map((l) => (
                    <div key={l.label}>
                      <dt className="font-semibold text-fg">{l.label} <span className="font-normal text-fg/50">· {l.desk}</span></dt>
                      <dd className="text-fg/70">{l.covers}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

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
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-10 text-center text-fg/50">
                        {filter === 'unlabelled' ? 'Every query has a label.' : 'No queries here yet.'}
                      </td>
                    </tr>
                  )}
                  {rows.map((q) => (
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
            <div className="px-5 sm:px-6 py-4 border-t border-fg/10 flex flex-wrap items-center gap-3">
              <span className="flex-1" />
              <div className="flex flex-col items-end gap-1">
                <button
                  type="button"
                  onClick={group}
                  disabled={!ready || busy}
                  className="bg-purple-brand hover:bg-purple-brand/90 text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {busy ? 'Grouping…' : 'Group it'}
                </button>
                {!ready && short.length > 0 && (
                  <span className="text-xs text-fg/60 text-right">Needs {MIN_PER_LABEL} each: {short.join(', ')}</span>
                )}
                {ready && !busy && (
                  <span className="text-xs text-fg/60 text-right">
                    Each label becomes a box on the page with its queries inside. Unlabelled queries are left out.
                  </span>
                )}
              </div>
              {notice && <p className="w-full text-sm text-fg/70" role="status">{notice}</p>}
              {error && <p className="w-full text-sm text-pink-brand" role="alert">{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
