'use client';

/**
 * "3. Use the AI" for Text and Image Recognition projects: the block editor from Exercise 1 (Rule
 * Based Classifier), with an "ML Model" block category. The page uses the model the way any other app
 * would: through its deployed URL (the one Export shows on the training page, backend api/deployed.py).
 * Nothing is loaded when the page opens: the learner pastes the URL into "use deployed model" and
 * presses Enter, then the model's labels appear on the left.
 *   text   recognise text ( ) (label)   POST {url}/predict {"text": ...}
 *   image  recognise an image and wait  (a picker: Upload / Webcam / workshop test images), then
 *          POST {url}/predict with the image as a "file" upload
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import config from '../../lib/config';
import BlockStudioShell from '../BlockStudio/BlockStudioShell';
import RuleBasedProcess, { type MlOptions } from '../RuleBasedProcess/RuleBasedProcess';
import { labelNamesKey } from '../SampleImages/sampleImages';
import ImagePicker, { type PickedImage } from './ImagePicker';

interface Props {
  kind: 'text' | 'image';
  projectName: string;
  sessionId: string;
  projectId: string;
  /** Project page (Back) and training page (Train) links. */
  backHref: string;
  trainHref: string;
  /** "Move to next" in the header once the model is trained (Text Recognition: the Evaluate step). */
  nextHref?: string;
  nextLabel?: string;
}

interface MlState {
  trained: boolean;
}

const MODEL_TYPES: Record<string, string> = {
  sentence_embed_lr: 'Logistic Regression',
  logistic_regression_ovr: 'Logistic Regression (word matching)',
  logistic_regression: 'Logistic Regression',
  distilbert: 'DistilBERT',
  efficientnet: 'Image model (EfficientNet)',
  mobilenet: 'Image model (MobileNet)',
};

type Result = { label: string; confidence: number; name?: string };

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Error text from a deployed-model call, in the learner's words. */
async function deployedError(r: Response) {
  const body = await r.json().catch(() => ({}));
  if (r.status === 404) return 'Your deployed model was not found. Train it again on the Train the AI page.';
  if (r.status === 409) return typeof body?.detail === 'string' ? body.detail : 'The model is being trained again. Try again soon.';
  return 'The deployed model could not be reached. Try again.';
}

export default function ProjectAI({ kind, projectName, sessionId, projectId, backHref, trainHref, nextHref, nextLabel }: Props) {
  const [ml, setMl] = useState<MlState | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickBusy, setPickBusy] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const pending = useRef<((r: Result | null) => void) | null>(null);

  // Only whether the project is trained (for the header): the model itself comes from the URL
  // the learner pastes into "use deployed model".
  useEffect(() => {
    let alive = true;
    fetch(`${config.apiBaseUrl}${config.api.guests.trainingStatus(sessionId, projectId)}`)
      .then((r) => r.json())
      .then((status) => alive && setMl({ trained: status?.projectStatus === 'trained' }))
      .catch(() => alive && setMl({ trained: false }));
    return () => {
      alive = false;
    };
  }, [sessionId, projectId]);

  // The model loaded from the pasted URL: its predict calls and labels (the image picker uses them)
  const urlRef = useRef<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);

  /** "use deployed model [URL]" + Enter: read the model's details from its URL. */
  const load = useCallback(
    async (raw: string) => {
      const url = raw.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/\S+$/.test(url)) throw new Error('That is not a URL. Copy it from Export on the training page.');
      let r: Response;
      try {
        r = await fetch(url);
      } catch {
        throw new Error('No model at this URL. Copy it again from Export on the training page.');
      }
      if (!r.ok) throw new Error(await deployedError(r));
      const info = await r.json().catch(() => null);
      const got: string[] = Array.isArray(info?.labels) ? info.labels.map(String) : [];
      const want = kind === 'image' ? 'image' : 'text';
      if (!got.length || (info?.input && info.input !== want)) {
        throw new Error(`This URL is not a ${kind === 'image' ? 'Image' : 'Text'} Recognition model. Use the URL from this project's Export.`);
      }
      urlRef.current = url;
      setLabels(got);
      return {
        name: String(info?.name || projectName),
        labels: got,
        type: info?.modelType ? MODEL_TYPES[info.modelType] ?? String(info.modelType) : undefined,
        trainedAt: info?.trainedAt ? shortDate(info.trainedAt) : undefined,
        url,
      };
    },
    [kind, projectName],
  );

  /** POST {url}/predict on the deployed model: JSON for text, a "file" upload for images. */
  const callDeployed = useCallback(
    async (body: FormData | { text: string }) => {
      const deployedUrl = urlRef.current;
      if (!deployedUrl) throw new Error('Paste your model’s URL into “use deployed model” and press Enter first.');
      let r: Response;
      try {
        r = await fetch(`${deployedUrl}/predict`, body instanceof FormData
          ? { method: 'POST', body }
          : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch {
        throw new Error('The deployed model could not be reached. Try again.');
      }
      if (!r.ok) throw new Error(await deployedError(r));
      const data = await r.json();
      return { label: String(data.label), confidence: Number(data.confidence) || 0 };
    },
    [],
  );

  const predictDeployed = useCallback((text: string) => callDeployed({ text }), [callDeployed]);

  const predictImage = useCallback(
    (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return callDeployed(form);
    },
    [callDeployed],
  );

  // the image block asks for an image: open the picker and wait for the learner
  const recogniseImage = useCallback(() => {
    pending.current?.(null); // a picker left over from a stopped run
    setPickError(null);
    setPickBusy(null);
    setPicker(true);
    return new Promise<Result | null>((resolve) => {
      pending.current = resolve;
    });
  }, []);

  const finish = (r: Result | null) => {
    pending.current?.(r);
    pending.current = null;
    setPicker(false);
    setPickBusy(null);
  };

  const onPick = async (img: PickedImage) => {
    setPickError(null);
    setPickBusy('Your model is looking at the image…');
    try {
      const r = await predictImage(img.file);
      finish({ ...r, name: img.name });
    } catch (e) {
      setPickBusy(null);
      setPickError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };

  const mlOptions: MlOptions | undefined = ml
    ? kind === 'image'
      ? { kind: 'image', trained: ml.trained, labels: [], model: { name: projectName }, load, recogniseImage }
      : { kind: 'text', trained: ml.trained, labels: [], model: { name: projectName }, load, recognise: predictDeployed }
    : undefined;

  // Only a hint while there is no trained model; once it is ready the header shows just the title
  const subtitle = ml ? (
    ml.trained ? null : (
      <span className="opacity-75">
        Train your model to unlock the ML Model blocks.{' '}
        <Link href={trainHref} className="underline font-semibold">Go to training</Link>
      </span>
    )
  ) : null;

  return (
    <BlockStudioShell
      title={`Use the AI : ${projectName}`}
      subtitle={subtitle}
      backHref={backHref}
      backLabel="Back to project"
      actions={
        nextHref && ml?.trained ? (
          <Link
            href={nextHref}
            className="inline-flex items-center gap-2 whitespace-nowrap bg-purple-brand hover:bg-purple-brand/90 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          >
            {nextLabel ?? 'Move to next'}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ) : null
      }
      overlay={
        picker && ml ? (
          <ImagePicker
            labels={labels}
            namesKey={labelNamesKey(sessionId, projectId)}
            busy={pickBusy}
            error={pickError}
            onPick={onPick}
            onCancel={() => finish(null)}
          />
        ) : null
      }
    >
      {(toolbarHostRef) =>
        ml && (
          <RuleBasedProcess
            key={`ml:${kind}`}
            projectName={projectName}
            localStorageKey={`np-${kind === 'image' ? 'imgrec' : 'textrec'}-ai:${sessionId}:${projectId}`}
            toolbarHostRef={toolbarHostRef}
            ml={mlOptions}
          />
        )
      }
    </BlockStudioShell>
  );
}
