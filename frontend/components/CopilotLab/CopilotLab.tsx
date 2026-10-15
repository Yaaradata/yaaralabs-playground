'use client';

/**
 * Copilot labs: AI Ethics and Document AI.
 * The Playground is the worksheet beside Microsoft Copilot: copy the prompt, paste it into Copilot, tick what
 * Copilot did. No AI calls happen here, and only ticks, choices and short notes are saved (never Copilot's output).
 * Content: activities/. Scoring: scoring.ts. Design reference: CopilotLab.preview.jsx.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITIES, AI_CHECKS } from './activities';
import { clearLab, clearLocal, loadLab, readLocal, saveLab, writeLocal } from './api';
import './copilotLab.css';
import {
  TONE_LABEL,
  allBlocks,
  blockResult,
  checkEvidence,
  completedSteps,
  fieldScore,
  scoredBlocks,
  stepDone,
  tally,
} from './scoring';
import type {
  Activity,
  ActivityId,
  Answers,
  ChecklistAnswer,
  ChecklistBlock,
  ChoiceBlock,
  FieldCheckAnswer,
  FieldCheckBlock,
  FieldKey,
  NotesAnswer,
  NotesBlock,
  Step,
  Tone,
} from './types';

export interface CopilotLabProps {
  activity: ActivityId;
  projectName: string;
  sessionId: string;
  projectId: string;
}

const DEFAULT_HINT = 'Paste this into Copilot. Start a **new chat** first.';
const NOTE_MAX = 300;

/* ───────────── small pieces ───────────── */

function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function Chip({ tone, children }: { tone: Tone; children?: React.ReactNode }) {
  return <span className={`chip ${tone}`}>{children ?? TONE_LABEL[tone]}</span>;
}

function useCopy(): [string, (text: string, onFail?: () => void) => Promise<void>] {
  const [state, setState] = useState<'idle' | 'ok' | 'manual'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = async (text: string, onFail?: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setState('ok');
    } catch {
      onFail?.();
      setState('manual');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };
  return [state, copy];
}

function PromptCard({ text, hint }: { text: string; hint?: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, copy] = useCopy();
  const selectAll = () => {
    const sel = window.getSelection();
    if (!pre.current || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(pre.current);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  return (
    <div className="prompt">
      <div className="prompt-head">
        <span className="eyebrow">Prompt for Copilot</span>
        <button type="button" className={`btn pri copy ${state}`} onClick={() => copy(text, selectAll)} aria-live="polite">
          {state === 'ok' ? 'Copied ✓' : state === 'manual' ? 'Press Ctrl+C' : 'Copy'}
        </button>
      </div>
      <pre ref={pre} className="mono">{text}</pre>
      <div className="hint">↳ <Rich text={hint || DEFAULT_HINT} /></div>
    </div>
  );
}

function Checklist({ b, ans, set, hidden }: { b: ChecklistBlock; ans?: ChecklistAnswer; set: (v: ChecklistAnswer) => void; hidden?: boolean }) {
  const ticked = new Set(ans?.ticked || []);
  const open = !hidden || Boolean(ans?.open);
  const toggle = (i: number) => {
    const next = new Set(ticked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    set({ ...ans, ticked: [...next].sort((a, c) => a - c) });
  };
  if (!open) {
    return (
      <div className="card reveal-lock">
        <div className="q">{b.q}</div>
        <p className="muted">The checklist stays hidden so you see Copilot’s answer first.</p>
        <button type="button" className="btn pri" onClick={() => set({ ...ans, open: true })}>I’ve asked Copilot – show the checklist</button>
      </div>
    );
  }
  const r = blockResult(b, { [b.id]: ans });
  return (
    <div className="card">
      <div className="q-row">
        <div className="q">{b.q}</div>
        <span className="count num">{ticked.size} of {b.items.length}</span>
      </div>
      <div className="checks">
        {b.items.map((it, i) => (
          <label key={i} className={`check ${ticked.has(i) ? 'on' : ''}`}>
            <input type="checkbox" checked={ticked.has(i)} onChange={() => toggle(i)} />
            <span className="box" aria-hidden="true">{ticked.has(i) ? '✓' : ''}</span>
            <span>{it}</span>
          </label>
        ))}
        {b.bonus && (
          <label className={`check bonus ${ans?.bonus ? 'on' : ''}`}>
            <input type="checkbox" checked={Boolean(ans?.bonus)} onChange={() => set({ ...ans, bonus: !ans?.bonus })} />
            <span className="box" aria-hidden="true">{ans?.bonus ? '✓' : ''}</span>
            <span><b>Bonus:</b> {b.bonus}</span>
          </label>
        )}
      </div>
      <div className="row-end">
        {ans?.done ? (
          <Chip tone={r.tone}>{r.text}</Chip>
        ) : (
          <button type="button" className="btn" onClick={() => set({ ...ans, done: true })}>Done with this list</button>
        )}
      </div>
    </div>
  );
}

function Choice({ b, ans, set }: { b: ChoiceBlock; ans?: number; set: (v: number) => void }) {
  return (
    <div className="card" role="radiogroup" aria-label={b.q}>
      <div className="q">{b.q}</div>
      <div className="opts">
        {b.options.map((o, i) => {
          const on = ans === i;
          return (
            <button key={i} type="button" role="radio" aria-checked={on} className={`opt ${on ? `on ${o.v}` : ''}`} onClick={() => set(i)}>
              <span className="dot" aria-hidden="true" />
              <span>{o.label}</span>
              {on && <Chip tone={o.v} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const FIELD_OPTS: [FieldKey, string][] = [['right', 'Right'], ['wrong', 'Wrong'], ['missing', 'Said not in document']];

function FieldCheck({ b, ans, set }: { b: FieldCheckBlock; ans?: FieldCheckAnswer; set: (v: FieldCheckAnswer) => void }) {
  const marks = ans?.marks || {};
  const shown = Boolean(ans?.shown);
  const { ok, marked } = fieldScore(b, ans);
  const allMarked = marked === b.rows.length;
  const r = blockResult(b, { [b.id]: ans });
  return (
    <div className="card">
      <div className="q-row">
        <div className="q">Mark what Copilot did for each field</div>
        <span className="count num">{marked} of {b.rows.length} marked</span>
      </div>
      <div className={`ftable ${shown ? 'shown' : ''}`}>
        <div className="fhead">
          <span>Field</span>
          <span>Copilot’s answer was…</span>
          {shown && <span>In the notice</span>}
        </div>
        {b.rows.map((row, i) => {
          const good = marks[i] === row.key;
          return (
            <div key={i} className={`frow ${shown ? (good ? 'ok' : 'no') : ''}`}>
              <span className="fname">{row.f}</span>
              <span className="fbtns" role="radiogroup" aria-label={`What Copilot did for ${row.f}`}>
                {FIELD_OPTS.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={marks[i] === k}
                    className={`seg ${marks[i] === k ? 'on' : ''}`}
                    onClick={() => set({ ...ans, marks: { ...marks, [i]: k } })}
                  >
                    {l}
                  </button>
                ))}
              </span>
              {shown && (
                <span className="fans">
                  <span className="tick" aria-label={good ? 'Copilot got this' : 'Copilot missed this'}>{good ? '✓' : '✗'}</span> {row.correct}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="row-end">
        {shown ? (
          <>
            <span className="muted">Copilot got {ok} of {b.rows.length}. The misses are what a person must check.</span>
            <Chip tone={r.tone}>{r.text}</Chip>
          </>
        ) : (
          <button type="button" className="btn pri" disabled={!allMarked} onClick={() => set({ ...ans, shown: true })}>
            {allMarked ? 'Show the answers' : 'Mark every row to see the answers'}
          </button>
        )}
      </div>
    </div>
  );
}

function Notes({ b, ans, set }: { b: NotesBlock; ans?: NotesAnswer; set: (v: NotesAnswer) => void }) {
  const vals = ans || b.boxes.map(() => '');
  return (
    <div className="card">
      {b.boxes.map((label, i) => (
        <label key={i} className="note">
          <span className="q">{label}</span>
          <textarea
            maxLength={NOTE_MAX}
            rows={3}
            value={vals[i] || ''}
            placeholder="Write a line or two…"
            onChange={(e) => {
              const next = b.boxes.map((_, j) => vals[j] || '');
              next[i] = e.target.value.slice(0, NOTE_MAX);
              set(next);
            }}
          />
          <span className="muted small num">{(vals[i] || '').length}/{NOTE_MAX}</span>
        </label>
      ))}
    </div>
  );
}

/* ───────────── result card and AI check ───────────── */

function ResultPage({ act, answers }: { act: Activity; answers: Answers }) {
  const t = tally(act, answers);
  const notes = allBlocks(act).filter((b): b is NotesBlock => b.type === 'notes');
  return (
    <div className="result print-area">
      <div className="result-head">
        <div>
          <div className="eyebrow">Result card</div>
          <h2 className="h2">How Copilot did</h2>
        </div>
        <div className="tally num">
          <span className="chip good">{t.good} held</span>
          <span className="chip partial">{t.partial} partly</span>
          <span className="chip bad">{t.bad} slipped</span>
        </div>
      </div>
      <div className="rlist">
        {scoredBlocks(act).map((b) => {
          const r = blockResult(b, answers);
          return (
            <div key={b.id} className="rrow">
              <span className={`bar ${r.tone}`} />
              <span className="rlabel">{b.label}</span>
              <span className="rtext">{r.text}</span>
              <Chip tone={r.tone} />
            </div>
          );
        })}
      </div>
      {notes.map((b) => (
        <div key={b.id} className="rnotes">
          {b.boxes.map((l, i) => {
            const v = ((answers[b.id] as NotesAnswer | undefined) || [])[i]?.trim();
            return (
              <div key={i}>
                <div className="small eyebrow-plain">{l}</div>
                <p>{v || <span className="muted">Not written yet</span>}</p>
              </div>
            );
          })}
        </div>
      ))}
      <div className="point">Point to land: {act.point}</div>
    </div>
  );
}

function AiCheckPage({ act, answers }: { act: Activity; answers: Answers }) {
  const other = act.id === 'ethics' ? 'the Document AI lab' : 'the AI Ethics lab';
  return (
    <div className="aicheck print-area">
      <div className="eyebrow">Take this with you</div>
      <h2 className="h2">Your AI check: six questions for any AI task</h2>
      <p className="lead">
        Whenever a task depends on an AI answer (a client reply, a document summary, a number), run these six questions before it goes
        anywhere. Each one is something you just saw.
      </p>
      <div className="checks6">
        {AI_CHECKS.map((c, i) => {
          const { lines, worst } = checkEvidence(c, act, answers);
          return (
            <div key={c.id} className={`c6 ${worst}`}>
              <div className="c6-num">{i + 1}</div>
              <div className="c6-body">
                <div className="c6-title">{c.title}</div>
                <p>{c.text}</p>
                <div className="c6-ev">
                  {lines.length ? (
                    lines.map((l) => (
                      <span key={l.id} className={`ev ${l.tone}`}>
                        <b>{l.label}:</b> {l.text}
                      </span>
                    ))
                  ) : (
                    <span className="ev none">You’ll see this one in {other}.</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────── the lab ───────────── */

type Page = { kind: 'step'; step: Step } | { kind: 'result'; title: string } | { kind: 'aicheck'; title: string };
type SaveState = 'loading' | 'saved' | 'saving' | 'local';
const SAVE_LABEL: Record<SaveState, string> = { loading: 'Loading…', saved: 'Saved', saving: 'Saving…', local: 'Saved on this device' };

export default function CopilotLab({ activity, projectName, sessionId, projectId }: CopilotLabProps) {
  const act = ACTIVITIES[activity];
  const [answers, setAnswers] = useState<Answers>({});
  const [stepIx, setStepIx] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [save, setSave] = useState<SaveState>('loading');
  const loaded = useRef(false);
  const dirty = useRef(false);
  const latest = useRef<Answers>({});
  const mainRef = useRef<HTMLDivElement>(null);

  const pages: Page[] = useMemo(
    () => [...act.steps.map((s) => ({ kind: 'step' as const, step: s })), { kind: 'result', title: 'Your result' }, { kind: 'aicheck', title: 'Your AI check' }],
    [act],
  );
  const page = pages[Math.min(stepIx, pages.length - 1)];

  // Save now (on Next, on leaving, or 800 ms after the last change). A failure keeps the answers on this device.
  const flush = useCallback(async () => {
    if (!loaded.current || !dirty.current || !sessionId) return;
    const a = latest.current;
    dirty.current = false;
    setSave('saving');
    try {
      await saveLab(sessionId, projectId, a, completedSteps(act, a));
      clearLocal(projectId);
      setSave(dirty.current ? 'saving' : 'saved');
    } catch {
      writeLocal(projectId, act.id, a);
      dirty.current = true; // retried on the next change
      setSave('local');
    }
  }, [act, projectId, sessionId]);

  // load: the server's copy, unless this device holds answers that never reached it
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    const local = readLocal(projectId);
    loadLab(sessionId, projectId)
      .then((s) => {
        if (!live) return;
        const pending = local && local.activity === act.id ? local.answers : null;
        const a = pending || s.answers || {};
        latest.current = a;
        setAnswers(a);
        loaded.current = true;
        if (pending) {
          dirty.current = true;
          flush();
        } else setSave('saved');
      })
      .catch(() => {
        if (!live) return;
        const a = local && local.activity === act.id ? local.answers : {};
        latest.current = a;
        setAnswers(a);
        loaded.current = true;
        setSave('local');
      });
    return () => {
      live = false;
    };
  }, [sessionId, projectId, act.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 800 ms after the last change
  useEffect(() => {
    if (!loaded.current || !dirty.current) return;
    setSave('saving');
    const t = setTimeout(flush, 800);
    return () => clearTimeout(t);
  }, [answers, flush]);

  // leaving the page (tab close, navigation away)
  useEffect(() => {
    const leave = () => {
      if (dirty.current) flush();
    };
    window.addEventListener('beforeunload', leave);
    window.addEventListener('pagehide', leave);
    return () => {
      leave();
      window.removeEventListener('beforeunload', leave);
      window.removeEventListener('pagehide', leave);
    };
  }, [flush]);

  const setAns = (id: string, v: Answers[string]) => {
    dirty.current = true;
    setAnswers((p) => {
      const next = { ...p, [id]: v };
      latest.current = next;
      return next;
    });
  };

  const go = (i: number) => {
    flush();
    setStepIx(i);
    mainRef.current?.scrollTo({ top: 0 });
  };

  const reset = async () => {
    setConfirmReset(false);
    latest.current = {};
    dirty.current = false;
    setAnswers({});
    setStepIx(0);
    clearLocal(projectId);
    setSave('saving');
    try {
      await clearLab(sessionId, projectId);
      setSave('saved');
    } catch {
      setSave('local');
    }
  };

  useEffect(() => {
    if (!confirmReset) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setConfirmReset(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [confirmReset]);

  const doneSteps = act.steps.filter((s) => stepDone(s, answers)).length;

  return (
    <div className="cpl">
      <header className="top no-print">
        <div className="min-w-0">
          <div className="eyebrow">{projectName} · Copilot</div>
          <h1 className="h1">{act.title}</h1>
        </div>
        <span className="sp" />
        <span className="muted small saved" aria-live="polite">{SAVE_LABEL[save]}</span>
        <button type="button" className="btn" onClick={() => setConfirmReset(true)} disabled={save === 'loading'}>Start again</button>
      </header>

      <div className="body">
        <nav className="rail no-print" aria-label="Steps">
          <div className="small muted rail-sum num">{doneSteps} of {act.steps.length} steps done</div>
          {pages.map((p, i) => {
            const isStep = p.kind === 'step';
            const done = isStep && stepDone(p.step, answers);
            const label = isStep ? p.step.title : p.title;
            const num = isStep ? i + 1 : p.kind === 'result' ? '★' : '✓';
            return (
              <button
                key={i}
                type="button"
                aria-current={i === stepIx ? 'step' : undefined}
                className={`rail-item ${i === stepIx ? 'on' : ''} ${done ? 'done' : ''} ${!isStep ? 'end' : ''}`}
                onClick={() => go(i)}
              >
                <i>{done ? '✓' : num}</i>
                <span>{isStep ? `Step ${i + 1}: ` : ''}{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="main-scroll" ref={mainRef}>
          <main className="main">
            {save === 'loading' ? (
              <p className="muted">Loading your answers…</p>
            ) : (
              <>
                {page.kind === 'step' && (
                  <>
                    <div className="step-head">
                      <div className="eyebrow">Step {stepIx + 1} of {act.steps.length}</div>
                      <h2 className="h2">{page.step.title}</h2>
                    </div>
                    {page.step.blocks.map((b, i) => {
                      const k = `${page.step.id}-${i}`;
                      if (b.type === 'text') return <p key={k} className={b.tone === 'note' ? 'note-line' : 'lead'}><Rich text={b.text} /></p>;
                      if (b.type === 'prompt') return <PromptCard key={k} text={b.text} hint={b.hint} />;
                      if (b.type === 'download') {
                        return (
                          <a key={k} className="download" href={b.href} download>
                            <span className="file-ic">PDF</span>
                            <span><b>{b.name}</b><br /><span className="muted small">{b.size}</span></span>
                            <span className="sp" />
                            <span className="btn">Download</span>
                          </a>
                        );
                      }
                      if (b.type === 'checklist' || b.type === 'reveal') {
                        return <Checklist key={k} b={b} ans={answers[b.id] as ChecklistAnswer | undefined} set={(v) => setAns(b.id, v)} hidden={b.type === 'reveal'} />;
                      }
                      if (b.type === 'choice') return <Choice key={k} b={b} ans={answers[b.id] as number | undefined} set={(v) => setAns(b.id, v)} />;
                      if (b.type === 'fieldcheck') return <FieldCheck key={k} b={b} ans={answers[b.id] as FieldCheckAnswer | undefined} set={(v) => setAns(b.id, v)} />;
                      if (b.type === 'notes') return <Notes key={k} b={b} ans={answers[b.id] as NotesAnswer | undefined} set={(v) => setAns(b.id, v)} />;
                      return null;
                    })}
                  </>
                )}
                {page.kind === 'result' && <ResultPage act={act} answers={answers} />}
                {page.kind === 'aicheck' && <AiCheckPage act={act} answers={answers} />}
              </>
            )}

            <div className="nav no-print">
              <button type="button" className="btn" disabled={stepIx === 0} onClick={() => go(stepIx - 1)}>← Back</button>
              <span className="sp" />
              {stepIx < pages.length - 1 && (
                <button type="button" className="btn pri" onClick={() => go(stepIx + 1)}>
                  {pages[stepIx + 1].kind === 'step' ? 'Next →' : `${(pages[stepIx + 1] as { title: string }).title} →`}
                </button>
              )}
            </div>
          </main>
        </div>
      </div>

      {confirmReset && (
        <div className="modal-bg" onClick={() => setConfirmReset(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cpl-reset-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="cpl-reset-title">Start this lab again?</h3>
            <p className="muted">Your ticks and notes for this lab will be cleared.</p>
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setConfirmReset(false)} autoFocus>Cancel</button>
              <button type="button" className="btn pri" onClick={reset}>Start again</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
