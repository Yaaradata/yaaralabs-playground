import React, { useEffect, useMemo, useState } from 'react';
import type { TextPrepConfig } from '../types';
import {
  cleanNoteText,
  inspectDuplicates,
  inspectLeakage,
  inspectMissing,
  type InspectRow,
  type PackInspectStats,
} from './ex2TextPrep';

const SCAN_MS = 520;

type ScanKey = 'missing' | 'duplicates' | 'leakage';

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function noneOrCounts(parts: Array<{ count: number; one: string; many: string }>) {
  const bits = parts
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${part.count === 1 ? part.one : part.many}`);
  return bits.length ? bits.join(' · ') : 'None';
}

function ScanCheck({
  label,
  tone,
  busy,
  done,
  disabled,
  warn,
  answer,
  onScan,
}: {
  label: string;
  tone: ScanKey;
  busy: boolean;
  done: boolean;
  disabled: boolean;
  warn: boolean;
  answer: string;
  onScan: () => void;
}) {
  return (
    <div className={`e2-inspect-check ${tone}`}>
      <p>{label}</p>
      <button
        type="button"
        className={`e2-inspect-go${busy ? ' busy' : ''}${done ? ' done' : ''}`}
        disabled={disabled || done}
        aria-label={label}
        onClick={onScan}
      >
        <ArrowIcon />
      </button>
      {busy ? <b className="e2-inspect-answer">Scanning…</b> : null}
      {done ? <b className={`e2-inspect-answer${warn ? ' warn' : ''}`}>{answer}</b> : null}
    </div>
  );
}

function wordChips(text: string) {
  return text.split(/\s+/).filter(Boolean);
}

export function Ex2InspectModal({
  packName,
  classes,
  totalRows,
  rows,
  prep,
  packInspect,
  statsLoading,
  alreadyApplied,
  onChangePrep,
  onBack,
  onApply,
}: {
  packName: string;
  classes: string[];
  totalRows: number;
  rows: InspectRow[];
  prep: TextPrepConfig;
  packInspect?: PackInspectStats | null;
  statsLoading?: boolean;
  alreadyApplied?: boolean;
  onChangePrep: (next: TextPrepConfig) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  const [busy, setBusy] = useState<ScanKey | null>(null);
  const [missingRun, setMissingRun] = useState(Boolean(alreadyApplied));
  const [dupesRun, setDupesRun] = useState(Boolean(alreadyApplied));
  const [leakRun, setLeakRun] = useState(Boolean(alreadyApplied));
  const sampleMissing = useMemo(() => inspectMissing(rows), [rows]);
  const sampleDupes = useMemo(() => inspectDuplicates(rows), [rows]);
  const sampleLeaks = useMemo(() => inspectLeakage(rows, classes), [classes, rows]);
  const missing = packInspect
    ? { emptyText: packInspect.emptyText, emptyLabel: packInspect.emptyLabel }
    : sampleMissing;
  const dupes = packInspect
    ? { extra: packInspect.extra, groups: packInspect.groups }
    : sampleDupes;
  const leaks = packInspect
    ? { labelInText: packInspect.labelInText, mixedLabels: packInspect.mixedLabels }
    : sampleLeaks;
  const before = rows.find((row) => row.review.trim())?.review || '';
  const after = before
    ? cleanNoteText(before, { ...prep, stopwords: false, lemmatize: false })
    : '';
  const afterWords = new Set(wordChips(after).map((word) => word.toLowerCase()));

  useEffect(() => {
    setBusy(null);
    setMissingRun(Boolean(alreadyApplied));
    setDupesRun(Boolean(alreadyApplied));
    setLeakRun(Boolean(alreadyApplied));
  }, [alreadyApplied, packName]);

  const runScan = (key: ScanKey) => {
    if (busy || statsLoading) return;
    setBusy(key);
    window.setTimeout(() => {
      switch (key) {
        case 'missing':
          setMissingRun(true);
          break;
        case 'duplicates':
          setDupesRun(true);
          break;
        case 'leakage':
          setLeakRun(true);
          break;
        default: {
          const _never: never = key;
          return _never;
        }
      }
      setBusy(null);
    }, SCAN_MS);
  };

  const apply = () => {
    onChangePrep({ ...prep, stopwords: false, lemmatize: false });
    onApply();
  };

  const ready = missingRun && dupesRun && leakRun && rows.length > 0 && !statsLoading;

  return (
    <div className="e2-modal-back e2-inspect-back" role="presentation">
      <div
        className="e2-modal e2-modal-preview e2-inspect-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="e2-inspect-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="e2-modal-h e2-preview-h">
          <div className="e2-preview-heading">
            <button
              className="e2-btn e2-btn-icon e2-btn-back"
              type="button"
              onClick={onBack}
              aria-label="Back"
              title="Back"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h2 id="e2-inspect-title">Inspect and clean</h2>
            <div className="e2-preview-stats">
              <span className="e2-preview-stat pack">{packName}</span>
              <span className="e2-preview-stat samples">{totalRows.toLocaleString()} samples</span>
              <span className="e2-preview-stat classes">
                {classes.length} {classes.length === 1 ? 'class' : 'classes'}
              </span>
            </div>
          </div>
        </div>
        <div className="e2-inspect-page">
          <ScanCheck
            label="Check for Missing Values"
            tone="missing"
            busy={busy === 'missing'}
            done={missingRun}
            disabled={Boolean(busy) || Boolean(statsLoading)}
            warn={missing.emptyText + missing.emptyLabel > 0}
            answer={noneOrCounts([
              { count: missing.emptyText, one: 'empty text', many: 'empty texts' },
              { count: missing.emptyLabel, one: 'empty label', many: 'empty labels' },
            ])}
            onScan={() => runScan('missing')}
          />
          <ScanCheck
            label="Check for Duplicates"
            tone="duplicates"
            busy={busy === 'duplicates'}
            done={dupesRun}
            disabled={Boolean(busy) || Boolean(statsLoading)}
            warn={dupes.extra + dupes.groups > 0}
            answer={noneOrCounts([
              { count: dupes.extra, one: 'extra copy', many: 'extra copies' },
              { count: dupes.groups, one: 'repeated note', many: 'repeated notes' },
            ])}
            onScan={() => runScan('duplicates')}
          />
          <ScanCheck
            label="Check for Leakage"
            tone="leakage"
            busy={busy === 'leakage'}
            done={leakRun}
            disabled={Boolean(busy) || Boolean(statsLoading)}
            warn={leaks.labelInText + leaks.mixedLabels > 0}
            answer={noneOrCounts([
              { count: leaks.labelInText, one: 'class in the text', many: 'classes in the text' },
              { count: leaks.mixedLabels, one: 'mixed label', many: 'mixed labels' },
            ])}
            onScan={() => runScan('leakage')}
          />

          <section className="e2-inspect-block">
            <div className="e2-inspect-row">
              <header>
                <b>Clean</b>
              </header>
              <div className="e2-inspect-toggles pair">
                <button
                  type="button"
                  className={`e2-inspect-toggle${prep.lowercase ? ' on' : ''}`}
                  aria-pressed={prep.lowercase}
                  onClick={() => onChangePrep({ ...prep, lowercase: !prep.lowercase, stopwords: false, lemmatize: false })}
                >
                  <b>Lowercase</b>
                  <span>Login = login</span>
                </button>
                <button
                  type="button"
                  className={`e2-inspect-toggle${prep.stripNoise ? ' on' : ''}`}
                  aria-pressed={prep.stripNoise}
                  onClick={() => onChangePrep({ ...prep, stripNoise: !prep.stripNoise, stopwords: false, lemmatize: false })}
                >
                  <b>Strip noise</b>
                  <span>URLs, emoji, symbols</span>
                </button>
              </div>
            </div>
            {before ? (
              <div className="e2-inspect-diff">
                <div>
                  <h3>Before</h3>
                  <div className="e2-inspect-words">
                    {wordChips(before).map((word, index) => (
                      <span
                        key={`b-${word}-${index}`}
                        className={`e2-inspect-word${afterWords.has(word.toLowerCase()) ? '' : ' gone'}`}
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3>After</h3>
                  <div className="e2-inspect-words">
                    {wordChips(after).map((word, index) => (
                      <span key={`a-${word}-${index}`} className="e2-inspect-word keep">
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
        <div className="e2-preview-foot">
          <span className="e2-inspect-muted">
            {statsLoading
              ? 'Loading pack checks…'
              : ready
                ? packInspect
                  ? `Ready · checked all ${packInspect.nRows.toLocaleString()} notes`
                  : 'Ready to apply'
                : packInspect
                  ? `Scan the full pack of ${packInspect.nRows.toLocaleString()} notes`
                  : 'Scan missing, copies, and leakage'}
          </span>
          <button className="e2-btn e2-btn-train" type="button" disabled={!ready} onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
