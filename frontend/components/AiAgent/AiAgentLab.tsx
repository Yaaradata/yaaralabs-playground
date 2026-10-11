'use client';

/**
 * AI Agent project: a model that decides when to call tools, and a platform that decides what it may do.
 *
 * 1 Agent     name, instructions (the policy), model; how the agent loop works
 * 2 No tools  questions answered from memory only: the baseline (wrong dates, invented companies)
 * 3 Tools     server tools (built-in, reference checks, ready-made, a guarded action) with why/without/what the
 *             model sees/code; the learner's own Python tool, checked and run in this browser (Pyodide)
 * 4 Chat      the loop with a full trace: model step → tool call (args) → result → … → answer
 * 5 Test      11 prompts checked automatically (right answer, right tool, refusal), with and without tools
 *
 * The loop runs on the server (ai_agent_service.py). When the model calls the learner's own tool, the turn pauses,
 * this page runs the Python and posts the result back. Every turn and its trace is saved in Firestore.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import config from '../../lib/config';
import { useAppTheme } from '../../lib/theme';
import { callOwn, defineOwn, ensurePython, pyErr, type DefinedOwnTool } from '../Exercises/labs/exercise13/lib/ownTool';
import type {
  AgentSettings, Catalog, CatalogTool, Eval, JsonSchema, Project, Step, TestPrompt, ToolGroup, ToolStep, TraceStep, Turn,
} from './types';
import './aiAgent.css';

interface Props {
  projectName: string;
  sessionId: string;
  projectId: string;
}

class ApiError extends Error {}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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
const IcPlay = () => <Svg s={14}><path d="M7 4l13 8-13 8z" /></Svg>;
const IcShield = () => <Svg s={20}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></Svg>;
const IcPlus = () => <Svg s={14}><path d="M12 5v14M5 12h14" /></Svg>;

const STEPS: { n: Step; title: string; sub: string }[] = [
  { n: 1, title: 'Agent', sub: 'Name, policy, model' },
  { n: 2, title: 'No tools', sub: 'What memory gets wrong' },
  { n: 3, title: 'Tools', sub: 'Give it the right ones' },
  { n: 4, title: 'Chat', sub: 'Watch the agent work' },
  { n: 5, title: 'Test', sub: '10 prompts + a bonus' },
];

const GROUPS: { id: CatalogTool['group']; title: string; sub: string }[] = [
  { id: 'built-in', title: 'Built-in', sub: 'Things a model simply cannot know or do exactly on its own.' },
  { id: 'reference', title: 'Reference checks', sub: 'Facts and check digits: computed or looked up, never guessed.' },
  { id: 'ready-made', title: 'Ready-made', sub: 'For when your own Python tool can’t load. Off by default: you write this one below.' },
  { id: 'action', title: 'Actions', sub: 'Tools that change something. The dangerous kind.' },
];

const BASELINE = ['p01', 'p05', 'p04', 'p07'];
const num = (v: number) => v.toLocaleString();
const inr = (usd: number) => `₹${(usd * 88).toFixed(usd * 88 < 0.1 ? 3 : 2)}`;
const pretty = (v: unknown) => {
  if (v && typeof v === 'object' && 'json' in (v as Record<string, unknown>)) return String((v as { json: string }).json);
  return JSON.stringify(v, null, 1);
};
const argsText = (a: Record<string, unknown>) =>
  Object.entries(a || {}).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');

function Md({ text }: { text: string }) {
  const bulleted = text.replace(/^(\s*)[*-]\s+/gm, '$1• ');
  const parts = bulleted.split(/(\*\*[^*\n]+\*\*)/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;
}

function Params({ schema }: { schema: JsonSchema }) {
  const props = Object.entries(schema.properties || {});
  if (!props.length) return <span className="muted">No parameters.</span>;
  return (
    <table className="params">
      <thead><tr><th>Parameter</th><th>Type</th><th>Needed</th><th>Description the model reads</th></tr></thead>
      <tbody>
        {props.map(([k, p]) => (
          <tr key={k}>
            <td className="mono">{k}</td>
            <td>{p.type || 'string'}{p.enum ? `: ${p.enum.join(' | ')}` : ''}</td>
            <td>{(schema.required || []).includes(k) ? 'yes' : 'optional'}</td>
            <td>{p.description || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const groupBadge = (g: ToolGroup, runsOn?: string) =>
  runsOn === 'browser' || g === 'yours'
    ? <span className="badge br">Your Python · runs in your browser</span>
    : <span className="badge sv">Runs on the server</span>;

/* ───────────── Main ───────────── */

export default function AiAgentLab({ sessionId, projectId }: Props) {
  const [theme] = useAppTheme();
  const base = config.api.aiAgent.project(sessionId, projectId);

  const [project, setProject] = useState<Project | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [agent, setAgent] = useState<AgentSettings | null>(null);
  const savedRef = useRef('');
  const loadedOnce = useRef(false); // a reload (remount, dev refresh) must not move the learner back a step

  const [code, setCode] = useState('');
  const [py, setPy] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [defined, setDefined] = useState<{ tools: DefinedOwnTool[]; notes: string[] } | null>(null);
  const [tryArgs, setTryArgs] = useState('{"trade_date": "2026-10-19", "t_plus": 1}');
  const [tryOut, setTryOut] = useState<string | null>(null);
  const definedFor = useRef<string | null>(null); // which saved own-tool version is loaded into Python

  const [draft, setDraft] = useState('');
  const [baselineDraft, setBaselineDraft] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [evalOpen, setEvalOpen] = useState<Eval | null>(null);

  const apply = useCallback((p: Project, moveTo?: Step) => {
    setProject(p);
    setAgent(p.state.agent);
    if (moveTo) setStep(moveTo);
    savedRef.current = JSON.stringify({ step: moveTo ?? p.state.step, agent: p.state.agent });
  }, []);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const [p, c] = await Promise.all([api<{ data: Project }>(base), api<{ data: Catalog }>(config.api.aiAgent.catalog)]);
      apply(p.data, loadedOnce.current ? undefined : p.data.state.step);
      loadedOnce.current = true;
      setCatalog(c.data);
      setCode(p.data.ownTool?.source || c.data.starterTool);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [base, apply]);

  useEffect(() => { load(); }, [load]);

  // autosave the step and the agent's settings
  useEffect(() => {
    if (!project || !agent) return;
    const snap = JSON.stringify({ step, agent });
    if (snap === savedRef.current) return;
    const t = setTimeout(() => {
      savedRef.current = snap;
      api(`${base}/state`, { method: 'PUT', body: snap }).catch((e) => { savedRef.current = ''; setError((e as Error).message); });
    }, 600);
    return () => clearTimeout(t);
  }, [project, base, step, agent]);

  const refresh = useCallback(async () => {
    const p = await api<{ data: Project }>(base);
    setProject(p.data);
    return p.data;
  }, [base]);

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

  const serverNames = useMemo(() => (catalog?.tools || []).filter((t) => t.group !== 'ready-made').map((t) => t.name), [catalog]);

  /* ── the learner's Python ── */
  const loadPython = async () => {
    setPy('loading');
    try {
      await ensurePython();
      setPy('ready');
    } catch (e) {
      setPy('error');
      throw e;
    }
  };

  /** Load the saved own tool into Python (once per version), so the agent can call it. */
  const ensureOwnLoaded = useCallback(async (p: Project) => {
    if (!p.ownTool) throw new Error('Your tool is not saved. Add it in step 3.');
    if (definedFor.current === p.ownTool.id) return;
    setPy('loading');
    try {
      await ensurePython();
      await defineOwn(p.ownTool.source, serverNames);
      definedFor.current = p.ownTool.id;
      setPy('ready');
    } catch (e) {
      setPy('error');
      throw new Error(`Python couldn't load your tool: ${pyErr(e)}`);
    }
  }, [serverNames]);

  /** One message through the agent loop; runs browser tools whenever the turn pauses for them. */
  const runTurn = useCallback(async (body: Record<string, unknown>): Promise<Turn> => {
    let t = (await api<{ data: Turn }>(`${base}/turns`, { method: 'POST', body: JSON.stringify(body) })).data;
    while (t.status === 'waiting' && t.pending) {
      const p = project ?? (await refresh());
      await ensureOwnLoaded(p);
      const results = [];
      for (const c of t.pending.calls.filter((x) => t.pending!.browser.includes(x.id))) {
        const start = performance.now();
        try {
          const output = await callOwn(c.name, c.args);
          results.push({ callId: c.id, ok: true, output: String(output), ms: Math.round(performance.now() - start) });
        } catch (e) {
          results.push({ callId: c.id, ok: false, error: pyErr(e), ms: Math.round(performance.now() - start) });
        }
      }
      t = (await api<{ data: Turn }>(`${base}/turns/${t.id}/tool-results`, { method: 'POST', body: JSON.stringify({ results }) })).data;
    }
    return t;
  }, [base, project, refresh, ensureOwnLoaded]);

  const checkTool = () => run('Checking your tool', async () => {
    await loadPython();
    const r = await defineOwn(code, serverNames);
    definedFor.current = null; // the editor now holds a different version than the saved one
    setDefined(r);
    setTryOut(null);
  });

  const tryTool = () => run('Running your tool', async () => {
    if (!defined?.tools.length) throw new Error('Check your tool first.');
    let args: Record<string, unknown>;
    try { args = JSON.parse(tryArgs || '{}'); } catch { throw new Error('The test input must be JSON, like {"trade_date": "2026-10-19"}.'); }
    try {
      setTryOut(String(await callOwn(defined.tools[0].name, args)));
    } catch (e) {
      setTryOut(`Error: ${pyErr(e)}`);
    }
  });

  const saveTool = () => run('Adding your tool', async () => {
    if (!defined?.tools.length) throw new Error('Check your tool first.');
    const r = await api<{ data: Project }>(`${base}/own-tool`, {
      method: 'POST',
      body: JSON.stringify({ source: code, functions: defined.tools.map((t) => ({ name: t.name, desc: t.desc, schema: t.schema })), notes: defined.notes }),
    });
    apply(r.data, 3);
    definedFor.current = r.data.ownTool?.id ?? null; // the Python in this page is that version
  });

  const removeTool = () => run('Removing your tool', async () => {
    apply((await api<{ data: Project }>(`${base}/own-tool`, { method: 'DELETE' })).data, 3);
    definedFor.current = null;
  });

  const setEnabled = (names: string[]) => run('Saving', async () => {
    await api(`${base}/state`, { method: 'PUT', body: JSON.stringify({ enabled: names }) });
    await refresh();
  });
  const toggle = (name: string) => {
    if (!project) return;
    const on = project.state.tools.enabled.includes(name);
    let next = on ? project.state.tools.enabled.filter((n) => n !== name) : [...project.state.tools.enabled, name];
    // your settlement_date and the ready-made one share a name: one or the other
    if (!on && name === 'settlement_date' && project.ownTool?.functions.some((f) => f.name === name)) next = next.filter((n, i, a) => a.indexOf(n) === i);
    setEnabled(next);
  };
  const setGuard = (v: boolean) => run('Saving', async () => {
    await api(`${base}/state`, { method: 'PUT', body: JSON.stringify({ guard: { blockRiskyActions: v } }) });
    await refresh();
  });

  /* ── chat ── */
  const send = (message: string, testPromptId?: string) => {
    const m = message.trim();
    if (!m || busy) return;
    run('Agent working', async () => {
      try {
        await runTurn({ message: m, testPromptId });
        setDraft('');
      } finally {
        await refresh();
      }
    });
  };
  const askBaseline = (message: string, testPromptId?: string) => {
    if (!message.trim() || busy) return;
    run('Asking without tools', async () => {
      try {
        await runTurn({ message: message.trim(), chat: 'baseline', testPromptId });
        setBaselineDraft('');
      } finally {
        await refresh();
      }
    });
  };
  const newChat = () => run('New conversation', async () => apply((await api<{ data: Project }>(`${base}/chats`, { method: 'POST' })).data, 4));
  const openChat = (id: string) => run('Opening', async () => apply((await api<{ data: Project }>(`${base}/chats/${id}/open`, { method: 'POST' })).data, 4));
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); }
  };

  /* ── test runs ── */
  const runEval = (useTools: boolean) => run(useTools ? 'Testing with tools' : 'Testing without tools', async () => {
    if (!catalog) return;
    const ev = (await api<{ data: Eval }>(`${base}/evals`, { method: 'POST', body: JSON.stringify({ useTools }) })).data;
    const prompts = catalog.prompts;
    let done = 0;
    setProgress({ done, total: prompts.length, label: useTools ? 'with tools' : 'without tools' });
    const queue = [...prompts];
    const worker = async () => {
      while (queue.length) {
        const p = queue.shift()!;
        try {
          await runTurn({ message: p.prompt, evalId: ev.id, testPromptId: p.id, useTools });
        } catch {
          /* recorded on the turn; the run continues */
        }
        done += 1;
        setProgress({ done, total: prompts.length, label: useTools ? 'with tools' : 'without tools' });
      }
    };
    try {
      await Promise.all([worker(), worker()]);
      await api(`${base}/evals/${ev.id}/finish`, { method: 'POST' });
      setEvalOpen((await api<{ data: Eval }>(`${base}/evals/${ev.id}`)).data);
      await refresh();
    } finally {
      setProgress(null);
    }
  });
  const openEval = (ev: Eval) => run('Opening', async () => setEvalOpen((await api<{ data: Eval }>(`${base}/evals/${ev.id}`)).data));

  /* ───────────── Render ───────────── */

  if (loadState !== 'ready' || !project || !catalog || !agent) {
    return (
      <div className="agx" data-theme={theme}>
        <div className="loading">
          {loadState === 'error'
            ? <div><p>Couldn&apos;t open this project.</p><button className="btn" onClick={load}>Try again</button></div>
            : <p>Opening the agent…</p>}
        </div>
      </div>
    );
  }

  const enabled = project.state.tools.enabled;
  const promptsById: Record<string, TestPrompt> = Object.fromEntries(catalog.prompts.map((p) => [p.id, p]));
  const modelName = (id: string) => catalog.models.find((m) => m.id === id)?.name ?? id;
  const next = (n: Step, label: string, disabled = false) => (
    <button className="btn pri lg" disabled={disabled || !!busy} onClick={() => setStep(n)}>{label} <IcArrow /></button>
  );
  const back = (n: Step) => <button className="btn ghost" onClick={() => setStep(n)} disabled={!!busy}><IcBack /> Back</button>;
  const ownFns = project.ownTool?.functions ?? [];

  const traceView = (t: Turn) => (
    <ol className="trace">
      {t.steps.map((s: TraceStep, i) => s.kind === 'model' ? (
        <li key={i} className="model">
          <span className="dot" />
          <div className="what">
            <b>{s.calls.length ? `Model decided to call ${s.calls.length === 1 ? 'a tool' : `${s.calls.length} tools`}` : s.final ? 'Model answered (tool rounds used up)' : 'Model wrote the answer'}</b>
            <span className="muted">round {s.round} · {num(s.tokens.in)}→{num(s.tokens.out)} tokens · {(s.ms / 1000).toFixed(1)} s</span>
          </div>
          {s.calls.map((c) => <div key={c.id} style={{ marginTop: 4 }}><span className="call">{c.name}({argsText(c.args)})</span></div>)}
          {s.calls.length > 0 && s.text && <div style={{ marginTop: 4 }}>“{s.text}”</div>}
        </li>
      ) : (
        <li key={i} className={`tool ${(s as ToolStep).runsOn === 'browser' ? 'br' : ''} ${s.blocked ? 'blocked' : ''} ${!s.ok && !s.blocked ? 'err' : ''}`}>
          <span className="dot" />
          <div className="what">
            <b className="mono">{s.name}</b>
            {s.group === 'unknown' ? <span className="badge bad">no such tool: the model invented it</span> : groupBadge(s.group, s.runsOn)}
            {s.blocked && <span className="badge warn"><IcShield /> Blocked by the guardrail</span>}
            {!s.ok && !s.blocked && s.group !== 'unknown' && <span className="badge bad">error</span>}
            <span className="muted">{s.ms} ms</span>
          </div>
          <pre>{`input  ${argsText(s.args)}\nresult ${pretty(s.result)}`}</pre>
        </li>
      ))}
    </ol>
  );

  const turnView = (t: Turn, open: boolean) => {
    const p = t.testPromptId ? promptsById[t.testPromptId] : null;
    const called = t.toolsCalled ?? [];
    return (
      <div key={t.id} className={`turn ${t.check ? (t.check.pass ? 'pass' : 'fail') : ''}`}>
        <div className="q">
          <span style={{ flex: 1 }}>{t.message}</span>
          {p && <span className="badge">{p.bonus ? 'Bonus prompt' : `Test ${p.id.slice(1)}`}</span>}
        </div>
        {t.status === 'error' ? <div className="a err">{t.error}</div> : <div className="a"><Md text={t.answer || '…'} /></div>}
        {t.steps.length > 0 && (
          <details open={open}>
            <summary className="tfoot" style={{ cursor: 'pointer', borderTop: '1px solid var(--line)' }}>
              <b style={{ color: 'var(--tx)' }}>What the agent did</b>
              <span>{t.steps.filter((s) => s.kind === 'model').length} model steps · {called.length} tool call{called.length === 1 ? '' : 's'}{t.blocked ? ' · 1 blocked' : ''}</span>
              <span className="sp" />
              <span className="link">show / hide</span>
            </summary>
            {traceView(t)}
          </details>
        )}
        {p && t.check && (
          <div className="tfoot">
            <span className={`badge ${t.check.pass ? 'ok' : 'bad'}`}>{t.check.pass ? <IcCheck /> : <IcX />} {t.check.reason}</span>
            <span>Expected: {p.answer}</span>
          </div>
        )}
        <div className="tfoot">
          {!t.settings.useTools ? <span className="badge warn">No tools</span>
            : called.length === 0 ? (p && p.tools.length === 0 ? <span className="badge ok">No tool needed</span> : <span className="badge warn">Answered without a tool</span>)
              : called.map((n, i) => <span key={i} className="badge ac mono">{n}</span>)}
          <span className="sp" />
          <span>{t.model?.name ?? modelName(t.settings.model)}</span>
          <span className="num">{num(t.tokens.in + t.tokens.out)} tokens</span>
          <span className="num">{inr(t.costUsd)}</span>
          <span className="num">{(t.ms / 1000).toFixed(1)} s</span>
        </div>
      </div>
    );
  };

  const toolCard = (t: CatalogTool) => {
    const on = enabled.includes(t.name);
    const overridden = t.name === 'settlement_date' && ownFns.some((f) => f.name === t.name);
    return (
      <div key={t.name} className={`tool ${on && !overridden ? 'on' : ''}`}>
        <div className="hd">
          <button className={`switch ${on && !overridden ? 'on' : ''}`} onClick={() => toggle(t.name)} disabled={!!busy || overridden}
            aria-pressed={on && !overridden} aria-label={`${on ? 'Turn off' : 'Turn on'} ${t.name}`} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{t.title}</b>
            <code>{t.name}</code>
          </div>
          {groupBadge(t.group)}
        </div>
        <div className="bd">
          <span><b style={{ color: 'var(--tx)' }}>Why:</b> {t.why}</span>
          {t.without && <span className="wo">Without it: {t.without}</span>}
          {overridden && <span className="badge br">Your own settlement_date is used instead</span>}
        </div>
        <details>
          <summary>What the model sees</summary>
          <div className="seen">
            <span><b>Description:</b> {t.desc}</span>
            <Params schema={t.schema} />
          </div>
        </details>
        <details>
          <summary>Example call and result</summary>
          <pre className="code">{`${t.name}(${argsText(t.example)})\n→ ${pretty(t.exampleResult)}`}</pre>
        </details>
        <details>
          <summary>Python code</summary>
          <pre className="code">{t.source}</pre>
        </details>
      </div>
    );
  };

  const baselineTurns = project.baseline;
  const turns = project.turns;

  return (
    <div className="agx" data-theme={theme}>
      <div className="wrap">
        <div className="eyebrow">AI agent</div>
        <h1 className="h1">An agent that uses tools, and knows its limits</h1>
        <p className="lead">
          A language model guesses dates and check digits. An <b>agent</b> is a model that can call <b>tools</b>: it decides when it needs
          one, the platform runs it, and the model answers from the result. The platform also decides what the agent may <b>never</b> do.
        </p>

        <nav className="steps" aria-label="Steps">
          {STEPS.map((s) => (
            <button key={s.n} className={`stp ${step === s.n ? 'on' : ''} ${step !== s.n && s.n < step ? 'done' : ''}`}
              disabled={!!busy} onClick={() => setStep(s.n)} aria-current={step === s.n ? 'step' : undefined}>
              <span className="n">{step !== s.n && s.n < step ? <IcCheck /> : s.n}</span>
              <span><b>{s.title}</b><small>{s.sub}</small></span>
            </button>
          ))}
        </nav>

        {error && <p className="err" role="alert">{error}</p>}

        {/* ── 1 Agent ── */}
        {step === 1 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">1 · Set up the agent</h2>
                <p>The instructions are the agent&apos;s policy: what it does, what tools it must use, and what it must never do.</p>
              </div>
            </div>
            <div className="panel pad">
              <p className="sub-h">How an agent works <span>one message can go round this loop several times</span></p>
              <div className="loop">
                <div className="lp"><b>1 · You ask</b><span>“When does a 19 Oct trade settle?”</span></div>
                <div className="arrow">→</div>
                <div className="lp m"><b>2 · Model decides</b><span>Answer now, or ask for a tool: <code>settlement_date(trade_date=…)</code></span></div>
                <div className="arrow">→</div>
                <div className="lp t"><b>3 · Platform runs the tool</b><span>Real code, exact result. The model never runs anything itself.</span></div>
                <div className="arrow">→</div>
                <div className="lp m"><b>4 · Model answers</b><span>From the tool&apos;s result: “Wed 21 Oct, 20 Oct is Dussehra.”</span></div>
              </div>
            </div>
            <div className="panel pad" style={{ marginTop: 14 }}>
              <label className="label" htmlFor="ag-instr">Instructions (the policy)</label>
              <textarea id="ag-instr" className="instr" value={agent.instructions} maxLength={4000}
                onChange={(e) => setAgent({ ...agent, instructions: e.target.value })} />
              <div className="cfg">
                <label><span className="label">Agent name</span>
                  <input className="input" value={agent.name} maxLength={60} onChange={(e) => setAgent({ ...agent, name: e.target.value })} />
                </label>
                <label><span className="label">Model</span>
                  <select className="select" value={agent.model} onChange={(e) => setAgent({ ...agent, model: e.target.value })}>
                    {catalog.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label><span className="label">Temperature</span>
                  <select className="select" value={agent.temperature} onChange={(e) => setAgent({ ...agent, temperature: Number(e.target.value) })}>
                    {[0, 0.2, 0.7, 1].map((v) => <option key={v} value={v}>{v}{v === 0.2 ? ' · default' : ''}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn sm" onClick={() => setAgent({ ...agent, instructions: catalog.defaultInstructions })} disabled={agent.instructions === catalog.defaultInstructions}>Reset to the suggested instructions</button>
                <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Saved automatically.</span>
              </div>
            </div>
            <div className="foot">{next(2, 'Next: try it without tools')}</div>
          </section>
        )}

        {/* ── 2 No tools ── */}
        {step === 2 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">2 · Without tools: the model answers from memory</h2>
                <p>Ask questions that need a calendar, a check digit or a lookup. Compare what the model says with the right answer. Keep these: step 5 asks the same questions with tools.</p>
              </div>
            </div>
            <div className="panel composer">
              <div className="chips" style={{ marginTop: 0 }}>
                <span className="muted" style={{ fontSize: 12 }}>Ask:</span>
                {BASELINE.map((id) => promptsById[id]).filter(Boolean).map((p) => (
                  <button key={p.id} className="chip" disabled={!!busy} onClick={() => askBaseline(p.prompt, p.id)}>{p.prompt}</button>
                ))}
              </div>
              <div className="row">
                <input className="input" style={{ flex: 1 }} value={baselineDraft} onChange={(e) => setBaselineDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && askBaseline(baselineDraft)} placeholder="Or type your own question" maxLength={2000} />
                <button className="btn pri" onClick={() => askBaseline(baselineDraft)} disabled={!baselineDraft.trim() || !!busy}><IcSend /> Ask without tools</button>
              </div>
            </div>
            <div className="stack" style={{ marginTop: 14 }}>
              {busy === 'Asking without tools' && <div className="panel typing"><div className="track"><i /></div>The model is answering from memory…</div>}
              {baselineTurns.slice().reverse().map((t) => {
                const p = t.testPromptId ? promptsById[t.testPromptId] : null;
                return (
                  <div className="qa" key={t.id}>
                    <div className="q">{t.message}{t.check && <span className={`badge ${t.check.answerOk ? 'warn' : 'bad'}`}>{t.check.answerOk ? 'Right, but a guess' : 'Wrong'}</span>}</div>
                    <div className="cols">
                      <div className="col"><small>Model, no tools</small>{t.status === 'error' ? <span className="fail">{t.error}</span> : <Md text={t.answer} />}</div>
                      <div className="col"><small>Right answer</small>{p ? p.answer : <span className="muted">(your own question: check it yourself)</span>}</div>
                    </div>
                  </div>
                );
              })}
              {baselineTurns.length === 0 && busy !== 'Asking without tools' && <div className="panel empty">Click a question above.</div>}
            </div>
            <div className="note" style={{ marginTop: 14 }}>
              <IcInfo />
              <span>Look for <b>confident wrong answers</b>: a weekday that is a holiday, an ISIN “belonging” to the wrong company, a code called valid without any check. The model isn&apos;t lying: it has no calendar, no list and no way to compute a check digit.</span>
            </div>
            <div className="foot">{back(1)}{next(3, 'Next: give it tools')}</div>
          </section>
        )}

        {/* ── 3 Tools ── */}
        {step === 3 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">3 · Give the agent tools</h2>
                <p>
                  A tool is a function the platform runs for the model. The model only ever sees its <b>name, description and parameters</b>: from
                  those it decides when to call it. Turn on what this desk needs, then write your own.
                </p>
              </div>
              <span className="sp" />
              <span className="badge ac">{enabled.length} of {catalog.limits.maxTools} tools on</span>
              <button className="btn sm" disabled={!!busy} onClick={() => setEnabled(Array.from(new Set([...catalog.recommended, ...ownFns.map((f) => f.name)])))}>Turn on the recommended set</button>
            </div>

            {GROUPS.map((g) => (
              <div key={g.id}>
                <div className="group-h"><h3>{g.title}</h3><span>{g.sub}</span></div>
                <div className="tools">{catalog.tools.filter((t) => t.group === g.id).map(toolCard)}</div>
                {g.id === 'action' && (
                  <div className="guard">
                    <IcShield />
                    <div style={{ flex: 1 }}>
                      <b>Guardrail: block risky actions</b>
                      <p>
                        Instructions ask the model not to change bank details, but a model can be talked round. This switch is enforced by the
                        platform: even if the agent calls <code>request_ssi_change</code>, the call is blocked and logged. Turn it off only to see why it exists (sandbox: nothing real changes).
                      </p>
                    </div>
                    <button className={`switch ${project.state.guard.blockRiskyActions ? 'on' : ''}`} disabled={!!busy}
                      onClick={() => setGuard(!project.state.guard.blockRiskyActions)} aria-pressed={project.state.guard.blockRiskyActions} aria-label="Block risky actions" />
                  </div>
                )}
              </div>
            ))}

            <div className="group-h"><h3>Your tool</h3><span>Python you write, checked and run in this browser. It never runs on the server.</span></div>
            <div className="yours">
              <div className="bar">
                <b style={{ fontSize: 14.5 }}>settlement_date: write it, check it, add it</b>
                <span className="sp" />
                {py === 'loading' && <span className="badge">Loading Python…</span>}
                {py === 'error' && <span className="badge bad">Python couldn&apos;t load (cdn.jsdelivr.net blocked?). Use the ready-made tool.</span>}
                {project.ownTool && <span className="badge ok"><IcCheck /> Added to the agent: {ownFns.map((f) => f.name).join(', ')}</span>}
              </div>
              <textarea className="editor" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Your Python tool" />
              <div className="bar">
                <button className="btn" onClick={checkTool} disabled={!!busy}>{busy === 'Checking your tool' ? 'Checking…' : '1 · Check my tool'}</button>
                <input className="input mono" style={{ flex: '1 1 260px', fontSize: 12.5 }} value={tryArgs} onChange={(e) => setTryArgs(e.target.value)} aria-label="Test input (JSON)" />
                <button className="btn" onClick={tryTool} disabled={!!busy || !defined?.tools.length}>2 · Test it</button>
                <button className="btn pri" onClick={saveTool} disabled={!!busy || !defined?.tools.length}><IcPlus /> 3 · Add to the agent</button>
                {project.ownTool && <button className="btn ghost sm" onClick={removeTool} disabled={!!busy}>Remove</button>}
                <button className="btn ghost sm" onClick={() => { setCode(catalog.starterTool); setDefined(null); }} disabled={!!busy}>Reset code</button>
              </div>
              {tryOut !== null && <pre className="code" style={{ borderTop: '1px solid var(--line)' }}>{tryOut}</pre>}
              {defined && (
                <div className="found">
                  <span className="sub-h" style={{ margin: 0 }}>What the model will see <span>built from your function name, type hints and docstring</span></span>
                  {defined.tools.map((f) => (
                    <div className="fn" key={f.name}>
                      <b>{f.name}</b> <span className="muted">{f.desc || '(no description: write a docstring)'}</span>
                      <Params schema={f.schema as JsonSchema} />
                    </div>
                  ))}
                  {defined.notes.map((n) => <div key={n} className="notice"><IcInfo /><span>{n}</span></div>)}
                </div>
              )}
            </div>

            <details className="panel" style={{ marginTop: 14 }}>
              <summary className="rows-h" style={{ cursor: 'pointer' }}>
                <h3>NSE 2026 holidays: trading vs settlement</h3>
                <span className="muted">{catalog.holidays.trading.length} trading holidays · {catalog.holidays.settlement.length} settlement holidays · {catalog.holidays.settlementOnly.length} differ</span>
              </summary>
              <div className="pad">
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--tx2)' }}>{catalog.holidays.note} Source: NSE holiday master.</p>
                <table className="hol">
                  <thead><tr><th>Date</th><th>Day</th><th>Trading</th><th>Settlement</th></tr></thead>
                  <tbody>
                    {Array.from(new Set([...catalog.holidays.trading, ...catalog.holidays.settlement].map((h) => h.date))).sort().map((d) => {
                      const tr = catalog.holidays.trading.find((h) => h.date === d);
                      const se = catalog.holidays.settlement.find((h) => h.date === d);
                      return (
                        <tr key={d} className={!tr ? 'diff' : ''}>
                          <td className="mono">{d}</td><td>{(tr || se)?.day}</td>
                          <td>{tr ? tr.name : <span className="badge ok">open</span>}</td>
                          <td>{se ? se.name : <span className="badge ok">settles</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
            <div className="foot">{back(2)}{next(4, 'Next: chat with the agent', enabled.length === 0)}</div>
          </section>
        )}

        {/* ── 4 Chat ── */}
        {step === 4 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">4 · Chat, and watch what the agent does</h2>
                <p>Under every answer: each decision the model made, every tool it called with the exact inputs, what came back, and where it ran.</p>
              </div>
            </div>
            <div className="chat-grid">
              <div>
                <div className="panel composer">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} maxLength={2000}
                    placeholder="Ask the settlement assistant and press Enter" aria-label="Your message" />
                  <div className="row">
                    <span className="muted">Enter to send · the agent remembers this conversation</span>
                    <button className="btn pri" onClick={() => send(draft)} disabled={!draft.trim() || !!busy}><IcSend /> Send</button>
                  </div>
                  <div className="chips">
                    <span className="muted" style={{ fontSize: 12 }}>Test prompts:</span>
                    {catalog.prompts.map((p) => (
                      <button key={p.id} className="chip" disabled={!!busy} onClick={() => send(p.prompt, p.id)} title={p.tests}>
                        {p.id === 'p10' ? '⚠ ' : p.bonus ? '★ ' : ''}{p.prompt}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="thread">
                  {busy === 'Agent working' && <div className="panel typing"><div className="track"><i /></div>{py === 'loading' ? 'Running your Python tool in this browser…' : 'The agent is working: deciding, calling tools, reading results…'}</div>}
                  {turns.slice().reverse().map((t, i) => turnView(t, i === 0))}
                  {turns.length === 0 && busy !== 'Agent working' && <div className="panel empty">No messages yet. Click a test prompt or type your own.</div>}
                </div>
              </div>
              <aside className="side">
                <div className="panel">
                  <span className="label">Agent</span>
                  <b>{agent.name}</b> <span className="muted">· {modelName(agent.model)}</span>
                  <span className="label" style={{ marginTop: 12 }}>Tools it can call ({project.tools.length})</span>
                  <div className="toolist">
                    {project.tools.map((t) => <span key={t.name} className={`badge ${t.runsOn === 'browser' ? 'br' : 'sv'} mono`}>{t.name}</span>)}
                    {project.tools.length === 0 && <span className="muted">None: turn some on in step 3.</span>}
                  </div>
                  <span className="label" style={{ marginTop: 12 }}>Guardrail</span>
                  {project.state.guard.blockRiskyActions ? <span className="badge ok"><IcShield /> Risky actions blocked</span> : <span className="badge bad">Off: actions run (sandbox)</span>}
                </div>
                <div className="panel">
                  <span className="label">Conversations</span>
                  <button className="btn sm" style={{ width: '100%', marginBottom: 8 }} onClick={newChat} disabled={!!busy}><IcPlus /> New conversation</button>
                  {project.chats.slice().reverse().map((c) => (
                    <button key={c.id} className="chip" style={{ display: 'block', width: '100%', marginTop: 4, borderStyle: c.id === project.state.chatId ? 'solid' : 'dashed' }}
                      onClick={() => openChat(c.id)} disabled={!!busy || c.id === project.state.chatId}>
                      {c.title || 'New conversation'} <span className="muted">· {c.turns}</span>
                    </button>
                  ))}
                </div>
                <div className="note">
                  <IcInfo />
                  <span><b>Purple</b> tools are your Python, run in this browser; <b>blue</b> ones run on the server. The model never runs code: it asks, the platform runs.</span>
                </div>
              </aside>
            </div>
            <div className="foot">{back(3)}{next(5, 'Next: run the test prompts')}</div>
          </section>
        )}

        {/* ── 5 Test ── */}
        {step === 5 && (
          <section>
            <div className="sec-h">
              <div>
                <h2 className="h2">5 · Test: 10 prompts and a bonus</h2>
                <p>Each prompt has a known right answer and the tool that should give it. A pass needs both: the right answer <b>and</b> the tool called (a right answer without the tool is a lucky guess). Prompt 10 passes only if the agent refuses.</p>
              </div>
            </div>
            <div className="panel pad">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <span className="label">Current agent</span>
                  <b>{modelName(agent.model)}</b> <span className="muted">· {project.tools.length} tools · guardrail {project.state.guard.blockRiskyActions ? 'on' : 'off'}{project.ownTool ? ' · your Python tool' : ''}</span>
                </div>
                <button className="btn" onClick={() => runEval(false)} disabled={!!busy}>Run without tools</button>
                <button className="btn pri" onClick={() => runEval(true)} disabled={!!busy || project.tools.length === 0}><IcPlay /> Run with tools</button>
              </div>
              {progress && (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
                  <div className="track det"><i style={{ ['--w' as string]: `${(progress.done / progress.total) * 100}%` }} /></div>
                  <span className="muted">{progress.done} of {progress.total} prompts {progress.label}{py === 'loading' ? ' · loading Python for your tool' : ''}</span>
                </div>
              )}
            </div>

            {evalOpen?.summary && (
              <>
                <div className="scores">
                  <div className="stat"><small>Passed</small><b className="num">{evalOpen.summary.passed} / {evalOpen.summary.total}</b><span>right answer and right tool</span></div>
                  <div className="stat"><small>Right answers</small><b className="num">{evalOpen.summary.answersRight} / {evalOpen.summary.total}</b><span>with or without a tool</span></div>
                  <div className="stat"><small>Refused the SSI change</small><b className="num">{evalOpen.summary.refused ? 'Yes' : 'No'}</b><span>prompt 10</span></div>
                  <div className="stat"><small>Bonus</small><b className="num">{evalOpen.summary.bonusPassed} / {evalOpen.summary.bonusTotal}</b><span>{evalOpen.settings.useTools ? 'with tools' : 'no tools'} · {evalOpen.summary.toolCalls} tool calls · {inr(evalOpen.summary.costUsd)} · {evalOpen.summary.seconds} s</span></div>
                </div>
                <div className="panel">
                  <div className="scroll">
                    <table className="t">
                      <thead><tr><th>#</th><th>Prompt</th><th>Right answer</th><th>Tool it needs</th><th>Agent called</th><th>Agent answered</th><th>Result</th></tr></thead>
                      <tbody>
                        {evalOpen.results.map((r) => {
                          const p = promptsById[r.promptId];
                          const t = evalOpen.turns?.find((x) => x.id === r.turnId);
                          return (
                            <tr key={r.promptId}>
                              <td className="mono">{p?.bonus ? '★' : r.promptId.slice(1)}</td>
                              <td className="q">{p?.prompt}<br /><span className="muted" style={{ fontSize: 12 }}>{p?.tests}</span></td>
                              <td>{p?.answer}</td>
                              <td className="mono">{p?.tools.length ? p.tools.join(p.toolsAny ? ' or ' : ' + ') : 'none: refuse'}</td>
                              <td className="mono">{r.called.length ? r.called.join(', ') : <span className="muted">none</span>}{r.blocked && <><br /><span className="badge warn">blocked</span></>}</td>
                              <td className="a">{t ? (t.status === 'error' ? <span className="fail">{t.error}</span> : <Md text={t.answer} />) : <span className="muted">—</span>}</td>
                              <td><span className={r.pass ? 'pass' : 'fail'}>{r.pass ? 'Pass' : 'Fail'}</span><br /><span className="muted" style={{ fontSize: 12 }}>{r.reason}</span></td>
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
              <div className="panel" style={{ marginTop: 16 }}>
                <div className="rows-h"><h3>Compare runs</h3><span className="muted">click a run to open it</span></div>
                <div className="scroll">
                  <table className="t">
                    <thead><tr><th>Run</th><th>Tools</th><th>Model</th><th>Passed</th><th>Right answers</th><th>Refused SSI</th><th>Bonus</th><th>Cost</th></tr></thead>
                    <tbody>
                      {project.evals.slice().reverse().map((ev, i) => ev.summary && (
                        <tr key={ev.id} className={`click ${evalOpen?.id === ev.id ? 'on' : ''}`} onClick={() => !busy && openEval(ev)}>
                          <td className="mono">{project.evals.length - i}</td>
                          <td>{ev.settings.useTools ? `${ev.settings.tools.length} tools${ev.settings.ownTool ? ' incl. yours' : ''}` : 'none'}{!ev.settings.blockRiskyActions && ' · guardrail off'}</td>
                          <td>{modelName(ev.settings.model)}</td>
                          <td className="num"><b>{ev.summary.passed} / {ev.summary.total}</b></td>
                          <td className="num">{ev.summary.answersRight} / {ev.summary.total}</td>
                          <td>{ev.summary.refused ? 'yes' : 'no'}</td>
                          <td className="num">{ev.summary.bonusPassed} / {ev.summary.bonusTotal}</td>
                          <td className="num">{inr(ev.summary.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {!evalOpen && project.evals.length === 0 && !progress && <div className="panel empty" style={{ marginTop: 14 }}>No test runs yet. Run without tools first, then with tools, and compare.</div>}
            <div className="note" style={{ marginTop: 14 }}>
              <IcInfo />
              <span><b>Compare models.</b> Switch the model in step 1 to Gemini 2.5 Flash-Lite and run again. It is cheaper, but it more often
                answers without calling the tool, and those answers are guesses. Choosing the model is part of building an agent.</span>
            </div>
            <div className="note" style={{ marginTop: 10 }}>
              <IcInfo />
              <span><b>The bonus prompt</b> (★) is a trade on 25 Aug 2026. Your settlement_date uses <b>trading</b> holidays, so it says 26 Aug. But 26 Aug is a <b>settlement</b> holiday: the money moves on 27 Aug. A tool is only as good as its data. Add <code>nse_calendar</code> or switch to the ready-made tool and run again.</span>
            </div>
            <div className="foot">{back(4)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
