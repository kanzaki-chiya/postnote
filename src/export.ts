/**
 * Turning a rendered card into a PNG file.
 *
 * The rules that matter here:
 *
 * - An image counts as loaded only when it really decoded. `complete`, a
 *   `data:` prefix, or a network event are not proof on their own.
 * - Every request has a bounded life: it succeeds, fails, times out, or is
 *   cancelled. Nothing waits forever.
 * - A resource that cannot be used either degrades in a defined way or stops
 *   the export. It is never silently dropped from the finished image.
 */

import { snapdom } from '@zumer/snapdom';
import type { ExportFailure } from './messages';
import {
  ROLE_ATTRIBUTE,
  applyAvatarPlaceholder,
  applyEmojiFallback,
  applyOrgFallback,
  type ResourceRole,
} from './render';

export const EXPORT_SCALE = 3;

/**
 * Limits of the capture engine, not of some theoretical browser.
 *
 * Measured: SnapDOM downscales any output wider or taller than 16384 px and only
 * logs a warning, so a tall post silently produced a 1296x16384 image instead of
 * the promised 1950x24633. The guard has to refuse above 16384 per side, and
 * `capturePng` re-checks the produced bitmap so a silent downscale can never
 * again be delivered as a successful export. The pixel budget is 16384^2, which
 * is also the engine's own total-pixel limit.
 */
const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_PIXELS = 268_000_000;

/**
 * Internal budgets, not browser guarantees. They bound how long one export can
 * wait on the network; tune them against real measurements.
 */
const RESOURCE_TIMEOUT_MS = 12_000;
const PREPARE_BUDGET_MS = 45_000;
const FONT_TIMEOUT_MS = 2_000;
const RESOURCE_CONCURRENCY = 4;

/** Hosts PostNote is allowed to fetch through the userscript request API. */
const ALLOWED_MEDIA_HOSTS: Record<string, true> = {
  'pbs.twimg.com': true,
  'abs.twimg.com': true,
};

const PNG_CHARS = /[\\/:*?"<>|]/g;
const CONTROL_CHARS = /[\u0000-\u001f]/g;

export class ExportError extends Error {
  readonly code: ExportFailure;

  constructor(code: ExportFailure) {
    super(code);
    this.name = 'ExportError';
    this.code = code;
  }
}

export type ResourceFailure = {
  role: ResourceRole;
  src: string;
  reason: 'timeout' | 'http' | 'decode' | 'unsupported' | 'cancelled';
};

export type PrepareReport = {
  /** Failures that degrade instead of stopping the export. */
  degraded: ResourceFailure[];
  /** Failures that make the finished image incomplete, so the export stops. */
  blocking: ResourceFailure[];
  fontTimedOut: boolean;
};

type GmResponse = { status: number; response: Blob | null };

type GmDetails = {
  method: 'GET';
  url: string;
  responseType: 'blob';
  timeout: number;
  onload: (response: GmResponse) => void;
  onerror: () => void;
  ontimeout: () => void;
  onabort: () => void;
};

type GmRuntime = typeof globalThis & {
  GM?: { xmlHttpRequest?: (details: GmDetails) => void };
  GM_xmlhttpRequest?: (details: GmDetails) => void;
};

const runtime = globalThis as GmRuntime;

function isAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

/** Fetch through the userscript API, which is not subject to page CORS. */
function requestBlob(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Blob | null> {
  const request = runtime.GM?.xmlHttpRequest ?? runtime.GM_xmlhttpRequest;
  if (typeof request !== 'function') return Promise.resolve(null);

  const { promise, resolve } = Promise.withResolvers<Blob | null>();
  let settled = false;
  const finish = (blob: Blob | null) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener('abort', onAbort);
    resolve(blob);
  };
  const onAbort = () => finish(null);

  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    request.call(runtime, {
      method: 'GET',
      url,
      responseType: 'blob',
      timeout: timeoutMs,
      onload: (response) =>
        finish(response.status >= 200 && response.status < 300 ? response.response : null),
      onerror: () => finish(null),
      ontimeout: () => finish(null),
      onabort: () => finish(null),
    });
  } catch {
    finish(null);
  }
  return promise;
}

function blobToDataUrl(blob: Blob): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const reader = new FileReader();
  reader.onloadend = () =>
    resolve(typeof reader.result === 'string' ? reader.result : null);
  reader.onerror = () => resolve(null);
  reader.readAsDataURL(blob);
  return promise;
}

/**
 * Wait until an image is decoded, not merely requested.
 *
 * `naturalWidth > 0` is the acceptance test. A `data:` URL that failed to decode
 * has `naturalWidth === 0` and is rejected like any other broken image.
 */
function waitForDecode(image: HTMLImageElement, timeoutMs: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    image.removeEventListener('load', onLoad);
    image.removeEventListener('error', onError);
    resolve(ok);
  };
  const onLoad = () => finish(image.naturalWidth > 0);
  const onError = () => finish(false);
  const timer = setTimeout(() => finish(image.naturalWidth > 0), timeoutMs);

  if (image.complete) finish(image.naturalWidth > 0);
  else {
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
  }
  return promise;
}

async function waitForFonts(timeoutMs: number): Promise<boolean> {
  const ready = document.fonts?.ready;
  if (!ready) return false;
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => resolve(true), timeoutMs);
  const settle = () => {
    clearTimeout(timer);
    resolve(false);
  };
  ready.then(settle, settle);
  return promise;
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function isAllowedHost(value: string): boolean {
  try {
    return ALLOWED_MEDIA_HOSTS[new URL(value).hostname] === true;
  } catch {
    return false;
  }
}

function canDegrade(role: ResourceRole, image: HTMLImageElement): boolean {
  if (role === 'emoji') return Boolean(image.dataset.unicode);
  return role === 'avatar' || role === 'quote-avatar' || role === 'org';
}

/**
 * Resolve every image inside `deck` and report what could not be used.
 *
 * `cache` deduplicates identical sources within one export round: a snapshot
 * reused for a second render does not refetch what the first render already
 * resolved. `timeoutMs` overrides the per-resource budget so the wait can be
 * measured instead of assumed.
 */
export async function prepareCard(
  deck: HTMLElement,
  options: { cache: Map<string, string>; signal?: AbortSignal; timeoutMs?: number },
): Promise<PrepareReport> {
  const resourceTimeout = options.timeoutMs ?? RESOURCE_TIMEOUT_MS;
  const deadline = Date.now() + PREPARE_BUDGET_MS;
  const report: PrepareReport = { degraded: [], blocking: [], fontTimedOut: false };
  report.fontTimedOut = await waitForFonts(FONT_TIMEOUT_MS);

  const images = Array.from(
    deck.querySelectorAll<HTMLImageElement>(`img[${ROLE_ATTRIBUTE}]`),
  );

  await runPool(images, RESOURCE_CONCURRENCY, async (image) => {
    if (isAborted(options.signal)) return;
    const role = (image.getAttribute(ROLE_ATTRIBUTE) ?? 'media') as ResourceRole;
    const source = image.dataset.postnoteSrc || image.getAttribute('src') || '';
    if (!source) {
      report.blocking.push({ role, src: '', reason: 'unsupported' });
      return;
    }

    const remaining = () => Math.max(1, Math.min(resourceTimeout, deadline - Date.now()));
    const load = async (url: string): Promise<ResourceFailure['reason'] | null> => {
      if (!url.startsWith('data:') && isAllowedHost(url)) {
        let resolved = options.cache.get(url) ?? '';
        if (!resolved) {
          const blob = await requestBlob(url, remaining(), options.signal);
          resolved = blob ? (await blobToDataUrl(blob)) ?? '' : '';
          if (resolved) options.cache.set(url, resolved);
        }
        if (resolved) image.src = resolved;
        else return isAborted(options.signal) ? 'cancelled' : 'http';
      } else if (image.getAttribute('src') !== url) {
        image.src = url;
      }
      return (await waitForDecode(image, remaining())) ? null : 'decode';
    };

    let failure = await load(source);
    // A larger rendition that fails falls back to the URL the page delivered.
    const fallback = image.dataset.postnoteFallback;
    if (failure && failure !== 'cancelled' && fallback && fallback !== source) {
      failure = await load(fallback);
    }
    if (!failure) return;

    const entry: ResourceFailure = { role, src: source, reason: failure };
    if (canDegrade(role, image)) {
      if (role === 'emoji') applyEmojiFallback(image);
      else if (role === 'org') applyOrgFallback(image);
      else applyAvatarPlaceholder(image, image.dataset.ownerName ?? '');
      report.degraded.push(entry);
      return;
    }
    report.blocking.push(entry);
  });

  return report;
}

export function getCaptureDimensions(
  element: HTMLElement,
  scale = EXPORT_SCALE,
): { width: number; height: number; pixels: number } {
  const rect = element.getBoundingClientRect();
  const cssWidth = Math.max(rect.width, element.scrollWidth || 0);
  const cssHeight = Math.max(rect.height, element.scrollHeight || 0);
  const width = Math.ceil(cssWidth * scale);
  const height = Math.ceil(cssHeight * scale);
  return { width, height, pixels: width * height };
}

export type CapturePlan = {
  scale: number;
  width: number;
  height: number;
  pixels: number;
  /** True when the content did not fit at the preferred scale. */
  limited: boolean;
};

/**
 * Choose the largest scale at which this deck can actually be captured.
 *
 * Content taller than the engine's 16384 px side limit used to be refused. A
 * post with four phone screenshots is ordinary material, though, and refusing it
 * leaves the user with nothing, so the deck is captured at the highest whole
 * scale that fits and the caller reports the exact size that was produced.
 * Below 1x the text stops being readable, so that case still fails.
 */
export function planCapture(element: HTMLElement, preferred = EXPORT_SCALE): CapturePlan | null {
  const rect = element.getBoundingClientRect();
  const cssWidth = Math.max(rect.width, element.scrollWidth || 0);
  const cssHeight = Math.max(rect.height, element.scrollHeight || 0);
  if (cssWidth <= 0 || cssHeight <= 0) return null;

  const fits = (scale: number) => {
    const { width, height, pixels } = getCaptureDimensions(element, scale);
    return width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE && pixels <= MAX_CANVAS_PIXELS;
  };
  if (fits(preferred)) {
    return {
      scale: preferred,
      ...getCaptureDimensions(element, preferred),
      limited: false,
    };
  }

  const limit = Math.min(
    MAX_CANVAS_SIDE / cssWidth,
    MAX_CANVAS_SIDE / cssHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)),
  );
  const scale = Math.floor(Math.min(preferred, limit) * 100) / 100;
  if (scale < 1) return null;
  return { scale, ...getCaptureDimensions(element, scale), limited: true };
}

/**
 * Capture the deck at the scale the plan chose.
 *
 * The pixel ratio is pinned to 1 so the image is exactly `scale` times the CSS
 * size on every display. Left at the default, SnapDOM multiplies by
 * `devicePixelRatio`: measured on a 125% display, a card that the plan sized as
 * 1950x3774 came out 2437x4717.
 *
 * The produced bitmap is then compared with the plan. The engine downscales
 * oversized output instead of failing, and a smaller image must be reported as a
 * failed export rather than handed to the user as a success.
 */
export async function capturePng(deck: HTMLElement, plan: CapturePlan): Promise<Blob> {
  const capture = await snapdom(deck, {
    scale: plan.scale,
    dpr: 1,
    embedFonts: true,
    backgroundColor: '#ffffff',
  });
  const blob = await capture.toBlob({ type: 'png' });
  if (!blob || blob.size === 0) throw new ExportError('empty-image');

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const produced = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    // The engine rounds its own output, so allow a little slack; a real
    // downscale is off by whole factors, not by a pixel or two.
    const shortfall = produced.width < plan.width * 0.98 || produced.height < plan.height * 0.98;
    if (shortfall) throw new ExportError('too-large');
  }
  return blob;
}

/**
 * Build the download name.
 *
 * This sanitizes the pieces it is given; it is not a general-purpose file-name
 * validator for arbitrary input.
 */
export function buildFileName(handle: string, id: string): string {
  const clean = (value: string) =>
    value
      .replace(PNG_CHARS, '_')
      .replace(CONTROL_CHARS, '')
      .replace(/^\.+/, '')
      .replace(/[. ]+$/g, '')
      .slice(0, 60) || 'postnote';
  return `postnote-${clean(handle.replace(/^@/, ''))}-${clean(id)}.png`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = fileName;
  link.href = url;
  link.rel = 'noopener';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
