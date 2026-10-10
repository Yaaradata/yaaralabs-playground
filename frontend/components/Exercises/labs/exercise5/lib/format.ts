/** Colour tokens used by the canvas (CSS custom properties). */
export const LANG_COLORS: Record<string, string> = {
  cyan: 'var(--cyan)',
  mag: 'var(--mag)',
  amber: 'var(--amber)',
  vio: 'var(--vio)',
  grn: 'var(--grn)',
  org: 'var(--org)',
  blu: 'var(--blu)',
};

export const CFG_IDS = ['n-model', 'n-q', 'n-len', 'n-lang'] as const;
export type CfgId = (typeof CFG_IDS)[number];

export const CFG_NAMES: Record<CfgId, string> = {
  'n-model': 'Models',
  'n-q': 'Question',
  'n-len': 'Answer length',
  'n-lang': 'Languages',
};

export const DEFAULT_EDGES: [CfgId, CfgId][] = [
  ['n-model', 'n-q'],
  ['n-q', 'n-len'],
  ['n-len', 'n-lang'],
];

export const STORAGE_KEY = 'ex5-tokeniser-flow';

export function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

/** Format a USD amount for classroom cost panels. */
export function usd(v: number): string {
  if (v >= 1000) return `$${fmt(v)}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v >= 0.0001) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(6)}`;
}

export function wordCount(t: string): number {
  return t.trim() ? t.trim().split(/\s+/).length : 0;
}

export function charCount(t: string): number {
  return Array.from(t).length;
}
