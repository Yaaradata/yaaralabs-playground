const SAMPLE = 24;

let signatureCanvas: HTMLCanvasElement | null = null;
let signatureCtx: CanvasRenderingContext2D | null = null;

function getSignatureContext(): CanvasRenderingContext2D | null {
  if (!signatureCanvas) signatureCanvas = document.createElement('canvas');
  if (!signatureCtx) {
    signatureCtx = signatureCanvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });
  }
  return signatureCtx;
}

/** Compact grayscale fingerprint of the current video frame. */
export function computeFrameSignature(video: HTMLVideoElement): Float32Array | null {
  if (video.readyState < 2 || video.videoWidth < 8 || video.videoHeight < 8) return null;
  const ctx = getSignatureContext();
  if (!ctx || !signatureCanvas) return null;
  signatureCanvas.width = SAMPLE;
  signatureCanvas.height = SAMPLE;
  try {
    ctx.drawImage(video, 0, 0, SAMPLE, SAMPLE);
    const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
    const out = new Float32Array(SAMPLE * SAMPLE);
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      out[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    }
    return out;
  } catch {
    return null;
  }
}

/** True when two signatures differ enough to warrant fresh inference / capture. */
export function framesDiffer(
  previous: Float32Array | null,
  next: Float32Array | null,
  threshold = 0.028
): boolean {
  if (!previous || !next || previous.length !== next.length) return true;
  let sum = 0;
  for (let i = 0; i < previous.length; i += 1) {
    sum += Math.abs(previous[i] - next[i]);
  }
  return sum / previous.length >= threshold;
}
