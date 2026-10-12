'use client';

/**
 * Rules Bot: the board for Rule Based Process projects.
 *
 * Build   IF the message contains <keyword> THEN route to <team>, plus an "Otherwise" reply.
 * Run     Freezes the current rules into a bot and opens the test panel.
 * Test    Type a message, press Route: shows the team, the rule that fired and the keywords hit.
 *
 * Rules and reply autosave to the backend (rules_bot_boards); samples come from
 * rules_bot_samples. Routing runs here in the browser, so results are instant.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import config from '../../lib/config';
import { useAppTheme } from '../../lib/theme';
import {
  DEFAULT_REPLY,
  MAX_KEYWORDS,
  MAX_RULES,
  PALETTE,
  activeRules,
  fingerprint,
  markKeywords,
  newRuleId,
  runRules,
  type NumberedRule,
  type RouteResult,
  type Rule,
} from './engine';
import './rulesBot.css';

interface Sample {
  id: string;
  name: string;
  summary: string;
}

interface BoardData {
  rules: Rule[];
  reply: string;
  sampleId: string | null;
}

interface Bot {
  rules: NumberedRule[];
  reply: string;
  fp: string;
}

/** A tested message, kept exactly as the bot answered it: later rule changes never rewrite it. */
interface MessageEntry {
  kind: 'message';
  key: string;
  text: string;
  result: RouteResult | null;
  reply: string;
  rules: NumberedRule[]; // the rules it was routed with (for highlighting)
}

/** Marks where the bot was run again with changed rules. */
interface RunMark {
  kind: 'run';
  key: string;
  run: number;
  rules: number;
}

type LogEntry = MessageEntry | RunMark;

type SaveState = 'saved' | 'saving' | 'error';

interface RulesBotProps {
  projectName: string;
  sessionId: string;
  projectId: string;
}

const cssVar = (c: string) => ({ '--c': c }) as CSSProperties;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = await res.json();
  return body.data as T;
}

/* ───────────── Icons ───────────── */

const Svg = ({ children, s = 16 }: { children: ReactNode; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const IcX = () => <Svg s={12}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcTrash = () => <Svg s={14}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>;
const IcPlus = () => <Svg s={16}><path d="M12 5v14M5 12h14" /></Svg>;
const IcPlay = () => <Svg s={14}><path d="M7 4l13 8-13 8z" /></Svg>;
const IcSend = () => <Svg s={14}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></Svg>;
const IcInfo = () => <Svg s={14}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>;
const IcArrowR = () => <Svg s={14}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
const IcClose = () => <Svg s={16}><path d="M18 6L6 18M6 6l12 12" /></Svg>;
const IcChevron = () => <Svg s={14}><path d="M6 9l6 6 6-6" /></Svg>;
const IcCheck = () => <Svg s={14}><path d="M20 6L9 17l-5-5" /></Svg>;
const IcRules = () => <Svg s={22}><path d="M4 6h10" /><path d="M4 12h6" /><path d="M4 18h10" /><path d="M14 12h6" /><path d="M17 9l3 3-3 3" /></Svg>;

/* ───────────── Rule card ───────────── */

interface RuleCardProps {
  rule: Rule;
  no: number;
  fired: boolean;
  hitKeywords: string[];
  autoFocus: boolean;
  onChange: (patch: Partial<Rule>) => void;
  onDelete: () => void;
}

function RuleCard({ rule, no, fired, hitKeywords, autoFocus, onChange, onDelete }: RuleCardProps) {
  const [draft, setDraft] = useState('');
  const deskRef = useRef<HTMLInputElement>(null);
  const kwRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    deskRef.current?.focus({ preventScroll: true });
    deskRef.current?.closest('.rule')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [autoFocus]);

  const addKeywords = (raw: string) => {
    const have = new Set(rule.keywords.map((k) => k.toLowerCase()));
    const fresh: string[] = [];
    for (const s of raw.split(',').map((x) => x.trim().slice(0, 60))) {
      if (s && !have.has(s.toLowerCase())) {
        have.add(s.toLowerCase());
        fresh.push(s);
      }
    }
    const room = MAX_KEYWORDS - rule.keywords.length;
    if (fresh.length && room > 0) onChange({ keywords: [...rule.keywords, ...fresh.slice(0, room)] });
    setDraft('');
  };
  const full = rule.keywords.length >= MAX_KEYWORDS;
  const noTeam = !rule.desk.trim(); // keywords come after the team: a rule needs to know where it routes

  return (
    <div className={`rule${fired ? ' fired' : ''}${rule.keywords.length ? '' : ' idle'}`} style={cssVar(rule.color)}>
      <div className="rule-h">
        <span className="rule-no">RULE {no}</span>
        {fired && <span className="fired-tag">Fired</span>}
        {(noTeam || rule.keywords.length === 0) && (
          <span className="todo-tag">{noTeam && rule.keywords.length === 0 ? 'Needs a team and keywords' : noTeam ? 'Needs a team' : 'Needs a keyword'}</span>
        )}
        <span className="spacer" />
        <button className="mini" onClick={onDelete} aria-label={`Delete rule ${no}`} title="Delete rule"><IcTrash /></button>
      </div>

      <div className="kw-label"><span className="kw">IF</span>message contains</div>
      <div className="chips">
        {rule.keywords.length === 0 && <span className="hint">{noTeam ? 'Name the team first (THEN route to), then add keywords' : 'Add keywords below'}</span>}
        {rule.keywords.map((k) => (
          <span key={k} className={`chip${hitKeywords.includes(k) ? ' hit' : ''}`}>
            {k}
            <button onClick={() => onChange({ keywords: rule.keywords.filter((x) => x !== k) })} aria-label={`Remove ${k}`}><IcX /></button>
          </span>
        ))}
      </div>
      <form className="kw-in" onSubmit={(e) => { e.preventDefault(); addKeywords(draft); }}>
        <input
          ref={kwRef}
          value={draft}
          maxLength={60}
          disabled={full || noTeam}
          onChange={(e) => (e.target.value.endsWith(',') ? addKeywords(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Backspace' && !draft && rule.keywords.length) onChange({ keywords: rule.keywords.slice(0, -1) }); }}
          placeholder={noTeam ? 'Enter the team name below first' : full ? `Up to ${MAX_KEYWORDS} keywords` : 'Add keyword, press Enter'}
          aria-label={`Add keyword to rule ${no}`}
        />
        <button type="submit" disabled={!draft.trim() || full || noTeam} aria-label="Add keyword"><IcPlus /></button>
      </form>

      <div className="then-row">
        <span className="kw-label"><span className="kw then">THEN</span>route to</span>
        <label className="desk">
          <span className="dot" />
          <input
            ref={deskRef}
            value={rule.desk}
            maxLength={60}
            onChange={(e) => onChange({ desk: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); kwRef.current?.focus(); } }}
            placeholder="Team name"
            aria-label={`Team for rule ${no}`}
          />
        </label>
      </div>
    </div>
  );
}

/* ───────────── Samples menu ───────────── */

interface SamplesMenuProps {
  samples: Sample[] | null;
  samplesError: boolean;
  currentId: string | null;
  onPick: (s: Sample) => void;
  size?: string;
  align?: 'right' | 'center';
}

function SamplesMenu({ samples, samplesError, currentId, onPick, size = '', align = 'right' }: SamplesMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="dd" ref={ref}>
      <button className={`btn ${size}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Sample <IcChevron />
      </button>
      {open && (
        <div className={`dd-menu${align === 'center' ? ' center' : ''}`} role="menu">
          <div className="dd-h">Load a sample</div>
          {samplesError && <div className="dd-msg">Couldn&apos;t load samples. Try again in a moment.</div>}
          {!samplesError && samples === null && <div className="dd-msg">Loading…</div>}
          {!samplesError && samples?.length === 0 && <div className="dd-msg">No samples yet.</div>}
          {samples?.map((s) => (
            <button key={s.id} role="menuitem" className="dd-item" onClick={() => { onPick(s); setOpen(false); }}>
              <span className="dd-ic">{initials(s.name)}</span>
              <span className="dd-txt"><b>{s.name}</b><small>{s.summary}</small></span>
              {currentId === s.id && <span className="tick"><IcCheck /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── Main ───────────── */

export default function RulesBot({ projectName, sessionId, projectId }: RulesBotProps) {
  // Follows the app-wide theme (the toggle is in the site header)
  const [theme] = useAppTheme();

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [samplesError, setSamplesError] = useState(false);

  const [rules, setRules] = useState<Rule[]>([]);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [reply, setReply] = useState(DEFAULT_REPLY);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [busy, setBusy] = useState(false);

  const [bot, setBot] = useState<Bot | null>(null);
  const [runNo, setRunNo] = useState(0);
  const [message, setMessage] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // What the server last confirmed; autosave skips when the board matches it
  const savedRef = useRef<string>('');
  const boardPath = config.api.rulesBot.board(sessionId, projectId);
  const snapshot = (d: BoardData) => JSON.stringify(d);

  const applyBoard = useCallback((d: BoardData) => {
    setRules(d.rules);
    setReply(d.reply);
    setSampleId(d.sampleId);
    savedRef.current = snapshot({ rules: d.rules, reply: d.reply, sampleId: d.sampleId });
    setSaveState('saved');
  }, []);

  const loadBoard = useCallback(async () => {
    setLoadState('loading');
    try {
      applyBoard(await api<BoardData>(boardPath));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [applyBoard, boardPath]);

  useEffect(() => {
    if (!sessionId || !projectId) return;
    loadBoard();
    api<Sample[]>(config.api.rulesBot.samples)
      .then((s) => setSamples(s))
      .catch(() => setSamplesError(true));
  }, [sessionId, projectId, loadBoard]);

  // Autosave edits (debounced)
  useEffect(() => {
    if (loadState !== 'ready') return;
    const current = snapshot({ rules, reply, sampleId });
    if (current === savedRef.current) return;
    setSaveState('saving');
    const t = setTimeout(async () => {
      try {
        await api<BoardData>(boardPath, { method: 'PUT', body: current });
        savedRef.current = current;
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [rules, reply, sampleId, loadState, boardPath]);

  // Leaving within the debounce window: send the last edit anyway
  const pendingRef = useRef<string | null>(null);
  useEffect(() => {
    const current = snapshot({ rules, reply, sampleId });
    pendingRef.current = loadState === 'ready' && current !== savedRef.current ? current : null;
  });
  useEffect(() => {
    const flush = () => {
      if (!pendingRef.current) return;
      fetch(`${config.apiBaseUrl}${boardPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: pendingRef.current,
        keepalive: true,
      }).catch(() => {});
      pendingRef.current = null;
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [boardPath]);

  const live = !!bot;
  const active = activeRules(rules);
  const keywordCount = rules.reduce((n, r) => n + r.keywords.length, 0);
  // Every rule box on the board must be finished (a team and at least one keyword) before the bot can run
  const unfinished = rules.map((r, i) => ({ r, no: i + 1 })).filter(({ r }) => !r.desk.trim() || !r.keywords.length);
  const canRun = rules.length > 0 && unfinished.length === 0;
  const stale = live && (fingerprint(active, reply) !== bot.fp || unfinished.length > 0);
  const latestMsg = log.find((x): x is MessageEntry => x.kind === 'message');
  const latest = latestMsg?.result;
  const messages = log.filter((x) => x.kind === 'message').length;
  const sample = samples?.find((s) => s.id === sampleId) || null;

  const patch = (id: string, p: Partial<Rule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const addRule = () => {
    if (rules.length >= MAX_RULES) return;
    const used = new Set(rules.map((r) => r.color));
    const color = PALETTE.find((p) => !used.has(p)) || PALETTE[rules.length % PALETTE.length];
    const id = newRuleId();
    setRules((rs) => [...rs, { id, desk: '', color, keywords: [] }]);
    setFocusId(id);
  };

  // Run freezes the rules into the bot. Earlier messages keep the answer they got: running again with changed
  // rules adds a marker to the history instead of re-routing old messages.
  const run = () => {
    const frozen = active.map((r) => ({ ...r, keywords: [...r.keywords] }));
    const next = runNo + 1;
    setBot({ rules: frozen, reply, fp: fingerprint(frozen, reply) });
    setRunNo(next);
    if (messages > 0) setLog((l) => [{ kind: 'run', key: `run-${next}`, run: next, rules: frozen.length }, ...l]);
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 300);
  };
  const stop = () => { setBot(null); setLog([]); setRunNo(0); };

  const loadSample = async (s: Sample) => {
    setBusy(true);
    try {
      stop();
      applyBoard(await api<BoardData>(config.api.rulesBot.loadSample(sessionId, projectId), {
        method: 'POST',
        body: JSON.stringify({ sampleId: s.id }),
      }));
    } catch {
      setSaveState('error');
    } finally {
      setBusy(false);
    }
  };
  const resetBoard = async () => {
    setBusy(true);
    try {
      stop();
      applyBoard(await api<BoardData>(config.api.rulesBot.resetBoard(sessionId, projectId), { method: 'POST' }));
    } catch {
      setSaveState('error');
    } finally {
      setBusy(false);
    }
  };

  const hasRules = rules.length > 0;
  useEffect(() => { if (!hasRules && bot) stop(); }, [hasRules, bot]);

  const send = () => {
    const text = message.trim();
    if (!text || !bot || stale) return; // the bot only answers with the rules it was last run with, once they match the board
    setLog((l) => [{ kind: 'message', key: `${Date.now()}-${l.length}`, text, result: runRules(text, bot.rules), reply: bot.reply, rules: bot.rules }, ...l]);
    setMessage('');
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Highlight the rule that fired for the latest message (only while the bot matches the board)
  const firedId = live && !stale ? latest?.id : null;
  const firedHits = firedId && latest ? latest.hits : [];
  const otherwiseFired = live && !stale && !!latestMsg && !latest;

  if (loadState !== 'ready') {
    return (
      <div className="rbot" data-theme={theme}>
        <div className="status">
          {loadState === 'loading' ? (
            <p>Loading your rules…</p>
          ) : (
            <div>
              <p>Couldn&apos;t load this project&apos;s rules.</p>
              <button className="btn primary lg" onClick={loadBoard}>Try again</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rbot" data-theme={theme}>
      <div className={`shell ${live ? 'live' : 'build'}`}>
        {/* ── RULE BOARD ── */}
        <main className="board">
          <div className="bhead">
            <div className="bhead-t">
              <div className="title-row">
                <h1 className="h1">{projectName || 'Message router'}</h1>
                {sample && <span className="sample-tag">Sample · {sample.name}</span>}
              </div>
            </div>
            <div className="bhead-a">
              {hasRules && (
                <>
                  <button className="btn accent" onClick={addRule} disabled={rules.length >= MAX_RULES} title={rules.length >= MAX_RULES ? `Up to ${MAX_RULES} rules` : undefined}><IcPlus /> Add rule</button>
                  <SamplesMenu samples={samples} samplesError={samplesError} currentId={sampleId} onPick={loadSample} />
                  <button className="btn quiet" onClick={resetBoard} disabled={busy}>Reset</button>
                </>
              )}
            </div>
          </div>

          {!hasRules ? (
            <div className="empty-board">
              <div className="empty-icon"><IcRules /></div>
              <h2>No rules yet</h2>
              <p>A rule routes a message to a team when the message contains one of its keywords. Start your own, or load a sample.</p>
              <div className="sample" aria-hidden="true">
                <span className="kw-label"><span className="kw">IF</span>message contains</span>
                <span className="chip">invoice</span>
                <span className="arrow"><IcArrowR /></span>
                <span className="kw-label"><span className="kw then">THEN</span>route to</span>
                <span className="route" style={cssVar(PALETTE[0])}><span className="dot" />Billing</span>
              </div>
              <div className="empty-actions">
                <button className="btn primary lg" onClick={addRule}><IcPlus /> Add rule</button>
                <SamplesMenu samples={samples} samplesError={samplesError} currentId={sampleId} onPick={loadSample} size="lg" align="center" />
              </div>
            </div>
          ) : (
            <div className="rules">
              {rules.map((r, i) => (
                <RuleCard
                  key={r.id}
                  rule={r}
                  no={i + 1}
                  fired={r.id === firedId}
                  hitKeywords={r.id === firedId ? firedHits : []}
                  autoFocus={r.id === focusId}
                  onChange={(p) => patch(r.id, p)}
                  onDelete={() => setRules((rs) => rs.filter((x) => x.id !== r.id))}
                />
              ))}
            </div>
          )}

          {hasRules && (
            <div className="runbar">
              <div className={`otherwise${otherwiseFired ? ' fired' : ''}`}>
                <span className="kw-label"><span className="kw else">OTHERWISE</span>reply</span>
                <input value={reply} maxLength={300} onChange={(e) => setReply(e.target.value)} aria-label="Reply when no rule matches" />
              </div>
              <div className="run-actions">
                <span className="vline" />
                <span className="meta"><b>{active.length}</b> of {rules.length} rules ready · <b>{keywordCount}</b> keywords</span>
                {saveState === 'error' && <span className="save-state err" aria-live="polite">Couldn’t save your changes</span>}
                {unfinished.length > 0 && (
                  <span className="state stale" role="status">
                    Finish {unfinished.length === 1 ? `rule ${unfinished[0].no}` : `rules ${unfinished.map((u) => u.no).join(', ')}`} or delete {unfinished.length === 1 ? 'it' : 'them'} to run
                  </span>
                )}
                {live && !stale && <span className="state on"><i />Bot is running</span>}
                {stale && unfinished.length === 0 && <span className="state stale">Rules changed</span>}
                {live && <button className="btn" onClick={stop}>Stop</button>}
                {(!live || stale) && (
                  <button className="btn primary lg" onClick={run} disabled={!canRun}
                    title={canRun ? undefined : 'Every rule needs a team name and at least one keyword'}>
                    <IcPlay /> {live ? 'Run again' : 'Run'}
                  </button>
                )}
              </div>
            </div>
          )}
        </main>

        {/* ── TEST PANEL (after Run) ── */}
        {live && bot && (
          <aside className="test" aria-label="Test the bot">
            <div className="test-h">
              <div>
                <h2>Test the bot</h2>
                <p>{bot.rules.length} rules · first match fires</p>
              </div>
              <span className="spacer" />
              {stale && <span className="state stale">Rules changed · Run again</span>}
              <button className="mini" onClick={stop} aria-label="Close test panel" title="Stop"><IcClose /></button>
            </div>

            <div className="feed" ref={feedRef} aria-live="polite">
              {log.length === 0 && (
                <div className="empty">
                  <b>Send a message</b>
                  Type a message below to see which rule routes it.
                </div>
              )}
              {log.map((x) => x.kind === 'run' ? (
                <div key={x.key} className="run-mark"><span>Rules updated · run {x.run} · {x.rules} rules. Messages below used the earlier rules.</span></div>
              ) : (
                <div key={x.key} className={`res${x === latestMsg ? ' latest' : ''}`}>
                  <div className="res-msg">
                    <span className="res-lbl">Customer message</span>
                    {/* highlighted with the rules this message was routed by, not the current board */}
                    {markKeywords(x.text, x.rules).map((s, j) =>
                      s.color ? <mark key={j} className="hl" style={cssVar(s.color)}>{s.t}</mark> : <span key={j}>{s.t}</span>
                    )}
                  </div>
                  {x.result ? (
                    <div className="res-out">
                      <span className="res-lbl">Routed to</span>
                      <div className="res-route">
                        <span className="route" style={cssVar(x.result.color)}><span className="dot" />{x.result.desk}</span>
                        <span className="why">Rule {x.result.no} · <code>{x.result.hits.join(', ')}</code></span>
                      </div>
                      {x.result.others.length > 0 && (
                        <span className="also">
                          Also matched {x.result.others.map((o) => `Rule ${o.no} (${o.desk})`).join(', ')}. Rule {x.result.no} came first.
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="res-out">
                      <span className="res-lbl">Bot reply</span>
                      <span className="reply">“{x.reply}”</span>
                      <span className="nomatch"><IcInfo /> No rule matched</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="compose">
              {stale && (
                <div className="paused" role="status">
                  <span>
                    {unfinished.length > 0
                      ? `The bot is paused. Finish ${unfinished.length === 1 ? `rule ${unfinished[0].no}` : `rules ${unfinished.map((u) => u.no).join(', ')}`} or delete it, then click Run again.`
                      : 'The bot is paused: the rules changed. Click Run again to test with the new rules.'}
                  </span>
                  <button className="btn primary" onClick={run} disabled={!canRun}><IcPlay /> Run again</button>
                </div>
              )}
              <form className="send" onSubmit={(e) => { e.preventDefault(); send(); }}>
                <input ref={inputRef} value={message} onChange={(e) => setMessage(e.target.value)} disabled={stale}
                  placeholder={stale ? 'Run again to keep testing' : 'Type a message…'} aria-label="Message" />
                <button className="btn primary lg" type="submit" disabled={!message.trim() || stale}><IcSend /> Route</button>
              </form>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
