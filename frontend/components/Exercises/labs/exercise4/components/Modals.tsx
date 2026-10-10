"use client";

import { useState, type ReactNode } from "react";
import type { DatasetMeta, LearnTrack, ModelId, ParamMap, RunView } from "../lib/types";
import { MODELS, estimate, modelsForTrack, optLabel } from "../lib/models";
import { num, pct, pct0, points, sameVal, spreadOf } from "../lib/format";
import { Icon } from "./Icon";

export function ModalFrame({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="modal-bg"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" style={wide ? { width: "min(980px, 100%)" } : undefined}>
        <div className="modal-h">
          <h3>{title}</h3>
          <button type="button" className="xbtn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame title="How this exercise works" wide onClose={onClose}>
      <div className="box">
        <h5>1 · Upload data</h5>
        <p>
          Upload a <b>Training Data</b> and a <b>Testing Data</b> folder, each holding one sub-folder per class (80 : 20). A .zip of those folders works too. Images are prepared on the lab server as 64×64 greyscale (letterboxed, not cropped).
        </p>
      </div>
      <div className="box">
        <h5>2 · Train</h5>
        <p>
          Choose Machine Learning or Deep Learning, then train one of its models. Every training image is used to fit the model. Live scores come from a <b>validation</b> slice (about 15% of Training Data). The Testing Data is used only once, after training.
        </p>
      </div>
      <div className="box">
        <h5>3 · Evaluate</h5>
        <p>
          The confusion matrix shows which classes get mixed up. Each class has its own <b>precision</b> (when it says this class, how often it is right) and <b>recall</b> (of the real ones, how many it finds).
        </p>
      </div>
      <div className="box">
        <h5>4 · Test board</h5>
        <p>Drag test images onto the board one by one, step through them with the arrow keys, or drop a photo of your own, and watch the prediction and its confidence.</p>
      </div>
    </ModalFrame>
  );
}

export function PathModal({
  onPick,
  onClose,
}: {
  onPick: (track: LearnTrack, model: ModelId, vals: ParamMap) => void;
  onClose: () => void;
}) {
  const [track, setTrack] = useState<LearnTrack | null>(null);
  const [model, setModel] = useState<ModelId | null>(null);
  const [vals, setVals] = useState<ParamMap | null>(null);
  const models = track ? modelsForTrack(track) : [];
  const spec = model ? MODELS[model] : null;
  const title =
    model && spec
      ? `${spec.short} parameters`
      : track === "ml"
        ? "Machine Learning models"
        : track === "dl"
          ? "Deep Learning models"
          : "Pick your model to start?";

  const pickModel = (id: ModelId) => {
    setModel(id);
    setVals(Object.fromEntries(MODELS[id].params.map((param) => [param.k, param.def])));
  };

  return (
    <ModalFrame title={title} wide onClose={onClose}>
      {track === null ? (
        <>
          <p className="path-lead">Choose Machine Learning or Deep Learning, then pick a model.</p>
          <div className="path-grid">
            <button type="button" className="path-card ml" onClick={() => setTrack("ml")}>
              <span className="path-ico" aria-hidden="true">
                <Icon name="grid" />
              </span>
              <span className="path-copy">
                <b>Machine Learning</b>
                <span>k-NN, Linear SVM, and Random Forest.</span>
              </span>
            </button>
            <button type="button" className="path-card dl" onClick={() => setTrack("dl")}>
              <span className="path-ico" aria-hidden="true">
                <Icon name="brain" />
              </span>
              <span className="path-copy">
                <b>Deep Learning</b>
                <span>MLP or a small CNN.</span>
              </span>
            </button>
          </div>
        </>
      ) : model === null || vals === null || !spec ? (
        <>
          <div className="path-bar">
            <button
              type="button"
              className="sbtn small ghost"
              onClick={() => {
                setTrack(null);
                setModel(null);
                setVals(null);
              }}
            >
              <Icon name="back" />
              Paths
            </button>
            <span className={`path-chip ${track}`}>
              <Icon name={track === "dl" ? "brain" : "grid"} />
              {track === "dl" ? "Deep Learning" : "Machine Learning"}
            </span>
          </div>
          <p className="path-lead">Pick a model, then set its parameters.</p>
          <div className={`path-models ${track}`}>
            {models.map((id) => {
              const row = MODELS[id];
              return (
                <button key={id} type="button" className={`path-model ${track}`} onClick={() => pickModel(id)}>
                  <span className="path-ico" aria-hidden="true">
                    <Icon name={track === "dl" ? "brain" : id === "rf" ? "tree" : id === "knn" ? "search" : "sliders"} />
                  </span>
                  <span className="path-copy">
                    <b>{row.name}</b>
                    <em>{row.short}</em>
                  </span>
                  <span className="path-go">
                    Set parameters
                    <Icon name="next" />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="path-bar">
            <button
              type="button"
              className="sbtn small ghost"
              onClick={() => {
                setModel(null);
                setVals(null);
              }}
            >
              <Icon name="back" />
              Models
            </button>
            <span className={`path-chip ${track}`}>
              <Icon name={track === "dl" ? "brain" : "grid"} />
              {spec.name}
            </span>
          </div>
          <div className="path-params">
            {spec.params.map((param) => (
              <div className="path-param" key={param.k}>
                <b>{param.label}</b>
                <div className="path-segs" role="radiogroup" aria-label={param.label}>
                  {param.opts.map((opt) => (
                    <button
                      key={String(opt)}
                      type="button"
                      className={sameVal(vals[param.k], opt) ? "on" : ""}
                      role="radio"
                      aria-checked={sameVal(vals[param.k], opt)}
                      onClick={() => setVals((prev) => (prev ? { ...prev, [param.k]: opt } : prev))}
                    >
                      {optLabel(param, opt)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="path-foot">
            <button
              type="button"
              className="sbtn ghost"
              onClick={() => setVals(Object.fromEntries(spec.params.map((param) => [param.k, param.def])))}
            >
              <Icon name="reset" size={14} />
              Defaults
            </button>
            <button type="button" className="sbtn lime" onClick={() => onPick(track, model, vals)}>
              <Icon name="check" size={14} />
              Continue
            </button>
          </div>
        </>
      )}
    </ModalFrame>
  );
}

export function ParamsModal({
  model,
  vals,
  dataset,
  frac,
  onChange,
  onReset,
  onSave,
  onTrain,
  onClose,
}: {
  model: ModelId;
  vals: ParamMap;
  dataset: DatasetMeta;
  frac: number;
  onChange: (key: string, value: ParamMap[string]) => void;
  onReset: () => void;
  onSave: () => void;
  onTrain: () => void;
  onClose: () => void;
}) {
  const spec = MODELS[model];
  const changed = spec.params.some((param) => !sameVal(vals[param.k], param.def));
  return (
    <ModalFrame title={`${spec.short} parameters`} wide onClose={onClose}>
      <div className="path-params">
        {spec.params.map((param) => (
          <div className="path-param" key={param.k}>
            <b>{param.label}</b>
            <div className="path-segs" role="radiogroup" aria-label={param.label}>
              {param.opts.map((opt) => (
                <button
                  key={String(opt)}
                  type="button"
                  className={sameVal(vals[param.k], opt) ? "on" : ""}
                  role="radio"
                  aria-checked={sameVal(vals[param.k], opt)}
                  onClick={() => onChange(param.k, opt)}
                >
                  {optLabel(param, opt)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="path-foot">
        <span className="est">
          <Icon name="clock" size={15} />
          <span>{estimate(model, vals, dataset, frac)}</span>
        </span>
        <span className="pp-btns">
          <button type="button" className="sbtn ghost" disabled={!changed} onClick={onReset}>
            <Icon name="reset" size={14} />
            Defaults
          </button>
          <button type="button" className="sbtn" onClick={onSave}>
            Save
          </button>
          <button type="button" className="sbtn lime" onClick={onTrain}>
            <Icon name="play" size={14} />
            Save & train
          </button>
        </span>
      </div>
    </ModalFrame>
  );
}

export function CellModal({
  dataset,
  run,
  real,
  guess,
  imageSrc,
  onOpen,
  onClose,
}: {
  dataset: DatasetMeta;
  run: RunView;
  real: number;
  guess: number;
  imageSrc: (index: number) => string;
  onOpen: (index: number) => void;
  onClose: () => void;
}) {
  const scored = run.res;
  if (!scored) return null;
  const images: { index: number; conf: number }[] = [];
  scored.pred.forEach((pred, offset) => {
    const index = dataset.ntr + offset;
    if (dataset.y[index] === real && pred === guess) images.push({ index, conf: scored.conf[offset] ?? 0 });
  });
  images.sort((left, right) => right.conf - left.conf);
  const title = real === guess ? `${dataset.classes[real].name}: guessed right` : `Real ${dataset.classes[real].name} → guessed ${dataset.classes[guess].name}`;
  return (
    <ModalFrame title={title} wide onClose={onClose}>
      <p style={{ margin: "0 0 12px", color: "var(--muted)" }}>
        {images.length} of the {scored.cls[real]?.rs ?? 0} test images of {dataset.classes[real].name}
        {real === guess ? "." : ". Sorted by how sure the model was. Would you have been fooled?"} Click one to open it on the test board.
      </p>
      <div className="gallery" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gridAutoRows: 72 }}>
        {images.map((item) => (
          <button key={item.index} type="button" className="tt" title={`${pct0(item.conf)} sure`} onClick={() => onOpen(item.index)}>
            <img src={imageSrc(item.index)} alt="" />
          </button>
        ))}
      </div>
    </ModalFrame>
  );
}

export function SummaryModal({
  dataset,
  runs,
  tried,
  right,
  note,
  onClose,
  onRestart,
}: {
  dataset: DatasetMeta;
  runs: RunView[];
  tried: number;
  right: number;
  note: string | null;
  onClose: () => void;
  onRestart: () => void;
}) {
  const done = runs.filter((run) => run.done && run.res);
  const current = done[done.length - 1];
  if (!current?.res) return null;
  const best = done.reduce((lead, run) => ((run.valAcc ?? 0) > (lead.valAcc ?? 0) ? run : lead), done[0]);
  const spread = spreadOf(current.res.cls);
  const pairs: { a: number; c: number; v: number }[] = [];
  current.res.cm.forEach((row, real) =>
    row.forEach((value, guess) => {
      if (real !== guess && value) pairs.push({ a: real, c: guess, v: value });
    }),
  );
  pairs.sort((left, right) => right.v - left.v);
  const top = pairs[0];
  const accuracies = done.map((run) => run.res?.acc ?? 0);
  return (
    <ModalFrame title="Your results" wide onClose={onClose}>
      <div className="rep">
        <div className="rc digits">
          <h4>Your data</h4>
          <dl>
            <dt>Classes</dt>
            <dd>{dataset.K}</dd>
            <dt>Training images</dt>
            <dd>{num(dataset.trainCount)}</dd>
            <dt>Validation images</dt>
            <dd>{num(dataset.valCount)}</dd>
            <dt>Testing images</dt>
            <dd>{num(dataset.nte)}</dd>
            <dt>Biggest-class guess</dt>
            <dd>{pct(dataset.baseRate)}</dd>
          </dl>
        </div>
        <div className="rc dept">
          <h4>
            Run {current.no} <small style={{ font: "500 12px var(--f-body)", color: "var(--muted)" }}>{MODELS[current.model].name}</small>
          </h4>
          <dl>
            <dt>Test accuracy</dt>
            <dd>{pct(current.res.acc)}</dd>
            <dt>Avg precision</dt>
            <dd>{pct(current.res.P)}</dd>
            <dt>Avg recall</dt>
            <dd>{pct(current.res.R)}</dd>
            <dt>Weakest class</dt>
            <dd>
              {dataset.classes[spread.loI]?.short} {pct0(spread.lo)}
            </dd>
            <dt>Strongest class</dt>
            <dd>
              {dataset.classes[spread.hiI]?.short} {pct0(spread.hi)}
            </dd>
          </dl>
        </div>
        <div className="rc text">
          <h4>Test board</h4>
          <dl>
            <dt>Images tried</dt>
            <dd>{tried}</dd>
            <dt>Right</dt>
            <dd>{tried ? `${right} (${pct0(right / tried)})` : "—"}</dd>
            <dt>Runs trained</dt>
            <dd>{done.length}</dd>
            <dt>Best on validation</dt>
            <dd>
              Run {best.no} · test {pct(best.res?.acc)}
            </dd>
          </dl>
        </div>
      </div>
      {note ? <p className="hempty" style={{ marginTop: 12 }}>{note}</p> : null}
      <div className="findings">
        <div>
          <i>1</i>
          <span>
            <b>One score hides a lot.</b> Overall accuracy is {pct(current.res.acc)}, but recall runs from {pct0(spread.lo)} for {dataset.classes[spread.loI]?.name} to {pct0(spread.hi)} for {dataset.classes[spread.hiI]?.name}: a {points(spread)}-point spread.
          </span>
        </div>
        <div>
          <i>2</i>
          <span>
            {top ? (
              <>
                <b>The biggest mix-up</b> is {dataset.classes[top.a]?.name} taken for {dataset.classes[top.c]?.name} ({top.v} of {current.res.cls[top.a]?.rs} test images).
              </>
            ) : (
              <>
                <b>No mix-ups at all</b> on the test set.
              </>
            )}
          </span>
        </div>
        <div>
          <i>3</i>
          <span>
            {done.length > 1 ? (
              <>
                <b>Across your {done.length} runs</b>, accuracy ranged from {pct(Math.min(...accuracies))} to {pct(Math.max(...accuracies))}. Picked on validation accuracy, the best is Run {best.no} ({MODELS[best.model].name}, {num(best.n)} images), which scores {pct(best.res?.acc)} on the test set.
              </>
            ) : (
              <>
                <b>Train another model</b> (k-NN, SVM, Random Forest, MLP or CNN) and compare the spread.
              </>
            )}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button type="button" className="sbtn" onClick={onClose}>
          Keep exploring
        </button>
        <button type="button" className="sbtn lime" onClick={onRestart}>
          <Icon name="reset" />
          Start over
        </button>
      </div>
    </ModalFrame>
  );
}
