'use client';

import { useEffect, useState } from 'react';
import { getTools, saveTools } from './api';
import type { ToolCatalog } from './types';
import { Notice, PanelHeader, Spinner, Toggle } from './ui';

const argsText = (args: Record<string, unknown>) =>
  Object.values(args || {})
    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
    .join(', ');

function exampleLine(name: string, example: Record<string, unknown>, result: unknown): string {
  const input = argsText(example);
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    const first = ['answer', 'summary', 'settlement_date', 'date', 'valid', 'result', 'company', 'holder_type', 'state', 'status']
      .map((k) => (k in r ? `${k}: ${typeof r[k] === 'string' ? r[k] : JSON.stringify(r[k])}` : ''))
      .find(Boolean);
    return `${name}(${input}) → ${first || JSON.stringify(r).slice(0, 80)}`;
  }
  return input ? `${name}(${input})` : name;
}

/** TOOLS: what the agent may use. Saved on every switch. */
export default function ToolsPanel({ agentId, sessionId }: { agentId: string; sessionId: string }) {
  const [cat, setCat] = useState<ToolCatalog | null>(null);
  const [saving, setSaving] = useState('');
  const [saved, setSaved] = useState('');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getTools(agentId, sessionId).then(setCat).catch((e: Error) => setMsg({ type: 'error', text: e.message }));
  }, [agentId, sessionId]);

  const toggle = async (name: string) => {
    if (!cat) return;
    const on = cat.enabled.includes(name);
    const enabled = on ? cat.enabled.filter((t) => t !== name) : [...cat.enabled, name];
    setSaving(name);
    setSaved('');
    try {
      setCat(await saveTools(agentId, sessionId, enabled));
      setSaved(name);
      setTimeout(() => setSaved((s) => (s === name ? '' : s)), 2000);
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving('');
    }
  };

  return (
    <div>
      <PanelHeader
        icon="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z"
        title="TOOLS"
        subtitle="Switch on what your agent may use. It decides when to use each one."
      />
      <Notice msg={msg} />
      {!cat ? (
        <div className="flex items-center gap-2 text-fg/60 text-sm"><Spinner /> Loading the tools…</div>
      ) : (
        <div className="space-y-6">
          {cat.groups.map((g) => (
            <section key={g.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-fg/60 mb-2">{g.title}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {g.tools.map((t) => (
                  <div key={t.name} className={`bg-card rounded-lg border p-4 ${t.enabled ? 'border-purple-brand/50' : 'border-magenta-brand/15'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-fg">{t.title}</div>
                        <div className="text-sm text-fg/70 mt-0.5">{t.desc}</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {saving === t.name && <Spinner />}
                        {saved === t.name && <span className="text-xs text-fg/60" role="status">✓ Saved</span>}
                        <Toggle on={t.enabled} label={t.title} onClick={() => toggle(t.name)} disabled={Boolean(saving)} />
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-fg/55 font-mono break-words">
                      Example: {exampleLine(t.name, t.example, t.exampleResult)}
                    </div>
                    {t.note && <div className="mt-2 text-xs text-fg/70">{t.note}</div>}
                    {t.blockedByGuardrail && <div className="mt-2 text-xs font-semibold text-purple-brand">🛡 Blocked by your guardrail</div>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
