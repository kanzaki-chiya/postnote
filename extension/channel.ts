/**
 * The MAIN <-> ISOLATED channel that carries GraphQL response text.
 *
 * The page hook runs in the page's own world (MAIN), the post reader in the
 * extension's world (ISOLATED). The two share no JavaScript, only the DOM, so
 * the text is forwarded as a `CustomEvent` on the document whose type carries a
 * per-document random suffix — the two sides find each other without leaving a
 * guessable name for either of them to talk to.
 *
 * The order the two scripts start in is not fixed. Measured (Phase 0): at
 * `document_start` Chrome runs the MAIN script before the ISOLATED one, but the
 * reverse stays possible, so each side is written to work either way. Whichever
 * runs first leaves the suffix in `CHANNEL_ATTR` or waits for the ready event,
 * and one of those two always happens.
 *
 * Trust boundary: the page itself can forge these events. A forged body only
 * changes what a card is rendered from — nothing privileged is reachable
 * through it — so it shares the trust boundary of the page's own DOM.
 */

export const CHANNEL_ATTR = 'data-postnote-channel';
export const CHANNEL_PREFIX = 'postnote:gql:';
export const CHANNEL_READY_EVENT = 'postnote:gql-ready';
export const MAX_BUFFERED_RESPONSES = 200;

/** A suffix the page would have to guess before it could address the channel. */
function randomSuffix(): string {
  const source = globalThis.crypto;
  if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Build the function MAIN calls with every observed response body.
 *
 * The suffix in `CHANNEL_ATTR` is the handshake: ISOLATED writes it before it
 * can receive anything, so finding it at startup means the content script is
 * already listening. When it is absent the page side started first, and what it
 * observes is held — bounded by `MAX_BUFFERED_RESPONSES` — until the ready
 * event announces the other side.
 */
export function createPageBridge(doc: Document): (text: string) => void {
  const dispatch = (target: string, text: string): void => {
    doc.dispatchEvent(new CustomEvent(target, { detail: text }));
  };

  const root = doc.documentElement;
  if (root) {
    const suffix = root.getAttribute(CHANNEL_ATTR);
    if (suffix) {
      // Read and removed in the same turn: the attribute is a greeting, not state.
      root.removeAttribute(CHANNEL_ATTR);
      const target = CHANNEL_PREFIX + suffix;
      return (text: string) => dispatch(target, text);
    }
  }

  const buffered: string[] = [];
  let target: string | null = null;

  const onReady = (): void => {
    const ready = doc.documentElement?.getAttribute(CHANNEL_ATTR) ?? '';
    doc.documentElement?.removeAttribute(CHANNEL_ATTR);
    if (!ready) {
      // The attribute is what the event points at; without it there is no one to
      // answer yet, so wait for the next announcement instead of buffering forever.
      doc.addEventListener(CHANNEL_READY_EVENT, onReady, { once: true });
      return;
    }
    target = CHANNEL_PREFIX + ready;
    for (const text of buffered.splice(0)) dispatch(target, text);
  };
  doc.addEventListener(CHANNEL_READY_EVENT, onReady, { once: true });

  return (text: string) => {
    if (target) {
      dispatch(target, text);
      return;
    }
    buffered.push(text);
    if (buffered.length > MAX_BUFFERED_RESPONSES) buffered.shift();
  };
}

/**
 * Claim the channel from ISOLATED and hand every forwarded body to `onText`.
 *
 * Only a string `detail` is forwarded. The page can dispatch on this event type
 * as well, and a body that is not a string was never response text, so it is
 * dropped rather than coerced.
 *
 * The returned cleanup gives the document back as it was found.
 */
export function attachContentChannel(doc: Document, onText: (text: string) => void): () => void {
  const suffix = randomSuffix();
  const root = doc.documentElement;
  root?.setAttribute(CHANNEL_ATTR, suffix);

  const target = CHANNEL_PREFIX + suffix;
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail === 'string') onText(detail);
  };
  doc.addEventListener(target, listener);
  doc.dispatchEvent(new CustomEvent(CHANNEL_READY_EVENT));

  return () => {
    doc.removeEventListener(target, listener);
    // Another channel may have claimed the attribute in the meantime; only the
    // one this call wrote is removed.
    if (root?.getAttribute(CHANNEL_ATTR) === suffix) root.removeAttribute(CHANNEL_ATTR);
  };
}
