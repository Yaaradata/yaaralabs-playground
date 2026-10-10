import type { CaptureRecord, TimelineEvent, TrackedObject } from './types';
import { formatClock } from './tracker';

type ExportInput = {
  projectName: string;
  startedAt: number | null;
  elapsedMs: number;
  fps: number;
  detectorKind: string;
  detectorLabel: string;
  uniqueObjects: string[];
  totalTracks: number;
  captures: CaptureRecord[];
  timeline: TimelineEvent[];
  memory: TrackedObject[];
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lod-src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.lodSrc = src;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

function dataUrlToUint8(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function exportLodSession(input: ExportInput): Promise<void> {
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
  } catch {
    await loadScript('https://unpkg.com/jszip@3.10.1/dist/jszip.min.js');
  }
  const JSZipCtor = (window as unknown as { JSZip?: new () => {
    file: (name: string, data: string | Uint8Array) => void;
    generateAsync: (opts: { type: 'blob' }) => Promise<Blob>;
  } }).JSZip;
  if (!JSZipCtor) throw new Error('Could not start the export zip');

  const zip = new JSZipCtor();
  const metadata = {
    projectName: input.projectName,
    exportedAt: new Date().toISOString(),
    elapsedMs: input.elapsedMs,
    fps: input.fps,
    detectorKind: input.detectorKind,
    detectorLabel: input.detectorLabel,
    uniqueObjects: input.uniqueObjects,
    totalTracks: input.totalTracks,
    captures: input.captures.map((capture) => ({
      id: capture.id,
      at: new Date(capture.at).toISOString(),
      caption: capture.caption,
      captionSource: capture.captionSource,
      avgConfidence: capture.avgConfidence,
      detectorKind: capture.detectorKind,
      detectorLabel: capture.detectorLabel,
      fpsAtCapture: capture.fpsAtCapture,
      objects: capture.objects.map((object) => ({
        className: object.className,
        score: object.score,
        colorName: object.colorName,
        bbox: object.bbox,
      })),
      image: `captures/${capture.id}.jpg`,
    })),
    timeline: input.timeline.map((event) => ({
      at: new Date(event.at).toISOString(),
      clock: formatClock(event.at),
      kind: event.kind,
      text: event.text,
    })),
    objectMemory: input.memory.map((track) => ({
      id: track.id,
      className: track.className,
      colorName: track.colorName,
      firstSeen: new Date(track.firstSeenAt).toISOString(),
      lastSeen: new Date(track.lastSeenAt).toISOString(),
      stillPresent: track.present,
    })),
  };

  zip.file('session.json', JSON.stringify(metadata, null, 2));
  zip.file(
    'captions.txt',
    input.captures
      .map(
        (capture) =>
          `${formatClock(capture.at)}  [${capture.detectorLabel}]  fps=${capture.fpsAtCapture}  ${capture.caption}`
      )
      .join('\n')
  );
  zip.file(
    'detections.csv',
    [
      'capture_id,at,detector_kind,detector_label,fps,class_name,score,color,bbox_x,bbox_y,bbox_w,bbox_h,caption',
      ...input.captures.flatMap((capture) => {
        const stamp = new Date(capture.at).toISOString();
        const caption = JSON.stringify(capture.caption);
        if (!capture.objects.length) {
          return [
            [
              capture.id,
              stamp,
              capture.detectorKind,
              JSON.stringify(capture.detectorLabel),
              capture.fpsAtCapture,
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              caption,
            ].join(','),
          ];
        }
        return capture.objects.map((object) =>
          [
            capture.id,
            stamp,
            capture.detectorKind,
            JSON.stringify(capture.detectorLabel),
            capture.fpsAtCapture,
            JSON.stringify(object.className),
            object.score.toFixed(4),
            JSON.stringify(object.colorName || ''),
            object.bbox ? object.bbox[0].toFixed(1) : '',
            object.bbox ? object.bbox[1].toFixed(1) : '',
            object.bbox ? object.bbox[2].toFixed(1) : '',
            object.bbox ? object.bbox[3].toFixed(1) : '',
            caption,
          ].join(',')
        );
      }),
    ].join('\n')
  );
  zip.file(
    'timeline.txt',
    input.timeline
      .map((event) => `${formatClock(event.at)}\t${event.text}`)
      .join('\n')
  );
  input.captures.forEach((capture) => {
    if (capture.imageDataUrl.startsWith('data:')) {
      zip.file(`captures/${capture.id}.jpg`, dataUrlToUint8(capture.imageDataUrl));
    }
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = (input.projectName || 'session').replace(/[^\w-]+/g, '-').toLowerCase();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `live-object-detection-${slug}-${stamp}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}
