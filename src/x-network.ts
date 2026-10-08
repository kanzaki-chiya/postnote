/**
 * The tweet data X itself loads.
 *
 * The page DOM carries no parent id — a reply's article looks exactly like a
 * root post's — and X recycles articles once they scroll far enough away, so a
 * post that was rendered a moment ago can be gone entirely. Both problems are
 * solved by reading the data the page already fetched: every GraphQL response
 * is observed as it arrives, and each tweet node in it is condensed into a
 * small, sanitized snapshot kept in memory. No request of its own is ever made;
 * this module reads what the page was going to load anyway.
 *
 * A post that appears with `in_reply_to_status_id_str` absent is a root
 * (`null`). A post that has not been seen at all is unknown (`undefined`), and
 * callers must not treat the two the same.
 */

import type { TweetSnapshot } from './x-snapshot';
import { snapshotFromNode } from './x-snapshot';

const GRAPHQL_MARKER = '/graphql/';
const LEGACY_MARKER = '"legacy"';
const MAX_ENTRIES = 5_000;
const MAX_NODES = 400_000;

/** `null` = root, a string = parent id, absent = not known. */
const parents = new Map<string, string | null>();

/** Snapshot per status id; the map doubles as an LRU by reinsertion. */
const snapshots = new Map<string, TweetSnapshot>();

type TweetNode = {
  id?: string;
  rest_id?: string;
  legacy?: { id_str?: string; in_reply_to_status_id_str?: string | null };
};

function rememberParent(id: string, informative: boolean, parent: string | null): boolean {
  const known = parents.get(id);
  const has = parents.has(id);
  if (informative) {
    // Real data always wins, and may correct an earlier guess of "root".
    if (!has || known !== parent) {
      parents.set(id, parent);
      return true;
    }
    return false;
  }
  if (!has) {
    // X omits the field for a top-level post, but a partial copy of a reply
    // omits it too: assume a root only when nothing better is known.
    parents.set(id, null);
    return true;
  }
  return false;
}

function trim<T>(map: Map<string, T>): void {
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    parents.delete(oldest.value);
    snapshots.delete(oldest.value);
  }
}

/**
 * Record every tweet node in one response body: the `status id -> parent id`
 * pair, and a sanitized content snapshot for posts the response describes
 * completely.
 *
 * Exported so the walking logic can be exercised against captured payloads
 * without a live page.
 */
export function recordTweets(text: string): number {
  if (!text || !text.includes(LEGACY_MARKER)) return 0;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 0;
  }

  let recorded = 0;
  let visited = 0;
  const stack: unknown[] = [data];
  while (stack.length > 0 && visited < MAX_NODES) {
    const node = stack.pop();
    visited += 1;
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const candidate = node as TweetNode;
    const legacy = candidate.legacy;
    const id = candidate.rest_id ?? candidate.id ?? legacy?.id_str;
    if (legacy && typeof legacy === 'object' && id) {
      const informative = 'in_reply_to_status_id_str' in legacy;
      const parent = legacy.in_reply_to_status_id_str ?? null;
      if (rememberParent(id, informative, parent)) recorded += 1;
      touch(id);
    }
    const snapshot = snapshotFromNode(node);
    if (snapshot) {
      if (snapshots.has(snapshot.data.id)) snapshots.delete(snapshot.data.id);
      snapshots.set(snapshot.data.id, snapshot);
      // A complete snapshot also settles the parent relation.
      const relation = snapshot.data.reply;
      if (relation.kind === 'reply') parents.set(snapshot.data.id, relation.parentId);
      else if (relation.kind === 'root') {
        if (!parents.has(snapshot.data.id)) parents.set(snapshot.data.id, null);
      }
      trim(snapshots);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  trim(parents);
  return recorded;
}

export function parentOf(id: string): string | null | undefined {
  touch(id);
  return parents.get(id);
}

function touch(id: string): void {
  if (parents.has(id)) {
    const parent = parents.get(id)!;
    parents.delete(id);
    parents.set(id, parent);
  }
  const snapshot = snapshots.get(id);
  if (snapshot) {
    snapshots.delete(id);
    snapshots.set(id, snapshot);
  }
}

/** The snapshot for one status id, when a GraphQL response carried it. */
export function snapshotOf(id: string): TweetSnapshot | undefined {
  touch(id);
  return snapshots.get(id);
}

export function forgetAll(): void {
  parents.clear();
  snapshots.clear();
}

type WatchTarget = Window & typeof globalThis;

const watched = new WeakSet<object>();

/**
 * Start observing the page's own GraphQL traffic.
 *
 * Both `fetch` and `XMLHttpRequest` are covered: X uses both, and a userscript
 * that hooked only one would silently miss half the conversations. The page
 * object is reached through `unsafeWindow` when the userscript sandbox has it.
 */
export function watchNetwork(explicit?: WatchTarget): void {
  const target = explicit ?? ((globalThis as { unsafeWindow?: WatchTarget }).unsafeWindow ?? (globalThis as unknown as WatchTarget));
  if (!target || watched.has(target)) return;
  watched.add(target);

  const originalFetch = target.fetch;
  if (typeof originalFetch === 'function') {
    target.fetch = function watchedFetch(
      this: unknown,
      ...args: Parameters<typeof fetch>
    ) {
      return originalFetch.apply(this, args).then((response) => {
        try {
          const url = String(response.url || (args[0] as Request)?.url || args[0]);
          if (url.includes(GRAPHQL_MARKER)) {
            response
              .clone()
              .text()
              .then((text) => recordTweets(text))
              .catch(() => undefined);
          }
        } catch {
          // Observing is best effort; the page keeps working either way.
        }
        return response;
      });
    } as typeof fetch;
  }

  const Xhr = target.XMLHttpRequest;
  if (typeof Xhr === 'function' && Xhr.prototype?.open) {
    const originalOpen = Xhr.prototype.open;
    Xhr.prototype.open = function watchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      this.addEventListener('load', () => {
        try {
          if (String(url).includes(GRAPHQL_MARKER)) recordTweets(this.responseText);
        } catch {
          // Same as above: never break the page's own request.
        }
      });
      return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof Xhr.prototype.open;
  }
}
