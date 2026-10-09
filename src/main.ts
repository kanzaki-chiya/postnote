/**
 * PostNote entry point: the page lifecycle and the entry button.
 *
 * One click on a post produces one PNG. There is no dialog in between, and
 * nothing is remembered between posts — failures and the scale actually used are
 * reported through a toast.
 *
 * Post content comes first from the sanitized snapshots of the data X loaded
 * for itself (`x-network.ts`); a post the loaded data does not cover falls back
 * to reading the rendered article.
 */

import './style.css';
import {
  EXPORT_FAILURES,
  EXTRACT_FAILURES,
  EXTRACT_WARNINGS,
  UI,
  chainNotice,
  pollMeta,
  progressNotice,
  savedNotice,
  scaledNotice,
  type ExportFailure,
} from './messages';
import {
  ExportError,
  buildFileName,
  capturePng,
  downloadBlob,
  planCapture,
  prepareCard,
} from './export';
import { BLOCKING_WARNINGS } from './tweet';
import type { ExtractFailure, ExtractWarning, PageLanguage, TweetData } from './tweet';
import { renderSheet } from './render';
import { showToast } from './toast';
import { ancestorPath } from './chain';
import { parentOf, snapshotOf, watchNetwork } from './x-network';
import type { TweetSnapshot } from './x-snapshot';
import {
  expandTweetText,
  findDetailMainTweet,
  findTweetActionGroup,
  findTweetElements,
  findTweetById,
  getArticleStatusId,
  getPageLanguage,
  hasCollapsedText,
  ownPollElement,
  postTextLength,
  readPollElement,
  readTweet,
  showsTranslation,
} from './x-page';

const ENTRY_CLASS = 'postnote-entry';
const ENTRY_SLOT_CLASS = 'postnote-entry-slot';
/** X draws an 18.75px icon inside a 34.75px hover circle; keep that proportion. */
const HOVER_RATIO = 34.75 / 18.75;
const ROOT_CLASS = 'postnote-root';
const SCAN_DELAY_MS = 250;
/** X's own "⋯" control in a post's header row. */
const CARET_SELECTOR = '[data-testid="caret"]';

const SAVE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M3 19.5c0 .83.67 1.5 1.5 1.5h15c.83 0 1.5-.67 1.5-1.5v-6.5h-2v6.5h-15v-6.5h-2v6.5zM10.46 13.07l-3.54-3.54-1.42 1.42L12 17.41l6.5-6.46-1.42-1.42-3.54 3.54V3h-2v10.07z"></path></g></svg>';

let scanTimer: number | null = null;
let observer: MutationObserver | null = null;
let lastPath = '';
let observerStarted = false;
/** The export that is running right now, so two captures never overlap. */
let saving: AbortController | null = null;
/** Posts already reported as having no usable interaction bar. */
const withoutEntry = new WeakSet<HTMLElement>();

function isTraditional(doc: Document): boolean {
  const lang = doc.documentElement.lang || '';
  return /(?:^|-)Hant(?:-|$)|^zh-(?:TW|HK|MO)(?:-|$)/i.test(lang);
}

function isOwnNode(node: Node | null): boolean {
  const element = (node as Partial<Element> | null)?.closest
    ? (node as Element)
    : node?.parentElement ?? null;
  return Boolean(element?.closest(`.${ROOT_CLASS}`));
}

function isOwnMutation(mutation: MutationRecord): boolean {
  if (isOwnNode(mutation.target)) return true;
  if (mutation.type !== 'childList') return false;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length > 0 && nodes.every(isOwnNode);
}

/* Entry button ------------------------------------------------------------ */

function setBusy(button: HTMLButtonElement, busy: boolean, language: PageLanguage): void {
  const label = UI[busy ? 'saving' : 'saveImage'][language];
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  button.setAttribute('aria-busy', String(busy));
  button.setAttribute('aria-label', label);
  button.title = label;
}

function createEntry(article: HTMLElement, language: PageLanguage): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = ENTRY_CLASS;
  button.innerHTML = SAVE_ICON;
  setBusy(button, false, language);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // The page reuses article elements across navigations, so the post is
    // resolved from where the button actually sits, not from what it was
    // created next to. Reading a stale element saved the wrong post.
    const owner = button.closest<HTMLElement>('article[data-testid="tweet"]') ?? article;
    void savePost(owner, button);
  });
  return button;
}

/**
 * Copy the size and colour of the icons already beside the entry.
 *
 * X does not use one icon size: the focused post on a detail page draws its
 * action icons at 23px while replies draw them at 19px. A fixed size looked
 * wrong in the focused post, so the row's own icon is measured instead of
 * assumed. The same holds in the header placement, where the "⋯" control's
 * icon is the neighbour. Nothing measurable leaves the CSS defaults in place.
 */
function syncEntry(slot: HTMLElement, neighbour?: HTMLElement | null): void {
  const container = slot.parentElement;
  const previous = neighbour ?? (slot.previousElementSibling as HTMLElement | null);
  const host =
    previous?.querySelector('svg') ??
    Array.from(container?.querySelectorAll('svg') ?? []).find(
      (svg) => !svg.closest(`.${ENTRY_CLASS}`),
    );
  if (!host) return;
  const box = host.getBoundingClientRect();
  // Only a rendered icon is worth copying: an unrendered row reports 0, and
  // anything far outside X's own range is a different glyph in the same row.
  if (box.width >= 10 && box.width <= 40) {
    slot.style.setProperty('--postnote-icon-size', `${box.width}px`);
  }
  // The hover circle is as tall as the item beside it — 35px in a timeline row,
  // 47px in the focused post — falling back to X's icon-to-circle proportion.
  const item = previous?.getBoundingClientRect();
  const height =
    item && item.height >= 20 && item.height <= 80 ? item.height : box.width * HOVER_RATIO;
  if (height >= 20) {
    slot.style.setProperty('--postnote-box-size', `${Math.round(height)}px`);
  }
  const color = getComputedStyle(host).color;
  if (color) slot.style.setProperty('--postnote-entry-color', color);
}

/**
 * Where the entry goes in this article.
 *
 * Normally it joins the interaction bar. On a row too narrow to hold it — the
 * photo view's side column is the known case — the entry moves to the post
 * header instead, beside the "⋯" control, and the bar keeps its own items.
 *
 * Whether the bar has room cannot be read off the bar itself: X's items are
 * flex children that shrink inside their own boxes, so a squeezed item clips
 * its count rather than widening the group, and the group's own scrollWidth
 * never grows. What overflows is each child — and in the photo column every
 * item already clips at the baseline, so a before/after diff has nothing to
 * compare. Instead the check reads what the row needs: a fitting item's
 * scrollWidth is its flex share, a clipped one's is its full count, so the
 * sum of every item's scrollWidth plus the entry's is the width the row
 * really wants. The entry stays only while that total lands inside the
 * group's width — a bar that cannot show its own items does not get an extra
 * one. The sum alone misses a row whose items share it evenly: X's items are
 * `flex: 1 1 0`, so one long count clips inside its own share while the total
 * still fits. Any item with a visible number that overflows its box therefore
 * moves the entry too; icon-only items (share, download) clip a few pixels
 * even at baseline and are not counted. The check is re-run on every pass, so a row that later gains room gets
 * the entry back, and a cramped row keeps it in the header — the decision
 * cannot flap.
 */
/** Whether a bar item shows a number — icon-only items clip a little at baseline. */
function hasVisibleCount(item: Element): boolean {
  return /\d/.test(item.textContent ?? '');
}

/**
 * The ancestor of the "⋯" control that sits directly in a horizontal flex row.
 *
 * Some headers wrap the control in a column box (the photo view on some posts),
 * and a sibling there stacks above the "⋯". Walk up at most four levels to the
 * node whose parent lays out in a row; without one, the control's own wrapper
 * is used as before.
 */
function rowChildAround(anchor: HTMLElement): HTMLElement {
  let node: HTMLElement = anchor;
  for (let level = 0; level < 4; level++) {
    const parent = node.parentElement;
    if (!parent) break;
    const style = getComputedStyle(parent);
    if (
      (style.display === 'flex' || style.display === 'inline-flex') &&
      (style.flexDirection === 'row' || style.flexDirection === 'row-reverse')
    ) {
      return node;
    }
    node = parent;
  }
  return anchor;
}

function placeEntry(article: HTMLElement, group: HTMLElement, slot: HTMLElement): void {
  slot.classList.remove('in-head');
  slot.remove();
  group.appendChild(slot);
  syncEntry(slot);
  let needed = 0;
  let countClipped = false;
  for (const child of Array.from(group.children)) {
    needed += child.scrollWidth;
    if (child !== slot && hasVisibleCount(child) && child.scrollWidth > child.clientWidth + 1) {
      countClipped = true;
    }
  }

  const caret = article.querySelector<HTMLElement>(CARET_SELECTOR);
  const anchor = caret?.parentElement ?? null;
  if ((needed > group.clientWidth + 1 || countClipped) && anchor) {
    slot.classList.add('in-head');
    const spot = rowChildAround(anchor);
    spot.parentElement?.insertBefore(slot, spot);
    syncEntry(slot, anchor);
  }
}

/**
 * Add our button to a post's interaction bar.
 *
 * Nothing of the host's markup is copied or rearranged. A post whose bar cannot
 * be identified is left alone and reported instead of being guessed at.
 */
function injectEntry(article: HTMLElement, language: PageLanguage): void {
  const group = findTweetActionGroup(article);
  if (!group) {
    if (!withoutEntry.has(article)) {
      withoutEntry.add(article);
      console.info('[postnote] no interaction bar found; no entry was added to this post.');
    }
    return;
  }
  // An existing entry is kept, but its look follows this row and its labels
  // follow the page language: the page reuses one article for several posts,
  // and a post moves between the timeline and the focused slot.
  const existing = article.querySelector<HTMLElement>(`.${ENTRY_CLASS}`);
  let slot: HTMLElement;
  if (existing) {
    slot = existing.closest<HTMLElement>(`.${ENTRY_SLOT_CLASS}`)!;
    if (existing instanceof HTMLButtonElement && !existing.disabled) {
      setBusy(existing, false, language);
    }
  } else {
    slot = document.createElement('div');
    slot.className = `${ENTRY_SLOT_CLASS} ${ROOT_CLASS}`;
    slot.appendChild(createEntry(article, language));
    group.appendChild(slot);
  }
  placeEntry(article, group, slot);
}

/**
 * Add the entry to every post on the page that does not have one yet.
 *
 * Exported as the single entry point for a full pass over the page: the observer
 * coalesces into it, and tests call it directly instead of waiting on a timer.
 */
export function scan(): void {
  const language = getPageLanguage(document);
  findTweetElements(document).forEach((article) => injectEntry(article, language));
  lastPath = window.location.pathname;
}

function scheduleScan(): void {
  if (scanTimer !== null) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    scan();
  }, SCAN_DELAY_MS);
}

/* Saving ------------------------------------------------------------------ */

function mountStage(sheet: HTMLElement): { stage: HTMLElement } {
  const stage = document.createElement('div');
  stage.className = `postnote-stage ${ROOT_CLASS}`;
  stage.setAttribute('aria-hidden', 'true');
  stage.appendChild(sheet);
  document.body.appendChild(stage);
  return { stage };
}

const EXPAND_TIMEOUT_MS = 1500;

/** Wait for one frame, so a page that just re-rendered can be read again. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Show the rest of a long post before reading it.
 *
 * X cuts long text off behind its own "show more". Clicking it is the only way
 * to get the full text — nothing here guesses what the hidden part says.
 *
 * The wait watches the text itself, not just the control: a click can take the
 * control away a moment before the text lands, and reading in that gap produced
 * a card with half a post in it. `false` means the text never grew, which the
 * caller treats as a post it could not read.
 *
 * Returns nothing to wait for when the post was not cut off, so an ordinary
 * export stays synchronous up to the first render.
 */
function expandPost(article: HTMLElement, signal: AbortSignal): Promise<boolean> | null {
  const before = postTextLength(article);
  if (!expandTweetText(article)) return null;
  return (async () => {
    const deadline = Date.now() + EXPAND_TIMEOUT_MS;
    while (Date.now() < deadline && !signal.aborted) {
      if (!hasCollapsedText(article, null) && postTextLength(article) > before) return true;
      await nextFrame();
    }
    return false;
  })();
}

type ReadOutcome =
  | { ok: true; data: TweetData; blocking?: ExtractWarning }
  | { ok: false; failure: ExtractFailure; blocking?: ExtractWarning };

/**
 * Turn a snapshot into the post data to draw.
 *
 * `preferTranslation` is decided from the article that is on the page: when X
 * shows the translated text, the card shows the translation the data carried.
 */
function materialize(snapshot: TweetSnapshot, preferTranslation: boolean): TweetData {
  if (!preferTranslation || !snapshot.translatedBody) return snapshot.data;
  return { ...snapshot.data, body: snapshot.translatedBody };
}

/**
 * Draw a poll the way the page draws it — option pills while it is still
 * votable, result bars once results show — the same rule the translation flag
 * follows. When this post's poll is rendered on the page, that element decides
 * both display and the "N votes · …" line; when it is not (an ancestor that is
 * no longer rendered), the card data decides instead.
 */
function withPollDisplay(
  data: TweetData,
  pollElement: Element | null,
  language: PageLanguage,
  traditional: boolean,
): TweetData {
  const pagePoll = pollElement ? readPollElement(pollElement) : null;
  const poll = data.poll ?? pagePoll;
  if (!poll) return data;
  const display = pagePoll?.display ?? (poll.final || poll.voted ? 'results' : 'options');
  // Result rows keep the page's own percentages and leader marks when it was
  // the source of truth; the card data's counts decide otherwise.
  const choices =
    pagePoll?.display === 'results' && pagePoll.choices.length === poll.choices.length
      ? poll.choices.map((choice, index) => ({
          ...choice,
          pct: pagePoll.choices[index].pct ?? choice.pct,
          win: pagePoll.choices[index].win ?? choice.win,
        }))
      : poll.choices;
  const meta =
    pagePoll?.meta ?? poll.meta ?? (pollMeta({ ...poll, choices }, language, traditional) || null);
  return { ...data, poll: { ...poll, choices, display, meta } };
}

/** Read one post, preferring the data the page already loaded. */
async function readPost(
  article: HTMLElement,
  signal: AbortSignal,
): Promise<ReadOutcome> {
  const id = getArticleStatusId(article);
  const snapshot = id ? snapshotOf(id) : undefined;

  if (snapshot) {
    // A snapshot carries the full text already, so there is nothing to expand.
    const translated = showsTranslation(article);
    let data = materialize(snapshot, translated);
    if (translated && !snapshot.translatedBody) {
      const expansion = expandPost(article, signal);
      if (expansion && !(await expansion)) return { ok: false, failure: 'no-content', blocking: 'text-collapsed' };
      const visible = readTweet(article, { isDetailMain: article === findDetailMainTweet() });
      if (!visible.ok) return visible;
      data = { ...data, body: visible.data.body };
    }
    data = withPollDisplay(
      data,
      ownPollElement(article),
      getPageLanguage(document),
      isTraditional(document),
    );
    const blocking = snapshot.warnings.find((warning) =>
      BLOCKING_WARNINGS.includes(warning),
    );
    if (blocking) return { ok: false, failure: 'no-content', blocking };
    return { ok: true, data };
  }

  // DOM fallback: the post was not in the loaded data, so the rendered article
  // is the source — including expanding long text the page still hides.
  const expansion = expandPost(article, signal);
  if (expansion && !(await expansion)) {
    return { ok: false, failure: 'no-content', blocking: 'text-collapsed' };
  }
  const extract = readTweet(article, { isDetailMain: article === findDetailMainTweet() });
  if (!extract.ok) return { ok: false, failure: extract.failure };
  const blocking = extract.warnings.find((warning) => BLOCKING_WARNINGS.includes(warning));
  if (blocking) return { ok: false, failure: 'no-content', blocking };
  return { ok: true, data: extract.data };
}

type PrepareOutcome = { blocking: number; degraded: boolean; fontTimedOut: boolean };

/** Prepare the whole sheet's resources and report what could not be used. */
async function prepareSheet(
  controller: AbortController,
  sheet: HTMLElement,
): Promise<PrepareOutcome> {
  const report = await prepareCard(sheet, { cache: new Map(), signal: controller.signal });
  return {
    blocking: report.blocking.length,
    degraded: report.degraded.length > 0,
    fontTimedOut: report.fontTimedOut,
  };
}

function reportFailure(
  language: PageLanguage,
  toast: ReturnType<typeof showToast>,
  error: unknown,
): void {
  const code: ExportFailure = error instanceof ExportError ? error.code : 'capture-failed';
  console.error('[postnote] export failed:', error);
  toast.update(EXPORT_FAILURES[code][language], 'error');
}

/**
 * Read the post, its verified ancestors, capture them, and hand over the file.
 *
 * The chain comes from parent ids the page itself loaded, never from position or
 * wording. An ancestor's content comes from the snapshot store first — X
 * recycles articles once they scroll away, but the loaded data stays — and only
 * a post absent from both the store and the DOM counts as missing.
 */
async function savePost(article: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const language = getPageLanguage(document);
  const traditional = isTraditional(document);
  if (saving) {
    showToast(UI.busyNotice[language], 'error', ROOT_CLASS);
    return;
  }

  const controller = new AbortController();
  saving = controller;
  const toast = showToast(UI.saving[language], 'progress', ROOT_CLASS);
  setBusy(button, true, language);

  let stage: HTMLElement | null = null;
  try {
    const clicked = await readPost(article, controller.signal);
    if (!clicked.ok) {
      const message = clicked.blocking
        ? EXTRACT_WARNINGS[clicked.blocking][language]
        : EXTRACT_FAILURES[clicked.failure][language];
      toast.update(message, 'error');
      return;
    }

    // Whether the page shows the clicked post translated; ancestors share the
    // same choice, since their articles may no longer be rendered at all.
    const clickedId = getArticleStatusId(article);
    const clickedSnap = clickedId ? snapshotOf(clickedId) : undefined;
    const preferTranslation = Boolean(clickedSnap?.translatedBody) && showsTranslation(article);

    const chain = ancestorPath(clicked.data.id, parentOf);
    const ancestorIds = chain.ids.filter((id) => id !== clicked.data.id);
    const resolved: (TweetData | null)[] = [];
    for (const id of ancestorIds) {
      const snapshot = snapshotOf(id);
      if (snapshot) {
        const blocking = snapshot.warnings.find((warning) =>
          BLOCKING_WARNINGS.includes(warning),
        );
        const visible = findTweetById(id);
        if (visible) {
          const read = await readPost(visible, controller.signal);
          resolved.push(read.ok ? read.data : null);
        } else {
          // Not rendered: the card data alone decides how its poll draws.
          resolved.push(
            blocking
              ? null
              : withPollDisplay(
                  materialize(snapshot, preferTranslation),
                  null,
                  language,
                  traditional,
                ),
          );
        }
        continue;
      }
      const ancestorArticle = findTweetById(id);
      if (!ancestorArticle) {
        resolved.push(null);
        continue;
      }
      const ancestorExpansion = expandPost(ancestorArticle, controller.signal);
      // An ancestor whose text would not open is as unusable as a missing one.
      if (ancestorExpansion && !(await ancestorExpansion)) {
        resolved.push(null);
        continue;
      }
      const read = readTweet(ancestorArticle, {
        isDetailMain: ancestorArticle === findDetailMainTweet(),
      });
      if (!read.ok || read.warnings.some((warning) => BLOCKING_WARNINGS.includes(warning))) {
        resolved.push(null);
        continue;
      }
      resolved.push(read.data);
    }

    if (import.meta.env.MODE === 'development') {
      console.info('[postnote] chain', {
        id: clicked.data.id,
        parent: String(parentOf(clicked.data.id)),
        ids: chain.ids,
        complete: chain.complete,
        unresolvedFrom: chain.unresolvedFrom,
        missing: resolved.map((item) => item?.id ?? null),
      });
    }

    // Keep the connected tail: everything below the nearest link that cannot be
    // resolved. A gap in the middle would be a different claim from a prefix.
    const lastMissing = resolved.reduce((acc, item, index) => (item === null ? index : acc), -1);
    const posts: TweetData[] = [
      ...(resolved.slice(lastMissing + 1) as TweetData[]),
      clicked.data,
    ];
    let notice = '';
    if (lastMissing >= 0) {
      notice = chainNotice(language, 'missing-article', posts.length, ancestorIds[lastMissing]);
    } else if (!chain.complete) {
      notice = chainNotice(
        language,
        chain.reason === 'root' ? 'unknown-parent' : chain.reason,
        posts.length,
        chain.unresolvedFrom,
      );
    }

    // A short chain gets its own notice so the reason cannot be overwritten by
    // the outcome of the capture that follows.
    if (notice) showToast(notice, 'error', ROOT_CLASS);

    // Say how many posts the chain resolved to before the capture starts.
    toast.update(progressNotice(language, posts.length), 'progress');

    const sheet = renderSheet(posts, { language, traditional });
    stage = mountStage(sheet).stage;

    const report = await prepareSheet(controller, sheet);
    if (controller.signal.aborted) return;
    if (report.blocking > 0) {
      toast.update(EXPORT_FAILURES['media-failed'][language], 'error');
      return;
    }

    const plan = planCapture(sheet);
    if (!plan) throw new ExportError('too-large');
    const blob = await capturePng(sheet, plan);
    if (controller.signal.aborted) return;

    const root = posts[0];
    downloadBlob(
      blob,
      posts.length === 1
        ? buildFileName(root.author.handle, root.id)
        : `postnote-thread-${posts.length}-${root.id}.png`,
    );

    if (plan.limited) {
      const scaled = scaledNotice(language, plan.scale, plan.width, plan.height);
      toast.update(
        posts.length > 1 ? `${savedNotice(language, posts.length)} ${scaled}` : scaled,
        'info',
      );
    } else {
      const degraded = report.degraded || report.fontTimedOut;
      toast.update(
        degraded ? UI.degraded[language] : savedNotice(language, posts.length),
        'info',
      );
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    reportFailure(language, toast, error);
  } finally {
    stage?.remove();
    if (saving === controller) saving = null;
    setBusy(button, false, language);
  }
}

/* Lifecycle --------------------------------------------------------------- */

function startObserver(): void {
  if (observerStarted || !document.body) return;
  observerStarted = true;

  observer = new MutationObserver((mutations) => {
    if (mutations.every(isOwnMutation)) return;
    if (window.location.pathname !== lastPath) scheduleScan();
    else if (mutations.some((mutation) => mutation.type === 'childList')) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleScan);
  window.addEventListener('resize', scheduleScan);
  scan();
}

export function install(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const state = window as Window & { __postnoteInstalled?: boolean };
  if (state.__postnoteInstalled) return;
  state.__postnoteInstalled = true;

  watchNetwork();
  if (document.body) startObserver();
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
}

/**
 * Stop watching the page and remove everything PostNote added.
 *
 * The page can run for hours and navigate without a reload; this is how the
 * listeners and nodes of a finished run are given back.
 */
export function uninstall(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  observer?.disconnect();
  observer = null;
  observerStarted = false;
  window.removeEventListener('popstate', scheduleScan);
  window.removeEventListener('resize', scheduleScan);
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
    scanTimer = null;
  }
  saving?.abort();
  saving = null;
  document.querySelectorAll(`.${ROOT_CLASS}`).forEach((node) => node.remove());
  (window as Window & { __postnoteInstalled?: boolean }).__postnoteInstalled = false;
}

if (typeof document !== 'undefined' && import.meta.env.MODE !== 'test') install();
