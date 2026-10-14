/** Copilot labs (Ex 9, Ex 10): content and answer types. Content lives in activities/. */

export type ActivityId = 'ethics' | 'document-ai';
export type Verdict = 'good' | 'partial' | 'bad';
export type Tone = Verdict | 'none';

export interface TextBlock {
  type: 'text';
  text: string; // **bold** allowed
  tone?: 'note';
}

export interface PromptBlock {
  type: 'prompt';
  text: string;
  hint?: string; // replaces the default hint
}

export interface DownloadBlock {
  type: 'download';
  name: string;
  size: string;
  href: string;
}

export interface ChecklistBlock {
  type: 'checklist' | 'reveal';
  id: string;
  label: string; // the row label on the result card
  q: string;
  items: string[];
  bonus?: string; // reveal only: an extra tick that isn't counted
}

export interface ChoiceOption {
  label: string;
  v: Verdict;
}

export interface ChoiceBlock {
  type: 'choice';
  id: string;
  label: string;
  q: string;
  options: ChoiceOption[];
}

export type FieldKey = 'right' | 'wrong' | 'missing';

export interface FieldRow {
  f: string;
  correct: string;
  key: FieldKey;
}

export interface FieldCheckBlock {
  type: 'fieldcheck';
  id: string;
  label: string;
  rows: FieldRow[];
}

export interface NotesBlock {
  type: 'notes';
  id: string;
  label?: string;
  boxes: string[];
}

export type Block = TextBlock | PromptBlock | DownloadBlock | ChecklistBlock | ChoiceBlock | FieldCheckBlock | NotesBlock;
export type AnsweredBlock = ChecklistBlock | ChoiceBlock | FieldCheckBlock | NotesBlock;

export interface Step {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Activity {
  id: ActivityId;
  ex: string;
  title: string;
  point: string;
  steps: Step[];
}

export interface AiCheck {
  id: string;
  title: string;
  text: string;
  evidence: Partial<Record<ActivityId, string[]>>;
}

/** Answers, by block id. */
export interface ChecklistAnswer {
  ticked?: number[];
  done?: boolean;
  open?: boolean;
  bonus?: boolean;
}
export interface FieldCheckAnswer {
  marks?: Record<string, FieldKey>;
  shown?: boolean;
}
export type NotesAnswer = string[];
export type ChoiceAnswer = number;
export type Answer = ChecklistAnswer | FieldCheckAnswer | NotesAnswer | ChoiceAnswer;
export type Answers = Record<string, Answer | undefined>;

export interface LabState {
  activity: ActivityId;
  answers: Answers;
  completedSteps: string[];
  updatedAt?: string | null;
}
