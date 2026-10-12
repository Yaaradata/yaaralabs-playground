/**
 * The built-in image sample for Image Recognition projects: client documents (KYC forms,
 * corporate-action notices, invoices, cheques) served from frontend/public. Sources and licences:
 * nuvama_document_images/SOURCES.csv.
 */

export const SAMPLE_IMAGES_BASE = '/datasets/nuvama_documents';
export const MIN_IMAGES_PER_LABEL = 5; // the same rule as the data page

export interface SampleImageLabel {
  label: string; // project label name, e.g. "Corporate action"
  covers: string;
  files: string[]; // relative to SAMPLE_IMAGES_BASE
}
export interface SampleImageTestItem {
  file: string;
  expected: string;
}
export interface SampleImageSet {
  name: string;
  description: string;
  labels: SampleImageLabel[];
  test: SampleImageTestItem[];
}

export const sampleImageUrl = (file: string) => `${SAMPLE_IMAGES_BASE}/${file}`;
export const fileName = (file: string) => file.split('/').pop() || file;

export async function loadSampleImages(): Promise<SampleImageSet> {
  const r = await fetch(`${SAMPLE_IMAGES_BASE}/manifest.json`);
  if (!r.ok) throw new Error(`Could not load the sample images (${r.status}).`);
  const d = (await r.json()) as SampleImageSet;
  if (!Array.isArray(d?.labels) || !Array.isArray(d?.test)) throw new Error('The sample file is not in the expected format.');
  return d;
}

/** Download a sample image as a File, ready for the same upload call as a learner's own image. */
export async function sampleImageFile(file: string): Promise<File> {
  const r = await fetch(sampleImageUrl(file));
  if (!r.ok) throw new Error(`Could not load ${fileName(file)} (${r.status}).`);
  const blob = await r.blob();
  return new File([blob], fileName(file), { type: blob.type || 'image/jpeg' });
}

/** Label names the learner chose for the sample labels, kept per project in this browser. */
export type LabelNames = Record<string, string>; // sample label -> project label
export const labelNamesKey = (sessionId: string, projectId: string) => `sampleImageLabels:${sessionId}:${projectId}`;
export function readLabelNames(key: string): LabelNames {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') as LabelNames;
  } catch {
    return {};
  }
}
export function writeLabelNames(key: string, names: LabelNames) {
  try {
    localStorage.setItem(key, JSON.stringify(names));
  } catch {
    /* only a convenience */
  }
}

/** Files of a sample label that the project does not already have under that label. */
export function missingFiles(label: SampleImageLabel, existing: { label: string; filename: string }[]): string[] {
  const have = new Set(existing.filter((e) => e.label === label.label).map((e) => e.filename));
  return label.files.filter((f) => !have.has(fileName(f)));
}
