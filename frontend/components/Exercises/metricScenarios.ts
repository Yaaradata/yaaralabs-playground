export type MetricChoice = 'precision' | 'recall' | 'f1';

export interface MetricReason {
  id: string;
  correct: boolean;
  text: string;
}

export interface MetricScenario {
  id: string;
  packId: string;
  target: string;
  title: string;
  blurb: string;
  fpCost: string;
  fnCost: string;
  answer: MetricChoice;
  why: string;
  reasons: MetricReason[];
}

// Authoring rule: only write a scenario for a class where one mistake clearly
// costs more than the other. If a miss and a false alarm cost about the same,
// there is no right metric — skip that class. Every scenario must give the
// false-positive cost, the false-negative cost, and the worse one → the metric.
// Add remaining packs (MECH, ECE, CSE, IT, CHEM, AERO, AUTO, BME) later using
// this same shape.
export const METRIC_JUDGE_SCENARIOS: readonly MetricScenario[] = [
  {
    id: 'eee-fire',
    packId: 'EEE',
    target: 'Fault',
    answer: 'recall',
    title: 'Auto-route fault notes to the shift crew',
    blurb:
      'Notes are classified and the Fault ones — shorts and trips that can cascade — are sent to the shift electrician.',
    fpCost: 'A technician is dispatched, checks the gear, finds nothing. A few wasted hours.',
    fnCost: 'A real short is left in service. It can cascade into a fire or a wide outage.',
    why: 'A miss can cause a fire; a false alarm only wastes time. When misses cost far more, optimise recall — catch every real fault.',
    reasons: [
      {
        id: 'a',
        correct: true,
        text: 'A missed Fault can cause a fire, so catching every real one matters more than the occasional false alarm.',
      },
      { id: 'b', correct: false, text: 'Fault precision is already high, so keep pushing precision up.' },
      { id: 'c', correct: false, text: 'False alarms waste technician time, so cutting them is the priority.' },
      { id: 'd', correct: false, text: 'Accuracy is fine, so no single metric needs attention.' },
    ],
  },
  {
    id: 'eee-team',
    packId: 'EEE',
    target: 'Fault',
    answer: 'precision',
    title: 'Same routing — but the crew is 2 people',
    blurb:
      'Same classifier, but only two electricians cover the whole grid and every ticket is hours of field work. Severe faults are also caught by a separate SCADA alarm layer.',
    fpCost: "A wrong Fault ticket burns the tiny team's limited hours on a non-issue, so real work waits.",
    fnCost: 'A miss here is usually caught by the separate SCADA alarms, so it rarely goes unnoticed.',
    why: 'Here a false positive is the expensive error — it drains a 2-person team — while misses are backstopped by SCADA. When false alarms cost more, optimise precision. Same class as the fire scenario, opposite metric, because the cost of the errors changed.',
    reasons: [
      {
        id: 'a',
        correct: true,
        text: "The crew is tiny; every wrong ticket burns hours they don't have, so being right when we flag matters most.",
      },
      { id: 'b', correct: false, text: 'We must catch every possible fault, so recall is the priority.' },
      { id: 'c', correct: false, text: 'Fault recall is only 73%, so recall is always the metric to fix.' },
      { id: 'd', correct: false, text: 'F1 balances both, so it is always the safest choice.' },
    ],
  },
  {
    id: 'eee-thermal',
    packId: 'EEE',
    target: 'Fault',
    answer: 'f1',
    title: 'Same-shift feeder triage',
    blurb:
      'Fault notes flag a feeder that may need a stop. A missed finding and a false trip are both moderately costly and roughly comparable.',
    fpCost: 'A false alarm forces an unnecessary shutdown and inspection — real money, but recoverable.',
    fnCost: 'A missed finding lets the feeder keep running hot — damage builds over time, but not instantly catastrophic.',
    why: 'Both errors hurt about equally — a needless shutdown vs slow equipment damage. When the two mistakes cost about the same, optimise F1, the balance of precision and recall.',
    reasons: [
      {
        id: 'a',
        correct: true,
        text: 'A missed finding damages equipment and a false alarm forces a costly shutdown — both hurt about equally, so balance precision and recall.',
      },
      { id: 'b', correct: false, text: 'Missing a finding is catastrophic, so only recall matters.' },
      { id: 'c', correct: false, text: 'Shutdowns are expensive, so only precision matters.' },
      { id: 'd', correct: false, text: 'Just pick whichever metric is the highest number.' },
    ],
  },
  {
    id: 'civil-safety',
    packId: 'CIVIL',
    target: 'unsafe',
    answer: 'recall',
    title: 'Flag site notes describing unsafe structures for inspection',
    blurb: 'Each note is labelled safe or unsafe. The unsafe ones are escalated for a structural inspection.',
    fpCost: 'A safe structure is flagged unsafe → an unnecessary, expensive shutdown and inspection.',
    fnCost: 'An unsafe structure is called safe → it stays in use and can collapse, risking lives.',
    why: 'A miss can get someone killed; a false alarm costs money. When a miss is far worse, optimise recall — catch every truly-unsafe structure, even at the cost of extra false alarms.',
    reasons: [
      {
        id: 'a',
        correct: true,
        text: 'A missed unsafe structure risks lives, so catching every real one matters more than a few unnecessary shutdowns.',
      },
      { id: 'b', correct: false, text: 'Shutdowns are expensive, so we should reduce false alarms first.' },
      { id: 'c', correct: false, text: "The model's accuracy is high, so no metric needs attention." },
      { id: 'd', correct: false, text: "F1 is balanced, so it's the safe default here." },
    ],
  },
];
