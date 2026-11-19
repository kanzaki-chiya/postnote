# Chrome 应用商店上架信息 · 简体中文

按 Chrome 开发者后台的字段分节，可直接复制粘贴。

## 名称

推笺 · PostNote

## 简短描述（132 字符以内）

把值得留下的推文，存成一张图。

## 详细说明

在 X / Twitter 上把单条推文或整条回复链导出成一张可以分享的 PNG 图片。

- 点推文操作栏旁的 PostNote 图标即生成图片并直接下载，没有弹窗和多余步骤。
- 点一条回复时，导出的图从主推一路画到这条回复，并画上线程连线。
- 正文、换行、链接、提及、话题、Emoji、图片和作者头像原样保留。
- 引用推文、链接预览卡片、投票、视频与 GIF 封面都按 X 页面上的样子画出。
- 蓝标、金标、灰标与所属组织标识原样保留。
- 时间、查看数与互动数的写法与 X 详情页一致。
- 页脚写明原帖地址，图片转出去也能查回出处。

仅支持 X / Twitter（`x.com`、`twitter.com`）。不收集任何数据，图片在浏览器里本地生成。

## 单一用途说明

把 X 上的推文导出为图片。

## 权限理由

- 内容脚本（`https://x.com/*`、`https://*.x.com/*`、`https://twitter.com/*`、`https://*.twitter.com/*`）：在推文旁注入导出按钮，读取所点击的那条推文，并只在当前标签页的内存中观察页面自己已经加载的推文数据，用来拼接回复链。
- 主机权限 `https://pbs.twimg.com/*`：从 X 的图片服务器取回头像、推文图片、视频 / GIF 封面和链接卡片缩略图，让导出的 PNG 能内嵌这些图片。
- 主机权限 `https://abs.twimg.com/*`：从 X 的静态资源服务器取回 Twemoji 图形，让导出图片里的 Emoji 与页面显示一致。
- 不请求其他任何权限（没有 `tabs`、`downloads`、`storage`、`cookies`、`history`，也没有 `<all_urls>`）。
- 不加载远程代码：截图引擎与全部逻辑都打包在扩展内，不从网络下载或执行任何脚本。

## 数据使用声明

以下类别全部选择「不收集」：

- 个人身份信息
- 健康和健身
- 财务和付款信息
- 身份验证信息
- 个人通讯
- 位置
- 网络记录
- 用户活动
- 网站内容

不使用、也不传输任何第三方分析或追踪数据。

## 网址

- 官方主页：https://github.com/kanzaki-chiya/postnote
- 支持网址：https://github.com/kanzaki-chiya/postnote/issues
- 隐私政策网址：https://github.com/kanzaki-chiya/postnote/blob/main/PRIVACY.md
