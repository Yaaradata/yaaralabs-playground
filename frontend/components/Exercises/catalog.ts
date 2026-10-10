import type { ExerciseMeta } from './types';
import { RULE_EXAMPLES } from './examples';

export { DEFAULT_TEXT_DATASET } from './examples';

export const EXERCISE_CATALOG: readonly ExerciseMeta[] = [
  {
    id: 1,
    title: 'Rule Based Classifier',
    outcome: '',
    difficulty: 'Beginner',
    minutes: 20,
  },
  {
    id: 2,
    title: 'Logistic Regression',
    outcome: 'Pick TF-IDF or sentence embeddings, train logistic regression, and try a ticket.',
    difficulty: 'Intermediate',
    minutes: 30,
  },
  {
    id: 3,
    title: 'Confusion Matrix',
    outcome:
      'Build a confusion matrix from a scenario and calculate accuracy, precision, recall, specificity, F1 and MCC.',
    difficulty: 'Beginner',
    minutes: 25,
  },
  {
    id: 4,
    title: 'Image Classification',
    outcome: 'Upload a department image set, train a classifier, and read the confusion matrix.',
    difficulty: 'Intermediate',
    minutes: 30,
  },
  {
    id: 4.5,
    title: 'Live Object Detection',
    outcome: 'Point the camera at a scene and watch objects get labelled live.',
    difficulty: 'Intermediate',
    minutes: 25,
  },
  {
    id: 5,
    title: 'Tokeniser & Cost Explorer',
    outcome:
      'Wire a multilingual answer flow, then compare token counts and USD cost across models and Indian languages.',
    difficulty: 'Beginner',
    minutes: 20,
  },
  {
    id: 6,
    title: 'Two Embedding Models',
    outcome:
      'Embed the same batch with two models, work out cosine / Euclidean / dot product, and find where the rankings disagree.',
    difficulty: 'Intermediate',
    minutes: 30,
  },
  {
    id: 7,
    title: 'Change One Dial at a Time',
    outcome:
      'Change temperature, top-k, top-p, or output cap one at a time; compare variety, consistency, and cost against a baseline.',
    difficulty: 'Beginner',
    minutes: 25,
  },
  {
    id: 8,
    title: 'Write a Persona & Prompt It',
    outcome:
      'Write a system persona, add zero/one/few-shot examples, then judge held vs broke across on-task, off-topic and pressure questions.',
    difficulty: 'Intermediate',
    minutes: 30,
  },
  {
    id: 9,
    title: 'Same Prompt, Different Models',
    outcome:
      'Compare 2–4 models on the same persona (from Exercise 8) and message; optional blind shuffle, guess which model wrote each answer, and mark the best reply.',
    difficulty: 'Intermediate',
    minutes: 25,
  },
  {
    id: 10,
    title: 'Hit the Limit, Then Manage It',
    outcome: 'Overflow a context window, prune, compact, and recover the prompt.',
    difficulty: 'Advanced',
    minutes: 35,
  },
  {
    id: 11,
    title: 'RAG Chatbot',
    outcome:
      'Build a civil-engineering chatbot using retrieval-augmented generation (RAG) and explore how to detect and reduce hallucinations.',
    difficulty: 'Advanced',
    minutes: 45,
  },
  {
    id: 12,
    title: 'Build a RAG, End to End',
    outcome:
      'Prepare a document through clean, chunk, embed, store, retrieve, prompt, generate, and evaluate — the full RAG pipeline.',
    difficulty: 'Advanced',
    minutes: 50,
  },
  {
    id: 13,
    title: 'Build an Agent & Give It a Tool',
    outcome:
      'See why a language model fails at exact arithmetic, switch on tools, write one in Python, and watch the agent decide, call, and answer.',
    difficulty: 'Advanced',
    minutes: 40,
  },
  {
    id: 14,
    title: 'AI Ethics Lab',
    outcome:
      'Pressure-test answers, check name bias, redact personal details, spot made-up facts, and compare refusals — then judge the replies yourself.',
    difficulty: 'Advanced',
    minutes: 45,
  },
] as const;

export const RULE_CHALLENGE_CASES = RULE_EXAMPLES.map((ex) => ({ text: ex.text, expected: ex.expected }));

export const METRIC_SCENARIOS = [
  {
    id: 'medical',
    title: 'Medical screening',
    positive: 'disease',
    goal: 'Catch as many true cases as possible. Missing a case is worse than a false alarm.',
    prefer: 'Recall',
  },
  {
    id: 'spam',
    title: 'Spam filter',
    positive: 'spam',
    goal: 'Do not hide real mail. A false alarm (real email marked spam) is costly.',
    prefer: 'Precision',
  },
  {
    id: 'search',
    title: 'Search ranking',
    positive: 'relevant',
    goal: 'Balance showing useful results without flooding the page with junk.',
    prefer: 'F1',
  },
] as const;

export const TOKEN_SAMPLES = {
  english: 'The school library opens at nine and students borrow books freely.',
  tamil: 'பள்ளி நூலகம் காலை ஒன்பது மணிக்கு திறக்கும் மற்றும் மாணவர்கள் புத்தகங்களை இலவசமாக இரவல் வாங்குகின்றனர்.',
  hindi: 'विद्यालय पुस्तकालय सुबह नौ बजे खुलता है और विद्यार्थी पुस्तकें निशुल्क उधार लेते हैं.',
};

export const SIMILARITY_PHRASES = [
  'the cat sat on the mat',
  'a kitten rested on the rug',
  'bank of a river',
  'savings bank account',
  'python programming language',
  'python the snake',
];

export const CONTEXT_SEED = [
  'You are a lab assistant for YaaraLabs Playground.',
  'Student name: Asha. Class: 9B. Favourite topic: computer vision.',
  'Irrelevant note: The canteen menu this week is dosa, noodles, and fruit salad.',
  'Duplicate line: Always cite sources when you are unsure.',
  'Always cite sources when you are unsure.',
  'Task: Explain overfitting in one short paragraph a 14-year-old can use.',
  'Extra unused history: Yesterday we talked about Scratch sprites and costumes.',
  'More unused history: Last month the class planted trees near the football field.',
  'Style: friendly, concrete, no jargon without a plain-language translation.',
  'Constraint: stay under the context window and do not invent citations.',
].join('\n');
