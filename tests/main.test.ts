// @vitest-environment jsdom

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXPORT_FAILURES, EXTRACT_FAILURES, EXTRACT_WARNINGS, UI, progressNotice } from '../src/messages';
import * as exportModule from '../src/export';
import { install, scan, uninstall } from '../src/main';
import { forgetAll, recordTweets } from '../src/x-network';
import { buildPost } from './fixtures/build-page';

/** A conversation payload as the page loads it: root, reply, and a deep reply. */
function conversation(ids: [string, string | null][]): string {
  return JSON.stringify({
    data: {
      entries: ids.map(([id, parent]) => ({
        rest_id: id,
        legacy: {
          id_str: id,
          full_text: `post ${id}`,
          ...(parent === null ? {} : { in_reply_to_status_id_str: parent }),
        },
      })),
    },
  });
}

async function waitForEntry(index = 0): Promise<HTMLButtonElement> {
  await vi.waitFor(() => {
    expect(document.querySelectorAll('.postnote-entry').length).toBeGreaterThan(index);
  });
  return document.querySelectorAll<HTMLButtonElement>('.postnote-entry')[index];
}

function toastText(): string | null {
  return document.querySelector('.postnote-toast')?.textContent ?? null;
}

function allToasts(): string[] {
  return Array.from(document.querySelectorAll('.postnote-toast')).map(
    (toast) => toast.textContent ?? '',
  );
}

/**
 * Hold the canvas capture open, so the state just before it (the progress
 * toast) is observable. Snapshot-loaded posts need no resources, so the real
 * `capturePng` would fail on jsdom's missing canvas before a poll could see it.
 * `captureStarted` marks the moment the engine was entered; `releaseCapture`
 * settles that pending capture.
 */
let captureStarted = false;
let releaseCapture: () => void = () => {};
let capturedSheet: HTMLElement | undefined;

function waitForCapture(): Promise<unknown> {
  return vi.waitFor(() => {
    expect(captureStarted).toBe(true);
  });
}

beforeEach(() => {
  forgetAll();
  uninstall();
  captureStarted = false;
  releaseCapture = () => {};
  capturedSheet = undefined;
  vi.spyOn(exportModule, 'capturePng').mockImplementation(
    (element) => {
      capturedSheet = element;
      return new Promise<Blob>((_, reject) => {
        captureStarted = true;
        releaseCapture = () => reject(new Error('canvas unavailable'));
      });
    },
  );
  document.documentElement.lang = 'zh-CN';
  document.body.innerHTML = '';
  // jsdom has no layout engine; give the capture planner a card-sized box so the
  // save path can run. Real pixel sizes come from the live runs.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 650,
    height: 800,
    top: 0,
    left: 0,
    right: 650,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  install();
});

afterAll(() => {
  vi.restoreAllMocks();
  uninstall();
});

describe('the page entry', () => {
  it('takes the icon size and colour of the icon beside it in the same row', async () => {
    document.body.append(buildPost({ id: '100', text: '聚焦的那条' }));
    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    // jsdom has no layout: nothing measurable, so the CSS defaults stand.
    expect(slot.style.getPropertyValue('--postnote-icon-size')).toBe('');

    // X draws a focused post's action icons at 23px and replies' at 19px, so the
    // size has to come from the row rather than from one fixed value.
    const neighbour = slot.previousElementSibling as HTMLElement;
    neighbour.style.color = 'rgb(83, 100, 113)';
    const icon = neighbour.querySelector('svg')!;
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue({
      width: 23,
      height: 23,
      top: 0,
      left: 0,
      right: 23,
      bottom: 23,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    scan();
    expect(slot.style.getPropertyValue('--postnote-icon-size')).toBe('23px');
    expect(slot.style.getPropertyValue('--postnote-entry-color')).toBe('rgb(83, 100, 113)');
    // No measurable item beside it: the circle falls back to X's own proportion.
    expect(slot.style.getPropertyValue('--postnote-box-size')).toBe('43px');

    // In the focused post X's items are 47px tall; ours has to fill the row the
    // same way instead of stopping short of it.
    vi.spyOn(neighbour, 'getBoundingClientRect').mockReturnValue({
      width: 23,
      height: 47,
      top: 0,
      left: 0,
      right: 23,
      bottom: 47,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    scan();
    expect(slot.style.getPropertyValue('--postnote-box-size')).toBe('47px');

    // A glyph that is not an action icon (unrendered row, or another widget in
    // the same bar) must not decide our size.
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue({
      width: 650,
      height: 800,
      top: 0,
      left: 0,
      right: 650,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    slot.style.removeProperty('--postnote-icon-size');
    scan();
    expect(slot.style.getPropertyValue('--postnote-icon-size')).toBe('');
  });

  it('adds one entry per post and keeps it a single entry when a post is scanned again', async () => {
    document.body.append(
      buildPost({ id: '100', text: '第一条' }),
      buildPost({ id: '101', text: '第二条' }),
    );
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.postnote-entry')).toHaveLength(2);
    });

    scan();
    scan();
    expect(document.querySelectorAll('.postnote-entry')).toHaveLength(2);
    expect(document.querySelectorAll('.postnote-entry-slot')).toHaveLength(2);
  });

  it('leaves a post alone when its interaction bar cannot be identified', async () => {
    const article = buildPost({ id: '102', text: '无操作栏' });
    article.querySelector('[role="group"]')?.remove();
    document.body.append(buildPost({ id: '103', text: '有操作栏' }), article);
    await waitForEntry();

    expect(document.querySelectorAll('.postnote-entry')).toHaveLength(1);
    expect(article.querySelector('.postnote-entry')).toBeNull();
  });

  /**
   * jsdom has no layout, so the widths the placement check reads are stubbed:
   * the group's clientWidth and each item's scrollWidth — a fitting item's is
   * its flex share, a clipped one's its full count.
   */
  function stubRow(
    group: HTMLElement,
    groupWidth: number,
    itemWidths: number[],
    boxWidths: number[] = itemWidths,
  ): void {
    Object.defineProperty(group, 'clientWidth', {
      configurable: true,
      get: () => groupWidth,
    });
    Array.from(group.children).forEach((child, index) => {
      Object.defineProperty(child, 'scrollWidth', {
        configurable: true,
        get: () => itemWidths[index] ?? 45,
      });
      Object.defineProperty(child, 'clientWidth', {
        configurable: true,
        get: () => boxWidths[index] ?? 45,
      });
    });
  }

  /** Give each bar item the visible count X renders beside its icon. */
  function setCounts(group: HTMLElement, counts: (string | null)[]): void {
    Array.from(group.children).forEach((child, index) => {
      const count = counts[index];
      if (count) child.appendChild(document.createTextNode(count));
    });
  }

  function addCaret(article: HTMLElement): HTMLElement {
    const head = document.createElement('div');
    const anchor = document.createElement('div');
    const caret = document.createElement('button');
    caret.dataset.testid = 'caret';
    anchor.appendChild(caret);
    head.appendChild(anchor);
    article.prepend(head);
    return anchor;
  }

  it('moves the entry beside the "⋯" control when the bar cannot hold it', async () => {
    // The photo view's side column: the bar is 254px and every item already
    // clips its count — the row wants ~270px for X's own controls, so adding
    // our entry would squeeze it further and it goes to the header instead.
    const article = buildPost({ id: '100', text: '窄栏' });
    const anchor = addCaret(article);
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    stubRow(group, 254, [90, 90, 90]);
    document.body.append(article);

    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    expect(slot.classList.contains('in-head')).toBe(true);
    expect(anchor.previousElementSibling).toBe(slot);
    expect(slot.parentElement).not.toBe(group);

    // A re-scan measures the same cramped row and lands on the same
    // placement, so the entry does not bounce between the bar and the header.
    scan();
    expect(slot.classList.contains('in-head')).toBe(true);
    expect(anchor.previousElementSibling).toBe(slot);
  });

  it('keeps the entry in the bar when the row still has room', async () => {
    const article = buildPost({ id: '100', text: '宽栏' });
    addCaret(article);
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    stubRow(group, 450, [140, 140, 140]);
    document.body.append(article);

    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    expect(slot.classList.contains('in-head')).toBe(false);
    expect(slot.parentElement).toBe(group);
  });

  it('moves the entry when one item with a count clips although the sum fits', async () => {
    // The photo view's reply row as measured: 254px wide, items share it
    // evenly, the views count overflows its own share while the total of
    // every scrollWidth (247 with the entry) still lands under the width.
    const article = buildPost({
      id: '100',
      text: '单项溢出',
      actions: ['回复', '转发', '喜欢', '查看', '分享'],
    });
    const anchor = addCaret(article);
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    setCounts(group, ['12', '34', '56', '393', null]);
    stubRow(group, 254, [45, 45, 45, 50, 27], [45, 45, 45, 45, 19]);
    document.body.append(article);

    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    expect(slot.classList.contains('in-head')).toBe(true);
    expect(anchor.previousElementSibling).toBe(slot);

    // Measured again from the bar, the same item clips again: no bounce.
    scan();
    expect(slot.classList.contains('in-head')).toBe(true);
    expect(anchor.previousElementSibling).toBe(slot);
  });

  it('puts the entry into the header row when the "⋯" sits in a column box', async () => {
    // The photo view on some posts: row > column(20px) > anchor > caret.
    // Inserted beside the anchor, the entry would stack above the "⋯".
    const article = buildPost({ id: '100', text: '竖排表头' });
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'row';
    const column = document.createElement('div');
    column.style.display = 'flex';
    column.style.flexDirection = 'column';
    const anchor = document.createElement('div');
    const caret = document.createElement('button');
    caret.dataset.testid = 'caret';
    anchor.appendChild(caret);
    column.appendChild(anchor);
    row.appendChild(column);
    article.prepend(row);
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    stubRow(group, 254, [90, 90, 90]);
    document.body.append(article);

    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    expect(slot.classList.contains('in-head')).toBe(true);
    expect(slot.parentElement).toBe(row);
    expect(slot.nextElementSibling).toBe(column);
    expect(column.contains(slot)).toBe(false);
    // X's own boxes keep their styles.
    expect(column.getAttribute('style')).toBe('display: flex; flex-direction: column;');

    scan();
    expect(slot.parentElement).toBe(row);
    expect(slot.nextElementSibling).toBe(column);
  });

  it('ignores an icon-only item that clips at baseline', async () => {
    const article = buildPost({
      id: '100',
      text: '图标溢出',
      actions: ['回复', '转发', '喜欢', '查看', '分享'],
    });
    addCaret(article);
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    setCounts(group, ['1', '2', '3', '4', null]);
    stubRow(group, 254, [45, 45, 45, 45, 27], [45, 45, 45, 45, 19]);
    document.body.append(article);

    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    expect(slot.classList.contains('in-head')).toBe(false);
    expect(slot.parentElement).toBe(group);

    scan();
    expect(slot.parentElement).toBe(group);
  });

  it('stays in the bar when the row is cramped but there is no "⋯" to sit beside', async () => {
    const article = buildPost({ id: '100', text: '窄栏' });
    const group = article.querySelector<HTMLElement>('[role="group"]')!;
    stubRow(group, 254, [90, 90, 90]);
    document.body.append(article);

    const entry = await waitForEntry();
    const slot = entry.closest<HTMLElement>('.postnote-entry-slot')!;
    expect(slot.classList.contains('in-head')).toBe(false);
    expect(slot.parentElement).toBe(group);
  });

  it('has a label a keyboard user can hear in both languages', async () => {
    document.body.append(buildPost({ id: '100', text: '可读' }));
    const entry = await waitForEntry();
    expect(entry.getAttribute('aria-label')).toBe(UI.saveImage.zh);
    expect(entry.title).toBe(UI.saveImage.zh);
    expect(entry.type).toBe('button');

    document.documentElement.lang = 'en';
    scan();
    expect(document.querySelector('.postnote-entry')?.getAttribute('aria-label')).toBe(
      UI.saveImage.en,
    );
  });
});

describe('saving a post', () => {
  it('generates straight from the click, with no dialog in between', async () => {
    document.body.append(buildPost({ id: '100', text: '直接生成' }));
    recordTweets(conversation([['100', null]]));
    const entry = await waitForEntry();
    entry.click();

    // jsdom has no canvas, so the capture itself stops at the engine and reports
    // that; what this covers is the shape of the flow: no window opens, nothing is
    // left behind, and the button comes back. The saved file is verified live.
    await vi.waitFor(() => {
      expect(document.querySelector('.postnote-toast')).not.toBeNull();
    });
    await waitForCapture();
    releaseCapture();
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
    expect(document.querySelector('.postnote-bar')).toBeNull();
    await vi.waitFor(() => {
      expect(document.querySelector('.postnote-stage')).toBeNull();
      expect(entry.disabled).toBe(false);
    });
    expect(entry.getAttribute('aria-label')).toBe(UI.saveImage.zh);
  });

  it('explains a post it cannot read, and saves nothing', async () => {
    document.body.append(buildPost({ id: '100' }));
    const entry = await waitForEntry();
    entry.click();

    await vi.waitFor(() => {
      expect(toastText()).toBe(EXTRACT_FAILURES['no-content'].zh);
    });
    expect(document.querySelector('.postnote-toast')?.getAttribute('role')).toBe('alert');
    expect(document.querySelector('.postnote-stage')).toBeNull();
  });

  it('draws the poll the page is showing, options while it still votes', async () => {
    document.body.append(buildPost({ id: '100', text: '带投票', poll: 'options' }));
    const entry = await waitForEntry();
    entry.click();

    await waitForCapture();
    const poll = capturedSheet!.querySelector('.postnote-poll')!;
    expect(
      [...poll.querySelectorAll<HTMLElement>('.postnote-po')].map((item) => item.textContent),
    ).toEqual(['选项甲', '选项乙']);
    expect(poll.querySelectorAll('.postnote-pr')).toHaveLength(0);
    expect(poll.querySelector('.postnote-poll-meta')?.textContent).toBe('9 票 · 剩下 2 天');
    releaseCapture();
  });

  it('draws poll results with the page\'s own percentages and leaders', async () => {
    document.body.append(buildPost({ id: '100', text: '带投票', poll: 'results' }));
    const entry = await waitForEntry();
    entry.click();

    await waitForCapture();
    const rows = [...capturedSheet!.querySelectorAll<HTMLElement>('.postnote-pr')];
    expect(rows.map((row) => row.querySelector('.postnote-pr-pct')?.textContent)).toEqual([
      '45.5%',
      '9.1%',
      '45.5%',
    ]);
    // Both leaders are bold on the page, so both lead on the sheet.
    expect(rows.map((row) => row.classList.contains('is-win'))).toEqual([true, false, true]);
    expect(
      capturedSheet!.querySelector('.postnote-poll-meta')?.textContent,
    ).toBe('11 票 · 最終結果');
    releaseCapture();
  });

  it('lets the card data decide the poll of an ancestor that left the DOM', async () => {
    // A reply whose parent carried a poll; only the reply is still rendered.
    const parent: Record<string, unknown> = {
      rest_id: '100',
      legacy: {
        id_str: '100',
        full_text: 'parent',
        created_at: '2026-06-01T10:00:00.000Z',
      },
      card: {
        legacy: {
          name: 'poll2choice_text_only',
          binding_values: [
            { key: 'choice1_label', value: { type: 'STRING', string_value: '赞成' } },
            { key: 'choice1_count', value: { type: 'STRING', string_value: '7' } },
            { key: 'choice2_label', value: { type: 'STRING', string_value: '反对' } },
            { key: 'choice2_count', value: { type: 'STRING', string_value: '3' } },
            { key: 'counts_are_final', value: { type: 'BOOLEAN', boolean_value: true } },
          ],
        },
      },
    };
    const reply = {
      rest_id: '200',
      legacy: {
        id_str: '200',
        full_text: 'reply',
        in_reply_to_status_id_str: '100',
        created_at: '2026-06-01T11:00:00.000Z',
      },
    };
    recordTweets(JSON.stringify({ data: { entries: [parent, reply] } }));
    document.body.append(buildPost({ id: '200', text: 'reply' }));
    const entry = await waitForEntry();
    entry.click();

    await waitForCapture();
    const posts = capturedSheet!.querySelectorAll<HTMLElement>('.postnote-post');
    expect(posts).toHaveLength(2);
    const rows = [...posts[0].querySelectorAll<HTMLElement>('.postnote-pr')];
    // The parent never rendered in this run: results come from the data alone.
    expect(rows.map((row) => row.querySelector('.postnote-pr-label')?.textContent)).toEqual([
      '赞成',
      '反对',
    ]);
    expect(rows.map((row) => row.querySelector('.postnote-pr-pct')?.textContent)).toEqual([
      '70%',
      '30%',
    ]);
    expect(rows[0].classList.contains('is-win')).toBe(true);
    expect(posts[0].querySelector('.postnote-poll-meta')?.textContent).toBe('10 票 · 最终结果');
    releaseCapture();
  });

  it('stops when a resource cannot be loaded instead of saving a partial image', async () => {
    document.body.append(
      buildPost({ id: '100', text: '有图', media: ['https://pbs.twimg.com/media/a?format=jpg'] }),
    );
    const entry = await waitForEntry();
    entry.click();

    await vi.waitFor(() => {
      expect(toastText()).toContain(EXPORT_FAILURES['media-failed'].zh);
    });
    expect(document.querySelector('.postnote-stage')).toBeNull();
  });

  it('refuses a post that cannot be captured even at the lowest scale', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 650,
      height: 20_000,
      top: 0,
      left: 0,
      right: 650,
      bottom: 20_000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.append(buildPost({ id: '100', text: '太长' }));
    const entry = await waitForEntry();
    entry.click();

    await vi.waitFor(() => {
      expect(toastText()).toContain('16384');
    });
    expect(document.querySelector('.postnote-stage')).toBeNull();
  });

  it('shows the rest of a long post before reading it', async () => {
    document.body.append(
      buildPost({ id: '100', text: '可见的一半', showMore: '被折起来的一半' }),
    );
    const entry = await waitForEntry();
    entry.click();

    // The page's own control was clicked, so the whole text is in the DOM.
    // The export waited for that swap instead of reading the cut text, so it got
    // as far as the capture (which jsdom cannot do) rather than refusing the post.
    await vi.waitFor(() => {
      expect(document.querySelector('.postnote-stage')).not.toBeNull();
    });
    await waitForCapture();
    releaseCapture();
    await vi.waitFor(() => {
      expect(allToasts().join(' | ')).toContain(EXPORT_FAILURES['capture-failed'].zh);
    });
    expect(document.querySelector('[data-testid="tweetText"]')?.textContent).toContain(
      '被折起来的一半',
    );
    expect(allToasts().join(' | ')).not.toContain(EXTRACT_FAILURES['no-content'].zh);
  });

  it('refuses a post whose text never opened, instead of saving half of it', async () => {
    document.body.append(
      buildPost({ id: '100', text: '可见的一半', showMoreStuck: true }),
    );
    const entry = await waitForEntry();
    entry.click();

    // The control went away without the rest arriving, so nothing was exported.
    await vi.waitFor(
      () => {
        expect(allToasts().join(' | ')).toContain(EXTRACT_WARNINGS['text-collapsed'].zh);
      },
      { timeout: 4000 },
    );
    expect(allToasts().join(' | ')).not.toContain(EXPORT_FAILURES['capture-failed'].zh);
  });

  it('saves the verified chain when the clicked post is a reply', async () => {
    document.body.append(
      buildPost({ id: '100', handle: 'main', text: '主推正文' }),
      buildPost({ id: '200', handle: 'replier', text: '回复正文' }),
      buildPost({ id: '300', handle: 'deep', text: '更深的回复' }),
    );
    recordTweets(conversation([['100', null], ['200', '100'], ['300', '200']]));
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.postnote-entry')).toHaveLength(3);
    });

    document.querySelectorAll<HTMLButtonElement>('.postnote-entry')[2].click();

    // Three verified ancestors plus the clicked post, counted before the capture.
    // The capture is held open so the progress notice can be observed instead of
    // being overwritten by jsdom's immediate canvas failure.
    await vi.waitFor(() => {
      expect(allToasts().join(' | ')).toContain(progressNotice('zh', 3));
    });
    await waitForCapture();
    releaseCapture();
    await vi.waitFor(() => {
      expect(document.querySelector('.postnote-stage')).toBeNull();
    });
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
  });

  it('says what is missing when the chain cannot be established', async () => {
    document.body.append(buildPost({ id: '200', handle: 'replier', text: '回复正文' }));
    // Nothing was observed about this post, so its relation is unknown rather
    // than "no parent".
    const entry = await waitForEntry();
    entry.click();

    await vi.waitFor(() => {
      expect(allToasts().join(' | ')).toContain('只保存了 1 条');
    });
    expect(allToasts().join(' | ')).toContain('父推关系数据还没加载');
  });

  it('stops at the part of the chain it could read, and says which post is missing', async () => {
    document.body.append(buildPost({ id: '300', handle: 'deep', text: '更深的回复' }));
    // The page loaded the reply's parent link, but never the parent post itself.
    recordTweets(conversation([['300', '200']]));
    const entry = await waitForEntry();
    entry.click();

    await vi.waitFor(() => {
      expect(allToasts().join(' | ')).toContain('只保存了已确认的 1 条');
    });
    expect(allToasts().join(' | ')).toContain('200');
  });

  it('saves the post the button now belongs to, not the one it was created for', async () => {
    // X reuses article elements across navigations: the button can end up inside
    // an article that now shows a different post, and the stale reference is not
    // what the user is looking at.
    document.body.append(buildPost({ id: '100', handle: 'first', text: '旧推文' }));
    recordTweets(conversation([['100', null], ['200', '100']]));
    const entry = await waitForEntry();

    const replacement = buildPost({ id: '200', handle: 'second', text: '新推文' });
    document.body.append(replacement);
    replacement.querySelector('[role="group"]')?.appendChild(entry.parentElement as HTMLElement);

    entry.click();
    await vi.waitFor(() => {
      expect(toastText()).toBe(progressNotice('zh', 2));
    });
    await waitForCapture();
    releaseCapture();
    await vi.waitFor(() => {
      expect(document.querySelector('.postnote-stage')).toBeNull();
    });
  });

  it('refuses a second click while one image is still being generated', async () => {
    document.body.append(
      buildPost({ id: '100', text: '第一条' }),
      buildPost({ id: '101', text: '第二条' }),
    );
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.postnote-entry')).toHaveLength(2);
    });
    const entries = document.querySelectorAll<HTMLButtonElement>('.postnote-entry');
    entries[0].click();
    entries[1].click();

    await vi.waitFor(() => {
      expect(document.querySelectorAll('.postnote-toast').length).toBeGreaterThan(0);
    });
    const texts = Array.from(document.querySelectorAll('.postnote-toast')).map(
      (toast) => toast.textContent,
    );
    expect(texts).toContain(UI.busyNotice.zh);
    await waitForCapture();
    releaseCapture();
  });
});
