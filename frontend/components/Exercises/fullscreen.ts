/** Shared Full Screen helpers — same behaviour as Rule Based Classifier. */

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export const FS_ICON_ENTER =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

export const FS_ICON_EXIT =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

export function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isElementFullscreen(el: Element | null | undefined): boolean {
  return Boolean(el && getFullscreenElement() === el);
}

export function canRequestFullscreen(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  const node = el as FullscreenElement;
  return Boolean(el.requestFullscreen || node.webkitRequestFullscreen);
}

export async function requestElementFullscreen(el: HTMLElement): Promise<void> {
  const node = el as FullscreenElement;
  if (el.requestFullscreen) {
    await el.requestFullscreen();
    return;
  }
  if (node.webkitRequestFullscreen) {
    await node.webkitRequestFullscreen();
    return;
  }
  throw new Error("Full screen isn't available in this browser");
}

export async function exitElementFullscreen(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (getFullscreenElement() && document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  if (doc.webkitExitFullscreen) {
    await doc.webkitExitFullscreen();
  }
}

export async function toggleElementFullscreen(el: HTMLElement): Promise<void> {
  if (isElementFullscreen(el)) {
    await exitElementFullscreen();
    return;
  }
  await requestElementFullscreen(el);
}

export function subscribeFullscreen(handler: () => void): () => void {
  const events = ['fullscreenchange', 'webkitfullscreenchange'] as const;
  for (const event of events) document.addEventListener(event, handler);
  return () => {
    for (const event of events) document.removeEventListener(event, handler);
  };
}

/** Wire a DOM button so it fullscreens `host` (Rule Based Classifier style). */
export function bindHostFullscreen(host: HTMLElement, btn: HTMLElement | null): () => void {
  if (!btn) return () => undefined;

  const paint = () => {
    const on = isElementFullscreen(host);
    btn.innerHTML = on ? FS_ICON_EXIT : FS_ICON_ENTER;
    btn.title = on ? 'Exit full screen' : 'Full screen';
    btn.setAttribute('aria-label', btn.title);
    btn.classList.toggle('is-fs', on);
  };

  if (!canRequestFullscreen(host)) {
    btn.hidden = true;
    return () => undefined;
  }

  const onClick = () => {
    void toggleElementFullscreen(host).catch(() => undefined);
  };

  btn.addEventListener('click', onClick);
  const unsub = subscribeFullscreen(paint);
  paint();

  return () => {
    btn.removeEventListener('click', onClick);
    unsub();
  };
}
