/** Per-exercise step-by-step undo (snapshot stack). Not a full reset. */

export type UndoStackOptions = {
  max?: number;
};

export function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createUndoStack<T>(options: UndoStackOptions = {}) {
  const max = Math.max(1, options.max ?? 40);
  const stack: T[] = [];

  return {
    push(snapshot: T) {
      stack.push(cloneState(snapshot));
      if (stack.length > max) stack.shift();
    },
    undo(): T | undefined {
      return stack.pop();
    },
    get canUndo() {
      return stack.length > 0;
    },
    get size() {
      return stack.length;
    },
    clear() {
      stack.length = 0;
    },
  };
}

/** Shared markup for imperative (mount) lab headers — curved-arrow icon, no text. */
export const UNDO_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.9L3 13"/></svg>';

export const UNDO_BUTTON_HTML = `<button type="button" class="undo-btn" id="undoBtn" disabled title="Undo the last change" aria-label="Undo the last change">${UNDO_ICON_SVG}</button>`;

export function syncUndoButton(btn: HTMLButtonElement | null | undefined, canUndo: boolean): void {
  if (!btn) return;
  btn.disabled = !canUndo;
}
