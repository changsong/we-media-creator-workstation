#!/usr/bin/env node
// 小红书目标名单采集：走灰豚数据 searchAnchor（站内搜索风控严重，不直接抓小红书）。
// 只采公开达人资料（昵称、粉丝数、简介、主页/灰豚达人链接），不读取手机号或私信。
//   node marketing/scripts/collect-xiaohongshu.mjs --keyword "母婴育儿" --limit 30
//   node marketing/scripts/collect-xiaohongshu.mjs --keyword "知识分享,职场干货" --pages 2 --import

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ensureDir, parseArgs, randomInt, sleep, todayKey } from './lib/util.mjs';
import { importLeads } from './lib/store.mjs';
import { nicheTargets } from './lib/niches.mjs';
import huitun from '../../lib/huitun.js';

const DEFAULT_TARGETS = nicheTargets('xiaohongshu');

const args = parseArgs();
const keywords = String(args.keyword || args._.join(',') || '')
  .split(/[,，]/)
  .map((s) => s.trim())
  .filter(Boolean);
const targets = keywords.length
  ? keywords.map((keyword) => ({ domain: keyword, keyword }))
  : DEFAULT_TARGETS;
const pages = Math.max(1, Math.min(Number(args.pages) || 2, 10));
const pageSize = Math.max(10, Math.min(Number(args['page-size']) || 20, 50));
const limit = Math.max(1, Math.min(Number(args.limit) || 50, 500));
const minFollowers = Math.max(0, Number(args['min-followers']) || 1000);
const maxFollowers = Math.max(minFollowers, Number(args['max-followers']) || 500000);
const keepUnknown = args['keep-unknown'] === true;
const autoImport = args.import === true;
const intervalMin = Math.max(3, Number(args['interval-min']) || 8);
const intervalMax = Math.max(intervalMin, Number(args['interval-max']) || 15);

function showHelp() {
  console.log(`小红书名单采集（数据源：灰豚数据）

前置：到「连接设置 · 灰豚数据」完成登录，Cookie 会保存在本机。

用法：
  node marketing/scripts/collect-xiaohongshu.mjs --keyword "母婴育儿" --limit 30
  node marketing/scripts/collect-xiaohongshu.mjs --keyword "知识分享,职场干货" --pages 2 --import

参数：
  --keyword a,b       搜索关键词，逗号分隔（省略则跑 niches.json 全部领域）
  --pages N           每个关键词翻几页（默认 2，上限 10）
  --page-size N       每页条数（默认 20，上限 50）
  --limit N           每个关键词最多保留多少个达人（默认 50，上限 500）
  --min-followers N   粉丝下限（默认 1000）
  --max-followers N   粉丝上限（默认 500000）
  --keep-unknown      保留粉丝数未知的达人（默认丢弃）
  --interval-min N    关键词间隔下限秒数（默认 8）
  --interval-max N    关键词间隔上限秒数（默认 15）
  --import            采集后直接导入本地名单库
  --out FILE          指定输出 CSV 路径
`);
}

function pickNumber(row, keys) {
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return 0;
}

function pickText(row, keys, max) {
  for (const key of keys) {
    const value = String(row[key] == null ? '' : row[key]).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (value) return value.slice(0, max || 120);
  }
  return '';
}

function pickRawText(row, keys, max) {
  for (const key of keys) {
    const value = String(row[key] == null ? '' : row[key]).replace(/<[^>]*>/g, '').replace(/\r/g, '').trim();
    if (value) return value.slice(0, max || 400);
  }
  return '';
}

// 灰豚搜索列表没有小红书 userId，用达人 anchorId 调 /anchor/queryId 换真实 userId。
async function resolveUserId(cookie, anchorId) {
  try {
    const json = await huitun.request({ path: '/anchor/queryId', cookie, params: { id: anchorId } });
    const id = String(json.extData || '').trim();
    return /^[0-9a-f]{24}$/i.test(id) ? id : '';
  } catch (err) {
    return '';
  }
}

function xhsProfileUrl(userId, anchorId) {
  return userId ? 'https://www.xiaohongshu.com/user/profile/' + userId : huitun.anchorUrl(anchorId);
}

// 灰豚达人详情：比搜索列表多简介原文、IP 地域、认证、报价、MCN 等。
async function fetchDetail(cookie, anchorId) {
  try {
    const json = await huitun.request({ path: '/anchor/detail', cookie, params: { anchorId } });
    return json.extData && typeof json.extData === 'object' ? json.extData : null;
  } catch (err) {
    return null;
  }
}

function humanCount(value) {
  const n = Number(value) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
  return String(n);
}

// 简介原样保留（含商务邮箱/微信，属于公开资料），后面补一行灰豚公开数据摘要。
function buildNote(search, detail) {
  const src = { ...(search || {}), ...(detail || {}) };
  const desc = pickRawText(src, ['userText', 'intro', 'desc', 'signature', 'brief', 'note'], 500);
  const careers = Array.isArray(src.careerList) ? src.careerList.join('/') : (Array.isArray(src.career) ? src.career.join('/') : String(src.career || ''));
  const tags = Array.isArray(src.tagList) ? src.tagList.join('/') : '';
  const redId = pickText(src, ['redId', 'red_id', 'xiaohongshuId', 'xhsId'], 40);
  const picturePrice = pickNumber(src, ['picturePrice', 'picPri']);
  const videoPrice = pickNumber(src, ['videoPrice', 'vidPri']);
  const parts = [
    src.type && '类型:' + src.type,
    src.verify && src.verifyContent ? '认证:' + pickText(src, ['verifyContent'], 40) : '',
    careers && '职业:' + careers,
    tags && '标签:' + tags,
    redId && '小红书号:' + redId,
    (src.location || src.ipLocation || src.loc) && '地域:' + pickText(src, ['location', 'ipLocation', 'loc'], 40),
    pickNumber(src, ['likeCount']) && '获赞与收藏:' + humanCount(pickNumber(src, ['likeCount'])),
    pickNumber(src, ['totalNoteCount', 'note']) && '笔记:' + pickNumber(src, ['totalNoteCount', 'note']),
    pickNumber(src, ['note30']) && '近30天笔记:' + pickNumber(src, ['note30']),
    pickNumber(src, ['businessNoteCount']) && '商业笔记:' + pickNumber(src, ['businessNoteCount']),
    picturePrice && '图文报价:¥' + picturePrice,
    videoPrice && '视频报价:¥' + videoPrice,
    src.mcnId && 'MCN:已签约',
    pickNumber(src, ['htScore']) && '灰豚评分:' + Number(src.htScore).toFixed(0),
  ].filter(Boolean);
  return [desc, parts.length ? '[灰豚] ' + parts.join(' | ') : ''].filter(Boolean).join('\n').slice(0, 1000);
}

const EXTRA_DETAIL_KEYS = [
  'anchorId', 'redId', 'nick', 'headurl', 'fansCount', 'followCount', 'collectCount', 'likeCount',
  'totalNoteCount', 'businessNoteCount', 'gmtCreate', 'gmtModified', 'type', 'level', 'curLevel',
  'htScore', 'location', 'ipLocation', 'mcnId', 'verify', 'verifyContent', 'userSex', 'careerList',
  'tagList', 'noteSign', 'include', 'showFans', 'pictureCpe', 'pictureCpm', 'picturePrice',
  'videoCpe', 'videoCpm', 'videoPrice', 'pgy',
];
const EXTRA_SEARCH_KEYS = [
  'anchorId', 'redId', 'nick', 'headurl', 'fansCount', 'followCount', 'likeCount', 'collectCount',
  'type', 'career', 'tagList', 'loc', 'mcnId', 'verify', 'htScore',
  'note', 'note7', 'note30', 'avgLike', 'avgComm', 'avgColl', 'avgShare', 'hotRate', 'hotRateDays',
  'mostType', 'cooperateBrandNum', 'mcn', 'tag', 'ntid', 'fanM', 'fanF', 'fanAge',
  'fanProv', 'fanCity', 'isComm', 'businessNoteCount', 'likeRate', 'picPri', 'vidPri',
];

// 把灰豚返回的公开字段尽量完整地存进 extra（JSON），方便以后做筛选或二次分析。
function buildExtra(search, detail) {
  const extra = { _source: 'huitun', _fetched_at: new Date().toISOString() };
  for (const key of EXTRA_DETAIL_KEYS) {
    if (detail && detail[key] !== undefined) extra[key] = detail[key];
  }
  for (const key of EXTRA_SEARCH_KEYS) {
    if (search && search[key] !== undefined) extra[key] = search[key];
  }
  return JSON.stringify(extra);
}

function mapRow(row, domain) {
  const anchorId = pickText(row, ['anchorId', 'anchor_id', 'id'], 40);
  if (!anchorId) return null;
  return {
    anchorId,
    search: row,
    domain,
    nickname: pickText(row, ['nick', 'nickname', 'name', 'anchorName', 'anchor_name'], 60),
    followers: pickNumber(row, ['fansCount', 'fans', 'fansNum', 'fans_num', 'fans_count', 'followerCount', 'follower_count']),
  };
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function writeCsv(file, rows) {
  const header = ['platform', 'nickname', 'profile_url', 'followers', 'last_active', 'niche', 'source', 'note', 'extra'];
  const lines = [header.join(',')];
  for (const row of rows) lines.push(header.map((key) => csvEscape(row[key])).join(','));
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

async function main() {
  if (args.help || args.h) { showHelp(); return; }

  const conn = huitun.connection();
  if (!conn.cookie) {
    console.error('灰豚数据未登录：请先在主应用「连接设置 · 灰豚数据」扫码登录，再运行采集。');
    process.exitCode = 1;
    return;
  }
  try {
    const user = await huitun.requireUser(conn.cookie);
    console.log(`灰豚账号：${user.nickname || user.mobile || '已登录'}`);
  } catch (err) {
    console.error('灰豚登录态不可用：' + err.message);
    console.error('请到「连接设置 · 灰豚数据」重新登录后再试。');
    process.exitCode = 1;
    return;
  }

  const collected = new Map();
  for (let i = 0; i < targets.length; i++) {
    const { domain, keyword } = targets[i];
    console.log(`\n搜索「${keyword}」（小红书达人）`);
    for (let page = 1; page <= pages; page++) {
      let list = [];
      try {
        list = await huitun.searchAnchor(conn.cookie, keyword, { page, pageSize });
      } catch (err) {
        console.error(`  第 ${page} 页失败：${err.message}`);
        if (err.code === 'NO_COOKIE' || err.code === 'HTTP_401') break;
      }
      let added = 0;
      for (const row of list) {
        const item = mapRow(row, domain);
        if (!item) continue;
        if (collected.has(item.anchorId)) continue;
        collected.set(item.anchorId, item);
        added++;
      }
      console.log(`  第 ${page}/${pages} 页：${list.length} 条，新增 ${added}，累计 ${collected.size}`);
      if (collected.size >= limit * 3) break;
      if (page < pages) await sleep(randomInt(2000, 4000));
    }
    if (i < targets.length - 1) {
      const wait = randomInt(intervalMin, intervalMax);
      console.log(`等待 ${wait} 秒后继续下一个关键词……`);
      await sleep(wait * 1000);
    }
  }

  const filtered = [];
  const perNiche = new Map();
  let low = 0, high = 0, unknown = 0;
  for (const card of collected.values()) {
    if (!card.followers) {
      unknown++;
      if (!keepUnknown) continue;
    } else if (card.followers < minFollowers) { low++; continue; }
    else if (card.followers > maxFollowers) { high++; continue; }
    const used = perNiche.get(card.domain) || 0;
    if (used >= limit) continue;
    perNiche.set(card.domain, used + 1);
    filtered.push(card);
  }

  const rows = [];
  let detailOk = 0;
  for (let i = 0; i < filtered.length; i++) {
    const card = filtered[i];
    const userId = await resolveUserId(conn.cookie, card.anchorId);
    const detail = await fetchDetail(conn.cookie, card.anchorId);
    if (detail) detailOk++;
    rows.push({
      platform: 'xiaohongshu',
      nickname: (detail && String(detail.nick || '').trim()) || card.nickname,
      profile_url: xhsProfileUrl(userId, card.anchorId),
      followers: pickNumber(detail || {}, ['fansCount']) || card.followers,
      last_active: '',
      niche: card.domain,
      source: '灰豚搜索',
      note: buildNote(card.search, detail || card.search),
      extra: buildExtra(card.search, detail),
    });
    if (i < filtered.length - 1) await sleep(randomInt(250, 600));
  }

  const stamp = new Date();
  const name = `${todayKey()}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}`;
  const outFile = path.resolve(args.out || path.join(ROOT, 'outreach', 'lists', `xiaohongshu-collected-${name}.csv`));
  writeCsv(outFile, rows);

  const resolved = rows.filter((row) => row.profile_url.includes('xiaohongshu.com/user/profile/')).length;
  console.log(`\n采集完成：候选 ${collected.size}，保留 ${rows.length}`);
  console.log(`过滤：粉丝过少 ${low}，粉丝过多 ${high}，粉丝未知 ${unknown}`);
  console.log(`主页链接：${resolved}/${rows.length} 为小红书主页，其余（${rows.length - resolved}）回退灰豚达人页`);
  console.log(`文件：${outFile}`);

  if (autoImport && rows.length) {
    const result = importLeads(rows);
    console.log(`已导入名单库：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`);
  } else if (rows.length) {
    console.log(`导入名单库：node marketing/scripts/leads.mjs import "${outFile}"`);
  }
}

main().catch((err) => {
  console.error(`\n出错了：${err.message}`);
  process.exitCode = 1;
});
