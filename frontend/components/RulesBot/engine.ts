/**
 * Rules Bot engine: keyword rules that route a message to a team.
 *
 * A keyword matches at the start of a word, any case ("settle" matches "settled").
 * Rules are checked in order; the first rule that matches fires.
 */

export interface Rule {
  id: string;
  desk: string;
  color: string;
  keywords: string[];
}

export interface NumberedRule extends Rule {
  no: number;
}

export interface RouteResult {
  id: string;
  no: number;
  desk: string;
  color: string;
  hits: string[];
  others: { no: number; desk: string }[];
}

export interface Segment {
  t: string;
  color?: string;
}

// Rule colours, brand first. Keep in sync with PALETTE in backend/app/services/rules_bot_service.py.
export const PALETTE = ['#9333EA', '#EC4899', '#B90ABD', '#3B82F6', '#06B6D4', '#F59E0B', '#10B981', '#F97316', '#6366F1', '#14B8A6'];

export const DEFAULT_REPLY = "Sorry, I didn't understand. A person will reply.";
export const MAX_RULES = 30;
export const MAX_KEYWORDS = 50;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const kwRe = (k: string, flags = 'i') => new RegExp('(^|[^a-z0-9])(' + esc(k.toLowerCase()) + ')', flags);

/** First rule that fires, plus any later rules that also matched. */
export function runRules(message: string, rules: NumberedRule[]): RouteResult | null {
  const fired: Omit<RouteResult, 'others'>[] = [];
  rules.forEach((r) => {
    const hits = r.keywords.filter((k) => kwRe(k).test(message));
    if (hits.length) fired.push({ id: r.id, no: r.no, desk: r.desk, color: r.color, hits });
  });
  return fired.length ? { ...fired[0], others: fired.slice(1).map((f) => ({ no: f.no, desk: f.desk })) } : null;
}

/** Split a message into plain and keyword-highlighted segments. */
export function markKeywords(message: string, rules: Rule[]): Segment[] {
  const marks: { s: number; e: number; color: string }[] = [];
  rules.forEach((r) =>
    r.keywords.forEach((k) => {
      const re = kwRe(k, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(message))) {
        const s = m.index + m[1].length;
        marks.push({ s, e: s + m[2].length, color: r.color });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    })
  );
  marks.sort((a, b) => a.s - b.s || b.e - a.e);
  const out: Segment[] = [];
  let p = 0;
  for (const mk of marks) {
    if (mk.s < p) continue;
    if (mk.s > p) out.push({ t: message.slice(p, mk.s) });
    out.push({ t: message.slice(mk.s, mk.e), color: mk.color });
    p = mk.e;
  }
  if (p < message.length) out.push({ t: message.slice(p) });
  return out;
}

/** Rules ready to run, keeping their board number (empty rules are skipped, not renumbered). */
export const activeRules = (rules: Rule[]): NumberedRule[] =>
  rules.map((r, i) => ({ ...r, no: i + 1 })).filter((r) => r.desk.trim() && r.keywords.length);

export const fingerprint = (rules: NumberedRule[], reply: string) =>
  JSON.stringify([rules.map((r) => [r.no, r.desk, r.keywords]), reply]);

export const newRuleId = () => 'r' + Math.random().toString(36).slice(2, 12);
