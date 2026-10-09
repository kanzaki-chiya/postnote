/**
 * Turning a tweet node from X's own GraphQL responses into a `TweetData`
 * snapshot.
 *
 * The page loads these responses for itself; this module only interprets what
 * was already delivered. Everything produced here is sanitized and serializable:
 * links that are not http(s) become plain text, media is restricted to the
 * hosts the export is allowed to fetch, and nothing references live DOM.
 *
 * Two text forms are kept when the data carries both: the original body and the
 * machine translation X attached (`grok_translated_post_with_availability`).
 * Which one is shown is a display decision made at read time by the caller, so
 * the snapshot itself does not depend on what the page happened to show.
 */

import type {
  Author,
  BodySegment,
  ExtractWarning,
  LinkCard,
  Media,
  Metrics,
  Poll,
  PollChoice,
  Quote,
  TweetData,
  TweetTime,
  VerificationKind,
} from './tweet';
import { getHighResImageUrl, toAbsoluteUrl } from './x-content';

const MEDIA_HOSTS: Record<string, true> = {
  'pbs.twimg.com': true,
  'abs.twimg.com': true,
};

const BASE_URL = 'https://x.com/';

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asCount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

/** A URL the export is permitted to fetch for display, or null. */
function mediaUrl(raw: unknown): string | null {
  const url = toAbsoluteUrl(asString(raw));
  return url && MEDIA_HOSTS[url.hostname] === true ? url.href : null;
}

/**
 * Twemoji image for one emoji sequence, in the form X itself serves.
 * The variation selector never appears in the file name.
 */
export function emojiImageSrc(unicode: string): string {
  const codes = Array.from(unicode)
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((code) => code !== 'fe0f');
  return `https://abs.twimg.com/emoji/v2/72x72/${codes.join('-')}.png`;
}

const EMOJI_PATTERN =
  /(?:\p{Extended_Pictographic}[🏻-🏿️]?(?:‍\p{Extended_Pictographic}[🏻-🏿️]?)*)|(?:\p{Regional_Indicator}{2})|(?:[0-9#*]️?⃣)|(?:[©®‼⁉™↔-↙↩-↪⌚⌛⌨⏏-⏳⏸-⏺Ⓜ▪▫▶◀◻-◾☀-☄☎☑☔☕☘☝☠☢☣☦☪☮☯☸-☺♀♂♈-♓♟♠♣♥♦♨♻♾♿⚒-⚗⚙⚛⚜⚠⚡⚪⚫⚰⚱⚽⚾⛄⛅⛈⛎⛏⛑⛓⛔⛩⛪⛰-⛵⛷-⛺⛽✂✅✈-✍✏✒✔✖✝✡✨✳✴❄❇❌❎❓-❕❗❣❤➕-➗➡➰➿⤴-⤵⬅-⬇⬛⬜⭐⭕〰〽㊗㊙]️?)/gu;

/** Split a plain-text run into text and emoji segments, keeping order. */
function pushTextWithEmoji(text: string, out: BodySegment[]): void {
  text.split('\n').forEach((line, lineIndex) => {
    if (lineIndex > 0) out.push({ kind: 'break' });
    let cursor = 0;
    for (const match of line.matchAll(EMOJI_PATTERN)) {
      const start = match.index;
      if (start > cursor) out.push({ kind: 'text', text: line.slice(cursor, start) });
      out.push({ kind: 'emoji', unicode: match[0], src: emojiImageSrc(match[0]) });
      cursor = start + match[0].length;
    }
    if (cursor < line.length) out.push({ kind: 'text', text: line.slice(cursor) });
  });
}

type RawEntity = { indices?: unknown } & Raw;

/** `entitySet[key]` as an array of raw objects, or []. */
function entityList(entitySet: unknown, key: string): Raw[] {
  const entities = asObject(entitySet);
  return Array.isArray(entities?.[key]) ? (entities[key] as Raw[]) : [];
}

/** The `[start, end)` code-point pair of an entity, or null when malformed. */
function entityRange(entity: unknown): [number, number] | null {
  const indices = (entity as RawEntity).indices;
  if (!Array.isArray(indices)) return null;
  const [start, end] = indices;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  return [start, end];
}

type Mark = {
  start: number;
  end: number;
  build: (slice: string) => BodySegment[];
};

/**
 * Turn a full text plus its entity set into body segments.
 *
 * `indices` in X's entities are code-point offsets into the text, measured on
 * the original string, so everything here works on code points, not UTF-16
 * units. Entities outside the display range (the t.co link of attached media,
 * for example) are dropped the same way the page drops them.
 */
export function bodyFromEntities(
  text: string,
  entitySet: unknown,
  range?: [number, number] | null,
  extraMedia?: unknown,
  hiddenUrl?: string | null,
): BodySegment[] {
  const chars = Array.from(text);
  const [from, to] = [
    Math.max(0, range?.[0] ?? 0),
    Math.min(chars.length, range?.[1] ?? chars.length),
  ];
  const entities = asObject(entitySet) ?? {};
  const marks: Mark[] = [];
  const inside = (span: [number, number]) => span[0] >= from && span[1] <= to;
  const sliceOf = (span: [number, number]) => chars.slice(span[0], span[1]).join('');

  const list = (key: string): Raw[] =>
    Array.isArray(entities[key]) ? (entities[key] as Raw[]) : [];

  // Links that stand in for attached media or for the post's own link card
  // are not body text, even when X's display range covers them.
  let dropped = false;
  const mediaList = [...list('media'), ...(Array.isArray(extraMedia) ? (extraMedia as Raw[]) : [])];
  for (const media of mediaList) {
    const span = entityRange(media);
    if (!span || !inside(span)) continue;
    marks.push({
      start: span[0],
      end: span[1],
      build: () => {
        dropped = true;
        return [];
      },
    });
  }
  for (const urlEntity of list('urls')) {
    const span = entityRange(urlEntity);
    if (!span || !inside(span)) continue;
    // A link card's own t.co is hidden only at the very end of the displayed
    // text — the spot where the page swaps it for the card. The same URL in
    // the middle of the text, or any link when no card was read, stays.
    if (
      hiddenUrl &&
      asString(urlEntity.url) === hiddenUrl &&
      chars.slice(span[1], to).every((char) => /\s/.test(char))
    ) {
      marks.push({
        start: span[0],
        end: span[1],
        build: () => {
          dropped = true;
          return [];
        },
      });
      continue;
    }
    const href =
      toAbsoluteUrl(asString(urlEntity.expanded_url) ?? asString(urlEntity.url))?.href ?? null;
    const display = asString(urlEntity.display_url) ?? sliceOf(span);
    marks.push({
      start: span[0],
      end: span[1],
      build: () =>
        href
          ? [{ kind: 'link', text: display, href }]
          : [{ kind: 'text', text: display }],
    });
  }
  for (const mention of list('user_mentions')) {
    const span = entityRange(mention);
    if (!span || !inside(span)) continue;
    const name = asString(mention.screen_name);
    if (!name) continue;
    marks.push({
      start: span[0],
      end: span[1],
      build: (slice) => [
        { kind: 'mention', text: slice.startsWith('@') ? slice : `@${name}`, handle: `@${name}` },
      ],
    });
  }
  for (const tag of list('hashtags')) {
    const span = entityRange(tag);
    if (!span || !inside(span)) continue;
    const name = asString(tag.text) ?? '';
    marks.push({
      start: span[0],
      end: span[1],
      build: (slice) => [
        { kind: 'hashtag', text: slice.startsWith('#') ? slice : `#${name}`, tag: name },
      ],
    });
  }
  for (const symbol of list('symbols')) {
    const span = entityRange(symbol);
    if (!span || !inside(span)) continue;
    const name = asString(symbol.text) ?? '';
    const href = name
      ? `${BASE_URL}search?q=${encodeURIComponent(`$${name}`)}&src=cashtag_click`
      : null;
    marks.push({
      start: span[0],
      end: span[1],
      build: (slice) =>
        href
          ? [{ kind: 'link', text: slice.startsWith('$') ? slice : `$${name}`, href }]
          : [{ kind: 'text', text: slice }],
    });
  }

  marks.sort((left, right) => left.start - right.start);
  const kept: Mark[] = [];
  for (const mark of marks) {
    const last = kept[kept.length - 1];
    if (last && mark.start < last.end) continue;
    kept.push(mark);
  }

  const out: BodySegment[] = [];
  let cursor = from;
  for (const mark of kept) {
    if (mark.start > cursor) {
      pushTextWithEmoji(chars.slice(cursor, mark.start).join(''), out);
    }
    out.push(...mark.build(sliceOf([mark.start, mark.end])));
    cursor = mark.end;
  }
  if (cursor < to) pushTextWithEmoji(chars.slice(cursor, to).join(''), out);

  if (dropped) trimEdges(out);
  return out;
}

/** Drop the blank lines and spaces a removed media link leaves at either end. */
function trimEdges(out: BodySegment[]): void {
  for (const end of ['start', 'end'] as const) {
    while (out.length > 0) {
      const index = end === 'start' ? 0 : out.length - 1;
      const segment = out[index];
      if (segment.kind === 'break') {
        out.splice(index, 1);
        continue;
      }
      if (segment.kind !== 'text') break;
      const text = end === 'start' ? segment.text.trimStart() : segment.text.trimEnd();
      if (text) {
        out[index] = { ...segment, text };
        break;
      }
      out.splice(index, 1);
    }
  }
}

/** `created_at` as delivered, parsed to ISO; null when it cannot be read. */
function snapshotTime(createdAt: unknown): TweetTime {
  const raw = asString(createdAt);
  const time = raw ? new Date(raw) : null;
  return {
    absolute: time && !Number.isNaN(time.getTime()) ? time.toISOString() : null,
    visible: null,
  };
}

/**
 * `_normal` avatars are 48px — a 3x export needs 144px, so ask for the
 * `_400x400` rendition. The delivered URL is kept as the fallback.
 */
function avatarUrls(raw: unknown): { avatarUrl: string | null; avatarFallbackUrl?: string } {
  const url = mediaUrl(raw);
  if (!url) return { avatarUrl: null };
  const large = url.replace(/_(?:normal|bigger|mini)(\.\w+)$/i, '_400x400$1');
  return large === url ? { avatarUrl: url } : { avatarUrl: large, avatarFallbackUrl: url };
}

function readAuthor(tweet: Raw): Author {
  const user =
    asObject(asObject(asObject(tweet.core)?.user_results)?.result) ?? {};
  const core = asObject(user.core) ?? {};
  const name = asString(core.name) ?? '';
  const screen = asString(core.screen_name) ?? '';
  const verificationType = asString(asObject(user.verification)?.verified_type);
  const verification: VerificationKind | null =
    verificationType === 'Business' || verificationType === 'Organization'
      ? 'business'
      : verificationType === 'Government'
        ? 'government'
        : user.is_blue_verified === true
          ? 'blue'
          : null;
  const label = asObject(asObject(user.affiliates_highlighted_label)?.label);
  const badgeUrl = mediaUrl(asObject(label?.badge)?.url);
  const badge =
    badgeUrl !== null
      ? { src: badgeUrl, label: asString(label?.description) ?? '' }
      : null;
  return {
    name,
    handle: screen ? `@${screen}` : '',
    ...avatarUrls(asObject(user.avatar)?.image_url),
    avatarShape: user.profile_image_shape === 'Square' ? 'square' : 'circle',
    verification,
    badge,
  };
}

function readMedia(tweet: Raw, warnings: ExtractWarning[]): Media[] {
  const legacy = asObject(tweet.legacy) ?? {};
  const rawList =
    (asObject(legacy.extended_entities)?.media as unknown) ??
    (asObject(legacy.entities)?.media as unknown);
  if (!Array.isArray(rawList)) return [];
  const media: Media[] = [];
  for (const raw of rawList) {
    const item = asObject(raw);
    if (!item) continue;
    const kind =
      item.type === 'video' ? 'video' : item.type === 'animated_gif' ? 'gif' : 'photo';
    const src =
      kind === 'photo'
        ? mediaUrl(getHighResImageUrl(asString(item.media_url_https) ?? ''))
        : mediaUrl(item.media_url_https);
    if (!src) {
      // A media slot with no usable image would otherwise vanish from the card.
      warnings.push('media-unknown');
      continue;
    }
    const info = asObject(item.original_info) ?? {};
    media.push({
      src,
      alt: asString(item.ext_alt_text) ?? '',
      kind,
      width: typeof info.width === 'number' ? info.width : undefined,
      height: typeof info.height === 'number' ? info.height : undefined,
    });
  }
  return media;
}

function readMetrics(tweet: Raw): Metrics {
  const legacy = asObject(tweet.legacy) ?? {};
  const metrics: Metrics = {};
  // X's repost button counts quotes too: retweet_count + quote_count.
  const retweets = asCount(legacy.retweet_count);
  const quotes = asCount(legacy.quote_count);
  const reposts =
    retweets === null ? null : String(Number(retweets) + (quotes === null ? 0 : Number(quotes)));
  const pairs: [keyof Metrics, unknown][] = [
    ['replies', legacy.reply_count],
    ['reposts', reposts],
    ['likes', legacy.favorite_count],
    ['bookmarks', legacy.bookmark_count],
    ['views', asObject(tweet.views)?.count],
  ];
  for (const [kind, value] of pairs) {
    const count = asCount(value);
    if (count !== null) metrics[kind] = count;
  }
  return metrics;
}

/** The node a `quoted_status_result`-shaped field actually points at. */
function resultNode(value: unknown): Raw | null {
  const result = asObject(value)?.result;
  const node = asObject(result);
  if (!node) return null;
  // TweetWithVisibilityResults wraps the real tweet one level deeper.
  const inner = asObject(node.tweet);
  if (inner) return inner;
  return node;
}

function isTweetNode(node: Raw | null): node is Raw {
  return (
    node !== null &&
    typeof node.rest_id === 'string' &&
    asObject(node.legacy)?.full_text !== undefined
  );
}

/**
 * Unwrap `note_tweet`: long posts carry their full text and entities in
 * `note_tweet_results`, while `legacy.full_text` stays truncated.
 */
function noteText(tweet: Raw): { text: string; entities: unknown } | null {
  const note = asObject(
    asObject(asObject(tweet.note_tweet)?.note_tweet_results)?.result,
  );
  const text = asString(note?.text);
  return note && text !== null ? { text, entities: note.entity_set } : null;
}

function translationOf(tweet: Raw, hiddenUrl?: string | null): { body: BodySegment[] } | null {
  const translated = asObject(tweet.grok_translated_post_with_availability);
  if (translated?.is_available !== true) return null;
  const data = asObject(translated.data);
  const text = asString(data?.translation);
  if (!text) return null;
  return { body: bodyFromEntities(text, data?.entities, null, undefined, hiddenUrl) };
}

/** Where the card payload lives: `card.legacy` normally, `card` itself otherwise. */
function cardHolder(tweet: Raw): Raw | null {
  const candidates = [asObject(tweet.card), asObject(asObject(tweet.legacy)?.card)];
  for (const card of candidates) {
    if (!card) continue;
    const legacy = asObject(card.legacy);
    if (legacy) return legacy;
    if (asString(card.name)) return card;
  }
  return null;
}

/** `binding_values` as a key → value map; each value carries a `type`. */
function cardBindings(holder: Raw): Map<string, Raw> {
  const map = new Map<string, Raw>();
  const list = holder.binding_values;
  if (!Array.isArray(list)) return map;
  for (const entry of list) {
    const item = asObject(entry);
    const key = asString(item?.key);
    const value = asObject(item?.value);
    if (key && value) map.set(key, value);
  }
  return map;
}

function bindingString(bindings: Map<string, Raw>, key: string): string | null {
  return asString(bindings.get(key)?.string_value);
}

/** A card image that may be fetched, or null — anything else counts as no image. */
function bindingImage(bindings: Map<string, Raw>, key: string): LinkCard['image'] {
  const image = asObject(bindings.get(key)?.image_value);
  const src = mediaUrl(image?.url);
  if (!image || !src) return null;
  return {
    src,
    width: typeof image.width === 'number' ? image.width : undefined,
    height: typeof image.height === 'number' ? image.height : undefined,
  };
}

const LINK_CARD_LAYOUTS: Record<string, LinkCard['layout']> = {
  summary_large_image: 'large',
  summary: 'small',
  player: 'small',
};

/** Image keys, in the order the card kind prefers them. */
const CARD_IMAGE_KEYS: Record<string, string[]> = {
  summary_large_image: [
    'photo_image_full_size_large',
    'photo_image_full_size_original',
    'summary_photo_image_large',
    'thumbnail_image_original',
  ],
  summary: ['thumbnail_image_large', 'thumbnail_image', 'thumbnail_image_original'],
  player: ['player_image_large', 'player_image', 'player_image_original'],
};

/**
 * A `summary_large_image` / `summary` / `player` card. Every other name —
 * `unified_card` included — is not a card X draws as a link preview.
 */
function readLinkCard(
  holder: Raw,
  bindings: Map<string, Raw>,
  urlEntities: Raw[],
): { card: LinkCard; hiddenUrl: string | null } | null {
  const name = asString(holder.name) ?? '';
  const layout = LINK_CARD_LAYOUTS[name];
  if (!layout) return null;
  const title = bindingString(bindings, 'title');
  if (!title) return null;
  const ownUrl = asString(holder.url) ?? '';
  const entity = urlEntities.find(
    (entry) => asString(asObject(entry)?.url) === ownUrl,
  );
  const url =
    toAbsoluteUrl(asString(asObject(entity)?.expanded_url))?.href ??
    toAbsoluteUrl(bindingString(bindings, 'card_url'))?.href ??
    ownUrl;
  const image =
    CARD_IMAGE_KEYS[name].map((key) => bindingImage(bindings, key)).find(Boolean) ?? null;
  return {
    card: {
      layout,
      player: name === 'player',
      url,
      domain:
        bindingString(bindings, 'vanity_url') ?? bindingString(bindings, 'domain') ?? '',
      title,
      description: bindingString(bindings, 'description') ?? '',
      image,
    },
    hiddenUrl: ownUrl || null,
  };
}

/** `end_datetime_utc` text as ISO, or null when it cannot be read. */
function cardTime(raw: string | null): string | null {
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A `*poll*` card binding set as a Poll; null when it yields no choices. */
function readPollCard(bindings: Map<string, Raw>): Poll | null {
  const choices: PollChoice[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const label = bindingString(bindings, `choice${index}_label`);
    if (!label) continue;
    const raw = bindingString(bindings, `choice${index}_count`);
    const count = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
    choices.push({ label, count });
  }
  if (!choices.length) return null;
  const finalFlag = bindings.get('counts_are_final');
  const final = finalFlag?.string_value === 'true' || finalFlag?.boolean_value === true;
  let endsAt = cardTime(bindingString(bindings, 'end_datetime_utc'));
  if (!endsAt) {
    const updated = cardTime(bindingString(bindings, 'last_updated_datetime_utc'));
    const minutes = Number(bindingString(bindings, 'duration_minutes'));
    if (updated && Number.isFinite(minutes) && minutes > 0) {
      endsAt = new Date(new Date(updated).getTime() + minutes * 60_000).toISOString();
    }
  }
  const voted =
    Boolean(bindingString(bindings, 'selected_choice')) ||
    bindings.get('selected_choice')?.boolean_value === true;
  return { choices, final, voted, endsAt };
}

/**
 * The tweet's own card, if X draws one for it. Poll cards come back as
 * `poll`; `hiddenUrl` is the link card's t.co so the body can drop it the
 * way the page does.
 */
function readCard(
  tweet: Raw,
  urlEntities: Raw[],
): { card: LinkCard | null; poll: Poll | null; hiddenUrl: string | null } | null {
  const holder = cardHolder(tweet);
  if (!holder) return null;
  const name = asString(holder.name) ?? '';
  const bindings = cardBindings(holder);
  if (/poll/i.test(name)) {
    return { card: null, poll: readPollCard(bindings), hiddenUrl: null };
  }
  const link = readLinkCard(holder, bindings, urlEntities);
  return { card: link?.card ?? null, poll: null, hiddenUrl: link?.hiddenUrl ?? null };
}

function readQuote(tweet: Raw, depth: number, warnings: ExtractWarning[]): Quote {
  const legacy = asObject(tweet.legacy) ?? {};
  const marker = tweet.quoted_status_result ?? tweet.quoted_status;
  if (marker === undefined || marker === null) {
    return legacy.is_quote_status === true ? { kind: 'unreadable' } : { kind: 'none' };
  }
  const node = resultNode(marker);
  if (!isTweetNode(node)) return { kind: 'unreadable' };
  return quoteFromNode(node, depth, warnings);
}

function quoteFromNode(node: Raw, depth: number, warnings: ExtractWarning[]): Quote {
  const author = readAuthor(node);
  const images = readMedia(node, warnings);
  const legacyInner = asObject(node.legacy) ?? {};
  const note = noteText(node);
  const body = note
    ? bodyFromEntities(note.text, note.entities, null)
    : bodyFromEntities(
        asString(legacyInner.full_text) ?? '',
        legacyInner.entities,
        Array.isArray(legacyInner.display_text_range)
          ? [legacyInner.display_text_range[0] as number, legacyInner.display_text_range[1] as number]
          : null,
        asObject(legacyInner.extended_entities)?.media,
      );
  const screen = author.handle.replace(/^@/, '');
  const id = asString(node.rest_id) ?? asString(legacyInner.id_str) ?? null;
  const nested =
    depth === 0
      ? readNestedQuote(node, warnings)
      : ({ kind: 'none' } as Quote);
  return {
    kind: 'readable',
    id,
    url: id ? `${BASE_URL}${screen || 'i/web'}/status/${id}` : null,
    author,
    time: snapshotTime(legacyInner.created_at),
    body,
    images,
    // A poll inside a quote stays a "Show this poll" line, on both levels.
    poll: /poll/i.test(asString(cardHolder(node)?.name) ?? ''),
    nested,
  };
}

/** The second quote level X attaches inside `quoted_status_result`. */
function readNestedQuote(tweet: Raw, warnings: ExtractWarning[]): Quote {
  const wrapper =
    tweet.nested_quoted_tweet_results ??
    asObject(tweet.quotedRefResult)?.result ??
    null;
  const node = resultNode(wrapper ?? undefined) ?? asObject(wrapper);
  if (wrapper === null) return readQuote(tweet, 1, warnings);
  if (!isTweetNode(node)) return { kind: 'unreadable' };
  return quoteFromNode(node, 1, warnings);
}

export type TweetSnapshot = {
  data: TweetData;
  /** The translation X delivered, or null when it has none / it was unavailable. */
  translatedBody: BodySegment[] | null;
  warnings: ExtractWarning[];
};

/**
 * Build a snapshot from one GraphQL tweet node, or return null when the value
 * is not a tweet node at all.
 *
 * `TweetWithVisibilityResults` and timeline wrappers are unwrapped; a
 * tombstone or any other unavailable marker is not a tweet and returns null.
 */
export function snapshotFromNode(input: unknown): TweetSnapshot | null {
  const raw = asObject(input);
  if (!raw) return null;
  const node = (asObject(raw.tweet) ?? raw) as Raw;
  if (!isTweetNode(node)) return null;

  const warnings: ExtractWarning[] = [];
  const legacy = asObject(node.legacy) ?? {};
  const author = readAuthor(node);
  if (!author.avatarUrl) warnings.push('avatar-missing');
  const images = readMedia(node, warnings);
  const note = noteText(node);
  const range = Array.isArray(legacy.display_text_range)
    ? ([legacy.display_text_range[0], legacy.display_text_range[1]] as [number, number])
    : null;
  // The card decides whether its own t.co disappears from the body end, so it
  // is read first; url entities from either text layer resolve its link.
  const urlEntities = [
    ...entityList(legacy.entities, 'urls'),
    ...(note ? entityList(note.entities, 'urls') : []),
  ];
  const cardRead = readCard(node, urlEntities);
  const body = note
    ? bodyFromEntities(note.text, note.entities, null, undefined, cardRead?.hiddenUrl)
    : bodyFromEntities(
        asString(legacy.full_text) ?? '',
        legacy.entities,
        range,
        asObject(legacy.extended_entities)?.media,
        cardRead?.hiddenUrl,
      );
  const quote = readQuote(node, 0, warnings);
  if (quote.kind === 'unreadable') warnings.push('quote-unreadable');

  const id = asString(node.rest_id) ?? asString(legacy.id_str);
  if (!id) return null;
  const screen = author.handle.replace(/^@/, '');
  const parentKey = 'in_reply_to_status_id_str' in legacy;
  const parent = asString(legacy.in_reply_to_status_id_str);

  return {
    data: {
      id,
      url: `${BASE_URL}${screen || 'i/web'}/status/${id}`,
      author,
      time: snapshotTime(legacy.created_at),
      body,
      images,
      card: cardRead?.card ?? null,
      poll: cardRead?.poll ?? null,
      quote,
      metrics: readMetrics(node),
      reply: parentKey ? (parent ? { kind: 'reply', parentId: parent } : { kind: 'root' }) : { kind: 'root' },
    },
    translatedBody: translationOf(node, cardRead?.hiddenUrl)?.body ?? null,
    warnings,
  };
}
