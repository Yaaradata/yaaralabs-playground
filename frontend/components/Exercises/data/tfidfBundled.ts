import bundled from './tfidf-datasets.json';
import { DEPARTMENT_SOURCES } from './departmentCatalog';
import type { TfidfDatasetInfo, TfidfDatasetPayload } from '../types';

const TABLES = bundled.tables as Record<string, TfidfDatasetPayload>;

export const BUNDLED_TFIDF_CATALOG: TfidfDatasetInfo[] = DEPARTMENT_SOURCES.map((source) => ({
  id: source.id,
  name: source.name,
  short: source.short,
  theme: source.theme,
  source: source.source,
  use_case: source.use_case,
  classes: source.classes,
  n_rows: 0, // offline fallback: the real count comes from the server (exercises_tfidf_datasets.row_count)
}));

export function loadBundledTfidfDataset(datasetId: string): TfidfDatasetPayload | null {
  const table = TABLES[datasetId];
  if (!table || !Array.isArray(table.rows) || table.rows.length < 4) return null;
  return table;
}
