/**
 * Document AI: read a dividend notice. Runs in Microsoft Copilot; the Playground is the worksheet.
 * The notice (public/datasets/copilot/Seabird_dividend_notice_TRAINING.pdf, made by scripts/make_seabird_notice.py)
 * has four traps: two BSE codes (543210 address, 543201 table), no ISIN, no fixed payment date, and an Annexure A
 * that isn't attached. Block ids (amount, record, paydate, cond, fields, traps, decide) are used by aiChecks.ts.
 */
import type { Activity } from '../types';

export const NOTICE_HREF = '/datasets/copilot/Seabird_dividend_notice_TRAINING.pdf';

export const DOC_AI: Activity = {
  id: 'document-ai',
  title: 'Document AI: read a dividend notice',
  point: 'The AI reads fast. The risk is in what’s missing or doesn’t match. A person signs off.',
  // Step 4 and the closing pages stay here (content, scoring, saved answers) but are not shown for now
  hidden: { steps: ['s4'], result: true, aiCheck: true },
  steps: [
    {
      id: 's1',
      title: 'Read',
      blocks: [
        {
          type: 'text',
          text: 'Download the dividend notice (the company is made up). In a **new** Copilot chat, attach it with the **+** button, then send the prompt.',
        },
        { type: 'download', name: 'Seabird_dividend_notice_TRAINING.pdf', size: '1 page · PDF · 74 KB', href: NOTICE_HREF },
        {
          type: 'prompt',
          hint: 'Attach the notice first, then paste this.',
          text: 'A client holds 1,000 shares of this company. In 3 lines: what will they get, and when?',
        },
        {
          type: 'choice',
          id: 'amount',
          label: 'Amount',
          q: 'Amount',
          options: [
            { label: 'Rs 4,500, and said tax may be deducted', v: 'good' },
            { label: 'Rs 4,500, no mention of tax', v: 'partial' },
            { label: 'Wrong amount', v: 'bad' },
          ],
        },
        {
          type: 'choice',
          id: 'record',
          label: 'Record date',
          q: 'Record date',
          options: [
            { label: '6 Nov 2026', v: 'good' },
            { label: 'Another date or none', v: 'bad' },
          ],
        },
        {
          type: 'choice',
          id: 'paydate',
          label: 'Payment date',
          q: 'Payment date',
          options: [
            { label: 'Said it isn’t fixed yet', v: 'good' },
            { label: 'Gave an exact payment date', v: 'bad' },
          ],
        },
        {
          type: 'choice',
          id: 'cond',
          label: 'Condition',
          q: 'Condition',
          options: [
            { label: 'Said it depends on shareholder approval at the AGM', v: 'good' },
            { label: 'Presented the dividend as certain', v: 'bad' },
          ],
        },
      ],
    },
    {
      id: 's2',
      title: 'Extract',
      blocks: [
        {
          type: 'prompt',
          hint: 'Same chat.',
          text: 'Extract these fields from the notice as a table. Write NOT IN DOCUMENT if a field is missing. Never guess.\nCompany name | NSE symbol | BSE code | ISIN | Dividend per share | Face value | Record date | AGM date | Payment date | Conditions',
        },
        { type: 'text', text: 'Check Copilot’s table against the notice yourself, then mark each row.' },
        {
          type: 'fieldcheck',
          id: 'fields',
          label: 'Fields extracted',
          rows: [
            { f: 'Company name', correct: 'Seabird Industries Limited', key: 'right' },
            { f: 'NSE symbol', correct: 'SEABIRD', key: 'right' },
            {
              f: 'BSE code',
              correct: 'The notice has two: 543210 (address) and 543201 (table). Right means Copilot showed both or flagged the conflict.',
              key: 'right',
            },
            { f: 'ISIN', correct: 'Not in the notice', key: 'missing' },
            { f: 'Dividend per share', correct: 'Rs 4.50', key: 'right' },
            { f: 'Face value', correct: 'Rs 2', key: 'right' },
            { f: 'Record date', correct: '6 Nov 2026', key: 'right' },
            { f: 'AGM date', correct: '20 Nov 2026', key: 'right' },
            { f: 'Payment date', correct: 'Not fixed: “within 30 days of the AGM” / “will be intimated separately”', key: 'missing' },
            { f: 'Conditions', correct: 'Subject to shareholder approval at the AGM', key: 'right' },
          ],
        },
      ],
    },
    {
      id: 's3',
      title: 'Find the problems',
      blocks: [
        { type: 'prompt', hint: 'Same chat.', text: 'List anything in this notice that is missing, unclear or contradicts itself.' },
        {
          type: 'reveal',
          id: 'traps',
          label: 'Problems found',
          q: 'Copilot found…',
          items: ['Two different BSE codes (543210 and 543201)', 'No ISIN', 'No fixed payment date', 'Annexure A mentioned but not attached'],
          bonus: '“Recommended” in the text vs “if declared” in the table, so it isn’t final',
        },
      ],
    },
    {
      id: 's4',
      title: 'Decide',
      blocks: [
        {
          type: 'notes',
          id: 'decide',
          label: 'Your notes',
          boxes: ['Three things a person must check before telling the client “you’ll get Rs 4,500”'],
        },
      ],
    },
  ],
};
