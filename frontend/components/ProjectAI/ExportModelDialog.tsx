'use client';

/**
 * "Export": deploys the trained model and shows its URL.
 * The Use the AI page uses the same URL ("Use it in AI" opens it in a new tab).
 *
 * The backend makes the URL once per project (POST .../deploy) and keeps it, so it stays the same
 * after retraining and always runs the latest model. See backend/app/api/deployed.py.
 */

import { useEffect, useRef, useState } from 'react';
import config from '../../lib/config';

interface Props {
  sessionId: string;
  projectId: string;
  onClose: () => void;
  /** The Use the AI page: a "Use it in AI" button opens it in a new tab. */
  useHref?: string;
  /** Live Object Detection: the model is still being saved (deploy waits), or saving failed. */
  saving?: 'saving' | 'error' | null;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'error'; message: string };

export default function ExportModelDialog({ sessionId, projectId, onClose, useHref, saving = null }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (saving === 'error') {
      setState({ kind: 'error', message: 'Your model could not be saved, so it cannot be deployed. Train again to retry.' });
      return;
    }
    if (saving === 'saving') {
      setState({ kind: 'loading' }); // deploys as soon as the save finishes
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${config.apiBaseUrl}${config.api.guests.deploy(sessionId, projectId)}`, { method: 'POST' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data?.path) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not deploy the model. Try again.');
        const url = `${config.apiBaseUrl}${data.path}`;
        if (alive) setState({ kind: 'ready', url });
      } catch (e) {
        if (alive) setState({ kind: 'error', message: e instanceof Error ? e.message : 'Could not deploy the model. Try again.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, projectId, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    if (state.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(state.url);
    } catch {
      inputRef.current?.select(); // no clipboard permission: leave it selected for Ctrl+C
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-model-h"
        className="w-full max-w-lg rounded-xl border border-magenta-brand/30 bg-canvas p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="export-model-h" className="text-lg font-semibold text-fg">Your model is deployed</h2>
            <p className="text-sm text-fg/65 mt-0.5">Anyone with this URL can use the model you trained.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-fg/60 hover:text-fg p-1 -m-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {state.kind === 'loading' && (
          <p className="mt-5 flex items-center gap-2 text-sm text-fg/70" role="status">
            <span className="w-4 h-4 border-2 border-fg/20 border-t-pink-brand rounded-full animate-spin" aria-hidden="true" />
            {saving === 'saving' ? 'Saving your model to the project…' : 'Deploying your model…'}
          </p>
        )}

        {state.kind === 'error' && (
          <p className="mt-5 text-sm text-red-500" role="alert">{state.message}</p>
        )}

        {state.kind === 'ready' && (
          <>
            <label htmlFor="deployed-url" className="block mt-5 text-xs font-semibold uppercase tracking-wider text-pink-brand">
              Deployed model URL
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                ref={inputRef}
                id="deployed-url"
                readOnly
                value={state.url}
                onFocus={(e) => e.target.select()}
                className="min-w-0 flex-1 rounded-lg border border-magenta-brand/30 bg-canvas px-3 py-2 font-mono text-sm text-fg"
              />
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-lg bg-purple-brand px-4 py-2 text-sm font-semibold text-white hover:bg-purple-brand/90"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            {useHref && (
              <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
                <p className="flex-1 min-w-[14rem] text-sm text-fg/70">
                  Copy the URL, then in Use the AI paste it into <b className="text-fg">use deployed model</b> and press Enter.
                </p>
                <a
                  href={useHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-purple-brand px-4 py-2 text-sm font-semibold text-white hover:bg-purple-brand/90"
                >
                  Use it in AI
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3h7v7M10 14L21 3M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" />
                  </svg>
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
