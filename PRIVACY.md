# 隐私说明 · Privacy Policy

适用范围：推笺 · PostNote 的 Chrome 扩展与油猴脚本。英文版本见下方。

## 不收集任何数据

PostNote 不收集、不存储、不追踪，也不上传任何个人信息、浏览记录或推文内容。没有账号，没有统计上报，没有第三方分析，也不加载任何远程代码。

## 处理的数据及其去向

- 从 X 页面自身的请求中观察到的推文数据严格只保存在当前标签页的内存里，标签页关闭或刷新后即丢弃。它只用于还原回复链、在本地画出导出的 PNG 图片。
- 导出的图片在浏览器本地生成，直接保存到你的设备，不经过任何服务器。
- 生成图片所需的头像、推文图片、视频 / GIF 封面、链接卡片缩略图和 Twemoji 图形，从 X 自己的图片服务器读取。

## Chrome 扩展申请的权限

| 权限 | 用途 |
| --- | --- |
| 内容脚本：`https://x.com/*`、`https://*.x.com/*`、`https://twitter.com/*`、`https://*.twitter.com/*` | 注入 PostNote 导出按钮，读取所点击的那条推文，并在内存中观察页面自身已经加载的 GraphQL 响应，用来拼接回复链。 |
| 主机权限：`https://pbs.twimg.com/*`、`https://abs.twimg.com/*` | 由后台工作线程取回头像、推文图片、视频 / GIF 封面、链接卡片缩略图和 Twemoji 图形，让生成的 PNG 能内嵌这些图片而不受 CORS 限制。 |

除此之外不申请任何权限：没有 `tabs`、`downloads`、`storage`、`cookies`、`history`，也没有 `<all_urls>`。不使用任何第三方分析服务，不加载远程代码。

## 联系方式与源码

- 源码：https://github.com/kanzaki-chiya/postnote
- 问题反馈：https://github.com/kanzaki-chiya/postnote/issues

---

# Privacy Policy (English)

Applies to the Chrome extension and the userscript of 推笺 · PostNote.

## No data is collected

PostNote does not collect, store, track, or upload any personal data, browsing history, or tweet content. There are no accounts, no telemetry, no third-party analytics, and no remote code is loaded.

## What is processed, and where it goes

- Tweet data observed from X's own page requests stays strictly in the active tab's memory and is discarded when the tab is closed or reloaded. It is used solely to reconstruct reply chains and render the exported PNG locally.
- Exported images are generated locally in the browser and saved directly to your device; they never pass through a server.
- Avatars, tweet images, video / GIF covers, link card thumbnails, and Twemoji graphics are read from X's own image servers.

## Permissions requested by the Chrome extension

| Permission | Purpose |
| --- | --- |
| Content scripts: `https://x.com/*`, `https://*.x.com/*`, `https://twitter.com/*`, `https://*.twitter.com/*` | Inject the PostNote export button, read the clicked post, and observe the page's own already-loaded GraphQL responses in memory to build reply threads. |
| Host permissions: `https://pbs.twimg.com/*`, `https://abs.twimg.com/*` | Fetch avatars, tweet images, video / GIF covers, link card thumbnails, and Twemoji graphics in the background worker, so the rendered PNG can embed them without CORS errors. |

No other permissions are requested: no `tabs`, `downloads`, `storage`, `cookies`, `history`, and no `<all_urls>`. No third-party analytics are used and no remote code is loaded.

## Contact and source

- Source: https://github.com/kanzaki-chiya/postnote
- Issues: https://github.com/kanzaki-chiya/postnote/issues
