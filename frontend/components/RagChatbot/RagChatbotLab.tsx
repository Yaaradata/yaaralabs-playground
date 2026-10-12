'use client';

/**
 * RAG Chatbot project: answer from the documents, and show where.
 *
 * 1 Choose documents  a dropdown of the SEBI library (the official PDF, served by our backend because sebi.gov.in
 *                     can't be framed) and an upload area; "In use" chips are the documents the bot may read
 * 2 Cut and index     cut by section or by fixed words, choose the embedding model, build the index, see every chunk
 * 3 Chat              a chat screen: each reply cites its sources [n]; a "sources" button opens the passages and a
 *                     keyword vs meaning comparison; settings live behind the gear
 *
 * Everything runs on the Playground backend (rag_chatbot_service.py): real chunking, Vertex embeddings, Gemini answers,
 * all saved in Firestore. Answers are never simulated.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import config from '../../lib/config';
import { useAppTheme } from '../../lib/theme';
import type { AnswerSettings, Ask, Chunking, LibraryDoc, Method, Models, Preview, Project, ProjectDoc, Retrieval, SearchResult, TestQuestion, Verdict } from './types';
import './ragChatbot.css';

interface Props {
  projectName: string;
  sessionId: string;
  projectId: string;
}

type Tab = 'docs' | 'index' | 'ask';
const TAB_STEP: Record<Tab, number> = { docs: 1, index: 2, ask: 4 };
const stepTab = (n: number): Tab => (n <= 1 ? 'docs' : n === 2 ? 'index' : 'ask');

class ApiError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: isForm ? init?.headers : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const IcDoc = ({ s = 18 }: { s?: number }) => <Svg s={s}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></Svg>;
const IcCut = ({ s = 18 }: { s?: number }) => <Svg s={s}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" /></Svg>;
const IcArrowR = () => <Svg s={14}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const IcCheck = ({ s = 14 }: { s?: number }) => <Svg s={s}><path d="M20 6L9 17l-5-5" /></Svg>;
const IcX = ({ s = 14 }: { s?: number }) => <Svg s={s}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcSend = () => <Svg s={15}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></Svg>;
const IcUp = () => <Svg s={22}><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></Svg>;
const IcPlay = () => <Svg s={14}><path d="M7 4l13 8-13 8z" /></Svg>;
const IcInfo = () => <Svg s={14}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
const IcChevron = ({ open }: { open: boolean }) => <Svg s={14}><path d={open ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /></Svg>;
const IcGear = () => <Svg s={17}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
const IcPlus = () => <Svg s={17}><path d="M12 5v14M5 12h14" /></Svg>;
const IcBulb = () => <Svg s={17}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" /></Svg>;
const IcBot = ({ s = 18 }: { s?: number }) => <Svg s={s}><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" /></Svg>;
const IcLink = () => <Svg s={12}><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Svg>;

/* ───────────── helpers ───────────── */

const DEFAULT_RETRIEVAL: Retrieval = { method: 'meaning', k: 3, minScore: 0 };
const DEFAULT_ANSWER: AnswerSettings = { model: 'gemini-flash-lite', temperature: 0.2, strict: true, useDocuments: true };
const SUGGESTED = [0, 1, 3, 6, 8, 9]; // indexes into the 12 test questions: 4 facts, 2 traps
const VERDICT_KEY: Record<Verdict, 'g' | 'm' | 'n'> = { grounded: 'g', 'made-up': 'm', refused: 'n' };
const dateText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const sinceKey = (pid: string) => `rag-chat-since:${pid}`;
const readSince = (pid: string) => {
  try { return localStorage.getItem(sinceKey(pid)) || ''; } catch { return ''; }
};

/** The model's light markdown (**bold**, * bullets) as text, with [n] citations as clickable chips. */
function AnswerText({ text, count, onCite }: { text: string; count: number; onCite: (n: number) => void }) {
  const parts = text.replace(/^(\s*)[*-]\s+/gm, '$1• ').split(/(\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]|\*\*[^*\n]+\*\*)/g);
  return (
    <div className="answer">
      {parts.map((p, i) => {
        if (p.startsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
        if (!/^\[/.test(p)) return <span key={i}>{p}</span>;
        return (p.match(/\d+/g) || []).map((d) => {
          const n = Number(d);
          const ok = n >= 1 && n <= count;
          return <sup key={`${i}-${n}`} className={ok ? '' : 'bad'} onClick={() => ok && onCite(n)} title={ok ? 'Show the source' : 'No such passage'}>{n}</sup>;
        });
      })}
    </div>
  );
}

/* ───────────── Main ───────────── */

export default function RagChatbotLab({ sessionId, projectId }: Props) {
  const [theme] = useAppTheme();
  const base = config.api.ragChatbot.project(sessionId, projectId);

  const [project, setProject] = useState<Project | null>(null);
  const [library, setLibrary] = useState<LibraryDoc[] | null>(null);
  const [models, setModels] = useState<Models | null>(null);
  const [testQs, setTestQs] = useState<TestQuestion[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('docs');

  // settings (restored from and autosaved to the project)
  const [chunking, setChunking] = useState<Chunking>({ mode: 'sections', size: 60, overlap: 10 });
  const [embModel, setEmbModel] = useState('text-embedding-005');
  const [retrieval, setRetrieval] = useState<Retrieval>(DEFAULT_RETRIEVAL);
  const [answer, setAnswer] = useState<AnswerSettings>(DEFAULT_ANSWER);
  const savedRef = useRef('');
  const loadedOnce = useRef(false); // a reload (remount, dev refresh) must not move the learner back a step

  // 1 · documents
  const [viewId, setViewId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [upErr, setUpErr] = useState('');
  const [texts, setTexts] = useState<Record<string, string>>({}); // extracted text of uploads, for the viewer
  const blobs = useRef<Record<string, string>>({}); // PDFs uploaded in this page, shown from memory
  const fileRef = useRef<HTMLInputElement>(null);

  // 2 · index
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState('');

  // 3 · chat
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState<null | 'search' | 'read' | 'write'>(null);
  const [since, setSince] = useState('');
  const [showSet, setShowSet] = useState(false);
  const [showSugg, setShowSugg] = useState(false);
  const [openSrc, setOpenSrc] = useState<Record<string, boolean>>({});
  const [openPas, setOpenPas] = useState<Record<string, boolean>>({});
  const [compare, setCompare] = useState<Record<string, SearchResult | null>>({});
  const [prompts, setPrompts] = useState<Record<string, { system: string; user: string }>>({});
  const msgsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback((p: Project, moveTo?: Tab) => {
    setProject(p);
    setChunking(p.state.chunking);
    setEmbModel(p.state.embeddingModel);
    setRetrieval(p.state.retrieval);
    setAnswer(p.state.answer);
    if (moveTo) setTab(moveTo);
    savedRef.current = JSON.stringify({ step: moveTo ? TAB_STEP[moveTo] : p.state.step, chunking: p.state.chunking,
      embeddingModel: p.state.embeddingModel, retrieval: p.state.retrieval, answer: p.state.answer });
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [p, lib, m, tq] = await Promise.all([
        api<{ data: Project }>(base),
        api<{ data: LibraryDoc[] }>(config.api.ragChatbot.library),
        api<{ data: Models }>(config.api.ragChatbot.models),
        api<{ data: TestQuestion[] }>(config.api.ragChatbot.testQuestions),
      ]);
      const st = p.data.state;
      const allowed: Tab = !p.data.documents.length ? 'docs' : !st.indexId ? (st.step >= 2 ? 'index' : 'docs') : stepTab(st.step);
      apply(p.data, loadedOnce.current ? undefined : allowed);
      if (!loadedOnce.current) setViewId(p.data.documents[0]?.id ?? '');
      loadedOnce.current = true;
      setLibrary(lib.data);
      setModels(m.data);
      setTestQs(tq.data);
      setSince(readSince(projectId));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [base, apply, projectId]);

  useEffect(() => { load(); }, [load]);

  // autosave the place and the settings
  useEffect(() => {
    if (!project) return;
    const snap = JSON.stringify({ step: TAB_STEP[tab], chunking, embeddingModel: embModel, retrieval, answer });
    if (snap === savedRef.current) return;
    const t = setTimeout(async () => {
      savedRef.current = snap;
      try {
        await api(`${base}/state`, { method: 'PUT', body: snap });
        const p = await api<{ data: Project }>(base); // chunking / model decide whether the index is still current
        setProject((cur) => (cur ? { ...cur, indexFresh: p.data.indexFresh, wantedIndexId: p.data.wantedIndexId } : cur));
      } catch {
        savedRef.current = '';
      }
    }, 500);
    return () => clearTimeout(t);
  }, [project, base, tab, chunking, embModel, retrieval, answer]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const docs = useMemo(() => project?.documents ?? [], [project]);
  const index = project?.index ?? null;
  // the server says whether the index matches the saved settings; the local check reacts before the save lands
  const sameCut = !!index && index.chunking.mode === chunking.mode && index.embeddingModel === embModel
    && (chunking.mode === 'sections' || (index.chunking.size === chunking.size && index.chunking.overlap === chunking.overlap));
  const ready = !!(project?.indexFresh && index && sameCut);
  const stale = !!index && !ready;
  const modelName = (id: string) => models?.chat.find((m) => m.id === id)?.name ?? id;

  /* ── 1 · documents ── */
  const viewDoc: (LibraryDoc & { kind: 'library'; inUse: boolean }) | (ProjectDoc & { kind: 'upload'; inUse: true }) | null = (() => {
    if (!viewId) return null;
    const lib = library?.find((d) => d.id === viewId);
    if (lib) return { ...lib, kind: 'library' as const, inUse: docs.some((d) => d.id === lib.id) };
    const up = docs.find((d) => d.id === viewId && d.source === 'upload');
    return up ? { ...up, kind: 'upload' as const, inUse: true as const } : null;
  })();

  const addLibrary = (id: string) => run('Adding', async () => {
    apply((await api<{ data: Project }>(`${base}/documents/library`, { method: 'POST', body: JSON.stringify({ libraryId: id }) })).data);
  });
  const pickDoc = (id: string) => {
    setViewId(id);
    setUpErr('');
    if (id && library?.some((d) => d.id === id) && !docs.some((d) => d.id === id)) addLibrary(id);
  };
  const dropDoc = (id: string) => run('Removing', async () => {
    apply((await api<{ data: Project }>(`${base}/documents/${id}`, { method: 'DELETE' })).data);
  });
  const onUpload = (file?: File | null) => {
    if (!file) return;
    setUpErr('');
    if (!/\.(pdf|txt|md)$/i.test(file.name)) { setUpErr('Use a PDF, TXT or MD file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setUpErr('That file is over 10 MB.'); return; }
    run(`Reading ${file.name}`, async () => {
      const before = new Set(docs.map((d) => d.id));
      const fd = new FormData();
      fd.append('file', file);
      try {
        const p = (await api<{ data: Project }>(`${base}/documents/upload`, { method: 'POST', body: fd })).data;
        apply(p);
        const added = p.documents.find((d) => !before.has(d.id));
        if (added) {
          if (/\.pdf$/i.test(file.name)) blobs.current[added.id] = URL.createObjectURL(file);
          setViewId(added.id);
        }
      } catch (e) {
        setUpErr((e as Error).message);
        throw e;
      }
    });
  };
  // uploads without a PDF in memory are shown as the text we extracted
  useEffect(() => {
    if (!viewDoc || viewDoc.kind !== 'upload' || blobs.current[viewDoc.id] || texts[viewDoc.id] !== undefined) return;
    let live = true;
    api<{ data: { page: number; text: string }[] }>(`${base}/documents/${viewDoc.id}/pages`)
      .then((r) => live && setTexts((t) => ({ ...t, [viewDoc.id]: r.data.map((p) => p.text).join('\n\n') })))
      .catch(() => live && setTexts((t) => ({ ...t, [viewDoc.id]: '(Could not load the text.)' })));
    return () => { live = false; };
  }, [viewDoc, base, texts]);

  /* ── 2 · index ── */
  useEffect(() => {
    if (tab !== 'index' || !docs.length) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ data: Preview }>(`${base}/chunks/preview`, { method: 'POST', body: JSON.stringify({ chunking }) })
        .then((r) => live && setPreview(r.data))
        .catch((e) => live && setError((e as Error).message));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [tab, base, chunking, docs]);

  const build = () => run('Building', async () => {
    await api(`${base}/state`, { method: 'PUT', body: JSON.stringify({ chunking, embeddingModel: embModel }) });
    apply((await api<{ data: Project }>(`${base}/index`, { method: 'POST' })).data);
  });

  /* ── 3 · chat ── */
  const thread = useMemo(() => (project?.asks ?? []).filter((a) => !since || a.createdAt > since), [project, since]);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, asking, tab]);
  useEffect(() => {
    if (!showSet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSet(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSet]);

  const ask = async (qText?: string) => {
    const q = (qText ?? question).trim();
    if (!q || !ready || asking) return;
    setQuestion('');
    setShowSugg(false);
    setError(null);
    if (inputRef.current) inputRef.current.style.height = '';
    const test = testQs.find((t) => t.question === q);
    setAsking(answer.useDocuments ? 'search' : 'write');
    const t1 = setTimeout(() => setAsking((s) => (s === 'search' ? 'read' : s)), 700);
    const t2 = setTimeout(() => setAsking((s) => (s ? 'write' : s)), 1500);
    try {
      const r = await api<{ data: Ask }>(`${base}/ask`, { method: 'POST', body: JSON.stringify({ question: q, testQuestionId: test?.id, retrieval, answer }) });
      setProject((p) => (p ? { ...p, asks: [...p.asks, r.data] } : p));
    } catch (e) {
      setError((e as Error).message);
      setQuestion(q);
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      setAsking(null);
    }
  };
  const newChat = () => {
    const now = new Date().toISOString();
    try { localStorage.setItem(sinceKey(projectId), now); } catch { /* the cut-off just won't survive a reload */ }
    setSince(now);
    setOpenSrc({});
    setCompare({});
  };
  const setVerdict = (a: Ask, v: Verdict) => {
    const next = a.verdict === v ? null : v;
    setProject((p) => (p ? { ...p, asks: p.asks.map((x) => (x.id === a.id ? { ...x, verdict: next } : x)) } : p));
    api(`${base}/asks/${a.id}`, { method: 'PATCH', body: JSON.stringify({ verdict: next }) }).catch(() => setError('Could not save that verdict.'));
  };
  const loadCompare = (a: Ask) => {
    if (compare[a.id]) { setCompare((c) => ({ ...c, [a.id]: null })); return; }
    run('Comparing', async () => {
      const r = await api<{ data: SearchResult }>(`${base}/search`, { method: 'POST', body: JSON.stringify({ question: a.question, k: a.settings.k || retrieval.k, minScore: 0 }) });
      setCompare((c) => ({ ...c, [a.id]: r.data }));
    });
  };
  const togglePrompt = async (a: Ask) => {
    if (prompts[a.id]) {
      setPrompts((cur) => { const n = { ...cur }; delete n[a.id]; return n; });
      return;
    }
    const r = await api<{ data: Ask }>(`${base}/asks/${a.id}`).catch(() => null);
    if (r?.data.prompt) setPrompts((p) => ({ ...p, [a.id]: r.data.prompt! }));
  };
  const tally = { g: 0, m: 0, n: 0 };
  thread.forEach((a) => { if (a.verdict) tally[VERDICT_KEY[a.verdict]] += 1; });
  const changed = (Object.keys(DEFAULT_RETRIEVAL) as (keyof Retrieval)[]).some((k) => retrieval[k] !== DEFAULT_RETRIEVAL[k])
    || (Object.keys(DEFAULT_ANSWER) as (keyof AnswerSettings)[]).some((k) => answer[k] !== DEFAULT_ANSWER[k]);

  /* ───────────── Render ───────────── */

  if (loadState !== 'ready' || !project || !library || !models) {
    return (
      <div className="rgx" data-theme={theme}>
        <div className="loading">
          {loadState === 'error' ? <div><p>Couldn&apos;t open this project.</p><button className="btn" onClick={load}>Try again</button></div> : <p>Opening the RAG chatbot…</p>}
        </div>
      </div>
    );
  }

  const uploads = docs.filter((d) => d.source === 'upload');
  const pdfSrc = viewDoc ? (viewDoc.kind === 'library' ? `${config.apiBaseUrl}${config.api.ragChatbot.libraryPdf(viewDoc.id)}` : blobs.current[viewDoc.id]) : undefined;
  const openUrl = viewDoc?.kind === 'library' ? viewDoc.pdfUrl || viewDoc.sourceUrl : pdfSrc;
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setDragging(false); onUpload(e.dataTransfer.files?.[0]); };

  const docsScreen = (
    <section className="panel dpick">
      <div className="dbar">
        <label className="dsel">
          <span className="ic"><IcDoc s={18} /></span>
          <select className="select" value={viewId} onChange={(e) => pickDoc(e.target.value)} aria-label="Document" disabled={!!busy}>
            <option value="">＋ Add your own document</option>
            <optgroup label="Sample documents · SEBI">
              {library.map((d) => <option key={d.id} value={d.id}>{d.title} · {dateText(d.date)}</option>)}
            </optgroup>
            {uploads.length > 0 && <optgroup label="Your documents">{uploads.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</optgroup>}
          </select>
        </label>
        {viewDoc && (
          <span className="dmeta">
            {viewDoc.kind === 'library' ? <>{viewDoc.issuer.replace(/ \(SEBI\)$/, '')} · <span className="mono">{viewDoc.reference}</span></> : <>Your file · {viewDoc.fileName}</>}
            {viewDoc.kind === 'library' && <span className="tag ac">Source: sebi.gov.in</span>}
            <span className="tag neu">{viewDoc.pages} pages · {viewDoc.words.toLocaleString()} words</span>
          </span>
        )}
        <span className="sp" />
        {viewDoc && !viewDoc.inUse && <button className="btn pri" onClick={() => addLibrary(viewDoc.id)} disabled={!!busy}><IcPlus /> Use this document</button>}
        {viewDoc && openUrl && <a className="btn" href={openUrl} target="_blank" rel="noreferrer">Open original <IcLink /></a>}
      </div>

      <div className="dview" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        {!viewDoc ? (
          <div className="zone">
            <div className={`drop2${dragging ? ' over' : ''}`}>
              <span className="bigic"><IcUp /></span>
              <h4>Add your document</h4>
              <p>Drag a file here, or</p>
              <button className="btn pri" onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy?.startsWith('Reading') ? `${busy}…` : 'Browse files'}</button>
              <p style={{ fontSize: 12 }}>PDF with real text (not a scan), TXT or MD · up to 10 MB, 80 pages</p>
              {upErr && <span className="uerr">{upErr}</span>}
              <div className="or">or use a sample</div>
              <div className="samples">{library.map((d) => <button key={d.id} onClick={() => pickDoc(d.id)} disabled={!!busy}><IcDoc s={14} /> {d.short}</button>)}</div>
            </div>
          </div>
        ) : pdfSrc ? (
          <>
            <iframe key={pdfSrc} className="pdf" src={`${pdfSrc}#view=FitH`} title={viewDoc.title} />
            <div className="pdf-m">
              <span className="bigic"><IcDoc s={24} /></span>
              <b>{viewDoc.title}</b>
              <small>{viewDoc.kind === 'library' ? `${dateText(viewDoc.date)} · ${viewDoc.pages} pages` : `${viewDoc.pages} pages`}</small>
              {openUrl && <a className="btn pri" href={openUrl} target="_blank" rel="noreferrer">Open the PDF <IcLink /></a>}
            </div>
          </>
        ) : (
          <pre className="txtv">{texts[viewDoc.id] ?? 'Loading the text…'}</pre>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" hidden onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      <div className="dfoot">
        <span className="lbl2">In use</span>
        {docs.length ? docs.map((d) => (
          <span className="chip" key={d.id} title={d.title}>
            <span>{d.short}</span>
            <button onClick={() => dropDoc(d.id)} aria-label={`Remove ${d.short}`} disabled={!!busy}><IcX s={12} /></button>
          </span>
        )) : <span className="none">Nothing yet. Pick a sample or add your own.</span>}
        {viewDoc && <button className="link" onClick={() => setViewId('')} style={{ marginLeft: 4 }}><IcPlus /> Add another</button>}
        <span className="sp" />
        <button className="btn pri lg" onClick={() => setTab('index')} disabled={!docs.length || !!busy}>Next: cut and index <IcArrowR /></button>
      </div>
    </section>
  );

  const dims = models.embedding.find((m) => m.id === embModel)?.dims ?? 768;
  const pchunks = preview?.chunks ?? [];
  const lens = pchunks.map((c) => c.words);
  const maxLen = Math.max(1, ...lens);
  const median = lens.length ? lens.slice().sort((a, b) => a - b)[Math.floor(lens.length / 2)] : 0;
  const shown = pchunks.filter((c) => !filter || c.text.toLowerCase().includes(filter.toLowerCase()) || c.label.includes(filter) || (c.context || '').toLowerCase().includes(filter.toLowerCase()));
  // from the chunking the preview was made with, not the control (a new preview may still be on its way)
  const pc = preview?.chunking;
  const overlapOf = (i: number) => (pc && pc.mode === 'words' && pc.overlap > 0 && i > 0 && pchunks[i - 1]?.docId === pchunks[i].docId ? pc.overlap : 0);

  const indexScreen = !docs.length ? (
    <section className="panel cempty">
      <IcDoc s={28} /><b style={{ color: 'var(--tx)' }}>No documents chosen</b>
      <button className="btn pri" onClick={() => setTab('docs')}>Go to step 1 <IcArrowR /></button>
    </section>
  ) : (
    <div className="idx">
      <aside className="panel idx-set">
        <div className="sec-h"><h3>How to cut and index</h3></div>
        <div className="cut">
          <div>
            <span className="lbl">Cut the text</span>
            <div className="seg" role="group" aria-label="Chunking">
              <button className={chunking.mode === 'sections' ? 'on' : ''} onClick={() => setChunking({ ...chunking, mode: 'sections' })} disabled={!!busy}>By section</button>
              <button className={chunking.mode === 'words' ? 'on' : ''} onClick={() => setChunking({ ...chunking, mode: 'words' })} disabled={!!busy}>Fixed words</button>
            </div>
            <p className="hint">{chunking.mode === 'sections' ? 'One chunk per numbered paragraph (5.5.4, 6.2.1 …). Recommended for circulars.' : 'A new chunk every N words, whatever the paragraph. One chunk can mix two rules.'}</p>
          </div>
          {chunking.mode === 'words' && (
            <div className="two">
              <div><span className="lbl">Words per chunk</span>
                <select className="select" value={chunking.size} onChange={(e) => setChunking({ ...chunking, size: Number(e.target.value) })} disabled={!!busy}>
                  {[30, 60, 120, 250].map((n) => <option key={n} value={n}>{n} words</option>)}
                </select>
              </div>
              <div><span className="lbl">Overlap</span>
                <select className="select" value={chunking.overlap} onChange={(e) => setChunking({ ...chunking, overlap: Number(e.target.value) })} disabled={!!busy}>
                  {[0, 10, 20].filter((n) => n <= chunking.size / 2).map((n) => <option key={n} value={n}>{n} words</option>)}
                </select>
              </div>
            </div>
          )}
          <div>
            <span className="lbl">Embedding model</span>
            <select className="select" value={embModel} onChange={(e) => setEmbModel(e.target.value)} disabled={!!busy}>
              {models.embedding.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.note}</option>)}
            </select>
            <p className="hint">Turns each chunk into {dims} numbers that capture its meaning.</p>
          </div>
        </div>
        <div className="build-foot">
          {ready ? <div className="status ok"><IcCheck /> Index built ({index!.chunkCount} chunks, {index!.seconds.toFixed(1)} s). Ready to chat.</div>
            : <div className="status warn"><IcInfo /> {stale ? 'Settings or documents changed. Rebuild the index.' : 'Not built yet.'}</div>}
          <button className={`btn lg${ready ? '' : ' pri'}`} onClick={build} disabled={!!busy || ready}><IcPlay /> {busy === 'Building' ? 'Building… embedding the chunks' : ready ? 'Index is current' : stale ? 'Rebuild the index' : 'Build the index'}</button>
          {ready && <button className="btn pri lg" onClick={() => setTab('ask')}>Next: chat <IcArrowR /></button>}
        </div>
      </aside>

      <section className="panel">
        <div className="sec-h">
          <h3>The chunks</h3>
          {ready ? <span className="tag ok"><IcCheck s={12} /> Indexed</span> : <span className="tag warn">Preview · not indexed yet</span>}
          {pc && (pc.mode !== chunking.mode || (chunking.mode === 'words' && (pc.size !== chunking.size || pc.overlap !== chunking.overlap))) && <span className="tag neu">Updating the preview…</span>}
          <span className="sp" />
          <span className="meta">{docs.map((d) => d.short).join(' · ')}</span>
        </div>
        <div className="stats">
          <div className="stat"><small>Chunks</small><b className="num">{preview ? preview.count : '—'}</b></div>
          <div className="stat"><small>Typical size</small><b className="num">{lens.length ? `${median} words` : '—'}</b></div>
          <div className="stat"><small>Shortest · longest</small><b className="num">{preview ? `${preview.words.min} · ${preview.words.max}` : '—'}</b></div>
          <div className="stat"><small>Each chunk becomes</small><b className="num">{dims} numbers</b></div>
        </div>
        {pchunks.length > 0 && (
          <div className="ctools">
            <input className="input" placeholder="Find a word or para number" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find in chunks" />
            {filter && <span style={{ fontSize: 12.5, color: 'var(--tx3)' }}>{shown.length} of {pchunks.length}</span>}
            <span className="sp" />
            {chunking.mode === 'words' && chunking.overlap > 0 && <span className="legend"><mark className="ov">words</mark> repeated from the previous chunk</span>}
          </div>
        )}
        <div className="chunks">
          {!preview ? <div className="cempty"><IcCut s={26} />Cutting the documents…</div> : shown.map((c) => {
            const i = pchunks.indexOf(c);
            const ov = overlapOf(i);
            const w = c.text.split(' ');
            return (
              <div className="chunk" key={`${c.docId}-${c.n}`}>
                <span className="n">#{c.n}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="h">
                    <b>{c.label === 'opening' ? 'Opening' : `Para ${c.label}`}</b>
                    {c.context && <span className="tag neu">{c.context}</span>}
                    {docs.length > 1 && <span>{c.docTitle}</span>}
                    <span>{c.pageLabel}</span>
                    <span className="size"><span className="bar"><i style={{ width: `${(c.words / maxLen) * 100}%` }} /></span>{c.words} words</span>
                  </div>
                  {ov ? <p><mark className="ov">{w.slice(0, ov).join(' ')}</mark> {w.slice(ov).join(' ')}</p> : <p>{c.text}</p>}
                </div>
              </div>
            );
          })}
          {preview && preview.count > pchunks.length && <div className="more">Showing the first {pchunks.length} of {preview.count} chunks.</div>}
        </div>
      </section>
    </div>
  );

  const docsLabel = docs.length === 1 ? docs[0].short : `${docs.length} documents`;
  const sugg = testQs.filter((_, i) => SUGGESTED.includes(i));

  const renderMsg = (a: Ask) => {
    const src = !!openSrc[a.id];
    const maxScore = Math.max(0.0001, ...a.retrieved.map((h) => h.score));
    const t = a.testQuestionId ? testQs.find((q) => q.id === a.testQuestionId) : null;
    const cite = (n: number) => { setOpenSrc((o) => ({ ...o, [a.id]: true })); setOpenPas((o) => ({ ...o, [`${a.id}-${n}`]: true })); };
    const v = a.verdict ? VERDICT_KEY[a.verdict] : null;
    const auto = a.check ? (a.check.pass ? (t?.trap ? 'n' : 'g') : 'm') : null;
    const cmp = compare[a.id];
    return (
      <Fragment key={a.id}>
        <div className="msg me">
          <div className="bubble">{a.question}</div>
          {t && <span className={`tag ${t.trap ? 'warn' : 'neu'}`}>{t.trap ? 'Trap question' : 'Test question'}</span>}
        </div>
        <div className="msg bot">
          <span className="bot-av sm"><IcBot s={16} /></span>
          <div className="bwrap">
            <div className="bubble">
              {!a.settings.useDocuments && <span className="tag warn">Documents off · from memory</span>}
              <AnswerText text={a.answer} count={a.retrieved.length} onCite={cite} />
              {a.settings.useDocuments && a.retrieved.length > 0 && (
                <button className={`src-btn${src ? ' on' : ''}`} onClick={() => setOpenSrc((o) => ({ ...o, [a.id]: !o[a.id] }))} aria-expanded={src}>
                  <IcDoc s={14} /> {a.retrieved.length} sources{a.citations.length ? ` · ${a.citations.length} cited` : ''} <IcChevron open={src} />
                </button>
              )}
              {src && (
                <div className="srcs">
                  <div className="passages">
                    {a.retrieved.map((h, i) => {
                      const k = `${a.id}-${i + 1}`;
                      const cited = a.citations.includes(i + 1);
                      return (
                        <div className={`pas${cited ? ' cited' : ''}`} key={`${h.docId}-${h.n}`}>
                          <button onClick={() => setOpenPas((o) => ({ ...o, [k]: !o[k] }))} aria-expanded={!!openPas[k]}>
                            <span className="k">{i + 1}</span>
                            <span className="src">{h.docTitle} · para {h.label}</span>
                            <span className="sec">{h.context || h.pageLabel}</span>
                            <span className="sp" />
                            <span className="pscore">{h.score.toFixed(2)}</span>
                            <span className="bar" title={`Match ${h.score.toFixed(3)}`}><i style={{ width: `${(h.score / maxScore) * 100}%` }} /></span>
                            <IcChevron open={!!openPas[k]} />
                          </button>
                          {openPas[k] && <p>{h.text}</p>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="links">
                    {ready && <button className="link" onClick={() => loadCompare(a)} disabled={busy === 'Comparing'}>{cmp ? 'Hide comparison' : 'Compare keyword vs meaning search'}</button>}
                    <button className="link" onClick={() => togglePrompt(a)}>{prompts[a.id] ? 'Hide the prompt' : 'Show the prompt sent to the model'}</button>
                  </div>
                  {cmp && (
                    <div className="cmp">
                      {([['keyword', 'Keyword', 'kw'], ['meaning', 'Meaning', 'mn']] as [Method, string, string][]).map(([key, name, cls]) => (
                        <div key={key}>
                          <h5><span className={`tag ${cls}`}>{name}</span></h5>
                          <ol>
                            {cmp[key].hits.map((h, i) => <li key={`${h.docId}-${h.n}`}><b>#{i + 1}</b> para {h.label}<em>{h.context}</em><span>{h.score.toFixed(2)}</span></li>)}
                            {cmp[key].hits.length === 0 && <li>No match</li>}
                          </ol>
                        </div>
                      ))}
                    </div>
                  )}
                  {prompts[a.id] && <pre className="prompt">{`SYSTEM\n${prompts[a.id].system}\n\nUSER\n${prompts[a.id].user}`}</pre>}
                </div>
              )}
            </div>
            <div className="mfoot">
              <span className="meta">{a.model.name.replace('Gemini ', '')} · {(a.ms / 1000).toFixed(1)} s · ₹{(a.costInr ?? a.costUsd * 88).toFixed(4)}</span>
              {auto && <span className={`tag ${auto === 'g' ? 'ok' : auto === 'n' ? 'warn' : 'bad'}`}>Auto-check: {auto === 'g' ? 'matches' : auto === 'n' ? 'not covered' : 'doesn’t match'}</span>}
              <span className="sp" />
              <div className="verdict" role="group" aria-label="Your verdict">
                <button className={v === 'g' ? 'g' : ''} onClick={() => setVerdict(a, 'grounded')}>Grounded</button>
                <button className={v === 'm' ? 'm' : ''} onClick={() => setVerdict(a, 'made-up')}>Made up</button>
                <button className={v === 'n' ? 'n' : ''} onClick={() => setVerdict(a, 'refused')}>Not covered</button>
              </div>
            </div>
          </div>
        </div>
      </Fragment>
    );
  };

  const askScreen = (
    <section className="panel chat">
      <header className="chat-h">
        <span className="bot-av"><IcBot /></span>
        <div className="chat-id">
          <b>Custody rules assistant</b>
          <span className={answer.useDocuments ? '' : 'off'}><i className="live-dot" />{answer.useDocuments ? `Answers from ${docsLabel} · ${modelName(answer.model)}` : 'Documents off · answering from memory'}</span>
        </div>
        <span className="sp" />
        <button className="icon-btn" onClick={newChat} disabled={!thread.length || !!asking} aria-label="New chat" title="New chat"><IcPlus /></button>
        <button className={`icon-btn${showSet ? ' on' : ''}${changed ? ' dot' : ''}`} onClick={() => setShowSet((x) => !x)} aria-label="Settings" title={changed ? 'Settings (changed)' : 'Settings'} aria-expanded={showSet}><IcGear /></button>
      </header>

      <div className="msgs" ref={msgsRef}>
        {!ready ? (
          <div className="locked">
            <span className="ic"><IcInfo /></span>
            <h4>{stale ? 'Rebuild the index first' : 'Build the index first'}</h4>
            <p>The assistant needs an up-to-date index of the documents to answer from.</p>
            <button className="btn pri" onClick={() => setTab(docs.length ? 'index' : 'docs')}>Go to step 2 <IcArrowR /></button>
          </div>
        ) : !thread.length && !asking ? (
          <div className="welcome">
            <span className="bot-av lg"><IcBot s={26} /></span>
            <h4>Ask about SEBI’s custodian rules</h4>
            <p>Every answer comes with its sources.</p>
            <div className="qgrid">
              {sugg.map((t) => (
                <button key={t.id} className="qbtn" onClick={() => ask(t.question)}>
                  <span>{t.question}</span>{t.trap && <span className="tag warn">Trap</span>}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {ready && thread.map(renderMsg)}
        {asking && (
          <div className="msg bot">
            <span className="bot-av sm"><IcBot s={16} /></span>
            <div className="bwrap"><div className="bubble typing"><span className="dots"><i /><i /><i /></span>{asking === 'search' ? 'Searching the documents…' : asking === 'read' ? 'Reading the passages…' : 'Writing the answer…'}</div></div>
          </div>
        )}
        {error && tab === 'ask' && <div className="err" role="alert">{error}</div>}
      </div>

      <div className="composer">
        {showSugg && ready && (
          <div className="chips-row">
            {sugg.map((t) => <button key={t.id} className={t.trap ? 'trap' : ''} onClick={() => ask(t.question)} disabled={!!asking}>{t.trap ? 'Trap · ' : ''}{t.question}</button>)}
          </div>
        )}
        <div className="inp">
          <button className={`icon-btn ghost${showSugg ? ' on' : ''}`} onClick={() => setShowSugg((x) => !x)} disabled={!ready} aria-label="Suggested questions" title="Suggested questions"><IcBulb /></button>
          <textarea
            ref={inputRef}
            rows={1}
            value={question}
            maxLength={1000}
            onChange={(e) => { setQuestion(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
            placeholder={ready ? 'Ask a question…' : 'Build the index first'}
            disabled={!ready}
            aria-label="Question"
          />
          <button className="send" onClick={() => ask()} disabled={!ready || !question.trim() || !!asking} aria-label="Send"><IcSend /></button>
        </div>
      </div>

      {showSet && (
        <>
          <div className="scrim" onClick={() => setShowSet(false)} />
          <aside className="drawer" role="dialog" aria-label="Chat settings">
            <div className="dh"><IcGear /><div><h3>Settings</h3><small>Applies to your next question</small></div><span className="sp" /><button className="icon-btn ghost" onClick={() => setShowSet(false)} aria-label="Close"><IcX s={16} /></button></div>
            <div className="db">
              <div className="grp">
                <span className="gt">Grounding</span>
                <label className="switch"><input type="checkbox" checked={answer.useDocuments} onChange={(e) => setAnswer({ ...answer, useDocuments: e.target.checked })} /><span className="sw" /><span><b>Use the documents</b><small>Off: the model answers from memory.</small></span></label>
                <label className="switch"><input type="checkbox" checked={answer.strict} onChange={(e) => setAnswer({ ...answer, strict: e.target.checked })} disabled={!answer.useDocuments} /><span className="sw" /><span><b>Strict</b><small>Only answer from the sources, or say “not covered”.</small></span></label>
              </div>
              <div className="grp">
                <span className="gt">Search</span>
                <div className="seg">
                  {(['meaning', 'keyword'] as Method[]).map((m) => (
                    <button key={m} className={retrieval.method === m ? 'on' : ''} onClick={() => setRetrieval({ ...retrieval, method: m })} disabled={!answer.useDocuments}>{m === 'meaning' ? 'Meaning' : 'Keyword'}</button>
                  ))}
                </div>
                <div><span className="lbl">Sources per answer</span>
                  <select className="select" value={retrieval.k} onChange={(e) => setRetrieval({ ...retrieval, k: Number(e.target.value) })} disabled={!answer.useDocuments}>
                    {[1, 3, 6].map((n) => <option key={n} value={n}>Top {n}</option>)}
                  </select>
                </div>
              </div>
              <div className="grp">
                <span className="gt">Model</span>
                <select className="select" value={answer.model} onChange={(e) => setAnswer({ ...answer, model: e.target.value })} aria-label="Model">
                  {models.chat.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <div><span className="lbl">Temperature</span>
                  <select className="select" value={answer.temperature} onChange={(e) => setAnswer({ ...answer, temperature: Number(e.target.value) })}>
                    {[0, 0.2, 0.7, 1].map((n) => <option key={n} value={n}>{n}{n === 0.2 ? ' · default' : ''}</option>)}
                  </select>
                </div>
              </div>
              <div className="grp">
                <span className="gt">Your verdicts</span>
                <div className="tally">
                  <div><b style={{ color: 'var(--ok)' }}>{tally.g}</b><small>Grounded</small></div>
                  <div><b style={{ color: 'var(--bad)' }}>{tally.m}</b><small>Made up</small></div>
                  <div><b style={{ color: 'var(--warn)' }}>{tally.n}</b><small>Not covered</small></div>
                </div>
              </div>
            </div>
            <div className="df">
              <button className="btn" onClick={() => { setRetrieval(DEFAULT_RETRIEVAL); setAnswer(DEFAULT_ANSWER); }} disabled={!changed}>Reset</button>
              <button className="btn pri" onClick={() => setShowSet(false)}>Done</button>
            </div>
          </aside>
        </>
      )}
    </section>
  );

  const tabs: [Tab, string, boolean][] = [
    ['docs', 'Choose documents', docs.length > 0],
    ['index', 'Cut and index', ready],
    ['ask', 'Chat', thread.length > 0],
  ];

  return (
    <div className="rgx" data-theme={theme}>
      <div className="wrap">
        <div className="eyebrow">RAG chatbot</div>
        <h1 className="h1">Answer from SEBI’s documents, and show where</h1>
        <p className="lead">The bot first finds the matching passages, then answers only from them, with citations.</p>

        <div className="tabs" role="tablist">
          {tabs.map(([id, name, done], i) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' on' : ''}${done ? ' done' : ''}`} onClick={() => setTab(id)} disabled={!!busy && busy !== 'Comparing'}>
              <i>{done && tab !== id ? <IcCheck s={12} /> : i + 1}</i>{name}
            </button>
          ))}
        </div>

        {error && tab !== 'ask' && <p className="err" role="alert">{error}</p>}
        {tab === 'docs' ? docsScreen : tab === 'index' ? indexScreen : askScreen}
      </div>
    </div>
  );
}
