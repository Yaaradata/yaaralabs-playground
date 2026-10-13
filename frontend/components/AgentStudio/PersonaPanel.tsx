'use client';

import { useEffect, useState } from 'react';
import { getPersona, getSettings, savePersona, saveSettings } from './api';
import { DEFAULT_MODEL, MODEL_OPTIONS, type Stage } from './stages';
import { Notice, PanelHeader, PrimaryButton } from './ui';

const TONES: [string, string, string][] = [
  ['friendly', '😊', 'Friendly'],
  ['professional', '😐', 'Professional'],
  ['casual', '🤝', 'Casual'],
];
const LENGTHS: [string, string][] = [
  ['minimal', 'Minimal'],
  ['short', 'Short'],
  ['long', 'Long'],
  ['chatty', 'Chatty'],
];

const input =
  'w-full px-4 py-3 bg-card border border-magenta-brand/20 text-fg rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-brand focus:border-transparent';

/** AI PERSONA: name, role, tone, length, and the model (saved through the settings endpoint). */
export default function PersonaPanel({ agentId, stage, onSaved }: { agentId: string; stage: Stage; onSaved?: (name: string) => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [tone, setTone] = useState('friendly');
  const [length, setLength] = useState('short');
  const [model, setModel] = useState(DEFAULT_MODEL[stage]);
  const [embedding, setEmbedding] = useState('text-embedding-005');
  const [similarity, setSimilarity] = useState('Cosine similarity');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([getPersona(agentId), getSettings(agentId)])
      .then(([p, s]) => {
        if (!live) return;
        setName(p.name || '');
        setRole(p.role || '');
        setTone((p.tone || 'friendly').toLowerCase());
        setLength(p.response_length || 'short');
        setModel(MODEL_OPTIONS.some(([v]) => v === s.model) ? s.model : DEFAULT_MODEL[stage]);
        setEmbedding(s.embedding_model || 'text-embedding-005');
        setSimilarity(s.similarity || 'Cosine similarity');
      })
      .catch((e: Error) => live && setMsg({ type: 'error', text: e.message }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [agentId, stage]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await savePersona(agentId, { name, role, tone, response_length: length });
      await saveSettings(agentId, { model, embedding_model: embedding, similarity });
      setMsg({ type: 'success', text: 'Persona saved.' });
      onSaved?.(name);
      setTimeout(() => setMsg(null), 3000);
    } catch (e) {
      setMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PanelHeader
        icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        title="AI PERSONA"
        subtitle="How the agent talks"
        action={<PrimaryButton onClick={save} busy={saving} disabled={loading}>Save Persona</PrimaryButton>}
      />
      <Notice msg={msg} />
      <div className="space-y-6">
        <div>
          <label htmlFor="as-name" className="block text-sm font-semibold text-fg mb-1">Agent Name</label>
          <p className="text-sm text-fg/60 mb-2">The name shown in the conversation</p>
          <input id="as-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Asha" />
        </div>
        <div>
          <label htmlFor="as-role" className="block text-sm font-semibold text-fg mb-1">Agent Role</label>
          <p className="text-sm text-fg/60 mb-2">Its job title</p>
          <input id="as-role" className={input} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Custody client-service assistant" />
        </div>
        <div>
          <div className="block text-sm font-semibold text-fg mb-2">Tone of Voice</div>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Tone of voice">
            {TONES.map(([v, emoji, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={tone === v}
                onClick={() => setTone(v)}
                className={`px-4 py-3 rounded-lg text-center transition-all ${tone === v ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
              >
                <span className="text-2xl mb-1 block" aria-hidden="true">{emoji}</span>
                <span className="text-sm font-medium text-fg">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="block text-sm font-semibold text-fg mb-2">Chat Response Length</div>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Chat response length">
            {LENGTHS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={length === v}
                onClick={() => setLength(v)}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-fg transition-all ${length === v ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="as-model" className="block text-sm font-semibold text-fg mb-1">Model</label>
          <p className="text-sm text-fg/60 mb-2">The AI model that writes the replies</p>
          <select id="as-model" className={input} value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
