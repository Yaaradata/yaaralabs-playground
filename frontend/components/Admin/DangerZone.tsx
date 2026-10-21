'use client';

import { useState } from 'react';
import { adminApi, CONFIRM, type AdminStats } from '../../lib/admin-api';
import { Alert, Button, Card, ConfirmDialog } from './ui';
import { errorText, goToLoginOn401 } from './useAdminList';

type Action = 'projects' | 'sessions' | 'models' | 'everything';

const ACTIONS: Record<Action, { title: string; button: string; phrase: string; text: (s: AdminStats | null) => string }> = {
  projects: {
    title: 'Delete all projects',
    button: 'Delete all projects',
    phrase: CONFIRM.allProjects,
    text: (s) =>
      `Deletes every project (${s?.projects.total ?? '?'}) with its datasets, images, trained models and companion data. Guest sessions stay, but they will be empty.`,
  },
  sessions: {
    title: 'Clear all sessions',
    button: 'Clear all sessions',
    phrase: CONFIRM.allSessions,
    text: (s) =>
      `Removes every guest session (${s?.sessions.total ?? '?'}, ${s?.sessions.active ?? '?'} active). Everyone using the playground starts over. With projects ticked, every guest project and its files and models go too.`,
  },
  models: {
    title: 'Delete all models',
    button: 'Delete all models',
    phrase: CONFIRM.allModels,
    text: (s) => `Removes every trained model in the bucket (${s?.models.total ?? '?'}). Projects stay, but must be trained again.`,
  },
  everything: {
    title: 'Clear everything',
    button: 'Clear everything',
    phrase: CONFIRM.everything,
    text: () =>
      'Deletes all projects, all guest sessions and every project file and model in the bucket. Admin accounts, teachers, students and demo projects are kept.',
  },
};

export default function DangerZone({ stats, onChanged }: { stats: AdminStats | null; onChanged: () => void }) {
  const [open, setOpen] = useState<Action | null>(null);
  const [withProjects, setWithProjects] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function run(phrase: string) {
    if (!open) return;
    setBusy(true);
    setNotice(null);
    try {
      const r =
        open === 'projects'
          ? await adminApi.deleteAllProjects(phrase)
          : open === 'sessions'
            ? await adminApi.clearSessions({ confirm: phrase, include_projects: withProjects })
            : open === 'models'
              ? await adminApi.deleteAllModels(phrase)
              : await adminApi.clearEverything(phrase);
      const parts = [
        ['deleted_projects', 'projects'],
        ['deleted_sessions', 'sessions'],
        ['deleted_files', 'files'],
      ]
        .filter(([k]) => typeof r[k] === 'number')
        .map(([k, label]) => `${r[k]} ${label}`);
      setNotice({ tone: 'success', text: `Done. Removed ${parts.join(', ') || 'nothing'}.` });
      onChanged();
    } catch (err) {
      if (!goToLoginOn401(err)) setNotice({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
      setOpen(null);
    }
  }

  const action = open ? ACTIONS[open] : null;
  return (
    <Card title={<span className="text-red-600">Danger zone</span>} className="border-red-500/40">
      <p className="mb-4 text-sm text-fg/70">
        These actions change the live database and storage bucket and can&apos;t be undone. Each one asks you to type a phrase first and is
        written to the admin activity log.
      </p>
      {notice && <div className="mb-4"><Alert tone={notice.tone}>{notice.text}</Alert></div>}
      <ul className="divide-y divide-fg/10 rounded-xl border border-red-500/30">
        {(Object.keys(ACTIONS) as Action[]).map((key) => (
          <li key={key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{ACTIONS[key].title}</p>
              <p className="mt-0.5 text-sm text-fg/60">{ACTIONS[key].text(stats)}</p>
            </div>
            <Button
              variant="danger"
              className="shrink-0"
              onClick={() => {
                setWithProjects(true);
                setOpen(key);
              }}
            >
              {ACTIONS[key].button}
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(action)}
        title={`${action?.title ?? ''}?`}
        body={<p>{action?.text(stats)}</p>}
        phrase={action?.phrase}
        confirmLabel={action?.button}
        busy={busy}
        onConfirm={run}
        onClose={() => setOpen(null)}
      >
        {open === 'sessions' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={withProjects} onChange={(e) => setWithProjects(e.target.checked)} />
            Also delete their projects and models
          </label>
        )}
      </ConfirmDialog>
    </Card>
  );
}
