#!/usr/bin/env node
// 抖音目标名单采集：在已登录的浏览器里搜索关键词，滚动收集公开创作者主页。
// 只采公开信息（昵称、粉丝数、简介片段、主页链接），不读取手机号/私信/关注列表。
//   node marketing/scripts/collect-douyin.mjs --login
//   node marketing/scripts/collect-douyin.mjs --keyword "自媒体运营" --limit 50
//   node marketing/scripts/collect-douyin.mjs --keyword "美食探店,职场口播" --mode video --import

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR,
  ROOT,
  ensureDir,
  parseArgs,
  randomInt,
  sleep,
  todayKey,
} from './lib/util.mjs';
import { importLeads } from './lib/store.mjs';
import { openSession } from './lib/browser.mjs';
import { nicheTargets } from './lib/niches.mjs';

const RISK_PATTERNS = ['安全验证', '人机验证', '操作频繁', '请稍后再试', '访问异常', '账号存在异常'];
const args = parseArgs();
const excludes = String(args.exclude || '')
  .split(/[,，]/)
  .map((item) => item.trim())
  .filter(Boolean);

const inputKeywords = String(args.keyword || args._.join(',') || '')
  .split(/[,，]/)
  .map((item) => item.trim())
  .filter(Boolean);
const targets = inputKeywords.length
  ? inputKeywords.map((keyword) => ({ domain: keyword, keyword }))
  : nicheTargets('douyin');
const mode = ['user', 'video'].includes(String(args.mode)) ? String(args.mode) : 'user';
const limit = Math.max(1, Math.min(Number(args.limit) || 50, 100));
const scrolls = Math.max(1, Math.min(Number(args.scrolls) || 4, 12));
const minFollowers = Math.max(0, Number(args['min-followers']) || 1000);
const maxFollowers = Math.max(minFollowers, Number(args['max-followers']) || 500000);
const keepUnknown = args['keep-unknown'] === true;
const intervalMin = Math.max(5, Number(args['interval-min']) || 10);
const intervalMax = Math.max(intervalMin, Number(args['interval-max']) || 18);
const autoImport = args.import === true;

export function extractCards() {
  const out = [];
  const seen = new Set();

  const parseCount = (text) => {
    const patterns = [
      /([\d.]+)\s*(万|亿|w)?\s*粉丝/i,
      /粉丝\s*([\d.]+)\s*(万|亿|w)?/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseFloat(match[1]);
      if (!Number.isFinite(value)) continue;
      const unit = (match[2] || '').toLowerCase();
      if (unit === '亿') return Math.round(value * 100000000);
      if (unit === '万' || unit === 'w') return Math.round(value * 10000);
      return Math.round(value);
    }
    return 0;
  };

  document.querySelectorAll('a[href*="/user/"]').forEach((anchor) => {
    let url;
    try {
      url = new URL(anchor.href, location.href);
    } catch (err) {
      return;
    }
    if (!url.pathname.includes('/user/')) return;
    const secUid = url.pathname.split('/user/')[1].split(/[/?#]/)[0];
    if (!secUid || seen.has(secUid)) return;
    seen.add(secUid);

    let card = anchor;
    let rawText = '';
    for (let i = 0; i < 6 && card; i++) {
      rawText = (card.innerText || '').trim();
      if (rawText.length >= 20) break;
      card = card.parentElement;
    }
    const text = rawText.replace(/\s+/g, ' ').trim();
    const anchorText = (anchor.innerText || '').replace(/\s+/g, ' ').trim();
    let nickname = '';
    if (anchorText && anchorText.length <= 30 && !/粉丝|作品|获赞/.test(anchorText)) {
      nickname = anchorText;
    } else {
      nickname = rawText.split('\n').map((line) => line.trim()).find((line) => line) || '';
      if (nickname.length > 30) nickname = '';
    }

    out.push({
      profile_url: 'https://www.douyin.com' + url.pathname,
      nickname,
      followers: parseCount(text),
      text: text.slice(0, 400),
    });
  });

  return out;
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeCsv(file, rows) {
  const header = ['nickname', 'profile_url', 'followers', 'last_active', 'niche', 'source', 'note'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => csvEscape(row[key])).join(','));
  }
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function showHelp() {
  console.log(`抖音名单采集

用法：
  node marketing/scripts/collect-douyin.mjs --login
  node marketing/scripts/collect-douyin.mjs --keyword "自媒体运营" --limit 50
  node marketing/scripts/collect-douyin.mjs --keyword "美食探店,职场口播" --mode video --import

参数：
  --keyword a,b       搜索关键词，逗号分隔（省略则跑 niches.json 全部领域）
  --mode user|video   搜用户（默认）或搜视频作者（更偏近期活跃）
  --limit N           每个关键词最多保留多少个主页（默认 50，上限 100）
  --scrolls N         每个关键词滚动次数（默认 4，上限 12）
  --min-followers N   粉丝下限（默认 1000）
  --max-followers N   粉丝上限（默认 500000）
  --keep-unknown      保留粉丝数解析失败的账号
  --exclude a,b       排除昵称/简介含这些词的账号（默认不过滤）
  --interval-min N    关键词间隔下限秒数（默认 10）
  --interval-max N    关键词间隔上限秒数（默认 18）
  --import            采集后直接导入本地名单库
  --yes               跳过“确认已登录”的等待（适合已登录后的定时运行）
  --out FILE          指定输出 CSV 路径
`);
}

async function runLogin() {
  const session = await openSession('https://www.douyin.com/');
  console.log('浏览器已打开抖音，请扫码登录。检测到登录态后会自动结束（最多等 5 分钟）。');
  await session.cdp('Network.enable').catch(() => {});
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    try {
      const result = await session.cdp('Network.getAllCookies');
      const logged = (result.cookies || []).some((cookie) =>
        /^sessionid/.test(cookie.name) &&
        cookie.value &&
        /douyin\.com$/i.test(String(cookie.domain || '').replace(/^\./, ''))
      );
      if (logged) {
        console.log('检测到抖音登录态，登录完成。');
        session.close();
        return;
      }
    } catch (err) {
      /* 页面跳转中，继续轮询 */
    }
  }
  console.warn('等待登录超时。浏览器保持打开，可以重新运行 --login 或直接采集。');
  session.close();
}

function waitForEnter() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

async function collect(session, keyword) {
  const type = mode === 'video' ? 'video' : 'user';
  const url = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=${type}`;
  console.log(`\n搜索「${keyword}」（${type === 'user' ? '用户' : '视频作者'}）`);
  await session.navigate(url, 2600);

  const merged = new Map();
  for (let i = 0; i < scrolls; i++) {
    const text = await session.text(4000);
    if (RISK_PATTERNS.some((token) => text.includes(token))) {
      const safeKeyword = keyword.replace(/[\\/:*?"<>|]/g, '_');
      const shot = path.join(DATA_DIR, 'screenshots', `collect-${todayKey()}-${safeKeyword}.png`);
      await session.screenshot(shot).catch(() => {});
      throw new Error(`触发平台验证提示，已停止。截图：${shot}`);
    }

    const cards = await session.eval(`(${extractCards.toString()})()`);
    for (const card of cards || []) {
      if (!merged.has(card.profile_url)) merged.set(card.profile_url, card);
    }
    console.log(`  第 ${i + 1}/${scrolls} 屏：本页 ${cards ? cards.length : 0}，累计 ${merged.size}`);
    if (merged.size >= limit) break;

    await session.eval(`(() => {
      window.scrollTo(0, (document.scrollingElement || document.documentElement).scrollHeight);
      const scrollables = Array.from(document.querySelectorAll('div'))
        .filter((el) => el.scrollHeight > el.clientHeight + 500 && el.clientHeight > 300)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)
        .slice(0, 3);
      scrollables.forEach((el) => { el.scrollTop = el.scrollHeight; });
    })()`);
    await sleep(randomInt(1600, 3200));
  }
  return [...merged.values()];
}

async function main() {
  if (args.login) {
    await runLogin();
    return;
  }
  if (args.help || args.h || !targets.length) {
    showHelp();
    return;
  }

  const session = await openSession('https://www.douyin.com/');
  if (!args.yes) {
    console.log('浏览器已打开。请确认已登录抖音（未登录先扫码），然后回到终端按 Enter 开始采集。');
    await waitForEnter();
  }

  const collected = new Map();
  for (let index = 0; index < targets.length; index++) {
    const { domain, keyword } = targets[index];
    try {
      const cards = await collect(session, keyword);
      for (const card of cards) {
        if (collected.has(card.profile_url)) continue;
        collected.set(card.profile_url, { ...card, niche: domain });
      }
    } catch (err) {
      console.error(err.message);
      break;
    }
    if (index < targets.length - 1) {
      const wait = randomInt(intervalMin, intervalMax);
      console.log(`等待 ${wait} 秒后继续下一个关键词……`);
      await sleep(wait * 1000);
    }
  }
  session.close();

  if (!collected.size) {
    console.warn('没有采集到任何主页：可能未登录、关键词无结果，或页面结构有变化。先运行 --login 再试。');
  }

  const filtered = [];
  const perNiche = new Map();
  let lowFollowers = 0;
  let highFollowers = 0;
  let unknownFollowers = 0;
  let excluded = 0;
  for (const card of collected.values()) {
    const haystack = `${card.nickname} ${card.text}`;
    if (excludes.some((word) => haystack.includes(word))) {
      excluded++;
      continue;
    }
    if (!card.followers) {
      unknownFollowers++;
      if (!keepUnknown) continue;
    } else if (card.followers < minFollowers) {
      lowFollowers++;
      continue;
    } else if (card.followers > maxFollowers) {
      highFollowers++;
      continue;
    }
    const used = perNiche.get(card.niche) || 0;
    if (used >= limit) continue;
    perNiche.set(card.niche, used + 1);
    filtered.push({
      nickname: card.nickname || '',
      profile_url: card.profile_url,
      followers: card.followers,
      last_active: '',
      niche: card.niche,
      source: `抖音搜索:${mode}`,
      note: card.text,
    });
  }

  const stamp = new Date();
  const name = `${todayKey()}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
  const outFile = path.resolve(args.out || path.join(ROOT, 'outreach', 'lists', `douyin-collected-${name}.csv`));
  writeCsv(outFile, filtered);

  console.log(`\n采集完成：候选 ${collected.size}，保留 ${filtered.length}`);
  console.log(`过滤：自定义排除 ${excluded}，粉丝过少 ${lowFollowers}，粉丝过多 ${highFollowers}，粉丝未知 ${unknownFollowers}`);
  console.log(`文件：${outFile}`);

  if (autoImport && filtered.length) {
    const result = importLeads(filtered);
    console.log(`已导入名单库：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`);
  } else if (filtered.length) {
    console.log(`导入名单库：node marketing/scripts/leads.mjs import "${outFile}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n出错了：${err.message}`);
    process.exitCode = 1;
  });
}
