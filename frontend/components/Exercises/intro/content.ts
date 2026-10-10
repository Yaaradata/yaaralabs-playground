import type { ExerciseIntroPack, IntroExerciseId } from './types';

const PACKS: Record<IntroExerciseId, ExerciseIntroPack> = {
  1: {
    exerciseId: 1,
    subtitle: 'Teach rules, then run them',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll build a rule-based classifier with blocks — questions, conditions, and answers — then watch Sparky act it out on the stage.',
        content: {
          kind: 'overview',
          goal: 'Your goal: pick a concept, drag blocks into a script, run it, and see how hard-coded rules behave before any machine learning.',
          stages: [
            { n: '1', title: 'Pick a concept', detail: 'Odd/even, grades, tickets, or your own task' },
            { n: '2', title: 'Build the script', detail: 'Drag blocks; they snap into a flow' },
            { n: '3', title: 'Run & reply', detail: 'Sparky asks; you answer on the stage' },
            { n: '4', title: 'Compare to ML', detail: 'Rules are clear — later labs learn from data' },
          ],
        },
      },
      {
        title: 'What is a rule-based process?',
        body: 'Every decision is an explicit if/then you wrote. Nothing is “learned” from examples — the logic is visible in the blocks and in the Python view.',
        content: {
          kind: 'cards',
          heading: 'Why start here?',
          cards: [
            { title: 'Transparent', detail: 'You can read every branch. When something is wrong, you fix the rule.' },
            { title: 'Fast to try', detail: 'Change a condition, press Run, and see the new path immediately.' },
            { title: 'Limits show up', detail: 'Messy language and edge cases need more rules — that pain motivates learning models later.' },
          ],
        },
      },
      {
        title: 'How the workspace fits together',
        body: 'Left palette, centre canvas, right stage. Features (Run / Stop / Restart) sit on the canvas; Full screen keeps the lab focused.',
        content: {
          kind: 'pipeline',
          heading: 'The three panes',
          items: [
            { title: 'Palette', detail: 'Concept picker and block types you can drag in.' },
            { title: 'Canvas', detail: 'Your script — questions, conditions, and replies snap together.' },
            { title: 'Stage / Python', detail: 'Sparky performs the run, or you inspect the generated Python.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Choose a preset concept or invent one. Build a short script, press Run, and answer Sparky’s questions.',
        content: {
          kind: 'task',
          task: 'Build one complete rule script and run it end-to-end on the stage before you move on.',
          conclusions: [
            { title: 'Rules are contracts', detail: 'What you wrote is what runs — no hidden weights.' },
            { title: 'Next labs learn', detail: 'Exercise 2 trains a model from labelled notes instead of hand-written rules.' },
          ],
        },
      },
    ],
  },
  3: {
    exerciseId: 3,
    subtitle: 'Read a model with a confusion matrix',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll turn a real-world story into a confusion matrix, then use it to work out the six standard metrics for a classification model.',
        content: {
          kind: 'overview',
          goal: 'Your goal: pick out the positive class, fill the matrix, build each formula, and check the value.',
          stages: [
            { n: '1', title: 'Read the story', detail: 'Which numbers are predictions, and which are what was true?' },
            { n: '2', title: 'Build the matrix', detail: 'Place the counts, then work out the missing cells from the totals' },
            { n: '3', title: 'Build the formulas', detail: 'Drag TP, FN, FP and TN into Accuracy, Precision, Recall and Specificity' },
            { n: '4', title: 'F1 and MCC', detail: 'Use your Precision and Recall, then all four cells' },
            { n: '5', title: 'Rapid fire', detail: 'Four short questions: Precision, Recall, F1 score, or Accuracy?' },
            { n: '6', title: 'Compare', detail: 'Play a new scenario — fraud, welds, spam — and watch the metrics move' },
          ],
        },
      },
      {
        title: 'Four cells, then the totals',
        body: 'Not every number in the story belongs in the matrix. A distractor is there on purpose. The four inner cells decide the row and column totals.',
        content: {
          kind: 'cards',
          heading: 'What each cell means',
          cards: [
            { title: 'True positive', detail: 'The model said positive, and it really was.' },
            { title: 'False negative', detail: 'A real positive the model missed.' },
            { title: 'False positive', detail: 'A false alarm: the model said positive, and it was not.' },
            { title: 'True negative', detail: 'The model said negative, and it really was.' },
          ],
        },
      },
      {
        title: 'What each metric measures',
        body: 'Accuracy can look strong when one class is rare. Precision, recall, specificity, F1 and MCC tell different parts of the story.',
        content: {
          kind: 'cards',
          heading: 'In plain words',
          cards: [
            { title: 'Precision', detail: 'Of the positive alarms, how many were real? This is about false alarms.' },
            { title: 'Recall', detail: 'Of the real positive cases, how many did the model find? This is about missed cases.' },
            { title: 'Specificity', detail: 'Of the real negatives, how many did the model correctly leave alone?' },
            { title: 'F1 and MCC', detail: 'F1 balances precision and recall. MCC uses all four cells and stays honest when classes are unbalanced.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Read the scenario, fill every cell, then solve the six challenges in order. After MCC, a rapid-fire round asks which metric fits. When you want a different class balance, press New scenario.',
        content: {
          kind: 'task',
          task: 'Complete one matrix, all six metrics, and the rapid-fire round. Then try a second scenario and compare the scores.',
          conclusions: [
            { title: 'Same model, different jobs', detail: 'A high accuracy in fraud detection can still hide missed fraud.' },
            { title: 'The formulas stay the same', detail: 'Only the counts change. The meaning of each metric does not.' },
          ],
        },
      },
    ],
  },
  4: {
    exerciseId: 4,
    subtitle: 'Train on images, not tickets',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll upload a department image set, train an image classifier, then read predictions and the confusion matrix on a held-out test tray.',
        content: {
          kind: 'overview',
          goal: 'Your goal: prepare labelled folders, pick a model path, train, then test images one by one or in a batch.',
          stages: [
            { n: '1', title: 'Upload', detail: 'Folder of class folders with images' },
            { n: '2', title: 'Prepare', detail: 'Choose which classes to keep and the train/test split' },
            { n: '3', title: 'Train', detail: 'Pick a model and watch learning' },
            { n: '4', title: 'Test', detail: 'Predict cards and open the matrix' },
          ],
        },
      },
      {
        title: 'How the dataset is organised',
        body: 'Each class is a folder of images. You decide which classes stay in the pool and how much data is held out for testing.',
        content: {
          kind: 'cards',
          heading: 'Before training',
          cards: [
            { title: 'Classes', detail: 'Keep at least two classes with enough train and test images.' },
            { title: 'Split', detail: 'Test images stay hidden while the model learns — like Exercise 2’s held-out notes.' },
            { title: 'Model path', detail: 'Open Model in the header to choose the learner and its knobs.' },
          ],
        },
      },
      {
        title: 'Train, then read the matrix',
        body: 'Training fills the run history. Testing shows what the model thinks it saw — and where it confuses two classes.',
        content: {
          kind: 'pipeline',
          heading: 'What “done” looks like',
          items: [
            { title: 'Learning curve', detail: 'Loss and accuracy move while the run is active.' },
            { title: 'Test tray', detail: 'Flip cards; compare prediction to the true label.' },
            { title: 'Confusion matrix', detail: 'Rows are truth, columns are guesses — find the mix-ups.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Use a sample department pack or your own folder tree. Prepare classes, train once, then spend time on the mistakes.',
        content: {
          kind: 'task',
          task: 'Finish one full train + test cycle and open at least one confusion-matrix cell that is not on the diagonal.',
          conclusions: [
            { title: 'Pixels are features', detail: 'Same idea as text labs — representation in, label out.' },
            { title: 'Next: live vision', detail: 'Exercise 4.5 puts detectors on a live camera feed.' },
          ],
        },
      },
    ],
  },
  4.5: {
    exerciseId: 4.5,
    subtitle: 'Labels on a live camera',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll point the camera at a scene and watch objects get boxes and labels in real time — with a choice of detection engines.',
        content: {
          kind: 'overview',
          goal: 'Your goal: start the camera, pick an engine, watch tracking stay smooth, and try Full screen for a demo-friendly view.',
          stages: [
            { n: '1', title: 'Allow camera', detail: 'Browser permission for the stream' },
            { n: '2', title: 'Pick an engine', detail: 'Cloud Vision, YOLO, COCO, or SAM-6' },
            { n: '3', title: 'Watch labels', detail: 'Boxes update as things move' },
            { n: '4', title: 'Export / share', detail: 'Capture what you saw when useful' },
          ],
        },
      },
      {
        title: 'Engines are different tools',
        body: 'Each detector names scenes differently. Swap engines to see breadth vs speed vs what they recognise.',
        content: {
          kind: 'cards',
          heading: 'What to notice',
          cards: [
            { title: 'Names differ', detail: 'The same object may get a different label under another engine.' },
            { title: 'Tracking', detail: 'Boxes try to stick to the same object as it moves across frames.' },
            { title: 'Mirror & fullscreen', detail: 'Mirror for selfie view; Full screen for presenting to the class.' },
          ],
        },
      },
      {
        title: 'How to run a clean trial',
        body: 'Good light, a clear subject, and a moment of stillness make labels easier to read — then move to see tracking.',
        content: {
          kind: 'pipeline',
          heading: 'A short classroom loop',
          items: [
            { title: 'Still object', detail: 'Hold one thing in frame and read the label.' },
            { title: 'Move it', detail: 'Watch whether the box follows.' },
            { title: 'Swap engine', detail: 'Compare what each detector claims to see.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Press play, grant camera access if asked, and try at least two engines on the same scene.',
        content: {
          kind: 'task',
          task: 'Get stable labels on one scene with two different engines and note what changed.',
          conclusions: [
            { title: 'Live ≠ trained pack', detail: 'This lab detects general objects; Exercise 4 trains on your folders.' },
            { title: 'Safety', detail: 'Only use a camera you control in the classroom setting.' },
          ],
        },
      },
    ],
  },
  5: {
    exerciseId: 5,
    subtitle: 'Tokens, languages, and cost',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll wire a multilingual answer flow, then compare token counts and USD cost across models and Indian languages.',
        content: {
          kind: 'overview',
          goal: 'Your goal: connect models → question → length → languages → answers, run the workflow, and read the cost panel.',
          stages: [
            { n: '1', title: 'Pick models', detail: 'Compare more than one Gemini model' },
            { n: '2', title: 'Ask a question', detail: 'Type or load a department sample' },
            { n: '3', title: 'Add languages', detail: 'Drop languages into the flow' },
            { n: '4', title: 'Run & meter', detail: 'Tokens, multipliers, and USD cost' },
          ],
        },
      },
      {
        title: 'Why tokens matter',
        body: 'Models bill by tokens, not by “words in English.” Indic scripts often use more tokens for the same meaning.',
        content: {
          kind: 'cards',
          heading: 'What the lab measures',
          cards: [
            { title: 'Token count', detail: 'How the chosen encoder splits your text.' },
            { title: '× vs English', detail: 'Relative cost of the same answer in another language.' },
            { title: 'USD cost', detail: 'Rough dollar cost from Vertex list prices ($/1M tokens).' },
          ],
        },
      },
      {
        title: 'How wiring works',
        body: 'Nodes must be connected in order. Auto-wire helps; Undo walks back a mistake. Zoom and Fit keep the canvas readable.',
        content: {
          kind: 'pipeline',
          heading: 'Flow order',
          items: [
            { title: 'Models', detail: 'Which APIs will answer.' },
            { title: 'Question + length', detail: 'What students ask and how long the reply may be.' },
            { title: 'Languages → answers', detail: 'One answer node per language you kept.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Load a sample question, add at least two languages, run the workflow, and compare the metrics panel.',
        content: {
          kind: 'task',
          task: 'Produce answers in two languages and write down which one cost more tokens for a similar reply.',
          conclusions: [
            { title: 'Language is infrastructure', detail: 'Cost is part of designing a real school or product flow.' },
            { title: 'Next: similarity', detail: 'Exercise 6 compares how two embedding models see phrases.' },
          ],
        },
      },
    ],
  },
  6: {
    exerciseId: 6,
    subtitle: 'When embeddings disagree',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll embed the same batch of sentences with two models, work out how close each pair is, and find where the rankings disagree.',
        content: {
          kind: 'overview',
          goal: 'Your goal: embed one batch with two models, read both grids, and explain at least one disagreement.',
          stages: [
            { n: '1', title: 'Batch', detail: '3–12 sentences both models will embed' },
            { n: '2', title: 'Two models', detail: 'Browser, word counts, or Playground-hosted' },
            { n: '3', title: 'Pair grids', detail: 'Cosine, Euclidean, or dot product' },
            { n: '4', title: 'Calculation', detail: 'Step-by-step maths for a picked pair' },
            { n: '5', title: 'Compare', detail: 'Closest matches and rank gaps' },
          ],
        },
      },
      {
        title: 'An embedding is a list of numbers',
        body: 'A given model always returns the same length list for every sentence. Distance between two lists is how the model scores “similar meaning”.',
        content: {
          kind: 'cards',
          heading: 'What to look for',
          cards: [
            { title: 'Paraphrases', detail: 'Same idea, different words — should rank close if the model “gets” meaning.' },
            { title: 'Negation', detail: '“did not fail” vs “failed” — often a hard test.' },
            { title: 'Two meanings / another language', detail: '“beam” as girder vs laser; Tamil vs English for the same idea.' },
          ],
        },
      },
      {
        title: 'Higher is not always closer',
        body: 'Cosine similarity and the dot product: higher means closer. Euclidean distance: lower means closer. A 0.8 from one model is not the same as a 0.8 from another.',
        content: {
          kind: 'pipeline',
          heading: 'How to read the lab',
          items: [
            { title: 'Pick a metric', detail: 'Switch cosine / Euclidean / dot and watch both grids update.' },
            { title: 'Open the calculation', detail: 'Click a cell to see dot product, lengths, and the final number.' },
            { title: 'Compare rankings', detail: 'Closest-match table and all-pairs rank gap show where models disagree.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Load the example batch (paraphrase, negation, polysemy, Tamil), pick MiniLM and BGE, embed, then switch to Euclidean and compare rankings.',
        content: {
          kind: 'task',
          task: 'Find one pair where Model A and Model B disagree on closest match, and suggest why (paraphrase, negation, two meanings, or language).',
          conclusions: [
            { title: 'Scores stay inside one model', detail: 'Compare ranks, not raw numbers across models.' },
            { title: 'Link forward', detail: 'The same distance idea later picks RAG chunks to send to the model.' },
          ],
        },
      },
    ],
  },
  7: {
    exerciseId: 7,
    subtitle: 'Change one dial at a time',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll change temperature, top-k, top-p, or the output cap one at a time, then compare variety, consistency, and cost against a baseline.',
        content: {
          kind: 'overview',
          goal: 'Your goal: pick one dial, run Batch A and Batch B with a controlled difference, and log what changed.',
          stages: [
            { n: '1', title: 'Write a prompt', detail: 'Short answers make dial effects obvious' },
            { n: '2', title: 'Choose a dial', detail: 'Temp, top-k, top-p, or cap' },
            { n: '3', title: 'Run batches', detail: 'Same model; only one knob differs' },
            { n: '4', title: 'Compare & log', detail: 'Variety, overlap, tokens, cost' },
          ],
        },
      },
      {
        title: 'What each dial does',
        body: 'Keep the model fixed. Only the dial you are studying should move between Batch A and Batch B.',
        content: {
          kind: 'cards',
          heading: 'The four dials',
          cards: [
            { title: 'Temperature', detail: 'Low = focused and repeatable. High = more varied wording.' },
            { title: 'Top-k / Top-p', detail: 'How wide the next-token shortlist is. Narrow = safer; wide = freer.' },
            { title: 'Output cap', detail: 'Hard limit on answer length — also caps cost.' },
          ],
        },
      },
      {
        title: 'Fair experiments',
        body: 'Baseline makes B match A so you can see chance alone. Reset restores the starting values for the dial in view.',
        content: {
          kind: 'pipeline',
          heading: 'Classroom habit',
          items: [
            { title: 'One change', detail: 'Never move two dials in the same comparison.' },
            { title: 'Several runs', detail: 'Use the runs stepper so noise is visible.' },
            { title: 'Export', detail: 'Save the log when you want a sheet for discussion.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Use the sample prompt or write your own. Run A, then B, and read the Compare card before you touch another dial.',
        content: {
          kind: 'task',
          task: 'Complete one clean A/B comparison for a single dial and note variety vs cost.',
          conclusions: [
            { title: 'Knobs are trade-offs', detail: 'Creativity, consistency, and budget pull in different directions.' },
            { title: 'Next: personas', detail: 'Exercise 8 writes a system persona and tests if it holds.' },
          ],
        },
      },
    ],
  },
  8: {
    exerciseId: 8,
    subtitle: 'Write a persona and prompt it',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll write a system persona, add zero/one/few-shot examples, then judge Held vs Broke across on-task, off-topic, and pressure questions.',
        content: {
          kind: 'overview',
          goal: 'Your goal: define who the assistant is, give examples, run the matrix, and mark whether answers stayed in character.',
          stages: [
            { n: '1', title: 'Persona', detail: 'Role, helps-with, refuses, rules' },
            { n: '2', title: 'Examples', detail: 'Question + ideal answer pairs' },
            { n: '3', title: 'Run matrix', detail: 'Zero / one / few-shot columns' },
            { n: '4', title: 'Judge', detail: 'Held or Broke for each cell' },
          ],
        },
      },
      {
        title: 'Why examples change behaviour',
        body: 'Zero-shot is persona only. One-shot adds example 1. Few-shot uses all examples — format and tone often improve.',
        content: {
          kind: 'cards',
          heading: 'What you will score',
          cards: [
            { title: 'Format hits', detail: 'Did the answer reuse labels/patterns from your examples?' },
            { title: 'Held / Broke', detail: 'Your call: stayed in character or stepped outside?' },
            { title: 'Pressure rows', detail: 'Off-topic and pushy questions test the refuse rules.' },
          ],
        },
      },
      {
        title: 'Parameters stay fixed',
        body: 'Temperature, top-p, and the output cap stay the same across columns so only the prompt recipe changes.',
        content: {
          kind: 'pipeline',
          heading: 'Fair column compare',
          items: [
            { title: 'Same model', detail: 'One model answers every cell.' },
            { title: 'Same dials', detail: 'Open settings only to set a shared baseline.' },
            { title: 'Different prompt', detail: 'Zero vs one vs few is the single variable.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Load the materials-science example or write your own persona. Add examples, run, then mark Held/Broke honestly.',
        content: {
          kind: 'task',
          task: 'Fill the matrix once and mark every finished cell Held or Broke.',
          conclusions: [
            { title: 'Personas are products', detail: 'Scope and refusals are part of the design, not afterthoughts.' },
            { title: 'Next: model bake-off', detail: 'Exercise 9 reuses your persona across several models.' },
          ],
        },
      },
    ],
  },
  9: {
    exerciseId: 9,
    subtitle: 'Same prompt, different models',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll compare 2–4 models on the same persona (from Exercise 8) and message — optionally blind, then guess who wrote each answer.',
        content: {
          kind: 'overview',
          goal: 'Your goal: paste a persona, send one message to every lane, mark the best reply, and try a blind round.',
          stages: [
            { n: '1', title: 'Persona', detail: 'Paste from Exercise 8 or load Example' },
            { n: '2', title: 'Message', detail: 'Every model gets the same user text' },
            { n: '3', title: 'Compare lanes', detail: 'Add models; read side by side' },
            { n: '4', title: 'Blind & guess', detail: 'Shuffle, hide names, reveal' },
          ],
        },
      },
      {
        title: 'Keep the prompt constant',
        body: 'Only the model changes. Parameters in settings apply to every lane so the bake-off stays fair.',
        content: {
          kind: 'cards',
          heading: 'Classroom moves',
          cards: [
            { title: 'Best reply', detail: 'Star the answer you would ship for this persona.' },
            { title: 'Blind round', detail: 'Hide which model wrote which column, then guess.' },
            { title: 'New chat', detail: 'Clear history when the thread gets noisy.' },
          ],
        },
      },
      {
        title: 'What “better” can mean',
        body: 'On-task, refusal quality, tone, and length all matter. Cost and speed show up in the lane stats.',
        content: {
          kind: 'pipeline',
          heading: 'Judge with the persona',
          items: [
            { title: 'On-task', detail: 'Did it help inside the stated scope?' },
            { title: 'Refusals', detail: 'Did it decline what the persona forbids?' },
            { title: 'Style', detail: 'Would a student trust this voice?' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Paste your Exercise 8 persona (or Example), add at least two models, send one message, then try Blind.',
        content: {
          kind: 'task',
          task: 'Run one open compare and one blind round; mark a best answer in each.',
          conclusions: [
            { title: 'Models are different writers', detail: 'Same prompt ≠ same behaviour.' },
            { title: 'Next: context limits', detail: 'Exercise 10 overflows the window and teaches how to manage it.' },
          ],
        },
      },
    ],
  },
  10: {
    exerciseId: 10,
    subtitle: 'Hit the limit, then manage it',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll overflow a context window on purpose, then prune, compact, and recover the prompt so the chat can continue.',
        content: {
          kind: 'overview',
          goal: 'Your goal: fill the meter past the limit, drop or summarise messages, and send again successfully.',
          stages: [
            { n: '1', title: 'Persona', detail: 'Paste from Exercise 8 or Example' },
            { n: '2', title: 'Fill the window', detail: 'Chat or paste long text' },
            { n: '3', title: 'Hit the limit', detail: 'Watch the meter refuse to send' },
            { n: '4', title: 'Manage it', detail: 'Drop, keep, or compact — then recover' },
          ],
        },
      },
      {
        title: 'What counts against the window',
        body: 'Persona, summary, prior turns, your draft, and room for the reply all share one budget.',
        content: {
          kind: 'cards',
          heading: 'Tools you’ll use',
          cards: [
            { title: 'Drop / Keep', detail: 'Remove a turn from the window or put it back.' },
            { title: 'Compact', detail: 'Summarise older chatter so facts survive in fewer tokens.' },
            { title: 'Long text example', detail: 'A fast way to fill the meter for class demos.' },
          ],
        },
      },
      {
        title: 'Recovery is the skill',
        body: 'Overflowing is easy. The point is choosing what to keep so the model still has the task, constraints, and key facts.',
        content: {
          kind: 'pipeline',
          heading: 'A good recovery',
          items: [
            { title: 'Protect the persona', detail: 'Don’t delete the system rules that define the job.' },
            { title: 'Keep the ask', detail: 'The latest user goal must stay.' },
            { title: 'Compress history', detail: 'Summaries beat silent deletion when details still matter.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Load a persona, push past the limit once, then practise Drop and Compact until Send works again.',
        content: {
          kind: 'task',
          task: 'Overflow once, recover with prune or compact, and get a successful reply afterward.',
          conclusions: [
            { title: 'Context is a budget', detail: 'Every token competes with the answer you still need.' },
            { title: 'Next: RAG chatbot', detail: 'Exercise 11 retrieves from a document instead of stuffing everything into chat history.' },
          ],
        },
      },
    ],
  },
  12: {
    exerciseId: 12,
    subtitle: 'Build a RAG, end to end',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll walk a document through every stage of retrieval-augmented generation — from messy PDF text to a scored answer.',
        content: {
          kind: 'overview',
          goal: 'Your goal: load a sample campus code, run the pipeline, ask one grounded question, then evaluate with known tests.',
          stages: [
            { n: '1–2', title: 'Load & clean', detail: 'Fix PDF headers, hyphens, wraps' },
            { n: '3–5', title: 'Chunk → embed → store', detail: 'Vectors you can search' },
            { n: '6–8', title: 'Retrieve → prompt → generate', detail: 'Ground the model' },
            { n: '9', title: 'Evaluate', detail: 'Score retrieval and answers' },
          ],
        },
      },
      {
        title: 'Clean and chunk first',
        body: 'Extraction noise and chunk size decide what search can find. Bad cleaning makes good embedding look weak.',
        content: {
          kind: 'cards',
          heading: 'Prep stages',
          cards: [
            { title: 'Clean', detail: 'Drop repeating headers, join hyphen breaks, fix wrapped sentences.' },
            { title: 'Chunk', detail: 'Words, sentences, or sections — with size and overlap you can tune.' },
            { title: 'Inspect', detail: 'The Python panel shows the same rules as runnable Colab-style code.' },
          ],
        },
      },
      {
        title: 'Embed, then retrieve',
        body: 'Each chunk becomes a vector. The question is embedded the same way; the closest chunks become context.',
        content: {
          kind: 'pipeline',
          heading: 'Search path',
          items: [
            { title: 'Embed', detail: 'MiniLM or TF-IDF on the server — both models, one API.' },
            { title: 'Store', detail: 'Vectors sit in a flat in-memory index (classroom stand-in for FAISS/Chroma).' },
            { title: 'Retrieve', detail: 'Top-k with a minimum score; watch the 2D map of chunks.' },
          ],
        },
      },
      {
        title: 'Ready to build?',
        body: 'Build the prompt from retrieved chunks, generate with and without the document, then run the evaluation set.',
        content: {
          kind: 'task',
          task: 'Load the example, embed, ask one question that cites chunks, then run the example tests.',
          conclusions: [
            { title: 'RAG is a pipeline', detail: 'Every stage changes what the model is allowed to see.' },
            { title: 'Next: agents with tools', detail: 'Exercise 13 lets the model call tools instead of only reading chunks.' },
          ],
        },
      },
    ],
  },
  13: {
    exerciseId: 13,
    subtitle: 'Turn a model into an agent with tools',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll see what turns a language model into an agent: an instruction, a set of tools it may call, and a loop that decides, runs a tool, reads the result, and answers.',
        content: {
          kind: 'overview',
          goal: 'Your goal: ask without tools, switch a tool on, write one in Python, and follow the step trace.',
          stages: [
            { n: '1', title: 'Agent', detail: 'Name, description, instruction' },
            { n: '2', title: 'Tools', detail: 'Switch on calculator / converter, or write your own' },
            { n: '3', title: 'Chat', detail: 'Ask, watch the steps, check the exact result' },
          ],
        },
      },
      {
        title: 'Why tools matter',
        body: 'On its own, a language model is unreliable at exact arithmetic. A tool returns an exact number; the model only chooses when to call it.',
        content: {
          kind: 'cards',
          heading: 'What the model actually sees',
          cards: [
            { title: 'Name & description', detail: 'Wording steers whether and when it calls a tool.' },
            { title: 'Inputs (schema)', detail: 'Type hints and params — never the tool’s code.' },
            { title: 'Result text', detail: 'After the page runs the tool, only the output comes back.' },
          ],
        },
      },
      {
        title: 'The agent loop',
        body: 'Decide → call a tool → read the result → answer (or call again). Limits and exact checks keep you from trusting bad output.',
        content: {
          kind: 'pipeline',
          heading: 'One round',
          items: [
            { title: 'Model decides', detail: 'It may call one or more tools, or answer in text.' },
            { title: 'Page runs the tool', detail: 'Calculator, converter, or your Python function.' },
            { title: 'Model finishes', detail: 'Or hits the tool-round cap and must answer.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Load the Example agent, ask an exact multiply with no tools, then switch the calculator on and ask again.',
        content: {
          kind: 'task',
          task: 'Compare no-tool vs tool answers on the same sum, then add your own Python tool and chain two tools in one question.',
          conclusions: [
            { title: 'Agents need tools for exact work', detail: 'The model chooses; the page computes.' },
            { title: 'Limits matter', detail: 'Cap tool rounds and verify against an exact result before trusting the answer.' },
            { title: 'Next: AI ethics lab', detail: 'Exercise 14 pressure-tests answers, checks bias and privacy, and compares refusals.' },
          ],
        },
      },
    ],
  },
  14: {
    exerciseId: 14,
    subtitle: 'Test when a model lets people down — and judge for yourself',
    slides: [
      {
        title: 'What will you discover?',
        body: 'You’ll run your own experiments in five situations where an AI system can mislead or harm, then decide when its behaviour is acceptable.',
        content: {
          kind: 'overview',
          goal: 'Your goal: compare models, read the replies (not just counts), override automatic labels, and explain what your results do and don’t show.',
          stages: [
            { n: '1', title: 'Pressure', detail: 'Keep a correct answer under pushback' },
            { n: '2', title: 'Bias', detail: 'Swap only a name; compare scores' },
            { n: '3', title: 'Privacy', detail: 'See what leaves your computer' },
            { n: '4–5', title: 'Facts & refusals', detail: 'Spot inventions and needless refusals' },
          ],
        },
      },
      {
        title: 'Five cases, one model picker',
        body: 'Each case is a controlled test. Switch the model at the top and run again to compare side by side.',
        content: {
          kind: 'cards',
          heading: 'What each case asks',
          cards: [
            { title: 'Pressure test', detail: 'Does an added system instruction stop it changing a right answer?' },
            { title: 'Bias', detail: 'Repeated runs separate a real score gap from ordinary noise.' },
            { title: 'Privacy', detail: 'Find PII, replace it before send, put it back in the reply.' },
            { title: 'Made-up facts & refusals', detail: 'Stamp invented answers; mark should-answer vs should-refuse.' },
          ],
        },
      },
      {
        title: 'Read the replies',
        body: 'Automatic labels help, but you decide. Click a stamp, circle, or matrix cell when you read a reply differently.',
        content: {
          kind: 'pipeline',
          heading: 'Across every case',
          items: [
            { title: 'Compare models', detail: 'Same test, different model — keep prior columns where the lab allows it.' },
            { title: 'Override labels', detail: 'Your reading beats a regex when they disagree.' },
            { title: 'Explain limits', detail: 'Say what the run shows — and what a classroom sample cannot prove.' },
          ],
        },
      },
      {
        title: 'Ready to start?',
        body: 'Open Pressure test, load the Example questions, push back, then try Bias or Privacy with the Example data.',
        content: {
          kind: 'task',
          task: 'Run at least two cases, override one automatic label, and note one result that does not generalise beyond this lab.',
          conclusions: [
            { title: 'Behaviour is testable', detail: 'Controlled prompts and repeated runs beat a single anecdote.' },
            { title: 'Judgement stays with you', detail: 'Counts help; reading the reply decides.' },
          ],
        },
      },
    ],
  },
};

export function getExerciseIntroPack(exerciseId: number): ExerciseIntroPack | null {
  if (exerciseId === 2 || exerciseId === 11) return null;
  return PACKS[exerciseId as IntroExerciseId] ?? null;
}
