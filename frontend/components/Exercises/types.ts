export type ExerciseId = 1 | 2 | 3 | 4 | 4.5 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type ExerciseDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export type ExerciseStatus = 'not_started' | 'in_progress' | 'completed';

export interface ExerciseMeta {
  id: ExerciseId;
  title: string;
  outcome: string;
  difficulty: ExerciseDifficulty;
  minutes: number;
}

export interface ExerciseProgress {
  status: ExerciseStatus;
  notes: string;
  snapshot: Record<string, unknown>;
}

export interface ExercisesWorkspaceState {
  version: number;
  progress: Record<string, ExerciseProgress>;
  activeId?: ExerciseId | null;
  ex2Result?: Ex2Result | null;
}

export interface LabeledText {
  id: string;
  text: string;
  label: string;
}

export interface RuleConditionKind {
  kind: 'contains' | 'startsWith' | 'endsWith' | 'wordCount';
}

export interface ClassifierRule {
  id: string;
  kind: RuleConditionKind['kind'];
  pattern: string;
  label: string;
}

export interface MetricBundle {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export interface GenerateResult {
  outputs: string[];
  model: string;
  temperature: number;
  simulated: boolean;
}

export interface EmbedResult {
  embeddings: number[][];
  model: string;
  simulated: boolean;
  dimensions?: number;
}

export interface TfidfReviewRow {
  review: string;
  sentiment?: string;
  label?: string;
  y?: number;
}

export interface TfidfTestProb {
  y: number;
  p: number;
  pred?: number;
  label?: string;
  pred_label?: string;
  probs?: number[];
}

export interface Ex2Result {
  packId: string;
  packLabel: string;
  classes: string[];
  matrix: number[][];
  /** Decision cutoff used to build `matrix`, as a probability from 0 to 1. */
  threshold?: number;
  probsByClass?: {
    [className: string]: { pos: number[]; neg: number[] };
  };
}

export interface TfidfWordWeight {
  word: string;
  weight: number;
  label?: string;
}

export interface TfidfClassBelief {
  label: string;
  words: string[];
}

export interface TfidfCurvePoint {
  epoch: number;
  loss: number;
  acc: number;
  train_acc: number;
  prec: number;
  rec: number;
  f1: number;
  pos_words: string[];
  neg_words: string[];
  class_words?: TfidfClassBelief[];
}

export type TextRepresentation = 'tfidf' | 'embeddings';

export const SENTENCE_EMBED_DIM = 384;

export interface TextPrepConfig {
  dropMissing: boolean;
  dropDuplicates: boolean;
  lowercase: boolean;
  stripNoise: boolean;
  stopwords: boolean;
  lemmatize: boolean;
}

export interface TfidfTrainConfig {
  test_size: number;
  seed: number;
  max_features: number;
  ngram_min: number;
  ngram_max: number;
  min_df: number;
  regularization_c: number;
  solver: 'lbfgs' | 'liblinear' | 'saga';
  max_iter: number;
  epochs: number;
  threshold: number;
  representation?: TextRepresentation;
  textPrep?: TextPrepConfig;
}

export const DEFAULT_TFIDF_TRAIN_CONFIG: TfidfTrainConfig = {
  test_size: 0.2,
  seed: 42,
  max_features: 1000,
  ngram_min: 1,
  ngram_max: 2,
  min_df: 1,
  regularization_c: 1,
  solver: 'lbfgs',
  max_iter: 500,
  epochs: 100,
  threshold: 0.5,
};

export interface TfidfExportedModel {
  vocab: string[];
  idf: number[];
  weights: number[] | number[][];
  bias: number | number[];
  classes?: string[];
  ngram_min?: number;
  ngram_max?: number;
  representation?: TextRepresentation;
}

export interface TfidfTrainResult {
  success: boolean;
  simulated: boolean;
  n_train: number;
  n_test: number;
  n_features: number;
  n_classes?: number;
  classes?: string[];
  class_counts?: Record<string, number>;
  n_positive: number;
  n_negative: number;
  baseline: number;
  n_epochs: number;
  epochs?: number;
  train_accuracy?: number;
  test_accuracy?: number;
  test_precision?: number;
  test_recall?: number;
  test_f1?: number;
  cv_accuracy?: number;
  solver?: string;
  regularization_c?: number;
  max_features?: number;
  ngram_min?: number;
  ngram_max?: number;
  min_df?: number;
  max_iter?: number;
  test_size?: number;
  seed?: number;
  threshold?: number;
  representation?: TextRepresentation;
  curve_kind?: string;
  test_probs: TfidfTestProb[];
  confusion_matrix?: number[][];
  word_weights: TfidfWordWeight[];
  class_beliefs?: TfidfClassBelief[];
  curve: TfidfCurvePoint[];
  model: TfidfExportedModel;
}

export interface TfidfTokenScore {
  word: string;
  contribution: number;
  tfidf: number;
}

export interface TfidfClassProb {
  label: string;
  p: number;
}

export interface TfidfPredictResult {
  success: boolean;
  probability: number;
  label?: string;
  classes?: string[];
  probs?: TfidfClassProb[];
  known_tokens: number;
  chips: TfidfTokenScore[];
  features: TfidfTokenScore[];
}

export interface TfidfDatasetInfo {
  id: string;
  name: string;
  short: string;
  theme: string;
  source?: string;
  use_case?: string;
  classes: string[];
  n_rows: number;
}

export interface TfidfInspectStats {
  empty_text: number;
  empty_label: number;
  extra: number;
  groups: number;
  label_in_text: number;
  mixed_labels: number;
  n_rows: number;
}

export interface TfidfDatasetPayload {
  id: string;
  name: string;
  short: string;
  theme: string;
  source?: string;
  use_case?: string;
  classes: string[];
  counts: Record<string, number>;
  n_rows: number;
  rows: Array<{ review: string; label: string }>;
  examples: Array<{ label: string; text: string }>;
  inspect?: TfidfInspectStats | null;
}

export interface ExercisesProps {
  projectName: string;
  sessionId: string;
  projectId: string;
}
