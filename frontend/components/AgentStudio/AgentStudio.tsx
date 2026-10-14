'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import './agentStudio.css';
import ActionsPanel from './ActionsPanel';
import { getPersona } from './api';
import ChatPanel from './ChatPanel';
import GuardrailsPanel from './GuardrailsPanel';
import KnowledgePanel from './KnowledgePanel';
import PersonaPanel from './PersonaPanel';
import { sidebarFor, type Section, type Stage } from './stages';
import ToolsPanel from './ToolsPanel';
import { SamplesShortcut } from './samplesShortcut';

export interface AgentStudioProps {
  agentId: string;
  sessionId: string;
  stage: Stage;
  projectName: string;
  copiedFrom: { agent_id: string; name: string; stage: string } | null;
  backHref: string;
}

const ICONS: Record<Section, string> = {
  persona: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  guardrails:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  actions: 'M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9',
  knowledge:
    'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  tools:
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

/** Day 2 Agent Studio: one UI for Ex 6 (assistant), Ex 7 (RAG chatbot) and Ex 8 (AI agent). */
// projectName and copiedFrom stay in the props (the page passes them) but the header no longer shows them
export default function AgentStudio({ agentId, sessionId, stage, backHref }: AgentStudioProps) {
  const [tab, setTab] = useState<'train' | 'use'>('train');
  const [section, setSection] = useState<Section>('persona');
  const [agentName, setAgentName] = useState('');
  const items = sidebarFor(stage);

  useEffect(() => {
    getPersona(agentId).then((p) => setAgentName(p.name || '')).catch(() => undefined);
  }, [agentId]);

  return (
    <div className="h-full flex flex-col min-h-0 bg-canvas">
      <SamplesShortcut />
      {/* one row: back on the left, Train / Use AI in the centre */}
      <div className="flex-shrink-0 border-b border-magenta-brand/20 px-4 sm:px-6 py-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Link href={backHref} className="justify-self-start inline-flex items-center gap-1.5 text-sm text-fg/70 hover:text-fg whitespace-nowrap">
          <span aria-hidden="true">‹</span> Back to Projects
        </Link>
        <div className="flex items-center gap-1 bg-card rounded-lg p-1 border border-magenta-brand/15" role="tablist" aria-label="Train or use">
          {(['train', 'use'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                if (t === 'train') setSection('persona');
              }}
              className={`px-5 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === t ? 'bg-purple-brand text-white' : 'text-fg/70 hover:text-fg hover:bg-raised'}`}
            >
              {t === 'train' ? 'TRAIN' : 'USE AI'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'train' ? (
        <div className="flex-1 min-h-0 flex">
          <nav className="w-72 flex-shrink-0 border-r border-magenta-brand/20 p-4 overflow-y-auto dark-scrollbar" aria-label="Train">
            <h2 className="text-sm font-semibold text-fg/60 mb-3 px-2">TRAIN</h2>
            <ul className="space-y-1.5">
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => setSection(it.id)}
                    aria-current={section === it.id ? 'page' : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                      section === it.id ? 'bg-purple-brand/20 text-fg' : 'text-fg/65 hover:bg-raised/40 hover:text-fg'
                    }`}
                  >
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICONS[it.id]} />
                    </svg>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{it.label}</span>
                      <span className="block text-xs text-fg/55">{it.hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex-1 min-w-0 overflow-y-auto dark-scrollbar">
            {/* full height, so a short section still has its Save bar at the bottom of the screen */}
            <div className="w-full min-h-full px-6 pb-6 flex flex-col">
              {section === 'persona' && <PersonaPanel agentId={agentId} stage={stage} onSaved={setAgentName} />}
              {section === 'guardrails' && <GuardrailsPanel agentId={agentId} />}
              {section === 'actions' && <ActionsPanel agentId={agentId} sessionId={sessionId} stage={stage} />}
              {section === 'knowledge' && stage !== 'assistant' && <KnowledgePanel agentId={agentId} sessionId={sessionId} />}
              {section === 'tools' && stage === 'agent' && <ToolsPanel agentId={agentId} sessionId={sessionId} />}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-4">
          <ChatPanel agentId={agentId} sessionId={sessionId} stage={stage} agentName={agentName} />
        </div>
      )}
    </div>
  );
}
