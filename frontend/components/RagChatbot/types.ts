/** RAG Chatbot projects. Mirrors backend/app/services/rag_chatbot_service.py. */

export type Step = 1 | 2 | 3 | 4 | 5;
export type Method = 'meaning' | 'keyword';
export type Verdict = 'grounded' | 'made-up' | 'refused';

export interface Chunking {
  mode: 'sections' | 'words';
  size: number;
  overlap: number;
}

export interface Retrieval {
  method: Method;
  k: number;
  minScore: number;
}

export interface AnswerSettings {
  model: string;
  temperature: number;
  strict: boolean;
  useDocuments: boolean;
}

export interface State {
  step: Step;
  chunking: Chunking;
  embeddingModel: string;
  retrieval: Retrieval;
  answer: AnswerSettings;
  indexId: string | null;
}

export interface LibraryDoc {
  id: string;
  title: string;
  short: string;
  issuer: string;
  reference: string;
  date: string;
  effective?: string;
  sourceUrl: string;
  pdfUrl?: string;
  licence: string;
  summary: string;
  recommended: boolean;
  pages: number;
  words: number;
  version: string;
}

export interface ProjectDoc {
  id: string;
  source: 'library' | 'upload';
  libraryId?: string;
  title: string;
  short: string;
  issuer?: string;
  reference?: string;
  date?: string;
  sourceUrl?: string;
  fileName: string;
  fileType: string;
  fileBytes?: number;
  pages: number;
  words: number;
  version: string;
  addedAt: string;
}

export interface IndexMeta {
  id: string;
  status: 'building' | 'ready';
  documents: { id: string; short: string; version: string }[];
  chunking: Chunking;
  embeddingModel: string;
  dims: number;
  chunkCount: number;
  words: { min: number; max: number; avg: number };
  embedded: { new: number; fromSharedCache: number };
  seconds: number;
  builtAt: string;
  lastUsedAt: string;
}

export interface ChunkRow {
  n: number;
  docId: string;
  docTitle: string;
  pages: number[];
  pageLabel: string;
  paras: string[];
  label: string;
  context: string;
  text: string;
  words: number;
}

export interface Preview {
  chunking: Chunking;
  count: number;
  perDocument: { id: string; short: string; chunks: number }[];
  words: { min: number; max: number; avg: number };
  chunks: ChunkRow[];
}

export interface Hit {
  n: number;
  docId: string;
  docTitle: string;
  label: string;
  pageLabel: string;
  context: string;
  text: string;
  words: number;
  score: number;
  matched?: string[];
  passage?: number; // its number in the prompt: [1], [2]...
}

export interface SearchSide {
  method: Method;
  hits: Hit[];
  belowMinScore: number;
  unknownWords: string[];
  best: number;
}

export interface SearchResult {
  question: string;
  k: number;
  minScore: number;
  keyword: SearchSide;
  meaning: SearchSide;
}

export interface AskSettings extends Retrieval, AnswerSettings {
  indexId: string | null;
  chunking: Chunking;
  embeddingModel: string;
}

export interface Ask {
  id: string;
  question: string;
  testQuestionId: string | null;
  evalId?: string | null;
  settings: AskSettings;
  retrieved: Hit[];
  answer: string;
  citations: number[];
  invalidCitations: number[];
  declined: boolean;
  check: { pass: boolean; reason: string } | null;
  verdict: Verdict | null;
  model: { id: string; vertex: string; name: string };
  tokens: { in: number; out: number };
  costUsd: number;
  costInr?: number;
  ms: number;
  createdAt: string;
  prompt?: { system: string; user: string };
}

export interface EvalResult {
  questionId: string;
  trap: boolean;
  askId: string | null;
  pass: boolean;
  reason: string;
  cited: boolean;
  declined: boolean;
  verdict: Verdict | null;
  error: string | null;
}

export interface EvalSummary {
  total: number;
  passed: number;
  facts: number;
  factsPassed: number;
  factsCited: number;
  traps: number;
  trapsPassed: number;
  madeUp: number;
  errors: number;
}

export interface Eval {
  id: string;
  settings: AskSettings;
  questionIds: string[];
  results: EvalResult[];
  summary: EvalSummary;
  seconds: number;
  createdAt: string;
  asks?: (Ask | null)[];
}

export interface TestQuestion {
  id: string;
  type: string;
  question: string;
  answer: string;
  where: string;
  doc: string | null;
  trap: boolean;
}

export interface Models {
  chat: { id: string; name: string; pin: number; pout: number; hint: string }[];
  embedding: { id: string; name: string; note: string; dims: number }[];
  defaults: { chat: string; embedding: string };
}

export interface Project {
  project_id: string;
  state: State;
  documents: ProjectDoc[];
  index: IndexMeta | null;
  indexFresh: boolean;
  wantedIndexId: string | null;
  indexes: IndexMeta[];
  asks: Ask[];
  evals: Eval[];
}
