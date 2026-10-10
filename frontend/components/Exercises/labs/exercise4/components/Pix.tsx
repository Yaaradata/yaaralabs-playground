"use client";

import { useEffect, useRef } from "react";

function paint(canvas: HTMLCanvasElement, values: number[], mode: "gray" | "diverge", dark: boolean) {
  const side = canvas.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(side, side);
  if (mode === "gray") {
    let lo = Infinity;
    let hi = -Infinity;
    values.forEach((value) => {
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    });
    const span = hi - lo || 1;
    for (let i = 0; i < side * side; i += 1) {
      const gray = Math.round((((values[i] ?? 0) - lo) / span) * 255);
      image.data[i * 4] = gray;
      image.data[i * 4 + 1] = gray;
      image.data[i * 4 + 2] = gray;
      image.data[i * 4 + 3] = 255;
    }
  } else {
    const bg = dark ? 0 : 255;
    let max = 0;
    values.forEach((value) => {
      max = Math.max(max, Math.abs(value));
    });
    for (let i = 0; i < side * side; i += 1) {
      const value = (values[i] ?? 0) / (max || 1);
      const amount = Math.min(1, Math.abs(value));
      const [r, g, b] = value >= 0 ? [228, 249, 142] : [226, 126, 247];
      image.data[i * 4] = bg + (r - bg) * amount;
      image.data[i * 4 + 1] = bg + (g - bg) * amount;
      image.data[i * 4 + 2] = bg + (b - bg) * amount;
      image.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export function Pix({
  values,
  size,
  mode,
  dark = false,
}: {
  values: number[];
  size: number;
  mode: "gray" | "diverge";
  dark?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paint(ref.current, values, mode, dark);
  }, [values, size, mode, dark]);
  return <canvas ref={ref} className="wimg" width={size} height={size} />;
}
