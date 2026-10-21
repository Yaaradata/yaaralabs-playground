'use client';

import { useState } from 'react';
import { adminApi, dayBound, formatBytes, formatDate } from '../../lib/admin-api';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyRow, Pagination, Select, TextInput, tdClass, thClass } from './ui';
import { errorText, goToLoginOn401, useAdminList } from './useAdminList';

const EMPTY = { search: '', kind: '', orphaned: '', from: '', to: '', sort: 'newest' };

export default function ModelsPanel({ onChanged }: { onChanged: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const list = useAdminList(adminApi.models, {
    search: f.search,
    kind: f.kind,
    orphaned: f.orphaned,
    date_from: dayBound(f.from),
    date_to: dayBound(f.to, true),
    sort: f.sort,
  });
  const items = list.data?.items ?? [];
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [key]: e.target.value }));
  const filtered = Object.entries(f).some(([k, v]) => v !== EMPTY[k as keyof typeof EMPTY]);
  const allOnPage = items.length > 0 && items.every((m) => selected.includes(m.key));

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await adminApi.deleteModels(pending);
      setNotice({ tone: 'success', text: `Deleted ${r.deleted_models} model(s), ${r.deleted_files} file(s).` });
      setSelected((s) => s.filter((k) => !pending.includes(k)));
      list.reload();
      onChanged();
    } catch (err) {
      if (!goToLoginOn401(err)) setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Card
      title={`Models in bucket${list.data ? ` (${list.data.total})` : ''}`}
      actions={
        <>
          {filtered && (
            <Button variant="ghost" onClick={() => setF(EMPTY)}>
              Clear filters
            </Button>
          )}
          <Button variant="danger" disabled={!selected.length} onClick={() => setPending(selected)}>
            Delete selected ({selected.length})
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="sm:col-span-2">
          <TextInput label="Search" placeholder="Project or session id" value={f.search} onChange={set('search')} />
        </div>
        <Select label="Kind" value={f.kind} onChange={set('kind')}>
          <option value="">All kinds</option>
          <option value="text">Text (trained on server)</option>
          <option value="image">Image (Live Object Detection)</option>
        </Select>
        <Select label="Project" value={f.orphaned} onChange={set('orphaned')}>
          <option value="">Any</option>
          <option value="false">Project exists</option>
          <option value="true">Orphaned (project gone)</option>
        </Select>
        <TextInput label="Updated from" type="date" value={f.from} onChange={set('from')} />
        <TextInput label="Updated to" type="date" value={f.to} onChange={set('to')} />
        <Select label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="size">Largest first</option>
          <option value="files">Most files</option>
          <option value="name">Path A–Z</option>
        </Select>
      </div>

      {notice && <div className="mb-3"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {list.error && <div className="mb-3"><Alert tone="error">{list.error}</Alert></div>}

      <div className="overflow-x-auto rounded-xl border border-fg/10">
        <table className="w-full min-w-[760px]">
          <thead className="bg-surface">
            <tr>
              <th className={`${thClass} w-8`}>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPage}
                  onChange={() =>
                    setSelected((s) => (allOnPage ? s.filter((k) => !items.some((m) => m.key === k)) : [...new Set([...s, ...items.map((m) => m.key)])]))
                  }
                />
              </th>
              <th className={thClass}>Model folder</th>
              <th className={thClass}>Kind</th>
              <th className={thClass}>Files</th>
              <th className={thClass}>Size</th>
              <th className={thClass}>Updated</th>
              <th className={thClass}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/10">
            {items.length === 0 ? (
              <EmptyRow cols={7} loading={list.loading} />
            ) : (
              items.map((m) => (
                <tr key={m.key} className="hover:bg-raised/40">
                  <td className={tdClass}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${m.key}`}
                      checked={selected.includes(m.key)}
                      onChange={() => setSelected((s) => (s.includes(m.key) ? s.filter((x) => x !== m.key) : [...s, m.key]))}
                    />
                  </td>
                  <td className={tdClass}>
                    <p className="break-all font-mono text-xs">{m.key}</p>
                    {m.orphaned && (
                      <span className="mt-1 inline-block">
                        <Badge tone="amber">project deleted</Badge>
                      </span>
                    )}
                  </td>
                  <td className={tdClass}>
                    <Badge tone="purple">{m.kind}</Badge>
                  </td>
                  <td className={`${tdClass} tabular-nums`}>{m.files}</td>
                  <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{formatBytes(m.bytes)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-fg/70`}>{formatDate(m.updated_at)}</td>
                  <td className={`${tdClass} text-right`}>
                    <Button variant="ghost" className="text-red-600" onClick={() => setPending([m.key])}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {list.data && <Pagination total={list.data.total} limit={list.data.limit} offset={list.offset} onChange={list.setOffset} />}

      <ConfirmDialog
        open={Boolean(pending)}
        title="Delete models?"
        body={
          <p>
            {pending?.length === 1 ? 'This model folder' : `${pending?.length} model folders`} will be removed from the bucket. Projects stay, but
            will need to be trained again.
          </p>
        }
        busy={busy}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </Card>
  );
}
