'use client';

import { useEffect, useState } from 'react';
import { getPersona, getSettings, savePersona, saveSettings } from './api';
import { DEFAULT_MODEL, MODEL_OPTIONS, type Stage } from './stages';
import { PanelHeader, SaveBar } from './ui';

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

interface Fields {
  name: string;
  role: string;
  tone: string;
  length: string;
  model: string;
  embedding: string;
  similarity: string;
}

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
  // what is saved, to tell "Unsaved changes" and to Discard back to it
  const [saved, setSaved] = useState<Fields | null>(null);
  const fields: Fields = { name, role, tone, length, model, embedding, similarity };
  const dirty = saved !== null && JSON.stringify(fields) !== JSON.stringify(saved);
  const apply = (f: Fields) => {
    setName(f.name);
    setRole(f.role);
    setTone(f.tone);
    setLength(f.length);
    setModel(f.model);
    setEmbedding(f.embedding);
    setSimilarity(f.similarity);
  };

  useEffect(() => {
    let live = true;
    Promise.all([getPersona(agentId), getSettings(agentId)])
      .then(([p, s]) => {
        if (!live) return;
        const f: Fields = {
          name: p.name || '',
          role: p.role || '',
          tone: (p.tone || 'friendly').toLowerCase(),
          length: p.response_length || 'short',
          model: MODEL_OPTIONS.some(([v]) => v === s.model) ? s.model : DEFAULT_MODEL[stage],
          embedding: s.embedding_model || 'text-embedding-005',
          similarity: s.similarity || 'Cosine similarity',
        };
        apply(f);
        setSaved(f);
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
      setSaved(fields);
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
    <div className="flex-1 flex flex-col">
      <PanelHeader
        icon="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
        title="AI PERSONA"
        subtitle="How the agent talks"
      />
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
                className={`min-w-[8.5rem] px-6 py-4 rounded-xl text-center transition-all ${tone === v ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
              >
                <span className="text-3xl mb-1.5 block" aria-hidden="true">{emoji}</span>
                <span className="text-base font-medium text-fg">{label}</span>
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
                className={`min-w-[7rem] px-6 py-3 rounded-xl text-base font-medium text-fg transition-all ${length === v ? 'border-2 border-magenta-brand bg-purple-brand/10' : 'border border-magenta-brand/20 hover:border-magenta-brand/40'}`}
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
      <div className="h-8 flex-shrink-0" aria-hidden="true" />
      <SaveBar
        label="Save Persona"
        dirty={dirty}
        saving={saving}
        msg={msg}
        loading={saved === null && !msg}
        disabled={loading}
        onSave={save}
        onDiscard={() => {
          if (saved) apply(saved);
          setMsg(null);
        }}
      />
    </div>
  );
}
