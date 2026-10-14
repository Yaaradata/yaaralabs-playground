/**
 * Splits a model answer into text, **bold** and citation pieces, so [2], [1, 3] and [2-4] become clickable chips.
 * Pure (no React), so the tests can check it. Mirrors rag_text.citations on the backend.
 */

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'cite'; n: number; ok: boolean };

const SPLIT = /(\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]|\*\*[^*\n]+\*\*)/g;

/** Numbers in one citation group: "[1, 3]" → [1, 3]; "[2-4]" → [2, 3, 4] (ranges up to 10 long). */
export function citeNumbers(group: string): number[] {
  const nums = (group.match(/\d+/g) || []).map(Number);
  if (/[–-]/.test(group) && nums.length === 2 && nums[1] - nums[0] > 0 && nums[1] - nums[0] < 10) {
    return Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => nums[0] + i);
  }
  return nums;
}

/** Pieces of an answer. `count` is how many passages exist; numbers outside 1..count are marked not ok. */
export function parseAnswer(text: string, count: number): Piece[] {
  const out: Piece[] = [];
  const src = (text || '').replace(/^(\s*)[*-]\s+/gm, '$1• ');
  for (const part of src.split(SPLIT)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push({ kind: 'bold', text: part.slice(2, -2) });
    } else if (/^\[\s*\d/.test(part)) {
      for (const n of citeNumbers(part)) out.push({ kind: 'cite', n, ok: n >= 1 && n <= count });
    } else {
      out.push({ kind: 'text', text: part });
    }
  }
  return out;
}

/** Unique cited numbers, in order (like rag_text.citations). */
export function citedNumbers(text: string): number[] {
  const seen: number[] = [];
  for (const p of parseAnswer(text, Number.MAX_SAFE_INTEGER)) {
    if (p.kind === 'cite' && !seen.includes(p.n)) seen.push(p.n);
  }
  return seen;
}
