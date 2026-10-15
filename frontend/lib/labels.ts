/**
 * Label names (text and image projects). The same rule as the server (backend app/labels.py):
 * 1-50 characters after trimming, letters in any script (Tamil, Hindi, ...), digits, spaces, - _ &,
 * and no second label that differs only by case. Labels go into URLs (delete a label), so they are
 * always passed through encodeURIComponent there.
 */

export const LABEL_MAX = 50;
const LABEL_CHARS = /^[\p{L}\p{M}\p{N}\s\-_&]+$/u;

/** Why this label can't be used, or null when it can. */
export function labelProblem(name: string, existing: string[] = []): string | null {
  const label = name.trim();
  if (!label) return 'Enter a label name.';
  if (label.length > LABEL_MAX) return `A label can be at most ${LABEL_MAX} characters.`;
  if (!LABEL_CHARS.test(label)) return 'A label can use letters (any language), numbers, spaces, - _ and &.';
  const same = existing.find((l) => l.trim().toLowerCase() === label.toLowerCase());
  if (same !== undefined && same.trim() !== label) return `There is already a label called "${same}".`;
  return null;
}
