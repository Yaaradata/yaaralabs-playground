/**
 * Sample datasets that learners label themselves in a Text Recognition project.
 * Pure logic (no React), so it can be tested on its own: scripts/test-sample-labelling.ts.
 */

export const MIN_PER_LABEL = 5; // the same rule as the label page: at least 5 examples per label

/** The four standard labels, the same across exercises (and in the sample file, in this order). */
export const STANDARD_LABELS = ['Fees & billing', 'Corporate action', 'Onboarding & KYC', 'Complaint / escalation'];
/** Their project names: "Fees and billing", "Corporate action", "Onboarding and KYC", "Complaint or escalation". */
export const standardLabelNames = () => STANDARD_LABELS.map(projectLabelName);

export interface SampleLabelInfo {
  label: string; // name in the file, e.g. "Fees & billing"
  desk: string;
  covers: string;
}
export interface SampleQuery {
  id: number;
  text: string;
  label: string; // the sample answer key, used by the trainer fill shortcut
  difficulty: string;
  note: string;
}
export interface SampleTest {
  id: number;
  text: string;
  expected: string;
  note: string;
}
export interface SampleDataset {
  name: string;
  description: string;
  labels: SampleLabelInfo[];
  queries: SampleQuery[];
  test: SampleTest[];
}

export interface SampleSource {
  id: string;
  name: string;
  url: string; // served from frontend/public
}
export const SAMPLE_SOURCES: SampleSource[] = [
  { id: 'nuvama-custody', name: 'Nuvama custody client queries', url: '/datasets/nuvama_custody_queries.json' },
];

/**
 * Project label name for a sample label. Label names may only use letters, numbers, spaces,
 * hyphens and underscores (the label page rule; names also appear in URLs), so "&" becomes
 * "and" and "/" becomes "or": "Fees & billing" -> "Fees and billing".
 */
export function projectLabelName(sampleLabel: string): string {
  return sampleLabel
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/[^a-zA-Z0-9\s\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const isValidLabelName = (name: string) => /^[a-zA-Z0-9\s\-_]+$/.test(name);

/** Choices: query id -> sample label name ('' or missing = not labelled yet). */
export type Choices = Record<number, string>;

export function countByLabel(labels: SampleLabelInfo[], choices: Choices): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(labels.map((l) => [l.label, 0]));
  for (const v of Object.values(choices)) {
    if (v && v in counts) counts[v] += 1;
  }
  return counts;
}

export const labelledCount = (choices: Choices) => Object.values(choices).filter(Boolean).length;

/** "Finish labelling" is allowed only when every label has at least MIN_PER_LABEL examples. */
export function canGroup(labels: SampleLabelInfo[], choices: Choices, min = MIN_PER_LABEL): boolean {
  const counts = countByLabel(labels, choices);
  return labels.length > 0 && labels.every((l) => counts[l.label] >= min);
}

/** Fill every query with its sample answer key (trainer shortcut in the labelling screen). */
export function fillAllLabels(queries: SampleQuery[]): Choices {
  return Object.fromEntries(queries.map((q) => [q.id, q.label]));
}

export interface NewExample {
  label: string; // project label name
  text: string;
}

const norm = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/** Where each text already is in the project: normalised text -> label name. */
function placed(existing: { label: string; texts: string[] }[]): Map<string, string> {
  const at = new Map<string, string>();
  for (const l of existing) for (const t of l.texts) if (!at.has(norm(t))) at.set(norm(t), l.label);
  return at;
}

/**
 * Examples to add for the labelled rows. A text belongs to one label only, so any text already in
 * the project (under any label) is skipped: grouping twice adds nothing, and relabelling a query
 * never copies it into a second label. Unlabelled rows are skipped. Never removes anything.
 */
export function examplesToAdd(
  queries: SampleQuery[],
  choices: Choices,
  existing: { label: string; texts: string[] }[],
): NewExample[] {
  const at = placed(existing);
  const out: NewExample[] = [];
  for (const q of queries) {
    const chosen = choices[q.id];
    if (!chosen || at.has(norm(q.text))) continue;
    const label = projectLabelName(chosen);
    at.set(norm(q.text), label);
    out.push({ label, text: q.text.trim() });
  }
  return out;
}

/** Labelled rows whose text is already in the project under a different label than the one chosen. */
export function inOtherLabel(
  queries: SampleQuery[],
  choices: Choices,
  existing: { label: string; texts: string[] }[],
): { text: string; current: string; chosen: string }[] {
  const at = placed(existing);
  return queries.flatMap((q) => {
    const chosen = choices[q.id] ? projectLabelName(choices[q.id]) : '';
    const current = at.get(norm(q.text));
    return chosen && current && current !== chosen ? [{ text: q.text, current, chosen }] : [];
  });
}

/** Split into request-sized batches (the examples endpoint takes at most 50 at a time). */
export function batches<T>(items: T[], size = 50): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The sample's test messages make sense only when the project uses the sample's labels. */
export function usesSampleLabels(dataset: SampleDataset, projectLabels: string[]): boolean {
  const names = new Set(projectLabels);
  return dataset.labels.filter((l) => names.has(projectLabelName(l.label))).length >= 2;
}

export function validateDataset(raw: unknown): SampleDataset {
  const d = raw as SampleDataset;
  if (!d || !Array.isArray(d.labels) || !Array.isArray(d.queries) || !Array.isArray(d.test)) {
    throw new Error('The sample file is not in the expected format.');
  }
  const names = new Set(d.labels.map((l) => l.label));
  for (const q of d.queries) {
    if (!names.has(q.label)) throw new Error(`Query ${q.id} uses an unknown label: ${q.label}`);
  }
  for (const l of d.labels) {
    if (!isValidLabelName(projectLabelName(l.label))) throw new Error(`Label cannot be used as a name: ${l.label}`);
  }
  return d;
}
