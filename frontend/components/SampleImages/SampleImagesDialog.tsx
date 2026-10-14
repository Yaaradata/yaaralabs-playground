'use client';

/**
 * "Use sample data" for Image Recognition: a tab per region (India, United States, China), each with the
 * sample labels and their images (label names can be edited), then adds everything in one upload. Images already in the project under the same
 * label are skipped, so adding twice adds nothing.
 */

import { useEffect, useState } from 'react';
import {
  fileName,
  loadSampleImages,
  missingFiles,
  sampleImageFile,
  readLabelNames,
  readRegion,
  SAMPLE_REGIONS,
  sampleImageUrl,
  writeLabelNames,
  writeRegion,
  type SampleImageSet,
} from './sampleImages';

interface Props {
  /** Where the chosen label names are remembered, so the test dataset can use them. */
  namesKey: string;
  existing: { label: string; filename: string }[];
  /** Uploads every image with its label in one request; throws with a readable message on failure. */
  onAdd: (items: { file: File; label: string }[]) => Promise<void>;
  onClose: () => void;
}

export default function SampleImagesDialog({ namesKey, existing, onAdd, onClose }: Props) {
  const [region, setRegion] = useState(() => readRegion(namesKey));
  const [data, setData] = useState<SampleImageSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() => readLabelNames(namesKey)); // sample label -> name the learner chose

  useEffect(() => {
    let alive = true;
    setData(null);
    setLoadError(null);
    setError(null);
    loadSampleImages(region)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setLoadError(e instanceof Error ? e.message : 'Could not load the sample images.'));
    return () => {
      alive = false;
    };
  }, [region]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      if (zoom) setZoom(null);
      else onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [busy, zoom, onClose]);

  const nameOf = (label: string) => (names[label] ?? label).trim().replace(/\s+/g, ' ');
  const nameError = (label: string): string | null => {
    const n = nameOf(label);
    if (!n) return 'Give this label a name.';
    if (!/^[a-zA-Z0-9\s\-_]+$/.test(n)) return 'Use only letters, numbers, spaces, - and _.';
    if (n.length > 30) return 'Keep it to 30 characters.';
    if (data && data.labels.some((o) => o.label !== label && nameOf(o.label).toLowerCase() === n.toLowerCase())) return 'Two labels have this name.';
    return null;
  };
  const invalid = !!data && data.labels.some((l) => nameError(l.label));
  const todo = data ? data.labels.map((l) => ({ l, name: nameOf(l.label), files: missingFiles({ ...l, label: nameOf(l.label) }, existing) })) : [];
  const toAdd = todo.reduce((n, t) => n + t.files.length, 0);
  const total = data ? data.labels.reduce((n, l) => n + l.files.length, 0) : 0;

  const add = async () => {
    if (!data || invalid || toAdd === 0) return;
    setError(null);
    try {
      setBusy(`Adding ${toAdd} image${toAdd === 1 ? '' : 's'}…`);
      const items = await Promise.all(
        todo.flatMap((t) => t.files.map(async (f) => ({ file: await sampleImageFile(f), label: t.name }))),
      );
      await onAdd(items);
      writeLabelNames(namesKey, Object.fromEntries(data.labels.map((l) => [l.label, nameOf(l.label)])));
      writeRegion(namesKey, region); // its test images are the ones offered after training
      setBusy(null);
      onClose();
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : 'Could not add the images. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="sample-images-title">
      <div className="bg-card text-fg border border-magenta-brand/30 rounded-xl w-full max-w-5xl max-h-[94vh] flex flex-col shadow-2xl">
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-fg/10 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-pink-brand">Sample data</p>
            <h2 id="sample-images-title" className="text-xl font-semibold mt-1">{data?.name ?? 'Sample images'}</h2>
            {data && <p className="text-sm text-fg/70 mt-1">{data.labels.length} labels, {total} images. Rename a label if you like, then add them to your project.</p>}
          </div>
          <button type="button" onClick={onClose} disabled={!!busy} className="text-fg/60 hover:text-fg p-1 rounded disabled:opacity-40" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 sm:px-6 pt-3 border-b border-fg/10 flex gap-1 overflow-x-auto" role="tablist" aria-label="Region">
          {SAMPLE_REGIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={region === r.id}
              onClick={() => setRegion(r.id)}
              disabled={!!busy}
              className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors disabled:opacity-40 ${region === r.id ? 'border-pink-brand text-pink-brand' : 'border-transparent text-fg/60 hover:text-fg'}`}
            >
              {r.name}
            </button>
          ))}
        </div>

        {loadError && <p className="px-6 py-8 text-sm text-pink-brand" role="alert">{loadError}</p>}
        {!data && !loadError && <p className="px-6 py-8 text-sm text-fg/60">Loading the images…</p>}

        {data && (
          <>
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 grid gap-3 sm:grid-cols-2">
              {todo.map(({ l, files }) => {
                const err = nameError(l.label);
                return (
                <section key={l.label} className="rounded-lg border border-fg/10 bg-surface p-3" aria-label={`${l.label} images`}>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="sr-only" htmlFor={`label-${l.label}`}>Label name for {l.label}</label>
                    <input
                      id={`label-${l.label}`}
                      value={names[l.label] ?? l.label}
                      onChange={(e) => setNames((n) => ({ ...n, [l.label]: e.target.value }))}
                      disabled={!!busy}
                      maxLength={30}
                      aria-invalid={!!err}
                      title="Edit the label name"
                      className={`min-w-0 flex-1 bg-canvas border rounded-md px-2 py-1 text-sm font-semibold focus:outline-none focus:border-pink-brand ${err ? 'border-pink-brand' : 'border-fg/15 hover:border-magenta-brand/50'}`}
                    />
                    <span className="text-xs text-fg/50 tabular-nums whitespace-nowrap">{l.files.length} images</span>
                    {files.length === 0 && <span className="text-xs text-[var(--success)] font-medium whitespace-nowrap">In your project</span>}
                  </div>
                  {err && <p className="text-xs text-pink-brand mb-1" role="alert">{err}</p>}
                  <p className="text-xs text-fg/60 mb-2.5">{l.covers}</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {l.files.map((f) => (
                      <button
                        type="button"
                        key={f}
                        onClick={() => setZoom(f)}
                        className="aspect-[3/4] rounded-md overflow-hidden border border-fg/10 hover:border-pink-brand bg-canvas focus:outline-none focus:ring-2 focus:ring-pink-brand/50"
                        title={`View ${fileName(f)}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sampleImageUrl(f)} alt={`${l.label}: ${fileName(f)}`} className="w-full h-full object-cover object-top" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </section>
                );
              })}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-fg/10 flex flex-wrap items-center gap-3">
              <p className="text-xs text-fg/60 flex-1 min-w-[12rem]" role="status">
                {busy ?? (invalid ? 'Fix the label names first.' : toAdd === 0 ? 'Every sample image is already in your project.' : `${toAdd} image${toAdd === 1 ? '' : 's'} will be added. Images already in your project are skipped.`)}
              </p>
              <button
                type="button"
                onClick={() => void add()}
                disabled={!!busy || toAdd === 0 || invalid}
                className="bg-purple-brand hover:bg-purple-brand/90 text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40"
              >
                {busy ? 'Adding…' : 'Add to project'}
              </button>
              {error && <p className="w-full text-sm text-pink-brand" role="alert">{error}</p>}
            </div>
          </>
        )}
      </div>

      {zoom && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sampleImageUrl(zoom)} alt={fileName(zoom)} className="max-w-full max-h-[90vh] rounded-lg shadow-2xl bg-white" />
        </div>
      )}
    </div>
  );
}
