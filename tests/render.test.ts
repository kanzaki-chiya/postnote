// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { applyAvatarPlaceholder, applyEmojiFallback, renderCard } from '../src/render';
import { ROLE_ATTRIBUTE } from '../src/render';
import type { TweetData } from '../src/tweet';
import { buildPost } from './fixtures/build-page';
import { readTweet } from '../src/x-page';

const OPTIONS = { language: 'zh', traditional: false } as const;

function sample(overrides: Partial<TweetData> = {}): TweetData {
  return {
    id: '100',
    url: 'https://x.com/alice/status/100',
    author: { name: 'Alice', handle: '@alice', avatarUrl: 'https://pbs.twimg.com/a.jpg' },
    time: { absolute: null, visible: '2h' },
    body: [{ kind: 'text', text: '正文' }],
    images: [],
    quote: { kind: 'none' },
    metrics: {},
    reply: { kind: 'unknown' },
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('rendering a card', () => {
  it('renders the same snapshot twice without changing it or the first result', () => {
    const article = buildPost({
      id: '100',
      text: 'hello',
      media: ['https://pbs.twimg.com/media/m?format=jpg'],
    });
    document.body.appendChild(article);
    const extract = readTweet(article);
    if (!extract.ok) throw new Error(extract.failure);
    const before = structuredClone(extract.data);

    const first = renderCard(extract.data, OPTIONS);
    const second = renderCard(extract.data, OPTIONS);

    expect(first.textContent).toContain('hello');
    expect(second.textContent).toContain('hello');
    expect(first.querySelectorAll('img')).toHaveLength(2);
    expect(second.querySelectorAll('img')).toHaveLength(2);
    expect(extract.data).toEqual(before);
    expect(first).not.toBe(second);
  });

  it('hides an unknown count and keeps a real zero', () => {
    const hidden = renderCard(sample({ metrics: {} }), OPTIONS);
    expect(hidden.querySelector('.postnote-mx')).toBeNull();

    const zero = renderCard(sample({ metrics: { likes: '0' } }), OPTIONS);
    const counts = zero.querySelectorAll('.postnote-metric-count');
    expect(counts).toHaveLength(1);
    expect(counts[0].textContent).toBe('0');
    expect(zero.querySelector('.postnote-metric')?.getAttribute('aria-label')).toBe('点赞 0');
  });

  it('renders the action row in X order, views going to the stamp line', () => {
    const card = renderCard(
      sample({
        metrics: { replies: '1', reposts: '0', likes: '1', views: '592', bookmarks: '69' },
      }),
      OPTIONS,
    );
    const row = card.querySelector('.postnote-mx');
    expect([...row!.querySelectorAll<HTMLElement>('.postnote-metric')].map((item) => item.dataset.metric)).toEqual([
      'replies',
      'reposts',
      'likes',
      'bookmarks',
    ]);
    // A real zero is drawn; an unknown count is absent entirely.
    expect(row!.textContent).toBe('10169');
    // The view count belongs to the timestamp line, the way X's detail page has it.
    expect(card.querySelector('.postnote-stamp')?.textContent).toBe('2h · 592 次查看');
    const glyphs = [...row!.querySelectorAll('svg path')].map((path) => path.getAttribute('d'));
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('omits a count the page never showed', () => {
    const card = renderCard(sample({ metrics: { likes: '3' } }), OPTIONS);
    expect([...card.querySelectorAll<HTMLElement>('.postnote-metric')].map((item) => item.dataset.metric)).toEqual([
      'likes',
    ]);
  });

  it('shows an unreadable quote as its own state, not an empty box', () => {
    const card = renderCard(sample({ quote: { kind: 'unreadable' } }), OPTIONS);
    const quote = card.querySelector('.postnote-quote');
    expect(quote?.classList.contains('is-unreadable')).toBe(true);
    expect(quote?.textContent).not.toBe('');
  });

  it('falls back to the Unicode an emoji image stood for', () => {
    const card = renderCard(
      sample({
        body: [
          { kind: 'text', text: 'hi ' },
          { kind: 'emoji', unicode: '😀', src: 'https://abs.twimg.com/emoji/1f600.svg' },
        ],
      }),
      OPTIONS,
    );
    const image = card.querySelector<HTMLImageElement>(`img[${ROLE_ATTRIBUTE}="emoji"]`);
    expect(image).not.toBeNull();
    applyEmojiFallback(image as HTMLImageElement);
    expect(card.querySelector('.postnote-text')?.textContent).toBe('hi 😀');
  });

  it('replaces a failed avatar with a placeholder that still names the author', () => {
    const card = renderCard(sample(), OPTIONS);
    const avatar = card.querySelector<HTMLImageElement>(`.postnote-avatar`);
    expect(avatar).not.toBeNull();
    applyAvatarPlaceholder(avatar as HTMLImageElement, 'Alice');
    const placeholder = card.querySelector('.postnote-avatar-placeholder');
    expect(placeholder?.textContent).toBe('A');
  });
});
