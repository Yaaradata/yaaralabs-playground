'use client';

import { useState } from 'react';
import { adminApi, CONFIRM, dayBound, formatDate } from '../../lib/admin-api';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyRow, Pagination, Select, TextInput, tdClass, thClass } from './ui';
import { errorText, goToLoginOn401, useAdminList } from './useAdminList';

const EMPTY = { search: '', status: 'active', from: '', to: '', sort: 'newest' };
const TONE = { active: 'green', expired: 'amber', inactive: 'neutral' } as const;

type Pending = { kind: 'selected'; ids: string[] } | { kind: 'expired' } | { kind: 'all' };

export default function SessionsPanel({ onChanged, onShowProjects }: { onChanged: () => void; onShowProjects: (sessionId: string) => void }) {
  const [f, setF] = useState(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [withProjects, setWithProjects] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const list = useAdminList(adminApi.sessions, {
    search: f.search,
    status: f.status,
    date_from: dayBound(f.from),
    date_to: dayBound(f.to, true),
    sort: f.sort,
  });
  const items = list.data?.items ?? [];
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((v) => ({ ...v, [key]: e.target.value }));
  const filtered = Object.entries(f).some(([k, v]) => v !== EMPTY[k as keyof typeof EMPTY]);
  const allOnPage = items.length > 0 && items.every((s) => selected.includes(s.session_id));

  function ask(p: Pending) {
    setWithProjects(true);
    setPending(p);
  }

  async function confirm(typed: string) {
    if (!pending) return;
    setBusy(true);
    try {
      const r =
        pending.kind === 'all'
          ? await adminApi.clearSessions({ confirm: typed, include_projects: withProjects })
          : pending.kind === 'expired'
            ? await adminApi.clearSessions({ expired_only: true, include_projects: withProjects })
            : await adminApi.clearSessions({ session_ids: pending.ids, include_projects: withProjects });
      setNotice({ tone: 'success', text: `Cleared ${r.deleted_sessions} session(s), ${r.deleted_projects} project(s) and ${r.deleted_files} file(s).` });
      if (pending.kind === 'all') setSelected([]);
      if (pending.kind === 'selected') setSelected((s) => s.filter((id) => !pending.ids.includes(id)));
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
      title={`Guest sessions${list.data ? ` (${list.data.total})` : ''}`}
      actions={
        <>
          {filtered && (
            <Button variant="ghost" onClick={() => setF(EMPTY)}>
              Reset filters
            </Button>
          )}
          <Button onClick={() => ask({ kind: 'expired' })}>Clear expired</Button>
          <Button variant="danger" disabled={!selected.length} onClick={() => ask({ kind: 'selected', ids: selected })}>
            Clear selected ({selected.length})
          </Button>
          <Button variant="danger" onClick={() => ask({ kind: 'all' })}>
            Delete all
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <TextInput label="Search" placeholder="Session id, IP or browser" value={f.search} onChange={set('search')} />
        </div>
        <Select label="Status" value={f.status} onChange={set('status')}>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </Select>
        <TextInput label="Started from" type="date" value={f.from} onChange={set('from')} />
        <TextInput label="Started to" type="date" value={f.to} onChange={set('to')} />
        <Select label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Session id A–Z</option>
        </Select>
      </div>

      {notice && <div className="mb-3"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      {list.error && <div className="mb-3"><Alert tone="error">{list.error}</Alert></div>}

      <div className="overflow-x-auto rounded-xl border border-fg/10">
        <table className="w-full min-w-[820px]">
          <thead className="bg-surface">
            <tr>
              <th className={`${thClass} w-8`}>
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPage}
                  onChange={() =>
                    setSelected((s) =>
                      allOnPage ? s.filter((id) => !items.some((x) => x.session_id === id)) : [...new Set([...s, ...items.map((x) => x.session_id)])],
                    )
                  }
                />
              </th>
              <th className={thClass}>Session</th>
              <th className={thClass}>Status</th>
              <th className={thClass}>Projects</th>
              <th className={thClass}>Started</th>
              <th className={thClass}>Last active</th>
              <th className={thClass}>Expires</th>
              <th className={thClass}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fg/10">
            {items.length === 0 ? (
              <EmptyRow cols={8} loading={list.loading} />
            ) : (
              items.map((s) => (
                <tr key={s.session_id} className="hover:bg-raised/40">
                  <td className={tdClass}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.session_id}`}
                      checked={selected.includes(s.session_id)}
                      onChange={() => setSelected((v) => (v.includes(s.session_id) ? v.filter((x) => x !== s.session_id) : [...v, s.session_id]))}
                    />
                  </td>
                  <td className={tdClass}>
                    <p className="font-mono text-xs">{s.session_id}</p>
                    <p className="max-w-[16rem] truncate text-xs text-fg/50" title={s.user_agent}>
                      {s.ip_address || 'no IP'} · {s.user_agent || 'unknown browser'}
                    </p>
                  </td>
                  <td className={tdClass}>
                    <Badge tone={TONE[s.status]}>{s.status}</Badge>
                  </td>
                  <td className={tdClass}>
                    {s.project_count ? (
                      <button type="button" className="text-pink-brand hover:underline" onClick={() => onShowProjects(s.session_id)}>
                        {s.project_count} project{s.project_count === 1 ? '' : 's'}
                      </button>
                    ) : (
                      <span className="text-fg/40">0</span>
                    )}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-fg/70`}>{formatDate(s.created_at)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-fg/70`}>{formatDate(s.last_active)}</td>
                  <td className={`${tdClass} whitespace-nowrap text-fg/70`}>{formatDate(s.expires_at)}</td>
                  <td className={`${tdClass} text-right`}>
                    <Button variant="ghost" className="text-red-600" onClick={() => ask({ kind: 'selected', ids: [s.session_id] })}>
                      Clear
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
        title={pending?.kind === 'all' ? 'Delete all sessions?' : pending?.kind === 'expired' ? 'Clear expired sessions?' : 'Clear sessions?'}
        phrase={pending?.kind === 'all' ? CONFIRM.allSessions : undefined}
        confirmLabel={pending?.kind === 'all' ? 'Delete all sessions' : 'Clear'}
        body={
          <p>
            {pending?.kind === 'all'
              ? withProjects
                ? 'Every guest session is deleted, active ones included, together with every guest project (also those whose session is already gone) and all their files and saved models. Teacher and demo projects stay. This can take a minute or two.'
                : 'Every guest session is deleted, active ones included. Everyone using the playground starts a fresh session; their projects and models stay in the database.'
              : pending?.kind === 'selected'
              ? `${pending.ids.length === 1 ? 'This session is' : `${pending.ids.length} sessions are`} removed. Anyone still using one gets a fresh session on their next visit.`
              : 'Every expired or inactive guest session is removed. Active sessions stay.'}
          </p>
        }
        busy={busy}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withProjects} onChange={(e) => setWithProjects(e.target.checked)} />
          Also delete their projects and models
        </label>
      </ConfirmDialog>
    </Card>
  );
}
