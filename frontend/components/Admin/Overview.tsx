'use client';

import { formatBytes, formatDate, type AdminStats, type AuditRow } from '../../lib/admin-api';
import { Badge, Card } from './ui';

function Stat({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-fg/10 bg-card p-4 text-left transition hover:border-pink-brand/50 sm:p-5"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-fg/55">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-fg/55">{sub}</p>}
    </button>
  );
}

function Breakdown({ data, total }: { data: Record<string, number>; total: number }) {
  const rows = Object.entries(data);
  if (!rows.length) return <p className="text-sm text-fg/50">No projects yet.</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map(([name, n]) => (
        <li key={name}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate">{name}</span>
            <span className="tabular-nums text-fg/70">{n}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fg/10">
            <div className="brand-gradient h-full rounded-full" style={{ width: `${Math.max(2, (n / Math.max(total, 1)) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const ACTIONS: Record<string, string> = {
  delete_project: 'Deleted a project',
  delete_projects: 'Deleted selected projects',
  delete_all_projects: 'Deleted all projects',
  delete_session: 'Cleared a session',
  clear_sessions: 'Cleared sessions',
  delete_models: 'Deleted models',
  delete_all_models: 'Deleted all models',
  clear_everything: 'Cleared everything',
};

function summary(d: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (key: string, label: string) => {
    if (typeof d[key] === 'number') parts.push(`${d[key]} ${label}`);
  };
  add('deleted_projects', 'projects');
  add('deleted_sessions', 'sessions');
  add('deleted_models', 'models');
  add('deleted_files', 'files');
  return parts.join(' · ');
}

export default function Overview({ stats, audit, onOpen }: { stats: AdminStats | null; audit: AuditRow[]; onOpen: (tab: string) => void }) {
  if (!stats) return <p className="py-10 text-center text-sm text-fg/50">Loading numbers…</p>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Projects" value={stats.projects.total} sub={`${stats.projects.guest} guest · ${stats.projects.last_24h} new in 24 h`} onClick={() => onOpen('projects')} />
        <Stat label="Active sessions" value={stats.sessions.active} sub={`${stats.sessions.total} total · ${stats.sessions.expired} expired`} onClick={() => onOpen('sessions')} />
        <Stat label="Models in bucket" value={stats.models.total} sub={`${stats.models.files} files · ${formatBytes(stats.models.bytes)}`} onClick={() => onOpen('models')} />
        <Stat label="Admins" value={stats.admins} sub={`Updated ${formatDate(stats.generated_at)}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Projects by type">
          <Breakdown data={stats.projects.by_type} total={stats.projects.total} />
        </Card>
        <Card title="Projects by status">
          <Breakdown data={stats.projects.by_status} total={stats.projects.total} />
        </Card>
        <Card title="Sessions and models">
          <dl className="grid grid-cols-2 gap-y-3 text-sm">
            <dt className="text-fg/60">Active sessions</dt>
            <dd className="text-right tabular-nums">{stats.sessions.active}</dd>
            <dt className="text-fg/60">Expired sessions</dt>
            <dd className="text-right tabular-nums">{stats.sessions.expired}</dd>
            <dt className="text-fg/60">Inactive sessions</dt>
            <dd className="text-right tabular-nums">{stats.sessions.inactive}</dd>
            <dt className="text-fg/60">New sessions (24 h)</dt>
            <dd className="text-right tabular-nums">{stats.sessions.last_24h}</dd>
            <dt className="text-fg/60">Text models</dt>
            <dd className="text-right tabular-nums">{stats.models.by_kind.text ?? 0}</dd>
            <dt className="text-fg/60">Image models</dt>
            <dd className="text-right tabular-nums">{stats.models.by_kind.image ?? 0}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Recent admin activity">
        {audit.length ? (
          <ul className="divide-y divide-fg/10">
            {audit.slice(0, 10).map((row, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="red">{ACTIONS[row.action] ?? row.action}</Badge>
                  <span className="text-fg/70">{summary(row.details)}</span>
                </span>
                <span className="text-xs text-fg/50">
                  {row.admin} · {formatDate(row.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg/50">No destructive actions yet.</p>
        )}
      </Card>
    </div>
  );
}
