/**
 * The background service worker: resolves post images for the content script.
 *
 * X's media hosts do not let a page origin read their bytes, so the content
 * script asks here instead. That makes this a security boundary as much as a
 * proxy: only the two hosts whose images a card actually draws are fetched, and
 * only over HTTPS, so a page cannot borrow the worker's host permissions to
 * read anything else.
 */

/// <reference path="./chrome.d.ts" />

export const ALLOWED_IMAGE_HOSTS: readonly string[] = ['pbs.twimg.com', 'abs.twimg.com'];

/** Used when a message carries no usable budget of its own. */
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Base64 work is done in slices: a photo can be several megabytes, and one
 * `String.fromCharCode(...bytes)` over it is a call the engine may refuse.
 */
const BASE64_CHUNK = 0x2000;

/**
 * Whether this URL may be fetched at all.
 *
 * The hostname has to match one of the allowed hosts exactly — a suffix check
 * would accept `evil-pbs.twimg.com` — and the scheme has to be HTTPS.
 */
export function isAllowedImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.includes(parsed.hostname);
}

/**
 * Encode bytes as base64. `FileReader` does not exist in an MV3 service worker;
 * `btoa` does.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * Fetch one allowed image and return it as a data URL.
 *
 * A URL that is not allowed is refused before `fetch` is ever called. Any other
 * outcome that is not a complete 2xx image — timeout, HTTP error, network
 * failure — is `null`, never a partial body.
 */
export async function fetchImageAsDataUrl(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!isAllowedImageUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) return null;
    const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${mime || 'application/octet-stream'};base64,${toBase64(bytes)}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type FetchImageMessage = { type?: unknown; url?: unknown; timeoutMs?: unknown };

/**
 * Answer one content-script message.
 *
 * `true` means the message was ours and the reply follows later from the fetch,
 * which is also what keeps the channel open until `sendResponse` runs. A message
 * of another shape is left for whoever else is listening.
 */
export function handleMessage(
  message: unknown,
  sendResponse: (res: string | null) => void,
  fetchImpl: typeof fetch = fetch,
): boolean {
  const request = message as FetchImageMessage | null;
  if (!request || request.type !== 'fetch-image' || typeof request.url !== 'string') return false;

  const timeoutMs =
    typeof request.timeoutMs === 'number' &&
    Number.isFinite(request.timeoutMs) &&
    request.timeoutMs > 0
      ? request.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  fetchImageAsDataUrl(request.url, timeoutMs, fetchImpl).then(sendResponse, () => sendResponse(null));
  return true;
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) =>
    handleMessage(message, sendResponse),
  );
}
