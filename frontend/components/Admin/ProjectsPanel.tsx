'use client';

import { useState } from 'react';
import { adminApi, dayBound, formatDate } from '../../lib/admin-api';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyRow, Pagination, Select, TextInput, tdClass, thClass } from './ui';
import { errorText, goToLoginOn401, useAdminList } from './useAdminList';

const EMPTY = { search: '', type: '', status: '', owner: '', session_id: '', from: '', to: '', sort: 'newest' };

export default function ProjectsPanel({ onChanged, sessionFilter = '' }: { onChanged: () => void; sessionFilter?: string }) {
  const [f, setF] = useState({ ...EMPTY, session_id: sessionFilter });
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<{ ids: string[]; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const list = useAdminList(adminApi.projects, {
    search: f.search,
    type: f.type,
    status: f.status,
    owner: f.owner,
    session_id: f.session_id,
    date_from: dayBound(f.from),
    date_to: dayBound(f.to, true),
    sort: f.sort,
  });
  const items = list.data?.items ?? [];
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [key]: e.target.value }));
  const filtered = Object.entries(f).some(([k, v]) => v !== EMPTY[k as keyof typeof EMPTY]);
  const allOnPage = items.length > 0 && items.every((p) => selected.includes(p.id));

  async function confirmDelete() {
    if (!pending) return;
    setBusy(true);
    try {
      const r = pending.ids.length === 1 ? await adminApi.deleteProject(pending.ids[0]) : await adminApi.deleteProjects(pending.ids);
      setNotice({ tone: 'success', text: `Deleted ${r.deleted_projects} project(s) and ${r.deleted_files} file(s).` });
      setSelected((s) => s.filter((id) => !pending.ids.includes(id)));
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
      title={`Projects${list.data ? ` (${list.data.total})` : ''}`}
      actions={
        <>
          {filtered && (
            <Button variant="ghost" onClick={() => setF(EMPTY)}>
              Clear filters
            </Button>
          )}
          <Button variant="danger" disabled={!selected.length} onClick={() => setPending({ ids: selected, label: `${selected.length} selected project(s)` })}>
            Delete selected ({selected.length})
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <div className="sm:col-span-2">
          <TextInput label="Search" placeholder="Name, project id or session id" value={f.search} onChange={set('search')} />
        </div>
        <Select label="Type" value={f.type} onChange={set('type')}>
          <option value="">All types</option>
          {list.data?.types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Select label="Status" value={f.status} onChange={set('status')}>
          <option value="">All statuses</option>
          {list.data?.statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Select label="Owner" value={f.owner} onChange={set('owner')}>
          <option value="">Anyone</option>
          <option value="guest">Guest sessions</option>
          <option value="other">Other (teachers, demos)</option>
        </Select>
        <TextInput label="Created from" type="date" value={f.from} onChange={set('from')} />
        <TextInput label="Created to" type="date" value={f.to} onChange={set('to')} />
        <Select label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option>
          <option value="name_desc">Name Z–A</option>
        </Select>
        <div className="sm:col-span-2">
          <TextInput label="Session id" placeholder="session_…" value={f.session_id} onChange={set('session_id')} />
        </div>
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
                    setSelected((s) => (allOnPage ? s.filter((id) => !items.some((p) => p.id === id)) : [...new Set([...s, ...items.map((p) => p.id)])]))
                  }
                />
              </th>
              <th className={thClass}>Project</th>
              <th className={thClass}>Type</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Session</th>
              <th className={thClass}>Created</th>
              <th className={thClass}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/10">
            {items.length === 0 ? (
              <EmptyRow cols={7} loading={list.loading} />
            ) : (
              items.map((p) => (
                <tr key={p.id} className="hover:bg-raised/40">
                  <td className={tdClass}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.name || p.id}`}
                      checked={selected.includes(p.id)}
                      onChange={() => setSelected((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                    />
                  </td>
                  <td className={tdClass}>
                    <p className="font-medium">{p.name || 'Untitled'}</p>
                    <p className="font-mono text-xs text-fg/50">{p.id}</p>
                  </td>
                  <td className={tdClass}>
                    <Badge tone="purple">{p.type}</Badge>
                  </td>
                  <td className={tdClass}>
                    <Badge tone={p.status === 'trained' ? 'green' : p.status === 'failed' ? 'red' : 'neutral'}>{p.status}</Badge>
                  </td>
                  <td className={`${tdClass} font-mono text-xs text-fg/70`}>{p.session_id || <span className="text-fg/40">{p.created_by || '—'}</span>}</td>
                  <td className={`${tdClass} whitespace-nowrap text-fg/70`}>{formatDate(p.created_at)}</td>
                  <td className={`${tdClass} text-right`}>
                    <Button variant="ghost" className="text-red-600" onClick={() => setPending({ ids: [p.id], label: `"${p.name || p.id}"` })}>
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
        title="Delete projects?"
        body={
          <p>
            This permanently deletes {pending?.label}, with their datasets, trained models and companion data (RAG chunks, agent runs,
            workspaces). It can&apos;t be undone.
          </p>
        }
        busy={busy}
        onConfirm={confirmDelete}
        onClose={() => setPending(null)}
      />
    </Card>
  );
}
