type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  mozFullScreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  mozCancelFullScreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  mozRequestFullScreen?: () => Promise<void> | void;
};

export type DeviceTier = 'low' | 'mid' | 'high';

type NavigatorHints = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
};

export function isSecureCameraContext(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function getDeviceTier(): DeviceTier {
  if (typeof navigator === 'undefined') return 'mid';
  const nav = navigator as NavigatorHints;
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory || 4;
  const saveData = Boolean(nav.connection?.saveData);
  const slowNet = nav.connection?.effectiveType === '2g' || nav.connection?.effectiveType === 'slow-2g';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
  if (saveData || slowNet || memory <= 2 || cores <= 2) return 'low';
  if (mobile && (memory <= 4 || cores <= 4)) return 'low';
  if (memory >= 8 && cores >= 8 && !mobile) return 'high';
  return 'mid';
}

export function canUseHeavyEngine(): boolean {
  return getDeviceTier() !== 'low';
}

export function canUseWasmThreads(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && Boolean(globalThis.crossOriginIsolated);
}

export function canUseWasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
    );
  } catch {
    return false;
  }
}

export async function canUseWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu?.requestAdapter) return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export async function openCameraStream(): Promise<MediaStream> {
  if (!isSecureCameraContext()) {
    throw new Error('Camera needs HTTPS (or localhost) in this browser.');
  }
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) {
    throw new Error('Camera is not available in this browser. Try Chrome, Edge, Firefox, or Safari.');
  }
  const tier = getDeviceTier();
  const attempts: MediaStreamConstraints[] =
    tier === 'low'
      ? [
          { audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } },
          { audio: false, video: { facingMode: 'user' } },
          { audio: false, video: true },
        ]
      : [
          { audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
          { audio: false, video: { facingMode: 'user' } },
          { audio: false, video: true },
        ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await media.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not start the camera.');
}

export async function attachCameraStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.setAttribute('muted', '');
  video.setAttribute('autoplay', '');
  video.playsInline = true;
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  if ('disableRemotePlayback' in video) {
    video.disableRemotePlayback = true;
  }
  video.srcObject = stream;
  if (video.readyState < 2) {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        resolve();
      }, 3000);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Camera preview failed to load'));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }
  try {
    await video.play();
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
      return;
    }
    throw error;
  }
}

export function detachCameraStream(video: HTMLVideoElement | null): void {
  if (!video) return;
  const currentSrc = video.getAttribute('src');
  video.pause();
  video.srcObject = null;
  if (currentSrc && currentSrc.startsWith('blob:')) {
    URL.revokeObjectURL(currentSrc);
    video.removeAttribute('src');
  }
  video.load();
}

export function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement ?? null;
}

export async function requestElementFullscreen(element: HTMLElement): Promise<boolean> {
  const node = element as FullscreenElement;
  try {
    if (element.requestFullscreen) {
      await element.requestFullscreen();
      return getFullscreenElement() === element;
    }
    if (node.webkitRequestFullscreen) {
      await node.webkitRequestFullscreen();
      return getFullscreenElement() === element;
    }
    if (node.webkitRequestFullScreen) {
      await node.webkitRequestFullScreen();
      return getFullscreenElement() === element;
    }
    if (node.mozRequestFullScreen) {
      await node.mozRequestFullScreen();
      return getFullscreenElement() === element;
    }
  } catch {
    // CSS fullscreen keeps overlays and controls visible in every browser.
  }
  return getFullscreenElement() === element;
}

export async function exitElementFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  try {
    if (getFullscreenElement() && document.exitFullscreen) {
      await document.exitFullscreen();
      return;
    }
    if (doc.webkitExitFullscreen) {
      await doc.webkitExitFullscreen();
      return;
    }
    if (doc.mozCancelFullScreen) {
      await doc.mozCancelFullScreen();
    }
  } catch {
    // CSS fullscreen still exits via class.
  }
}

export function subscribeFullscreen(handler: () => void): () => void {
  const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'] as const;
  events.forEach((name) => document.addEventListener(name, handler));
  return () => {
    events.forEach((name) => document.removeEventListener(name, handler));
  };
}
