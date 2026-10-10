import config from "../../../../../lib/config";
import type { DatasetMeta, DepartmentInfo, ModelId, ParamMap, PredictView, RunView, Summary } from "./types";

export interface VisionCatalog {
  driveRoot: string;
  departments: DepartmentInfo[];
  models: ModelId[];
}

export interface VisionState {
  summary: Summary | null;
  dataset: DatasetMeta | null;
  runs: RunView[];
  activeRunId: string | null;
  department: string | null;
}

function base(sessionId: string, projectId: string): string {
  return `${config.apiBaseUrl}/api/exercises/session/${sessionId}/projects/${projectId}/vision`;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    return res.statusText || "Request failed";
  } catch {
    return res.statusText || "Request failed";
  }
}

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(await readError(res));
  return res.json() as Promise<T>;
}

export function visionImageUrl(sessionId: string, projectId: string, index: number, version?: string): string {
  const stamp = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${base(sessionId, projectId)}/images/${index}${stamp}`;
}

export function setVisionDepartment(sessionId: string, projectId: string, department: string): Promise<{ department: string }> {
  return send(`${base(sessionId, projectId)}/department`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ department }),
  });
}

export function loadVisionCatalog(sessionId: string, projectId: string): Promise<VisionCatalog> {
  return send(`${base(sessionId, projectId)}/catalog`);
}

export function loadVisionState(sessionId: string, projectId: string): Promise<VisionState> {
  return send(`${base(sessionId, projectId)}/state`);
}

export function ingestVision(
  sessionId: string,
  projectId: string,
  body: FormData,
): Promise<{ added: number; skipped: number; summary: Summary | null }> {
  return send(`${base(sessionId, projectId)}/ingest`, { method: "POST", body });
}

export function loadVisionSample(
  sessionId: string,
  projectId: string,
  department: string,
): Promise<{ added: number; summary: Summary | null }> {
  return send(`${base(sessionId, projectId)}/sample`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ department }),
  });
}

export function applyVisionPool(
  sessionId: string,
  projectId: string,
  mode: "split" | "train",
): Promise<{ summary: Summary | null }> {
  return send(`${base(sessionId, projectId)}/pool`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export function fixVisionTest(sessionId: string, projectId: string): Promise<{ summary: Summary | null }> {
  return send(`${base(sessionId, projectId)}/fixtest`, { method: "POST" });
}

export function setVisionClassKept(
  sessionId: string,
  projectId: string,
  name: string,
  kept: boolean,
): Promise<{ summary: Summary | null }> {
  return send(`${base(sessionId, projectId)}/keep`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kept }),
  });
}

export function setVisionTestShare(
  sessionId: string,
  projectId: string,
  percent: number,
): Promise<{ summary: Summary | null }> {
  return send(`${base(sessionId, projectId)}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ percent }),
  });
}

export function prepareVision(sessionId: string, projectId: string): Promise<DatasetMeta> {
  return send(`${base(sessionId, projectId)}/prepare`, { method: "POST" });
}

export function clearVision(sessionId: string, projectId: string): Promise<{ ok: boolean }> {
  return send(`${base(sessionId, projectId)}/clear`, { method: "POST" });
}

export function startVisionTrain(
  sessionId: string,
  projectId: string,
  model: ModelId,
  params: ParamMap,
  frac: number,
): Promise<RunView> {
  return send(`${base(sessionId, projectId)}/train`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, params, frac }),
  });
}

export function loadVisionRun(sessionId: string, projectId: string, runId: string): Promise<RunView> {
  return send(`${base(sessionId, projectId)}/runs/${runId}`);
}

export function stopVisionTrain(sessionId: string, projectId: string, runId: string): Promise<{ ok: boolean }> {
  return send(`${base(sessionId, projectId)}/runs/${runId}/stop`, { method: "POST" });
}

export function predictVisionIndex(
  sessionId: string,
  projectId: string,
  runId: string,
  index: number,
): Promise<PredictView> {
  return send(`${base(sessionId, projectId)}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, index }),
  });
}

export function predictVisionFile(
  sessionId: string,
  projectId: string,
  runId: string,
  file: File,
): Promise<PredictView> {
  const body = new FormData();
  body.append("run_id", runId);
  body.append("file", file, file.name);
  return send(`${base(sessionId, projectId)}/predict-file`, { method: "POST", body });
}
