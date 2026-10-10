"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import type { Summary } from "../lib/types";
import { fileSize, num, uploadStamp } from "../lib/format";
import { Icon } from "./Icon";

const RULES = [
  "One folder is one class. A folder of subfolders is one class per subfolder, and that folder name is the label.",
  "Add at least 2 classes. PNG, JPG, BMP, GIF, and WEBP images inside those folders are kept.",
  "Each class needs at least 6 images, so 5 can stay for training and 1 can be kept for testing.",
  "Train/Test Split sets how many images from each class are for testing. The rest stay for training.",
  "A class uses up to 2,000 training images and 2,000 testing images. Extra images are left out at random.",
];

const HIDDEN_CHECKS = [
  "Training Data needs at least 2 class folders with images inside.",
  "Every class has testing images, kept apart from training.",
];

function testingLimit(summary: Summary): number {
  const totals = summary.classes
    .filter((row) => row.kept)
    .map((row) => row.train + row.test + row.pool)
    .filter((count) => count >= 6);
  if (!totals.length) return 0;
  const smallest = Math.min(...totals);
  return Math.min(90, Math.floor(((smallest - 5) * 100) / smallest));
}

function splitChoices(limit: number, applied: number): number[] {
  const steps = [10, 20, 30, 40, 50].filter((test) => test <= limit);
  if (applied > 0 && applied <= limit && !steps.includes(applied)) steps.push(applied);
  steps.sort((left, right) => left - right);
  if (!steps.length && limit > 0) steps.push(limit);
  return steps;
}

function shownInData(message: string): boolean {
  if (HIDDEN_CHECKS.includes(message)) return false;
  if (/^\d+ classes found in Training Data\.$/.test(message)) return false;
  return !/^Split is \d+ : \d+ training to testing, as the exercise expects\.$/.test(message);
}

interface Props {
  summary: Summary | null;
  reading: boolean;
  preparing: boolean;
  onFiles: (files: File[], forced: "train" | "test" | null) => void;
  onPickFolder: (forced: "train" | "test" | null) => Promise<boolean>;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onClear: () => void;
  onShare: (percent: number) => void;
  onKeep: (name: string, kept: boolean) => void;
  onPrepare: () => void;
}

export function UploadStep({
  summary,
  reading,
  preparing,
  onFiles,
  onPickFolder,
  onDrop,
  onClear,
  onShare,
  onKeep,
  onPrepare,
}: Props) {
  const zone = useRef<HTMLDivElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const splitRef = useRef<HTMLSpanElement>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const applied = summary && summary.train + summary.test ? Math.round((summary.test / (summary.train + summary.test)) * 100) : 0;
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);
  useEffect(() => {
    // After Clear, drop any retained FileList so the same folder can be chosen again.
    if (!summary || summary.classes.length === 0) {
      if (folderRef.current) folderRef.current.value = "";
    }
  }, [summary]);
  useEffect(() => {
    if (!splitOpen) return;
    const close = (event: MouseEvent) => {
      if (!splitRef.current?.contains(event.target as Node)) setSplitOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSplitOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [splitOpen]);
  const choose = () => {
    void onPickFolder(null).then((handled) => {
      if (!handled) folderRef.current?.click();
    });
  };
  const uploaded = uploadStamp(summary?.uploadedAt);
  const updated = uploadStamp(summary?.updatedAt);
  const useImages = (
    <button type="button" className="train-btn use-images" disabled={reading || preparing || !summary?.ok} onClick={onPrepare}>
      <Icon name="check" />
      Use these images
    </button>
  );
  return (
    <div className="page fit">
      <div className="page-h">
        <div>
          <h2>1) Upload your images</h2>
        </div>
      </div>
      <div className="up-grid">
        <div>
          <div
            className="dropzone"
            ref={zone}
            tabIndex={0}
            role="button"
            aria-label="Upload your files Here"
            onClick={choose}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              choose();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              zone.current?.classList.add("over");
            }}
            onDragLeave={(event) => {
              if (!zone.current?.contains(event.relatedTarget as Node)) zone.current?.classList.remove("over");
            }}
            onDrop={(event) => {
              zone.current?.classList.remove("over");
              onDrop(event);
            }}
          >
            <span className="big">
              <Icon name="upload" />
            </span>
            <h3>Upload your files Here</h3>
            <p>Click this box, or drop a folder onto it.</p>
            <p>One folder is one class. A folder of subfolders is one class per subfolder.</p>
            <input
              ref={folderRef}
              type="file"
              hidden
              multiple
              onChange={(event) => {
                const list = event.target.files;
                const files = list ? Array.from(list) : [];
                event.target.value = "";
                if (files.length) onFiles(files, null);
              }}
            />
          </div>
          <section className="rules" aria-label="Rules">
            <h4>Rules</h4>
            <ol>
              {RULES.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          </section>
        </div>
        <div className="summary">
          {reading ? (
            <>
              <h4>Your data</h4>
              <div className="empty-sum">
                <div>
                  <span className="spin" style={{ display: "inline-block" }} />
                  <br />
                  Reading the folder…
                </div>
              </div>
            </>
          ) : !summary || summary.classes.length === 0 ? (
            <>
              <h4>Your data</h4>
              <div className="empty-sum">
                Nothing uploaded yet.
                <br />
                Your classes, image counts and a quick check will appear here.
              </div>
            </>
          ) : (
            <>
              <h4>
                Your data{" "}
                <span className="sum-actions">
                  <span className="split-pop" ref={splitRef}>
                    <button
                      type="button"
                      className={`sbtn small split-btn${splitOpen ? " on" : ""}`}
                      aria-expanded={splitOpen}
                      aria-haspopup="menu"
                      disabled={preparing || testingLimit(summary) === 0}
                      title={testingLimit(summary) === 0 ? "Each class needs at least 6 images before some can be held for testing." : undefined}
                      onClick={() => setSplitOpen((open) => !open)}
                    >
                      <Icon name="sliders" />
                      <span>Train/Test Split</span>
                      <b>
                        {100 - applied}% / {applied}%
                      </b>
                    </button>
                    {splitOpen && testingLimit(summary) > 0 ? (
                      <div className="split-menu" role="menu" aria-label="Train/Test Split">
                        {splitChoices(testingLimit(summary), applied).map((test) => (
                          <button
                            key={test}
                            type="button"
                            role="menuitem"
                            className={test === applied ? "on" : ""}
                            disabled={preparing}
                            onClick={() => {
                              if (test !== applied) onShare(test);
                              setSplitOpen(false);
                            }}
                          >
                            <span>Train {100 - test}%</span>
                            <span>Test {test}%</span>
                            {test === applied ? <Icon name="check" /> : <i />}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="sbtn small clear-btn"
                    onClick={onClear}
                    disabled={preparing || reading}
                    title={reading ? "Wait until the folder finishes reading." : undefined}
                  >
                    <Icon name="trash" />
                    Clear
                  </button>
                </span>
              </h4>
              <div className="kpis">
                <div className="kpi lime">
                  <div className="sl">Classes</div>
                  <div className="sv">{summary.classes.length}</div>
                </div>
                <div className="kpi wide">
                  <div className="sl">Overall Img (Across)</div>
                  <div className="sv">{num(summary.classes.reduce((sum, row) => sum + row.images, 0))}</div>
                </div>
                <div className="kpi">
                  <div className="sl">Total Size</div>
                  <div className="sv">{fileSize(summary.classes.reduce((sum, row) => sum + row.bytes, 0))}</div>
                </div>
                <div className="kpi">
                  <div className="sl">Uploaded</div>
                  <div className="sv sm">{uploaded}</div>
                </div>
                <div className="kpi">
                  <div className="sl">Updated</div>
                  <div className="sv sm">{updated}</div>
                </div>
              </div>
              <div className="ctable-wrap">
                <table className="ctable">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th style={{ textAlign: "right" }}>Total Img</th>
                      <th style={{ textAlign: "right" }}>Total Size</th>
                      <th>Examples</th>
                      <th>Ratio</th>
                      <th>Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.classes.map((row) => {
                      const total = row.train + row.test || 1;
                      return (
                        <tr key={row.name} className={row.kept ? undefined : "out"}>
                          <td className="cn" title={row.name}>
                            {row.name}
                          </td>
                          <td className="n">{num(row.images)}</td>
                          <td className="n">{fileSize(row.bytes)}</td>
                          <td>
                            <div className="thumbs">
                              {Array.from({ length: 5 }, (_, index) => {
                                const src = row.thumbs[index];
                                return src ? <img key={`${row.name}-${index}`} src={src} alt="" /> : <span key={`${row.name}-empty-${index}`} />;
                              })}
                            </div>
                          </td>
                          <td>
                            <div className="ratio-cell">
                              <div
                                className="ratio"
                                role="img"
                                aria-label={`Training ${num(row.train)}, testing ${num(row.test)}${row.pool ? `, ${num(row.pool)} not split` : ""}`}
                              >
                                <span className="tr" style={{ width: `${(row.train / total) * 100}%` }}>
                                  {row.train ? <b>{num(row.train)}</b> : null}
                                </span>
                                <span className="te" style={{ width: `${(row.test / total) * 100}%` }}>
                                  {row.test ? <b>{num(row.test)}</b> : null}
                                </span>
                              </div>
                              {row.pool ? <em>+{num(row.pool)}</em> : null}
                            </div>
                          </td>
                          <td className="pick">
                            <button
                              type="button"
                              className={row.kept ? "on" : ""}
                              aria-pressed={row.kept}
                              aria-label={`Use ${row.name}`}
                              title="Use this folder"
                              disabled={preparing || row.kept}
                              onClick={() => onKeep(row.name, true)}
                            >
                              <Icon name="check" />
                            </button>
                            <button
                              type="button"
                              className={row.kept ? "" : "off"}
                              aria-pressed={!row.kept}
                              aria-label={`Leave out ${row.name}`}
                              title="Leave this folder out"
                              disabled={preparing || !row.kept}
                              onClick={() => onKeep(row.name, false)}
                            >
                              <Icon name="x" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="checks">
                {summary.checks.filter((check) => shownInData(check.message)).map((check) => (
                  <div className={`chk ${check.level}`} key={check.message}>
                    <span className="ci">
                      <Icon name={check.level === "ok" ? "check" : check.level === "warn" ? "alert" : "x"} />
                    </span>
                    <span>{check.message}</span>
                  </div>
                ))}
              </div>
              {preparing ? (
                <div className="prep">
                  <div className="pl">
                    <span>Fitting every image into a 64×64 greyscale canvas for the model…</span>
                    <b>Working</b>
                  </div>
                  <div className="progress">
                    <i style={{ width: "40%" }} />
                  </div>
                </div>
              ) : null}
              {useImages}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
