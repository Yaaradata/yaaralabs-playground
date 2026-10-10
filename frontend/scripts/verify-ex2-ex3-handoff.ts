import { ex2ResultFromTrain } from '../components/Exercises/labs/ex2HeldOut';
import { departmentFocus } from '../components/Exercises/data/departmentCatalog';
import type { TfidfTestProb, TfidfTrainResult } from '../components/Exercises/types';

function flags(p: number, threshold: number) {
  const hundredths = Math.min(99, Math.max(1, Math.round(threshold * 100)));
  const thousandths = Math.min(999, Math.max(1, Math.round(p * 1000)));
  return thousandths >= hundredths * 10;
}

function matrixFromRule(rows: { y: number; p1: number }[], classes: [string, string], threshold: number, focus: string): number[][] {
  const focusIndex = classes.findIndex((name) => name.toLowerCase() === focus.toLowerCase());
  const other = focusIndex === 0 ? 1 : 0;
  const matrix = [
    [0, 0],
    [0, 0],
  ];
  rows.forEach((row) => {
    const pFocus = focusIndex === 1 ? row.p1 : 1 - row.p1;
    const pred = flags(pFocus, threshold) ? focusIndex : other;
    matrix[row.y][pred] += 1;
  });
  return matrix;
}

function focusCounts(matrix: number[][], k: number) {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let total = 0;
  matrix.forEach((row, i) => {
    row.forEach((cell, j) => {
      total += cell;
      if (i === k && j === k) tp += cell;
      else if (i === k) fn += cell;
      else if (j === k) fp += cell;
    });
  });
  const tn = total - tp - fn - fp;
  const prec = tp + fp > 0 ? tp / (tp + fp) : null;
  const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = prec && rec ? (2 * prec * rec) / (prec + rec) : 0;
  const acc = total ? (tp + tn) / total : 0;
  return { tp, fp, fn, tn, prec, rec, f1, acc, total };
}

function ex3Cells(classes: string[], matrix: number[][]) {
  return {
    labels: [classes[1], classes[0]],
    cells: [
      [matrix[1][1], matrix[1][0]],
      [matrix[0][1], matrix[0][0]],
    ],
  };
}

function ex2Cells(matrix: number[][]) {
  const tp = matrix[1][1];
  const fn = matrix[1][0];
  const fp = matrix[0][1];
  const tn = matrix[0][0];
  return [
    [tp, fn],
    [fp, tn],
  ];
}

function recount(pos: number[], neg: number[], threshold: number) {
  const cut = Math.round(threshold * 100);
  const flag = (p: number) => Math.min(999, Math.max(1, Math.round(p * 1000))) >= cut * 10;
  const tp = pos.filter(flag).length;
  const fn = pos.length - tp;
  const fp = neg.filter(flag).length;
  const tn = neg.length - fp;
  return { tp, fp, fn, tn };
}

function pct1(value: number | null) {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function check(name: string, datasetId: string, classes: [string, string], threshold: number, rows: { y: number; p1: number }[]) {
  const focus = departmentFocus(datasetId) || '';
  const matrix = matrixFromRule(rows, classes, threshold, focus);
  const testProbs: TfidfTestProb[] = rows.map((row) => ({
    y: row.y,
    p: row.p1,
    pred: row.p1 >= threshold ? 1 : 0,
    probs: [1 - row.p1, row.p1],
    label: classes[row.y],
    pred_label: classes[row.p1 >= threshold ? 1 : 0],
  }));
  const serverMatrix = [
    [0, 0],
    [0, 0],
  ];
  rows.forEach((row) => {
    serverMatrix[row.y][row.p1 >= threshold ? 1 : 0] += 1;
  });
  const trained = {
    classes,
    threshold,
    confusion_matrix: serverMatrix,
    test_probs: testProbs,
    model: { classes, vocab: ['note'] },
  } as unknown as TfidfTrainResult;
  const handed = ex2ResultFromTrain(trained, datasetId);
  const focusName = departmentFocus(datasetId);
  const failures: string[] = [];
  if (!handed) {
    failures.push('handoff missing');
    return { name, failures };
  }
  if (handed.threshold !== threshold) failures.push(`threshold ${handed.threshold} != ${threshold}`);
  if (handed.classes.join('|') !== classes.join('|')) failures.push(`classes ${handed.classes.join('|')}`);
  if (JSON.stringify(handed.matrix) !== JSON.stringify(matrix)) failures.push(`matrix ${JSON.stringify(handed.matrix)} != ${JSON.stringify(matrix)}`);
  const view = ex3Cells(handed.classes, handed.matrix);
  if (JSON.stringify(view.cells) !== JSON.stringify(ex2Cells(matrix))) failures.push('exercise 2 and 3 grids differ');
  const k = handed.classes.findIndex((label) => label.toLowerCase() === (focus || '').toLowerCase());
  const fromMatrix = focusCounts(handed.matrix, k);
  const scores = handed.probsByClass?.[handed.classes[k]];
  if (!scores) failures.push('focus scores missing');
  else {
    const fromScores = recount(scores.pos, scores.neg, threshold);
    const same =
      fromScores.tp === fromMatrix.tp &&
      fromScores.fp === fromMatrix.fp &&
      fromScores.fn === fromMatrix.fn &&
      fromScores.tn === fromMatrix.tn;
    if (!same) {
      failures.push(`scores ${JSON.stringify(fromScores)} != matrix ${JSON.stringify(fromMatrix)} for ${focus}`);
    }
    if (scores.pos.length + scores.neg.length !== fromMatrix.total) {
      failures.push(`score rows ${scores.pos.length + scores.neg.length} != matrix total ${fromMatrix.total}`);
    }
  }
  const card = {
    acc: pct1(fromMatrix.acc),
    prec: pct1(fromMatrix.prec),
    rec: pct1(fromMatrix.rec),
    f1: pct1(fromMatrix.f1),
  };
  return { name, focus, total: fromMatrix.total, card, failures };
}

const ece = Array.from({ length: 4000 }, (_, i) => ({
  y: i < 2000 ? 0 : 1,
  p1: i < 2000 ? 0.2 + (i % 7) * 0.05 : 0.55 + (i % 5) * 0.08,
}));
const eceTie = ece.concat([
  { y: 0, p1: 0.5 },
  { y: 1, p1: 0.5 },
]);
const chem = Array.from({ length: 200 }, (_, i) => ({
  y: i % 2,
  p1: ((i * 17) % 100) / 100,
}));

const results = [
  check('ECE at 0.50', 'ece', ['Fail', 'Pass'], 0.5, ece),
  check('ECE ties at 0.50', 'ece', ['Fail', 'Pass'], 0.5, eceTie),
  check('ECE at 0.30', 'ece', ['Fail', 'Pass'], 0.3, ece),
  check('CHEM at 0.50', 'chemical', ['Abnormal', 'Normal'], 0.5, chem),
];

const short = ex2ResultFromTrain(
  {
    classes: ['Fail', 'Pass'],
    threshold: 0.5,
    confusion_matrix: [
      [10, 0],
      [0, 10],
    ],
    test_probs: [{ y: 0, p: 0.2, probs: [0.8, 0.2] }],
    model: { classes: ['Fail', 'Pass'], vocab: ['note'] },
  } as unknown as TfidfTrainResult,
  'ece',
);
if (short) {
  console.error('short score list was accepted');
  process.exit(1);
}
let failed = 0;
results.forEach((result) => {
  const ok = result.failures.length === 0;
  if (!ok) failed += 1;
  console.log(JSON.stringify(result));
});
if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('PASSED');
