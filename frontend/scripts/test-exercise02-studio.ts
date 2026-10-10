import {
  DATASET_CSV,
  encodeLabeledRows,
  loadDataset,
  loadLabFile,
  macroMetricsFromProbs,
  metricsAt,
  modelFromExport,
  canClassifyText,
  scoreWithModel,
  toTrainRows,
  trainLocal,
} from '../components/Exercises/engines/sentimentStudio';
import { DEFAULT_TFIDF_TRAIN_CONFIG } from '../components/Exercises/types';
import { DEPARTMENT_SOURCES, DATASET_COLLECTION_ABOUT, DATASET_COLLECTION_DESCRIPTION, getDepartmentSource } from '../components/Exercises/data/departmentCatalog';
import { BUNDLED_TFIDF_CATALOG, loadBundledTfidfDataset } from '../components/Exercises/data/tfidfBundled';
import { canTrainEx2 } from '../components/Exercises/labs/ex2LabState';
import { parseEx2Result, serializeEx2Result, toEx2Result } from '../components/Exercises/ex2Result';
import {
  cleanNoteText,
  inspectDuplicates,
  inspectLeakage,
  inspectMissing,
  parsePackInspect,
  prepareLabeledRows,
} from '../components/Exercises/labs/ex2TextPrep';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const retail = loadDataset(DATASET_CSV);
assert(retail.length >= 20, 'retail sample too small');
assert(retail.some((row) => row.label === 'positive'), 'missing positive');
assert(retail.some((row) => row.label === 'negative'), 'missing negative');

const tight = trainLocal(retail, { ...DEFAULT_TFIDF_TRAIN_CONFIG, max_features: 40, ngram_min: 1, ngram_max: 1, seed: 42, test_size: 0.25 });
assert(tight.n_features <= 40, `max_features should cap vocab, got ${tight.n_features}`);
const grams = trainLocal(retail, { ...DEFAULT_TFIDF_TRAIN_CONFIG, ngram_min: 1, ngram_max: 2, max_features: 800, seed: 42, test_size: 0.25 });
assert(grams.model.ngram_max === 2, 'exported model should keep ngram max');
assert(grams.word_weights.some((item) => item.word.includes(' ')), 'bigrams should appear when ngram_max is 2');
const local = trainLocal(retail, 0.25, 42);
assert(local.success, 'local train failed');
assert(local.n_classes === 2, 'retail should be binary');
assert((local.model.classes || []).includes('positive'), 'missing positive class');
const model = modelFromExport(local.model);
const love = scoreWithModel('I absolutely love this, it works great!', model);
assert(love.probability > 0.5, `positive text scored ${love.probability}`);
const hate = scoreWithModel('Terrible quality, broke and a total waste.', model);
assert(hate.probability < 0.5, `negative text scored ${hate.probability}`);
assert(!canClassifyText('m'), 'a single letter should not classify');
assert(!canClassifyText('a'), 'a stopword should not classify');
assert(canClassifyText('gearbox vibration'), 'a real ticket should classify');
const card = metricsAt(local.test_probs, 0.5);
assert(card.total === local.n_test, 'scorecard size mismatch');
const lastCurve = local.curve[local.curve.length - 1];
assert(Math.round(lastCurve.acc * 100) === Math.round((local.test_accuracy || 0) * 100), 'curve accuracy should match scorecard');

const tickets = encodeLabeledRows([
  { review: 'login page crashes on save', label: 'Bug' },
  { review: 'please add dark mode to settings', label: 'Feature Request' },
  { review: 'dashboard is slow with large files', label: 'Performance' },
  { review: 'token leak in the public api', label: 'Security' },
  { review: 'null pointer when opening reports', label: 'Bug' },
  { review: 'export to csv would help a lot', label: 'Feature Request' },
  { review: 'search takes too long to return', label: 'Performance' },
  { review: 'password reset is not hashed', label: 'Security' },
]);
assert(new Set(tickets.map((row) => row.label)).size === 4, 'expected 4 classes');
const payload = toTrainRows(tickets);
assert(payload.every((row) => row.label && row.review), 'train rows missing labels');
const multi = trainLocal(tickets, 0.25, 42);
assert(multi.n_classes === 4, 'local multi-class train should keep 4 classes');
assert(multi.model.classes?.length === 4, 'exported model missing classes');
assert(multi.curve.length > 2, 'multi-class curve should move');

assert(DATASET_COLLECTION_ABOUT.length > 80 && DATASET_COLLECTION_DESCRIPTION.length > 80, 'collection About/Description missing');
assert(DEPARTMENT_SOURCES.length === 10, 'department catalog should list 10 departments');
assert(BUNDLED_TFIDF_CATALOG.length === 10, 'bundled catalog should list 10 departments');
assert(BUNDLED_TFIDF_CATALOG.every((item) => item.n_rows === 40000), 'catalog should advertise 40,000 rows');
assert(DEPARTMENT_SOURCES.every((item) => item.about.length > 20 && item.description.join(' ').length > 40), 'each department needs About the Data and Description');
assert(
  DEPARTMENT_SOURCES.every((item) => !item.about.includes('It is for')),
  'About should not name who the pack is for',
);
assert(
  DEPARTMENT_SOURCES.every((item) => item.source.length > 20 && item.use_case.length > 20),
  'each department needs source and use_case',
);
assert(
  DEPARTMENT_SOURCES.every((item) => !item.source.toLowerCase().includes('synthetic') && !item.use_case.toLowerCase().includes('synthetic')),
  'source and use_case should not say synthetic',
);
const eee = getDepartmentSource('electrical');
assert(eee?.source.includes('SCADA') === true, 'EEE source should name real electrical documents');
assert(eee?.use_case.toLowerCase().includes('normal or fault') === true, 'EEE use_case should be the binary routing scenario');
assert(eee?.about.includes('The data came from') === true, 'About should keep origin as running text');
assert(eee?.about.includes('SCADA') !== true, 'About should not append the long source list');
assert(
  DEPARTMENT_SOURCES.every((item) => item.about.split('\n\n').every((para) => para.length <= 280)),
  'About paragraphs should stay short enough for the preview card',
);
assert(
  DEPARTMENT_SOURCES.every((item) => item.description.length === item.classes.length),
  'each class needs one description bullet',
);
assert(
  DEPARTMENT_SOURCES.every((item) => !item.description.join(' ').toLowerCase().includes(item.about.slice(0, 24).toLowerCase())),
  'Description should not repeat the About line',
);
assert(
  DEPARTMENT_SOURCES.every((item) =>
    item.description.every((line, index) => !line.toLowerCase().includes(item.classes[index].toLowerCase())),
  ),
  'Description bullets should not repeat the class name',
);
assert(getDepartmentSource('cse')?.classes.includes('Bug') === true, 'CSE should keep Bug as a class');
assert(getDepartmentSource('not-a-dept') === null, 'unknown department should be null');
assert((loadBundledTfidfDataset('cse')?.n_rows || 0) >= 50, 'CSE bundled pack should load');

const labeledCsv = `text,label
"Login API returns 500 when the session token expires.",Bug
"Add dark mode to the dashboard settings page.",Feature
"How do I rotate API keys without dropping live traffic?",Question
"Search times out on large repositories.",Bug
"Please add SSO for student accounts.",Feature
"Where is the webhook retry documented?",Question
`;
const labeledRows = loadDataset(labeledCsv);
assert(labeledRows.length >= 6, 'text,label CSV should load');
assert(new Set(labeledRows.map((row) => row.label)).size === 3, 'text,label CSV should keep class names');

const ticketCsv = `Document,Topic_group
"VPN disconnects every few minutes on the office guest network.",Network
"Need access to the payroll share for the new hire in finance.",Access
"Laptop will not power on after the overnight Windows update.",Hardware
"Payroll app crashes when exporting last month.",Software
"Cannot reach the printer on floor three.",Network
"Please grant admin rights on the lab workstation.",Access
`;
const ticketRows = loadDataset(ticketCsv);
assert(ticketRows.some((row) => row.label === 'Network'), 'Document/Topic_group aliases should map to text,label');

const githubCsv = `Title,Body,Label
"Null pointer on save","The editor crashes when a file is empty.",Bug
"Dark mode","Add a dark theme to settings.",Feature
"API docs?","Where is token rotation documented?",Question
"Slow search","Large repos hang the search bar.",Bug
"CSV export","Please add export to CSV.",Feature
"Webhooks","How many retries does a webhook get?",Question
`;
const githubRows = loadDataset(githubCsv);
assert(githubRows[0].review.includes('editor crashes'), 'Title+Body should combine into text');
assert(githubRows.some((row) => row.label === 'Bug'), 'GitHub Label column should map to label');

const fakeProbs = [
  { y: 0, p: 0.9, pred: 0 },
  { y: 1, p: 0.8, pred: 1 },
  { y: 1, p: 0.2, pred: 0 },
  { y: 2, p: 0.7, pred: 2 },
];
const macro = macroMetricsFromProbs(fakeProbs, 3);
assert(macro.matrix.length === 3, 'macro confusion size');
assert(macro.total === 4, 'macro total');
assert(macro.correct === 3, 'macro correct');

const embedLocal = trainLocal(retail, { ...DEFAULT_TFIDF_TRAIN_CONFIG, representation: 'embeddings', seed: 42, test_size: 0.25 });
assert(embedLocal.representation === 'embeddings', 'local embeddings train should tag representation');
assert(embedLocal.n_features === 384, `embeddings width should be 384, got ${embedLocal.n_features}`);
const embedModel = modelFromExport(embedLocal.model);
assert(embedModel.representation === 'embeddings', 'exported embedding model missing representation');
const embedLove = scoreWithModel('I absolutely love this, it works great!', embedModel);
const embedHate = scoreWithModel('Terrible quality, broke and a total waste.', embedModel);
assert(embedLove.label === 'positive' || embedLove.probability > 0.5, `embedding positive scored ${embedLove.probability}`);
assert(embedHate.label === 'negative' || embedHate.probability < 0.5, `embedding negative scored ${embedHate.probability}`);
assert(embedLove.probability >= 0 && embedLove.probability <= 1, 'embedding confidence out of range');

const jsonRows = loadLabFile(
  JSON.stringify([
    { text: 'Login API returns 500 when the session token expires.', label: 'Bug' },
    { text: 'Add dark mode to the dashboard settings page.', label: 'Feature' },
    { text: 'How do I rotate API keys without dropping live traffic?', label: 'Question' },
    { text: 'Search times out on large repositories.', label: 'Bug' },
    { text: 'Please add SSO for student accounts.', label: 'Feature' },
    { text: 'Where is the webhook retry documented?', label: 'Question' },
  ]),
  'tickets.json',
);
assert(jsonRows.length === 6, 'JSON array upload should load');
assert(new Set(jsonRows.map((row) => row.label)).size === 3, 'JSON array should keep class names');

const jsonlRows = loadLabFile(
  [
    '{"text":"A tanker parted a mooring line while coming alongside.","label":"Damage"}',
    '{"text":"Port tender reported engine issues with no further damage.","label":"Control"}',
    '{"text":"Fishing support vessel grounded near the fairway.","label":"Grounding"}',
    '{"text":"Pleasure vessel took on water after a coolant pipe failed.","label":"Flooding"}',
    '{"text":"Roller failed and damaged the mooring equipment.","label":"Damage"}',
    '{"text":"Recreational craft lost steering in the canal approach.","label":"Control"}',
    '{"text":"EERV made contact with the fairway and damaged a thruster.","label":"Grounding"}',
    '{"text":"Fishing vessel started to take on water in harbour.","label":"Flooding"}',
  ].join('\n'),
  'maib.jsonl',
);
assert(jsonlRows.length === 8, 'JSONL upload should load');
assert(jsonlRows.some((row) => row.label === 'Damage'), 'JSONL labels should map');

const githubJson = loadLabFile(
  JSON.stringify([
    { Title: 'Null pointer on save', Body: 'The editor crashes when a file is empty.', Label: 0 },
    { Title: 'Dark mode', Body: 'Add a dark theme to settings.', Label: 1 },
    { Title: 'API docs?', Body: 'Where is token rotation documented?', Label: 2 },
    { Title: '', Body: '', Label: 0 },
    { Title: 'Slow search', Body: 'Large repos hang the search bar.', Label: 0 },
    { Title: 'CSV export', Body: 'Please add export to CSV.', Label: 1 },
    { Title: 'Webhooks', Body: 'How many retries does a webhook get?', Label: 2 },
  ]),
  'embold_train.json',
);
assert(githubJson.some((row) => row.label === 'Bug'), 'GitHub JSON 0 should remap to Bug');
assert(githubJson.some((row) => row.label === 'Feature'), 'GitHub JSON 1 should remap to Feature');
assert(githubJson.some((row) => row.label === 'Question'), 'GitHub JSON 2 should remap to Question');
assert(githubJson[0].review.includes('editor crashes'), 'GitHub JSON Title+Body should combine');

const tsvRows = loadLabFile('text\tlabel\n"VPN drops on guest wifi."\tNetwork\n"Need payroll share access."\tAccess\n"Laptop will not power on."\tHardware\n"Payroll app crashes on export."\tSoftware\n"Cannot reach floor printer."\tNetwork\n"Grant admin on lab PC."\tAccess\n');
assert(tsvRows.some((row) => row.label === 'Network'), 'tab-separated files should load');

const messy = [
  { review: '  The LOGIN throws a NULL pointer http://ex.test 🔥  ', label: 'Bug' },
  { review: '  The LOGIN throws a NULL pointer http://ex.test 🔥  ', label: 'Bug' },
  { review: '', label: 'Bug' },
  { review: 'Users requested dark mode', label: 'Feature Request' },
];
const missing = inspectMissing(messy);
assert(missing.emptyText === 1, 'should count empty text');
const dupes = inspectDuplicates(messy);
assert(dupes.extra === 1, 'should count one extra duplicate');
const leaks = inspectLeakage(
  [{ review: 'This Bug ticket is still open', label: 'Bug' }, { review: 'Add export', label: 'Feature Request' }],
  ['Bug', 'Feature Request'],
);
assert(leaks.labelInText === 1, 'class name in the note is leakage');
assert(!canTrainEx2({ hasData: true, inspectApplied: false, repChosen: true }), 'cannot train before inspect');
assert(!canTrainEx2({ hasData: true, inspectApplied: true, repChosen: false }), 'cannot train before representation');
assert(!canTrainEx2({ hasData: false, inspectApplied: true, repChosen: true }), 'cannot train without data');
assert(canTrainEx2({ hasData: true, inspectApplied: true, repChosen: true }), 'can train after inspect and representation');
const liveResult = toEx2Result({
  packId: 'cse',
  packLabel: 'CSE · 2 classes',
  classes: ['Bug', 'Feature'],
  matrix: [[12, 3], [2, 13]],
  threshold: 0.3,
});
assert(liveResult != null, 'toEx2Result should keep a square matrix');
const roundTrip = parseEx2Result(serializeEx2Result(liveResult as NonNullable<typeof liveResult>));
assert(roundTrip != null && roundTrip.matrix[0][1] === 3 && roundTrip.matrix[1][0] === 2, 'flat matrix should round-trip');
assert(roundTrip?.threshold === 0.3, 'threshold should round-trip');
assert(parseEx2Result(liveResult)?.matrix[1][1] === 13, 'legacy nested matrix should still parse');
const packStats = parsePackInspect({
  empty_text: 0,
  empty_label: 0,
  extra: 12,
  groups: 5,
  label_in_text: 3,
  mixed_labels: 1,
  n_rows: 40000,
});
assert(packStats?.extra === 12 && packStats.nRows === 40000 && packStats.mixedLabels === 1, 'pack inspect stats should parse');
const cleaned = cleanNoteText('Visit HTTPS://Example.com NOW!!! 😀', {
  dropMissing: true,
  dropDuplicates: true,
  lowercase: true,
  stripNoise: true,
  stopwords: false,
  lemmatize: false,
}, 'tfidf');
assert(!cleaned.includes('http'), 'URLs should strip');
assert(cleaned === cleaned.toLowerCase(), 'lowercase should apply');
const prepared = prepareLabeledRows(messy, {
  dropMissing: true,
  dropDuplicates: true,
  lowercase: true,
  stripNoise: true,
  stopwords: true,
  lemmatize: true,
}, 'tfidf');
assert(prepared.length === 2, `prep should drop empty and duplicate, got ${prepared.length}`);
assert(!prepared[0].review.includes('http'), 'prepared text should be cleaned');
const rawEmbed = cleanNoteText('The requested reports are running', {
  dropMissing: true,
  dropDuplicates: true,
  lowercase: true,
  stripNoise: true,
  stopwords: true,
  lemmatize: true,
}, 'embeddings');
assert(rawEmbed.includes('the') || rawEmbed.includes('requested'), 'embeddings should skip stopwords/lemmatize');

try {
  loadLabFile('PK\x03\x04fake-xlsx', 'sheet.xlsx');
  throw new Error('xlsx should be rejected');
} catch (error) {
  assert(
    error instanceof Error && error.message.toLowerCase().includes('excel'),
    'xlsx should explain Save as CSV or JSON',
  );
}

console.log('Exercise 2 studio engine checks passed.');
