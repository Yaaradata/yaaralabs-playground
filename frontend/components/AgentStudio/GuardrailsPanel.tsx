'use client';

import { useEffect, useState } from 'react';
import { getGuardrails, getPersona, saveGuardrails, savePersona } from './api';
import type { Guardrails } from './types';
import { Block, PanelHeader, SaveBar, SecondaryButton, Toggle } from './ui';
import { useSamplesShown } from './samplesShortcut';

export const EMPTY_GUARDRAILS: Guardrails = {
  stay_on_topic: false,
  no_made_up_facts: false,
  protect_client_data: false,
  block_instruction_changes: false,
  never_rules: [],
  handoff_message: '',
};

export const DEFAULT_HANDOFF = "I can't help with that here. Your relationship manager will call you on your registered number.";
export const NEVER_RULES_MAX = 10;
export const NEVER_RULE_CHARS = 200;
export const HANDOFF_CHARS = 300;

/** Name shown in the USE AI chip for a guardrail that blocked a reply. */
export const GUARDRAIL_LABELS: Record<string, string> = {
  stay_on_topic: 'Stay on topic',
  no_made_up_facts: "Don't make things up",
  protect_client_data: 'Protect client data',
  block_instruction_changes: 'Bank and settlement changes',
};

/** "Load the custody example": fills the page; the participant saves it. */
export const CUSTODY_EXAMPLE: { instructions: string[]; guardrails: Guardrails } = {
  instructions: [
    'Answer only questions about corporate actions, fees and billing, and onboarding and KYC.',
    'If you are not sure, say so and offer to connect a colleague.',
    'If the client is unhappy, say you are escalating to a senior manager.',
    'Reply in under 80 words.',
  ],
  guardrails: {
    stay_on_topic: true,
    no_made_up_facts: true,
    protect_client_data: true,
    block_instruction_changes: true,
    never_rules: [
      'Never give investment advice or recommend a stock.',
      "Never promise a payment date that isn't in the exchange notice.",
      'Never admit fault or promise compensation.',
    ],
    handoff_message: DEFAULT_HANDOFF,
  },
};

const SWITCHES: { key: keyof Guardrails; name: string; line: string }[] = [
  { key: 'stay_on_topic', name: 'Stay on topic', line: 'Only answer questions within its role. Politely decline anything else.' },
  { key: 'no_made_up_facts', name: "Don't make things up", line: "If it isn't sure, say so. Never invent a rule, circular, date or number." },
  { key: 'protect_client_data', name: 'Protect client data', line: "Never share another client's details. Hide PAN, Aadhaar and account numbers in replies." },
  {
    key: 'block_instruction_changes',
    name: 'Block bank and settlement changes',
    line: 'Never change bank accounts, payout accounts, IFSC or settlement instructions in chat. Hand off to a person.',
  },
];

const inputCls =
  'flex-1 min-w-0 px-4 py-2.5 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent placeholder-fg/40';

/** Add / edit / delete list of one-line entries. */
function LineList({ lines, onChange, placeholder, max, maxChars, label }: {
  lines: string[]; onChange: (lines: string[]) => void; placeholder: string; max?: number; maxChars?: number; label: string;
}) {
  const [draft, setDraft] = useState('');
  const full = max !== undefined && lines.length >= max;
  const add = () => {
    const v = draft.trim();
    if (!v || full) return;
    onChange([...lines, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {lines.map((line, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={line}
            maxLength={maxChars}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(lines.map((l, j) => (j === i ? e.target.value : l)))}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
            className="p-2 text-fg/50 hover:text-red-500 transition-colors"
            title="Delete"
            aria-label={`Delete ${label.toLowerCase()} ${i + 1}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      ))}
      {!full && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            maxLength={maxChars}
            placeholder={placeholder}
            aria-label={`New ${label.toLowerCase()}`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            className={`${inputCls} border-dashed`}
          />
          <SecondaryButton onClick={add} disabled={!draft.trim()}>Add</SecondaryButton>
        </div>
      )}
      {max !== undefined && <p className="text-xs text-fg/50">{lines.length} of {max} lines{full ? ' (full)' : ''}</p>}
    </div>
  );
}

/** RULES & GUARDRAILS: instructions (persona.guidelines), four switches, "Also never" lines, hand-off message. */
export default function GuardrailsPanel({ agentId }: { agentId: string }) {
  // sample data stays hidden until Ctrl+Shift+Z is pressed in this section (see samplesShortcut.tsx)
  const samplesShown = useSamplesShown(`${agentId}:guardrails`);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [g, setG] = useState<Guardrails>(EMPTY_GUARDRAILS);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // what is saved, to tell "Unsaved changes" and to Discard back to it
  const [saved, setSaved] = useState<{ instructions: string[]; g: Guardrails } | null>(null);
  const dirty = saved !== null && JSON.stringify({ instructions, g }) !== JSON.stringify(saved);

  useEffect(() => {
    let live = true;
    Promise.all([getPersona(agentId), getGuardrails(agentId)])
      .then(([p, gr]) => {
        if (!live) return;
        const loaded = {
          instructions: (p.guidelines || '').split('\n').filter((l) => l.trim()),
          g: {
            stay_on_topic: Boolean(gr.stay_on_topic),
            no_made_up_facts: Boolean(gr.no_made_up_facts),
            protect_client_data: Boolean(gr.protect_client_data),
            block_instruction_changes: Boolean(gr.block_instruction_changes),
            never_rules: Array.isArray(gr.never_rules) ? gr.never_rules : [],
            handoff_message: gr.handoff_message || '',
          },
        };
        setInstructions(loaded.instructions);
        setG(loaded.g);
        setSaved(loaded);
      })
      .catch((e: Error) => live && setMsg({ type: 'error', text: e.message }));
    return () => {
      live = false;
    };
  }, [agentId]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    const lines = instructions.map((l) => l.trim()).filter(Boolean);
    const body = { ...g, never_rules: g.never_rules.map((l) => l.trim()).filter(Boolean), handoff_message: g.handoff_message.trim() };
    try {
      await Promise.all([savePersona(agentId, { guidelines: lines.join('\n') }), saveGuardrails(agentId, body)]);
      setInstructions(lines);
      setG(body);
      setSaved({ instructions: lines, g: body });
      setMsg({ type: 'success', text: 'Rules and guardrails saved. The agent uses them from the next message.' });
      setTimeout(() => setMsg(null), 4000);
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const loadExample = () => {
    setInstructions([...CUSTODY_EXAMPLE.instructions]);
    setG({ ...CUSTODY_EXAMPLE.guardrails, never_rules: [...CUSTODY_EXAMPLE.guardrails.never_rules] });
    setMsg({ type: 'success', text: 'Custody example loaded. Press Save Rules & Guardrails to use it.' });
    setTimeout(() => setMsg(null), 4000);
  };

  return (
    <div className="flex-1 flex flex-col">
      <PanelHeader
        icon="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        title="RULES & GUARDRAILS"
        subtitle="What it must always do, and never do"
        action={samplesShown ? <SecondaryButton onClick={loadExample}>Load the custody example</SecondaryButton> : undefined}
      />
      <div className="space-y-4">
        <Block title="Instructions: what it should always do" subtitle="One instruction per line. The agent follows these in every reply.">
          <LineList lines={instructions} onChange={setInstructions} placeholder="e.g. Reply in under 80 words" label="Instruction" />
        </Block>

        <Block title="Guardrails: what it must never do">
          <div className="divide-y divide-magenta-brand/10">
            {SWITCHES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg">{s.name}</div>
                  <div className="text-sm text-fg/60">{s.line}</div>
                </div>
                <Toggle on={Boolean(g[s.key])} label={s.name} onClick={() => setG({ ...g, [s.key]: !g[s.key] })} />
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-magenta-brand/10">
            <div className="text-sm font-semibold text-fg mb-2">Also never…</div>
            <LineList
              lines={g.never_rules}
              onChange={(never_rules) => setG({ ...g, never_rules })}
              placeholder="e.g. Never recommend a stock"
              max={NEVER_RULES_MAX}
              maxChars={NEVER_RULE_CHARS}
              label="Never rule"
            />
          </div>
        </Block>

        <Block title="When it can't help" subtitle="Used whenever a guardrail stops a reply.">
          <label htmlFor="as-handoff" className="block text-sm font-semibold text-fg mb-2">Hand-off message</label>
          <textarea
            id="as-handoff"
            rows={2}
            maxLength={HANDOFF_CHARS}
            value={g.handoff_message}
            placeholder={DEFAULT_HANDOFF}
            onChange={(e) => setG({ ...g, handoff_message: e.target.value })}
            className="w-full px-4 py-2.5 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent placeholder-fg/40 resize-none"
          />
          <p className="text-xs text-fg/50 mt-1">
            {g.handoff_message.length} / {HANDOFF_CHARS} characters. Left empty, the grey text above is used.
          </p>
        </Block>
      </div>
      <div className="h-8 flex-shrink-0" aria-hidden="true" />
      <SaveBar
        label="Save Rules & Guardrails"
        dirty={dirty}
        saving={saving}
        msg={msg}
        loading={saved === null && !msg}
        onSave={save}
        onDiscard={() => {
          if (saved) {
            setInstructions(saved.instructions);
            setG(saved.g);
          }
          setMsg(null);
        }}
      />
    </div>
  );
}
