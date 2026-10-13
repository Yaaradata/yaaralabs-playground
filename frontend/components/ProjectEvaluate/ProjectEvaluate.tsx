'use client';

/**
 * Evaluate step for Text Recognition projects (senior learners, read on a projector).
 * One scrolling page: the exam, then five blocks (accuracy, where it got confused, what precision
 * and recall mean, the desk that matters most, pick the right metric) and practice vs exam.
 * The endpoint returns the score of every label for every message; all numbers come from
 * evaluate.ts. Plain words only: accuracy, precision, recall.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import config from '../../lib/config';
import { SAMPLE_SOURCES, validateDataset } from '../SampleLabelling/sample';
import {
  accuracy,
  cellItems,
  defaultDesk,
  deskAtLean,
  deskNoun,
  examItems,
  grid,
  hiddenWeakDeskLine,
  mostMissesLine,
  offTopicLine,
  orderLabels,
  shortName,
  type EvalItem,
  type EvalResponse,
} from './evaluate';

interface Props {
  sessionId: string;
  projectId: string;
  makeHref: string;
  learnHref: string;
}

type Setup = { trained: boolean; labels: string[]; items: { text: string; expected: string }[] };

const card = 'bg-card border border-magenta-brand/20 rounded-2xl p-6 md:p-8';
const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-lg font-semibold transition-colors';

export default function ProjectEvaluate({ sessionId, projectId, makeHref, learnHref }: Props) {
  const base = `${config.apiBaseUrl}/api/guests/session/${sessionId}/projects/${projectId}`;
  const [setup, setSetup] = useState<Setup | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<EvalResponse | null>(null);

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
        const sample = validateDataset(await fetch(SAMPLE_SOURCES[0].url).then((r) => r.json()));
        items = examItems(sample, labels);
      } catch {
        /* no sample file: the learner's own examples are used */
      }
      if (alive) setSetup({ trained, labels, items });
    })();
    return () => {
      alive = false;
    };
  }, [base]);

  const run = async () => {
    if (!setup) return;
    setRunning(true);
    setError(null);
    try {
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
    }
  };

  if (!setup) return <p className="max-w-5xl mx-auto text-xl text-fg/70">Loading…</p>;

  if (!setup.trained) {
    return (
      <div className={`max-w-5xl mx-auto ${card}`}>
        <p className="text-2xl font-semibold">Train your bot first, then give it an exam.</p>
        <Link href={learnHref} className={`${btn} mt-6 bg-purple-brand hover:bg-purple-brand/90 text-white`}>
          Go to training
        </Link>
      </div>
    );
  }

  if (!res) {
    const own = setup.items.length === 0;
    return (
      <div className={`max-w-5xl mx-auto ${card}`}>
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

  return <Results res={res} makeHref={makeHref} learnHref={learnHref} />;
}

/* ───────────────────────── results ───────────────────────── */

function Results({ res, makeHref, learnHref }: { res: EvalResponse; makeHref: string; learnHref: string }) {
  const labels = useMemo(() => orderLabels(res.labels), [res.labels]);
  const items = res.items;
  const own = res.source === 'own-examples';
  const what = own ? 'of your examples' : 'desk messages';
  const acc = accuracy(items);
  const [desk, setDesk] = useState(() => defaultDesk(labels));
  const [worse, setWorse] = useState<'miss' | 'alarm' | null>(null);
  const [lean, setLean] = useState(0);
  const normal = deskAtLean(items, labels, desk, 0);
  const live = deskAtLean(items, labels, desk, lean);

  return (
    <div className="max-w-5xl mx-auto space-y-6 text-lg">
      {/* 1. Overall score */}
      <section className={card} aria-labelledby="b1">
        <h2 id="b1" className="sr-only">Overall score</h2>
        <p className="text-3xl md:text-4xl font-bold leading-tight">
          Your bot got <span className="text-pink-brand">{acc.right} of {acc.total}</span> {what} right
        </p>
        <p className="text-xl text-fg/70 mt-2">That’s its accuracy: {acc.pct}%.</p>
        {own && <p className="text-base text-fg/60 mt-2">Each example was hidden from the bot while it was tested.</p>}
      </section>

      {/* 2. Where it got confused */}
      <Confusion items={items} labels={labels} />

      {/* 3. What precision and recall mean */}
      <Explain desk={desk} />

      {/* 4. The desk that matters most */}
      <section className={card} aria-labelledby="b4">
        <h2 id="b4" className="text-2xl font-bold">The desk that matters most</h2>
        <div className="flex flex-wrap gap-2 mt-4" role="radiogroup" aria-label="Desk">
          {labels.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={desk === l}
              onClick={() => {
                setDesk(l);
                setLean(0);
              }}
              className={`rounded-full border-2 px-4 py-2 text-base font-semibold transition-colors ${
                desk === l ? 'border-pink-brand bg-purple-brand/20 text-fg' : 'border-magenta-brand/25 text-fg/70 hover:border-magenta-brand/50'
              }`}
            >
              {shortName(l)}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 mt-5">
          <Tile
            title="Recall"
            big={`Caught ${normal.caught} of ${normal.total}`}
            pct={normal.total ? `${normal.recall}%` : '—'}
            sub={`real ${deskNoun(desk)} the bot found`}
            on={worse === 'miss'}
          />
          <Tile
            title="Precision"
            big={normal.flagged ? `${normal.caught} of ${normal.flagged} right` : 'Nothing flagged'}
            pct={normal.flagged ? `${normal.precision}%` : '—'}
            sub={`messages it called ${deskNoun(desk)} that really were`}
            on={worse === 'alarm'}
          />
        </div>
        <p className="mt-5 text-xl">{hiddenWeakDeskLine(acc, desk, normal)}</p>
      </section>

      {/* 5. Pick the right metric */}
      <section className={card} aria-labelledby="b5">
        <h2 id="b5" className="text-2xl font-bold">Which is worse for us?</h2>
        <div className="flex flex-wrap gap-3 mt-4">
          {([
            ['miss', `Missing a real ${deskNoun(desk, 1)}`],
            ['alarm', 'Raising a false alarm'],
          ] as const).map(([k, text]) => (
            <button
              key={k}
              type="button"
              aria-pressed={worse === k}
              onClick={() => setWorse(k)}
              className={`${btn} border-2 ${worse === k ? 'border-pink-brand bg-purple-brand/20' : 'border-magenta-brand/30 hover:bg-purple-brand/10'}`}
            >
              {text}
            </button>
          ))}
        </div>
        {worse && (
          <p className="mt-3 text-xl font-semibold text-pink-brand">
            {worse === 'miss' ? 'Watch recall. Slide right to catch more.' : 'Watch precision. Slide left for fewer false alarms.'}
          </p>
        )}

        <label htmlFor="lean" className="block mt-6 text-xl font-semibold">
          How quickly should the bot say ‘{shortName(desk)}’?
        </label>
        <input
          id="lean"
          type="range"
          min={-50}
          max={50}
          step={5}
          value={lean}
          onChange={(e) => setLean(Number(e.target.value))}
          className="w-full mt-4 accent-pink-500 h-2"
          aria-valuetext={lean === 0 ? 'Normal' : lean < 0 ? 'Only when more sure' : 'Sooner'}
        />
        <div className="relative flex justify-between text-base text-fg/70 mt-1">
          <span>Only when very sure</span>
          <span className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center">
            <span className="w-px h-2 bg-fg/40" aria-hidden="true" />
            Normal
          </span>
          <span>At the first hint</span>
        </div>

        <div className="mt-6 rounded-xl bg-purple-brand/10 border border-magenta-brand/20 px-5 py-4" aria-live="polite">
          <p className="text-2xl font-bold">
            Caught {live.caught} of {live.total} {deskNoun(desk, live.total)} · {live.falseAlarms} false {live.falseAlarms === 1 ? 'alarm' : 'alarms'}
          </p>
          <p className="text-lg mt-1">
            <span className={worse === 'miss' ? 'font-bold text-pink-brand' : ''}>Recall {live.total ? `${live.recall}%` : '—'}</span>
            <span className="text-fg/40"> · </span>
            <span className={worse === 'alarm' ? 'font-bold text-pink-brand' : ''}>Precision {live.flagged ? `${live.precision}%` : '—'}</span>
          </p>
          <p className="text-base text-fg/50 mt-1">
            Normal: caught {normal.caught} of {normal.total} · {normal.falseAlarms} false {normal.falseAlarms === 1 ? 'alarm' : 'alarms'}
          </p>
        </div>
        <p className="mt-4 text-xl">
          The model didn’t change. Only the rule changed, and the right setting depends on what a mistake costs you.
        </p>
      </section>

      {/* Practice vs exam */}
      <section className="px-1">
        <p className="text-xl">
          Practice score <b>{res.practice.correct} of {res.practice.total}</b> (messages it learned from) · Exam score{' '}
          <b>{acc.right} of {acc.total}</b> ({own ? 'each example hidden while tested' : 'messages it has never seen'}). Always judge a bot on messages it hasn’t seen.
        </p>
        <div className="flex flex-wrap gap-3 mt-5">
          <Link href={makeHref} className={`${btn} border-2 border-magenta-brand/40 hover:bg-purple-brand/10`}>
            ← Back to Use the AI
          </Link>
          <Link href={learnHref} className={`${btn} bg-purple-brand hover:bg-purple-brand/90 text-white`}>
            Add more examples
          </Link>
        </div>
      </section>
    </div>
  );
}

function Tile({ title, big, pct, sub, on }: { title: string; big: string; pct: string; sub: string; on: boolean }) {
  return (
    <div className={`rounded-2xl border-2 p-5 transition-colors ${on ? 'border-pink-brand bg-purple-brand/15' : 'border-magenta-brand/25'}`}>
      <p className="text-base font-bold uppercase tracking-wider text-fg/60">{title}</p>
      <p className="text-3xl font-bold mt-2">
        {big} <span className="text-pink-brand">({pct})</span>
      </p>
      <p className="text-lg text-fg/70 mt-1">{sub}</p>
    </div>
  );
}

/* ───────── block 2 ───────── */

function Confusion({ items, labels }: { items: EvalItem[]; labels: string[] }) {
  const g = grid(items, labels);
  const [open, setOpen] = useState<{ r: number; c: number } | null>(null);
  const picked = open ? cellItems(items, labels[open.r], labels[open.c]) : [];
  const most = mostMissesLine(items, labels);
  const off = offTopicLine(items);

  return (
    <section className={card} aria-labelledby="b2">
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
                <th key={l} className="px-2 pb-1 text-base font-semibold text-center min-w-[6.5rem]">
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
                        className={`w-full h-14 rounded-lg text-2xl font-bold tabular-nums transition-shadow ${
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
              <li key={i.text}>
                “{i.text}” <span className="text-fg/60">· Bot said {i.predicted}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {most && <p className="mt-4 text-xl font-semibold">{most}</p>}
      {!most && <p className="mt-4 text-xl font-semibold">No mistakes on the desk messages.</p>}
      {off && <p className="mt-3 text-lg text-fg/80">{off}</p>}
      <p className="mt-2 text-base text-fg/50">Click a number to see those messages.</p>
    </section>
  );
}

/* ───────── block 3 ───────── */

function Explain({ desk }: { desk: string }) {
  const many = deskNoun(desk);
  return (
    <section className={card} aria-labelledby="b3">
      <h2 id="b3" className="text-2xl font-bold">What do precision and recall mean?</h2>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem] items-center mt-4">
        <div className="space-y-4">
          <div>
            <p className="text-xl font-bold">Recall: did we catch them?</p>
            <p className="text-lg text-fg/80">Of all the real {many}, how many did the bot catch?</p>
          </div>
          <div>
            <p className="text-xl font-bold">Precision: when it flags, is it right?</p>
            <p className="text-lg text-fg/80">Of the messages the bot called {many}, how many really were?</p>
          </div>
          <div className="text-base text-fg/70 border-l-4 border-magenta-brand/40 pl-4 space-y-1">
            <p><b>Recall:</b> how many of the fish in the pond did your net catch?</p>
            <p><b>Precision:</b> how much of what’s in your net is actually fish?</p>
          </div>
        </div>
        <FishingNet />
      </div>
    </section>
  );
}

function Fish({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`} className="text-pink-brand">
      <ellipse cx="0" cy="0" rx="13" ry="7" fill="currentColor" />
      <path d="M11 0 L21 -7 L21 7 Z" fill="currentColor" />
      <circle cx="-6" cy="-2" r="1.6" className="text-canvas" fill="currentColor" />
    </g>
  );
}

/** A net in a pond: fish caught, fish missed, and a boot and some weed in the net. */
function FishingNet() {
  return (
    <svg viewBox="0 0 240 190" className="w-full max-w-[16rem] mx-auto text-fg" role="img" aria-label="A fishing net holding three fish, a boot and some weed, with two fish still outside the net">
      {/* pond */}
      <rect x="4" y="40" width="232" height="146" rx="18" className="text-purple-brand" fill="currentColor" opacity="0.12" />
      {/* handle and rim */}
      <line x1="120" y1="8" x2="120" y2="52" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.7" />
      <ellipse cx="120" cy="58" rx="62" ry="10" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.8" />
      {/* net bag with mesh */}
      <path d="M58 58 Q70 150 120 160 Q170 150 182 58" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.7" />
      {[78, 98, 120, 142, 162].map((x) => (
        <path key={x} d={`M${x} 64 Q${x + (120 - x) * 0.35} 120 120 158`} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      ))}
      {[82, 104, 126].map((y) => (
        <path key={y} d={`M${62 + (y - 64) * 0.18} ${y} Q120 ${y + 12} ${178 - (y - 64) * 0.18} ${y}`} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      ))}
      {/* in the net: three fish, a boot, weed */}
      <Fish x={98} y={96} />
      <Fish x={140} y={110} flip />
      <Fish x={112} y={132} />
      <path d="M140 80 h12 v14 h10 v8 h-22 Z" className="text-fg" fill="currentColor" opacity="0.55" />
      <path d="M86 128 q-6 -10 2 -18 M90 130 q4 -12 -2 -20" fill="none" className="text-[var(--success)]" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* missed: two fish outside */}
      <Fish x={30} y={150} />
      <Fish x={212} y={168} flip />
    </svg>
  );
}

