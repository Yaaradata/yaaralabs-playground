'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import DangerZone from '../../../components/Admin/DangerZone';
import ModelsPanel from '../../../components/Admin/ModelsPanel';
import Overview from '../../../components/Admin/Overview';
import ProjectsPanel from '../../../components/Admin/ProjectsPanel';
import SessionsPanel from '../../../components/Admin/SessionsPanel';
import { Alert, Badge, Button, Card, tdClass, thClass } from '../../../components/Admin/ui';
import { errorText, goToLoginOn401 } from '../../../components/Admin/useAdminList';
import Logo from '../../../components/Header/Logo';
import ThemeToggle from '../../../components/Header/ThemeToggle';
import { adminApi, clearSession, formatDate, getStoredAdmin, getToken, type AdminProfile, type AdminStats, type AuditRow } from '../../../lib/admin-api';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'models', label: 'Models' },
  { id: 'admins', label: 'Admins' },
  { id: 'danger', label: 'Danger zone' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [admins, setAdmins] = useState<AdminProfile[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [projectSession, setProjectSession] = useState('');
  const [panelKey, setPanelKey] = useState(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const [s, a, list] = await Promise.all([adminApi.stats(), adminApi.audit(), adminApi.admins()]);
      setStats(s);
      setAudit(a.items);
      setAdmins(list.items);
    } catch (err) {
      if (!goToLoginOn401(err)) setError(errorText(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/admin/login');
      return;
    }
    setAdmin(getStoredAdmin());
    const fromHash = () => {
      const t = window.location.hash.slice(1) as Tab;
      if (TABS.some((x) => x.id === t)) setTab(t);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    adminApi
      .me()
      .then(setAdmin)
      .catch((err) => goToLoginOn401(err));
    refresh();
    return () => window.removeEventListener('hashchange', fromHash);
  }, [router, refresh]);

  function open(next: Tab) {
    setTab(next);
    history.replaceState(null, '', `#${next}`);
  }

  function logout() {
    clearSession();
    router.replace('/admin/login');
  }

  if (!admin) return <div className="min-h-screen bg-canvas" />;

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-20 border-b border-fg/10 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[var(--page-max)] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="YaaraLabs Playground home">
              <Logo size="sm" />
            </Link>
            <Badge tone="purple">Admin</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-right text-xs leading-tight text-fg/60 sm:block">
              <span className="block font-medium text-fg">{admin.name}</span>
              {admin.email}
            </span>
            <ThemeToggle />
            <Button onClick={logout}>Log out</Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[var(--page-max)] gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Admin sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (t.id === 'projects') setProjectSession('');
                open(t.id);
              }}
              aria-current={tab === t.id ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                tab === t.id ? 'border-pink-brand text-fg' : 'border-transparent text-fg/60 hover:text-fg'
              } ${t.id === 'danger' ? 'text-red-600' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-[var(--page-max)] space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{TABS.find((t) => t.id === tab)?.label}</h1>
            <p className="text-sm text-fg/60">YaaraLabs Playground admin console</p>
          </div>
          <Button
            onClick={() => {
              refresh();
              setPanelKey((k) => k + 1);
            }}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}

        {tab === 'overview' && <Overview stats={stats} audit={audit} onOpen={(t) => open(t as Tab)} />}
        {tab === 'projects' && <ProjectsPanel key={`p${panelKey}${projectSession}`} sessionFilter={projectSession} onChanged={refresh} />}
        {tab === 'sessions' && (
          <SessionsPanel
            key={`s${panelKey}`}
            onChanged={refresh}
            onShowProjects={(sid) => {
              setProjectSession(sid);
              open('projects');
            }}
          />
        )}
        {tab === 'models' && <ModelsPanel key={`m${panelKey}`} onChanged={refresh} />}
        {tab === 'admins' && (
          <Card title={`Admin accounts (${admins.length})`}>
            <p className="mb-4 text-sm text-fg/60">
              New admins sign up at <span className="font-mono">/admin/signup</span> with the signup code from the server&apos;s{' '}
              <span className="font-mono">ADMIN_SIGNUP_CODE</span>.
            </p>
            <div className="overflow-x-auto rounded-xl border border-fg/10">
              <table className="w-full min-w-[560px]">
                <thead className="bg-surface">
                  <tr>
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Email</th>
                    <th className={thClass}>Created</th>
                    <th className={thClass}>Last login</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-fg/10">
                  {admins.map((a) => (
                    <tr key={a.email}>
                      <td className={tdClass}>
                        {a.name} {a.email === admin.email && <Badge tone="green">you</Badge>}
                      </td>
                      <td className={`${tdClass} text-fg/70`}>{a.email}</td>
                      <td className={`${tdClass} text-fg/70`}>{formatDate(a.created_at)}</td>
                      <td className={`${tdClass} text-fg/70`}>{formatDate(a.last_login_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {tab === 'danger' && <DangerZone stats={stats} onChanged={refresh} />}
      </main>
    </div>
  );
}
