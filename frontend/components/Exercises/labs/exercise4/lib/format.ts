import type { CSSProperties } from "react";

export const pct = (value: number | null | undefined): string =>
  value == null || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(1)}%`;

export const pct0 = (value: number | null | undefined): string =>
  value == null || Number.isNaN(value) ? "—" : `${Math.round(value * 100)}%`;

export const num = (value: number): string => Math.round(value).toLocaleString("en-IN");

export function runtimeLabel(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem}s`;
}

export function uploadStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "—";
  return when.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sameVal(a: string | number, b: string | number): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  return a === b;
}

export function spreadOf(cls: { r: number }[]): { lo: number; hi: number; loI: number; hiI: number } {
  const recalls = cls.map((row) => row.r);
  const lo = Math.min(...recalls);
  const hi = Math.max(...recalls);
  return { lo, hi, loI: recalls.indexOf(lo), hiI: recalls.indexOf(hi) };
}

export function points(spread: { lo: number; hi: number }): number {
  return Math.round((spread.hi - spread.lo) * 100);
}

export function heat(value: number, diagonal: boolean, rowSum: number): string {
  if (!value) return "background:var(--tile);color:transparent";
  const amount = Math.min(1, value / Math.max(1, rowSum));
  if (diagonal) {
    return `background:color-mix(in srgb,var(--green) ${Math.round(18 + amount * 64)}%,var(--tile));color:${amount > 0.55 ? "#06210f" : "var(--green-t)"}`;
  }
  const mix = Math.min(1, amount / 0.22);
  return `background:color-mix(in srgb,var(--coral) ${Math.round(14 + mix * 68)}%,var(--tile));color:${mix > 0.6 ? "#2a060c" : "var(--coral-t)"}`;
}

export function colorVars(color: string): CSSProperties {
  if (color === "blue") return { "--c": "var(--blue-t)", "--ct": "var(--blue-t)" } as CSSProperties;
  return { "--c": `var(--${color})`, "--ct": `var(--${color}-t)` } as CSSProperties;
}
