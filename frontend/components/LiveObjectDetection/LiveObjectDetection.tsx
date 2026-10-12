'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import config from '@/lib/config';
import { createDetector, hasCachedDetector, type ObjectDetectorModel } from './detector';
import DetectorSettings from './DetectorSettings';
import {
  DEFAULT_DETECTOR,
  DETECTOR_OPTIONS,
  detectorHeadline,
  detectorTitle,
  isDetectorKind,
  type DetectorKind,
} from './engines/kinds';
import { suppressOverlaps } from './engines/runtime';
import { buildActionCaption, sampleObjectColor, summarizeCaptureObjects } from './captions';
import { averageConfidence } from './detectionQuality';
import { exportLodSession } from './exportSession';
import { computeFrameSignature, framesDiffer } from './frameChange';
import { CloseIcon, CompressIcon, DownloadIcon, ExpandIcon, FlipIcon, PlayIcon, StopIcon } from './icons';
import {
  boxCoverage,
  formatClock,
  formatLabel,
  iou,
  isBodyPartClass,
  ObjectMemory,
} from './tracker';
import type {
  CameraStatus,
  CaptureRecord,
  Detection,
  TimelineEvent,
  TrackedObject,
} from './types';
import {
  attachCameraStream,
  detachCameraStream,
  exitElementFullscreen,
  getFullscreenElement,
  openCameraStream,
  requestElementFullscreen,
  subscribeFullscreen,
} from './compat';
import UndoButton from '../Exercises/UndoButton';
import ExerciseHeaderIcon from '../Exercises/ExerciseHeaderIcon';
import { useUndoHistory } from '../Exercises/useUndoHistory';
import { useAppTheme } from '../../lib/theme';
import '../Exercises/theme-labs.css';
import '../Exercises/exerciseHeader.css';
import './liveObjectDetection.css';

type LiveObjectDetectionProps = {
  projectName?: string;
  sessionId?: string;
  projectId?: string;
  onClose?: () => void;
  /** Inside a project page (not Exercise 4.5): no exercise title bar. */
  embedded?: boolean;
};

type LodUndoSnapshot = {
  detectorKind: DetectorKind;
  mirrored: boolean;
  query: string;
  timeWindow: 'all' | '1m' | '5m';
  actionsOnly: boolean;
  captures: CaptureRecord[];
};

const MIN_SCORE = 0.2;
const CAPTION_EVERY_MS = 10_000;
const FIRST_CAPTION_MS = 3_500;
const MAX_TIMELINE = 80;
const MAX_CAPTURES = 36;
/** Mean grayscale delta above which a frame is considered changed enough to re-infer. */
const INFER_CHANGE_THRESHOLD = 0.028;
/** Slightly looser threshold before writing another capture/report. */
const CAPTURE_CHANGE_THRESHOLD = 0.035;
/** Re-run inference periodically even on static frames so missed objects can recover. */
const FORCE_INFER_MS = 2200;
const CLOTHING_LABELS = new Set([
  'clothing',
  'top',
  'pants',
  'outerwear',
  'jeans',
  'dress',
  'skirt',
  'coat',
  'jacket',
  'shirt',
  'shorts',
]);
const PALETTE = ['#dbfe87', '#9333EA', '#c4b5fd', '#f9a8d4', '#7dd3fc', '#fcd34d'];

function colorForClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function dropNestedDetections(items: Detection[]): Detection[] {
  const people = items.filter((item) => item.class.toLowerCase() === 'person');
  const candidates = items.filter((item) => {
    const name = item.class.toLowerCase();
    if (name === 'person') return true;
    const nested = people.some((person) => boxCoverage(item.bbox, person.bbox) > 0.55);
    if (nested && CLOTHING_LABELS.has(name)) return false;
    return true;
  });
  return suppressOverlaps(candidates, 12, 0.32);
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'AbortError') {
    return 'Camera start was interrupted. Press play again.';
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera access was blocked. Allow the camera in your browser and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is already in use by another app.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'This camera does not support the requested quality. Try again, or use another camera.';
  }
  if (name === 'SecurityError') {
    return 'Camera needs HTTPS (or localhost) in this browser.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Could not start the camera.';
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 16);
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mapBoxToCanvas(
  bbox: [number, number, number, number],
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  mirrored: boolean
) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(canvas.width / vw, canvas.height / vh);
  const drawnW = vw * scale;
  const drawnH = vh * scale;
  const offsetX = (canvas.width - drawnW) / 2;
  const offsetY = (canvas.height - drawnH) / 2;
  const [x, y, width, height] = bbox;
  const mapped = {
    x: offsetX + x * scale,
    y: offsetY + y * scale,
    width: width * scale,
    height: height * scale,
  };
  if (!mirrored) return mapped;
  return { ...mapped, x: canvas.width - mapped.x - mapped.width };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function grabJpeg(video: HTMLVideoElement, maxWidth = 360, quality = 0.5): string {
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    try {
      return canvas.toDataURL('image/jpeg');
    } catch {
      return canvas.toDataURL('image/png');
    }
  }
}

export default function LiveObjectDetection({
  projectName,
  sessionId,
  projectId,
  onClose,
  embedded = false,
}: LiveObjectDetectionProps) {
  const [theme] = useAppTheme();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<ObjectDetectorModel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const loopIdRef = useRef(0);
  const memoryRef = useRef(new ObjectMemory());
  const detectionsRef = useRef<Detection[]>([]);
  const rawDetectionsRef = useRef<Detection[]>([]);
  const eventsRef = useRef<TimelineEvent[]>([]);
  const mirroredRef = useRef(true);
  const captionIntervalRef = useRef<number | null>(null);
  const firstCaptureRef = useRef<number | null>(null);
  const lastCaptureAt = useRef(0);
  const analyzingRef = useRef(false);
  const statsIntervalRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const framesRef = useRef(0);
  const fpsStampRef = useRef(performance.now());
  const fpsRef = useRef(0);
  const lastInferSigRef = useRef<Float32Array | null>(null);
  const lastCaptureSigRef = useRef<Float32Array | null>(null);
  const lastForceInferAt = useRef(0);
  const lastCaptureEmptyRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const captureSeq = useRef(0);
  const lastUiAt = useRef(0);

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [mirrored, setMirrored] = useState(true);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [memoryRows, setMemoryRows] = useState<TrackedObject[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [fps, setFps] = useState(0);
  const [totalTracks, setTotalTracks] = useState(0);
  const [uniqueCount, setUniqueCount] = useState(0);
  const [query, setQuery] = useState('');
  const [timeWindow, setTimeWindow] = useState<'all' | '1m' | '5m'>('all');
  const [actionsOnly, setActionsOnly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cssFullscreenRef = useRef(false);
  const [detectorKind, setDetectorKind] = useState<DetectorKind>(DEFAULT_DETECTOR);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engineLoading, setEngineLoading] = useState(false);
  const detectorKindRef = useRef<DetectorKind>(DEFAULT_DETECTOR);
  const userChoseEngineRef = useRef(false);
  const loadGenRef = useRef(0);
  const queryUndoArmed = useRef(true);
  const skipLodUndoPush = useRef(false);

  const liveLodRef = useRef({
    detectorKind,
    mirrored,
    query,
    timeWindow,
    actionsOnly,
    captures,
  });
  liveLodRef.current = { detectorKind, mirrored, query, timeWindow, actionsOnly, captures };

  const { push: pushLodSnapshot, undo: undoLodSnapshot, canUndo: canLodUndo } =
    useUndoHistory<LodUndoSnapshot>();

  const captureLodUndo = useCallback((): LodUndoSnapshot => {
    const live = liveLodRef.current;
    return {
      detectorKind: live.detectorKind,
      mirrored: live.mirrored,
      query: live.query,
      timeWindow: live.timeWindow,
      actionsOnly: live.actionsOnly,
      captures: live.captures.map((item) => ({ ...item })),
    };
  }, []);

  const pushLodUndo = useCallback(() => {
    if (skipLodUndoPush.current) return;
    pushLodSnapshot(captureLodUndo());
  }, [captureLodUndo, pushLodSnapshot]);

  mirroredRef.current = mirrored;
  detectorKindRef.current = detectorKind;

  const visionEndpoint =
    sessionId && projectId ? `${config.apiBaseUrl}${config.api.lod.detect(sessionId, projectId)}` : '';

  const appendTimeline = useCallback((events: TimelineEvent[]) => {
    if (!events.length) return;
    eventsRef.current = [...eventsRef.current, ...events].slice(-MAX_TIMELINE);
    setTimeline((prev) => [...prev, ...events].slice(-MAX_TIMELINE));
  }, []);

  const loadEngine = useCallback(
    async (kind: DetectorKind) => {
      if (kind === 'vision' && !visionEndpoint) {
        detectorKindRef.current = 'vision';
        setDetectorKind('vision');
        setModelReady(false);
        return;
      }
      const next = kind;
      const previous = detectorKindRef.current;
      const gen = loadGenRef.current + 1;
      loadGenRef.current = gen;
      setError(null);
      setDetectorKind(next);
      const cached = hasCachedDetector(next, visionEndpoint || undefined);
      if (!cached) setEngineLoading(true);
      try {
        const model = await createDetector(next, { visionEndpoint: visionEndpoint || undefined });
        if (gen !== loadGenRef.current) return;
        modelRef.current = model;
        const actual = isDetectorKind(model.kind) ? model.kind : next;
        detectorKindRef.current = next;
        setDetectorKind(next);
        setModelReady(true);
        if (actual !== next) {
          setError(`Using ${detectorHeadline(actual)} on this device.`);
        }
      } catch (err) {
        if (gen !== loadGenRef.current) throw err;
        detectorKindRef.current = previous;
        setDetectorKind(previous);
        throw err;
      } finally {
        if (gen === loadGenRef.current) setEngineLoading(false);
      }
    },
    [visionEndpoint]
  );

  const syncCanvasSize = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(stage.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(stage.clientHeight * dpr));
    canvas.style.width = `${stage.clientWidth}px`;
    canvas.style.height = `${stage.clientHeight}px`;
  }, []);

  const drawDetections = useCallback((items: Detection[]) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    items.forEach((item) => {
      const box = mapBoxToCanvas(item.bbox, video, canvas, mirroredRef.current);
      const color = colorForClass(item.class);
      const label = `${formatLabel(item.class)}  ${Math.round(item.score * 100)}%`;
      const fontSize = Math.max(13, 14 * dpr);
      ctx.setLineDash([7 * dpr, 5 * dpr]);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 2.5 * dpr);
      roundRect(ctx, box.x, box.y, box.width, box.height, 10 * dpr);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
      const padX = 8 * dpr;
      const padY = 5 * dpr;
      const textW = ctx.measureText(label).width;
      const pillW = textW + padX * 2;
      const pillH = fontSize + padY * 2;
      const pillX = Math.min(Math.max(box.x, 6 * dpr), canvas.width - pillW - 6 * dpr);
      const pillY = box.y - pillH - 6 * dpr >= 6 * dpr ? box.y - pillH - 6 * dpr : box.y + 6 * dpr;
      ctx.fillStyle = color;
      roundRect(ctx, pillX, pillY, pillW, pillH, 7 * dpr);
      ctx.fill();
      ctx.fillStyle = '#010101';
      ctx.fillText(label, pillX + padX, pillY + padY + fontSize * 0.82);
    });
  }, []);

  const clearCaptionTimers = useCallback(() => {
    if (captionIntervalRef.current) {
      window.clearInterval(captionIntervalRef.current);
      captionIntervalRef.current = null;
    }
    if (firstCaptureRef.current) {
      window.clearTimeout(firstCaptureRef.current);
      firstCaptureRef.current = null;
    }
  }, []);

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    loopIdRef.current += 1;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    detectionsRef.current = [];
    rawDetectionsRef.current = [];
    lastInferSigRef.current = null;
    lastCaptureSigRef.current = null;
    setDetections([]);
  }, []);

  const stopCamera = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    analyzingRef.current = false;
    clearCaptionTimers();
    stopLoop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    detachCameraStream(video);
    memoryRef.current.resetLivePresence();
    setMemoryRows([...memoryRef.current.tracks]);
  }, [clearCaptionTimers, stopLoop]);

  const analyzeFrame = useCallback(async (saveCapture: boolean) => {
    if (!runningRef.current || analyzingRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    const tracked = memoryRef.current.liveDetections();
    const fallback = rawDetectionsRef.current;
    const current = tracked.length ? tracked : fallback;
    const frameSig = computeFrameSignature(video);
    const unchanged =
      Boolean(lastCaptureSigRef.current) &&
      !framesDiffer(lastCaptureSigRef.current, frameSig, CAPTURE_CHANGE_THRESHOLD);
    // Allow a static re-capture when detections appeared after an empty report,
    // or when we still have nothing (retry until Cloud Vision lands).
    if (
      saveCapture &&
      unchanged &&
      current.length > 0 &&
      !lastCaptureEmptyRef.current
    ) {
      return;
    }

    const imageDataUrl = grabJpeg(video);
    if (!imageDataUrl) return;
    analyzingRef.current = true;
    const now = Date.now();
    const heuristicObjects = current.map((item) => {
      const track = memoryRef.current.tracks.find(
        (candidate) => candidate.present && iou(candidate.bbox, item.bbox) > 0.3
      );
      return {
        className: item.class,
        score: item.score,
        colorName: track?.colorName || sampleObjectColor(video, item.bbox),
        bbox: item.bbox,
      };
    });
    const heuristicCaption = buildActionCaption(
      memoryRef.current.tracks,
      eventsRef.current.slice(-6),
      current
    );
    let recordId: string | null = null;
    let captionEventId: string | null = null;
    const kind = detectorKindRef.current;
    const label = detectorTitle(kind);
    const fpsAtCapture = fpsRef.current;

    if (saveCapture) {
      captureSeq.current += 1;
      recordId = `cap-${captureSeq.current}`;
      captionEventId = `cap-evt-${recordId}`;
      lastCaptureAt.current = now;
      lastCaptureSigRef.current = frameSig;
      lastCaptureEmptyRef.current = heuristicObjects.length === 0;
      const record: CaptureRecord = {
        id: recordId,
        at: now,
        imageDataUrl,
        objects: heuristicObjects,
        caption: heuristicCaption,
        captionSource: 'heuristic',
        avgConfidence: averageConfidence(heuristicObjects),
        detectorKind: kind,
        detectorLabel: label,
        fpsAtCapture,
      };
      setCaptures((prev) => [record, ...prev].slice(0, MAX_CAPTURES));
      const captionEvent: TimelineEvent = {
        id: captionEventId,
        at: now,
        kind: 'caption',
        text: heuristicCaption,
      };
      appendTimeline([captionEvent]);
    }

    if (!sessionId || !projectId) {
      analyzingRef.current = false;
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(
        `${config.apiBaseUrl}${config.api.lod.caption(sessionId, projectId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            image_base64: imageDataUrl,
            detections: heuristicObjects.map((item) => ({
              className: item.className,
              score: item.score,
              colorName: item.colorName,
            })),
            recent_events: eventsRef.current.slice(-6).map((event) => event.text),
          }),
        }
      );
      if (!response.ok || !runningRef.current) return;
      const payload = (await response.json()) as {
        caption?: string;
        objects?: { name?: string; score?: number }[];
      };
      if ((!payload.caption && !payload.objects?.length) || !recordId || !captionEventId) return;
      if (payload.caption || payload.objects?.length) {
        const visionObjects = payload.objects?.length
          ? payload.objects.map((item, index) => ({
              className: item.name || 'object',
              score: item.score ?? 0.7,
              colorName: heuristicObjects[index]?.colorName ?? null,
              bbox: heuristicObjects[index]?.bbox ?? null,
            }))
          : undefined;
        const nextCaption =
          payload.caption ||
          (visionObjects?.length
            ? `${visionObjects[0].className} is in the camera frame.`
            : heuristicCaption);
        const emptyish = /no prominent objects|nothing (is |clearly )?visible|empty scene/i.test(
          nextCaption
        );
        setCaptures((prev) =>
          prev.map((item) => {
            if (item.id !== recordId) return item;
            const nextObjects = visionObjects?.length ? visionObjects : item.objects;
            const keepLocalCaption = emptyish && nextObjects.length > 0;
            lastCaptureEmptyRef.current = nextObjects.length === 0;
            return {
              ...item,
              caption: keepLocalCaption ? item.caption : nextCaption,
              captionSource: keepLocalCaption ? item.captionSource : 'model',
              objects: nextObjects,
              avgConfidence: nextObjects.length
                ? averageConfidence(nextObjects)
                : item.avgConfidence,
            };
          })
        );
        setTimeline((prev) =>
          prev.map((item) => {
            if (item.id !== captionEventId) return item;
            const text =
              heuristicObjects.length && emptyish ? heuristicCaption : nextCaption;
            return { ...item, text };
          })
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Overlay keeps last good vision labels; capture already has a fallback caption.
    } finally {
      analyzingRef.current = false;
    }
  }, [appendTimeline, projectId, sessionId]);

  const startCaptionTimers = useCallback(() => {
    clearCaptionTimers();
    lastCaptureAt.current = 0;
    lastCaptureSigRef.current = null;
    lastCaptureEmptyRef.current = true;
    firstCaptureRef.current = window.setTimeout(() => {
      void analyzeFrame(true);
      captionIntervalRef.current = window.setInterval(() => {
        void analyzeFrame(true);
      }, CAPTION_EVERY_MS);
    }, FIRST_CAPTION_MS);
  }, [analyzeFrame, clearCaptionTimers]);

  const startLoop = useCallback(() => {
    const loopId = loopIdRef.current + 1;
    loopIdRef.current = loopId;
    runningRef.current = true;
    framesRef.current = 0;
    fpsStampRef.current = performance.now();
    lastInferSigRef.current = null;
    lastForceInferAt.current = 0;

    const loop = async () => {
      while (runningRef.current && loopIdRef.current === loopId) {
        const model = modelRef.current;
        const video = videoRef.current;
        if (model && video && video.readyState >= 2) {
          try {
            const started = performance.now();
            const nowPerf = performance.now();
            const frameSig = computeFrameSignature(video);
            const forceRefresh = nowPerf - lastForceInferAt.current >= FORCE_INFER_MS;
            const unchanged =
              lastInferSigRef.current !== null &&
              !framesDiffer(lastInferSigRef.current, frameSig, INFER_CHANGE_THRESHOLD);
            const hasLiveBoxes = detectionsRef.current.length > 0 || rawDetectionsRef.current.length > 0;

            // Never skip while empty — otherwise Cloud Vision's first async hit never lands.
            if (unchanged && !forceRefresh && hasLiveBoxes) {
              drawDetections(detectionsRef.current);
              await waitMs(80);
              continue;
            }

            lastInferSigRef.current = frameSig;
            lastForceInferAt.current = nowPerf;
            const raw = await model.detect(video);
            if (!runningRef.current || loopIdRef.current !== loopId) return;
            const filtered = dropNestedDetections(
              raw.filter((item) => item.score >= MIN_SCORE && !isBodyPartClass(item.class))
            );
            rawDetectionsRef.current = filtered;
            const now = Date.now();
            const colors: Record<string, string | null> = {};
            const newEvents = memoryRef.current.update(
              filtered,
              now,
              { width: video.videoWidth, height: video.videoHeight },
              colors,
              mirroredRef.current
            );
            const labeled = memoryRef.current.liveDetections();
            const display = labeled.length ? labeled : filtered;
            detectionsRef.current = display;
            drawDetections(display);
            if (newEvents.length) {
              appendTimeline(newEvents);
            }
            if (now - lastUiAt.current > 180) {
              setDetections(display);
              setMemoryRows(
                memoryRef.current.tracks.filter(
                  (track) => track.present || now - track.lastSeenAt < 1500
                )
              );
              setTotalTracks(memoryRef.current.totalTracksCreated);
              setUniqueCount(memoryRef.current.uniqueClasses.size);
              lastUiAt.current = now;
            }
            framesRef.current += 1;
            const elapsed = performance.now() - fpsStampRef.current;
            if (elapsed >= 1000) {
              const rate = (framesRef.current * 1000) / elapsed;
              const nextFps = rate < 1 ? Number(rate.toFixed(1)) : Math.round(rate);
              fpsRef.current = nextFps;
              setFps(nextFps);
              framesRef.current = 0;
              fpsStampRef.current = performance.now();
            }
            await waitFrame();
            const minGap = model.kind === 'coco' ? 100 : 16;
            const spent = performance.now() - started;
            if (spent < minGap) await waitMs(minGap - spent);
            continue;
          } catch {
            await waitFrame();
          }
        }
        await waitFrame();
      }
    };

    void loop();
  }, [appendTimeline, drawDetections]);

  const startDetection = useCallback(async () => {
    setError(null);
    setStatus('starting');
    let stream: MediaStream | null = null;
    try {
      if (!sessionId || !projectId) {
        throw new Error('This live session is not ready. Open the project again and press play.');
      }
      const mediaPromise = openCameraStream();
      const enginePromise = loadEngine(detectorKindRef.current);
      const settled = await Promise.allSettled([mediaPromise, enginePromise]);
      if (settled[0].status === 'rejected') throw settled[0].reason;
      stream = settled[0].value;
      streamRef.current = stream;
      if (settled[1].status === 'rejected') throw settled[1].reason;
      const video = videoRef.current;
      if (!video) {
        throw new Error('Camera preview is not ready');
      }
      await attachCameraStream(video, stream);
      syncCanvasSize();
      setStatus('active');
      lastTickRef.current = performance.now();
      startLoop();
      startCaptionTimers();
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      stopCamera();
      setStatus('error');
      setError(cameraErrorMessage(err));
    }
  }, [sessionId, projectId, loadEngine, startCaptionTimers, startLoop, stopCamera, syncCanvasSize]);

  const stopDetection = useCallback(() => {
    stopCamera();
    lastTickRef.current = null;
    setFps(0);
    setStatus((prev) => (prev === 'error' ? 'error' : 'stopped'));
  }, [stopCamera]);

  const handleClose = useCallback(() => {
    cssFullscreenRef.current = false;
    setIsFullscreen(false);
    void exitElementFullscreen();
    stopCamera();
    onClose?.();
  }, [onClose, stopCamera]);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (isFullscreen) {
      cssFullscreenRef.current = false;
      await exitElementFullscreen();
      setIsFullscreen(false);
      window.requestAnimationFrame(() => syncCanvasSize());
      return;
    }
    const native = await requestElementFullscreen(stage);
    await waitFrame();
    if (native || getFullscreenElement() === stage) {
      cssFullscreenRef.current = false;
      setIsFullscreen(true);
    } else {
      cssFullscreenRef.current = true;
      setIsFullscreen(true);
    }
    window.requestAnimationFrame(() => syncCanvasSize());
  }, [isFullscreen, syncCanvasSize]);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      const hosts = document.querySelectorAll('.lod-studio .lod-settings');
      for (let i = 0; i < hosts.length; i += 1) {
        if (hosts[i].contains(target)) return;
      }
      setSettingsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [settingsOpen]);

  const restoreLodUndo = useCallback((snap: LodUndoSnapshot) => {
    setDetectorKind(snap.detectorKind);
    detectorKindRef.current = snap.detectorKind;
    setMirrored(snap.mirrored);
    mirroredRef.current = snap.mirrored;
    setQuery(snap.query);
    setTimeWindow(snap.timeWindow);
    setActionsOnly(snap.actionsOnly);
    setCaptures(snap.captures.map((item) => ({ ...item })));
    queryUndoArmed.current = true;
  }, []);

  const handleLodUndo = useCallback(() => {
    const snap = undoLodSnapshot();
    if (!snap) return;
    skipLodUndoPush.current = true;
    const priorKind = detectorKindRef.current;
    try {
      restoreLodUndo(snap);
      if (snap.detectorKind !== priorKind) {
        void loadEngine(snap.detectorKind).catch((err) => {
          setError(cameraErrorMessage(err));
        });
      }
    } finally {
      skipLodUndoPush.current = false;
    }
  }, [loadEngine, restoreLodUndo, undoLodSnapshot]);

  const handleSelectEngine = useCallback(
    async (kind: DetectorKind) => {
      setSettingsOpen(false);
      if (kind === detectorKindRef.current && modelRef.current) return;
      pushLodUndo();
      userChoseEngineRef.current = true;
      try {
        await loadEngine(kind);
        memoryRef.current.resetLivePresence();
        detectionsRef.current = [];
        rawDetectionsRef.current = [];
        lastInferSigRef.current = null;
        setDetections([]);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      } catch (err) {
        setError(cameraErrorMessage(err));
      }
    },
    [loadEngine, pushLodUndo]
  );

  useEffect(() => {
    if (userChoseEngineRef.current) return;
    detectorKindRef.current = DEFAULT_DETECTOR;
    setDetectorKind(DEFAULT_DETECTOR);
    void loadEngine(DEFAULT_DETECTOR).catch((err) => {
      setError(cameraErrorMessage(err));
    });
  }, [loadEngine]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const observer = new ResizeObserver(() => syncCanvasSize());
    observer.observe(stage);
    syncCanvasSize();
    return () => observer.disconnect();
  }, [syncCanvasSize]);

  useEffect(() => {
    const syncFullscreen = () => {
      const stage = stageRef.current;
      const native = Boolean(stage && getFullscreenElement() === stage);
      if (native) {
        cssFullscreenRef.current = false;
        setIsFullscreen(true);
      } else if (!cssFullscreenRef.current) {
        setIsFullscreen(false);
      }
      window.requestAnimationFrame(() => syncCanvasSize());
    };
    return subscribeFullscreen(syncFullscreen);
  }, [syncCanvasSize]);

  useEffect(() => {
    if (!isFullscreen) {
      document.body.style.removeProperty('overflow');
      document.documentElement.classList.remove('lod-fs-open');
      return undefined;
    }
    document.body.style.overflow = 'hidden';
    document.documentElement.classList.add('lod-fs-open');
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (settingsOpen) return;
      event.preventDefault();
      cssFullscreenRef.current = false;
      void exitElementFullscreen();
      setIsFullscreen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.removeProperty('overflow');
      document.documentElement.classList.remove('lod-fs-open');
      document.removeEventListener('keydown', onKey, true);
    };
  }, [isFullscreen, settingsOpen]);

  useEffect(() => {
    statsIntervalRef.current = window.setInterval(() => {
      if (status !== 'active') {
        lastTickRef.current = null;
        return;
      }
      const now = performance.now();
      const last = lastTickRef.current ?? now;
      elapsedRef.current += now - last;
      lastTickRef.current = now;
      setElapsedMs(elapsedRef.current);
    }, 250);
    return () => {
      if (statsIntervalRef.current) window.clearInterval(statsIntervalRef.current);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportLodSession({
        projectName: projectName || 'Live Object Detection',
        startedAt: captures.at(-1)?.at ?? null,
        elapsedMs,
        fps: fpsRef.current || fps,
        detectorKind: detectorKind,
        detectorLabel: detectorTitle(detectorKind),
        uniqueObjects: Array.from(memoryRef.current.uniqueClasses),
        totalTracks,
        captures,
        timeline,
        memory: memoryRef.current.tracks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const avgConfidence = useMemo(() => {
    if (detections.length) {
      return Math.round(
        (detections.reduce((sum, item) => sum + item.score, 0) / detections.length) * 100
      );
    }
    if (captures[0]) return Math.round(captures[0].avgConfidence * 100);
    return 0;
  }, [captures, detections]);

  const filteredCaptures = useMemo(() => {
    const now = Date.now();
    return captures.filter((capture) => {
      if (query && !`${capture.caption} ${capture.detectorLabel} ${summarizeCaptureObjects(capture)}`.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }
      if (timeWindow === '1m' && now - capture.at > 60_000) return false;
      if (timeWindow === '5m' && now - capture.at > 300_000) return false;
      if (actionsOnly) {
        const actionLike = /hold|pick|place|put|hand|point|mov/i.test(capture.caption);
        if (!actionLike) return false;
      }
      return true;
    });
  }, [actionsOnly, captures, query, timeWindow]);

  const cameraLabel = (() => {
    switch (status) {
      case 'idle':
        return 'Stopped';
      case 'starting':
        return 'Starting';
      case 'active':
        return 'Active';
      case 'stopped':
        return 'Stopped';
      case 'error':
        return 'Error';
      default: {
        const exhaustive: never = status;
        return exhaustive;
      }
    }
  })();

  const renderOverlay = () => {
    switch (status) {
      case 'active':
        return null;
      case 'starting':
        return (
          <div className="lod-overlay">
            <div>
              <div className="lod-spin" />
              <h2>Starting camera</h2>
              <p>Allow camera access to begin detection and captions.</p>
            </div>
          </div>
        );
      case 'error':
        return (
          <div className="lod-overlay">
            <div>
              <h2>Camera unavailable</h2>
              <p>{error}</p>
              <p>Press the play button on the camera to try again.</p>
            </div>
          </div>
        );
      case 'idle':
      case 'stopped':
        return (
          <div className="lod-overlay">
            <div>
              <h2>{status === 'stopped' ? 'Detection stopped' : 'Ready when you are'}</h2>
              <p>
                {modelReady
                  ? `Press play, allow the camera, then ${detectorHeadline(detectorKind)} and captions start. Use HTTPS (or localhost) in Chrome, Edge, Firefox, or Safari.`
                  : engineLoading
                    ? `Loading ${detectorHeadline(detectorKind)}…`
                    : `Press play, or tap ${(DETECTOR_OPTIONS.find((option) => option.id === detectorKind) ?? DETECTOR_OPTIONS[0]).title} to pick another engine.`}
              </p>
            </div>
          </div>
        );
      default: {
        const exhaustive: never = status;
        return exhaustive;
      }
    }
  };

  return (
    <div className="lod-studio" data-theme={theme}>
      {!embedded && (
        <header className="lod-ex-head">
          <div className="ex-lab-brand">
            <ExerciseHeaderIcon id={4.5} />
            <h1 className="ex-lab-brand-title">Exercise - 4.5 : Live Object Detection</h1>
          </div>
        </header>
      )}
      <div className="lod-body">
        <div className="lod-left">
          <section className="lod-card lod-camera-card">
            <div className="lod-camera-label">
              <span>LIVE CAMERA</span>
              <div className="lod-camera-meta">
                <span className="lod-camera-chip lod-camera-chip-time">{formatElapsed(elapsedMs)}</span>
                <span className="lod-camera-chip lod-camera-chip-fps">{fps} FPS</span>
              </div>
            </div>
            <div ref={stageRef} className={`lod-camera-stage${isFullscreen ? ' is-fullscreen' : ''}`}>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                disablePictureInPicture
                disableRemotePlayback
                style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
              />
              <canvas ref={canvasRef} />
              <div className="lod-stage-meta">
                <span className="lod-camera-chip lod-camera-chip-time">{formatElapsed(elapsedMs)}</span>
                <span className="lod-camera-chip lod-camera-chip-fps">{fps} FPS</span>
              </div>
              <div className="lod-stage-tools">
                <UndoButton
                  canUndo={canLodUndo}
                  onUndo={handleLodUndo}
                  className="lod-btn export compact lod-undo-btn"
                />
                <button
                  type="button"
                  className={`lod-btn export icon compact${mirrored ? ' is-active' : ''}`}
                  onClick={() => {
                    pushLodUndo();
                    setMirrored((value) => !value);
                  }}
                  aria-label={mirrored ? 'Unmirror camera' : 'Mirror camera'}
                  aria-pressed={mirrored}
                  title={mirrored ? 'Unmirror' : 'Mirror'}
                >
                  <FlipIcon />
                </button>
                <DetectorSettings
                  compact
                  open={settingsOpen}
                  kind={detectorKind}
                  loading={engineLoading}
                  onToggle={toggleSettings}
                  onSelect={(next) => void handleSelectEngine(next)}
                />
                <button
                  type="button"
                  className="lod-btn export icon compact"
                  onClick={() => void toggleFullscreen()}
                  aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                  title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                >
                  {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
                </button>
                <button
                  type="button"
                  className="lod-btn export icon compact"
                  onClick={() => void handleExport()}
                  disabled={exporting || (!captures.length && !timeline.length)}
                  aria-label={exporting ? 'Exporting session' : 'Export session'}
                  title={exporting ? 'Exporting…' : 'Export'}
                >
                  <DownloadIcon />
                </button>
                <button
                  type="button"
                  className="lod-btn start icon compact"
                  onClick={() => void startDetection()}
                  disabled={status === 'active' || status === 'starting'}
                  aria-label="Start detection"
                  title="Start"
                >
                  <PlayIcon />
                </button>
                <button
                  type="button"
                  className="lod-btn stop icon compact"
                  onClick={stopDetection}
                  disabled={status !== 'active' && status !== 'starting'}
                  aria-label="Stop detection"
                  title="Stop"
                >
                  <StopIcon />
                </button>
                <button
                  type="button"
                  className="lod-btn close icon compact"
                  onClick={handleClose}
                  aria-label="Close"
                  title="Close"
                >
                  <CloseIcon />
                </button>
              </div>
              {status === 'active' ? (
                <div className="lod-rec">
                  <span className="lod-rec-dot" />
                  Rec
                </div>
              ) : (
                <div className="lod-rec stopped">
                  <span className="lod-rec-dot" />
                  {cameraLabel}
                </div>
              )}
              {error && status === 'active' ? (
                <div className="lod-banner" role="status">
                  {error}
                </div>
              ) : null}
              {engineLoading && status === 'active' ? (
                <div className="lod-overlay lod-overlay-soft">
                  <div>
                    <div className="lod-spin" />
                    <h2>Switching engine</h2>
                    <p>Loading {detectorHeadline(detectorKind)}…</p>
                  </div>
                </div>
              ) : (
                renderOverlay()
              )}
            </div>
          </section>
        </div>

        <div className="lod-right">
          <section className="lod-card lod-insights">
            <h2>AI Insights</h2>
            <div className="lod-metrics">
              <div className="lod-metric">
                <b>{uniqueCount}</b>
                <span>Unique objects</span>
              </div>
              <div className="lod-metric">
                <b>{captures.length}</b>
                <span>Captures</span>
              </div>
              <div className="lod-metric">
                <b>{avgConfidence}%</b>
                <span>Avg confidence</span>
              </div>
            </div>
            <div className="lod-stats">
              <div>
                Session <strong>{formatElapsed(elapsedMs)}</strong>
              </div>
              <div>
                FPS <strong>{fps}</strong>
              </div>
              <div>
                Camera{' '}
                <strong
                  className={
                    status === 'active'
                      ? 'lod-status-active'
                      : status === 'error'
                        ? 'lod-status-error'
                        : 'lod-status-stopped'
                  }
                >
                  {cameraLabel}
                </strong>
              </div>
              <div>
                Objects tracked <strong>{totalTracks}</strong>
              </div>
            </div>
            <div className="lod-memory">
              {memoryRows.length === 0 ? (
                <div className="lod-empty">Object memory is empty.</div>
              ) : (
                [...memoryRows]
                  .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
                  .slice(0, 8)
                  .map((track) => (
                    <div key={track.id} className="lod-memory-row">
                      <div>
                        <b>{formatLabel(track.displayName || track.className)}</b>
                        <div>
                          First seen {formatClock(track.firstSeenAt)} ·{' '}
                          {track.present ? 'Still present' : `Last seen ${formatClock(track.lastSeenAt)}`}
                        </div>
                      </div>
                      <span>{Math.round(track.score * 100)}%</span>
                    </div>
                  ))
              )}
            </div>
          </section>

          <section className="lod-card lod-captures">
            <div className="lod-card-head">
              <h2>Captured Data</h2>
            </div>
            <div className="lod-filters">
              <input
                value={query}
                onChange={(event) => {
                  if (queryUndoArmed.current) {
                    pushLodUndo();
                    queryUndoArmed.current = false;
                  }
                  setQuery(event.target.value);
                }}
                onBlur={() => {
                  queryUndoArmed.current = true;
                }}
                placeholder="Filter by object or action"
              />
              <div className="lod-filter-row">
                <select
                  value={timeWindow}
                  onChange={(event) => {
                    pushLodUndo();
                    setTimeWindow(event.target.value as 'all' | '1m' | '5m');
                  }}
                >
                  <option value="all">All time</option>
                  <option value="1m">Last minute</option>
                  <option value="5m">Last 5 minutes</option>
                </select>
                <label className="lod-actions-toggle">
                  <input
                    type="checkbox"
                    checked={actionsOnly}
                    onChange={(event) => {
                      pushLodUndo();
                      setActionsOnly(event.target.checked);
                    }}
                  />
                  Person actions
                </label>
              </div>
            </div>
            <div className="lod-capture-list">
              {filteredCaptures.length === 0 ? (
                <div className="lod-empty">Captures appear every 10 seconds while detection is running.</div>
              ) : (
                filteredCaptures.map((capture) => (
                  <article key={capture.id} className="lod-capture">
                    <img src={capture.imageDataUrl} alt={capture.caption} />
                    <div>
                      <h3>{formatClock(capture.at)}</h3>
                      <p>{capture.caption}</p>
                      <small>
                        {capture.detectorLabel} · {summarizeCaptureObjects(capture)} ·{' '}
                        {Math.round(capture.avgConfidence * 100)}% · {capture.fpsAtCapture} fps
                      </small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
