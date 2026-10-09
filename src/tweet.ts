/**
 * PostNote content model.
 *
 * These values cross a module boundary: `x-page.ts` and `x-snapshot.ts` produce
 * them, `render.ts` consumes them. Nothing here may hold a DOM node, a listener,
 * a host class name, or a host style, so one snapshot can be rendered any
 * number of times without the earlier result changing.
 */

export type PageLanguage = 'zh' | 'en';

export type EngagementKind =
  | 'replies'
  | 'reposts'
  | 'likes'
  | 'bookmarks'
  | 'views';

/**
 * Engagement values exactly as the source exposed them.
 *
 * A missing key means the value is unknown: the page or the loaded data never
 * exposed it, and it is rendered as absent. A plain integer string is the real
 * count and is formatted for display; a value that came pre-formatted from the
 * page (such as "4.3萬") is kept as-is. `'0'` means a real zero — never used
 * to stand in for an unknown count.
 */
export type Metrics = Partial<Record<EngagementKind, string>>;

/**
 * One node of a post body. Values are already sanitized: a `link` never carries
 * a non-http(s) target, and an `emoji` always carries the Unicode it stands for
 * so it can be rendered as text when its image cannot be used.
 */
export type BodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'mention'; text: string; handle: string }
  | { kind: 'hashtag'; text: string; tag: string }
  | { kind: 'emoji'; unicode: string; src: string }
  | { kind: 'break' };

/** What a media entry is, taken from the source's own `type`. */
export type MediaKind = 'photo' | 'video' | 'gif';

export type Media = {
  /**
   * For a photo: the image. For a video or GIF: the poster X itself exposes.
   * The video stream is never captured or rendered.
   */
  src: string;
  alt: string;
  kind: MediaKind;
  /** Natural pixel size when the source exposed it; drives the aspect ratio. */
  width?: number;
  height?: number;
};

/** The colour of the verification mark, in X's own terms. */
export type VerificationKind = 'blue' | 'business' | 'government';

export type Author = {
  /** Display name, emoji kept as Unicode. Never carries host DOM. */
  name: string;
  /** `@handle` including the leading `@`, or `''` when unreadable. */
  handle: string;
  avatarUrl: string | null;
  /** The URL to fall back to when `avatarUrl` (a larger rendition) fails to load. */
  avatarFallbackUrl?: string;
  /** X marks business accounts with a square avatar. Defaults to a circle. */
  avatarShape?: 'circle' | 'square';
  /** Absent or null means no verification mark was present in the source. */
  verification?: VerificationKind | null;
  /** Organization badge drawn after the verification mark. */
  badge?: { src: string; label: string } | null;
};

export type TweetTime = {
  /** Machine-readable timestamp, when the source exposed one. */
  absolute: string | null;
  /**
   * Text the page actually displayed. May be relative ("2h"), and is the only
   * value available when `absolute` is null. Never invented from other data.
   */
  visible: string | null;
};

/**
 * Reply relation of this post.
 *
 * `root` and `unknown` must stay distinguishable: "this post has no parent" is
 * a fact, "we have not established the parent" is not.
 */
export type ReplyRelation =
  | { kind: 'root' }
  | { kind: 'reply'; parentId: string }
  | { kind: 'unknown' };

export type Quote =
  | { kind: 'none' }
  | { kind: 'unreadable' }
  | {
      kind: 'readable';
      id: string | null;
      url: string | null;
      author: Author;
      time: TweetTime;
      body: BodySegment[];
      images: Media[];
      /**
       * The quoted post carries a poll; X never draws it inside a quote, it
       * shows a "显示此投票" link line instead — and so does the export.
       */
      poll: boolean;
      /**
       * The post this quoted post itself quotes — X renders one level inside a
       * quote, compactly. `none` when there is none, `unreadable` when the
       * source marked it unavailable, `readable` with its own `nested` set to
       * `none`: nothing deeper is kept.
       */
      nested: Quote;
    };

/**
 * A link preview card under the post, drawn the way X draws it: `large` is the
 * wide image card (`summary_large_image`), `small` the thumbnail row
 * (`summary` and `player`). `player` marks the small card that carries a play
 * button over its thumbnail.
 */
export type LinkCard = {
  layout: 'large' | 'small';
  player: boolean;
  /** The card's expanded link; falls back to the card's own URL when unread. */
  url: string;
  /** `vanity_url` first, then `domain`. */
  domain: string;
  title: string;
  description: string;
  image: { src: string; width?: number; height?: number } | null;
};

export type PollChoice = {
  label: string;
  /** Vote count; null when the source (a page read) only exposed percentages. */
  count: number | null;
  /** The percentage text read off the page, when the page was the source. */
  pct?: string;
  /** The page's own leading mark, when the page was the source. */
  win?: boolean;
};

export type Poll = {
  choices: PollChoice[];
  /** `counts_are_final`: the vote is closed. */
  final: boolean;
  /** The reader already voted (`selected_choice` present), so results show. */
  voted?: boolean;
  endsAt: string | null;
  /**
   * Decided at read time from what the page shows — same rule as the
   * translation flag: the snapshot stays pure data, the DOM decides display.
   */
  display?: 'options' | 'results';
  /** The page's own "N votes · …" line, kept verbatim when it was read. */
  meta?: string | null;
};

export type TweetData = {
  /** Stable id of this post itself, never taken from quoted content. */
  id: string;
  url: string;
  author: Author;
  time: TweetTime;
  body: BodySegment[];
  images: Media[];
  /** Link preview card; absent when the card is of a kind X does not draw. */
  card?: LinkCard | null;
  /** Poll card; absent when there is none or it could not be read. */
  poll?: Poll | null;
  quote: Quote;
  metrics: Metrics;
  reply: ReplyRelation;
};

export type ExtractFailure =
  | 'no-tweet-element'
  | 'no-status-id'
  | 'no-content'
  | 'unsupported-media'
  | 'read-error';

export type ExtractWarning =
  | 'avatar-missing'
  | 'quote-unreadable'
  | 'media-unknown'
  | 'text-collapsed';

export type TweetExtract =
  | { ok: true; data: TweetData; warnings: ExtractWarning[] }
  | { ok: false; failure: ExtractFailure };

/**
 * Warnings that stop an export instead of degrading it.
 *
 * Missing parts of the supported body, and body text the page is hiding, would
 * otherwise be exported as if the card were complete.
 */
export const BLOCKING_WARNINGS: readonly ExtractWarning[] = [
  'media-unknown',
  'text-collapsed',
];

/** True when a body carries something a reader would see, ignoring blanks. */
export function hasVisibleBody(body: BodySegment[]): boolean {
  return body.some((segment) => {
    switch (segment.kind) {
      case 'text':
        return segment.text.trim().length > 0;
      case 'link':
      case 'mention':
      case 'hashtag':
        return segment.text.trim().length > 0;
      case 'emoji':
        return true;
      case 'break':
        return false;
    }
  });
}

/** Plain text of a body, used for titles and diagnostics. */
export function bodyText(body: BodySegment[]): string {
  return body
    .map((segment) => {
      switch (segment.kind) {
        case 'text':
          return segment.text;
        case 'link':
        case 'mention':
        case 'hashtag':
          return segment.text;
        case 'emoji':
          return segment.unicode;
        case 'break':
          return '\n';
      }
    })
    .join('');
}
