/**
 * Sample datasets that learners label themselves in a Text Recognition project.
 * Pure logic (no React), so it can be tested on its own: scripts/test-sample-labelling.ts.
 */

export const MIN_PER_LABEL = 5; // the same rule as the label page: at least 5 examples per label

export interface SampleLabelInfo {
  label: string; // name in the file, e.g. "Fees & billing"
  desk: string;
  covers: string;
}
export interface SampleQuery {
  id: number;
  text: string;
  label: string; // the trainer's answer key: never shown before "Check my labels"
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

/** "Group it" is allowed only when every label has at least MIN_PER_LABEL examples. */
export function canGroup(labels: SampleLabelInfo[], choices: Choices, min = MIN_PER_LABEL): boolean {
  const counts = countByLabel(labels, choices);
  return labels.length > 0 && labels.every((l) => counts[l.label] >= min);
}

export interface Mismatch {
  id: number;
  chosen: string;
  trainer: string;
  note: string;
}
/** Compare labelled rows with the trainer's labels. Unlabelled rows are not counted. */
export function checkLabels(queries: SampleQuery[], choices: Choices): { labelled: number; matching: number; mismatches: Mismatch[] } {
  let labelled = 0;
  let matching = 0;
  const mismatches: Mismatch[] = [];
  for (const q of queries) {
    const chosen = choices[q.id];
    if (!chosen) continue;
    labelled += 1;
    if (chosen === q.label) matching += 1;
    else mismatches.push({ id: q.id, chosen, trainer: q.label, note: q.note });
  }
  return { labelled, matching, mismatches };
}

export interface NewExample {
  label: string; // project label name
  text: string;
}

const norm = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/**
 * Examples to add for the labelled rows, skipping any text already under that label in the project
 * (so grouping twice adds nothing). Unlabelled rows are skipped. Never removes anything.
 */
export function examplesToAdd(
  queries: SampleQuery[],
  choices: Choices,
  existing: { label: string; texts: string[] }[],
): NewExample[] {
  const have = new Set(existing.flatMap((l) => l.texts.map((t) => `${l.label}\u0000${norm(t)}`)));
  const out: NewExample[] = [];
  for (const q of queries) {
    const chosen = choices[q.id];
    if (!chosen) continue;
    const label = projectLabelName(chosen);
    const key = `${label}\u0000${norm(q.text)}`;
    if (have.has(key)) continue;
    have.add(key);
    out.push({ label, text: q.text.trim() });
  }
  return out;
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
