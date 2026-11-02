#!/usr/bin/env node
/**
 * 把静态页面拍成 mp4。
 *
 * 为什么不录屏：屏幕录制会掉帧、字体渲染跟着桌面环境走、分辨率还不受控。
 * 这里用 Chrome 的 Page.startScreencast 抓真实渲染帧，按时间戳重排成恒定帧率，
 * 再和片尾卡交叉淡入、混入音轨。
 *
 * 用法：
 *   node tools/video/make-video.mjs --orientation portrait
 *   node tools/video/make-video.mjs --orientation landscape --music music.mp3 --music-start 20
 *
 * 依赖：Node 22+（自带 WebSocket）、google-chrome（或 CHROME 环境变量）、ffmpeg。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

/** 两种画幅的拍摄参数。数字不是随手填的，见文件末尾「调参」注释。 */
const ORIENTATIONS = {
  landscape: {
    key: 'landscape',
    label: '横版 1920×1080',
    metrics: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
    window: { width: 1920, height: 1080 },
    dsf: 1,
    lead: 0.14,
    transitionMs: 1100,
    driftPx: 26,
    hold: { base: 2200, perChar: 16, min: 4200, max: 6800 },
    card: { eyebrow: 15, title: 52, url: 20, credit: 15, padX: 56, padY: 44 },
    crf: 22,
    level: '4.1',
  },
  portrait: {
    key: 'portrait',
    label: '竖版 1080×1920',
    // 540×960 CSS @2x：走站点自己的移动端版式，图在上、文在下，边框不裁
    metrics: { width: 540, height: 960, deviceScaleFactor: 2, mobile: true,
               screenOrientation: { type: 'portraitPrimary', angle: 0 } },
    window: { width: 540, height: 960 },
    dsf: 2,
    lead: 0.10,
    transitionMs: 1300,
    driftPx: 110,
    hold: { base: 2600, perChar: 16, min: 4800, max: 7200 },
    card: { eyebrow: 13, title: 44, url: 17, credit: 11, padX: 26, padY: 40 },
    crf: 22,
    level: '4.2',
  },
};

const NARRATION_MANIFEST = path.join(REPO_ROOT, 'build', 'narration', 'manifest.json');
/** 解说不早于画面落位，也不贴着换场尾巴开口。 */
const NARRATION_LEAD_MS = 300;
/** 一句说完留半拍，别让下一章的画面在最后一个字上抢跑。 */
const NARRATION_TAIL_MS = 700;

const args = parseArgs(process.argv.slice(2));
const workDir = path.resolve(args.work || path.join(REPO_ROOT, 'build', 'video'));
const outDir = path.resolve(args.out || path.join(REPO_ROOT, 'video'));
const orientationKeys = args.orientation === 'both' || !args.orientation
  ? ['portrait', 'landscape']
  : [args.orientation];

if (!Object.keys(ORIENTATIONS).includes(orientationKeys[0])) {
  fail(`--orientation 只认 portrait / landscape / both，收到 ${args.orientation}`);
}

// 放到所有声明之后执行：类声明有暂时性死区，提前跑会 Cannot access 'Cdp' before initialization
async function main() {
  const narration = await loadNarration(args.narration);
  if (narration) {
    console.log(`解说 ${narration.segments.length} 段 / ${narration.totalSec.toFixed(1)}s`
      + `（${narration.model} · ${narration.voice}）`);
  }

  const server = await startServer(REPO_ROOT);
  const siteUrl = `http://127.0.0.1:${server.port}/`;
  console.log(`静态服务 ${siteUrl}`);

  try {
    for (const key of orientationKeys) {
      const cfg = ORIENTATIONS[key];
      console.log(`\n=== ${cfg.label} ===`);
      await runOrientation(cfg, siteUrl, narration);
    }
  } finally {
    server.server.close();
  }
  console.log('\n完成。');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

/* -------------------------------------------------------------------------- */

async function runOrientation(cfg, siteUrl, narration) {
  const framesDir = path.join(workDir, `frames-${cfg.key}`);
  const cardPath = path.join(workDir, `endcard-${cfg.key}.png`);
  // 解说版另存一份：无声/配乐版是 100 秒的社媒短版，别被两分半的解说版覆盖
  const suffix = narration ? '-narrated' : '';
  const outPath = path.join(outDir, cfg.key === 'portrait'
    ? `yizhi-yantai-vertical-1080x1920${suffix}.mp4`
    : `yizhi-yantai-1080p${suffix}.mp4`);

  await fsp.mkdir(workDir, { recursive: true });
  await fsp.mkdir(outDir, { recursive: true });

  const chrome = await launchChrome(cfg);
  let cdp;
  try {
    cdp = await connect(chrome.port);
    const shots = await capture(cdp, cfg, siteUrl, framesDir, narration);
    await renderEndcard(cdp, cfg, cardPath, narration);

    const total = await encode(cfg, framesDir, cardPath, outPath, shots, args.music, narration);
    console.log(`成片 ${path.relative(REPO_ROOT, outPath)}  ${total.toFixed(2)}s`);

    if (!args['keep-frames']) await fsp.rm(framesDir, { recursive: true, force: true });
  } finally {
    if (cdp) await cdp.send('Browser.close').catch(() => {});
    chrome.proc.kill('SIGTERM');
    await fsp.rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------ 解说清单 -------------------------------- */

async function loadNarration(flag) {
  if (!flag) return null;
  const file = path.resolve(flag === true ? NARRATION_MANIFEST : flag);
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`读不了解说清单 ${path.relative(REPO_ROOT, file)}（${error.message}）。\n`
      + '先跑 node tools/video/narrate.mjs 生成它。');
  }
  if (!Array.isArray(manifest.segments) || manifest.segments.length === 0) {
    throw new Error(`解说清单里没有 segments：${file}`);
  }
  for (const segment of manifest.segments) {
    if (!Number.isFinite(segment.durationSec)) {
      throw new Error(`段落 ${segment.id} 缺 durationSec，重跑 tools/video/narrate.mjs`);
    }
    segment.path = path.isAbsolute(segment.file) ? segment.file : path.join(REPO_ROOT, segment.file);
  }
  return manifest;
}

/** 页面章节的停留时间由解说长度决定，而不是由页面字数决定。 */
function planNarration(narration) {
  if (!narration) return null;
  const holdById = {};
  let introSec = 0;
  for (const segment of narration.segments) {
    if (segment.id === 'intro') { introSec = segment.durationSec; continue; }
    holdById[segment.id] = Math.round(segment.durationSec * 1000);
  }
  return {
    introMs: Math.max(3600, Math.round(introSec * 1000) + 500),
    holdById,
  };
}

/* ------------------------------ 抓帧 -------------------------------------- */

async function capture(cdp, cfg, url, framesDir, narration) {
  const narrationPlan = planNarration(narration);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', cfg.metrics);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });

  const loaded = cdp.waitFor('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;

  // 热身：解码所有图、把图层建好，再把正文的入场动画重置。
  // 不热身，第一次换场会在镜头前解码 1536px 的 WebP，片子会凭空冻住一秒。
  await cdp.send('Runtime.evaluate', { expression: WARMUP, awaitPromise: true });

  await fsp.rm(framesDir, { recursive: true, force: true });
  await fsp.mkdir(framesDir, { recursive: true });

  let frameIndex = 0;
  let first = null;
  let last = null;
  const timestamps = [];
  let writes = Promise.resolve();

  cdp.on('Page.screencastFrame', (params) => {
    frameIndex += 1;
    if (first === null) first = params.metadata.timestamp;
    last = params.metadata.timestamp;
    timestamps.push(last - first);
    const name = `frame-${String(frameIndex).padStart(5, '0')}.jpg`;
    const data = Buffer.from(params.data, 'base64');

    // 先 ack 再落盘：Chrome 拿不到 ack 就不发下一帧，卡住就成了一部 PPT。
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
    writes = writes.then(() => fsp.writeFile(path.join(framesDir, name), data));
  });

  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 88,
    maxWidth: cfg.metrics.width * cfg.dsf,
    maxHeight: cfg.metrics.height * cfg.dsf,
    everyNthFrame: 1,
  });

  const evaluation = await cdp.send('Runtime.evaluate', {
    expression: choreography(cfg, narrationPlan),
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails) {
    const detail = evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text;
    throw new Error(`页面里的拍摄脚本出错：${detail}`);
  }

  await cdp.send('Page.stopScreencast');
  await writes;

  if (frameIndex < 10) throw new Error('只抓到不到 10 帧，Chrome 的 screencast 没有正常工作');

  const duration = last - first;
  const timeline = evaluation.result.value;
  if (!timeline || !Array.isArray(timeline.arrivals)) {
    throw new Error('拍摄脚本没有回报章节落位时间，无法对齐解说音轨');
  }
  await fsp.writeFile(path.join(framesDir, 'timestamps.json'), JSON.stringify(timestamps));
  console.log(`抓帧 ${frameIndex} 帧 / ${duration.toFixed(1)}s（计划 ${(timeline.plannedMs / 1000).toFixed(1)}s）`);
  return { frames: frameIndex, duration, arrivals: timeline.arrivals };
}

const WARMUP = `(async () => {
  document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
  await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
  const bottom = document.documentElement.scrollHeight - window.innerHeight;
  for (let y = 0; y <= bottom; y += 320) {
    window.scrollTo(0, y);
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 16)));
  }
  window.scrollTo(0, 0);

  // 热身会触发所有 IntersectionObserver，正片里文字就不会再浮起来了，重置一次
  const items = document.querySelectorAll('.ch > *');
  items.forEach((el) => el.classList.remove('is-visible'));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -12% 0px' });
    items.forEach((el) => observer.observe(el));
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
})()`;

function choreography(cfg, narrationPlan) {
  const narrationHolds = narrationPlan ? narrationPlan.holdById : {};
  const introMs = narrationPlan ? narrationPlan.introMs : 3600;
  return String.raw`
  (async () => {
    // CSS 的 scroll-behavior:smooth 会和逐帧滚动打架，先按住
    const style = document.createElement('style');
    style.textContent = 'html{scroll-behavior:auto !important}';
    document.head.appendChild(style);

    const narrationHolds = ${JSON.stringify(narrationHolds)};
    const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

    function animateScrollTo(target, duration) {
      const to = clamp(target, 0, maxScroll());
      const from = window.scrollY;
      const started = performance.now();
      return new Promise((resolve) => {
        function step(now) {
          const p = clamp((now - started) / duration, 0, 1);
          window.scrollTo(0, from + (to - from) * easeInOutCubic(p));
          p < 1 ? requestAnimationFrame(step) : resolve();
        }
        requestAnimationFrame(step);
      });
    }

    const chapters = Array.from(document.querySelectorAll('.ch'));
    const unknownIds = Object.keys(narrationHolds).filter((id) => !document.getElementById(id));
    if (unknownIds.length) {
      throw new Error('解说清单里的段落对不上页面章节：' + unknownIds.join(', '));
    }
    const plan = chapters.map((chapter) => {
      const top = chapter.getBoundingClientRect().top + window.scrollY;
      const chars = (chapter.innerText || '').replace(/\s/g, '').length;
      const readingHold = clamp(${cfg.hold.base} + chars * ${cfg.hold.perChar},
                                 ${cfg.hold.min}, ${cfg.hold.max});
      // 有解说时，画面至少陪解说站完；没解说的章节仍然按阅读速度走
      const narrationHold = narrationHolds[chapter.id]
        ? narrationHolds[chapter.id] + ${NARRATION_TAIL_MS}
        : 0;
      return { id: chapter.id, target: top - window.innerHeight * ${cfg.lead},
               hold: Math.max(readingHold, narrationHold) };
    });

    const startedAt = performance.now();
    window.scrollTo(0, 0);
    await wait(${introMs});

    const arrivals = [];
    for (const item of plan) {
      await animateScrollTo(item.target, ${cfg.transitionMs});
      // 记下画面真正落位的时刻，音轨按这个时间排，不按算术平均值
      arrivals.push({ id: item.id, at: performance.now() - startedAt });
      // 停留时缓慢漂移：画面不死，观众也能顺着读完。
      // 正文精简后，最后一章的 punch 本来就在画面里，不用再下摇去追它。
      await animateScrollTo(window.scrollY + ${cfg.driftPx}, item.hold);
    }

    await wait(300);
    return { plannedMs: performance.now() - startedAt, arrivals };
  })()`;
}

/* ------------------------------ 片尾卡 ------------------------------------ */

async function renderEndcard(cdp, cfg, cardPath, narration) {
  const c = cfg.card;
  const credits = [];
  if (args.music) credits.push('《月光》Debussy｜录音 Laurens Goedhart｜Public Domain');
  if (narration) credits.push('配音 MiniMax 语音合成');
  const creditHtml = credits.join('<br>');
  await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      document.querySelectorAll('#endcard').forEach((el) => el.remove());
      document.querySelectorAll('.rail, .progress, .stage, .site-footer, section, header')
        .forEach((el) => { el.style.visibility = 'hidden'; });
      const card = document.createElement('div');
      card.id = 'endcard';
      card.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999', 'display:grid', 'place-items:center',
        'background:#f3ede1', 'opacity:1',
        'font-family:"Noto Serif CJK SC","Noto Serif SC",serif', 'color:#2a2521',
      ].join(';');
      card.innerHTML =
        '<div style="text-align:center">' +
          '<div style="font-size:${c.eyebrow}px;letter-spacing:.55em;color:#6f655a;margin-bottom:${Math.round(c.eyebrow * 2.4)}px">一 纸 烟 台</div>' +
          '<div style="font-size:${c.title}px;letter-spacing:.06em;line-height:1.65">烟台水果的<br>一百五十年</div>' +
          '<div style="margin-top:${Math.round(c.url * 2.5)}px;font-size:${c.url}px;letter-spacing:.12em;color:#a83a2e">fruit.bigcow.net</div>' +
        '</div>' +
        '<div style="position:absolute;right:${c.padX}px;bottom:${c.padY}px;' +
          'font-size:${c.credit}px;letter-spacing:.03em;color:#9c9184;text-align:right">' +
          ${JSON.stringify(creditHtml)} + '</div>';
      document.body.appendChild(card);
    })()`,
  });
  await delay(400);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await fsp.writeFile(cardPath, Buffer.from(shot.data, 'base64'));
}

/* ------------------------------ 编码 -------------------------------------- */

async function encode(cfg, framesDir, cardPath, outPath, shots, musicFile, narration) {
  const timestamps = JSON.parse(await fsp.readFile(path.join(framesDir, 'timestamps.json'), 'utf8'));
  const concatPath = path.join(framesDir, 'concat.txt');
  const filterPath = path.join(framesDir, 'filter.txt');

  // 主片长度 = 最后一帧的时间戳 + 它自己该停留的时长
  const mainDuration = timestamps.at(-1) + Math.max(0.008, timestamps.at(-1) - timestamps.at(-2));
  const fade = 0.9;
  const offset = mainDuration - fade;
  const cardSeconds = 5.6;

  const lines = timestamps.map((t, i) => {
    const next = i + 1 < timestamps.length ? timestamps[i + 1] : t + 0.05;
    return `file '${path.join(framesDir, `frame-${String(i + 1).padStart(5, '0')}.jpg`)}'\nduration ${Math.max(0.008, next - t).toFixed(4)}`;
  });
  lines.push(`file '${path.join(framesDir, `frame-${String(timestamps.length).padStart(5, '0')}.jpg`)}'`);
  await fsp.writeFile(concatPath, lines.join('\n') + '\n');

  const [w, h] = [cfg.metrics.width * cfg.dsf, cfg.metrics.height * cfg.dsf];
  await fsp.writeFile(filterPath,
    `[0:v]fps=30,format=yuv420p,trim=duration=${mainDuration.toFixed(3)}[main];` +
    `[1:v]fps=30,scale=${w}:${h},format=yuv420p[card];` +
    `[main][card]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)},format=yuv420p[v]`);

  const total = mainDuration + 4.7;
  const audio = await prepareSoundtrack({
    musicFile,
    narration,
    arrivals: shots.arrivals,
    total,
  });

  const ffArgs = [
    '-y', '-v', 'warning',
    '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-loop', '1', '-framerate', '30', '-t', String(cardSeconds), '-i', cardPath,
  ];
  if (audio) ffArgs.push('-i', audio);

  ffArgs.push(
    '-filter_complex_script', filterPath,
    '-map', '[v]',
    ...(audio ? ['-map', '2:a'] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(cfg.crf),
    '-profile:v', 'high', '-level', cfg.level,
    '-t', total.toFixed(3),
    ...(audio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart',
    outPath,
  );

  await run('ffmpeg', ffArgs);
  if (audio) await fsp.rm(audio, { force: true }).catch(() => {});

  if (narration) {
    const srtPath = outPath.replace(/\.mp4$/, '.srt');
    await writeNarrationSrt(narration, shots.arrivals, srtPath);
    console.log(`解说字幕 ${path.relative(REPO_ROOT, srtPath)}`);
  }

  // 720p 轻量版：只重编视频，音轨直接复制
  const small = path.join(outDir, cfg.key === 'portrait'
    ? `yizhi-yantai-vertical-720x1280${narration ? '-narrated' : ''}.mp4`
    : `yizhi-yantai-720p${narration ? '-narrated' : ''}.mp4`);
  if (small !== outPath) {
    await run('ffmpeg', [
      '-y', '-v', 'warning', '-i', outPath,
      '-vf', `scale=${cfg.key === 'portrait' ? '720:1280' : '1280:720'}:flags=lanczos`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-profile:v', 'high', '-level', '3.1',
      ...(audio ? ['-c:a', 'copy'] : ['-an']),
      '-movflags', '+faststart', small,
    ]);
    console.log(`轻量版 ${path.relative(REPO_ROOT, small)}`);
  }

  return total;
}

/**
 * 配乐处理：截取 → 淡入淡出 → 归一到目标响度。
 * loudnorm 单遍经常差 1–2 dB，所以量一遍再补一次增益，别交给运气。
 *
 * 有解说时配乐退到 -27 LUFS，给 -16 LUFS 的人声让路；没有解说时仍是 -20 LUFS。
 */
async function prepareAudio(file, startSeconds, total, targetLufs = -20, name = 'audio') {
  const tmp = path.join(workDir, `${name}-trim.wav`);
  const out = path.join(workDir, `${name}-master.wav`);
  const start = Number(startSeconds || 0);
  const fadeOutStart = Math.max(0, total - 4);

  await run('ffmpeg', [
    '-y', '-v', 'error', '-ss', String(start), '-t', total.toFixed(3), '-i', file,
    '-af', `afade=t=in:st=0:d=2.5,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=4`,
    '-ar', '48000', '-ac', '2', tmp,
  ]);

  const measured = await measureLoudness(tmp);
  const gain = (targetLufs - measured.i).toFixed(2);

  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', tmp,
    '-af', `volume=${gain}dB,alimiter=limit=0.794:level=0:attack=5:release=80`,
    '-t', total.toFixed(3), '-ar', '48000', '-ac', '2', out,
  ]);

  await fsp.rm(tmp, { force: true }).catch(() => {});
  return out;
}

/** 解说、配乐各自归好响度再混：混完再归一，人声会被配乐推着忽大忽小。 */
async function prepareSoundtrack({ musicFile, narration, arrivals, total }) {
  const music = musicFile
    ? await prepareAudio(musicFile, args['music-start'], total, narration ? -27 : -20, 'music')
    : null;
  const voice = narration ? await prepareVoice(narration, arrivals, total) : null;

  if (music && voice) return mixTracks(voice, music, total);
  return music || voice;
}

/**
 * 把逐段 mp3 摆到画面上：intro 从片头开始，其余按章节落位时刻加一点提前量。
 * amix 的 normalize=0 很关键——默认会把每条轨道除以输入数，人声会凭空小 6 dB。
 */
async function prepareVoice(narration, arrivals, total) {
  const arrivalById = new Map((arrivals || []).map((item) => [item.id, item.at]));
  const raw = path.join(workDir, 'voice-raw.wav');
  const out = path.join(workDir, 'voice-master.wav');
  const inputs = [];
  const graph = [];

  narration.segments.forEach((segment, index) => {
    const base = segment.id === 'intro' ? 0 : (arrivalById.get(segment.id) ?? 0);
    const startMs = Math.max(0, Math.round(base + NARRATION_LEAD_MS));
    inputs.push('-i', segment.path);
    graph.push(`[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,`
      + `adelay=${startMs}|${startMs}[seg${index}]`);
  });

  const labels = narration.segments.map((_, index) => `[seg${index}]`).join('');
  graph.push(`${labels}amix=inputs=${narration.segments.length}:normalize=0:duration=longest,`
    + `apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)},asetpts=N/SR/TB[voice]`);

  await run('ffmpeg', [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', graph.join(';'),
    '-map', '[voice]', '-ar', '48000', '-ac', '2', raw,
  ]);

  const measured = await measureLoudness(raw);
  if (!Number.isFinite(measured.i)) throw new Error('解说轨是静音，检查 manifest 里的文件');
  const gain = (-16 - measured.i).toFixed(2);

  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', raw,
    '-af', `volume=${gain}dB,alimiter=limit=0.841:level=0:attack=5:release=80`,
    '-t', total.toFixed(3), '-ar', '48000', '-ac', '2', out,
  ]);

  await fsp.rm(raw, { force: true }).catch(() => {});
  return out;
}

async function mixTracks(voice, music, total) {
  const out = path.join(workDir, 'mix-master.wav');
  await run('ffmpeg', [
    '-y', '-v', 'error', '-i', voice, '-i', music,
    '-filter_complex',
    '[0:a][1:a]amix=inputs=2:normalize=0:duration=longest,'
      + 'alimiter=limit=0.841:level=0:attack=5:release=80[a]',
    '-map', '[a]', '-t', total.toFixed(3), '-ar', '48000', '-ac', '2', out,
  ]);
  return out;
}

/* ------------------------------ 字幕 -------------------------------------- */

function writeNarrationSrt(narration, arrivals, outPath) {
  const arrivalById = new Map((arrivals || []).map((item) => [item.id, item.at]));
  const cues = narration.segments.map((segment, index) => {
    const base = segment.id === 'intro' ? 0 : (arrivalById.get(segment.id) ?? 0);
    const start = (base + NARRATION_LEAD_MS) / 1000;
    const end = start + segment.durationSec;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${segment.text}\n`;
  });
  return fsp.writeFile(outPath, cues.join('\n'));
}

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value, size = 2) => String(value).padStart(size, '0');
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor((ms % 3_600_000) / 60_000))}`
    + `:${pad(Math.floor((ms % 60_000) / 1000))},${pad(ms % 1000, 3)}`;
}

async function measureLoudness(file) {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file,
    '-af', 'loudnorm=print_format=json', '-f', 'null', '-',
  ], { allowNonZero: true });
  const match = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
  if (!match) throw new Error('读不出配乐响度，loudnorm 没有输出 JSON');
  const data = JSON.parse(match[0]);
  return { i: Number(data.input_i), tp: Number(data.input_tp) };
}

/* ------------------------------ 浏览器 ------------------------------------ */

async function launchChrome(cfg) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yizhi-chrome-'));
  const port = await freePort();
  const bin = process.env.CHROME || 'google-chrome';
  const proc = spawn(bin, [
    '--headless=new', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--window-size=${cfg.window.width},${cfg.window.height}`,
    `--force-device-scale-factor=${cfg.dsf}`,
    `--user-data-dir=${profile}`,
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=gl',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--mute-audio', '--no-first-run', '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return { proc, port, profile };
    } catch {}
    await delay(100);
  }
  proc.kill('SIGKILL');
  throw new Error(`Chrome 没起来：${bin}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const waiter = this.pending.get(msg.id);
        if (!waiter) return;
        this.pending.delete(msg.id);
        msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
        return;
      }
      (this.listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  waitFor(method) {
    return new Promise((resolve) => this.on(method, resolve));
  }
}

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return new Cdp(ws);
}

/* ------------------------------ 小工具 ------------------------------------ */

function startServer(root) {
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const file = path.join(root, relative);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const data = await fsp.readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

function run(cmd, params, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, params, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || options.allowNonZero) resolve({ stderr });
      else reject(new Error(`${cmd} 退出码 ${code}\n${stderr.slice(-800)}`));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; }
    else out[key] = true;
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
