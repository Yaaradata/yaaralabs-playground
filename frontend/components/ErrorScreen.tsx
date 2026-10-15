'use client';

/**
 * Shown by Next's error boundaries (app/error.tsx, app/projects/[userid]/[projectid]/error.tsx)
 * instead of the white "Application error" screen. Work is saved on the server as the learner goes,
 * so reloading is safe.
 */

import { useEffect } from 'react';

export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset?: () => void }) {
  useEffect(() => {
    console.error('Screen error:', error);
  }, [error]);

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 bg-canvas text-fg" role="alert">
      <div className="max-w-md w-full rounded-2xl border border-magenta-brand/25 bg-card p-6 text-center">
        <h1 className="text-2xl font-bold">Something went wrong on this screen.</h1>
        <p className="mt-2 text-fg/70">Your work is saved.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => (reset ? reset() : window.location.reload())}
            className="rounded-xl bg-purple-brand px-5 py-2.5 font-semibold text-white hover:bg-purple-brand/90"
          >
            Reload
          </button>
          {/* a full page load: after an error, start the next screen fresh */}
          <button
            type="button"
            onClick={() => window.location.assign('/projects')}
            className="rounded-xl border border-magenta-brand/30 px-5 py-2.5 font-semibold hover:bg-purple-brand/10"
          >
            Back to projects
          </button>
        </div>
        {error?.digest && <p className="mt-4 text-sm text-fg/50">Reference: {error.digest}</p>}
      </div>
    </main>
  );
}
