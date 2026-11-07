# APlayer

> 玻璃拟态悬浮音乐播放器 · 基于 Vue 3 重写，可拖拽、可缩放、带桌面歌词

这是 [MoePlayer/APlayer](https://github.com/MoePlayer/APlayer) 的一个**改版分支**。在保留「一个脚本就能用」的前提下，把 UI/UX 换成了玻璃拟态的悬浮小组件，并补齐了拖拽、缩放、桌面歌词等能力。**不考虑向后兼容**，配置项与事件都按新形态定义。

## 特性

-   **两种形态**：`widget` 悬浮小卡（左下角）/ `full` 全屏卡片（居中，封面在左、歌词在右下方、控件在底部）
-   **玻璃拟态卡片**：贴合站点主题令牌，浅色 / 深色自动跟随
-   **自由拖拽**：按住播放器空白处拖动，位置写入 `localStorage`；越界自动收回
-   **界面缩放**：`Ctrl` / `⌘` + 滚轮（或触控板双指捏合），范围 75%~160%
-   **空闲折叠**：悬浮形态下暂停或指针移开后自动收起控件区（全屏形态常驻展开）
-   **桌面歌词**：悬浮形态为独立浮层，默认停在屏幕正下方居中，可拖拽，右键呼出外观设置；全屏形态收进卡片内。
    歌词统一用 `mix-blend-mode: difference` 与底板**自动反色**（浅底深字 / 深底浅字 / 彩色底补色），
    不再按主题或形态切换颜色，设置里只保留字号调节
-   **显隐与外观**：可整体显示 / 隐藏，可按形态分别调背景不透明度（30%~100%）与模糊度（0~24px）
-   **全部可外部控制**：形态、显隐、外观、歌词、位置都有对应 API
-   **播放列表**：网易云歌单（Meting API）或本地 `audio` 数组
-   **零外部依赖**：样式与模板都打进 JS，引入一个脚本即可

## 安装

```bash
npm install
npm run build
```

产物：

| 文件                   | 说明                                    |
| ---------------------- | --------------------------------------- |
| `dist/APlayer.min.js`  | 完整构建（Vue 运行时 + 模板 + 样式）    |
| `dist/APlayer.min.css` | 单独抽出的样式，可用 `<link>` 提前加载  |
| `dist/APlayer.min.js.map` | Source map                           |

## 使用

```html
<script src="dist/APlayer.min.js"></script>
<script>
    const ap = new APlayer({
        container: document.getElementById('aplayer'),
        audio: [
            { name: '歌曲名', artist: '歌手', url: 'https://.../a.mp3', cover: 'https://.../cover.jpg', lrc: 'https://.../a.lrc' },
        ],
    });
</script>
```

> `container` 请传一个专用节点，不要直接传 `document.body`——挂载会替换容器内容。万一传了 body，
> 播放器会自动插入 `.aplayer-host` 节点兜底，不会清空页面。

### 配置项

| 名称            | 类型       | 默认值                | 说明                                          |
| --------------- | ---------- | --------------------- | --------------------------------------------- |
| `container`     | `Element`  | —（必填）             | 播放器挂载的容器                              |
| `audio`         | `Array`    | `null`                | 本地歌单，传了就不再请求网络                  |
| `playlistId`    | `string`   | `'18022003523'`       | 网易云歌单 ID                                 |
| `server`        | `string`   | `'netease'`           | Meting API 的 `server` 参数                   |
| `type`          | `string`   | `'playlist'`          | Meting API 的 `type` 参数                     |
| `api`           | `string`   | `''`                  | 自定义歌单接口，覆盖上面的拼接结果            |
| `volume`        | `number`   | `0.7`                 | 初始音量 0~1                                  |
| `lyrics`        | `boolean`  | `true`                | 是否启用歌词                                  |
| `mode`          | `string`   | `'widget'`            | 初始形态：`widget` 悬浮小卡 / `full` 全屏卡片 |
| `visible`       | `boolean`  | `true`                | 初始是否显示                                  |
| `collapseDelay` | `number`   | `500`                 | 空闲多久后折叠（毫秒，仅悬浮形态）            |

### 方法

```js
ap.play();
ap.pause();
ap.toggle();
ap.next();
ap.prev();
ap.switchTo(0); // 切到指定下标
ap.seek(30); // 跳到第 30 秒
ap.volume(0.5); // 设置音量；不传值则返回当前音量
ap.scale(1.2); // 设置界面缩放；不传值则重置为 100%
ap.destroy();
```

### 形态、显隐与外观（外部控制）

```js
/* 形态：widget 悬浮小卡 / full 全屏卡片 */
ap.mode(); // → 'widget' | 'full'
ap.mode('full'); // 切到全屏卡片
ap.toggleMode(); // 两种形态来回切

/* 显隐：隐藏时音频继续播放 */
ap.visible(); // → true | false
ap.hide();
ap.show();
ap.toggleVisible();

/* 外观：背景不透明度与模糊度，两种形态各自独立 */
ap.style(); // → { widget: { opacity, blur }, full: { opacity, blur } }
ap.style({ opacity: 0.8, blur: 20 }); // 只改当前形态
ap.style({ widgetOpacity: 0.9, fullBlur: 24 }); // 指定形态（card* 亦可作为 full* 的别名）

/* 歌词与位置 */
ap.lyrics(false); // 关掉歌词；不传值则读取状态
ap.toggleLyrics();
ap.position({ left: 40, top: 200 }); // 播放器位置；传 null 回到默认位置
ap.lyricsPosition({ x: 120, y: 300 }); // 歌词浮层位置
ap.lyricsPosition({ centered: true }); // 歌词回到屏幕正下方居中
```

### 事件

```js
ap.on('play', (song) => {});
ap.on('pause', (song) => {});
ap.on('ended', (song) => {});
ap.on('switch', (song) => {});
ap.on('timeupdate', ({ currentTime, duration }) => {});
ap.on('volumechange', (value) => {});
ap.on('loopchange', (mode) => {}); // list | one | shuffle
ap.on('modechange', (mode) => {}); // widget | full
ap.on('visiblechange', (visible) => {});
ap.on('appearancechange', ({ mode, opacity, blur }) => {});
ap.on('lyricschange', (visible) => {});
ap.on('playlist', (list) => {});
ap.on('lyrics', (lines) => {});
ap.on('error', (err) => {});
```

## 主题融合

播放器全部颜色走 CSS 变量，站点定义了这些令牌就会自动接管，未定义则回退内置配色：

```css
:root {
    --bg-color: #f4f3f0;
    --surface-color: #ffffff;
    --text-color: #23231f;
    --text-secondary: #6d6d66;
    --accent-color: #ab4f57;
    --accent-light: #cd8189;
    --accent-rgb: 171, 79, 87;
    --border-color: #e4e1da;
    --border-light: #edebe5;
    --shadow-md: 0 6px 18px rgba(35, 35, 31, 0.06);
    --radius-lg: 14px;
    --radius-xl: 18px;
    --font-sans: ...;
}
```

深色主题只需在 `[data-theme='dark']` 下覆盖同一组变量即可，播放器会随之切换。

## 本地存储

| Key                       | 内容             |
| ------------------------- | ---------------- |
| `player-widget-position`  | 两种形态各自的播放器位置 |
| `player-widget-scale`     | 界面缩放             |
| `player-widget-collapsed` | 折叠状态             |
| `player-widget-mode`      | 当前形态             |
| `player-widget-appearance`| 两种形态的不透明度与模糊度 |
| `lyrics-position`         | 歌词浮层位置（无记录时居中） |
| `lyrics-visible`          | 歌词显隐             |
| `lyrics-settings`         | 歌词字号（颜色自动反色，不再存储色值） |

> 显隐状态不写入存储：刷新后播放器会重新出现，避免出现“播放器找不到了”的困惑。

## 开发

```bash
npm run dev     # 非压缩构建，便于调试
npm run build   # 生产构建
npm run test    # 在 DOM 环境里真实挂载一次，校验结构与接口
```

源码结构：

```
src/
├── index.js          # APlayer 类与对外接口
├── player.js         # 组件逻辑（setup）
├── template.js       # 模板（构建期编译成 render 函数）
├── style.css         # 玻璃拟态样式
├── lrc.js            # LRC 解析
├── storage.js        # localStorage 读写
├── emitter.js        # 事件总线
└── inject-style.js   # 样式注入
```

模板在构建期由 `build.mjs` 编译成 `src/render.generated.cjs`，因此运行时只需要 Vue 的 runtime 版本，产物更小。

## 许可

[MIT](./LICENSE) © Xinyang-Gao，原始项目 © DIYgod。
