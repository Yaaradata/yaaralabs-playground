'use client';

import React, { useCallback, useRef, useState } from 'react';
import ExerciseShell from '../ExerciseShell';
import UndoButton from '../UndoButton';
import { useUndoHistory } from '../useUndoHistory';
import { EXERCISE_CATALOG } from '../catalog';
import { SIMILARITY_EXAMPLES } from '../examples';
import { useExerciseSession } from '../ExerciseContext';
import { WithExerciseIntro } from '../intro';
import { cosine, embedText } from '../engines/text';
import { runSimilarityLab } from '../labEngine';
import { Alert, ExampleBar } from '../ui';

function heatColor(value: number): string {
  const t = Math.max(0, Math.min(1, (value + 1) / 2));
  const r = Math.round(40 + t * 180);
  const g = Math.round(40 + t * 220);
  const b = Math.round(80 + (1 - t) * 80);
  return `rgb(${r}, ${g}, ${b})`;
}

type Ex7UndoSnapshot = {
  exampleId: string;
  phrases: string;
};

export default function Exercise07() {
  const meta = EXERCISE_CATALOG[6];
  const { embed } = useExerciseSession();
  const [exampleId, setExampleId] = useState(SIMILARITY_EXAMPLES[0].id);
  const [phrases, setPhrases] = useState(SIMILARITY_EXAMPLES[0].phrases.join('\n'));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [heatA, setHeatA] = useState<number[][]>([]);
  const [heatB, setHeatB] = useState<number[][]>([]);
  const [disagreements, setDisagreements] = useState<string[]>([]);

  const liveRef = useRef({ exampleId, phrases });
  liveRef.current = { exampleId, phrases };

  const { push, undo, canUndo } = useUndoHistory<Ex7UndoSnapshot>();
  const phraseUndoArmed = useRef(true);
  const skipUndoPush = useRef(false);

  const captureUndo = useCallback((): Ex7UndoSnapshot => {
    const live = liveRef.current;
    return { exampleId: live.exampleId, phrases: live.phrases };
  }, []);

  const pushUndo = useCallback(() => {
    if (skipUndoPush.current || running) return;
    push(captureUndo());
  }, [captureUndo, push, running]);

  const restoreUndo = useCallback((snap: Ex7UndoSnapshot) => {
    setExampleId(snap.exampleId);
    setPhrases(snap.phrases);
    setHeatA([]);
    setHeatB([]);
    setDisagreements([]);
    setSimulated(false);
    setError(null);
  }, []);

  const handleUndo = useCallback(() => {
    if (running) return;
    const snap = undo();
    if (!snap) return;
    skipUndoPush.current = true;
    try {
      restoreUndo(snap);
      phraseUndoArmed.current = true;
    } finally {
      skipUndoPush.current = false;
    }
  }, [restoreUndo, running, undo]);

  const pick = (id: string) => {
    const next = SIMILARITY_EXAMPLES.find((item) => item.id === id);
    if (!next || id === exampleId) return;
    pushUndo();
    setExampleId(id);
    setPhrases(next.phrases.join('\n'));
    setHeatA([]);
    setHeatB([]);
    setDisagreements([]);
  };

  const onPhrasesChange = (value: string) => {
    if (phraseUndoArmed.current && value !== phrases) {
      pushUndo();
      phraseUndoArmed.current = false;
    }
    setPhrases(value);
    setHeatA([]);
    setHeatB([]);
    setDisagreements([]);
  };

  const run = async () => {
    const local = runSimilarityLab(phrases.split('\n'));
    if (!local.ok) {
      setError(local.error);
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const texts = phrases.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
      const a = await embed(texts, 'text-embedding-005');
      const b = await embed(texts, 'text-embedding-004');
      const vecA = a.embeddings.length === texts.length ? a.embeddings : texts.map((t) => embedText(t, 48, 5));
      const vecB = b.embeddings.length === texts.length ? b.embeddings : texts.map((t) => embedText(t, 48, 3));
      const matrixA = texts.map((_, i) => texts.map((__, j) => cosine(vecA[i], vecA[j])));
      const matrixB = texts.map((_, i) => texts.map((__, j) => cosine(vecB[i], vecB[j])));
      setHeatA(matrixA);
      setHeatB(matrixB);
      setDisagreements(local.data.disagreements);
      setSimulated(a.simulated || b.simulated);
    } catch (err) {
      setHeatA(local.data.matrixA);
      setHeatB(local.data.matrixB);
      setDisagreements(local.data.disagreements);
      setSimulated(true);
      setError(err instanceof Error ? `${err.message} Using classroom embeddings.` : 'Using classroom embeddings.');
    } finally {
      setRunning(false);
    }
  };

  const labels = phrases.split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <WithExerciseIntro exerciseId={meta.id}>
      <ExerciseShell
        meta={meta}
        onRun={run}
        running={running}
        runLabel="Build heatmaps"
        error={error}
        onRetry={run}
        headerActions={
          <UndoButton canUndo={canUndo && !running} onUndo={handleUndo} className="ex-fs-btn" />
        }
        left={
          <div className="space-y-3 text-sm">
            <p>One phrase per line. Ten bundled sets include paraphrase, polysemy, and identical pairs.</p>
            <ExampleBar examples={SIMILARITY_EXAMPLES} activeId={exampleId} onPick={pick} />
            <textarea
              value={phrases}
              onChange={(e) => onPhrasesChange(e.target.value)}
              onBlur={() => {
                phraseUndoArmed.current = true;
              }}
              rows={8}
              className="w-full px-3 py-2 rounded-lg bg-ink border border-magenta-brand/20 font-mono text-xs"
            />
            {simulated ? <Alert kind="warn">Classroom fallback embeddings in use.</Alert> : null}
          </div>
        }
        center={
          <div className="space-y-4 text-sm overflow-auto">
            <div>
              <div className="mb-2 text-white/70">Model A cosine heatmap</div>
              <Heatmap matrix={heatA} labels={labels} />
            </div>
            <div>
              <div className="mb-2 text-white/70">Model B cosine heatmap</div>
              <Heatmap matrix={heatB} labels={labels} />
            </div>
          </div>
        }
        right={
          <div className="space-y-3 text-sm">
            <div className="font-medium">Where the models disagree</div>
            {disagreements.length === 0 ? (
              <p className="text-white/50">Run the experiment. Large Δ cells are the interesting ones.</p>
            ) : (
              disagreements.map((row) => (
                <div key={row} className="rounded border border-magenta-brand/30 p-2 text-xs">
                  {row}
                </div>
              ))
            )}
          </div>
        }
      />
    </WithExerciseIntro>
  );
}

function Heatmap({ matrix, labels }: { matrix: number[][]; labels: string[] }) {
  if (matrix.length === 0) {
    return <p className="text-white/40">No matrix yet.</p>;
  }
  return (
    <div className="overflow-auto">
      <div className="ex-heat" style={{ gridTemplateColumns: `72px repeat(${matrix.length}, minmax(28px, 1fr))` }}>
        <div />
        {labels.map((label, i) => (
          <div key={`h-${i}`} className="text-[9px] text-white/50 truncate">
            {label}
          </div>
        ))}
        {matrix.map((row, i) => (
          <React.Fragment key={`r-${i}`}>
            <div className="text-[9px] text-white/50 truncate">{labels[i]}</div>
            {row.map((value, j) => (
              <div
                key={`${i}-${j}`}
                className="ex-heat-cell"
                style={{ background: heatColor(value) }}
                title={`${labels[i]} × ${labels[j]} = ${value.toFixed(2)}`}
              >
                {value.toFixed(1)}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
