'use client';

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import ExerciseShell from '../ExerciseShell';
import FullscreenButton from '../FullscreenButton';
import ThemeToggle from '../ThemeToggle';
import UndoButton from '../UndoButton';
import ExerciseHeaderIcon from '../ExerciseHeaderIcon';
import { useUndoHistory } from '../useUndoHistory';
import { EXERCISE_CATALOG } from '../catalog';
import { useExerciseSession } from '../ExerciseContext';
import { ex2ResultFromTrain } from './ex2HeldOut';
import { listTfidfDatasets, loadTfidfDataset, trainTfidfLab, predictTfidfLab } from '../api';
import {
  compactTrainResult,
  parseEx2LabSnapshot,
  readEx2LabBlob,
  writeEx2LabBlob,
  canTrainEx2,
  type Ex2LabSnapshot,
} from './ex2LabState';
import {
  canClassifyText,
  confusionFromProbs,
  macroMetricsFromProbs,
  metricsAt,
  modelFromExport,
  scoreWithModel,
  toTrainRows,
  trainLocal,
  type StudioModel,
  type StudioReview,
} from '../engines/sentimentStudio';
import { Ex2ConfusionMatrix, Ex2Scorecard } from './ex2ScoreViews';
import { Ex2InspectModal } from './Ex2InspectModal';
import {
  DEFAULT_TEXT_PREP,
  cleanNoteText,
  parsePackInspect,
  parseTextPrep,
  prepareLabeledRows,
  type InspectRow,
  type PackInspectStats,
  type TextPrepConfig,
} from './ex2TextPrep';
import { BUNDLED_TFIDF_CATALOG } from '../data/tfidfBundled';
import {
  DEPARTMENT_IDS,
  GENERIC_FORMAT_SAMPLES,
  departmentFocus,
  departmentSourceToMeta,
  getDepartmentConcept,
  getDepartmentSource,
  type DepartmentId,
  type DepartmentSource,
} from '../data/departmentCatalog';
import type {
  ExerciseMeta,
  TextRepresentation,
  TfidfCurvePoint,
  TfidfDatasetInfo,
  TfidfPredictResult,
  TfidfTrainConfig,
  TfidfTrainResult,
} from '../types';
import { DEFAULT_TFIDF_TRAIN_CONFIG, SENTENCE_EMBED_DIM } from '../types';
import './Exercise02.css';
import './Exercise03.css';
import '../labBuddy/labBuddy.css';
import LabBuddy from '../labBuddy';

const RING_R = 100;
const RING_C = 2 * Math.PI * RING_R;
const TRAIN_PLAY_MIN_MS = 18000;
const TRAIN_PLAY_MAX_MS = 28000;

function trainPlayMs(epochs: number): number {
  const n = Math.max(10, Math.round(epochs));
  return Math.round(Math.max(TRAIN_PLAY_MIN_MS, Math.min(TRAIN_PLAY_MAX_MS, n * 200)));
}

const WORKFLOW_STEPS = [
  { n: 1, title: 'Choose Dataset', detail: 'Pick a pack, then inspect it' },
  { n: 2, title: 'Choose One', detail: 'TF-IDF or embeddings' },
  { n: 3, title: 'Train Model', detail: 'Set knobs for that method, then fit' },
  { n: 4, title: 'Type + Enter', detail: 'Classify a ticket' },
] as const;

const SWAP_WORKFLOW_STEPS = WORKFLOW_STEPS;

function stageGateMessage(n: 1 | 2 | 3): string {
  switch (n) {
    case 1:
      return 'Choose a dataset and inspect it first.';
    case 2:
      return 'Choose TF-IDF or sentence embeddings first.';
    case 3:
      return 'Train the model first.';
    default: {
      const _never: never = n;
      return _never;
    }
  }
}

function workflowStep(input: {
  hasData: boolean;
  inspectApplied: boolean;
  repChosen: boolean;
  training: boolean;
  watching: boolean;
  trained: boolean;
}): 1 | 2 | 3 | 4 {
  if (!input.hasData) return 1;
  if (!input.inspectApplied) return 1;
  if (!input.repChosen) return 2;
  if (input.training || input.watching) return 3;
  if (input.trained) return 4;
  return 3;
}

type ConceptLabelTone = 'bug' | 'feature' | 'performance' | 'security';

const CONCEPT_TONES: ConceptLabelTone[] = ['bug', 'feature', 'performance', 'security'];

function conceptToneAt(index: number): ConceptLabelTone {
  return CONCEPT_TONES[((index % CONCEPT_TONES.length) + CONCEPT_TONES.length) % CONCEPT_TONES.length];
}

function uniqueConceptWordChips(pack: {
  pullWord?: string;
  reuse?: string;
  weakWord?: string;
  countOnceWord?: string;
} | null): { word: string; score: string }[] {
  const scores = ['0.61', '0.48', '0.12'];
  const seen = new Set<string>();
  const words: string[] = [];
  const candidates = [
    pack?.pullWord,
    pack?.reuse,
    pack?.weakWord,
    pack?.countOnceWord,
    'reported',
    'note',
  ];
  candidates.forEach((raw) => {
    const word = (raw || '').trim().slice(0, 12);
    if (!word || seen.has(word.toLowerCase())) return;
    seen.add(word.toLowerCase());
    words.push(word);
  });
  while (words.length < 3) words.push(`term ${words.length + 1}`);
  return scores.map((score, index) => ({ word: words[index], score }));
}

function demoPercents(count: number): number[] {
  const n = Math.max(2, count);
  const raw = [82, 18, 12, 8, 6, 4].slice(0, n);
  const sum = raw.reduce((total, value) => total + value, 0);
  const out = raw.map((value) => Math.round((value / sum) * 100));
  out[0] += 100 - out.reduce((total, value) => total + value, 0);
  return out;
}

type ConceptStage =
  | {
      kind: 'intro';
      goal: string;
      ticket: string;
      predicted: string;
      predictedTone: ConceptLabelTone;
      others: string;
      stages: { n: string; title: string; detail: string }[];
    }
  | {
      kind: 'dataset';
      rows: { text: string; label: string; tone: ConceptLabelTone }[];
      trainPct: string;
      testPct: string;
      trainBody: string;
      testBody: string;
    }
  | {
      kind: 'numbers';
      sentence: string;
      words: { word: string; score: string }[];
      common: string;
      vector: string;
      embedLeft: string;
      embedRight: string;
    }
  | {
      kind: 'logistic';
      clues: { cue: string; label: string; tone: ConceptLabelTone }[];
      example: string;
      bars: { label: string; pct: number; tone: ConceptLabelTone }[];
      winner: string;
      winnerTone: ConceptLabelTone;
      why: string;
    }
  | {
      kind: 'results';
      score: string;
      scoreMax: string;
      accuracyBody: string;
      conclusions: { title: string; detail: string }[];
    };

type ConceptSlide = {
  title: string;
  body: string;
  stage: ConceptStage;
};

function buildConceptSlides(source: DepartmentSource | null): ConceptSlide[] {
  const fallback = getDepartmentSource('cse');
  const packSource = source || fallback;
  const pack = getDepartmentConcept(packSource?.id || 'cse');
  const classes = packSource?.classes?.length ? packSource.classes : ['Bug', 'Working as Intended'];
  const samples = pack?.samples?.length ? pack.samples : [
    { text: 'Auth module throws a null pointer on submit.', label: 'Bug' },
    { text: 'Export is PDF-only because that is how the product was specified.', label: 'Working as Intended' },
  ];
  const rows = samples.slice(0, Math.max(2, classes.length)).map((row, index) => ({
    text: row.text,
    label: row.label,
    tone: conceptToneAt(Math.max(0, classes.indexOf(row.label) === -1 ? index : classes.indexOf(row.label))),
  }));
  const ticket = pack?.keyword || rows[0]?.text || 'Auth module throws a null pointer on submit.';
  const predicted = rows[0]?.label || classes[0];
  const predictedTone = rows[0]?.tone || conceptToneAt(0);
  const percents = demoPercents(classes.length);
  const bars = classes.map((label, index) => ({
    label,
    pct: percents[index] ?? 0,
    tone: conceptToneAt(index),
  }));
  const usedCues = new Set<string>();
  const clues = rows.map((row, index) => {
    const fromText = row.text
      .split(/\s+/)
      .map((token) => token.replace(/[^a-zA-Z]/g, '').toLowerCase())
      .filter((token) => token.length > 3 && !usedCues.has(token));
    const preferred =
      index === 0 && pack?.pullWord && !usedCues.has(pack.pullWord.toLowerCase())
        ? pack.pullWord.toLowerCase()
        : fromText[0] || `${row.label.toLowerCase()}-${index + 1}`;
    usedCues.add(preferred);
    return { cue: preferred, label: row.label, tone: row.tone };
  });
  const exampleNote = source ? `${packSource?.name} notes` : 'an example from Computer Science';
  return [
    {
      title: 'What will you discover?',
      body: `You'll teach logistic regression to sort ${exampleNote} into the right category. Pick one way to turn text into numbers, train once, then try a ticket.`,
      stage: {
        kind: 'intro',
        goal: 'Your goal: inspect the notes, choose TF-IDF or sentence embeddings, train logistic regression, then type a ticket.',
        ticket,
        predicted,
        predictedTone,
        others: `Other categories: ${classes.filter((name) => name !== predicted).join(', ')}`,
        stages: WORKFLOW_STEPS.map((step) => ({ n: String(step.n), title: step.title, detail: step.detail })),
      },
    },
    {
      title: "What's inside the dataset?",
      body: source
        ? `Each row is one ${packSource?.short || ''} note and its correct category (the label). After the preview you will inspect labels, missing values, duplicates, and leakage, then clean the text.`
        : 'Each row is one field note and its correct category (the label). After the preview you will inspect labels, missing values, duplicates, and leakage, then clean the text.',
      stage: {
        kind: 'dataset',
        rows,
        trainPct: '80%',
        testPct: '20%',
        trainBody: 'The model studies these examples, like practising with solved problems before an exam.',
        testBody: 'Kept hidden until the end, like a surprise exam. It shows whether the model really learned.',
      },
    },
    {
      title: 'Two ways to turn text into numbers',
      body: 'A computer only understands numbers. You will pick one method. Both feed the same logistic regression model — they do not share word knobs.',
      stage: {
        kind: 'numbers',
        sentence: ticket,
        words: uniqueConceptWordChips(pack),
        common: 'common words (the, when, I): low score',
        vector: '[ 0.12, −0.40, 0.88, 0.05, … ]  ·  384 numbers',
        embedLeft: pack?.embedLeft || 'cannot sign in',
        embedRight: pack?.embedRight || 'lockout after the password expired',
      },
    },
    {
      title: 'About the model: Logistic Regression',
      body: 'After the text is numbers, logistic regression weighs every clue and names a category. The clues are words if you chose TF-IDF, or meaning-dimensions if you chose sentence embeddings.',
      stage: {
        kind: 'logistic',
        clues,
        example: ticket,
        bars,
        winner: predicted,
        winnerTone: predictedTone,
        why: 'It is a fast first classifier. With TF-IDF, the results panel lists words that pulled each class. With sentence embeddings, similar notes can match even when they share few words.',
      },
    },
    {
      title: "How you'll check your results",
      body: 'After training, the model sorts the hidden test notes and we compare its answers with the correct labels. That is evaluation — not a bake-off between both methods.',
      stage: {
        kind: 'results',
        score: '87',
        scoreMax: '100',
        accuracyBody: 'Notes sorted correctly out of every 100. Example value from a held-out test.',
        conclusions: [
          { title: 'Pick one method', detail: 'TF-IDF scores words. Sentence embeddings score meaning as 384 numbers. Train with the one you chose.' },
          { title: 'Learn, then test', detail: 'The model learns from labelled examples and is checked on notes it has never seen.' },
          { title: 'Then try a live ticket', detail: 'Type a note from this department and press Enter. Exercise 3 is where you build a confusion matrix and calculate the metrics.' },
        ],
      },
    },
  ];
}

const REP_STORAGE_KEY_EX2 = 'np-ex2-representation';
const REP_STORAGE_KEY_EX3 = 'np-ex3-representation';
const CONCEPT_SEEN_PREFIX = 'np-ex-concept-seen';

function conceptSeenKey(sessionId: string, projectId: string, exerciseId: number) {
  return `${CONCEPT_SEEN_PREFIX}:${sessionId}:${projectId}:${exerciseId}`;
}

function markConceptSeen(sessionId: string, projectId: string, exerciseId: number) {
  if (!sessionId || !projectId) return;
  try {
    window.localStorage.setItem(conceptSeenKey(sessionId, projectId, exerciseId), '1');
  } catch {
    return;
  }
}

function clearConceptSeen(sessionId: string, projectId: string, exerciseId: number) {
  if (!sessionId || !projectId) return;
  try {
    window.localStorage.removeItem(conceptSeenKey(sessionId, projectId, exerciseId));
  } catch {
    return;
  }
}

function hasConceptSeen(sessionId: string, projectId: string, exerciseId: number) {
  if (!sessionId || !projectId) return false;
  try {
    return window.localStorage.getItem(conceptSeenKey(sessionId, projectId, exerciseId)) === '1';
  } catch {
    return false;
  }
}

import {
  readExerciseTheme,
  subscribeExerciseTheme,
  type ExerciseTheme,
} from '../theme';

type LabTheme = ExerciseTheme;

function readLabTheme(): LabTheme {
  return readExerciseTheme();
}

function representationStorageKey(swapLab: boolean) {
  return swapLab ? REP_STORAGE_KEY_EX3 : REP_STORAGE_KEY_EX2;
}

function storeRepresentation(value: TextRepresentation, swapLab: boolean) {
  try {
    window.sessionStorage.setItem(representationStorageKey(swapLab), value);
  } catch {
    return;
  }
}

function clearStoredRepresentation(swapLab: boolean) {
  try {
    window.sessionStorage.removeItem(representationStorageKey(swapLab));
  } catch {
    return;
  }
}

function representationLabel(value: TextRepresentation): string {
  switch (value) {
    case 'tfidf':
      return 'TF-IDF';
    case 'embeddings':
      return 'Sentence Embeddings';
    default: {
      const _never: never = value;
      return _never;
    }
  }
}

function buildCompareBundle(
  representation: TextRepresentation,
  primary: TfidfTrainResult,
  other: TfidfTrainResult,
  text: string,
): {
  tfidf: TfidfTrainResult;
  embeddings: TfidfTrainResult;
  tfidfPred: TfidfPredictResult | null;
  embeddingsPred: TfidfPredictResult | null;
} {
  const tfidf = representation === 'tfidf' ? primary : other;
  const embeddings = representation === 'embeddings' ? primary : other;
  const trimmed = text.trim();
  return {
    tfidf,
    embeddings,
    tfidfPred: trimmed ? scoreWithModel(trimmed, modelFromExport(tfidf.model)) : null,
    embeddingsPred: trimmed ? scoreWithModel(trimmed, modelFromExport(embeddings.model)) : null,
  };
}

const CLASS_TONES = ['pos', 'neg', 'blue', 'amber', 'purple', 'lime'] as const;
const SOLVERS: TfidfTrainConfig['solver'][] = ['lbfgs', 'liblinear', 'saga'];
const TEST_SPLITS = [0.1, 0.2, 0.3] as const;
const NGRAM_CHOICES: Array<[number, number]> = [
  [1, 1],
  [1, 2],
  [1, 3],
];

type SetupDraft = {
  test_size: string;
  seed: string;
  max_features: string;
  ngram: string;
  min_df: string;
  regularization_c: string;
  solver: string;
  max_iter: string;
  epochs: string;
  threshold: string;
};
type SetupPresetId = 'quick' | 'balanced' | 'thorough';
type SetupPresetFields = Omit<SetupDraft, 'test_size'>;

const SETUP_PRESET_IDS: SetupPresetId[] = ['quick', 'balanced', 'thorough'];
const SETUP_PRESETS: Record<SetupPresetId, SetupPresetFields> = {
  quick: {
    seed: '42',
    max_features: '500',
    ngram: '1,1',
    min_df: '2',
    regularization_c: '1.0',
    solver: 'lbfgs',
    max_iter: '200',
    epochs: '50',
    threshold: '0.50',
  },
  balanced: {
    seed: '42',
    max_features: '1000',
    ngram: '1,2',
    min_df: '1',
    regularization_c: '1.0',
    solver: 'lbfgs',
    max_iter: '500',
    epochs: '100',
    threshold: '0.50',
  },
  thorough: {
    seed: '42',
    max_features: '5000',
    ngram: '1,3',
    min_df: '1',
    regularization_c: '1.0',
    solver: 'lbfgs',
    max_iter: '1000',
    epochs: '200',
    threshold: '0.50',
  },
};

const EMBED_SETUP_PRESETS: Record<SetupPresetId, Partial<SetupDraft>> = {
  quick: {
    regularization_c: '0.5',
    max_iter: '200',
    epochs: '50',
    solver: 'lbfgs',
  },
  balanced: {
    regularization_c: '1.0',
    max_iter: '500',
    epochs: '100',
    solver: 'lbfgs',
  },
  thorough: {
    regularization_c: '2.0',
    max_iter: '1000',
    epochs: '200',
    solver: 'lbfgs',
  },
};

function presetDraftPatch(id: SetupPresetId, representation: TextRepresentation): Partial<SetupDraft> {
  const base = SETUP_PRESETS[id];
  if (representation !== 'embeddings') return base;
  return { ...base, ...EMBED_SETUP_PRESETS[id] };
}

function fullPresetDraft(id: SetupPresetId, representation: TextRepresentation): SetupDraft {
  return {
    test_size: String(DEFAULT_TFIDF_TRAIN_CONFIG.test_size),
    ...SETUP_PRESETS[id],
    ...presetDraftPatch(id, representation),
  };
}

const SETUP_KEYS = [
  'test_size',
  'seed',
  'max_features',
  'ngram',
  'min_df',
  'regularization_c',
  'threshold',
  'solver',
  'max_iter',
  'epochs',
] as const;
type SetupFieldKey = (typeof SETUP_KEYS)[number];
type SetupPane = 'basic' | 'advanced';

function gateCursorPoint(event?: { clientX: number; clientY: number }): { x: number; y: number } {
  const x = (event?.clientX ?? 0) + 14;
  const y = (event?.clientY ?? 0) + 16;
  if (typeof window === 'undefined') return { x, y };
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - 220)),
    y: Math.max(8, Math.min(y, window.innerHeight - 36)),
  };
}

function isSetupFieldFilled(key: SetupFieldKey, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  switch (key) {
    case 'test_size':
      return (TEST_SPLITS as readonly number[]).includes(Number(trimmed));
    case 'ngram':
      return NGRAM_CHOICES.some(([min, max]) => `${min},${max}` === trimmed);
    case 'solver':
      return SOLVERS.includes(trimmed as TfidfTrainConfig['solver']);
    case 'seed':
    case 'max_features':
    case 'min_df':
    case 'regularization_c':
    case 'max_iter':
    case 'epochs':
    case 'threshold':
      return Number.isFinite(Number(trimmed));
    default: {
      const _never: never = key;
      return _never;
    }
  }
}

function setupPresetMeta(id: SetupPresetId, representation: TextRepresentation = 'tfidf'): { title: string; blurb: string } {
  if (representation === 'embeddings') {
    switch (id) {
      case 'quick':
        return { title: 'Quick', blurb: 'Softer C, fewer steps' };
      case 'balanced':
        return { title: 'Balanced', blurb: 'Default C for meaning vectors' };
      case 'thorough':
        return { title: 'Thorough', blurb: 'Stronger C, more steps' };
      default: {
        const _never: never = id;
        return _never;
      }
    }
  }
  switch (id) {
    case 'quick':
      return { title: 'Quick', blurb: 'Fewer word features' };
    case 'balanced':
      return { title: 'Balanced', blurb: 'Best mix of n-grams' };
    case 'thorough':
      return { title: 'Thorough', blurb: 'More n-grams, slower' };
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

function draftFieldMatches(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

function matchingSetupPreset(draft: SetupDraft, representation: TextRepresentation = 'tfidf'): SetupPresetId | null {
  for (const id of SETUP_PRESET_IDS) {
    const preset = presetDraftPatch(id, representation);
    const keys = Object.keys(preset) as Array<keyof SetupDraft>;
    if (keys.every((key) => draftFieldMatches(draft[key], String(preset[key] ?? '')))) return id;
  }
  return null;
}

type SetupModelConfig = {
  draft: SetupDraft;
  preset: SetupPresetId;
  /** True after any in-session edit; blocks hydrate from overwriting on remount. */
  touched: boolean;
  /**
   * Once Advanced has been shown (or edited), Basic preset clicks must never
   * rewrite Advanced knobs — only the selected preset id may change.
   */
  advancedLocked: boolean;
};

type Ex2UndoSnapshot = {
  activeDataset: string;
  datasetId: string;
  representation: TextRepresentation;
  repChosen: boolean;
  inspectApplied: boolean;
  textPrep: TextPrepConfig | null;
  setup: SetupModelConfig;
  appliedConfig: TfidfTrainConfig | null;
  reviewText: string;
  threshold: number;
  trained: boolean;
};

type SetupAction =
  | { type: 'patch'; patch: Partial<SetupDraft> }
  | { type: 'preset'; id: SetupPresetId; representation?: TextRepresentation }
  /** First visit to Advanced: sync draft from the current Basic preset, then lock. */
  | { type: 'revealAdvanced' }
  | { type: 'set'; config: SetupModelConfig }
  | {
      type: 'replace';
      draft: SetupDraft;
      preset?: SetupPresetId;
      touched?: boolean;
      advancedLocked?: boolean;
    }
  | { type: 'reset'; representation?: TextRepresentation };

function defaultSetupDraft(): SetupDraft {
  return {
    test_size: String(DEFAULT_TFIDF_TRAIN_CONFIG.test_size),
    ...SETUP_PRESETS.balanced,
  };
}

function createSetupConfig(
  draft: SetupDraft = defaultSetupDraft(),
  preset: SetupPresetId = 'balanced',
  touched = false,
  advancedLocked = false,
): SetupModelConfig {
  return { draft, preset, touched, advancedLocked };
}

/** Survives React remounts / HMR within the same exercise lab session. */
const liveSetupStore = new Map<string, SetupModelConfig>();
const liveSetupHydrated = new Set<string>();

function setupStoreKey(sessionId: string, projectId: string, exerciseId: number): string {
  return `${sessionId}::${projectId}::${exerciseId}`;
}

function cloneSetupConfig(config: SetupModelConfig): SetupModelConfig {
  return {
    draft: { ...config.draft },
    preset: config.preset,
    touched: Boolean(config.touched),
    advancedLocked: Boolean(config.advancedLocked),
  };
}

function readLiveSetup(sessionId: string, projectId: string, exerciseId: number): SetupModelConfig {
  const key = setupStoreKey(sessionId, projectId, exerciseId);
  const existing = liveSetupStore.get(key);
  if (existing) return cloneSetupConfig(existing);
  const fresh = createSetupConfig();
  liveSetupStore.set(key, fresh);
  return cloneSetupConfig(fresh);
}

function writeLiveSetup(
  sessionId: string,
  projectId: string,
  exerciseId: number,
  config: SetupModelConfig,
): void {
  liveSetupStore.set(setupStoreKey(sessionId, projectId, exerciseId), cloneSetupConfig(config));
}

function clearLiveSetup(sessionId: string, projectId: string, exerciseId: number): void {
  const key = setupStoreKey(sessionId, projectId, exerciseId);
  liveSetupStore.delete(key);
  liveSetupHydrated.delete(key);
}

function patchTouchesAdvanced(patch: Partial<SetupDraft>): boolean {
  return (Object.keys(patch) as Array<keyof SetupDraft>).some((key) => key !== 'test_size');
}

function setupConfigReducer(state: SetupModelConfig, action: SetupAction): SetupModelConfig {
  switch (action.type) {
    case 'set':
      return cloneSetupConfig(action.config);
    case 'patch':
      // Partial merge only — never replace the whole draft.
      return {
        ...state,
        touched: true,
        advancedLocked: state.advancedLocked || patchTouchesAdvanced(action.patch),
        draft: { ...state.draft, ...action.patch },
      };
    case 'preset':
      return {
        ...state,
        touched: true,
        preset: action.id,
        draft: {
          ...state.draft,
          ...presetDraftPatch(action.id, action.representation || 'tfidf'),
          test_size: state.draft.test_size,
        },
      };
    case 'revealAdvanced':
      if (state.advancedLocked) return state;
      return { ...state, touched: true, advancedLocked: true };
    case 'replace': {
      const preset = action.preset || matchingSetupPreset(action.draft) || state.preset;
      const matched = matchingSetupPreset(action.draft);
      return {
        draft: { ...action.draft },
        preset,
        touched: action.touched ?? state.touched,
        advancedLocked:
          action.advancedLocked ?? (matched === null ? true : state.advancedLocked),
      };
    }
    case 'reset':
      return createSetupConfig(
        fullPresetDraft('balanced', action.representation || 'tfidf'),
        'balanced',
        true,
        false,
      );
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

function fillEmptySetupFields(
  draft: SetupDraft,
  presetId: SetupPresetId = 'balanced',
  representation: TextRepresentation = 'tfidf',
): SetupDraft {
  const examples = fullPresetDraft(presetId, representation);
  const next = { ...draft };
  SETUP_KEYS.forEach((key) => {
    if (!isSetupFieldFilled(key, next[key])) next[key] = examples[key];
  });
  return next;
}

function setupKeysFor(representation: TextRepresentation): SetupFieldKey[] {
  switch (representation) {
    case 'embeddings':
      return SETUP_KEYS.filter((key) => key !== 'max_features' && key !== 'ngram' && key !== 'min_df');
    case 'tfidf':
      return [...SETUP_KEYS];
    default: {
      const _never: never = representation;
      return _never;
    }
  }
}

function missingSetupFields(draft: SetupDraft, representation: TextRepresentation = 'tfidf'): SetupFieldKey[] {
  return setupKeysFor(representation).filter((key) => !isSetupFieldFilled(key, draft[key]));
}

function ngramLabel(min: number, max: number): string {
  return `(${min},${max})`;
}

function snapTestSize(value: number): string {
  if ((TEST_SPLITS as readonly number[]).includes(value)) return String(value);
  const nearest = TEST_SPLITS.reduce((best, split) =>
    Math.abs(split - value) < Math.abs(best - value) ? split : best,
  );
  return String(nearest);
}

function draftFromConfig(config: TfidfTrainConfig): SetupDraft {
  return {
    test_size: snapTestSize(config.test_size),
    seed: String(config.seed),
    max_features: String(config.max_features),
    ngram: `${config.ngram_min},${config.ngram_max}`,
    min_df: String(config.min_df),
    regularization_c: Number(config.regularization_c).toFixed(1),
    solver: config.solver,
    max_iter: String(config.max_iter),
    epochs: String(config.epochs),
    threshold: Number(config.threshold).toFixed(2),
  };
}

function configFromTrainResult(result: TfidfTrainResult): TfidfTrainConfig {
  const solver =
    result.solver === 'liblinear' || result.solver === 'saga' || result.solver === 'lbfgs'
      ? result.solver
      : 'lbfgs';
  return clampTrainConfig({
    test_size: Number(result.test_size),
    seed: Number(result.seed),
    max_features: Number(result.max_features),
    ngram_min: Number(result.ngram_min),
    ngram_max: Number(result.ngram_max),
    min_df: Number(result.min_df),
    regularization_c: Number(result.regularization_c),
    solver,
    max_iter: Number(result.max_iter),
    epochs: Number(result.epochs ?? result.n_epochs),
    threshold: Number(result.threshold),
  });
}

function configFromDraft(draft: SetupDraft): TfidfTrainConfig {
  const ngramParts = draft.ngram.split(',').map(Number);
  const solver =
    draft.solver === 'liblinear' || draft.solver === 'saga' || draft.solver === 'lbfgs'
      ? draft.solver
      : undefined;
  if (!solver) {
    throw new Error('Choose a solver.');
  }
  const ngramMin = Number.isFinite(ngramParts[0]) ? ngramParts[0] : 1;
  const ngramMax = Number.isFinite(ngramParts[1]) ? ngramParts[1] : Math.max(ngramMin, 1);
  return clampTrainConfig({
    test_size: Number(draft.test_size),
    seed: Number(draft.seed),
    max_features: Number(draft.max_features) || 1000,
    ngram_min: ngramMin,
    ngram_max: ngramMax,
    min_df: Number(draft.min_df) || 1,
    regularization_c: Number(draft.regularization_c),
    solver,
    max_iter: Number(draft.max_iter),
    epochs: Number(draft.epochs),
    threshold: Number(draft.threshold),
  });
}

function clampTrainConfig(draft: TfidfTrainConfig): TfidfTrainConfig {
  const ngramMin = Math.max(1, Math.min(3, Math.round(Number(draft.ngram_min))));
  const ngramMax = Math.max(ngramMin, Math.min(3, Math.round(Number(draft.ngram_max))));
  if (!SOLVERS.includes(draft.solver)) {
    throw new Error('Choose a solver.');
  }
  if (!(TEST_SPLITS as readonly number[]).includes(draft.test_size)) {
    throw new Error('Choose Test Data(%).');
  }
  return {
    test_size: draft.test_size,
    seed: Math.max(0, Math.min(2147483647, Math.round(Number(draft.seed)))),
    max_features: Math.max(50, Math.min(8000, Math.round(Number(draft.max_features)))),
    ngram_min: ngramMin,
    ngram_max: ngramMax,
    min_df: Math.max(1, Math.min(50, Math.round(Number(draft.min_df)))),
    regularization_c: Math.max(0.1, Math.min(10, Number(draft.regularization_c))),
    solver: draft.solver,
    max_iter: Math.max(50, Math.min(5000, Math.round(Number(draft.max_iter)))),
    epochs: Math.max(10, Math.min(2000, Math.round(Number(draft.epochs)))),
    threshold: Math.max(0.05, Math.min(0.95, Number(draft.threshold))),
  };
}

function classTone(index: number): string {
  return CLASS_TONES[index % CLASS_TONES.length];
}

function uniqueLabels(rows: Array<{ label: string }>): string[] {
  const names: string[] = [];
  rows.forEach((row) => {
    if (!names.includes(row.label)) names.push(row.label);
  });
  return names;
}

function toInspectRows(rows: Array<{ review?: string; text?: string; label?: string }>): InspectRow[] {
  return rows.map((row) => ({
    review: row.review || row.text || '',
    label: row.label || '',
  }));
}

function toPreparedStudio(
  rows: StudioReview[],
  prep: ReturnType<typeof parseTextPrep>,
  representation: TextRepresentation,
): StudioReview[] {
  const prepared = prepareLabeledRows(rows, prep, representation);
  const index = new Map<string, number>();
  rows.forEach((row) => {
    if (!row.label || index.has(row.label)) return;
    index.set(row.label, row.y);
  });
  return prepared.map((row) => ({
    review: row.review,
    label: row.label,
    y: index.get(row.label) ?? 0,
  }));
}

const PREVIEW_SAMPLE_COUNT = 4;
const FULL_TABLE_PAGE_SIZE = 50;

function toStudioPreview(rows: Array<{ review?: string; text?: string; label: string }>): StudioReview[] {
  return rows
    .map((row) => ({
      review: (row.review || row.text || '').trim(),
      label: (row.label || '').trim(),
      y: 0,
    }))
    .filter((row) => row.review && row.label);
}

function samplePreviewRows<T extends { label: string }>(rows: T[], count = PREVIEW_SAMPLE_COUNT): T[] {
  const picked: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.label)) continue;
    seen.add(row.label);
    picked.push(row);
    if (picked.length >= count) return picked;
  }
  for (const row of rows) {
    if (picked.length >= count) break;
    if (picked.includes(row)) continue;
    picked.push(row);
  }
  return picked;
}

function FormatPreviewTable({
  rows,
  compact = false,
  rowStart,
  scrollerRef,
}: {
  rows: Array<{ text?: string; review?: string; label: string }>;
  compact?: boolean;
  rowStart?: number;
  scrollerRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const labels = uniqueLabels(rows);
  const numbered = rowStart != null;
  return (
    <div className={`e2-preview-table${compact ? ' sample' : ' full'}`} ref={scrollerRef}>
      <table className="data">
        <thead>
          <tr>
            {numbered ? (
              <th className="e2-preview-num" scope="col">
                #
              </th>
            ) : null}
            <th scope="col">Text</th>
            <th scope="col">Label</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const full = (row.review || row.text || '').replace(/\s+/g, ' ').trim();
            const n = numbered ? rowStart + index : index + 1;
            return (
              <tr key={`${n}-${row.label}-${full}`}>
                {numbered ? <td className="e2-preview-num">{n}</td> : null}
                <td className="rev" title={full}>
                  <span>{full}</span>
                </td>
                <td>
                  <span className={`e2-tag e2-tag-${classTone(labels.indexOf(row.label))}`}>{row.label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DatasetAbout({ source }: { source: DepartmentSource }) {
  const aboutParas = source.about.split('\n\n').map((para) => para.trim()).filter(Boolean);
  return (
    <div className="e2-data-about">
      <section className="e2-data-about-about">
        <h3>About</h3>
        {aboutParas.map((para, index) => (
          <p key={`${index}-${para.slice(0, 24)}`}>{para}</p>
        ))}
      </section>
      <section className="e2-data-about-desc">
        <h3>Classes</h3>
        <ul className="e2-data-points">
          {source.classes.map((name, index) => (
            <li key={`${name}-${index}`}>
              <span className={`e2-tag e2-tag-${classTone(index)}`}>{name}</span>
              <span>{source.description[index]}</span>
            </li>
          ))}
        </ul>
      </section>
      {source.use_case ? (
        <section className="e2-data-about-use">
          <h3>When to use it</h3>
          <p>{source.use_case}</p>
        </section>
      ) : null}
    </div>
  );
}

function ConceptTag({ label, tone }: { label: string; tone: ConceptLabelTone }) {
  return <span className={`e2-intro-tag ${tone}`}>{label}</span>;
}

function ConceptIntroView({ stage }: { stage: Extract<ConceptStage, { kind: 'intro' }> }) {
  return (
    <div className="e2-intro">
      <p className="e2-intro-goal">{stage.goal}</p>
      <div className="e2-intro-pipe">
        <span className="e2-intro-quote">“{stage.ticket}”</span>
        <span className="e2-intro-join" aria-hidden="true">
          →
        </span>
        <span className="e2-intro-model">Your model</span>
        <span className="e2-intro-join" aria-hidden="true">
          →
        </span>
        <ConceptTag label={stage.predicted} tone={stage.predictedTone} />
        <span className="e2-intro-others">{stage.others}</span>
      </div>
      <h4 className="e2-intro-h">Here are the stages you’ll go through</h4>
      <div className="e2-intro-stages">
        {stage.stages.map((item) => (
          <div key={item.n} className="e2-intro-stage">
            <span className="e2-intro-n">{item.n}</span>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptDatasetView({ stage }: { stage: Extract<ConceptStage, { kind: 'dataset' }> }) {
  return (
    <div className="e2-intro">
      <div className="e2-intro-table" role="table" aria-label="Sample tickets">
        <div className="e2-intro-thead" role="row">
          <span>Text</span>
          <span>Label</span>
        </div>
        {stage.rows.map((row, index) => (
          <div key={`${row.label}-${index}`} className="e2-intro-trow" role="row">
            <span>“{row.text}”</span>
            <ConceptTag label={row.label} tone={row.tone} />
          </div>
        ))}
      </div>
      <h4 className="e2-intro-h">Why do we split the data?</h4>
      <div className="e2-intro-splitbar" aria-hidden="true">
        <span className="train">{stage.trainPct} Training data</span>
        <span className="test">{stage.testPct} Test data</span>
      </div>
      <div className="e2-intro-splitcards">
        <div className="e2-intro-card">
          <strong>Training data</strong>
          <p>{stage.trainBody}</p>
        </div>
        <div className="e2-intro-card">
          <strong>Test data</strong>
          <p>{stage.testBody}</p>
        </div>
      </div>
    </div>
  );
}

function ConceptNumbersView({ stage }: { stage: Extract<ConceptStage, { kind: 'numbers' }> }) {
  return (
    <div className="e2-intro">
      <p className="e2-intro-sentence">“{stage.sentence}”</p>
      <div className="e2-intro-methods">
        <div className="e2-intro-card method">
          <span className="e2-intro-method-kicker a">A · TF-IDF</span>
          <strong>Word-by-word learning</strong>
          <p>Gives each word or short phrase a score for how important it is in this note versus the rest of the pack.</p>
          <div className="e2-intro-chips">
            {stage.words.map((item, index) => (
              <span key={`${item.word}-${index}`} className="e2-intro-chip">
                {item.word} <b>{item.score}</b>
              </span>
            ))}
          </div>
          <span className="e2-intro-common">{stage.common}</span>
          <em>You can tune max features, n-grams, and rare-word cuts. Example values.</em>
        </div>
        <div className="e2-intro-card method">
          <span className="e2-intro-method-kicker b">B · Sentence embeddings</span>
          <strong>Whole-sentence meaning</strong>
          <p>
            Turns the full sentence into a fixed list of 384 numbers. Nearby numbers mean nearby meaning, even if the wording differs.
          </p>
          <p className="e2-intro-embed-pair">
            “{stage.embedLeft}” and “{stage.embedRight}” can land close — TF-IDF would only match if they share words.
          </p>
          <span className="e2-intro-vector">{stage.vector}</span>
          <em>Size is fixed in this lab. Word knobs do not apply. Example values.</em>
        </div>
      </div>
    </div>
  );
}

function ConceptLogisticView({ stage }: { stage: Extract<ConceptStage, { kind: 'logistic' }> }) {
  return (
    <div className="e2-intro e2-intro-lr">
      <div className="e2-intro-card">
        <strong>1. It learns clues</strong>
        <p>From the training data, it learns how strongly each clue points to each category. With TF-IDF, the clues are words:</p>
        <div className="e2-intro-clues">
          {stage.clues.map((item, index) => (
            <span key={`${item.cue}-${item.label}-${index}`} className="e2-intro-clue">
              {item.cue} <span aria-hidden="true">→</span> <ConceptTag label={item.label} tone={item.tone} />
            </span>
          ))}
        </div>
      </div>
      <div className="e2-intro-card">
        <strong>2. It gives a chance for each category</strong>
        <p>
          For “{stage.example}”:
        </p>
        <ul className="e2-intro-bars">
          {stage.bars.map((bar, index) => (
            <li key={`${bar.label}-${index}`}>
              <span className="e2-intro-bar-lab">{bar.label}</span>
              <span className="e2-intro-bar-track">
                <span className={`e2-intro-bar-fill ${bar.tone}`} style={{ width: `${bar.pct}%` }} />
              </span>
              <span className="e2-intro-bar-pct">{bar.pct}%</span>
            </li>
          ))}
        </ul>
        <em>Example values</em>
      </div>
      <div className="e2-intro-card">
        <strong>3. It picks the highest</strong>
        <p>
          The category with the biggest chance wins. Here, the answer is <ConceptTag label={stage.winner} tone={stage.winnerTone} />.
        </p>
      </div>
      <div className="e2-intro-card">
        <strong>Why we use it</strong>
        <p>{stage.why}</p>
      </div>
    </div>
  );
}

function ConceptResultsView({ stage }: { stage: Extract<ConceptStage, { kind: 'results' }> }) {
  return (
    <div className="e2-intro">
      <div className="e2-intro-eval">
        <div className="e2-intro-card e2-intro-score">
          <span className="e2-intro-score-n">
            {stage.score}
            <small> / {stage.scoreMax}</small>
          </span>
          <div>
            <strong>Accuracy</strong>
            <p>{stage.accuracyBody}</p>
          </div>
        </div>
        <div className="e2-intro-card e2-intro-task">
          <strong>Your task</strong>
          <p>
            Pick <span className="a">TF-IDF</span> or <span className="b">sentence embeddings</span>, train logistic regression once, then type a ticket. Exercise 3 is where you build a confusion matrix and work out the six metrics.
          </p>
        </div>
      </div>
      <h4 className="e2-intro-h">Conclusion</h4>
      <div className="e2-intro-conclusions">
        {stage.conclusions.map((item, index) => (
          <div key={`${item.title}-${index}`} className="e2-intro-card">
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptStageView({ stage }: { stage: ConceptStage }) {
  switch (stage.kind) {
    case 'intro':
      return <ConceptIntroView stage={stage} />;
    case 'dataset':
      return <ConceptDatasetView stage={stage} />;
    case 'numbers':
      return <ConceptNumbersView stage={stage} />;
    case 'logistic':
      return <ConceptLogisticView stage={stage} />;
    case 'results':
      return <ConceptResultsView stage={stage} />;
    default: {
      const _never: never = stage;
      return _never;
    }
  }
}

function ConceptDeck({
  open,
  slides,
  index,
  onIndex,
  onClose,
  onStart,
  exerciseN,
}: {
  open: boolean;
  slides: ConceptSlide[];
  index: number;
  onIndex: (n: number) => void;
  onClose: () => void;
  onStart?: () => void;
  exerciseN: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const ignoreScrollRef = useRef(false);
  const last = Math.max(0, slides.length - 1);
  const safeIndex = Math.min(Math.max(0, index), last);

  const slideAt = useCallback(
    (n: number) => viewportRef.current?.querySelectorAll<HTMLElement>('.e2-concept-slide')[n] ?? null,
    [],
  );

  const scrollToIndex = useCallback(
    (n: number, behavior: ScrollBehavior = 'smooth') => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      ignoreScrollRef.current = true;
      viewport.scrollTo({ left: n * viewport.clientWidth, behavior });
      slideAt(n)?.scrollTo({ top: 0 });
      window.setTimeout(() => {
        ignoreScrollRef.current = false;
      }, 420);
    },
    [slideAt],
  );

  useEffect(() => {
    if (!open) return;
    if (index !== safeIndex) {
      onIndex(safeIndex);
      return;
    }
    const frame = window.requestAnimationFrame(() => scrollToIndex(safeIndex));
    return () => window.cancelAnimationFrame(frame);
  }, [index, onIndex, open, safeIndex, scrollToIndex]);

  useEffect(() => {
    if (!open) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      const dx = event.shiftKey ? event.deltaY : event.deltaX;
      const dy = event.shiftKey ? 0 : event.deltaY;
      if (Math.abs(dx) >= Math.abs(dy) && Math.abs(dx) > 2) {
        event.preventDefault();
        viewport.scrollLeft += dx;
        return;
      }
      const slide = slideAt(safeIndex);
      if (!slide || Math.abs(dy) <= 1) return;
      const atTop = slide.scrollTop <= 1;
      const atBottom = slide.scrollTop + slide.clientHeight >= slide.scrollHeight - 2;
      if ((dy > 0 && !atBottom) || (dy < 0 && !atTop)) {
        event.preventDefault();
        slide.scrollTop += dy;
        return;
      }
      event.preventDefault();
      viewport.scrollLeft += dy;
    };
    const onScroll = () => {
      if (ignoreScrollRef.current) return;
      const width = viewport.clientWidth || 1;
      const next = Math.min(last, Math.max(0, Math.round(viewport.scrollLeft / width)));
      if (next !== safeIndex) onIndex(next);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [last, onIndex, open, safeIndex, slideAt]);

  if (!open || !slides.length) return null;
  const go = (delta: number) => {
    if (delta < 0) onIndex(Math.max(0, safeIndex - 1));
    else onIndex(Math.min(last, safeIndex + 1));
  };
  return (
    <div className="e2-modal-back e2-concept-back" role="presentation" onClick={onClose}>
      <div className="e2-concept-shell" onClick={(event) => event.stopPropagation()}>
        <button
          className="e2-btn e2-concept-arrow prev"
          type="button"
          aria-label="Previous concept"
          disabled={safeIndex <= 0}
          onClick={() => go(-1)}
        >
          <IconArrowLeft />
        </button>
        <div className="e2-modal e2-modal-concept" role="dialog" aria-modal="true" aria-label="Concept">
          <button
            className="e2-btn e2-modal-close e2-btn-icon e2-concept-close"
            type="button"
            onClick={onClose}
            aria-label="Close concept"
          >
            ✕
          </button>
          <div className="e2-intro-brand">
            <span className="e2-intro-badge">EXERCISE {exerciseN}</span>
            <span className="e2-intro-sub">Sort text automatically</span>
            <span className="e2-intro-pill">
              {safeIndex === 0 ? 'Intro' : `Slide ${safeIndex + 1} of ${slides.length}`}
            </span>
          </div>
          <div className="e2-concept-viewport" ref={viewportRef}>
            {slides.map((item, slideIndex) => (
              <article key={`${slideIndex}-${item.title}`} className="e2-concept-slide is-about">
                <h3>{item.title}</h3>
                <p className="e2-concept-lead">{item.body}</p>
                <ConceptStageView stage={item.stage} />
              </article>
            ))}
          </div>
          <div className="e2-concept-foot">
            <div className="e2-concept-dots" role="tablist" aria-label="Concept slides">
              {slides.map((item, slideIndex) => (
                <button
                  key={`${slideIndex}-${item.title}`}
                  className={`e2-concept-dot${slideIndex === safeIndex ? ' on' : ''}`}
                  type="button"
                  role="tab"
                  aria-selected={slideIndex === safeIndex}
                  aria-label={`Concept ${slideIndex + 1}: ${item.title}`}
                  onClick={() => onIndex(slideIndex)}
                />
              ))}
            </div>
            {safeIndex >= last && onStart ? (
              <button className="e2-btn e2-btn-train" type="button" onClick={onStart}>
                Start the lab
              </button>
            ) : null}
          </div>
        </div>
        <button
          className="e2-btn e2-concept-arrow next"
          type="button"
          aria-label={safeIndex >= last ? 'Start the lab' : 'Next concept'}
          onClick={() => {
            if (safeIndex >= last) {
              onStart?.();
              return;
            }
            go(1);
          }}
        >
          <IconArrowRight />
        </button>
      </div>
    </div>
  );
}

function countLabels(rows: StudioReview[]): Record<string, number> {
  const counts: Record<string, number> = {};
  rows.forEach((row) => {
    counts[row.label] = (counts[row.label] || 0) + 1;
  });
  return counts;
}

function canTrainRows(rows: StudioReview[]): boolean {
  const counts = countLabels(rows);
  const labels = Object.keys(counts);
  return labels.length >= 2 && labels.every((name) => counts[name] >= 2);
}

type BuddyFace = 'sleep' | 'idle' | 'listen' | 'type' | 'think' | 'speak' | 'cheer' | 'wait';
type OrbView = {
  mood: string;
  face: BuddyFace;
  label: string;
  labelColor: string;
  pct: string;
  ring: number;
};

const ASLEEP_ORB: OrbView = {
  mood: '#5a5a60',
  face: 'sleep',
  label: 'Asleep',
  labelColor: 'var(--e2-dim-2)',
  pct: 'train to wake me up',
  ring: 0,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixHex(channels: number[]): string {
  return `#${channels.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

const RED = [247, 118, 142];
const AMB = [230, 195, 92];
const GRN = [95, 216, 143];

function moodColor(p: number): string {
  if (p < 0.5) {
    const t = p / 0.5;
    return mixHex([lerp(RED[0], AMB[0], t), lerp(RED[1], AMB[1], t), lerp(RED[2], AMB[2], t)]);
  }
  const t = (p - 0.5) / 0.5;
  return mixHex([lerp(AMB[0], GRN[0], t), lerp(AMB[1], GRN[1], t), lerp(AMB[2], GRN[2], t)]);
}

function faceForScore(p: number): BuddyFace {
  if (p >= 0.85) return 'cheer';
  if (p >= 0.62) return 'speak';
  if (p > 0.45) return 'idle';
  if (p > 0.2) return 'wait';
  return 'think';
}

function learningFace(journey: number): BuddyFace {
  if (journey < 0.22) return 'think';
  if (journey < 0.5) return 'type';
  if (journey < 0.82) return 'listen';
  return 'cheer';
}

function StudioBuddy({ face }: { face: BuddyFace }) {
  switch (face) {
    case 'sleep':
    case 'idle':
    case 'listen':
    case 'type':
    case 'think':
    case 'speak':
    case 'cheer':
    case 'wait':
      break;
    default: {
      const _never: never = face;
      return _never;
    }
  }
  return <LabBuddy mood={face} className="e2-buddy" />;
}

function orbFromProbability(p: number | null): OrbView {
  if (p === null) return ASLEEP_ORB;
  const color = moodColor(p);
  const conf = Math.max(p, 1 - p);
  return {
    mood: color,
    face: faceForScore(p),
    label: p >= 0.55 ? 'Positive' : p <= 0.45 ? 'Negative' : 'Neutral',
    labelColor: color,
    pct: `${Math.round(conf * 100)}% confident`,
    ring: (conf - 0.5) * 2,
  };
}

function learningColor(acc: number): string {
  const t = Math.max(0, Math.min(1, (acc - 0.45) / 0.5));
  return mixHex([lerp(AMB[0], GRN[0], t), lerp(AMB[1], GRN[1], t), lerp(AMB[2], GRN[2], t)]);
}

function learningOrb(acc: number, epoch: number, total = 800): OrbView {
  const journey = Math.min(1, epoch / Math.max(total, 1));
  const faceAcc = 0.5 + 0.5 * journey;
  const color = learningColor(faceAcc);
  return {
    mood: color,
    face: learningFace(journey),
    label: 'Learning…',
    labelColor: color,
    pct: `${acc >= 0.999 ? Math.round(acc * 100) : Math.min(99, Math.max(0, Math.floor(acc * 100)))}% on test · epoch ${epoch}`,
    ring: Math.max(0.06, faceAcc),
  };
}

function normalizeCurve(points: TfidfCurvePoint[] | null | undefined): TfidfCurvePoint[] {
  return (Array.isArray(points) ? points : [])
    .filter((point): point is TfidfCurvePoint => Boolean(point))
    .map((point, i) => ({
      epoch: point.epoch ?? i + 1,
      loss: point.loss ?? 0,
      acc: point.acc ?? 0,
      train_acc: point.train_acc ?? point.acc ?? 0,
      prec: point.prec ?? 0,
      rec: point.rec ?? 0,
      f1: point.f1 ?? point.acc ?? 0,
      pos_words: point.pos_words || [],
      neg_words: point.neg_words || [],
      class_words: point.class_words || [],
    }));
}

function orbFromClass(scored: TfidfPredictResult): OrbView {
  const label = scored.label || 'Ready';
  const p = scored.probs?.find((item) => item.label === label)?.p ?? scored.probability;
  const color = moodColor(0.5 + 0.5 * Math.max(0, Math.min(1, p)));
  return {
    mood: color,
    face: faceForScore(0.35 + 0.65 * p),
    label,
    labelColor: color,
    pct: `${Math.round(p * 100)}% confident`,
    ring: Math.max(0.08, p),
  };
}

function usesClassOrb(scored: TfidfPredictResult): boolean {
  const classes = scored.classes && scored.classes.length ? scored.classes : ['negative', 'positive'];
  if (classes.length > 2) return true;
  const label = (scored.label || '').toLowerCase();
  return Boolean(label) && label !== 'positive' && label !== 'negative';
}

function readyOrb(): OrbView {
  return {
    mood: moodColor(0.5),
    face: 'listen',
    label: 'Ready',
    labelColor: 'var(--e2-dim)',
    pct: 'press Enter to classify',
    ring: 0,
  };
}

function typingOrb(): OrbView {
  return {
    mood: moodColor(0.5),
    face: 'type',
    label: 'Ready',
    labelColor: 'var(--e2-dim)',
    pct: 'press Enter when you are done',
    ring: 0,
  };
}

function needTicketOrb(): OrbView {
  return {
    mood: moodColor(0.5),
    face: 'listen',
    label: 'Need a ticket',
    labelColor: 'var(--e2-dim)',
    pct: 'needs real words',
    ring: 0,
  };
}

function thinkingOrb(): OrbView {
  return {
    mood: moodColor(0.55),
    face: 'think',
    label: 'Thinking…',
    labelColor: 'var(--e2-dim)',
    pct: 'reading your text',
    ring: 0.22,
  };
}

function applyScoredOrb(text: string, scored: TfidfPredictResult): OrbView {
  if (!canClassifyText(text) || scored.known_tokens === 0) return needTicketOrb();
  const view = usesClassOrb(scored) ? orbFromClass(scored) : orbFromProbability(scored.probability);
  return view;
}

function ticketReport(text: string, scored: TfidfPredictResult) {
  return {
    words: text.trim().split(/\s+/).filter(Boolean).length,
    known: scored.known_tokens || 0,
  };
}

function runningPct(value: number, done: boolean): string {
  const clamped = Math.max(0, Math.min(1, value));
  if (done) return `${Math.round(clamped * 100)}%`;
  return `${(clamped * 100).toFixed(1)}%`;
}

function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

function climbValue(value: number, t: number, delay: number): number {
  const span = Math.max(0.0001, 1 - delay);
  const u = easeOutCubic(Math.min(1, Math.max(0, t - delay) / span));
  return (Number(value) || 0) * u;
}

function liveCount(final: number, t: number, salt: number): number {
  const delay = ((salt % 8) / 8) * 0.1;
  return Math.round(climbValue(final, t, delay));
}

function matrixTotal(matrix: number[][]): number {
  return matrix.reduce((sum, row) => sum + row.reduce((cellSum, cell) => cellSum + (Number(cell) || 0), 0), 0);
}

function scorecardFromMatrix(result: TfidfTrainResult, matrix: number[][]) {
  const tn = matrix[0][0] || 0;
  const fp = matrix[0][1] || 0;
  const fn = matrix[1][0] || 0;
  const tp = matrix[1][1] || 0;
  const total = tp + fp + fn + tn;
  const acc = total ? (tp + tn) / total : result.test_accuracy || 0;
  const prec = tp + fp ? tp / (tp + fp) : result.test_precision || 0;
  const rec = tp + fn ? tp / (tp + fn) : result.test_recall || 0;
  const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : result.test_f1 || 0;
  return { tp, fp, fn, tn, acc, prec, rec, f1, correct: tp + tn, total };
}

function savedBinaryScorecard(result: TfidfTrainResult, threshold: number) {
  const probs = result.test_probs || [];
  const matrix = result.confusion_matrix;
  const trainedAt = typeof result.threshold === 'number' && Number.isFinite(result.threshold) ? result.threshold : 0.5;
  const full =
    matrix && matrix.length === 2 && matrix[0]?.length === 2 && matrix[1]?.length === 2 ? matrix : null;
  // Exercise 3 shows this same grid. At the cutoff used in training, do not recount a shorter score list.
  if (full && Math.abs(threshold - trainedAt) < 0.001 && matrixTotal(full) > 0) {
    return scorecardFromMatrix(result, full);
  }
  if (probs.length) return metricsAt(probs, threshold);
  if (full) return scorecardFromMatrix(result, full);
  return metricsAt(probs, threshold);
}

function liveMatrix(matrix: number[][] | undefined, t: number): number[][] {
  return (matrix || []).map((row, i) => row.map((cell, j) => liveCount(cell, t, i * 17 + j * 11 + 3)));
}

function emptySquare(n: number): number[][] {
  const size = Math.max(2, n);
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

function pct1(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

/** Same four numbers Exercise 3 shows at the Exercise 2 cutoff: the focus class, from this matrix. */
function sharedScorecard(result: TfidfTrainResult, datasetId: string): { acc: string; prec: string; rec: string; f1: string } | null {
  const matrix = result.confusion_matrix;
  const classes = (result.classes && result.classes.length ? result.classes : result.model?.classes) || [];
  if (!matrix || matrix.length < 2 || matrix.length !== classes.length) return null;
  if (matrix.some((row) => row.length !== classes.length)) return null;
  const focus = departmentFocus(datasetId);
  const index = focus ? classes.findIndex((name) => name.toLowerCase() === focus.toLowerCase()) : -1;
  const k = index >= 0 ? index : classes.length === 2 ? 1 : 0;
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let total = 0;
  matrix.forEach((row, i) => {
    row.forEach((cell, j) => {
      const count = Number(cell) || 0;
      total += count;
      if (i === k && j === k) tp += count;
      else if (i === k) fn += count;
      else if (j === k) fp += count;
    });
  });
  if (!total) return null;
  const tn = total - tp - fn - fp;
  const prec = tp + fp > 0 ? tp / (tp + fp) : null;
  const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = prec && rec ? (2 * prec * rec) / (prec + rec) : 0;
  const acc = (tp + tn) / total;
  return { acc: pct1(acc), prec: pct1(prec), rec: pct1(rec), f1: pct1(f1) };
}

function packMetrics(
  result: TfidfTrainResult,
  done: boolean,
  live?: { acc: number; prec: number; rec: number; f1: number },
  t = 1,
) {
  const acc = climbValue(live?.acc ?? result.test_accuracy ?? 0, t, 0);
  const prec = climbValue(live?.prec ?? result.test_precision ?? 0, t, 0.05);
  const rec = climbValue(live?.rec ?? result.test_recall ?? 0, t, 0.09);
  const f1 = climbValue(live?.f1 ?? result.test_f1 ?? 0, t, 0.13);
  return {
    acc: runningPct(acc, done),
    prec: runningPct(prec, done),
    rec: runningPct(rec, done),
    f1: runningPct(f1, done),
  };
}

const BLANK_METRICS = {
  acc: '—',
  prec: '—',
  rec: '—',
  f1: '—',
};

const RUNNING_ZERO_METRICS = {
  acc: '0.0%',
  prec: '0.0%',
  rec: '0.0%',
  f1: '0.0%',
};

function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2.2c4.9 0 8.9 3.8 8.9 8.5 0 4.4-3.4 8-7.7 8.5L10.6 22.4c-.35.25-.8 0-.75-.4l.45-3.2C6.3 17.9 3.1 14.6 3.1 10.7 3.1 6 7.1 2.2 12 2.2Z"
      />
      <path
        fill="#f4f4f5"
        d="M12 4.1c3.9 0 7 3 7 6.6 0 3.4-2.6 6.2-6 6.6l-.55.05-.15 1.15-.9-1.55c-3.1-.7-5.4-3.4-5.4-6.25 0-3.6 3.1-6.6 6-6.6Z"
      />
      <text
        x="12"
        y="13.4"
        textAnchor="middle"
        fill="#0A0A0F"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="700"
        fontSize="11"
      >
        i
      </text>
    </svg>
  );
}

function SetupHint({ label, info }: { label: string; info: string }) {
  return (
    <span className="e2-setup-heading">
      <span>{label}</span>
      <span className="e2-info" aria-label={`About ${label}`}>
        <IconInfo />
        <span className="e2-info-tip" role="tooltip">
          {info}
        </span>
      </span>
    </span>
  );
}

function SetupStepper({
  id,
  value,
  min,
  max,
  step,
  format,
  invalid,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  min: number;
  max: number;
  step: number;
  format?: (n: number) => string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const parsed = Number(value);
  const current = Number.isFinite(parsed) ? parsed : min;
  const decimals = step < 1 ? (String(step).split('.')[1] || '').length : 0;
  const shown = format ? format(current) : String(current);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(shown);
  const clampValue = (n: number) =>
    Math.min(max, Math.max(min, Number(n.toFixed(decimals))));
  const commit = (raw: string) => {
    const n = Number(String(raw).replace(/,/g, '').trim());
    onChange(String(Number.isFinite(n) ? clampValue(n) : min));
  };
  const bump = (dir: -1 | 1) => {
    if (disabled) return;
    const next = clampValue(current + dir * step);
    onChange(String(next));
    if (editing) setTyped(decimals ? next.toFixed(decimals) : String(next));
  };
  const allow = decimals ? /^\d*\.?\d*$/ : /^\d*$/;
  return (
    <div className={`e2-stepper${invalid ? ' need' : ''}`}>
      <button type="button" aria-label="Decrease" disabled={disabled || current <= min} onClick={() => bump(-1)}>
        −
      </button>
      <input
        id={id}
        type="text"
        inputMode={decimals ? 'decimal' : 'numeric'}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={editing ? typed : shown}
        onFocus={() => {
          setEditing(true);
          setTyped(decimals ? current.toFixed(decimals) : String(current));
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/,/g, '');
          if (!allow.test(next)) return;
          setTyped(next);
          if (next === '' || next.endsWith('.')) return;
          const n = Number(next);
          if (Number.isFinite(n)) onChange(String(clampValue(n)));
        }}
        onBlur={() => {
          setEditing(false);
          commit(typed);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            bump(1);
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            bump(-1);
          }
        }}
      />
      <button type="button" aria-label="Increase" disabled={disabled || current >= max} onClick={() => bump(1)}>
        +
      </button>
    </div>
  );
}

function SetupSegs({
  id,
  value,
  options,
  invalid,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className={`e2-segs${invalid ? ' need' : ''}`} id={id} role="group">
      {options.map((option) => (
        <button
          key={`${option.value}-${option.label}`}
          type="button"
          className={value === option.value ? 'on' : ''}
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polygon fill="currentColor" points="8 5 19 12 8 19" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 4v6h-6" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function IconReset() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconBulb() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    </svg>
  );
}

function IconArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconTfidf() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10" />
      <path d="M9 20V4" />
      <path d="M14 20v-6" />
      <path d="M19 20V8" />
    </svg>
  );
}

function IconEmbed() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function RepresentationCard({
  kind,
  selected,
  onSelect,
}: {
  kind: TextRepresentation;
  selected: boolean;
  onSelect: () => void;
}) {
  const tfidf = kind === 'tfidf';
  return (
    <button
      type="button"
      className={`e3-rep-card${selected ? ' on' : ''}${tfidf ? ' tfidf' : ' embed'}`}
      aria-pressed={selected}
      aria-label={tfidf ? 'TF-IDF' : 'Sentence Embeddings'}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <span className="e3-rep-ico" aria-hidden="true">
        {tfidf ? <IconTfidf /> : <IconEmbed />}
      </span>
      <b>{tfidf ? 'TF-IDF' : 'Sentence Embeddings'}</b>
    </button>
  );
}

function departmentIconKind(id: string): DepartmentId | 'other' {
  return (DEPARTMENT_IDS as readonly string[]).includes(id) ? (id as DepartmentId) : 'other';
}

function DepartmentIcon({ id }: { id: string }) {
  const kind = departmentIconKind(id);
  switch (kind) {
    case 'civil':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18" />
          <path d="M6 21V9l6-5 6 5v12" />
          <path d="M10 21v-6h4v6" />
        </svg>
      );
    case 'mechanical':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
      );
    case 'electrical':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'ece':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="7" width="10" height="10" rx="1" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
      );
    case 'cse':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="8 6 3 12 8 18" />
          <polyline points="16 6 21 12 16 18" />
        </svg>
      );
    case 'it':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case 'chemical':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3h6M10 3v6L5 18a4 4 0 0 0 3.5 6h7A4 4 0 0 0 19 18l-5-9V3" />
        </svg>
      );
    case 'aerospace':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 16l9-3 9 7-4-9 7-4-11 1L8 2 7 10 2 16z" />
        </svg>
      );
    case 'automobile':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 13 5 7h14l2 6" />
          <path d="M3 13h18v4H3z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="17" cy="18" r="1.5" />
        </svg>
      );
    case 'biomedical':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.6-7 10-7 10z" />
        </svg>
      );
    case 'other':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19V7l8-4 8 4v12" />
          <path d="M12 3v16" />
        </svg>
      );
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

const CHART_PAD = { l: 42, r: 40, t: 10, b: 24 };
const CHART_ACC = '#dbfe87';
const CHART_ACC_LIGHT = '#3f6212';
const CHART_LOSS = '#9333EA';
const CHART_LOSS_LIGHT = '#7a2ea8';

type CombinedAxis = 'pct' | 'loss';

type CombinedSeries = {
  id: 'loss' | 'acc';
  label: string;
  color: string;
  lightColor: string;
  axis: CombinedAxis;
  y: (point: TfidfCurvePoint) => number;
};

type ChartView = {
  hoverIndex: number | null;
  domainN: number;
  lossMax?: number;
  running?: boolean;
  light?: boolean;
};

const COMBINED_SERIES: CombinedSeries[] = [
  { id: 'loss', label: 'Loss', color: CHART_LOSS, lightColor: CHART_LOSS_LIGHT, axis: 'loss', y: (point) => point.loss },
  { id: 'acc', label: 'Accuracy', color: CHART_ACC, lightColor: CHART_ACC_LIGHT, axis: 'pct', y: (point) => point.acc },
];

function seriesPaint(item: CombinedSeries, light?: boolean): string {
  return light ? item.lightColor : item.color;
}

function seriesReadout(series: CombinedSeries, point: TfidfCurvePoint, done: boolean): string {
  if (series.axis === 'loss') return point.loss.toFixed(3);
  return runningPct(series.y(point), done);
}

function chartPlotBox(cssW: number, cssH: number) {
  return {
    x: CHART_PAD.l,
    y: CHART_PAD.t,
    w: Math.max(12, cssW - CHART_PAD.l - CHART_PAD.r),
    h: Math.max(12, cssH - CHART_PAD.t - CHART_PAD.b),
  };
}

function chartIndexFromX(
  cssW: number,
  cssH: number,
  points: TfidfCurvePoint[],
  domainEpochs: number,
  cssX: number,
): number {
  if (!points.length) return 0;
  const box = chartPlotBox(cssW, cssH);
  const t = (cssX - box.x) / Math.max(1e-6, box.w);
  const epoch = Math.max(0, Math.min(1, t)) * Math.max(1, domainEpochs);
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const dist = Math.abs(point.epoch - epoch);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  return best;
}

function lerpCurvePoint(a: TfidfCurvePoint, b: TfidfCurvePoint, t: number): TfidfCurvePoint {
  const u = Math.max(0, Math.min(1, t));
  return {
    epoch: a.epoch + (b.epoch - a.epoch) * u,
    loss: a.loss + (b.loss - a.loss) * u,
    acc: a.acc + (b.acc - a.acc) * u,
    train_acc: a.train_acc + (b.train_acc - a.train_acc) * u,
    prec: a.prec + (b.prec - a.prec) * u,
    rec: a.rec + (b.rec - a.rec) * u,
    f1: a.f1 + (b.f1 - a.f1) * u,
    pos_words: u < 0.5 ? a.pos_words : b.pos_words,
    neg_words: u < 0.5 ? a.neg_words : b.neg_words,
    class_words: u < 0.5 ? a.class_words : b.class_words,
  };
}

function pinCurveTail(points: TfidfCurvePoint[], finals: { acc: number; train_acc: number; prec: number; rec: number; f1: number }): TfidfCurvePoint[] {
  if (!points.length) return points;
  const last = points[points.length - 1];
  return [
    ...points.slice(0, -1),
    {
      ...last,
      acc: finals.acc,
      train_acc: finals.train_acc,
      prec: finals.prec,
      rec: finals.rec,
      f1: finals.f1,
    },
  ];
}

function chartTipStyle(tip: { x: number; y: number; w: number; h: number }): React.CSSProperties {
  const tw = 236;
  const th = 118;
  let left = tip.x + 14;
  let top = tip.y + 16;
  if (left + tw > tip.w - 6) left = tip.x - tw - 10;
  if (top + th > tip.h - 6) top = tip.y - th - 10;
  return {
    left: Math.max(6, Math.min(left, Math.max(6, tip.w - tw - 6))),
    top: Math.max(6, Math.min(top, Math.max(6, tip.h - th - 6))),
  };
}

function curveInsight(points: TfidfCurvePoint[], index: number, showAcc: boolean): string {
  const point = points[index];
  const prev = index > 0 ? points[index - 1] : null;
  if (!point) return 'Move along the curve to inspect training.';
  if (!prev) {
    return showAcc
      ? 'Start: the model has not learned yet, so accuracy is a majority-class guess.'
      : 'Start: weights are just beginning to update.';
  }
  const dAcc = point.acc - prev.acc;
  const dLoss = point.loss - prev.loss;
  if (!showAcc) {
    if (dLoss < -0.03) return 'Training loss dropped as class weights updated.';
    if (dLoss > 0.03) return 'Loss ticked up while the solver searched.';
    if (Math.abs(dLoss) < 0.02) return 'Loss is holding steady this step.';
    return 'The solver took another step.';
  }
  if (dAcc > 0.02 && dLoss < -0.01) {
    return 'Loss fell and more held-out texts were classified correctly.';
  }
  if (dAcc > 0.02) return 'Held-out accuracy improved at this iteration.';
  if (dAcc < -0.02) return 'A few test texts flipped the wrong way this step.';
  if (dLoss < -0.03) return 'Training loss dropped as class weights updated.';
  if (dLoss > 0.03) return 'Loss ticked up while the solver searched.';
  if (point.acc >= 0.9 && Math.abs(dAcc) < 0.01 && index >= points.length - 2) return 'Held-out accuracy has mostly settled.';
  if (Math.abs(dAcc) < 0.01 && Math.abs(dLoss) < 0.02) return 'Little change — the holdout score is holding steady.';
  return 'Weights updated; the held-out score stayed about the same.';
}

function drawLearningCurve(canvas: HTMLCanvasElement | null, points: TfidfCurvePoint[], view: ChartView) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = canvas.clientWidth || 280;
  const cssH = canvas.clientHeight || 180;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!points.length) return;

  const padL = CHART_PAD.l * dpr;
  const padR = CHART_PAD.r * dpr;
  const padT = CHART_PAD.t * dpr;
  const padB = CHART_PAD.b * dpr;
  const plotW = Math.max(12, w - padL - padR);
  const plotH = Math.max(12, h - padT - padB);
  const last = points.length - 1;
  const maxEpoch = Math.max(view.domainN, points[last]?.epoch ?? 0, 1);
  const lossMax = Math.max(view.lossMax || 0, ...points.map((point) => point.loss), 1e-6);
  const clampY = (y: number) => Math.max(padT, Math.min(padT + plotH, y));
  const xAtEpoch = (epoch: number) => padL + (Math.max(0, epoch) / maxEpoch) * plotW;
  const yOf = (value: number, axis: CombinedAxis) => {
    if (axis === 'loss') return padT + (1 - Math.max(0, Math.min(1, value / lossMax))) * plotH;
    return padT + (1 - Math.max(0, Math.min(1, value))) * plotH;
  };
  const xy = (point: TfidfCurvePoint, item: CombinedSeries) => ({
    x: xAtEpoch(point.epoch),
    y: yOf(item.y(point), item.axis),
  });
  const trace = (item: CombinedSeries) => {
    const first = xy(points[0], item);
    ctx.moveTo(first.x, first.y);
    if (points.length === 1) return;
    if (points.length === 2) {
      const next = xy(points[1], item);
      ctx.lineTo(next.x, next.y);
      return;
    }
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = xy(points[Math.max(0, i - 1)], item);
      const p1 = xy(points[i], item);
      const p2 = xy(points[i + 1], item);
      const p3 = xy(points[Math.min(points.length - 1, i + 2)], item);
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6,
        clampY(p1.y + (p2.y - p0.y) / 6),
        p2.x - (p3.x - p1.x) / 6,
        clampY(p2.y - (p3.y - p1.y) / 6),
        p2.x,
        p2.y,
      );
    }
  };

  ctx.lineWidth = dpr;
  ctx.strokeStyle = view.light ? 'rgba(22,22,22,0.12)' : 'rgba(255,255,255,0.08)';
  [0, 0.5, 1].forEach((t) => {
    const y = padT + (1 - t) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  });
  ctx.font = `${Math.round(9 * dpr)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = view.light ? 'rgba(22,22,22,0.72)' : 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'right';
  ctx.fillText('100%', padL - 4 * dpr, padT);
  ctx.fillText('50%', padL - 4 * dpr, padT + plotH / 2);
  ctx.fillText('0%', padL - 4 * dpr, padT + plotH);
  ctx.fillStyle = seriesPaint(COMBINED_SERIES[0], view.light);
  ctx.textAlign = 'left';
  ctx.fillText(lossMax.toFixed(2), padL + plotW + 4 * dpr, padT);
  ctx.fillText((lossMax / 2).toFixed(2), padL + plotW + 4 * dpr, padT + plotH / 2);
  ctx.fillText('0', padL + plotW + 4 * dpr, padT + plotH);
  ctx.fillStyle = view.light ? 'rgba(22,22,22,0.78)' : 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('0', padL, padT + plotH + 4 * dpr);
  ctx.fillText(String(Math.round(maxEpoch)), padL + plotW, padT + plotH + 4 * dpr);
  ctx.fillText('Epoch', padL + plotW / 2, padT + plotH + 4 * dpr);

  COMBINED_SERIES.forEach((item) => {
    const paint = seriesPaint(item, view.light);
    ctx.beginPath();
    ctx.lineWidth = 2.1 * dpr;
    ctx.strokeStyle = paint;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    trace(item);
    ctx.stroke();
    const head = points[last];
    ctx.beginPath();
    ctx.fillStyle = paint;
    ctx.arc(xAtEpoch(head.epoch), yOf(item.y(head), item.axis), 2.8 * dpr, 0, Math.PI * 2);
    ctx.fill();
  });

  if (view.running) {
    const headX = xAtEpoch(points[last].epoch);
    ctx.strokeStyle = view.light ? 'rgba(22,22,22,0.22)' : 'rgba(255,255,255,0.18)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(headX, padT);
    ctx.lineTo(headX, padT + plotH);
    ctx.stroke();
  }

  const hoverIndex = view.hoverIndex;
  if (hoverIndex != null) {
    const clamped = Math.max(0, Math.min(last, hoverIndex));
    const mx = xAtEpoch(points[clamped].epoch);
    ctx.strokeStyle = view.light ? 'rgba(22,22,22,0.38)' : 'rgba(255,255,255,0.34)';
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(mx, padT);
    ctx.lineTo(mx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    COMBINED_SERIES.forEach((item) => {
      ctx.beginPath();
      ctx.fillStyle = seriesPaint(item, view.light);
      ctx.arc(mx, yOf(item.y(points[clamped]), item.axis), 3.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = view.light ? '#ffffff' : '#000000';
      ctx.arc(mx, yOf(item.y(points[clamped]), item.axis), 1.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function celebrate(canvas: HTMLCanvasElement | null, reduceMotion: boolean) {
  if (!canvas || reduceMotion) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const parent = canvas.parentElement;
  document.body.appendChild(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.classList.add('show');
  const duration = 1000;
  const cols = ['#dbfe87', '#9333EA', '#7aa2f7', '#5fd88f', '#f7768e', '#e6c35c'];
  const parts = Array.from({ length: 220 }, (_, i) => ({
    x: Math.random() * width * dpr,
    y: Math.random() * height * dpr,
    vx: (Math.random() - 0.5) * 12 * dpr,
    vy: (Math.random() * 8 - 2) * dpr,
    g: 0.28 * dpr,
    s: (Math.random() * 8 + 4) * dpr,
    rot: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 0.45,
    c: cols[i % cols.length],
  }));
  const t0 = performance.now();
  const finish = () => {
    canvas.classList.remove('show');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    parent?.appendChild(canvas);
  };
  const frame = (now: number) => {
    const elapsed = now - t0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const fade = Math.max(0, 1 - elapsed / duration);
    parts.forEach((p) => {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.55);
      ctx.restore();
    });
    if (elapsed < duration) requestAnimationFrame(frame);
    else finish();
  };
  requestAnimationFrame(frame);
}

function TfidfLogisticRegression({ meta, swapLab = false }: { meta: ExerciseMeta; swapLab?: boolean }) {
  const { sessionId, projectId, markInProgress, markComplete, resetExercise, saveEx2Result, resetEpoch, getProgress, patchProgress, persist } =
    useExerciseSession();
  const reduceMotion = useMemo(
    () => (typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false),
    [],
  );

  const [data, setData] = useState<StudioReview[] | null>(null);
  const [dataError, setDataError] = useState('');
  const [activeDataset, setActiveDataset] = useState('');
  const [datasetMeta, setDatasetMeta] = useState<TfidfDatasetInfo | null>(null);
  const [catalog, setCatalog] = useState<TfidfDatasetInfo[]>(() => BUNDLED_TFIDF_CATALOG.filter((item) => item.id !== 'retail'));
  const [loadingDataset, setLoadingDataset] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFromEye, setPreviewFromEye] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectApplied, setInspectApplied] = useState(false);
  const [inspectRows, setInspectRows] = useState<InspectRow[]>([]);
  const [inspectStats, setInspectStats] = useState<PackInspectStats | null>(null);
  const [inspectStatsLoading, setInspectStatsLoading] = useState(false);
  const [textPrep, setTextPrep] = useState(() => ({ ...DEFAULT_TEXT_PREP }));
  const [fullTableOpen, setFullTableOpen] = useState(false);
  const [fullTablePage, setFullTablePage] = useState(0);
  const [packPageRows, setPackPageRows] = useState<StudioReview[] | null>(null);
  const [packPageLoading, setPackPageLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deptDraft, setDeptDraft] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const [conceptOpen, setConceptOpen] = useState(false);
  const [conceptIndex, setConceptIndex] = useState(0);
  const [labTheme, setLabTheme] = useState<LabTheme>('dark');
  const [needDataset, setNeedDataset] = useState(false);
  const [stageGate, setStageGate] = useState<{ n: 1 | 2 | 3; message: string; x: number; y: number } | null>(null);
  const [representation, setRepresentation] = useState<TextRepresentation>('tfidf');
  const [repChosen, setRepChosen] = useState(false);
  const [repModalOpen, setRepModalOpen] = useState(false);
  const [repDraft, setRepDraft] = useState<TextRepresentation | null>(null);
  const [compareBundle, setCompareBundle] = useState<{
    tfidf: TfidfTrainResult | null;
    embeddings: TfidfTrainResult | null;
    tfidfPred: TfidfPredictResult | null;
    embeddingsPred: TfidfPredictResult | null;
  }>({ tfidf: null, embeddings: null, tfidfPred: null, embeddingsPred: null });
  const [setupTried, setSetupTried] = useState(false);
  const [setup, dispatchSetupRaw] = useReducer(
    setupConfigReducer,
    undefined,
    () => readLiveSetup(sessionId, projectId, meta.id),
  );
  const [setupPane, setSetupPane] = useState<SetupPane>('basic');
  const { draft: draftConfig, preset: setupPreset } = setup;
  const draftConfigRef = useRef(draftConfig);
  const setupPresetRef = useRef(setupPreset);
  const setupRef = useRef(setup);
  draftConfigRef.current = draftConfig;
  setupPresetRef.current = setupPreset;
  setupRef.current = setup;
  const setupTouchedRef = useRef(setup.touched);
  const textPrepRef = useRef(textPrep);
  textPrepRef.current = textPrep;
  const inspectAppliedRef = useRef(inspectApplied);
  inspectAppliedRef.current = inspectApplied;
  const repChosenRef = useRef(repChosen);
  repChosenRef.current = repChosen;
  const representationRef = useRef(representation);
  representationRef.current = representation;

  const dispatchSetup = useCallback(
    (action: SetupAction) => {
      const next =
        action.type === 'set' ? cloneSetupConfig(action.config) : setupConfigReducer(setupRef.current, action);
      setupRef.current = next;
      setupTouchedRef.current = next.touched;
      writeLiveSetup(sessionId, projectId, meta.id, next);
      // Push absolute config into React state so we never double-apply and desync.
      dispatchSetupRaw({ type: 'set', config: next });
    },
    [meta.id, projectId, sessionId],
  );
  const [appliedConfig, setAppliedConfig] = useState<TfidfTrainConfig | null>(null);
  const [training, setTraining] = useState(false);
  const [watching, setWatching] = useState(false);
  const [trained, setTrained] = useState(false);
  const [hasTrained, setHasTrained] = useState(false);
  const [hint, setHint] = useState('');
  const [reviewText, setReviewText] = useState('');
  const [threshold, setThreshold] = useState(0.5);
  const [displayedMetrics, setDisplayedMetrics] = useState(BLANK_METRICS);
  const [playProgress, setPlayProgress] = useState(1);
  const [curve, setCurve] = useState<TfidfCurvePoint[]>([]);
  const [curveSpan, setCurveSpan] = useState({ n: 0, lossMax: 1 });
  const [chartTip, setChartTip] = useState<{
    index: number;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [trainResult, setTrainResult] = useState<TfidfTrainResult | null>(null);
  const [model, setModel] = useState<StudioModel | null>(null);
  const [prediction, setPrediction] = useState<TfidfPredictResult | null>(null);
  const [orb, setOrb] = useState<OrbView>(ASLEEP_ORB);
  const [liveEpoch, setLiveEpoch] = useState(0);
  const [totalEpochs, setTotalEpochs] = useState(0);
  const playGen = useRef(0);
  const scoreSeq = useRef(0);
  const pickGen = useRef(0);
  const previewForPack = useRef('');
  const inspectForPack = useRef('');
  const inspectRowsRef = useRef<InspectRow[]>([]);
  inspectRowsRef.current = inspectRows;
  const holdAutoPreview = useRef(false);
  const pickerFromPreview = useRef(false);
  const hydrating = useRef(true);
  const activeDatasetRef = useRef(activeDataset);
  activeDatasetRef.current = activeDataset;

  const resumeSetupAfterConcept = useRef(false);
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const fullTableScrollRef = useRef<HTMLDivElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const confettiRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const stageGateTimer = useRef<number | null>(null);
  const pushEx2UndoRef = useRef<() => void>(() => {});

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewFromEye(false);
    setFullTableOpen(false);
    setFullTablePage(0);
  }, []);

  const applyRows = useCallback((rows: StudioReview[], meta: TfidfDatasetInfo | null) => {
    setData(rows);
    setDataError('');
    setDatasetMeta(meta);
    setActiveDataset(meta?.id || 'upload');
    setConceptIndex(0);
    setConceptOpen(false);
    if (!holdAutoPreview.current) {
      setSetupOpen(false);
      setPreviewFromEye(false);
      setPreviewOpen(true);
    }
    setFullTableOpen(false);
    setFullTablePage(0);
    setPackPageRows(null);
    setPackPageLoading(false);
    setInspectOpen(false);
    setInspectApplied(false);
    setInspectRows([]);
    setInspectStats(null);
    setInspectStatsLoading(false);
    setTextPrep({ ...DEFAULT_TEXT_PREP });
    inspectForPack.current = '';
    inspectAppliedRef.current = false;
    setRepChosen(false);
    repChosenRef.current = false;
    setTrained(false);
    setHasTrained(false);
    setAppliedConfig(null);
    setTrainResult(null);
    setModel(null);
    setPrediction(null);
    setCurve([]);
    setCurveSpan({ n: 0, lossMax: 1 });
    setChartTip(null);
    setWatching(false);
    setLiveEpoch(0);
    setTotalEpochs(0);
    setTraining(false);
    playGen.current += 1;
    setOrb(ASLEEP_ORB);
    setReviewText('');
    setHint('');
    setNeedDataset(false);
    setStageGate(null);
    setSetupTried(false);
    setRepModalOpen(false);
    setCompareBundle({ tfidf: null, embeddings: null, tfidfPred: null, embeddingsPred: null });
  }, []);

  const pickDepartment = useCallback(
    async (datasetId: string) => {
      if (training) return;
      pushEx2UndoRef.current();
      const gen = (pickGen.current += 1);
      holdAutoPreview.current = false;
      pickerFromPreview.current = false;
      setPickerOpen(false);
      setNeedDataset(false);
      setStageGate(null);
      setDataError('');
      previewForPack.current = '';
      const source = getDepartmentSource(datasetId);
      const item = catalog.find((entry) => entry.id === datasetId);
      const pack = getDepartmentConcept(datasetId);
      const seed = toStudioPreview(pack?.samples || []);
      const meta = item
        ? item
        : source
          ? departmentSourceToMeta(source)
          : null;
      if (source && meta && seed.length) {
        applyRows(seed, meta);
      } else {
        setLoadingDataset(datasetId);
      }
      window.requestAnimationFrame(() => {
        if (pickGen.current !== gen || holdAutoPreview.current) return;
        setPreviewFromEye(false);
        setPreviewOpen(true);
        setFullTableOpen(false);
        setConceptOpen(false);
        setSetupOpen(false);
      });
      try {
        const payload = await loadTfidfDataset(sessionId, projectId, datasetId, { limit: PREVIEW_SAMPLE_COUNT });
        if (pickGen.current !== gen) return;
        const rows = toStudioPreview(payload.rows.length ? payload.rows : payload.examples);
        if (!rows.length) throw new Error('Could not load that department pack.');
        const nextMeta = {
          id: payload.id,
          name: payload.name,
          short: payload.short,
          theme: payload.theme,
          source: payload.source,
          use_case: payload.use_case,
          classes: payload.classes,
          n_rows: payload.n_rows || payload.rows.length,
        };
        if (source && meta && seed.length) {
          setData(rows);
          setDatasetMeta(nextMeta);
        } else {
          applyRows(rows, nextMeta);
        }
      } catch (error) {
        if (pickGen.current !== gen) return;
        if (!seed.length) {
          setDataError(error instanceof Error ? error.message : 'Could not load that department pack.');
        }
      } finally {
        if (pickGen.current === gen) {
          setLoadingDataset('');
          if (!holdAutoPreview.current) {
            setPreviewFromEye(false);
            setPreviewOpen(true);
            setFullTableOpen(false);
            setConceptOpen(false);
            setSetupOpen(false);
          }
        }
      }
    },
    [applyRows, catalog, projectId, sessionId, training],
  );

  useEffect(() => {
    setLabTheme(readLabTheme());
    return subscribeExerciseTheme(setLabTheme);
  }, []);

  useEffect(() => {
    const id = datasetMeta?.id;
    if (!id || !data?.length) return;
    if (previewForPack.current === id) return;
    previewForPack.current = id;
    if (holdAutoPreview.current) return;
    setPreviewFromEye(false);
    setPreviewOpen(true);
    setFullTableOpen(false);
    setConceptOpen(false);
    setSetupOpen(false);
  }, [data, datasetMeta]);

  useEffect(() => {
    let cancelled = false;
    void listTfidfDatasets(sessionId, projectId)
      .then((items) => {
        if (cancelled || !items.length) return;
        setCatalog(items.filter((item) => item.id !== 'retail'));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !conceptOpen) setPickerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conceptOpen, pickerOpen]);

  useEffect(() => {
    const packId = getDepartmentSource(activeDataset)?.id;
    if (!fullTableOpen || !packId) {
      setPackPageRows(null);
      setPackPageLoading(false);
      return undefined;
    }
    let cancelled = false;
    const page = fullTablePage;
    setPackPageRows(null);
    setPackPageLoading(true);
    void loadTfidfDataset(sessionId, projectId, packId, {
      offset: page * FULL_TABLE_PAGE_SIZE,
      limit: FULL_TABLE_PAGE_SIZE,
    })
      .then((payload) => {
        if (cancelled) return;
        setPackPageRows(toStudioPreview(payload.rows));
        window.requestAnimationFrame(() => {
          fullTableScrollRef.current?.scrollTo({ top: 0 });
        });
      })
      .catch(() => {
        if (!cancelled) setPackPageRows([]);
      })
      .finally(() => {
        if (!cancelled) setPackPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeDataset, fullTableOpen, fullTablePage, projectId, sessionId]);

  const finishTrain = useCallback(
    (result: TfidfTrainResult, opts?: { celebrate?: boolean }) => {
      const nextModel = modelFromExport(result.model);
      const source = getDepartmentSource(activeDatasetRef.current);
      const classes = (result.classes && result.classes.length >= 2 ? result.classes : result.model?.classes) || [];
      const matrix =
        result.confusion_matrix && result.confusion_matrix.length === classes.length
          ? result.confusion_matrix
          : confusionFromProbs(result.test_probs || [], classes.length);
      const handedOff = ex2ResultFromTrain(
        { ...result, classes, confusion_matrix: matrix },
        source?.id || activeDatasetRef.current || '',
      );
      if (handedOff) saveEx2Result(handedOff);
      setTrainResult({
        ...result,
        classes: handedOff?.classes || classes,
        confusion_matrix: handedOff?.matrix || matrix,
      });
      setModel(nextModel);
      setTrained(true);
      setHasTrained(true);
      setTraining(false);
      setWatching(false);
      setThreshold(result.threshold ?? 0.5);
      setPlayProgress(1);
      if (opts?.celebrate !== false) celebrate(confettiRef.current, reduceMotion);
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
      const nextText = reviewText.trim();
      markComplete(meta.id);
      if (!canClassifyText(cleanNoteText(nextText, textPrepRef.current, nextModel.representation || 'tfidf') || nextText)) {
        setPrediction(null);
        setOrb(readyOrb());
        setHint('');
        markInProgress(meta.id);
        return;
      }
      const scored = scoreWithModel(
        cleanNoteText(nextText, textPrepRef.current, nextModel.representation || 'tfidf') || nextText,
        nextModel,
      );
      setPrediction(scored);
      setOrb(applyScoredOrb(nextText, scored));
      setHint('Model updated — your text is re-scored above.');
      markInProgress(meta.id);
      if (result.simulated) return;
      const seq = (scoreSeq.current += 1);
      void predictTfidfLab(sessionId, projectId, nextText)
        .then((serverScored) => {
          if (scoreSeq.current !== seq) return;
          setPrediction(serverScored);
          setOrb(applyScoredOrb(nextText, serverScored));
        })
        .catch(() => undefined);
    },
    [activeDataset, markComplete, markInProgress, meta.id, projectId, reduceMotion, reviewText, saveEx2Result, sessionId],
  );

  const commitLab = useCallback(
    (snap: Ex2LabSnapshot, result: TfidfTrainResult | null, dropModel = false) => {
      if (!snap.datasetId || hydrating.current) return;
      const prevBlob = readEx2LabBlob(sessionId, projectId, meta.id);
      const datasetChanged = Boolean(prevBlob?.datasetId && prevBlob.datasetId !== snap.datasetId);
      const methodChanged = Boolean(
        prevBlob?.trainResult &&
          (prevBlob.trainResult.representation || 'tfidf') !== snap.representation,
      );
      const drop = dropModel || datasetChanged || methodChanged;
      const compacted = result != null ? compactTrainResult(result) : null;
      if (
        compacted &&
        !(compacted.test_probs || []).length &&
        !datasetChanged &&
        !methodChanged &&
        prevBlob?.trainResult?.test_probs?.length
      ) {
        compacted.test_probs = prevBlob.trainResult.test_probs;
      }
      const nextResult =
        compacted != null
          ? compacted
          : snap.training || drop
            ? null
            : prevBlob?.trainResult ?? null;
      if (drop && result == null) saveEx2Result(null);
      const nextSnap: Ex2LabSnapshot = {
        ...snap,
        trained: Boolean(snap.trained || nextResult),
        training: Boolean(snap.training && !nextResult),
      };
      const current = getProgress(meta.id);
      patchProgress(meta.id, {
        snapshot: nextSnap,
        status: current.status === 'completed' ? 'completed' : 'in_progress',
      });
      writeEx2LabBlob(sessionId, projectId, meta.id, {
        v: 1,
        datasetId: nextSnap.datasetId,
        trainResult: nextResult,
      });
      void persist();
    },
    [getProgress, meta.id, patchProgress, persist, projectId, saveEx2Result, sessionId],
  );

  const labLive = useRef({
    activeDataset,
    appliedConfig,
    datasetId: datasetMeta?.id || activeDataset,
    draftConfig,
    setupPreset,
    inspectApplied,
    textPrep,
    repChosen,
    representation,
    reviewText,
    trainResult,
    trained,
    training,
  });
  labLive.current = {
    activeDataset,
    appliedConfig,
    datasetId: datasetMeta?.id || activeDataset,
    draftConfig,
    setupPreset,
    inspectApplied,
    textPrep,
    repChosen,
    representation,
    reviewText,
    trainResult,
    trained,
    training,
  };

  const persistLabNow = useCallback(
    (
      extra?: Partial<Ex2LabSnapshot> & { trainResult?: TfidfTrainResult | null; dropModel?: boolean },
    ) => {
      const live = labLive.current;
      const datasetId = extra?.datasetId ?? live.datasetId;
      if (!datasetId) return;
      commitLab(
        {
          v: 1,
          datasetId,
          representation: extra?.representation ?? live.representation,
          inspectApplied: extra?.inspectApplied ?? live.inspectApplied,
          textPrep: extra?.textPrep === undefined ? live.textPrep : extra.textPrep,
          repChosen: extra?.repChosen ?? live.repChosen,
          appliedConfig: extra?.appliedConfig === undefined ? live.appliedConfig : extra.appliedConfig,
          draftConfig: extra?.draftConfig === undefined ? { ...live.draftConfig } : extra.draftConfig,
          setupPreset: extra?.setupPreset === undefined ? live.setupPreset : extra.setupPreset,
          trained: extra?.trained ?? (live.trained || Boolean(live.trainResult)),
          training: extra?.training ?? live.training,
          reviewText: extra?.reviewText ?? live.reviewText,
        },
        extra && Object.prototype.hasOwnProperty.call(extra, 'trainResult')
          ? extra.trainResult ?? null
          : live.trainResult,
        extra?.dropModel === true,
      );
    },
    [commitLab],
  );

  const skipUndoPushRef = useRef(false);
  const reviewUndoArmedRef = useRef(true);
  const { push: pushUndoSnapshot, undo: undoConfigSnapshot, canUndo: canConfigUndo } =
    useUndoHistory<Ex2UndoSnapshot>({ max: 40 });

  const captureEx2Undo = useCallback((): Ex2UndoSnapshot => {
    const live = labLive.current;
    return {
      activeDataset: live.activeDataset,
      datasetId: live.datasetId,
      representation: live.representation,
      repChosen: live.repChosen,
      inspectApplied: live.inspectApplied,
      textPrep: live.textPrep ? { ...live.textPrep } : null,
      setup: cloneSetupConfig(setupRef.current),
      appliedConfig: live.appliedConfig ? { ...live.appliedConfig } : null,
      reviewText: live.reviewText,
      threshold,
      trained: live.trained,
    };
  }, [threshold]);

  const pushEx2Undo = useCallback(() => {
    if (training || skipUndoPushRef.current) return;
    pushUndoSnapshot(captureEx2Undo());
  }, [captureEx2Undo, pushUndoSnapshot, training]);
  pushEx2UndoRef.current = pushEx2Undo;

  const clearTrainingArtifacts = useCallback(() => {
    setTrained(false);
    setHasTrained(false);
    setAppliedConfig(null);
    setTrainResult(null);
    setModel(null);
    setPrediction(null);
    setCurve([]);
    setCurveSpan({ n: 0, lossMax: 1 });
    setChartTip(null);
    setWatching(false);
    setLiveEpoch(0);
    setTotalEpochs(0);
    setTraining(false);
    playGen.current += 1;
    setOrb(ASLEEP_ORB);
    setCompareBundle({ tfidf: null, embeddings: null, tfidfPred: null, embeddingsPred: null });
  }, []);

  const reloadDatasetForUndo = useCallback(
    async (datasetId: string) => {
      if (!datasetId) return;
      const gen = (pickGen.current += 1);
      try {
        const payload = await loadTfidfDataset(sessionId, projectId, datasetId, { limit: PREVIEW_SAMPLE_COUNT });
        if (pickGen.current !== gen) return;
        const rows = toStudioPreview(payload.rows.length ? payload.rows : payload.examples);
        if (!rows.length) return;
        const nextMeta = {
          id: payload.id,
          name: payload.name,
          short: payload.short,
          theme: payload.theme,
          source: payload.source,
          use_case: payload.use_case,
          classes: payload.classes,
          n_rows: payload.n_rows || payload.rows.length,
        };
        setData(rows);
        setDatasetMeta(nextMeta);
        setActiveDataset(nextMeta.id);
        activeDatasetRef.current = nextMeta.id;
      } catch {
        /* keep restored config if reload fails */
      }
    },
    [projectId, sessionId],
  );

  const restoreEx2Undo = useCallback(
    (snap: Ex2UndoSnapshot) => {
      const prevDatasetId = datasetMeta?.id || activeDataset;
      const datasetChanged = snap.datasetId !== prevDatasetId;

      dispatchSetup({ type: 'set', config: cloneSetupConfig(snap.setup) });
      setRepresentation(snap.representation);
      representationRef.current = snap.representation;
      setRepDraft(snap.repChosen ? snap.representation : null);
      setRepChosen(snap.repChosen);
      repChosenRef.current = snap.repChosen;
      setInspectApplied(snap.inspectApplied);
      inspectAppliedRef.current = snap.inspectApplied;
      const prep = snap.textPrep ? { ...snap.textPrep } : { ...DEFAULT_TEXT_PREP };
      setTextPrep(prep);
      textPrepRef.current = prep;
      setAppliedConfig(snap.appliedConfig ? { ...snap.appliedConfig } : null);
      setReviewText(snap.reviewText);
      setThreshold(snap.threshold);
      setPrediction(null);
      setHint('');
      scoreSeq.current += 1;
      reviewUndoArmedRef.current = true;

      const keepModel =
        snap.trained &&
        !datasetChanged &&
        trainResult &&
        (trainResult.representation || 'tfidf') === snap.representation &&
        model;
      if (keepModel) {
        setTrained(true);
        setHasTrained(true);
      } else {
        clearTrainingArtifacts();
      }

      if (datasetChanged) {
        setActiveDataset(snap.activeDataset || snap.datasetId);
        activeDatasetRef.current = snap.activeDataset || snap.datasetId;
        void reloadDatasetForUndo(snap.datasetId);
      }

      persistLabNow({
        datasetId: snap.datasetId,
        representation: snap.representation,
        repChosen: snap.repChosen,
        inspectApplied: snap.inspectApplied,
        textPrep: prep,
        appliedConfig: snap.appliedConfig,
        draftConfig: snap.setup.draft,
        setupPreset: snap.setup.preset,
        reviewText: snap.reviewText,
        trained: Boolean(keepModel),
        dropModel: !keepModel,
      });
    },
    [
      activeDataset,
      clearTrainingArtifacts,
      datasetMeta?.id,
      dispatchSetup,
      model,
      persistLabNow,
      reloadDatasetForUndo,
      trainResult,
    ],
  );

  const handleEx2Undo = useCallback(() => {
    if (training) return;
    const snap = undoConfigSnapshot();
    if (!snap) return;
    skipUndoPushRef.current = true;
    try {
      restoreEx2Undo(snap);
    } finally {
      skipUndoPushRef.current = false;
    }
  }, [restoreEx2Undo, training, undoConfigSnapshot]);

  const showTrainComplete = useCallback(
    (result: TfidfTrainResult, celebrateAnim: boolean) => {
      const rawPoints = normalizeCurve(result.curve);
      const finalAcc = result.test_accuracy ?? rawPoints[rawPoints.length - 1]?.acc ?? 0;
      const points = pinCurveTail(rawPoints, {
        acc: finalAcc,
        train_acc: result.train_accuracy ?? rawPoints[rawPoints.length - 1]?.train_acc ?? finalAcc,
        prec: result.test_precision ?? rawPoints[rawPoints.length - 1]?.prec ?? 0,
        rec: result.test_recall ?? rawPoints[rawPoints.length - 1]?.rec ?? 0,
        f1: result.test_f1 ?? rawPoints[rawPoints.length - 1]?.f1 ?? 0,
      });
      const epochs = result.epochs || result.n_epochs || points[points.length - 1]?.epoch || points.length;
      const applied = configFromTrainResult(result);
      setTotalEpochs(epochs);
      setCurve(points);
      setCurveSpan({
        n: Math.max(epochs, points[points.length - 1]?.epoch || 0, 2),
        lossMax: Math.max(...points.map((point) => point.loss), 1e-6),
      });
      setLiveEpoch(Math.round(points[points.length - 1]?.epoch || epochs));
      setDisplayedMetrics(packMetrics(result, true, points[points.length - 1], 1));
      setPlayProgress(1);
      setAppliedConfig(applied);
      // Eagerly sync the persist mirror so an immediate leave/remount cannot write an empty blob.
      labLive.current = {
        ...labLive.current,
        trainResult: result,
        trained: true,
        training: false,
        appliedConfig: applied,
        draftConfig: draftFromConfig(applied),
      };
      finishTrain(result, { celebrate: celebrateAnim });
    },
    [finishTrain],
  );

  const runTrain = useCallback(
    async (trainConfig: TfidfTrainConfig, opts?: { skipPlay?: boolean }) => {
      if (training) return;
      const packSource = getDepartmentSource(activeDatasetRef.current || activeDataset);
      if (
        !canTrainEx2({
          hasData: Boolean(packSource || data),
          inspectApplied: inspectAppliedRef.current,
          repChosen: repChosenRef.current,
        })
      ) {
        return;
      }
      const rowCount = datasetMeta?.n_rows || data?.length || 0;
      if (!packSource && !data) return;
      if (!packSource && data && !canTrainRows(data)) {
        setSetupOpen(false);
        const message = 'Your dataset needs at least 2 examples in each class to train.';
        setDataError(message);
        setHint(message);
        return;
      }
      const readyConfig = clampTrainConfig(trainConfig);
      const chosenRep = trainConfig.representation || representationRef.current;
      const trainPayload: TfidfTrainConfig = { ...readyConfig, representation: chosenRep, textPrep: textPrepRef.current };
      setAppliedConfig(readyConfig);
      setThreshold(readyConfig.threshold);
      holdAutoPreview.current = true;
      setSetupOpen(false);
      setConceptOpen(false);
      setTraining(true);
      setTrained(false);
      setTrainResult(null);
      setWatching(false);
      setCurve([]);
      setCurveSpan({ n: 0, lossMax: 1 });
      setChartTip(null);
      setLiveEpoch(0);
      setDisplayedMetrics(RUNNING_ZERO_METRICS);
      setPlayProgress(0);
      setOrb(learningOrb(0.5, 0));
      setHint('');
      dispatchSetup({
        type: 'replace',
        draft: draftFromConfig(readyConfig),
        preset: setupPresetRef.current,
      });
      persistLabNow({
        appliedConfig: readyConfig,
        draftConfig: draftFromConfig(readyConfig),
        setupPreset: setupPresetRef.current,
        trained: false,
        training: true,
        trainResult: null,
      });
      const playThenFinish = (result: TfidfTrainResult) => {
        // Training finished — never let a stale hydrate lock block saving the model.
        hydrating.current = false;
        const datasetId =
          getDepartmentSource(activeDatasetRef.current || activeDataset)?.id ||
          activeDatasetRef.current ||
          activeDataset ||
          '';
        const handedOff = ex2ResultFromTrain(result, datasetId);
        if (handedOff) saveEx2Result(handedOff);
        const shared = handedOff
          ? { ...result, classes: handedOff.classes, confusion_matrix: handedOff.matrix }
          : result;
        labLive.current = {
          ...labLive.current,
          trainResult: shared,
          trained: true,
          training: false,
          appliedConfig: readyConfig,
          draftConfig: draftFromConfig(readyConfig),
        };
        persistLabNow({
          appliedConfig: readyConfig,
          draftConfig: draftFromConfig(readyConfig),
          setupPreset: setupPresetRef.current,
          trained: true,
          training: false,
          trainResult: shared,
        });
        if (opts?.skipPlay) {
          showTrainComplete(shared, false);
          return;
        }
        const rawPoints = normalizeCurve(result.curve);
        const finalAcc = result.test_accuracy ?? rawPoints[rawPoints.length - 1]?.acc ?? 0;
        const points = pinCurveTail(rawPoints, {
          acc: finalAcc,
          train_acc: result.train_accuracy ?? rawPoints[rawPoints.length - 1]?.train_acc ?? finalAcc,
          prec: result.test_precision ?? rawPoints[rawPoints.length - 1]?.prec ?? 0,
          rec: result.test_recall ?? rawPoints[rawPoints.length - 1]?.rec ?? 0,
          f1: result.test_f1 ?? rawPoints[rawPoints.length - 1]?.f1 ?? 0,
        });
        const epochs = result.epochs || result.n_epochs || points[points.length - 1]?.epoch || points.length;
        setTotalEpochs(epochs);
        setCurveSpan({
          n: Math.max(epochs, points[points.length - 1]?.epoch || 0, 2),
          lossMax: Math.max(...points.map((point) => point.loss), 1e-6),
        });
        const gen = (playGen.current += 1);
        const applyFrame = (shown: TfidfCurvePoint[], point: TfidfCurvePoint | undefined, t: number) => {
          if (!point) return;
          const u = Math.max(0, Math.min(1, t));
          const done = u >= 1;
          setCurve(shown);
          setLiveEpoch(Math.round(point.epoch));
          setOrb(learningOrb(point.acc, point.epoch, epochs));
          setDisplayedMetrics(packMetrics(result, done, point, reduceMotion ? 1 : u));
          setPlayProgress(reduceMotion || done ? 1 : u);
        };
        if (points.length < 2) {
          if (points.length) applyFrame(points, points[points.length - 1], 1);
          finishTrain(shared);
          return;
        }
        setTrainResult(shared);
        setWatching(true);
        applyFrame(points.slice(0, 1), points[0], 0);
        const playMs = trainPlayMs(epochs);
        const t0 = performance.now();
        const tick = (now: number) => {
          if (playGen.current !== gen) return;
          const t = Math.min(1, (now - t0) / playMs);
          const last = Math.max(0, points.length - 1);
          const exact = t * last;
          const idx = Math.max(0, Math.min(last, Math.floor(exact)));
          const frac = exact - idx;
          const shown = points.slice(0, idx + 1);
          if (frac > 0.001 && idx < last) shown.push(lerpCurvePoint(points[idx], points[idx + 1], frac));
          applyFrame(shown, shown[shown.length - 1], t);
          if (t < 1) {
            requestAnimationFrame(tick);
            return;
          }
          setWatching(false);
          finishTrain(shared);
        };
        requestAnimationFrame(tick);
      };
      try {
        const departmentId = getDepartmentSource(activeDatasetRef.current || activeDataset)?.id;
        const result = await trainTfidfLab(
          sessionId,
          projectId,
          departmentId || !data ? [] : toTrainRows(data),
          trainPayload,
          departmentId,
        );
        if (swapLab && data && rowCount <= 1500) {
          const otherRep: TextRepresentation = chosenRep === 'tfidf' ? 'embeddings' : 'tfidf';
          const other = trainLocal(toPreparedStudio(data, textPrepRef.current, otherRep), {
            ...readyConfig,
            representation: otherRep,
          });
          setCompareBundle(buildCompareBundle(chosenRep, result, other, reviewText));
        }
        playThenFinish(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Training failed.';
        if (rowCount > 1500 || packSource) {
          setTraining(false);
          setWatching(false);
          setHint(message);
          setOrb(ASLEEP_ORB);
          persistLabNow({ training: false, trained: false, trainResult: null });
          return;
        }
        try {
          if (!data) throw new Error(message);
          const local = trainLocal(toPreparedStudio(data, textPrepRef.current, chosenRep), trainPayload);
          if (swapLab) {
            const otherRep: TextRepresentation = chosenRep === 'tfidf' ? 'embeddings' : 'tfidf';
            const other = trainLocal(toPreparedStudio(data, textPrepRef.current, otherRep), {
              ...readyConfig,
              representation: otherRep,
            });
            setCompareBundle(buildCompareBundle(chosenRep, local, other, reviewText));
          }
          playThenFinish(local);
        } catch (localError) {
          setTraining(false);
          setWatching(false);
          setHint(localError instanceof Error ? localError.message : message);
          setOrb(ASLEEP_ORB);
          persistLabNow({ training: false, trained: false, trainResult: null });
        }
      }
    },
    [activeDataset, data, datasetMeta, finishTrain, persistLabNow, projectId, reduceMotion, representation, reviewText, saveEx2Result, sessionId, showTrainComplete, swapLab, training],
  );

  const closeConcept = useCallback(() => {
    setConceptOpen(false);
    markConceptSeen(sessionId, projectId, meta.id);
    if (resumeSetupAfterConcept.current) {
      setSetupOpen(true);
      resumeSetupAfterConcept.current = false;
    }
  }, [meta.id, projectId, sessionId]);

  const openConcept = useCallback(() => {
    if (training || watching) return;
    setPickerOpen(false);
    resumeSetupAfterConcept.current = setupOpen;
    setConceptIndex(0);
    setInspectOpen(false);
    setConceptOpen(true);
  }, [setupOpen, training, watching]);

  useEffect(() => {
    setConceptIndex(0);
    setPickerOpen(false);
    closePreview();
    setSetupOpen(false);
    setSetupPane('basic');
    setRepModalOpen(false);
    if (resetEpoch > 0) {
      setConceptOpen(true);
      clearLiveSetup(sessionId, projectId, meta.id);
      const fresh = createSetupConfig();
      writeLiveSetup(sessionId, projectId, meta.id, fresh);
      setupRef.current = fresh;
      setupTouchedRef.current = false;
      dispatchSetupRaw({ type: 'set', config: fresh });
      setSetupTried(false);
      setAppliedConfig(null);
    }
  }, [closePreview, meta.id, projectId, resetEpoch, sessionId]);

  const showTrainCompleteRef = useRef(showTrainComplete);
  showTrainCompleteRef.current = showTrainComplete;
  const runTrainRef = useRef(runTrain);
  runTrainRef.current = runTrain;
  const dispatchSetupHydrateRef = useRef(dispatchSetup);
  dispatchSetupHydrateRef.current = dispatchSetup;
  const getProgressRef = useRef(getProgress);
  getProgressRef.current = getProgress;
  const markInProgressRef = useRef(markInProgress);
  markInProgressRef.current = markInProgress;

  useEffect(() => {
    if (!sessionId || !projectId) {
      hydrating.current = false;
      return undefined;
    }
    let cancelled = false;
    hydrating.current = true;
    const blob = readEx2LabBlob(sessionId, projectId, meta.id);
    const savedResult = blob?.trainResult || null;
    const progressSnap = parseEx2LabSnapshot(getProgressRef.current(meta.id).snapshot);
    const snap =
      progressSnap ||
      (savedResult && blob?.datasetId
        ? {
            v: 1 as const,
            datasetId: blob.datasetId,
            representation:
              savedResult.representation === 'embeddings' ? ('embeddings' as const) : ('tfidf' as const),
            inspectApplied: true,
            textPrep: { ...DEFAULT_TEXT_PREP },
            repChosen: true,
            appliedConfig: null,
            draftConfig: null,
            trained: true,
            training: false,
            reviewText: '',
          }
        : null);
    const seen = hasConceptSeen(sessionId, projectId, meta.id);
    if (!snap) {
      hydrating.current = false;
      if (!seen) setConceptOpen(true);
      return () => {
        cancelled = true;
      };
    }
    holdAutoPreview.current = true;
    previewForPack.current = snap.datasetId;
    setConceptOpen(false);
    markConceptSeen(sessionId, projectId, meta.id);
    markInProgressRef.current(meta.id);
    if (snap.reviewText) setReviewText(snap.reviewText);
    if (snap.appliedConfig) setAppliedConfig(snap.appliedConfig);
    if (!setupTouchedRef.current) {
      if (snap.draftConfig) {
        const base = snap.appliedConfig ? draftFromConfig(snap.appliedConfig) : defaultSetupDraft();
        const next = { ...base, ...snap.draftConfig } as SetupDraft;
        const restored =
          snap.setupPreset === 'quick' || snap.setupPreset === 'balanced' || snap.setupPreset === 'thorough'
            ? snap.setupPreset
            : matchingSetupPreset(next, snap.representation) || 'balanced';
        dispatchSetupHydrateRef.current({
          type: 'replace',
          draft: next,
          preset: restored,
          touched: false,
          advancedLocked: matchingSetupPreset(next, snap.representation) === null,
        });
      } else if (snap.appliedConfig) {
        const fromApplied = draftFromConfig(snap.appliedConfig);
        const restored =
          snap.setupPreset === 'quick' || snap.setupPreset === 'balanced' || snap.setupPreset === 'thorough'
            ? snap.setupPreset
            : matchingSetupPreset(fromApplied, snap.representation) || 'balanced';
        dispatchSetupHydrateRef.current({
          type: 'replace',
          draft: fromApplied,
          preset: restored,
          touched: false,
          advancedLocked: false,
        });
      } else if (savedResult) {
        const fromResult = draftFromConfig(configFromTrainResult(savedResult));
        dispatchSetupHydrateRef.current({
          type: 'replace',
          draft: fromResult,
          preset: matchingSetupPreset(fromResult, snap.representation) || 'balanced',
          touched: false,
          advancedLocked: false,
        });
      }
    }
    setRepresentation(snap.representation);
    representationRef.current = snap.representation;
    setRepDraft(snap.representation);
    setRepChosen(snap.repChosen || Boolean(savedResult));
    repChosenRef.current = snap.repChosen || Boolean(savedResult);
    setInspectApplied(snap.inspectApplied || Boolean(savedResult));
    inspectAppliedRef.current = snap.inspectApplied || Boolean(savedResult);
    setTextPrep(parseTextPrep(snap.textPrep));
    const source = getDepartmentSource(snap.datasetId);
    const item = catalog.find((entry) => entry.id === snap.datasetId);
    const pack = getDepartmentConcept(snap.datasetId);
    const seed = toStudioPreview(pack?.samples || []);
    const nextMeta = item
      ? item
      : source
        ? departmentSourceToMeta(source)
        : null;
    if (nextMeta) {
      setDatasetMeta(nextMeta);
      setActiveDataset(nextMeta.id);
      activeDatasetRef.current = nextMeta.id;
    } else {
      setActiveDataset(snap.datasetId);
      activeDatasetRef.current = snap.datasetId;
    }
    if (seed.length) setData(seed);
    const result =
      savedResult &&
      blob?.datasetId === snap.datasetId &&
      (savedResult.representation || 'tfidf') === snap.representation
        ? savedResult
        : null;
    const done = Boolean(result);
    // Restore the trained UI immediately from the saved blob — do not wait on the
    // preview dataset fetch (it can take seconds and was racing effect cleanups).
    if (done && result) {
      showTrainCompleteRef.current(result, false);
      window.setTimeout(() => {
        if (!cancelled) hydrating.current = false;
      }, 0);
    }
    void loadTfidfDataset(sessionId, projectId, snap.datasetId, { limit: PREVIEW_SAMPLE_COUNT })
      .then((payload) => {
        if (cancelled) return;
        const rows = toStudioPreview(payload.rows.length ? payload.rows : payload.examples);
        if (!rows.length) return;
        setData(rows);
        setDatasetMeta({
          id: payload.id,
          name: payload.name,
          short: payload.short,
          theme: payload.theme,
          source: payload.source,
          use_case: payload.use_case,
          classes: payload.classes,
          n_rows: payload.n_rows || payload.rows.length,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        if (!done && snap.training && snap.appliedConfig && snap.inspectApplied && snap.repChosen) {
          void runTrainRef.current(snap.appliedConfig, { skipPlay: true });
        }
        if (!done) {
          hydrating.current = false;
        }
      });
    return () => {
      cancelled = true;
      // Do not clear hydrating here if we already restored a trained model;
      // a brief remount race used to skip showTrainComplete and leave Asleep.
      if (!done) hydrating.current = false;
    };
  }, [catalog, meta.id, projectId, resetEpoch, sessionId]);

  useEffect(() => {
    if (hydrating.current) return undefined;
    if (!activeDataset && !datasetMeta) return undefined;
    const timer = window.setTimeout(() => persistLabNow(), 400);
    return () => window.clearTimeout(timer);
  }, [
    activeDataset,
    appliedConfig,
    datasetMeta,
    draftConfig,
    inspectApplied,
    persistLabNow,
    repChosen,
    representation,
    reviewText,
    setupPreset,
    textPrep,
    trained,
    training,
    trainResult,
  ]);

  useEffect(() => {
    const classes = data ? uniqueLabels(data) : datasetMeta?.classes || [];
    if (classes.length > 2 && draftConfig.solver === 'liblinear') {
      dispatchSetup({ type: 'patch', patch: { solver: 'lbfgs' } });
    }
  }, [data, datasetMeta, dispatchSetup, draftConfig.solver]);

  const persistLabNowRef = useRef(persistLabNow);
  persistLabNowRef.current = persistLabNow;

  useEffect(() => {
    return () => {
      if (!hydrating.current) persistLabNowRef.current();
    };
  }, []);

  useEffect(() => {
    const onLeave = () => {
      if (!hydrating.current) persistLabNowRef.current();
    };
    window.addEventListener('pagehide', onLeave);
    const onHide = () => {
      if (document.visibilityState === 'hidden') onLeave();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (stageGateTimer.current) window.clearTimeout(stageGateTimer.current);
    };
  }, []);

  const openSetup = () => {
    if (!data || training || !inspectAppliedRef.current || !repChosenRef.current) return;
    holdAutoPreview.current = true;
    setNeedDataset(false);
    setSetupTried(false);
    closeConcept();
    closePreview();
    setRepModalOpen(false);
    // Keep the shared draft as-is. Only Reset to Defaults (or exercise reset) clears it.
    setSetupOpen(true);
  };

  const applyRepresentation = (next: TextRepresentation, persist = true) => {
    const changed = next !== representation;
    if (changed) pushEx2UndoRef.current();
    setRepresentation(next);
    representationRef.current = next;
    setRepDraft(next);
    setRepChosen(true);
    repChosenRef.current = true;
    setRepModalOpen(false);
    setStageGate(null);
    if (persist) storeRepresentation(next, swapLab);
    if (changed) {
      dispatchSetup({ type: 'preset', id: setupPresetRef.current, representation: next });
      setTrained(false);
      setHasTrained(false);
      setAppliedConfig(null);
      setTrainResult(null);
      setModel(null);
      setPrediction(null);
      setCurve([]);
      setCurveSpan({ n: 0, lossMax: 1 });
      setChartTip(null);
      setWatching(false);
      setLiveEpoch(0);
      setTotalEpochs(0);
      setTraining(false);
      playGen.current += 1;
      setOrb(ASLEEP_ORB);
      setHint('');
      setCompareBundle({ tfidf: null, embeddings: null, tfidfPred: null, embeddingsPred: null });
    }
    persistLabNow({
      representation: next,
      repChosen: true,
      ...(changed
        ? { trained: false, training: false, trainResult: null, dropModel: true }
        : {}),
    });
  };

  const openRepresentationModal = (skipInspect = false) => {
    if (training) return;
    if (!skipInspect && !inspectAppliedRef.current) {
      openInspectModal();
      return;
    }
    holdAutoPreview.current = true;
    setRepDraft(repChosen ? representation : null);
    setConceptOpen(false);
    closePreview();
    setInspectOpen(false);
    setPickerOpen(false);
    setSetupOpen(false);
    setRepModalOpen(true);
  };

  const closeRepresentationModal = () => {
    setRepModalOpen(false);
  };

  const confirmRepresentation = () => {
    if (!repDraft) return;
    holdAutoPreview.current = true;
    applyRepresentation(repDraft, true);
    setNeedDataset(false);
    setSetupTried(false);
    closePreview();
    setPickerOpen(false);
    setRepModalOpen(false);
  };

  const closeDatasetModal = () => {
    setPickerOpen(false);
    if (pickerFromPreview.current && data && !training) {
      pickerFromPreview.current = false;
      holdAutoPreview.current = true;
      setPreviewFromEye(false);
      setPreviewOpen(true);
    }
  };

  const openPreviewStep = () => {
    if (training || !data) return;
    holdAutoPreview.current = true;
    pickerFromPreview.current = false;
    setConceptOpen(false);
    setPickerOpen(false);
    setRepModalOpen(false);
    setInspectOpen(false);
    setSetupOpen(false);
    setFullTableOpen(false);
    setPreviewFromEye(false);
    setPreviewOpen(true);
  };

  const loadInspectSample = useCallback(async () => {
    const packId = getDepartmentSource(activeDatasetRef.current)?.id;
    const seed = (data || []).map((row) => ({ review: row.review, label: row.label }));
    if (!packId) {
      if (seed.length) setInspectRows(seed);
      setInspectStats(null);
      setInspectStatsLoading(false);
      inspectForPack.current = activeDatasetRef.current || 'upload';
      return;
    }
    if (!inspectRowsRef.current.length && seed.length) setInspectRows(seed);
    if (inspectForPack.current === packId && inspectRowsRef.current.length >= 20 && inspectStats) return;
    setInspectStatsLoading(true);
    try {
      const payload = await loadTfidfDataset(sessionId, projectId, packId, {
        limit: FULL_TABLE_PAGE_SIZE,
        inspect: true,
      });
      const next = toInspectRows(payload.rows.length ? payload.rows : payload.examples || []);
      setInspectRows((prev) => (next.length >= prev.length ? next : prev));
      setInspectStats(parsePackInspect(payload.inspect));
      inspectForPack.current = packId;
    } catch {
      if (!inspectRowsRef.current.length && seed.length) setInspectRows(seed);
      inspectForPack.current = packId;
    } finally {
      setInspectStatsLoading(false);
    }
  }, [data, inspectStats, projectId, sessionId]);

  const openInspectModal = () => {
    if (training || !data) return;
    holdAutoPreview.current = true;
    closePreview();
    setConceptOpen(false);
    setPickerOpen(false);
    setRepModalOpen(false);
    setSetupOpen(false);
    setInspectOpen(true);
    void loadInspectSample();
  };

  const applyInspect = () => {
    if (training || !data) return;
    pushEx2UndoRef.current();
    const nextPrep = { ...textPrepRef.current, stopwords: false, lemmatize: false };
    setTextPrep(nextPrep);
    textPrepRef.current = nextPrep;
    setInspectApplied(true);
    inspectAppliedRef.current = true;
    setInspectOpen(false);
    persistLabNow({ inspectApplied: true, textPrep: nextPrep });
  };

  const backFromRepresentation = () => {
    if (training) return;
    setRepModalOpen(false);
    openInspectModal();
  };

  const backFromSetup = () => {
    if (training) return;
    setSetupOpen(false);
    openRepresentationModal(true);
  };

  const askCompleteStage = (n: 1 | 2 | 3, event?: { clientX: number; clientY: number }) => {
    const point = gateCursorPoint(event);
    setNeedDataset(n === 1);
    setStageGate({ n, message: stageGateMessage(n), x: point.x, y: point.y });
    if (stageGateTimer.current) window.clearTimeout(stageGateTimer.current);
    stageGateTimer.current = window.setTimeout(() => {
      setStageGate(null);
      stageGateTimer.current = null;
    }, 1200);
  };

  const requestStart = () => {
    if (training) return;
    if (!data || !inspectAppliedRef.current) {
      askCompleteStage(1);
      return;
    }
    if (!repChosenRef.current) {
      askCompleteStage(2);
      return;
    }
    holdAutoPreview.current = true;
    closePreview();
    setPickerOpen(false);
    setStageGate(null);
    openSetup();
  };

  const continueFromPreview = () => {
    if (training || !data) return;
    closePreview();
    openInspectModal();
  };

  const openDatasetBoard = (fromPreview = false) => {
    if (training) return;
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    pickerFromPreview.current = fromPreview;
    setConceptOpen(false);
    closePreview();
    setInspectOpen(false);
    setSetupOpen(false);
    setRepModalOpen(false);
    setDeptDraft(activeDataset || '');
    setPickerOpen(true);
  };

  const confirmDepartment = () => {
    if (!deptDraft || training || Boolean(loadingDataset)) return;
    if (deptDraft === activeDataset && data) {
      pickerFromPreview.current = false;
      setPickerOpen(false);
      setPreviewFromEye(false);
      setPreviewOpen(true);
      setFullTableOpen(false);
      return;
    }
    void pickDepartment(deptDraft);
  };

  const onFlowStep = (n: 1 | 2 | 3 | 4, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (training) return;
    if (n > flowStep) {
      const prior = flowStep === 1 || flowStep === 2 || flowStep === 3 ? flowStep : 3;
      askCompleteStage(prior, event);
      return;
    }
    switch (n) {
      case 1:
        setStageGate(null);
        if (data && !inspectAppliedRef.current) {
          openInspectModal();
          return;
        }
        openDatasetBoard();
        return;
      case 2:
        if (!data || !inspectAppliedRef.current) {
          askCompleteStage(1, event);
          return;
        }
        setStageGate(null);
        openRepresentationModal(true);
        return;
      case 3:
        requestStart();
        return;
      case 4:
        if (!data || !inspectAppliedRef.current) {
          askCompleteStage(1, event);
          return;
        }
        if (!repChosenRef.current) {
          askCompleteStage(2, event);
          return;
        }
        if (!trained) {
          askCompleteStage(3, event);
          return;
        }
        document.getElementById('e2-review')?.focus();
        return;
      default: {
        const _never: never = n;
        return _never;
      }
    }
  };

  const submitSetup = () => {
    if (
      training ||
      !canTrainEx2({
        hasData: Boolean(data),
        inspectApplied: inspectAppliedRef.current,
        repChosen: repChosenRef.current,
      })
    ) {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.e2-setup-modal')) {
      active.blur();
    }
    window.setTimeout(() => {
      const latest = draftConfigRef.current;
      const presetId = setupPresetRef.current;
      if (setupPane === 'advanced' && missingSetupFields(latest, representation).length) {
        setSetupTried(true);
        return;
      }
      const forTrain = fillEmptySetupFields(latest, presetId, representation);
      setupTouchedRef.current = true;
      setSetupTried(false);
      void runTrain(configFromDraft(forTrain));
    }, 0);
  };

  const chooseSetupPane = (pane: SetupPane) => {
    setSetupTried(false);
    setSetupPane(pane);
    if (pane === 'advanced') {
      dispatchSetup({ type: 'revealAdvanced' });
    }
  };

  const resetSetupDefaults = () => {
    pushEx2UndoRef.current();
    setupTouchedRef.current = true;
    setSetupTried(false);
    dispatchSetup({ type: 'reset', representation });
  };

  const patchDraft = (patch: Partial<SetupDraft>) => {
    pushEx2UndoRef.current();
    setupTouchedRef.current = true;
    dispatchSetup({ type: 'patch', patch });
  };

  const onChartPointer = (event: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
    const canvas = chartRef.current;
    if (!canvas || curve.length < 1) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const wrap = event.currentTarget.getBoundingClientRect();
    const domainEpochs = Math.max(curveSpan.n, curve[curve.length - 1]?.epoch || curve.length, 2);
    const index = chartIndexFromX(rect.width, rect.height, curve, domainEpochs, cssX);
    setChartTip({
      index,
      x: event.clientX - wrap.left,
      y: event.clientY - wrap.top,
      w: wrap.width,
      h: wrap.height,
    });
  };

  const paintChart = useCallback(() => {
    const hoverIndex = chartTip?.index ?? (watching ? curve.length - 1 : null);
    const domainN = Math.max(curveSpan.n, curve[curve.length - 1]?.epoch || curve.length);
    drawLearningCurve(chartRef.current, curve, {
      hoverIndex,
      domainN,
      lossMax: curveSpan.lossMax,
      running: watching,
      light: labTheme === 'light',
    });
  }, [chartTip, curve, curveSpan, watching, labTheme]);

  useEffect(() => {
    if (!watching) {
      paintChart();
      return;
    }
    let frame = 0;
    const loop = () => {
      paintChart();
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [paintChart, watching]);

  useEffect(() => {
    const wrap = chartWrapRef.current;
    window.addEventListener('resize', paintChart);
    if (!wrap || typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', paintChart);
    }
    const observer = new ResizeObserver(() => paintChart());
    observer.observe(wrap);
    return () => {
      window.removeEventListener('resize', paintChart);
      observer.disconnect();
    };
  }, [paintChart]);

  useEffect(() => {
    if (!trainResult || watching) return;
    setDisplayedMetrics(packMetrics(trainResult, true));
  }, [trainResult, watching]);

  const liveScore = useCallback(
    (text: string, nextModel: StudioModel, useServer: boolean) => {
      const trimmed = text.trim();
      const prepared = cleanNoteText(trimmed, textPrepRef.current, nextModel.representation || 'tfidf');
      if (!canClassifyText(prepared || trimmed)) {
        scoreSeq.current += 1;
        setPrediction(null);
        setHint('Type a short ticket with real words, then press Enter.');
        setOrb(needTicketOrb());
        return;
      }
      const local = scoreWithModel(prepared || trimmed, nextModel);
      if ((nextModel.representation || 'tfidf') !== 'embeddings' && local.known_tokens === 0) {
        scoreSeq.current += 1;
        setPrediction(null);
        setHint('None of those words were in training. Try a real ticket from this department.');
        setOrb(needTicketOrb());
        return;
      }
      setPrediction(local);
      setOrb(applyScoredOrb(trimmed, local));
      setHint('');
      if (swapLab && compareBundle.tfidf && compareBundle.embeddings) {
        const tfidfModel = modelFromExport(compareBundle.tfidf.model);
        const embModel = modelFromExport(compareBundle.embeddings.model);
        setCompareBundle((current) => ({
          ...current,
          tfidfPred: scoreWithModel(cleanNoteText(trimmed, textPrepRef.current, 'tfidf'), tfidfModel),
          embeddingsPred: scoreWithModel(cleanNoteText(trimmed, textPrepRef.current, 'embeddings'), embModel),
        }));
      }
      if (!useServer) return;
      const seq = (scoreSeq.current += 1);
      void predictTfidfLab(sessionId, projectId, trimmed)
        .then((scored) => {
          if (scoreSeq.current !== seq) return;
          setPrediction(scored);
          setOrb(applyScoredOrb(trimmed, scored));
        })
        .catch((error) => {
          if (scoreSeq.current !== seq) return;
          setHint(
            error instanceof Error
              ? `${error.message} Showing the on-device score instead.`
              : 'Could not reach the server score. Showing the on-device score instead.',
          );
        });
    },
    [compareBundle.embeddings, compareBundle.tfidf, projectId, sessionId, swapLab],
  );

  const onReviewChange = (value: string) => {
    if (reviewUndoArmedRef.current && !training) {
      pushEx2UndoRef.current();
      reviewUndoArmedRef.current = false;
    }
    setReviewText(value);
    setHint('');
    if (timerRef.current) window.clearTimeout(timerRef.current);
    scoreSeq.current += 1;
    setPrediction(null);
    if (!trained || watching || training) return;
    setOrb(value.trim() ? typingOrb() : readyOrb());
  };

  const submitReview = () => {
    if (!model || watching || training) return;
    const trimmed = reviewText.trim();
    if (!canClassifyText(cleanNoteText(trimmed, textPrepRef.current, model.representation || 'tfidf') || trimmed)) {
      setPrediction(null);
      setHint('Type a short ticket with real words, then press Enter.');
      setOrb(needTicketOrb());
      return;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setPrediction(null);
    setOrb(thinkingOrb());
    timerRef.current = window.setTimeout(() => {
      liveScore(trimmed, model, !trainResult?.simulated);
    }, 450);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      playGen.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!repModalOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !conceptOpen) closeRepresentationModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conceptOpen, repModalOpen]);

  useEffect(() => {
    if (!setupOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !training && !conceptOpen) setSetupOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conceptOpen, setupOpen, training]);

  const selectedSource = getDepartmentSource(activeDataset);
  const conceptSlides = useMemo(() => buildConceptSlides(selectedSource), [selectedSource]);

  useEffect(() => {
    const last = Math.max(0, conceptSlides.length - 1);
    setConceptIndex((current) => Math.min(current, last));
  }, [conceptSlides.length]);

  useEffect(() => {
    if (!previewOpen && !conceptOpen && !fullTableOpen && !inspectOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (fullTableOpen) {
          setFullTableOpen(false);
          return;
        }
        if (inspectOpen) {
          openPreviewStep();
          return;
        }
        if (conceptOpen) {
          closeConcept();
          return;
        }
        if (previewOpen && previewFromEye) closePreview();
      }
      if (!conceptOpen) return;
      const count = Math.max(1, conceptSlides.length);
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setConceptIndex((current) => Math.min(count - 1, current + 1));
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setConceptIndex((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeConcept, closePreview, conceptOpen, conceptSlides.length, fullTableOpen, inspectOpen, previewFromEye, previewOpen]);

  const dataClasses = data ? uniqueLabels(data) : datasetMeta?.classes || [];
  const steps = swapLab ? SWAP_WORKFLOW_STEPS : WORKFLOW_STEPS;
  const flowStep = workflowStep({
    hasData: Boolean(data),
    inspectApplied,
    repChosen,
    training,
    watching,
    trained,
  });
  const scoreClasses = trainResult?.classes && trainResult.classes.length ? trainResult.classes : dataClasses;
  const nClasses = trainResult?.n_classes ?? dataClasses.length;
  const binaryStudio = nClasses <= 2;
  const scorecard = trainResult
    ? binaryStudio
      ? savedBinaryScorecard(trainResult, threshold)
      : (() => {
          const derived = macroMetricsFromProbs(
            trainResult.test_probs || [],
            trainResult.n_classes || scoreClasses.length,
          );
          const matrix =
            trainResult.confusion_matrix && trainResult.confusion_matrix.length === derived.matrix.length
              ? trainResult.confusion_matrix
              : derived.matrix;
          return {
            acc: trainResult.test_accuracy ?? derived.acc,
            prec: trainResult.test_precision ?? derived.prec,
            rec: trainResult.test_recall ?? derived.rec,
            f1: trainResult.test_f1 ?? derived.f1,
            tp: 0,
            fp: 0,
            fn: 0,
            tn: 0,
            correct: derived.correct,
            total: derived.total,
            matrix,
          };
        })()
    : null;
  const lastCurve = curve[curve.length - 1];
  const probeIndex = chartTip?.index ?? (watching && curve.length ? curve.length - 1 : null);
  const hoverPoint = probeIndex != null && curve[probeIndex] ? curve[probeIndex] : lastCurve;
  const hoverInsight = probeIndex != null ? curveInsight(curve, probeIndex, true) : '';
  const tipBox = chartTip;
  const formatRows = data
    ? samplePreviewRows(data).map((row) => ({ text: row.review, label: row.label }))
    : GENERIC_FORMAT_SAMPLES;
  const totalSamples = datasetMeta?.n_rows || data?.length || 0;
  const classCount = datasetMeta?.classes?.length || (data ? uniqueLabels(data).length : 0);
  const packId = getDepartmentSource(activeDataset)?.id;
  const fullTablePages = Math.max(1, Math.ceil(totalSamples / FULL_TABLE_PAGE_SIZE));
  const fullTableSafePage = Math.min(fullTablePage, fullTablePages - 1);
  const fullTableRows = packId
    ? (packPageRows || []).map((row) => ({ text: row.review, label: row.label }))
    : data
      ? data
          .slice(fullTableSafePage * FULL_TABLE_PAGE_SIZE, fullTableSafePage * FULL_TABLE_PAGE_SIZE + FULL_TABLE_PAGE_SIZE)
          .map((row) => ({ text: row.review, label: row.label }))
      : [];
  const fullTableFrom = totalSamples ? fullTableSafePage * FULL_TABLE_PAGE_SIZE + 1 : 0;
  const fullTableTo = Math.min(totalSamples, (fullTableSafePage + 1) * FULL_TABLE_PAGE_SIZE);
  const shownConfig = appliedConfig || (trainResult ? configFromTrainResult(trainResult) : null);
  const showSidePanel = watching || trained || training || Boolean(shownConfig);
  const metricsLive = training || watching;
  const settledScorecard = !metricsLive && trainResult ? sharedScorecard(trainResult, packId || datasetMeta?.id || '') : null;
  const liveT = reduceMotion || !metricsLive ? 1 : playProgress;
  const setupMissing = new Set(setupTried ? missingSetupFields(draftConfig, representation) : []);
  const setupFieldClass = (key: SetupFieldKey) => `e2-setup-field${setupMissing.has(key) ? ' need' : ''}`;
  const activePreset = setupPreset;
  const predReport = prediction?.label ? ticketReport(reviewText, prediction) : null;

  return (
    <div ref={rootRef} className={`e2${swapLab ? ' e3' : ''}${labTheme === 'light' ? ' e2-light' : ''}`}>
      <canvas ref={confettiRef} className="e2-confetti" />
      {stageGate ? (
        <p
          className="e2-stage-gate"
          role="status"
          aria-live="polite"
          style={{ left: stageGate.x, top: stageGate.y }}
        >
          {stageGate.message}
        </p>
      ) : null}
      <header className="e2-bar">
        <div className="e2-bar-in">
          <div className="e2-brand ex-lab-brand">
            <ExerciseHeaderIcon id={2} />
            <h1 className="e2-brand-title">
              {swapLab ? (
                <>
                  <span className="e2-spark">✦</span>
                  TF-IDF vs Sentence Embeddings
                </>
              ) : (
                'Exercise - 2 : Logistic Regression'
              )}
            </h1>
          </div>
          <div className="e2-bar-ctrls">
            <FullscreenButton targetRef={rootRef} className="e2-btn e2-btn-icon e2-btn-fs" />
            <UndoButton
              canUndo={canConfigUndo && !training}
              onUndo={handleEx2Undo}
              className="e2-btn e2-btn-undo"
            />
            <button
              className="e2-btn e2-btn-reset e2-btn-icon"
              type="button"
              title="Reset exercise"
              aria-label="Reset exercise"
              disabled={training}
              onClick={() => {
                clearStoredRepresentation(swapLab);
                clearConceptSeen(sessionId, projectId, meta.id);
                setConceptIndex(0);
                resetExercise(meta.id);
              }}
            >
              <IconReset />
            </button>
            {datasetMeta ? (
              <button
                className={`e2-btn e2-btn-dataset chosen${pickerOpen ? ' open' : ''}`}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                disabled={training || Boolean(loadingDataset)}
                onClick={() => openDatasetBoard()}
              >
                <span className="e2-picker-icon e2-picker-icon-sm" aria-hidden="true">
                  <DepartmentIcon id={datasetMeta.id} />
                </span>
                {datasetMeta.short} Dataset
              </button>
            ) : null}
            <button
              className={`e2-btn e2-btn-preview e2-btn-icon${previewOpen ? ' open' : ''}`}
              type="button"
              title={data ? 'Preview dataset' : 'Choose a dataset to preview'}
              aria-label={data ? 'Preview dataset' : 'Choose a dataset to preview'}
              aria-pressed={previewOpen}
              disabled={!data}
              onClick={() => {
                if (!data) return;
                setPickerOpen(false);
                setConceptOpen(false);
                setSetupOpen(false);
                setRepModalOpen(false);
                setPreviewFromEye(true);
                setPreviewOpen(true);
              }}
            >
              <IconEye />
            </button>
            <button
              className={`e2-btn e2-btn-concept e2-btn-icon${conceptOpen ? ' open' : ''}`}
              type="button"
              title="Concept"
              aria-label="Concept"
              aria-pressed={conceptOpen}
              disabled={training || watching}
              onClick={openConcept}
            >
              <IconBulb />
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {pickerOpen ? (
        <div
          className="e2-modal-back e2-dept-back"
          role="presentation"
          onClick={closeDatasetModal}
        >
          <div
            className="e2-modal e2-dept-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="e2-dept-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="e2-modal-h">
              <h2 id="e2-dept-title">Choose your Department</h2>
              <div className="e2-modal-h-actions">
                <button
                  className="e2-btn e2-btn-icon e2-modal-close"
                  type="button"
                  onClick={closeDatasetModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="e2-dept-grid" role="listbox" aria-label="Choose your Department">
              {catalog.map((item) => {
                const selected = deptDraft === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={`${item.short}, ${item.name}`}
                    className={`e2-dept-card${selected ? ' on' : ''}${loadingDataset === item.id ? ' busy' : ''}`}
                    disabled={training || Boolean(loadingDataset)}
                    onClick={() => setDeptDraft(item.id)}
                  >
                    <span className="e2-dept-ico" aria-hidden="true">
                      <DepartmentIcon id={item.id} />
                    </span>
                    <b>{item.short}</b>
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="e2-modal-actions">
              <button className="e2-btn e2-btn-ghost" type="button" onClick={closeDatasetModal}>
                Cancel
              </button>
              <button
                className="e2-btn e2-btn-train"
                type="button"
                disabled={!deptDraft || training || Boolean(loadingDataset)}
                onClick={confirmDepartment}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {repModalOpen ? (
        <div
          className="e2-modal-back e3-rep-back"
          role="presentation"
          onClick={closeRepresentationModal}
        >
          <div
            className="e2-modal e3-rep-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="e3-rep-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="e2-modal-h">
              <div className="e2-preview-heading">
                {data ? (
                  <button
                    className="e2-btn e2-btn-icon e2-btn-back"
                    type="button"
                    onClick={backFromRepresentation}
                    aria-label="Back"
                    title="Back"
                  >
                    <IconArrowLeft />
                  </button>
                ) : null}
                <h2 id="e3-rep-title">Choose One</h2>
              </div>
              <div className="e2-modal-h-actions">
                <button
                  className="e2-btn e2-btn-icon e2-modal-close"
                  type="button"
                  onClick={closeRepresentationModal}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="e3-rep-grid">
              <RepresentationCard kind="tfidf" selected={repDraft === 'tfidf'} onSelect={() => setRepDraft('tfidf')} />
              <RepresentationCard kind="embeddings" selected={repDraft === 'embeddings'} onSelect={() => setRepDraft('embeddings')} />
            </div>
            <div className="e2-modal-actions">
              <button className="e2-btn e2-btn-ghost" type="button" onClick={closeRepresentationModal}>
                Cancel
              </button>
              <button className="e2-btn e2-btn-train" type="button" disabled={!repDraft} onClick={confirmRepresentation}>
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="e2-modal-back e2-setup-back"
        role="presentation"
        hidden={!setupOpen}
        aria-hidden={!setupOpen}
        onClick={() => {
          if (!training && !conceptOpen) setSetupOpen(false);
        }}
      >
          <div
            className="e2-modal e2-setup-modal"
            role="dialog"
            aria-modal={setupOpen}
            aria-labelledby="e2-setup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="e2-modal-h">
              <div className="e2-preview-heading">
                <button
                  className="e2-btn e2-btn-icon e2-btn-back"
                  type="button"
                  disabled={training}
                  onClick={backFromSetup}
                  aria-label="Back"
                  title="Back"
                >
                  <IconArrowLeft />
                </button>
                <h2 id="e2-setup-title">Model setup · {representationLabel(representation)}</h2>
              </div>
              <div className="e2-modal-h-actions">
                <button
                  className="e2-btn e2-btn-icon e2-modal-close"
                  type="button"
                  onClick={() => setSetupOpen(false)}
                  disabled={training}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="e2-setup-panes" role="tablist" aria-label="Model setup mode">
              <button
                className={`e2-setup-pane${setupPane === 'basic' ? ' on' : ''}`}
                type="button"
                role="tab"
                id="e2-setup-basic-title"
                aria-selected={setupPane === 'basic'}
                aria-controls="e2-setup-basic-panel"
                disabled={training}
                onClick={() => chooseSetupPane('basic')}
              >
                <b>Basic</b>
                <span>Recommended for everyone</span>
              </button>
              <button
                className={`e2-setup-pane${setupPane === 'advanced' ? ' on' : ''}`}
                type="button"
                role="tab"
                id="e2-setup-adv-title"
                aria-selected={setupPane === 'advanced'}
                aria-controls="e2-setup-adv-panel"
                disabled={training}
                onClick={() => chooseSetupPane('advanced')}
              >
                <b>Advanced</b>
                <span>For CS / advanced learners</span>
              </button>
            </div>
            <div className="e2-setup-body">
              <div
                id="e2-setup-basic-panel"
                className="e2-setup-cat"
                role="tabpanel"
                aria-labelledby="e2-setup-basic-title"
                hidden={setupPane !== 'basic'}
              >
                <p className="e2-setup-kicker">Choose a preset</p>
                <div className="e2-setup-presets" role="group" aria-label="Training preset">
                  {SETUP_PRESET_IDS.map((id) => {
                    const meta = setupPresetMeta(id, representation);
                    const on = activePreset === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`e2-setup-preset${on ? ' on' : ''}`}
                        disabled={training}
                        aria-pressed={on}
                        onClick={() => {
                  setupTouchedRef.current = true;
                  pushEx2UndoRef.current();
                  dispatchSetup({ type: 'preset', id, representation });
                }}
                      >
                        <b>{meta.title}</b>
                        <span>{meta.blurb}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="e2-setup-kicker">
                  Test data <span>(kept aside to check your model)</span>
                </p>
                <div className="e2-setup-pills" role="group" aria-label="Test data">
                  {TEST_SPLITS.map((value) => {
                    const on = Number(draftConfig.test_size) === value;
                    return (
                      <button
                        key={value}
                        id={value === 0.1 ? 'e2-setup-test_size' : undefined}
                        type="button"
                        className={`e2-setup-pill${on ? ' on' : ''}${setupMissing.has('test_size') ? ' need' : ''}`}
                        disabled={training}
                        aria-pressed={on}
                        onClick={() => patchDraft({ test_size: String(value) })}
                      >
                        {Math.round(value * 100)}%
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                id="e2-setup-adv-panel"
                className="e2-setup-cat"
                role="tabpanel"
                aria-labelledby="e2-setup-adv-title"
                hidden={setupPane !== 'advanced'}
              >
                <div className="e2-setup-adv">
                  {representation === 'embeddings' ? (
                    <div className="e2-setup-field">
                      <SetupHint
                        label="Embedding size"
                        info="Sentence embeddings in this lab are a fixed 384-number meaning vector. Word-feature knobs do not apply."
                      />
                      <div className="e2-setup-readonly" aria-live="polite">
                        {SENTENCE_EMBED_DIM}
                      </div>
                    </div>
                  ) : (
                    <>
                  <div className={setupFieldClass('max_features')}>
                    <SetupHint
                      label="Max TF-IDF features"
                      info="Cap on how many word patterns the model keeps. A higher cap remembers more terms; a lower cap stays simpler."
                    />
                    <SetupStepper
                      id="e2-setup-max_features"
                      value={draftConfig.max_features}
                      min={50}
                      max={8000}
                      step={100}
                      format={(n) => n.toLocaleString('en-US')}
                      invalid={setupMissing.has('max_features')}
                      disabled={training}
                      onChange={(next) => patchDraft({ max_features: next })}
                    />
                  </div>
                  <div className={setupFieldClass('ngram')}>
                    <SetupHint
                      label="N-gram range"
                      info="(1,1) uses single words only. (1,2) also keeps two-word phrases. (1,3) adds three-word phrases."
                    />
                    <SetupSegs
                      id="e2-setup-ngram"
                      value={draftConfig.ngram}
                      invalid={setupMissing.has('ngram')}
                      disabled={training}
                      options={NGRAM_CHOICES.map(([min, max]) => ({
                        value: `${min},${max}`,
                        label: ngramLabel(min, max),
                      }))}
                      onChange={(next) => patchDraft({ ngram: next })}
                    />
                  </div>
                  <div className={setupFieldClass('min_df')}>
                    <SetupHint
                      label="Min word frequency"
                      info="Ignore words that appear in fewer documents than this. 1 keeps rare words; 2 or more drops uncommon ones."
                    />
                    <SetupStepper
                      id="e2-setup-min_df"
                      value={draftConfig.min_df}
                      min={1}
                      max={50}
                      step={1}
                      invalid={setupMissing.has('min_df')}
                      disabled={training}
                      onChange={(next) => patchDraft({ min_df: next })}
                    />
                  </div>
                    </>
                  )}
                  <div className={setupFieldClass('regularization_c')}>
                    <SetupHint
                      label="Regularization C"
                      info="How tightly the model may fit the training texts. Smaller C keeps weights simpler; larger C follows the train split more closely."
                    />
                    <SetupStepper
                      id="e2-setup-regularization_c"
                      value={draftConfig.regularization_c}
                      min={0.1}
                      max={10}
                      step={0.1}
                      format={(n) => n.toFixed(1)}
                      invalid={setupMissing.has('regularization_c')}
                      disabled={training}
                      onChange={(next) => patchDraft({ regularization_c: next })}
                    />
                  </div>
                  <div className={setupFieldClass('solver')}>
                    <SetupHint
                      label="Solver"
                      info="The optimizer that fits the class weights. lbfgs is a solid default; liblinear is for two classes; saga can handle larger sets."
                    />
                    <SetupSegs
                      id="e2-setup-solver"
                      value={draftConfig.solver}
                      invalid={setupMissing.has('solver')}
                      disabled={training}
                      options={(binaryStudio ? SOLVERS : SOLVERS.filter((solver) => solver !== 'liblinear')).map(
                        (solver) => ({ value: solver, label: solver }),
                      )}
                      onChange={(next) => patchDraft({ solver: next })}
                    />
                  </div>
                  <div className={setupFieldClass('max_iter')}>
                    <SetupHint
                      label="Max iterations"
                      info="How long the solver may run before it stops. Raise this if training ends before the weights settle."
                    />
                    <SetupStepper
                      id="e2-setup-max_iter"
                      value={draftConfig.max_iter}
                      min={50}
                      max={5000}
                      step={50}
                      invalid={setupMissing.has('max_iter')}
                      disabled={training}
                      onChange={(next) => patchDraft({ max_iter: next })}
                    />
                  </div>
                  {binaryStudio ? (
                  <div className={setupFieldClass('threshold')}>
                    <SetupHint
                      label="Decision threshold"
                      info="For two-class models, probability above this counts as the second class. 0.50 is the usual midpoint."
                    />
                    <SetupStepper
                      id="e2-setup-threshold"
                      value={draftConfig.threshold}
                      min={0.05}
                      max={0.95}
                      step={0.05}
                      format={(n) => n.toFixed(2)}
                      invalid={setupMissing.has('threshold')}
                      disabled={training}
                      onChange={(next) => patchDraft({ threshold: next })}
                    />
                  </div>
                  ) : null}
                  <div className={setupFieldClass('epochs')}>
                    <SetupHint
                      label="Epochs"
                      info="How many training passes to run. The learning curve counts these from 0 to this number."
                    />
                    <SetupStepper
                      id="e2-setup-epochs"
                      value={draftConfig.epochs}
                      min={10}
                      max={2000}
                      step={10}
                      invalid={setupMissing.has('epochs')}
                      disabled={training}
                      onChange={(next) => patchDraft({ epochs: next })}
                    />
                  </div>
                  <div className={setupFieldClass('seed')}>
                    <SetupHint
                      label="Random seed"
                      info="A number that makes the train/test shuffle repeatable. Same seed and same data give the same split."
                    />
                    <SetupStepper
                      id="e2-setup-seed"
                      value={draftConfig.seed}
                      min={0}
                      max={2147483647}
                      step={1}
                      invalid={setupMissing.has('seed')}
                      disabled={training}
                      onChange={(next) => patchDraft({ seed: next })}
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="e2-modal-actions">
              <button
                className="e2-text-btn"
                type="button"
                disabled={training}
                onClick={resetSetupDefaults}
              >
                Reset to defaults
              </button>
              <button
                className={`e2-btn e2-btn-train${setupTried && setupMissing.size ? ' need' : ''}`}
                type="button"
                disabled={training || !data}
                onClick={submitSetup}
              >
                {hasTrained ? (
                  <>
                    <IconRefresh /> Re-Train
                  </>
                ) : (
                  <>
                    <IconPlay /> Train Model
                  </>
                )}
              </button>
            </div>
          </div>
      </div>

      {previewOpen && data && !fullTableOpen && !repModalOpen && !setupOpen && !pickerOpen && !inspectOpen ? (
        <div
          className="e2-modal-back"
          role="presentation"
          onClick={previewFromEye ? closePreview : undefined}
        >
          <div
            className="e2-modal e2-modal-preview"
            role="dialog"
            aria-modal="true"
            aria-labelledby="e2-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="e2-modal-h e2-preview-h">
              <div className="e2-preview-heading">
                {previewFromEye ? null : (
                  <button
                    className="e2-btn e2-btn-icon e2-btn-back"
                    type="button"
                    disabled={training}
                    onClick={() => openDatasetBoard(true)}
                    aria-label="Back"
                    title="Back"
                  >
                    <IconArrowLeft />
                  </button>
                )}
                <h2 id="e2-preview-title">{data ? 'Dataset preview' : 'Required format'}</h2>
                {data ? (
                  <div className="e2-preview-stats">
                    {datasetMeta?.id ? (
                      <span className="e2-preview-stat pack">
                        <span className="e2-picker-icon e2-picker-icon-sm" aria-hidden="true">
                          <DepartmentIcon id={datasetMeta.id} />
                        </span>
                        {datasetMeta.short || datasetMeta.name}
                      </span>
                    ) : (
                      <span className="e2-preview-stat pack">{datasetMeta?.short || datasetMeta?.name || 'Uploaded dataset'}</span>
                    )}
                    <span className="e2-preview-stat samples">{totalSamples.toLocaleString()} samples</span>
                    <span className="e2-preview-stat classes">
                      {classCount} {classCount === 1 ? 'class' : 'classes'}
                    </span>
                  </div>
                ) : (
                  <p className="e2-preview-meta">Need two columns named text and label</p>
                )}
              </div>
              {previewFromEye ? (
                <div className="e2-modal-h-actions">
                  <button className="e2-btn e2-btn-icon e2-modal-close" type="button" onClick={closePreview} aria-label="Close">
                    ✕
                  </button>
                </div>
              ) : null}
            </div>
            <div className="e2-preview-body">
              {selectedSource ? <DatasetAbout source={selectedSource} /> : null}
              <div className="e2-preview-samples">
                <div className="e2-preview-samples-h">
                  <h3>Sample notes</h3>
                </div>
                <FormatPreviewTable rows={formatRows} compact />
              </div>
            </div>
            <div className={`e2-preview-foot${previewFromEye ? ' eye' : ''}`}>
              <button
                className="e2-btn e2-btn-ghost"
                type="button"
                onClick={() => {
                  setFullTablePage(0);
                  setFullTableOpen(true);
                }}
              >
                View full dataset
              </button>
              {previewFromEye ? null : (
                <button
                  className="e2-btn e2-btn-train"
                  type="button"
                  disabled={training}
                  onClick={continueFromPreview}
                >
                  Continue
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {inspectOpen && data ? (
        <Ex2InspectModal
          packName={datasetMeta?.short || datasetMeta?.name || 'Dataset'}
          classes={datasetMeta?.classes?.length ? datasetMeta.classes : uniqueLabels(data)}
          totalRows={datasetMeta?.n_rows || data.length}
          rows={inspectRows}
          prep={textPrep}
          onChangePrep={setTextPrep}
          packInspect={inspectStats}
          statsLoading={inspectStatsLoading}
          alreadyApplied={inspectApplied}
          onBack={openPreviewStep}
          onApply={applyInspect}
        />
      ) : null}

      {fullTableOpen && data && !pickerOpen ? (
        <div
          className="e2-modal-back e2-fulltable-back"
          role="presentation"
          onClick={() => setFullTableOpen(false)}
        >
          <div
            className="e2-modal e2-modal-preview e2-modal-fulltable"
            role="dialog"
            aria-modal="true"
            aria-labelledby="e2-fulltable-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="e2-modal-h e2-preview-h">
              <div className="e2-preview-heading">
                <h2 id="e2-fulltable-title">Full dataset</h2>
                <div className="e2-preview-stats">
                  <span className="e2-preview-stat pack">{datasetMeta?.short || datasetMeta?.name || 'Uploaded dataset'}</span>
                  <span className="e2-preview-stat samples">{totalSamples.toLocaleString()} samples</span>
                  <span className="e2-preview-stat classes">
                    {classCount} {classCount === 1 ? 'class' : 'classes'}
                  </span>
                </div>
              </div>
              <div className="e2-modal-h-actions">
                <button
                  className="e2-btn e2-btn-icon e2-modal-close"
                  type="button"
                  onClick={() => setFullTableOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            {packPageLoading && packId && !fullTableRows.length ? (
              <p className="e2-preview-note">Loading rows…</p>
            ) : (
              <FormatPreviewTable
                rows={fullTableRows}
                rowStart={fullTableFrom}
                scrollerRef={fullTableScrollRef}
              />
            )}
            <div className="e2-fulltable-pager">
              <button
                className="e2-btn e2-btn-ghost"
                type="button"
                disabled={fullTableSafePage <= 0}
                onClick={() => setFullTablePage((page) => Math.max(0, page - 1))}
              >
                Previous
              </button>
              <p>
                Showing {fullTableFrom}–{fullTableTo} of {totalSamples}
              </p>
              <button
                className="e2-btn e2-btn-ghost"
                type="button"
                disabled={fullTableSafePage >= fullTablePages - 1}
                onClick={() => setFullTablePage((page) => Math.min(fullTablePages - 1, page + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConceptDeck
        open={conceptOpen}
        slides={conceptSlides}
        index={conceptIndex}
        onIndex={setConceptIndex}
        onClose={closeConcept}
        onStart={() => {
          closeConcept();
          if (!data) openDatasetBoard();
        }}
        exerciseN={meta.id}
      />

      <main className={`e2-stage${dataError ? ' has-err' : ''}${trained || watching || showSidePanel ? ' has-results' : ''}`}>
        {dataError ? <div className="e2-db-err">{dataError}</div> : null}

        <div className={`e2-live${showSidePanel ? ' with-side' : ''}`}>
        <section
          className={`e2-console${trained ? '' : ' asleep'}${watching ? ' learning' : ''}`}
          style={{ ['--e2-mood' as string]: orb.mood }}
        >
          <div className="e2-orb-col">
            <div className="e2-orb-stage">
              <div className="e2-orb-glow" />
              <svg className="e2-ring-svg" viewBox="0 0 240 240">
                <circle className="e2-ring-bg" cx="120" cy="120" r={RING_R} />
                <circle
                  className="e2-ring"
                  cx="120"
                  cy="120"
                  r={RING_R}
                  style={{
                    strokeDasharray: RING_C,
                    strokeDashoffset: RING_C * (1 - Math.max(0, Math.min(1, orb.ring))),
                  }}
                />
              </svg>
              <div className="e2-orb-core">
                <StudioBuddy face={orb.face} />
              </div>
            </div>
            <div className="e2-orb-read">
              <span className="e2-orb-label">
                {orb.label}
              </span>
              <span className="e2-orb-pct">{orb.pct}</span>
            </div>
          </div>
          <div className={`e2-input-col${trained || watching ? ' ready' : ''}`}>
            <div className="e2-composer">
              {trained ? (
                <span className="e2-composer-kicker">
                  Type a ticket{swapLab ? ` · ${representationLabel(representation)} + Logistic Regression` : ''}
                </span>
              ) : null}
              <label className="e2-hidden" htmlFor="e2-review">
                Type a text
              </label>
              <textarea
                id="e2-review"
                value={reviewText}
                disabled={!trained}
                placeholder={
                  trained
                    ? 'Type a ticket from this department, then press Enter to classify…'
                    : 'Train the model first, then type a ticket from this department…'
                }
                onChange={(e) => onReviewChange(e.target.value)}
                onBlur={() => {
                  reviewUndoArmedRef.current = true;
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  submitReview();
                }}
              />
              {trained ? <span className="e2-composer-hint">Enter classifies · Shift+Enter adds a line</span> : null}
            </div>
            {hint ? <div className="e2-console-hint">{hint}</div> : null}
            <div className="e2-journey">
                <ol className="e2-flow" aria-label="What to do">
                  {steps.map((step, index) => {
                    const active =
                      (step.n === 1 && (pickerOpen || previewOpen || inspectOpen)) ||
                      (step.n === 2 && repModalOpen) ||
                      (step.n === 3 && setupOpen) ||
                      flowStep === step.n;
                    const done = flowStep > step.n;
                    const rest = flowStep < step.n;
                    const detail =
                      step.n === 1 && datasetMeta
                        ? inspectApplied
                          ? `${datasetMeta.short} · inspected`
                          : `${datasetMeta.short} pack`
                        : step.n === 2 && repChosen
                          ? representationLabel(representation)
                          : step.detail;
                    const blocked = stageGate?.n === step.n;
                    return (
                      <li key={step.n} className="e2-flow-item">
                        <button
                          type="button"
                          className={`e2-flow-step${active ? ' on' : ''}${done ? ' done' : ''}${rest ? ' rest' : ''}${
                            blocked || (step.n === 1 && needDataset && !data) ? ' need' : ''
                          }`}
                          aria-current={active ? 'step' : undefined}
                          aria-haspopup={step.n === 1 && !rest ? 'dialog' : undefined}
                          aria-expanded={
                            step.n === 1
                              ? pickerOpen || previewOpen || inspectOpen
                              : step.n === 2
                                ? repModalOpen
                                : step.n === 3
                                  ? setupOpen
                                  : undefined
                          }
                          aria-disabled={rest || undefined}
                          disabled={training || watching}
                          onClick={(event) => onFlowStep(step.n, event)}
                        >
                          <span className="e2-flow-n">{step.n}</span>
                          <span className="e2-flow-copy">
                            <span className="e2-flow-title">
                              <b>{step.title}</b>
                              {index < steps.length - 1 ? <span className="e2-flow-arrow" aria-hidden="true" /> : null}
                            </span>
                            <span>{detail}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
          </div>
        </section>
          {showSidePanel ? (
            <section className="e2-panel e2-pred-card">
              <div className="e2-panel-h">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Predicted category
              </div>
              {prediction?.label ? (
                <div className="e2-panel-body e2-pred-body">
                  {predReport ? (
                    <div className="e2-pred-stats">
                      <p className="e2-pred-stats-k">Ticket report</p>
                      <ul className="e2-pred-report">
                        <li>
                          <b>{predReport.words}</b>
                          <em>Words</em>
                        </li>
                        <li>
                          <b>{predReport.known}</b>
                          <em>Known to the model</em>
                        </li>
                      </ul>
                    </div>
                  ) : null}
                  <div className="e2-pred-call">
                    <span
                      className={`e2-pred-label e2-tag e2-tag-${classTone(Math.max(0, scoreClasses.indexOf(prediction.label)))}`}
                    >
                      {prediction.label}
                    </span>
                    <strong>
                      {`${Math.round(
                        ((prediction.probs?.find((item) => item.label === prediction.label)?.p ?? prediction.probability) || 0) *
                          100,
                      )}%`}
                    </strong>
                  </div>
                  {prediction.probs && prediction.probs.length ? (
                    <ul className="e2-pred-probs">
                      {prediction.probs
                        .slice()
                        .sort((a, b) => b.p - a.p)
                        .map((item, index) => (
                          <li key={`${item.label}-${index}`}>
                            <span className="e2-pred-probs-k">{item.label}</span>
                            <i>
                              <b
                                style={{
                                  width: `${Math.round(item.p * 100)}%`,
                                  background: `var(--e2-${['lime', 'cyan', 'pink', 'amber', 'purple', 'blue'][index % 6]})`,
                                }}
                              />
                            </i>
                            <em>{`${Math.round(item.p * 100)}%`}</em>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <div className="e2-panel-empty">
                  {training || watching
                    ? 'Training… type a ticket after the run finishes.'
                    : 'Type a ticket and press Enter to see the predicted category.'}
                </div>
              )}
            </section>
          ) : null}
        </div>

        <div className="e2-grid" ref={resultsRef}>
          <section className="e2-panel e2-chart-panel">
            <div className="e2-panel-h">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M19 9l-5 5-4-4-3 3" />
              </svg>
              Learning curve
              {curve.length ? (
                <div className="e2-curve-stats">
                  <span className="e2-stat">
                    <span className="e2-stat-k">Epoch</span>
                    <span className="e2-stat-v">
                      {hoverPoint ? Math.round(hoverPoint.epoch) : liveEpoch}
                      {totalEpochs ? ` / ${totalEpochs}` : ''}
                    </span>
                  </span>
                  <span className="e2-stat e2-stat-loss">
                    <span className="e2-stat-k">Loss</span>
                    <span className="e2-stat-v">{hoverPoint ? hoverPoint.loss.toFixed(3) : '—'}</span>
                  </span>
                </div>
              ) : null}
            </div>
            {!curve.length ? (
              <div className="e2-panel-empty">Train the model to watch loss and accuracy.</div>
            ) : (
              <div className="e2-panel-body">
                <div className="e2-legend" aria-hidden="true">
                  {COMBINED_SERIES.map((item) => (
                    <span key={item.id} className="e2-legend-item">
                      <i style={{ background: seriesPaint(item, labTheme === 'light') }} />
                      {item.label}
                    </span>
                  ))}
                </div>
                <div
                  className={`e2-chart${watching ? ' running' : ''}`}
                  ref={chartWrapRef}
                  onPointerMove={onChartPointer}
                  onMouseMove={onChartPointer}
                  onPointerLeave={() => setChartTip(null)}
                  onMouseLeave={() => setChartTip(null)}
                >
                  <canvas
                    ref={chartRef}
                    className="e2-canvas"
                    aria-label="Learning curve for loss and accuracy"
                  />
                  {tipBox && hoverPoint ? (
                    <div className="e2-chart-tip" style={chartTipStyle(tipBox)}>
                      <b>
                        Epoch {Math.round(hoverPoint.epoch)}
                        {totalEpochs ? ` / ${totalEpochs}` : ''}
                      </b>
                      {COMBINED_SERIES.map((item) => (
                        <span key={item.id} className="e2-tip-row">
                          <i style={{ background: seriesPaint(item, labTheme === 'light') }} />
                          {item.label} {seriesReadout(item, hoverPoint, !watching)}
                        </span>
                      ))}
                      <span>{hoverInsight || (watching ? 'Loss and accuracy update as the solver steps.' : '')}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          <section
            className={`e2-panel e2-score-panel${metricsLive ? ' running' : ''}`}
            style={metricsLive ? { ['--e2-live' as string]: String(liveT) } : undefined}
          >
            <div className="e2-panel-h">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              Scorecard
            </div>
            {!metricsLive && !trainResult ? (
              <div className="e2-panel-empty">Metrics appear here after training — on a held-out test set.</div>
            ) : (
              <div className="e2-panel-body">
                <Ex2Scorecard
                  running={metricsLive}
                  items={[
                    { id: 'acc', label: 'Accuracy', value: settledScorecard?.acc || displayedMetrics.acc },
                    { id: 'prec', label: settledScorecard || binaryStudio ? 'Precision' : 'Precision (macro)', value: settledScorecard?.prec || displayedMetrics.prec },
                    { id: 'rec', label: settledScorecard || binaryStudio ? 'Recall' : 'Recall (macro)', value: settledScorecard?.rec || displayedMetrics.rec },
                    { id: 'f1', label: settledScorecard || binaryStudio ? 'F1 Score' : 'F1 (macro)', value: settledScorecard?.f1 || displayedMetrics.f1 },
                  ]}
                />
              </div>
            )}
          </section>

          <section
            className={`e2-panel e2-cm-panel${metricsLive ? ' running' : ''}`}
            style={metricsLive ? { ['--e2-live' as string]: String(liveT) } : undefined}
          >
            <div className="e2-panel-h">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              Confusion matrix
            </div>
            {!metricsLive && !trainResult ? (
              <div className="e2-panel-empty">The held-out confusion matrix appears here after training.</div>
            ) : binaryStudio && scorecard ? (
              <Ex2ConfusionMatrix
                running={metricsLive}
                classes={[scoreClasses[1] || '+', scoreClasses[0] || '−']}
                matrix={[
                  [liveCount(scorecard.tp, liveT, 1), liveCount(scorecard.fn, liveT, 4)],
                  [liveCount(scorecard.fp, liveT, 7), liveCount(scorecard.tn, liveT, 2)],
                ]}
              />
            ) : !binaryStudio && trainResult ? (
              <Ex2ConfusionMatrix
                running={metricsLive}
                classes={scoreClasses}
                matrix={liveMatrix(
                  trainResult.confusion_matrix &&
                    trainResult.confusion_matrix.length === (trainResult.n_classes || scoreClasses.length)
                    ? trainResult.confusion_matrix
                    : confusionFromProbs(trainResult.test_probs || [], trainResult.n_classes || scoreClasses.length),
                  liveT,
                )}
              />
            ) : metricsLive ? (
              <Ex2ConfusionMatrix
                running
                classes={
                  binaryStudio
                    ? [scoreClasses[1] || '+', scoreClasses[0] || '−']
                    : scoreClasses.length
                      ? scoreClasses
                      : ['—', '—']
                }
                matrix={emptySquare(binaryStudio ? 2 : scoreClasses.length)}
              />
            ) : (
              <div className="e2-panel-empty">No confusion matrix for this run.</div>
            )}
          </section>

        {swapLab ? (
          <section className="e2-panel e3-compare">
            <div className="e2-panel-h">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="7" height="16" rx="1" />
                <rect x="14" y="4" width="7" height="16" rx="1" />
              </svg>
              TF-IDF vs Sentence Embeddings
              <span className="e3-compare-note">Same Logistic Regression · same split · only features change</span>
            </div>
            {!compareBundle.tfidf || !compareBundle.embeddings ? (
              <div className="e2-panel-empty">Train once to score both representations with the same classifier.</div>
            ) : (
              <div className="e3-compare-grid">
                {([
                  { key: 'tfidf' as const, result: compareBundle.tfidf, pred: compareBundle.tfidfPred },
                  { key: 'embeddings' as const, result: compareBundle.embeddings, pred: compareBundle.embeddingsPred },
                ]).map((side) => {
                  const active = representation === side.key;
                  const acc = side.result.test_accuracy ?? 0;
                  const otherAcc =
                    (side.key === 'tfidf' ? compareBundle.embeddings?.test_accuracy : compareBundle.tfidf?.test_accuracy) ?? 0;
                  const winner = acc > otherAcc + 0.005;
                  const predP = side.pred?.probs?.find((item) => item.label === side.pred?.label)?.p ?? side.pred?.probability;
                  return (
                    <article key={side.key} className={`e3-compare-card${active ? ' on' : ''}${winner ? ' win' : ''}`}>
                      <header>
                        <b>{representationLabel(side.key)}</b>
                        {active ? <span className="e3-in-use">In use</span> : null}
                        {winner ? <span className="e3-winner">Higher accuracy</span> : null}
                      </header>
                      <dl>
                        <div>
                          <dt>Accuracy</dt>
                          <dd>{`${Math.round(acc * 100)}%`}</dd>
                        </div>
                        <div>
                          <dt>Precision</dt>
                          <dd>{`${Math.round((side.result.test_precision ?? 0) * 100)}%`}</dd>
                        </div>
                        <div>
                          <dt>Recall</dt>
                          <dd>{`${Math.round((side.result.test_recall ?? 0) * 100)}%`}</dd>
                        </div>
                        <div>
                          <dt>F1</dt>
                          <dd>{`${Math.round((side.result.test_f1 ?? 0) * 100)}%`}</dd>
                        </div>
                        <div>
                          <dt>Features</dt>
                          <dd>{side.result.n_features.toLocaleString()}</dd>
                        </div>
                        <div>
                          <dt>Classifier</dt>
                          <dd>Logistic Regression</dd>
                        </div>
                      </dl>
                      <p className="e3-compare-pred">
                        {side.pred?.label
                          ? `Prediction: ${side.pred.label} · ${Math.round((predP || 0) * 100)}% confident`
                          : 'Press Enter after training to compare a live ticket.'}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : null}
        </div>
      </main>
    </div>
  );
}

export { TfidfLogisticRegression };

export default function Exercise02() {
  const meta = EXERCISE_CATALOG[1];
  const { resetEpoch } = useExerciseSession();
  return (
    <ExerciseShell
      meta={meta}
      bare
      workspace={<TfidfLogisticRegression key={resetEpoch} meta={meta} />}
    />
  );
}
