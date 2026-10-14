'use client';

/**
 * Evaluate step for Text and Image Recognition projects (senior learners, read on a projector).
 * First the exam card answers "how do you know it was right?": the test set, labelled by people.
 * Then: accuracy, where it got confused (grid), right per desk (graph, also the desk picker) and the
 * chosen desk (recall and precision as dots), and at the bottom the scientific terms in business words.
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
  loadDeepTest,
  loadSampleImages,
  readRegion,
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
  examCounts,
  examItems,
  grid,
  hiddenWeakDeskLine,
  mostMissesLine,
  offTopicLine,
  orderLabels,
  perDesk,
  shortName,
  termRows,
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
  ownCount: number; // the learner's examples (the own-examples exam)
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
      let ownCount = 0;
      try {
        const d = (await fetch(base).then((r) => r.json()))?.data ?? {};
        trained = d.status === 'trained';
        labels = (d.model?.labels?.length ? d.model.labels : d.dataset?.labels ?? []).map(String);
        ownCount = Array.isArray(d.dataset?.examples) ? d.dataset.examples.length : 0;
        if (kind === 'image') {
          const sample = await loadSampleImages(readRegion(labelNamesKey(sessionId, projectId)));
          const renamed = readLabelNames(labelNamesKey(sessionId, projectId));
          const standard = imageExam(sample.test, 'Test', labels, renamed);
          const deep = imageExam(sample.deepTest?.length ? sample.deepTest : await loadDeepTest(), 'Deep', labels, renamed);
          const inSampleOrder = [
            ...sample.labels.map((l) => renamed[l.label] ?? l.label).filter((l) => labels.includes(l)),
            ...labels.filter((l) => !sample.labels.some((s) => (renamed[s.label] ?? s.label) === l)),
          ];
          if (alive) setSetup({ trained, labels: inSampleOrder, items: [], images: standard ? { standard, deep: deep ?? [] } : undefined, ownCount });
          return;
        }
        const sample = validateDataset(await fetch(SAMPLE_SOURCES[0].url).then((r) => r.json()));
        items = examItems(sample, labels);
      } catch {
        /* no sample file: the learner's own examples are used (text) */
      }
      if (alive) setSetup({ trained, labels, items, ownCount });
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

  if (kind === 'image' && !setup.images) {
    return (
      <div className={`max-w-7xl mx-auto ${card}`}>
        <p className="text-2xl font-semibold">The exam uses the workshop’s sample images.</p>
        <p className="text-xl text-fg/70 mt-3">
          Add the sample images on Collect Data (KYC, Corporate action, Invoice, Cheque) and train again, then come back here.
        </p>
      </div>
    );
  }

  const unit: Unit = kind === 'image' ? 'images' : 'messages';
  const sets = setup.images
    ? [
        { id: 'standard' as const, name: 'Standard', items: setup.images.standard, hint: 'clean scans of each document type' },
        { id: 'deep' as const, name: 'Handwritten and damaged', items: setup.images.deep, hint: 'filled in by hand, stained, skewed phone photos' },
      ].filter((x) => x.items.length)
    : [];
  const chosen = sets.find((x) => x.id === imageSet) ?? sets[0];
  const own = kind === 'text' && setup.items.length === 0;
  const counts =
    kind === 'image' ? examCounts(chosen?.items ?? [], setup.labels) : own ? [] : examCounts(setup.items, orderLabels(setup.labels));

  return (
    <div className="max-w-7xl mx-auto">
      {/* The exam, explained before it runs ("how do you know whether it was right?") */}
      <section className={`${card} !py-4 mb-[18px] flex flex-col md:flex-row md:items-center gap-4 md:gap-5`} aria-label="The exam">
        <div className="flex-1 min-w-0 space-y-1 text-base">
          {kind === 'image' ? (
            <>
              <p><b>The exam:</b> {chosen?.items.length ?? 0} document images your bot has never seen.</p>
              <p><b>The answer key:</b> a person labelled every image beforehand. The bot is right only when it matches the human label.</p>
            </>
          ) : own ? (
            <>
              <p><b>The exam:</b> your {setup.ownCount} examples, one at a time.</p>
              <p><b>The answer key:</b> your own labels. Each example is hidden from the bot while it’s tested.</p>
            </>
          ) : (
            <>
              <p><b>The exam:</b> {setup.items.length} client messages your bot has never seen.</p>
              <p><b>The answer key:</b> people labelled every message beforehand. The bot is right only when it matches the human label.</p>
            </>
          )}
          {counts.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {counts.map((c) => (
                <span key={c.name} className="rounded-full border border-fg/10 bg-purple-brand/5 px-2.5 py-0.5 text-sm text-fg/70 tabular-nums">
                  {c.name} {c.n}
                </span>
              ))}
            </div>
          )}
          {kind === 'image' && sets.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 pt-1.5" role="radiogroup" aria-label="Which test images">
              {sets.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen?.id === x.id}
                  onClick={() => setImageSet(x.id)}
                  disabled={running || !!res}
                  className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors disabled:cursor-default ${
                    chosen?.id === x.id
                      ? 'border-purple-brand/50 bg-purple-brand/10 text-purple-brand'
                      : 'border-fg/15 text-fg/60 hover:border-purple-brand/40 disabled:opacity-50'
                  }`}
                >
                  {x.name} ({x.items.length})
                </button>
              ))}
              {chosen && <span className="text-sm text-fg/50">{chosen.hint}</span>}
            </div>
          )}
          {error && <p className="text-base text-pink-brand pt-1" role="alert">{error}</p>}
        </div>
        {res ? (
          <span className="shrink-0 font-bold text-[var(--success)] whitespace-nowrap">✓ Exam done</span>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={running}
            className={`${btn} shrink-0 bg-purple-brand hover:bg-purple-brand/90 text-white disabled:opacity-70`}
          >
            {running && <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />}
            {running ? (kind === 'image' ? `Tested ${progress?.done ?? 0} of ${chosen?.items.length ?? 0}…` : 'Running the exam…') : 'Run the exam'}
          </button>
        )}
      </section>

      {res && <Results res={res} unit={unit} onAgain={kind === 'image' ? () => setRes(null) : undefined} />}
    </div>
  );
}

/* ───────────────────────── results ───────────────────────── */

/** A scientific term with its business words: "Accuracy · overall hit rate". A plain label (no
 *  outline or fill) so it doesn't read as a toggle or tabs. */
function Term({ sci, biz }: { sci: string; biz: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm whitespace-nowrap">
      <b className="font-bold text-purple-brand">{sci}</b>
      <span className="text-fg/40" aria-hidden="true">·</span>
      <span className="text-fg/60">{biz}</span>
    </span>
  );
}

const panel = 'bg-card border border-magenta-brand/20 rounded-2xl p-[22px]';

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
    <div className="text-base">
      <div className="grid gap-[18px] lg:grid-cols-2">
        <div className="flex flex-col gap-[18px] min-w-0">
          {/* 1. Overall score */}
          <section className={panel} aria-labelledby="b1">
            <h2 id="b1" className="sr-only">Overall score</h2>
            <p className="text-3xl md:text-[38px] font-extrabold leading-[1.15] tracking-tight">
              Your bot got <span className="text-pink-brand">{acc.right} of {acc.total}</span> {what} right
            </p>
            <p className="mt-4 flex flex-wrap items-center gap-2.5">
              <Term sci="Accuracy" biz="overall hit rate" />
              <b className="text-2xl text-pink-brand tabular-nums">{acc.pct}%</b>
            </p>
            {own && <p className="text-sm text-fg/60 mt-3">Each example was hidden from the bot while it was tested.</p>}
            {onAgain && (
              <button type="button" onClick={onAgain} className="mt-3 text-base font-semibold text-pink-brand underline">
                Try the other test images
              </button>
            )}
          </section>

          {/* 2. Where it got confused (reset the open cell when the desk changes) */}
          <Confusion key={desk} items={items} labels={labels} unit={unit} desk={desk} className="flex-1" />
        </div>

        <div className="flex flex-col gap-[18px] min-w-0">
          {/* 3. Graph: right per desk, also the desk picker */}
          <PerDeskChart items={items} labels={labels} unit={unit} desk={desk} onDesk={setDesk} />

          {/* 4. The chosen desk, as dots */}
          <section className={`${panel} flex-1`} aria-labelledby="b4">
            <h2 id="b4" className="text-[21px] font-bold">{shortName(desk)}: how well did it do?</h2>
            <DeskDots items={items} desk={desk} result={normal} unit={unit} />
            <p className="mt-3">{hiddenWeakDeskLine(acc, desk, normal, unit)}</p>
          </section>
        </div>
      </div>

      {/* 5. The scientific terms, in business words (the next scroll) */}
      <section className={`${panel} mt-[18px]`} aria-labelledby="b5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="b5" className="text-[21px] font-bold">The scientific terms, in business words</h2>
          <span className="text-[13px] text-fg/50">Desk shown: {shortName(desk)}</span>
        </div>
        <table className="mt-3 w-full text-sm border border-fg/10 rounded-xl border-separate border-spacing-0 overflow-hidden">
          <thead>
            <tr className="bg-purple-brand/5 text-xs font-bold uppercase tracking-wide text-fg/50">
              <th scope="col" className="text-left px-3.5 py-2.5 w-[200px]">Scientific term</th>
              <th scope="col" className="text-left px-3.5 py-2.5">What it means at work</th>
              <th scope="col" className="text-right px-3.5 py-2.5 w-[200px]">How your bot did</th>
            </tr>
          </thead>
          <tbody>
            {termRows(items, labels, desk, res.practice, unit, own).map((t) => (
              <tr key={t.term}>
                <th scope="row" className="text-left px-3.5 py-2 border-t border-fg/10 font-bold text-purple-brand">{t.term}</th>
                <td className="px-3.5 py-2 border-t border-fg/10">{t.meaning}</td>
                <td className="px-3.5 py-2 border-t border-fg/10 text-right font-bold tabular-nums">{t.yours}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ───────── graph: right per desk (each row selects the desk) ───────── */

function PerDeskChart({ items, labels, unit, desk, onDesk }: { items: EvalItem[]; labels: string[]; unit: Unit; desk: string; onDesk: (d: string) => void }) {
  const bars = perDesk(items, labels);
  const max = Math.max(1, ...bars.map((b) => b.total));
  const tip = (b: DeskBar) =>
    b.missed.length
      ? `${shortName(b.label)} missed: ${b.missed.map((i) => `“${i.text}” (bot said ${shortName(i.predicted)})`).join('; ')}`
      : `${shortName(b.label)}: every ${unit === 'images' ? 'image' : 'message'} went to the right desk`;

  return (
    <section className={panel} aria-labelledby="b3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="b3" className="text-[21px] font-bold">Right per desk</h2>
        <span className="text-[13px] text-fg/50">Click a desk to look closer</span>
      </div>
      <div className="mt-3 space-y-1" role="radiogroup" aria-label="Desk">
        {bars.map((b) => (
          <button
            key={b.label}
            type="button"
            role="radio"
            aria-checked={desk === b.label}
            onClick={() => onDesk(b.label)}
            title={tip(b)}
            aria-label={`${shortName(b.label)}: ${b.right} of ${b.total} right${b.missed.length ? `, ${b.missed.length} sent to another desk` : ''}`}
            className={`w-full grid grid-cols-[9.5rem_minmax(0,1fr)_4rem] items-center gap-3 rounded-lg px-2 py-[7px] text-left transition-colors ${
              desk === b.label ? 'bg-purple-brand/10 ring-[1.5px] ring-inset ring-purple-brand/40' : 'hover:bg-fg/5'
            }`}
          >
            <span className="font-semibold truncate">{shortName(b.label)}</span>
            <span className="h-6 flex rounded-md bg-fg/5 overflow-hidden" aria-hidden="true">
              {b.right > 0 && <span className="h-full bg-[var(--success)] rounded-l-md" style={{ width: `${(b.right / max) * 100}%` }} />}
              {b.missed.length > 0 && (
                <span
                  className={`h-full bg-red-500/70 ${b.right > 0 ? 'ml-0.5' : 'rounded-l-md'} rounded-r-md`}
                  style={{ width: `${(b.missed.length / max) * 100}%` }}
                />
              )}
            </span>
            <span className="tabular-nums text-fg/80 text-right whitespace-nowrap">
              {b.right} of {b.total}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ───────── the chosen desk, as dots ───────── */

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
    term: { sci: string; biz: string },
    question: string,
    pct: string,
    summary: string,
    dots: { item: EvalItem; ok: boolean }[],
    kind: 'real' | 'flagged',
    empty: string,
  ) => (
    <div className="rounded-xl border border-magenta-brand/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <Term {...term} />
        <span className="rounded-full bg-pink-brand/15 text-pink-brand px-2.5 py-0.5 font-bold tabular-nums shrink-0">{pct}</span>
      </div>
      <p className="mt-2 text-fg/70">{question}</p>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {dots.length ? (
          dots.map((d) => (
            <Dot
              key={d.item.text}
              ok={d.ok}
              kind={kind}
              text={kind === 'real'
                ? `“${d.item.text}” ${d.ok ? '(right: caught)' : `(missed: bot said ${shortName(d.item.predicted)})`}`
                : `“${d.item.text}” ${d.ok ? '(right: really was)' : `(false alarm: really ${shortName(d.item.expected)})`}`}
            />
          ))
        ) : (
          <span className="text-fg/60">{empty}</span>
        )}
        <span className="ml-1.5 text-[22px] font-bold">{summary}</span>
      </div>
    </div>
  );

  return (
    <div className="mt-3 space-y-3">
      {row(
        { sci: 'Recall', biz: 'catch rate' },
        `Of all the real ${many}, how many did it catch?`,
        result.total ? `${result.recall}%` : '—',
        `Caught ${result.caught} of ${result.total}`,
        real,
        'real',
        `No ${many} in this exam.`,
      )}
      {row(
        { sci: 'Precision', biz: 'alert quality' },
        `When it said “${shortName(desk)}”, was it right?`,
        result.flagged ? `${result.precision}%` : '—',
        result.flagged ? `${result.caught} of ${result.flagged} right` : 'Nothing flagged',
        flagged,
        'flagged',
        `It never said ${shortName(desk)}.`,
      )}
    </div>
  );
}

/* ───────── block 2: where it got confused ───────── */

function Confusion({ items, labels, unit, desk, className = '' }: { items: EvalItem[]; labels: string[]; unit: Unit; desk: string; className?: string }) {
  const g = grid(items, labels);
  const [open, setOpen] = useState<{ r: number; c: number } | null>(null);
  const picked = open ? cellItems(items, labels[open.r], labels[open.c]) : [];
  const most = mostMissesLine(items, labels, unit);
  const off = offTopicLine(items);
  const sel = 'text-purple-brand bg-purple-brand/10';

  return (
    <section className={`${panel} ${className}`} aria-labelledby="b2">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="b2" className="text-[21px] font-bold">Where it got confused</h2>
        <Term sci="Confusion matrix" biz="the error table" />
      </div>
      <div className="overflow-x-auto mt-3">
        <table className="w-full border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th />
              <th colSpan={labels.length} className="text-center text-sm font-normal text-fg/50 pb-0.5">
                Bot said →
              </th>
            </tr>
            <tr>
              <th className="text-left text-sm font-normal text-fg/50 pr-2 align-bottom">Really was ↓</th>
              {labels.map((l) => (
                <th key={l} className={`px-1.5 py-1 rounded-lg text-sm font-semibold text-center align-bottom min-w-[4.5rem] ${l === desk ? sel : ''}`}>
                  {shortName(l)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((r, ri) => (
              <tr key={r}>
                <th className={`text-left font-semibold px-1.5 rounded-lg whitespace-nowrap ${r === desk ? sel : ''}`}>{shortName(r)}</th>
                {labels.map((c, ci) => {
                  const n = g[ri][ci];
                  const right = ri === ci;
                  // for the chosen desk: its row off the diagonal = missed, its column = false alarm
                  const role = right ? 'right' : r === desk ? 'missed' : c === desk ? 'alarm' : 'other';
                  const selected = open?.r === ri && open?.c === ci;
                  const look = n === 0
                    ? 'text-fg/30 font-normal text-lg'
                    : role === 'right'
                      ? 'bg-[var(--success)]/15 text-[var(--success)]'
                      : role === 'missed'
                        ? 'bg-red-500/10 text-red-500 border-[1.5px] border-red-500'
                        : role === 'alarm'
                          ? 'bg-orange-500/10 text-orange-500 border-[1.5px] border-orange-500'
                          : 'bg-red-500/15 text-red-500';
                  return (
                    <td key={c} className="p-0">
                      <button
                        type="button"
                        onClick={() => setOpen(selected ? null : { r: ri, c: ci })}
                        disabled={n === 0}
                        aria-label={`Really ${shortName(r)}, bot said ${shortName(c)}: ${n}${n && role === 'missed' ? ', missed' : n && role === 'alarm' ? ', false alarm' : ''}`}
                        className={`w-full h-[52px] rounded-lg flex flex-col items-center justify-center text-xl font-extrabold tabular-nums leading-tight transition-shadow ${look} ${
                          n > 0 ? 'hover:ring-2 hover:ring-purple-brand/40 cursor-pointer' : 'cursor-default'
                        } ${selected ? 'ring-[3px] ring-purple-brand/50' : ''}`}
                      >
                        {n}
                        {n > 0 && role === 'missed' && <span className="text-[10.5px] font-extrabold uppercase tracking-wide">Missed</span>}
                        {n > 0 && role === 'alarm' && <span className="text-[10.5px] font-extrabold uppercase tracking-wide">False alarm</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && picked.length > 0 ? (
        <div className="mt-3 rounded-xl bg-purple-brand/5 border border-magenta-brand/20 px-4 py-3">
          <p className="text-sm text-fg/60">
            Really {shortName(labels[open.r])}, bot said {shortName(labels[open.c])}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {picked.map((i) => (
              <li key={i.text} className="flex items-center gap-3">
                {i.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt={i.text} className="w-14 h-14 rounded-md object-cover border border-magenta-brand/20 shrink-0" />
                )}
                <span>{i.image ? i.text : `“${i.text}”`}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          {most ? (
            <p className="mt-3">
              <b>Most mistakes:</b> {most.replace(/^Most mistakes: /, '')}
            </p>
          ) : (
            <p className="mt-3 font-semibold">No mistakes on the {unit === 'images' ? 'test images' : 'desk messages'}.</p>
          )}
          {off && <p className="mt-2 text-fg/70">{off}</p>}
          <p className="mt-2 text-[13px] text-fg/50">Click a number to see those {unit}.</p>
        </>
      )}
    </section>
  );
}
