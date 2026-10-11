'use client';

/**
 * Exercise 3 · Confusion matrix
 *
 * Start      Choose a source: the learner's Exercise 2 model (retrained with its exact settings)
 *            or a pre-trained model on one of the sample datasets (opens straight away).
 * Workspace  Sample data · logistic regression settings (Basic / Intermediate / Advanced) ·
 *            confusion matrix and four scores · every retrain kept in "Compare runs".
 *            Changing a setting does nothing until Retrain: the matrix only ever shows what a
 *            trained model actually predicted on held-out examples it never saw.
 *
 * Training runs on the server; every run and its model are saved to the project. The state
 * (source, dataset, level, settings, open run) is saved too, so the learner resumes where they left.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import config from '../../lib/config';
import { useAppTheme } from '../../lib/theme';
import {
  BERT_MAX_ITEMS,
  DEFAULTS,
  LEVEL_PLAN,
  LEVELS,
  MODELS,
  PARAMS,
  fmt,
  labelOf,
  metricDefined,
  metricText,
  optionsFor,
  pct,
  presetFor,
  same,
  signed,
  summary,
} from './settings';
import type { CellKey, Dataset, Example, Ex2Run, Level, ModelId, Params, Project, Run, SampleRow, Source } from './types';
import './confusionMatrix.css';

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
const IcPlay = () => <Svg s={14}><path d="M7 4l13 8-13 8z" /></Svg>;
const IcCheck = () => <Svg s={14}><path d="M20 6L9 17l-5-5" /></Svg>;
const IcInfo = () => <Svg s={15}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
const IcUser = () => <Svg s={22}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Svg>;
const IcBox = () => <Svg s={22}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></Svg>;
const IcArrow = () => <Svg s={14}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const IcBack = () => <Svg s={14}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
const IcReset = () => <Svg s={13}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Svg>;
const IcChevron = ({ open }: { open: boolean }) => <Svg s={14}><path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /></Svg>;
const IcRefresh = () => <Svg s={13}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></Svg>;

const time = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

/* ───────────── Main ───────────── */

export default function ConfusionMatrixLab({ sessionId, projectId }: Props) {
  const [theme] = useAppTheme();
  const base = config.api.confusionMatrix.project(sessionId, projectId);

  const [project, setProject] = useState<Project | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [ex2Runs, setEx2Runs] = useState<Ex2Run[] | null>(null);
  const [ex2Error, setEx2Error] = useState(false);

  // Workspace UI (restored from and autosaved to the project)
  const [model, setModel] = useState<ModelId>('lr');
  const [params, setParams] = useState<Params>(DEFAULTS);
  const [selId, setSelId] = useState<string | null>(null);
  const savedStateRef = useRef('');

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<CellKey | null>(null);
  const [showSample, setShowSample] = useState(true);
  const [samplePage, setSamplePage] = useState(0);
  const [sampleRows, setSampleRows] = useState<SampleRow[] | null>(null);
  const [startDs, setStartDs] = useState('client_emails');
  const [startEx2, setStartEx2] = useState<string | null>(null);
  const [startTarget, setStartTarget] = useState<string | null>(null);

  // Browser-side caches: each is fetched once per run / page
  const examplesCache = useRef(new Map<string, { items: Example[]; total: number }>());
  const sampleCache = useRef(new Map<string, SampleRow[]>());
  const [examples, setExamples] = useState<{ items: Example[]; total: number } | null>(null);

  const applyProject = useCallback((p: Project) => {
    const mdl: ModelId = p.state.model === 'bert' ? 'bert' : 'lr';
    const prm = { ...DEFAULTS, ...p.state.params };
    setProject(p);
    setModel(mdl);
    setParams(prm);
    setSelId(p.state.selectedRunId);
    savedStateRef.current = JSON.stringify({ model: mdl, params: prm, selectedRunId: p.state.selectedRunId });
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [p, d] = await Promise.all([
        api<{ data: Project }>(base),
        api<{ data: Dataset[] }>(config.api.confusionMatrix.datasets),
      ]);
      applyProject(p.data);
      setDatasets(d.data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [base, applyProject]);

  useEffect(() => {
    if (!sessionId || !projectId) return;
    load();
    api<{ data: Ex2Run[] }>(config.api.confusionMatrix.ex2Runs(sessionId))
      .then((r) => setEx2Runs(r.data))
      .catch(() => setEx2Error(true));
  }, [sessionId, projectId, load]);

  // Autosave where the learner is (debounced)
  useEffect(() => {
    if (loadState !== 'ready' || !project?.state.source) return;
    const current = JSON.stringify({ model, params, selectedRunId: selId });
    if (current === savedStateRef.current) return;
    const t = setTimeout(async () => {
      try {
        await api(`${base}/state`, { method: 'PUT', body: current });
        savedStateRef.current = current;
      } catch {
        /* next change retries; the run history itself is already saved */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [model, params, selId, loadState, project?.state.source, base]);

  /* derived */
  const source = project?.state.source ?? null;
  const ds = project?.dataset ?? null;
  const ex2 = project?.ex2 ?? null;
  const scopeKey =
    source === 'pre'
      ? `sample:${project?.state.datasetId}`
      : source === 'ex2' && ex2
        ? ex2.datasetKey || `ex2:${ex2.datasetId}:${ex2.classes[0]}`
        : null;
  const scopeRuns = useMemo(
    () => (project?.runs ?? []).filter((r) => r.source === source && r.datasetKey === scopeKey).sort((a, b) => a.no - b.no),
    [project?.runs, source, scopeKey],
  );
  const sel = scopeRuns.find((r) => r.id === selId) ?? scopeRuns[scopeRuns.length - 1] ?? null;
  const prev = sel ? scopeRuns[scopeRuns.indexOf(sel) - 1] ?? null : null;
  const sameRun = (r: Run, m: ModelId, p: Params) => (r.model ?? 'lr') === m && same(m, { ...DEFAULTS, ...r.params }, p);
  const stale = !!sel && !sameRun(sel, model, params);
  // "Same model, new threshold": this run differs from the previous one in the threshold alone
  const thresholdOnly =
    !!sel && !!prev && (sel.model ?? 'lr') === (prev.model ?? 'lr') &&
    Number(sel.params.threshold) !== Number(prev.params.threshold) &&
    PARAMS[sel.model ?? 'lr'].every((d) => d.key === 'threshold' || Number(sel.params[d.key] ?? DEFAULTS[d.key]) === Number(prev.params[d.key] ?? DEFAULTS[d.key]));
  const twin = stale ? [...scopeRuns].reverse().find((r) => sameRun(r, model, params)) ?? null : null;
  const usableEx2 = (ex2Runs ?? []).filter((r) => r.usable);

  // Levels: Basic = the settings the model started with (Ex 2's own for an Ex 2 model);
  // Intermediate and Advanced improve on them. The highlighted tab follows the settings.
  const basicFor = (m: ModelId): Params =>
    source === 'ex2' && ex2
      ? m === 'lr'
        ? { ...DEFAULTS, ...ex2.params }
        : { ...DEFAULTS, testSplit: ex2.params.testSplit }
      : DEFAULTS;
  const basic = basicFor(model);
  const activeLevel: Level | null = LEVELS.find((l) => same(model, presetFor(model, l.id, basic), params))?.id ?? null;
  const bertTooBig = !!ds && ds.n > BERT_MAX_ITEMS;

  // Sample rows for the current dataset (cached per page)
  useEffect(() => {
    if (!scopeKey) return;
    const key = `${scopeKey}:${samplePage}`;
    const hit = sampleCache.current.get(key);
    if (hit) return setSampleRows(hit);
    setSampleRows(null);
    api<{ data: SampleRow[] }>(`${base}/sample?page=${samplePage}`)
      .then((r) => {
        sampleCache.current.set(key, r.data);
        setSampleRows(r.data);
      })
      .catch(() => setSampleRows([]));
  }, [scopeKey, samplePage, base]);

  // Messages in the clicked box (cached per run + box)
  useEffect(() => {
    if (!cell || !sel) return setExamples(null);
    const key = `${sel.id}:${cell}`;
    const hit = examplesCache.current.get(key);
    if (hit) return setExamples(hit);
    setExamples(null);
    api<{ data: Example[]; total: number }>(`${base}/runs/${sel.id}/examples?cell=${cell}&limit=5`)
      .then((r) => {
        const v = { items: r.data, total: r.total };
        examplesCache.current.set(key, v);
        setExamples(v);
      })
      .catch(() => setExamples({ items: [], total: 0 }));
  }, [cell, sel, base]);

  /* actions */
  const run = async (text: string, call: () => Promise<{ data: Project }>) => {
    setBusy(text);
    setError(null);
    setCell(null);
    try {
      applyProject((await call()).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };
  const openSource = (src: Source, datasetId?: string | null, ex2ProjectId?: string | null, target?: string | null) => {
    setSamplePage(0);
    const reopening = (project?.runs ?? []).some((r) =>
      r.source === src &&
      (src === 'pre'
        ? r.datasetKey === `sample:${datasetId}`
        : r.datasetKey.startsWith(`tr:${ex2ProjectId}:`)
          ? !target || r.datasetKey.endsWith(`:${target}`)
          : ex2?.projectId === ex2ProjectId),
    );
    const text = reopening ? 'Opening your runs' : src === 'pre' ? 'Opening the trained model' : 'Training your Ex 2 model with its exact settings';
    return run(text, () =>
      api(`${base}/open`, { method: 'POST', body: JSON.stringify({ source: src, datasetId, ex2ProjectId, target: target || null }) }),
    );
  };
  const openEx2 = (r: Ex2Run | null | undefined, target?: string | null) => {
    if (!r) return;
    openSource('ex2', null, r.projectId, r.kind === 'textrec' ? target || r.labels[0] : null);
  };
  /** Train these settings, or open the run that already has them (nothing is trained twice). */
  const trainWith = (m: ModelId, p: Params, text: string) => {
    const existing = [...scopeRuns].reverse().find((r) => sameRun(r, m, p));
    setCell(null);
    setError(null);
    if (existing) {
      setModel(m);
      setParams(p);
      setSelId(existing.id);
      return;
    }
    const firstBert = m === 'bert' && !scopeRuns.some((r) => r.model === 'bert');
    return run(firstBert && ds ? `DistilBERT is reading the ${fmt(ds.n)} ${ds.noun}` : text, () =>
      api(`${base}/train`, { method: 'POST', body: JSON.stringify({ model: m, params: p }) }),
    );
  };
  const retrain = () => trainWith(model, params, `Training ${MODELS[model].name} on the server`);
  const chooseLevel = (l: Level) =>
    trainWith(model, presetFor(model, l, basic), `Training with the ${LEVELS.find((x) => x.id === l)?.label} settings`);
  const changeModel = (m: ModelId) => {
    if (m === model) return;
    trainWith(m, basicFor(m), `Training ${MODELS[m].name}`); // the other model starts from its Basic settings
  };
  const startOver = () => run('Back to the start', () => api(`${base}/start-over`, { method: 'POST' }));
  const changeSource = (v: Source) =>
    v === 'ex2'
      ? ex2
        ? openSource('ex2', null, ex2.projectId, ex2.kind === 'textrec' ? ex2.classes[0] : null)
        : openEx2(usableEx2[0])
      : openSource('pre', startDs);
  const setP = (key: keyof Params, v: number) => setParams((s) => ({ ...s, [key]: v }));
  const resetParams = () => setParams(sel ? { ...DEFAULTS, ...sel.params } : basic);

  /* ───────── loading / error ───────── */
  if (loadState !== 'ready' || !project) {
    return (
      <div className="cmx" data-theme={theme}>
        <div className="loading">
          {loadState === 'error' ? (
            <div>
              <p>Couldn&apos;t load this project.</p>
              <button className="btn pri" onClick={load}>Try again</button>
            </div>
          ) : (
            <p>Loading…</p>
          )}
        </div>
      </div>
    );
  }

  /* ───────── START SCREEN ───────── */
  if (!source || !ds) {
    const allEx2 = ex2Runs ?? [];
    const pickedEx2 = allEx2.find((r) => r.projectId === startEx2) ?? usableEx2[0] ?? allEx2[0] ?? null;
    const pickedTarget =
      pickedEx2?.kind === 'textrec' ? (startTarget && pickedEx2.labels.includes(startTarget) ? startTarget : pickedEx2.labels[0]) : null;
    const startDataset = datasets?.find((d) => d.id === startDs) ?? datasets?.[0];
    return (
      <div className="cmx" data-theme={theme}>
        <div className="wrap">
          <div className="start">
            <div className="eyebrow">Exercise 3</div>
            <h1 className="h1">Confusion matrix</h1>
            <p className="lead">
              Accuracy alone hides <b>which way</b> a model is wrong. The confusion matrix shows what it caught, what it
              missed and what it flagged by mistake. Choose a model to look at.
            </p>
            {error && <p className="err" style={{ marginTop: 16 }} role="alert">{error}</p>}

            <div className="choices">
              <section className="panel choice">
                <span className="ic"><IcUser /></span>
                <h2>My Ex 2 model</h2>
                <p>Open the model you trained in Exercise 2 (a Text Classification or Text Recognition project). It is retrained here on the same data, with the same recipe, so you see the same scorecard.</p>
                {ex2Error && <div className="notice"><IcInfo /> Couldn&apos;t look up your Exercise 2 models. Refresh to try again.</div>}
                {!ex2Error && ex2Runs === null && <div className="facts"><div>Looking for your Exercise 2 models…</div></div>}
                {!ex2Error && ex2Runs !== null && allEx2.length === 0 && (
                  <div className="notice">
                    <IcInfo />
                    <span>
                      No trained Exercise 2 model in this workspace yet. Create a Text Classification project, train it on a finance pack,
                      then come back. Or open a pre-trained model.
                    </span>
                  </div>
                )}
                {pickedEx2 && (
                  <div className="pick">
                    <label className="field">
                      <span>Model ({allEx2.length})</span>
                      <select
                        className="select"
                        value={pickedEx2.projectId}
                        onChange={(e) => { setStartEx2(e.target.value); setStartTarget(null); }}
                        disabled={!!busy}
                      >
                        {allEx2.map((r) => (
                          <option key={r.projectId} value={r.projectId} disabled={!r.usable}>
                            {r.projectName} · {r.kind === 'textrec' ? r.labels.join(', ') : r.datasetName}
                            {r.usable ? '' : r.kind === 'textrec' ? ' (needs more examples)' : ' (can’t open yet)'}
                          </option>
                        ))}
                      </select>
                    </label>
                    {pickedEx2.kind === 'textrec' && pickedEx2.labels.length > 1 && (
                      <label className="field">
                        <span>Class we care about</span>
                        <select className="select" value={pickedTarget ?? ''} onChange={(e) => setStartTarget(e.target.value)} disabled={!!busy || !pickedEx2.usable}>
                          {pickedEx2.labels.map((l) => (
                            <option key={l} value={l}>{l}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )}
                {pickedEx2 && !pickedEx2.usable && (
                  <div className="notice"><IcInfo /><span>{pickedEx2.reason}</span></div>
                )}
                {pickedEx2?.usable && pickedEx2.params && (
                  <div className="facts">
                    {pickedEx2.kind === 'textrec' ? (
                      <>
                        <div><span>Project</span><b>{pickedEx2.projectName}</b></div>
                        <div>
                          <span>Reads</span>
                          <b>
                            {pickedTarget} vs {pickedEx2.labels.length === 2 ? pickedEx2.labels.find((l) => l !== pickedTarget) : 'Other labels'}
                          </b>
                        </div>
                        <div>
                          <span>Examples</span>
                          <b>{pickedEx2.labels.map((l) => `${l} ${pickedEx2.labelCounts[l] ?? 0}`).join(' · ')}</b>
                        </div>
                        <div><span>Model</span><b>{MODELS.lr.name} (Text Recognition)</b></div>
                      </>
                    ) : (
                      <>
                        <div><span>Dataset</span><b>{pickedEx2.datasetName}</b></div>
                        <div><span>Classes</span><b>{pickedEx2.classes[0]} vs {pickedEx2.classes[1]}</b></div>
                        <div><span>Model</span><b>{MODELS.lr.name}</b></div>
                        <div><span>Settings</span><b>{summary('lr', pickedEx2.params)} · threshold {pickedEx2.params.threshold.toFixed(1)}</b></div>
                      </>
                    )}
                    {pickedEx2.updatedAt && <div><span>Trained</span><b>{new Date(pickedEx2.updatedAt).toLocaleString()}</b></div>}
                  </div>
                )}
                {pickedEx2?.kind === 'textrec' && pickedEx2.usable && pickedEx2.labels.length > 2 && (
                  <p className="hint">
                    A confusion matrix compares two sides, so your {pickedEx2.labels.length} labels are read as {pickedTarget} against all
                    the others. Pick another class any time to see its own matrix.
                  </p>
                )}
                <button
                  className="btn pri lg block go"
                  disabled={!pickedEx2?.usable || !!busy}
                  onClick={() => openEx2(pickedEx2, pickedTarget)}
                >
                  {busy && busy.includes('Ex 2') ? `${busy}…` : <>Open my Ex 2 model <IcArrow /></>}
                </button>
              </section>

              <section className="panel choice">
                <span className="ic"><IcBox /></span>
                <h2>A pre-trained model</h2>
                <p>Pick a dataset. A model is already trained on it and opens straight away.</p>
                <div className="ds-list" role="radiogroup" aria-label="Dataset">
                  {(datasets ?? []).map((d) => (
                    <button key={d.id} role="radio" aria-checked={startDs === d.id} className={`ds${startDs === d.id ? ' on' : ''}`} onClick={() => setStartDs(d.id)}>
                      <span><b>{d.name}</b><span>{d.classes[0]} vs {d.classes[1]} · {fmt(d.n)} {d.noun}</span></span>
                      <span className="radio" />
                    </button>
                  ))}
                </div>
                <button className="btn pri lg block go" disabled={!startDataset || !!busy} onClick={() => openSource('pre', startDs)}>
                  {busy && !busy.includes('Ex 2') ? `${busy}…` : <>Open {startDataset?.name} <IcArrow /></>}
                </button>
              </section>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ───────── WORKSPACE ───────── */
  const m = sel?.m;
  const [T, O] = ds.short;
  const CELLS: Record<CellKey, { cls: string; tag: string; words: string }> = {
    tp: { cls: 'ok', tag: 'Caught', words: `Real ${T} ${ds.noun}, sent to ${T}` },
    fn: { cls: 'miss', tag: 'Missed', words: `Real ${T} ${ds.noun}, sent to ${O} by mistake` },
    fp: { cls: 'fa', tag: 'False alarm', words: `${O} ${ds.noun}, sent to ${T} by mistake` },
    tn: { cls: 'ok', tag: 'Correct', words: `${O} ${ds.noun}, correctly left in ${O}` },
  };
  const defs = PARAMS[model];
  const changed = (key: keyof Params) => !!sel && (sel.model ?? 'lr') === model && Number(sel.params[key] ?? DEFAULTS[key]) !== Number(params[key]);
  const startLabel = source === 'ex2' ? 'Ex 2' : 'Basic';
  // A dataset no longer offered (kept so earlier runs open): point to the one that replaced it
  const retired = source === 'pre' && !!datasets && !datasets.some((d) => d.id === project.state.datasetId);
  const replacement = retired ? datasets?.find((d) => d.name === ds.name.replace(/ \(.*\)$/, '')) ?? datasets?.[0] ?? null : null;

  const Cell = ({ k }: { k: CellKey }) => {
    if (!m) return null;
    const c = CELLS[k];
    const d = prev ? m[k] - prev.m[k] : 0;
    return (
      <button className={`cell ${c.cls}${cell === k ? ' sel' : ''}`} onClick={() => setCell(cell === k ? null : k)} aria-pressed={cell === k}>
        <span className="k">{c.tag}<code>{k.toUpperCase()}</code></span>
        <span className="n num">{fmt(m[k])}</span>
        <span className="w">{c.words}</span>
        {prev && d !== 0 && <span className="d">{signed(d)}</span>}
      </button>
    );
  };
  const Metric = ({ id, name, words }: { id: 'accuracy' | 'precision' | 'recall' | 'f1'; name: string; words: string }) => {
    if (!m) return null;
    const defined = metricDefined(m, id);
    const d = prev && defined && metricDefined(prev.m, id) ? m[id] - prev.m[id] : 0;
    const why =
      id === 'precision' && !defined ? `It never said ${T}, so there is nothing to measure.`
      : id === 'recall' && !defined ? `No real ${T} ${ds.noun} were held back for testing.`
      : id === 'f1' && !defined ? 'Needs both precision and recall.'
      : words;
    return (
      <div className={`metric${defined ? '' : ' na'}`}>
        <small>{name}</small>
        <b className="num">
          {metricText(m, id)}
          {Math.abs(d) >= 0.0005 && <span className={`dl ${d > 0 ? 'up' : 'dn'}`}>{d > 0 ? '+' : '−'}{Math.abs(d * 100).toFixed(1)}</span>}
        </b>
        <span>{why}</span>
      </div>
    );
  };

  return (
    <div className="cmx" data-theme={theme}>
      <div className="wrap">
        {/* context: source · dataset · model */}
        <div className="panel ctx">
          <label className="field">
            <span>Source</span>
            <select className="select" value={source} onChange={(e) => changeSource(e.target.value as Source)} disabled={!!busy}>
              <option value="ex2" disabled={!ex2 && usableEx2.length === 0}>My Ex 2 model</option>
              <option value="pre">Pre-trained model</option>
            </select>
          </label>
          {source === 'ex2' && ex2 && usableEx2.length > 0 && (
            <label className="field">
              <span>Ex 2 model</span>
              <select
                className="select"
                value={ex2.projectId}
                onChange={(e) => openEx2(usableEx2.find((r) => r.projectId === e.target.value))}
                disabled={!!busy}
              >
                {!usableEx2.some((r) => r.projectId === ex2.projectId) && <option value={ex2.projectId}>{ex2.projectName}</option>}
                {usableEx2.map((r) => (
                  <option key={r.projectId} value={r.projectId}>{r.projectName}</option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>{source === 'ex2' && ex2?.kind === 'textrec' ? 'Class we care about' : 'Dataset'}</span>
            {source === 'ex2' && ex2?.kind === 'textrec' ? (
              <select
                className="select"
                value={ex2.classes[0]}
                onChange={(e) => openSource('ex2', null, ex2.projectId, e.target.value)}
                disabled={!!busy || ex2.labels.length < 2}
                title={`Read as this class vs ${ex2.labels.length > 2 ? 'Other labels' : 'the other label'}`}
              >
                {ex2.labels.map((l) => (
                  <option key={l} value={l}>
                    {l} vs {ex2.labels.length > 2 ? 'Other labels' : ex2.labels.find((o) => o !== l)}
                  </option>
                ))}
              </select>
            ) : source === 'ex2' ? (
              <div className="static">{ds.name}</div>
            ) : (
              <select className="select" value={project.state.datasetId ?? ''} onChange={(e) => { setStartDs(e.target.value); openSource('pre', e.target.value); }} disabled={!!busy}>
                {project.state.datasetId && !(datasets ?? []).some((d) => d.id === project.state.datasetId) && (
                  <option value={project.state.datasetId}>{ds.name} · {ds.classes[0]} vs {ds.classes[1]}</option>
                )}
                {(datasets ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name} · {d.classes[0]} vs {d.classes[1]}</option>
                ))}
              </select>
            )}
          </label>
          <label className="field">
            <span>Model</span>
            <select className="select" value={model} disabled={!!busy} onChange={(e) => changeModel(e.target.value as ModelId)}>
              <option value="lr">{MODELS.lr.name}</option>
              <option value="bert" disabled={bertTooBig}>
                {MODELS.bert.name}{bertTooBig ? ` (up to ${fmt(BERT_MAX_ITEMS)} items)` : ''}
              </option>
            </select>
          </label>
          <button className="btn ghost back" onClick={startOver} disabled={!!busy}><IcBack /> Start over</button>
        </div>
        {retired && (
          <div className="notice retired" role="status">
            <IcInfo />
            <span>
              <b>{ds.name}</b> is an older dataset that is too easy: the model is almost always right, so changing the
              settings barely changes the result. Your runs here are kept.
            </span>
            {replacement && (
              <button className="btn pri" onClick={() => { setStartDs(replacement.id); openSource('pre', replacement.id); }} disabled={!!busy}>
                Open {replacement.name} <IcArrow />
              </button>
            )}
          </div>
        )}

        {/* sample data */}
        <section className="panel sample">
          <div className="sample-h">
            <h3>Sample data</h3>
            <span className="meta">{ds.source} · {fmt(ds.n)} {ds.noun}{ds.licence ? ` · ${ds.licence}` : ''}</span>
            <span className="pill t">{ds.classes[0]} · {fmt(ds.counts[0])}</span>
            <span className="pill">{ds.classes[1]} · {fmt(ds.counts[1])}</span>
            <span className="sp" />
            <button className="link" onClick={() => setShowSample((v) => !v)} aria-expanded={showSample}>
              {showSample ? 'Hide' : 'Show'} <IcChevron open={showSample} />
            </button>
          </div>
          {showSample && (
            <>
              <div className="rows">
                {sampleRows === null && <div className="row"><p>Loading examples…</p></div>}
                {sampleRows?.map((r, i) => (
                  <div className="row" key={`${samplePage}-${i}`}>
                    <p>{r.text}</p>
                    <span className={`pill${r.y === 0 ? ' t' : ''}`}>{ds.classes[r.y]}</span>
                  </div>
                ))}
              </div>
              <div className="rows-foot">
                <span>{ds.blurb ? `${ds.blurb} ` : ''}The highlighted class is the one we care about.</span>
                <button className="link" onClick={() => setSamplePage((n) => n + 1)}><IcRefresh /> More examples</button>
              </div>
            </>
          )}
        </section>

        <div className="grid">
          {/* settings */}
          <aside className="panel" aria-label="Model settings">
            <div className="set-h">
              <h3>{MODELS[model].name} settings</h3>
              <span className="sp" />
              <button className="link" onClick={resetParams} disabled={!!busy || !stale} title="Back to the settings of the run on screen">
                <IcReset /> Reset
              </button>
            </div>
            <div className="levels" role="tablist" aria-label="Settings level">
              {LEVELS.map((l) => (
                <button
                  key={l.id}
                  role="tab"
                  aria-selected={activeLevel === l.id}
                  className={activeLevel === l.id ? 'on' : ''}
                  onClick={() => chooseLevel(l.id)}
                  disabled={!!busy}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="level-note">
              {activeLevel === 'basic' && (
                <span>
                  {source === 'ex2' && model === 'lr'
                    ? 'The exact settings you used in Exercise 2.'
                    : `The settings this ${MODELS[model].name} model started with.`}{' '}
                  Pick Intermediate or Advanced to train a better one.
                </span>
              )}
              {activeLevel && activeLevel !== 'basic' && <span>{LEVEL_PLAN[model][activeLevel].why}</span>}
              {!activeLevel && <span>Your own settings. Retrain to see what they do, or pick a level.</span>}
            </div>
            <div className="params">
              {defs.map((d) => {
                const fromBasic = Number(basic[d.key]) !== Number(params[d.key]);
                return (
                  <div className={`param${fromBasic ? ' up' : ''}`} key={d.key}>
                    <label htmlFor={`cmx-${d.key}`}>
                      {d.label}
                      {fromBasic && (
                        <em className="from">
                          {startLabel}: {labelOf(model, d.key, Number(basic[d.key]))}
                        </em>
                      )}
                      {changed(d.key) && <em>Not trained yet</em>}
                    </label>
                    <select
                      id={`cmx-${d.key}`}
                      className="select"
                      value={String(params[d.key])}
                      onChange={(e) => setP(d.key, Number(e.target.value))}
                      disabled={!!busy}
                    >
                      {optionsFor(d, Number(params[d.key]), Number(basic[d.key]), startLabel).map((o) => (
                        <option key={o.v} value={String(o.v)}>{o.l}</option>
                      ))}
                    </select>
                    <small>{d.hint(ds)}</small>
                  </div>
                );
              })}
            </div>
            <div className="set-foot">
              {busy ? (
                <div className="prog" aria-live="polite">
                  <div className="prog-h"><span>{busy}…</span></div>
                  <div className="track"><i /></div>
                </div>
              ) : (
                <>
                  {stale && <div className="stale"><IcInfo /> Settings changed. Retrain to see the new result.</div>}
                  {!stale && sel && <div className="fresh"><IcCheck /> The result shows these settings.</div>}
                  <button className="btn pri lg block" onClick={retrain}><IcPlay /> Retrain model</button>
                  {twin && <button className="btn ghost" onClick={() => setSelId(twin.id)}>Already trained as Run {twin.no}. Show it</button>}
                </>
              )}
              {error && <div className="err" role="alert">{error}</div>}
            </div>
          </aside>

          {/* result */}
          <section className={`panel${busy ? ' busy' : ''}`} aria-label="Result">
            {!sel || !m ? (
              <div className="empty">{busy ? `${busy}…` : 'Retrain to see the result.'}</div>
            ) : (
              <>
                <div className="res-h">
                  <h3>Run {sel.no} · {MODELS[sel.model ?? 'lr'].name}</h3>
                  {sel.kind === 'ex2' && <span className="badge ac">Your Ex 2 model</span>}
                  {sel.kind === 'pre' && <span className="badge ac">Pre-trained</span>}
                  {sel.kind === 'retrain' && <span className="badge">Retrained {time(sel.createdAt)}</span>}
                  <span className="badge">Threshold {sel.params.threshold.toFixed(1)}</span>
                  {thresholdOnly && <span className="badge" title="Only the threshold changed, so the fitted model is the same">Same model, new threshold</span>}
                  {sel.modelSaved && <span className="badge ok" title="The trained model is saved with this project">Model saved</span>}
                  <p>
                    {summary(sel.model ?? 'lr', sel.params)} · learned from {fmt(sel.trainN)} {ds.noun}, scored on {fmt(m.n)} it never saw
                  </p>
                </div>
                <div className="res-b">
                  <div className="mx">
                    <div />
                    <div className="ch"><span>Model said<b className="lbl">{ds.classes[0]}</b></span></div>
                    <div className="ch"><span>Model said<b className="lbl">{ds.classes[1]}</b></span></div>
                    <div className="rh">Actually<b className="lbl">{ds.classes[0]}</b></div>
                    <Cell k="tp" />
                    <Cell k="fn" />
                    <div className="rh">Actually<b className="lbl">{ds.classes[1]}</b></div>
                    <Cell k="fp" />
                    <Cell k="tn" />
                  </div>
                  {!cell && <div className="hint-click">Click a box to see the {ds.noun} in it.</div>}
                  {cell && (
                    <div className="msgs">
                      <div className="msgs-h">
                        {CELLS[cell].tag} · {CELLS[cell].words}
                        {examples && examples.total > examples.items.length && (
                          <span style={{ fontWeight: 500, color: 'var(--tx3)' }}>· showing {examples.items.length} of {fmt(examples.total)}, most decisive first</span>
                        )}
                        <span className="sp" />
                        <button className="link" onClick={() => setCell(null)}>Close</button>
                      </div>
                      {examples === null && <div className="msg"><p>Loading…</p></div>}
                      {examples?.items.length === 0 && <div className="msg"><p>Nothing in this box.</p></div>}
                      {examples?.items.map((x, i) => (
                        <div className="msg" key={i}><p>{x.text}</p><span>score {x.score.toFixed(2)}</span></div>
                      ))}
                    </div>
                  )}

                  <div className="metrics">
                    <Metric id="accuracy" name="Accuracy" words="How often it is right, overall" />
                    <Metric id="precision" name="Precision" words={`When it says ${T}, how often it is right`} />
                    <Metric id="recall" name="Recall" words={`Of all real ${T} ${ds.noun}, how many it caught`} />
                    <Metric id="f1" name="F1" words="One score that balances the two" />
                  </div>

                </div>
              </>
            )}
          </section>
        </div>

        {/* runs */}
        {scopeRuns.length > 0 && (
          <section className="panel runs" aria-label="Compare runs">
            <div className="runs-h">
              <h3>Compare runs</h3>
              <span>Every retrain on {ds.name} is kept, with its model. Click a row to open it.</span>
            </div>
            <div className="scroll">
              <table className="t">
                <thead>
                  <tr>
                    <th className="l">Run</th><th className="l">Model</th><th className="l">Settings</th><th>Threshold</th><th>Caught</th>
                    <th>Missed</th><th>False alarms</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th>
                  </tr>
                </thead>
                <tbody>
                  {scopeRuns.map((r: Run) => (
                    <tr
                      key={r.id}
                      className={r.id === sel?.id ? 'on' : ''}
                      onClick={() => { setSelId(r.id); setCell(null); }}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') { setSelId(r.id); setCell(null); } }}
                      aria-selected={r.id === sel?.id}
                    >
                      <td className="l"><b>{r.no}</b>{r.kind === 'ex2' ? ' · Ex 2' : r.kind === 'pre' ? ' · Pre-trained' : ''}</td>
                      <td className="l">{MODELS[r.model ?? 'lr'].name}</td>
                      <td className="l set">{summary(r.model ?? 'lr', r.params)}</td>
                      <td className="num">{r.params.threshold.toFixed(1)}</td>
                      <td className="num">{r.m.tp}</td>
                      <td className="num">{r.m.fn}</td>
                      <td className="num">{r.m.fp}</td>
                      <td className="num">{pct(r.m.accuracy)}</td>
                      <td className="num">{metricText(r.m, 'precision')}</td>
                      <td className="num">{metricText(r.m, 'recall')}</td>
                      <td className="num">{metricText(r.m, 'f1')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
