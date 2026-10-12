'use client';

/**
 * "Test dataset" on the training page: the sample's unseen test images listed on the right; click
 * one to put it on the left, then Test sends it through the same prediction call as an uploaded
 * image. Shown only when the project uses the sample's labels.
 */

import { useEffect, useMemo, useState } from 'react';
import { fileName, loadSampleImages, readLabelNames, sampleImageFile, sampleImageUrl, type SampleImageSet } from './sampleImages';

export interface ImagePrediction {
  label: string;
  confidence: number; // percent
  alternatives: { label: string; confidence: number }[];
}

interface Props {
  projectLabels: string[];
  /** Where the label names chosen in the sample dialog are remembered. */
  namesKey: string;
  predict: (file: File) => Promise<ImagePrediction>;
}

const title = (file: string) => fileName(file).replace(/\.\w+$/, '').replace('test_', 'Test ');

export default function SampleImageTest({ projectLabels, namesKey, predict }: Props) {
  const [data, setData] = useState<SampleImageSet | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, ImagePrediction | string>>({});

  useEffect(() => {
    let alive = true;
    loadSampleImages()
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, []);

  const renamed = useMemo(() => (typeof window === 'undefined' ? {} : readLabelNames(namesKey)), [namesKey]);
  const asProject = (label: string) => renamed[label] ?? label;
  const names = useMemo(() => new Set(projectLabels), [projectLabels]);
  const show = !!data && data.labels.filter((l) => names.has(asProject(l.label))).length >= 2;

  const test = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const p = await predict(await sampleImageFile(picked));
      console.log('🔮 Test dataset prediction:', { file: picked, ...p });
      setResults((r) => ({ ...r, [picked]: p }));
    } catch (e) {
      setResults((r) => ({ ...r, [picked]: e instanceof Error ? e.message : 'Could not test this image.' }));
    } finally {
      setBusy(false);
    }
  };

  if (!show || !data) return null;
  const expectedOf = (file: string) => asProject(data.test.find((t) => t.file === file)?.expected ?? '');
  const res = picked ? results[picked] : undefined;
  const pred = res && typeof res !== 'string' ? res : null;
  const scored = data.test.filter((t) => results[t.file] && typeof results[t.file] !== 'string');
  const right = scored.filter((t) => (results[t.file] as ImagePrediction).label === expectedOf(t.file)).length;

  return (
    <div className="mb-6 rounded-lg border border-magenta-brand/20 bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <h5 className="font-semibold text-fg">Test dataset</h5>
          <p className="text-sm text-fg/60">{data.test.length} images the model has never seen. Some are blurred, cropped or photographed at an angle.</p>
        </div>
        {open && scored.length > 0 && (
          <span className="text-sm text-fg" aria-live="polite"><b>{right} of {scored.length}</b> correct</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={open
            ? 'px-4 py-2 rounded-lg border border-magenta-brand/50 text-fg hover:bg-purple-brand/10 text-sm font-medium'
            : 'px-4 py-2 rounded-lg bg-purple-brand hover:bg-purple-brand/90 text-white text-sm font-medium'}
        >
          {open ? 'Hide test dataset' : 'Test dataset'}
        </button>
      </div>

      {open && (
        <div className="grid gap-4 border-t border-magenta-brand/20 p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* left: the picked image, Test, result */}
          <div className="min-w-0 rounded-lg border border-fg/10 bg-canvas p-4 flex flex-col">
            {!picked ? (
              <div className="flex-1 grid place-items-center text-center py-16 text-fg/60 text-sm">
                Pick an image from the list to test it.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-3">
                  <h6 className="font-semibold text-fg flex-1">{title(picked)}</h6>
                  <button
                    type="button"
                    onClick={test}
                    disabled={busy}
                    className="bg-purple-brand hover:bg-purple-brand/90 text-white px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {busy && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />}
                    {busy ? 'Testing…' : 'Test'}
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sampleImageUrl(picked)} alt={title(picked)} className="w-full max-h-[26rem] object-contain rounded-md border border-fg/10 bg-white" />
                  <div aria-live="polite">
                    {typeof res === 'string' && <p className="text-sm text-pink-brand" role="alert">{res}</p>}
                    {!res && !busy && <p className="text-sm text-fg/60">Click Test to see what the model predicts.</p>}
                    {pred && (
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs uppercase tracking-wider text-fg/50">Prediction</p>
                          <p className={`text-xl font-bold ${pred.label === expectedOf(picked) ? 'text-[var(--success)]' : 'text-pink-brand'}`}>
                            {pred.label} <span className="text-base font-medium text-fg/70 tabular-nums">{pred.confidence.toFixed(1)}%</span>
                          </p>
                          <p className="text-sm text-fg/70 mt-0.5">
                            Expected: <b className="text-fg">{expectedOf(picked)}</b>{' '}
                            {pred.label === expectedOf(picked) ? '· correct' : '· wrong'}
                          </p>
                        </div>
                        <ul className="space-y-1.5" aria-label="Confidence for every label">
                          {[{ label: pred.label, confidence: pred.confidence }, ...pred.alternatives].map((a) => (
                            <li key={a.label} className="text-sm">
                              <div className="flex justify-between gap-2"><span className="text-fg/80">{a.label}</span><span className="tabular-nums text-fg/70">{a.confidence.toFixed(1)}%</span></div>
                              <div className="h-1.5 rounded-full bg-fg/10 overflow-hidden">
                                <div className="h-full rounded-full bg-purple-brand" style={{ width: `${Math.max(0, Math.min(100, a.confidence))}%` }} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* right: the test images */}
          <ul className="grid grid-cols-3 lg:grid-cols-2 gap-2 lg:max-h-[32rem] lg:overflow-y-auto pr-1" aria-label="Test images">
            {data.test.map((t) => {
              const r = results[t.file];
              const p = r && typeof r !== 'string' ? r : null;
              return (
                <li key={t.file}>
                  <button
                    type="button"
                    onClick={() => setPicked(t.file)}
                    aria-pressed={picked === t.file}
                    className={`w-full text-left rounded-md overflow-hidden border bg-canvas transition-colors ${
                      picked === t.file ? 'border-pink-brand ring-2 ring-pink-brand/40' : 'border-fg/10 hover:border-magenta-brand/50'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sampleImageUrl(t.file)} alt={title(t.file)} className="w-full aspect-[4/3] object-cover object-top bg-white" loading="lazy" />
                    <span className="flex items-center gap-1 px-2 py-1 text-xs">
                      <span className="flex-1 text-fg/80">{title(t.file)}</span>
                      {p && (
                        <span className={p.label === expectedOf(t.file) ? 'text-[var(--success)] font-semibold' : 'text-pink-brand font-semibold'}>
                          {p.label === expectedOf(t.file) ? '✓' : '✗'}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
