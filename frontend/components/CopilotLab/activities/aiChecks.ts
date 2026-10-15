/**
 * "Your AI check": six questions for any task that depends on an AI answer. Shared by both Copilot labs.
 * Evidence lists the block ids in each lab that showed the question in action.
 */
import type { AiCheck } from '../types';

export const AI_CHECKS: AiCheck[] = [
  {
    id: 'input',
    title: 'What am I giving it?',
    text: 'Take out client names, account numbers and personal details before you paste. Once it’s in the chat, it has left your desk.',
    evidence: { ethics: ['redact'] },
  },
  {
    id: 'facts',
    title: 'Does every fact exist?',
    text: 'Any rule, circular, date or number must trace back to a source you can open. Click the citation. No source, no use.',
    evidence: { ethics: ['circ1', 'circ2'], 'document-ai': ['record', 'amount'] },
  },
  {
    id: 'missing',
    title: 'What’s not there?',
    text: 'Look for what the AI filled in that the document never said: a payment date, an ISIN, a clean answer to an open question.',
    evidence: { 'document-ai': ['paydate', 'fields'] },
  },
  {
    id: 'conflict',
    title: 'Does it contradict itself?',
    text: 'Two codes, two dates, “recommended” vs “declared”. The AI often smooths conflicts over instead of flagging them.',
    evidence: { 'document-ai': ['traps'] },
  },
  {
    id: 'action',
    title: 'Is it doing something only a person should?',
    text: 'Bank changes, payments, approvals and promises to a client stay with a person, however it’s asked.',
    evidence: { ethics: ['bank', 'push'], 'document-ai': ['cond'] },
  },
  {
    id: 'signoff',
    title: 'Who signs off?',
    text: 'A named person reads it before it reaches a client or a system, and can say why it was right.',
    evidence: { ethics: ['decide'], 'document-ai': ['decide'] },
  },
];
