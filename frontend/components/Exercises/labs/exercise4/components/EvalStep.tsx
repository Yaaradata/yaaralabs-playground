"use client";

import type { CSSProperties } from "react";
import type { DatasetMeta, RunView } from "../lib/types";
import type { IconName } from "./Icon";
import { MODELS } from "../lib/models";
import { heat, num, pct, pct0, points, spreadOf } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  dataset: DatasetMeta;
  run: RunView;
  runs: RunView[];
  imageSrc: (index: number) => string;
  onRun: (id: string) => void;
  onCell: (row: number, col: number) => void;
}

type Miss = { offset: number; index: number; real: number; guess: number; conf: number };
type Tone = "lime" | "cyan" | "mag" | "muted";

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function confBins(values: number[]): number[] {
  const bins = [0, 0, 0, 0, 0];
  values.forEach((value) => {
    const slot = Math.min(4, Math.floor(value * 5));
    bins[slot] += 1;
  });
  return bins;
}

function MetricCard({
  tone,
  icon,
  title,
  value,
  blurb,
}: {
  tone: Tone;
  icon: IconName;
  title: string;
  value: string;
  blurb: string;
}) {
  return (
    <article className={`ask-card ${tone}`}>
      <span className="ask-ico" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <span className="ask-copy">
        <b>{title}</b>
        <span>{blurb}</span>
      </span>
      <span className="ask-go">{value}</span>
    </article>
  );
}

export function EvalStep({ dataset, run, runs, imageSrc, onRun, onCell }: Props) {
  const scored = run.res;
  if (!scored) return null;
  const spread = spreadOf(scored.cls);
  const pairs: { a: number; c: number; v: number }[] = [];
  scored.cm.forEach((row, a) =>
    row.forEach((value, c) => {
      if (a !== c && value) pairs.push({ a, c, v: value });
    }),
  );
  pairs.sort((left, right) => right.v - left.v);

  const misses: Miss[] = [];
  scored.pred.forEach((guess, offset) => {
    const index = dataset.ntr + offset;
    const real = dataset.y[index];
    if (real === guess) return;
    misses.push({ offset, index, real, guess, conf: scored.conf[offset] ?? 0 });
  });
  misses.sort((left, right) => right.conf - left.conf);

  const confAll = scored.conf;
  const confRight = scored.pred
    .map((guess, offset) => (dataset.y[dataset.ntr + offset] === guess ? scored.conf[offset] : null))
    .filter((value): value is number => value != null);
  const confWrong = misses.map((item) => item.conf);
  const bins = confBins(confAll);
  const binMax = Math.max(1, ...bins);
  const avgConf = mean(confAll);

  const firstIndex = (real: number, guess: number) => {
    for (let i = 0; i < scored.pred.length; i += 1) {
      if (dataset.y[dataset.ntr + i] === real && scored.pred[i] === guess) return dataset.ntr + i;
    }
    return dataset.rep[real];
  };
  const undefinedNames = scored.cls.map((row, index) => (row.undef ? dataset.classes[index].name : null)).filter((name): name is string => !!name);

  return (
    <div className="page fit eval-page">
      <div className="eval-head">
        <div>
          <h3 className="eval-title">How did the model do?</h3>
          <p className="eval-lead">Read the scores, then check the matrix and the mistakes.</p>
        </div>
        <div className="runpick">
          <span>Showing</span>
          <select aria-label="Choose a run" value={run.id} onChange={(event) => onRun(event.target.value)}>
            {runs
              .filter((item) => item.done && item.res)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  Run {item.no} · {MODELS[item.model].name} · {num(item.n)} imgs · {pct(item.res?.acc)}
                </option>
              ))}
          </select>
        </div>
      </div>

      {undefinedNames.length || dataset.dupes ? (
        <div className="eval-notes">
          {undefinedNames.length ? (
            <span>
              <Icon name="alert" size={13} />
              Never predicted: <b>{undefinedNames.join(", ")}</b>. Their precision counts as 0 in the average.
            </span>
          ) : null}
          {dataset.dupes ? (
            <span>
              <Icon name="alert" size={13} />
              {num(dataset.dupes)} test image{dataset.dupes > 1 ? "s match" : " matches"} a training image, so this score is optimistic.
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="eval-block" aria-labelledby="eval-metrics">
        <h4 id="eval-metrics">Performance metrics</h4>
        <div className="ask-grid">
          <MetricCard
            tone="lime"
            icon="target"
            title="Accuracy"
            value={pct(scored.acc)}
            blurb="Percentage of total images the model classifies correctly."
          />
          <MetricCard
            tone="cyan"
            icon="check"
            title="Precision"
            value={pct(scored.P)}
            blurb="How many predicted positive images were correct (avg across classes)."
          />
          <MetricCard
            tone="mag"
            icon="search"
            title="Recall"
            value={pct(scored.R)}
            blurb="How many actual positive images the model found (avg across classes)."
          />
          <MetricCard
            tone="cyan"
            icon="pulse"
            title="Log loss"
            value={scored.loss.toFixed(3)}
            blurb="Uncertainty of the model’s probabilities. Lower scores mean better confidence."
          />
          <MetricCard
            tone="muted"
            icon="grid"
            title="mAP"
            value="—"
            blurb="Object-detection score for boxes and classes. Not used in this classification lab."
          />
          <MetricCard
            tone="lime"
            icon="report"
            title="Recall spread"
            value={`${points(spread)} pts`}
            blurb={`${dataset.classes[spread.loI]?.short} → ${dataset.classes[spread.hiI]?.short}. One score can hide weak classes.`}
          />
        </div>
      </section>

      <section className="eval-block" aria-labelledby="eval-viz">
        <h4 id="eval-viz">Visual and diagnostic results</h4>
        <div className="ask-grid diag">
          <MetricCard
            tone="mag"
            icon="grid"
            title="Confusion matrix"
            value={`${dataset.K}×${dataset.K}`}
            blurb="Correct predictions versus mislabeled classes — which images get mixed up."
          />
          <MetricCard
            tone="cyan"
            icon="pulse"
            title="Confidence scores"
            value={pct(avgConf)}
            blurb="Probability the model assigns to its guess. Helps set thresholds for accepting results."
          />
          <MetricCard
            tone="lime"
            icon="alert"
            title="False positives & negatives"
            value={String(misses.length)}
            blurb="Images it failed on — look for patterns like dark lighting or weird angles."
          />
        </div>

        <div className="eval">
          <div className="mbox">
            <h4>
              Confusion matrix <span>rows = real · columns = guess · click a cell</span>
            </h4>
            <div className="cm" style={{ ["--k" as string]: String(dataset.K), fontSize: dataset.K > 14 ? 10 : undefined }}>
              <div />
              {dataset.classes.map((cls, index) => (
                <div className="ax" key={`g-${cls.name}`} title={`Guessed ${cls.name}`}>
                  <img src={imageSrc(dataset.rep[index])} alt="" style={{ width: "100%", maxWidth: 26, aspectRatio: "1", borderRadius: 3, objectFit: "cover" }} />
                </div>
              ))}
              {scored.cm.map((row, real) => (
                <div key={dataset.classes[real].name} style={{ display: "contents" }}>
                  <div className="rax" title={`Real ${dataset.classes[real].name}`}>
                    {dataset.classes[real].short}
                    <img src={imageSrc(dataset.rep[real])} alt="" style={{ width: 20, height: 20, borderRadius: 3, objectFit: "cover" }} />
                  </div>
                  {row.map((value, guess) => (
                    <button
                      key={`${real}-${guess}`}
                      type="button"
                      className="c"
                      style={{ ...inlineStyle(heat(value, real === guess, scored.cls[real].rs)), opacity: value ? undefined : 1 }}
                      disabled={!value}
                      title={`Real ${dataset.classes[real].name} → guessed ${dataset.classes[guess].name}: ${value}`}
                      onClick={() => value && onCell(real, guess)}
                    >
                      {value || ""}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="eval-side">
            <div className="mbox">
              <h4>
                Confidence scores <span>right {pct(mean(confRight))} · wrong {pct(mean(confWrong))}</span>
              </h4>
              <div className="conf-bins" role="img" aria-label="Confidence histogram">
                {bins.map((count, index) => (
                  <div key={index} className="conf-bin">
                    <i style={{ height: `${(count / binMax) * 100}%` }} />
                    <span>
                      {index * 20}–{index * 20 + 20}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mbox">
              <h4>
                Biggest mix-ups <span>click to inspect</span>
              </h4>
              <div className="side-list" style={{ flex: "0 0 auto", maxHeight: 200 }}>
                {pairs.slice(0, 5).map((pair) => (
                  <button key={`${pair.a}-${pair.c}`} type="button" className="pair" onClick={() => onCell(pair.a, pair.c)}>
                    <img src={imageSrc(firstIndex(pair.a, pair.c))} alt="" style={{ width: 32, height: 32, borderRadius: 5, objectFit: "cover" }} />
                    <span className="arr">
                      <Icon name="arrow" size={14} />
                    </span>
                    <img src={imageSrc(dataset.rep[pair.c])} alt="" style={{ width: 32, height: 32, borderRadius: 5, objectFit: "cover" }} />
                    <span className="pt">
                      {dataset.classes[pair.a].short} → {dataset.classes[pair.c].short}
                      <small>
                        FN · {dataset.classes[pair.a].short} / FP · {dataset.classes[pair.c].short}
                      </small>
                    </span>
                    <span className="pv">{pair.v}</span>
                  </button>
                ))}
                {pairs.length === 0 ? <span style={{ color: "var(--muted)" }}>No mistakes at all.</span> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="mbox miss-box">
          <h4>
            False positives &amp; negatives <span>failed images, highest confidence first</span>
          </h4>
          {misses.length ? (
            <div className="miss-grid">
              {misses.slice(0, 12).map((item) => (
                <button
                  key={item.index}
                  type="button"
                  className="miss"
                  onClick={() => onCell(item.real, item.guess)}
                  title={`Open all ${dataset.classes[item.real].name} → ${dataset.classes[item.guess].name}`}
                >
                  <img src={imageSrc(item.index)} alt="" />
                  <span className="miss-meta">
                    <b>
                      {dataset.classes[item.real].short} → {dataset.classes[item.guess].short}
                    </b>
                    <em>{pct0(item.conf)} sure</em>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <span style={{ color: "var(--muted)" }}>Every test image was labeled correctly.</span>
          )}
        </div>
      </section>
    </div>
  );
}

function inlineStyle(css: string): CSSProperties {
  const style: Record<string, string> = {};
  css.split(";").forEach((part) => {
    const [key, value] = part.split(":");
    if (!key || !value) return;
    const name = key.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[name] = value.trim();
  });
  return style;
}
