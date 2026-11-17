#!/usr/bin/env node
// 补全小红书达人的灰豚详情字段：早期名单没存灰豚内部 anchorId，用备注里的小红书号反查回来，再取 /anchor/detail。
// 灰豚免费版 detail 每天 100 次，按粉丝数从高到低补，额度用完自动停，第二天再跑继续。
//   node marketing/scripts/detail-xiaohongshu.mjs --limit 100
//   node marketing/scripts/detail-xiaohongshu.mjs --limit 20 --min-followers 10000

import { DatabaseSync } from 'node:sqlite';
import { dbFile } from './lib/store.mjs';
import { parseArgs, randomInt, sleep } from './lib/util.mjs';
import huitun from '../../lib/huitun.js';

const args = parseArgs();
const limit = Math.max(1, Math.min(Number(args.limit) || 100, 100));
const minFollowers = Math.max(0, Number(args['min-followers']) || 0);

const EXTRA_DETAIL_KEYS = [
  'anchorId', 'redId', 'nick', 'headurl', 'fansCount', 'followCount', 'collectCount', 'likeCount',
  'totalNoteCount', 'businessNoteCount', 'gmtCreate', 'gmtModified', 'type', 'level', 'curLevel',
  'htScore', 'location', 'ipLocation', 'mcnId', 'verify', 'verifyContent', 'userSex', 'careerList',
  'tagList', 'noteSign', 'include', 'showFans', 'pictureCpe', 'pictureCpm', 'picturePrice',
  'videoCpe', 'videoCpm', 'videoPrice', 'pgy',
];

function redIdOf(note) {
  const match = String(note || '').match(/小红书号[:：]\s*([A-Za-z0-9_]+)/);
  return match ? match[1] : '';
}

// 用昵称搜索，优先按小红书号精确匹配，避免同名达人串号。
async function findAnchorId(cookie, nickname, redId) {
  let list = [];
  try {
    list = await huitun.searchAnchor(cookie, nickname, { page: 1, pageSize: 20 });
  } catch (err) {
    return { anchorId: '', error: err.message };
  }
  const hit = (redId && list.find((row) => String(row.redId) === redId)) || list.find((row) => String(row.nick) === nickname);
  return { anchorId: hit ? String(hit.anchorId || '') : '' };
}

function mergeExtra(rawExtra, detail, anchorId) {
  let extra = {};
  if (rawExtra) {
    try { extra = JSON.parse(rawExtra); } catch { extra = {}; }
  }
  for (const key of EXTRA_DETAIL_KEYS) {
    if (detail[key] !== undefined) extra[key] = detail[key];
  }
  extra.anchorId = anchorId;
  extra._detail = true;
  extra._detail_at = new Date().toISOString();
  return JSON.stringify(extra);
}

// 详情里的 userText 是简介原文，只替换 [灰豚] 摘要之前的正文，保留已生成的灰豚摘要行。
function mergeNote(rawNote, detail) {
  const note = String(rawNote || '');
  const bio = String(detail.userText || '').replace(/\r/g, '').trim();
  if (!bio) return note;
  const idx = note.indexOf('\n[灰豚]');
  const tail = idx >= 0 ? note.slice(idx) : '';
  return (bio + tail).slice(0, 1200);
}

async function main() {
  const conn = huitun.connection();
  if (!conn.cookie) {
    console.error('灰豚数据未登录：请先到「连接设置 · 灰豚数据」登录。');
    process.exitCode = 1;
    return;
  }

  const db = new DatabaseSync(dbFile());
  const rows = db.prepare(`
    SELECT id, nickname, followers, note, extra FROM leads
    WHERE platform = 'xiaohongshu' AND followers >= ?
      AND (extra NOT LIKE '%"_detail":true%' OR extra = '')
    ORDER BY followers DESC, id ASC LIMIT ?
  `).all(minFollowers, limit);
  if (!rows.length) {
    console.log('没有需要补详情的小红书名单。');
    return;
  }
  console.log(`待补详情 ${rows.length} 条（按粉丝数从高到低）。`);

  const update = db.prepare('UPDATE leads SET nickname = ?, followers = ?, note = ?, extra = ?, updated_at = ? WHERE id = ?');
  const now = () => new Date().toISOString();
  let done = 0;
  let unmatched = 0;
  let failed = 0;
  for (const row of rows) {
    const redId = redIdOf(row.note);
    const match = await findAnchorId(conn.cookie, row.nickname, redId);
    if (match.error) {
      console.error(`#${row.id} ${row.nickname}：搜索失败 ${match.error}`);
      if (match.error.includes('100')) {
        console.warn('灰豚今日额度已用完（100 次/天），明天再跑一次即可。');
        break;
      }
      failed++;
      await sleep(randomInt(1500, 2500));
      continue;
    }
    if (!match.anchorId) {
      unmatched++;
      console.warn(`#${row.id} ${row.nickname}：未匹配到灰豚达人（小红书号 ${redId || '无'}）`);
      await sleep(randomInt(1200, 2000));
      continue;
    }

    let json;
    try {
      json = await huitun.request({ path: '/anchor/detail', cookie: conn.cookie, params: { anchorId: match.anchorId } });
    } catch (err) {
      console.error(`#${row.id} ${row.nickname}：详情请求失败 ${err.message}`);
      failed++;
      continue;
    }
    if (json.status !== 0 || !json.extData || typeof json.extData !== 'object') {
      const message = String(json.message || '');
      console.warn(`#${row.id} ${row.nickname}：详情不可用 ${message || '未知错误'}`);
      if (message.includes('100')) {
        console.warn('灰豚今日 detail 额度已用完（100 次/天），明天再跑一次即可。');
        break;
      }
      failed++;
      continue;
    }

    const detail = json.extData;
    const nickname = row.nickname || String(detail.nick || '');
    const followers = Number(detail.fansCount) > 0 ? Math.round(Number(detail.fansCount)) : row.followers;
    update.run(nickname, followers, mergeNote(row.note, detail), mergeExtra(row.extra, detail, match.anchorId), now(), row.id);
    done++;
    console.log(`#${row.id} ${nickname}：详情已补（${Object.keys(detail).length} 字段）`);
    await sleep(randomInt(600, 1000));
  }

  const left = db.prepare(`
    SELECT COUNT(*) c FROM leads
    WHERE platform = 'xiaohongshu' AND (extra NOT LIKE '%"_detail":true%' OR extra = '')
  `).get().c;
  console.log(`\n本次补全 ${done} 条，未匹配 ${unmatched} 条，失败 ${failed} 条，剩余 ${left} 条待补。`);
}

main().catch((err) => {
  console.error(`\n出错了：${err.message}`);
  process.exitCode = 1;
});
