'use client';

/**
 * Custom live object detection: a Teachable Machine–style trainer. Class cards on the left,
 * Training in the middle, Preview on the right, joined by curved lines. Training and preview run
 * in the browser; after every training the model (and its samples) is saved to the project, and
 * it comes back when the project is opened again.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ClassCard } from './ClassCard';
import { PreviewCard, type PreviewModel } from './PreviewCard';
import {
  DEFAULT_PARAMS,
  buildMetadata,
  combinedModel,
  disposeModel,
  embed,
  exportFiles,
  fileToImage,
  loadCombined,
  loadExtractor,
  loadImage,
  trainHead,
  type TrainParams,
} from './engine';
import { openSavedModel, saveModel } from './api';
import ExportModelDialog from '../ProjectAI/ExportModelDialog';
import { dataUrlToBytes, makeZip, saveBlob } from './zip';
import { PALETTE, newId, type ClassData, type SamplesManifest } from './types';
import './videoClassifier.css';

interface Props {
  /** The project's Use the AI page ("Use it in AI" in the Export dialog). */
  useHref?: string;
  sessionId: string | null;
  projectId: string;
}

/** The model the preview uses: just trained (head) or restored from the project (combined). */
interface Model {
  version: number;
  head?: unknown;
  combined?: unknown;
  labels: string[];
  colors: string[];
  accuracy: number | null;
}

const BATCH_SIZES = [16, 32, 64, 128, 256, 512];
const MAX_SAVED_SAMPLES = 500;

function blankClass(i: number): ClassData {
  return { id: newId(), name: `Class ${i + 1}`, color: PALETTE[i % PALETTE.length], samples: [], disabled: false };
}

export default function VideoClassifierLab({ sessionId, projectId, useHref }: Props) {
  const [classes, setClasses] = useState<ClassData[]>(() => [blankClass(0), blankClass(1)]);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [engine, setEngine] = useState<'loading' | 'ready' | 'error'>('loading');
  const [restore, setRestore] = useState<string | null>('Opening your project…');
  const [params, setParams] = useState<TrainParams>(DEFAULT_PARAMS);
  const [phase, setPhase] = useState<'idle' | 'training'>('idle');
  const [epoch, setEpoch] = useState(0);
  const [model, setModel] = useState<Model | null>(null);
  const [save, setSave] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [activeCam, setActiveCam] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const modelRef = useRef<Model | null>(null);
  modelRef.current = model;
  const versionRef = useRef(0);
  versionRef.current = version;

  // feature extractor, then the project's saved model (if any); free models when leaving
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await loadExtractor();
        if (!alive) return;
        setEngine('ready');
      } catch {
        if (alive) setEngine('error');
        return;
      }
      if (!sessionId || !projectId) {
        setRestore(null);
        return;
      }
      try {
        const saved = await openSavedModel(sessionId, projectId);
        if (!alive || !saved) return;
        setRestore('Loading your trained model…');
        const combined = await loadCombined((n) => saved.urls[n]);
        if (!alive) {
          disposeModel(combined);
          return;
        }
        const meta = await fetch(saved.urls['metadata.json']).then((r) => r.json());
        let cls: ClassData[];
        if (saved.hasSamples && saved.urls['samples.json']) {
          const manifest: SamplesManifest = await fetch(saved.urls['samples.json']).then((r) => r.json());
          const total = manifest.classes.reduce((n, c) => n + c.samples.length, 0);
          let done = 0;
          cls = [];
          for (const c of manifest.classes) {
            const samples = [];
            for (const path of c.samples) {
              if (!alive) return;
              setRestore(`Loading your samples… ${++done} of ${total}`);
              if (!saved.urls[path]) continue;
              samples.push({ id: newId(), ...(await embed(await loadImage(saved.urls[path]))) });
            }
            cls.push({ id: newId(), name: c.name, color: c.color, disabled: c.disabled, samples });
          }
        } else {
          const metaClasses: { label: string; color: string }[] =
            meta.classes ?? saved.labels.map((label: string, i: number) => ({ label, color: saved.colors[i] }));
          cls = metaClasses.map((c) => ({ id: newId(), name: c.label, color: c.color, samples: [], disabled: false }));
        }
        if (!alive) return;
        // editing is locked while restoring, so the version cannot move under us
        const next = versionRef.current + 1;
        setClasses(cls);
        setVersion(next);
        setModel({ version: next, combined, labels: meta.labels ?? saved.labels, colors: saved.colors, accuracy: saved.accuracy });
        setSave('saved');
      } catch {
        /* no saved model, or it could not be read: start fresh */
      } finally {
        if (alive) setRestore(null);
      }
    })();
    return () => {
      alive = false;
      disposeModel(modelRef.current?.head);
      disposeModel(modelRef.current?.combined);
    };
  }, [sessionId, projectId]);

  const bump = () => setVersion((v) => v + 1);
  const update = (id: string, fn: (c: ClassData) => ClassData) => {
    setClasses((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));
    bump();
  };
  /** Embedding runs one at a time so the page stays responsive. */
  const enqueue = <T,>(job: () => Promise<T>) => {
    const next = queue.current.then(job, job);
    queue.current = next.catch(() => undefined);
    return next;
  };

  const addFiles = (id: string, files: File[]) =>
    enqueue(async () => {
      for (const [i, f] of files.entries()) {
        setBusy((b) => ({ ...b, [id]: `Adding ${i + 1} of ${files.length}…` }));
        try {
          const s = await embed(await fileToImage(f));
          update(id, (c) => ({ ...c, samples: [...c.samples, { id: newId(), ...s }] }));
        } catch {
          /* skip unreadable files */
        }
      }
      setBusy((b) => {
        const n = { ...b };
        delete n[id];
        return n;
      });
    });

  const addFrame = (id: string, video: HTMLVideoElement) =>
    embed(video, true).then((s) => update(id, (c) => ({ ...c, samples: [...c.samples, { id: newId(), ...s }] })));

  const nameError = (id: string) => (name: string) => {
    if (!name) return 'Give the class a name.';
    if (classes.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return 'Another class has this name.';
    return null;
  };

  const enabled = classes.filter((c) => !c.disabled);
  const reason =
    engine !== 'ready'
      ? engine === 'error' ? 'The image model could not load. Reload the page.' : 'Loading the image model…'
      : restore
        ? restore
        : enabled.length < 2
          ? 'You need at least 2 enabled classes.'
          : enabled.some((c) => c.samples.length === 0)
            ? `Add at least 1 sample to ${enabled.find((c) => c.samples.length === 0)?.name}.`
            : Object.keys(busy).length
              ? 'Wait for the samples to finish adding.'
              : null;
  const outOfDate = !!model && model.version !== version;

  /** Save the trained model (and its samples, up to 500) to the project. Saves run in order. */
  const saving = useRef<Promise<void>>(Promise.resolve());
  const persist = (m: Model, cls: ClassData[], p: TrainParams) => {
    if (!sessionId || !projectId || !m.head) return;
    setSave('saving');
    const run = async () => {
      const meta = await buildMetadata(
        'custom-live-object-detection',
        m.labels.map((label, i) => ({ label, color: m.colors[i] })),
        p,
        m.accuracy,
      );
      const files: Record<string, Blob> = { ...(await exportFiles(await combinedModel(m.head), meta)) };
      const total = cls.reduce((n, c) => n + c.samples.length, 0);
      if (total <= MAX_SAVED_SAMPLES) {
        const manifest: SamplesManifest = { version: 1, classes: [] };
        cls.forEach((c, ci) => {
          const paths = c.samples.map((s, n) => {
            const path = `samples/${ci}/${n}.jpg`;
            files[path] = new Blob([dataUrlToBytes(s.thumb) as BlobPart], { type: 'image/jpeg' });
            return path;
          });
          manifest.classes.push({ name: c.name, color: c.color, disabled: c.disabled, samples: paths });
        });
        files['samples.json'] = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
      }
      await saveModel(sessionId, projectId, { labels: m.labels, colors: m.colors, accuracy: m.accuracy }, files);
    };
    const next = saving.current.then(run, run);
    saving.current = next.then(
      () => setSave((s) => (modelRef.current === m ? 'saved' : s)),
      () => setSave((s) => (modelRef.current === m ? 'error' : s)),
    );
  };

  const train = async () => {
    if (reason || phase !== 'idle') return;
    setTrainError(null);
    setActiveCam(null); // close any class webcam: the preview takes the camera next
    setPhase('training');
    setEpoch(0);
    const snapshot = enabled.map((c) => ({ label: c.name, color: c.color, embeddings: c.samples.map((s) => s.embedding) }));
    const cls = classes;
    const v = version;
    try {
      const { head, result } = await trainHead(snapshot, params, (log) => setEpoch(log.epoch));
      disposeModel(modelRef.current?.head);
      disposeModel(modelRef.current?.combined);
      const m: Model = {
        version: v,
        head,
        labels: snapshot.map((s) => s.label),
        colors: snapshot.map((s) => s.color),
        accuracy: result.valAccuracy,
      };
      setModel(m);
      modelRef.current = m;
      persist(m, cls, params);
    } catch (e) {
      setTrainError(e instanceof Error ? e.message : 'Training failed.');
    } finally {
      setPhase('idle');
    }
  };

  const preview: PreviewModel | null = useMemo(
    () => (model ? { model: { head: model.head, combined: model.combined }, labels: model.labels, colors: model.colors } : null),
    [model],
  );

  const downloadSamples = async (c: ClassData) => {
    const zip = await makeZip(c.samples.map((s, i) => ({ name: `${c.name}/${i + 1}.jpg`, data: dataUrlToBytes(s.thumb) })));
    saveBlob(zip, `${c.name.replace(/[^\w-]+/g, '_')}-samples.zip`);
  };

  // ── connector lines ──
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const trainRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    const t = trainRef.current;
    const pv = previewRef.current;
    if (!wrap || !t || !pv || window.innerWidth < 900) {
      setPaths([]);
      return;
    }
    const base = wrap.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    const pr = pv.getBoundingClientRect();
    const curve = (x1: number, y1: number, x2: number, y2: number) => {
      const mx = (x1 + x2) / 2;
      return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
    };
    const tx = tr.left - base.left;
    const ty = tr.top - base.top + Math.min(tr.height / 2, 40);
    const out = classes
      .map((c) => cardRefs.current[c.id]?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r)
      .map((r) => curve(r.right - base.left, r.top - base.top + Math.min(r.height / 2, 60), tx, ty));
    out.push(curve(tr.right - base.left, ty, pr.left - base.left, pr.top - base.top + Math.min(pr.height / 2, 30)));
    setPaths(out);
  }, [classes]);
  useLayoutEffect(() => {
    draw();
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    Object.values(cardRefs.current).forEach((el) => el && ro.observe(el));
    if (trainRef.current) ro.observe(trainRef.current);
    if (previewRef.current) ro.observe(previewRef.current);
    window.addEventListener('resize', draw);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', draw);
    };
  }, [draw, advanced, model, phase, activeCam]);

  const status =
    phase === 'training' ? `Training… epoch ${epoch} / ${params.epochs}`
      : outOfDate ? 'Model out of date — Train again'
        : model ? 'Model Trained ✓'
          : null;
  const saveText =
    save === 'saving' ? 'Saving to your project…'
      : save === 'saved' ? 'Saved to your project'
        : save === 'error' ? 'Could not save. Your model still works here; train again to retry.'
          : null;

  const num = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  return (
    <div className="vc h-full overflow-auto bg-canvas text-fg">
      <div ref={wrapRef} className="vc-grid relative px-4 sm:px-6 py-6">
        <svg className="vc-lines" aria-hidden="true">
          {paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>

        {/* classes */}
        <div className="vc-col space-y-4">
          {classes.map((c) => (
            <ClassCard
              key={c.id}
              ref={(el) => {
                cardRefs.current[c.id] = el;
              }}
              data={c}
              readOnly={!!restore}
              busyText={busy[c.id] ?? null}
              nameError={nameError(c.id)}
              onRename={(name) => update(c.id, (x) => ({ ...x, name }))}
              onFiles={(f) => addFiles(c.id, f)}
              onFrame={(v) => addFrame(c.id, v)}
              onRemoveSample={(sid) => update(c.id, (x) => ({ ...x, samples: x.samples.filter((s) => s.id !== sid) }))}
              onDelete={() => {
                if (activeCam === c.id) setActiveCam(null);
                setClasses((cs) => cs.filter((x) => x.id !== c.id));
                bump();
              }}
              onToggleDisabled={() => update(c.id, (x) => ({ ...x, disabled: !x.disabled }))}
              onClear={() => update(c.id, (x) => ({ ...x, samples: [] }))}
              onDownload={() => downloadSamples(c)}
              canDelete={classes.length > 1}
              camOpen={activeCam === c.id}
              onToggleCam={() => setActiveCam((cur) => (cur === c.id ? null : c.id))}
            />
          ))}
          {!restore && (
            <button
              type="button"
              onClick={() => {
                setClasses((cs) => [...cs, { ...blankClass(cs.length), name: uniqueName(cs) }]);
                bump();
              }}
              className="w-full rounded-xl border-2 border-dashed border-fg/20 py-5 text-sm font-medium text-fg/70 hover:border-purple-brand hover:text-purple-brand"
            >
              ＋ Add a class
            </button>
          )}
        </div>

        {/* training */}
        <div className="vc-col">
          <div ref={trainRef} className="vc-card rounded-xl border border-fg/10 bg-card shadow-sm" role="region" aria-label="Training">
            <div className="px-4 py-3">
              <h3 className="font-semibold mb-3">Training</h3>
              <span title={reason ?? ''} className="block">
                <button
                  type="button"
                  onClick={train}
                  disabled={!!reason || phase !== 'idle'}
                  className="w-full rounded-lg bg-purple-brand py-2.5 text-sm font-semibold text-white hover:bg-purple-brand/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {phase !== 'idle' ? 'Training…' : model ? 'Train again' : 'Train Model'}
                </button>
              </span>
              {reason && phase === 'idle' && <p className="text-xs text-fg/55 mt-1.5" role="status">{reason}</p>}
              {phase === 'training' && (
                <div className="mt-2 h-1.5 rounded-full bg-fg/10 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={params.epochs} aria-valuenow={epoch}>
                  <div className="h-full bg-purple-brand transition-[width]" style={{ width: `${(epoch / params.epochs) * 100}%` }} />
                </div>
              )}
              {status && (
                <p className={`text-sm mt-2 font-medium ${outOfDate && phase === 'idle' ? 'text-pink-brand' : 'text-fg/80'}`} role="status">
                  {status}
                </p>
              )}
              {saveText && phase === 'idle' && (
                <p className={`text-xs mt-1 ${save === 'error' ? 'text-pink-brand' : 'text-fg/55'}`} role="status">{saveText}</p>
              )}
              {trainError && <p className="text-sm text-pink-brand mt-2" role="alert">{trainError}</p>}
            </div>
            <div className="border-t border-fg/10">
              <button
                type="button"
                onClick={() => setAdvanced((v) => !v)}
                aria-expanded={advanced}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-fg/75 hover:text-fg"
              >
                Advanced
                <svg className={`w-4 h-4 transition-transform ${advanced ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {advanced && (
                <div className="px-4 pb-4 space-y-3 text-sm">
                  <label className="flex items-center justify-between gap-2">
                    Epochs
                    <input type="number" min={1} max={500} value={params.epochs} onChange={(e) => setParams((p) => ({ ...p, epochs: num(e.target.value, 1, 500, 50) }))} className="vc-input w-20" />
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    Batch size
                    <select value={params.batchSize} onChange={(e) => setParams((p) => ({ ...p, batchSize: Number(e.target.value) }))} className="vc-input w-20">
                      {BATCH_SIZES.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center justify-between gap-2">
                    Learning rate
                    <input type="number" step={0.0001} min={0.00001} max={1} value={params.learningRate} onChange={(e) => setParams((p) => ({ ...p, learningRate: num(e.target.value, 0.00001, 1, 0.001) }))} className="vc-input w-24" />
                  </label>
                  <button type="button" onClick={() => setParams(DEFAULT_PARAMS)} className="text-xs text-purple-brand hover:underline">Reset defaults</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* preview */}
        <div className="vc-col">
          <PreviewCard
            ref={previewRef}
            preview={preview}
            paused={activeCam !== null}
            // like Teachable Machine: Export as soon as there is a trained model (the dialog waits for the save)
            onExport={model && phase === 'idle' && sessionId ? () => setExporting(true) : undefined}
          />
        </div>
      </div>
      {exporting && sessionId && projectId && (
        <ExportModelDialog
          sessionId={sessionId}
          projectId={projectId}
          useHref={useHref}
          saving={save === 'saving' || save === 'error' ? save : null}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function uniqueName(cs: ClassData[]) {
  for (let i = cs.length + 1; ; i += 1) {
    const name = `Class ${i}`;
    if (!cs.some((c) => c.name === name)) return name;
  }
}
