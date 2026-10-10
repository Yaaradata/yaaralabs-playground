import type { ExerciseId } from '../types';

export type IntroStage = { n: string; title: string; detail: string };
export type IntroCard = { title: string; detail: string };

export type IntroSlideContent =
  | { kind: 'overview'; goal: string; stages: IntroStage[] }
  | { kind: 'cards'; heading?: string; cards: IntroCard[] }
  | { kind: 'pipeline'; heading?: string; items: IntroCard[] }
  | { kind: 'task'; task: string; conclusions: IntroCard[] };

export type IntroSlide = {
  title: string;
  body: string;
  content: IntroSlideContent;
};

export type ExerciseIntroPack = {
  exerciseId: ExerciseId;
  subtitle: string;
  slides: IntroSlide[];
};

/** Exercises that use the shared Ex2-style intro (Ex 2 keeps its own ConceptDeck). */
export type IntroExerciseId = Exclude<ExerciseId, 2 | 11>;
