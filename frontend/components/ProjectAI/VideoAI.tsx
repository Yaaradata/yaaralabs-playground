'use client';

/**
 * "Use the AI" for custom Live Object Detection: the block editor with video blocks, Teachable
 * Machine style (set video transparency, turn video on, use model [URL], when model detects [label]),
 * and a live webcam stage on the right instead of Aria's chat.
 *
 * The model is loaded from its deployed URL (Export on the project page), the way any app would:
 * {url}/model.json + {url}/metadata.json, then run on every webcam frame in the browser. Any
 * Teachable Machine image model link works too.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BlockStudioShell from '../BlockStudio/BlockStudioShell';
import RuleBasedProcess, { type MlOptions } from '../RuleBasedProcess/RuleBasedProcess';
import { openSavedModel } from '../VideoClassifier/api';
import { disposeModel, loadCombined, loadTf, predict } from '../VideoClassifier/engine';
import { PALETTE } from '../VideoClassifier/types';
import { useCamera } from '../VideoClassifier/useCamera';

interface Props {
  projectName: string;
  sessionId: string;
  projectId: string;
  /** Project page: Back, and where the model is trained. */
  backHref: string;
}

/** The project's deployed model, read from its URL when the page opens. */
interface Deployed {
  trained: boolean;
  url?: string;
  labels: string[];
  trainedAt?: string;
}

/** The model the stage runs (what "use model [URL]" loaded). */
interface Loaded {
  url: string;
  name: string;
  labels: string[];
  colors: string[];
  model: unknown;
}

type VideoState = 'off' | 'on' | 'flipped';
type Status = { kind: 'idle' } | { kind: 'loading'; url: string } | { kind: 'ready' } | { kind: 'error'; message: string };

export default function VideoAI({ projectName, sessionId, projectId, backHref }: Props) {
  const [deployed, setDeployed] = useState<Deployed | null>(null);
  const [video, setVideo] = useState<VideoState>('off');
  const [transparency, setTransparency] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [probs, setProbs] = useState<number[] | null>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // read by the prediction loop and the engine hooks (which the engine keeps from its mount)
  const onPrediction = useRef<((label: string, confidence: number) => void) | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  loadedRef.current = loaded;

  // Only whether the project has a saved model (for the header): the model itself comes from the
  // URL the learner pastes into "use deployed model".
  useEffect(() => {
    let alive = true;
    openSavedModel(sessionId, projectId)
      .then((saved) => alive && setDeployed({ trained: !!saved, labels: [] }))
      .catch(() => alive && setDeployed({ trained: false, labels: [] }));
    return () => {
      alive = false;
    };
  }, [sessionId, projectId]);

  // free the model when leaving
  useEffect(() => () => disposeModel(loadedRef.current?.model), []);

  /** "use model [URL]": load the model files from the URL (cached while the URL stays the same). */
  const connect = useCallback(async (raw: string, report: (label: string, confidence: number) => void) => {
    onPrediction.current = report;
    const url = raw.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/.test(url)) {
      const message = 'Put your model’s URL (Export on the project page) in “use model”.';
      setStatus({ kind: 'error', message });
      throw new Error(message);
    }
    if (loadedRef.current?.url === url) {
      setStatus({ kind: 'ready' });
      return { name: loadedRef.current.name, labels: loadedRef.current.labels };
    }
    setStatus({ kind: 'loading', url });
    try {
      await loadTf();
      const meta = await fetch(`${url}/metadata.json`).then((r) => {
        if (!r.ok) throw new Error(r.status === 409 ? 'This model was deleted. Train it again on the project page.' : 'No model at this URL.');
        return r.json();
      });
      const model = await loadCombined((name) => `${url}/${name}`);
      // our deployed URLs also say the project's name and label colours
      const info = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const labels: string[] = (meta.labels ?? []).map(String);
      const colors: string[] = labels.map((_, i) => info?.colors?.[i] ?? meta.classes?.[i]?.color ?? PALETTE[i % PALETTE.length]);
      const name = String(info?.name || meta.modelName || 'Your model');
      disposeModel(loadedRef.current?.model);
      setLoaded({ url, name, labels, colors, model });
      setProbs(null);
      setStatus({ kind: 'ready' });
      return { name, labels };
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : 'Could not load a model from that URL.';
      setStatus({ kind: 'error', message });
      throw new Error(message);
    }
  }, []);

  const say = useCallback((text: string, secs: number | null) => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble(text || null);
    if (secs != null) bubbleTimer.current = setTimeout(() => setBubble(null), Math.max(0, secs) * 1000);
  }, []);

  const stop = useCallback(() => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    onPrediction.current = null;
    setBubble(null);
    setVideo('off');
    setProbs(null);
    setStatus((s) => (s.kind === 'error' ? s : { kind: 'idle' }));
  }, []);

  const mlOptions: MlOptions | undefined = useMemo(
    () =>
      deployed
        ? {
            kind: 'video',
            trained: deployed.trained,
            labels: [],
            model: { name: projectName, type: 'Teachable Machine image model' },
            // "use deployed model [URL]" + Enter: load the model (no predictions until Run)
            load: (url: string) => connect(url, () => undefined),
            connect,
            video: {
              turn: (state: string) => setVideo(state === 'off' ? 'off' : state === 'on flipped' ? 'flipped' : 'on'),
              transparency: (pct: number) => setTransparency(pct),
            },
            say,
            stop,
          }
        : undefined,
    [deployed, projectName, connect, say, stop],
  );

  const stage = (
    <VideoStage
      video={video}
      transparency={transparency}
      loaded={loaded}
      status={status}
      probs={probs}
      bubble={bubble}
      onProbs={(p) => {
        setProbs(p);
        const l = loadedRef.current;
        if (!l || !onPrediction.current) return;
        let best = 0;
        for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
        onPrediction.current(l.labels[best] ?? '', (p[best] ?? 0) * 100);
      }}
    />
  );

  return (
    <BlockStudioShell
      title={`Use the AI : ${projectName}`}
      subtitle={
        deployed && !deployed.trained ? (
          <span className="opacity-75">
            Train your custom model and let it save, then the ML Model blocks appear.{' '}
            <Link href={backHref} className="underline font-semibold">Go to the project</Link>
          </span>
        ) : null
      }
      backHref={backHref}
      backLabel="Back to project"
    >
      {(toolbarHostRef) =>
        mlOptions && (
          <RuleBasedProcess
            key="ml:video"
            projectName={projectName}
            localStorageKey={`np-lod-ai:${sessionId}:${projectId}`}
            toolbarHostRef={toolbarHostRef}
            ml={mlOptions}
            stage={stage}
          />
        )
      }
    </BlockStudioShell>
  );
}

/* ───────────── the stage: webcam, speech bubble, one bar per label ───────────── */

interface StageProps {
  video: VideoState;
  transparency: number;
  loaded: Loaded | null;
  status: Status;
  probs: number[] | null;
  bubble: string | null;
  onProbs: (p: number[]) => void;
}

function VideoStage({ video, transparency, loaded, status, probs, bubble, onProbs }: StageProps) {
  const { videoRef, error: camError, ready } = useCamera(video !== 'off');
  const onProbsRef = useRef(onProbs);
  onProbsRef.current = onProbs;

  // predict on every frame while the video is on and a model is loaded
  useEffect(() => {
    if (video === 'off' || !ready || !loaded) return;
    let stop = false;
    let raf = 0;
    const loop = async () => {
      if (stop) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2) {
        try {
          // the model was trained on mirrored webcam frames (as the training preview shows them)
          const p = await predict(v, { combined: loaded.model }, true);
          if (!stop) onProbsRef.current(p);
        } catch {
          /* a frame can fail while the model changes */
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, [video, ready, loaded, videoRef]);

  const best = probs && loaded ? probs.indexOf(Math.max(...probs)) : -1;
  const bestPct = best > -1 && probs ? Math.round(probs[best] * 100) : 0;

  return (
    <div className="flex flex-col gap-3 p-1" aria-label="Stage">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-fg/10 bg-white">
        {video !== 'off' && (
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Camera"
            className={`absolute inset-0 h-full w-full object-cover ${video === 'on' ? '-scale-x-100' : ''}`}
            style={{ opacity: 1 - transparency / 100 }}
          />
        )}
        {video === 'off' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-neutral-500">
            <p>
              Press <b className="text-neutral-800">Run</b>: the video turns on and your model watches the camera.
            </p>
          </div>
        )}
        {video !== 'off' && camError && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-neutral-600">{camError}</div>
        )}
        {bubble && (
          <div className="absolute left-3 top-3 max-w-[75%] rounded-2xl rounded-bl-sm border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-900 shadow-md" role="status">
            {bubble}
          </div>
        )}
        {video !== 'off' && loaded && best > -1 && (
          <span
            className="absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-xs font-semibold text-white shadow"
            style={{ background: loaded.colors[best] }}
          >
            {loaded.labels[best]} · {bestPct}%
          </span>
        )}
      </div>

      <div className="text-xs text-fg/70" role="status">
        {status.kind === 'loading' && <span>Loading the model from its URL…</span>}
        {status.kind === 'error' && <span className="text-pink-brand">{status.message}</span>}
        {status.kind !== 'loading' && status.kind !== 'error' && loaded && (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className={`w-2 h-2 rounded-full ${status.kind === 'ready' ? 'bg-[var(--success)]' : 'bg-fg/30'}`} aria-hidden="true" />
            <span className="font-semibold text-fg whitespace-nowrap">{loaded.name}</span>
            <span className="truncate font-mono text-[11px]" title={loaded.url}>{loaded.url}</span>
          </span>
        )}
        {status.kind === 'idle' && !loaded && <span>Your model loads when the &ldquo;use model&rdquo; block runs.</span>}
      </div>

      {loaded && (
        <ul className="space-y-1.5" aria-label="Output">
          {loaded.labels.map((label, i) => {
            const pct = probs && video !== 'off' ? Math.round((probs[i] ?? 0) * 100) : 0;
            return (
              <li key={label} className="flex items-center gap-2 text-sm">
                <span className="w-24 truncate text-fg/85" title={label}>{label}</span>
                <span className="relative h-6 flex-1 overflow-hidden rounded-md" style={{ background: `${loaded.colors[i]}22` }}>
                  <span className="absolute inset-y-0 left-0 transition-[width] duration-150" style={{ width: `${pct}%`, background: loaded.colors[i] }} />
                  <span className={`absolute inset-y-0 flex items-center text-xs font-semibold tabular-nums ${pct > 18 ? 'left-2 text-white' : 'right-2 text-fg/80'}`}>{pct}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
