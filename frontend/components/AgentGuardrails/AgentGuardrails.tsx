'use client';

import { useState } from 'react';

/** Custom AI Agent guardrails, as stored by PUT /agent/{id}/guardrails. */
export interface Guardrails {
  stay_on_topic: boolean;
  no_made_up_facts: boolean;
  protect_client_data: boolean;
  block_instruction_changes: boolean;
  never_rules: string[];
  handoff_message: string;
}

export const EMPTY_GUARDRAILS: Guardrails = {
  stay_on_topic: false,
  no_made_up_facts: false,
  protect_client_data: false,
  block_instruction_changes: false,
  never_rules: [],
  handoff_message: '',
};

export const DEFAULT_HANDOFF =
  "I can't help with that here. Your relationship manager will call you on your registered number.";

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

/** "Load the custody example": fills all three blocks; the participant saves it. */
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
  {
    key: 'no_made_up_facts',
    name: "Don't make things up",
    line: "If it isn't sure, say so. Never invent a rule, circular, date or number. Also turns off web search.",
  },
  {
    key: 'protect_client_data',
    name: 'Protect client data',
    line: "Never share another client's details. Hide PAN, Aadhaar and account numbers in replies.",
  },
  {
    key: 'block_instruction_changes',
    name: 'Block bank and settlement changes',
    line: 'Never change bank accounts, payout accounts, IFSC or settlement instructions in chat. Hand off to a person.',
  },
];

const inputCls =
  'flex-1 min-w-0 px-4 py-2.5 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent placeholder-fg/40';

/** Add / edit / delete list of one-line entries. */
function LineList({
  lines,
  onChange,
  placeholder,
  max,
  maxChars,
  label,
}: {
  lines: string[];
  onChange: (lines: string[]) => void;
  placeholder: string;
  max?: number;
  maxChars?: number;
  label: string;
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
        <div key={i} className="flex items-center gap-2 group">
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
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="px-4 py-2.5 rounded-lg border border-magenta-brand/30 text-sm font-medium text-fg hover:bg-raised transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      )}
      {max !== undefined && (
        <p className="text-xs text-fg/50">
          {lines.length} of {max} lines{full ? ' (full)' : ''}
        </p>
      )}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-pink-brand ${
        on ? 'bg-purple-brand' : 'bg-fg/20'
      }`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Block({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-card/40 border border-magenta-brand/20 rounded-xl p-5">
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      <p className="text-sm text-fg/60 mt-0.5 mb-4">{subtitle}</p>
      {children}
    </section>
  );
}

/** RULES & GUARDRAILS tab of the Custom AI Agent. State and saving live in the page. */
export function AgentGuardrails({
  instructions,
  onInstructions,
  guardrails,
  onGuardrails,
  onSave,
  onLoadExample,
  saving,
  message,
}: {
  instructions: string[];
  onInstructions: (lines: string[]) => void;
  guardrails: Guardrails;
  onGuardrails: (g: Guardrails) => void;
  onSave: () => void;
  onLoadExample: () => void;
  saving: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <svg className="w-6 h-6 text-purple-brand" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <div>
            <h2 className="text-2xl font-bold text-fg">RULES &amp; GUARDRAILS</h2>
            <p className="text-sm text-fg/60">What the agent must always do, and never do</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLoadExample}
            className="px-4 py-2.5 rounded-lg border border-magenta-brand/30 text-sm font-medium text-fg hover:bg-raised transition-colors"
          >
            Load the custody example
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-6 py-2.5 bg-purple-brand text-white rounded-lg font-medium hover:bg-[#a855c7] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Rules & Guardrails'}
          </button>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`mb-4 px-4 py-3 rounded-lg border ${
            message.type === 'success'
              ? 'bg-green-500/10 text-fg border-green-500/40'
              : 'bg-red-500/10 text-fg border-red-500/40'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-4">
        <Block title="Instructions: what it should always do" subtitle="One instruction per line. The agent follows these in every reply.">
          <LineList lines={instructions} onChange={onInstructions} placeholder="e.g. Reply in under 80 words" label="Instruction" />
        </Block>

        <Block title="Guardrails: what it must never do" subtitle="All off to start. Try the agent first, then turn them on.">
          <div className="divide-y divide-magenta-brand/10">
            {SWITCHES.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg">{s.name}</div>
                  <div className="text-sm text-fg/60">{s.line}</div>
                </div>
                <Toggle
                  on={Boolean(guardrails[s.key])}
                  label={s.name}
                  onClick={() => onGuardrails({ ...guardrails, [s.key]: !guardrails[s.key] })}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-magenta-brand/10">
            <div className="text-sm font-semibold text-fg mb-2">Also never…</div>
            <LineList
              lines={guardrails.never_rules}
              onChange={(never_rules) => onGuardrails({ ...guardrails, never_rules })}
              placeholder="e.g. Never recommend a stock"
              max={NEVER_RULES_MAX}
              maxChars={NEVER_RULE_CHARS}
              label="Never rule"
            />
          </div>
        </Block>

        <Block title="When it can't help" subtitle="Used whenever a guardrail stops a reply.">
          <label htmlFor="handoff-message" className="block text-sm font-semibold text-fg mb-2">
            Hand-off message
          </label>
          <textarea
            id="handoff-message"
            rows={2}
            maxLength={HANDOFF_CHARS}
            value={guardrails.handoff_message}
            placeholder={DEFAULT_HANDOFF}
            onChange={(e) => onGuardrails({ ...guardrails, handoff_message: e.target.value })}
            className="w-full px-4 py-2.5 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent placeholder-fg/40 resize-none"
          />
          <p className="text-xs text-fg/50 mt-1">
            {guardrails.handoff_message.length} / {HANDOFF_CHARS} characters. Left empty, the grey text above is used.
          </p>
        </Block>
      </div>
    </div>
  );
}

export default AgentGuardrails;
