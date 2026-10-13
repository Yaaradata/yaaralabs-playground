/** Machine Learning blocks: Text / Image Recognition and Live Object Detection "Use the AI". */
export type MlOptions = {
  kind?: 'text' | 'image' | 'video';
  trained: boolean;
  /** The deployed model the "use deployed model" / "use model" blocks connect to. */
  model?: { name: string; type?: string; trainedAt?: string; url?: string };
  labels: string[];
  recognise?: (text: string) => Promise<{ label: string; confidence: number }>;
  /** Image models: the host lets the learner pick an image; null when they cancel. */
  recogniseImage?: () => Promise<{ label: string; confidence: number; name?: string } | null>;
  /** Video: load the model at `url`; the host then reports every webcam prediction (confidence %). */
  connect?: (url: string, onPrediction: (label: string, confidence: number) => void) => Promise<{ name: string }>;
  /** Video: the webcam on the stage. */
  video?: { turn: (state: string) => void; transparency: (percent: number) => void };
  /** Video: a speech bubble on the stage; `secs` null keeps it until the next one. */
  say?: (text: string, secs: number | null) => void;
  /** Video: the run ended: camera and predictions off. */
  stop?: () => void;
};

export function mountRuleBasedProcess(
  root: HTMLElement,
  options?: {
    initialState?: Record<string, unknown>;
    /** Host outside `root` that may hold the runbar controls. */
    toolbarHost?: HTMLElement | null;
    onSave?: (state: Record<string, unknown>) => void;
    askModel?: (prompt: string) => Promise<string>;
    onReset?: () => Promise<Record<string, unknown> | null | undefined>;
    /** "desk-routing": open on the keyword-rules starter (Rule Based Process projects). */
    starter?: 'desk-routing';
    /** Machine Learning blocks (see MlOptions). */
    ml?: MlOptions;
  }
): {
  cleanup: () => void;
  getState: () => Record<string, unknown>;
  applyState: (state: Record<string, unknown>) => void;
};

export default mountRuleBasedProcess;
