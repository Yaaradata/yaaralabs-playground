import type { TextPrepConfig, TextRepresentation } from '../types';

export type { TextPrepConfig };

export type InspectRow = {
  review: string;
  label: string;
};

export const DEFAULT_TEXT_PREP: TextPrepConfig = {
  dropMissing: true,
  dropDuplicates: true,
  lowercase: true,
  stripNoise: true,
  stopwords: false,
  lemmatize: false,
};

export const INSPECT_SAMPLE_COUNT = 200;

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const STOP_WORDS = new Set(
  'a an and are as at be by for from has have i in is it its of on or that the this to was were will with you your my me we our us they them their all every very just so also really even still more most some any only first actually'.split(
    ' ',
  ),
);

const LEMMAS: Record<string, string> = {
  are: 'be',
  is: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  being: 'be',
  has: 'have',
  had: 'have',
  having: 'have',
  does: 'do',
  did: 'do',
  doing: 'do',
  thrown: 'throw',
  threw: 'throw',
  ran: 'run',
  running: 'run',
  said: 'say',
  went: 'go',
  going: 'go',
  got: 'get',
  getting: 'get',
};

export function parseTextPrep(value: unknown): TextPrepConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_TEXT_PREP };
  const raw = value as Partial<TextPrepConfig>;
  return {
    dropMissing: raw.dropMissing !== false,
    dropDuplicates: raw.dropDuplicates !== false,
    lowercase: raw.lowercase !== false,
    stripNoise: raw.stripNoise !== false,
    stopwords: raw.stopwords === true,
    lemmatize: raw.lemmatize === true,
  };
}

export function inspectLabelCounts(rows: InspectRow[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const name = row.label.trim() || '(empty)';
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

export function inspectMissing(rows: InspectRow[]): { emptyText: number; emptyLabel: number } {
  let emptyText = 0;
  let emptyLabel = 0;
  rows.forEach((row) => {
    if (!row.review.trim()) emptyText += 1;
    if (!row.label.trim()) emptyLabel += 1;
  });
  return { emptyText, emptyLabel };
}

export function inspectDuplicates(rows: InspectRow[]): { extra: number; groups: number; example: string | null } {
  const seen = new Map<string, number>();
  rows.forEach((row) => {
    const key = row.review.trim();
    if (!key) return;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  let extra = 0;
  let groups = 0;
  let example: string | null = null;
  seen.forEach((count, key) => {
    if (count < 2) return;
    groups += 1;
    extra += count - 1;
    if (!example) example = key.length > 140 ? `${key.slice(0, 137)}…` : key;
  });
  return { extra, groups, example };
}

export type PackInspectStats = {
  emptyText: number;
  emptyLabel: number;
  extra: number;
  groups: number;
  labelInText: number;
  mixedLabels: number;
  nRows: number;
};

export function parsePackInspect(raw: unknown): PackInspectStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (!('empty_text' in row) && !('extra' in row) && !('n_rows' in row)) return null;
  const num = (key: string) => {
    const value = Number(row[key]);
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  };
  return {
    emptyText: num('empty_text'),
    emptyLabel: num('empty_label'),
    extra: num('extra'),
    groups: num('groups'),
    labelInText: num('label_in_text'),
    mixedLabels: num('mixed_labels'),
    nRows: num('n_rows'),
  };
}

export function inspectLeakage(
  rows: InspectRow[],
  classes: string[],
): { labelInText: number; mixedLabels: number; examples: string[] } {
  const labels = classes.map((name) => name.trim()).filter(Boolean);
  const byText = new Map<string, Set<string>>();
  let labelInText = 0;
  const examples: string[] = [];
  rows.forEach((row) => {
    const text = row.review.trim();
    const label = row.label.trim();
    if (text && label) {
      const bucket = byText.get(text) || new Set<string>();
      bucket.add(label);
      byText.set(text, bucket);
    }
    if (!text || !label) return;
    const hay = ` ${text.toLowerCase()} `;
    const hit = labels.some((name) => {
      const needle = name.toLowerCase();
      if (needle.length < 3) return false;
      return hay.includes(` ${needle} `) || hay.includes(` ${needle}.`) || hay.includes(` ${needle},`);
    });
    if (!hit) return;
    labelInText += 1;
    if (examples.length < 3) examples.push(text.length > 140 ? `${text.slice(0, 137)}…` : text);
  });
  let mixedLabels = 0;
  byText.forEach((set) => {
    if (set.size > 1) mixedLabels += 1;
  });
  return { labelInText, mixedLabels, examples };
}

export function cleanNoteText(
  text: string,
  prep: TextPrepConfig,
  representation: TextRepresentation = 'tfidf',
): string {
  let next = (text || '').replace(/\u0000/g, '');
  if (prep.stripNoise) {
    next = next.replace(URL_RE, ' ');
    next = next.replace(EMOJI_RE, ' ');
    next = next.replace(/[^a-zA-Z0-9\s]/g, ' ');
  }
  if (prep.lowercase) next = next.toLowerCase();
  next = next.replace(/\s+/g, ' ').trim();
  const tfidfOnly = representation !== 'embeddings';
  if (!tfidfOnly || (!prep.stopwords && !prep.lemmatize) || !next) return next.slice(0, 4000);
  const tokens = next.split(' ').filter(Boolean).map((word) => {
    const lemma = tfidfOnly && prep.lemmatize ? lemmatizeToken(word) : word;
    return lemma;
  }).filter((word) => {
    if (!tfidfOnly || !prep.stopwords) return word.length > 0;
    return word.length > 1 && !STOP_WORDS.has(word);
  });
  const joined = tokens.join(' ').trim();
  return (joined || next).slice(0, 4000);
}

export function prepareLabeledRows(
  rows: InspectRow[],
  prep: TextPrepConfig,
  representation: TextRepresentation = 'tfidf',
): InspectRow[] {
  let next = rows.map((row) => ({ review: row.review || '', label: (row.label || '').trim() }));
  if (prep.dropMissing) {
    next = next.filter((row) => row.review.trim() && row.label);
  }
  if (prep.dropDuplicates) {
    const seen = new Set<string>();
    next = next.filter((row) => {
      const key = row.review.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return next
    .map((row) => ({
      review: cleanNoteText(row.review, prep, representation),
      label: row.label,
    }))
    .filter((row) => row.review && row.label);
}

function lemmatizeToken(word: string): string {
  if (LEMMAS[word]) return LEMMAS[word];
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}
