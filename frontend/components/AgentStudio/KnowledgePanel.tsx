'use client';

import { useEffect, useRef, useState } from 'react';
import { kbAddLibrary, kbChunks, kbDelete, kbDocuments, kbLibrary, kbPdfUrl, kbUpload, libraryPdfUrl } from './api';
import PdfViewer from './PdfViewer';
import type { KbChunk, KbDocument, LibraryDoc, PdfTarget } from './types';
import { Notice, PanelHeader, PrimaryButton, SecondaryButton, Spinner } from './ui';

const dateText = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** KNOWLEDGE BASE: the documents the agent answers from, cut into passages. */
export default function KnowledgePanel({ agentId, sessionId }: { agentId: string; sessionId: string }) {
  // the sample documents are always offered here (no Ctrl+Shift+Z in this section)
  const [docs, setDocs] = useState<KbDocument[] | null>(null);
  const [library, setLibrary] = useState<LibraryDoc[]>([]);
  const [sample, setSample] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<string>('');
  const [busy, setBusy] = useState<string>('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [viewer, setViewer] = useState<PdfTarget | null>(null);
  const [passagesOf, setPassagesOf] = useState<string>('');
  const [chunks, setChunks] = useState<Record<string, KbChunk[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    kbDocuments(agentId, sessionId)
      .then(setDocs)
      .catch((e: Error) => {
        setDocs([]);
        setMsg({ type: 'error', text: e.message });
      });
    kbLibrary(agentId, sessionId)
      .then((lib) => {
        setLibrary(lib);
        setPicked(Object.fromEntries(lib.map((d) => [d.id, true])));
        setPreview(lib[0]?.id || '');
      })
      .catch(() => setLibrary([]));
  }, [agentId, sessionId]);

  const have = new Set((docs || []).map((d) => d.library_id).filter(Boolean));
  const toAdd = library.filter((d) => picked[d.id] && !have.has(d.id)).map((d) => d.id);
  const totalPassages = (list: KbDocument[]) => list.reduce((s, d) => s + (d.chunks || 0), 0);

  const saveSample = async () => {
    setBusy('Reading and cutting into passages…');
    setMsg(null);
    try {
      const next = await kbAddLibrary(agentId, sessionId, toAdd);
      setDocs(next);
      setSample(false);
      setMsg({ type: 'success', text: `Saved. ${next.length} document${next.length === 1 ? '' : 's'}, ${totalPassages(next)} passages.` });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Reading and cutting into passages…');
    setMsg(null);
    try {
      const next = await kbUpload(agentId, sessionId, file);
      setDocs(next);
      setMsg({ type: 'success', text: `Saved. ${next.length} document${next.length === 1 ? '' : 's'}, ${totalPassages(next)} passages.` });
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (d: KbDocument) => {
    if (!confirm(`Remove "${d.title}" from the knowledge base?`)) return;
    try {
      setDocs(await kbDelete(agentId, sessionId, d.doc_id));
      if (viewer?.docId === d.doc_id) setViewer(null);
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    }
  };

  const togglePassages = async (d: KbDocument) => {
    if (passagesOf === d.doc_id) return setPassagesOf('');
    setPassagesOf(d.doc_id);
    if (!chunks[d.doc_id]) {
      try {
        const r = await kbChunks(agentId, sessionId, d.doc_id);
        setChunks((prev) => ({ ...prev, [d.doc_id]: r.chunks }));
      } catch (e) {
        setMsg({ type: 'error', text: (e as Error).message });
      }
    }
  };

  const uploadInput = (
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" aria-label="Upload a PDF" onChange={(e) => upload(e.target.files?.[0])} />
  );
  const previewDoc = library.find((d) => d.id === preview);

  return (
    <div>
      <PanelHeader
        icon="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
        title="KNOWLEDGE BASE"
        subtitle="The documents it answers from"
        action={
          docs && docs.length > 0 && !sample ? (
            <>
              {library.some((d) => !have.has(d.id)) && <SecondaryButton onClick={() => setSample(true)}>Add sample data</SecondaryButton>}
              <SecondaryButton onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>Upload a PDF</SecondaryButton>
            </>
          ) : undefined
        }
      />
      {uploadInput}
      <Notice msg={msg} />
      {busy && (
        <div className="mb-4 flex items-center gap-2 text-fg/80 text-sm" role="status">
          <Spinner /> {busy}
        </div>
      )}

      {docs === null ? (
        <div className="flex items-center gap-2 text-fg/60 text-sm"><Spinner /> Loading…</div>
      ) : sample ? (
        <div className="border border-magenta-brand/20 rounded-xl overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="p-4 space-y-3 border-b lg:border-b-0 lg:border-r border-magenta-brand/15">
              <p className="text-sm text-fg/70">Two public SEBI documents. Tick the ones to use.</p>
              {library.map((d) => (
                <div
                  key={d.id}
                  className={`rounded-lg border p-3 cursor-pointer ${preview === d.id ? 'border-purple-brand bg-purple-brand/10' : 'border-magenta-brand/15 hover:border-magenta-brand/40'}`}
                  onClick={() => setPreview(d.id)}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 accent-purple-600"
                      checked={have.has(d.id) || Boolean(picked[d.id])}
                      disabled={have.has(d.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setPicked({ ...picked, [d.id]: e.target.checked })}
                      aria-label={`Use ${d.title}`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-fg">{d.title}</div>
                      <div className="text-xs text-fg/60 mt-0.5">{d.issuer} · {dateText(d.date)} · {d.pages} pages</div>
                      <div className="text-xs text-fg/75 mt-1">{d.summary}</div>
                      {have.has(d.id) && <div className="text-xs font-semibold text-purple-brand mt-1">Already in the knowledge base</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="h-[60vh] min-h-[22rem]">
              {previewDoc && (
                <PdfViewer
                  target={{ url: libraryPdfUrl(previewDoc.pdf_url), title: previewDoc.short, page: 1 }}
                  agentId={agentId}
                  sessionId={sessionId}
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-t border-magenta-brand/15 bg-card">
            <SecondaryButton onClick={() => setSample(false)}>Cancel</SecondaryButton>
            <PrimaryButton onClick={saveSample} busy={Boolean(busy)} disabled={toAdd.length === 0}>Save to knowledge base</PrimaryButton>
          </div>
        </div>
      ) : docs.length === 0 ? (
        <div className="bg-card rounded-xl border border-magenta-brand/15 p-8 text-center">
          <p className="text-fg text-lg mb-4">Give your assistant documents to answer from.</p>
          <PrimaryButton onClick={() => setSample(true)} disabled={!library.length}>Use sample data</PrimaryButton>
          <div className="mt-3">
            <button type="button" onClick={() => fileRef.current?.click()} className="text-sm text-pink-brand hover:underline" disabled={Boolean(busy)}>
              Upload your own PDF (public documents only)
            </button>
          </div>
        </div>
      ) : (
        // View opens the PDF on the right of the document list (one column on narrow screens)
        <div className={viewer ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start' : undefined}>
        <div className="space-y-3 min-w-0">
          <p className="text-sm text-fg/70">
            {docs.length} document{docs.length === 1 ? '' : 's'}, {totalPassages(docs)} passages. Each passage is one numbered paragraph with the heading above it.
          </p>
          {docs.map((d) => (
            <div key={d.doc_id} className="bg-card rounded-lg border border-magenta-brand/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold text-fg">{d.title}</div>
                  <div className="text-xs text-fg/60">{d.pages} pages · {d.chunks} passages · {d.source === 'library' ? 'Sample data' : 'Uploaded'}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SecondaryButton onClick={() => setViewer({ url: kbPdfUrl(agentId, sessionId, d.doc_id), title: d.title, page: 1, docId: d.doc_id })}>View</SecondaryButton>
                  <SecondaryButton onClick={() => togglePassages(d)}>{passagesOf === d.doc_id ? 'Hide the passages' : 'See the passages'}</SecondaryButton>
                  <button type="button" onClick={() => remove(d)} className="px-3 py-2 text-sm text-red-500 hover:underline">Remove</button>
                </div>
              </div>
              {passagesOf === d.doc_id && (
                <div className="mt-3 max-h-[24rem] overflow-y-auto space-y-2 pr-1">
                  {!chunks[d.doc_id] ? (
                    <div className="flex items-center gap-2 text-sm text-fg/60"><Spinner /> Loading the passages…</div>
                  ) : (
                    chunks[d.doc_id].map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        className="as-passage"
                        onClick={() => setViewer({ url: kbPdfUrl(agentId, sessionId, d.doc_id), title: d.title, page: c.pages[0] || 1, docId: d.doc_id })}
                      >
                        <div className="text-xs text-fg/70">
                          <b className="text-fg">Para {c.label}</b> · {c.page_label}{c.context ? ` · ${c.context}` : ''} · {c.words} words
                        </div>
                        <p className="text-sm text-fg/90 mt-1">{c.text}</p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
          {viewer && (
            <div className="border border-magenta-brand/20 rounded-xl overflow-hidden lg:sticky lg:top-4">
              <div className="flex justify-end px-3 py-1.5 bg-card border-b border-magenta-brand/15">
                <button type="button" className="text-sm text-fg/60 hover:text-fg" onClick={() => setViewer(null)}>Close ✕</button>
              </div>
              <div className="h-[75vh] min-h-[22rem]">
                <PdfViewer target={viewer} agentId={agentId} sessionId={sessionId} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
