'use client';

/**
 * "3. Use the AI" for Text and Image Recognition projects: the block editor from Exercise 1 (Rule
 * Based Classifier), with an "ML Model" block category that appears once the project's model is
 * trained. The page uses the model the way any other app would: through its deployed URL (the one
 * Export shows on the training page, backend api/deployed.py).
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
  labels: string[];
  /** Shown by the "use deployed model" block. */
  modelType?: string;
  trainedAt?: string;
  /** Text: the deployed model URL (the one Export shows); every recognise call goes through it. */
  url?: string;
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
  const base = `${config.apiBaseUrl}/api/guests/session/${sessionId}/projects/${projectId}`;

  // Is the model trained, and with which labels?
  useEffect(() => {
    let alive = true;
    (async () => {
      let trained = false;
      let labels: string[] = [];
      let modelType: string | undefined;
      let trainedAt: string | undefined;
      let url: string | undefined;
      try {
        const status = await fetch(`${config.apiBaseUrl}${config.api.guests.trainingStatus(sessionId, projectId)}`).then((r) => r.json());
        trained = status?.projectStatus === 'trained';
        if (status?.modelType) modelType = MODEL_TYPES[status.modelType] ?? String(status.modelType);
        const jobs: { completedAt?: string; startedAt?: string; createdAt?: string }[] = status?.allJobs ?? [];
        const last = status?.currentJob ?? jobs.filter((j) => j.completedAt).sort((x, y) => String(y.completedAt).localeCompare(String(x.completedAt)))[0];
        const done = last?.completedAt ?? last?.startedAt ?? last?.createdAt;
        if (done) {
          trainedAt = new Date(done).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }
        const details = await fetch(base).then((r) => r.json());
        const d = details?.data ?? {};
        labels = (d.model?.labels?.length ? d.model.labels : d.dataset?.labels ?? []).map(String);
        if (d.model?.trainedAt) {
          trainedAt = new Date(d.model.trainedAt).toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }
        // Use the model the way any app would, through its deployed URL (the one Export shows).
        // The labels, type and training time come from that URL.
        if (trained) {
          const dep = await fetch(`${config.apiBaseUrl}${config.api.guests.deploy(sessionId, projectId)}`, { method: 'POST' }).then((r) => r.json());
          if (!dep?.path) throw new Error('not deployed');
          url = `${config.apiBaseUrl}${dep.path}`;
          const info = await fetch(url).then((r) => r.json());
          if (Array.isArray(info?.labels) && info.labels.length) labels = info.labels.map(String);
          if (info?.modelType) modelType = MODEL_TYPES[info.modelType] ?? String(info.modelType);
          if (info?.trainedAt) trainedAt = shortDate(info.trainedAt);
        }
      } catch {
        /* treated as not trained */
        trained = false;
      }
      if (alive) setMl({ trained: trained && labels.length > 0, labels, modelType, trainedAt, url });
    })();
    return () => {
      alive = false;
    };
  }, [kind, sessionId, projectId, base]);

  /** POST {url}/predict on the deployed model: JSON for text, a "file" upload for images. */
  const deployedUrl = ml?.url;
  const callDeployed = useCallback(
    async (body: FormData | { text: string }) => {
      if (!deployedUrl) throw new Error('Your model is not deployed yet. Train it on the Train the AI page.');
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
    [deployedUrl],
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

  const model = ml ? { name: projectName, type: ml.modelType, trainedAt: ml.trainedAt, url: ml.url } : undefined;
  const mlOptions: MlOptions | undefined = ml
    ? kind === 'image'
      ? { kind: 'image', trained: ml.trained, labels: ml.labels, model, recogniseImage }
      : { kind: 'text', trained: ml.trained, labels: ml.labels, model, recognise: predictDeployed }
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
            labels={ml.labels}
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
            // remount when the model becomes available so the ML Model blocks appear
            key={ml.trained ? `ml:${kind}:${ml.labels.join('|')}` : 'no-ml'}
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
