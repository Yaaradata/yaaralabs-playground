'use client';

/**
 * RAG Chatbot project: retrieval-augmented generation, one step at a time.
 *
 * 1 Documents  official SEBI circulars from the library, or the learner's own PDF / TXT / MD
 * 2 Chunks     sections (numbered paragraphs) or fixed word windows; preview, then build the index
 * 3 Search     keyword (TF-IDF) and meaning (embeddings) side by side, no model call; pick one
 * 4 Ask        passages → Gemini → an answer that cites them as [n]; strict mode; documents on/off;
 *              the learner marks each answer grounded / made up / said not covered
 * 5 Test       12 built-in questions (8 facts, 4 traps) checked automatically; compare settings
 *
 * Everything lives on the server (rag_chatbot_service.py): documents, indexes and chunks, every
 * question with the passages and prompt used, every test run. Answers are never simulated.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import config from '../../lib/config';
import { useAppTheme } from '../../lib/theme';
import type {
  AnswerSettings, Ask, Chunking, Eval, LibraryDoc, Method, Models, Preview, Project, ProjectDoc, Retrieval,
  SearchResult, SearchSide, Step, TestQuestion, Verdict,
} from './types';
import './ragChatbot.css';

interface Props {
  projectName: string;
  sessionId: string;
  projectId: string;
}

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
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IcCheck = () => <Svg s={14}><path d="M20 6L9 17l-5-5" /></Svg>;
const IcX = () => <Svg s={14}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcInfo = () => <Svg s={15}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
const IcArrow = () => <Svg s={14}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const IcBack = () => <Svg s={14}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
const IcSend = () => <Svg s={14}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></Svg>;
const IcTrash = () => <Svg s={13}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;
const IcLink = () => <Svg s={12}><path d="M15 3h6v6M10 14L21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Svg>;
const IcUp = () => <Svg s={22}><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></Svg>;
const IcSearch = () => <Svg s={14}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Svg>;
const IcPlay = () => <Svg s={14}><path d="M7 4l13 8-13 8z" /></Svg>;

const STEPS: { n: Step; title: string; sub: string }[] = [
  { n: 1, title: 'Documents', sub: 'What the bot may read' },
  { n: 2, title: 'Chunks', sub: 'Cut, embed, index' },
  { n: 3, title: 'Search', sub: 'Find the right passages' },
  { n: 4, title: 'Ask', sub: 'Answers with sources' },
  { n: 5, title: 'Test', sub: 'Facts and traps' },
];

const METHOD: Record<Method, { name: string; short: string; how: string; cls: string }> = {
  keyword: { name: 'Keyword search (TF-IDF)', short: 'Keyword', cls: 'kw',
    how: 'Scores passages by the words they share with the question, rare words counting more. A word the document doesn’t use scores nothing.' },
  meaning: { name: 'Meaning search (embeddings)', short: 'Meaning', cls: 'mn',
    how: 'Turns the question and every passage into vectors and compares their meaning, so “business continuity site” can find “disaster recovery site”.' },
};

const VERDICTS: { v: Verdict; label: string }[] = [
  { v: 'grounded', label: 'Grounded' },
  { v: 'made-up', label: 'Made up' },
  { v: 'refused', label: 'Said not covered' },
];

const SEARCH_EXAMPLES = ['Where must the business continuity site be?', 'How often are DR drills?', 'Do custodians need a vault?',
  'Which reports were discontinued?', 'T+0 trading hours'];

const num = (v: number) => v.toLocaleString();
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const inr = (usd: number) => `₹${(usd * 88).toFixed(usd * 88 < 0.01 ? 4 : 2)}`;
const dateText = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const chunkingText = (c: Chunking) => (c.mode === 'sections' ? 'sections' : `${c.size} words, ${c.overlap} overlap`);

/** Plain text with the model's light markdown shown properly: **bold** and * bullets. */
function Md({ text }: { text: string }) {
  const bulleted = text.replace(/^(\s*)[*-]\s+/gm, '$1• ');
  const parts = bulleted.split(/(\*\*[^*\n]+\*\*)/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

/** An answer with its [n] citations as chips (red when the passage number doesn't exist). */
function Cited({ text, count }: { text: string; count: number }) {
  const parts = text.split(/(\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\])/g);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Md key={i} text={p} />;
        const nums = (p.match(/\d+/g) || []).map(Number);
        return nums.map((n) => (
          <span key={`${i}-${n}`} className={`cite ${n >= 1 && n <= count ? '' : 'bad'}`} title={n <= count ? `passage ${n}` : 'no such passage'}>{n}</span>
        ));
      })}
    </>
  );
}

/** Passage text with the question's matched words highlighted (keyword search). */
function Marked({ text, words }: { text: string; words?: string[] }) {
  if (!words?.length) return <>{text}</>;
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((w, i) => {
        const bare = w.toLowerCase().replace(/[^a-z0-9]/g, '');
        return bare && words.some((m) => bare.startsWith(m)) ? <mark key={i} className="m">{w}</mark> : <span key={i}>{w}</span>;
      })}
    </>
  );
}

function Score({ v, max }: { v: number; max: number }) {
  return (
    <span className="score num">
      <i style={{ ['--w' as string]: `${Math.max(4, Math.min(100, (v / (max || 1)) * 100))}%` }} />
      {v.toFixed(3)}
    </span>
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
  const [step, setStep] = useState<Step>(1);

  // settings (restored from and autosaved to the project)
  const [chunking, setChunking] = useState<Chunking>({ mode: 'sections', size: 60, overlap: 10 });
  const [embModel, setEmbModel] = useState('text-embedding-005');
  const [retrieval, setRetrieval] = useState<Retrieval>({ method: 'meaning', k: 3, minScore: 0 });
  const [answer, setAnswer] = useState<AnswerSettings>({ model: 'gemini-flash-lite', temperature: 0.2, strict: true, useDocuments: true });
  const savedRef = useRef('');
  const loadedOnce = useRef(false); // a reload (remount, dev refresh) must not move the learner back a step

  const [viewer, setViewer] = useState<{ doc: ProjectDoc; pages: { page: number; text: string }[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chunkFilter, setChunkFilter] = useState('');
  const [query, setQuery] = useState(SEARCH_EXAMPLES[0]);
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [draft, setDraft] = useState('');
  const [prompts, setPrompts] = useState<Record<string, { system: string; user: string }>>({});
  const [evalOpen, setEvalOpen] = useState<Eval | null>(null);

  const apply = useCallback((p: Project, moveTo?: Step) => {
    setProject(p);
    setChunking(p.state.chunking);
    setEmbModel(p.state.embeddingModel);
    setRetrieval(p.state.retrieval);
    setAnswer(p.state.answer);
    if (moveTo) setStep(moveTo);
    savedRef.current = JSON.stringify({ step: moveTo ?? p.state.step, chunking: p.state.chunking, embeddingModel: p.state.embeddingModel,
      retrieval: p.state.retrieval, answer: p.state.answer });
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
      const allowed: Step = !p.data.documents.length ? 1 : !st.indexId ? (Math.min(st.step, 2) as Step) : st.step;
      apply(p.data, loadedOnce.current ? undefined : allowed);
      loadedOnce.current = true;
      setLibrary(lib.data);
      setModels(m.data);
      setTestQs(tq.data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [base, apply]);

  useEffect(() => { load(); }, [load]);

  // autosave the learner's place and settings
  useEffect(() => {
    if (!project) return;
    const snap = JSON.stringify({ step, chunking, embeddingModel: embModel, retrieval, answer });
    if (snap === savedRef.current) return;
    const t = setTimeout(async () => {
      savedRef.current = snap;
      try {
        await api(`${base}/state`, { method: 'PUT', body: snap });
        // chunking / model changes decide whether the index is still current
        const p = await api<{ data: Project }>(base);
        setProject((cur) => (cur ? { ...cur, indexFresh: p.data.indexFresh, wantedIndexId: p.data.wantedIndexId } : cur));
      } catch {
        savedRef.current = '';
      }
    }, 500);
    return () => clearTimeout(t);
  }, [project, base, step, chunking, embModel, retrieval, answer]);

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

  const docs = project?.documents ?? [];
  const hasIndex = !!project?.state.indexId && !!project.index;
  const unlocked = (n: Step) => n === 1 || (n === 2 && docs.length > 0) || (n >= 3 && hasIndex);

  /* ── step 1 ── */
  const addLibrary = (id: string) => run('Adding', async () => apply((await api<{ data: Project }>(`${base}/documents/library`, { method: 'POST', body: JSON.stringify({ libraryId: id }) })).data, 1));
  const removeDoc = (id: string) => run('Removing', async () => {
    apply((await api<{ data: Project }>(`${base}/documents/${id}`, { method: 'DELETE' })).data, 1);
    if (viewer?.doc.id === id) setViewer(null);
  });
  const uploadFile = (file: File) => run(`Reading ${file.name}`, async () => {
    const fd = new FormData();
    fd.append('file', file);
    apply((await api<{ data: Project }>(`${base}/documents/upload`, { method: 'POST', body: fd })).data, 1);
  });
  const openViewer = (doc: ProjectDoc) => run('Opening', async () => {
    const r = await api<{ data: { page: number; text: string }[] }>(`${base}/documents/${doc.id}/pages`);
    setViewer({ doc, pages: r.data });
  });

  /* ── step 2 ── */
  useEffect(() => {
    if (step !== 2 || !docs.length) return;
    let live = true;
    const t = setTimeout(() => {
      api<{ data: Preview }>(`${base}/chunks/preview`, { method: 'POST', body: JSON.stringify({ chunking }) })
        .then((r) => live && setPreview(r.data))
        .catch((e) => live && setError((e as Error).message));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [step, base, chunking, docs.length]);

  const buildIndex = () => run('Building the index', async () => {
    await api(`${base}/state`, { method: 'PUT', body: JSON.stringify({ chunking, embeddingModel: embModel }) });
    apply((await api<{ data: Project }>(`${base}/index`, { method: 'POST' })).data, 2);
  });

  /* ── step 3 ── */
  const doSearch = (q = query) => run('Searching', async () => {
    const r = await api<{ data: SearchResult }>(`${base}/search`, { method: 'POST', body: JSON.stringify({ question: q, k: retrieval.k, minScore: retrieval.minScore }) });
    setSearch(r.data);
  });

  /* ── step 4 ── */
  const asks = useMemo(() => project?.asks ?? [], [project]);
  const ask = (q: string, testQuestionId?: string) => {
    const question = q.trim();
    if (!question || busy) return;
    run('Thinking', async () => {
      const r = await api<{ data: Ask }>(`${base}/ask`, { method: 'POST', body: JSON.stringify({ question, testQuestionId, retrieval, answer }) });
      setProject((p) => (p ? { ...p, asks: [...p.asks, r.data] } : p));
      setDraft('');
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); }
  };
  const verdict = (a: Ask, v: Verdict) => {
    const next = a.verdict === v ? null : v;
    const patch = (p: Project): Project => ({
      ...p,
      asks: p.asks.map((x) => (x.id === a.id ? { ...x, verdict: next } : x)),
    });
    setProject((p) => (p ? patch(p) : p));
    setEvalOpen((ev) => (ev?.asks ? { ...ev, asks: ev.asks.map((x) => (x && x.id === a.id ? { ...x, verdict: next } : x)) } : ev));
    api(`${base}/asks/${a.id}`, { method: 'PATCH', body: JSON.stringify({ verdict: next }) })
      .then(() => (a.evalId ? refreshEvals() : undefined))
      .catch(() => setError('Could not save that verdict.'));
  };
  const removeAsk = (a: Ask) => {
    setProject((p) => (p ? { ...p, asks: p.asks.filter((x) => x.id !== a.id) } : p));
    api(`${base}/asks/${a.id}`, { method: 'DELETE' }).catch(() => setError('Could not delete that question.'));
  };
  const togglePrompt = async (a: Ask) => {
    if (prompts[a.id]) {
      setPrompts((cur) => {
        const nextPrompts = { ...cur };
        delete nextPrompts[a.id];
        return nextPrompts;
      });
      return;
    }
    const r = await api<{ data: Ask }>(`${base}/asks/${a.id}`).catch(() => null);
    if (r?.data.prompt) setPrompts((p) => ({ ...p, [a.id]: r.data.prompt! }));
  };
  const tally = useMemo(() => ({
    grounded: asks.filter((a) => a.verdict === 'grounded').length,
    madeUp: asks.filter((a) => a.verdict === 'made-up').length,
    refused: asks.filter((a) => a.verdict === 'refused').length,
  }), [asks]);

  /* ── step 5 ── */
  const refreshEvals = async () => {
    const p = await api<{ data: Project }>(base).catch(() => null);
    if (p) setProject((cur) => (cur ? { ...cur, evals: p.data.evals } : cur));
  };
  const runEval = (over?: Partial<AnswerSettings>) => run(over?.useDocuments === false ? 'Asking all 12 without documents' : 'Asking all 12 questions', async () => {
    const r = await api<{ data: Eval }>(`${base}/evals`, { method: 'POST', body: JSON.stringify({ retrieval, answer: { ...answer, ...over } }) });
    const detail = await api<{ data: Eval }>(`${base}/evals/${r.data.id}`);
    setProject((p) => (p ? { ...p, evals: [...p.evals, r.data] } : p));
    setEvalOpen(detail.data);
  });
  const openEval = (ev: Eval) => run('Opening', async () => setEvalOpen((await api<{ data: Eval }>(`${base}/evals/${ev.id}`)).data));

  /* ───────────── Render ───────────── */

  if (loadState !== 'ready' || !project || !library || !models) {
    return (
      <div className="rgx" data-theme={theme}>
        <div className="loading">
          {loadState === 'error' ? (
            <div><p>Couldn&apos;t open this project.</p><button className="btn" onClick={load}>Try again</button></div>
          ) : <p>Opening the RAG chatbot…</p>}
        </div>
      </div>
    );
  }

  const next = (n: Step, label: string, disabled = false) => (
    <button className="btn pri lg" disabled={disabled || !!busy} onClick={() => setStep(n)}>{label} <IcArrow /></button>
  );
  const back = (n: Step) => <button className="btn ghost" onClick={() => setStep(n)} disabled={!!busy}><IcBack /> Back</button>;
  const index = project.index;
  const filtered = preview?.chunks.filter((c) => !chunkFilter || `${c.label} ${c.text} ${c.context}`.toLowerCase().includes(chunkFilter.toLowerCase())) ?? [];
  const qById = Object.fromEntries(testQs.map((q) => [q.id, q]));

  const sideView = (side: SearchSide) => {
    const m = METHOD[side.method];
    const max = Math.max(...side.hits.map((h) => h.score), 0.0001);
    return (
      <div className={`panel pad side ${m.cls}`} key={side.method}>
        <h3><span className={`badge ${m.cls}`}>{m.short}</span>{m.name}</h3>
        <p className="how">{m.how}</p>
        {side.unknownWords.length > 0 && (
          <p className="how">Words in no passage: {side.unknownWords.map((w) => <code key={w} className="mono"> {w}</code>)}</p>
        )}
        {side.hits.length === 0 && <div className="empty" style={{ padding: 20 }}>Nothing scored above the minimum.</div>}
        {side.hits.map((h, i) => (
          <details className="hit" key={h.n}>
            <summary style={{ listStyle: 'none', cursor: 'pointer' }}>
              <div className="hd">
                <b>#{i + 1}</b>
                <span>{h.docTitle} · para {h.label} · {h.pageLabel}</span>
                <Score v={h.score} max={max} />
              </div>
              {h.context && <div className="hd" style={{ marginTop: 2 }}>{h.context}</div>}
              <p><Marked text={h.text} words={h.matched} /></p>
            </summary>
          </details>
        ))}
        {side.belowMinScore > 0 && <p className="how" style={{ marginTop: 8 }}>{side.belowMinScore} of the top {search?.k} were below the minimum score.</p>}
      </div>
    );
  };

  const turn = (a: Ask) => {
    const used = new Set(a.citations);
    return (
      <div key={a.id} className={`turn ${a.verdict || ''}`}>
        <div className="q">
          <span style={{ flex: 1 }}>{a.question}</span>
          {a.testQuestionId && <span className="badge">{qById[a.testQuestionId]?.trap ? 'Trap question' : 'Test question'}</span>}
        </div>
        <div className="a"><Cited text={a.answer} count={a.retrieved.length} /></div>
        <div className="flags">
          {!a.settings.useDocuments && <span className="badge warn">Documents off: answered from memory</span>}
          {a.settings.useDocuments && <span className={`badge ${METHOD[a.settings.method].cls}`}>{METHOD[a.settings.method].short} · top {a.settings.k}</span>}
          {a.settings.useDocuments && <span className="badge">{a.settings.strict ? 'Strict' : 'Not strict'}</span>}
          {a.settings.useDocuments && a.retrieved.length > 0 && (
            <span className={`badge ${a.citations.length ? 'ok' : 'warn'}`}>Cited {a.citations.length} of {a.retrieved.length} passages</span>
          )}
          {a.invalidCitations.length > 0 && <span className="badge bad">Cites a passage that doesn’t exist: {a.invalidCitations.join(', ')}</span>}
          {a.declined && <span className="badge ac">Said the documents don’t cover it</span>}
          {a.check && <span className={`badge ${a.check.pass ? 'ok' : 'bad'}`}>{a.check.pass ? <IcCheck /> : <IcX />} Check: {a.check.reason}</span>}
        </div>
        {a.retrieved.length > 0 && (
          <details className="sources">
            <summary><IcSearch /> Passages sent to the model ({a.retrieved.length}) · click to read</summary>
            {a.retrieved.map((h, i) => (
              <div key={h.n} className={`src ${used.has(i + 1) ? 'used' : ''}`}>
                <span className="pn">[{i + 1}]</span>
                <div>
                  <div className="hd"><b>{h.docTitle}</b><span>para {h.label}</span><span>{h.pageLabel}</span><span className="mono">score {h.score.toFixed(3)}</span>{used.has(i + 1) && <span className="badge ac">cited</span>}</div>
                  {h.text}
                </div>
              </div>
            ))}
          </details>
        )}
        {prompts[a.id] && (
          <pre className="prompt">{`SYSTEM\n${prompts[a.id].system}\n\nUSER\n${prompts[a.id].user}`}</pre>
        )}
        <div className="tfoot">
          <span>{a.model.name}</span>
          <span className="num">{num(a.tokens.in)} in · {num(a.tokens.out)} out</span>
          <span className="num">{inr(a.costUsd)}</span>
          <span className="num">{(a.ms / 1000).toFixed(1)} s</span>
          <button className="link" onClick={() => togglePrompt(a)}>{prompts[a.id] ? 'Hide prompt' : 'Show the prompt sent'}</button>
          <span className="sp" />
          {VERDICTS.map(({ v, label }) => (
            <button key={v} className={`vb ${v} ${a.verdict === v ? 'on' : ''}`} onClick={() => verdict(a, v)} aria-pressed={a.verdict === v}>{label}</button>
          ))}
          {!a.evalId && <button className="vb x" onClick={() => removeAsk(a)} aria-label="Delete this question"><IcTrash /></button>}
        </div>
      </div>
    );
  };

  const settingsText = (s: Eval['settings']) =>
    s.useDocuments ? `${METHOD[s.method].short} · top ${s.k} · ${chunkingText(s.chunking)} · ${s.strict ? 'strict' : 'not strict'}` : 'Documents off';

  return (
    <div className="rgx" data-theme={theme}>
      <div className="wrap">
        <div className="eyebrow">RAG chatbot</div>
        <h1 className="h1">Answer from the documents, and show where</h1>
        <p className="lead">
          A chatbot that answers from memory can sound sure and still invent a rule. <b>Retrieval-augmented generation</b> first finds the
          passages that match the question, then lets the model answer <b>only from them</b>, citing each one, and say so when the
          documents don&apos;t cover it.
        </p>

        <nav className="steps" aria-label="Steps">
          {STEPS.map((s) => (
            <button key={s.n} className={`stp ${step === s.n ? 'on' : ''} ${step !== s.n && s.n < step && unlocked(s.n) ? 'done' : ''}`}
              disabled={!unlocked(s.n) || !!busy} onClick={() => setStep(s.n)} aria-current={step === s.n ? 'step' : undefined}>
              <span className="n">{step !== s.n && s.n < step && unlocked(s.n) ? <IcCheck /> : s.n}</span>
              <span><b>{s.title}</b><small>{s.sub}</small></span>
            </button>
          ))}
        </nav>

        {error && <p className="err" role="alert">{error}</p>}

        {/* ── 1 Documents ── */}
        {step === 1 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">1 · Choose the documents</h2>
                <p>The chatbot may only answer from what is here. Start with the official SEBI circulars, or add your own (PDF with real text, TXT or MD).</p>
              </div>
            </div>
            <div className="grid3">
              {library.map((d) => {
                const added = docs.some((x) => x.id === d.id);
                return (
                  <div key={d.id} className={`lib ${added ? 'on' : ''}`}>
                    <div className="meta"><span className="badge ok">Official</span><span>{d.issuer.replace(/ \(SEBI\)$/, '')}</span></div>
                    <h3>{d.title}</h3>
                    <div className="meta"><span className="mono">{d.reference}</span></div>
                    <div className="meta"><span>{dateText(d.date)}</span><span>·</span><span>{d.pages} pages</span><span>·</span><span>{num(d.words)} words</span></div>
                    <p>{d.summary}</p>
                    <div className="act">
                      {added
                        ? <button className="btn sm" onClick={() => removeDoc(d.id)} disabled={!!busy}><IcX /> Remove</button>
                        : <button className="btn sm pri" onClick={() => addLibrary(d.id)} disabled={!!busy || docs.length >= 5}>Add to project</button>}
                      <a className="link" href={d.sourceUrl} target="_blank" rel="noreferrer">sebi.gov.in <IcLink /></a>
                    </div>
                  </div>
                );
              })}
              <label
                className={`drop ${dragOver ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) uploadFile(f); }}
              >
                <IcUp />
                <b>Add your own document</b>
                <span>Drop a file here or click. PDF (with real text, not a scan), TXT or MD · up to 10 MB, 80 pages.</span>
                <input type="file" accept=".pdf,.txt,.md" disabled={!!busy || docs.length >= 5}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }} />
                {busy?.startsWith('Reading') && <span className="badge ac">{busy}…</span>}
              </label>
            </div>

            <div className="panel docs">
              <div className="rows-h"><h3>In this project</h3><span className="muted">{docs.length} of 5 documents</span></div>
              {docs.length === 0 && <div className="empty">No documents yet. Add a circular above.</div>}
              {docs.map((d) => (
                <div className="docrow" key={d.id}>
                  <span className={`badge ${d.source === 'library' ? 'ok' : 'ac'}`}>{d.source === 'library' ? 'Library' : d.fileType.toUpperCase()}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b>{d.title}</b><br />
                    <small>{d.fileName} · {d.pages} pages · {num(d.words)} words{d.reference ? ` · ${d.reference}` : ''}</small>
                  </div>
                  <button className="btn sm" onClick={() => openViewer(d)} disabled={!!busy}>Read the text</button>
                  <button className="btn sm ghost" onClick={() => removeDoc(d.id)} disabled={!!busy}><IcTrash /></button>
                </div>
              ))}
            </div>

            {viewer && (
              <div className="panel docs">
                <div className="rows-h">
                  <h3>{viewer.doc.title}</h3>
                  <span className="muted">The text the chatbot works with, as extracted from the file</span>
                  <span className="sp" />
                  <button className="btn sm ghost" onClick={() => setViewer(null)}><IcX /> Close</button>
                </div>
                <div className="viewer">
                  {viewer.pages.map((p) => (
                    <div className="pg" key={p.page}><b>Page {p.page}</b><pre>{p.text}</pre></div>
                  ))}
                </div>
              </div>
            )}
            <div className="foot">
              {!docs.length && <span className="muted">Add at least one document.</span>}
              {next(2, 'Next: chunks', !docs.length)}
            </div>
          </section>
        )}

        {/* ── 2 Chunks ── */}
        {step === 2 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">2 · Cut the documents into chunks, then build the index</h2>
                <p>
                  The model can&apos;t read a whole circular for every question, so the text is cut into passages. Each passage is turned
                  into a vector (an embedding) and stored. How you cut decides what can be found.
                </p>
              </div>
            </div>
            <div className="modes">
              <button className={`mode ${chunking.mode === 'sections' ? 'on' : ''}`} onClick={() => setChunking({ ...chunking, mode: 'sections' })} disabled={!!busy}>
                <h3>By section <span className="badge ac">Recommended</span></h3>
                <p>One passage per numbered paragraph (5.5.4, 6.2.1 …), the way a regulation is written and cited. Short list items stay together; long paragraphs are split.</p>
              </button>
              <button className={`mode ${chunking.mode === 'words' ? 'on' : ''}`} onClick={() => setChunking({ ...chunking, mode: 'words' })} disabled={!!busy}>
                <h3>Fixed number of words</h3>
                <p>Every N words, with an overlap so a sentence cut in two still appears whole somewhere. Ignores the paragraphs, so one passage can mix two rules.</p>
              </button>
            </div>
            <div className="chunk-cfg">
              <label>
                <span className="label">Words per chunk</span>
                <select className="select" value={chunking.size} disabled={chunking.mode !== 'words' || !!busy} onChange={(e) => setChunking({ ...chunking, size: Number(e.target.value) })}>
                  {[30, 60, 120, 250].map((v) => <option key={v} value={v}>{v} words</option>)}
                </select>
              </label>
              <label>
                <span className="label">Overlap</span>
                <select className="select" value={chunking.overlap} disabled={chunking.mode !== 'words' || !!busy} onChange={(e) => setChunking({ ...chunking, overlap: Number(e.target.value) })}>
                  {[0, 10, 20, 40].filter((v) => v <= chunking.size / 2).map((v) => <option key={v} value={v}>{v} words</option>)}
                </select>
              </label>
              <label>
                <span className="label">Embedding model</span>
                <select className="select" value={embModel} disabled={!!busy} onChange={(e) => setEmbModel(e.target.value)}>
                  {models.embedding.map((m) => <option key={m.id} value={m.id}>{m.name}: {m.note}</option>)}
                </select>
              </label>
            </div>

            {preview && (
              <div className="stats" style={{ marginTop: 14 }}>
                <div className="stat"><small>Chunks</small><b className="num">{num(preview.count)}</b><span>{preview.perDocument.map((d) => `${d.short} ${d.chunks}`).join(' · ')}</span></div>
                <div className="stat"><small>Typical size</small><b className="num">{preview.words.avg} words</b><span>shortest {preview.words.min}, longest {preview.words.max}</span></div>
                <div className="stat"><small>Each becomes</small><b className="num">{models.embedding.find((m) => m.id === embModel)?.dims ?? 768}</b><span>numbers (a vector) for meaning search</span></div>
                <div className="stat"><small>Index</small><b>{project.indexFresh ? 'Up to date' : index ? 'Out of date' : 'Not built'}</b>
                  <span>{index ? `${num(index.chunkCount)} chunks · ${chunkingText(index.chunking)}` : 'build it to search and ask'}</span></div>
              </div>
            )}

            <div className="panel" style={{ marginTop: 14 }}>
              <div className="indexbar">
                {busy === 'Building the index' ? (
                  <><div className="track"><i /></div><span className="muted">Embedding {preview ? num(preview.count) : ''} chunks and saving them…</span></>
                ) : project.indexFresh && index ? (
                  <span className="badge ok"><IcCheck /> Index ready: {num(index.chunkCount)} chunks · {index.embeddingModel} · built in {index.seconds.toFixed(1)} s
                    {index.embedded.fromSharedCache > 0 ? ` · ${index.embedded.fromSharedCache} vectors reused` : ''}</span>
                ) : (
                  <span className="badge warn"><IcInfo /> {index ? 'The documents or chunk settings changed: build the index again.' : 'Not built yet.'}</span>
                )}
                <span className="sp" />
                <button className="btn pri" onClick={buildIndex} disabled={!!busy || !docs.length || (project.indexFresh && !!index)}>
                  <IcPlay /> {index && project.indexFresh ? 'Index is current' : 'Build the index'}
                </button>
              </div>
            </div>

            {preview && (
              <div className="panel" style={{ marginTop: 14 }}>
                <div className="rows-h">
                  <h3>The chunks</h3>
                  <span className="muted">{chunkFilter ? `${filtered.length} match` : `showing ${Math.min(preview.chunks.length, preview.count)} of ${num(preview.count)}`}</span>
                  <span className="sp" />
                  <input className="input" style={{ width: 240 }} placeholder="Find text or a para number" value={chunkFilter} onChange={(e) => setChunkFilter(e.target.value)} />
                </div>
                <div className="chunks">
                  {filtered.map((c) => (
                    <div className="chunk" key={c.n}>
                      <span className="no">#{c.n}</span>
                      <div>
                        <div className="hd"><b style={{ color: 'var(--tx)' }}>{c.docTitle}</b><span>para {c.label}</span><span>{c.pageLabel}</span><span>{c.words} words</span>{c.context && <span className="badge">{c.context}</span>}</div>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="foot">
              {back(1)}
              {next(3, 'Next: search', !(project.indexFresh && index))}
            </div>
          </section>
        )}

        {/* ── 3 Search ── */}
        {step === 3 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">3 · Search: which passages come back?</h2>
                <p>Before any model writes a word, retrieval decides what it gets to read. Compare the two ways of searching on the same question. No AI model is called here.</p>
              </div>
            </div>
            <div className="panel pad">
              <div className="qbar">
                <label className="q"><span className="label">Question</span>
                  <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} maxLength={1000} />
                </label>
                <label className="k"><span className="label">Top k</span>
                  <select className="select" value={retrieval.k} onChange={(e) => setRetrieval({ ...retrieval, k: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <button className="btn pri" onClick={() => doSearch()} disabled={!!busy || !query.trim()}><IcSearch /> {busy === 'Searching' ? 'Searching…' : 'Search'}</button>
              </div>
              <div className="chips">
                <span className="muted" style={{ fontSize: 12 }}>Try:</span>
                {SEARCH_EXAMPLES.map((x) => <button key={x} className="chip" onClick={() => { setQuery(x); doSearch(x); }}>{x}</button>)}
              </div>
            </div>
            {search && (
              <>
                <div className="grid2" style={{ marginTop: 14 }}>
                  {sideView(search.keyword)}
                  {sideView(search.meaning)}
                </div>
                <div className="note" style={{ marginTop: 12 }}>
                  <IcInfo />
                  <span>Scores on the two sides aren&apos;t comparable: keyword scores are word overlap (often below 0.3), meaning scores are similarity between vectors (often 0.5–0.8). Compare the <b>order</b>, and whether the right paragraph made the top {search.k}.</span>
                </div>
              </>
            )}
            <div className="panel pad" style={{ marginTop: 14 }}>
              <p className="sub-h">What the chatbot uses <span>saved with the project; you can change it again in step 4</span></p>
              <div className="choose">
                <div>
                  <span className="label">Search method</span>
                  <div className="seg">
                    {(['meaning', 'keyword'] as Method[]).map((m) => (
                      <button key={m} className={retrieval.method === m ? 'on' : ''} onClick={() => setRetrieval({ ...retrieval, method: m })}>{METHOD[m].short}</button>
                    ))}
                  </div>
                </div>
                <label><span className="label">Passages per question (k)</span>
                  <select className="select" value={retrieval.k} onChange={(e) => setRetrieval({ ...retrieval, k: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label><span className="label">Minimum score</span>
                  <select className="select" value={retrieval.minScore} onChange={(e) => setRetrieval({ ...retrieval, minScore: Number(e.target.value) })}>
                    {[0, 0.1, 0.2, 0.3, 0.5, 0.6, 0.7].map((v) => <option key={v} value={v}>{v === 0 ? 'none' : v}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div className="foot">
              {back(2)}
              {next(4, 'Next: ask the chatbot')}
            </div>
          </section>
        )}

        {/* ── 4 Ask ── */}
        {step === 4 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">4 · Ask</h2>
                <p>Each answer shows the passages it was given and which ones it cited. Mark it: <b>grounded</b> (backed by a cited passage), <b>made up</b>, or <b>said not covered</b>.</p>
              </div>
            </div>
            <div className="ask-grid">
              <div>
                <div className="panel composer">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} maxLength={1000}
                    placeholder="Ask about the documents and press Enter" aria-label="Your question" />
                  <div className="row">
                    <span className="muted">Enter to send · Shift+Enter for a new line</span>
                    <button className="btn pri" onClick={() => ask(draft)} disabled={!draft.trim() || !!busy}><IcSend /> Ask</button>
                  </div>
                  <div className="chips">
                    <span className="muted" style={{ fontSize: 12 }}>From the test set:</span>
                    {testQs.slice(0, 4).concat(testQs.filter((q) => q.trap).slice(0, 2)).map((q) => (
                      <button key={q.id} className="chip" onClick={() => ask(q.question, q.id)} disabled={!!busy}>{q.trap ? '⚠ ' : ''}{q.question}</button>
                    ))}
                  </div>
                </div>
                <div className="thread">
                  {busy === 'Thinking' && <div className="panel typing"><div className="track"><i /></div>Searching the documents and asking {models.chat.find((m) => m.id === answer.model)?.name}…</div>}
                  {asks.slice().reverse().map(turn)}
                  {asks.length === 0 && busy !== 'Thinking' && <div className="panel empty">No questions yet. Ask one, or click a test question.</div>}
                </div>
              </div>
              <aside className="panel settings">
                <p className="sub-h" style={{ margin: 0 }}>Settings for the next question</p>
                <label className="tg">
                  <input type="checkbox" checked={answer.useDocuments} onChange={(e) => setAnswer({ ...answer, useDocuments: e.target.checked })} />
                  <span><b>Use the documents</b><span>Off: the model answers from memory, with no passages. Ask a trap question both ways.</span></span>
                </label>
                <label className="tg">
                  <input type="checkbox" checked={answer.strict} disabled={!answer.useDocuments} onChange={(e) => setAnswer({ ...answer, strict: e.target.checked })} />
                  <span><b>Strict: passages only</b><span>Must cite, must say “The documents don&apos;t cover this” instead of guessing.</span></span>
                </label>
                <div>
                  <span className="label">Search</span>
                  <div className="seg">
                    {(['meaning', 'keyword'] as Method[]).map((m) => (
                      <button key={m} className={retrieval.method === m ? 'on' : ''} disabled={!answer.useDocuments} onClick={() => setRetrieval({ ...retrieval, method: m })}>{METHOD[m].short}</button>
                    ))}
                  </div>
                </div>
                <label><span className="label">Passages (k)</span>
                  <select className="select" value={retrieval.k} disabled={!answer.useDocuments} onChange={(e) => setRetrieval({ ...retrieval, k: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label><span className="label">Model</span>
                  <select className="select" value={answer.model} onChange={(e) => setAnswer({ ...answer, model: e.target.value })}>
                    {models.chat.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label><span className="label">Temperature</span>
                  <select className="select" value={answer.temperature} onChange={(e) => setAnswer({ ...answer, temperature: Number(e.target.value) })}>
                    {[0, 0.2, 0.7, 1.2].map((v) => <option key={v} value={v}>{v}{v === 0.2 ? ' · default' : v >= 1 ? ' · creative' : ''}</option>)}
                  </select>
                </label>
                <div className="tally">
                  <div><b className="num" style={{ color: 'var(--ok)' }}>{tally.grounded}</b><span>grounded</span></div>
                  <div><b className="num" style={{ color: 'var(--bad)' }}>{tally.madeUp}</b><span>made up</span></div>
                  <div><b className="num" style={{ color: 'var(--act)' }}>{tally.refused}</b><span>said not covered</span></div>
                </div>
              </aside>
            </div>
            <div className="foot">
              {back(3)}
              {next(5, 'Next: run the test set')}
            </div>
          </section>
        )}

        {/* ── 5 Test ── */}
        {step === 5 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">5 · Test: 8 facts and 4 traps</h2>
                <p>
                  The same 12 questions with the current settings. Facts are checked against the circulars; a trap is passed only when the
                  bot says the documents don&apos;t cover it. Change a setting and run again to compare. Your own verdict overrides the automatic check.
                </p>
              </div>
            </div>
            <div className="panel pad">
              <div className="qbar">
                <div style={{ flex: 1, minWidth: 240 }}>
                  <span className="label">Current settings</span>
                  <b>{answer.useDocuments ? `${METHOD[retrieval.method].short} search · top ${retrieval.k} · ${chunkingText(chunking)} · ${answer.strict ? 'strict' : 'not strict'}` : 'Documents off'}</b>
                  <span className="muted"> · {models.chat.find((m) => m.id === answer.model)?.name}</span>
                </div>
                <button className="btn" onClick={() => runEval({ useDocuments: false })} disabled={!!busy}>Run with documents off</button>
                <button className="btn pri" onClick={() => runEval()} disabled={!!busy}><IcPlay /> {busy?.startsWith('Asking all') ? `${busy}…` : 'Run all 12'}</button>
              </div>
              {busy?.startsWith('Asking all') && <div className="indexbar" style={{ padding: '12px 0 0' }}><div className="track"><i /></div><span className="muted">About 20–40 seconds.</span></div>}
            </div>

            {evalOpen && evalOpen.asks && (
              <>
                <div className="scores">
                  <div className="stat"><small>Facts correct</small><b className="num">{evalOpen.summary.factsPassed} / {evalOpen.summary.facts}</b><span>{pct(evalOpen.summary.factsCited, evalOpen.summary.facts)} cited a passage</span></div>
                  <div className="stat"><small>Traps declined</small><b className="num">{evalOpen.summary.trapsPassed} / {evalOpen.summary.traps}</b><span>said the documents don&apos;t cover it</span></div>
                  <div className="stat"><small>Made up</small><b className="num" style={{ color: evalOpen.summary.madeUp ? 'var(--bad)' : undefined }}>{evalOpen.summary.madeUp}</b><span>answered a trap, or marked made up</span></div>
                  <div className="stat"><small>Overall</small><b className="num">{evalOpen.summary.passed} / {evalOpen.summary.total}</b><span>{settingsText(evalOpen.settings)} · {evalOpen.seconds} s</span></div>
                </div>
                <div className="panel">
                  <div className="scroll">
                    <table className="t">
                      <thead><tr><th>#</th><th>Question</th><th>Expected</th><th>Chatbot answered</th><th>Check</th><th>Your verdict</th></tr></thead>
                      <tbody>
                        {evalOpen.results.map((r, i) => {
                          const q = qById[r.questionId];
                          const a = evalOpen.asks?.[i] ?? null;
                          return (
                            <tr key={r.questionId}>
                              <td className="mono">{i + 1}</td>
                              <td className="q">{q?.question}<br /><span className={`badge ${r.trap ? 'warn' : ''}`}>{q?.type}</span></td>
                              <td>{q?.answer}<br /><span className="muted" style={{ fontSize: 12 }}>{q?.where}</span></td>
                              <td className="a">{a ? <Cited text={a.answer} count={a.retrieved.length} /> : <span className="fail">{r.error}</span>}
                                {a && a.retrieved.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>passages: {a.retrieved.map((h) => h.label).join(', ')}</div>}
                              </td>
                              <td><span className={r.pass ? 'pass' : 'fail'}>{r.pass ? 'Pass' : 'Fail'}</span><br /><span className="muted" style={{ fontSize: 12 }}>{r.reason}</span></td>
                              <td>
                                {a && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {VERDICTS.map(({ v, label }) => (
                                      <button key={v} className={`vb ${v} ${a.verdict === v ? 'on' : ''}`} onClick={() => verdict(a, v)}>{label}</button>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {project.evals.length > 0 && (
              <div className="panel runs">
                <div className="rows-h"><h3>Compare runs</h3><span className="muted">click a run to open it</span></div>
                <div className="scroll">
                  <table className="t">
                    <thead><tr><th>Run</th><th>Settings</th><th>Model</th><th>Facts</th><th>Traps declined</th><th>Made up</th><th>Overall</th></tr></thead>
                    <tbody>
                      {project.evals.slice().reverse().map((ev, i) => (
                        <tr key={ev.id} className={`click ${evalOpen?.id === ev.id ? 'on' : ''}`} onClick={() => !busy && openEval(ev)}>
                          <td className="mono">{project.evals.length - i}</td>
                          <td>{settingsText(ev.settings)}</td>
                          <td>{models.chat.find((m) => m.id === ev.settings.model)?.name ?? ev.settings.model}</td>
                          <td className="num">{ev.summary.factsPassed} / {ev.summary.facts}</td>
                          <td className="num">{ev.summary.trapsPassed} / {ev.summary.traps}</td>
                          <td className="num" style={{ color: ev.summary.madeUp ? 'var(--bad)' : undefined }}>{ev.summary.madeUp}</td>
                          <td className="num"><b>{ev.summary.passed} / {ev.summary.total}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!evalOpen && project.evals.length === 0 && <div className="panel empty" style={{ marginTop: 14 }}>No test runs yet. Press <b>Run all 12</b>.</div>}
            <div className="foot">{back(4)}</div>
          </section>
        )}
      </div>
    </div>
  );
}

