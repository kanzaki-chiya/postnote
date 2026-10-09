/**
 * Every user-facing string, in both languages PostNote supports.
 *
 * Each table is keyed by a code shared with the extraction and export layers, so
 * a failure travels from where it is detected to where it is shown as a code,
 * and prose is only looked up at the point of display.
 */

import type {
  EngagementKind,
  ExtractFailure,
  ExtractWarning,
  PageLanguage,
  Poll,
} from './tweet';

/** Look up with the page language: `ENTRY[language]`. */
export type Entry = Record<PageLanguage, string>;

export type ExportFailure = 'media-failed' | 'too-large' | 'capture-failed' | 'empty-image';

export const EXTRACT_FAILURES: Record<ExtractFailure, Entry> = {
  'no-tweet-element': {
    zh: '没有找到这条推文。请等页面加载完成后重试。',
    en: 'This post was not found. Wait for the page to finish loading and try again.',
  },
  'no-status-id': {
    zh: '没有读到这条推文的链接，无法确认它是哪一条。',
    en: 'No permalink was read for this post, so its identity cannot be confirmed.',
  },
  'no-content': {
    zh: '没有读到这条推文的正文或图片。',
    en: 'No text or image was read from this post.',
  },
  'unsupported-media': {
    zh: '这条推文包含现在无法导出的内容，已停止。',
    en: 'This post contains content that cannot be exported yet, so nothing was saved.',
  },
  'read-error': {
    zh: '读取这条推文时出错，请刷新页面后重试。',
    en: 'Reading this post failed. Refresh the page and try again.',
  },
};

export const EXTRACT_WARNINGS: Record<ExtractWarning, Entry> = {
  'avatar-missing': {
    zh: '没有读到作者头像，卡片里用占位图标代替。',
    en: 'The author avatar could not be read; a placeholder is used instead.',
  },
  'quote-unreadable': {
    zh: '引用推文没有读全，卡片里标注为无法读取。',
    en: 'The quoted post could not be read fully; it is marked as unreadable.',
  },
  'media-unknown': {
    zh: '这条推文有图片没有读到，导出会缺少内容，已停止。',
    en: 'Some images in this post could not be read, so the export would be incomplete and was stopped.',
  },
  'text-collapsed': {
    zh: '这条推文的长文没能自动展开，请在页面上点「顯示更多」后重试。',
    en: 'The long text of this post would not expand automatically. Open it on the page, then try again.',
  },
};

export const EXPORT_FAILURES: Record<ExportFailure, Entry> = {
  'media-failed': {
    zh: '有图片没有加载成功，已停止导出。请确认图片加载完成后重试。',
    en: 'Some images did not load, so the export was stopped. Wait for the images and try again.',
  },
  'too-large': {
    zh: '内容太长，连最低倍率也超过浏览器能输出的图片边长上限（16384 px）。',
    en: 'This is taller than the largest image a browser can produce (16384 px per side), even at the lowest scale.',
  },
  'capture-failed': {
    zh: '生成图片失败，请重试。',
    en: 'Generating the image failed. Please try again.',
  },
  'empty-image': {
    zh: '没有生成有效的图片，请重试。',
    en: 'No valid image was produced. Please try again.',
  },
};

export const UI: Record<
  | 'saveImage'
  | 'saving'
  | 'saved'
  | 'degraded'
  | 'busyNotice'
  | 'unreadableQuote'
  | 'videoBadge'
  | 'gifBadge'
  | 'viewsSuffix',
  Entry
> = {
  saveImage: { zh: '存成图片', en: 'Save as image' },
  saving: { zh: '正在生成图片…', en: 'Generating the image…' },
  saved: { zh: '图片已保存。', en: 'The image was saved.' },
  degraded: { zh: '图片已保存，部分内容以降级形式显示。', en: 'Saved, with some content in a fallback form.' },
  busyNotice: { zh: '正在生成上一张，请稍候。', en: 'A previous image is still being generated.' },
  unreadableQuote: { zh: '引用的推文无法读取', en: 'The quoted post could not be read' },
  videoBadge: { zh: '视频', en: 'Video' },
  gifBadge: { zh: 'GIF', en: 'GIF' },
  viewsSuffix: { zh: '次查看', en: 'views' },
};

/** The corner badge on a video or GIF poster; traditional pages say 影片. */
export function mediaBadge(
  kind: 'video' | 'gif',
  language: PageLanguage,
  traditional = false,
): string {
  if (kind === 'gif') return UI.gifBadge[language];
  return language === 'zh' && traditional ? '影片' : UI.videoBadge[language];
}

/** "共 N 条" tail for the source line of a multi-post sheet. */
export function postsSuffix(language: PageLanguage, count: number, traditional = false): string {
  if (language === 'en') return `${count} posts`;
  return `共 ${count} ${traditional ? '條' : '条'}`;
}

/** The "From domain" line under a large link card. */
export function cardFromLabel(language: PageLanguage, traditional = false): string {
  return language === 'en' ? 'From' : traditional ? '來自' : '来自';
}

/** The link X draws inside a quote box in place of the quoted post's poll. */
export function pollRevealLabel(language: PageLanguage, traditional = false): string {
  return language === 'en' ? 'Show this poll' : traditional ? '顯示此投票' : '显示此投票';
}

const POLL_UNITS = {
  day: { zh: '天', zht: '天', en: 'day' },
  hour: { zh: '小时', zht: '小時', en: 'hour' },
  minute: { zh: '分钟', zht: '分鐘', en: 'minute' },
} as const;

/**
 * The grey line under a poll: 「N 票 · 剩余 2 天」/「N votes · 2 days left」.
 *
 * Returns '' when the vote total was never exposed — the line is omitted then,
 * rather than printed with an invented count.
 */
export function pollMeta(poll: Poll, language: PageLanguage, traditional = false): string {
  if (poll.choices.every((choice) => choice.count === null)) return '';
  const total = poll.choices.reduce((sum, choice) => sum + (choice.count ?? 0), 0);
  const grouped = total.toLocaleString('en-US');
  const votes =
    language === 'en' ? `${grouped} ${total === 1 ? 'vote' : 'votes'}` : `${grouped} 票`;
  let tail = '';
  if (poll.final) {
    tail = language === 'en' ? 'Final results' : traditional ? '最終結果' : '最终结果';
  } else if (poll.endsAt) {
    const ms = new Date(poll.endsAt).getTime() - Date.now();
    if (Number.isFinite(ms) && ms > 0) {
      const [amount, unit] =
        ms >= 86_400_000
          ? ([Math.floor(ms / 86_400_000), 'day'] as const)
          : ms >= 3_600_000
            ? ([Math.floor(ms / 3_600_000), 'hour'] as const)
            : ([Math.max(1, Math.floor(ms / 60_000)), 'minute'] as const);
      tail =
        language === 'en'
          ? `${amount} ${POLL_UNITS[unit].en}${amount === 1 ? '' : 's'} left`
          : `${traditional ? '剩下' : '剩余'} ${amount} ${traditional ? POLL_UNITS[unit].zht : POLL_UNITS[unit].zh}`;
    }
  }
  return tail ? `${votes} · ${tail}` : votes;
}

export type UiKey = keyof typeof UI;

const METRIC_LABELS: Record<EngagementKind, Entry> = {
  replies: { zh: '评论', en: 'Replies' },
  reposts: { zh: '转发', en: 'Reposts' },
  likes: { zh: '点赞', en: 'Likes' },
  bookmarks: { zh: '书签', en: 'Bookmarks' },
  views: { zh: '浏览', en: 'Views' },
};

const TRADITIONAL_METRIC_LABELS: Partial<Record<EngagementKind, Entry>> = {
  replies: { zh: '回覆', en: 'Replies' },
  reposts: { zh: '轉發', en: 'Reposts' },
  likes: { zh: '喜歡', en: 'Likes' },
  bookmarks: { zh: '書籤', en: 'Bookmarks' },
  views: { zh: '觀看', en: 'Views' },
};

/** Simplified is the default; the traditional table only overrides its own keys. */
export function metricLabel(
  kind: EngagementKind,
  language: PageLanguage,
  traditional = false,
): string {
  const entry = (traditional ? TRADITIONAL_METRIC_LABELS[kind] : undefined) ??
    METRIC_LABELS[kind];
  return entry[language];
}

/** Say exactly what was produced when the content did not fit at the full scale. */
export function scaledNotice(
  language: PageLanguage,
  scale: number,
  width: number,
  height: number,
): string {
  const factor = `${Math.round(scale * 100) / 100}\u00d7`;
  return language === 'zh'
    ? `内容较长，本次按 ${factor} 输出（${width} × ${height} px），已包含全部内容。`
    : `This is long, so it was produced at ${factor} (${width} \u00d7 ${height} px). Nothing was cut off.`;
}

/** How many posts the chain resolved to, before the capture starts. */
export function progressNotice(language: PageLanguage, count: number): string {
  return language === 'zh'
    ? count > 1
      ? `正在生成主推 + 这条回复，共 ${count} 条…`
      : '正在生成图片…'
    : count > 1
      ? `Generating ${count} posts of this thread…`
      : 'Generating the image…';
}

/** What was saved, including how many posts a chain turned out to have. */
export function savedNotice(language: PageLanguage, count: number): string {
  return language === 'zh'
    ? count > 1
      ? `已保存：主推 + 这条回复，共 ${count} 条。`
      : '图片已保存。'
    : count > 1
      ? `Saved ${count} posts of this thread.`
      : 'The image was saved.';
}

/**
 * Why a chain stops short.
 *
 * The user asked for the whole chain, so a short one must say which link is
 * missing and what would fix it, instead of quietly saving fewer posts.
 */
export function chainNotice(
  language: PageLanguage,
  outcome: 'unknown-parent' | 'missing-article' | 'cycle' | 'too-deep' | 'child-failed',
  count: number,
  id: string | null,
): string {
  const post = id ? `${id}` : '';
  const table: Record<typeof outcome, Entry> = {
    'unknown-parent': {
      zh: `这条推文的父推关系数据还没加载，只保存了 ${count} 条。点这条推文的时间打开详情页后重试，可以得到完整链条。`,
      en: `The parent of this post was not in the loaded data, so only ${count} post(s) were saved. Open the post's detail view and retry for the full thread.`,
    },
    'missing-article': {
      zh: `父推 ${post} 的数据还没加载，只保存了已确认的 ${count} 条。点主推的时间打开详情页后再试。`,
      en: `The data for ancestor ${post} has not loaded, so only the ${count} confirmed post(s) were saved. Open the thread from its first post and retry.`,
    },
    cycle: {
      zh: `读到互相指向的父子关系，为避免错误内容，只保存了已确认的 ${count} 条。`,
      en: `The parent links point in a cycle, so only the ${count} confirmed post(s) were saved.`,
    },
    'too-deep': {
      zh: `链条超过 ${count} 层，只保存到这里。`,
      en: `The thread is deeper than ${count} levels, so it stops here.`,
    },
    'child-failed': {
      zh: `${post} 没有读取成功，已停止保存，避免产出缺内容的图片。`,
      en: `${post} could not be read, so nothing was saved rather than producing an incomplete image.`,
    },
  };
  return table[outcome][language];
}
