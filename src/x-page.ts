/**
 * Reading one rendered post into `TweetData`.
 *
 * This is the fallback path: the preferred source is the snapshot X itself
 * delivered over its own GraphQL traffic (`x-network.ts` + `x-snapshot.ts`).
 * When the loaded data has no record of the post being read, this module reads
 * the rendered article instead.
 *
 * Nothing here returns a DOM node, and nothing here infers a relationship from
 * position, connector lines, author names, or wording.
 */

import type {
  Author,
  ExtractFailure,
  ExtractWarning,
  Media,
  Metrics,
  PageLanguage,
  Quote,
  ReplyRelation,
  TweetData,
  TweetExtract,
  TweetTime,
} from './tweet';
import { hasVisibleBody } from './tweet';
import {
  AVATAR_SELECTOR,
  BASE_URL,
  CHROME_TEXTS,
  TEXT_SELECTORS,
  USER_NAME_SELECTOR,
  collapse,
  getHighResImageUrl,
  hasUnreadMedia,
  readBody,
  readImages,
  readInlineText,
  toAbsoluteUrl,
} from './x-content';

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

const STATUS_ID_PATTERN = /\/status\/(\d+)/;
const QUOTE_WRAPPER_SELECTOR =
  '[data-testid="card.wrapper"], div[role="link"][tabindex="0"]';

/** X's own markers for a poll card, which still cannot be exported. */
const POLL_SELECTOR = '[data-testid="cardPoll"], [data-testid="poll"]';

/** Containers that mean the post carries video or GIF media. */
const VIDEO_CONTAINER_SELECTOR = [
  '[data-testid="videoPlayer"]',
  '[data-testid="videoComponent"]',
  '[data-testid="videoPlayerComponent"]',
].join(', ');

const ACTION_PATTERNS = [
  /reply|评论|評論|回复|回覆/i,
  /retweet|repost|转发|轉發/i,
  /like|点赞|點讚|喜欢|喜歡/i,
  /bookmark|书签|書籤/i,
  /share|分享/i,
  /analytics|views?|查看|浏览|瀏覽|觀看/i,
];

const ENGAGEMENT_PATTERNS: Record<string, RegExp> = {
  replies: /repl(?:y|ies)|评论|評論|回复|回覆/i,
  reposts: /retweets?|reposts?|转发|轉發/i,
  likes: /likes?|点赞|點讚|喜欢|喜歡/i,
  bookmarks: /bookmarks?|书签|書籤/i,
  views: /analytics|views?|查看|浏览|瀏覽|觀看/i,
};

const COLLAPSED_PATTERN = /^(?:显示更多|顯示更多|show more)$/i;
/** X's own control for the rest of a long post, whatever the UI language. */
const SHOW_MORE_SELECTOR = '[data-testid="tweet-text-show-more-link"]';

export type ReadOptions = { isDetailMain?: boolean };

export function getPageLanguage(doc?: Document): PageLanguage {
  const declared = doc?.documentElement?.lang || '';
  const browser = typeof navigator === 'undefined' ? '' : navigator.language || '';
  return /^(?:zh|cmn)(?:-|$)/i.test(declared || browser) ? 'zh' : 'en';
}

export function getCurrentStatusId(pathname?: string): string | null {
  const path =
    pathname ?? (typeof window === 'undefined' ? '' : window.location.pathname);
  return path.match(STATUS_ID_PATTERN)?.[1] ?? null;
}

export function findTweetElements(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR));
}

function getStatusIdFromHref(href: string | null): string | null {
  return toAbsoluteUrl(href)?.pathname.match(STATUS_ID_PATTERN)?.[1] ?? null;
}

/** The nearest post element: the scope itself, or the post a quote sits in. */
function ownerTweet(scope: Element): Element | null {
  return scope.closest(TWEET_SELECTOR);
}

function isOutside(element: Element | null, excluded: Element | null): boolean {
  return element !== null && !excluded?.contains(element);
}

function getOwnStatusIds(article: HTMLElement, excluded: Element | null): string[] {
  const ids: string[] = [];
  const owner = ownerTweet(article);
  article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]').forEach((link) => {
    if (link.closest(TWEET_SELECTOR) !== owner) return;
    if (!isOutside(link, excluded)) return;
    const id = getStatusIdFromHref(link.getAttribute('href'));
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids;
}

/**
 * The status id of the post this article belongs to.
 *
 * Used to look the post up in the snapshot store before any DOM reading; it
 * only identifies the post, it never stands in for its content.
 */
export function getArticleStatusId(article: HTMLElement): string | null {
  const current = getCurrentStatusId();
  const ids = getOwnStatusIds(article, findQuoteWrapper(article));
  if (current && article === findDetailMainTweet() && ids.includes(current)) {
    return current;
  }
  const handle = readHandle(article, findQuoteWrapper(article)).replace(/^@/, '').toLowerCase();
  if (handle) {
    for (const link of Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))) {
      const id = getStatusIdFromHref(link.getAttribute('href'));
      const path = toAbsoluteUrl(link.getAttribute('href'))?.pathname.toLowerCase() ?? '';
      if (id && path.includes(`/${handle}/status/`)) return id;
    }
  }
  return ids[0] ?? null;
}

function readHandle(article: HTMLElement, excluded: Element | null): string {
  const userName = article.querySelector(USER_NAME_SELECTOR);
  const scope: ParentNode = isOutside(userName, excluded) ? (userName as Element) : article;
  for (const span of Array.from(scope.querySelectorAll('span'))) {
    if (!isOutside(span, excluded)) continue;
    const text = collapse(span.textContent);
    if (/^@\S+$/.test(text)) return text;
  }
  return '';
}

function readDisplayName(article: HTMLElement, excluded: Element | null): string {
  const userName = article.querySelector(USER_NAME_SELECTOR);
  if (!isOutside(userName, excluded)) return '';
  for (const span of Array.from((userName as Element).querySelectorAll('span'))) {
    if (span.querySelector('span')) continue;
    if (span.closest('time')) continue;
    const text = readInlineText(span);
    if (!text || text.startsWith('@') || text === '·') continue;
    if (CHROME_TEXTS[text] === true) continue;
    return text;
  }
  return '';
}

function readAuthor(article: HTMLElement, excluded: Element | null): Author {
  const handle = readHandle(article, excluded);
  const name = readDisplayName(article, excluded) || handle.replace(/^@/, '');
  const avatar = Array.from(article.querySelectorAll<HTMLImageElement>(AVATAR_SELECTOR))
    .filter((image) => isOutside(image, excluded))
    .map((image) => getHighResImageUrl(image.currentSrc || image.getAttribute('src') || ''))
    .find(Boolean);
  return { name, handle, avatarUrl: avatar ?? null };
}

function readTime(article: HTMLElement, excluded: Element | null): TweetTime {
  const element = Array.from(article.querySelectorAll('time')).find((candidate) =>
    isOutside(candidate, excluded),
  );
  if (!element) return { absolute: null, visible: null };
  return {
    absolute: collapse(element.getAttribute('datetime')) || null,
    visible: collapse(element.textContent) || null,
  };
}

function readPermalink(
  article: HTMLElement,
  excluded: Element | null,
  handle: string,
): { id: string; url: string } | null {
  const author = handle.replace(/^@/, '').toLowerCase();
  const owner = ownerTweet(article);
  const own: string[] = [];
  const other: string[] = [];
  article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]').forEach((link) => {
    if (link.closest(TWEET_SELECTOR) !== owner) return;
    if (!isOutside(link, excluded)) return;
    const raw = link.getAttribute('href');
    const id = getStatusIdFromHref(raw);
    if (!id) return;
    const path = toAbsoluteUrl(raw)?.pathname.toLowerCase() ?? '';
    if (author && path.includes(`/${author}/status/`)) own.push(id);
    else other.push(id);
  });
  const id = own[0] ?? other[0];
  if (!id) return null;
  const prefix = author ? `${BASE_URL}${author}/status/` : `${BASE_URL}i/web/status/`;
  return { id, url: `${prefix}${id}` };
}

function findTextRoot(article: HTMLElement, excluded: Element | null): Element | null {
  for (const selector of TEXT_SELECTORS) {
    const match = Array.from(article.querySelectorAll(selector)).find((candidate) =>
      isOutside(candidate, excluded),
    );
    if (match) return match;
  }
  return null;
}

/**
 * A quote box is a quoted post, not a link card: X no longer wraps the quoted
 * timestamp in an `a[href*="/status/"]`, so it is recognized by having its own
 * author row plus some actual content (text, media, or a timestamp).
 */
function isLikelyQuote(wrapper: Element): boolean {
  const hasUser = Boolean(wrapper.querySelector(USER_NAME_SELECTOR));
  if (!hasUser) return false;
  const hasText = Boolean(
    wrapper.querySelector('[data-testid="tweetText"], [data-testid="noteTweetText"]'),
  );
  const hasMedia = Boolean(
    wrapper.querySelector('img[src*="/media/"], video[poster], [data-testid="videoPlayer"]'),
  );
  const hasTime = Boolean(wrapper.querySelector('time'));
  return hasText || hasMedia || hasTime;
}

function findQuoteWrapper(article: HTMLElement): Element | null {
  const likely = Array.from(article.querySelectorAll(QUOTE_WRAPPER_SELECTOR)).filter(
    isLikelyQuote,
  );
  const outermost = likely.find(
    (candidate) => !likely.some((other) => other !== candidate && other.contains(candidate)),
  );
  return outermost ?? null;
}

function readQuote(wrapper: Element, depth: number): Quote {
  const element = wrapper as HTMLElement;
  const body = readBody(findTextRoot(element, null) ?? element);
  const images = readImages(element, null);
  if (images.length === 0 && !hasVisibleBody(body)) return { kind: 'unreadable' };
  const author = readAuthor(element, null);
  const permalink = readPermalink(element, null, author.handle);
  const nested: Quote =
    depth === 0
      ? (() => {
          const inner = Array.from(
            element.querySelectorAll(QUOTE_WRAPPER_SELECTOR),
          ).find((candidate) => isLikelyQuote(candidate));
          return inner ? readQuote(inner, depth + 1) : { kind: 'none' };
        })()
      : { kind: 'none' };
  return {
    kind: 'readable',
    id: permalink?.id ?? null,
    url: permalink?.url ?? null,
    author,
    time: readTime(element, null),
    body,
    images,
    nested,
  };
}

function getActionGroupScore(group: Element): number {
  const values = [
    ...Array.from(group.querySelectorAll('[data-testid]')).map(
      (element) => element.getAttribute('data-testid') ?? '',
    ),
    ...Array.from(group.querySelectorAll('[aria-label]')).map(
      (element) => element.getAttribute('aria-label') ?? '',
    ),
  ];
  const text = values.join(' ');
  return ACTION_PATTERNS.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

/** The interaction bar belonging to `article`, if it can be identified at all. */
export function findTweetActionGroup(
  article: HTMLElement,
  excluded: Element | null = null,
): HTMLElement | null {
  const owner = ownerTweet(article);
  const candidates = Array.from(article.querySelectorAll<HTMLElement>('[role="group"]'))
    .filter((group) => group.closest(TWEET_SELECTOR) === owner && isOutside(group, excluded))
    .map((group) => ({ group, score: getActionGroupScore(group) }))
    .filter(({ score }) => score >= 2);
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.group ?? null;
}

function getEngagementValue(text: string): string {
  return collapse(text).match(/\d[\d,.]*\s*(?:万|萬|亿|億|[KMB])?/i)?.[0]?.replace(/\s+/g, '') ?? '';
}

function getLabeledEngagementValue(text: string, pattern: RegExp): string {
  const match = collapse(text).match(
    new RegExp(
      `(\\d[\\d,.]*\\s*(?:万|萬|亿|億|[KMB])?)(?:\\s*(?:則|次|個|个))?\\s*(?:${pattern.source})`,
      'i',
    ),
  );
  return match?.[1]?.replace(/\s+/g, '') ?? '';
}

/**
 * Normalize a count read from the page into the raw integer form metrics carry.
 * A value the page already abbreviated ("26萬") stays as displayed; it cannot
 * be reversed without inventing digits.
 */
function normalizeMetricValue(value: string): string {
  const digits = value.replace(/[,\s]/g, '');
  return /^\d+$/.test(digits) ? digits : value;
}

/**
 * Read the interaction counts the page actually shows.
 *
 * A kind that cannot be read stays absent so callers can render it as unknown.
 * Only a value the page really displayed, including a real zero, is recorded.
 */
function readMetrics(
  article: HTMLElement,
  excluded: Element | null,
  isDetailMain: boolean,
): Metrics {
  const group = findTweetActionGroup(article, excluded);
  const scope: ParentNode = group ?? article;
  const ariaTexts = Array.from(scope.querySelectorAll('[aria-label]')).map(
    (element) => element.getAttribute('aria-label') ?? '',
  );
  const metrics: Metrics = {};

  for (const [kind, pattern] of Object.entries(ENGAGEMENT_PATTERNS)) {
    const source = ariaTexts.find((text) => pattern.test(text) && getEngagementValue(text));
    let value = getEngagementValue(source ?? '');
    if (!value && group) {
      value = getLabeledEngagementValue(group.getAttribute('aria-label') ?? '', pattern);
    }
    if (!value && kind === 'views' && isDetailMain) {
      const viewsText = Array.from(article.querySelectorAll('span, a'))
        .filter((element) => isOutside(element, excluded))
        .map((element) => collapse(element.textContent))
        .find(
          (text) =>
            text.length <= 80 &&
            /\d/.test(text) &&
            /views?|查看|浏览量|浏览|瀏覽量|瀏覽|觀看/i.test(text),
        );
      value = getEngagementValue(viewsText ?? '');
    }
    if (value) metrics[kind as keyof Metrics] = normalizeMetricValue(value);
  }
  return metrics;
}

function findPoll(article: HTMLElement, excluded: Element | null): boolean {
  return Array.from(article.querySelectorAll(POLL_SELECTOR)).some((element) =>
    isOutside(element, excluded),
  );
}

/**
 * Video or GIF media rendered on the page: the poster image X shows plus its
 * kind. The stream itself is never read; a container with no poster is reported
 * as unread media instead of vanishing.
 */
function readVideoPoster(article: HTMLElement, excluded: Element | null): Media[] {
  const media: Media[] = [];
  for (const container of Array.from(article.querySelectorAll(VIDEO_CONTAINER_SELECTOR))) {
    if (!isOutside(container, excluded)) continue;
    const video = container.tagName === 'VIDEO' ? (container as HTMLVideoElement) : container.querySelector('video');
    const image = container.querySelector('img');
    const raw =
      video?.getAttribute('poster') ?? image?.currentSrc ?? image?.getAttribute('src') ?? '';
    const src = getHighResImageUrl(raw);
    const kind: Media['kind'] = /tweet_video|gif/i.test(raw) ? 'gif' : 'video';
    if (src) media.push({ src, alt: '', kind });
  }
  return media;
}

function hasUnreadVideo(article: HTMLElement, excluded: Element | null): boolean {
  return Array.from(article.querySelectorAll(VIDEO_CONTAINER_SELECTOR)).some((container) => {
    if (!isOutside(container, excluded)) return false;
    const video =
      container.tagName === 'VIDEO' ? (container as HTMLVideoElement) : container.querySelector('video');
    const image = container.querySelector('img');
    const raw =
      video?.getAttribute('poster') ?? image?.currentSrc ?? image?.getAttribute('src') ?? '';
    return !getHighResImageUrl(raw);
  });
}

export function hasCollapsedText(article: HTMLElement, excluded: Element | null): boolean {
  return Array.from(
    article.querySelectorAll(`${SHOW_MORE_SELECTOR}, a, button, [role="button"]`),
  ).some(
    (element) =>
      isOutside(element, excluded) &&
      (element.matches(SHOW_MORE_SELECTOR) ||
        COLLAPSED_PATTERN.test(collapse(element.textContent))),
  );
}

/**
 * How much text this post's own body holds right now.
 *
 * Used to tell "the page showed the rest" from "the control vanished": the
 * length is what changed, so it is what gets compared.
 */
export function postTextLength(article: HTMLElement): number {
  return findTextRoot(article, null)?.textContent?.length ?? 0;
}

/**
 * Ask the page to show the rest of a long post.
 *
 * Only X's own control is clicked, so the page expands the same text it would
 * expand for the reader; nothing here decides what the full text is. Returns
 * whether anything needed expanding, and does not wait for the re-render.
 */
export function expandTweetText(article: HTMLElement): boolean {
  const controls = Array.from(article.querySelectorAll<HTMLElement>(SHOW_MORE_SELECTOR));
  controls.forEach((control) => control.click());
  return controls.length > 0;
}

/** The detail page's own post, matched by the id in the address bar. */
export function findDetailMainTweet(root: ParentNode = document): HTMLElement | null {
  const statusId = getCurrentStatusId();
  if (!statusId) return null;
  return findTweetById(statusId, root);
}

/**
 * The rendered article for one status id.
 *
 * Used to read the ancestors of a chain when a snapshot is not available: their
 * relation is known from the data the page loaded, and their content comes from
 * the article that renders it.
 */
export function findTweetById(id: string, root: ParentNode = document): HTMLElement | null {
  const matches = findTweetElements(root).filter((article) =>
    getOwnStatusIds(article, null).includes(id),
  );
  if (matches.length <= 1) return matches[0] ?? null;
  const outermost = matches.filter(
    (article) => !matches.some((other) => other !== article && other.contains(article)),
  );
  return outermost.length === 1 ? outermost[0] : matches[0];
}

/**
 * True when the page currently shows the post's translation rather than the
 * original text: X swaps the control's label between "Translate post" and
 * "Show original" / 「顯示原文」.
 */
export function showsTranslation(article: HTMLElement): boolean {
  const quote = findQuoteWrapper(article);
  return Array.from(
    article.querySelectorAll('a, button, [role="button"], span'),
  ).some(
    (element) =>
      isOutside(element, quote) && element.closest(TWEET_SELECTOR) === article && (
        /^(?:顯示原文|显示原文|show original)$/i.test(collapse(element.textContent)) ||
        /顯示原文|显示原文|show original/i.test(element.getAttribute('aria-label') ?? '')
      ),
  );
}

/**
 * The reply relation of a DOM-read post.
 *
 * The DOM carries no parent id, so a post read this way never claims one;
 * `unknown` means "not established", which callers must never read as "this is
 * a root post".
 */
const UNKNOWN_REPLY: ReplyRelation = { kind: 'unknown' };

function readFailure(error: unknown): ExtractFailure {
  console.error('[postnote] Failed to read the post:', error);
  return 'read-error';
}

export function readTweet(article: HTMLElement, options: ReadOptions = {}): TweetExtract {
  try {
    const quoteWrapper = findQuoteWrapper(article);
    const author = readAuthor(article, quoteWrapper);
    const permalink = readPermalink(article, quoteWrapper, author.handle);
    if (!permalink) return { ok: false, failure: 'no-status-id' };
    if (findPoll(article, quoteWrapper)) {
      return { ok: false, failure: 'unsupported-poll' };
    }

    const body = readBody(findTextRoot(article, quoteWrapper) ?? document.createElement('div'));
    const images: Media[] = [
      ...readImages(article, quoteWrapper).map((media) => ({ ...media, kind: 'photo' as const })),
      ...readVideoPoster(article, quoteWrapper),
    ];
    const quote: Quote = quoteWrapper ? readQuote(quoteWrapper, 0) : { kind: 'none' };
    if (!hasVisibleBody(body) && images.length === 0 && quote.kind !== 'readable') {
      return { ok: false, failure: 'no-content' };
    }

    const warnings: ExtractWarning[] = [];
    if (!author.avatarUrl) warnings.push('avatar-missing');
    if (quote.kind === 'unreadable') warnings.push('quote-unreadable');
    // A second author row that no quote box accounts for is a quote the shape
    // rules missed: say so instead of silently dropping it.
    const authorRows = Array.from(article.querySelectorAll(USER_NAME_SELECTOR)).filter((row) =>
      isOutside(row, quoteWrapper),
    );
    if (authorRows.length > 1 && quote.kind !== 'readable') {
      warnings.push('quote-unreadable');
    }
    if (
      hasUnreadMedia(article, quoteWrapper) ||
      hasUnreadVideo(article, quoteWrapper)
    ) {
      warnings.push('media-unknown');
    }
    // A collapse control means part of the text is not in the DOM yet, whether
    // or not a text element exists.
    if (hasCollapsedText(article, quoteWrapper)) warnings.push('text-collapsed');

    const data: TweetData = {
      id: permalink.id,
      url: permalink.url,
      author,
      time: readTime(article, quoteWrapper),
      body,
      images,
      quote,
      metrics: readMetrics(article, quoteWrapper, Boolean(options.isDetailMain)),
      reply: UNKNOWN_REPLY,
    };
    return { ok: true, data, warnings };
  } catch (error) {
    return { ok: false, failure: readFailure(error) };
  }
}
