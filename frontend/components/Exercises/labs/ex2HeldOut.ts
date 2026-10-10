import { DEPARTMENT_SOURCES, departmentFocus, getDepartmentSource } from '../data/departmentCatalog';
import { toEx2Result } from '../ex2Result';
import type { Ex2Result, TfidfTestProb, TfidfTrainResult } from '../types';
import { readEx2LabBlob } from './ex2LabState';

export function hasHeldOutScores(result: Ex2Result | null | undefined): boolean {
  if (!result?.probsByClass) return false;
  return Object.values(result.probsByClass).some((item) => item.pos.length > 0 && item.neg.length > 0);
}

function classProbability(row: TfidfTestProb, k: number, nClasses: number): number | null {
  if (row.probs && row.probs.length === nClasses && Number.isFinite(row.probs[k])) return row.probs[k];
  if (nClasses === 2 && Number.isFinite(row.p)) return k === 1 ? row.p : 1 - row.p;
  return null;
}

/** Same cutoff Exercise 3 applies: round to thousandths, then compare with the threshold in hundredths. */
function flagsFocus(probability: number, threshold: number): boolean {
  const hundredths = Math.min(99, Math.max(1, Math.round(threshold * 100)));
  const thousandths = Math.min(999, Math.max(1, Math.round(probability * 1000)));
  return thousandths >= hundredths * 10;
}

/**
 * Binary matrix Exercise 3 recounts from the passed scores.
 * A note is the focus class when its focus probability clears the training threshold.
 */
function sharedBinaryMatrix(
  classes: string[],
  probs: TfidfTestProb[],
  threshold: number,
  focusName: string | null,
): number[][] | null {
  if (classes.length !== 2 || !probs.length) return null;
  const found = focusName ? classes.findIndex((name) => name.toLowerCase() === focusName.toLowerCase()) : -1;
  const focus = found >= 0 ? found : 1;
  const other = focus === 0 ? 1 : 0;
  const matrix = [
    [0, 0],
    [0, 0],
  ];
  let used = 0;
  probs.forEach((row) => {
    const p = classProbability(row, focus, 2);
    if (p == null || row.y < 0 || row.y > 1) return;
    const pred = flagsFocus(p, threshold) ? focus : other;
    matrix[row.y][pred] += 1;
    used += 1;
  });
  return used === probs.length ? matrix : null;
}

function packFor(datasetId: string, classes: string[]): { code: string; label: string } {
  const source = getDepartmentSource(datasetId);
  if (source) return { code: source.short, label: `${source.short} · ${classes.length} classes` };
  const key = classes.map((name) => name.toLowerCase()).sort().join('|');
  const byClass = DEPARTMENT_SOURCES.find(
    (item) => item.classes.map((name) => name.toLowerCase()).sort().join('|') === key,
  );
  if (byClass) return { code: byClass.short, label: `${byClass.short} · ${classes.length} classes` };
  return { code: datasetId || 'CUSTOM', label: `${classes.length} classes` };
}

function isSquare(matrix: number[][] | undefined, size: number): matrix is number[][] {
  return Boolean(matrix && matrix.length === size && matrix.every((row) => Array.isArray(row) && row.length === size));
}

/** Build the Exercise 3 handoff from a finished Exercise 2 training result. */
export function ex2ResultFromTrain(trained: TfidfTrainResult, datasetId: string): Ex2Result | null {
  const source = getDepartmentSource(datasetId);
  const classes = (
    trained.classes && trained.classes.length >= 2
      ? trained.classes
      : trained.model?.classes && trained.model.classes.length >= 2
        ? trained.model.classes
        : source?.classes || []
  ).filter((name) => name.trim());
  if (classes.length < 2) return null;
  const probs = trained.test_probs || [];
  const threshold = typeof trained.threshold === 'number' && Number.isFinite(trained.threshold) ? trained.threshold : 0.5;
  const given = isSquare(trained.confusion_matrix, classes.length) ? trained.confusion_matrix : null;
  const givenTotal = given ? matrixCount(given) : 0;
  if (given && probs.length > 0 && probs.length !== givenTotal) return null;
  const shared = sharedBinaryMatrix(classes, probs, threshold, departmentFocus(datasetId));
  const matrix = shared || given;
  if (!matrix) return null;
  const pack = packFor(datasetId, classes);
  const built = toEx2Result({
    packId: pack.code,
    packLabel: pack.label,
    classes,
    matrix,
    testProbs: probs,
    threshold,
  });
  return hasHeldOutScores(built) ? built : null;
}

function matrixCount(matrix: number[][] | undefined): number {
  if (!matrix) return 0;
  return matrix.reduce((sum, row) => sum + row.reduce((cellSum, cell) => cellSum + (Number(cell) || 0), 0), 0);
}

function squareMatrix(matrix: number[][] | undefined, size: number): number[][] | null {
  if (!isSquare(matrix, size)) return null;
  return matrix.map((row) => row.map((cell) => Number(cell) || 0));
}

/** The lab blob keeps the trained model even when the workspace handoff was not saved. */
export function restoreEx2Result(sessionId: string, projectId: string): Ex2Result | null {
  const blob = readEx2LabBlob(sessionId, projectId, 2);
  if (!blob?.trainResult) return null;
  return ex2ResultFromTrain(blob.trainResult, blob.datasetId || '');
}

/** Exercise 2 and Exercise 3 both draw the confusion matrix stored with the trained model. */
export function withSharedMatrix(result: Ex2Result | null, sessionId: string, projectId: string): Ex2Result | null {
  if (!result) return null;
  const saved = squareMatrix(readEx2LabBlob(sessionId, projectId, 2)?.trainResult?.confusion_matrix, result.classes.length);
  if (!saved || matrixCount(saved) === matrixCount(result.matrix)) return result;
  return { ...result, matrix: saved };
}
