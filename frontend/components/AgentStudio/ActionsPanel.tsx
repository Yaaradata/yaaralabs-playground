'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteRule, kbDocuments, listRules, saveRule, setRuleStatus } from './api';
import type { Stage } from './stages';
import type { KbDocument, RuleItem, SavedRule } from './types';
import { Notice, PanelHeader, PrimaryButton, SecondaryButton, Spinner } from './ui';
import { useSamplesShown } from './samplesShortcut';

/** WHEN options: as in the original Actions screen. */
export const WHEN_OPTIONS = [
  'Conversation starts',
  'User wants to',
  'User talks about',
  'User asks about',
  'User sentiment is',
  'User provides',
  'The sentence contains',
];

/** DO options by stage. No knowledge base in Ex 6; "Find in website" is never offered. */
export function doOptions(stage: Stage): string[] {
  const all = ['Say exact message', 'Always include', 'Always talk about', 'Talk about/mention', "Don't talk about/mention", 'Ask for information'];
  return stage === 'assistant' ? all : [...all, 'Answer Using Knowledge Base'];
}

export const ALL_KB = 'All Knowledge Base';

/** "Load the custody actions": two actions, added once. */
export const CUSTODY_ACTIONS: { name: string; conditions: RuleItem[]; actions: RuleItem[] }[] = [
  {
    name: 'Bank change → hand off',
    conditions: [{ type: 'User wants to', value: 'change bank account or settlement instructions' }],
    actions: [{
      type: 'Say exact message',
      value: "I can't change bank or settlement instructions in chat. Your relationship manager will call you on your registered number.",
    }],
  },
  {
    name: 'Unhappy client → escalate',
    conditions: [{ type: 'User sentiment is', value: 'negative' }],
    actions: [{ type: 'Always include', value: "I'm escalating this to a senior manager." }],
  },
];

const same = (a: RuleItem[], b: RuleItem[]) =>
  a.length === b.length && a.every((x, i) => x.type === b[i].type && (x.value || '').trim() === (b[i].value || '').trim());

interface Row extends RuleItem {
  id: string;
}
const blankRow = (): Row => ({ id: `${Date.now()}-${Math.random()}`, type: '', value: '' });
const field =
  'w-full px-3 py-2.5 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent text-sm';

/** ACTIONS: WHEN conditions → DO actions, ANY/ALL matching, on/off, edit, clone, delete. */
export default function ActionsPanel({ agentId, sessionId, stage }: { agentId: string; sessionId: string; stage: Stage }) {
  // sample data stays hidden until Ctrl+Shift+Z is pressed in this section (see samplesShortcut.tsx)
  const samplesShown = useSamplesShown(`${agentId}:actions`);
  const [rules, setRules] = useState<SavedRule[]>([]);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SavedRule | null>(null);
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<Row[]>([blankRow()]);
  const [act, setAct] = useState<Row[]>([blankRow()]);
  const [match, setMatch] = useState<'ANY' | 'ALL'>('ANY');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const hasKb = stage !== 'assistant';

  const flash = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    if (type === 'success') setTimeout(() => setMsg(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await listRules(agentId));
    } catch (e) {
      flash('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    load();
    if (hasKb) kbDocuments(agentId, sessionId).then(setDocs).catch(() => setDocs([]));
  }, [agentId, sessionId, hasKb, load]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-rule-menu]')) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const reset = () => {
    setOpen(false);
    setEditing(null);
    setWhen([blankRow()]);
    setAct([blankRow()]);
    setMatch('ANY');
  };

  const submit = async () => {
    const conditions = when.filter((c) => c.type === 'Conversation starts' || (c.type && c.value.trim()));
    const actions = act.filter((a) => a.type && a.value.trim());
    if (!conditions.length) return flash('error', 'Add at least one condition.');
    if (!actions.length) return flash('error', 'Add at least one action.');
    setBusy(true);
    try {
      await saveRule({
        agent_id: agentId,
        rule_id: editing?.rule_id,
        name: editing?.name || '',
        conditions: conditions.map(({ type, value }) => ({ type, value: type === 'Conversation starts' ? '' : value.trim() })),
        match_type: match,
        actions: actions.map(({ type, value }) => ({ type, value: value.trim() })),
      });
      flash('success', editing ? 'Action updated.' : 'Action saved.');
      reset();
      await load();
    } catch (e) {
      flash('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const edit = (r: SavedRule) => {
    setMenu(null);
    setEditing(r);
    setOpen(true);
    setWhen(r.conditions.length ? r.conditions.map((c) => ({ ...blankRow(), type: c.type, value: c.value || '' })) : [blankRow()]);
    setAct(r.actions.length ? r.actions.map((a) => ({ ...blankRow(), type: a.type, value: a.value })) : [blankRow()]);
    setMatch(r.match_type || 'ANY');
    setTimeout(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  // Clone: a new rule (no rule_id) through POST /rules/save
  const clone = async (r: SavedRule) => {
    setMenu(null);
    try {
      await saveRule({ agent_id: agentId, name: `${r.name} (copy)`, conditions: r.conditions, match_type: r.match_type, actions: r.actions });
      flash('success', 'Action copied.');
      await load();
    } catch (e) {
      flash('error', (e as Error).message);
    }
  };

  const toggle = async (r: SavedRule) => {
    setMenu(null);
    try {
      await setRuleStatus(r.rule_id, !r.active);
      setRules((prev) => prev.map((x) => (x.rule_id === r.rule_id ? { ...x, active: !r.active } : x)));
      flash('success', r.active ? 'Action switched off.' : 'Action switched on.');
    } catch (e) {
      flash('error', (e as Error).message);
    }
  };

  const remove = async (r: SavedRule) => {
    setMenu(null);
    if (!confirm(`Delete the action "${r.name}"?`)) return;
    try {
      await deleteRule(r.rule_id);
      setRules((prev) => prev.filter((x) => x.rule_id !== r.rule_id));
      flash('success', 'Action deleted.');
    } catch (e) {
      flash('error', (e as Error).message);
    }
  };

  const loadCustody = async () => {
    setBusy(true);
    try {
      let added = 0;
      for (const c of CUSTODY_ACTIONS) {
        if (rules.some((r) => same(r.conditions, c.conditions) && same(r.actions, c.actions))) continue;
        await saveRule({ agent_id: agentId, name: c.name, conditions: c.conditions, match_type: 'ANY', actions: c.actions });
        added += 1;
      }
      flash('success', added ? `Added ${added} custody action${added === 1 ? '' : 's'}.` : 'The custody actions are already here.');
      await load();
    } catch (e) {
      flash('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rowsEditor = (kind: 'when' | 'do') => {
    const rows = kind === 'when' ? when : act;
    const set = kind === 'when' ? setWhen : setAct;
    const options = kind === 'when' ? WHEN_OPTIONS : doOptions(stage);
    return rows.map((row, i) => {
      const complete = row.type === 'Conversation starts' || Boolean(row.type && row.value.trim());
      const last = i === rows.length - 1;
      return (
        <div key={row.id} className="mb-3">
          <div className="flex items-center gap-2">
            <span className="text-fg font-semibold w-14 text-sm">{kind === 'when' ? 'WHEN' : 'DO'}</span>
            <select
              className={`${field} flex-1`}
              value={row.type}
              aria-label={kind === 'when' ? `Condition ${i + 1}` : `Action ${i + 1}`}
              onChange={(e) => set(rows.map((r) => (r.id === row.id ? { ...r, type: e.target.value, value: e.target.value === 'Answer Using Knowledge Base' ? ALL_KB : r.value } : r)))}
            >
              <option value="">{kind === 'when' ? 'Select a condition…' : 'Select an action…'}</option>
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label="Add another"
              disabled={!complete || !last}
              onClick={() => set([...rows, blankRow()])}
              className="w-9 h-9 rounded-lg flex items-center justify-center bg-emerald-600 text-white disabled:bg-raised-2 disabled:text-fg/50 disabled:cursor-not-allowed"
            >
              +
            </button>
            {rows.length > 1 && (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => set(rows.filter((r) => r.id !== row.id))}
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-red-500/15 text-red-500 hover:bg-red-500/30"
              >
                −
              </button>
            )}
          </div>
          {row.type && row.type !== 'Conversation starts' && (
            <div className="ml-16 mt-2">
              {row.type === 'Answer Using Knowledge Base' ? (
                <select
                  className={field}
                  value={row.value}
                  aria-label="Which documents"
                  onChange={(e) => set(rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
                >
                  <option value={ALL_KB}>{ALL_KB}</option>
                  {docs.map((d) => (
                    <option key={d.doc_id} value={`File: ${d.short}`}>{d.title}</option>
                  ))}
                </select>
              ) : (
                <textarea
                  rows={row.type === 'Say exact message' ? 3 : 1}
                  className={`${field} resize-none`}
                  value={row.value}
                  placeholder={row.type === 'Say exact message' ? 'The exact message…' : `${row.type}…`}
                  onChange={(e) => set(rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
                />
              )}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div ref={top}>
      <PanelHeader
        icon="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
        title="ACTIONS"
        subtitle="When a message matches, the action runs before the model replies."
        action={samplesShown ? <SecondaryButton onClick={loadCustody} disabled={busy || loading}>Load the custody actions</SecondaryButton> : undefined}
      />
      <Notice msg={msg} />

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full bg-purple-brand/10 border-2 border-dashed border-magenta-brand/40 rounded-lg p-5 text-center hover:border-magenta-brand hover:bg-purple-brand/20 transition-all mb-6 font-semibold text-purple-brand"
        >
          + New action
        </button>
      ) : (
        <div className="bg-card rounded-xl p-5 border border-magenta-brand/20 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-fg">{editing ? 'Edit action' : 'New action'}</h3>
            <button type="button" onClick={reset} className="text-fg/60 hover:text-fg" aria-label="Close">✕</button>
          </div>
          <h4 className="text-xs font-semibold text-fg/60 uppercase tracking-wider mb-2">When (conditions)</h4>
          {rowsEditor('when')}
          {when.length > 1 && (
            <div className="my-4 flex items-center gap-2 text-sm text-fg">
              <span>Run when</span>
              <select className={`${field} w-auto`} value={match} onChange={(e) => setMatch(e.target.value as 'ANY' | 'ALL')} aria-label="Match">
                <option value="ANY">ANY (one is enough)</option>
                <option value="ALL">ALL (every one)</option>
              </select>
              <span>of the conditions match</span>
            </div>
          )}
          <h4 className="text-xs font-semibold text-fg/60 uppercase tracking-wider mb-2 mt-4">Do (actions)</h4>
          {rowsEditor('do')}
          <div className="flex justify-end">
            <PrimaryButton onClick={submit} busy={busy}>{editing ? 'Save changes' : 'Save action'}</PrimaryButton>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-fg">Your actions</h3>
        <span className="text-sm text-fg/60">{rules.length} action{rules.length === 1 ? '' : 's'}</span>
      </div>
      {loading ? (
        <div className="bg-card rounded-lg p-8 text-center border border-magenta-brand/10 text-fg/60 flex items-center justify-center gap-2">
          <Spinner /> Loading actions…
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-card rounded-lg p-6 text-center border border-magenta-brand/10">
          <p className="text-fg font-semibold mb-1">No actions yet</p>
          <p className="text-fg/60 text-sm">An action is a fixed rule: when a message matches, it runs before the model replies.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.rule_id} className={`bg-card rounded-lg p-4 border ${r.active === false ? 'border-raised-2 opacity-60' : 'border-magenta-brand/15'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="text-fg font-medium">{r.name}</h4>
                    {r.active === false && <span className="px-2 py-0.5 bg-raised-2 text-fg/80 text-xs rounded-full">Off</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-1.5 text-xs">
                    <span className="font-semibold text-fg/70">WHEN</span>
                    {r.conditions.map((c, i) => (
                      <span key={i} className="as-tag as-tag-when">{c.type}{c.value ? `: ${c.value}` : ''}</span>
                    ))}
                    {r.conditions.length > 1 && <span className="as-tag">({r.match_type})</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <span className="font-semibold text-fg/70">DO</span>
                    {r.actions.map((a, i) => (
                      // the whole action, wrapping onto more lines when long (no cut-off)
                      <span key={i} className="as-tag as-tag-do whitespace-pre-wrap break-words">{a.type}: {a.value}</span>
                    ))}
                  </div>
                </div>
                <div className="relative" data-rule-menu>
                  <button
                    type="button"
                    aria-label={`Options for ${r.name}`}
                    aria-expanded={menu === r.rule_id}
                    onClick={() => setMenu(menu === r.rule_id ? null : r.rule_id)}
                    className="p-2 text-fg/60 hover:text-fg rounded-lg hover:bg-raised"
                  >
                    ⋮
                  </button>
                  {menu === r.rule_id && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-card rounded-lg shadow-xl border border-magenta-brand/20 z-30 overflow-hidden" role="menu">
                      {[
                        ['Edit', () => edit(r)],
                        [r.active === false ? 'Switch on' : 'Switch off', () => toggle(r)],
                        ['Clone', () => clone(r)],
                        ['Delete', () => remove(r)],
                      ].map(([label, fn]) => (
                        <button
                          key={label as string}
                          type="button"
                          role="menuitem"
                          onClick={fn as () => void}
                          className={`w-full px-4 py-2.5 text-left text-sm hover:bg-raised ${label === 'Delete' ? 'text-red-500' : 'text-fg'}`}
                        >
                          {label as string}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
