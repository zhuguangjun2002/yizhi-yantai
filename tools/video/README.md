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

# 带解说：先合成台词，再拍。产物是 *-narrated.mp4，不覆盖上面的短版
export MINIMAX_API_KEY=...
node tools/video/narrate.mjs
node tools/video/make-video.mjs --narration --music /path/to/music.wav
```

产物写到 `video/`：`*-1080p.mp4` / `*-720p.mp4`（横）、`*-1080x1920.mp4` / `*-720x1280.mp4`（竖）。
中间帧在 `build/video/`，默认跑完就删；加 `--keep-frames` 留着排查。

## 依赖

| 东西 | 说明 |
|---|---|
| Node 22+ | 用到内置 `WebSocket` 和 `fetch`，不需要装任何 npm 包 |
| Chrome | `google-chrome` 在 PATH 里，或用 `CHROME=/path/to/chrome` 指定 |
| ffmpeg / ffprobe | 编码、混音、响度测量、读解说时长 |
| 中文字体 | 页面本来就用系统字体（Noto Serif CJK SC），缺了会退到别的衬线体 |
| `MINIMAX_API_KEY` | 只有生成解说时需要；`narrate.mjs --dry-run` 可以不联网 |

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
图在上、文在下，剪纸的回纹边框完整。正文精简后，最后一句本来就在画面里，
结尾只做缓慢漂移，不再下摇。

## 调参

都在 `make-video.mjs` 顶部的 `ORIENTATIONS` 里：

| 字段 | 作用 |
|---|---|
| `lead` | 章节顶边落在视窗的百分比，越大画面上方留白越多 |
| `transitionMs` | 换场时长 |
| `hold` | 每章停留：`base + 字数 × perChar`，再夹在 min/max 之间 |
| `driftPx` | 停留期间的缓慢漂移，避免画面像暂停 |
| `card` | 片尾卡的排版尺寸 |

改文案后不用改代码：字数变了，停留时间自己会跟着变。

## 解说

成片可以带一条 MiniMax 合成的人声解说，另存为 `*-narrated.mp4`，不覆盖无声/配乐版。

```bash
export MINIMAX_API_KEY=...
node tools/video/narrate.mjs                        # 台词 → build/narration/*.mp3 + manifest.json
node tools/video/make-video.mjs --narration         # 按解说长度排章节、拼音轨、出 SRT
node tools/video/make-video.mjs --narration --music <配乐> --music-start 20
```

**台词**在 `narration.txt`：`[id]` 对应 `index.html` 的章节 id（`ch1`…`ch11`），`[intro]` 是片头。
段落逐条送进 TTS，段落之间的停顿时长由成片脚本按画面节奏排，所以不用靠空行制造停顿。

**原稿与朗读稿必须一致**：网页正文就是台词。`node tools/video/narrate.mjs --check` 会逐章比对
`index.html` 里的 `.lead` / 普通段落 / `.punch` 和 `narration.txt`，不一致返回 1；
正常合成时也会先检查，不一致就先警告再继续，提醒你这片子会出现「看到的」和「听到的」两套字。

**年份读法**：中文习惯逐位读，`1949 年` 是「一九四九年」，不是「一千九百四十九年」。
`narrate.mjs` 在送 TTS 前把紧跟「年」的四位数字转成汉字数字，页面仍显示阿拉伯数字；
manifest 里同时留 `text`（页面/字幕）和 `spokenText`（实际送合成），方便复核。

**缓存**按「文本 + 模型 + 音色 + 参数」做哈希。改一句只重合成那一句，缓存落在 `build/narration/`。
`narrate.mjs --dry-run` 只解析台词和缓存状态，不联网。

**换音色**：`--voice female-chengshu --speed 1.05`。系统女声有 `female-shaonv`（少女）、
`female-yujie`（御姐）、`female-chengshu`（成熟）、`female-tianmei`（甜美）；
默认 `speech-2.6-hd` + `female-shaonv`。接口默认走 `https://api.minimaxi.com`，
国内站设 `MINIMAX_API_BASE=https://api.minimax.chat`。

**节奏**：有解说的章节，停留时间 = `max(按字数估的阅读时间, 解说时长 + 0.7s)`。
浏览器在每章落位时回报真实时间戳，Node 按这些时间排音轨——不要用「片头 + 每段时长求和」
算偏移，`setTimeout` 和 `requestAnimationFrame` 的零头会累积，跑到第八章就能差出半秒。

**收尾**：正文精简后，最后一章的 punch 已经在画面里，竖版不再额外下摇；
结尾只是缓慢漂移，然后交叉淡入片尾卡。硬要下摇会把剪纸边框切掉，得不偿失。

**响度**：人声归一到 -16 LUFS，配乐在有解说时退到 -27 LUFS（没有解说仍是 -20），
限幅 -1.5 dBFS，AAC 编码后实测约 -1.3 dBTP。先各自归一再用 `amix=normalize=0` 合，别让 ffmpeg 替你把两条轨各除以二。

**字幕**：顺手产出 `*-narrated.srt`（逐段，时间戳跟音轨同源）。片子里不烧字幕——
页面本身就有字，再压一层会打架。SRT 给视频号/YouTube 这类需要 CC 的平台用。

## 配乐

`--music` 接任意音频文件，脚本会截取 `--music-start` 起的片段、2.5 秒淡入、
结尾 4 秒淡出，并把整体归一到 **-20 LUFS / -2 dBTP**（先量一遍再补增益，
loudnorm 单遍经常差 1–2 dB）。带解说时配乐自动降到 **-27 LUFS**，给人声让路。

当前成片用的是德彪西《月光》，公有领域；录音由 Laurens Goedhart 演奏，
Wikimedia Commons 标注为公有领域。署名已压进片尾卡，详见 `../../video/CREDITS.md`。

## 已知限制

- 抓帧依赖 GPU 合成；`--disable-gpu` 会让帧率掉到 20 fps 左右，动作发涩。
  脚本默认开 `--use-angle=gl`，在没有 GPU 的机器上会自动退回软件渲染，只是慢。
- 页面有滚动驱动的动画，所以拍摄期间不要同时跑重负载任务，否则会掉帧。
- 片尾卡是烧进画面的，改署名要重编视频——换音轨不用。
- 解说版比短版长（约 1 分 58 秒 vs 1 分 06–1 分 20 秒），因为章节停留跟着解说走。
  想压短就删 `narration.txt` 里的解释句，别去调 `hold` 的下限，否则人声会被切。
- TTS 按字符计费。`build/narration/` 是缓存，清理 `build/` 后重拍会重新合成。
- 换音色或改台词都会改变每章时长，`*-narrated.srt` 必须和视频一起重出，别混用旧字幕。
