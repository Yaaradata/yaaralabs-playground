"use client";

import { useEffect, useState } from "react";
import type { BoardCard, DatasetMeta, HistItem, RunView, TrayFilter } from "../lib/types";
import { MODELS } from "../lib/models";
import { num, pct, pct0 } from "../lib/format";
import { Icon } from "./Icon";

interface Props {
  dataset: DatasetMeta;
  run: RunView;
  runs: RunView[];
  imageSrc: (index: number) => string;
  filter: TrayFilter;
  classFilter: number;
  deck: number[];
  tested: Record<number, boolean>;
  current: BoardCard | null;
  history: HistItem[];
  auto: boolean;
  busy: boolean;
  onFilter: (filter: TrayFilter) => void;
  onClass: (index: number) => void;
  onRun: (id: string) => void;
  onLoad: (index: number) => void;
  onReplay: (item: HistItem) => void;
  onPrev: () => void;
  onNext: () => void;
  onAuto: () => void;
  onOwn: (file: File) => void;
  onTruth: (cls: number) => void;
}

export function TestStep(props: Props) {
  const { dataset, run, imageSrc, filter, classFilter, deck, tested, current, history, auto } = props;
  const [over, setOver] = useState(false);
  const visible = deck.filter((index) => {
    if (classFilter >= 0 && dataset.y[index] !== classFilter) return false;
    if (filter === "new") return tested[index] === undefined;
    if (filter === "wrong") return tested[index] === false;
    return true;
  });
  const labeledOwn = history.filter((item) => item.n == null && item.truth != null);
  const tried = Object.keys(tested).length + labeledOwn.length;
  const right = Object.values(tested).filter(Boolean).length + labeledOwn.filter((item) => item.ok).length;
  const bars = current
    ? (() => {
        const order = current.probs
          .map((value, index) => index)
          .sort((left, right) => current.probs[right] - current.probs[left])
          .slice(0, Math.min(6, dataset.K));
        if (current.truth != null && !order.includes(current.truth)) order.push(current.truth);
        return order;
      })()
    : [];
  useEffect(() => {
    const bars = document.querySelectorAll<HTMLElement>(".ex4 .bar i");
    bars.forEach((node) => {
      const width = node.dataset.w;
      if (width) node.style.width = `${width}%`;
    });
  }, [current]);
  return (
    <div className="page fit">
      <div className="test-grid">
        <aside className="panel" aria-label="Test images">
          <div className="tray-head">
            <span className="cap" style={{ color: "var(--cyan-t)" }}>
              <Icon name="image" />
              Testing Data{" "}
              <span className="pill" style={{ marginLeft: "auto" }}>
                <b>{num(visible.length)}</b>
              </span>
            </span>
            <div className="row">
              <div className="chips" role="group">
                {(
                  [
                    ["all", "All"],
                    ["new", "Not tried"],
                    ["wrong", "Got wrong"],
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" className={filter === key ? "on" : ""} onClick={() => props.onFilter(key)}>
                    {label}
                  </button>
                ))}
              </div>
              <select aria-label="Filter by class" value={classFilter} onChange={(event) => props.onClass(Number(event.target.value))}>
                <option value={-1}>All classes</option>
                {dataset.classes.map((cls, index) => (
                  <option key={cls.name} value={index}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="tray-grid">
            {visible.length ? (
              visible.map((index) => {
                const mark = tested[index];
                return (
                  <button
                    key={index}
                    type="button"
                    className={`tt${dataset.small[index] ? " pix" : ""}${current?.n === index ? " on" : ""}`}
                    draggable
                    aria-label={`Test image ${index - dataset.ntr + 1}`}
                    onClick={() => props.onLoad(index)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", `ex4:${index}`);
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <img src={imageSrc(index)} alt="" />
                    {mark === undefined ? null : (
                      <span className={`bd ${mark ? "ok" : "no"}`}>
                        <Icon name={mark ? "check" : "x"} />
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="hempty" style={{ gridColumn: "1 / -1" }}>
                {filter === "wrong" ? "No wrong guesses yet." : "Nothing left here. Try another filter."}
              </div>
            )}
          </div>
          <div className="tray-foot">Drag an image onto the board, or click it.</div>
        </aside>
        <section className="panel board-wrap">
          <div className="ph">
            <span className="cap" style={{ color: "var(--lime-t)" }}>
              <Icon name="target" />
              Prediction board
            </span>
            <span className="runpick">
              <select aria-label="Model used" value={run.id} onChange={(event) => props.onRun(event.target.value)}>
                {props.runs
                  .filter((item) => item.done)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      Run {item.no} · {MODELS[item.model].name} · {num(item.n)} imgs · {pct(item.res?.acc)}
                    </option>
                  ))}
              </select>
            </span>
          </div>
          <div
            className={`board${over ? " over" : ""}`}
            tabIndex={0}
            aria-label="Drop an image here to get a prediction"
            onDragOver={(event) => {
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              const token = event.dataTransfer.getData("text/plain");
              if (token.startsWith("ex4:")) {
                props.onLoad(Number(token.slice(4)));
                return;
              }
              const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
              if (file) props.onOwn(file);
            }}
          >
            {!current ? (
              <div className="board-empty">
                <span className="big">
                  <Icon name="drag" />
                </span>
                <h3>Drop a test image here</h3>
                <div>Drag any image from the Testing Data tray on the left, or drop a picture from your computer. The model predicts its class instantly.</div>
                <button type="button" className="sbtn lime" onClick={props.onNext}>
                  <Icon name="play" />
                  Start with the first test image
                </button>
                <div style={{ fontSize: 12 }}>
                  <span className="kbd">→</span> next &nbsp; <span className="kbd">←</span> previous &nbsp; <span className="kbd">space</span> auto-play
                </div>
              </div>
            ) : (
              <div className="result">
                <div className="pic">
                  <img className={`bimg${current.small ? " pix" : ""}`} src={current.url} alt="Image being tested" />
                  <div className="sees2">
                    <img src={current.seen} alt="" style={{ width: 56, height: 56, borderRadius: 8, imageRendering: "pixelated" }} />
                    What the model sees: 64×64 greyscale
                  </div>
                </div>
                <div className="verdict">
                  <span className="vl">{current.n == null ? current.name || "Your image" : `Test image ${current.n - dataset.ntr + 1} of ${num(dataset.nte)}`}</span>
                  <span className="vp">{dataset.classes[current.pred]?.name}</span>
                  <span className="vc">
                    {pct0(current.probs[current.pred])} sure{current.probs[current.pred] < 0.5 ? " · it is unsure" : ""}
                  </span>
                  {current.truth == null ? (
                    <span className="vtag unk">
                      <Icon name="alert" />
                      Real class?{" "}
                      <select key={current.url} aria-label="Tell it the real class" defaultValue="" onChange={(event) => event.target.value !== "" && props.onTruth(Number(event.target.value))}>
                        <option value="">choose…</option>
                        {dataset.classes.map((cls, index) => (
                          <option key={cls.name} value={index}>
                            {cls.name}
                          </option>
                        ))}
                      </select>
                    </span>
                  ) : current.pred === current.truth ? (
                    <span className="vtag ok">
                      <Icon name="check" />
                      Correct
                    </span>
                  ) : (
                    <span className="vtag no">
                      <Icon name="x" />
                      Wrong · it is really {dataset.classes[current.truth]?.name}
                    </span>
                  )}
                  <div className="bars">
                    {bars.map((index) => (
                      <div key={index} className={`bar${index === current.pred ? " top" : ""}${index === current.truth ? " truth" : ""}`}>
                        <span title={dataset.classes[index]?.name}>{dataset.classes[index]?.name}</span>
                        <span className="rt">
                          <i data-w={(current.probs[index] * 100).toFixed(1)} style={{ width: 0 }} />
                        </span>
                        <b>{pct0(current.probs[index])}</b>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="ctrl">
            <button type="button" className="sbtn" onClick={props.onPrev} title="Previous (←)">
              <Icon name="back" />
              Previous
            </button>
            <button type="button" className="sbtn lime" onClick={props.onNext} title="Next test image (→)">
              Next test image
              <Icon name="next" />
            </button>
            <button type="button" className={`sbtn${auto ? " on" : ""}`} onClick={props.onAuto} title="Auto-play (space)">
              <Icon name={auto ? "pause" : "play"} />
              {auto ? "Pause" : "Auto-play"}
            </button>
            <label className="sbtn ghost">
              <Icon name="upload" />
              Your own image
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) props.onOwn(file);
                }}
              />
            </label>
          </div>
        </section>
        <aside className="panel" aria-label="Your score">
          <div className="ph">
            <span className="cap" style={{ color: "var(--mag-t)" }}>
              <Icon name="report" />
              Your spot-check
            </span>
          </div>
          <div className="score">
            <div className="kpis">
              <div className="kpi">
                <div className="sl">Tried</div>
                <div className="sv">
                  {tried}
                  <span style={{ fontSize: 13, color: "var(--muted)" }}> / {num(dataset.nte)}</span>
                </div>
              </div>
              <div className="kpi lime">
                <div className="sl">Right</div>
                <div className="sv">{tried ? pct0(right / tried) : "—"}</div>
              </div>
            </div>
            <div className="cmp">
              On all {num(dataset.nte)} test images this model scores <b>{pct(run.res?.acc)}</b>.{" "}
              {tried >= 10
                ? `Your ${tried} picks: ${pct0(right / tried)}${Math.abs(right / tried - (run.res?.acc ?? 0)) > 0.15 ? ", quite different; small samples swing a lot." : ", close to the full score."}`
                : "Try 10 or more to see if your sample agrees."}
            </div>
            <div className="field-lbl" style={{ margin: 0 }}>
              <span>History</span>
              <span>newest first</span>
            </div>
            <div className="hist">
              {history.length ? (
                history.slice(0, 200).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="hrow"
                    onClick={() => (item.n != null ? props.onLoad(item.n) : props.onReplay(item))}
                  >
                    <img src={item.url} alt="" className={item.small ? "pix" : ""} />
                    <span>
                      {dataset.classes[item.a]?.name}{" "}
                      <small>
                        {pct0(item.conf)} sure
                        {item.truth != null && item.ok === false ? ` · really ${dataset.classes[item.truth]?.name}` : ""}
                        {item.n == null ? " · your image" : ""}
                      </small>
                    </span>
                    {item.truth == null ? null : (
                      <span className={`bd ${item.ok ? "ok" : "no"}`} style={{ position: "static" }}>
                        <Icon name={item.ok ? "check" : "x"} />
                      </span>
                    )}
                  </button>
                ))
              ) : (
                <div className="hempty">Each image you test lands here. Click one to look again.</div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
