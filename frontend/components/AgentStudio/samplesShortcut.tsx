'use client';

/**
 * Sample data is hidden until the trainer presses Ctrl+Shift+Z (Cmd+Shift+Z on a Mac) in that
 * section, so participants try the agent with their own words first. The same keys hide it again.
 *
 * Each section has its own switch (per project): pressing the keys in Rules & Guardrails shows only
 * the custody example there; Actions, the Knowledge Base and the Sample questions in USE AI stay
 * hidden until the keys are pressed in them too. The section on screen is the one that registered
 * last (useSamplesShown), and its choice is kept for this browser tab (sessionStorage).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

const PREFIX = 'agentStudio:samplesShown:';
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();
/** The sections on screen, newest last: the shortcut acts on the last one. */
const onScreen: string[] = [];

function shown(scope: string): boolean {
  if (!memory.has(scope)) {
    let on = false;
    try {
      on = sessionStorage.getItem(PREFIX + scope) === '1';
    } catch {
      /* storage blocked: hidden */
    }
    memory.set(scope, on);
  }
  return memory.get(scope) as boolean;
}

function setShown(scope: string, on: boolean) {
  memory.set(scope, on);
  try {
    if (on) sessionStorage.setItem(PREFIX + scope, '1');
    else sessionStorage.removeItem(PREFIX + scope);
  } catch {
    /* storage blocked: the switch still works until the page reloads */
  }
  listeners.forEach((l) => l());
}

/**
 * True once Ctrl+Shift+Z was pressed in this section. `scope` names the section and project, e.g.
 * `${agentId}:guardrails`; while the component is on screen the shortcut switches this scope only.
 */
export function useSamplesShown(scope: string): boolean {
  useEffect(() => {
    onScreen.push(scope);
    return () => {
      const i = onScreen.lastIndexOf(scope);
      if (i > -1) onScreen.splice(i, 1);
    };
  }, [scope]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown(scope),
    () => false,
  );
}

/** Listens for Ctrl+Shift+Z and switches the section on screen. Mount once (AgentStudio). */
export function SamplesShortcut() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      const scope = onScreen[onScreen.length - 1];
      if (!scope) return; // this section has no sample data
      e.preventDefault();
      const on = !shown(scope);
      setShown(scope, on);
      setToast(on ? 'Sample data shown in this section' : 'Sample data hidden');
      clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 2500);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;
  return (
    <div
      role="status"
      className="fixed top-20 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-purple-brand px-4 py-2 text-sm font-semibold text-white shadow-lg"
    >
      {toast} <span className="font-normal opacity-80">· Ctrl+Shift+Z</span>
    </div>
  );
}
