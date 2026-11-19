/**
 * Extension platform adapter: media and downloads for a content script.
 *
 * A content script cannot read `pbs.twimg.com` itself — the page's own CORS
 * rules apply to it — so images are fetched by the background service worker
 * and arrive here as data URLs. Every request has a bounded life: the worker
 * bounds its fetch, and the guard below bounds the wait for the worker's reply.
 */

/// <reference path="./chrome.d.ts" />

import { downloadBlob } from '../src/export';
import type { Platform } from '../src/platform';

/** Added to the worker's own budget; past this the reply is not coming. */
const REPLY_GRACE_MS = 2_000;

export type FetchImageRequest = {
  type: 'fetch-image';
  url: string;
  timeoutMs: number;
};

/** How a caller reaches the background service worker. */
export type SendMessage = (message: FetchImageRequest) => Promise<unknown>;

/** Only a complete data URL is a usable image; everything else is a failure. */
function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

/** Read the error a failed call leaves behind; reading it also clears it. */
function runtimeError(): string | null {
  if (typeof chrome === 'undefined') return null;
  const error = chrome.runtime?.lastError;
  return error ? error.message ?? 'unknown error' : null;
}

export function createExtensionPlatform(sendMessage: SendMessage): Platform {
  return {
    fetchImage(url: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
      if (signal?.aborted) return Promise.resolve(null);

      const { promise, resolve } = Promise.withResolvers<string | null>();
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      // An abort settles the caller in this turn instead of whenever the worker
      // gets around to answering.
      const onAbort = () => finish(null);
      // A worker that was stopped mid-request never answers at all, so the wait
      // needs a bound of its own.
      const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs) + REPLY_GRACE_MS);

      signal?.addEventListener('abort', onAbort, { once: true });
      void (async () => {
        try {
          const response = await sendMessage({ type: 'fetch-image', url, timeoutMs });
          finish(runtimeError() || !isDataUrl(response) ? null : response);
        } catch {
          finish(null);
        }
      })();
      return promise;
    },
    download(blob: Blob, fileName: string): void {
      downloadBlob(blob, fileName);
    },
  };
}

function sendToBackground(message: FetchImageRequest): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

export const extensionPlatform: Platform = createExtensionPlatform(sendToBackground);
