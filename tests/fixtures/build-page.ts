/**
 * Synthetic post markup for tests.
 *
 * Modeled on the structure the audited 1.9.x project relied on, so the reader
 * has something to fail against. These are NOT sanitized real-page samples:
 * those are captured separately under their own names during P0, and neither
 * replaces the other.
 */

export type PostFixture = {
  id?: string;
  handle?: string;
  name?: string;
  text?: string;
  media?: string[];
  actions?: string[];
  avatar?: string | null;
  datetime?: string;
  timeText?: string;
  video?: boolean;
  /** The poster URL a video player exposes; defaults to a real-looking one. */
  videoPoster?: string | null;
  /**
   * A poll card the way X renders it: 'options' while it still votes (a
   * radiogroup), 'results' once it shows bars. `true` means 'options'.
   */
  poll?: boolean | 'options' | 'results';
  /** A link preview card under the body, as X's card.wrapper draws it. */
  linkCard?: LinkCardFixture;
  /** Text X hides behind its own "show more" until that control is clicked. */
  showMore?: string;
  /** A control that takes itself away without ever showing the rest. */
  showMoreStuck?: boolean;
};

export type LinkCardFixture = {
  layout?: 'large' | 'small';
  title?: string;
  domain?: string;
  description?: string;
  /** Thumbnail src; `null` draws the card without an image. */
  image?: string | null;
  /** A play badge over the thumbnail, like a player card's. */
  player?: boolean;
  /** The address the card's anchor carries. */
  href?: string;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildUserName(options: PostFixture): HTMLElement {
  const handle = options.handle ?? 'alice';
  const userName = el('div');
  userName.dataset.testid = 'User-Name';

  const nameLink = el('a');
  nameLink.href = `https://x.com/${handle}`;
  const nameBox = el('div');
  nameBox.appendChild(el('span', options.name ?? 'Alice'));
  nameLink.appendChild(nameBox);
  userName.appendChild(nameLink);

  const handleLink = el('a');
  handleLink.href = `https://x.com/${handle}`;
  handleLink.appendChild(el('span', `@${handle}`));
  userName.appendChild(handleLink);
  userName.appendChild(el('span', '·'));

  if (options.id) {
    const timeLink = el('a');
    timeLink.href = `https://x.com/${handle}/status/${options.id}`;
    const time = el('time', options.timeText ?? 'Jan 1');
    if (options.datetime) time.setAttribute('datetime', options.datetime);
    timeLink.appendChild(time);
    userName.appendChild(timeLink);
  }
  return userName;
}

/** Build one post; `article` is what `readTweet` receives. */
export function buildPost(options: PostFixture = {}): HTMLElement {
  const article = el('article');
  article.dataset.testid = 'tweet';

  const avatarBox = el('div');
  avatarBox.dataset.testid = 'Tweet-User-Avatar';
  const avatarSource = options.avatar === undefined ? 'https://pbs.twimg.com/profile_images/1/a.jpg' : options.avatar;
  if (avatarSource) {
    const avatar = el('img');
    avatar.src = avatarSource;
    avatarBox.appendChild(avatar);
  }
  article.appendChild(avatarBox);

  article.appendChild(buildUserName(options));

  if (options.text !== undefined) {
    const text = el('div');
    text.dataset.testid = 'tweetText';
    text.setAttribute('lang', 'zh');
    text.innerHTML = options.text;
    article.appendChild(text);

    if (options.showMore !== undefined || options.showMoreStuck) {
      const controller = el('div');
      const more = el('button', '顯示更多');
      more.dataset.testid = 'tweet-text-show-more-link';
      more.setAttribute('role', 'button');
      // As on the page: clicking swaps the cut text for the whole text, but the
      // swap lands on a later task — a read that does not wait sees the cut text.
      more.addEventListener('click', () => {
        window.setTimeout(() => {
          if (!options.showMoreStuck) text.innerHTML += options.showMore ?? '';
          controller.remove();
        }, 0);
      });
      controller.appendChild(more);
      article.appendChild(controller);
    }
  }

  for (const src of options.media ?? []) {
    const photo = el('div');
    photo.dataset.testid = 'tweetPhoto';
    const image = el('img');
    image.src = src;
    photo.appendChild(image);
    article.appendChild(photo);
  }

  if (options.video) {
    const container = el('div');
    container.dataset.testid = 'videoPlayer';
    const video = document.createElement('video');
    const poster =
      options.videoPoster === undefined
        ? 'https://pbs.twimg.com/media/vid.jpg'
        : options.videoPoster;
    if (poster) video.setAttribute('poster', poster);
    container.appendChild(video);
    article.appendChild(container);
  }

  if (options.poll) {
    const poll = el('div');
    poll.dataset.testid = 'cardPoll';
    const mode = options.poll === true ? 'options' : options.poll;
    if (mode === 'options') {
      const group = el('div');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', '投票選項');
      ['选项甲', '选项乙'].forEach((label) => {
        const radio = el('div');
        radio.setAttribute('role', 'radio');
        radio.appendChild(el('span', label));
        group.appendChild(radio);
      });
      poll.appendChild(group);
    } else {
      // Result rows: the leaders are the rows the page bolds.
      const rows: [string, string, boolean][] = [
        ['选项甲', '45.5%', true],
        ['选项乙', '9.1%', false],
        ['选项丙', '45.5%', true],
      ];
      for (const [label, pct, win] of rows) {
        const row = el('div');
        const labelSpan = el('span', label);
        const pctSpan = el('span', pct);
        if (win) {
          labelSpan.style.fontWeight = '700';
          pctSpan.style.fontWeight = '700';
        }
        row.append(labelSpan, pctSpan);
        poll.appendChild(row);
      }
    }
    const meta = el('div');
    meta.appendChild(el('span', mode === 'options' ? '9 票' : '11 票'));
    meta.appendChild(el('span', '·'));
    meta.appendChild(el('span', mode === 'options' ? '剩下 2 天' : '最終結果'));
    poll.appendChild(meta);
    article.appendChild(poll);
  }

  if (options.linkCard) {
    const spec = options.linkCard;
    const wrapper = el('div');
    wrapper.dataset.testid = 'card.wrapper';
    const anchor = el('a');
    anchor.href = spec.href ?? 'https://t.co/card';
    if ((spec.layout ?? 'small') === 'large') {
      const media = el('div');
      media.dataset.testid = 'card.layoutLarge.media';
      if (spec.image !== null) {
        const image = el('img');
        image.src = spec.image ?? 'https://pbs.twimg.com/card_img/1/a?format=jpg&name=800x419';
        media.appendChild(image);
      }
      media.appendChild(el('div', spec.title ?? 'Card title'));
      anchor.appendChild(media);
      const from = el('div');
      from.appendChild(el('span', `來自 ${spec.domain ?? 'example.com'}`));
      anchor.appendChild(from);
    } else {
      const media = el('div');
      media.dataset.testid = 'card.layoutSmall.media';
      if (spec.image !== null) {
        const image = el('img');
        image.src = spec.image ?? 'https://pbs.twimg.com/card_img/1/a?format=jpg&name=280x150';
        media.appendChild(image);
      }
      if (spec.player) media.appendChild(el('div'));
      anchor.appendChild(media);
      const detail = el('div');
      detail.dataset.testid = 'card.layoutSmall.detail';
      [
        spec.domain ?? 'example.com',
        spec.title ?? 'Card title',
        spec.description ?? 'The summary under the title',
      ].forEach((text) => detail.appendChild(el('div', text)));
      anchor.appendChild(detail);
    }
    wrapper.appendChild(anchor);
    article.appendChild(wrapper);
  }

  const group = el('div');
  group.setAttribute('role', 'group');
  (options.actions ?? ['3 replies', '12 reposts', '40 likes']).forEach((label) => {
    const button = el('button');
    button.setAttribute('aria-label', label);
    // As on the page: each action is an icon inside the button.
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    button.appendChild(icon);
    group.appendChild(button);
  });
  article.appendChild(group);

  return article;
}

/** Attach a quoted post inside `article`, as X nests one. */
export function attachQuote(article: HTMLElement, options: PostFixture = {}): HTMLElement {
  const wrapper = el('div');
  wrapper.setAttribute('role', 'link');
  wrapper.setAttribute('tabindex', '0');

  const handle = options.handle ?? 'bob';
  const avatarBox = el('div');
  avatarBox.dataset.testid = 'Tweet-User-Avatar';
  if (options.avatar !== null) {
    const avatar = el('img');
    avatar.src = options.avatar ?? `https://pbs.twimg.com/profile_images/${handle}/a.jpg`;
    avatarBox.appendChild(avatar);
  }
  wrapper.appendChild(avatarBox);
  wrapper.appendChild(buildUserName({ ...options, handle, id: options.id ?? '99' }));

  if (options.text !== undefined) {
    const text = el('div');
    text.dataset.testid = 'tweetText';
    text.textContent = options.text;
    wrapper.appendChild(text);
  }
  for (const src of options.media ?? []) {
    const photo = el('div');
    photo.dataset.testid = 'tweetPhoto';
    const image = el('img');
    image.src = src;
    photo.appendChild(image);
    wrapper.appendChild(photo);
  }

  article.appendChild(wrapper);
  return wrapper;
}
