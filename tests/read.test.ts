// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { bodyText, hasVisibleBody } from '../src/tweet';
import { getHighResImageUrl } from '../src/x-content';
import { readTweet } from '../src/x-page';
import { attachQuote, buildPost } from './fixtures/build-page';

beforeEach(() => {
  document.body.innerHTML = '';
});

function read(article: HTMLElement) {
  document.body.appendChild(article);
  const extract = readTweet(article);
  if (!extract.ok) throw new Error(`expected a successful read, got ${extract.failure}`);
  return extract;
}

describe('reading a post', () => {
  it('reads identity, body, media and time without carrying DOM nodes', () => {
    const post = read(
      buildPost({
        id: '100',
        handle: 'alice',
        name: 'Alice',
        text: '你好 world',
        media: ['https://pbs.twimg.com/media/abc?format=jpg&name=small'],
        datetime: '2026-01-02T03:04:05.000Z',
        timeText: 'Jan 2',
      }),
    );

    expect(post.data.id).toBe('100');
    expect(post.data.url).toBe('https://x.com/alice/status/100');
    expect(post.data.author).toEqual({
      name: 'Alice',
      handle: '@alice',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/a.jpg',
    });
    expect(bodyText(post.data.body)).toBe('你好 world');
    expect(post.data.images).toEqual([
      { kind: 'photo', src: 'https://pbs.twimg.com/media/abc?format=jpg&name=orig', alt: '' },
    ]);
    expect(post.data.time).toEqual({
      absolute: '2026-01-02T03:04:05.000Z',
      visible: 'Jan 2',
    });
    expect(JSON.parse(JSON.stringify(post.data))).toEqual(post.data);
  });

  it.each([['1234'], ['。'], ['😀'], ['a']])(
    'keeps a short but real body: %s',
    (text) => {
      const post = read(buildPost({ id: '7', text }));
      expect(hasVisibleBody(post.data.body)).toBe(true);
      expect(bodyText(post.data.body)).toBe(text);
    },
  );

  it('keeps mentions, hashtags, links and line breaks in order', () => {
    const post = read(
      buildPost({
        id: '8',
        text:
          '第一行<br>第二行 <a href="https://x.com/bob">@bob</a> ' +
          '<a href="https://x.com/hashtag/测试">#测试</a> ' +
          '<a href="https://t.co/abc">example.com</a>',
      }),
    );

    expect(post.data.body.map((segment) => segment.kind)).toEqual([
      'text',
      'break',
      'text',
      'mention',
      'text',
      'hashtag',
      'text',
      'link',
    ]);
    expect(post.data.body.at(-1)).toEqual({
      kind: 'link',
      text: 'example.com',
      href: 'https://t.co/abc',
    });
  });

  it('keeps the text of a link but drops its unusable target', () => {
    const post = read(
      buildPost({ id: '9', text: '<a href="javascript:alert(1)">点我</a>' }),
    );
    expect(post.data.body).toEqual([{ kind: 'text', text: '点我' }]);
  });

  it('keeps emoji as Unicode plus its image source', () => {
    const post = read(
      buildPost({
        id: '10',
        text: 'hi <img src="https://abs.twimg.com/emoji/v2/svg/1f600.svg" alt="😀">',
      }),
    );
    expect(post.data.body.at(-1)).toEqual({
      kind: 'emoji',
      unicode: '😀',
      src: 'https://abs.twimg.com/emoji/v2/svg/1f600.svg',
    });
  });

  it('does not let a quoted post become the current post', () => {
    const article = buildPost({
      id: '100',
      handle: 'alice',
      text: '我的正文',
      media: ['https://pbs.twimg.com/media/own?format=jpg'],
    });
    attachQuote(article, {
      id: '99',
      handle: 'bob',
      name: 'Bob',
      text: '被引用内容',
      media: ['https://pbs.twimg.com/media/quoted?format=jpg'],
    });
    const post = read(article);

    expect(post.data.id).toBe('100');
    expect(bodyText(post.data.body)).toBe('我的正文');
    expect(post.data.author.handle).toBe('@alice');
    expect(post.data.images).toEqual([
      { kind: 'photo', src: 'https://pbs.twimg.com/media/own?format=jpg&name=orig', alt: '' },
    ]);
    expect(post.data.quote).toEqual({
      kind: 'readable',
      id: '99',
      url: 'https://x.com/bob/status/99',
      author: {
        name: 'Bob',
        handle: '@bob',
        avatarUrl: 'https://pbs.twimg.com/profile_images/bob/a.jpg',
      },
      time: { absolute: null, visible: 'Jan 1' },
      body: [{ kind: 'text', text: '被引用内容' }],
      images: [
        { kind: 'photo', src: 'https://pbs.twimg.com/media/quoted?format=jpg&name=orig', alt: '' },
      ],
      poll: false,
      nested: { kind: 'none' },
    });
  });

  it('reads only the counts the page showed', () => {
    const post = read(
      buildPost({ id: '11', text: '统计', actions: ['3 replies', '12 reposts', '40 likes'] }),
    );
    expect(post.data.metrics).toEqual({ replies: '3', reposts: '12', likes: '40' });
    expect(post.data.metrics).not.toHaveProperty('views');
  });

  it('reads a video post from the poster the page shows', () => {
    const post = read(buildPost({ id: '12', text: '带视频', video: true }));
    expect(post.data.images).toEqual([
      { kind: 'video', src: 'https://pbs.twimg.com/media/vid.jpg?name=orig', alt: '' },
    ]);
  });

  it('reports a video whose poster it could not read', () => {
    const post = read(buildPost({ id: '12', text: '带视频', video: true, videoPoster: null }));
    expect(post.warnings).toContain('media-unknown');
  });

  it('reads a voting poll the way the page shows it', () => {
    const post = read(buildPost({ id: '12', text: '带投票', poll: 'options' }));
    expect(post.data.poll).toMatchObject({
      final: false,
      display: 'options',
      meta: '9 票 · 剩下 2 天',
    });
    expect(post.data.poll?.choices).toEqual([
      { label: '选项甲', count: null },
      { label: '选项乙', count: null },
    ]);
  });

  it('reads poll results with the page\'s percentages and leaders', () => {
    const post = read(buildPost({ id: '12', text: '带投票', poll: 'results' }));
    expect(post.data.poll?.display).toBe('results');
    expect(post.data.poll?.meta).toBe('11 票 · 最終結果');
    expect(post.data.poll?.choices).toEqual([
      { label: '选项甲', count: null, pct: '45.5%', win: true },
      { label: '选项乙', count: null, pct: '9.1%', win: false },
      { label: '选项丙', count: null, pct: '45.5%', win: true },
    ]);
  });

  it('reads the post\'s own large link card and leaves a quote\'s poll alone', () => {
    const article = buildPost({
      id: '15',
      text: '正文',
      linkCard: { layout: 'large', title: 'Hatoba 的 README', domain: 'github.com' },
    });
    const quote = attachQuote(article, { text: '引用' });
    quote.insertAdjacentHTML(
      'beforeend',
      '<div data-testid="cardPoll"><div role="radiogroup">' +
        '<div role="radio"><span>內部選項</span></div></div>' +
        '<div><span>3 票</span><span> · </span><span>剩下 1 天</span></div></div>',
    );
    const post = read(article);
    expect(post.data.card).toMatchObject({
      layout: 'large',
      player: false,
      title: 'Hatoba 的 README',
      domain: 'github.com',
    });
    expect(post.data.card?.image?.src).toContain('pbs.twimg.com/card_img/');
    // The quote's poll belongs to the quote: marked on it, never on the post.
    expect(post.data.poll).toBeNull();
    expect(post.data.quote).toMatchObject({ kind: 'readable', poll: true });
  });

  it('marks a quote whose post carries a poll, either marker the page shows', () => {
    const article = buildPost({ id: '20', text: '外层' });
    const quote = attachQuote(article, { text: '引用正文' });
    quote.insertAdjacentHTML('beforeend', '<a href="#"><span>顯示此投票</span></a>');
    const post = read(article);
    expect(post.data.quote).toMatchObject({ kind: 'readable', poll: true });

    const article2 = buildPost({ id: '21', text: '外层' });
    attachQuote(article2, { text: '普通引用' });
    expect(read(article2).data.quote).toMatchObject({ kind: 'readable', poll: false });
  });

  it('marks the nested quote\'s poll as its own, not the outer one\'s', () => {
    const article = buildPost({ id: '22', text: '外层' });
    const quote = attachQuote(article, { text: '一层引用' });
    const inner = document.createElement('div');
    inner.setAttribute('role', 'link');
    inner.tabIndex = 0;
    inner.innerHTML =
      '<div data-testid="User-Name"><div><a href="https://x.com/carol"><span>Carol</span></a></div></div>' +
      '<div data-testid="tweetText"><span>二层引用</span></div>' +
      '<div><span>顯示此投票</span></div>' +
      '<a href="/carol/status/77"></a>';
    quote.appendChild(inner);
    const post = read(article);
    const outer = post.data.quote;
    if (outer.kind !== 'readable') throw new Error('expected readable quote');
    expect(outer.poll).toBe(false);
    expect(outer.nested).toMatchObject({ kind: 'readable', poll: true });
  });

  it('reads a player card as a small card with a play badge', () => {
    const post = read(
      buildPost({
        id: '16',
        linkCard: { layout: 'small', title: 'YouTube', domain: 'youtube.com', player: true },
      }),
    );
    expect(post.data.card).toMatchObject({ layout: 'small', player: true, domain: 'youtube.com' });
    expect(post.data.body).toEqual([]);
  });

  it('keeps the link visible when the card itself could not be read', () => {
    const post = read(
      buildPost({
        id: '17',
        text: 'Hatoba',
        linkCard: {
          layout: 'small',
          title: '',
          description: '',
          domain: 'x.com',
          href: 'https://t.co/card',
        },
      }),
    );
    expect(post.data.card).toBeNull();
    expect(post.data.body.at(-1)).toEqual({
      kind: 'link',
      text: 'x.com',
      href: 'https://t.co/card',
    });
  });

  it('refuses a post without a permalink', () => {
    document.body.appendChild(buildPost({ text: '没有链接' }));
    expect(readTweet(document.body.firstElementChild as HTMLElement)).toEqual({
      ok: false,
      failure: 'no-status-id',
    });
  });

  it('reports a photo it could not read', () => {
    const article = buildPost({ id: '13', text: '有图' });
    const photo = document.createElement('div');
    photo.dataset.testid = 'tweetPhoto';
    article.appendChild(photo);
    const post = read(article);
    expect(post.warnings).toContain('media-unknown');
  });

  it('reports text the page is still hiding, whatever the UI language', () => {
    const post = buildPost({
      id: '100',
      text: '可见的一半',
      showMore: '被折起来的一半',
    });
    document.body.appendChild(post);
    const extract = readTweet(post);
    if (!extract.ok) throw new Error('expected a successful read');
    expect(extract.warnings).toContain('text-collapsed');
  });

  it('reports a missing avatar instead of inventing one', () => {
    const post = read(buildPost({ id: '14', text: '无头像', avatar: null }));
    expect(post.data.author.avatarUrl).toBeNull();
    expect(post.warnings).toContain('avatar-missing');
  });
});

describe('image urls', () => {
  it('upgrades only media origins and rejects other schemes', () => {
    expect(getHighResImageUrl('https://pbs.twimg.com/media/a?format=png&name=small')).toBe(
      'https://pbs.twimg.com/media/a?format=png&name=orig',
    );
    expect(getHighResImageUrl('https://pbs.twimg.com/profile_images/1/a_normal.jpg')).toBe(
      'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
    );
    expect(getHighResImageUrl('javascript:alert(1)')).toBe('');
    expect(getHighResImageUrl('')).toBe('');
  });
});
