/** Scoring for the Copilot labs. Pure (no React), so scripts/test-copilot-lab.ts can check it. */
import type {
  Activity,
  AiCheck,
  Answers,
  AnsweredBlock,
  Block,
  ChecklistAnswer,
  ChecklistBlock,
  FieldCheckAnswer,
  FieldCheckBlock,
  NotesAnswer,
  Step,
  Tone,
} from './types';

export interface Result {
  tone: Tone;
  text: string;
}

export const WORST: Record<Tone, number> = { bad: 3, partial: 2, good: 1, none: 0 };
export const TONE_LABEL: Record<Tone, string> = { good: 'Held', partial: 'Partly', bad: 'Slipped', none: '—' };

/** Held when all were caught, partly at 70% or more, slipped below. */
export function checklistTone(n: number, total: number): Tone {
  return n === total ? 'good' : n / total >= 0.7 ? 'partial' : 'bad';
}

/** Rows where the participant's mark equals the key: Copilot got those right. */
export function fieldScore(b: FieldCheckBlock, ans?: FieldCheckAnswer): { ok: number; marked: number } {
  const marks = ans?.marks || {};
  return { ok: b.rows.filter((r, i) => marks[i] === r.key).length, marked: Object.keys(marks).length };
}

export function blockResult(b: Block, answers: Answers): Result {
  if (!('id' in b)) return { tone: 'none', text: '' };
  const ans = answers[b.id];
  if (b.type === 'checklist' || b.type === 'reveal') {
    const a = ans as ChecklistAnswer | undefined;
    if (!a?.done) return { tone: 'none', text: 'Not done yet' };
    const n = (a.ticked || []).length;
    const verb = b.type === 'reveal' ? 'Found' : 'Caught';
    return { tone: checklistTone(n, b.items.length), text: `${verb} ${n} of ${b.items.length}${a.bonus ? ' + the bonus' : ''}` };
  }
  if (b.type === 'choice') {
    if (typeof ans !== 'number' || !b.options[ans]) return { tone: 'none', text: 'Not answered' };
    const o = b.options[ans];
    return { tone: o.v, text: o.label };
  }
  if (b.type === 'fieldcheck') {
    const { ok, marked } = fieldScore(b, ans as FieldCheckAnswer | undefined);
    if (marked < b.rows.length) return { tone: 'none', text: 'Not done yet' };
    const miss = b.rows.length - ok;
    return { tone: miss === 0 ? 'good' : miss <= 2 ? 'partial' : 'bad', text: `Got ${ok} of ${b.rows.length}` };
  }
  if (b.type === 'notes') {
    const filled = ((ans as NotesAnswer | undefined) || []).filter((x) => x && x.trim()).length;
    return { tone: filled ? 'good' : 'none', text: filled ? 'Written down' : 'Not written yet' };
  }
  return { tone: 'none', text: '' };
}

export function blockAnswered(b: Block, answers: Answers): boolean {
  if (b.type === 'text' || b.type === 'prompt' || b.type === 'download') return true;
  return blockResult(b, answers).tone !== 'none';
}

/** A step is done once every checklist, choice, field check and notes block in it has an answer. */
export function stepDone(step: Step, answers: Answers): boolean {
  return step.blocks.every((b) => blockAnswered(b, answers));
}

export function completedSteps(act: Activity, answers: Answers): string[] {
  return act.steps.filter((s) => stepDone(s, answers)).map((s) => s.id);
}

export function allBlocks(act: Activity): Block[] {
  return act.steps.flatMap((s) => s.blocks);
}

export function scoredBlocks(act: Activity): Exclude<AnsweredBlock, { type: 'notes' }>[] {
  return allBlocks(act).filter(
    (b): b is Exclude<AnsweredBlock, { type: 'notes' }> =>
      b.type === 'checklist' || b.type === 'reveal' || b.type === 'choice' || b.type === 'fieldcheck',
  );
}

export function tally(act: Activity, answers: Answers): Record<Tone, number> {
  const t: Record<Tone, number> = { good: 0, partial: 0, bad: 0, none: 0 };
  for (const b of scoredBlocks(act)) t[blockResult(b, answers).tone] += 1;
  return t;
}

/** The result card as plain text, for pasting into the training chat. */
export function resultText(act: Activity, answers: Answers): string {
  const t = tally(act, answers);
  const notes = allBlocks(act).filter((b) => b.type === 'notes');
  return [
    `${act.title}`,
    `${t.good} held · ${t.partial} partly · ${t.bad} slipped`,
    '',
    ...scoredBlocks(act).map((b) => {
      const r = blockResult(b, answers);
      return `${b.label}: ${r.text} (${TONE_LABEL[r.tone]})`;
    }),
    '',
    ...notes.flatMap((b) => b.type === 'notes' ? b.boxes.map((l, i) => `${l}: ${((answers[b.id] as NotesAnswer | undefined) || [])[i]?.trim() || '—'}`) : []),
    '',
    `Point to land: ${act.point}`,
  ].join('\n');
}

/** One AI check's evidence from this lab, and the worst tone among it (the card's border). */
export function checkEvidence(check: AiCheck, act: Activity, answers: Answers) {
  const byId = Object.fromEntries(allBlocks(act).filter((b) => 'id' in b).map((b) => [(b as ChecklistBlock).id, b]));
  const ids = check.evidence[act.id] || [];
  const lines = ids
    .filter((id) => byId[id])
    .map((id) => {
      const b = byId[id] as AnsweredBlock;
      return { id, label: b.label || 'Your notes', ...blockResult(b, answers) };
    });
  const worst = lines.reduce<Tone>((w, x) => (WORST[x.tone] > WORST[w] ? x.tone : w), 'none');
  return { lines, worst };
}

export function aiChecksText(checks: AiCheck[]): string {
  return ['Your AI check: six questions for any AI task', ...checks.map((c, i) => `${i + 1}. ${c.title} ${c.text}`)].join('\n');
}
