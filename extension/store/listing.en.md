# Chrome Web Store listing · English

Field by field, ready to copy into the developer dashboard.

## Name

推笺 · PostNote

## Short description (max. 132 characters)

Save posts from X as clean, shareable PNG images.

## Detailed description

Export a single post — or a whole reply thread — from X / Twitter as one shareable PNG image.

- Click the PostNote icon beside a post's action bar to generate the image and download it straight away, with no dialog in between.
- Click a reply and the image runs from the root post down to that reply, with thread connector lines drawn in.
- Text, line breaks, links, mentions, hashtags, emoji, photos and author avatars are kept as they are.
- Quoted posts, link preview cards, polls, and video / GIF covers are drawn the way X shows them.
- Blue, gold and grey verification badges and organisation labels stay intact.
- Timestamps, view counts and engagement numbers follow the same formatting as X's detail view.
- The footer records the original post's URL, so a shared image can always be traced back.

Supports X / Twitter (`x.com`, `twitter.com`) only. No data is collected, and images are generated locally in the browser.

## Single purpose statement

Export posts from X as PNG images.

## Permission justifications

- Content scripts (`https://x.com/*`, `https://*.x.com/*`, `https://twitter.com/*`, `https://*.twitter.com/*`): inject the export button beside posts, read the post that was clicked, and observe the page's own already-loaded post data in the active tab's memory only, to build reply threads.
- Host permission `https://pbs.twimg.com/*`: fetch avatars, post images, video / GIF covers and link card thumbnails from X's image servers, so the exported PNG can embed them.
- Host permission `https://abs.twimg.com/*`: fetch Twemoji graphics from X's static asset server, so emoji in the exported image match the page.
- No other permissions are requested (no `tabs`, `downloads`, `storage`, `cookies`, `history`, and no `<all_urls>`).
- No remote code is loaded: the capture engine and all logic are bundled inside the extension, and no script is downloaded or executed from the network.

## Data usage disclosures

Select "No data collected" for every category:

- Personally identifiable information
- Health and fitness
- Financial and payment information
- Authentication information
- Personal communications
- Location
- Web history
- User activity
- Website content

No third-party analytics or tracking data is used or transferred.

## URLs

- Homepage: https://github.com/kanzaki-chiya/postnote
- Support: https://github.com/kanzaki-chiya/postnote/issues
- Privacy policy: https://github.com/kanzaki-chiya/postnote/blob/main/PRIVACY.md
