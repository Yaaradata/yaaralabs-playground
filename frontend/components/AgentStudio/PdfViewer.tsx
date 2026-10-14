'use client';

import { useEffect, useState } from 'react';
import { kbChunks } from './api';
import type { KbChunk, PdfTarget } from './types';
import { Spinner } from './ui';

/**
 * A PDF at a page. The iframe is keyed on url + page so a page jump always remounts it (browsers ignore a changed
 * #page on a loaded PDF). "Text view" shows the passages on that page instead, for browsers that can't show PDFs.
 */
export default function PdfViewer({ target, agentId, sessionId, height = '100%' }: {
  target: PdfTarget; agentId: string; sessionId: string; height?: string;
}) {
  const [textView, setTextView] = useState(false);
  const [chunks, setChunks] = useState<KbChunk[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setChunks(null);
    setErr('');
  }, [target.docId]);

  useEffect(() => {
    if (!textView || chunks || !target.docId) return;
    kbChunks(agentId, sessionId, target.docId)
      .then((r) => setChunks(r.chunks))
      .catch((e: Error) => setErr(e.message));
  }, [textView, chunks, target.docId, agentId, sessionId]);

  const onPage = (chunks || []).filter((c) => c.pages.includes(target.page));
  return (
    <div className="flex flex-col min-h-0" style={{ height }}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-magenta-brand/15 bg-card">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg truncate">{target.title}</div>
          <div className="text-xs text-fg/60">Page {target.page}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {target.docId && (
            <button type="button" className="text-xs text-pink-brand hover:underline" onClick={() => setTextView(!textView)}>
              {textView ? 'PDF view' : 'Text view'}
            </button>
          )}
          <a href={`${target.url}#page=${target.page}`} target="_blank" rel="noopener noreferrer" className="text-xs text-pink-brand hover:underline">
            Open ↗
          </a>
        </div>
      </div>
      {textView ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-canvas">
          {err && <p className="text-sm text-red-500">{err}</p>}
          {!chunks && !err && <div className="flex items-center gap-2 text-sm text-fg/60"><Spinner /> Loading the text…</div>}
          {chunks && onPage.length === 0 && <p className="text-sm text-fg/60">No passages on this page.</p>}
          {onPage.map((c, i) => (
            <div key={i} className="text-sm">
              <div className="text-xs font-semibold text-fg/70 mb-0.5">Para {c.label} · {c.page_label}</div>
              <p className="text-fg whitespace-pre-wrap">{c.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <iframe
          key={`${target.url}#${target.page}`}
          src={`${target.url}#page=${target.page}&view=FitH`}
          title={`${target.title}, page ${target.page}`}
          className="flex-1 w-full bg-white"
        />
      )}
    </div>
  );
}
