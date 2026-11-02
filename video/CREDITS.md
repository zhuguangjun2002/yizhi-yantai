# 成片与素材授权

## 配乐

**《月光》（Clair de lune）** — Claude Debussy（1862–1918）

- 作曲：公有领域（作者去世逾 70 年）。
- 使用录音：[File:Clair de lune (Claude Debussy) Suite bergamasque.ogg](https://commons.wikimedia.org/wiki/File:Clair_de_lune_(Claude_Debussy)_Suite_bergamasque.ogg)
- 演奏/录音：Laurens Goedhart，该录音在 Wikimedia Commons 标注为 **Public Domain**。
- 取用区间：原录音 0:20 起。短版横 66.5 秒 / 竖 75.5 秒；解说版约 1 分 58 秒（0:20–2:18）。
- 处理：2.5 秒淡入、4 秒淡出。短版整体 -20 LUFS / -2 dBTP；
  解说版配乐垫到 -27 LUFS，与人声混完真峰值 -1.5 dBTP。

署名已压在片尾卡右下角：

> 《月光》Debussy｜录音 Laurens Goedhart｜Public Domain

## 解说（`*-narrated.mp4`）

- 文本：本项目原创，见 `tools/video/narration.txt`（460 字）。
- 年份按中文习惯逐位读（`1949 年` → `一九四九年`），页面与字幕仍显示阿拉伯数字；
  该转写只作用于送进 TTS 的口语文本。
- 合成：MiniMax `speech-2.6-hd`，系统音色 `female-shaonv`（少女）。
- 处理：逐段合成，按画面落位拼接；人声 EBU R128 归一到 **-16 LUFS**，限幅 -1.5 dBFS，AAC 编码后真峰值约 **-2.7 dBTP**。
- 片尾卡署名：

> 配音 MiniMax 语音合成

**这是 AI 合成语音，不是真人录音。** 发布到要求披露 AI 生成内容的平台时，请保留片尾署名；
若平台要求更细，可一并标注模型与音色：`MiniMax speech-2.6-hd / female-shaonv`。

音色是 MiniMax 账号提供的系统音色，商用授权以账号当前的服务条款为准。
换了音色或模型，记得同步改这里和 `build/narration/manifest.json` 里的记录。

## 视频

由 `index.html` + `assets/` 的静态页面在 540×960@2x / 1920×1080 下逐帧抓取后编码，画面与线上 <https://fruit.bigcow.net/> 一致。

| 文件 | 画面 | 时长 | 音频 |
|---|---|---|---|
| `yizhi-yantai-vertical-1080x1920.mp4` | 1080×1920 | 75.5 s | 配乐 AAC 192k |
| `yizhi-yantai-vertical-720x1280.mp4` | 720×1280 | 75.5 s | 配乐 AAC 192k |
| `yizhi-yantai-1080p.mp4` | 1920×1080 | 66.5 s | 配乐 AAC 192k |
| `yizhi-yantai-720p.mp4` | 1280×720 | 66.5 s | 配乐 AAC 192k |
| `yizhi-yantai-vertical-1080x1920-narrated.mp4` | 1080×1920 | 118.2 s | 解说 + 配乐 AAC 192k |
| `yizhi-yantai-vertical-720x1280-narrated.mp4` | 720×1280 | 118.2 s | 解说 + 配乐 AAC 192k |
| `yizhi-yantai-1080p-narrated.mp4` | 1920×1080 | 115.3 s | 解说 + 配乐 AAC 192k |
| `yizhi-yantai-720p-narrated.mp4` | 1280×720 | 115.3 s | 解说 + 配乐 AAC 192k |

`*-silent.mp4` 为无音轨版本，用于二次剪辑或替换配乐。
`*-narrated.mp4` 的配乐沿用上面的《月光》录音，从原曲 0:20 截取，
在解说下方垫到 -27 LUFS；人声 -16 LUFS，限幅 -1.5 dBFS，AAC 编码后真峰值约 -2.7 dBTP。
