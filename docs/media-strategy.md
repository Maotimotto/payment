# Media Strategy

汐账可以收很多人生视野原片，但页面不能一次性加载全部文件。当前实现采用这套规则：

- 首屏只播放当前视频。
- 只轻量预热下一条视频的 metadata。
- 用户打开省流模式、慢速网络或减少动效时，不再切到图片，只切换为更保守的加载策略。
- 下滑视频章节进入视口后才挂载，图表库也延迟加载。
- 新素材只进入 `src/lib/lifeMedia.ts` 清单，不直接散落在页面组件里。
- 页面不使用图片海报作为素材层；视觉资产以原始视频为准。

## Source Policy

当前目标是原画质播放，不做前端转码压缩：

- `original`: 原片保留在素材库或媒体服务器。
- `dev`: 本地开发优先从 `~/Desktop/video/browser-mp4` 读取浏览器兼容版；没有兼容版时回退到 `~/Desktop/video/mp4格式` 原片。
- `production`: 用 `VITE_LIFE_MEDIA_BASE` 指向媒体服务器/CDN，不把原片提交进前端仓库。

## Naming

上线到媒体服务器时建议保留稳定文件名或建立映射：

- `morning-window.mp4`
- `city-return.mp4`
- `mountain-road.mp4`
- `night-desk.mp4`
- `wide-horizon.mp4`

## Page Budget

目标预算：

- Initial HTML/CSS/JS: keep under the app's functional baseline.
- Initial media: only one hero video request.
- Near-future media: at most one metadata prewarm.
- Below-fold sections: no media/component loading until near viewport.

大素材可以很多，但同时在浏览器里活跃的素材必须很少。

## Local Preview Flow

当前新素材保留在 `~/Desktop/video/mp4格式`，不直接提交到仓库。现在这些素材是 4K HEVC/H.265 原片，Safari 通常可以播放，但 Chromium/Electron 内置浏览器容易报格式错误。为了让 Web 端稳定全屏播放视频，而不是降级成图片，本地先生成同分辨率 H.264 兼容版：

```bash
npm run media:transcode
```

输出目录是 `~/Desktop/video/browser-mp4`，原片不会被覆盖。转码参数保留 4K 分辨率，使用 H.264 High Profile、CRF 16、`faststart`，用于浏览器播放兼容性。

`src/lib/lifeMedia.ts` 只保存素材清单和视频 URL；页面首屏按顺序播放 19 段素材，但同一时刻只挂载当前段、切换中的下一段和一个 metadata 预热节点。开发预览时启动：

```bash
npm run media:serve
```

页面会在开发环境从 `http://127.0.0.1:4174` 读取这些 `.mp4`。本地媒体服务由 `scripts/serve-media.mjs` 提供，支持视频 Range 请求；正式构建不会把这些本地视频打包；仓库也忽略 `public/video/*.mov` 和 `public/media/`，避免把大素材误推到 GitHub。

生产环境配置示例：

```bash
VITE_LIFE_MEDIA_BASE=https://media.example.com/life
```

如果原片自身带有内嵌黑边，页面播放层会裁切显示，让视频内容铺满视口；素材文件本身不被改写。
