"use client";

import { useEffect, useRef, useState } from "react";
import type { DatasetMeta, ModelId, PredictView, RunView } from "../lib/types";
import { MODELS, paramSummary } from "../lib/models";
import { num, pct, pct0, points, runtimeLabel, spreadOf } from "../lib/format";
import { Icon, type IconName } from "./Icon";

interface Props {
  dataset: DatasetMeta;
  model: ModelId;
  training: boolean;
  run: RunView | null;
  runs: RunView[];
  imageSrc: (index: number) => string;
  onTrain: () => void;
  onStop: () => void;
  onSelectRun: (runId: string) => void;
  onOpenParams: () => void;
  onPredictFile: (file: File) => Promise<PredictView>;
}

function LearningCurve({ run, baseRate }: { run: RunView; baseRate: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const accRef = useRef<SVGPathElement>(null);
  const lossRef = useRef<SVGPathElement>(null);
  const [box, setBox] = useState({ w: 320, h: 140 });
  const [hover, setHover] = useState<number | null>(null);
  const live = run.status === "running" || run.phase === "scoring";
  const stepLabel = run.model === "knn" ? "Images" : run.model === "rf" ? "Trees" : "Epoch";
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const watch = new ResizeObserver(() => setBox({ w: Math.max(240, node.clientWidth), h: Math.max(90, node.clientHeight) }));
    watch.observe(node);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    for (const path of [accRef.current, lossRef.current]) {
      if (!path) continue;
      const length = path.getTotalLength();
      if (!length) continue;
      path.style.transition = "none";
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${Math.max(0, length * 0.08)}`;
      requestAnimationFrame(() => {
        path.style.transition = "stroke-dashoffset .45s ease-out";
        path.style.strokeDashoffset = "0";
      });
    }
  }, [run.log.length, box.w, box.h]);
  useEffect(() => {
    setHover(null);
  }, [run.id]);
  const width = box.w;
  const height = box.h;
  const end = Math.max(1, run.steps, ...run.log.map((point) => point.e));
  const left = 38;
  const right = 38;
  const top = 8;
  const bottom = 22;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const x = (step: number) => left + (Math.min(step, end) / end) * innerW;
  const yAcc = (value: number) => top + (1 - value) * innerH;
  const yLoss = (value: number) => top + (1 - Math.min(value, 2.5) / 2.5) * innerH;
  const accPath = run.log.map((point, index) => `${index ? "L" : "M"}${x(point.e).toFixed(1)} ${yAcc(point.acc).toFixed(1)}`).join(" ");
  const lossPath = run.log.map((point, index) => `${index ? "L" : "M"}${x(point.e).toFixed(1)} ${yLoss(point.loss).toFixed(1)}`).join(" ");
  const last = run.log[run.log.length - 1];
  const tip = hover != null ? run.log[hover] : null;
  const note = run.done
    ? `Finished · validation ${pct(run.valAcc)} · test ${pct(run.res?.acc)}`
    : run.phase === "scoring"
      ? "Scoring the Testing Data once…"
      : run.status === "running"
        ? "Live scores use the validation slice"
        : "";

  const nearestIndex = (clientX: number) => {
    const node = ref.current;
    if (!node || !run.log.length) return null;
    const bounds = node.getBoundingClientRect();
    const localX = ((clientX - bounds.left) / Math.max(1, bounds.width)) * width;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    run.log.forEach((point, index) => {
      const dist = Math.abs(x(point.e) - localX);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    return best;
  };

  const tipX = tip ? x(tip.e) : 0;
  const tipLeft = tip ? Math.min(Math.max(8, tipX - 70), Math.max(8, width - 148)) : 0;

  return (
    <div className={`curve-box${live ? " live" : ""}`}>
      <div className="legend">
        <span>
          <i style={{ background: "var(--lime-t)" }} />
          Validation accuracy
        </span>
        <span>
          <i style={{ background: "var(--mag)" }} />
          Validation loss
        </span>
        <span>{note}</span>
      </div>
      <div
        className="fill"
        ref={ref}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => setHover(nearestIndex(event.clientX))}
      >
        {run.log.length === 0 ? (
          <p className="try-empty" style={{ margin: "auto", textAlign: "center" }}>
            Curve appears as validation scores arrive
          </p>
        ) : (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Learning curve">
              {[0, 0.5, 1].map((value) => (
                <g key={value}>
                  <line x1={left} x2={width - right} y1={yAcc(value)} y2={yAcc(value)} style={{ stroke: "var(--line)" }} />
                  <text x={left - 6} y={yAcc(value) + 4} textAnchor="end" style={{ fill: "var(--lime-t)", font: "11px var(--f-mono)" }}>
                    {value * 100}%
                  </text>
                  <text x={width - right + 6} y={yAcc(value) + 4} style={{ fill: "var(--mag-t)", font: "11px var(--f-mono)" }}>
                    {(value * 2.5).toFixed(1)}
                  </text>
                </g>
              ))}
              <line x1={left} x2={width - right} y1={yAcc(baseRate)} y2={yAcc(baseRate)} style={{ stroke: "var(--dim)", strokeDasharray: "3 4" }} />
              <text x={width - right - 4} y={yAcc(baseRate) - 4} textAnchor="end" style={{ fill: "var(--muted)", font: "10px var(--f-body)" }}>
                biggest-class guess
              </text>
              <text x={left + innerW / 2} y={height - 5} textAnchor="middle" style={{ fill: "var(--muted)", font: "11px var(--f-body)" }}>
                {MODELS[run.model].stepName}
              </text>
              {last && live ? (
                <line
                  className="curve-scan"
                  x1={x(last.e)}
                  x2={x(last.e)}
                  y1={top}
                  y2={height - bottom}
                  style={{ stroke: "var(--lime-t)", strokeWidth: 1.5, strokeDasharray: "4 4", opacity: 0.55 }}
                />
              ) : null}
              {lossPath ? <path ref={lossRef} className="curve-line loss" d={lossPath} /> : null}
              {accPath ? <path ref={accRef} className="curve-line acc" d={accPath} /> : null}
              {run.log.map((point, index) => (
                <g key={`pt-${point.e}-${index}`} className={`curve-dot${hover === index ? " on" : ""}`}>
                  <circle cx={x(point.e)} cy={yAcc(point.acc)} r={hover === index ? 4.5 : 2.5} style={{ fill: "var(--lime-t)", opacity: hover === index ? 1 : 0.55 }} />
                  <circle cx={x(point.e)} cy={yLoss(point.loss)} r={hover === index ? 4.5 : 2.5} style={{ fill: "var(--mag)", opacity: hover === index ? 1 : 0.55 }} />
                </g>
              ))}
              {tip ? (
                <line
                  className="curve-hover-line"
                  x1={tipX}
                  x2={tipX}
                  y1={top}
                  y2={height - bottom}
                  style={{ stroke: "var(--text)", strokeWidth: 1, strokeDasharray: "3 3", opacity: 0.35 }}
                />
              ) : null}
              {last && hover !== run.log.length - 1 ? (
                <g className={`curve-tip${live ? " pulse" : ""}`}>
                  <circle cx={x(last.e)} cy={yAcc(last.acc)} r={live ? 7 : 5} className="tip-ring acc" />
                  <circle cx={x(last.e)} cy={yAcc(last.acc)} r={5} style={{ fill: "var(--lime-t)", stroke: "var(--panel)", strokeWidth: 2 }} />
                  <circle cx={x(last.e)} cy={yLoss(last.loss)} r={live ? 7 : 5} className="tip-ring loss" />
                  <circle cx={x(last.e)} cy={yLoss(last.loss)} r={5} style={{ fill: "var(--mag)", stroke: "var(--panel)", strokeWidth: 2 }} />
                </g>
              ) : null}
            </svg>
            {tip ? (
              <div className="curve-tip-card" style={{ left: tipLeft }} role="status">
                <b>
                  {stepLabel} {tip.e}
                </b>
                <span>
                  <i style={{ background: "var(--lime-t)" }} />
                  Acc {pct(tip.acc)}
                </span>
                <span>
                  <i style={{ background: "var(--mag)" }} />
                  Loss {tip.loss.toFixed(3)}
                </span>
                <span>
                  P {pct0(tip.P)} · R {pct0(tip.R)}
                </span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function seedField(k: number): { cls: { p: number; r: number }[]; P: number; R: number } {
  const cls = Array.from({ length: k }, (_, index) => ({
    p: 0.34 + ((index * 5) % 7) * 0.012,
    r: 0.34 + ((index * 3) % 7) * 0.012,
  }));
  const P = cls.reduce((sum, row) => sum + row.p, 0) / Math.max(1, k);
  const R = cls.reduce((sum, row) => sum + row.r, 0) / Math.max(1, k);
  return { cls, P, R };
}

function ClassField({
  dataset,
  run,
  runs,
  imageSrc,
  training,
}: {
  dataset: DatasetMeta;
  run: RunView | null;
  runs: RunView[];
  imageSrc: (index: number) => string;
  training: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 220 });
  const [disp, setDisp] = useState<{ cls: { p: number; r: number }[]; P: number; R: number } | null>(null);
  const targetRef = useRef<{ cls: { p: number; r: number }[]; P: number; R: number } | null>(null);
  const liveRef = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const watch = new ResizeObserver(() => setBox({ w: Math.max(240, node.clientWidth), h: Math.max(160, node.clientHeight) }));
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  const target = (() => {
    if (!run) return null;
    if (run.done && run.res) {
      return {
        cls: run.res.cls.map((row) => ({ p: row.p, r: row.r })),
        P: run.res.P,
        R: run.res.R,
      };
    }
    if (run.log.length) {
      const last = run.log[run.log.length - 1];
      return { cls: last.cls.map((row) => ({ p: row.p, r: row.r })), P: last.P, R: last.R };
    }
    return seedField(dataset.K);
  })();
  targetRef.current = target;
  const live = Boolean(run && (!run.done || training));
  liveRef.current = live;
  const runId = run?.id ?? "";
  const runDone = Boolean(run?.done);
  const logLen = run?.log.length ?? 0;

  useEffect(() => {
    if (!runId) {
      setDisp(null);
      return undefined;
    }
    let frame = 0;
    let raf = 0;
    let active = true;
    let current = seedField(dataset.K);
    setDisp(current);
    const step = () => {
      if (!active) return;
      frame += 1;
      const goal = targetRef.current;
      if (!goal) {
        raf = window.requestAnimationFrame(step);
        return;
      }
      if (current.cls.length !== goal.cls.length) current = goal;
      const speed = liveRef.current ? 0.11 : 0.18;
      const wobble = liveRef.current ? 0.018 : 0;
      let drift = 0;
      current = {
        P: lerp(current.P, goal.P, speed),
        R: lerp(current.R, goal.R, speed),
        cls: goal.cls.map((row, index) => {
          const from = current.cls[index] ?? row;
          const p = Math.min(1, Math.max(0, lerp(from.p, row.p, speed) + wobble * Math.sin(frame / 11 + index * 1.7)));
          const r = Math.min(1, Math.max(0, lerp(from.r, row.r, speed) + wobble * Math.cos(frame / 13 + index * 1.3)));
          drift = Math.max(drift, Math.abs(p - row.p), Math.abs(r - row.r));
          return { p, r };
        }),
      };
      drift = Math.max(drift, Math.abs(current.P - goal.P), Math.abs(current.R - goal.R));
      setDisp(current);
      if (liveRef.current || drift > 0.004) raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => {
      active = false;
      window.cancelAnimationFrame(raf);
    };
  }, [dataset.K, runId, training, runDone, logLen]);

  const width = box.w;
  const height = box.h;
  const left = 44;
  const right = 18;
  const top = 22;
  const bottom = 40;
  const lo = 0.3;
  const span = 1 - lo;
  const plotW = Math.max(1, width - left - right);
  const plotH = Math.max(1, height - top - bottom);
  const pad = 0.06;
  const x = (value: number) => {
    const t = (Math.min(1, Math.max(lo, value)) - lo) / span;
    return left + (pad + t * (1 - 2 * pad)) * plotW;
  };
  const y = (value: number) => {
    const t = (Math.min(1, Math.max(lo, value)) - lo) / span;
    return top + (1 - (pad + t * (1 - 2 * pad))) * plotH;
  };
  const ticks: number[] = [];
  for (let value = lo; value <= 1.0001; value += 0.1) ticks.push(Number(value.toFixed(2)));
  const current = disp;
  const past = runs.filter((item) => item.done && item.id !== run?.id && item.res);
  const size = Math.max(16, Math.min(24, Math.min(plotW, plotH) / 15));
  const tick = run?.log.length ?? 0;
  const trails = live && run ? run.log.slice(-6, -1) : [];
  const greatLeft = x(0.9);
  const greatTop = y(1);
  const greatW = Math.max(0, x(1) - x(0.9));
  const greatH = Math.max(0, y(0.9) - y(1));
  const hunting = Boolean(run && !run.done && run.log.length === 0);
  return (
    <div className={`field${live ? " live" : ""}${hunting ? " hunting" : ""}`} ref={ref} data-tick={tick}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Precision and recall of every class">
        <rect x={left} y={top} width={plotW} height={plotH} rx={6} style={{ fill: "transparent", stroke: "var(--line)", strokeWidth: 1 }} />
        <rect x={greatLeft} y={greatTop} width={greatW} height={greatH} style={{ fill: "var(--green)", opacity: 0.12 }} />
        {live ? <rect className="field-scan" x={left} y={top} width={Math.max(8, plotW * 0.12)} height={plotH} /> : null}
        {ticks.map((value) => (
          <g key={value}>
            <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} style={{ stroke: "var(--line)", opacity: 0.85 }} />
            <line x1={x(value)} x2={x(value)} y1={top} y2={height - bottom} style={{ stroke: "var(--line)", opacity: 0.85 }} />
            <text x={left - 7} y={y(value) + 3.5} textAnchor="end" style={{ fill: "var(--muted)", font: "10px var(--f-mono)" }}>
              {Math.round(value * 100)}
            </text>
            <text x={x(value)} y={height - bottom + 14} textAnchor="middle" style={{ fill: "var(--muted)", font: "10px var(--f-mono)" }}>
              {Math.round(value * 100)}
            </text>
          </g>
        ))}
        {greatW > 40 ? (
          <text x={greatLeft + 6} y={greatTop + 12} style={{ fill: "var(--green-t)", font: "600 10px var(--f-body)" }}>
            great at both
          </text>
        ) : null}
        <text x={left + plotW / 2} y={height - 6} textAnchor="middle" style={{ fill: "var(--muted)", font: "600 10px var(--f-body)" }}>
          recall → (how many real ones it finds)
        </text>
        <text transform={`translate(12 ${top + plotH / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: "var(--muted)", font: "600 10px var(--f-body)" }}>
          precision → (how often a guess is right)
        </text>
        {past.map((item) =>
          item.res?.cls.map((row, index) => (
            <circle key={`${item.id}-${index}`} cx={x(row.r)} cy={y(row.p)} r={3.5} style={{ fill: "var(--mag)" }} opacity={0.28} />
          )),
        )}
        {trails.map((point, trail) =>
          point.cls.map((row, index) => (
            <circle
              key={`trail-${trail}-${index}`}
              cx={x(row.r)}
              cy={y(row.p)}
              r={2.4}
              style={{ fill: "var(--mag)" }}
              opacity={0.12 + trail * 0.06}
            />
          )),
        )}
        {current
          ? dataset.classes.map((cls, index) => {
              const row = current.cls[index];
              if (!row) return null;
              return (
                <g key={cls.name} className="fdot" style={{ transform: `translate(${x(row.r)}px, ${y(row.p)}px)` }}>
                  <title>{cls.name}</title>
                  <g className={live ? "fdot-live" : undefined} style={live ? { animationDelay: `${index * 70}ms` } : undefined}>
                    <rect x={-size / 2 - 2} y={-size / 2 - 2} width={size + 4} height={size + 4} rx={5} style={{ fill: "var(--mag)" }} />
                    <image href={imageSrc(dataset.rep[index])} x={-size / 2} y={-size / 2} width={size} height={size} preserveAspectRatio="xMidYMid slice" />
                  </g>
                </g>
              );
            })
          : null}
        {current ? (
          <g className="fdot avg" style={{ transform: `translate(${x(current.R)}px, ${y(current.P)}px)` }}>
            {live ? <circle r={12} className="avg-ring" /> : null}
            <g className={live ? "fdot-live" : undefined}>
              <path d="M0 -9l9 9-9 9-9-9z" style={{ fill: "var(--text)", stroke: "var(--panel)", strokeWidth: 2 }} />
            </g>
          </g>
        ) : null}
      </svg>
      {hunting ? <div className="field-hint">Learning where each class lands…</div> : null}
    </div>
  );
}

function Scorecard({ run }: { run: RunView }) {
  const scored = run.res;
  if (!scored) return null;
  const spread = spreadOf(scored.cls);
  const conf = scored.conf.length ? scored.conf.reduce((sum, value) => sum + value, 0) / scored.conf.length : null;
  const wrong = scored.m - scored.cls.reduce((sum, row) => sum + row.tp, 0);
  const f1 = scored.P + scored.R > 0 ? (2 * scored.P * scored.R) / (scored.P + scored.R) : 0;
  const cards: { label: string; value: string; tone: string; tip: string }[] = [
    { label: "Accuracy", value: pct(scored.acc), tone: "lime", tip: "Correct labels overall" },
    { label: "Precision", value: pct(scored.P), tone: "cyan", tip: "Guesses that were right" },
    { label: "Recall", value: pct(scored.R), tone: "mag", tip: "Real cases it found" },
    { label: "F1", value: pct(f1), tone: "lime", tip: "Precision + recall blend" },
    { label: "Log loss", value: scored.loss.toFixed(3), tone: "", tip: "Lower = surer on truth" },
    { label: "Confidence", value: pct(conf), tone: "cyan", tip: "How sure of its guess" },
    { label: "Mistakes", value: String(wrong), tone: wrong ? "mag" : "lime", tip: "Wrong test images" },
    { label: "Spread", value: `${points(spread)} pts`, tone: "", tip: "Recall gap across classes" },
  ];
  return (
    <div className="scorecard side" aria-label="Test scorecard">
      <div className="scorecard-head">
        <b>Scorecard</b>
        <span>
          Run {run.no} · {MODELS[run.model].short} · test
        </span>
      </div>
      <div className="scorecard-grid">
        {cards.map((card) => (
          <div key={card.label} className={`score-chip ${card.tone}`} title={card.tip}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.tip}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function TryImageBox({
  dataset,
  ready,
  training,
  onPredictFile,
}: {
  dataset: DatasetMeta;
  ready: boolean;
  training: boolean;
  onPredictFile: (file: File) => Promise<PredictView>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictView | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const runFile = async (file: File) => {
    if (!ready || training || busy) return;
    if (!/\.(png|jpe?g|bmp|gif|webp)$/i.test(file.name) && !file.type.startsWith("image/")) {
      setError("Choose an image file (png, jpg, …).");
      return;
    }
    setError(null);
    setBusy(true);
    const url = URL.createObjectURL(file);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    try {
      setResult(await onPredictFile(file));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Could not predict that image.");
    } finally {
      setBusy(false);
    }
  };

  const ranked = result
    ? result.probs
        .map((value, index) => ({ index, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
    : [];
  const predicted = result ? dataset.classes[result.pred] : null;
  const confidence = result ? result.probs[result.pred] ?? 0 : 0;
  const locked = !ready || training;

  return (
    <div className={`try-box fill${locked ? " locked" : ""}${busy ? " busy" : ""}${predicted ? " has-result" : ""}`} aria-label="Try one image">
      <div className="try-head">
        <span className="cap" style={{ color: "var(--lime-t)" }}>
          <Icon name="search" />
          Try an image
        </span>
        <span className="try-note">{locked ? (training ? "Wait until training finishes" : "Train a model first") : "Drop one photo to see the prediction"}</span>
      </div>
      <div className="try-body">
        <button
          type="button"
          className="try-drop"
          disabled={locked || busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) void runFile(file);
          }}
        >
          {preview ? (
            <img src={preview} alt="Upload preview" />
          ) : (
            <span className="try-drop-idle">
              <Icon name="upload" size={28} />
              <b>Upload or drop</b>
              <small>png · jpg · webp</small>
            </span>
          )}
          {preview ? <span className="try-replace">Replace image</span> : null}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/bmp,image/gif,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void runFile(file);
          }}
        />
        <div className="try-result" aria-live="polite">
          {error ? <p className="try-error">{error}</p> : null}
          {!error && busy ? <p className="try-wait">Scoring…</p> : null}
          {!error && !busy && predicted ? (
            <>
              <div className="try-call">
                <span>Predicted</span>
                <b>{predicted.name}</b>
                <em>{pct(confidence)}</em>
              </div>
              <div className="try-seen-row">
                {result?.seen ? <img className="try-seen" src={result.seen} alt="What the model saw" title="What the model saw" /> : null}
                <span>What the model saw</span>
              </div>
              <div className="try-top">
                {ranked.map((row) => (
                  <div key={row.index} className={`try-row${row.index === result?.pred ? " win" : ""}`}>
                    <span>{dataset.classes[row.index]?.name ?? dataset.classes[row.index]?.short}</span>
                    <i style={{ width: `${Math.round(row.value * 100)}%` }} />
                    <b>{pct0(row.value)}</b>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {!error && !busy && !predicted ? (
            <div className="try-empty-panel">
              <Icon name="image" size={26} />
              <p>Prediction will show here</p>
              <small>Class · confidence · top scores</small>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function TrainStep(props: Props) {
  const { dataset, model, training, run, runs, imageSrc } = props;
  const [runMenu, setRunMenu] = useState(false);
  const runMenuRef = useRef<HTMLDivElement>(null);
  const doneRuns = runs.filter((item) => item.done && item.res).sort((a, b) => b.no - a.no);

  useEffect(() => {
    if (!runMenu) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (!runMenuRef.current?.contains(event.target as Node)) setRunMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRunMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [runMenu]);

  useEffect(() => {
    setRunMenu(false);
  }, [run?.id]);

  const mosaic: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const group = dataset.byClass[index % dataset.K];
    if (group?.length) mosaic.push(group[(Math.floor(index / dataset.K) * 3 + index) % group.length]);
  }
  const wall = dataset.wall.length ? dataset.wall : mosaic;
  const belt = run?.belt.length ? run.belt : wall.slice(0, 14);
  const beltKey = belt.join("-");
  useEffect(() => {
    // Warm the browser cache so conveyor swaps do not flash empty tiles.
    for (const index of belt) {
      const probe = new Image();
      probe.decoding = "async";
      probe.src = imageSrc(index);
    }
  }, [beltKey]); // imageSrc only changes with dataset.key, which rebuilds wall/belt
  const brain: IconName = run?.model === "knn" ? "search" : run?.model === "rf" ? "tree" : "brain";
  const predictReady = Boolean((run?.done && run.res && !training) || runs.some((item) => item.done && item.res));
  const startingNext = Boolean(training && (!run || run.done));
  const phaseNote =
    startingNext
      ? "Starting next run…"
      : !run || run.done
      ? ""
      : run.phase === "fitting" || run.phase === "loading"
        ? "Fitting on the training pool…"
        : run.phase === "scoring" && run.model === "knn"
          ? `Checking validation · ${num(run.live.seen)} / ${num(dataset.valCount)}`
          : run.status === "running"
            ? `Live validation · step ${run.live.step}${run.steps ? ` / ${run.steps}` : ""}`
            : "Working…";
  const beltLoop = [...belt, ...belt];
  const progress = startingNext ? 0 : Math.max(0, Math.min(1, run?.live.progress ?? 0));
  return (
    <div className="page fit train-page">
      <div className="app train-app no-bench">
        <section className="panel stage-panel">
          <div className="ph stage-ph">
            <span className="cap" style={{ color: "var(--lime-t)" }}>
              <Icon name="pulse" />
              Live training
            </span>
            <div className="train-meta">
              <button
                type="button"
                className="train-model"
                disabled={training}
                title={training ? "Stop training to edit parameters" : "Edit model parameters"}
                onClick={props.onOpenParams}
              >
                {MODELS[model].name}
                <Icon name="sliders" size={13} />
              </button>
            </div>
            <button type="button" className={`train-btn header${training ? " stop" : ""}`} onClick={training ? props.onStop : props.onTrain}>
              {training ? (
                <>
                  <Icon name="stop" />
                  Stop
                  <span className="prog" style={{ width: `${Math.round(progress * 100)}%` }} />
                </>
              ) : (
                <>
                  <Icon name="play" />
                  Train
                </>
              )}
            </button>
          </div>
          <div className="stage-body" aria-live="polite">
            {!run && !training ? (
              <div className="empty">
                <div className="wall" aria-hidden="true">
                  {wall.map((index, position) => (
                    <img
                      key={`wall-${position}-${index}`}
                      src={imageSrc(index)}
                      alt=""
                      decoding="async"
                      loading={position < 20 ? "eager" : "lazy"}
                      draggable={false}
                      onError={(event) => {
                        event.currentTarget.style.opacity = "0";
                      }}
                    />
                  ))}
                </div>
                <div className="intro">
                  <h2>Ready to train</h2>
                  <p>
                    The model learns from all <b style={{ color: "var(--text)" }}>{num(dataset.trainCount)}</b> training images.
                    A <b style={{ color: "var(--text)" }}>{num(dataset.valCount)}</b>-image slice is used for live validation scores while it trains, and the{" "}
                    <b style={{ color: "var(--text)" }}>{num(dataset.nte)}</b> testing images are scored once after training.
                  </p>
                  <div className="how">
                    <div>
                      <i>1</i>
                      <span>
                        Tap the model name above to open parameters in a popup.
                      </span>
                    </div>
                    <div>
                      <i>2</i>
                      <span>
                        Press <b>Train</b> and watch the learning curve and class spread update live.
                      </span>
                    </div>
                    <div>
                      <i>3</i>
                      <span>When training finishes, try your own image in the box beside the curve.</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`train-live${run?.done && run.res && !training ? " done" : ""}`}>
                {startingNext || (run && !run.done) ? (
                  <div className={`conveyor${training ? " running" : ""}`} style={{ ["--belt-speed" as string]: `${1.35 - progress * 0.55}s` }}>
                    <div className="conv-lbl">
                      <b>
                        {startingNext
                          ? `Next → ${MODELS[model].short}`
                          : `Run ${run!.no} → ${MODELS[run!.model].short}`}
                      </b>
                      <em>
                        {startingNext
                          ? phaseNote
                          : phaseNote || paramSummary(run!.model, run!.params)}
                      </em>
                    </div>
                    <div className="ex4-belt">
                      <div className="ex4-belt-in" key={beltKey}>
                        {beltLoop.map((index, position) => (
                          <img
                            key={`${position}-${index}`}
                            src={imageSrc(index)}
                            alt=""
                            decoding="async"
                            loading="eager"
                            draggable={false}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="brain">
                      <Icon name={startingNext ? (model === "knn" ? "search" : model === "rf" ? "tree" : "brain") : brain} size={24} />
                    </div>
                    <span className="conv-progress" aria-hidden="true" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </div>
                ) : run ? (
                  <div className="run-chip">
                    <div className={`run-switch${runMenu ? " open" : ""}`} ref={runMenuRef}>
                      <button
                        type="button"
                        className="run-switch-btn"
                        aria-haspopup="listbox"
                        aria-expanded={runMenu}
                        disabled={doneRuns.length < 2}
                        title={doneRuns.length < 2 ? "Train another model to compare runs" : "Switch run"}
                        onClick={() => setRunMenu((open) => !open)}
                      >
                        <b>
                          Run {run.no}
                          <span className="run-switch-model"> · {MODELS[run.model].short}</span>
                        </b>
                        {doneRuns.length > 1 ? <Icon name="next" size={14} /> : null}
                      </button>
                      {runMenu ? (
                        <div className="run-menu" role="listbox" aria-label="Training runs">
                          {doneRuns.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              role="option"
                              aria-selected={item.id === run.id}
                              className={item.id === run.id ? "on" : ""}
                              onClick={() => {
                                props.onSelectRun(item.id);
                                setRunMenu(false);
                              }}
                            >
                              <span>
                                Run {item.no} · {MODELS[item.model].short}
                              </span>
                              <em>{pct(item.res?.acc)}</em>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span>
                      Total runtime <em>{runtimeLabel(run.runtimeMs)}</em>
                    </span>
                  </div>
                ) : null}
                <div className="tgrid">
                  {predictReady ? (
                    <TryImageBox dataset={dataset} ready={predictReady} training={training} onPredictFile={props.onPredictFile} />
                  ) : (
                    <div className="try-box fill locked viz-wait-box">
                      <div className="try-head">
                        <span className="cap" style={{ color: "var(--lime-t)" }}>
                          <Icon name="search" />
                          Try an image
                        </span>
                        <span className="try-note">Wait until training finishes</span>
                      </div>
                      <div className="try-empty-panel">
                        <Icon name="image" size={26} />
                        <p>Available after training</p>
                        <small>Drop a photo here once the run completes</small>
                      </div>
                    </div>
                  )}
                  {run && !startingNext ? <LearningCurve run={run} baseRate={dataset.baseRate} /> : (
                    <div className="curve-box">
                      <div className="legend">
                        <span>
                          <i style={{ background: "var(--lime-t)" }} />
                          Validation accuracy
                        </span>
                        <span>
                          <i style={{ background: "var(--mag)" }} />
                          Validation loss
                        </span>
                        <span>{startingNext ? "Starting…" : ""}</span>
                      </div>
                      <div className="fill">
                        <p className="try-empty" style={{ margin: "auto", textAlign: "center" }}>
                          {startingNext ? "Next run is starting…" : "Curve appears as validation scores arrive"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
        <aside className="panel field-panel" aria-label="Precision and recall per class">
          <div className="ph">
            <span className="cap" style={{ color: "var(--cyan-t)" }}>
              <Icon name="target" />
              Class spread
            </span>
            <div className="flegend top">
              <span>
                <i style={{ background: "var(--mag)" }} />
                each class
              </span>
              <span>◆ average</span>
            </div>
          </div>
          <div className="field-body">
            <ClassField dataset={dataset} run={startingNext ? null : run} runs={runs} imageSrc={imageSrc} training={training} />
            {run?.done && run.res && !training ? <Scorecard run={run} /> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
