// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ancestorPath } from '../src/chain';
import { forgetAll, parentOf, recordTweets, watchNetwork } from '../src/x-network';

const PAYLOAD = JSON.stringify({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          entries: [
            { content: { itemContent: { tweet_results: { result: { rest_id: '100', legacy: { id_str: '100', full_text: 'root' } } } } } },
            { content: { itemContent: { tweet_results: { result: { rest_id: '200', legacy: { id_str: '200', in_reply_to_status_id_str: '100', full_text: 'reply' } } } } } },
            { content: { itemContent: { tweet_results: { result: { rest_id: '300', legacy: { id_str: '300', in_reply_to_status_id_str: '200', full_text: 'deep reply' } } } } } },
            { content: { itemContent: { tweet_results: { result: { rest_id: '400', legacy: { id_str: '400', in_reply_to_status_id_str: null, full_text: 'a separate root' } } } } } },
          ],
        },
      ],
    },
  },
});

beforeEach(() => {
  forgetAll();
});

describe('the parent map', () => {
  it('reads ids and parents out of a conversation payload', () => {
    expect(recordTweets(PAYLOAD)).toBe(4);
    expect(parentOf('100')).toBeNull();
    expect(parentOf('200')).toBe('100');
    expect(parentOf('300')).toBe('200');
    expect(parentOf('400')).toBeNull();
  });

  it('distinguishes a root from a post it never saw', () => {
    recordTweets(PAYLOAD);
    expect(parentOf('100')).toBeNull();
    expect(parentOf('999')).toBeUndefined();
  });

  it('never lets a partial copy erase a known parent', () => {
    // X omits the field for a top-level post, and a partial copy of a reply omits
    // it too; the real value must survive that.
    recordTweets(JSON.stringify({ legacy: { id_str: '300', in_reply_to_status_id_str: '200' } }));
    expect(parentOf('300')).toBe('200');
    recordTweets(JSON.stringify({ legacy: { id_str: '300', full_text: 'copy' } }));
    expect(parentOf('300')).toBe('200');
  });

  it('lets real data correct an earlier assumption of root', () => {
    recordTweets(JSON.stringify({ legacy: { id_str: '300' } }));
    expect(parentOf('300')).toBeNull();
    recordTweets(JSON.stringify({ legacy: { id_str: '300', in_reply_to_status_id_str: '200' } }));
    expect(parentOf('300')).toBe('200');
  });

  it('ignores payloads that carry no posts and never throws', () => {
    expect(recordTweets('{"data":{}}')).toBe(0);
    expect(recordTweets('not json at all')).toBe(0);
    expect(recordTweets('')).toBe(0);
  });

  it('observes both fetch and XMLHttpRequest without changing what they return', async () => {
    const win = window as unknown as Window & typeof globalThis;
    const originalFetch = win.fetch;
    let seenMode: RequestInit | undefined;
    win.fetch = ((_url: string, init?: RequestInit) => {
      seenMode = init;
      return Promise.resolve(
        new Response(PAYLOAD, { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    }) as typeof fetch;
    Object.defineProperty(win, 'fetch', { value: win.fetch, configurable: true });

    watchNetwork(win);
    const response = await win.fetch('https://x.com/i/api/graphql/abc/TweetDetail');
    const text = await response.text();

    expect(text).toBe(PAYLOAD);
    expect(seenMode).toBeUndefined();
    // The observer reads a clone of the body, so it settles on its own tick.
    await vi.waitFor(() => {
      expect(parentOf('300')).toBe('200');
    });

    win.fetch = originalFetch;
  });
});

describe('the ancestor path', () => {
  it('returns the root-first chain for a deep reply', () => {
    recordTweets(PAYLOAD);
    expect(ancestorPath('300', parentOf)).toEqual({
      ids: ['100', '200', '300'],
      complete: true,
      unresolvedFrom: null,
      reason: 'root',
    });
  });

  it('stays complete for a root post', () => {
    recordTweets(PAYLOAD);
    expect(ancestorPath('100', parentOf)).toMatchObject({ ids: ['100'], complete: true });
  });

  it('keeps a verified parent even when that parent has no parent data', () => {
    recordTweets(JSON.stringify({ legacy: { id_str: '500', in_reply_to_status_id_str: '404' } }));
    expect(ancestorPath('500', parentOf)).toEqual({
      ids: ['404', '500'],
      complete: false,
      unresolvedFrom: '404',
      reason: 'unknown-parent',
    });
  });

  it('reports an unknown relation when the post was never loaded', () => {
    expect(ancestorPath('999', parentOf)).toEqual({
      ids: ['999'],
      complete: false,
      unresolvedFrom: '999',
      reason: 'unknown-parent',
    });
  });

  it('stops on a cycle rather than walking forever', () => {
    const cyclic = (id: string) => (id === 'a' ? 'b' : id === 'b' ? 'a' : null);
    const outcome = ancestorPath('a', cyclic);
    expect(outcome.complete).toBe(false);
    expect(outcome.reason).toBe('cycle');
  });

  it('stops at the depth limit', () => {
    const outcome = ancestorPath('n9', (id) => (id === 'n0' ? null : `n${Number(id.slice(1)) - 1}`), 3);
    expect(outcome).toMatchObject({ complete: false, reason: 'too-deep', ids: ['n6', 'n7', 'n8', 'n9'] });
  });
});
