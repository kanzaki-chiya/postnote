// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_IMAGE_HOSTS,
  fetchImageAsDataUrl,
  handleMessage,
  isAllowedImageUrl,
} from '../extension/background';
import {
  CHANNEL_ATTR,
  CHANNEL_PREFIX,
  CHANNEL_READY_EVENT,
  MAX_BUFFERED_RESPONSES,
  attachContentChannel,
  createPageBridge,
} from '../extension/channel';
import { HOMEPAGE_URL, buildManifest } from '../extension/manifest';
import { createExtensionPlatform } from '../extension/platform';

/** A document of its own, so every handshake starts from a clean `<html>`. */
function freshDoc(): Document {
  return document.implementation.createHTMLDocument('postnote-channel-test');
}

function base64Of(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

/** `vi.fn()` cannot express the overloaded `fetch` type; the cast is local. */
function asFetch(impl: unknown): typeof fetch {
  return impl as typeof fetch;
}

describe('the MAIN <-> ISOLATED channel', () => {
  it('buffers what MAIN observed while ISOLATED was not there, and flushes on ready', () => {
    const doc = freshDoc();
    const send = createPageBridge(doc);
    send('{"first":1}');
    send('{"second":2}');
    // MAIN alone leaves no handshake behind: it only speaks once it is told where.
    expect(doc.documentElement.hasAttribute(CHANNEL_ATTR)).toBe(false);

    const received: string[] = [];
    const stop = attachContentChannel(doc, (text) => received.push(text));
    expect(received).toEqual(['{"first":1}', '{"second":2}']);
    // The handshake is a greeting, not state: it is gone after the exchange.
    expect(doc.documentElement.hasAttribute(CHANNEL_ATTR)).toBe(false);

    send('{"third":3}');
    expect(received).toEqual(['{"first":1}', '{"second":2}', '{"third":3}']);
    stop();
  });

  it('delivers straight away when ISOLATED ran first, and clears the handshake', () => {
    const doc = freshDoc();
    const received: string[] = [];
    const stop = attachContentChannel(doc, (text) => received.push(text));
    expect(doc.documentElement.getAttribute(CHANNEL_ATTR)).toBeTruthy();

    const send = createPageBridge(doc);
    expect(doc.documentElement.hasAttribute(CHANNEL_ATTR)).toBe(false);
    send('{"late":true}');
    expect(received).toEqual(['{"late":true}']);
    stop();
  });

  it('keeps waiting for a ready event that carries no handshake', () => {
    const doc = freshDoc();
    const send = createPageBridge(doc);
    doc.dispatchEvent(new CustomEvent(CHANNEL_READY_EVENT));
    send('{"kept":true}');

    const received: string[] = [];
    const stop = attachContentChannel(doc, (text) => received.push(text));
    expect(received).toEqual(['{"kept":true}']);
    stop();
  });

  it('holds the buffer at its limit by dropping the oldest response', () => {
    const doc = freshDoc();
    const send = createPageBridge(doc);
    const total = MAX_BUFFERED_RESPONSES + 5;
    for (let index = 0; index < total; index += 1) send(`body-${index}`);

    const received: string[] = [];
    const stop = attachContentChannel(doc, (text) => received.push(text));
    expect(received).toHaveLength(MAX_BUFFERED_RESPONSES);
    expect(received[0]).toBe('body-5');
    expect(received.at(-1)).toBe(`body-${total - 1}`);
    stop();
  });

  it('forwards a string detail and nothing else', () => {
    const doc = freshDoc();
    const received: string[] = [];
    const stop = attachContentChannel(doc, (text) => received.push(text));
    const target = CHANNEL_PREFIX + (doc.documentElement.getAttribute(CHANNEL_ATTR) ?? '');

    for (const detail of [{ body: 'object' }, 7, null, undefined, ['array'], true]) {
      doc.dispatchEvent(new CustomEvent(target, { detail }));
    }
    expect(received).toEqual([]);

    doc.dispatchEvent(new CustomEvent(target, { detail: '{"data":1}' }));
    expect(received).toEqual(['{"data":1}']);
    stop();
  });

  it('gives the document back on cleanup', () => {
    const doc = freshDoc();
    const received: string[] = [];
    const stop = attachContentChannel(doc, (text) => received.push(text));
    const target = CHANNEL_PREFIX + (doc.documentElement.getAttribute(CHANNEL_ATTR) ?? '');

    stop();
    expect(doc.documentElement.hasAttribute(CHANNEL_ATTR)).toBe(false);
    doc.dispatchEvent(new CustomEvent(target, { detail: 'after cleanup' }));
    expect(received).toEqual([]);
  });
});

describe('the background image fetcher', () => {
  it('accepts exactly the two X image hosts, over https', () => {
    expect(isAllowedImageUrl('https://pbs.twimg.com/media/abc.png')).toBe(true);
    expect(isAllowedImageUrl('https://abs.twimg.com/emoji/1f600.svg')).toBe(true);
    expect(ALLOWED_IMAGE_HOSTS).toEqual(['pbs.twimg.com', 'abs.twimg.com']);

    for (const url of [
      'https://example.com/abc.png',
      'https://evil-pbs.twimg.com/abc.png',
      'https://pbs.twimg.com.example.com/abc.png',
      'http://pbs.twimg.com/media/abc.png',
      'data:image/png;base64,AAAA',
      'not a url',
      '',
    ]) {
      expect(isAllowedImageUrl(url)).toBe(false);
    }
  });

  it('refuses a disallowed URL without calling fetch', async () => {
    const fetchImpl = vi.fn();
    for (const url of [
      'https://example.com/abc.png',
      'https://evil-pbs.twimg.com/abc.png',
      'http://pbs.twimg.com/media/abc.png',
      'https://abs.twimg.com.evil.test/emoji.svg',
      'about:blank',
    ]) {
      await expect(fetchImageAsDataUrl(url, 1_000, asFetch(fetchImpl))).resolves.toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();

    const reply = vi.fn();
    expect(
      handleMessage(
        { type: 'fetch-image', url: 'https://example.com/abc.png', timeoutMs: 1_000 },
        reply,
        asFetch(fetchImpl),
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(null));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('abandons a fetch that outlives its budget', async () => {
    const hanging = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const started = Date.now();
    await expect(
      fetchImageAsDataUrl('https://pbs.twimg.com/media/slow.png', 20, asFetch(hanging)),
    ).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('treats a non-2xx answer as a failure', async () => {
    for (const status of [404, 500]) {
      const fetchImpl = vi.fn(async () => new Response('nope', { status }));
      await expect(
        fetchImageAsDataUrl('https://pbs.twimg.com/media/abc.png', 1_000, asFetch(fetchImpl)),
      ).resolves.toBeNull();
    }
  });

  it('turns a 2xx image into a data URL with the response mime type', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetchImpl = vi.fn(
      async () =>
        new Response(bytes, { status: 200, headers: { 'content-type': 'image/png; charset=binary' } }),
    );

    const dataUrl = await fetchImageAsDataUrl(
      'https://pbs.twimg.com/media/abc.png',
      1_000,
      asFetch(fetchImpl),
    );
    expect(dataUrl).toBe(`data:image/png;base64,${base64Of(bytes)}`);
  });

  it('falls back to application/octet-stream when the response declares no type', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    await expect(
      fetchImageAsDataUrl('https://abs.twimg.com/x', 1_000, asFetch(fetchImpl)),
    ).resolves.toBe(`data:application/octet-stream;base64,${base64Of(bytes)}`);
  });

  it('encodes a body larger than one chunk exactly', async () => {
    const bytes = new Uint8Array(20_000).map((_, index) => index % 256);
    const fetchImpl = vi.fn(
      async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    );
    await expect(
      fetchImageAsDataUrl('https://pbs.twimg.com/media/big.jpg', 5_000, asFetch(fetchImpl)),
    ).resolves.toBe(`data:image/jpeg;base64,${base64Of(bytes)}`);
  });

  it('leaves messages of another shape to the next listener', () => {
    const reply = vi.fn();
    for (const message of [null, undefined, 'fetch-image', { type: 'something-else' }, { type: 'fetch-image' }]) {
      expect(handleMessage(message, reply)).toBe(false);
    }
    expect(reply).not.toHaveBeenCalled();
  });
});

describe('the extension platform adapter', () => {
  it('sends the request the worker expects and passes a data URL through', async () => {
    const send = vi.fn(async () => 'data:image/png;base64,AAAA');
    const platform = createExtensionPlatform(send);

    await expect(
      platform.fetchImage('https://pbs.twimg.com/media/abc.png', 500),
    ).resolves.toBe('data:image/png;base64,AAAA');
    expect(send).toHaveBeenCalledWith({
      type: 'fetch-image',
      url: 'https://pbs.twimg.com/media/abc.png',
      timeoutMs: 500,
    });
  });

  it('accepts only a data URL reply', async () => {
    for (const reply of [null, undefined, 42, {}, 'https://pbs.twimg.com/media/abc.png', 'error']) {
      const platform = createExtensionPlatform(async () => reply);
      await expect(
        platform.fetchImage('https://pbs.twimg.com/media/abc.png', 500),
      ).resolves.toBeNull();
    }
  });

  it('returns null when the send fails', async () => {
    const platform = createExtensionPlatform(async () => {
      throw new Error('worker gone');
    });
    await expect(platform.fetchImage('https://pbs.twimg.com/media/abc.png', 500)).resolves.toBeNull();
  });

  it('never sends when the signal is already aborted', async () => {
    const send = vi.fn(async () => 'data:image/png;base64,AAAA');
    const platform = createExtensionPlatform(send);
    const controller = new AbortController();
    controller.abort();

    await expect(
      platform.fetchImage('https://pbs.twimg.com/media/abc.png', 500, controller.signal),
    ).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('settles on abort instead of waiting for the worker', async () => {
    const platform = createExtensionPlatform(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = platform.fetchImage(
      'https://pbs.twimg.com/media/abc.png',
      60_000,
      controller.signal,
    );
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });

  it('gives up on a reply that never arrives', async () => {
    vi.useFakeTimers();
    try {
      const platform = createExtensionPlatform(() => new Promise(() => {}));
      const pending = platform.fetchImage('https://pbs.twimg.com/media/abc.png', 10);
      await vi.advanceTimersByTimeAsync(2_011);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the extension manifest', () => {
  it('takes its version from the package and asks for nothing else', () => {
    const manifest = buildManifest({ version: '9.9.9' });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('9.9.9');
    expect(manifest.default_locale).toBe('en');
    expect(manifest.name).toBe('__MSG_extName__');
    expect(manifest.description).toBe('__MSG_extDescription__');
    expect(manifest.homepage_url).toBe(HOMEPAGE_URL);
    expect(manifest.host_permissions).toEqual([
      'https://pbs.twimg.com/*',
      'https://abs.twimg.com/*',
    ]);
    expect(manifest).not.toHaveProperty('permissions');
  });

  it('runs the page hook in the page world and the reader with its stylesheet', () => {
    const manifest = buildManifest({ version: '0.0.0' });
    const matches = [
      'https://x.com/*',
      'https://*.x.com/*',
      'https://twitter.com/*',
      'https://*.twitter.com/*',
    ];

    expect(manifest.content_scripts).toHaveLength(2);
    const [pageHook, content] = manifest.content_scripts;
    expect(pageHook).toEqual({
      matches,
      run_at: 'document_start',
      js: ['page-hook.js'],
      world: 'MAIN',
    });
    expect(content).toEqual({
      matches,
      run_at: 'document_start',
      js: ['content.js'],
      css: ['content.css'],
    });
    expect(manifest.action.default_title).toBe('推笺 · PostNote');
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
  });
});
