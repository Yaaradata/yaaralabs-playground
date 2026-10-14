/**
 * The built-in image sample for Image Recognition projects: client documents (KYC forms,
 * corporate-action notices, invoices, cheques) served from frontend/public, one set per region.
 * Sources and licences: nuvama_document_images{,_us,_cn}/SOURCES.csv.
 */

export const SAMPLE_IMAGES_BASE = '/datasets';

export interface SampleRegion {
  id: string;
  name: string;
  dir: string; // folder under SAMPLE_IMAGES_BASE
}
export const SAMPLE_REGIONS: SampleRegion[] = [
  { id: 'in', name: 'India', dir: 'nuvama_documents' },
  { id: 'us', name: 'United States', dir: 'nuvama_documents_us' },
  { id: 'cn', name: 'China', dir: 'nuvama_documents_cn' },
];
export const DEFAULT_REGION = 'in';
const regionOf = (id: string) => SAMPLE_REGIONS.find((r) => r.id === id) ?? SAMPLE_REGIONS[0];
export const MIN_IMAGES_PER_LABEL = 5; // the same rule as the data page

export interface SampleImageLabel {
  label: string; // project label name, e.g. "Corporate action"
  covers: string;
  files: string[]; // relative to SAMPLE_IMAGES_BASE
}
export interface SampleImageTestItem {
  file: string;
  expected: string;
  /** Deep test only: the defects this image has, e.g. "handwritten fill; coffee stain; ..." */
  defects?: string;
}
export interface SampleImageSet {
  name: string;
  description: string;
  labels: SampleImageLabel[];
  test: SampleImageTestItem[];
  /** Harder images: handwriting plus several defects each (nuvama_document_images/test/deep test). */
  deepTest?: SampleImageTestItem[];
}

/** Files are "<region dir>/<path>" once loaded. */
export const sampleImageUrl = (file: string) => `${SAMPLE_IMAGES_BASE}/${file}`;
/** The upload name: India keeps its plain names (kyc_01.jpg); other regions get a prefix (us_kyc_01.jpg). */
export const fileName = (file: string) => {
  const base = file.split('/').pop() || file;
  const region = SAMPLE_REGIONS.find((r) => r.id !== DEFAULT_REGION && file.startsWith(`${r.dir}/`));
  return region ? `${region.id}_${base}` : base;
};

export async function loadSampleImages(regionId: string = DEFAULT_REGION): Promise<SampleImageSet> {
  const { dir } = regionOf(regionId);
  const r = await fetch(`${SAMPLE_IMAGES_BASE}/${dir}/manifest.json`);
  if (!r.ok) throw new Error(`Could not load the sample images (${r.status}).`);
  const d = (await r.json()) as SampleImageSet;
  if (!Array.isArray(d?.labels) || !Array.isArray(d?.test)) throw new Error('The sample file is not in the expected format.');
  const at = (f: string) => `${dir}/${f}`;
  return {
    ...d,
    labels: d.labels.map((l) => ({ ...l, files: l.files.map(at) })),
    test: d.test.map((t) => ({ ...t, file: at(t.file) })),
    deepTest: d.deepTest?.map((t) => ({ ...t, file: at(t.file) })),
  };
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

/** The region whose sample images were added to the project, so its test images are offered. */
const regionKey = (namesKey: string) => `${namesKey}:region`;
export function readRegion(namesKey: string): string {
  try {
    return localStorage.getItem(regionKey(namesKey)) || DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}
export function writeRegion(namesKey: string, regionId: string) {
  try {
    localStorage.setItem(regionKey(namesKey), regionId);
  } catch {
    /* only a convenience */
  }
}

/** Files of a sample label that the project does not already have under that label. */
export function missingFiles(label: SampleImageLabel, existing: { label: string; filename: string }[]): string[] {
  const have = new Set(existing.filter((e) => e.label === label.label).map((e) => e.filename));
  return label.files.filter((f) => !have.has(fileName(f)));
}
