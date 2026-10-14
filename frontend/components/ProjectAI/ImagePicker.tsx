'use client';

/**
 * The image chooser behind the "recognise an image and wait" block: Upload, Webcam, or one of the
 * workshop test images (when the project uses the sample labels). Resolves with the chosen image.
 */

import { useEffect, useRef, useState } from 'react';
import { useCamera } from '../VideoClassifier/useCamera';
import { fileName, loadDeepTest, loadSampleImages, readLabelNames, readRegion, sampleImageFile, sampleImageUrl, type SampleImageSet } from '../SampleImages/sampleImages';

export interface PickedImage {
  file: File;
  name: string;
}

interface Props {
  labels: string[];
  namesKey: string;
  busy: string | null;
  error: string | null;
  onPick: (img: PickedImage) => void;
  onCancel: () => void;
}

type Tab = 'upload' | 'webcam' | 'test' | 'deep';

export default function ImagePicker({ labels, namesKey, busy, error, onPick, onCancel }: Props) {
  const [tab, setTab] = useState<Tab>('upload');
  const [tests, setTests] = useState<SampleImageSet['test']>([]);
  const [deep, setDeep] = useState<SampleImageSet['test']>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { videoRef, error: camError, ready } = useCamera(tab === 'webcam' && !busy);

  // workshop test images, only when this project was built from the sample labels
  useEffect(() => {
    let alive = true;
    loadSampleImages(readRegion(namesKey))
      .then((d) => {
        const renamed = readLabelNames(namesKey);
        const have = new Set(labels);
        const used = d.labels.filter((l) => have.has(renamed[l.label] ?? l.label)).length;
        if (alive && used >= 2) {
          setTests(d.test);
          loadDeepTest().then((deepTest) => alive && setDeep(deepTest)); // the same on every region
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [labels, namesKey]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [busy, onCancel]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      if (blob) onPick({ file: new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' }), name: 'Webcam photo' });
    }, 'image/jpeg', 0.9);
  };

  const tabs: { id: Tab; name: string }[] = [
    { id: 'upload', name: 'Upload' },
    { id: 'webcam', name: 'Webcam' },
    ...(tests.length ? [{ id: 'test' as Tab, name: 'Test images' }] : []),
    ...(deep.length ? [{ id: 'deep' as Tab, name: 'Deep test' }] : []),
  ];

  return (
    <div className="fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Choose an image">
      <div className="w-full max-w-xl rounded-xl border border-fg/10 bg-card text-fg shadow-2xl">
        <div className="flex items-center px-5 pt-4 pb-3 border-b border-fg/10">
          <h2 className="text-lg font-semibold flex-1">Choose an image for your model</h2>
          <button type="button" onClick={onCancel} disabled={!!busy} aria-label="Close" className="text-fg/60 hover:text-fg p-1 disabled:opacity-40">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-1 p-1 rounded-lg bg-canvas border border-fg/10" role="tablist" aria-label="Image source">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                disabled={!!busy}
                className={`flex-1 px-2 py-1.5 rounded-md text-sm font-medium ${tab === t.id ? 'bg-purple-brand text-white' : 'text-fg/70 hover:bg-purple-brand/10'}`}
              >
                {t.name}
              </button>
            ))}
          </div>

          {busy ? (
            <p className="py-10 text-center text-sm text-fg/70" role="status">{busy}</p>
          ) : tab === 'upload' ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-lg border-2 border-dashed border-magenta-brand/40 hover:border-magenta-brand/70 hover:bg-purple-brand/5 py-10 text-sm font-medium"
            >
              Click to choose an image (JPG, PNG, WebP)
              <span className="block text-xs font-normal text-fg/55 mt-1">Use only public or sample documents.</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) onPick({ file: f, name: f.name });
                }}
              />
            </button>
          ) : tab === 'webcam' ? (
            camError ? (
              <p className="py-8 text-center text-sm text-fg/70" role="status">No camera found — use Upload.</p>
            ) : (
              <div className="space-y-2">
                <video ref={videoRef} muted playsInline className="w-full rounded-lg bg-black -scale-x-100" aria-label="Camera preview" />
                <button type="button" onClick={capture} disabled={!ready} className="w-full rounded-lg bg-purple-brand py-2.5 text-sm font-semibold text-white disabled:opacity-40">
                  Take photo
                </button>
              </div>
            )
          ) : (
            <ul className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[60vh] overflow-y-auto" aria-label={tab === 'deep' ? 'Deep test images' : 'Test images'}>
              {(tab === 'deep' ? deep : tests).map((t, k) => (
                <li key={t.file}>
                  <button
                    type="button"
                    onClick={async () => {
                      // names that do not give the answer away: Test 01..12, Deep 01..20
                      const name = tab === 'deep' ? `Deep ${String(k + 1).padStart(2, '0')}` : fileName(t.file).replace(/\.\w+$/, '').replace('test_', 'Test ');
                      onPick({ file: await sampleImageFile(t.file), name });
                    }}
                    className="block w-full rounded-md overflow-hidden border border-fg/10 hover:border-pink-brand bg-white"
                    title={tab === 'deep' ? t.defects ?? '' : fileName(t.file)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sampleImageUrl(t.file)} alt={fileName(t.file)} className="w-full aspect-[3/4] object-cover object-top" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-sm text-pink-brand" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
