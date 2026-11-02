#!/usr/bin/env node
/**
 * 用 MiniMax 语音合成把 narration.txt 变成成片可用的解说音轨。
 *
 * 为什么单独一个脚本：TTS 是唯一花钱、而且慢的环节。把「合成」和「拍摄」拆开，
 * 改一句词只重合成那一段（按文本+音色哈希缓存），不必为了听一句台词重拍两分钟的片子。
 *
 * 用法：
 *   node tools/video/narrate.mjs
 *   node tools/video/narrate.mjs --voice female-chengshu --speed 1.05
 *   node tools/video/narrate.mjs --dry-run          # 只解析台词和缓存状态，不联网
 *
 * 依赖：Node 22+（自带 fetch）、ffprobe。需要 MINIMAX_API_KEY。
 * 产物：build/narration/<id>-<hash>.mp3 + manifest.json（都在 gitignore 的 build/ 里）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const DEFAULTS = {
  script: path.join(HERE, 'narration.txt'),
  out: path.join(REPO_ROOT, 'build', 'narration'),
  model: 'speech-2.6-hd',
  voice: 'female-shaonv',
  speed: 1,
  pitch: 0,
  vol: 1,
  sampleRate: 32000,
  // api.minimaxi.com 是国际站；国内站换 https://api.minimax.chat。
  apiBase: process.env.MINIMAX_API_BASE || 'https://api.minimaxi.com',
};

const args = parseArgs(process.argv.slice(2));

async function main() {
  const scriptPath = path.resolve(args.script || DEFAULTS.script);
  const outDir = path.resolve(args.out || DEFAULTS.out);
  const dryRun = Boolean(args['dry-run']);

  const config = {
    model: args.model || DEFAULTS.model,
    voice: args.voice || DEFAULTS.voice,
    speed: Number(args.speed ?? DEFAULTS.speed),
    pitch: Number(args.pitch ?? DEFAULTS.pitch),
    vol: Number(args.vol ?? DEFAULTS.vol),
    sampleRate: Number(args['sample-rate'] || DEFAULTS.sampleRate),
  };

  const segments = parseScript(await fs.readFile(scriptPath, 'utf8'));
  if (segments.length === 0) throw new Error(`${scriptPath} 里没有可合成的段落`);

  // 原稿和朗读稿必须是同一份字。否则片子里会出现「看到的」和「听到的」两套文案。
  const mismatches = await compareWithPage(segments);
  if (args.check) {
    printConsistency(mismatches);
    process.exit(mismatches.length ? 1 : 0);
  }
  if (mismatches.length) {
    console.warn('\n  ⚠ index.html 的正文与朗读稿不一致：');
    for (const item of mismatches) console.warn(`    ${item.id}：${item.reason}`);
    console.warn('  先改成同一份字，或跑 node tools/video/narrate.mjs --check 看差异。\n');
  }

  await fs.mkdir(outDir, { recursive: true });

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey && !dryRun) {
    throw new Error('没有 MINIMAX_API_KEY。先 export，或者加 --dry-run 只看台词。');
  }

  const records = [];
  let synthesised = 0;

  for (const segment of segments) {
    // 中文习惯里，四位年份是逐位读的：「1949 年」→「一九四九年」。
    // 页面继续显示阿拉伯数字，只把送去合成的文本转写；两者意思相同，不破坏原稿一致性。
    const spoken = speakYears(segment.text);
    const key = cacheKey(config, spoken);
    const file = path.join(outDir, `${segment.id}-${key}.mp3`);
    const cached = await isUsable(file);

    if (!cached) {
      if (dryRun) {
        console.log(`  · 需要合成 ${segment.id}（${segment.text.length} 字）`);
        if (spoken !== segment.text) console.log(`    口语：${spoken}`);
      } else {
        process.stdout.write(`  合成 ${segment.id}（${segment.text.length} 字）… `);
        await synthesise({ ...config, text: spoken, file, apiKey, apiBase: DEFAULTS.apiBase });
        synthesised += 1;
        console.log('好');
      }
    }

    const durationSec = cached || !dryRun ? await probeDuration(file) : null;
    records.push({
      id: segment.id,
      text: segment.text,
      spokenText: spoken,
      file: path.relative(REPO_ROOT, file),
      durationSec: durationSec === null ? null : round(durationSec, 3),
      chars: segment.text.length,
    });
  }

  const totalSec = records.reduce((sum, item) => sum + (item.durationSec || 0), 0);
  const manifest = {
    generatedAt: new Date().toISOString(),
    model: config.model,
    voice: config.voice,
    settings: { speed: config.speed, pitch: config.pitch, vol: config.vol, sampleRate: config.sampleRate },
    // 页面文本里的四位年份在送 TTS 前转成逐位读法，manifest 里留一份记录，方便复核
    normalization: 'fourDigitYearsAsDigits',
    totalSec: round(totalSec, 3),
    segments: records,
  };

  const manifestPath = path.join(outDir, 'manifest.json');
  if (!dryRun) {
    await writeJsonAtomic(manifestPath, manifest);
  }

  printSummary(records, totalSec, synthesised, manifestPath, dryRun);
}

/* ------------------------------ 台词 -------------------------------------- */

/** 支持 `#` 注释和 `[id]` 分段；同一段里的多行会接成一句。 */
function parseScript(source) {
  const segments = [];
  let current = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const heading = line.match(/^\[([\w-]+)\]$/);
    if (heading) {
      if (current) segments.push(finishSegment(current));
      current = { id: heading[1], lines: [] };
      continue;
    }

    if (!current) throw new Error(`台词出现在任何 [id] 之前：「${line.slice(0, 24)}…」`);
    current.lines.push(line);
  }
  if (current) segments.push(finishSegment(current));

  const seen = new Set();
  for (const segment of segments) {
    if (seen.has(segment.id)) throw new Error(`段落 id 重复：${segment.id}`);
    seen.add(segment.id);
  }
  return segments;
}

function finishSegment(current) {
  const text = current.lines.join('');
  if (!text) throw new Error(`段落 ${current.id} 是空的`);
  return { id: current.id, text };
}

/* ------------------------------ 原稿一致性 -------------------------------- */

/**
 * 页面章节的正文必须和朗读稿逐字一致。
 * 只取 .lead / 无 class 的 p / .punch；kicker、h2、年份、facts 是版式标签，不参与朗读。
 */
async function compareWithPage(segments) {
  let html;
  try {
    html = await fs.readFile(path.join(REPO_ROOT, 'index.html'), 'utf8');
  } catch {
    return [];
  }

  const problems = [];
  for (const segment of segments) {
    if (segment.id === 'intro') continue;

    const block = html.match(new RegExp(`<section class="ch" id="${segment.id}"[\\s\\S]*?</section>`));
    if (!block) {
      problems.push({ id: segment.id, reason: '页面里找不到这个章节', pageText: '', voiceText: segment.text });
      continue;
    }

    const pageText = [...block[0].matchAll(/<p(?:\s+class="(?:lead|punch)")?>([\s\S]*?)<\/p>/g)]
      .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, '')))
      .join('');

    if (normalizeText(pageText) !== normalizeText(segment.text)) {
      problems.push({ id: segment.id, reason: '正文与朗读稿不一致', pageText, voiceText: segment.text });
    }
  }
  return problems;
}

function normalizeText(value) {
  return value.replace(/\s+/g, '');
}

const CHINESE_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * 中文习惯里，四位年份是逐位读的：1871 → 一八七一，2021 → 二零二一。
 * 只处理紧跟「年」的四位数字，免得把「124 个品种」这类数量也拆了。
 * 页面继续显示阿拉伯数字；这里只改送去合成的口语文本。
 */
function speakYears(text) {
  return text.replace(/(?<!\d)(\d{4})\s*年/g, (_, year) =>
    [...year].map((digit) => CHINESE_DIGITS[Number(digit)]).join('') + '年');
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function printConsistency(problems) {
  if (problems.length === 0) {
    console.log('  原稿与朗读稿一致。');
    return;
  }
  for (const item of problems) {
    console.log(`\n  ${item.id}：${item.reason}`);
    if (item.pageText) console.log(`    页面：${item.pageText}`);
    console.log(`    朗读：${item.voiceText}`);
  }
  console.log(`\n  共 ${problems.length} 处不一致。`);
}

/* ------------------------------ 合成 -------------------------------------- */

async function synthesise({ model, voice, speed, pitch, vol, sampleRate, text, file, apiKey, apiBase }) {
  const body = {
    model,
    text,
    stream: false,
    language_boost: 'Chinese',
    voice_setting: { voice_id: voice, speed, vol, pitch },
    audio_setting: { sample_rate: sampleRate, bitrate: 128000, format: 'mp3', channel: 1 },
  };

  const payload = await withRetry(async () => {
    const response = await fetch(`${apiBase}/v1/t2a_v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = data?.base_resp?.status_code;
    if (status !== 0) {
      // 鉴权、余额、敏感词这类错误重试也不会变好，直接停，别白烧钱
      const error = new Error(data?.base_resp?.status_msg || `status_code ${status}`);
      error.fatal = true;
      throw error;
    }
    return data;
  }, `合成 ${path.basename(file)}`);

  const hex = payload?.data?.audio;
  if (!hex) throw new Error(`MiniMax 没返回音频（${path.basename(file)}），可能是文本被风控拦了`);

  // 先写临时文件再改名：合成到一半断网时，缓存里不会留下半截 mp3 骗过下次运行
  const tmp = `${file}.part`;
  await fs.writeFile(tmp, Buffer.from(hex, 'hex'));
  await fs.rename(tmp, file);
}

async function withRetry(fn, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error;
      if (attempt === attempts) break;
      const backoff = 1000 * 2 ** (attempt - 1);
      console.log(`\n  ${label} 第 ${attempt} 次失败（${error.message}），${backoff / 1000}s 后重试`);
      await delay(backoff);
    }
  }
  throw lastError;
}

/* ------------------------------ 缓存与测量 -------------------------------- */

function cacheKey(config, text) {
  return createHash('sha256')
    .update(JSON.stringify({ ...config, text }))
    .digest('hex')
    .slice(0, 12);
}

async function isUsable(file) {
  try {
    const stat = await fs.stat(file);
    return stat.size > 1024;
  } catch {
    return false;
  }
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      const seconds = Number(out.trim());
      if (code !== 0 || !Number.isFinite(seconds)) {
        reject(new Error(`ffprobe 读不出时长：${file}\n${err.slice(-300)}`));
        return;
      }
      resolve(seconds);
    });
  });
}

/* ------------------------------ 小工具 ------------------------------------ */

function printSummary(records, totalSec, synthesised, manifestPath, dryRun) {
  console.log('\n  段  字数   时长');
  for (const item of records) {
    console.log(`  ${item.id.padEnd(5)} ${String(item.chars).padStart(4)} ${item.durationSec === null ? '   —' : `${item.durationSec.toFixed(1)}s`}`);
  }
  console.log(`\n  台词共 ${records.reduce((sum, item) => sum + item.chars, 0)} 字，`
    + `解说 ${totalSec.toFixed(1)}s；本次新合成 ${synthesised} 段。`);
  if (dryRun) {
    console.log('  --dry-run：没有联网，也没有写 manifest.json。');
  } else {
    console.log(`  清单 ${path.relative(REPO_ROOT, manifestPath)}`);
    console.log('  下一步：node tools/video/make-video.mjs --narration --music <配乐>');
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.part`;
  return fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n').then(() => fs.rename(tmp, file));
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

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`\n${error.message || error}`);
  process.exit(1);
});
