'use client';

import React, { useState } from 'react';

export type ScoreMetricId = 'acc' | 'prec' | 'rec' | 'f1';

export function MetricIcon({ id }: { id: ScoreMetricId }) {
  switch (id) {
    case 'acc':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case 'prec':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="22" y1="12" x2="18" y2="12" />
          <line x1="6" y1="12" x2="2" y2="12" />
          <line x1="12" y1="6" x2="12" y2="2" />
          <line x1="12" y1="22" x2="12" y2="18" />
        </svg>
      );
    case 'rec':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    case 'f1':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v18" />
          <path d="M3 7h18" />
          <path d="M5 7c0 3 3 5 7 5s7-2 7-5" />
          <path d="M7 21h10" />
        </svg>
      );
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function ConfusionHead({ predicted }: { predicted: string[] }) {
  const labels = predicted.length ? predicted : ['—'];
  return (
    <thead>
      <tr>
        <th className="e2-cm-corner" aria-hidden="true" />
        <th className="e2-cm-pred" colSpan={labels.length} scope="colgroup">
          Predicted
        </th>
      </tr>
      <tr>
        <th className="e2-cm-actual" scope="col">
          Actual
        </th>
        {labels.map((name) => (
          <th key={`pred-${name}`} scope="col" title={`Predicted ${name}`}>
            {name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function metricHelp(id: ScoreMetricId, label: string): string {
  const macro = /macro/i.test(label);
  switch (id) {
    case 'acc':
      return 'Accuracy: share of tickets sorted into the right category.';
    case 'prec':
      return macro
        ? 'Precision (macro): when it names a category, how often that is right — averaged across classes.'
        : 'Precision: when it names a category, how often that name is right.';
    case 'rec':
      return macro
        ? 'Recall (macro): of the real tickets in a category, how many it found — averaged across classes.'
        : 'Recall: of the real tickets in a category, how many it found.';
    case 'f1':
      return macro
        ? 'F1 (macro): a balance of precision and recall, averaged across classes.'
        : 'F1: one score that balances precision and recall.';
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

function metricTipPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const x = event.clientX + 14;
  const y = event.clientY + 16;
  if (typeof window === 'undefined') return { x, y };
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - 280)),
    y: Math.max(8, Math.min(y, window.innerHeight - 72)),
  };
}

export function Ex2Scorecard({
  items,
  highlight,
  running,
}: {
  items: { id: ScoreMetricId; label: string; value: string }[];
  highlight?: ScoreMetricId | null;
  running?: boolean;
}) {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const showTip = (metric: { id: ScoreMetricId; label: string }, event: { clientX: number; clientY: number }) => {
    setTip({ text: metricHelp(metric.id, metric.label), ...metricTipPoint(event) });
  };
  return (
    <div className={`e2-metrics${running ? ' live' : ''}`}>
      {items.map((metric) => (
        <div
          key={metric.id}
          className={`e2-metric e2-metric-${metric.id}${highlight === metric.id ? ' on' : ''}${running ? ' live' : ''}`}
          aria-label={`${metric.label}. ${metricHelp(metric.id, metric.label)}`}
          onMouseEnter={(event) => showTip(metric, event)}
          onMouseMove={(event) => showTip(metric, event)}
          onMouseLeave={() => setTip(null)}
        >
          <span className="e2-metric-ico">
            <MetricIcon id={metric.id} />
          </span>
          <span className="e2-metric-lbl">{metric.label}</span>
          <span className="e2-metric-val">{metric.value}</span>
        </div>
      ))}
      {tip ? (
        <p className="e2-metric-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </p>
      ) : null}
    </div>
  );
}

export function Ex2ConfusionMatrix({
  classes,
  matrix,
  highlightIndex,
  running,
}: {
  classes: string[];
  matrix: number[][];
  highlightIndex?: number;
  running?: boolean;
}) {
  const labels = classes.length ? classes : ['—'];
  return (
    <div
      className={`e2-cm-frame${running ? ' running' : ''}`}
      style={{ ['--e2-cm-n' as string]: Math.max(2, labels.length) }}
    >
      <table className="cm">
        <colgroup>
          <col className="e2-cm-stub" />
          {labels.map((name) => (
            <col key={`col-${name}`} className="e2-cm-val" />
          ))}
        </colgroup>
        <ConfusionHead predicted={labels} />
        <tbody>
          {labels.map((actual, rowIndex) => (
            <tr key={`actual-${actual}`} className={rowIndex === highlightIndex ? 'e3-cm-target-row' : undefined}>
              <th
                scope="row"
                title={`Actual ${actual}`}
                className={rowIndex === highlightIndex ? 'e3-cm-hi' : undefined}
              >
                {actual}
              </th>
              {labels.map((predicted, colIndex) => {
                const hit = rowIndex === highlightIndex || colIndex === highlightIndex;
                return (
                  <td
                    key={`${actual}-${predicted}`}
                    className={`e2-cm-cell${rowIndex === colIndex ? ' e2-cm-ok' : ' e2-cm-bad'}${hit ? ' e3-cm-hi' : ''}`}
                  >
                    {matrix[rowIndex]?.[colIndex] ?? 0}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
