/** API calls for the Day 2 Agent Studio. Every call throws an Error with the server's message on failure. */
import config from '../../lib/config';
import type {
  AgentSettings,
  Guardrails,
  KbChunk,
  KbDocument,
  LibraryDoc,
  Persona,
  SampleGroup,
  SavedRule,
  ToolCatalog,
  Trace,
} from './types';

const base = () => config.apiBaseUrl;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, init);
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg).replace(/^Value error, /, '');
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const q = (sessionId: string) => `session_id=${encodeURIComponent(sessionId)}`;

// persona, model, guardrails
export const getPersona = (agentId: string) => call<Persona>(`/agent/${agentId}/persona`);
export const savePersona = (agentId: string, body: Partial<Persona>) =>
  call<{ persona: Persona }>(`/agent/${agentId}/persona`, json('PUT', body));
export const getSettings = (agentId: string) => call<AgentSettings>(`/agent/${agentId}/settings`);
export const saveSettings = (agentId: string, body: AgentSettings) => call(`/agent/${agentId}/settings`, json('PUT', body));
export const getGuardrails = (agentId: string) => call<Guardrails>(`/agent/${agentId}/guardrails`);
export const saveGuardrails = (agentId: string, body: Guardrails) => call(`/agent/${agentId}/guardrails`, json('PUT', body));

// actions (the existing rules API)
export const listRules = (agentId: string) =>
  call<{ data: SavedRule[] }>(`/rules?agent_id=${encodeURIComponent(agentId)}`).then((r) => r.data || []);
export const saveRule = (body: Omit<SavedRule, 'rule_id' | 'active' | 'priority'> & { rule_id?: string; priority?: number }) =>
  call<{ data: SavedRule }>('/rules/save', json('POST', { priority: 1, ...body }));
export const deleteRule = (ruleId: string) => call(`/rules/${ruleId}`, { method: 'DELETE' });
export const setRuleStatus = (ruleId: string, active: boolean) => call(`/rules/${ruleId}/status`, json('PATCH', { active }));

// chat
export interface ChatReply {
  response: string;
  trace: Trace;
  chat_id?: string;
}
export const sendChat = (agentId: string, sessionId: string, message: string) =>
  call<ChatReply>('/chat', json('POST', { agent_id: agentId, session_id: sessionId, message }));
export const chatHistory = (agentId: string, sessionId: string) =>
  call<{ messages: { id: string; role: 'user' | 'assistant'; content: string; trace?: Trace | null }[] }>(
    `/chat/history?agent_id=${encodeURIComponent(agentId)}&${q(sessionId)}`,
  ).then((r) => r.messages || []);
export const clearChat = (agentId: string, sessionId: string) =>
  call(`/chat/history?agent_id=${encodeURIComponent(agentId)}&${q(sessionId)}`, { method: 'DELETE' });
export const sampleQuestions = (agentId: string, sessionId: string) =>
  call<{ groups: SampleGroup[] }>(`/agent/${agentId}/sample-questions?${q(sessionId)}`).then((r) => r.groups);

// knowledge base
export const kbLibrary = (agentId: string, sessionId: string) =>
  call<{ library: LibraryDoc[] }>(`/agent/${agentId}/kb/library?${q(sessionId)}`).then((r) => r.library);
export const kbDocuments = (agentId: string, sessionId: string) =>
  call<{ documents: KbDocument[] }>(`/agent/${agentId}/kb/documents?${q(sessionId)}`).then((r) => r.documents);
export const kbAddLibrary = (agentId: string, sessionId: string, libraryIds: string[]) =>
  call<{ documents: KbDocument[] }>(`/agent/${agentId}/kb/library?${q(sessionId)}`, json('POST', { library_ids: libraryIds })).then(
    (r) => r.documents,
  );
export const kbUpload = (agentId: string, sessionId: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return call<{ documents: KbDocument[] }>(`/agent/${agentId}/kb/upload?${q(sessionId)}`, { method: 'POST', body: form }).then(
    (r) => r.documents,
  );
};
export const kbChunks = (agentId: string, sessionId: string, docId: string, offset = 0, limit = 200) =>
  call<{ total: number; chunks: KbChunk[] }>(`/agent/${agentId}/kb/documents/${docId}/chunks?${q(sessionId)}&offset=${offset}&limit=${limit}`);
export const kbDelete = (agentId: string, sessionId: string, docId: string) =>
  call<{ documents: KbDocument[] }>(`/agent/${agentId}/kb/documents/${docId}?${q(sessionId)}`, { method: 'DELETE' }).then((r) => r.documents);
export const kbPdfUrl = (agentId: string, sessionId: string, docId: string) =>
  `${base()}/agent/${agentId}/kb/documents/${docId}/pdf?${q(sessionId)}`;
export const libraryPdfUrl = (path: string) => `${base()}${path}`;

// tools
export const getTools = (agentId: string, sessionId: string) => call<ToolCatalog>(`/agent/${agentId}/tools?${q(sessionId)}`);
export const saveTools = (agentId: string, sessionId: string, enabled: string[]) =>
  call<ToolCatalog>(`/agent/${agentId}/tools?${q(sessionId)}`, json('PUT', { enabled }));
