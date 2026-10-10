import { knnPredict, mulberry32 } from './text';

export interface ShapeSample {
  id: string;
  label: 'circle' | 'square' | 'triangle';
  split: 'train' | 'test';
  dataUrl: string;
  features: number[];
}

const LABELS: Array<ShapeSample['label']> = ['circle', 'square', 'triangle'];

function drawShape(
  ctx: CanvasRenderingContext2D,
  label: ShapeSample['label'],
  size: number,
  rng: () => number,
) {
  const pad = 6 + rng() * 4;
  const color = `hsl(${Math.floor(rng() * 360)}, 70%, ${40 + rng() * 20}%)`;
  ctx.fillStyle = `hsl(${Math.floor(rng() * 360)}, 12%, ${10 + rng() * 10}%)`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#dbfe87';
  ctx.lineWidth = 1;
  if (label === 'circle') {
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - pad, 0, Math.PI * 2);
    ctx.fill();
  } else if (label === 'square') {
    ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);
  } else {
    ctx.beginPath();
    ctx.moveTo(size / 2, pad);
    ctx.lineTo(size - pad, size - pad);
    ctx.lineTo(pad, size - pad);
    ctx.closePath();
    ctx.fill();
  }
}

function featuresFromImage(image: ImageData): number[] {
  const { data, width, height } = image;
  let r = 0;
  let g = 0;
  let b = 0;
  let filled = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let edge = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (lum > 40) {
        filled += 1;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (x > 0) {
          const j = (y * width + (x - 1)) * 4;
          const prev = (data[j] + data[j + 1] + data[j + 2]) / 3;
          if (Math.abs(lum - prev) > 28) edge += 1;
        }
      }
    }
  }
  const area = filled / (width * height);
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const aspect = bw / bh;
  const circularity = (4 * Math.PI * filled) / ((bw * 2 + bh * 2) ** 2 || 1);
  const n = filled || 1;
  return [area, aspect, circularity, edge / (filled || 1), r / n / 255, g / n / 255, b / n / 255];
}

export function makePublicShapeDataset(perClass = 10, size = 48, seed = 42): ShapeSample[] {
  if (typeof document === 'undefined') return [];
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const rng = mulberry32(seed);
  const samples: ShapeSample[] = [];
  LABELS.forEach((label) => {
    for (let i = 0; i < perClass; i += 1) {
      drawShape(ctx, label, size, rng);
      const image = ctx.getImageData(0, 0, size, size);
      samples.push({
        id: `${label}-${i}`,
        label,
        split: i < perClass - 3 ? 'train' : 'test',
        dataUrl: canvas.toDataURL('image/png'),
        features: featuresFromImage(image),
      });
    }
  });
  return samples;
}

export function classifyShapes(train: ShapeSample[], test: ShapeSample[]) {
  if (!train.length) {
    return test.map((sample) => ({ ...sample, predicted: 'unknown' as ShapeSample['label'] }));
  }
  const trainX = train.map((s) => s.features);
  const trainY = train.map((s) => s.label);
  return test.map((sample) => ({
    ...sample,
    predicted: knnPredict(sample.features, trainX, trainY, 3) as ShapeSample['label'],
  }));
}

export async function featuresFromFile(file: File, size = 48): Promise<number[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not read image'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, size, size);
    return featuresFromImage(ctx.getImageData(0, 0, size, size));
  } finally {
    URL.revokeObjectURL(url);
  }
}
