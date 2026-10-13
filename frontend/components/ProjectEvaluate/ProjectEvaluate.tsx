'use client';

/**
 * Evaluate step for Text and Image Recognition projects (senior learners, read on a projector).
 * The exam, then: accuracy, where it got confused (grid), right per desk (graph) and the desk that
 * matters most (recall and precision as dots). Plain words only: accuracy, precision, recall.
 *   text   the /evaluate endpoint scores the sample's test messages (or the learner's own examples)
 *   image  this page sends each sample test image through the same upload + predict calls as the
 *          training page (standard set, or the harder handwritten and damaged set)
 * All numbers come from evaluate.ts.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import config from '../../lib/config';
import { SAMPLE_SOURCES, validateDataset } from '../SampleLabelling/sample';
import {
  labelNamesKey,
  loadSampleImages,
  readLabelNames,
  sampleImageFile,
  sampleImageUrl,
  type SampleImageTestItem,
} from '../SampleImages/sampleImages';
import {
  accuracy,
  cellItems,
  defaultDesk,
  deskAtLean,
  deskDots,
  deskNoun,
  examItems,
  grid,
  hiddenWeakDeskLine,
  mostMissesLine,
  offTopicLine,
  orderLabels,
  perDesk,
  shortName,
  type DeskBar,
  type DeskResult,
  type EvalItem,
  type EvalResponse,
  type Unit,
} from './evaluate';

interface Props {
  sessionId: string;
  projectId: string;
  learnHref: string;
  kind?: 'text' | 'image';
}

type ImageItem = { file: string; expected: string; title: string };
type Setup = {
  trained: boolean;
  labels: string[]; // for images: in the sample's order (KYC, Corporate action, Invoice, Cheque)
  items: { text: string; expected: string }[]; // text exam ([] = own examples)
  images?: { standard: ImageItem[]; deep: ImageItem[] }; // image exam (undefined = labels don't match)
};

/** The sample's test images with the project's label names, or undefined if the labels don't match. */
function imageExam(test: SampleImageTestItem[], prefix: string, labels: string[], renamed: Record<string, string>): ImageItem[] | undefined {
  const have = new Set(labels);
  const items = test.map((t, i) => ({
    file: t.file,
    expected: renamed[t.expected] ?? t.expected,
    // a name that does not give the answer away
    title: `${prefix} ${String(i + 1).padStart(2, '0')}`,
  }));
  return items.length && items.every((i) => have.has(i.expected)) ? items : undefined;
}

const card = 'bg-card border border-magenta-brand/20 rounded-2xl p-5 md:p-6';
const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-lg font-semibold transition-colors';

export default function ProjectEvaluate({ sessionId, projectId, learnHref, kind = 'text' }: Props) {
  const base = `${config.apiBaseUrl}/api/guests/session/${sessionId}/projects/${projectId}`;
  const [setup, setSetup] = useState<Setup | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<EvalResponse | null>(null);
  const [imageSet, setImageSet] = useState<'standard' | 'deep'>('standard');

  // Trained? With which labels? Do they match the sample's exam?
  useEffect(() => {
    let alive = true;
    (async () => {
      let trained = false;
      let labels: string[] = [];
      let items: Setup['items'] = [];
      try {
        const d = (await fetch(base).then((r) => r.json()))?.data ?? {};
        trained = d.status === 'trained';
        labels = (d.model?.labels?.length ? d.model.labels : d.dataset?.labels ?? []).map(String);
        if (kind === 'image') {
          const sample = await loadSampleImages();
          const renamed = readLabelNames(labelNamesKey(sessionId, projectId));
          const standard = imageExam(sample.test, 'Test', labels, renamed);
          const deep = imageExam(sample.deepTest ?? [], 'Deep', labels, renamed);
          const inSampleOrder = [
            ...sample.labels.map((l) => renamed[l.label] ?? l.label).filter((l) => labels.includes(l)),
            ...labels.filter((l) => !sample.labels.some((s) => (renamed[s.label] ?? s.label) === l)),
          ];
          if (alive) setSetup({ trained, labels: inSampleOrder, items: [], images: standard ? { standard, deep: deep ?? [] } : undefined });
          return;
        }
        const sample = validateDataset(await fetch(SAMPLE_SOURCES[0].url).then((r) => r.json()));
        items = examItems(sample, labels);
      } catch {
        /* no sample file: the learner's own examples are used (text) */
      }
      if (alive) setSetup({ trained, labels, items });
    })();
    return () => {
      alive = false;
    };
  }, [base, kind, sessionId, projectId]);

  /** One test image through the training page's calls: upload for prediction, then predict. */
  const predictImage = async (item: ImageItem): Promise<EvalItem> => {
    const form = new FormData();
    form.append('files', await sampleImageFile(item.file));
    const up = await fetch(`${base}/predict-image`, { method: 'POST', body: form });
    if (!up.ok) throw new Error(`Could not send ${item.title} to your model (${up.status}).`);
    const { imageUrl } = await up.json();
    const r = await fetch(`${base}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: imageUrl }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.success) throw new Error(typeof data?.detail === 'string' ? data.detail : `Your model could not read ${item.title}.`);
    const scores: Record<string, number> = Object.fromEntries((setup?.labels ?? []).map((l) => [l, 0]));
    scores[String(data.label)] = Number(data.confidence) / 100;
    for (const a of data.alternatives ?? []) scores[String(a.label)] = Number(a.confidence) / 100;
    return { text: item.title, expected: item.expected, predicted: String(data.label), scores, image: sampleImageUrl(item.file) };
  };

  const run = async () => {
    if (!setup) return;
    setRunning(true);
    setError(null);
    try {
      if (kind === 'image') {
        const list = setup.images?.[imageSet] ?? [];
        const out: EvalItem[] = new Array(list.length);
        let done = 0;
        let next = 0;
        setProgress({ done: 0, total: list.length });
        // three images at a time; results keep the test set's order
        const worker = async () => {
          while (next < list.length) {
            const i = next++;
            out[i] = await predictImage(list[i]);
            setProgress({ done: ++done, total: list.length });
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        setProgress(null);
        setRes({ success: true, source: 'test-set', modelType: '', labels: setup.labels, items: out, practice: { correct: 0, total: 0 } });
        return;
      }
      const r = await fetch(`${base}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: setup.items }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.success) throw new Error(typeof data?.detail === 'string' ? data.detail : 'The exam could not run. Please try again.');
      setRes(data as EvalResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The exam could not run. Please try again.');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (!setup) return <p className="max-w-7xl mx-auto text-xl text-fg/70">Loading…</p>;

  if (!setup.trained) {
    return (
      <div className={`max-w-7xl mx-auto ${card}`}>
        <p className="text-2xl font-semibold">Train your bot first, then give it an exam.</p>
        <Link href={learnHref} className={`${btn} mt-6 bg-purple-brand hover:bg-purple-brand/90 text-white`}>
          Go to training
        </Link>
      </div>
    );
  }

  if (!res && kind === 'image') {
    if (!setup.images) {
      return (
        <div className={`max-w-7xl mx-auto ${card}`}>
          <p className="text-2xl font-semibold">The exam uses the workshop’s sample images.</p>
          <p className="text-xl text-fg/70 mt-3">
            Add the sample images on Collect Data (KYC, Corporate action, Invoice, Cheque) and train again, then come back here.
          </p>
        </div>
      );
    }
    const sets = [
      { id: 'standard' as const, name: 'Standard', items: setup.images.standard, hint: 'clean scans of each document type' },
      { id: 'deep' as const, name: 'Handwritten and damaged', items: setup.images.deep, hint: 'filled in by hand, stained, skewed phone photos' },
    ].filter((x) => x.items.length);
    const chosen = sets.find((x) => x.id === imageSet) ?? sets[0];
    return (
      <div className={`max-w-7xl mx-auto ${card}`}>
        <p className="text-2xl md:text-3xl font-semibold leading-snug">
          Let’s give your bot an exam: {chosen.items.length} test images from the sample. It has never seen them.
        </p>
        <div className="flex flex-wrap gap-3 mt-5" role="radiogroup" aria-label="Which test images">
          {sets.map((x) => (
            <button
              key={x.id}
              type="button"
              role="radio"
              aria-checked={chosen.id === x.id}
              onClick={() => setImageSet(x.id)}
              disabled={running}
              className={`rounded-xl border-2 px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                chosen.id === x.id ? 'border-pink-brand bg-purple-brand/15' : 'border-magenta-brand/25 hover:border-magenta-brand/50'
              }`}
            >
              <span className="block text-lg font-semibold">{x.name} ({x.items.length})</span>
              <span className="block text-sm text-fg/60">{x.hint}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running}
          className={`${btn} mt-6 bg-purple-brand hover:bg-purple-brand/90 text-white disabled:opacity-70`}
        >
          {running && <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />}
          {running ? `Tested ${progress?.done ?? 0} of ${chosen.items.length}…` : 'Run the exam'}
        </button>
        {error && <p className="text-lg text-pink-brand mt-4" role="alert">{error}</p>}
      </div>
    );
  }

  if (!res) {
    const own = setup.items.length === 0;
    return (
      <div className={`max-w-7xl mx-auto ${card}`}>
        <p className="text-2xl md:text-3xl font-semibold leading-snug">
          {own
            ? 'Let’s give your bot an exam on your own examples.'
            : `Let’s give your bot an exam: the ${setup.items.length} test messages from the sample. It has never seen them.`}
        </p>
        {own && (
          <p className="text-xl text-fg/70 mt-3">
            We’ll hide each of your examples from the bot one at a time and see if it still gets it right.
          </p>
        )}
        <button
          type="button"
          onClick={run}
          disabled={running}
          className={`${btn} mt-6 bg-purple-brand hover:bg-purple-brand/90 text-white disabled:opacity-70`}
        >
          {running && <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />}
          {running ? 'Running the exam…' : 'Run the exam'}
        </button>
        {error && <p className="text-lg text-pink-brand mt-4" role="alert">{error}</p>}
      </div>
    );
  }

  return <Results res={res} unit={kind === 'image' ? 'images' : 'messages'} onAgain={kind === 'image' ? () => setRes(null) : undefined} />;
}

/* ───────────────────────── results ───────────────────────── */

function Results({ res, unit = 'messages', onAgain }: { res: EvalResponse; unit?: Unit; onAgain?: () => void }) {
  // text: the standard desks first; images: the sample's own order (KYC, Corporate action, Invoice, Cheque)
  const labels = useMemo(() => (unit === 'images' ? res.labels : orderLabels(res.labels)), [res.labels, unit]);
  const items = res.items;
  const own = res.source === 'own-examples';
  const what = own ? 'of your examples' : unit === 'images' ? 'test images' : 'desk messages';
  const acc = accuracy(items);
  // text: the complaints desk; images: the desk it caught least of (the one worth talking about)
  const [desk, setDesk] = useState(() =>
    unit === 'images'
      ? [...labels].sort((a, b) => deskAtLean(items, labels, a, 0).recall - deskAtLean(items, labels, b, 0).recall)[0] ?? labels[0]
      : defaultDesk(labels),
  );
  const normal = deskAtLean(items, labels, desk, 0);

  return (
    <div className="max-w-7xl mx-auto text-lg">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4 min-w-0">
          {/* 1. Overall score */}
          <section className={card} aria-labelledby="b1">
            <h2 id="b1" className="sr-only">Overall score</h2>
            <p className="text-3xl md:text-4xl font-bold leading-tight">
              Your bot got <span className="text-pink-brand">{acc.right} of {acc.total}</span> {what} right
            </p>
            <p className="text-xl text-fg/70 mt-2">That’s its accuracy: {acc.pct}%.</p>
            {own && <p className="text-base text-fg/60 mt-2">Each example was hidden from the bot while it was tested.</p>}
            {onAgain && (
              <button type="button" onClick={onAgain} className="mt-3 text-base font-semibold text-pink-brand underline">
                Try the other test images
              </button>
            )}
          </section>

          {/* 2. Where it got confused */}
          <Confusion items={items} labels={labels} unit={unit} className="flex-1" />
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          {/* 3. Graph: right per desk */}
          <PerDeskChart items={items} labels={labels} />

          {/* 4. The desk that matters most, as dots */}
          <section className={`${card} flex-1`} aria-labelledby="b4">
            <h2 id="b4" className="text-2xl font-bold">The desk that matters most</h2>
            <div className="flex flex-wrap gap-2 mt-3" role="radiogroup" aria-label="Desk">
              {labels.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={desk === l}
                  onClick={() => setDesk(l)}
                  className={`rounded-full border-2 px-4 py-1.5 text-base font-semibold transition-colors ${
                    desk === l ? 'border-pink-brand bg-purple-brand/20 text-fg' : 'border-magenta-brand/25 text-fg/70 hover:border-magenta-brand/50'
                  }`}
                >
                  {shortName(l)}
                </button>
              ))}
            </div>
            <DeskDots items={items} desk={desk} result={normal} unit={unit} />
            <p className="mt-4 text-lg">{hiddenWeakDeskLine(acc, desk, normal, unit)}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ───────── graph: right per desk ───────── */

function PerDeskChart({ items, labels }: { items: EvalItem[]; labels: string[] }) {
  const bars = perDesk(items, labels);
  const max = Math.max(1, ...bars.map((b) => b.total));
  const tip = (b: DeskBar) =>
    b.missed.length
      ? `${shortName(b.label)} missed: ${b.missed.map((i) => `“${i.text}” (bot said ${shortName(i.predicted)})`).join('; ')}`
      : `${shortName(b.label)}: every message went to the right desk`;

  return (
    <section className={card} aria-labelledby="b3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="b3" className="text-2xl font-bold">Right per desk</h2>
        <div className="flex items-center gap-4 text-sm text-fg/70" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[var(--success)]" />Right</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500/70" />Sent to another desk</span>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {bars.map((b) => (
          <li
            key={b.label}
            className="grid grid-cols-[9.5rem_minmax(0,1fr)_4.5rem] items-center gap-3"
            title={tip(b)}
            aria-label={`${shortName(b.label)}: ${b.right} of ${b.total} right${b.missed.length ? `, ${b.missed.length} sent to another desk` : ''}`}
          >
            <span className="text-base font-semibold truncate">{shortName(b.label)}</span>
            <span className="h-6 flex rounded-md bg-fg/5 overflow-hidden" aria-hidden="true">
              {b.right > 0 && (
                <span className="h-full bg-[var(--success)] rounded-l-md" style={{ width: `${(b.right / max) * 100}%` }} />
              )}
              {b.missed.length > 0 && (
                <span
                  className={`h-full bg-red-500/70 ${b.right > 0 ? 'ml-0.5' : 'rounded-l-md'} rounded-r-md`}
                  style={{ width: `${(b.missed.length / max) * 100}%` }}
                />
              )}
            </span>
            <span className="text-base tabular-nums text-fg/80 text-right whitespace-nowrap">
              {b.right} of {b.total}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────── the desk that matters most, as dots ───────── */

function Dot({ ok, kind, text }: { ok: boolean; kind: 'real' | 'flagged'; text: string }) {
  // real:    filled green = caught, hollow red = missed
  // flagged: filled green = really this desk, red ✕ = false alarm
  const base = 'w-9 h-9 rounded-full inline-flex items-center justify-center text-base font-bold cursor-default';
  const look = ok
    ? 'bg-[var(--success)] text-white'
    : kind === 'real'
      ? 'border-[3px] border-red-500 bg-transparent'
      : 'bg-red-500/15 text-red-500 border-2 border-red-500';
  return (
    <span className={`${base} ${look}`} title={text} role="img" aria-label={text}>
      {ok ? '✓' : kind === 'flagged' ? '✕' : ''}
    </span>
  );
}

function DeskDots({ items, desk, result, unit }: { items: EvalItem[]; desk: string; result: DeskResult; unit: Unit }) {
  const { real, flagged } = deskDots(items, desk);
  const many = deskNoun(desk, 2, unit);

  const row = (
    title: string,
    question: string,
    pct: string,
    summary: string,
    dots: { item: EvalItem; ok: boolean }[],
    kind: 'real' | 'flagged',
    empty: string,
  ) => (
    <div className="rounded-xl border border-magenta-brand/20 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base">
          <b>{title}</b> <span className="text-fg/60">· {question}</span>
        </p>
        <span className="rounded-full bg-pink-brand/15 text-pink-brand px-2.5 py-0.5 text-base font-bold tabular-nums shrink-0">{pct}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-2.5">
        {dots.length ? (
          dots.map((d) => (
            <Dot
              key={d.item.text}
              ok={d.ok}
              kind={kind}
              text={kind === 'real'
                ? `“${d.item.text}” ${d.ok ? '(caught)' : `(missed: bot said ${shortName(d.item.predicted)})`}`
                : `“${d.item.text}” ${d.ok ? '(really was)' : `(false alarm: really ${shortName(d.item.expected)})`}`}
            />
          ))
        ) : (
          <span className="text-base text-fg/60">{empty}</span>
        )}
        <span className="ml-1 text-xl font-bold">{summary}</span>
      </div>
    </div>
  );

  return (
    <div className="mt-4 space-y-3">
      {row(
        'Recall',
        `of all the real ${many}, how many did it catch?`,
        result.total ? `${result.recall}%` : '—',
        `Caught ${result.caught} of ${result.total}`,
        real,
        'real',
        `No ${many} in this exam.`,
      )}
      {row(
        'Precision',
        `when it said ${shortName(desk)}, was it right?`,
        result.flagged ? `${result.precision}%` : '—',
        result.flagged ? `${result.caught} of ${result.flagged} right` : 'Nothing flagged',
        flagged,
        'flagged',
        `It never said ${shortName(desk)}.`,
      )}
      <p className="text-sm text-fg/60">Each dot is one {unit === 'images' ? 'image' : 'message'}: ✓ right, ○ missed, ✕ false alarm.</p>
    </div>
  );
}

/* ───────── block 2 ───────── */

function Confusion({ items, labels, unit, className = '' }: { items: EvalItem[]; labels: string[]; unit: Unit; className?: string }) {
  const g = grid(items, labels);
  const [open, setOpen] = useState<{ r: number; c: number } | null>(null);
  const picked = open ? cellItems(items, labels[open.r], labels[open.c]) : [];
  const most = mostMissesLine(items, labels, unit);
  const off = offTopicLine(items);

  return (
    <section className={`${card} ${className}`} aria-labelledby="b2">
      <h2 id="b2" className="text-2xl font-bold">Where it got confused</h2>
      <div className="overflow-x-auto mt-4">
        <table className="border-separate border-spacing-1.5 text-lg">
          <thead>
            <tr>
              <th />
              <th colSpan={labels.length} className="text-center text-base font-semibold text-fg/60 pb-1">
                Bot said →
              </th>
            </tr>
            <tr>
              <th className="text-left text-base font-semibold text-fg/60 pr-3 align-bottom">Really was ↓</th>
              {labels.map((l) => (
                <th key={l} className="px-2 pb-1 text-base font-semibold text-center min-w-[5.5rem]">
                  {shortName(l)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((r, ri) => (
              <tr key={r}>
                <th className="text-left font-semibold pr-3 whitespace-nowrap">{shortName(r)}</th>
                {labels.map((c, ci) => {
                  const n = g[ri][ci];
                  const right = ri === ci;
                  const selected = open?.r === ri && open?.c === ci;
                  return (
                    <td key={c} className="p-0">
                      <button
                        type="button"
                        onClick={() => setOpen(selected ? null : { r: ri, c: ci })}
                        disabled={n === 0}
                        aria-label={`Really ${shortName(r)}, bot said ${shortName(c)}: ${n}`}
                        className={`w-full h-11 rounded-lg text-xl font-bold tabular-nums transition-shadow ${
                          right
                            ? 'bg-[var(--success)]/20 text-[var(--success)]'
                            : n > 0
                              ? 'bg-red-500/15 text-red-500'
                              : 'text-fg/30'
                        } ${n > 0 ? 'hover:ring-2 hover:ring-magenta-brand/50 cursor-pointer' : 'cursor-default'} ${selected ? 'ring-2 ring-pink-brand' : ''}`}
                      >
                        {n}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && picked.length > 0 && (
        <div className="mt-4 rounded-xl border border-magenta-brand/30 bg-purple-brand/10 px-5 py-4">
          <p className="text-base font-semibold text-fg/70">
            Really {shortName(labels[open.r])}, bot said {shortName(labels[open.c])}
          </p>
          <ul className="mt-2 space-y-1.5">
            {picked.map((i) => (
              <li key={i.text} className="flex items-center gap-3">
                {i.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt={i.text} className="w-14 h-14 rounded-md object-cover border border-magenta-brand/20 shrink-0" />
                )}
                <span>
                  {i.image ? i.text : `“${i.text}”`} <span className="text-fg/60">· Bot said {i.predicted}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {most && <p className="mt-4 text-xl font-semibold">{most}</p>}
      {!most && <p className="mt-4 text-xl font-semibold">No mistakes on the {unit === 'images' ? 'test images' : 'desk messages'}.</p>}
      {off && <p className="mt-3 text-lg text-fg/80">{off}</p>}
      <p className="mt-2 text-base text-fg/50">Click a number to see those {unit}.</p>
    </section>
  );
}
