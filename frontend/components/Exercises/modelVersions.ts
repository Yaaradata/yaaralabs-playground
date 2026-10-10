/** Shared Model + Version helpers for exercise labs. */

export interface ModelVersionOption {
  id: string;
  label: string;
}

export interface VersionedModel {
  id: string;
  name: string;
  model?: string;
  versions?: ModelVersionOption[];
  defaultVersion?: string;
}

export function versionsOf(model: VersionedModel | null | undefined): ModelVersionOption[] {
  if (!model) return [];
  if (model.versions?.length) {
    return model.versions.map((row) => ({
      id: row.id,
      label: row.label || row.id,
    }));
  }
  const fallback = model.defaultVersion || model.model || model.id;
  return [{ id: fallback, label: fallback }];
}

export function defaultVersionOf(model: VersionedModel | null | undefined): string {
  if (!model) return '';
  if (model.defaultVersion) return model.defaultVersion;
  if (model.versions?.length) return model.versions[0].id;
  return model.model || model.id;
}

export function resolveVersion(
  model: VersionedModel | null | undefined,
  preferred?: string | null,
): string {
  const options = versionsOf(model);
  if (!options.length) return preferred || '';
  if (preferred && options.some((row) => row.id === preferred)) return preferred;
  return defaultVersionOf(model);
}

export function versionOptionsHtml(
  model: VersionedModel | null | undefined,
  selected?: string | null,
): string {
  const options = versionsOf(model);
  const current = resolveVersion(model, selected);
  return options
    .map(
      (row) =>
        `<option value="${escapeAttr(row.id)}"${row.id === current ? ' selected' : ''}>${escapeHtml(row.label)}</option>`,
    )
    .join('');
}

export function versionSelectMarkup(opts: {
  model: VersionedModel | null | undefined;
  selected?: string | null;
  selectId?: string;
  selectAttrs?: string;
  title?: string;
}): string {
  const title = opts.title || 'Version for the selected model';
  const idAttr = opts.selectId ? ` id="${escapeAttr(opts.selectId)}"` : '';
  const extra = opts.selectAttrs ? ` ${opts.selectAttrs}` : '';
  return `<label class="msel vsel" title="${escapeAttr(title)}">
  <span>Version</span>
  <select${idAttr}${extra} aria-label="Model version">${versionOptionsHtml(opts.model, opts.selected)}</select>
</label>`;
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
