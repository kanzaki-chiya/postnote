/**
 * Turning X's rendered post content into serializable values.
 *
 * This layer knows about text nodes, links, emoji images, and media URLs, but
 * not about which post it is looking at, so `x-page.ts` can stay about identity,
 * structure, and relationships.
 */

import type { BodySegment, Media } from './tweet';

export const BASE_URL = 'https://x.com/';
export const PHOTO_CONTAINER_SELECTOR = '[data-testid="tweetPhoto"]';
export const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
export const AVATAR_SELECTOR = '[data-testid="Tweet-User-Avatar"] img';
export const TEXT_SELECTORS = [
  '[data-testid="tweetText"]',
  '[data-testid="noteTweetText"]',
  '[data-testid="NoteTweet"]',
];

/** Labels X puts in the tweet chrome rather than in the post body. */
export const CHROME_TEXTS: Record<string, true> = {
  显示更多: true,
  顯示更多: true,
  'Show more': true,
  翻譯貼文: true,
  翻译帖子: true,
  翻譯推文: true,
  翻译推文: true,
  'Translate post': true,
  'Translate Tweet': true,
};

const TRANSLATE_HREF = /\/(?:i\/timeline\/explore_modes|translate)(?:[/?#]|$)/i;
const EMOJI_SRC = /\/emoji\//i;

/** Collapse runs of whitespace for comparisons only, never for post bodies. */
export function collapse(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a page URL, rejecting everything that is not http(s).
 *
 * Script URLs, `javascript:`, `data:` in links, and unparseable values all come
 * back as null, so a caller cannot accidentally render them.
 */
export function toAbsoluteUrl(raw: string | null | undefined): URL | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value, BASE_URL);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * Rewrite a media URL to its original size.
 *
 * Only `pbs.twimg.com/media/*` is rewritten: there the `name` parameter selects
 * the variant the site keeps the original under. Everything else is returned
 * unchanged, and a URL that is not usable at all becomes the empty string.
 */
export function getHighResImageUrl(source: string): string {
  const raw = (source ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:image/')) return raw;
  const url = toAbsoluteUrl(raw);
  if (!url) return '';
  if (url.hostname === 'pbs.twimg.com' && url.pathname.startsWith('/media/')) {
    url.searchParams.set('name', 'orig');
  }
  return url.href;
}

/** Text of an inline element, with emoji images kept as their Unicode. */
export function readInlineText(element: Element): string {
  let text = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'svg') return;
    if (tag === 'br') {
      text += ' ';
      return;
    }
    if (tag === 'img') {
      text += node.getAttribute('alt') ?? '';
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(element);
  return collapse(text);
}

function readEmoji(image: Element): BodySegment | null {
  const src = image.getAttribute('src') ?? '';
  if (!EMOJI_SRC.test(src)) return null;
  const unicode = image.getAttribute('alt') ?? '';
  const url = toAbsoluteUrl(src);
  if (!url) return unicode ? { kind: 'text', text: unicode } : null;
  return { kind: 'emoji', unicode, src: url.href };
}

/**
 * Turn one anchor into a segment.
 *
 * Returns an empty array when the anchor is chrome rather than content, and a
 * plain text segment when the visible text is real but the target is not usable:
 * dropping the text would quietly remove something the reader can see.
 */
function readAnchor(anchor: Element): BodySegment[] {
  const text = readInlineText(anchor);
  if (!text || CHROME_TEXTS[text] === true) return [];
  const rawHref = anchor.getAttribute('href') ?? '';
  if (TRANSLATE_HREF.test(rawHref)) return [];
  const url = toAbsoluteUrl(rawHref);
  if (!url) return [{ kind: 'text', text }];
  if (/^@\S+$/.test(text)) return [{ kind: 'mention', text, handle: text }];
  if (/^#\S+$/.test(text)) return [{ kind: 'hashtag', text, tag: text.slice(1) }];
  return [{ kind: 'link', text, href: url.href }];
}

function pushText(text: string, out: BodySegment[]): void {
  text.split('\n').forEach((part, index) => {
    if (index > 0) out.push({ kind: 'break' });
    if (part.length > 0) out.push({ kind: 'text', text: part });
  });
}

function walkBody(node: Node, out: BodySegment[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      pushText(child.textContent ?? '', out);
      return;
    }
    if (!(child instanceof Element)) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      out.push({ kind: 'break' });
      return;
    }
    if (tag === 'img') {
      const emoji = readEmoji(child);
      if (emoji) out.push(emoji);
      return;
    }
    if (tag === 'a') {
      out.push(...readAnchor(child));
      return;
    }
    walkBody(child, out);
  });
}

/** Drop blank edges and keep at most one blank line between paragraphs. */
function tidyBody(segments: BodySegment[]): BodySegment[] {
  const kept: BodySegment[] = [];
  for (const segment of segments) {
    if (segment.kind === 'break') {
      const previous = kept[kept.length - 1];
      if (!previous || previous.kind === 'break') continue;
    }
    if (segment.kind === 'text' && segment.text.length === 0) continue;
    kept.push(segment);
  }
  while (kept[kept.length - 1]?.kind === 'break') kept.pop();
  return kept;
}

export function readBody(scope: Element): BodySegment[] {
  const segments: BodySegment[] = [];
  walkBody(scope, segments);
  return tidyBody(segments);
}

export function readImages(scope: HTMLElement, excluded: Element | null): Media[] {
  const media: Media[] = [];
  scope
    .querySelectorAll<HTMLImageElement>(`${PHOTO_CONTAINER_SELECTOR} img`)
    .forEach((image) => {
      if (excluded?.contains(image)) return;
      const src = getHighResImageUrl(image.currentSrc || image.getAttribute('src') || '');
      if (!src) return;
      media.push({ kind: 'photo', src, alt: collapse(image.getAttribute('alt')) });
    });
  return media;
}

/** A photo container with no usable image means content we cannot read. */
export function hasUnreadMedia(scope: HTMLElement, excluded: Element | null): boolean {
  return Array.from(scope.querySelectorAll(PHOTO_CONTAINER_SELECTOR)).some((container) => {
    if (excluded?.contains(container)) return false;
    return !Array.from(container.querySelectorAll<HTMLImageElement>('img')).some((image) =>
      Boolean(getHighResImageUrl(image.currentSrc || image.getAttribute('src') || '')),
    );
  });
}
