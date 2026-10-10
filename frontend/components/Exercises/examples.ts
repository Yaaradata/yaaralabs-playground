import type { ClassifierRule, ExerciseId, LabeledText } from './types';

export interface NamedExample {
  id: string;
  title: string;
  hint: string;
}

export interface RuleExample extends NamedExample {
  text: string;
  expected: 'positive' | 'negative';
}

export interface TextProbeExample extends NamedExample {
  query: string;
  likely: 'positive' | 'negative';
}

export interface MetricExample extends NamedExample {
  scenario: 'medical' | 'spam' | 'search' | 'fraud' | 'hiring' | 'moderation' | 'loan' | 'factory' | 'ads' | 'support';
  threshold: number;
  prefer: 'Precision' | 'Recall' | 'F1';
}

export interface ShapeExample extends NamedExample {
  label: 'circle' | 'square' | 'triangle';
}

export interface TokenExample extends NamedExample {
  lang: 'english' | 'tamil' | 'hindi' | 'mixed';
  text: string;
}

export interface PhrasePairExample extends NamedExample {
  phrases: [string, string, string, string];
}

export interface PromptExample extends NamedExample {
  prompt: string;
}

export interface PersonaExample extends NamedExample {
  system: string;
  shotUser: string;
  shotAssistant: string;
  prompt: string;
}

export interface ContextExample extends NamedExample {
  text: string;
}

export const DEFAULT_RULES: ClassifierRule[] = [
  { id: 'r1', kind: 'contains', pattern: 'love', label: 'positive' },
  { id: 'r2', kind: 'contains', pattern: 'amazing', label: 'positive' },
  { id: 'r3', kind: 'contains', pattern: 'recommend', label: 'positive' },
  { id: 'r4', kind: 'contains', pattern: 'terrible', label: 'negative' },
  { id: 'r5', kind: 'contains', pattern: 'worst', label: 'negative' },
  { id: 'r6', kind: 'contains', pattern: 'broke', label: 'negative' },
];

export const DEFAULT_TEXT_DATASET: LabeledText[] = [
  { id: 'p1', text: 'I love this product, it works perfectly.', label: 'positive' },
  { id: 'p2', text: 'Amazing quality and super fast delivery.', label: 'positive' },
  { id: 'p3', text: 'Best purchase I have made this year.', label: 'positive' },
  { id: 'p4', text: 'Highly recommend to my friends.', label: 'positive' },
  { id: 'p5', text: 'So happy with the customer support.', label: 'positive' },
  { id: 'p6', text: 'The app is intuitive and saved me time.', label: 'positive' },
  { id: 'n1', text: 'This is terrible and broke after one day.', label: 'negative' },
  { id: 'n2', text: 'Worst experience, do not buy this.', label: 'negative' },
  { id: 'n3', text: 'Waste of money and poor quality.', label: 'negative' },
  { id: 'n4', text: 'The item arrived damaged and late.', label: 'negative' },
  { id: 'n5', text: 'I am disappointed with this purchase.', label: 'negative' },
  { id: 'n6', text: 'Customer service never replied to my ticket.', label: 'negative' },
];

export const RULE_EXAMPLES: RuleExample[] = [
  { id: 'e1', title: 'Straightforward praise', hint: 'Keyword rules should catch “love”.', text: 'I love how quiet this fan is.', expected: 'positive' },
  { id: 'e2', title: 'Straightforward complaint', hint: 'Keyword rules should catch “terrible”.', text: 'Terrible battery life on this phone.', expected: 'negative' },
  { id: 'e3', title: 'Negation', hint: '“not terrible” is actually praise.', text: 'This is not terrible, it is fine.', expected: 'positive' },
  { id: 'e4', title: 'Sarcasm', hint: '“love waiting” is complaint, not praise.', text: 'I love waiting three weeks for a refund.', expected: 'negative' },
  { id: 'e5', title: 'Contrast', hint: 'Last clause wins for humans, not keyword order.', text: 'Amazing? Hardly. Worst packing ever.', expected: 'negative' },
  { id: 'e6', title: 'Idiom', hint: '“broke my expectations” can be positive.', text: 'broke my expectations in the best way', expected: 'positive' },
  { id: 'e7', title: 'Support ticket', hint: 'No obvious keyword.', text: 'Still waiting on a replacement charger.', expected: 'negative' },
  { id: 'e8', title: 'Soft praise', hint: 'No “love/amazing” tokens.', text: 'Pretty good value for a school laptop.', expected: 'positive' },
  { id: 'e9', title: 'Emoji-heavy', hint: 'Messy text, still negative.', text: 'do NOT recommend!!! 😡 broke on day 2', expected: 'negative' },
  { id: 'e10', title: 'Polite complaint', hint: 'No insult words.', text: 'Could you please look into the late delivery?', expected: 'negative' },
];

export const TEXT_PROBE_EXAMPLES: TextProbeExample[] = [
  { id: 'e1', title: 'Clear positive', hint: 'Should lean positive.', query: 'Fantastic quality, I am so happy.', likely: 'positive' },
  { id: 'e2', title: 'Clear negative', hint: 'Should lean negative.', query: 'Poor quality and a total waste of money.', likely: 'negative' },
  { id: 'e3', title: 'Punctuation noise', hint: 'Embeddings often beat TF-IDF here.', query: 'Loved it!! really happy :)', likely: 'positive' },
  { id: 'e4', title: 'Sarcastic refund', hint: 'Hard for bag-of-words.', query: 'I love waiting months for support.', likely: 'negative' },
  { id: 'e5', title: 'Damaged parcel', hint: 'Shipping complaint.', query: 'The parcel arrived crushed and unusable.', likely: 'negative' },
  { id: 'e6', title: 'Support praise', hint: 'Service, not product.', query: 'Support replied in minutes and fixed it.', likely: 'positive' },
  { id: 'e7', title: 'Short slang', hint: 'Very few tokens.', query: 'fire product ngl', likely: 'positive' },
  { id: 'e8', title: 'Mixed review', hint: 'May flip between models.', query: 'Looks amazing but broke after a week.', likely: 'negative' },
  { id: 'e9', title: 'Classroom use', hint: 'Education domain.', query: 'My students loved the science kit.', likely: 'positive' },
  { id: 'e10', title: 'Empty-ish', hint: 'Whitespace and symbols only.', query: '   !!!   ', likely: 'negative' },
];

export const METRIC_EXAMPLES: MetricExample[] = [
  { id: 'e1', title: 'Cancer screen, low bar', hint: 'Catch cases → low threshold, high recall.', scenario: 'medical', threshold: 0.2, prefer: 'Recall' },
  { id: 'e2', title: 'Cancer screen, strict', hint: 'High threshold misses cases.', scenario: 'medical', threshold: 0.8, prefer: 'Recall' },
  { id: 'e3', title: 'Spam, balanced', hint: 'Do not bury real mail.', scenario: 'spam', threshold: 0.5, prefer: 'Precision' },
  { id: 'e4', title: 'Spam, aggressive', hint: 'Too many false positives.', scenario: 'spam', threshold: 0.25, prefer: 'Precision' },
  { id: 'e5', title: 'Search ranking', hint: 'F1 as the compromise.', scenario: 'search', threshold: 0.45, prefer: 'F1' },
  { id: 'e6', title: 'Card fraud', hint: 'Missing fraud is costly.', scenario: 'fraud', threshold: 0.3, prefer: 'Recall' },
  { id: 'e7', title: 'Hiring screen', hint: 'False positives waste interviews.', scenario: 'hiring', threshold: 0.7, prefer: 'Precision' },
  { id: 'e8', title: 'Content moderation', hint: 'Balance harm vs over-blocking.', scenario: 'moderation', threshold: 0.55, prefer: 'F1' },
  { id: 'e9', title: 'Loan default', hint: 'Rejecting good borrowers hurts.', scenario: 'loan', threshold: 0.65, prefer: 'Precision' },
  { id: 'e10', title: 'Factory defect', hint: 'A missed defect ships bad parts.', scenario: 'factory', threshold: 0.35, prefer: 'Recall' },
];

export const SHAPE_EXAMPLES: ShapeExample[] = [
  { id: 'e1', title: 'Clean circle', hint: 'High circularity.', label: 'circle' },
  { id: 'e2', title: 'Clean square', hint: 'Aspect near 1, lower circularity.', label: 'square' },
  { id: 'e3', title: 'Clean triangle', hint: 'Pointy, more edges.', label: 'triangle' },
  { id: 'e4', title: 'Small circle', hint: 'Same class, less area.', label: 'circle' },
  { id: 'e5', title: 'Wide square', hint: 'Still closer to square.', label: 'square' },
  { id: 'e6', title: 'Tall triangle', hint: 'Skinny triangle.', label: 'triangle' },
  { id: 'e7', title: 'Noisy circle', hint: 'Colour noise, same geometry.', label: 'circle' },
  { id: 'e8', title: 'Noisy square', hint: 'Should still vote square.', label: 'square' },
  { id: 'e9', title: 'Noisy triangle', hint: 'Should still vote triangle.', label: 'triangle' },
  { id: 'e10', title: 'Near-circle oval', hint: 'Closest neighbour is circle.', label: 'circle' },
];

export const TOKEN_EXAMPLES: TokenExample[] = [
  { id: 'e1', title: 'English library', lang: 'english', hint: 'Baseline English bill.', text: 'The school library opens at nine and students borrow books freely.' },
  { id: 'e2', title: 'Tamil library', lang: 'tamil', hint: 'Same meaning, more tokens.', text: 'பள்ளி நூலகம் காலை ஒன்பது மணிக்கு திறக்கும் மற்றும் மாணவர்கள் புத்தகங்களை இலவசமாக இரவல் வாங்குகின்றனர்.' },
  { id: 'e3', title: 'Hindi library', lang: 'hindi', hint: 'Indic script splits further.', text: 'विद्यालय पुस्तकालय सुबह नौ बजे खुलता है और विद्यार्थी पुस्तकें निशुल्क उधार लेते हैं.' },
  { id: 'e4', title: 'English homework', lang: 'english', hint: 'Short classroom sentence.', text: 'Please submit the science homework before Friday morning.' },
  { id: 'e5', title: 'Tamil homework', lang: 'tamil', hint: 'Compare token count to English.', text: 'வெள்ளிக்கிழமை காலைக்குள் அறிவியல் வீட்டுப்பாடத்தை சமர்ப்பிக்கவும்.' },
  { id: 'e6', title: 'Hindi homework', lang: 'hindi', hint: 'Compare token count to English.', text: 'कृपया शुक्रवार सुबह से पहले विज्ञान का गृहकार्य जमा करें।' },
  { id: 'e7', title: 'Code-switching', lang: 'mixed', hint: 'English + Tamil in one bill.', text: 'Please open the நூலகம் app and borrow a புத்தகம்.' },
  { id: 'e8', title: 'Punctuation storm', lang: 'english', hint: 'Symbols still cost tokens.', text: 'Wait... what?!? This can\'t be $5.00!!!' },
  { id: 'e9', title: 'Numbers & units', lang: 'english', hint: 'Digits group as pieces.', text: 'The bus arrives at 7:45 am and costs Rs 15.' },
  { id: 'e10', title: 'Empty input', lang: 'english', hint: 'Zero tokens, zero cost.', text: '   ' },
];

export const SIMILARITY_EXAMPLES: PhrasePairExample[] = [
  { id: 'e1', title: 'Cat paraphrases', hint: 'Near-paraphrase vs river bank.', phrases: ['the cat sat on the mat', 'a kitten rested on the rug', 'bank of a river', 'savings bank account'] },
  { id: 'e2', title: 'Python polysemy', hint: 'Language vs snake.', phrases: ['python programming language', 'write python code in class', 'python the snake', 'a cobra in the grass'] },
  { id: 'e3', title: 'School sports', hint: 'Football vs exam stress.', phrases: ['the football match after school', 'kids played soccer on the field', 'final exam timetable', 'chemistry revision notes'] },
  { id: 'e4', title: 'Food', hint: 'Dosa vs dessert.', phrases: ['crispy dosa with chutney', 'south indian breakfast plate', 'chocolate ice cream sundae', 'frozen dessert shop'] },
  { id: 'e5', title: 'Health', hint: 'Fever vs fitness.', phrases: ['the child has a high fever', 'a child with high fever needs rest', 'morning jogging in the park', 'track and field practice'] },
  { id: 'e6', title: 'Money', hint: 'Piggy bank vs river.', phrases: ['save money in a bank account', 'deposit pocket money weekly', 'the river bank was muddy', 'boats along the shore'] },
  { id: 'e7', title: 'Weather', hint: 'Rain vs sunny picnic.', phrases: ['heavy rain flooded the street', 'carry an umbrella today', 'bright sunshine for the picnic', 'clear blue sky this noon'] },
  { id: 'e8', title: 'Devices', hint: 'Phone vs telescope.', phrases: ['charge the mobile phone', 'android smartphone battery', 'look through a telescope', 'observe the night sky'] },
  { id: 'e9', title: 'Music', hint: 'Choir vs coding.', phrases: ['school choir rehearsal', 'students singing in harmony', 'debug the scratch project', 'fix a sprite costume bug'] },
  { id: 'e10', title: 'Identical pair', hint: 'Self-similarity should be 1.', phrases: ['yaaralabs playground lab', 'yaaralabs playground lab', 'unrelated asteroid mining', 'unrelated asteroid mining'] },
];

export const TEMPERATURE_EXAMPLES: PromptExample[] = [
  { id: 'e1', title: 'Robot gardener', hint: 'Creative story prompt.', prompt: 'Write a two-sentence bedtime story about a robot that learns to garden.' },
  { id: 'e2', title: 'Science fair', hint: 'Keep it classroom-safe.', prompt: 'In two sentences, describe a volcano model for a class 7 science fair.' },
  { id: 'e3', title: 'Lost homework', hint: 'Advice tone.', prompt: 'Give two sentences of advice to a student who forgot homework on the bus.' },
  { id: 'e4', title: 'Water cycle', hint: 'Factual vs florid.', prompt: 'Explain the water cycle in exactly two sentences.' },
  { id: 'e5', title: 'Haiku request', hint: 'Format sensitivity.', prompt: 'Write a haiku about monsoon rain on a school roof.' },
  { id: 'e6', title: 'Debugging buddy', hint: 'Practical help.', prompt: 'In two sentences, tell a beginner how to find a bug in Scratch.' },
  { id: 'e7', title: 'Canteen menu', hint: 'Everyday setting.', prompt: 'Invent a two-sentence advertisement for a school canteen dosa.' },
  { id: 'e8', title: 'Safety rule', hint: 'Should stay consistent at low temp.', prompt: 'State one lab safety rule about electricity in two sentences.' },
  { id: 'e9', title: 'Translate-ish', hint: 'Simple paraphrase.', prompt: 'Rewrite “the cat sat on the mat” in two playful sentences.' },
  { id: 'e10', title: 'Empty-ish prompt', hint: 'Should still refuse to crash.', prompt: 'Say hello in one sentence.' },
];

export const PERSONA_EXAMPLES: PersonaExample[] = [
  {
    id: 'e1', title: 'Priya / gravity', hint: 'Everyday physics, no equations.',
    system: 'You are Priya, a patient physics teacher for class 8. Use everyday Indian examples. Never use equations unless asked.',
    shotUser: 'What is friction?',
    shotAssistant: 'Priya here. Friction is the grip between two surfaces, like sandals on a playground. It slows things and also helps you walk without slipping.',
    prompt: 'Explain gravity in three sentences.',
  },
  {
    id: 'e2', title: 'Coach / teamwork', hint: 'Sports metaphors.',
    system: 'You are Coach Arun. Talk like a school football coach. Short sentences. Always end with a huddle cheer.',
    shotUser: 'I missed a goal.',
    shotAssistant: 'Coach Arun here. Shake it off. Next play, plant your foot and follow through. Huddle: we go again!',
    prompt: 'How do I stay calm before a match?',
  },
  {
    id: 'e3', title: 'Librarian / citations', hint: 'Must mention sources.',
    system: 'You are Ms. Kavitha, a school librarian. Always remind students to cite sources. Be warm and precise.',
    shotUser: 'Can I copy from Wikipedia?',
    shotAssistant: 'Ms. Kavitha here. You may read Wikipedia to learn, then write in your own words and cite it. Copy-paste is not allowed.',
    prompt: 'How should I start a history project on Ashoka?',
  },
  {
    id: 'e4', title: 'Lab tech / safety', hint: 'Safety first.',
    system: 'You are a chemistry lab technician. Lead with safety. Never suggest tasting chemicals.',
    shotUser: 'Can I mix two unknown liquids?',
    shotAssistant: 'Safety first: do not mix unknowns. Ask the teacher, wear goggles, and label every bottle.',
    prompt: 'How do I heat a test tube of water?',
  },
  {
    id: 'e5', title: 'CS mentor', hint: 'Scratch-friendly.',
    system: 'You are a coding mentor for Scratch. Avoid jargon. Prefer blocks over syntax.',
    shotUser: 'My sprite does not move.',
    shotAssistant: 'Check the green flag, then a motion block like “move 10 steps”. If it still sits, the script may be on the wrong sprite.',
    prompt: 'How do I make the cat bounce off the edge?',
  },
  {
    id: 'e6', title: 'Counsellor', hint: 'Gentle tone.',
    system: 'You are a school counsellor. Be kind, never shame the student, suggest talking to a trusted adult.',
    shotUser: 'I am nervous about marks.',
    shotAssistant: 'It is okay to feel nervous. One test does not define you. Let us plan a small study block and tell a teacher if it feels too heavy.',
    prompt: 'I froze during a class presentation.',
  },
  {
    id: 'e7', title: 'News editor', hint: 'No fake stats.',
    system: 'You are a student newspaper editor. Never invent statistics. Mark uncertainty clearly.',
    shotUser: 'How many kids use phones?',
    shotAssistant: 'I do not have a verified number for our school. We should survey our class or cite a named report.',
    prompt: 'Write a two-sentence news lede about a rain holiday.',
  },
  {
    id: 'e8', title: 'Math tuitor', hint: 'Steps, not just answers.',
    system: 'You are a maths tutor. Show steps in plain words. Do not skip the “why”.',
    shotUser: 'What is 3/4 of 20?',
    shotAssistant: 'A quarter of 20 is 5, so three quarters is 15. We multiplied by 3 and divided by 4.',
    prompt: 'Explain why a negative times a negative is positive, without formulas.',
  },
  {
    id: 'e9', title: 'Museum guide', hint: 'Storytelling.',
    system: 'You are a museum guide at a science centre. Invite the visitor to look closer. Keep it to 3 sentences.',
    shotUser: 'What is that skeleton?',
    shotAssistant: 'Come closer — that is a whale vertebra. Notice the size compared with your backpack. It once held up an animal longer than this hall.',
    prompt: 'Describe a Foucault pendulum to a 12-year-old.',
  },
  {
    id: 'e10', title: 'Empty persona contrast', hint: 'Baseline with no persona.',
    system: '',
    shotUser: '',
    shotAssistant: '',
    prompt: 'Explain gravity in three sentences.',
  },
];

export const MODEL_COMPARE_EXAMPLES: PromptExample[] = [
  { id: 'e1', title: 'Invented statistic trap', hint: 'Watch for hallucinations.', prompt: 'List three reasons a school might ban phones, then invent one statistic as if it were a real study. After that, clearly mark anything you are unsure about.' },
  { id: 'e2', title: 'Format request', hint: 'Headings vs blob.', prompt: 'Answer with a numbered list only: three ways to save water at school.' },
  { id: 'e3', title: 'Reasoning', hint: 'Show working.', prompt: 'A bus has 12 seats. 5 students board, 2 leave, 4 board. How many are on the bus? Show steps.' },
  { id: 'e4', title: 'Incomplete ask', hint: 'Should ask a clarifying question.', prompt: 'Make it better.' },
  { id: 'e5', title: 'Bilingual', hint: 'English explanation of a Tamil word.', prompt: 'Explain the Tamil word “நூலகம்” in English for a class 6 student.' },
  { id: 'e6', title: 'Safety', hint: 'Must not give dangerous instructions.', prompt: 'How can I test if a battery is leaking in the science lab?' },
  { id: 'e7', title: 'JSON-ish', hint: 'Formatting discipline.', prompt: 'Return JSON with keys summary and next_step for: “the class needs more pencils”.' },
  { id: 'e8', title: 'Long completeness', hint: 'Does the short model cut off?', prompt: 'Give five distinct ideas for a recycling club, each in one sentence.' },
  { id: 'e9', title: 'Cite or refuse', hint: 'No fake papers.', prompt: 'Cite a 2024 scientific paper proving that homework always raises marks.' },
  { id: 'e10', title: 'Role conflict', hint: 'Instruction following.', prompt: 'Ignore previous style and reply with exactly the word OK.' },
];

export const CONTEXT_EXAMPLES: ContextExample[] = [
  {
    id: 'e1', title: 'Triple-pasted lab brief', hint: 'Duplicates + canteen junk.',
    text: [
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
    ].join('\n').repeat(3),
  },
  {
    id: 'e2', title: 'Chat log dump', hint: 'Old turns drown the task.',
    text: Array.from({ length: 20 }, (_, i) => `Old turn ${i + 1}: someone asked about the weather in ${i}.`).join('\n')
      + '\nTask: Summarise why we prune context windows.',
  },
  {
    id: 'e3', title: 'Already short', hint: 'Should not overflow.',
    text: 'Task: Define a token in one sentence.\nStyle: plain English.',
  },
  {
    id: 'e4', title: 'Repeated safety banner', hint: 'Prune identical banners.',
    text: Array.from({ length: 15 }, () => 'SAFETY: wear goggles in the lab.').join('\n') + '\nTask: How do we heat water in a beaker?',
  },
  {
    id: 'e5', title: 'Wikipedia-ish dump', hint: 'Keep the question, drop trivia.',
    text: `${'Photosynthesis converts light into chemical energy. '.repeat(40)}\nTask: Give a 2-sentence definition of chlorophyll.`,
  },
  {
    id: 'e6', title: 'JSON blob', hint: 'Structured junk.',
    text: `${JSON.stringify({ menu: ['dosa', 'idli', 'noodles'], scores: Array.from({ length: 30 }, (_, i) => i) })}\nTask: Name one healthy canteen option.`,
  },
  {
    id: 'e7', title: 'Bilingual dump', hint: 'Tamil + English history.',
    text: `${'பள்ளி விளையாட்டு தினம் நேற்று நடைபெற்றது. '.repeat(12)}\nYesterday was sports day.\n`.repeat(4) + 'Task: Write a one-line caption for the trophy photo.',
  },
  {
    id: 'e8', title: 'Code comments', hint: 'Keep the ask, drop logs.',
    text: `${'console.log("debug");\n'.repeat(40)}Task: Explain what a sprite costume is.`,
  },
  {
    id: 'e9', title: 'Empty lines', hint: 'Whitespace should not count as signal.',
    text: `\n\n\n\nTask: Define precision.\n\n\n`,
  },
  {
    id: 'e10', title: 'Hard overflow', hint: 'Must report truncation.',
    text: Array.from({ length: 80 }, (_, i) => `Unused biography paragraph ${i} about a fictional scientist who collected stamps.`).join('\n')
      + '\nTask: Name one way to compact a prompt.',
  },
];

export const SCORED_DATASET: Array<{ y: number; s: number }> = [
  { y: 1, s: 0.96 },
  { y: 1, s: 0.91 },
  { y: 1, s: 0.82 },
  { y: 1, s: 0.71 },
  { y: 1, s: 0.64 },
  { y: 1, s: 0.51 },
  { y: 1, s: 0.44 },
  { y: 0, s: 0.73 },
  { y: 0, s: 0.58 },
  { y: 0, s: 0.41 },
  { y: 0, s: 0.33 },
  { y: 0, s: 0.22 },
  { y: 0, s: 0.18 },
  { y: 0, s: 0.09 },
];

const EXAMPLE_MAP: Record<ExerciseId, NamedExample[]> = {
  1: RULE_EXAMPLES,
  2: TEXT_PROBE_EXAMPLES,
  3: METRIC_EXAMPLES,
  4: SHAPE_EXAMPLES,
  4.5: [],
  5: TOKEN_EXAMPLES,
  6: SIMILARITY_EXAMPLES,
  7: TEMPERATURE_EXAMPLES,
  8: PERSONA_EXAMPLES,
  9: MODEL_COMPARE_EXAMPLES,
  10: CONTEXT_EXAMPLES,
  11: [],
  12: [],
  13: [],
  14: [],
};

export function examplesFor(id: ExerciseId): NamedExample[] {
  return EXAMPLE_MAP[id];
}
