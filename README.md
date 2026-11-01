# 一纸烟台 · 烟台水果的一百五十年

一个用**烟台剪纸**的视觉语言讲述城市故事的滚动叙事网页。

主线是一船水果：1871 年，倪维思在毓璜顶东边办起「广兴果园」，苹果、樱桃、梨、葡萄一起下了船。
二十一年后，葡萄被酿成了酒；一百五十年后，苹果成了一座城的名字。

十一章：清（下船/葡萄/窖）→ 民国（上厂/上山）→ 新中国（建厂）→ 改革开放（大港）→ 今天（回乡/出海/上天）→ 非遗（剪）。

---

## 为什么做成这样

**别人的作业是「AI 风光片 + 旁白」，我们让非遗当镜头，不当素材。**

- 十一张关键帧就是十一幅剪纸作品，用 AI 生成，边框是画里自带的回纹。
- 最后一章反转：前面看见的码头、独轮车、果园、海，都是一位老艺人剪出来的。非遗从"第五条素材"变成"整部片子的答案"。
- 全站零外部依赖、零构建步骤，一个文件夹扔到任何地方都能打开。

---

## 怎么跑

最简单的方式：双击 `index.html`。

想更接近线上环境（避免个别浏览器的本地文件限制）：

```bash
cd beatuful-yantai
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

部署时把整个目录上传到任意静态空间即可，不需要 Node、不需要打包。

但别把 `concept/` 一起传上去——131 MB 的分镜母版是给评审看的，不是给访客下载的。
正式发布用下面这条流水线。

---

## 线上地址

| 用途 | 地址 |
|---|---|
| 正式站点 | <https://fruit.bigcow.net/> |
| Pages 预览域 | <https://fruit-3cq.pages.dev/> |
| 源码 | <https://github.com/zhuguangjun2002/yizhi-yantai> |

托管在 Cloudflare Pages，git 推送即部署，没有服务器要养。

---

## 部署

### 自动（推荐）

推到 `main` 就完事：

```bash
git push origin main
```

`.github/workflows/deploy.yml` 会跑 `tools/build-site.sh` 生成 `dist/`，
再交给 `cloudflare/wrangler-action` 发布。约 20 秒后 <https://fruit.bigcow.net/> 生效。

需要的两个仓库 Secret（Settings → Secrets and variables → Actions）：

| Secret | 从哪来 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 控制台 → My Profile → API Tokens，权限至少 `Cloudflare Pages:Edit` + `Zone:DNS:Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | 控制台右下角 Account ID，或 `npx wrangler whoami` |

也可以命令行灌进去，省得手点：

```bash
gh secret set CLOUDFLARE_API_TOKEN --body "$CLOUDFLARE_API_TOKEN"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "<account-id>"
```

### 手动（网络断了/CI 抽风时）

```bash
bash tools/build-site.sh
npx wrangler pages deploy dist --project-name=fruit --branch=main
```

`wrangler.toml` 里已经写好项目名和产物目录，所以其实 `npx wrangler pages deploy` 就够了，
上面那条只是把话说清楚。

### 这套配置里几个不太显然的点

- **只发白名单**：`tools/build-site.sh` 明确拷贝 `index.html`、`404.html`、`_headers`、`assets/`。
  以后新增草稿目录默认不会误上线——黑名单式的"排除 concept"迟早会漏。
- **不能对图片用 `immutable`**：`assets/img/` 的文件名没有内容指纹，换图是直接覆盖同名文件。
  真上一年缓存，改了图老访客要等明年才看见。所以 `_headers` 里给的是 1 小时 + `stale-while-revalidate`。
- **自定义域名的 CNAME 要自己确认**：Pages 项目加域名后，若 DNS 记录没自动生成，
  手动加一条 `fruit` → `fruit-3cq.pages.dev` 的 CNAME 并开代理（橙云）。
  证书由 Google Trust Services 签发，通常几分钟内就绪。
- **`404.html` 不是装饰**：没有它时 Cloudflare 会把未知路径兜回首页并返回 200，
  搜索引擎会以为全世界都是你的首页。
- **成片不参与发布**：`tools/build-site.sh` 只拷 `index.html`、`404.html`、`_headers`、`assets/`，
  `video/` 留在本地。别为了「顺便托管」把它塞进 `dist/`，Pages 的流量不是给你发片的。

---

## 成片

| 文件（`video/` 下） | 画面 | 时长 | 体积 |
|---|---|---|---|
| `yizhi-yantai-vertical-1080x1920.mp4` | 1080×1920 | 100.3 s | 30 MB |
| `yizhi-yantai-vertical-720x1280.mp4` | 720×1280 | 100.3 s | 14 MB |
| `yizhi-yantai-1080p.mp4` | 1920×1080 | 90.5 s | 13 MB |
| `yizhi-yantai-720p.mp4` | 1280×720 | 90.5 s | 6.4 MB |

- 编码：H.264 High / 30 fps / CRF 22–23 / `+faststart`，音频 AAC 192k。
- 配乐：**《月光》（Clair de lune）**，Debussy 作曲（公有领域）；录音由 Laurens Goedhart 演奏，
  Wikimedia Commons 标注为公有领域。取自原曲 0:20，2.5 秒淡入、4 秒淡出，
  整体归一 **-20 LUFS**、真峰值 **-2 dBTP**。
- 署名已压进片尾卡右下角：`《月光》Debussy｜录音 Laurens Goedhart｜Public Domain`。
- 来源与授权细节见 `video/CREDITS.md`。
- `*-silent.mp4` 是无声版，留着给二次剪辑或换曲。

竖版不是把横版裁成 9:16——它走的是站点自己的移动端版式（图在上、文在下，回纹边框完整），
用 540×960 CSS @2x 渲染成 1080×1920。

**怎么做出来的**（别用录屏软件）：Chrome headless 通过 CDP `Page.startScreencast` 逐帧抓图，
滚动由页面内的缓动脚本驱动，停留时长按章节字数分配；竖版在收尾处额外下摇，
把「一纸烟台，剪了一百五十年」推进画面，并在片尾卡淡入前藏掉页脚（那里有二维码占位框）。
帧序列按时间戳转成 30 fps 恒定帧率，再与片尾卡交叉淡入、混入音轨。

> 抓帧脚本是一次性工具，没有随仓库提交——这是本次交付留下的已知缺口，见「下一步」。
> 重新做时别改用屏幕录制：字体渲染不同、掉帧，观感差一截。

---

## 目录

```
index.html              页面结构
404.html                找不到页面时的落款
_headers                Cloudflare 响应头（缓存与安全）
assets/css/style.css    版式、纸色、转场
assets/js/main.js       滚动叙事控制
assets/img/             十一张关键帧（1536×1024 WebP，三档尺寸）
concept/dashscope-final 十一张原图（1536×1024 PNG，母版）
tools/gen-keyframes.py  重新生成关键帧的脚本
tools/build-site.sh     发布前打包，只挑该上线的文件
docs/                   美术设定（风格圣经）
video/                  成片（本地，不进仓库）；CREDITS.md 授权说明入库
wrangler.toml           Cloudflare Pages 项目配置
.github/workflows/      推 main 即部署
```

---

## 页面是怎么动的

| 环节 | 实现 | 说明 |
|---|---|---|
| 切场景 | `main.js` 按滚动位置判断当前章节 | 只切 `.is-active`，动画交给 CSS |
| 末章反转 | 整块画面收缩成一张纸 | 挂在最后一个 `.ch` 上，加章节不用改 JS |
| 移动端 | 场景从固定舞台搬回每一章里 | 钉不住的画就别钉了 |
| 文字 | 段落进视口时浮起 | IntersectionObserver |

**加一章要改三处**：`index.html` 加 `<section class="ch" data-chapter="6">` 和 `<div class="scene" id="scene-6">`、导航加一项、准备一张 1600×1073 的图。

---

## 关键帧规格

| 项 | 值 |
|---|---|
| 尺寸 | 1536 × 1024（3:2，与 `--scene-ratio` 一致） |
| 格式 | WebP |
| 三档 | 800w / 1080w / 1536w |
| 单张体积 | 37–235 KB（按档位） |

浏览器按 `sizes="(max-width: 900px) 86vw, 620px"` 自己挑：手机 3x 拿 1080w，
桌面 2x 拿 1536w。第一张另加了 `<link rel="preload" imagesrcset>`，早一点开始下载。

实测（390×844 @3x）：首屏只拉第 1、2 张，约 188 KB；整页读完约 430 KB，
比不分档的 968 KB 省一半以上。桌面端仍然吃满 1536w。
| 构图要求 | **回纹边框必须完整**——`object-fit: contain`，裁一点就破相 |

换成新图只要覆盖 `assets/img/scene-N.webp`，代码一行不用改。

## 重新生成

```bash
export DASHSCOPE_API_KEY=sk-xxxx
python3 tools/gen-keyframes.py
```

脚本走阿里百炼 `wan2.5-t2i-preview`，异步提交 + 轮询，十一张约八分钟。
参数里有四个坑，脚本注释都写了：`prompt_extend` 会改掉边框和配色、`watermark` 不写就带署名、
负向词不写红色会飘成玫红、不描述"多层纸片叠压"就出扁平矢量图。

历史版本：`concept/qwen-image-3.0-clean/`（千问网页版，有厚度但有水印）、
`concept/compare/qwen-vs-wan.png`（两套对照）。

---

## 史料核对

页面里每条年代都查过公开资料，主要来源：张裕官网「百年历程」、烟台市档案馆、烟台市情资料库、
张裕酒文化博物馆、三环官网、万华官网、央视网与澎湃关于西港区 40 万吨码头的报道。

查证过程中改掉的三处错误，留个记录：

| 原来写的 | 实际 | 来源 |
|---|---|---|
| 酒窖「地下三米」 | **地下七米**，低于海平面一米 | 张裕官网、百度百科 |
| 宝时厂「1915 年出第一只钟」 | 1915 建厂，**1918** 才出第一批「宝」字牌摆钟 | 烟台市档案馆、李东山词条 |
| 啤酒厂「中国人开始自己酿啤酒」 | 1920 年胶东醴泉啤酒厂，**全国第二家**国人自办 | 烟台市志·啤酒辑 |

其余已核实：1892 张裕创办、1892—1896 三次引种 124 个品种、1912 孙中山题「品重醴泉」、
1915 巴拿马金奖、1931 解百纳（中国第一瓶干红）、1987 国际葡萄·葡萄酒城、1978 合成革厂立项、
2005—2011 西港区、2020 年 40 万吨矿石码头投用、2019 年起海阳东方航天港海上发射、
2021 年 11 月烟台苹果随神舟十三号进入空间站。

**第九章为什么能讲火箭**：不是硬凑。2021 年 11 月 18 日，烟台籍航天员王亚平在天和核心舱里
吃苹果的视频传回地面，那批苹果来自栖霞的供货基地。所以「我上过天」是事实，不是比喻——
一头把火箭送上天，一头把苹果送上天，这才是这一章的骨。

## 几个坑，先说在前面

**史实**：倪维思 1871 年引入西洋苹果、1861 年烟台开埠、1892 年张裕创办，这几条要经得起查。画面一律标注"艺术化演绎，非史料影像"——页脚已经写了，别删。

**红色题材的分寸**：不出现具体英烈的肖像。用独轮车、一筐果子、山路说话。克制比煽情有力。

**边框不能裁**：`object-fit` 必须是 `contain`。用 `cover` 会把画里的回纹切掉一截，那是这张图最贵的地方。

**水印**：原图右下角有平台署名，已用字形蒙版 + 镜像取样修掉。近看底边框右段比左段软一点，760px 显示尺寸下看不出来。要彻底干净，请用平台的无水印导出。

**中文字**：任何 AI 生成的图里都不要出现文字，糊得没法看。文字全部由 HTML 渲染。

**移动端**：`(max-width: 900px)` 时场景会从固定舞台搬进每一章。这是刻意的——固定画布在窄屏上会被正文压穿。

**无障碍**：尊重系统的「减少动态效果」设置，转场会自动关闭。

---

## 下一步可以做的

- [ ] 再生成一版别家模型的关键帧，横向比风格
- [ ] 补 3–5 个实拍空镜（老艺人的手、剪刀、红纸屑、真苹果、海面），与 AI 图交替
- [x] 剪一版竖屏成片（1080×1920，移动端版式，见「成片」）
- [ ] 把这套抓帧流程收进 `tools/video/`：目前只有 README 里的思路，脚本还是一次性的
- [ ] 页脚二维码换成线上地址
- [ ] 加一份「提示词 → 生成图 → 成片」的对照页，评审时最好用
- [ ] 若甲方要求音乐完全自有，把《月光》换成本地录制的原创或已购授权（换曲只需重混音轨，画面不用重编）
