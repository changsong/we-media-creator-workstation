#!/usr/bin/env node
// 快手目标名单采集：在已登录的浏览器里搜索关键词，滚动收集公开创作者主页。
// 只采公开信息（昵称、粉丝数、简介片段、主页链接），不读取手机号/私信/关注列表。
//   node marketing/scripts/collect-kuaishou.mjs --login
//   node marketing/scripts/collect-kuaishou.mjs --keyword "美食探店" --limit 30
//   node marketing/scripts/collect-kuaishou.mjs --keyword "美食探店,职场干货" --scrolls 6 --import

import fs from 'node:fs';
import path from 'node:path';
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

const RISK_PATTERNS = ['安全验证', '人机验证', '操作频繁', '请稍后再试', '访问异常', '账号存在异常', '访问过于频繁'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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
  : nicheTargets('kuaishou');
const limit = Math.max(1, Math.min(Number(args.limit) || 50, 100));
const scrolls = Math.max(1, Math.min(Number(args.scrolls) || 4, 12));
const minFollowers = Math.max(0, Number(args['min-followers']) || 1000);
const maxFollowers = Math.max(minFollowers, Number(args['max-followers']) || 500000);
// 快手搜索结果卡片不显示粉丝数，默认保留（--drop-unknown 可丢弃）。
const keepUnknown = args['keep-unknown'] === true || args['drop-unknown'] !== true;
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

  // 用户 tab 的结果卡片是 div.user-card（没有主页 <a> 链接）：
  // 昵称在 .name，快手号在「快手号：xxx」，简介在 .text；粉丝数卡片上不显示。
  document.querySelectorAll('.user-card').forEach((card) => {
    const nameEl = card.querySelector('.name');
    const nickname = (nameEl ? nameEl.textContent : '').replace(/\s+/g, ' ').trim();
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    const eidMatch = text.match(/快手号[:：]\s*([A-Za-z0-9_-]+)/);
    const eid = eidMatch ? eidMatch[1] : '';
    if (!eid || seen.has(eid)) return;
    seen.add(eid);

    const noteEl = card.querySelector('.text');
    const bio = noteEl ? (noteEl.innerText || '').replace(/\s+/g, ' ').trim() : '';
    out.push({
      profile_url: 'https://www.kuaishou.com/profile/' + eid,
      nickname,
      followers: parseCount(text),
      text: (bio || text).slice(0, 400),
    });
  });

  return out;
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeCsv(file, rows) {
  const header = ['platform', 'nickname', 'profile_url', 'followers', 'last_active', 'niche', 'source', 'note'];
  const lines = [header.join(',')];
  for (const row of rows) lines.push(header.map((key) => csvEscape(row[key])).join(','));
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function showHelp() {
  console.log(`快手名单采集

前置：先运行 --login 扫码登录，登录态保存在 marketing/data/chrome-profile。

用法：
  node marketing/scripts/collect-kuaishou.mjs --login
  node marketing/scripts/collect-kuaishou.mjs --keyword "美食探店" --limit 30
  node marketing/scripts/collect-kuaishou.mjs --keyword "美食探店,职场干货" --scrolls 6 --import

参数：
  --keyword a,b       搜索关键词，逗号分隔（省略则跑 niches.json 全部领域）
  --limit N           每个关键词最多保留多少个主页（默认 50，上限 100）
  --scrolls N         每个关键词滚动次数（默认 4，上限 12）
  --min-followers N   粉丝下限（默认 1000）
  --max-followers N   粉丝上限（默认 500000）
  --drop-unknown      丢弃粉丝数未知的账号（默认保留）
  --no-followers      跳过详情页粉丝数补全（更快，但 followers 记为 0）
  --exclude a,b       排除昵称/简介含这些词的账号（默认不过滤）
  --interval-min N    关键词间隔下限秒数（默认 10）
  --interval-max N    关键词间隔上限秒数（默认 18）
  --import            采集后直接导入本地名单库
  --yes               跳过“确认已登录”的等待（适合已登录后的定时运行）
  --out FILE          指定输出 CSV 路径
`);
}

async function loginCookieValue(session) {
  try {
    const result = await session.cdp('Network.getAllCookies');
    const cookies = result.cookies || [];
    const host = (c) => /kuaishou\.com$/i.test(String(c.domain || '').replace(/^\./, ''));
    const userId = cookies.find((c) => c.name === 'userId' && host(c));
    const token = cookies.find((c) =>
      (c.name === 'passToken' || c.name === 'kuaishou.server.webday7_st') && host(c)
    );
    return userId && token ? userId.value + ':' + token.value : '';
  } catch (err) {
    return '';
  }
}

async function runLogin() {
  const session = await openSession('https://www.kuaishou.com/');
  await session.cdp('Network.enable').catch(() => {});
  const initial = await loginCookieValue(session);
  console.log('浏览器已打开快手，请扫码登录。检测到登录态后会自动结束（最多等 5 分钟）。');
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const current = await loginCookieValue(session);
    if (current && current !== initial) {
      console.log('检测到快手登录态，登录完成。');
      session.close();
      return;
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

function cookieHeaderOf(cookies) {
  return (cookies || [])
    .filter((c) => /kuaishou\.com$/i.test(String(c.domain || '').replace(/^\./, '')))
    .map((c) => c.name + '=' + c.value)
    .join('; ');
}

// 详情页是服务端渲染的，HTML 里的 ownerCount.fan 就是粉丝数，无需逐页渲染。
// 200 但拿不到 ownerCount 通常是限流降级页，标记 throttled 以便及时停手。
async function fetchProfileFollowers(cookie, profileUrl) {
  try {
    const res = await fetch(profileUrl, {
      headers: { cookie, 'user-agent': UA, referer: 'https://www.kuaishou.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { followers: 0, risk: res.status === 403 || res.status === 412, throttled: false };
    const html = await res.text();
    if (RISK_PATTERNS.some((token) => html.includes(token))) {
      return { followers: 0, risk: true, throttled: false };
    }
    const m = html.match(/"ownerCount":\{"fan":(\d+)/);
    if (m) return { followers: Number(m[1]) || 0, risk: false, throttled: false };
    const t = html.match(/粉丝\s*([\d.]+)\s*(万|亿|w)?/);
    if (!t) return { followers: 0, risk: false, throttled: true };
    const value = parseFloat(t[1]);
    const unit = (t[2] || '').toLowerCase();
    const factor = unit === '亿' ? 100000000 : unit === '万' || unit === 'w' ? 10000 : 1;
    return { followers: Math.round(value * factor), risk: false, throttled: false };
  } catch (err) {
    return { followers: 0, risk: false, throttled: false };
  }
}

async function fillFollowers(cards, cookie, workers = 3) {
  let done = 0;
  let riskStopped = false;
  let softStreak = 0;
  const queue = [...cards];
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length && !riskStopped) {
      const card = queue.shift();
      const result = await fetchProfileFollowers(cookie, card.profile_url);
      if (result.followers > 0) card.followers = result.followers;
      done++;
      softStreak = result.throttled ? softStreak + 1 : 0;
      if (result.risk || softStreak >= 8) {
        riskStopped = true;
        console.warn(
          result.risk
            ? '  详情页返回验证/限流，停止获取粉丝数，剩余账号按粉丝未知处理。'
            : '  连续多次拿不到粉丝数据（疑似限流），停止获取，剩余账号按粉丝未知处理。可用 fill-kuaishou-followers.mjs 稍后补全。'
        );
      }
      if (done % 50 === 0) console.log(`  已获取 ${done}/${cards.length}`);
      await sleep(randomInt(400, 900));
    }
  }));
  return { done, riskStopped };
}

async function ensureUserTab(session) {
  const coords = await session.eval(`(() => {
    const nodes = Array.from(document.querySelectorAll('[role="button"], [role="tab"], span'));
    const tab = nodes.find((el) => (el.textContent || '').trim() === '用户' && el.getBoundingClientRect().width > 1);
    if (!tab) return null;
    tab.scrollIntoView({ block: 'center', inline: 'center' });
    const r = tab.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!coords) return false;
  await session.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.x, y: coords.y });
  await session.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', buttons: 1, clickCount: 1 });
  await session.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(3500);
  return true;
}

async function collect(session, keyword) {
  const url = `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(keyword)}`;
  console.log(`\n搜索「${keyword}」（用户）`);
  await session.navigate(url, 2600);

  let cards = await session.eval(`(${extractCards.toString()})()`);
  const loginWall = (await session.text(1200)).includes('登录即可享受');
  if (loginWall) {
    throw new Error('搜索页要求登录，请先运行 collect-kuaishou.mjs --login');
  }
  if (!cards || !cards.length) {
    await ensureUserTab(session);
    for (let i = 0; i < 6 && (!cards || !cards.length); i++) {
      await sleep(1200);
      cards = await session.eval(`(${extractCards.toString()})()`);
    }
  }

  const merged = new Map();
  for (let i = 0; i < scrolls; i++) {
    const text = await session.text(4000);
    if (RISK_PATTERNS.some((token) => text.includes(token))) {
      const safeKeyword = keyword.replace(/[\\/:*?"<>|]/g, '_');
      const shot = path.join(DATA_DIR, 'screenshots', `collect-ks-${todayKey()}-${safeKeyword}.png`);
      await session.screenshot(shot).catch(() => {});
      throw new Error(`触发平台验证提示，已停止。截图：${shot}`);
    }

    const found = await session.eval(`(${extractCards.toString()})()`);
    for (const card of found || []) {
      if (!merged.has(card.profile_url)) merged.set(card.profile_url, card);
    }
    console.log(`  第 ${i + 1}/${scrolls} 屏：本页 ${found ? found.length : 0}，累计 ${merged.size}`);
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

  const session = await openSession('https://www.kuaishou.com/');
  if (!args.yes) {
    console.log('浏览器已打开。请确认已登录快手（未登录先扫码），然后回到终端按 Enter 开始采集。');
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
  let cookieHeader = '';
  try {
    const result = await session.cdp('Network.getAllCookies');
    cookieHeader = cookieHeaderOf(result.cookies);
  } catch (err) {
    /* 拿不到 Cookie 时跳过粉丝补全 */
  }
  session.close();

  if (!collected.size) {
    console.warn('没有采集到任何主页：可能未登录、关键词无结果，或页面结构有变化。先运行 --login 再试。');
  } else if (args['no-followers'] !== true) {
    if (cookieHeader) {
      console.log(`\n获取详情页粉丝数（${collected.size} 个）……`);
      await fillFollowers([...collected.values()], cookieHeader);
    } else {
      console.warn('没有读到登录 Cookie，粉丝数将按未知处理。');
    }
  }

  const filtered = [];
  const perNiche = new Map();
  let low = 0, high = 0, unknown = 0, excluded = 0;
  for (const card of collected.values()) {
    const hay = `${card.nickname} ${card.text}`;
    if (excludes.some((word) => hay.includes(word))) { excluded++; continue; }
    if (!card.followers) {
      unknown++;
      if (!keepUnknown) continue;
    } else if (card.followers < minFollowers) { low++; continue; }
    else if (card.followers > maxFollowers) { high++; continue; }
    const used = perNiche.get(card.niche) || 0;
    if (used >= limit) continue;
    perNiche.set(card.niche, used + 1);
    filtered.push({
      platform: 'kuaishou',
      nickname: card.nickname || '',
      profile_url: card.profile_url,
      followers: card.followers,
      last_active: '',
      niche: card.niche,
      source: '快手搜索:user',
      note: card.text,
    });
  }

  const stamp = new Date();
  const name = `${todayKey()}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
  const outFile = path.resolve(args.out || path.join(ROOT, 'outreach', 'lists', `kuaishou-collected-${name}.csv`));
  writeCsv(outFile, filtered);

  console.log(`\n采集完成：候选 ${collected.size}，保留 ${filtered.length}`);
  console.log(`过滤：自定义排除 ${excluded}，粉丝过少 ${low}，粉丝过多 ${high}，粉丝未知 ${unknown}`);
  console.log(`文件：${outFile}`);

  if (autoImport && filtered.length) {
    const result = importLeads(filtered);
    console.log(`已导入名单库：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`);
  } else if (filtered.length) {
    console.log(`导入名单库：node marketing/scripts/leads.mjs import "${outFile}"`);
  }
}

main().catch((err) => {
  console.error(`\n出错了：${err.message}`);
  process.exitCode = 1;
});
