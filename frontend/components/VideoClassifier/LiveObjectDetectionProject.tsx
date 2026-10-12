'use client';

/**
 * A Live Object Detection project: two ways in.
 *   Custom      teach your own classes, Teachable Machine style (VideoClassifierLab)
 *   Pretrained  a ready-made detector that labels everyday objects live (the Exercise 4.5 view)
 * First visit shows two cards; afterwards the project opens in the last mode, and a dropdown at the
 * top switches between them. The choice is remembered per project in this browser.
 */

import { useEffect, useState } from 'react';
import LiveObjectDetection from '../LiveObjectDetection';
import VideoClassifierLab from './VideoClassifierLab';

type Mode = 'custom' | 'pretrained';

const MODES: { id: Mode; title: string; blurb: string; steps: string[] }[] = [
  {
    id: 'custom',
    title: 'Custom live object detection',
    blurb: 'Teach the computer your own objects with a few photos, then watch it recognise them live.',
    steps: ['Add classes and photos', 'Train in your browser', 'Test live with the webcam'],
  },
  {
    id: 'pretrained',
    title: 'Pretrained object detection',
    blurb: 'Use a ready-made model that already knows everyday objects. Point the camera and watch the labels.',
    steps: ['Pick a model', 'Start the camera', 'See objects labelled live'],
  },
];

interface Props {
  projectName: string;
  sessionId: string | null;
  projectId: string;
}

const storageKey = (projectId: string) => `lodMode:${projectId}`;

function readMode(projectId: string): Mode | null {
  try {
    const v = localStorage.getItem(storageKey(projectId));
    return v === 'custom' || v === 'pretrained' ? v : null;
  } catch {
    return null;
  }
}

function Icon({ mode }: { mode: Mode }) {
  return mode === 'custom' ? (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 6h7v7H4zM13 6h7v4h-7zM13 12h7v6h-7zM4 15h7v3H4z" />
    </svg>
  ) : (
    <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
      <rect x="7.5" y="8" width="9" height="8" rx="1.5" strokeWidth={1.7} />
    </svg>
  );
}

export default function LiveObjectDetectionProject({ projectName, sessionId, projectId }: Props) {
  const [mode, setModeState] = useState<Mode | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setModeState(readMode(projectId));
    setReady(true);
  }, [projectId]);

  const setMode = (m: Mode | null) => {
    setModeState(m);
    try {
      if (m) localStorage.setItem(storageKey(projectId), m);
      else localStorage.removeItem(storageKey(projectId));
    } catch {
      /* only a convenience */
    }
  };

  return (
    <div className="h-full flex flex-col bg-canvas text-fg">
      <div className="flex-shrink-0 flex flex-wrap items-center gap-3 px-4 sm:px-6 py-3 border-b border-fg/10">
        <div className="min-w-[12rem] flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-pink-brand">Live Object Detection</p>
          <h1 className="text-lg font-semibold truncate">{projectName}</h1>
        </div>
        {mode && (
          <label className="inline-flex items-center gap-2 text-sm text-fg/75">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
              className="bg-card border border-fg/20 rounded-lg px-3 py-2 text-sm font-medium text-fg focus:outline-none focus:border-pink-brand"
              aria-label="Detection mode"
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {!ready ? null : mode === 'custom' ? (
          <VideoClassifierLab sessionId={sessionId} projectId={projectId} />
        ) : mode === 'pretrained' ? (
          <div className="h-full overflow-auto">
            <LiveObjectDetection embedded projectName={projectName} sessionId={sessionId ?? undefined} projectId={projectId} onClose={() => setMode(null)} />
          </div>
        ) : (
          <div className="h-full overflow-auto px-4 sm:px-6 py-10">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-2xl font-semibold text-center">How do you want to detect objects?</h2>
              <p className="text-fg/65 text-center mt-2">You can switch any time from the menu at the top.</p>
              <div className="grid gap-5 md:grid-cols-2 mt-8">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    className="group text-left rounded-2xl border border-fg/10 bg-card p-6 shadow-sm hover:border-purple-brand hover:shadow-lg transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-pink-brand"
                  >
                    <span className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-purple-brand/10 text-purple-brand">
                      <Icon mode={m.id} />
                    </span>
                    <h3 className="text-lg font-semibold mt-4">{m.title}</h3>
                    <p className="text-sm text-fg/70 mt-1.5">{m.blurb}</p>
                    <ol className="mt-4 space-y-1.5 text-sm text-fg/80">
                      {m.steps.map((s, i) => (
                        <li key={s} className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-purple-brand/15 text-purple-brand text-xs font-semibold grid place-items-center">{i + 1}</span>
                          {s}
                        </li>
                      ))}
                    </ol>
                    <span className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-purple-brand px-4 py-2 text-sm font-semibold text-white group-hover:bg-purple-brand/90">
                      Open
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
