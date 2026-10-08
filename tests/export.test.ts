// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  ExportError,
  buildFileName,
  getCaptureDimensions,
  planCapture,
  prepareCard,
} from '../src/export';
import { renderCard } from '../src/render';
import type { TweetData } from '../src/tweet';

const OPTIONS = { focused: true, connector: false, language: 'zh', traditional: false } as const;
const SHORT_TIMEOUT = { timeoutMs: 30 };

function cardWith(data: Partial<TweetData>): HTMLElement {
  return renderCard(
    {
      id: '100',
      url: 'https://x.com/alice/status/100',
      author: { name: 'Alice', handle: '@alice', avatarUrl: null },
      time: { absolute: null, visible: null },
      body: [{ kind: 'text', text: '正文' }],
      images: [],
      quote: { kind: 'none' },
      metrics: {},
      reply: { kind: 'unknown' },
      ...data,
    },
    OPTIONS,
  );
}

function stubRect(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe('preparing resources', () => {
  it('does not accept an image just because its source is a data URL', async () => {
    const card = cardWith({
      images: [{ kind: 'photo', src: 'data:image/png;base64,not-an-image', alt: '' }],
    });
    const report = await prepareCard(card, { cache: new Map(), ...SHORT_TIMEOUT });
    expect(report.blocking).toHaveLength(1);
    expect(report.blocking[0].role).toBe('media');
    expect(report.blocking[0].reason).toBe('decode');
  });

  it('ends a request that never settles through the timeout path', async () => {
    const card = cardWith({ images: [{ kind: 'photo', src: 'https://abs.twimg.com/emoji/1f600.svg', alt: '' }] });
    const started = Date.now();
    const report = await prepareCard(card, { cache: new Map(), ...SHORT_TIMEOUT });
    expect(report.blocking[0]?.reason).toBe('http');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('degrades an emoji image that has Unicode to fall back on', async () => {
    const card = cardWith({
      body: [{ kind: 'emoji', unicode: '😀', src: 'data:image/png;base64,bad' }],
    });
    const report = await prepareCard(card, { cache: new Map(), ...SHORT_TIMEOUT });
    expect(report.blocking).toHaveLength(0);
    expect(report.degraded).toHaveLength(1);
    expect(card.querySelector('.postnote-text')?.textContent).toBe('😀');
  });

  it('retries a failed large avatar with the delivered URL before degrading', async () => {
    const card = cardWith({
      author: {
        name: 'Alice',
        handle: '@alice',
        avatarUrl: 'data:image/png;base64,large',
        avatarFallbackUrl: 'data:image/png;base64,small',
      },
    });
    const setter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!.set!;
    const tried: string[] = [];
    const spy = vi
      .spyOn(HTMLImageElement.prototype, 'src', 'set')
      .mockImplementation(function (this: HTMLImageElement, value: string) {
        tried.push(value);
        setter.call(this, value);
      });
    const report = await prepareCard(card, { cache: new Map(), ...SHORT_TIMEOUT });
    spy.mockRestore();
    expect(tried).toContain('data:image/png;base64,small');
    expect(report.blocking).toHaveLength(0);
    expect(report.degraded).toHaveLength(1);
  });

  it('stops working when the run is cancelled', async () => {
    const controller = new AbortController();
    const card = cardWith({ images: [{ kind: 'photo', src: 'https://abs.twimg.com/emoji/1f600.svg', alt: '' }] });
    controller.abort();
    const report = await prepareCard(card, {
      cache: new Map(),
      signal: controller.signal,
      ...SHORT_TIMEOUT,
    });
    expect(report.blocking).toHaveLength(0);
    expect(report.degraded).toHaveLength(0);
  });
});

describe('capture planning', () => {
  it('captures a normal card at the full scale', () => {
    const card = cardWith({});
    stubRect(card, 650, 800);
    expect(getCaptureDimensions(card)).toEqual({ width: 1950, height: 2400, pixels: 4_680_000 });
    expect(planCapture(card)).toEqual({
      scale: 3,
      width: 1950,
      height: 2400,
      pixels: 4_680_000,
      limited: false,
    });
  });

  it('keeps the full scale up to the last size that still fits', () => {
    const card = cardWith({});
    stubRect(card, 650, 5461);
    expect(planCapture(card)).toMatchObject({ scale: 3, height: 16_383, limited: false });
  });

  it('lowers the scale instead of letting the engine silently downscale', () => {
    const card = cardWith({});
    stubRect(card, 650, 5462);
    // 3x would be 16386 px tall; the plan must fit inside the 16384 px side limit.
    expect(planCapture(card)).toMatchObject({ scale: 2.99, height: 16_332, limited: true });
  });

  it('still fails when even 1x cannot fit', () => {
    const card = cardWith({});
    stubRect(card, 650, 20_000);
    expect(planCapture(card)).toBeNull();
  });

  it('fails a card that has no measurable size', () => {
    const card = cardWith({});
    stubRect(card, 0, 0);
    expect(planCapture(card)).toBeNull();
  });
});

describe('file names', () => {
  it('bounds and sanitizes the pieces it is given', () => {
    expect(buildFileName('@alice', '100')).toBe('postnote-alice-100.png');
    expect(buildFileName('@a/b:c*?"<>|', '1')).toBe('postnote-a_b_c______-1.png');
    expect(buildFileName('@alice', '')).toBe('postnote-alice-postnote.png');
    expect(buildFileName('@' + 'x'.repeat(200), '1').length).toBeLessThanOrEqual(200);
  });
});
