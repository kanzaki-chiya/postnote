/**
 * Userscript platform adapter backed by `GM.xmlHttpRequest`.
 */

import { downloadBlob } from './export';
import type { Platform } from './platform';

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

export const userscriptPlatform: Platform = {
  async fetchImage(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    const blob = await requestBlob(url, timeoutMs, signal);
    if (!blob || signal?.aborted) return null;
    return blobToDataUrl(blob);
  },
  download(blob: Blob, fileName: string): void {
    downloadBlob(blob, fileName);
  },
};
