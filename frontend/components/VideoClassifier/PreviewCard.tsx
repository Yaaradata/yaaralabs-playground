'use client';

/**
 * Preview: Input on/off, Webcam or File, the input, one bar per class. Once a model exists the
 * input starts ON with the webcam; with no camera (AWS WorkSpaces) it falls back to File.
 */

import { forwardRef, useEffect, useRef, useState } from 'react';
import { predict } from './engine';
import { SAMPLE_NOTE } from './types';
import { useCamera } from './useCamera';

export interface PreviewModel {
  model: { head?: unknown; combined?: unknown };
  labels: string[];
  colors: string[];
}

interface Props {
  preview: PreviewModel | null;
  /** A class card's webcam is open: the preview camera waits (one camera at a time). */
  paused: boolean;
  /** Shown once there is a trained model, like Teachable Machine: deploy it and show its URL. */
  onExport?: () => void;
}

export const PreviewCard = forwardRef<HTMLDivElement, Props>(function PreviewCard({ preview, paused, onExport }, ref) {
  const [on, setOn] = useState(true);
  const [source, setSource] = useState<'file' | 'webcam'>('webcam');
  const [img, setImg] = useState<string | null>(null);
  const [probs, setProbs] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const objectUrl = useRef<string | null>(null);
  const hadModel = useRef(false);
  const live = !!preview && on && source === 'webcam' && !paused;
  const { videoRef, error: camError, ready } = useCamera(live);

  // a model appears (trained or restored): input ON, webcam
  useEffect(() => {
    if (preview && !hadModel.current) {
      setOn(true);
      setSource('webcam');
    }
    hadModel.current = !!preview;
    setProbs(null);
    if (preview && on && source === 'file' && img && imgRef.current?.complete) runOnImage();
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  // no camera: switch to File and say so
  useEffect(() => {
    if (camError && source === 'webcam') {
      setSource('file');
      setNote('No camera found — using File instead.');
    }
  }, [camError, source]);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  // webcam: predict continuously, one frame at a time
  useEffect(() => {
    if (!live || !ready || !preview) return;
    let stop = false;
    let raf = 0;
    const loop = async () => {
      if (stop) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try {
          const p = await predict(v, preview.model, true);
          if (!stop) setProbs(p);
        } catch {
          /* a frame can fail while the model changes */
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [live, ready, preview, videoRef]);

  async function runOnImage(el?: HTMLImageElement) {
    const target = el ?? imgRef.current;
    if (!preview || !target) return;
    try {
      setError(null);
      setProbs(await predict(target, preview.model));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.');
    }
  }

  const pickFile = (f: File | undefined) => {
    if (!f || !/^image\//.test(f.type)) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(f);
    setImg(objectUrl.current);
  };

  return (
    <div ref={ref} className="vc-card rounded-xl border border-fg/10 bg-card shadow-sm" aria-label="Preview" role="region">
      <div className="px-4 py-3 border-b border-fg/10 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-fg">Preview</h3>
        {preview && onExport && (
          <button
            type="button"
            onClick={onExport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-brand/90"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" />
            </svg>
            Export Model
          </button>
        )}
      </div>

      {!preview ? (
        <p className="px-4 py-5 text-sm text-fg/70">You must train a model on the left before you can preview it here.</p>
      ) : (
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 text-sm text-fg/80">
              Input
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label="Input"
                onClick={() => setOn((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors ${on ? 'bg-purple-brand' : 'bg-fg/25'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-5' : 'left-0.5'}`} />
              </button>
              <span className="text-xs font-semibold w-6">{on ? 'ON' : 'OFF'}</span>
            </span>
            <span className="flex-1" />
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value as 'file' | 'webcam');
                setProbs(null);
                setNote(null);
              }}
              disabled={!on}
              aria-label="Input source"
              className="bg-canvas border border-fg/15 rounded-md px-2 py-1 text-sm text-fg"
            >
              <option value="webcam">Webcam</option>
              <option value="file">File</option>
            </select>
          </div>

          {note && <p className="text-xs text-fg/60" role="status">{note}</p>}

          {on && source === 'webcam' && (
            paused ? (
              <p className="text-sm text-fg/70 rounded-lg border border-fg/10 p-3 text-center">Close the class webcam to use the camera here.</p>
            ) : (
              <video ref={videoRef} muted playsInline className="w-full rounded-lg bg-black -scale-x-100" aria-label="Camera preview" />
            )
          )}

          {on && source === 'file' && (
            <div
              className={`rounded-lg border-2 border-dashed p-2 text-center cursor-pointer ${drag ? 'border-pink-brand bg-purple-brand/10' : 'border-fg/15 hover:border-magenta-brand/50'}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pickFile(e.dataTransfer.files[0]);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              aria-label="Choose an image to test"
            >
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img ref={imgRef} src={img} alt="Input" onLoad={(e) => runOnImage(e.currentTarget)} className="mx-auto max-h-56 rounded object-contain bg-white" />
              ) : (
                <p className="py-6 text-sm text-fg/60">Drop an image or click to choose a file</p>
              )}
              <p className="text-[11px] text-fg/50 mt-1">{SAMPLE_NOTE}</p>
            </div>
          )}

          {error && <p className="text-sm text-pink-brand" role="alert">{error}</p>}

          <div>
            <p className="text-xs font-semibold text-fg/70 mb-1.5">Output</p>
            <ul className="space-y-1.5" aria-label="Output">
              {preview.labels.map((label, i) => {
                const pct = probs && on ? Math.round((probs[i] ?? 0) * 100) : 0;
                return (
                  <li key={label} className="flex items-center gap-2 text-sm">
                    <span className="w-28 truncate text-fg/85" title={label}>{label}</span>
                    <span className="flex-1 h-6 rounded-md overflow-hidden relative" style={{ background: `${preview.colors[i]}22` }}>
                      <span className="absolute inset-y-0 left-0 transition-[width] duration-150" style={{ width: `${pct}%`, background: preview.colors[i] }} />
                      <span className={`absolute inset-y-0 flex items-center text-xs font-semibold tabular-nums ${pct > 18 ? 'left-2 text-white' : 'right-2 text-fg/80'}`}>{pct}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
});
