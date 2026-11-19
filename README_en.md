# 推笺 · PostNote

[简体中文](README.md) | English

> Save posts from X as clean, shareable PNG images.

A Chrome extension and userscript that run on X / Twitter. Click the PostNote icon beside a post and the image is generated and downloaded right away.

Current version: **0.6.0**

---

## Features

- A PostNote entry next to every post's action bar, usable from the keyboard (Enter / Space).
- **One click, one image**: read the post → prepare its images and fonts → render the PNG → download it. No dialog, no picker, no list in between.
- **A reply brings the whole thread**: if the post you clicked is a reply, the image runs from the root post → every step in between → the reply you clicked, in the same order as the page, with connector lines between them.
  - Parent links come from the page's **own loaded data** (`in_reply_to_status_id_str`). PostNote only watches the page's fetch / XHR calls at `document-start`: it sends no extra requests and reads nothing else. Position, connector lines, author names and “Replying to” labels play no part in that decision.
  - When the chain cannot be completed, PostNote does not pretend otherwise: the notice states what is missing — a parent that was never in the loaded data, an ancestor that was never rendered on the page, a cycle, or a chain that is too deep — and only the verified part is saved.
- Supports: text, line breaks, links, mentions, hashtags, emoji, still images and author avatars.
- **Quoted posts are exported with the post**: a quote box is drawn below the text; a quote inside a quote is drawn in X's compact style, anything deeper is left out, just as on X.
- **Video and GIF show their cover**: the card carries the cover image, a play button and a “Video / GIF” badge instead of refusing the post.
- **Link cards are drawn as the page shows them**: large image cards (title over the image) and small thumbnail cards (domain / title / description) both appear, and player cards get a play button; if the card image cannot be fetched, the card falls back to text and the export still finishes.
- **Polls are drawn as the page shows them**: while the poll is open you get the option buttons, once it closes you get the percentage bars; the page's percentages, leading markers and “N votes · time left” line are kept as they are. When the counts cannot be read, no result bars are drawn and no zeroes are invented.
- **Badges and labels stay as they appear**: blue, gold (business and organisation accounts) and grey (government organisations) verification badges, plus the organisation icon after a name and the square avatar of a business account.
- **If the page shows a translation, the translation is exported**: exactly what the page displays.
- **The footer carries the source**: the bottom of the card shows the original post's URL (with “· N posts” for a thread) and “推笺 PostNote”, so a shared image can always be traced back.
- The timestamp row matches X's detail view: time · date · N views; replies / reposts / likes / bookmarks are written the way X writes them.
- Engagement numbers only show what the page actually provides; if a number cannot be read it is left out rather than replaced with 0.
- **In a narrow column the entry steps aside**: when the action bar in the right column of the photo viewer has no room, the entry moves to the left of the “⋯” in the post header instead of squeezing the numbers.
- Results come back in a toast at the bottom-right of the page: generating, saved, the reason for a failure, and the output scale actually used; click an error to dismiss it.
- File names: `postnote-<author>-<post ID>.png`, or `postnote-thread-<count>-<root post ID>.png` for a thread.
- If even the longest post does not fit, PostNote exports at the largest scale that fits and states the **actual scale and pixel size** in the notice; it only refuses when even 1× is too large.

## Not supported

- Other card types (such as `unified_card`) are not drawn as link previews; if a card cannot be read in full, the text link stays in the post.
- Video and GIF only contribute their cover: the stream itself never enters the image, matching how X displays them (cover plus badge).
- Collapsed long posts: before exporting, PostNote opens the page's own “Show more” and reads the whole text (the page stays expanded, exactly as if you had clicked it yourself). If it cannot be expanded, the export stops with a notice instead of giving you half a post.
- Manual selection or stitching several posts into one tall image: not offered. The automatic thread contains only the ancestor path — no replies from other people at the same level, no ads, no recommendations.
- Very long content is never split across several images.

## Installation

PostNote is available as a Chrome extension and as a userscript. Both have the same features and produce the same images, so install only one.

### Chrome extension (recommended)

Until PostNote is listed in the Chrome Web Store, download `postnote-chrome-0.6.0.zip` (or the latest `postnote-chrome-*.zip`) from [Releases](https://github.com/kanzaki-chiya/postnote/releases), then:

1. Unzip the download.
2. Open `chrome://extensions/` and switch on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the unzipped folder.
4. Reload `x.com` / `twitter.com` and click the PostNote icon beside a post's action bar.

### Userscript (Tampermonkey)

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the [latest postnote.user.js](https://github.com/kanzaki-chiya/postnote/releases/latest/download/postnote.user.js); Tampermonkey opens its install page, click **Install**. Other versions are available in [Releases](https://github.com/kanzaki-chiya/postnote/releases).
3. Reload any `x.com` / `twitter.com` page and click the PostNote icon beside a post's action bar.

> **Running the Chrome extension and the userscript at the same time can produce two entries or make them interfere with each other. Keep only one of them.**

The first save may ask the browser for permission to download multiple files; allow it and you can keep saving.

## Privacy

Nothing is collected or uploaded. Images are generated locally, and the only data read is what the page has already loaded plus X's own image servers. See the [privacy policy](PRIVACY.md) for details.

## Local development

```bash
npm install
npm run dev      # development build, install it as the terminal suggests
npm test         # vitest
npm run build    # type-check, then dist/postnote.user.js, dist/extension/ and dist/postnote-chrome-<version>.zip
```

The version lives only in `package.json` and is read at build time for both the userscript header and the extension manifest.

## Known limitations

- A reply chain can be at most 50 posts deep.
- The chain relies on data the page has already loaded. PostNote covers the whole session when it is installed at `document-start`; if the conversation was loaded before the script took effect (for example, you just installed it while the page was open), the notice says the parent was not in the loaded data and only that one post is saved — reload the page, or click the post's timestamp to open its detail view.
