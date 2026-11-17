#!/usr/bin/env node
// B站目标名单采集：复用主应用「连接设置」里的 B站登录态，调用公开搜索接口按关键词找 UP 主。
// 只采公开信息（昵称、粉丝数、简介、主页链接），不读取手机号/私信/关注列表。
//   node marketing/scripts/collect-bilibili.mjs --keyword "母婴育儿" --limit 30
//   node marketing/scripts/collect-bilibili.mjs --keyword "知识分享,职场干货" --pages 3 --import

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  ensureDir,
  parseArgs,
  randomInt,
  sleep,
  todayKey,
} from './lib/util.mjs';
import { findLeadByUrl, importLeads } from './lib/store.mjs';
import { nicheTargets } from './lib/niches.mjs';

const REPO_ROOT = path.resolve(ROOT, '..');
const CONNECTIONS_FILE = path.join(REPO_ROOT, 'data', 'channel-connections.json');
const DEFAULT_TARGETS = nicheTargets('bilibili');
const RISK_CODES = new Set([-352, -412, -799]);

const args = parseArgs();
const keywords = String(args.keyword || args._.join(',') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const targets = keywords.length
  ? keywords.map((keyword) => ({ domain: keyword, keyword }))
  : DEFAULT_TARGETS;
const pages = Math.max(1, Math.min(Number(args.pages) || 2, 5));
const limit = Math.max(1, Math.min(Number(args.limit) || 50, 200));
const minFollowers = Math.max(0, Number(args['min-followers']) || 1000);
const maxFollowers = Math.max(minFollowers, Number(args['max-followers']) || 500000);
const keepUnknown = args['keep-unknown'] === true;
const autoImport = args.import === true;
const verify = args['no-verify'] !== true;
const intervalMin = Math.max(2, Number(args['interval-min']) || 15);
const intervalMax = Math.max(intervalMin, Number(args['interval-max']) || 25);

function readBiliCookie() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
    const fields = (cfg['B站'] && cfg['B站'].fields) || {};
    const parts = [];
    if (fields.SESSDATA) parts.push('SESSDATA=' + fields.SESSDATA);
    if (fields.bili_jct) parts.push('bili_jct=' + fields.bili_jct);
    if (fields.UID) parts.push('DedeUserID=' + fields.UID);
    return parts.join('; ');
  } catch (err) {
    return '';
  }
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
  console.log(`B站名单采集

用法：
  node marketing/scripts/collect-bilibili.mjs --keyword "母婴育儿" --limit 30
  node marketing/scripts/collect-bilibili.mjs --keyword "知识分享,职场干货" --pages 3 --import

参数：
  --keyword a,b       搜索关键词，逗号分隔（省略则跑 niches.json 全部领域）
  --pages N           每个关键词翻几页（每页 20 条，默认 2，上限 5；B站限流较严）
  --limit N           每个关键词最多保留多少个 UP 主（默认 50，上限 200）
  --min-followers N   粉丝下限（默认 1000）
  --max-followers N   粉丝上限（默认 500000）
  --keep-unknown      保留粉丝数解析失败的账号（默认丢弃）
  --interval-min N    关键词间隔下限秒数（默认 15）
  --interval-max N    关键词间隔上限秒数（默认 25）
  --import            采集后直接导入本地名单库
  --out FILE          指定输出 CSV 路径
  --no-verify         跳过主页核验（默认会用卡片接口逐条核对昵称/粉丝）
`);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchPage(cookie, keyword, page) {
  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=' +
    encodeURIComponent(keyword) + '&page=' + page;
  const res = await fetch(url, {
    headers: {
      cookie,
      'user-agent': UA,
      referer: 'https://search.bilibili.com/',
      accept: 'application/json, text/plain, */*',
    },
  });
  const json = await res.json();
  if (RISK_CODES.has(Number(json.code))) {
    const err = new Error('B站返回访问限制（错误码 ' + json.code + '）');
    err.risk = true;
    throw err;
  }
  if (Number(json.code) !== 0) {
    throw new Error('B站搜索失败：code=' + json.code + ' ' + (json.message || ''));
  }
  const data = json.data || {};
  const list = Array.isArray(data.result) ? data.result : (data.result && data.result.result) || [];
  return list;
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 接口被 -412 限流时，网页搜索页仍返回服务端渲染的 UP 主卡片，从卡片里解析公开资料。
function parseUserCards(html) {
  const rows = [];
  for (const card of html.split('b-user-info-card').slice(1)) {
    const mid = (card.match(/space\.bilibili\.com\/(\d+)/) || [])[1];
    if (!mid) continue;
    const nickname = decodeEntities((card.match(/title="([^"]*)"/) || [])[1] || '');
    const plain = decodeEntities(card.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '|'));
    const tokens = plain.split('|').map((part) => part.trim()).filter(Boolean);
    const fansToken = tokens.find((text) => /粉丝/.test(text)) || '';
    const fansMatch = fansToken.match(/([\d.]+)(万)?\s*粉丝/);
    const fans = fansMatch ? Math.round(Number(fansMatch[1]) * (fansMatch[2] ? 10000 : 1)) : 0;
    const fansIdx = tokens.indexOf(fansToken);
    const sign = fansIdx >= 0 && tokens[fansIdx + 1] && !/^\+?\s*关注/.test(tokens[fansIdx + 1]) ? tokens[fansIdx + 1] : '';
    rows.push({ mid, uname: nickname, fans, usign: sign });
  }
  return rows;
}

async function fetchPageHtml(cookie, keyword, page) {
  const url = 'https://search.bilibili.com/upuser?keyword=' + encodeURIComponent(keyword) + '&page=' + page;
  const res = await fetch(url, {
    headers: { cookie, 'user-agent': UA, referer: 'https://www.bilibili.com/' },
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error('B站网页搜索失败：HTTP ' + res.status);
  const rows = parseUserCards(text);
  if (!rows.length) throw new Error('B站网页搜索没有解析到 UP 主（可能触发验证）');
  return rows;
}

// 用公开卡片接口核对 mid 对应的主页：昵称以接口为准，粉丝数刷新。
async function verifyMid(mid) {
  const res = await fetch('https://api.bilibili.com/x/web-interface/card?mid=' + mid + '&photo=false', {
    headers: { 'user-agent': UA, referer: 'https://space.bilibili.com/' },
  });
  const json = await res.json();
  if (RISK_CODES.has(Number(json.code))) {
    const err = new Error('核验接口限流（错误码 ' + json.code + '）');
    err.risk = true;
    throw err;
  }
  if (Number(json.code) !== 0) return { error: 'code=' + json.code };
  const card = json.data && json.data.card;
  if (!card) return { error: '空数据' };
  return { name: String(card.name || ''), fans: Number(card.fans) || 0 };
}

async function main() {
  if (args.help || args.h) { showHelp(); return; }

  const cookie = readBiliCookie();
  if (!cookie) {
    console.warn('警告：没有读到 B站登录态（data/channel-connections.json · B站 · SESSDATA），将尝试匿名搜索，结果可能更少。');
  }

  const collected = new Map();
  for (let i = 0; i < targets.length; i++) {
    const { domain, keyword } = targets[i];
    console.log(`\n搜索「${keyword}」（B站 UP 主）`);
    let htmlMode = false;
    for (let page = 1; page <= pages; page++) {
      let list;
      try {
        list = htmlMode ? await fetchPageHtml(cookie, keyword, page) : await fetchPage(cookie, keyword, page);
      } catch (err) {
        if (err.risk && !htmlMode) {
          console.warn(`${err.message}，改用网页搜索页`);
          try {
            list = await fetchPageHtml(cookie, keyword, page);
            htmlMode = true;
          } catch (fallbackErr) {
            console.error(fallbackErr.message + '，已停止；建议等待 10 分钟以上再试。');
            break;
          }
        } else {
          console.error(err.message + (htmlMode ? '，已停止' : ''));
          break;
        }
      }
      let added = 0;
      for (const row of list) {
        const mid = String(row.mid || '').trim();
        if (!mid) continue;
        const profileUrl = 'https://space.bilibili.com/' + mid;
        if (collected.has(profileUrl)) continue;
        collected.set(profileUrl, {
          nickname: String(row.uname || '').trim(),
          profile_url: profileUrl,
          followers: Number(row.fans) || 0,
          text: String(row.usign || '').trim(),
          niche: domain,
        });
        added++;
      }
      console.log(`  第 ${page}/${pages} 页：${list.length} 条，新增 ${added}，累计 ${collected.size}`);
      if (collected.size >= limit * 3) break;
      if (page < pages) await sleep(randomInt(5000, 9000));
    }
    if (i < targets.length - 1) {
      const wait = randomInt(intervalMin, intervalMax);
      console.log(`等待 ${wait} 秒后继续下一个关键词……`);
      await sleep(wait * 1000);
    }
  }

  let filtered = [];
  const perNiche = new Map();
  let low = 0, high = 0, unknown = 0;
  for (const card of collected.values()) {
    if (!card.followers) {
      unknown++;
      if (!keepUnknown) continue;
    } else if (card.followers < minFollowers) { low++; continue; }
    else if (card.followers > maxFollowers) { high++; continue; }
    const used = perNiche.get(card.niche) || 0;
    if (used >= limit) continue;
    perNiche.set(card.niche, used + 1);
    filtered.push({
      platform: 'bilibili',
      nickname: card.nickname,
      profile_url: card.profile_url,
      followers: card.followers,
      last_active: '',
      niche: card.niche || '',
      source: 'B站搜索',
      note: card.text,
    });
  }

  let verifiedCount = 0;
  let knownSkipped = 0;
  let mismatch = 0;
  let verifySkipped = 0;
  if (verify && filtered.length) {
    console.log(`\n核验主页链接（${filtered.length} 条，已入库的沿用原资料）……`);
    const checked = [];
    let stopped = false;
    for (const row of filtered) {
      const known = findLeadByUrl(row.profile_url);
      if (known) {
        if (known.nickname) row.nickname = known.nickname;
        if (known.followers > 0) row.followers = known.followers;
        knownSkipped++;
        checked.push(row);
        continue;
      }
      if (stopped) { checked.push(row); continue; }
      const mid = row.profile_url.replace('https://space.bilibili.com/', '');
      try {
        const info = await verifyMid(mid);
        if (info.error) {
          console.warn(`  ${row.nickname}（${row.profile_url}）：核验失败 ${info.error}，保留`);
          checked.push(row);
        } else if (info.name !== row.nickname) {
          mismatch++;
          console.warn(`  丢弃 ${row.nickname}（${row.profile_url}）：主页实际是「${info.name}」`);
          continue;
        } else {
          row.nickname = info.name;
          if (info.fans > 0) row.followers = info.fans;
          verifiedCount++;
          checked.push(row);
        }
      } catch (err) {
        if (err.risk) {
          console.warn('  核验接口被限流，跳过后续核验；剩余名单保持采集结果。');
          stopped = true;
          verifySkipped++;
          checked.push(row);
          continue;
        }
        console.warn(`  ${row.nickname}：核验异常 ${err.message}，保留`);
        checked.push(row);
      }
      await sleep(randomInt(1500, 2500));
    }
    filtered = checked;
    console.log(`核验通过 ${verifiedCount} 条，已入库跳过 ${knownSkipped} 条，丢弃不一致 ${mismatch} 条${verifySkipped ? '，限流后未核验部分保留' : ''}`);
  }

  const stamp = new Date();
  const name = `${todayKey()}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
  const outFile = path.resolve(args.out || path.join(ROOT, 'outreach', 'lists', `bilibili-collected-${name}.csv`));
  writeCsv(outFile, filtered);

  console.log(`\n采集完成：候选 ${collected.size}，保留 ${filtered.length}`);
  console.log(`过滤：粉丝过少 ${low}，粉丝过多 ${high}，粉丝未知 ${unknown}`);
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
