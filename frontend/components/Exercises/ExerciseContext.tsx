'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EmbedResult,
  Ex2Result,
  ExerciseId,
  ExerciseProgress,
  ExerciseStatus,
  ExercisesProps,
  ExercisesWorkspaceState,
  GenerateResult,
} from './types';
import { EXERCISE_CATALOG } from './catalog';
import { parseEx2Result } from './ex2Result';
import { clearEx2LabState, clearResumeCookie, parseActiveId, readResumeCookie, snapshotRank, writeResumeCookie } from './labs/ex2LabState';
import { hasHeldOutScores, restoreEx2Result } from './labs/ex2HeldOut';
import {
  embedLab,
  generateLab,
  loadExercisesWorkspace,
  resetExercisesWorkspace,
  saveExercisesWorkspace,
} from './api';
import { simulateGenerate } from './engines/llm';
import { embedText } from './engines/text';
import {
  readExerciseTheme,
  subscribeExerciseTheme,
  writeExerciseTheme,
  type ExerciseTheme,
} from './theme';

const STORAGE_PREFIX = 'np-exercises';

function statusRank(status: ExerciseStatus): number {
  switch (status) {
    case 'not_started':
      return 0;
    case 'in_progress':
      return 1;
    case 'completed':
      return 2;
    default: {
      const _never: never = status;
      return _never;
    }
  }
}

function emptyProgress(): ExerciseProgress {
  return { status: 'not_started', notes: '', snapshot: {} };
}

function preferEx2Result(remote: Ex2Result | null, local: Ex2Result | null): Ex2Result | null {
  if (hasHeldOutScores(local)) return local;
  if (hasHeldOutScores(remote)) return remote;
  return local || remote;
}

function withHeldOut(state: ExercisesWorkspaceState, sessionId: string, projectId: string): ExercisesWorkspaceState {
  if (hasHeldOutScores(state.ex2Result)) return state;
  const restored = restoreEx2Result(sessionId, projectId);
  return restored ? { ...state, ex2Result: restored } : state;
}

function emptyState(): ExercisesWorkspaceState {
  const progress: Record<string, ExerciseProgress> = {};
  EXERCISE_CATALOG.forEach((item) => {
    progress[String(item.id)] = emptyProgress();
  });
  return { version: 1, progress, activeId: null, ex2Result: null };
}

function mergeState(incoming?: ExercisesWorkspaceState | null): ExercisesWorkspaceState {
  const base = emptyState();
  if (!incoming?.progress) {
    base.ex2Result = parseEx2Result(incoming?.ex2Result);
    base.activeId = parseActiveId(incoming?.activeId);
    return base;
  }
  Object.entries(incoming.progress).forEach(([key, value]) => {
    base.progress[key] = {
      status: value?.status || 'not_started',
      notes: value?.notes || '',
      snapshot: value?.snapshot || {},
    };
  });
  base.ex2Result = parseEx2Result(incoming.ex2Result);
  base.activeId = parseActiveId(incoming.activeId);
  return base;
}

interface ExerciseContextValue extends ExercisesProps {
  state: ExercisesWorkspaceState;
  activeId: ExerciseId | null;
  setActiveId: (id: ExerciseId | null) => void;
  getProgress: (id: ExerciseId) => ExerciseProgress;
  patchProgress: (id: ExerciseId, patch: Partial<ExerciseProgress>) => void;
  markInProgress: (id: ExerciseId) => void;
  markComplete: (id: ExerciseId) => void;
  saveNotes: (id: ExerciseId, notes: string) => Promise<boolean>;
  resetExercise: (id: ExerciseId) => void;
  resetAll: () => Promise<void>;
  persist: () => Promise<void>;
  ex2Result: Ex2Result | null;
  saveEx2Result: (result: Ex2Result | null) => void;
  resetEpoch: number;
  generate: (payload: {
    prompt: string;
    system?: string;
    examples?: { user: string; assistant: string }[];
    model?: string;
    temperature?: number;
    n?: number;
    max_tokens?: number;
  }) => Promise<GenerateResult>;
  embed: (texts: string[], model: string) => Promise<EmbedResult>;
  chromeBack: { label: string; run: () => void } | null;
  setChromeBack: (nav: { label: string; run: () => void } | null) => void;
  theme: ExerciseTheme;
  setTheme: (theme: ExerciseTheme) => void;
}

const ExerciseContext = createContext<ExerciseContextValue | null>(null);

export function ExerciseProvider({
  children,
  projectName,
  sessionId,
  projectId,
}: ExercisesProps & { children: React.ReactNode }) {
  const storageKey = `${STORAGE_PREFIX}:${sessionId}:${projectId}`;
  const [state, setState] = useState<ExercisesWorkspaceState>(() => {
    if (typeof window === 'undefined' || !sessionId || !projectId) return emptyState();
    try {
      const localRaw = window.localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}:${projectId}`);
      const local = localRaw ? mergeState(JSON.parse(localRaw)) : emptyState();
      return withHeldOut(local, sessionId, projectId);
    } catch {
      return emptyState();
    }
  });
  const [activeId, setActiveIdState] = useState<ExerciseId | null>(() => {
    if (typeof window === 'undefined' || !sessionId || !projectId) return null;
    try {
      const localRaw = window.localStorage.getItem(`${STORAGE_PREFIX}:${sessionId}:${projectId}`);
      if (localRaw) {
        const local = mergeState(JSON.parse(localRaw));
        if (local.activeId) return local.activeId;
      }
      return readResumeCookie(sessionId, projectId);
    } catch {
      return readResumeCookie(sessionId, projectId);
    }
  });
  const [resetEpoch, setResetEpoch] = useState(0);
  const [chromeBack, setChromeBackState] = useState<{ label: string; run: () => void } | null>(null);
  const chromeBackRef = useRef(chromeBack);
  chromeBackRef.current = chromeBack;
  const setChromeBack = useCallback((nav: { label: string; run: () => void } | null) => {
    chromeBackRef.current = nav;
    setChromeBackState(nav);
  }, []);
  const [theme, setThemeState] = useState<ExerciseTheme>(() => readExerciseTheme());
  const setTheme = useCallback((next: ExerciseTheme) => {
    writeExerciseTheme(next);
    setThemeState(next);
  }, []);
  useEffect(() => subscribeExerciseTheme(setThemeState), []);
  const stateRef = useRef(state);
  const activeIdRef = useRef<ExerciseId | null>(activeId);
  stateRef.current = state;
  activeIdRef.current = activeId;

  useEffect(() => {
    let cancelled = false;
    const localRaw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
    if (localRaw) {
      try {
        const local = withHeldOut(mergeState(JSON.parse(localRaw)), sessionId, projectId);
        setState(local);
        stateRef.current = local;
        if (local.activeId) {
          setActiveIdState(local.activeId);
          activeIdRef.current = local.activeId;
        } else {
          const cookieId = readResumeCookie(sessionId, projectId);
          if (cookieId) {
            setActiveIdState(cookieId);
            activeIdRef.current = cookieId;
          }
        }
      } catch {
        setState(emptyState());
      }
    } else {
      const cookieId = readResumeCookie(sessionId, projectId);
      if (cookieId) {
        setActiveIdState(cookieId);
        activeIdRef.current = cookieId;
      }
    }
    loadExercisesWorkspace(sessionId, projectId).then((remote) => {
      if (cancelled || !remote) return;
      setState((prev) => {
        const merged = mergeState(remote);
        Object.entries(prev.progress).forEach(([key, local]) => {
          const rem = merged.progress[key] || emptyProgress();
          let next = rem;
          if (statusRank(local.status) > statusRank(rem.status)) {
            next = { ...local };
          } else if (statusRank(local.status) === statusRank(rem.status) && local.notes.length > rem.notes.length) {
            next = { ...rem, notes: local.notes };
          }
          if (snapshotRank(local.snapshot) >= snapshotRank(next.snapshot)) {
            next = { ...next, snapshot: local.snapshot };
          }
          merged.progress[key] = next;
        });
        merged.ex2Result = preferEx2Result(merged.ex2Result ?? null, prev.ex2Result ?? null);
        if (!hasHeldOutScores(merged.ex2Result)) {
          merged.ex2Result = restoreEx2Result(sessionId, projectId) || merged.ex2Result;
        }
        if (!merged.activeId && prev.activeId) merged.activeId = prev.activeId;
        stateRef.current = merged;
        if (!activeIdRef.current && merged.activeId) {
          setActiveIdState(merged.activeId);
          activeIdRef.current = merged.activeId;
        }
        if (!activeIdRef.current) {
          const cookieId = readResumeCookie(sessionId, projectId);
          if (cookieId) {
            setActiveIdState(cookieId);
            activeIdRef.current = cookieId;
            merged.activeId = cookieId;
          }
        }
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, sessionId, storageKey]);

  const persistState = useCallback(
    async (next: ExercisesWorkspaceState) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore quota
      }
      writeResumeCookie(sessionId, projectId, parseActiveId(next.activeId));
      return saveExercisesWorkspace(sessionId, projectId, next);
    },
    [projectId, sessionId, storageKey],
  );

  const persist = useCallback(async () => {
    await persistState(stateRef.current);
  }, [persistState]);

  const setActiveId = useCallback(
    (id: ExerciseId | null) => {
      setActiveIdState(id);
      activeIdRef.current = id;
      if (id == null) {
        chromeBackRef.current = null;
        setChromeBackState(null);
      }
      const next: ExercisesWorkspaceState = { ...stateRef.current, activeId: id };
      stateRef.current = next;
      setState(next);
      void persistState(next);
    },
    [persistState],
  );

  const patchProgress = useCallback((id: ExerciseId, patch: Partial<ExerciseProgress>) => {
    const current = stateRef.current.progress[String(id)] || emptyProgress();
    const next: ExercisesWorkspaceState = {
      ...stateRef.current,
      progress: {
        ...stateRef.current.progress,
        [String(id)]: { ...current, ...patch },
      },
    };
    stateRef.current = next;
    setState(next);
  }, []);

  const getProgress = useCallback(
    (id: ExerciseId) => state.progress[String(id)] || emptyProgress(),
    [state.progress],
  );

  const markInProgress = useCallback(
    (id: ExerciseId) => {
      const current = stateRef.current.progress[String(id)] || emptyProgress();
      if (current.status === 'completed') return;
      patchProgress(id, { status: 'in_progress' as ExerciseStatus });
    },
    [patchProgress],
  );

  const markComplete = useCallback(
    (id: ExerciseId) => {
      patchProgress(id, { status: 'completed' });
      void persistState(stateRef.current);
    },
    [patchProgress, persistState],
  );

  const saveNotes = useCallback(
    async (id: ExerciseId, notes: string) => {
      patchProgress(id, { notes });
      return persistState(stateRef.current);
    },
    [patchProgress, persistState],
  );

  const resetExercise = useCallback(
    (id: ExerciseId) => {
      patchProgress(id, { ...emptyProgress(), status: 'in_progress' });
      if (id === 2) {
        clearEx2LabState(sessionId, projectId, 2);
        const next: ExercisesWorkspaceState = { ...stateRef.current, ex2Result: null };
        stateRef.current = next;
        setState(next);
      }
      setResetEpoch((n) => n + 1);
      void persistState(stateRef.current);
    },
    [patchProgress, persistState, projectId, sessionId],
  );

  const saveEx2Result = useCallback(
    (result: Ex2Result | null) => {
      const next: ExercisesWorkspaceState = { ...stateRef.current, ex2Result: result };
      stateRef.current = next;
      setState(next);
      void persistState(next);
    },
    [persistState],
  );

  const resetAll = useCallback(async () => {
    const next = emptyState();
    setState(next);
    stateRef.current = next;
    setActiveIdState(null);
    activeIdRef.current = null;
    setResetEpoch((n) => n + 1);
    try {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(`np-ex1-rbp:${sessionId}:${projectId}`);
      clearEx2LabState(sessionId, projectId);
      clearResumeCookie();
    } catch {
      // ignore
    }
    await resetExercisesWorkspace(sessionId, projectId);
  }, [projectId, sessionId, storageKey]);

  const generate = useCallback(
    async (payload: {
      prompt: string;
      system?: string;
      examples?: { user: string; assistant: string }[];
      model?: string;
      temperature?: number;
      n?: number;
      max_tokens?: number;
    }): Promise<GenerateResult> => {
      try {
        if (!payload.prompt.trim()) {
          return {
            outputs: [],
            model: payload.model || 'gemini-2.5-flash-lite',
            temperature: payload.temperature ?? 0.7,
            simulated: true,
          };
        }
        return await generateLab(sessionId, projectId, payload);
      } catch {
        return {
          outputs: simulateGenerate(payload),
          model: payload.model || 'gemini-2.5-flash-lite',
          temperature: payload.temperature ?? 0.7,
          simulated: true,
        };
      }
    },
    [projectId, sessionId],
  );

  const embed = useCallback(
    async (texts: string[], model: string): Promise<EmbedResult> => {
      try {
        return await embedLab(sessionId, projectId, texts, model);
      } catch {
        const ngram = model.includes('004') ? 3 : 5;
        return {
          embeddings: texts.map((text) => embedText(text, 48, ngram)),
          model,
          simulated: true,
        };
      }
    },
    [projectId, sessionId],
  );

  const value = useMemo<ExerciseContextValue>(
    () => ({
      projectName,
      sessionId,
      projectId,
      state,
      activeId,
      setActiveId,
      getProgress,
      patchProgress,
      markInProgress,
      markComplete,
      saveNotes,
      resetExercise,
      resetAll,
      persist,
      ex2Result: state.ex2Result ?? null,
      saveEx2Result,
      resetEpoch,
      generate,
      embed,
      chromeBack,
      setChromeBack,
      theme,
      setTheme,
    }),
    [
      activeId,
      chromeBack,
      embed,
      generate,
      getProgress,
      markComplete,
      markInProgress,
      patchProgress,
      persist,
      projectId,
      projectName,
      resetAll,
      resetEpoch,
      resetExercise,
      saveEx2Result,
      saveNotes,
      sessionId,
      setActiveId,
      setChromeBack,
      setTheme,
      state,
      theme,
    ],
  );

  return <ExerciseContext.Provider value={value}>{children}</ExerciseContext.Provider>;
}

export function useExerciseSession(): ExerciseContextValue {
  const ctx = useContext(ExerciseContext);
  if (!ctx) {
    throw new Error('useExerciseSession must be used inside ExerciseProvider');
  }
  return ctx;
}
