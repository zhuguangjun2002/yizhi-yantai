# 成片流水线

把 `index.html` 拍成 mp4。一条命令，两种画幅。

```bash
# 竖版 1080×1920（走移动端版式）+ 配乐
node tools/video/make-video.mjs --orientation portrait \
  --music /path/to/music.wav --music-start 20

# 横版 1920×1080
node tools/video/make-video.mjs --orientation landscape --music /path/to/music.wav

# 两条一起（不加 --orientation 默认就是 both）
node tools/video/make-video.mjs --music /path/to/music.wav
```

产物写到 `video/`：`*-1080p.mp4` / `*-720p.mp4`（横）、`*-1080x1920.mp4` / `*-720x1280.mp4`（竖）。
中间帧在 `build/video/`，默认跑完就删；加 `--keep-frames` 留着排查。

## 依赖

| 东西 | 说明 |
|---|---|
| Node 22+ | 用到内置 `WebSocket`，不需要装任何 npm 包 |
| Chrome | `google-chrome` 在 PATH 里，或用 `CHROME=/path/to/chrome` 指定 |
| ffmpeg | 编码、混音、响度测量 |
| 中文字体 | 页面本来就用系统字体（Noto Serif CJK SC），缺了会退到别的衬线体 |

## 为什么不是录屏

屏幕录制会掉帧、跟着桌面缩放走、还无法精确控制滚动节奏。这里用的是
Chrome DevTools Protocol 的 `Page.startScreencast`：

1. 起一个临时静态服务，Chrome 无头打开页面；
2. 先把所有图解码、图层建好（否则第一次换场会在镜头前解码 1536px 的 WebP，片子凭空冻住一秒）；
3. 按章节落点逐段缓动滚动，停留时间按章节字数分配；
4. 边滚边抓帧，每帧带时间戳；
5. 按时间戳把变帧率素材重排成 30 fps 恒定帧率；
6. 和片尾卡交叉淡入，混入音轨，出 1080 与 720 两档。

竖版不是横版裁的：它用 540×960 CSS @2x 渲染，走站点自己的移动端断点，
图在上、文在下，剪纸的回纹边框完整。片尾前还会把「一纸烟台，剪了一百五十年」
推到画面里，并暂时藏掉页脚（那儿有二维码，不该出现在片子里）。

## 调参

都在 `make-video.mjs` 顶部的 `ORIENTATIONS` 里：

| 字段 | 作用 |
|---|---|
| `lead` | 章节顶边落在视窗的百分比，越大画面上方留白越多 |
| `transitionMs` | 换场时长 |
| `hold` | 每章停留：`base + 字数 × perChar`，再夹在 min/max 之间 |
| `driftPx` | 停留期间的缓慢漂移，避免画面像暂停 |
| `finale` | 竖版收尾镜头（下摇到最后一句） |
| `card` | 片尾卡的排版尺寸 |

改文案后不用改代码：字数变了，停留时间自己会跟着变。

## 配乐

`--music` 接任意音频文件，脚本会截取 `--music-start` 起的片段、2.5 秒淡入、
结尾 4 秒淡出，并把整体归一到 **-20 LUFS / -2 dBTP**（先量一遍再补增益，
loudnorm 单遍经常差 1–2 dB）。

当前成片用的是德彪西《月光》，公有领域；录音由 Laurens Goedhart 演奏，
Wikimedia Commons 标注为公有领域。署名已压进片尾卡，详见 `../../video/CREDITS.md`。

## 已知限制

- 抓帧依赖 GPU 合成；`--disable-gpu` 会让帧率掉到 20 fps 左右，动作发涩。
  脚本默认开 `--use-angle=gl`，在没有 GPU 的机器上会自动退回软件渲染，只是慢。
- 页面有滚动驱动的动画，所以拍摄期间不要同时跑重负载任务，否则会掉帧。
- 片尾卡是烧进画面的，改署名要重编视频——换音轨不用。
