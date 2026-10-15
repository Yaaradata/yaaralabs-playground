'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { mountRuleBasedProcess, type MlOptions } from './engine.js';
import MARKUP from './markup.js';
import config from '@/lib/config';
import { bindExerciseTheme } from '../Exercises/theme';
import '../Exercises/theme-labs.css';
import '../Exercises/labBuddy/labBuddy.css';
import { LAB_BUDDY_SVG } from '../Exercises/labBuddy/labBuddySvg';
import './ruleBasedProcess.css';

type RuleBasedProcessProps = {
  projectName?: string;
  sessionId?: string;
  projectId?: string;
  /** Persist in localStorage instead of the RBP cloud API. Existing RBP projects omit this. */
  localStorageKey?: string;
  /** Override the classroom "Ask the model" call. Existing RBP projects omit this. */
  askModel?: (prompt: string) => Promise<string>;
  /** Rendered next to Stage / Python. Existing RBP projects omit this. */
  extraTabs?: ReactNode;
  /** Rendered under the Stage / Python tabs. Existing RBP projects omit this. */
  extraPanel?: ReactNode;
  /** Optional host (e.g. exercise shell header) to show Run / toolbar controls. */
  toolbarHostRef?: RefObject<HTMLElement | null>;
  /** Text Recognition "Use the AI": the trained model behind the Machine Learning blocks. */
  ml?: MlOptions;
  /** "desk-routing": open on the keyword-rules starter (Rule Based Process projects). */
  starter?: 'desk-routing';
  /** Replaces Aria's stage on the right (Live Object Detection: the webcam). */
  stage?: ReactNode;
};

export type { MlOptions };

type RbpApi = {
  cleanup: () => void;
  getState: () => Record<string, unknown>;
  applyState: (state: Record<string, unknown>) => void;
};

export default function RuleBasedProcess({
  projectName,
  sessionId,
  projectId,
  localStorageKey,
  askModel: askModelOverride,
  extraTabs,
  extraPanel,
  toolbarHostRef,
  ml,
  starter,
  stage,
}: RuleBasedProcessProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<RbpApi | null>(null);
  const askModelRef = useRef(askModelOverride);
  askModelRef.current = askModelOverride;
  // read once at mount; the host remounts (key) when the model becomes available
  const mlRef = useRef(ml);
  mlRef.current = ml;
  const toolbarHostRefStable = useRef(toolbarHostRef);
  toolbarHostRefStable.current = toolbarHostRef;
  const hasStageRef = useRef(Boolean(stage));
  hasStageRef.current = Boolean(stage);
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);
  const extraSlotsRef = useRef(Boolean(extraTabs || extraPanel));
  extraSlotsRef.current = Boolean(extraTabs || extraPanel);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // bumped by Retry after a failed load: re-runs the load (and only then mounts the board)
  const [attempt, setAttempt] = useState(0);
  const [extraHost, setExtraHost] = useState<HTMLElement | null>(null);
  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let cancelled = false;
    let api: RbpApi | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let statusTimer: ReturnType<typeof setTimeout> | null = null;
    const persistLocal = Boolean(localStorageKey);
    const persistCloud = Boolean(sessionId && projectId && !persistLocal);

    const setSaveButton = (label: string, opts?: { busy?: boolean; error?: boolean }) => {
      const btn = root.querySelector('#save') as HTMLButtonElement | null;
      if (!btn) return;
      btn.textContent = label;
      btn.disabled = !!opts?.busy;
      btn.classList.toggle('save-error', !!opts?.error);
      btn.title = opts?.error ? label : 'Save workspace';
    };

    const saveWorkspace = async (state: Record<string, unknown>) => {
      if (!persistLocal && !persistCloud) return;
      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }
      setSaveButton('Saving…', { busy: true });
      try {
        if (persistLocal && localStorageKey) {
          window.localStorage.setItem(localStorageKey, JSON.stringify(state));
          setSaveButton('Saved');
          statusTimer = setTimeout(() => {
            if (!cancelled) setSaveButton('Save');
            statusTimer = null;
          }, 2000);
          return;
        }
        const res = await fetch(
          `${config.apiBaseUrl}${config.api.rbp.workspace(sessionId!, projectId!)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const detail = err.detail;
          const msg =
            typeof detail === 'string'
              ? detail
              : Array.isArray(detail)
                ? detail.map((d: { msg?: string }) => d.msg || String(d)).join('; ')
                : 'Failed to save workspace';
          throw new Error(msg);
        }
        setSaveButton('Saved');
        statusTimer = setTimeout(() => {
          if (!cancelled) setSaveButton('Save');
          statusTimer = null;
        }, 2000);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Save failed';
        setSaveButton(msg.length > 18 ? 'Save failed' : msg, { error: true });
        statusTimer = setTimeout(() => {
          if (!cancelled) setSaveButton('Save');
          statusTimer = null;
        }, 2500);
      }
    };

    const scheduleAutosave = () => {
      if ((!persistLocal && !persistCloud) || !apiRef.current) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (apiRef.current) void saveWorkspace(apiRef.current.getState());
      }, 2500);
    };

    const resetWorkspace = async (): Promise<Record<string, unknown> | null> => {
      if (persistLocal && localStorageKey) {
        window.localStorage.removeItem(localStorageKey);
        return null;
      }
      if (!persistCloud) return null;
      const res = await fetch(
        `${config.apiBaseUrl}${config.api.rbp.resetWorkspace(sessionId!, projectId!)}`,
        { method: 'POST' }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = json?.detail;
        const msg =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: { msg?: string }) => d.msg || String(d)).join('; ')
              : 'Failed to reset workspace';
        throw new Error(msg);
      }
      const state = json?.data?.state;
      return state && typeof state === 'object' ? (state as Record<string, unknown>) : null;
    };

    const boot = async () => {
      let initialState: Record<string, unknown> | undefined;
      // A failed load (5xx, network) must not mount the default board: its autosave and the save on
      // leaving would overwrite the learner's real work. Only "nothing saved yet" (404) starts fresh.
      let loadFailed = false;
      if (!cancelled) setLoadError(null);
      if (persistLocal && localStorageKey) {
        try {
          const raw = window.localStorage.getItem(localStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed && typeof parsed === 'object') initialState = parsed;
          }
        } catch {
          // ignore corrupt local state
        }
      } else if (persistCloud) {
        try {
          const res = await fetch(
            `${config.apiBaseUrl}${config.api.rbp.workspace(sessionId!, projectId!)}`
          );
          if (res.ok) {
            const json = await res.json();
            if (json?.success && json?.data?.state) {
              initialState = json.data.state;
            }
          } else if (res.status !== 404) {
            loadFailed = true;
          }
        } catch {
          loadFailed = true;
        }
      }

      if (loadFailed) {
        if (!cancelled) setLoadError('Couldn’t load your work. Your saved work is safe on the server.');
        return;
      }
      if (cancelled || !rootRef.current) return;

      root.innerHTML = MARKUP;
      const buddy = root.querySelector('#buddy');
      if (buddy) buddy.innerHTML = LAB_BUDDY_SVG;

      const toolbarHost = toolbarHostRefStable.current?.current ?? null;
      const runbar = root.querySelector('.runbar');
      if (toolbarHost && runbar) {
        toolbarHost.replaceChildren();
        toolbarHost.appendChild(runbar);
      }

      const unbindTheme = bindExerciseTheme(root);
      const unbindToolbarTheme = toolbarHost ? bindExerciseTheme(toolbarHost) : () => undefined;
      if (extraSlotsRef.current) {
        const ptabs = root.querySelector('#ptabs');
        if (ptabs) {
          ptabs.classList.add('has-extra');
          const tabsHost = document.createElement('div');
          tabsHost.className = 'ptabs-extra';
          ptabs.appendChild(tabsHost);
          const dock = document.createElement('div');
          dock.className = 'ptabs-extra-panel';
          if (ptabs.parentElement) {
            ptabs.parentElement.insertBefore(dock, ptabs.nextSibling);
          }
          if (!cancelled) {
            setExtraHost(tabsHost);
            setPanelHost(dock);
          }
        }
      }
      // the host's stage takes Aria's place in the Stage pane
      const out = root.querySelector('#p-out');
      if (hasStageRef.current && out) {
        root.classList.add('rbp-video');
        const host = document.createElement('div');
        host.className = 'ml-stage-host';
        out.appendChild(host);
        if (!cancelled) setStageHost(host);
      }
      api = mountRuleBasedProcess(root, {
        initialState,
        toolbarHost,
        onSave: (state: Record<string, unknown>) => {
          void saveWorkspace(state);
        },
        askModel:
          askModelRef.current || persistCloud
            ? async (prompt: string) => {
                if (askModelRef.current) return askModelRef.current(prompt);
                const res = await fetch(
                  `${config.apiBaseUrl}${config.api.rbp.askModel(sessionId!, projectId!)}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt }),
                  }
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                  const detail = json?.detail;
                  const msg =
                    typeof detail === 'string'
                      ? detail
                      : Array.isArray(detail)
                        ? detail.map((d: { msg?: string }) => d.msg || String(d)).join('; ')
                        : 'Model request failed';
                  throw new Error(msg);
                }
                return String(json?.reply ?? '');
              }
            : undefined,
        onReset: persistLocal || persistCloud ? () => resetWorkspace() : undefined,
        ml: mlRef.current,
        starter,
      } as {
        initialState?: Record<string, unknown>;
        toolbarHost?: HTMLElement | null;
        onSave?: (state: Record<string, unknown>) => void;
        askModel?: (prompt: string) => Promise<string>;
        onReset?: () => Promise<Record<string, unknown> | null | undefined>;
        ml?: MlOptions;
      }) as RbpApi;
      apiRef.current = api;

      // Autosave after meaningful UI mutations
      const onDirty = () => scheduleAutosave();
      root.addEventListener('pointerup', onDirty);
      root.addEventListener('change', onDirty);
      root.addEventListener('input', onDirty);

      (api as RbpApi & { _unsub?: () => void })._unsub = () => {
        root.removeEventListener('pointerup', onDirty);
        root.removeEventListener('change', onDirty);
        root.removeEventListener('input', onDirty);
        unbindTheme();
        unbindToolbarTheme();
        if (toolbarHost) toolbarHost.replaceChildren();
      };

      if (!cancelled) setReady(true);
    };

    void boot();

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
      if (statusTimer) clearTimeout(statusTimer);
      const extra = apiRef.current as (RbpApi & { _unsub?: () => void }) | null;
      if (extra?._unsub) extra._unsub();
      if (apiRef.current) {
        if (persistLocal && localStorageKey) {
          try {
            window.localStorage.setItem(localStorageKey, JSON.stringify(apiRef.current.getState()));
          } catch {
            // ignore quota
          }
        } else if (persistCloud) {
          const state = apiRef.current.getState();
          void fetch(`${config.apiBaseUrl}${config.api.rbp.workspace(sessionId!, projectId!)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
            keepalive: true,
          });
        }
        apiRef.current.cleanup();
        apiRef.current = null;
      }
      setExtraHost(null);
      setPanelHost(null);
      setStageHost(null);
      if (root) root.innerHTML = '';
    };
  }, [sessionId, projectId, localStorageKey, attempt]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      {projectName ? (
        <div className="sr-only" aria-live="polite">
          {projectName}
        </div>
      ) : null}
      {loadError ? (
        <div role="alert" className="m-4 rounded-xl border border-[#ef6f5e]/40 bg-ink-card px-4 py-3 text-sm text-[#ef6f5e] flex flex-wrap items-center gap-3">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="rounded-lg bg-purple-brand px-3 py-1.5 font-semibold text-white hover:bg-purple-brand/90"
          >
            Retry
          </button>
        </div>
      ) : null}
      {!ready && !loadError && sessionId && projectId && !localStorageKey ? (
        <div className="px-4 py-2 text-sm text-white/50">Loading workspace…</div>
      ) : null}
      <div ref={rootRef} className="rbp-root flex-1 min-h-0" />
      {extraHost && extraTabs ? createPortal(extraTabs, extraHost) : null}
      {panelHost && extraPanel ? createPortal(extraPanel, panelHost) : null}
      {stageHost && stage ? createPortal(stage, stageHost) : null}
    </div>
  );
}
