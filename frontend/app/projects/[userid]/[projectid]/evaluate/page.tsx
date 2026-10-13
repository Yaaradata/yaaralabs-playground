'use client';

/**
 * "4. Evaluate" for Text Recognition projects: an exam on messages the bot has never seen, explained
 * with accuracy, precision and recall only. Opens from "Move to next - Evaluate" on Use the AI.
 * Session / project checks follow make/page.tsx.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Header from '../../../../../components/Header';
import ProjectEvaluate from '../../../../../components/ProjectEvaluate/ProjectEvaluate';
import config from '../../../../../lib/config';
import {
  getOrCreateMaskedId,
  getProjectIdFromMaskedId,
  getSessionIdFromMaskedId,
  isMaskedId,
  isMaskedProjectId,
  isProjectId,
  isSessionId,
} from '../../../../../lib/session-utils';
import { cleanupSessionWithReason, SessionCleanupReason } from '../../../../../lib/session-cleanup';

interface Project {
  id: string;
  name: string;
  type: string;
}

export default function EvaluatePage() {
  const params = useParams();
  const urlUserId = params?.userid as string;
  const urlProjectId = params?.projectid as string;
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [project, setProject] = useState<Project | null>(null);
  const [ids, setIds] = useState({ sessionId: '', projectId: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!urlUserId || !urlProjectId) return setState('invalid');

      // Session: masked id in the URL, matching this browser's session
      let sessionId: string;
      if (isMaskedId(urlUserId)) {
        const real = getSessionIdFromMaskedId(urlUserId);
        if (!real) return void (window.location.href = '/projects');
        sessionId = real;
      } else if (isSessionId(urlUserId)) {
        return void (window.location.href = `/projects/${getOrCreateMaskedId(urlUserId)}/${urlProjectId}/evaluate`);
      } else {
        return void (window.location.href = '/projects');
      }

      let projectId: string;
      if (isMaskedProjectId(urlProjectId)) {
        const real = getProjectIdFromMaskedId(urlProjectId);
        if (!real) return void (window.location.href = `/projects/${urlUserId}`);
        projectId = real;
      } else if (isProjectId(urlProjectId)) {
        projectId = urlProjectId;
      } else {
        return void (window.location.href = `/projects/${urlUserId}`);
      }

      const stored = localStorage.getItem('yaaralabs_playground_session_id');
      if (!stored) return void (window.location.href = '/projects');
      if (stored !== sessionId) return void (window.location.href = `/projects/${getOrCreateMaskedId(stored)}`);

      try {
        const s = await fetch(`${config.apiBaseUrl}${config.api.guests.sessionById(sessionId)}`);
        if (!s.ok) {
          await cleanupSessionWithReason(SessionCleanupReason.ERROR_FALLBACK);
          return void (window.location.href = '/projects');
        }
        const session = await s.json();
        if (!session?.success || !session.data?.active || new Date() >= new Date(session.data.expiresAt)) {
          await cleanupSessionWithReason(SessionCleanupReason.EXPIRED_BACKEND);
          return void (window.location.href = '/projects');
        }
        const p = await fetch(`${config.apiBaseUrl}/api/guests/session/${sessionId}/projects`);
        const list = p.ok ? await p.json() : null;
        const found: Project | undefined = list?.data?.find((x: Project) => x.id === projectId);
        if (!found) return void (window.location.href = `/projects/${urlUserId}`);
        if (!alive) return;
        setIds({ sessionId, projectId });
        setProject(found);
        setState('ready');
      } catch {
        if (alive) setState('invalid');
      }
    })();
    return () => {
      alive = false;
    };
  }, [urlUserId, urlProjectId]);

  const makeHref = `/projects/${urlUserId}/${urlProjectId}/make`;

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <Header />
      <main className="pt-[88px] pb-12 px-4 sm:px-6 lg:px-8">
        {state === 'loading' && <p className="text-center text-xl text-fg/70 py-24">Loading…</p>}

        {state === 'invalid' && (
          <div className="max-w-xl mx-auto text-center py-16">
            <h1 className="text-3xl font-semibold mb-4">Invalid Session or Project</h1>
            <Link href={`/projects/${urlUserId}`} className="bg-purple-brand text-white px-6 py-3 rounded-lg font-medium inline-block">
              Back to Projects
            </Link>
          </div>
        )}

        {state === 'ready' && project && (
          <>
            {/* Back link and title on one line (same as the training page) */}
            <div className="max-w-7xl mx-auto mb-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <Link
                href={makeHref}
                className="justify-self-start inline-flex items-center gap-2 text-fg/70 hover:text-fg transition-colors whitespace-nowrap text-sm"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Back to Use the AI</span>
              </Link>
              <h1 className="text-2xl md:text-3xl font-bold truncate text-center">
                Evaluate <span className="text-fg/40">:</span> {project.name}
              </h1>
              <span />
            </div>

            {project.type === 'text-recognition' ? (
              <ProjectEvaluate
                sessionId={ids.sessionId}
                projectId={ids.projectId}
                learnHref={`/projects/${urlUserId}/${urlProjectId}/learn`}
              />
            ) : (
              <div className="max-w-7xl mx-auto bg-card border border-magenta-brand/20 rounded-2xl p-8 text-lg">
                <p>Evaluate is available for Text recognition projects.</p>
                <Link href={`/projects/${urlUserId}/${urlProjectId}`} className="inline-block mt-4 text-pink-brand font-semibold underline">
                  Back to the project
                </Link>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
