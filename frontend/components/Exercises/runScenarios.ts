import {
  CONTEXT_EXAMPLES,
  DEFAULT_RULES,
  METRIC_EXAMPLES,
  MODEL_COMPARE_EXAMPLES,
  PERSONA_EXAMPLES,
  RULE_EXAMPLES,
  SCORED_DATASET,
  SHAPE_EXAMPLES,
  SIMILARITY_EXAMPLES,
  TEMPERATURE_EXAMPLES,
  TEXT_PROBE_EXAMPLES,
  TOKEN_EXAMPLES,
} from './examples';
import {
  preferMetric,
  runContextLab,
  runDualModelLab,
  runImageKnnLab,
  runMetricLab,
  runPersonaLab,
  runRuleLab,
  runSimilarityLab,
  runTemperatureLab,
  runTextClassifierLab,
  runTokenizerLab,
  syntheticShapeFeatures,
} from './labEngine';
import { cosine, embedText } from './engines/text';
import { loadDataset, DATASET_CSV, modelFromExport, scoreWithModel, trainLocal } from './engines/sentimentStudio';
import { DEFAULT_TFIDF_TRAIN_CONFIG } from './types';

export interface ScenarioResult {
  exercise: number;
  example: string;
  title: string;
  ok: boolean;
  detail: string;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function runAllScenarios(): ScenarioResult[] {
  const results: ScenarioResult[] = [];

  const record = (exercise: number, example: string, title: string, fn: () => string) => {
    try {
      const detail = fn();
      results.push({ exercise, example, title, ok: true, detail });
    } catch (error) {
      results.push({
        exercise,
        example,
        title,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  RULE_EXAMPLES.forEach((example) => {
    record(1, example.id, example.title, () => {
      const result = runRuleLab(DEFAULT_RULES, [example], 'unknown');
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      assert(result.data.total === 1, 'expected one scored row');
      assert(['positive', 'negative', 'unknown'].includes(result.data.rows[0].actual), 'invalid label');
      return `predicted=${result.data.rows[0].actual} expected=${example.expected}`;
    });
  });

  const studioRows = loadDataset(DATASET_CSV);
  const studioTrained = trainLocal(studioRows, 0.25, 42);
  const studioModel = modelFromExport(studioTrained.model);
  const studioTfidf = trainLocal(studioRows, { ...DEFAULT_TFIDF_TRAIN_CONFIG, representation: 'tfidf', seed: 42, test_size: 0.25 });
  const studioEmbed = trainLocal(studioRows, { ...DEFAULT_TFIDF_TRAIN_CONFIG, representation: 'embeddings', seed: 42, test_size: 0.25 });
  const studioTfidfModel = modelFromExport(studioTfidf.model);
  const studioEmbedModel = modelFromExport(studioEmbed.model);
  TEXT_PROBE_EXAMPLES.forEach((example) => {
    record(2, example.id, example.title, () => {
      assert(studioTrained.n_features > 8, 'expected a real TF-IDF vocabulary');
      assert(studioTrained.test_probs.length >= 2, 'need held-out probabilities');
      assert(studioTrained.curve.length > 2, 'learning curve should move');
      const last = studioTrained.curve[studioTrained.curve.length - 1];
      assert(typeof last.epoch === 'number', 'curve should count epochs');
      assert((last.pos_words?.length || 0) + (last.neg_words?.length || 0) > 0, 'beliefs should form');
      const scored = scoreWithModel(example.query, studioModel);
      assert(scored.probability >= 0 && scored.probability <= 1, 'probability out of range');
      const predicted = scored.probability >= 0.5 ? 'positive' : 'negative';
      if (example.id !== 'e10') {
        assert(predicted === 'positive' || predicted === 'negative', 'unexpected class');
      }
      if (example.id === 'e1') assert(scored.probability > 0.5, 'clear positive should lean positive');
      if (example.id === 'e2') assert(scored.probability < 0.5, 'clear negative should lean negative');
      assert(studioTfidf.representation === 'tfidf', 'primary studio path should stay TF-IDF');
      assert(studioEmbed.representation === 'embeddings', 'Exercise 2 can swap to sentence embeddings');
      assert(studioEmbed.n_features === 384, `embeddings should be 384-d, got ${studioEmbed.n_features}`);
      assert(studioTfidf.n_features !== studioEmbed.n_features, 'TF-IDF and embeddings must differ in width');
      const tfidfScored = scoreWithModel(example.query, studioTfidfModel);
      const embedScored = scoreWithModel(example.query, studioEmbedModel);
      assert(Boolean(tfidfScored.label), 'TF-IDF Logistic Regression should predict');
      assert(Boolean(embedScored.label), 'embedding Logistic Regression should predict');
      assert(tfidfScored.probability >= 0 && tfidfScored.probability <= 1, 'TF-IDF confidence out of range');
      assert(embedScored.probability >= 0 && embedScored.probability <= 1, 'embedding confidence out of range');
      return `pred=${predicted} p=${scored.probability.toFixed(2)} features=${studioTrained.n_features}`;
    });
  });

  METRIC_EXAMPLES.forEach((example) => {
    record(3, example.id, example.title, () => {
      const result = runMetricLab(SCORED_DATASET, example.threshold);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      const { tp, fp, tn, fn, n, precision, recall, f1 } = result.data;
      assert(tp + fp + tn + fn === n, 'confusion matrix must cover every score');
      assert([precision, recall, f1].every((v) => v >= 0 && v <= 1), 'metric out of range');
      const chosen = preferMetric(example, result.data);
      const low = runMetricLab(SCORED_DATASET, 0.2);
      const high = runMetricLab(SCORED_DATASET, 0.8);
      assert(low.ok && high.ok, 'threshold sweep failed');
      if (low.ok && high.ok) {
        assert(low.data.recall + 1e-9 >= high.data.recall, 'lowering threshold should not reduce recall');
        assert(high.data.precision + 1e-9 >= low.data.precision || high.data.fp <= low.data.fp, 'raising threshold should tighten positives');
      }
      return `${example.prefer}=${(chosen * 100).toFixed(0)}% tp=${tp} fp=${fp} fn=${fn} tn=${tn}`;
    });
  });

  const trainShapes = (['circle', 'square', 'triangle'] as const).flatMap((label) =>
    [0, 0.3, 0.6].map((j) => ({ label, features: syntheticShapeFeatures(label, j) })),
  );
  SHAPE_EXAMPLES.forEach((example) => {
    record(4, example.id, example.title, () => {
      const jitter = example.id === 'e10' ? 0.15 : Number(example.id.slice(1)) * 0.05;
      const result = runImageKnnLab(trainShapes, [
        { label: example.label, features: syntheticShapeFeatures(example.label, jitter) },
      ]);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      assert(result.data.predictions[0].predicted === example.label, `expected ${example.label}, got ${result.data.predictions[0].predicted}`);
      assert(result.data.accuracy === 1, 'synthetic neighbour should match');
      return `predicted=${result.data.predictions[0].predicted} P=${(result.data.precision * 100).toFixed(0)}% R=${(result.data.recall * 100).toFixed(0)}%`;
    });
  });

  TOKEN_EXAMPLES.forEach((example) => {
    record(5, example.id, example.title, () => {
      const result = runTokenizerLab(example.text, 0.15);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      if (example.id === 'e10') {
        assert(result.data.count === 0 && result.data.cost === 0, 'empty text must be zero cost');
      } else {
        assert(result.data.count > 0, 'expected tokens');
      }
      const expectedCost = (result.data.count / 1_000_000) * 0.15;
      assert(Math.abs(result.data.cost - expectedCost) < 1e-12, 'cost formula mismatch');
      if (example.id === 'e1' || example.id === 'e2') {
        const en = runTokenizerLab(TOKEN_EXAMPLES[0].text, 0.15);
        const ta = runTokenizerLab(TOKEN_EXAMPLES[1].text, 0.15);
        assert(en.ok && ta.ok && ta.ok && en.ok, 'lang compare failed');
        if (en.ok && ta.ok) assert(ta.data.count > en.data.count, 'Tamil should bill more tokens than English for the same idea');
      }
      return `tokens=${result.data.count} cost=$${result.data.cost.toFixed(6)}`;
    });
  });

  SIMILARITY_EXAMPLES.forEach((example) => {
    record(6, example.id, example.title, () => {
      const result = runSimilarityLab(example.phrases);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      const related = cosine(embedText(example.phrases[0], 48, 5), embedText(example.phrases[1], 48, 5));
      const unrelated = cosine(embedText(example.phrases[0], 48, 5), embedText(example.phrases[2], 48, 5));
      if (example.id === 'e10') {
        assert(Math.abs(related - 1) < 0.001, 'identical phrases must have cosine 1');
      } else {
        assert(related > unrelated - 0.02, 'paraphrase should be at least as similar as a different topic');
      }
      return `related=${related.toFixed(2)} unrelated=${unrelated.toFixed(2)} disagreements=${result.data.disagreements.length}`;
    });
  });

  TEMPERATURE_EXAMPLES.forEach((example) => {
    record(7, example.id, example.title, () => {
      const result = runTemperatureLab(example.prompt);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      assert(result.data.low.length === 5 && result.data.high.length === 5, 'need 10 outputs');
      assert(result.data.lowUnique <= result.data.highUnique + 1e-9, 'high temperature should not be less diverse');
      const sameLow = new Set(result.data.low).size === 1;
      assert(sameLow, 'temperature 0.1 should be consistent');
      return `lowU=${result.data.lowUnique.toFixed(2)} highU=${result.data.highUnique.toFixed(2)}`;
    });
  });

  PERSONA_EXAMPLES.forEach((example) => {
    record(8, example.id, example.title, () => {
      const result = runPersonaLab({
        prompt: example.prompt,
        system: example.system,
        examples: example.shotUser ? [{ user: example.shotUser, assistant: example.shotAssistant }] : [],
      });
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      assert(result.data.before.length === 3 && result.data.after.length === 3, 'need 3+3 replies');
      if (example.system) {
        assert(result.data.after.some((line) => line.includes('[Persona]')), 'persona was not applied');
      }
      return `beforeU=${result.data.beforeUnique.toFixed(2)} afterU=${result.data.afterUnique.toFixed(2)}`;
    });
  });

  MODEL_COMPARE_EXAMPLES.forEach((example) => {
    record(9, example.id, example.title, () => {
      const result = runDualModelLab(example.prompt);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      assert(result.data.lite.length > 0 && result.data.pro.length > 0, 'empty model output');
      assert(result.data.pro.includes('Reasoning') || result.data.pro.length >= result.data.lite.length / 2, 'pro should reason or be complete');
      return `lite=${result.data.lite.length}ch pro=${result.data.pro.length}ch`;
    });
  });

  CONTEXT_EXAMPLES.forEach((example) => {
    record(10, example.id, example.title, () => {
      const result = runContextLab(example.text, 180);
      assert(result.ok, result.ok ? '' : result.error);
      if (!result.ok) return '';
      assert(result.data.recoveredCount <= result.data.used, 'recovery must not grow tokens');
      if (example.id === 'e3' || example.id === 'e9') {
        assert(!result.data.overflow, 'short prompt should fit');
      }
      if (example.id === 'e1' || example.id === 'e10' || example.id === 'e5') {
        assert(result.data.overflow, 'this prompt should overflow before recovery');
        assert(result.data.recoveredFits, 'prune+compact should recover under the limit');
      }
      return `used=${result.data.used} recovered=${result.data.recoveredCount} overflow=${result.data.overflow}`;
    });
  });

  record(0, 'edge-empty-rules', 'Empty rules rejected', () => {
    const result = runRuleLab([], [{ text: 'hello', expected: 'positive' }]);
    assert(!result.ok, 'empty rules should fail');
    return result.ok ? 'unexpected ok' : result.error;
  });
  record(0, 'edge-empty-dataset', 'Empty dataset rejected', () => {
    const result = runTextClassifierLab([], 'hello', 'tfidf');
    assert(!result.ok, 'empty dataset should fail');
    return result.ok ? 'unexpected ok' : result.error;
  });
  record(0, 'edge-negative-rate', 'Negative price clamped', () => {
    const result = runTokenizerLab('hello world', -2);
    assert(result.ok && result.ok && result.data.cost === 0, 'negative price should become zero cost');
    return `cost=${result.ok ? result.data.cost : 0}`;
  });

  return results;
}

export function summarizeScenarios(results: ScenarioResult[]): {
  total: number;
  passed: number;
  failed: number;
  byExercise: Record<number, { passed: number; failed: number }>;
} {
  const byExercise: Record<number, { passed: number; failed: number }> = {};
  results.forEach((row) => {
    if (!byExercise[row.exercise]) byExercise[row.exercise] = { passed: 0, failed: 0 };
    if (row.ok) byExercise[row.exercise].passed += 1;
    else byExercise[row.exercise].failed += 1;
  });
  return {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    byExercise,
  };
}
