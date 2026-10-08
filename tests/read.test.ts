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

  it('still refuses a poll instead of exporting around it', () => {
    document.body.appendChild(buildPost({ id: '12', text: '带投票', poll: true }));
    expect(readTweet(document.body.firstElementChild as HTMLElement)).toEqual({
      ok: false,
      failure: 'unsupported-poll',
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
