'use client';

/**
 * Unseen test messages from the sample file, for projects that use the sample's labels. The page
 * shows a "Test data" button when useSampleTestSet returns a set, and this table when it is open.
 * Each message goes through the same prediction call as the test box.
 */

import { useEffect, useMemo, useState } from 'react';
import { SAMPLE_SOURCES, projectLabelName, usesSampleLabels, validateDataset, type SampleDataset } from './sample';

export interface Prediction {
  label: string;
  confidence: number; // percent, as the test box shows it
}

const NONE = 'None of these';
export const LOW_CONFIDENCE = 50; // below this the model is unsure

/** The sample test set when this project uses the sample's labels, else null. */
export function useSampleTestSet(projectLabels: string[]): SampleDataset | null {
  const [data, setData] = useState<SampleDataset | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(SAMPLE_SOURCES[0].url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => alive && setData(validateDataset(raw)))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, []);
  const key = projectLabels.join('|');
  return useMemo(() => (data && usesSampleLabels(data, key ? key.split('|') : []) ? data : null), [data, key]);
}

interface Props {
  data: SampleDataset;
  predict: (text: string) => Promise<Prediction>;
}

export default function SampleTestMessages({ data, predict }: Props) {
  const [results, setResults] = useState<Record<number, Prediction | 'error'>>({});
  const [running, setRunning] = useState<Set<number>>(new Set());

  const run = async (id: number, text: string) => {
    setRunning((s) => new Set(s).add(id));
    try {
      const p = await predict(text);
      setResults((r) => ({ ...r, [id]: p }));
    } catch {
      setResults((r) => ({ ...r, [id]: 'error' }));
    } finally {
      setRunning((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };
  const runAll = async () => {
    for (const t of data.test) await run(t.id, t.text); // one at a time: same as clicking each
  };

  const summary = useMemo(() => {
    const inScope = data.test.filter((t) => t.expected !== NONE);
    const scored = inScope.filter((t) => results[t.id] && results[t.id] !== 'error');
    if (scored.length === 0) return null;
    const right = scored.filter((t) => (results[t.id] as Prediction).label === projectLabelName(t.expected)).length;
    return { right, scored: scored.length, total: inScope.length };
  }, [data, results]);

  return (
    <div>
      <>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <p className="flex-1 min-w-0 text-sm text-fg/60">Messages the model has never seen. Click a row to test it.</p>
            {summary && (
              <span className="text-sm text-fg" aria-live="polite">
                <b>{summary.right} of {summary.scored}</b> correct
                {summary.scored < summary.total ? ` (${summary.total - summary.scored} not tested yet)` : ''}
              </span>
            )}
            <button
              type="button"
              onClick={runAll}
              disabled={running.size > 0}
              className="px-4 py-2 rounded-lg border border-magenta-brand/50 text-fg hover:bg-purple-brand/10 text-sm font-medium disabled:opacity-40"
            >
              Test all {data.test.length}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-magenta-brand/20">
            <table className="w-full min-w-[40rem] text-sm text-left border-collapse">
              <thead>
                <tr className="bg-canvas border-b border-magenta-brand/20 text-fg/70">
                  <th scope="col" className="px-4 py-2 font-medium">Text</th>
                  <th scope="col" className="px-4 py-2 font-medium whitespace-nowrap">Expected</th>
                  <th scope="col" className="px-4 py-2 font-medium whitespace-nowrap">Model output</th>
                  <th scope="col" className="px-4 py-2 font-medium whitespace-nowrap">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {data.test.map((t) => {
                  const res = results[t.id];
                  const busy = running.has(t.id);
                  const outOfScope = t.expected === NONE;
                  const expectedLabel = outOfScope ? NONE : projectLabelName(t.expected);
                  const pred = res && res !== 'error' ? res : null;
                  const correct = pred && !outOfScope && pred.label === expectedLabel;
                  const wrong = pred && !outOfScope && !correct;

                  return (
                    <tr
                      key={t.id}
                      onClick={() => !busy && run(t.id, t.text)}
                      onKeyDown={(e) => {
                        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          run(t.id, t.text);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Test message: ${t.text}`}
                      aria-busy={busy}
                      className={`border-b border-magenta-brand/10 last:border-b-0 transition-colors ${
                        busy ? 'opacity-70 cursor-wait' : 'cursor-pointer hover:bg-purple-brand/5'
                      }`}
                    >
                      <td className="px-4 py-2 text-fg align-top">
                        &ldquo;{t.text}&rdquo;
                      </td>
                      <td className="px-4 py-2 text-fg/80 align-top whitespace-nowrap">{expectedLabel}</td>
                      <td className="px-4 py-2 align-top whitespace-nowrap">
                        {busy && <span className="text-fg/60">Testing…</span>}
                        {res === 'error' && !busy && (
                          <span className="text-pink-brand">Could not test</span>
                        )}
                        {pred && !busy && (
                          <span className={wrong ? 'text-pink-brand font-medium' : correct ? 'text-[var(--success)] font-medium' : 'text-fg font-medium'}>
                            {pred.label}
                          </span>
                        )}
                        {!busy && !res && <span className="text-fg/40">—</span>}
                      </td>
                      <td className="px-4 py-2 align-top whitespace-nowrap tabular-nums">
                        {busy && <span className="text-fg/60">…</span>}
                        {pred && !busy && (
                          <span className="text-fg/80">{pred.confidence.toFixed(1)}%</span>
                        )}
                        {!busy && !pred && <span className="text-fg/40">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      </>
    </div>
  );
}
