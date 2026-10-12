export function mountRuleBasedProcess(
  root: HTMLElement,
  options?: {
    initialState?: Record<string, unknown>;
    /** Host outside `root` that may hold the runbar controls. */
    toolbarHost?: HTMLElement | null;
    onSave?: (state: Record<string, unknown>) => void;
    askModel?: (prompt: string) => Promise<string>;
    onReset?: () => Promise<Record<string, unknown> | null | undefined>;
    /** Machine Learning blocks (Text Recognition "Use the AI"). */
    ml?: {
      kind?: 'text' | 'image';
      trained: boolean;
      labels: string[];
      recognise?: (text: string) => Promise<{ label: string; confidence: number }>;
      /** Image models: the host lets the learner pick an image; null when they cancel. */
      recogniseImage?: () => Promise<{ label: string; confidence: number; name?: string } | null>;
    };
  }
): {
  cleanup: () => void;
  getState: () => Record<string, unknown>;
  applyState: (state: Record<string, unknown>) => void;
};

export default mountRuleBasedProcess;
