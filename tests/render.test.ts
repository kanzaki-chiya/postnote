// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAvatarPlaceholder,
  applyCardMediaFallback,
  applyEmojiFallback,
  formatPollPercent,
  renderCard,
} from '../src/render';
import { ROLE_ATTRIBUTE } from '../src/render';
import type { TweetData } from '../src/tweet';
import css from '../src/style.css?raw';
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

  it('draws the poll reveal line inside a quote and inside its nested quote', () => {
    const quote: TweetData['quote'] = {
      kind: 'readable',
      id: '9',
      url: null,
      author: { name: 'Q', handle: '@q', avatarUrl: null },
      time: { absolute: null, visible: null },
      body: [{ kind: 'text', text: '引用正文' }],
      images: [],
      poll: true,
      nested: { kind: 'none' },
    };
    const card = renderCard(sample({ quote }), OPTIONS);
    const line = card.querySelector('.postnote-quote:not(.is-nested) .postnote-qpoll');
    expect(line?.textContent).toBe('显示此投票');
    expect(card.querySelectorAll('.postnote-qpoll')).toHaveLength(1);
    // The quote never expands the poll itself.
    expect(card.querySelector('.postnote-poll')).toBeNull();

    const nestedQuote: TweetData['quote'] = {
      ...quote,
      poll: false,
      nested: { ...quote, poll: true, nested: { kind: 'none' } },
    };
    const card2 = renderCard(sample({ quote: nestedQuote }), OPTIONS);
    const nested = card2.querySelector('.postnote-quote.is-nested');
    expect(nested?.querySelector('.postnote-qpoll')?.textContent).toBe('显示此投票');
    expect(card2.querySelectorAll('.postnote-qpoll')).toHaveLength(1);
  });

  it('writes the reveal line in the page\'s own language', () => {
    const quote: TweetData['quote'] = {
      kind: 'readable',
      id: '9',
      url: null,
      author: { name: 'Q', handle: '@q', avatarUrl: null },
      time: { absolute: null, visible: null },
      body: [{ kind: 'text', text: '引用正文' }],
      images: [],
      poll: true,
      nested: { kind: 'none' },
    };
    expect(
      renderCard(sample({ quote }), { language: 'zh', traditional: true }).querySelector(
        '.postnote-qpoll',
      )?.textContent,
    ).toBe('顯示此投票');
    expect(
      renderCard(sample({ quote }), { language: 'en', traditional: false }).querySelector(
        '.postnote-qpoll',
      )?.textContent,
    ).toBe('Show this poll');
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

  it('draws a large card with the title over the image and the domain below', () => {
    const card = renderCard(
      sample({
        card: {
          layout: 'large',
          player: false,
          url: 'https://www.anthropic.com/claude-haiku-5-5',
          domain: 'anthropic.com',
          title: 'Introducing Claude Haiku 5.5',
          description: 'Claude Haiku 5.5 is our fastest.',
          image: {
            src: 'https://pbs.twimg.com/card_img/1/a?format=jpg&name=800x419',
            width: 800,
            height: 419,
          },
        },
      }),
      OPTIONS,
    );
    const large = card.querySelector('.postnote-lcard');
    expect(large).not.toBeNull();
    expect(large?.querySelector('img')?.dataset.postnoteSrc).toContain('card_img/1/a');
    expect(large?.querySelector('.postnote-lcard-title')?.textContent).toBe(
      'Introducing Claude Haiku 5.5',
    );
    expect(large?.querySelector('.postnote-lcard-from')?.textContent).toBe('来自 anthropic.com');
  });

  it('draws a small card with a play badge, and a text-only card without an image', () => {
    const player = renderCard(
      sample({
        card: {
          layout: 'small',
          player: true,
          url: 'https://youtube.com/watch?v=1',
          domain: 'youtube.com',
          title: 'Video',
          description: 'desc',
          image: { src: 'https://pbs.twimg.com/card_img/1/b?format=jpg&name=280x150' },
        },
      }),
      OPTIONS,
    );
    expect(player.querySelector('.postnote-scard-play')).not.toBeNull();
    expect(player.querySelector('.postnote-scard-domain')?.textContent).toBe('youtube.com');

    const bare = renderCard(
      sample({
        card: {
          layout: 'large',
          player: false,
          url: 'https://x.com',
          domain: 'x.com',
          title: 'No image',
          description: '',
          image: null,
        },
      }),
      OPTIONS,
    );
    const small = bare.querySelector('.postnote-scard')!;
    expect(small.classList.contains('no-media')).toBe(true);
    expect(small.querySelector('img')).toBeNull();
    expect(small.querySelector('.postnote-scard-title')?.textContent).toBe('No image');
  });

  it('swaps a failed large card image for the text layout instead of vanishing', () => {
    const card = renderCard(
      sample({
        card: {
          layout: 'large',
          player: false,
          url: 'https://x.com',
          domain: 'x.com',
          title: 'Fallback title',
          description: 'Fallback desc',
          image: { src: 'https://pbs.twimg.com/card_img/1/c?format=jpg&name=800x419' },
        },
      }),
      OPTIONS,
    );
    const image = card.querySelector<HTMLImageElement>(`img[${ROLE_ATTRIBUTE}="card-media"]`)!;
    applyCardMediaFallback(image);
    expect(card.querySelector('.postnote-lcard')).toBeNull();
    const small = card.querySelector('.postnote-scard')!;
    expect(small.classList.contains('no-media')).toBe(true);
    expect(small.querySelector('.postnote-scard-title')?.textContent).toBe('Fallback title');
    expect(small.querySelector('.postnote-scard-desc')?.textContent).toBe('Fallback desc');
  });

  it('formats a poll percentage the way X writes it', () => {
    expect(formatPollPercent(3, 10)).toBe('30%');
    expect(formatPollPercent(455, 1000)).toBe('45.5%');
    expect(formatPollPercent(1, 3)).toBe('33.3%');
    expect(formatPollPercent(0, 0)).toBe('0%');
  });

  it('draws voting options while the poll is open and bars once results show', () => {
    const voting = renderCard(
      sample({
        poll: {
          choices: [
            { label: '甲', count: 7 },
            { label: '乙', count: 3 },
          ],
          final: false,
          voted: false,
          endsAt: null,
          display: 'options',
          meta: '10 票 · 剩下 2 天',
        },
      }),
      OPTIONS,
    );
    expect([...voting.querySelectorAll('.postnote-po')].map((item) => item.textContent)).toEqual([
      '甲',
      '乙',
    ]);
    expect(voting.querySelector('.postnote-poll-meta')?.textContent).toBe('10 票 · 剩下 2 天');

    const closed = renderCard(
      sample({
        poll: {
          choices: [
            { label: '甲', count: 7 },
            { label: '乙', count: 3 },
            { label: '丙', count: 7 },
          ],
          final: true,
          endsAt: '2026-06-30T10:00:00.000Z',
          display: 'results',
          meta: '17 票 · 最终结果',
        },
      }),
      OPTIONS,
    );
    const rows = [...closed.querySelectorAll<HTMLElement>('.postnote-pr')];
    expect(rows.map((row) => row.querySelector('.postnote-pr-pct')?.textContent)).toEqual([
      '41.2%',
      '17.6%',
      '41.2%',
    ]);
    // Tied leaders are all marked, like the bold rows on the page.
    expect(rows.map((row) => row.classList.contains('is-win'))).toEqual([true, false, true]);
    expect(closed.querySelector('.postnote-poll-meta')?.textContent).toBe('17 票 · 最终结果');
  });

  it('keeps the page\'s own percentages when they are the source of truth', () => {
    const card = renderCard(
      sample({
        poll: {
          choices: [
            { label: '甲', count: null, pct: '45.5%', win: true },
            { label: '乙', count: null, pct: '9.1%', win: false },
          ],
          final: false,
          endsAt: null,
          display: 'results',
          meta: '11 票 · 最終結果',
        },
      }),
      OPTIONS,
    );
    const rows = [...card.querySelectorAll<HTMLElement>('.postnote-pr')];
    expect(rows.map((row) => row.querySelector('.postnote-pr-pct')?.textContent)).toEqual([
      '45.5%',
      '9.1%',
    ]);
    expect(rows.map((row) => row.classList.contains('is-win'))).toEqual([true, false]);
    expect(rows[0].querySelector<HTMLElement>('.postnote-pr-fill')?.style.width).toBe('45.5%');
  });

  it('does not draw a poll result bar when no count or percentage exists', () => {
    const card = renderCard(
      sample({
        poll: {
          choices: [
            { label: '甲', count: null },
            { label: '乙', count: null },
          ],
          final: true,
          endsAt: null,
          display: 'results',
        },
      }),
      OPTIONS,
    );
    // Results cannot be drawn without real numbers: options stand in their
    // place rather than invented bars.
    expect(card.querySelectorAll('.postnote-pr')).toHaveLength(0);
    expect(card.querySelectorAll('.postnote-po')).toHaveLength(2);
    expect(card.querySelector('.postnote-poll-meta')).toBeNull();
  });

  it('keeps the percentage flush with the poll edge and styles the reveal line', () => {
    const rule = (name: string) =>
      css.match(new RegExp(`${name}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    expect(rule('\\.postnote-pr')).toContain('padding: 0 0 0 12px');
    const qpoll = rule('\\.postnote-qpoll');
    expect(qpoll).toContain('margin-top: 5px');
    expect(qpoll).toContain('font-size: 15px');
    expect(qpoll).toContain('font-weight: 400');
    expect(qpoll).toContain('line-height: 20px');
    expect(qpoll).toContain('color: var(--link)');
    expect(css).toContain('--link: #1d9bf0');
  });
});
