"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import UndoButton from "../../UndoButton";
import { useUndoHistory } from "../../useUndoHistory";
import type { DragEvent } from "react";
import type { Ex2Result } from "../../types";
import { useExerciseSession } from "../../ExerciseContext";
import FullscreenButton from "../../FullscreenButton";
import ThemeToggle from "../../ThemeToggle";
import ExerciseHeaderIcon from "../../ExerciseHeaderIcon";
import {
  readExerciseTheme,
  subscribeExerciseTheme,
  type ExerciseTheme,
} from "../../theme";
import "../../exerciseHeader.css";
import "./exercise4.css";
import type { BoardCard, DatasetMeta, HistItem, LearnTrack, ModelId, ParamMap, RunView, Step, Summary, TrayFilter } from "./lib/types";
import {
  clearVision,
  ingestVision,
  loadVisionState,
  loadVisionRun,
  predictVisionFile,
  predictVisionIndex,
  prepareVision,
  setVisionClassKept,
  setVisionTestShare,
  startVisionTrain,
  stopVisionTrain,
  visionImageUrl,
} from "./lib/api";
import { pct } from "./lib/format";
import { defaultParams, defaults, loadSavedParams, MODELS } from "./lib/models";
import { Icon } from "./components/Icon";
import { UploadStep } from "./components/UploadStep";
import { TrainStep } from "./components/TrainStep";
import { TestStep } from "./components/TestStep";
import { CellModal, InfoModal, ParamsModal, PathModal } from "./components/Modals";

const IMAGE_RE = /\.(png|jpe?g|bmp|gif|webp)$/i;

type Ex4UndoSnapshot = {
  summary: Summary | null;
  track: LearnTrack;
  model: ModelId;
  params: Record<ModelId, ParamMap>;
  frac: number;
  step: Step;
  draft: ParamMap | null;
};

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (file: File) => void, err: (error: DOMException) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, err: (error: DOMException) => void) => void };
}

export interface Exercise4Props {
  sessionId: string;
  projectId: string;
  ex2Result: Ex2Result | null;
  onComplete: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function patchKept(summary: Summary | null, name: string, kept: boolean): Summary | null {
  if (!summary) return summary;
  const classes = summary.classes.map((row) => (row.name === name ? { ...row, kept } : row));
  const keptRows = classes.filter((row) => row.kept);
  const trained = keptRows.filter((row) => row.train > 0);
  const ready = trained.length >= 2 && keptRows.every((row) => row.pool === 0) && trained.every((row) => row.train >= 5 && row.test >= 1);
  return {
    ...summary,
    classes,
    train: keptRows.reduce((sum, row) => sum + row.train, 0),
    test: keptRows.reduce((sum, row) => sum + row.test, 0),
    pool: keptRows.reduce((sum, row) => sum + row.pool, 0),
    ok: ready,
  };
}

function shuffle(items: number[], seed: number): number[] {
  const out = items.slice();
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rand() * (index + 1));
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}

function entryOf(item: DataTransferItem): FsEntry | null {
  const withEntry = item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null };
  if (item.kind !== "file" || !withEntry.webkitGetAsEntry) return null;
  return withEntry.webkitGetAsEntry();
}

function readFile(entry: FsEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("Not a file"));
      return;
    }
    entry.file(resolve, reject);
  });
}

async function readDir(entry: FsEntry): Promise<FsEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: FsEntry[] = [];
  let emptyReads = 0;
  while (emptyReads < 3) {
    const batch = await new Promise<FsEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length) {
      emptyReads = 0;
      all.push(...batch);
      continue;
    }
    if (all.length) return all;
    emptyReads += 1;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  return all;
}

async function walk(entry: FsEntry, out: { path: string; file: File }[]): Promise<void> {
  if (entry.isFile) {
    const file = await readFile(entry);
    const path = entry.fullPath.replace(/^\/+/, "") || file.name;
    if (IMAGE_RE.test(path)) out.push({ path, file });
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readDir(entry);
  for (const child of children) await walk(child, out);
}

async function collectHandle(handle: FileSystemHandle, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  if (handle.kind === "file") {
    const file = await (handle as FileSystemFileHandle).getFile();
    const path = prefix || file.name;
    if (IMAGE_RE.test(path)) out.push({ path, file });
    return;
  }
  if (handle.kind !== "directory") return;
  const entries = (handle as FileSystemDirectoryHandle & { values: () => AsyncIterable<FileSystemHandle> }).values();
  for await (const child of entries) {
    const next = prefix ? `${prefix}/${child.name}` : child.name;
    await collectHandle(child, next, out);
  }
}

function directoryPicker(): ((options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>) | null {
  const opener = (window as Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  return opener ?? null;
}

function asDirectoryHandle(item: DataTransferItem): Promise<FileSystemHandle | null> {
  const withHandle = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };
  if (!withHandle.getAsFileSystemHandle) return Promise.resolve(null);
  return withHandle.getAsFileSystemHandle().catch(() => null);
}

export default function Exercise4({ sessionId, projectId, onComplete }: Exercise4Props) {
  const { setChromeBack } = useExerciseSession();
  const [theme, setTheme] = useState<ExerciseTheme>(() => readExerciseTheme());
  const [step, setStep] = useState<Step>(2);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dataset, setDataset] = useState<DatasetMeta | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [evalRun, setEvalRun] = useState<string | null>(null);
  const [training, setTraining] = useState(false);
  const [reading, setReading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [track, setTrack] = useState<LearnTrack>("ml");
  const [model, setModel] = useState<ModelId>("knn");
  const [params, setParams] = useState<Record<ModelId, ParamMap>>(defaultParams);
  const [draft, setDraft] = useState<ParamMap | null>(null);
  const [frac, setFrac] = useState(0.5);
  const [modal, setModal] = useState<"info" | "params" | "cell" | "path" | null>(null);
  const [cell, setCell] = useState<{ real: number; guess: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; warn: boolean } | null>(null);
  const [filter, setFilter] = useState<TrayFilter>("all");
  const [classFilter, setClassFilter] = useState(-1);
  const [deck, setDeck] = useState<number[]>([]);
  const [tested, setTested] = useState<Record<number, boolean>>({});
  const [current, setCurrent] = useState<BoardCard | null>(null);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  const { push: pushUndo, undo: popUndo, canUndo, clear: clearUndo } = useUndoHistory<Ex4UndoSnapshot>();

  const toastTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const announced = useRef("");
  const finished = useRef(false);
  const ownSeq = useRef(0);
  const keepSeq = useRef(0);
  /** Bumped on Clear / restart so late keep/share/ingest responses cannot restore wiped uploads. */
  const summaryGen = useRef(0);
  const busyRef = useRef(false);
  const cache = useRef(new Map<string, { pred: number; probs: number[]; seen: string }>());
  const showRef = useRef<(text: string, warn?: boolean) => void>(() => undefined);
  const live = useRef({
    load: async (_index: number) => undefined as void,
    step: (_dir: number) => undefined as void,
  });

  const doneRuns = runs.filter((run) => run.done && run.res);
  const activeRun = runs.find((run) => run.id === cur) ?? null;
  const scoredRun = doneRuns.find((run) => run.id === evalRun) ?? doneRuns[doneRuns.length - 1] ?? null;
  const imageSrc = (index: number) => visionImageUrl(sessionId, projectId, index, dataset?.key);

  const show = (text: string, warn = false) => {
    setToast({ text, warn });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  };
  showRef.current = show;

  const captureUndo = useCallback((): Ex4UndoSnapshot => ({
    summary,
    track,
    model,
    params,
    frac,
    step,
    draft,
  }), [summary, track, model, params, frac, step, draft]);

  const applySummary = useCallback((next: Summary | null, gen: number) => {
    if (gen !== summaryGen.current) return;
    setSummary(next);
  }, []);

  const syncSummaryToServer = useCallback(async (target: Summary | null, previous: Summary | null) => {
    if (!target || !previous) return;
    const gen = summaryGen.current;
    const jobs: Promise<void>[] = [];
    for (const row of target.classes) {
      const prior = previous.classes.find((item) => item.name === row.name);
      if (prior && prior.kept !== row.kept) {
        jobs.push(
          setVisionClassKept(sessionId, projectId, row.name, row.kept)
            .then((result) => {
              applySummary(result.summary, gen);
            })
            .catch(() => undefined),
        );
      }
    }
    if (target.test !== previous.test || target.train !== previous.train) {
      const total = target.train + target.test;
      if (total > 0) {
        const testPct = Math.round((target.test / total) * 100);
        jobs.push(
          setVisionTestShare(sessionId, projectId, testPct)
            .then((result) => {
              applySummary(result.summary, gen);
            })
            .catch(() => undefined),
        );
      }
    }
    await Promise.all(jobs);
  }, [applySummary, projectId, sessionId]);

  const applyUndo = useCallback((snap: Ex4UndoSnapshot) => {
    const previous = summary;
    setSummary(snap.summary);
    setTrack(snap.track);
    setModel(snap.model);
    setParams(snap.params);
    localStorage.setItem("ex4-params", JSON.stringify(snap.params));
    setFrac(snap.frac);
    setStep(snap.step);
    setDraft(snap.draft);
    void syncSummaryToServer(snap.summary, previous);
  }, [summary, syncSummaryToServer]);

  const handleUndo = useCallback(() => {
    const snap = popUndo();
    if (snap) applyUndo(snap);
  }, [applyUndo, popUndo]);

  const rememberParams = (next: Record<ModelId, ParamMap>) => {
    localStorage.setItem("ex4-params", JSON.stringify(next));
  };

  const wipeBoard = () => {
    setTested({});
    setHistory([]);
    setCurrent(null);
    setDeck([]);
    setAuto(false);
    cache.current.clear();
  };

  const wipeLab = () => {
    setSummary(null);
    setDataset(null);
    setRuns([]);
    setCur(null);
    setEvalRun(null);
    setTraining(false);
    wipeBoard();
  };

  useEffect(() => {
    const id = "ex4-fonts";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap";
      document.head.appendChild(link);
    }
    setParams(loadSavedParams());
  }, []);

  useEffect(() => {
    setTheme(readExerciseTheme());
    return subscribeExerciseTheme(setTheme);
  }, []);

  useEffect(() => {
    if (step <= 2) {
      setChromeBack(null);
      return () => setChromeBack(null);
    }
    setChromeBack({
      label: "Back",
      run: () => {
        if (training && cur) {
          void stopVisionTrain(sessionId, projectId, cur).catch(() => undefined);
          setTraining(false);
        }
        setModal(null);
        setStep(2);
      },
    });
    return () => setChromeBack(null);
  }, [cur, projectId, sessionId, setChromeBack, step, training]);

  useEffect(() => {
    let cancel = false;
    const gen = summaryGen.current;
    loadVisionState(sessionId, projectId)
      .then((state) => {
        if (cancel || gen !== summaryGen.current) return;
        if (state.summary) applySummary(state.summary, gen);
        if (state.dataset) {
          setDataset(state.dataset);
          setStep(3);
        }
        if (state.runs.length) {
          setRuns(state.runs);
          const last = [...state.runs].reverse().find((item) => item.done);
          if (last) {
            setCur(last.id);
            setEvalRun(last.id);
          }
        }
        if (state.activeRunId) {
          setCur(state.activeRunId);
          setTraining(true);
          setStep(3);
        }
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [applySummary, sessionId, projectId]);

  useEffect(() => {
    if (!dataset) return;
    setDeck(shuffle(dataset.testIdx, 3));
    setTested({});
    setHistory([]);
    setCurrent(null);
    cache.current.clear();
  }, [dataset]);

  useEffect(() => {
    setTested({});
    setHistory([]);
    setCurrent(null);
    cache.current.clear();
  }, [evalRun]);

  useEffect(() => {
    if (!training || !cur) return;
    let cancel = false;
    const poll = async () => {
      try {
        const next = await loadVisionRun(sessionId, projectId, cur);
        if (cancel) return;
        setRuns((prev) => {
          const index = prev.findIndex((item) => item.id === next.id);
          if (index < 0) return [...prev, next];
          const copy = prev.slice();
          copy[index] = next;
          return copy;
        });
        if (next.status === "done" || next.status === "error") {
          setTraining(false);
          const mark = `${next.id}:${next.status}`;
          if (announced.current !== mark) {
            announced.current = mark;
            if (next.status === "done") {
              setEvalRun(next.id);
              showRef.current(
                `Run ${next.no} · ${MODELS[next.model].short}: validation ${pct(next.valAcc)} · test ${pct(next.res?.acc)}`,
              );
            } else {
              showRef.current(next.error || "Training stopped before it could score.", true);
            }
          }
        }
      } catch (error) {
        if (cancel) return;
        setTraining(false);
        showRef.current(message(error), true);
      }
    };
    const id = window.setInterval(() => void poll(), 280);
    void poll();
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, [training, cur, sessionId, projectId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (step !== 5) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        live.current.step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        live.current.step(-1);
      } else if (event.key === " ") {
        event.preventDefault();
        setAuto((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  useEffect(() => {
    if (!auto || step !== 5) return;
    const id = window.setInterval(() => live.current.step(1), 1400);
    return () => window.clearInterval(id);
  }, [auto, step]);

  const forgetModel = () => {
    setDataset(null);
    setRuns([]);
    setCur(null);
    setEvalRun(null);
    wipeBoard();
    setStep((currentStep) => (currentStep > 2 ? 2 : currentStep));
  };

  const sendImages = async (items: { path: string; file: File }[], forced: "train" | "test" | null) => {
    if (!items.length) {
      show("No images found inside class folders.", true);
      return;
    }
    const body = new FormData();
    body.append("paths", JSON.stringify(items.map((item) => item.path)));
    if (forced) body.append("forced", forced);
    items.forEach((item) => body.append("files", item.file, item.file.name));
    const gen = summaryGen.current;
    setReading(true);
    try {
      const result = await ingestVision(sessionId, projectId, body);
      if (gen !== summaryGen.current) return;
      applySummary(result.summary, gen);
      forgetModel();
      const names = result.summary?.classes.map((row) => row.name) ?? [];
      const listed = names.slice(0, 8).join(", ");
      const more = names.length > 8 ? ` and ${names.length - 8} more` : "";
      const classes = names.length ? ` in ${names.length} class${names.length === 1 ? "" : "es"}: ${listed}${more}` : "";
      show(`Read ${result.added} images${classes}${result.skipped ? `, skipped ${result.skipped}` : ""}.`);
    } catch (error) {
      if (gen === summaryGen.current) show(message(error), true);
    } finally {
      if (gen === summaryGen.current) setReading(false);
    }
  };

  const sendZip = async (file: File) => {
    const body = new FormData();
    body.append("zip_file", file, file.name);
    body.append("replace", "1");
    const gen = summaryGen.current;
    setReading(true);
    try {
      const result = await ingestVision(sessionId, projectId, body);
      if (gen !== summaryGen.current) return;
      applySummary(result.summary, gen);
      forgetModel();
      show(`Read ${result.added} images${result.skipped ? `, skipped ${result.skipped}` : ""}.`);
    } catch (error) {
      if (gen === summaryGen.current) show(message(error), true);
    } finally {
      if (gen === summaryGen.current) setReading(false);
    }
  };

  const onFiles = (list: File[], forced: "train" | "test" | null) => {
    const items = list
      .filter((file) => IMAGE_RE.test(file.name) || IMAGE_RE.test(file.webkitRelativePath || ""))
      .map((file) => ({ path: file.webkitRelativePath || file.name, file }));
    void sendImages(items, forced);
  };

  const pickFolder = async (forced: "train" | "test" | null): Promise<boolean> => {
    const opener = directoryPicker();
    if (!opener) return false;
    try {
      const dir = await opener({ mode: "read" });
      setReading(true);
      const found: { path: string; file: File }[] = [];
      try {
        await collectHandle(dir, dir.name, found);
      } catch (error) {
        setReading(false);
        show(message(error), true);
        return true;
      }
      await sendImages(found, forced);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return true;
      return false;
    }
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const found: { path: string; file: File }[] = [];
    let sawDirectory = false;
    setReading(true);
    try {
      for (const item of event.dataTransfer.items) {
        const handle = await asDirectoryHandle(item);
        if (handle) {
          if (handle.kind === "directory") sawDirectory = true;
          await collectHandle(handle, handle.name, found);
          continue;
        }
        const entry = entryOf(item);
        if (!entry) continue;
        if (entry.isDirectory) sawDirectory = true;
        await walk(entry, found);
      }
    } catch (error) {
      setReading(false);
      show(message(error), true);
      return;
    }
    if (!found.length && !sawDirectory) {
      for (const file of event.dataTransfer.files) {
        const path = file.webkitRelativePath || file.name;
        if (IMAGE_RE.test(path)) found.push({ path, file });
      }
    }
    if (found.length) {
      await sendImages(found, null);
      return;
    }
    setReading(false);
    const zip = [...event.dataTransfer.files].find((file) => /\.zip$/i.test(file.name));
    if (zip) {
      await sendZip(zip);
      return;
    }
    show("Drop a folder of class images, or a .zip from Drive.", true);
  };

  const onKeep = async (name: string, kept: boolean) => {
    pushUndo(captureUndo());
    const seq = ++keepSeq.current;
    const gen = summaryGen.current;
    setSummary((current) => patchKept(current, name, kept));
    try {
      const result = await setVisionClassKept(sessionId, projectId, name, kept);
      if (seq !== keepSeq.current || gen !== summaryGen.current) return;
      applySummary(result.summary, gen);
      forgetModel();
    } catch (error) {
      if (seq !== keepSeq.current || gen !== summaryGen.current) return;
      setSummary((current) => patchKept(current, name, !kept));
      show(message(error), true);
    }
  };

  const onShare = async (percent: number) => {
    pushUndo(captureUndo());
    const gen = summaryGen.current;
    try {
      const result = await setVisionTestShare(sessionId, projectId, percent);
      if (gen !== summaryGen.current) return;
      applySummary(result.summary, gen);
      forgetModel();
    } catch (error) {
      if (gen === summaryGen.current) show(message(error), true);
    }
  };

  const onClear = async () => {
    if (reading || preparing || training) {
      show(training ? "Stop training before clearing uploads." : "Wait until this step finishes.", true);
      return;
    }
    if (!window.confirm("Remove the uploaded images?")) return;
    // Invalidate in-flight ingest/keep/share so they cannot repaint wiped data.
    summaryGen.current += 1;
    keepSeq.current += 1;
    const gen = summaryGen.current;
    wipeLab();
    clearUndo();
    setReading(false);
    try {
      await clearVision(sessionId, projectId);
      if (gen === summaryGen.current) show("Uploads cleared.");
    } catch (error) {
      show(message(error), true);
      try {
        const state = await loadVisionState(sessionId, projectId);
        if (gen === summaryGen.current) applySummary(state.summary, gen);
      } catch {
        /* keep wiped UI if reload also fails */
      }
    }
  };

  const onPrepare = async () => {
    if (reading || preparing) {
      show("Wait until this step finishes.", true);
      return;
    }
    if (!summary?.classes.length) {
      show("Upload a folder for each class first.", true);
      return;
    }
    if (!summary.ok) {
      show("Fix the data checks before using these images.", true);
      return;
    }
    setPreparing(true);
    try {
      const next = await prepareVision(sessionId, projectId);
      setDataset(next);
      setRuns([]);
      setCur(null);
      setEvalRun(null);
      setStep(3);
      setModal("path");
      const dupes = next.dupes ? ` ${next.dupes} look like duplicates.` : "";
      show(`Images ready: ${next.K} classes, ${next.trainCount} training, ${next.valCount} validation, ${next.nte} testing.${dupes}`);
    } catch (error) {
      show(message(error), true);
    } finally {
      setPreparing(false);
    }
  };

  const startWithTrack = (nextTrack: LearnTrack, nextModel: ModelId, vals: ParamMap) => {
    pushUndo(captureUndo());
    setModal(null);
    setTrack(nextTrack);
    setModel(nextModel);
    const nextParams = { ...params, [nextModel]: vals };
    setParams(nextParams);
    rememberParams(nextParams);
    setDraft({ ...vals });
    setTraining(false);
    show(`${MODELS[nextModel].name} selected. Press Train when you are ready.`);
  };

  const train = async (modelId: ModelId, vals: ParamMap, fraction: number) => {
    if (!dataset) {
      show("Prepare images before training.", true);
      return;
    }
    if (training) {
      show("Stop the current run before training again.", true);
      return;
    }
    setModal(null);
    // Unlock the UI immediately — do not wait for the HTTP round-trip / disk flush.
    setTraining(true);
    const begin = async () => startVisionTrain(sessionId, projectId, modelId, vals, fraction);
    try {
      let run: RunView;
      try {
        run = await begin();
      } catch (error) {
        const text = message(error);
        // If a previous job left the lab locked, stop it and retry once.
        if (/still running/i.test(text) && cur) {
          await stopVisionTrain(sessionId, projectId, cur).catch(() => undefined);
          await new Promise((resolve) => window.setTimeout(resolve, 200));
          run = await begin();
        } else {
          throw error;
        }
      }
      setCur(run.id);
      setRuns((prev) => [...prev.filter((item) => item.id !== run.id), run]);
    } catch (error) {
      setTraining(false);
      show(message(error), true);
    }
  };

  const saveDraft = (andTrain: boolean) => {
    if (!draft) return;
    pushUndo(captureUndo());
    const next = { ...params, [model]: draft };
    setParams(next);
    rememberParams(next);
    if (andTrain) {
      void train(model, draft, frac);
      return;
    }
    setModal(null);
    show("Parameters saved.");
  };

  const restart = async () => {
    if (training) {
      show("Stop training before starting over.", true);
      return;
    }
    if (!window.confirm("Start over? Uploaded images and trained models will be cleared.")) return;
    summaryGen.current += 1;
    keepSeq.current += 1;
    const gen = summaryGen.current;
    wipeLab();
    clearUndo();
    setModal(null);
    setStep(2);
    setReading(false);
    try {
      await clearVision(sessionId, projectId);
    } catch (error) {
      show(message(error), true);
      try {
        const state = await loadVisionState(sessionId, projectId);
        if (gen === summaryGen.current) applySummary(state.summary, gen);
      } catch {
        /* keep wiped UI */
      }
    }
  };

  const loadIndex = async (index: number) => {
    if (!dataset || !scoredRun) return;
    const key = `${scoredRun.id}:${index}`;
    let view = cache.current.get(key);
    if (!view) {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const predicted = await predictVisionIndex(sessionId, projectId, scoredRun.id, index);
        view = { pred: predicted.pred, probs: predicted.probs, seen: predicted.seen };
        cache.current.set(key, view);
      } catch (error) {
        show(message(error), true);
        return;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }
    const truth = dataset.y[index] ?? null;
    const card: BoardCard = {
      id: `ds:${index}`,
      n: index,
      url: imageSrc(index),
      small: dataset.small[index] ?? false,
      name: dataset.classes[view.pred]?.name,
      probs: view.probs,
      pred: view.pred,
      truth,
      seen: view.seen,
    };
    setCurrent(card);
    if (truth != null) setTested((prev) => ({ ...prev, [index]: view.pred === truth }));
    setHistory((prev) => [
      {
        id: card.id ?? `ds:${index}`,
        n: index,
        url: card.url,
        small: card.small,
        name: card.name,
        probs: card.probs,
        seen: card.seen,
        a: view.pred,
        conf: view.probs[view.pred] ?? 0,
        truth,
        ok: truth == null ? null : view.pred === truth,
      },
      ...prev.filter((item) => item.id !== card.id),
    ]);
  };

  const visibleDeck = () => {
    if (!dataset) return [];
    return deck.filter((index) => {
      if (classFilter >= 0 && dataset.y[index] !== classFilter) return false;
      if (filter === "new") return tested[index] === undefined;
      if (filter === "wrong") return tested[index] === false;
      return true;
    });
  };

  const stepBoard = (dir: number) => {
    const list = visibleDeck();
    if (!list.length || !dataset) return;
    if (current?.n == null || !list.includes(current.n)) {
      void loadIndex(dir < 0 ? list[list.length - 1] : list[0]);
      return;
    }
    const at = list.indexOf(current.n);
    const next = (at + dir + list.length) % list.length;
    void loadIndex(list[next]);
  };

  live.current.load = loadIndex;
  live.current.step = stepBoard;

  const onOwn = async (file: File) => {
    if (!scoredRun || !dataset) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const predicted = await predictVisionFile(sessionId, projectId, scoredRun.id, file);
      const id = `own:${(ownSeq.current += 1)}`;
      const card: BoardCard = {
        id,
        n: null,
        url: URL.createObjectURL(file),
        small: Boolean(predicted.small),
        name: file.name,
        probs: predicted.probs,
        pred: predicted.pred,
        truth: null,
        seen: predicted.seen,
      };
      setCurrent(card);
      setHistory((prev) => [
        {
          id,
          n: null,
          url: card.url,
          small: card.small,
          name: card.name,
          probs: card.probs,
          seen: card.seen,
          a: card.pred,
          conf: card.probs[card.pred] ?? 0,
          truth: null,
          ok: null,
        },
        ...prev,
      ]);
    } catch (error) {
      show(message(error), true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onTruth = (cls: number) => {
    const id = current?.id;
    setCurrent((card) => (card && card.id === id ? { ...card, truth: cls } : card));
    if (!id) return;
    setHistory((prev) => prev.map((item) => (item.id === id ? { ...item, truth: cls, ok: item.a === cls } : item)));
  };

  const onReplay = (item: HistItem) => {
    setCurrent({
      id: item.id,
      n: item.n,
      url: item.url,
      small: item.small,
      name: item.name,
      probs: item.probs,
      pred: item.a,
      truth: item.truth,
      seen: item.seen,
    });
  };


  return (
    <div ref={rootRef} className="ex4" data-theme={theme}>
      <header className="top">
        <div className="top-row">
          <div className="brand ex-lab-brand">
            <ExerciseHeaderIcon id={4} />
            <h1 className="ex-title">Exercise - 4 : Image Classification</h1>
          </div>
          <div className="actions">
            <FullscreenButton targetRef={rootRef} className="ibtn olive" />
            <button
              type="button"
              className="report-btn"
              disabled={!dataset || training}
              title={!dataset ? "Prepare images first" : training ? "Stop training to change model" : undefined}
              onClick={() => setModal("path")}
            >
              <Icon name="brain" />
              Model
            </button>
            <button type="button" className="ibtn cyan" aria-label="How this exercise works" onClick={() => setModal("info")}>
              <Icon name="info" />
            </button>
            <UndoButton canUndo={canUndo} onUndo={handleUndo} className="ibtn olive undo-ibtn" />
            <button type="button" className="ibtn amber" aria-label="Start over" onClick={() => void restart()}>
              <Icon name="reset" />
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      {step <= 2 ? (
        <UploadStep
          summary={summary}
          reading={reading}
          preparing={preparing}
          onFiles={onFiles}
          onPickFolder={pickFolder}
          onDrop={(event) => void onDrop(event)}
          onClear={() => void onClear()}
          onShare={(percent) => void onShare(percent)}
          onKeep={(name, kept) => void onKeep(name, kept)}
          onPrepare={() => {
            void onPrepare();
          }}
        />
      ) : null}
      {step === 3 && dataset ? (
        <TrainStep
          dataset={dataset}
          model={model}
          training={training}
          run={activeRun}
          runs={runs}
          imageSrc={imageSrc}
          onTrain={() => void train(model, params[model], frac)}
          onStop={() => {
            if (!cur) {
              setTraining(false);
              return;
            }
            const runId = cur;
            void stopVisionTrain(sessionId, projectId, runId)
              .catch((error) => show(message(error), true))
              .finally(() => {
                // Unlock the Train button even if the worker is slow to finish.
                window.setTimeout(() => {
                  setTraining((value) => {
                    if (!value) return value;
                    return false;
                  });
                }, 2200);
              });
          }}
          onSelectRun={(runId) => {
            setCur(runId);
            setEvalRun(runId);
            const picked = runs.find((item) => item.id === runId);
            if (picked) {
              setModel(picked.model);
              setDraft({ ...picked.params });
              setParams((prev) => ({ ...prev, [picked.model]: { ...picked.params } }));
            }
          }}
          onOpenParams={() => {
            setDraft({ ...params[model] });
            setModal("params");
          }}
          onPredictFile={async (file) => {
            const target = activeRun?.done && activeRun.res ? activeRun : [...doneRuns].reverse()[0];
            if (!target) throw new Error("Train a model first.");
            return predictVisionFile(sessionId, projectId, target.id, file);
          }}
        />
      ) : null}
      {step === 5 && dataset && scoredRun ? (
        <TestStep
          dataset={dataset}
          run={scoredRun}
          runs={doneRuns}
          imageSrc={imageSrc}
          filter={filter}
          classFilter={classFilter}
          deck={deck}
          tested={tested}
          current={current}
          history={history}
          auto={auto}
          busy={busy}
          onFilter={setFilter}
          onClass={setClassFilter}
          onRun={(id) => {
            setEvalRun(id);
            setAuto(false);
          }}
          onLoad={(index) => void loadIndex(index)}
          onReplay={onReplay}
          onPrev={() => stepBoard(-1)}
          onNext={() => stepBoard(1)}
          onAuto={() => setAuto((value) => !value)}
          onOwn={(file) => void onOwn(file)}
          onTruth={onTruth}
        />
      ) : null}
      {toast ? (
        <div className={`toast${toast.warn ? " warn" : ""}`} role="status">
          <span className="tk">
            <Icon name={toast.warn ? "alert" : "check"} size={14} />
          </span>
          {toast.text}
        </div>
      ) : null}
      {modal === "info" ? <InfoModal onClose={() => setModal(null)} /> : null}
      {modal === "path" ? (
        <PathModal
          onClose={() => setModal(null)}
          onPick={(nextTrack, nextModel, vals) => {
            startWithTrack(nextTrack, nextModel, vals);
          }}
        />
      ) : null}
      {modal === "params" && draft && dataset ? (
        <ParamsModal
          model={model}
          vals={draft}
          dataset={dataset}
          frac={frac}
          onChange={(key, value) => setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))}
          onReset={() => setDraft(defaults(model))}
          onSave={() => saveDraft(false)}
          onTrain={() => saveDraft(true)}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "cell" && cell && dataset && scoredRun ? (
        <CellModal
          dataset={dataset}
          run={scoredRun}
          real={cell.real}
          guess={cell.guess}
          imageSrc={imageSrc}
          onClose={() => setModal(null)}
          onOpen={(index) => {
            setModal(null);
            setStep(5);
            void loadIndex(index);
          }}
        />
      ) : null}
    </div>
  );
}
