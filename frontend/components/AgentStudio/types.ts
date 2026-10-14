/** Shared types for the Day 2 Agent Studio. */

export interface Persona {
  agent_id: string;
  name: string;
  role: string;
  tone: string;
  language: string;
  response_length: string;
  guidelines: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentSettings {
  model: string;
  embedding_model: string;
  similarity: string;
}

export interface Guardrails {
  stay_on_topic: boolean;
  no_made_up_facts: boolean;
  protect_client_data: boolean;
  block_instruction_changes: boolean;
  never_rules: string[];
  handoff_message: string;
}

export interface RuleItem {
  type: string;
  value: string;
}

export interface SavedRule {
  rule_id: string;
  agent_id: string;
  name: string;
  conditions: RuleItem[];
  match_type: 'ANY' | 'ALL';
  actions: RuleItem[];
  priority: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Passage {
  n: number;
  doc_id: string;
  doc_title: string;
  label: string;
  page_label: string;
  pages: number[];
  context: string;
  text: string;
  score: number;
  cited?: boolean;
}

export interface WebSource {
  title: string;
  uri: string;
}

export interface Step {
  kind: 'model' | 'tool';
  round: number;
  text?: string;
  calls?: { name: string; args: Record<string, unknown> }[];
  name?: string;
  args?: Record<string, unknown>;
  group?: string;
  ok?: boolean;
  blocked?: boolean;
  result?: unknown;
  ms?: number;
  final?: boolean;
  query?: string;
  passages?: number[];
  sources?: WebSource[];
}

export interface Trace {
  stage?: string;
  model?: string;
  guardrails_on?: string[];
  guardrail_blocked?: string;
  guardrail_masked?: number;
  rule_matched?: { rule_id: string; name: string } | string | null;
  llm_used?: boolean;
  passages?: Passage[];
  citations?: number[];
  invalid_citations?: number[];
  steps?: Step[];
  web_sources?: WebSource[];
  tools_called?: string[];
  blocked?: boolean;
  ms?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  trace?: Trace | null;
  error?: boolean;
  /** The answer is still being written (streamed): text so far, what the agent is doing, its tool steps. */
  streaming?: boolean;
  status?: string;
  liveSteps?: Step[];
}

export interface KbDocument {
  doc_id: string;
  source: 'library' | 'upload';
  library_id?: string;
  title: string;
  short: string;
  pages: number;
  chunks: number;
  words: number;
  added_at?: string;
}

export interface LibraryDoc {
  id: string;
  title: string;
  short: string;
  issuer: string;
  reference: string;
  date: string;
  summary: string;
  pages: number;
  pdf_url: string;
}

export interface KbChunk {
  label: string;
  page_label: string;
  pages: number[];
  context: string;
  text: string;
  words: number;
}

export interface ToolCard {
  name: string;
  title: string;
  desc: string;
  enabled: boolean;
  example: Record<string, unknown>;
  exampleResult?: unknown;
  note?: string | null;
  blockedByGuardrail?: boolean;
}

export interface ToolCatalog {
  groups: { title: string; tools: ToolCard[] }[];
  enabled: string[];
}

export interface SampleQuestion {
  id: string;
  text: string;
  answer?: string;
  note?: string | null;
  where?: string | null;
}

export interface SampleGroup {
  title: string;
  questions: SampleQuestion[];
}

/** What a PDF viewer needs to open a passage. */
export interface PdfTarget {
  url: string;
  title: string;
  page: number;
  passage?: Passage | null;
  docId?: string;
}
