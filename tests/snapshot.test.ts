// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import thread from './fixtures/detail-thread.json';
import quoteReply from './fixtures/detail-quote-reply.json';
import nestedQuote from './fixtures/detail-nested-quote.json';
import mediaPage from './fixtures/user-media-page.json';
import { bodyFromEntities, snapshotFromNode } from '../src/x-snapshot';
import { forgetAll, parentOf, recordTweets, snapshotOf } from '../src/x-network';
import { bodyText } from '../src/tweet';
import { mediaBadge } from '../src/messages';
import { ancestorPath } from '../src/chain';
import { formatCount, formatStampCount, renderSheet } from '../src/render';
import { install, scan, uninstall } from '../src/main';
import * as exporter from '../src/export';
import { showsTranslation } from '../src/x-page';
import { attachQuote, buildPost } from './fixtures/build-page';

type Node = Record<string, any>;
function tweets(payload: unknown): Node[] {
  const result: Node[] = [];
  function walk(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const node = value as Node;
    if (node.legacy?.full_text) result.push(node);
    Object.values(node).forEach(walk);
  }
  walk(payload);
  return result;
}
const threadNodes = tweets(thread);
const quoteNodes = tweets(quoteReply);
const nestedNodes = tweets(nestedQuote);
const mediaNodes = tweets(mediaPage);
const snapshot = (node: Node) => snapshotFromNode(node)!;
const options = { language: 'zh' as const, traditional: true };

beforeEach(() => {
  forgetAll();
  document.body.innerHTML = '';
  document.documentElement.lang = 'zh-Hant';
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('captured GraphQL snapshots', () => {
  it.each([
    ['thread', threadNodes, 40], ['quote reply', quoteNodes, 4],
    ['nested quote', nestedNodes, 12], ['media page', mediaNodes, 16],
  ] as const)('parses every complete tweet in %s', (_, nodes, count) => {
    expect(nodes).toHaveLength(count);
    for (const node of nodes) {
      const result = snapshot(node);
      expect(result.data.id).toBe(node.rest_id);
      expect(result.data.author.handle).toMatch(/^@user\d+$/);
      expect(result.data.url).toContain(`/status/${node.rest_id}`);
      expect(result.data.time.absolute).toMatch(/^2026-/);
      expect(result.warnings).not.toContain('media-unknown');
    }
  });

  it('keeps original and translated bodies separate', () => {
    const result = snapshot(threadNodes[0]);
    expect(bodyText(result.data.body)).toContain('Introducing');
    expect(bodyText(result.translatedBody!)).toContain('介紹');
    expect(bodyText(result.data.body)).not.toContain('https://t.co/');
    expect(snapshotFromNode({ tweet: threadNodes[0] })).toEqual(result);
    expect(snapshotFromNode({ __typename: 'TweetTombstone' })).toBeNull();
  });

  it('keeps a pure-text quote, and the captured reply quote', () => {
    const pure = snapshot(nestedNodes[0]).data.quote;
    expect(pure.kind).toBe('readable');
    if (pure.kind !== 'readable') throw new Error('missing quote');
    expect(bodyText(pure.body)).toContain('PR Review');
    expect(pure.images).toEqual([]);
    const quoted = snapshot(quoteNodes.find((node) => node.quoted_status_result)!).data.quote;
    expect(quoted.kind).toBe('readable');
    if (quoted.kind === 'readable') {
      expect(bodyText(quoted.body)).toBe('Let that sink in.');
      expect(quoted.images[0].kind).toBe('photo');
    }
  });

  it('draws the actual second quote with a video thumbnail and stops there', () => {
    const result = snapshot(nestedNodes[0]);
    const quote = result.data.quote;
    if (quote.kind !== 'readable' || quote.nested.kind !== 'readable') throw new Error('missing second quote');
    expect(bodyText(quote.nested.body)).toContain('2,500 PRs');
    expect(quote.nested.id).toBe(nestedNodes[2].rest_id);
    expect(quote.nested.images[0].kind).toBe('video');
    expect(quote.nested.nested.kind).toBe('none');
    const sheet = renderSheet([result.data], options);
    expect(sheet.querySelectorAll('.postnote-quote')).toHaveLength(2);
    expect(sheet.querySelector('.postnote-thumb img')).not.toBeNull();
    expect(sheet.querySelector('.postnote-vbadge')?.textContent).toBe('影片');
  });

  it('supports regular quote wrappers and text-only second quotes', () => {
    const third: Node = { ...threadNodes[1], quoted_status_result: { result: threadNodes[2] } };
    const second = { ...threadNodes[0], quoted_status_result: { result: third } };
    const outer = { ...nestedNodes[0], quoted_status_result: { result: second } };
    const result = snapshot(outer);
    if (result.data.quote.kind !== 'readable' || result.data.quote.nested.kind !== 'readable') throw new Error('missing nested');
    expect(result.data.quote.nested.id).toBe(third.rest_id);
    expect(result.data.quote.nested.nested.kind).toBe('none');
    const textOnly = { ...nestedNodes[0], quoted_status_result: { result: {
      ...nestedNodes[1], nested_quoted_tweet_results: { result: { ...nestedNodes[2], legacy: { ...nestedNodes[2].legacy, extended_entities: { media: [] } } } },
    } } };
    expect(renderSheet([snapshot(textOnly).data], options).querySelector('.postnote-nest')?.classList.contains('is-text-only')).toBe(true);
  });

  it('uses posters for video and GIF, never video streams', () => {
    for (const kind of ['video', 'animated_gif']) {
      const node = threadNodes.find((node) => node.legacy.extended_entities?.media?.[0]?.type === kind)!;
      const result = snapshot(node);
      expect(result.data.images[0].kind).toBe(kind === 'video' ? 'video' : 'gif');
      expect(result.data.images[0].src).toContain('pbs.twimg.com/');
      const sheet = renderSheet([result.data], options);
      expect(sheet.querySelector('video')).toBeNull();
      expect(sheet.querySelector('.postnote-play')).not.toBeNull();
      expect(sheet.querySelector('.postnote-vbadge')?.textContent).toBe(kind === 'video' ? '影片' : 'GIF');
    }
  });

  it('uses full note_tweet text and entities rather than the truncated legacy text', () => {
    const node = threadNodes.find((node) => node.note_tweet)!;
    const text = bodyText(snapshot(node).data.body);
    expect(text.length).toBeGreaterThan(node.legacy.full_text.length);
    expect(text).toContain('Haiku 5.5');
    expect(text).not.toContain('https://t.co/');
  });

  it('retains all three verification colours, affiliate badges, and square avatars', () => {
    const blue = snapshot(threadNodes[0]).data;
    const gold = snapshot(threadNodes.find((node) => node.core.user_results.result.verification.verified_type === 'Business')!).data;
    const gray = snapshot(mediaNodes[0]).data;
    expect([blue.author.verification, gold.author.verification, gray.author.verification]).toEqual(['blue', 'business', 'government']);
    expect(blue.author.badge?.src).toContain('profile_images/img');
    expect(gold.author.avatarShape).toBe('square');
    const sheet = renderSheet([blue, gold, gray], options);
    expect(sheet.querySelectorAll('.postnote-verified')).toHaveLength(4); // includes gold's quote
    expect(sheet.querySelector('.postnote-name .postnote-verified + .postnote-org')).not.toBeNull();
    expect(sheet.querySelector('.postnote-avatar.is-square')).not.toBeNull();
  });

  it('reads the post\'s summary_large_image card and hides its trailing t.co', () => {
    const node = threadNodes.find((n) => n.card?.legacy?.name === 'summary_large_image')!;
    const result = snapshot(node);
    expect(result.data.card).toMatchObject({
      layout: 'large',
      player: false,
      url: 'https://www.anthropic.com/claude-haiku-5-5',
      domain: 'anthropic.com',
      title: 'Introducing Claude Haiku 5.5',
      description:
        'Claude Haiku 5.5 is our fastest, most capable small model. Built for high-volume work like summarization, subagents, and browser use.',
    });
    expect(result.data.card?.image).toEqual({
      src: 'https://pbs.twimg.com/card_img/1000000000000000180/c0eqb9id?format=jpg&name=800x419',
      width: 800,
      height: 419,
    });
    const text = bodyText(result.data.body);
    expect(text).toContain('Read more:');
    expect(text).not.toContain('t.co/');
  });

  it('keeps a card\'s t.co when it sits mid-text, and ignores unified_card', () => {
    const base = threadNodes.find((n) => n.card?.legacy?.name === 'summary_large_image')!;
    const node = structuredClone(base);
    const tco = 'https://t.co/InzZXcEcRP';
    const text = `前置 ${tco} 结尾 ${tco}`;
    node.legacy.full_text = text;
    node.legacy.display_text_range = [0, Array.from(text).length];
    node.legacy.entities.urls = [
      { url: tco, display_url: 'anthropic.com/a', expanded_url: 'https://a.example', indices: [3, 26] },
      { url: tco, display_url: 'anthropic.com/b', expanded_url: 'https://b.example', indices: [30, 53] },
    ];
    const kept = bodyText(snapshot(node).data.body);
    // The mid-text occurrence is body text; only the trailing one hid.
    expect(kept).toContain('anthropic.com/a');
    expect(kept).not.toContain('anthropic.com/b');

    const unified = threadNodes.find((n) => n.card?.legacy?.name === 'unified_card')!;
    const result = snapshot(unified);
    expect(result.data.card).toBeNull();
    expect(result.data.poll).toBeNull();
  });

  it('reads a poll card into choices, final state, and end time', () => {
    const node: Node = {
      ...threadNodes[0],
      card: {
        legacy: {
          name: 'poll4choice_text_only',
          url: 'card://1',
          binding_values: [
            { key: 'choice1_label', value: { type: 'STRING', string_value: '甲' } },
            { key: 'choice1_count', value: { type: 'STRING', string_value: '7' } },
            { key: 'choice2_label', value: { type: 'STRING', string_value: '乙' } },
            { key: 'choice2_count', value: { type: 'STRING', string_value: '3' } },
            { key: 'choice3_label', value: { type: 'STRING', string_value: '丙' } },
            { key: 'counts_are_final', value: { type: 'BOOLEAN', boolean_value: true } },
            { key: 'end_datetime_utc', value: { type: 'STRING', string_value: '2026-06-30T10:00:00Z' } },
            { key: 'selected_choice', value: { type: 'STRING', string_value: '1' } },
          ],
        },
      },
    };
    const result = snapshot(node);
    expect(result.data.card).toBeNull();
    expect(result.data.poll).toMatchObject({
      final: true,
      voted: true,
      endsAt: '2026-06-30T10:00:00.000Z',
    });
    // A count the data never carried stays null — never drawn as a zero.
    expect(result.data.poll?.choices).toEqual([
      { label: '甲', count: 7 },
      { label: '乙', count: 3 },
      { label: '丙', count: null },
    ]);
  });

  it('derives a poll end from last_updated + duration when no end is delivered', () => {
    const node: Node = {
      ...threadNodes[0],
      card: {
        legacy: {
          name: 'poll2choice_text_only',
          binding_values: [
            { key: 'choice1_label', value: { type: 'STRING', string_value: '甲' } },
            { key: 'choice2_label', value: { type: 'STRING', string_value: '乙' } },
            { key: 'last_updated_datetime_utc', value: { type: 'STRING', string_value: '2026-06-29T10:00:00Z' } },
            { key: 'duration_minutes', value: { type: 'STRING', string_value: '1440' } },
          ],
        },
      },
    };
    const poll = snapshot(node).data.poll;
    expect(poll).toMatchObject({ final: false, voted: false, endsAt: '2026-06-30T10:00:00.000Z' });
  });

  it('flags a poll on the quoted post itself and on the nested quote', () => {
    const pollNode: Node = {
      ...nestedNodes[2],
      card: { legacy: { name: 'poll2choice_text_only', binding_values: [] } },
    };
    const direct = snapshot({
      ...nestedNodes[0],
      quoted_status_result: { result: pollNode },
    });
    expect(direct.data.quote).toMatchObject({ kind: 'readable', poll: true });

    const wrapped = snapshot({
      ...nestedNodes[0],
      quoted_status_result: {
        result: { ...nestedNodes[1], nested_quoted_tweet_results: { result: pollNode } },
      },
    });
    const quote = wrapped.data.quote;
    if (quote.kind !== 'readable') throw new Error('expected readable quote');
    expect(quote.poll).toBe(false);
    expect(quote.nested).toMatchObject({ kind: 'readable', poll: true });
  });

  it('does not silently drop unreadable quote media or a tombstone second quote', () => {
    const bad = { ...nestedNodes[2], legacy: { ...nestedNodes[2].legacy, extended_entities: { media: [{ type: 'photo', media_url_https: 'https://evil.example/a.jpg' }] } } };
    const result = snapshot({ ...nestedNodes[0], quoted_status_result: { result: bad } });
    expect(result.warnings).toContain('media-unknown');
    const unavailable = snapshot({ ...nestedNodes[0], quoted_status_result: { result: { ...nestedNodes[1], nested_quoted_tweet_results: { result: { __typename: 'TweetTombstone' } } } } });
    expect(unavailable.data.quote.kind === 'readable' && unavailable.data.quote.nested.kind).toBe('unreadable');
  });
});

describe('entities, counts and in-memory store', () => {
  it('uses code-point offsets after Emoji and keeps ZWJ Emoji intact', () => {
    const body = bodyFromEntities('👩‍💻 @alice https://t.co/a #tag', {
      user_mentions: [{ screen_name: 'alice', indices: [4, 10] }],
      urls: [{ indices: [11, 25], expanded_url: 'https://example.com/', display_url: 'example.com' }],
      hashtags: [{ text: 'tag', indices: [26, 30] }],
    });
    expect(bodyText(body)).toBe('👩‍💻 @alice example.com #tag');
    expect(body[0]).toMatchObject({ kind: 'emoji', unicode: '👩‍💻' });
    expect(body.find((part) => part.kind === 'mention')).toMatchObject({ text: '@alice', handle: '@alice' });
    expect(bodyFromEntities('bad', { urls: [{ indices: [0, 3], expanded_url: 'javascript:alert(1)' }] })).toEqual([{ kind: 'text', text: 'bad' }]);
  });

  it.each([
    ['1495', 'zh', false, '1,495'], ['43999', 'zh', true, '4.3萬'],
    ['43999', 'zh', false, '4.3万'], ['199999', 'zh', true, '19萬'],
    ['1495', 'en', false, '1.4K'], ['1999999', 'en', false, '1.9M'],
    ['1234567890', 'en', false, '1.2B'], ['999', 'en', false, '999'],
  ] as const)('formats %s in %s', (raw, lang, traditional, display) => {
    expect(formatCount(raw, lang, traditional)).toBe(display);
  });

  it.each([
    ['198992', 'zh', true, '19.8萬'], ['5880284', 'zh', true, '588萬'],
    ['30798306', 'zh', true, '3,079.8萬'], ['177146934', 'zh', true, '1.7億'],
    ['177146934', 'zh', false, '1.7亿'], ['30798306', 'zh', false, '3,079.8万'],
    ['198992', 'zh', false, '19.8万'], ['100000', 'zh', false, '10万'],
    ['43865', 'zh', false, '4.3万'], ['9876', 'zh', false, '9,876'],
    ['592', 'zh', false, '592'], ['30798304', 'zh', true, '3,079.8萬'],
    ['209063', 'zh', true, '20.9萬'], ['387337', 'zh', true, '38.7萬'],
    ['198992', 'en', false, '198K'], ['5880284', 'en', false, '5.88M'],
    ['1500000000', 'en', false, '1.5B'], ['9876', 'en', false, '9,876'],
  ] as const)('formats %s in the time row for %s', (raw, lang, traditional, display) => {
    expect(formatStampCount(raw, lang, traditional)).toBe(display);
  });

  it('drops the media t.co link even when the display range covers it', () => {
    const mediaOnly = structuredClone(threadNodes[0]);
    const link = 'https://t.co/AAAAAAAAAA';
    const media = [{ url: link, indices: [0, 23], type: 'video', source_status_id_str: '1' }];
    delete mediaOnly.note_tweet;
    mediaOnly.legacy.full_text = link;
    mediaOnly.legacy.display_text_range = [0, 23];
    mediaOnly.legacy.entities = { ...mediaOnly.legacy.entities, urls: [], user_mentions: [], hashtags: [], media };
    const empty = snapshot(mediaOnly).data;
    expect(empty.body).toEqual([]);
    const card = renderSheet([empty], options);
    expect(card.querySelector('.postnote-text')).toBeNull();
    expect(card.textContent).not.toContain('t.co');

    const withText = structuredClone(mediaOnly);
    withText.legacy.full_text = `看这个 👀
${link}`;
    withText.legacy.display_text_range = [0, 29];
    withText.legacy.entities.media = [{ ...media[0], indices: [6, 29] }];
    expect(bodyText(snapshot(withText).data.body)).toBe('看这个 👀');

    // Only extended_entities carries the media: still dropped.
    const extendedOnly = structuredClone(mediaOnly);
    extendedOnly.legacy.entities.media = [];
    extendedOnly.legacy.extended_entities = { media: media.map((m) => ({ ...m, media_url_https: 'https://pbs.twimg.com/media/x.jpg' })) };
    expect(snapshot(extendedOnly).data.body).toEqual([]);
  });

  it('drops the media t.co link inside a quote', () => {
    const withQuote = structuredClone(nestedNodes.find((n) => snapshot(n).data.quote.kind === 'readable')!);
    const quoted = withQuote.quoted_status_result.result.tweet ?? withQuote.quoted_status_result.result;
    delete quoted.note_tweet;
    quoted.legacy.full_text = 'https://t.co/BBBBBBBBBB';
    quoted.legacy.display_text_range = [0, 23];
    quoted.legacy.entities = { urls: [], user_mentions: [], hashtags: [], media: [{ url: 'https://t.co/BBBBBBBBBB', indices: [0, 23] }] };
    const quote = snapshot(withQuote).data.quote as { body: unknown[] };
    expect(quote.body).toEqual([]);
    expect(renderSheet([snapshot(withQuote).data], options).querySelector('.postnote-quote:not(.is-nested) > .postnote-qtext')).toBeNull();
  });

  it('counts quotes in the repost total, as the repost button does', () => {
    for (const node of [...threadNodes, ...nestedNodes]) {
      const { retweet_count: retweets, quote_count: quotes } = node.legacy;
      expect(snapshot(node).data.metrics.reposts).toBe(String(retweets + (quotes ?? 0)));
    }
    const node = structuredClone(threadNodes[0]);
    node.legacy.retweet_count = 90;
    node.legacy.quote_count = 11;
    expect(snapshot(node).data.metrics.reposts).toBe('101');
    delete node.legacy.quote_count;
    expect(snapshot(node).data.metrics.reposts).toBe('90');
  });

  it('asks for the 400x400 avatar and keeps the delivered one as a fallback', () => {
    const node = structuredClone(threadNodes[0]);
    node.core.user_results.result.avatar.image_url = 'https://pbs.twimg.com/profile_images/1/a_normal.jpg';
    const { author } = snapshot(node).data;
    expect(author.avatarUrl).toBe('https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
    expect(author.avatarFallbackUrl).toBe('https://pbs.twimg.com/profile_images/1/a_normal.jpg');
    const image = renderSheet([snapshot(node).data], options).querySelector<HTMLImageElement>('.postnote-avatar')!;
    expect(image.dataset.postnoteFallback).toBe(author.avatarFallbackUrl);
    // The quote box's small avatar takes the same rendition.
    const withQuote = structuredClone(nestedNodes.find((n) => snapshot(n).data.quote)!);
    const quotedNode = withQuote.quoted_status_result.result.tweet ?? withQuote.quoted_status_result.result;
    quotedNode.core.user_results.result.avatar.image_url = 'https://pbs.twimg.com/profile_images/2/b_normal.png';
    const quote = snapshot(withQuote).data.quote as { author: { avatarUrl: string | null } };
    expect(quote.author.avatarUrl).toBe('https://pbs.twimg.com/profile_images/2/b_400x400.png');
  });

  it('labels a video poster 影片 on a traditional page and leaves GIF alone', () => {
    expect(mediaBadge('video', 'zh', true)).toBe('影片');
    expect(mediaBadge('video', 'zh', false)).toBe('视频');
    expect(mediaBadge('video', 'en', false)).toBe('Video');
    expect(mediaBadge('gif', 'zh', true)).toBe('GIF');
    const video = mediaNodes.map((node) => snapshot(node).data).find((d) => d.images.some((m) => m.kind === 'video'));
    if (video) {
      const badge = renderSheet([video], options).querySelector('.postnote-vbadge');
      expect(badge?.textContent).toBe('影片');
    }
  });

  it('writes the footer count without a leading space, in traditional script when asked', () => {
    const posts = threadNodes.slice(0, 3).map((node) => snapshot(node).data);
    const traditional = renderSheet(posts, options).querySelector('.postnote-src-count');
    expect(traditional?.textContent).toBe('· 共 3 條');
    const simplified = renderSheet(posts, { ...options, traditional: false }).querySelector('.postnote-src-count');
    expect(simplified?.textContent).toBe('· 共 3 条');
  });

  it('keeps the eight-post chain complete when all ancestors have left the DOM', () => {
    recordTweets(JSON.stringify(thread));
    const chain = ancestorPath(threadNodes[7].rest_id, parentOf);
    expect(chain.complete).toBe(true);
    expect(chain.ids).toEqual(threadNodes.slice(0, 8).map((node) => node.rest_id));
    expect(document.querySelector('article')).toBeNull();
    expect(chain.ids.every((id) => snapshotOf(id))).toBe(true);
  });

  it('evicts the least recently used id and its parent together at 5000 entries', () => {
    const node = (id: string) => ({ rest_id: id, legacy: { full_text: id } });
    for (let i = 1; i <= 5000; i++) recordTweets(JSON.stringify(node(String(i))));
    snapshotOf('1');
    recordTweets(JSON.stringify(node('5001')));
    expect(snapshotOf('1')).toBeDefined();
    expect(parentOf('1')).toBeNull();
    expect(snapshotOf('2')).toBeUndefined();
    expect(parentOf('2')).toBeUndefined();
    parentOf('3');
    recordTweets(JSON.stringify(node('5002')));
    expect(snapshotOf('3')).toBeDefined();
    expect(snapshotOf('4')).toBeUndefined();
    forgetAll();
    expect(snapshotOf('1')).toBeUndefined();
  });
});

describe('snapshot-backed export decisions', () => {
  async function exportPost(article: HTMLElement): Promise<HTMLElement> {
    let sheet: HTMLElement | undefined;
    vi.spyOn(exporter, 'prepareCard').mockResolvedValue({ degraded: [], blocking: [], fontTimedOut: false });
    vi.spyOn(exporter, 'planCapture').mockReturnValue({ width: 1300, height: 1600, scale: 2, limited: false, pixels: 2080000 });
    vi.spyOn(exporter, 'capturePng').mockImplementation(async (element) => { sheet = element; return new Blob(); });
    vi.spyOn(exporter, 'downloadBlob').mockImplementation(() => {});
    document.body.append(article);
    install(); scan();
    article.querySelector<HTMLButtonElement>('.postnote-entry')!.click();
    await vi.waitFor(() => expect(sheet).toBeDefined());
    await vi.waitFor(() => expect(article.querySelector<HTMLButtonElement>('.postnote-entry')!.disabled).toBe(false));
    return sheet!;
  }

  it.each([true, false])('exports the clicked post translation only when displayed (%s)', async (translated) => {
    const node = threadNodes[0];
    recordTweets(JSON.stringify(node));
    const article = buildPost({ id: node.rest_id, handle: 'user1', text: 'DOM fallback must not win' });
    if (translated) article.append(Object.assign(document.createElement('button'), { textContent: '顯示原文' }));
    const sheet = await exportPost(article);
    const body = sheet.querySelector('.postnote-text')!;
    const plain = body.cloneNode(true) as HTMLElement;
    plain.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    expect(plain.textContent).toBe(bodyText(translated ? snapshot(node).translatedBody! : snapshot(node).data.body));
    expect(body.querySelectorAll('br')).toHaveLength(2);
  });

  it('exports all eight snapshots with no ancestor articles present', async () => {
    recordTweets(JSON.stringify(thread));
    const node = threadNodes[7];
    const article = buildPost({ id: node.rest_id, handle: 'user1', text: 'DOM tail' });
    article.append(Object.assign(document.createElement('button'), { textContent: '顯示原文' }));
    const sheet = await exportPost(article);
    expect(sheet.querySelectorAll('.postnote-post')).toHaveLength(8);
    expect(sheet.querySelector('.postnote-text')?.textContent).toContain('介紹');
    expect(sheet.querySelector('.postnote-src')?.textContent).toContain('8');
  });

  it('respects an ancestor shown as original even when the clicked reply is translated', async () => {
    recordTweets(JSON.stringify(threadNodes.slice(0, 2)));
    document.body.append(buildPost({ id: threadNodes[0].rest_id, handle: 'user1', text: 'root' }));
    const article = buildPost({ id: threadNodes[1].rest_id, handle: 'user1', text: 'reply' });
    article.append(Object.assign(document.createElement('button'), { textContent: '顯示原文' }));
    const sheet = await exportPost(article);
    expect(sheet.querySelectorAll('.postnote-text')[0].textContent).toContain('Introducing');
    expect(sheet.querySelectorAll('.postnote-text')[1].textContent).toBe(bodyText(snapshot(threadNodes[1]).translatedBody!));
  });

  it('uses visible translated text when the cached response did not carry a translation', async () => {
    const node: Node = { ...threadNodes[0], grok_translated_post_with_availability: { is_available: false } };
    recordTweets(JSON.stringify(node));
    const article = buildPost({ id: node.rest_id, handle: 'user1', text: '這是頁面譯文' });
    article.append(Object.assign(document.createElement('button'), { textContent: '顯示原文' }));
    const sheet = await exportPost(article);
    expect(sheet.querySelector('.postnote-text')?.textContent).toBe('這是頁面譯文');
    expect(sheet.querySelector('.postnote-vbadge')).not.toBeNull();
  });

  it('does not mistake a quote translation control for the main post', () => {
    const article = buildPost({ id: '1', text: 'original' });
    attachQuote(article, { text: 'quote' }).append(Object.assign(document.createElement('button'), { textContent: 'Show original' }));
    expect(showsTranslation(article)).toBe(false);
  });

  it('keeps a crowded entry next to the caret across scans and returns it when room grows', () => {
    const article = buildPost({ id: '1', text: 'narrow' });
    const header = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.append(Object.assign(document.createElement('button'), { textContent: '⋯' }));
    anchor.firstElementChild!.setAttribute('data-testid', 'caret');
    header.append(anchor); article.prepend(header); document.body.append(article);
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    // The bar is 254px like the photo view's side column; while crowded each
    // item wants ~90px so the row cannot hold our entry. Room returns below.
    let crowded = true;
    Object.defineProperty(group, 'clientWidth', { configurable: true, get: () => 254 });
    Array.from(group.children).forEach((child) => {
      Object.defineProperty(child, 'scrollWidth', {
        configurable: true,
        get: () => (crowded ? 90 : 45),
      });
    });
    scan(); scan(); scan();
    expect(header.querySelector('.postnote-entry-slot')?.nextElementSibling).toBe(anchor);
    crowded = false; scan();
    expect(group.querySelector('.postnote-entry')).not.toBeNull();
  });
});

