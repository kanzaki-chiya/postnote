/**
 * Rendering `TweetData` into the export sheet.
 *
 * Two rules shape this module:
 *
 * - Every call builds new nodes from the data. Nothing is moved out of the
 *   input, so the same snapshot can be rendered for a preview and again for the
 *   export, and rendering twice cannot change an earlier result.
 * - A missing metric is hidden. Only a value the source really exposed is
 *   drawn, so an unknown count never appears as a zero.
 */

import type {
  Author,
  BodySegment,
  LinkCard,
  Media,
  Metrics,
  PageLanguage,
  Poll,
  TweetData,
} from './tweet';
import { UI, cardFromLabel, mediaBadge, metricLabel, pollMeta, pollRevealLabel, postsSuffix } from './messages';

export const ROLE_ATTRIBUTE = 'data-postnote-role';

/** Which fallback a decorative resource gets when it cannot be loaded. */
export type ResourceRole =
  | 'avatar'
  | 'media'
  | 'quote-avatar'
  | 'quote-media'
  | 'card-media'
  | 'org'
  | 'emoji';

/** The bottom row, in X's own order: reply, repost, like, bookmark. */
const VISIBLE_METRICS = ['replies', 'reposts', 'likes', 'bookmarks'] as const;

const METRIC_ICONS: Record<(typeof VISIBLE_METRICS)[number], string> = {
  replies:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.751 10c0-4.42 3.584-8.01 8.005-8.01h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"></path></svg>',
  reposts:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"></path></svg>',
  likes:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"></path></g></svg>',
  bookmarks:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z"></path></svg>',
};

/** X's verified badge; the fill colour is set by the caller's class. */
const VERIFIED_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>';

/** The gold gradient definition, present once inside the exported sheet. */
const GOLD_DEFS =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true">' +
  '<defs><linearGradient id="postnote-gold" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#f4e72a"/><stop offset=".55" stop-color="#e2b719"/>' +
  '<stop offset="1" stop-color="#cd8105"/></linearGradient></defs></svg>';

const X_BASE_URL = 'https://x.com/';

export type CardOptions = {
  language: PageLanguage;
  traditional: boolean;
};

export type SheetOptions = CardOptions;

/** Format one real count the way X writes it for the page language. */
export function formatCount(
  raw: string | undefined,
  language: PageLanguage,
  traditional: boolean,
): string {
  const value = raw ?? '';
  if (!/^\d+$/.test(value)) return value;
  const count = Number(value);
  if (!Number.isSafeInteger(count)) return value;
  if (language === 'en') {
    if (count < 1_000) return String(count);
    const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const [divisor, unit] = units.find(([d]) => count >= d)!;
    const truncated = Math.floor((count / divisor) * 10) / 10;
    return `${truncated % 1 === 0 ? truncated.toFixed(0) : truncated.toFixed(1)}${unit}`;
  }
  const wan = traditional ? '萬' : '万';
  if (count < 10_000) return count.toLocaleString('en-US');
  if (count < 100_000) {
    const truncated = Math.floor(count / 1_000) / 10;
    return `${truncated % 1 === 0 ? truncated.toFixed(0) : truncated.toFixed(1)}${wan}`;
  }
  return `${Math.floor(count / 10_000)}${wan}`;
}

/** `value / divisor` cut (not rounded) to three significant digits, trailing zeros dropped. */
function threeDigits(count: number, divisor: number): string {
  const whole = Math.floor(count / divisor);
  const decimals = Math.max(0, 3 - String(whole).length);
  const scale = 10 ** decimals;
  const cut = Math.floor((count * scale) / divisor) / scale;
  return String(Number(cut.toFixed(decimals)));
}

/**
 * Format the view count in the detail time row the way X writes it there —
 * finer than the interaction bar. Chinese keeps one decimal of 万, or of 亿
 * from 1e8, with grouped digits (198992 → 19.8万, 30798304 → 3,079.8万,
 * 177146934 → 1.7亿); English
 * cuts K/M/B to three significant digits. Below ten thousand every digit stays.
 */
export function formatStampCount(
  raw: string | undefined,
  language: PageLanguage,
  traditional: boolean,
): string {
  const value = raw ?? '';
  if (!/^\d+$/.test(value)) return value;
  const count = Number(value);
  if (!Number.isSafeInteger(count)) return value;
  if (count < 10_000) return count.toLocaleString('en-US');
  if (language === 'en') {
    const units: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    const [divisor, unit] = units.find(([d]) => count >= d)!;
    return `${threeDigits(count, divisor)}${unit}`;
  }
  // Chinese: one decimal of 万 (亿 from 1e8), cut not rounded, grouped digits —
  // 30798304 → 3,079.8万, 177146934 → 1.7亿.
  const [divisor, unit] =
    count >= 1e8 ? [1e8, traditional ? '億' : '亿'] : [1e4, traditional ? '萬' : '万'];
  const tenths = Math.floor((count * 10) / divisor) / 10;
  return `${tenths.toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`;
}

function timeParts(
  absolute: string | null,
  visible: string | null,
  language: PageLanguage,
  traditional: boolean,
): string[] {
  if (absolute) {
    const date = new Date(absolute);
    if (!Number.isNaN(date.getTime())) {
      const locale = traditional ? 'zh-Hant' : language === 'zh' ? 'zh-Hans' : 'en';
      const time = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
      const day = new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(date);
      return [time, day];
    }
  }
  return visible ? [visible] : [];
}

/** The short date X shows inside a quote header ("10月7日" / "Oct 7"). */
function shortDate(time: TweetData['time'], language: PageLanguage, traditional: boolean): string {
  if (time.absolute) {
    const date = new Date(time.absolute);
    if (!Number.isNaN(date.getTime())) {
      const locale = traditional ? 'zh-Hant' : language === 'zh' ? 'zh-Hans' : 'en';
      return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date);
    }
  }
  return time.visible ?? '';
}

function renderSegment(segment: BodySegment): Node {
  switch (segment.kind) {
    case 'text':
      return document.createTextNode(segment.text);
    case 'break':
      return document.createElement('br');
    case 'emoji': {
      const image = document.createElement('img');
      image.className = 'postnote-emoji';
      image.setAttribute(ROLE_ATTRIBUTE, 'emoji');
      image.dataset.unicode = segment.unicode;
      image.alt = segment.unicode;
      image.dataset.postnoteSrc = segment.src;
      image.src = segment.src;
      return image;
    }
    case 'mention': {
      const anchor = document.createElement('a');
      anchor.className = 'postnote-link';
      anchor.href = `${X_BASE_URL}${segment.handle.replace(/^@/, '')}`;
      anchor.textContent = segment.text;
      return anchor;
    }
    case 'hashtag': {
      const anchor = document.createElement('a');
      anchor.className = 'postnote-link';
      anchor.href = `${X_BASE_URL}hashtag/${encodeURIComponent(segment.tag)}`;
      anchor.textContent = segment.text;
      return anchor;
    }
    case 'link': {
      const anchor = document.createElement('a');
      anchor.className = 'postnote-link';
      anchor.href = segment.href;
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = segment.text;
      return anchor;
    }
  }
}

function renderBody(body: BodySegment[], className: string): HTMLDivElement {
  const paragraph = document.createElement('div');
  paragraph.className = className;
  body.forEach((segment) => paragraph.appendChild(renderSegment(segment)));
  return paragraph;
}

function renderAvatar(author: Author, className: string, role: ResourceRole): HTMLElement {
  const square = author.avatarShape === 'square' ? ' is-square' : '';
  if (!author.avatarUrl) {
    const placeholder = document.createElement('span');
    placeholder.className = `${className}${square} postnote-avatar-placeholder`;
    placeholder.textContent = (author.name || '?').trim().charAt(0) || '?';
    return placeholder;
  }
  const image = document.createElement('img');
  image.className = `${className}${square}`;
  image.setAttribute(ROLE_ATTRIBUTE, role);
  image.alt = '';
  image.dataset.ownerName = author.name;
  image.dataset.postnoteSrc = author.avatarUrl;
  if (author.avatarFallbackUrl) image.dataset.postnoteFallback = author.avatarFallbackUrl;
  image.src = author.avatarUrl;
  return image;
}

function renderVerified(author: Author, className: string): HTMLElement | null {
  if (!author.verification) return null;
  const mark = document.createElement('span');
  mark.className = `postnote-verified is-${author.verification} ${className}`.trim();
  mark.innerHTML = VERIFIED_ICON;
  return mark;
}

function renderOrgBadge(author: Author, className: string): HTMLElement | null {
  if (!author.badge) return null;
  const image = document.createElement('img');
  image.className = `postnote-org ${className}`.trim();
  image.setAttribute(ROLE_ATTRIBUTE, 'org');
  image.alt = author.badge.label;
  image.title = author.badge.label;
  image.dataset.postnoteSrc = author.badge.src;
  image.src = author.badge.src;
  return image;
}

/** One media entry drawn the way the preview does: video/GIF get a badge. */
function renderMediaItem(media: Media, role: ResourceRole, options: CardOptions): HTMLElement {
  const box = document.createElement('div');
  box.className = 'postnote-clip';
  const image = document.createElement('img');
  image.className = 'postnote-clip-image';
  image.setAttribute(ROLE_ATTRIBUTE, role);
  image.alt = media.alt;
  image.dataset.postnoteSrc = media.src;
  image.src = media.src;
  box.appendChild(image);
  if (media.kind !== 'photo') {
    box.classList.add('is-video');
    const play = document.createElement('span');
    play.className = 'postnote-play';
    box.appendChild(play);
    const badge = document.createElement('span');
    badge.className = 'postnote-vbadge';
    badge.textContent = mediaBadge(media.kind, options.language, options.traditional);
    box.appendChild(badge);
  }
  return box;
}

function renderMediaStack(
  images: Media[],
  className: string,
  role: ResourceRole,
  options: CardOptions,
): HTMLDivElement {
  const stack = document.createElement('div');
  stack.className = className;
  images.forEach((media) => stack.appendChild(renderMediaItem(media, role, options)));
  return stack;
}

/** One text row of the small card's right-hand column; empty ones are skipped. */
function cardDetailRow(className: string, text: string): HTMLSpanElement | null {
  if (!text) return null;
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/** The detail column every small card shares: domain, title, summary. */
function cardDetail(card: LinkCard): HTMLElement {
  const detail = document.createElement('div');
  detail.className = 'postnote-scard-detail';
  for (const row of [
    cardDetailRow('postnote-scard-domain', card.domain),
    cardDetailRow('postnote-scard-title', card.title),
    cardDetailRow('postnote-scard-desc', card.description),
  ]) {
    if (row) detail.appendChild(row);
  }
  return detail;
}

/**
 * The link preview under the body, between media and quote.
 *
 * The large kind is a wide image with the title pinned over its bottom and a
 * "来自 domain" line under it; every other shape — including a large card
 * whose image is missing — is the small row layout.
 */
function renderLinkCard(card: LinkCard, options: CardOptions): HTMLElement {
  if (card.layout === 'large' && card.image) {
    const box = document.createElement('div');
    box.className = 'postnote-lcard';
    // The fields a fallback rebuild needs when the image never arrives.
    box.dataset.domain = card.domain;
    box.dataset.title = card.title;
    box.dataset.desc = card.description;
    const media = document.createElement('div');
    media.className = 'postnote-lcard-box';
    const image = document.createElement('img');
    image.className = 'postnote-lcard-image';
    image.setAttribute(ROLE_ATTRIBUTE, 'card-media');
    image.alt = '';
    image.dataset.postnoteSrc = card.image.src;
    image.src = card.image.src;
    media.appendChild(image);
    const chip = document.createElement('span');
    chip.className = 'postnote-lcard-title';
    chip.textContent = card.title;
    media.appendChild(chip);
    box.appendChild(media);
    if (card.domain) {
      const from = document.createElement('div');
      from.className = 'postnote-lcard-from';
      from.textContent = `${cardFromLabel(options.language, options.traditional)} ${card.domain}`;
      box.appendChild(from);
    }
    return box;
  }

  const box = document.createElement('div');
  box.className = 'postnote-scard';
  if (card.image) {
    const media = document.createElement('div');
    media.className = 'postnote-scard-media';
    const image = document.createElement('img');
    image.className = 'postnote-scard-image';
    image.setAttribute(ROLE_ATTRIBUTE, 'card-media');
    image.alt = '';
    image.dataset.postnoteSrc = card.image.src;
    image.src = card.image.src;
    media.appendChild(image);
    if (card.player) {
      const play = document.createElement('span');
      play.className = 'postnote-scard-play';
      media.appendChild(play);
    }
    box.appendChild(media);
  } else {
    box.classList.add('no-media');
  }
  box.appendChild(cardDetail(card));
  return box;
}

/**
 * A card image that cannot be used degrades instead of stopping the export:
 * the large card becomes the text-only small layout, the small card loses its
 * thumbnail column.
 */
export function applyCardMediaFallback(image: HTMLImageElement): void {
  const large = image.closest<HTMLElement>('.postnote-lcard');
  if (large) {
    const small = document.createElement('div');
    small.className = 'postnote-scard no-media';
    small.appendChild(
      cardDetail({
        layout: 'small',
        player: false,
        url: '',
        domain: large.dataset.domain ?? '',
        title: large.dataset.title ?? '',
        description: large.dataset.desc ?? '',
        image: null,
      }),
    );
    large.replaceWith(small);
    return;
  }
  const media = image.closest<HTMLElement>('.postnote-scard-media');
  media?.closest('.postnote-scard')?.classList.add('no-media');
  media?.remove();
}

/** Percentage text the way X writes it: one decimal, trailing ".0" dropped. */
export function formatPollPercent(part: number, total: number): string {
  if (total <= 0) return '0%';
  const value = Math.round((part / total) * 1000) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/**
 * The poll block, in the same slot the card would take. Option pills while the
 * post still votes; result bars once results show — a bar keeps the page's own
 * percentage text when it was the source, and every choice tied on top counts
 * as leading, exactly like the bold rows on the page.
 */
function renderPoll(poll: Poll, options: CardOptions): HTMLElement | null {
  const choices = poll.choices.filter((choice) => choice.label);
  if (choices.length === 0) return null;
  const box = document.createElement('div');
  box.className = 'postnote-poll';
  const display = poll.display ?? (poll.final || poll.voted ? 'results' : 'options');
  const total = choices.reduce((sum, choice) => sum + (choice.count ?? 0), 0);
  const drawable = choices.some((choice) => choice.count !== null || choice.pct);
  if (display === 'results' && drawable) {
    const top = choices.reduce((best, choice) => Math.max(best, choice.count ?? 0), 0);
    for (const choice of choices) {
      const pct = choice.pct ?? formatPollPercent(choice.count ?? 0, total);
      const win =
        choice.win ?? (choice.count !== null && total > 0 && choice.count === top);
      const row = document.createElement('div');
      row.className = `postnote-pr${win ? ' is-win' : ''}`;
      const fill = document.createElement('span');
      fill.className = 'postnote-pr-fill';
      fill.style.width = pct;
      const label = document.createElement('span');
      label.className = 'postnote-pr-label';
      label.textContent = choice.label;
      const number = document.createElement('span');
      number.className = 'postnote-pr-pct';
      number.textContent = pct;
      row.append(fill, label, number);
      box.appendChild(row);
    }
  } else {
    for (const choice of choices) {
      const option = document.createElement('div');
      option.className = 'postnote-po';
      option.textContent = choice.label;
      box.appendChild(option);
    }
  }
  const meta =
    poll.meta ?? pollMeta({ ...poll, choices }, options.language, options.traditional);
  if (meta) {
    const line = document.createElement('div');
    line.className = 'postnote-poll-meta';
    line.textContent = meta;
    box.appendChild(line);
  }
  return box;
}

/** The "Show this poll" line X prints inside a quote box that carries a poll. */
function renderQuotePollLine(options: CardOptions): HTMLElement {
  const line = document.createElement('div');
  line.className = 'postnote-qpoll';
  line.textContent = pollRevealLabel(options.language, options.traditional);
  return line;
}

/** The author line X shows inside a quote box. */
function renderQuoteHead(
  quote: Extract<TweetData['quote'], { kind: 'readable' }>,
  options: CardOptions,
): HTMLElement {
  const head = document.createElement('div');
  head.className = 'postnote-qhead';
  head.appendChild(renderAvatar(quote.author, 'postnote-qavatar', 'quote-avatar'));
  const name = document.createElement('b');
  name.textContent = quote.author.name;
  head.appendChild(name);
  const verified = renderVerified(quote.author, 'postnote-qverified');
  if (verified) head.appendChild(verified);
  const org = renderOrgBadge(quote.author, 'postnote-qorg');
  if (org) head.appendChild(org);
  const meta = document.createElement('i');
  const date = shortDate(quote.time, options.language, options.traditional);
  meta.textContent = [quote.author.handle, date].filter(Boolean).join(' · ');
  head.appendChild(meta);
  return head;
}

function renderQuote(quote: TweetData['quote'], options: CardOptions): HTMLElement | null {
  if (quote.kind === 'none') return null;
  const box = document.createElement('div');
  box.className = 'postnote-quote';
  if (quote.kind === 'unreadable') {
    box.classList.add('is-unreadable');
    box.textContent = UI.unreadableQuote[options.language];
    return box;
  }

  box.appendChild(renderQuoteHead(quote, options));
  if (quote.body.length > 0) box.appendChild(renderBody(quote.body, 'postnote-qtext'));
  // X never draws a poll inside a quote box — it prints a link line right
  // under the quote's text instead.
  if (quote.poll) box.appendChild(renderQuotePollLine(options));
  if (quote.images.length > 0) {
    box.appendChild(
      renderMediaStack(quote.images, 'postnote-qmedia', 'quote-media', options),
    );
  }

  const inner = quote.nested;
  if (inner.kind === 'readable') {
    // X renders the quoted post's own quote compactly: its author line, then a
    // square thumbnail of its first media beside its text. Deeper levels are
    // not drawn, matching the page itself.
    const nested = document.createElement('div');
    nested.className = 'postnote-quote is-nested';
    nested.appendChild(renderQuoteHead(inner, options));
    const row = document.createElement('div');
    row.className = 'postnote-nest';
    const first = inner.images[0];
    if (!first) row.classList.add('is-text-only');
    if (first) {
      const thumb = document.createElement('div');
      thumb.className = 'postnote-thumb';
      const image = document.createElement('img');
      image.setAttribute(ROLE_ATTRIBUTE, 'quote-media');
      image.alt = first.alt;
      image.dataset.postnoteSrc = first.src;
      image.src = first.src;
      thumb.appendChild(image);
      if (first.kind !== 'photo') {
        const play = document.createElement('span');
        play.className = 'postnote-play is-small';
        thumb.appendChild(play);
        const badge = document.createElement('span');
        badge.className = 'postnote-vbadge is-small';
        badge.textContent = mediaBadge(first.kind, options.language, options.traditional);
        thumb.appendChild(badge);
      }
      row.appendChild(thumb);
    }
    if (inner.body.length > 0) row.appendChild(renderBody(inner.body, 'postnote-qtext'));
    nested.appendChild(row);
    if (inner.poll) nested.appendChild(renderQuotePollLine(options));
    box.appendChild(nested);
  } else if (inner.kind === 'unreadable') {
    const nested = document.createElement('div');
    nested.className = 'postnote-quote is-nested is-unreadable';
    nested.textContent = UI.unreadableQuote[options.language];
    box.appendChild(nested);
  }
  return box;
}

function renderMetrics(
  metrics: Metrics,
  language: PageLanguage,
  traditional: boolean,
): HTMLElement | null {
  const shown = VISIBLE_METRICS.filter((kind) => metrics[kind] !== undefined);
  if (shown.length === 0) return null;
  const row = document.createElement('div');
  row.className = 'postnote-mx';
  shown.forEach((kind) => {
    const value = metrics[kind] as string;
    const display = formatCount(value, language, traditional);
    const item = document.createElement('span');
    item.className = 'postnote-metric';
    item.dataset.metric = kind;
    item.setAttribute('aria-label', `${metricLabel(kind, language, traditional)} ${value}`);
    item.innerHTML = METRIC_ICONS[kind];
    const count = document.createElement('span');
    count.className = 'postnote-metric-count';
    count.textContent = display;
    item.appendChild(count);
    row.appendChild(item);
  });
  return row;
}

function renderStamp(data: TweetData, options: CardOptions): HTMLElement | null {
  const parts = timeParts(data.time.absolute, data.time.visible, options.language, options.traditional);
  const views = data.metrics.views;
  const stamp = document.createElement('div');
  stamp.className = 'postnote-stamp';
  stamp.textContent = parts.join(' · ');
  if (views !== undefined) {
    if (parts.length > 0) stamp.appendChild(document.createTextNode(' · '));
    const number = document.createElement('b');
    number.textContent = formatStampCount(views, options.language, options.traditional);
    stamp.appendChild(number);
    stamp.appendChild(document.createTextNode(` ${UI.viewsSuffix[options.language]}`));
  }
  if (stamp.textContent === '') return null;
  return stamp;
}

/** One post inside the note: avatar rail plus the content column. */
export function renderCard(
  data: TweetData,
  options: CardOptions & { first?: boolean; last?: boolean },
): HTMLElement {
  const post = document.createElement('div');
  post.className = 'postnote-post';
  if (!options.first) post.classList.add('is-cont');
  if (options.last !== false) post.classList.add('is-end');

  const rail = document.createElement('div');
  rail.className = 'postnote-rail';
  rail.appendChild(renderAvatar(data.author, 'postnote-avatar', 'avatar'));
  const line = document.createElement('span');
  line.className = 'postnote-line';
  rail.appendChild(line);
  post.appendChild(rail);

  const content = document.createElement('div');
  content.className = 'postnote-content';

  const who = document.createElement('div');
  who.className = 'postnote-who';
  const nameRow = document.createElement('span');
  nameRow.className = 'postnote-name';
  nameRow.textContent = data.author.name;
  const verified = renderVerified(data.author, '');
  if (verified) nameRow.appendChild(verified);
  const org = renderOrgBadge(data.author, '');
  if (org) nameRow.appendChild(org);
  who.appendChild(nameRow);
  if (data.author.handle) {
    const handle = document.createElement('span');
    handle.className = 'postnote-handle';
    handle.textContent = data.author.handle;
    who.appendChild(handle);
  }
  content.appendChild(who);

  if (data.body.length > 0) content.appendChild(renderBody(data.body, 'postnote-text'));
  if (data.images.length > 0) {
    content.appendChild(renderMediaStack(data.images, 'postnote-media', 'media', options));
  }
  if (data.card) content.appendChild(renderLinkCard(data.card, options));
  const poll = data.poll ? renderPoll(data.poll, options) : null;
  if (poll) content.appendChild(poll);
  const quote = renderQuote(data.quote, options);
  if (quote) content.appendChild(quote);
  const stamp = renderStamp(data, options);
  if (stamp) content.appendChild(stamp);
  const metrics = renderMetrics(data.metrics, options.language, options.traditional);
  if (metrics) content.appendChild(metrics);

  post.appendChild(content);
  return post;
}

/**
 * The full export figure: one note on a tinted sheet, posts on it in order,
 * then the footer with the source address.
 */
export function renderSheet(posts: TweetData[], options: SheetOptions): HTMLElement {
  const sheet = document.createElement('div');
  sheet.className = 'postnote-sheet';
  sheet.innerHTML = GOLD_DEFS;

  const note = document.createElement('article');
  note.className = 'postnote-note';
  posts.forEach((data, index) => {
    note.appendChild(
      renderCard(data, {
        ...options,
        first: index === 0,
        last: index === posts.length - 1,
      }),
    );
  });

  const foot = document.createElement('div');
  foot.className = 'postnote-foot';
  const last = posts[posts.length - 1];
  const src = document.createElement('span');
  src.className = 'postnote-src';
  const address = last ? last.url.replace(/^https?:\/\//, '') : '';
  const link = document.createElement('span');
  link.className = 'postnote-src-url';
  link.textContent = address;
  src.appendChild(link);
  // The count sits outside the ellipsis zone: SnapDOM's text measure can run a
  // pixel or two wider than the live layout's, and a suffix sharing the address
  // span was clipped even while the footer still had room.
  if (posts.length > 1) {
    const count = document.createElement('span');
    count.className = 'postnote-src-count';
    count.textContent = `· ${postsSuffix(options.language, posts.length, options.traditional)}`;
    src.appendChild(count);
  }
  const mark = document.createElement('span');
  mark.className = 'postnote-mark';
  const brand = document.createElement('b');
  brand.textContent = '推笺';
  mark.appendChild(brand);
  mark.appendChild(document.createTextNode(' PostNote'));
  foot.appendChild(src);
  foot.appendChild(mark);
  note.appendChild(foot);

  sheet.appendChild(note);
  return sheet;
}

/** Swap a failed avatar for a readable placeholder instead of dropping it. */
export function applyAvatarPlaceholder(image: HTMLImageElement, name: string): void {
  const square = image.classList.contains('is-square') ? ' is-square' : '';
  const placeholder = document.createElement('span');
  placeholder.className = `${image.className}${square} postnote-avatar-placeholder`;
  placeholder.textContent = (name || '?').trim().charAt(0) || '?';
  image.replaceWith(placeholder);
}

/**
 * Fall back to the Unicode an emoji image stood for.
 *
 * Only valid because the emoji was read from its own alt text: when there is no
 * Unicode to fall back to, the caller reports the media as missing instead.
 */
export function applyEmojiFallback(image: HTMLImageElement): void {
  const unicode = image.dataset.unicode ?? '';
  if (!unicode) return;
  image.replaceWith(document.createTextNode(unicode));
}

/** A missing organization badge is cosmetic: hide it rather than block. */
export function applyOrgFallback(image: HTMLImageElement): void {
  image.style.display = 'none';
}
