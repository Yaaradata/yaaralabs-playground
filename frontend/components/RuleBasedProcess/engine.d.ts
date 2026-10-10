export function mountRuleBasedProcess(
  root: HTMLElement,
  options?: {
    initialState?: Record<string, unknown>;
    /** Host outside `root` that may hold the runbar controls. */
    toolbarHost?: HTMLElement | null;
    onSave?: (state: Record<string, unknown>) => void;
    askModel?: (prompt: string) => Promise<string>;
    onReset?: () => Promise<Record<string, unknown> | null | undefined>;
  }
): {
  cleanup: () => void;
  getState: () => Record<string, unknown>;
  applyState: (state: Record<string, unknown>) => void;
};

export default mountRuleBasedProcess;
