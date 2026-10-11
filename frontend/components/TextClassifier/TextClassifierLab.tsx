'use client';

/**
 * Day 1 · Exercise 2 · Text classifier (Text Classification projects)
 *
 * 1 Dataset          six finance packs (real CFPB / BANKING77 / headlines, synthetic custody); read 10 rows
 * 2 Inspect & clean  missing values, duplicates, conflicting labels, leakage, XXXX masks → cleaning choices
 * 3 Representation   TF-IDF words (Ex 3 can open it) or a hashed character vector (honestly named)
 * 4 Train            Basic presets or Advanced settings; loss and accuracy curves; scorecard; run history
 * 5 Type + Enter     the model's label, confidence and the words behind it; mark right/wrong;
 *                    the most confidently wrong message is the one to share
 *
 * Everything is saved on the server (state, runs, models, typed messages), so the learner resumes
 * where they left. Exercise 3 (Confusion Matrix project → My Ex 2 model) opens the same model.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import config from '../../lib/config';
import { useAppTheme } from '../../lib/theme';
import { ADVANCED_ORDER, DEFAULTS, OPTIONS, PRESETS, REPRESENTATIONS, TRY_HINTS, num, pct, presetOf, sameParams, summary } from './settings';
import type {
  CellKey, Clean, CurvePoint, Dataset, Example, Inspect, Level, Params, Preset, Project, Representation, Run, SampleRow, Step, Try,
} from './types';
import './textClassifier.css';

interface Props {
  projectName: string;
  sessionId: string;
  projectId: string;
}

class ApiError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = body?.detail;
    const msg = Array.isArray(d) ? d.map((x: { msg?: string }) => (x.msg || '').replace(/^Value error, /, '')).join(' ') : d;
    throw new ApiError(msg || `Request failed (${res.status})`);
  }
  return body as T;
}

/* ───────────── Icons ───────────── */

const Svg = ({ children, s = 16 }: { children: ReactNode; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IcCheck = () => <Svg s={14}><path d="M20 6L9 17l-5-5" /></Svg>;
const IcX = () => <Svg s={14}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcInfo = () => <Svg s={15}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
const IcArrow = () => <Svg s={14}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const IcBack = () => <Svg s={14}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
const IcPlay = () => <Svg s={14}><path d="M7 4l13 8-13 8z" /></Svg>;
const IcSend = () => <Svg s={14}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></Svg>;
const IcTrash = () => <Svg s={13}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;
const IcLink = () => <Svg s={12}><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Svg>;

const STEPS: { n: Step; title: string; sub: string }[] = [
  { n: 1, title: 'Dataset', sub: 'Choose a pack, read rows' },
  { n: 2, title: 'Inspect & clean', sub: 'Missing, duplicates, leakage' },
  { n: 3, title: 'Representation', sub: 'How text becomes numbers' },
  { n: 4, title: 'Train', sub: 'Curves and scorecard' },
  { n: 5, title: 'Type + Enter', sub: 'Test it on your own words' },
];

const CELLS: Record<CellKey, { cls: string; name: string }> = {
  tp: { cls: 'ok', name: 'Caught' },
  fn: { cls: 'miss', name: 'Missed' },
  fp: { cls: 'fa', name: 'False alarm' },
  tn: { cls: 'ok', name: 'Correctly left' },
};

/** Text with the regulator's XXXX masks highlighted. */
function Masked({ text }: { text: string }) {
  const parts = text.split(/(\S*XX\S*)/g);
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="x">{p}</mark> : <span key={i}>{p}</span>))}</>;
}

const clsOf = (ds: { classes: string[] } | null, label: string) => (ds && label === ds.classes[0] ? 'c0' : 'c1');

/* ───────────── Curves ───────────── */

function Curve({ points, kind }: { points: CurvePoint[]; kind: 'loss' | 'acc' }) {
  const W = 320, H = 150, L = 34, R = 8, T = 8, B = 22;
  const tr = points.map((p) => (kind === 'loss' ? p.trainLoss : p.trainAcc));
  const te = points.map((p) => (kind === 'loss' ? p.testLoss : p.testAcc));
  const all = [...tr, ...te];
  const lo = kind === 'loss' ? 0 : Math.max(0, Math.floor(Math.min(...all) * 10) / 10);
  const hi = kind === 'loss' ? Math.max(0.1, Math.ceil(Math.max(...all) * 10) / 10) : 1;
  const x = (i: number) => L + (points.length > 1 ? (i * (W - L - R)) / (points.length - 1) : (W - L - R) / 2);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ticks = [lo, (lo + hi) / 2, hi];
  const every = Math.max(1, Math.ceil(points.length / 7));
  return (
    <div className="chart">
      <p className="sub-h">
        {kind === 'loss' ? 'Loss' : 'Accuracy'}
        <span>{kind === 'loss' ? 'lower is better' : 'higher is better'} · by learning step</span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kind === 'loss' ? 'Loss' : 'Accuracy'} by learning step`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="gl" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 5} y={y(t) + 3} textAnchor="end">{kind === 'acc' ? `${Math.round(t * 100)}%` : t.toFixed(2)}</text>
          </g>
        ))}
        <line className="ax" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        {points.map((p, i) => (i % every === 0 || i === points.length - 1 ? (
          <text key={p.iter} x={x(i)} y={H - 6} textAnchor="middle">{p.iter}</text>
        ) : null))}
        <path className="ln tr" d={path(tr)} />
        <path className="ln te" d={path(te)} />
        <circle className="pt tr" cx={x(tr.length - 1)} cy={y(tr[tr.length - 1])} r={3} />
        <circle className="pt te" cx={x(te.length - 1)} cy={y(te[te.length - 1])} r={3} />
      </svg>
      <div className="chart-k">
        <span><i />Training</span>
        <span><i className="te" />Test (never seen)</span>
      </div>
    </div>
  );
}

/** One plain sentence about what the curves show. */
function curveReading(c: CurvePoint[]): string {
  if (!c.length) return '';
  const last = c[c.length - 1];
  const gap = last.trainAcc - last.testAcc;
  const best = c.reduce((a, b) => (b.testAcc > a.testAcc ? b : a), c[0]);
  const parts = [`After ${last.iter} steps: ${pct(last.trainAcc)} right on the training rows, ${pct(last.testAcc)} on the test rows.`];
  if (gap > 0.08) parts.push('The gap is large: the model is memorising its training rows more than it is learning general patterns.');
  else parts.push('The two lines stay close: what it learned carries over to text it has never seen.');
  if (best.iter < last.iter && best.testAcc - last.testAcc > 0.01) parts.push(`Test accuracy peaked at step ${best.iter} (${pct(best.testAcc)}).`);
  return parts.join(' ');
}

/* ───────────── Main ───────────── */

export default function TextClassifierLab({ sessionId, projectId }: Props) {
  const [theme] = useAppTheme();
  const base = config.api.textClassification.project(sessionId, projectId);

  const [project, setProject] = useState<Project | null>(null);
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Learner's place (restored from and autosaved to the project)
  const [step, setStep] = useState<Step>(1);
  const [representation, setRepresentation] = useState<Representation>('tfidf');
  const [level, setLevel] = useState<Level>('basic');
  const [preset, setPreset] = useState<Preset>('balanced');
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [selId, setSelId] = useState<string | null>(null);
  const savedRef = useRef('');
  const loadedOnce = useRef(false); // a reload (remount, dev refresh) must not move the learner back a step

  const [samplePage, setSamplePage] = useState(0);
  const [sample, setSample] = useState<SampleRow[] | null>(null);
  const sampleCache = useRef(new Map<string, SampleRow[]>());
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [cell, setCell] = useState<CellKey | null>(null);
  const [examples, setExamples] = useState<{ items: Example[]; total: number } | null>(null);
  const examplesCache = useRef(new Map<string, { items: Example[]; total: number }>());
  const [draft, setDraft] = useState('');

  const applyProject = useCallback((p: Project, moveTo?: Step) => {
    setProject(p);
    setRepresentation(p.state.representation);
    setLevel(p.state.level);
    setParams({ ...DEFAULTS, ...p.state.params });
    setPreset(p.state.preset);
    setSelId(p.state.selectedRunId);
    if (moveTo) setStep(moveTo);
    savedRef.current = JSON.stringify({
      step: moveTo ?? p.state.step, representation: p.state.representation, level: p.state.level,
      preset: p.state.preset, params: { ...DEFAULTS, ...p.state.params }, selectedRunId: p.state.selectedRunId,
    });
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [p, d] = await Promise.all([api<{ data: Project }>(base), api<{ data: Dataset[] }>(config.api.textClassification.datasets)]);
      const st = p.data.state;
      const hasRun = p.data.runs.some((r) => r.id === st.selectedRunId);
      const allowed: Step = !st.datasetId ? 1 : !st.inspected ? 2 : !hasRun ? (Math.min(st.step, 4) as Step) : st.step;
      applyProject(p.data, loadedOnce.current ? undefined : allowed);
      loadedOnce.current = true;
      setDatasets(d.data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [base, applyProject]);

  useEffect(() => { load(); }, [load]);

  // Autosave the learner's place (debounced)
  useEffect(() => {
    if (!project) return;
    const snap = JSON.stringify({ step, representation, level, preset, params, selectedRunId: selId });
    if (snap === savedRef.current) return;
    const t = setTimeout(() => {
      savedRef.current = snap;
      api(`${base}/state`, { method: 'PUT', body: snap }).catch(() => { savedRef.current = ''; });
    }, 600);
    return () => clearTimeout(t);
  }, [project, base, step, representation, level, preset, params, selId]);

  const dataset = project?.dataset ?? null;
  const state = project?.state;
  const runsHere = useMemo(() => (project && dataset ? project.runs.filter((r) => r.datasetId === dataset.id) : []), [project, dataset]);
  const sel: Run | null = useMemo(() => project?.runs.find((r) => r.id === selId) ?? null, [project, selId]);
  const unlocked = (n: Step) =>
    n === 1 || (n === 2 && !!state?.datasetId) || ((n === 3 || n === 4) && !!state?.inspected) || (n === 5 && !!sel && sel.datasetId === dataset?.id);

  /* ── step 1: sample rows ── */
  useEffect(() => {
    if (!dataset) { setSample(null); return; }
    const key = `${dataset.id}:${samplePage}`;
    const hit = sampleCache.current.get(key);
    if (hit) { setSample(hit); return; }
    let live = true;
    setSample(null);
    api<{ data: SampleRow[] }>(config.api.textClassification.sample(dataset.id, samplePage))
      .then((r) => { sampleCache.current.set(key, r.data); if (live) setSample(r.data); })
      .catch(() => live && setSample([]));
    return () => { live = false; };
  }, [dataset, samplePage]);

  const choose = async (id: string) => {
    if (busy || id === state?.datasetId) return;
    setBusy('Loading the pack'); setError(null);
    try {
      const r = await api<{ data: Project }>(`${base}/dataset`, { method: 'POST', body: JSON.stringify({ datasetId: id }) });
      applyProject(r.data, 1);
      setInspect(null); setSamplePage(0); setCell(null); setExamples(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /* ── step 2: inspect ── */
  const runInspect = useCallback(async (clean: Clean | null) => {
    setBusy('Checking the data'); setError(null);
    try {
      const r = await api<{ data: Inspect }>(`${base}/inspect`, { method: 'POST', body: JSON.stringify({ clean }) });
      setInspect(r.data);
      setProject((p) => (p ? { ...p, state: { ...p.state, inspected: true, clean: r.data.clean } } : p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [base]);

  useEffect(() => {
    if (step === 2 && state?.datasetId && !inspect && !busy) runInspect(null);
  }, [step, state?.datasetId, inspect, busy, runInspect]);

  const toggleClean = (k: keyof Clean) => {
    if (!inspect) return;
    runInspect({ ...inspect.clean, [k]: !inspect.clean[k] });
  };

  /* ── step 4: train ── */
  const effective: Params = level === 'basic' && preset !== 'custom' ? PRESETS[preset].params : params;
  const stale = !sel || sel.datasetId !== dataset?.id || sel.representation !== representation || !sameParams(sel.params, effective)
    || !sameClean(sel.clean, state?.clean);

  const train = async () => {
    setBusy('Training'); setError(null); setCell(null); setExamples(null);
    try {
      const body = { representation, preset: level === 'basic' ? preset : presetOf(effective), level, params: effective };
      const r = await api<{ data: Project }>(`${base}/train`, { method: 'POST', body: JSON.stringify(body) });
      applyProject(r.data, 4);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pickRun = (r: Run) => {
    setSelId(r.id);
    setRepresentation(r.representation);
    setParams(r.params);
    const p = presetOf(r.params);
    setPreset(p);
    if (p === 'custom') setLevel('advanced');
    setCell(null); setExamples(null);
  };

  const openCell = async (k: CellKey) => {
    if (!sel) return;
    if (cell === k) { setCell(null); return; }
    setCell(k);
    const key = `${sel.id}:${k}`;
    const hit = examplesCache.current.get(key);
    if (hit) { setExamples(hit); return; }
    setExamples(null);
    try {
      const r = await api<{ data: Example[]; total: number }>(`${base}/runs/${sel.id}/examples?cell=${k}&limit=5`);
      const v = { items: r.data, total: r.total };
      examplesCache.current.set(key, v);
      setExamples(v);
    } catch {
      setExamples({ items: [], total: 0 });
    }
  };

  /* ── step 5: type + Enter ── */
  const send = async () => {
    const text = draft.trim();
    if (!text || busy || !sel) return;
    setBusy('Asking the model'); setError(null);
    try {
      const r = await api<{ data: Try }>(`${base}/predict`, { method: 'POST', body: JSON.stringify({ text, runId: sel.id }) });
      setProject((p) => (p ? { ...p, tries: [...p.tries, r.data] } : p));
      setDraft('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const mark = async (t: Try, verdict: 'right' | 'wrong') => {
    const next = t.verdict === verdict ? null : verdict;
    setProject((p) => (p ? { ...p, tries: p.tries.map((x) => (x.id === t.id ? { ...x, verdict: next } : x)) } : p));
    api(`${base}/tries/${t.id}`, { method: 'PATCH', body: JSON.stringify({ verdict: next }) }).catch(() => setError('Could not save that mark.'));
  };
  const remove = async (t: Try) => {
    setProject((p) => (p ? { ...p, tries: p.tries.filter((x) => x.id !== t.id) } : p));
    api(`${base}/tries/${t.id}`, { method: 'DELETE' }).catch(() => setError('Could not delete that message.'));
  };

  const tries = useMemo(() => (project && sel ? project.tries.filter((t) => t.runId === sel.id).slice().reverse() : []), [project, sel]);
  const worst = useMemo(() => tries.filter((t) => t.verdict === 'wrong').sort((a, b) => b.confidence - a.confidence)[0] ?? null, [tries]);

  /* ───────────── Render ───────────── */

  if (loadState !== 'ready' || !project || !datasets) {
    return (
      <div className="tcx" data-theme={theme}>
        <div className="loading">
          {loadState === 'error' ? (
            <div>
              <p>Couldn&apos;t open this project.</p>
              <button className="btn" onClick={load}>Try again</button>
            </div>
          ) : <p>Opening the text classifier…</p>}
        </div>
      </div>
    );
  }

  const next = (n: Step, label: string, disabled = false) => (
    <button className="btn pri lg" disabled={disabled || !!busy} onClick={() => setStep(n)}>{label} <IcArrow /></button>
  );
  const back = (n: Step) => (
    <button className="btn ghost" onClick={() => setStep(n)} disabled={!!busy}><IcBack /> Back</button>
  );

  return (
    <div className="tcx" data-theme={theme}>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eyebrow">Day 1 · Exercise 2</div>
            <h1 className="h1">Text classifier</h1>
            <p className="lead">
              Rules only know the words someone thought of. Here the computer <b>learns the words from labelled examples</b>: choose a
              finance pack, check and clean it, train a model, then test it on messages you write yourself.
            </p>
          </div>
        </div>

        <nav className="steps" aria-label="Steps">
          {STEPS.map((s) => (
            <button
              key={s.n}
              className={`stp ${step === s.n ? 'on' : ''} ${step !== s.n && unlocked(s.n) && s.n < step ? 'done' : ''}`}
              disabled={!unlocked(s.n) || !!busy}
              onClick={() => setStep(s.n)}
              aria-current={step === s.n ? 'step' : undefined}
            >
              <span className="n">{step !== s.n && s.n < step && unlocked(s.n) ? <IcCheck /> : s.n}</span>
              <span><b>{s.title}</b><small>{s.sub}</small></span>
            </button>
          ))}
        </nav>

        {error && <p className="err" role="alert">{error}</p>}

        {/* ── 1 Dataset ── */}
        {step === 1 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">1 · Choose a dataset</h2>
                <p>Each pack has two labels. The first is the class we care about: the one Exercise 3 asks you to catch.</p>
              </div>
            </div>
            <div className="packs">
              {datasets.map((d) => (
                <button key={d.id} className={`pack ${state?.datasetId === d.id ? 'on' : ''}`} onClick={() => choose(d.id)} disabled={!!busy}>
                  <div className="top">
                    <span className={`badge ${d.kind === 'real' ? 'ok' : ''}`}>{d.kind === 'real' ? 'Real data' : 'Synthetic'}</span>
                    {d.recommended && <span className="badge ac">Use this in Ex 2</span>}
                    <span className="sp" />
                    <span className="muted num" style={{ fontSize: 12 }}>{num(d.n)} rows</span>
                  </div>
                  <h3>{d.name}</h3>
                  <div className="cls">
                    <span className="pill c0">{d.classes[0]} · {num(d.counts[0])}</span>
                    <span className="pill c1">{d.classes[1]} · {num(d.counts[1])}</span>
                  </div>
                  <p>{d.blurb}</p>
                  <span className="src">{d.source} · {d.licence}</span>
                </button>
              ))}
            </div>

            {dataset && (
              <div className="panel rows">
                <div className="rows-h">
                  <h3>Read the rows: {dataset.name}</h3>
                  <span className="muted">Rows {num(samplePage * 10 + 1)}–{num(Math.min(dataset.n, samplePage * 10 + 10))} of {num(dataset.n)}, cut at 280 characters</span>
                  <span className="sp" />
                  <button className="btn sm" onClick={() => setSamplePage((p) => Math.max(0, p - 1))} disabled={samplePage === 0}>Previous</button>
                  <button className="btn sm" onClick={() => setSamplePage((p) => p + 1)} disabled={(samplePage + 1) * 10 >= dataset.n}>Next 10</button>
                </div>
                <div className="scroll">
                  <table className="t">
                    <thead><tr><th>id</th><th>Label</th><th>Text</th></tr></thead>
                    <tbody>
                      {sample === null && <tr><td colSpan={3} className="muted">Loading rows…</td></tr>}
                      {sample?.map((r) => (
                        <tr key={r.id}>
                          <td className="id">{r.id}</td>
                          <td className="lb"><span className={`pill ${clsOf(dataset, r.label)}`}>{r.label}</span></td>
                          <td><Masked text={r.text} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pad" style={{ paddingTop: 12 }}>
                  <div className="note">
                    <IcInfo />
                    <span>
                      <b>Why this pack.</b> {dataset.nuvama}{' '}
                      {dataset.sourceUrl && (
                        <a className="link" href={dataset.sourceUrl} target="_blank" rel="noreferrer">Source <IcLink /></a>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div className="foot">
              {!dataset && <span className="muted">Choose a pack to read its rows.</span>}
              {next(2, 'Next: inspect and clean', !dataset)}
            </div>
          </section>
        )}

        {/* ── 2 Inspect & clean ── */}
        {step === 2 && dataset && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">2 · Inspect and clean: {dataset.name}</h2>
                <p>Real data is messy. Check it before training: a model learns whatever is in the file, mistakes included.</p>
              </div>
            </div>
            {!inspect ? (
              <div className="panel empty">Checking {num(dataset.n)} rows…</div>
            ) : (
              <>
                <div className="checks">
                  <div className="check">
                    <small>Rows</small>
                    <b className="num">{num(inspect.n)}</b>
                    <span>{dataset.classes[0]} {num(inspect.counts[0])} · {dataset.classes[1]} {num(inspect.counts[1])}</span>
                  </div>
                  <div className={`check ${inspect.missing ? 'flag' : 'clear'}`}>
                    <small><i className="dot" />Missing values</small>
                    <b className="num">{num(inspect.missing)}</b>
                    <span>Blank texts or unknown labels. Always left out: nothing to learn from.</span>
                  </div>
                  <div className={`check ${inspect.duplicates ? 'flag' : 'clear'}`}>
                    <small><i className="dot" />Duplicates</small>
                    <b className="num">{num(inspect.duplicates)}</b>
                    <span>Extra copies of a text with the same label{inspect.duplicateGroups ? ` (${inspect.duplicateGroups === 1 ? "1 text" : `${num(inspect.duplicateGroups)} texts`})` : ''}.</span>
                  </div>
                  <div className={`check ${inspect.conflicts ? 'flag' : 'clear'}`}>
                    <small><i className="dot" />Conflicting labels</small>
                    <b className="num">{num(inspect.conflicts)}</b>
                    <span>Rows where the same text has different labels{inspect.conflictGroups ? ` (${inspect.conflictGroups === 1 ? "1 text" : `${num(inspect.conflictGroups)} texts`})` : ''}.</span>
                  </div>
                  <div className={`check ${inspect.leakage ? 'flag' : 'clear'}`}>
                    <small><i className="dot" />Leakage risk</small>
                    <b className="num">{num(inspect.leakage)}</b>
                    <span>Rows whose text appears more than once. A copy can land in training and another in the test, so the test is partly an exam the model has already seen.</span>
                  </div>
                  <div className={`check ${inspect.masked ? 'flag' : 'clear'}`}>
                    <small><i className="dot" />XXXX masking</small>
                    <b className="num">{num(inspect.masked)}</b>
                    <span>{inspect.masked ? 'Rows where names, dates or amounts were replaced with XXXX.' : 'No masked rows.'}</span>
                  </div>
                  <div className="check">
                    <small>Text length</small>
                    <b className="num">{num(inspect.words.median)} words</b>
                    <span>Typical row ({num(inspect.chars.median)} characters). Longest: {num(inspect.chars.max)} characters.</span>
                  </div>
                  <div className="check">
                    <small>Balance</small>
                    <b className="num">{pct(inspect.counts[0] / Math.max(1, inspect.n), 0)}</b>
                    <span>of rows are {dataset.classes[0]}. Near 50% means accuracy isn’t flattered by one big class.</span>
                  </div>
                </div>

                {inspect.masked > 0 && (
                  <div className="notice" style={{ marginTop: 16 }}>
                    <IcInfo />
                    <span>
                      <b>Point out the XXXX masking.</b> Before publishing, the regulator replaced names, dates, account numbers and some amounts with
                      XXXX ({pct(inspect.masked / inspect.n, 0)} of rows). To the model, “XXXX” is just a very common word that appears in both
                      classes, so it carries almost no signal. Clients’ real messages won’t contain it. Try training with and without “Remove XXXX masks”.
                    </span>
                  </div>
                )}

                <div className="cleaning">
                  <div className="panel toggles">
                    <label className={`tg ${!inspect.duplicates ? 'off' : ''}`}>
                      <input type="checkbox" checked={inspect.clean.dropDuplicates} onChange={() => toggleClean('dropDuplicates')} disabled={!!busy || (!inspect.duplicates && !inspect.clean.dropDuplicates)} />
                      <span><b>Drop duplicates</b><span>Keep one copy of each text. Removes {rows(inspect.duplicates)} and stops copies leaking into the test.</span></span>
                    </label>
                    <label className={`tg ${!inspect.conflicts ? 'off' : ''}`}>
                      <input type="checkbox" checked={inspect.clean.dropConflicts} onChange={() => toggleClean('dropConflicts')} disabled={!!busy || (!inspect.conflicts && !inspect.clean.dropConflicts)} />
                      <span><b>Drop conflicting labels</b><span>When the same text has both labels, neither can be trusted. Removes {rows(inspect.conflicts)}.</span></span>
                    </label>
                    <label className={`tg ${!inspect.masked ? 'off' : ''}`}>
                      <input type="checkbox" checked={inspect.clean.removeMasks} onChange={() => toggleClean('removeMasks')} disabled={!!busy || (!inspect.masked && !inspect.clean.removeMasks)} />
                      <span><b>Remove XXXX masks</b><span>Delete the placeholder words before training. Amounts like {'{$150.00}'} stay.</span></span>
                    </label>
                  </div>
                  <div className="panel after">
                    <small className="muted">After cleaning, the model learns and is tested on</small>
                    <span className="big num">{num(inspect.after.n)} rows</span>
                    <div className="bar">
                      <i className="c0" style={{ width: `${(inspect.after.counts[0] / Math.max(1, inspect.after.n)) * 100}%` }} />
                      <i className="c1" style={{ width: `${(inspect.after.counts[1] / Math.max(1, inspect.after.n)) * 100}%` }} />
                    </div>
                    <div className="legend">
                      <span><i style={{ background: 'var(--c0)' }} />{dataset.classes[0]} {num(inspect.after.counts[0])}</span>
                      <span><i style={{ background: 'var(--c1)' }} />{dataset.classes[1]} {num(inspect.after.counts[1])}</span>
                    </div>
                    {inspect.after.n < inspect.n && <span className="muted" style={{ fontSize: 12.5 }}>{rows(inspect.n - inspect.after.n)} removed.</span>}
                  </div>
                </div>

                {(inspect.examples.conflicts.length > 0 || inspect.examples.duplicates.length > 0) && (
                  <div className="panel exs">
                    <div className="rows-h"><h3>What the problems look like</h3></div>
                    {inspect.examples.conflicts.slice(0, 2).map((e) => (
                      <div className="ex" key={`c${e.id}`}>
                        <span><Masked text={e.text} /></span>
                        <span className="lbls">Conflict · {e.copies} copies labelled {e.labels.map((l) => <span key={l} className={`pill ${clsOf(dataset, l)}`}>{l}</span>)}</span>
                      </div>
                    ))}
                    {inspect.examples.duplicates.slice(0, 2).map((e) => (
                      <div className="ex" key={`d${e.id}`}>
                        <span><Masked text={e.text} /></span>
                        <span className="lbls">Duplicate · {e.copies} copies, all <span className={`pill ${clsOf(dataset, e.labels[0])}`}>{e.labels[0]}</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="foot">
              {back(1)}
              {next(3, 'Next: representation', !inspect)}
            </div>
          </section>
        )}

        {/* ── 3 Representation ── */}
        {step === 3 && dataset && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">3 · Choose a representation</h2>
                <p>A model can’t read words. First the text is turned into numbers; this choice decides what the model can notice.</p>
              </div>
            </div>
            <div className="reps">
              {(Object.keys(REPRESENTATIONS) as Representation[]).map((k) => {
                const r = REPRESENTATIONS[k];
                return (
                  <button key={k} className={`rep ${representation === k ? 'on' : ''}`} onClick={() => setRepresentation(k)} disabled={!!busy}>
                    <h3>{r.name} <span className={`badge ${k === 'tfidf' ? 'ac' : ''}`}>{r.tag}</span></h3>
                    <p>{r.what}</p>
                    <div className="pro"><IcCheck /><span>{r.good}</span></div>
                    <div className="con"><IcInfo /><span>{r.limit}</span></div>
                  </button>
                );
              })}
            </div>
            {sample && sample[0] && (
              <div className="panel demo">
                <div className="rows-h">
                  <h3>What the model sees in row {sample[0].id}</h3>
                  <span className="muted">first features, after lowercasing and removing punctuation</span>
                </div>
                <div className="tokens">
                  {features(sample[0].text, representation).map((f, i) => <span className="tok" key={i}>{f}</span>)}
                  <span className="muted" style={{ fontSize: 12 }}>…</span>
                </div>
              </div>
            )}
            <div className="foot">
              {back(2)}
              {next(4, 'Next: train')}
            </div>
          </section>
        )}

        {/* ── 4 Train ── */}
        {step === 4 && dataset && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">4 · Train: {dataset.name}</h2>
                <p>
                  {REPRESENTATIONS[representation].name} + logistic regression. {pct(effective.testSplit, 0)} of the rows are held back as a test the
                  model never sees; the scorecard is measured on those.
                </p>
              </div>
            </div>
            <div className="grid">
              <aside className="panel">
                <div className="set-h"><h3>Settings</h3></div>
                <div className="levels" role="tablist">
                  {(['basic', 'advanced'] as Level[]).map((l) => (
                    <button key={l} role="tab" aria-selected={level === l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)} disabled={!!busy}>
                      {l === 'basic' ? 'Basic' : 'Advanced'}
                    </button>
                  ))}
                </div>
                {level === 'basic' ? (
                  <>
                    <div className="presets">
                      {(Object.keys(PRESETS) as Exclude<Preset, 'custom'>[]).map((k) => (
                        <button key={k} className={`preset ${preset === k ? 'on' : ''}`} onClick={() => { setPreset(k); setParams(PRESETS[k].params); }} disabled={!!busy}>
                          <b>{PRESETS[k].name}{k === 'balanced' && <span className="badge ac">Ex 2</span>}</b>
                          <span>{PRESETS[k].note}</span>
                        </button>
                      ))}
                      {preset === 'custom' && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Your Advanced settings are in use. Pick a preset to replace them.</p>}
                    </div>
                    <div className="kv"><span>Test data held back</span><b>{pct(effective.testSplit, 0)}</b></div>
                    <div className="kv"><span>Decision threshold</span><b>{effective.threshold.toFixed(1)}</b></div>
                  </>
                ) : (
                  <div className="params">
                    {ADVANCED_ORDER.filter((k) => representation === 'tfidf' || (k !== 'ngrams' && k !== 'maxFeatures')).map((k) => (
                      <div className="param" key={k}>
                        <label htmlFor={`tc-${k}`}>{OPTIONS[k].label}</label>
                        <select
                          id={`tc-${k}`}
                          className="select"
                          value={String(effective[k])}
                          disabled={!!busy}
                          onChange={(e) => { const v = { ...effective, [k]: Number(e.target.value) }; setParams(v); setPreset(presetOf(v)); }}
                        >
                          {OPTIONS[k].opts.some((o) => o.v === effective[k]) ? null : <option value={String(effective[k])}>{effective[k]}</option>}
                          {OPTIONS[k].opts.map((o) => <option key={o.v} value={String(o.v)}>{o.l}</option>)}
                        </select>
                        <small>{OPTIONS[k].help}</small>
                      </div>
                    ))}
                  </div>
                )}
                <div className="set-foot">
                  {busy === 'Training' ? (
                    <>
                      <span className="muted" style={{ fontSize: 12.5 }}>Training on {num(Math.round((inspect?.after.n ?? dataset.n) * (1 - effective.testSplit)))} rows…</span>
                      <div className="track"><i /></div>
                    </>
                  ) : stale ? (
                    <span className="stale"><IcInfo /> {sel ? 'Settings changed: train to see their effect.' : 'Not trained yet.'}</span>
                  ) : (
                    <span className="fresh"><IcCheck /> Showing these exact settings (run {sel?.no}).</span>
                  )}
                  <button className="btn pri lg block" onClick={train} disabled={!!busy}>
                    <IcPlay /> {sel && !stale ? 'Train again' : 'Train model'}
                  </button>
                </div>
              </aside>

              <div className={`panel ${busy === 'Training' ? 'busy' : ''}`}>
                {!sel || sel.datasetId !== dataset.id ? (
                  <div className="empty">Choose settings and press <b>Train model</b>. The curves and the scorecard appear here.</div>
                ) : (
                  <>
                    <div className="res-h">
                      <h3>Run {sel.no}</h3>
                      <span className="badge ac">{REPRESENTATIONS[sel.representation].name}</span>
                      <span className="badge">{summary(sel)}</span>
                      {sel.reusedFit && <span className="badge">same model, new threshold</span>}
                      <p>
                        Learned from {num(sel.trainN)} rows, tested on {num(sel.m.n)} it never saw · threshold {sel.params.threshold.toFixed(1)}
                        {sel.seconds ? ` · ${sel.seconds.toFixed(1)} s` : ''}
                      </p>
                    </div>
                    <div className="res-b">
                      {sel.curves.length > 0 && (
                        <>
                          <div className="curves">
                            <Curve points={sel.curves} kind="loss" />
                            <Curve points={sel.curves} kind="acc" />
                          </div>
                          <p className="read">{curveReading(sel.curves)}</p>
                        </>
                      )}

                      <p className="sub-h">Scorecard <span>{sel.classes[0]} is the class we care about · click a box to read its messages</span></p>
                      <div className="mx">
                        <div />
                        <div className="ch">Model said<b className="lbl">{sel.classes[0]}</b></div>
                        <div className="ch">Model said<b className="lbl">{sel.classes[1]}</b></div>
                        <div className="rh">Actually<b className="lbl">{sel.classes[0]}</b></div>
                        {(['tp', 'fn'] as CellKey[]).map((k) => (
                          <button key={k} className={`cell ${CELLS[k].cls} ${cell === k ? 'sel' : ''}`} onClick={() => openCell(k)}>
                            <span className="k">{CELLS[k].name}<code>{k.toUpperCase()}</code></span>
                            <span className="n num">{num(sel.m[k])}</span>
                            <span className="w">{k === 'tp' ? `${sel.classes[0]} correctly caught` : `${sel.classes[0]} the model let through`}</span>
                          </button>
                        ))}
                        <div className="rh">Actually<b className="lbl">{sel.classes[1]}</b></div>
                        {(['fp', 'tn'] as CellKey[]).map((k) => (
                          <button key={k} className={`cell ${CELLS[k].cls} ${cell === k ? 'sel' : ''}`} onClick={() => openCell(k)}>
                            <span className="k">{CELLS[k].name}<code>{k.toUpperCase()}</code></span>
                            <span className="n num">{num(sel.m[k])}</span>
                            <span className="w">{k === 'fp' ? `${sel.classes[1]} flagged as ${sel.classes[0]}` : `${sel.classes[1]} kept where it belongs`}</span>
                          </button>
                        ))}
                      </div>
                      {cell && (
                        <div className="msgs">
                          <div className="msgs-h">
                            {CELLS[cell].name}: {examples ? `${num(examples.total)} test rows` : 'loading…'}
                            <span className="sp" />
                            <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>most confident first · P({sel.classes[0]})</span>
                          </div>
                          {examples?.items.map((e) => (
                            <div className="msg" key={e.id}><p><Masked text={e.text} /></p><span>{e.score.toFixed(2)}</span></div>
                          ))}
                          {examples && examples.items.length === 0 && <div className="msg"><p>None in this box.</p></div>}
                        </div>
                      )}
                      <div className="metrics">
                        <div className="metric"><small>Accuracy</small><b className="num">{pct(sel.m.accuracy)}</b><span>of all test rows put in the right class</span></div>
                        <div className="metric"><small>Precision</small><b className="num">{pct(sel.m.precision)}</b><span>of those it called {sel.classes[0]}, how many really were</span></div>
                        <div className="metric"><small>Recall</small><b className="num">{pct(sel.m.recall)}</b><span>of all real {sel.classes[0]}, how many it caught</span></div>
                        <div className="metric"><small>F1</small><b className="num">{pct(sel.m.f1)}</b><span>precision and recall in one number</span></div>
                      </div>
                      <div className="note ex3">
                        <IcInfo />
                        <span>
                          {sel.representation === 'tfidf' ? (
                            <><b>Set this scorecard aside for Exercise 3.</b> There, create a Confusion Matrix project and choose <b>My Ex 2 model</b> → this project. It opens this exact model (run {sel.no}) with {sel.classes[0]} as the class we care about, so you can move the threshold to 0.3 and 0.7.</>
                          ) : (
                            <><b>Exercise 3 opens TF-IDF runs only.</b> Compare this score with a TF-IDF run, then train TF-IDF again before Exercise 3.</>
                          )}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {runsHere.length > 0 && (
              <div className="panel runs">
                <div className="rows-h"><h3>Runs on {dataset.name}</h3><span className="muted">click a run to open it</span></div>
                <div className="scroll">
                  <table className="t">
                    <thead>
                      <tr><th className="l">Run</th><th className="l">Representation · settings</th><th className="l">Cleaning</th><th>Threshold</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th></tr>
                    </thead>
                    <tbody>
                      {runsHere.slice().reverse().map((r) => (
                        <tr key={r.id} className={r.id === selId ? 'on' : ''} onClick={() => !busy && pickRun(r)}>
                          <td className="l"><b>{r.no}</b></td>
                          <td className="l">{REPRESENTATIONS[r.representation].name} · {summary(r)}</td>
                          <td className="l">{cleanText(r.clean)}</td>
                          <td className="num">{r.params.threshold.toFixed(1)}</td>
                          <td className="num">{pct(r.m.accuracy)}</td>
                          <td className="num">{pct(r.m.precision)}</td>
                          <td className="num">{pct(r.m.recall)}</td>
                          <td className="num">{pct(r.m.f1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="foot">
              {back(3)}
              {next(5, 'Next: type your own messages', !sel || sel.datasetId !== dataset.id)}
            </div>
          </section>
        )}

        {/* ── 5 Type + Enter ── */}
        {step === 5 && dataset && sel && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">5 · Type + Enter</h2>
                <p>{TRY_HINTS[dataset.id]?.brief} Note the label and the confidence. Then mark each answer right or wrong.</p>
              </div>
              <span className="sp" />
              <span className="badge ac">Run {sel.no} · {REPRESENTATIONS[sel.representation].name} · {pct(sel.m.accuracy)} on test rows</span>
            </div>
            <div className="try-grid">
              <div>
                <div className="panel composer">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    placeholder={`Type a ${dataset.noun.replace(/s$/, '')} and press Enter`}
                    maxLength={4000}
                    aria-label="Your message"
                  />
                  <div className="row">
                    <span className="muted">Enter to send · Shift+Enter for a new line</span>
                    <button className="btn pri" onClick={send} disabled={!draft.trim() || !!busy}><IcSend /> {busy === 'Asking the model' ? 'Asking…' : 'Send'}</button>
                  </div>
                  {tries.length === 0 && (
                    <div className="chips">
                      <span className="muted" style={{ fontSize: 12 }}>Stuck? Start from:</span>
                      {TRY_HINTS[dataset.id]?.examples.map((x) => <button key={x} className="chip" onClick={() => setDraft(x)}>{x}</button>)}
                    </div>
                  )}
                </div>
                <div className="tries">
                  {tries.map((t) => (
                    <div key={t.id} className={`try ${t.verdict || ''} ${worst?.id === t.id ? 'star' : ''}`}>
                      <p className="q">{t.text}</p>
                      <div className="ans">
                        <span className={`pill ${clsOf(dataset, t.label)}`}>{t.label}</span>
                        <span className="conf">
                          <span className="track2"><i style={{ width: `${t.confidence * 100}%` }} /></span>
                          <b className="num">{pct(t.confidence, 0)}</b> sure
                        </span>
                        <span className="verdict">
                          <button className={`vb r ${t.verdict === 'right' ? 'on' : ''}`} onClick={() => mark(t, 'right')} aria-pressed={t.verdict === 'right'}><IcCheck /> Right</button>
                          <button className={`vb w ${t.verdict === 'wrong' ? 'on' : ''}`} onClick={() => mark(t, 'wrong')} aria-pressed={t.verdict === 'wrong'}><IcX /> Wrong</button>
                          <button className="vb x" onClick={() => remove(t)} aria-label="Delete this message"><IcTrash /></button>
                        </span>
                      </div>
                      {t.evidence.length > 0 && (
                        <div className="why">
                          Words that decided it:
                          {t.evidence.map((e) => (
                            <span key={e.term} className={`w ${e.weight > 0 ? 'c0' : 'c1'}`} title={`pushes towards ${e.weight > 0 ? dataset.classes[0] : dataset.classes[1]}`}>
                              {e.term} {e.weight > 0 ? '→' : '←'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <aside className="side">
                <div className="panel tally">
                  <div><b className="num">{tries.length}</b><span>typed</span></div>
                  <div><b className="num" style={{ color: 'var(--ok)' }}>{tries.filter((t) => t.verdict === 'right').length}</b><span>right</span></div>
                  <div><b className="num" style={{ color: 'var(--bad)' }}>{tries.filter((t) => t.verdict === 'wrong').length}</b><span>wrong</span></div>
                </div>
                <div className="panel share">
                  <h4>Share: the most confidently wrong</h4>
                  {worst ? (
                    <>
                      <blockquote>{worst.text}</blockquote>
                      {worst.confidence >= 0.7 ? (
                        <p>
                          The model said <b>{worst.label}</b> and was <b>{pct(worst.confidence, 0)}</b> sure. Why would it be so sure? Look at the words
                          that decided it.
                        </p>
                      ) : (
                        <p>
                          The model said <b>{worst.label}</b> but was only <b>{pct(worst.confidence, 0)}</b> sure: a borderline case. Keep typing; a
                          message it gets wrong while sure of itself is the better one to share.
                        </p>
                      )}
                    </>
                  ) : (
                    <p>Mark an answer as wrong. The wrong one the model was most sure about appears here: that is the one to share with the room.</p>
                  )}
                </div>
                <div className="note">
                  <IcInfo />
                  <span>
                    <b>Confidence is not correctness.</b> A model can be 95% sure and wrong, when your message uses words it learned
                    from the other class.
                  </span>
                </div>
              </aside>
            </div>
            <div className="foot">
              {back(4)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ───────────── helpers ───────────── */

const rows = (n: number) => (n === 1 ? "1 row" : `${num(n)} rows`);

function sameClean(a?: Clean, b?: Clean): boolean {
  const keys: (keyof Clean)[] = ['dropDuplicates', 'dropConflicts', 'removeMasks'];
  return keys.every((k) => !!a?.[k] === !!b?.[k]);
}

function cleanText(c: Clean): string {
  const on = [c.dropDuplicates && 'no duplicates', c.dropConflicts && 'no conflicts', c.removeMasks && 'no XXXX'].filter(Boolean);
  return on.length ? on.join(', ') : 'as is';
}

/** A preview of the first features a representation makes from a text (client-side, illustrative). */
function features(text: string, rep: Representation): string[] {
  const words = text.toLowerCase().replace(/…$/, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (rep === 'tfidf') {
    const out: string[] = [];
    for (let i = 0; i < words.length && out.length < 18; i++) {
      out.push(words[i]);
      if (i + 1 < words.length) out.push(`${words[i]} ${words[i + 1]}`);
    }
    return out.slice(0, 18);
  }
  const out: string[] = [];
  for (const w of words.slice(0, 4)) {
    const padded = ` ${w} `;
    for (let i = 0; i + 3 <= padded.length && out.length < 18; i++) out.push(padded.slice(i, i + 3).replace(/ /g, '·'));
  }
  return out;
}
