'use client';

import { useEffect, useRef, useState } from 'react';
import { parseAnswer } from './answerText';
import { chatHistory, clearChat, kbPdfUrl, streamChat } from './api';
import { GUARDRAIL_LABELS } from './GuardrailsPanel';
import PdfViewer from './PdfViewer';
import SampleQuestions from './SampleQuestions';
import type { Stage } from './stages';
import type { ChatMessage, Passage, PdfTarget, Step, Trace } from './types';
import { Chip, Spinner } from './ui';
import { useSamplesShown } from './samplesShortcut';

const TOOL_LABEL: Record<string, string> = {
  today: "Today's date",
  calculator: 'Calculator',
  settlement_date: 'Settlement date',
  nse_calendar: 'NSE calendar',
  validate_isin: 'ISIN check',
  lookup_isin: 'ISIN lookup',
  validate_pan: 'PAN check',
  validate_ifsc: 'IFSC check',
  validate_gstin: 'GSTIN check',
  request_ssi_change: 'Change bank / settlement instructions',
};

const argsText = (args?: Record<string, unknown>) =>
  Object.entries(args || {})
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ');

// The fields that say what a tool found, in the order worth reading
const KEY_FIELDS = ['answer', 'settlement_date', 'weekday', 'date', 'result', 'valid', 'company', 'symbol', 'holder_type',
  'state', 'trading', 'settlement', 'holiday', 'status', 'note', 'warning'];

/** A tool result in a few words: its most telling fields, not the raw JSON. */
function shortResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result !== 'object') {
    const s = String(result);
    return s.length > 140 ? `${s.slice(0, 140)}…` : s;
  }
  const r = result as Record<string, unknown>;
  if (typeof r.error === 'string') return `error: ${r.error}`;
  if (typeof r.truncated === 'string' || typeof r.json === 'string') return 'see the full result in the trace';
  const parts = KEY_FIELDS.filter((k) => r[k] !== undefined && r[k] !== null && typeof r[k] !== 'object')
    .slice(0, 3)
    .map((k) => `${k.replace(/_/g, ' ')} ${String(r[k])}`);
  if (parts.length) return parts.join(', ');
  const s = JSON.stringify(r);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function AnswerText({ text, count, onCite }: { text: string; count: number; onCite: (n: number) => void }) {
  return (
    <div className="as-answer">
      {parseAnswer(text, count).map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === 'bold' ? (
          <b key={i}>{p.text}</b>
        ) : (
          <button
            key={i}
            type="button"
            className={`as-cite ${p.ok ? '' : 'as-cite-bad'}`}
            onClick={() => p.ok && onCite(p.n)}
            title={p.ok ? 'Show the passage' : 'No such passage'}
            aria-label={p.ok ? `Passage ${p.n}` : `Passage ${p.n} does not exist`}
          >
            {p.n}
          </button>
        ),
      )}
    </div>
  );
}

function PassageList({ passages, onOpen }: { passages: Passage[]; onOpen: (p: Passage) => void }) {
  const best = Math.max(0.0001, ...passages.map((p) => p.score));
  return (
    <ol className="space-y-2 mt-2">
      {passages.map((p) => (
        <li key={p.n}>
          <button type="button" onClick={() => onOpen(p)} className={`as-passage ${p.cited ? 'as-passage-cited' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg/70">
              <span className="as-cite">{p.n}</span>
              <b className="text-fg">{p.doc_title}</b>
              <span>para {p.label}</span>
              <span>{p.page_label}</span>
              <span className="as-scorebar" aria-label={`Match ${Math.round(p.score * 100)}%`}>
                <span style={{ width: `${Math.max(6, Math.round((p.score / best) * 100))}%` }} />
              </span>
              <span>{p.score.toFixed(2)}</span>
              {p.cited && <span className="as-chip">cited</span>}
            </div>
            <p className="text-sm text-fg/90 mt-1 line-clamp-3 text-left">{p.text}</p>
          </button>
        </li>
      ))}
    </ol>
  );
}

function StepsView({ steps, passages, onOpen }: { steps: Step[]; passages: Passage[]; onOpen: (p: Passage) => void }) {
  const [openKb, setOpenKb] = useState<number | null>(null);
  const tools = steps.filter((s) => s.kind === 'tool');
  return (
    <ol className="as-steps">
      {tools.map((s, i) => {
        if (s.blocked) {
          return <li key={i} className="as-step as-step-blocked">🛡 Blocked by your guardrail: {TOOL_LABEL[s.name || ''] || s.name}</li>;
        }
        if (s.name === 'search_knowledge_base') {
          const hits = passages.filter((p) => (s.passages || []).includes(p.n));
          return (
            <li key={i} className="as-step">
              <button type="button" className="text-left hover:text-pink-brand" onClick={() => setOpenKb(openKb === i ? null : i)} aria-expanded={openKb === i}>
                📄 Searched your documents for “{s.query}” → {hits.length} passage{hits.length === 1 ? '' : 's'}
              </button>
              {openKb === i && hits.length > 0 && <PassageList passages={hits} onOpen={onOpen} />}
            </li>
          );
        }
        if (s.name === 'web_search') {
          const srcs = s.sources || [];
          return (
            <li key={i} className="as-step">
              🌐 Searched the web for “{s.query}” → {srcs.length} source{srcs.length === 1 ? '' : 's'}
              {srcs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {srcs.map((src, j) => (
                    <a key={j} href={src.uri} target="_blank" rel="noopener noreferrer" className="as-source">{src.title || src.uri}</a>
                  ))}
                </div>
              )}
            </li>
          );
        }
        if (s.group === 'unknown') return <li key={i} className="as-step as-step-err">Tried a tool that doesn&apos;t exist: {s.name}</li>;
        return (
          <li key={i} className={`as-step ${s.ok ? '' : 'as-step-err'}`}>
            🔧 Used {TOOL_LABEL[s.name || ''] || s.name}: {argsText(s.args)} → {shortResult(s.result)}
          </li>
        );
      })}
    </ol>
  );
}

function ruleName(r: Trace['rule_matched']): string | null {
  if (!r) return null;
  return typeof r === 'string' ? 'Action fired' : r.name || 'Action fired';
}

/** One assistant reply: the answer, its chips, and (Ex 7 / Ex 8) passages or steps. */
function Reply({ m, stage, onOpen }: { m: ChatMessage; stage: Stage; onOpen: (p: Passage) => void }) {
  const [showPassages, setShowPassages] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const t = m.trace || {};
  const passages = t.passages || [];
  const cited = passages.filter((p) => p.cited).length;
  const toolSteps = (t.steps || []).filter((s) => s.kind === 'tool');
  const web = t.web_sources || [];
  const rule = ruleName(t.rule_matched);
  const openN = (n: number) => {
    const p = passages.find((x) => x.n === n);
    if (p) onOpen(p);
  };
  if (m.streaming) {
    // still being written: the text so far with a caret, or what the agent is doing before the first words
    const live = (m.liveSteps || []).filter((s) => s.kind === 'tool');
    return (
      <div className="as-bubble as-bubble-bot">
        {live.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {live.map((s, i) => (
              <Chip key={i}>🔧 {TOOL_LABEL[s.name || ''] || s.name}{s.ok === false ? ' ✕' : ' ✓'}</Chip>
            ))}
          </div>
        )}
        {m.content ? (
          <div className="as-answer">
            {m.content}
            <span className="as-caret" aria-hidden="true" />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-fg/60 text-sm">
            <Spinner /> {m.status || (stage === 'agent' ? 'Working on it…' : stage === 'rag' ? 'Reading the documents…' : 'Thinking…')}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={`as-bubble as-bubble-bot ${m.error ? 'as-bubble-error' : ''}`}>
      {m.error ? <p className="text-sm">{m.content}</p> : <AnswerText text={m.content} count={passages.length} onCite={openN} />}
      {!m.error && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {t.guardrail_blocked && <Chip tone="guard">🛡 Blocked by guardrail: {GUARDRAIL_LABELS[t.guardrail_blocked] || t.guardrail_blocked}</Chip>}
          {t.guardrail_masked ? <Chip tone="guard">🛡 Hid {t.guardrail_masked} client detail{t.guardrail_masked === 1 ? '' : 's'}</Chip> : null}
          {stage === 'rag' && passages.length > 0 && (
            <Chip onClick={() => setShowPassages(!showPassages)} title="Show the passages">📄 {passages.length} passages used · {cited} cited</Chip>
          )}
          {stage === 'agent' && passages.length > 0 && <Chip>📄 {passages.length} passages used</Chip>}
          {stage === 'agent' && web.length > 0 && <Chip>🌐 Searched the web</Chip>}
          {stage === 'agent' && toolSteps.length > 0 && <Chip>🔧 {toolSteps.length} tool step{toolSteps.length === 1 ? '' : 's'}</Chip>}
          {rule && <Chip>⚡ Action: {rule}</Chip>}
        </div>
      )}
      {showPassages && passages.length > 0 && <PassageList passages={passages} onOpen={onOpen} />}
      {stage === 'agent' && web.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-magenta-brand/15">
          <span className="text-xs font-semibold text-purple-brand mr-2">Searched from web</span>
          <span className="inline-flex flex-wrap gap-1.5 align-middle">
            {web.map((s, i) => (
              <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" className="as-source" title={s.uri}>
                {i + 1}. {s.title || s.uri}
              </a>
            ))}
          </span>
        </div>
      )}
      {stage === 'agent' && toolSteps.length > 0 && (
        <div className="mt-2.5">
          <button type="button" className="text-xs font-semibold text-pink-brand" onClick={() => setShowSteps(!showSteps)} aria-expanded={showSteps}>
            {showSteps ? '▾' : '▸'} What the agent did ({toolSteps.length} step{toolSteps.length === 1 ? '' : 's'})
          </button>
          {showSteps && <StepsView steps={t.steps || []} passages={passages} onOpen={onOpen} />}
        </div>
      )}
    </div>
  );
}

/** USE AI: the chat, Reset Chat, sample questions, and the PDF drawer for passages. */
export default function ChatPanel({ agentId, sessionId, stage, agentName }: { agentId: string; sessionId: string; stage: Stage; agentName: string }) {
  // sample data stays hidden until Ctrl+Shift+Z is pressed in this section (see samplesShortcut.tsx)
  const samplesShown = useSamplesShown(`${agentId}:chat`);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [samples, setSamples] = useState(false);
  const [pdf, setPdf] = useState<PdfTarget | null>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    chatHistory(agentId, sessionId)
      .then((ms) => live && setMessages(ms.map((m) => ({ id: m.id, role: m.role, content: m.content, trace: m.trace || null }))))
      .catch(() => live && setMessages([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [agentId, sessionId]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: message }]);
    setSending(true);
    // the answer appears as it is written (POST /chat/stream), like ChatGPT
    const id = `s-${Date.now()}`;
    const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));
    setMessages((prev) => [...prev, { id, role: 'assistant', content: '', streaming: true, liveSteps: [] }]);
    try {
      await streamChat(agentId, sessionId, message, (ev) => {
        if (ev.type === 'delta') patch((m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === 'status') patch((m) => ({ ...m, status: ev.text }));
        else if (ev.type === 'step') {
          const s = ev.step;
          patch((m) => ({
            ...m,
            liveSteps: [...(m.liveSteps || []), s],
            status: s.kind === 'tool' ? `Used ${TOOL_LABEL[s.name || ''] || s.name}…` : m.status,
          }));
        } else if (ev.type === 'done') {
          patch((m) => ({ ...m, id: ev.chat_id || id, content: ev.response, trace: ev.trace, streaming: false, status: undefined, liveSteps: undefined }));
        }
      });
    } catch (e) {
      // No made-up answer: show what went wrong (and keep any text that had already arrived)
      patch((m) => ({
        ...m,
        streaming: false,
        error: true,
        content: m.content ? `${m.content}

${(e as Error).message}` : (e as Error).message,
      }));
    } finally {
      setSending(false);
    }
  };

  const reset = async () => {
    try {
      await clearChat(agentId, sessionId);
      setMessages([]);
      setPdf(null);
    } catch (e) {
      setMessages((prev) => [...prev, { id: `e-${Date.now()}`, role: 'assistant', content: (e as Error).message, error: true }]);
    }
  };

  const openPassage = (p: Passage) => {
    setSamples(false);
    setPdf({ url: kbPdfUrl(agentId, sessionId, p.doc_id), title: p.doc_title, page: p.pages[0] || 1, passage: p, docId: p.doc_id });
  };

  return (
    <div className="as-chat">
      <div className="flex flex-col min-h-0 flex-1 border border-magenta-brand/20 rounded-xl overflow-hidden bg-canvas">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-magenta-brand/15 bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-purple-brand text-white flex items-center justify-center font-semibold flex-shrink-0">
              {(agentName || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-fg truncate">{agentName || 'Assistant'}</div>
              <div className="text-xs text-fg/60">
                {stage === 'assistant' ? 'Answers from what the model knows' : stage === 'rag' ? 'Answers only from your documents' : 'Decides which tools to use'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {samplesShown && (
              <button type="button" onClick={() => { setPdf(null); setSamples(!samples); }} className="as-head-btn" aria-expanded={samples}>
                Sample questions
              </button>
            )}
            <button type="button" onClick={reset} className="as-head-btn" disabled={sending}>
              Reset Chat
            </button>
          </div>
        </div>

        <div ref={list} className="flex-1 overflow-y-auto p-4 space-y-3 dark-scrollbar" aria-live="polite">
          {loading ? (
            <div className="flex items-center gap-2 text-fg/60 text-sm"><Spinner /> Loading the conversation…</div>
          ) : messages.length === 0 ? (
            <div className="text-center text-fg/60 text-sm py-10">
              {samplesShown ? <>Ask a question, or open <b>Sample questions</b>.</> : 'Ask a question to try your agent.'}
            </div>
          ) : (
            messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="as-bubble as-bubble-user">{m.content}</div>
                </div>
              ) : (
                <div key={m.id} className="flex">
                  <Reply m={m} stage={stage} onOpen={openPassage} />
                </div>
              ),
            )
          )}
        </div>

        <form
          className="flex gap-2 p-3 border-t border-magenta-brand/15 bg-card"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message…"
            aria-label="Message"
            className="flex-1 min-w-0 px-4 py-2.5 bg-canvas border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand"
          />
          <button type="submit" disabled={sending || !input.trim()} className="px-5 py-2.5 bg-purple-brand text-white rounded-lg font-medium disabled:opacity-50">
            Send
          </button>
        </form>
      </div>

      {samples && samplesShown && (
        <SampleQuestions agentId={agentId} sessionId={sessionId} disabled={sending} onClose={() => setSamples(false)} onAsk={(q) => send(q)} />
      )}
      {pdf && (
        <aside className="as-drawer as-drawer-wide" aria-label="Source document">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-magenta-brand/15">
            <h3 className="font-semibold text-fg text-sm">Passage {pdf.passage?.n}: para {pdf.passage?.label}</h3>
            <button type="button" onClick={() => setPdf(null)} className="text-fg/60 hover:text-fg" aria-label="Close the document">✕</button>
          </div>
          {pdf.passage && (
            <div className="as-pinned">
              <div className="text-xs text-fg/60 mb-1">{pdf.passage.doc_title} · {pdf.passage.page_label}{pdf.passage.context ? ` · ${pdf.passage.context}` : ''}</div>
              <p className="text-sm text-fg">{pdf.passage.text}</p>
            </div>
          )}
          <div className="flex-1 min-h-0">
            <PdfViewer target={pdf} agentId={agentId} sessionId={sessionId} />
          </div>
        </aside>
      )}
    </div>
  );
}
