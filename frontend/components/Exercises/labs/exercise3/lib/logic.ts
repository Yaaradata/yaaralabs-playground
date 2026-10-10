/** Confusion-matrix lab: scenarios, formulas, and scoring. Ported from the exercise prototype. */

export type CountKey = 'tp' | 'fn' | 'fp' | 'tn' | 'ap' | 'an' | 'pp' | 'pn' | 'n';
export type Piece = 'tp' | 'fn' | 'fp' | 'tn' | 'P' | 'R';
export type ChallengeKey = 'acc' | 'prec' | 'rec' | 'spec' | 'f1' | 'mcc';

export interface Counts {
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  ap: number;
  an: number;
  pp: number;
  pn: number;
  n: number;
}

export interface Domain {
  k: string;
  intro: string;
  tag: string;
  name: string;
  pos: string;
  hPP: string;
  hPN: string;
  hAP: string;
  hAN: string;
  n: [number, number, number];
  prev: [number, number];
  rec: [number, number];
  spec: [number, number];
  s: Record<string, string>;
  d: [string, number, number][];
}

export interface StoryLine {
  k: string;
  html: string;
  val: number | null;
}

export interface Scenario {
  dom: Domain;
  v: Counts;
  lines: StoryLine[];
}

export interface Family {
  b: string[];
  req: string[][];
}

export interface ChallengeDef {
  k: ChallengeKey;
  name: string;
  sub?: string;
  what: string;
  needs?: ChallengeKey[];
  bags: Record<string, number>;
  fam: Family[];
  value: (m: Counts) => number;
}

export const ORDER: CountKey[] = ['n', 'ap', 'an', 'pp', 'pn', 'tp', 'fn', 'fp', 'tn'];
export const INNER: Array<'tp' | 'fn' | 'fp' | 'tn'> = ['tp', 'fn', 'fp', 'tn'];
export const CELLS: CountKey[][] = [
  ['tp', 'fn', 'ap'],
  ['fp', 'tn', 'an'],
  ['pp', 'pn', 'n'],
];
export const NAME: Record<string, string> = {
  tp: 'TP',
  fn: 'FN',
  fp: 'FP',
  tn: 'TN',
  P: 'Precision',
  R: 'Recall',
};
export const SHORT: Record<ChallengeKey, string> = {
  acc: 'Accuracy',
  prec: 'Precision',
  rec: 'Recall',
  spec: 'Specificity',
  f1: 'F1',
  mcc: 'MCC',
};
export const PTS = { start: 100, drop: 10, pick: 20, peek: 30, min: 10 };

const SETS: CountKey[][] = [
  ['tp', 'fn', 'fp', 'tn'],
  ['n', 'ap', 'pp', 'tp'],
  ['n', 'ap', 'tp', 'fp'],
  ['n', 'pp', 'tp', 'fn'],
  ['ap', 'an', 'tp', 'tn'],
  ['n', 'an', 'pp', 'tn'],
];

export const DOMAINS: Domain[] = [
  {
    k: 'weld',
    intro: 'An AI camera on the assembly line inspected a batch of welded joints.',
    tag: 'Manufacturing',
    name: 'Weld inspection camera',
    pos: 'defective',
    hPP: 'Flagged defective',
    hPN: 'Passed as good',
    hAP: 'Actually defective',
    hAN: 'Actually good',
    n: [400, 1200, 50],
    prev: [0.06, 0.16],
    rec: [0.72, 0.95],
    spec: [0.86, 0.97],
    s: {
      n: 'An AI camera on the assembly line inspected {v} welded joints.',
      ap: '{v} of these joints were actually defective.',
      an: '{v} of them were actually good.',
      pp: 'Altogether, the camera flagged {v} joints as defective.',
      pn: 'It passed {v} joints as good.',
      tp: 'It flagged {v} defective joints as defective.',
      fn: 'It passed {v} defective joints as good.',
      fp: 'It flagged {v} good joints as defective.',
      tn: 'It passed {v} good joints as good.',
    },
    d: [
      ['The line ran for {v} shifts that week.', 3, 6],
      ['{v} inspectors re-checked every flagged joint by hand.', 2, 5],
    ],
  },
  {
    k: 'motor',
    intro: 'A predictive-maintenance model checked the motors in a plant.',
    tag: 'Maintenance',
    name: 'Motor failure prediction',
    pos: 'going to fail',
    hPP: 'Predicted to fail',
    hPN: 'Predicted healthy',
    hAP: 'Actually failed',
    hAN: 'Actually healthy',
    n: [150, 480, 10],
    prev: [0.08, 0.2],
    rec: [0.65, 0.92],
    spec: [0.8, 0.95],
    s: {
      n: 'A predictive-maintenance model checked {v} motors in a plant.',
      ap: 'Over the next month, {v} of these motors actually failed.',
      an: '{v} of them kept running without a problem.',
      pp: 'The model had predicted that {v} motors would fail.',
      pn: 'It predicted that {v} motors would stay healthy.',
      tp: '{v} of the motors it predicted would fail really did fail.',
      fn: '{v} motors it called healthy failed anyway.',
      fp: '{v} motors it predicted would fail kept running fine.',
      tn: '{v} motors it called healthy stayed healthy.',
    },
    d: [
      ["Each motor's sensors were read every {v} minutes.", 5, 30],
      ['The plant has {v} production lines.', 3, 9],
    ],
  },
  {
    k: 'spam',
    intro: "A spam filter sorted a day's emails at an office.",
    tag: 'Email',
    name: 'Spam filter',
    pos: 'spam',
    hPP: 'Sent to spam',
    hPN: 'Sent to inbox',
    hAP: 'Actually spam',
    hAN: 'Actually genuine',
    n: [300, 900, 10],
    prev: [0.22, 0.42],
    rec: [0.75, 0.95],
    spec: [0.88, 0.98],
    s: {
      n: 'A spam filter sorted {v} emails arriving at an office.',
      ap: '{v} of the emails were actually spam.',
      an: '{v} of them were genuine emails.',
      pp: 'It sent {v} emails to the spam folder in total.',
      pn: 'It let {v} emails through to the inbox.',
      tp: '{v} spam emails went to the spam folder.',
      fn: '{v} spam emails got through to the inbox.',
      fp: '{v} genuine emails went to the spam folder by mistake.',
      tn: '{v} genuine emails reached the inbox.',
    },
    d: [
      ['The office has {v} employees.', 20, 80],
      ['The emails arrived over {v} days.', 2, 7],
    ],
  },
  {
    k: 'fraud',
    intro: "A fraud-detection model scored an evening's card payments.",
    tag: 'Banking',
    name: 'Card fraud detection',
    pos: 'fraudulent',
    hPP: 'Blocked as fraud',
    hPN: 'Approved',
    hAP: 'Actually fraud',
    hAN: 'Actually genuine',
    n: [1500, 4000, 100],
    prev: [0.02, 0.06],
    rec: [0.6, 0.9],
    spec: [0.95, 0.995],
    s: {
      n: 'A fraud-detection model scored {v} card payments in one evening.',
      ap: '{v} of these payments were actually fraudulent.',
      an: '{v} of them were genuine.',
      pp: 'The model blocked {v} payments as fraud.',
      pn: 'It approved {v} payments.',
      tp: 'It blocked {v} fraudulent payments.',
      fn: 'It approved {v} fraudulent payments.',
      fp: 'It blocked {v} genuine payments by mistake.',
      tn: 'It approved {v} genuine payments.',
    },
    d: [
      ['The bank has {v} branches in the city.', 12, 60],
      ['Payments above ₹{v} were also sent for a text message check.', 5000, 9000],
    ],
  },
  {
    k: 'pcb',
    intro: 'An AI vision system checked the solder on a batch of circuit boards.',
    tag: 'Electronics',
    name: 'Circuit board solder check',
    pos: 'faulty',
    hPP: 'Rejected as faulty',
    hPN: 'Accepted',
    hAP: 'Actually faulty',
    hAN: 'Actually fine',
    n: [500, 1500, 50],
    prev: [0.05, 0.14],
    rec: [0.7, 0.94],
    spec: [0.88, 0.98],
    s: {
      n: 'An AI vision system checked the solder on {v} circuit boards.',
      ap: '{v} of the boards were actually faulty.',
      an: '{v} of them were fine.',
      pp: 'The system rejected {v} boards as faulty.',
      pn: 'It accepted {v} boards.',
      tp: 'It rejected {v} faulty boards.',
      fn: 'It accepted {v} faulty boards.',
      fp: 'It rejected {v} boards that were fine.',
      tn: 'It accepted {v} boards that were fine.',
    },
    d: [
      ['Each board has {v} solder joints.', 120, 400],
      ['The camera takes {v} photos of every board.', 2, 6],
    ],
  },
  {
    k: 'churn',
    intro: 'A churn model scored the customers of an online store.',
    tag: 'Retail',
    name: 'Customer churn prediction',
    pos: 'going to leave',
    hPP: 'Predicted to leave',
    hPN: 'Predicted to stay',
    hAP: 'Actually left',
    hAN: 'Actually stayed',
    n: [600, 2000, 50],
    prev: [0.1, 0.24],
    rec: [0.6, 0.88],
    spec: [0.8, 0.94],
    s: {
      n: 'A churn model scored {v} customers of an online store.',
      ap: 'By the end of the quarter, {v} of them had actually left.',
      an: '{v} of them stayed.',
      pp: 'The model had predicted that {v} customers would leave.',
      pn: 'It predicted that {v} customers would stay.',
      tp: '{v} customers it predicted would leave did leave.',
      fn: '{v} customers it expected to stay left anyway.',
      fp: '{v} customers it predicted would leave stayed.',
      tn: '{v} customers it expected to stay did stay.',
    },
    d: [
      ['The average order was worth ₹{v}.', 400, 1800],
      ['The store sells {v} different products.', 300, 900],
    ],
  },
];

export function precisionOf(m: Counts): number {
  return m.tp / (m.tp + m.fp);
}
export function recallOf(m: Counts): number {
  return m.tp / (m.tp + m.fn);
}
export function specificityOf(m: Counts): number {
  return m.tn / (m.tn + m.fp);
}
export function accuracyOf(m: Counts): number {
  return (m.tp + m.tn) / (m.tp + m.tn + m.fp + m.fn);
}
export function f1Of(m: Counts): number {
  // Graded from the 2-decimal precision and recall the student already found.
  const p = Number(f2(precisionOf(m)));
  const r = Number(f2(recallOf(m)));
  return (2 * p * r) / (p + r);
}
export function mccOf(m: Counts): number {
  return (
    (m.tp * m.tn - m.fp * m.fn) /
    Math.sqrt((m.tp + m.fp) * (m.tp + m.fn) * (m.tn + m.fp) * (m.tn + m.fn))
  );
}

export const CHALLENGES: ChallengeDef[] = [
  {
    k: 'acc',
    name: 'Accuracy',
    what: 'Overall correctness across both classes.',
    bags: { A: 2, B: 4 },
    fam: [
      { b: ['A'], req: [['tp', 'tn']] },
      { b: ['B'], req: [['tp', 'tn', 'fp', 'fn']] },
    ],
    value: accuracyOf,
  },
  {
    k: 'prec',
    name: 'Precision',
    what: 'Reliability of positive predictions (minimises false alarms).',
    bags: { A: 1, B: 2 },
    fam: [
      { b: ['A'], req: [['tp']] },
      { b: ['B'], req: [['tp', 'fp']] },
    ],
    value: precisionOf,
  },
  {
    k: 'rec',
    name: 'Recall',
    sub: 'Sensitivity',
    what: 'Ability to find all true positive cases (minimises missed cases).',
    bags: { A: 1, B: 2 },
    fam: [
      { b: ['A'], req: [['tp']] },
      { b: ['B'], req: [['tp', 'fn']] },
    ],
    value: recallOf,
  },
  {
    k: 'spec',
    name: 'Specificity',
    what: 'Ability to correctly identify negative cases.',
    bags: { A: 1, B: 2 },
    fam: [
      { b: ['A'], req: [['tn']] },
      { b: ['B'], req: [['tn', 'fp']] },
    ],
    value: specificityOf,
  },
  {
    k: 'f1',
    name: 'F1 score',
    what: 'Harmonic balance between Precision and Recall.',
    needs: ['prec', 'rec'],
    bags: { A: 2, B: 2 },
    fam: [
      { b: ['A'], req: [['P', 'R']] },
      { b: ['B'], req: [['P', 'R']] },
    ],
    value: f1Of,
  },
  {
    k: 'mcc',
    name: 'MCC',
    sub: 'Matthews correlation coefficient',
    what: 'Overall model quality, highly resilient to heavily imbalanced datasets.',
    bags: { A: 2, B: 2, C: 2, D: 2, E: 2, F: 2 },
    fam: [
      { b: ['A'], req: [['tp', 'tn']] },
      { b: ['B'], req: [['fp', 'fn']] },
      {
        b: ['C', 'D', 'E', 'F'],
        req: [
          ['tp', 'fp'],
          ['tp', 'fn'],
          ['tn', 'fp'],
          ['tn', 'fn'],
        ],
      },
    ],
    value: mccOf,
  },
];

export function challengeByKey(k: ChallengeKey): ChallengeDef {
  const found = CHALLENGES.find((c) => c.k === k);
  if (!found) throw new Error(`Unknown challenge ${k}`);
  return found;
}

/** The four choices in the rapid-fire round that follows MCC. */
export type RapidMetric = 'prec' | 'rec' | 'f1' | 'acc';

export interface RapidQuestion {
  id: string;
  ask: (pos: string) => string;
  answer: RapidMetric;
  why: string;
}

export const RAPID_CHOICES: { k: RapidMetric; label: string }[] = [
  { k: 'prec', label: 'Precision' },
  { k: 'rec', label: 'Recall' },
  { k: 'f1', label: 'F1 score' },
  { k: 'acc', label: 'Accuracy' },
];

export const RAPID_QUESTIONS: RapidQuestion[] = [
  {
    id: 'alarms',
    ask: (pos) =>
      `False alarms are costly. When the model says “${pos}”, that call should be right most of the time. Which metric is that?`,
    answer: 'prec',
    why: 'Precision is the share of positive flags that were actually right.',
  },
  {
    id: 'misses',
    ask: (pos) =>
      `Missing a real “${pos}” case is the worst outcome. You need the model to catch nearly all of them. Which metric is that?`,
    answer: 'rec',
    why: 'Recall is the share of real positive cases the model found.',
  },
  {
    id: 'overall',
    ask: () =>
      'Both classes are common, and every correct call counts the same. You want the share of all cases the model got right. Which metric is that?',
    answer: 'acc',
    why: 'Accuracy counts every correct prediction, positive or negative, over all cases.',
  },
  {
    id: 'balance',
    ask: () =>
      'Precision and Recall both matter. A model that is strong at only one of them should score poorly. Which metric is that?',
    answer: 'f1',
    why: 'F1 stays low unless Precision and Recall are both strong.',
  },
];

export function rapidLabel(k: RapidMetric): string {
  switch (k) {
    case 'prec':
      return 'Precision';
    case 'rec':
      return 'Recall';
    case 'f1':
      return 'F1 score';
    case 'acc':
      return 'Accuracy';
    default: {
      const _never: never = k;
      return _never;
    }
  }
}

export function isRapidMetric(s: string): s is RapidMetric {
  return s === 'prec' || s === 'rec' || s === 'f1' || s === 'acc';
}

export function starsOf(points: number): number {
  return points >= 90 ? 3 : points >= 60 ? 2 : 1;
}

export function f2(x: number): string {
  return (Math.round(x * 100) / 100).toFixed(2);
}
export function f4(x: number): string {
  return (Math.round(x * 10000) / 10000).toFixed(4);
}
export function fmtN(n: number): string {
  return n.toLocaleString('en-IN');
}
export function parseNum(s: string): number {
  const t = String(s).replace(/[,\s_]/g, '');
  return /^\d+$/.test(t) ? +t : NaN;
}

function rnd(a: number, b: number, rng: () => number): number {
  return a + rng() * (b - a);
}
function rint(a: number, b: number, rng: () => number): number {
  return Math.floor(rnd(a, b + 1, rng));
}
function pick<T>(a: readonly T[], rng: () => number): T {
  return a[Math.floor(rng() * a.length)];
}
function distractorValue(
  da: number,
  db: number,
  unit: number,
  used: ReadonlySet<number>,
  rng: () => number,
): number {
  const lo = Math.ceil(da / unit) * unit;
  const hi = Math.floor(db / unit) * unit;
  for (let i = 0; i < 24; i++) {
    const dv = Math.round(rint(da, db, rng) / unit) * unit;
    if (!used.has(dv)) return dv;
  }
  for (let dv = lo; dv <= hi; dv += unit) {
    if (!used.has(dv)) return dv;
  }
  return Math.round(rint(da, db, rng) / unit) * unit;
}

function shuffle<T>(a: readonly T[], rng: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function createScenario(rng: () => number = Math.random, avoidKey?: string): Scenario {
  const dom = pick(
    DOMAINS.filter((d) => d.k !== avoidKey),
    rng,
  );
  const step = dom.n[2];
  const n = Math.round(rnd(dom.n[0], dom.n[1], rng) / step) * step;
  const ap = Math.max(6, Math.round(n * rnd(dom.prev[0], dom.prev[1], rng)));
  const an = n - ap;
  const tp = Math.min(ap - 2, Math.max(3, Math.round(ap * rnd(dom.rec[0], dom.rec[1], rng))));
  const fn = ap - tp;
  const tn = Math.min(an - 3, Math.max(3, Math.round(an * rnd(dom.spec[0], dom.spec[1], rng))));
  const fp = an - tn;
  const v: Counts = { tp, fn, fp, tn, ap, an, pp: tp + fp, pn: fn + tn, n };
  const set = pick(SETS, rng);
  const lines: StoryLine[] = ORDER.filter((k) => set.includes(k)).map((k) => ({
    k,
    html: dom.s[k],
    val: v[k],
  }));
  if (!set.includes('n')) lines.unshift({ k: 'i', html: dom.intro, val: null });
  const used = new Set(Object.values(v));
  let distractor = pick(dom.d, rng);
  let [dt, da, db] = distractor;
  let unit = db > 1000 ? 100 : 1;
  let dv = distractorValue(da, db, unit, used, rng);
  if (used.has(dv)) {
    const other = dom.d.find((d) => d !== distractor);
    if (other) {
      distractor = other;
      [dt, da, db] = other;
      unit = db > 1000 ? 100 : 1;
      dv = distractorValue(da, db, unit, used, rng);
    }
  }
  const spots: number[] = [];
  for (let p = 1; p <= lines.length; p++) {
    if (p === lines.length || !['ap', 'an'].includes(lines[p].k)) spots.push(p);
  }
  lines.splice(pick(spots, rng), 0, { k: 'x', html: dt, val: dv });
  return { dom, v, lines };
}

/** True when the pieces already in the bags can still become a correct formula. */
export function placementOk(fam: Family[], slots: Record<string, ({ t: string } | null)[]>): boolean {
  return fam.every((f) =>
    perms(f.req.length).some((p) =>
      f.b.every((bb, j) => fits((slots[bb] || []).filter((x): x is { t: string } => Boolean(x)).map((x) => x.t), f.req[p[j]])),
    ),
  );
}

function fits(have: string[], need: string[]): boolean {
  const rest = [...need];
  for (const t of have) {
    const i = rest.indexOf(t);
    if (i < 0) return false;
    rest.splice(i, 1);
  }
  return true;
}

const PERM_CACHE = new Map<number, number[][]>();
function perms(n: number): number[][] {
  const hit = PERM_CACHE.get(n);
  if (hit) return hit;
  const out: number[][] = [];
  const go = (a: number[], rest: number[]) => {
    if (!rest.length) {
      out.push(a);
      return;
    }
    rest.forEach((x, i) => go(a.concat(x), rest.filter((_, j) => j !== i)));
  };
  go([], [...Array(n).keys()]);
  PERM_CACHE.set(n, out);
  return out;
}

/** The true value plus three nearby slips, shown to two decimal places. */
export function makeOpts(k: ChallengeKey, m: Counts, rng: () => number = Math.random): string[] {
  const t = challengeByKey(k).value(m);
  const p = precisionOf(m);
  const r = recallOf(m);
  const n = m.tp + m.tn + m.fp + m.fn;
  const pool = [
    p,
    r,
    specificityOf(m),
    m.tn / (m.tn + m.fn),
    accuracyOf(m),
    m.fp / (m.fp + m.tn),
    m.fn / (m.tp + m.fn),
    m.tp / n,
    (m.tp + m.fp) / n,
    f1Of(m),
    (p + r) / 2,
    p * r,
    mccOf(m),
    (m.tp * m.tn - m.fp * m.fn) / ((m.tp + m.fp) * (m.tn + m.fn)),
    m.tp / (m.tp + m.fp + m.fn),
    t * 0.9,
    t * 1.08,
    t - 0.07,
    t + 0.06,
  ].filter((x) => Number.isFinite(x) && x > -1 && x <= 1);
  const out = [+f2(t)];
  const ranked = shuffle(pool, rng)
    .sort((a, b) => Math.abs(a - t) - Math.abs(b - t))
    .slice(0, 12);
  const mixed = ranked.sort(() => rng() - 0.5);
  for (const x of mixed) {
    const v = +f2(x);
    if (out.every((o) => Math.abs(o - v) >= 0.02)) out.push(v);
    if (out.length === 4) break;
  }
  let d = 0.05;
  let guard = 0;
  while (out.length < 4 && guard < 40) {
    for (const sign of [1, -1]) {
      if (out.length >= 4) break;
      const v = +f2(t + sign * d);
      if (v > -1 && v <= 1 && out.every((o) => Math.abs(o - v) >= 0.02)) out.push(v);
    }
    d += 0.03;
    guard += 1;
  }
  return shuffle(out, rng).map((v) => v.toFixed(2));
}

export function countsBalance(v: Counts): boolean {
  return (
    v.tp + v.fn === v.ap &&
    v.fp + v.tn === v.an &&
    v.tp + v.fp === v.pp &&
    v.fn + v.tn === v.pn &&
    v.ap + v.an === v.n &&
    v.pp + v.pn === v.n &&
    v.tp > 0 &&
    v.fn > 0 &&
    v.fp > 0 &&
    v.tn > 0
  );
}

/** Fixed sample used to check the six formulas. */
export function assertMetricsSample(): void {
  const m: Counts = { tp: 16, fn: 4, fp: 10, tn: 70, ap: 20, an: 80, pp: 26, pn: 74, n: 100 };
  const expect: Record<ChallengeKey, string> = {
    acc: '0.86',
    prec: '0.62',
    rec: '0.80',
    spec: '0.88',
    f1: '0.70',
    mcc: '0.62',
  };
  (Object.keys(expect) as ChallengeKey[]).forEach((k) => {
    const got = f2(challengeByKey(k).value(m));
    if (got !== expect[k]) throw new Error(`${k} expected ${expect[k]} got ${got}`);
  });
  const prec = CHALLENGES[1];
  const empty: Record<string, ({ t: string } | null)[]> = { A: [null], B: [null, null] };
  if (!placementOk(prec.fam, empty)) throw new Error('empty precision bags should still be open');
  const bad = { A: [{ t: 'tn' }], B: [null, null] };
  if (placementOk(prec.fam, bad)) throw new Error('TN is not the precision numerator');
  const good = { A: [{ t: 'tp' }], B: [{ t: 'fp' }, { t: 'tp' }] };
  if (!placementOk(prec.fam, good)) throw new Error('TP / (FP + TP) is precision');
  for (let i = 0; i < 40; i++) {
    const sc = createScenario(() => {
      const x = Math.sin(i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    });
    if (!countsBalance(sc.v)) throw new Error(`unbalanced scenario ${sc.dom.k}`);
    const stated = new Set(sc.lines.filter((l) => l.k !== 'x' && l.k !== 'i').map((l) => l.k));
    if (stated.size < 4) throw new Error('scenario should state four matrix facts');
    if (!sc.lines.some((l) => l.k === 'x')) throw new Error('scenario should include a distractor');
    const extra = sc.lines.find((l) => l.k === 'x')?.val;
    if (extra != null && Object.values(sc.v).includes(extra)) {
      throw new Error(`distractor ${extra} matches a matrix cell in ${sc.dom.k}`);
    }
    const pieceP = Number(f2(precisionOf(sc.v)));
    const pieceR = Number(f2(recallOf(sc.v)));
    const fromPieces = f2((2 * pieceP * pieceR) / (pieceP + pieceR));
    if (f2(f1Of(sc.v)) !== fromPieces) throw new Error(`f1 pieces disagree: ${fromPieces}`);
    (['acc', 'prec', 'rec', 'spec', 'f1', 'mcc'] as ChallengeKey[]).forEach((k) => {
      const opts = makeOpts(k, sc.v, () => 0.37);
      if (opts.length !== 4) throw new Error(`${k} options ${opts.length}`);
      if (!opts.includes(f2(challengeByKey(k).value(sc.v)))) throw new Error(`${k} options missing truth`);
    });
  }
  const hi: Counts = { tp: 8, fn: 2, fp: 2, tn: 400, ap: 10, an: 402, pp: 10, pn: 402, n: 412 };
  const hiOpts = makeOpts('spec', hi, () => 0.2);
  if (hiOpts.length !== 4 || !hiOpts.includes(f2(specificityOf(hi)))) {
    throw new Error(`high specificity options failed: ${hiOpts.join(',')}`);
  }
  if (RAPID_QUESTIONS.length !== 4) throw new Error('rapid fire should ask four questions');
  const rapidAnswers = new Set(RAPID_QUESTIONS.map((q) => q.answer));
  if (rapidAnswers.size !== RAPID_CHOICES.length) throw new Error('each rapid-fire choice should be the answer once');
  RAPID_QUESTIONS.forEach((q) => {
    if (!q.ask('spam').trim() || !q.why.trim()) throw new Error(`rapid question ${q.id} is empty`);
  });
}
