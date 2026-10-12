'use client';

/** One class: rename, Webcam ("Hold to Record") / Upload / drop / folder, thumbnails, ⋮ menu. */

import { forwardRef, useEffect, useRef, useState } from 'react';
import { SAMPLE_NOTE, type ClassData } from './types';
import { useCamera } from './useCamera';

interface Props {
  data: ClassData;
  readOnly: boolean;
  busyText: string | null;
  nameError: (name: string) => string | null;
  onRename: (name: string) => void;
  onFiles: (files: File[]) => void;
  onFrame: (video: HTMLVideoElement) => Promise<void>;
  onRemoveSample: (sampleId: string) => void;
  onDelete: () => void;
  onToggleDisabled: () => void;
  onClear: () => void;
  onDownload: () => void;
  canDelete: boolean;
  /** Only one webcam is open at a time; the lab decides which. */
  camOpen: boolean;
  onToggleCam: () => void;
}

const icon = 'w-4 h-4';

export const ClassCard = forwardRef<HTMLDivElement, Props>(function ClassCard(p, ref) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(p.data.name);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const cam = p.camOpen;
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { videoRef, error: camError, ready } = useCamera(cam);
  const recording = useRef<number | null>(null);
  const [rec, setRec] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  useEffect(() => () => stopRec(), []);
  useEffect(() => {
    if (!cam) stopRec();
  }, [cam]);

  const save = () => {
    const name = draft.trim();
    const e = p.nameError(name);
    if (e) {
      setErr(e);
      return;
    }
    if (name !== p.data.name) p.onRename(name);
    setEditing(false);
    setErr(null);
  };

  // ~10 frames a second while held; frames are skipped while the previous one is still being read
  const startRec = () => {
    if (!ready || recording.current) return;
    setRec(true);
    let busy = false;
    recording.current = window.setInterval(async () => {
      const v = videoRef.current;
      if (busy || !v || v.readyState < 2) return;
      busy = true;
      try {
        await p.onFrame(v);
      } finally {
        busy = false;
      }
    }, 100);
  };
  function stopRec() {
    if (recording.current) window.clearInterval(recording.current);
    recording.current = null;
    setRec(false);
  }

  const files = (list: FileList | null) => {
    const ok = Array.from(list || []).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (ok.length) p.onFiles(ok);
  };

  const n = p.data.samples.length;
  const btn = 'flex flex-col items-center justify-center gap-1 w-[4.5rem] h-14 rounded-lg text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-brand disabled:opacity-40';

  return (
    <div
      ref={ref}
      className={`vc-card relative rounded-xl border bg-card shadow-sm transition-opacity ${p.data.disabled ? 'opacity-55' : ''} ${drag ? 'border-pink-brand ring-2 ring-pink-brand/40' : 'border-fg/10'}`}
      style={{ borderLeft: `4px solid ${p.data.color}` }}
      onDragOver={(e) => {
        if (p.readOnly) return;
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (!p.readOnly) files(e.dataTransfer.files);
      }}
      aria-label={`Class ${p.data.name}`}
      role="group"
    >
      {/* header */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-fg/10">
        {editing ? (
          <div className="flex-1 min-w-0">
            <input
              autoFocus
              value={draft}
              maxLength={30}
              onChange={(e) => {
                setDraft(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') {
                  setDraft(p.data.name);
                  setEditing(false);
                  setErr(null);
                }
              }}
              onBlur={save}
              aria-label="Class name"
              aria-invalid={!!err}
              className="w-full bg-canvas border border-pink-brand rounded px-2 py-1 text-sm font-semibold text-fg focus:outline-none"
            />
            {err && <p className="text-xs text-pink-brand mt-1" role="alert">{err}</p>}
          </div>
        ) : (
          <>
            <h3 className="font-semibold text-fg truncate">{p.data.name}</h3>
            {!p.readOnly && (
              <button
                type="button"
                onClick={() => {
                  setDraft(p.data.name);
                  setEditing(true);
                }}
                className="text-fg/50 hover:text-fg p-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-brand"
                aria-label={`Rename ${p.data.name}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.536 9 17l.464-3.536z" />
                </svg>
              </button>
            )}
            {p.data.disabled && <span className="text-[11px] rounded bg-fg/10 px-1.5 py-0.5 text-fg/70">Disabled</span>}
          </>
        )}
        <span className="flex-1" />
        {!p.readOnly && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label={`Options for ${p.data.name}`}
              className="text-fg/60 hover:text-fg p-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-brand"
            >
              <svg className={icon} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
            </button>
            {menu && (
              <div role="menu" className="absolute right-0 mt-1 w-52 rounded-lg border border-fg/10 bg-card shadow-xl z-30 py-1 text-sm">
                {[
                  { label: 'Delete class', act: p.onDelete, disabled: !p.canDelete },
                  { label: p.data.disabled ? 'Enable class' : 'Disable class', act: p.onToggleDisabled },
                  { label: 'Remove all samples', act: p.onClear, disabled: n === 0 },
                  { label: 'Download samples', act: p.onDownload, disabled: n === 0 },
                ].map((m) => (
                  <button
                    key={m.label}
                    type="button"
                    role="menuitem"
                    disabled={m.disabled}
                    onClick={() => {
                      setMenu(false);
                      m.act();
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-purple-brand/10 focus:bg-purple-brand/10 focus:outline-none disabled:opacity-40"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* body */}
      <div className="px-4 py-3">
        <p className="text-xs text-fg/70 mb-2">
          {n > 0 ? <><b className="text-fg">{n}</b> Image Sample{n === 1 ? '' : 's'}</> : 'Add Image Samples:'}
        </p>
        <div className="flex gap-3 items-start">
          {!p.readOnly && (
            <div className="flex gap-2 flex-shrink-0">
              <button type="button" onClick={p.onToggleCam} aria-pressed={cam} className={`${btn} ${cam ? 'bg-purple-brand text-white' : 'bg-purple-brand/10 text-purple-brand hover:bg-purple-brand/20'}`}>
                <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                Webcam
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} bg-purple-brand/10 text-purple-brand hover:bg-purple-brand/20`}>
                <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                Upload
              </button>
              <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { files(e.target.files); e.target.value = ''; }} />
              <input
                ref={folderRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => { files(e.target.files); e.target.value = ''; }}
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              />
            </div>
          )}
          {n > 0 && (
            <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto pb-1" aria-label={`${p.data.name} samples`}>
              {p.data.samples.slice().reverse().map((s) => (
                <div key={s.id} className="relative group flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.thumb} alt="" className="w-12 h-12 rounded object-cover border border-fg/10" />
                  {!p.readOnly && (
                    <button
                      type="button"
                      onClick={() => p.onRemoveSample(s.id)}
                      aria-label="Delete this sample"
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {!p.readOnly && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-fg/55">
            <span>{SAMPLE_NOTE}</span>
            <button type="button" onClick={() => folderRef.current?.click()} className="text-purple-brand hover:underline">Import from folder</button>
          </div>
        )}
        {p.busyText && <p className="text-xs text-pink-brand mt-1" role="status">{p.busyText}</p>}

        {cam && !p.readOnly && (
          <div className="mt-3 rounded-lg border border-fg/10 bg-canvas p-2">
            {camError ? (
              <p className="text-sm text-fg/70 py-3 text-center" role="status">{camError}</p>
            ) : (
              <>
                <video ref={videoRef} muted playsInline className="w-full max-w-[16rem] mx-auto rounded-md bg-black -scale-x-100" aria-label="Camera preview" />
                <button
                  type="button"
                  disabled={!ready}
                  onPointerDown={startRec}
                  onPointerUp={stopRec}
                  onPointerLeave={stopRec}
                  onPointerCancel={stopRec}
                  onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && startRec()}
                  onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && stopRec()}
                  className={`mt-2 w-full rounded-lg py-2 text-sm font-semibold select-none touch-none ${rec ? 'bg-pink-brand text-white' : 'bg-purple-brand text-white hover:bg-purple-brand/90'} disabled:opacity-40`}
                >
                  {rec ? 'Recording…' : 'Hold to Record'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
