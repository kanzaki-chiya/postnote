// @vitest-environment jsdom

/**
 * Regression against sanitized pages captured from a real logged-in X session.
 *
 * Structure is real: the article markup, test ids, action bar labels, media
 * containers and the quote nesting all come from live pages, with names,
 * handles, ids and media paths replaced by placeholders. The count assertions
 * read the numbers out of the page's own labels rather than from PostNote's
 * parsing, so a parser regression cannot satisfy them on its own.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import photoHtml from './fixtures/real-photo.html?raw';
import emojiHtml from './fixtures/real-emoji.html?raw';
import quoteHtml from './fixtures/real-quote.html?raw';
import collapsedHtml from './fixtures/real-collapsed.html?raw';
import { bodyText } from '../src/tweet';
import { readTweet } from '../src/x-page';

const FIXTURES = {
  'photo-only post': photoHtml,
  'post with emoji and topics': emojiHtml,
  'post quoting another post': quoteHtml,
  'long post the page cut off': collapsedHtml,
} as const;

type FixtureName = keyof typeof FIXTURES;

/** Fixtures whose post can be read whole and exported as-is. */
const CLEAN_FIXTURES: FixtureName[] = [
  'photo-only post',
  'post with emoji and topics',
  'post quoting another post',
];

function readFixture(name: FixtureName) {
  const html = FIXTURES[name];
  document.body.innerHTML = html;
  const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
  if (!article) throw new Error(`${name} has no post element`);
  const extract = readTweet(article);
  if (!extract.ok) throw new Error(`${name} failed to read: ${extract.failure}`);
  return extract;
}

/** The count the page itself printed in the matching action label. */
function labelledCount(html: string, marker: string): string {
  const match = html.match(new RegExp(`aria-label="(\\d[\\d,]*)[^"]*${marker}`));
  if (!match) throw new Error(`no label ending in ${marker}`);
  return match[1].replace(/,/g, '');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('pages captured from X', () => {
  it('reports a long post the page cut off instead of reading half of it', () => {
    document.body.innerHTML = collapsedHtml;
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    if (!article) throw new Error('the collapsed fixture has no post element');
    const extract = readTweet(article);
    if (!extract.ok) throw new Error(`failed to read: ${extract.failure}`);

    expect(extract.warnings).toContain('text-collapsed');
    // The page itself still holds the rest behind its own control.
    expect(article.querySelector('[data-testid="tweet-text-show-more-link"]')).not.toBeNull();
  });

  it.each(CLEAN_FIXTURES)(
    '%s reads without a failure or a warning',
    (name) => {
      const extract = readFixture(name);
      expect(extract.warnings).toEqual([]);
      expect(extract.data.id).toBe('1000000000000000001');
      expect(extract.data.url).toBe('https://x.com/sample/status/1000000000000000001');
      expect(extract.data.author).toEqual({
        name: 'Sample Name',
        handle: '@sample',
        avatarUrl: 'https://pbs.twimg.com/profile_images/1/sample.jpg',
      });
      expect(extract.data.time.absolute).toBe('2026-09-14T22:12:36.000Z');
    },
  );

  it('reports a long post the page cut off instead of reading half of it', () => {
    document.body.innerHTML = collapsedHtml;
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    if (!article) throw new Error('the collapsed fixture has no post element');
    const extract = readTweet(article);
    if (!extract.ok) throw new Error(`failed to read: ${extract.failure}`);

    expect(extract.warnings).toContain('text-collapsed');
    // The page itself still holds the rest behind its own control.
    expect(article.querySelector('[data-testid="tweet-text-show-more-link"]')).not.toBeNull();
  });

  it.each(Object.keys(FIXTURES) as FixtureName[])(
    '%s never claims a parent it cannot prove',
    (name) => {
      expect(readFixture(name).data.reply).toEqual({ kind: 'unknown' });
    },
  );

  it('reads a photo-only post as images with no body', () => {
    const extract = readFixture('photo-only post');
    expect(extract.data.body).toEqual([]);
    expect(extract.data.images).toHaveLength(1);
    expect(extract.data.images[0].src).toBe(
      'https://pbs.twimg.com/media/sample?format=jpg&name=orig',
    );
    expect(extract.data.quote).toEqual({ kind: 'none' });
  });

  it('keeps text, emoji, line breaks and topics in the order the page shows them', () => {
    const extract = readFixture('post with emoji and topics');
    expect(extract.data.body.map((segment) => segment.kind)).toEqual([
      'text',
      'emoji',
      'break',
      'hashtag',
      'break',
      'hashtag',
    ]);
    const emoji = extract.data.body[1];
    expect(emoji).toMatchObject({ kind: 'emoji', unicode: '🤣' });
    expect(emoji.kind === 'emoji' && emoji.src).toMatch(/^https:\/\/abs\.twimg\.com\/emoji\//);
  });

  it('separates a quoted post from the post that quotes it', () => {
    const extract = readFixture('post quoting another post');
    const { quote } = extract.data;

    expect(quote.kind).toBe('readable');
    if (quote.kind !== 'readable') return;
    expect(quote.author.handle).toBe('@sample');
    expect(bodyText(quote.body)).toBe('样本正文 sample body');
    expect(quote.images).toHaveLength(3);

    // The quoted post's media must not be counted as the current post's own.
    expect(extract.data.images).toHaveLength(1);
    expect(bodyText(extract.data.body)).toBe('样本正文 sample body');
  });

  it('reports a long post the page cut off instead of reading half of it', () => {
    document.body.innerHTML = collapsedHtml;
    const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]');
    if (!article) throw new Error('the collapsed fixture has no post element');
    const extract = readTweet(article);
    if (!extract.ok) throw new Error(`failed to read: ${extract.failure}`);

    expect(extract.warnings).toContain('text-collapsed');
    // The page itself still holds the rest behind its own control.
    expect(article.querySelector('[data-testid="tweet-text-show-more-link"]')).not.toBeNull();
  });

  it.each(Object.keys(FIXTURES) as FixtureName[])(
    '%s reports the counts the page showed',
    (name) => {
      const { metrics } = readFixture(name).data;
      const html = FIXTURES[name];
      expect(metrics.replies).toBe(labelledCount(html, '則回覆。回覆'));
      expect(metrics.reposts).toBe(labelledCount(html, '次轉發。轉發'));
      expect(metrics.likes).toBe(labelledCount(html, '個喜歡。喜歡'));
      expect(metrics.views).toBe(labelledCount(html, '次查看。查看貼文分析'));
    },
  );
});
