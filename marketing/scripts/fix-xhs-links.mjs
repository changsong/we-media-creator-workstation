#!/usr/bin/env node
// 补换小红书主页链接：灰豚免费版 queryId 每天 500 次，批量采集后会有部分名单回退成灰豚达人页。
// 次日额度恢复后运行本脚本，把剩下的换成真实小红书主页。
//   node marketing/scripts/fix-xhs-links.mjs
//   node marketing/scripts/fix-xhs-links.mjs --limit 50

import { DatabaseSync } from 'node:sqlite';
import { dbFile } from './lib/store.mjs';
import { parseArgs, randomInt, sleep } from './lib/util.mjs';
import huitun from '../../lib/huitun.js';

const args = parseArgs();
const limit = Math.max(1, Number(args.limit) || 1000);

function anchorIdOf(url) {
  const match = String(url || '').match(/[?&]id=([0-9A-Za-z]+)/);
  return match ? match[1] : '';
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
    SELECT id, nickname, profile_url FROM leads
    WHERE platform = 'xiaohongshu' AND profile_url LIKE '%huitun%'
    ORDER BY id ASC LIMIT ?
  `).all(limit);
  if (!rows.length) {
    console.log('没有需要补换的小红书名单。');
    return;
  }
  console.log(`待补换 ${rows.length} 条。`);

  const update = db.prepare('UPDATE leads SET profile_url = ?, updated_at = ? WHERE id = ?');
  const findByUrl = db.prepare('SELECT id, nickname FROM leads WHERE profile_url = ?');
  const now = () => new Date().toISOString();
  let fixed = 0;
  let dup = 0;
  for (const row of rows) {
    const anchorId = anchorIdOf(row.profile_url);
    if (!anchorId) continue;
    let json;
    try {
      json = await huitun.request({ path: '/anchor/queryId', cookie: conn.cookie, params: { id: anchorId } });
    } catch (err) {
      console.error(`#${row.id} ${row.nickname}：请求失败 ${err.message}`);
      continue;
    }
    if (json.status !== 0) {
      const message = String(json.message || '');
      console.warn(`#${row.id} 未换到：${message || '未知错误'}`);
      if (message.includes('500')) {
        console.warn('灰豚今日额度已用完，明天再跑一次即可。');
        break;
      }
      continue;
    }
    const userId = String(json.extData || '').trim();
    if (!/^[0-9a-f]{24}$/i.test(userId)) continue;
    const profileUrl = 'https://www.xiaohongshu.com/user/profile/' + userId;
    // 同一个创作者可能已有一条真实主页链接的名单，撞唯一索引时跳过，不能中断整轮。
    const existing = findByUrl.get(profileUrl);
    if (existing) {
      dup++;
      console.log(`#${row.id} ${row.nickname} → ${userId}（已有 #${existing.id} ${existing.nickname}，跳过）`);
      await sleep(randomInt(600, 1000));
      continue;
    }
    update.run(profileUrl, now(), row.id);
    fixed++;
    console.log(`#${row.id} ${row.nickname} → ${userId}`);
    await sleep(randomInt(600, 1000));
  }

  const left = db.prepare(`
    SELECT COUNT(*) c FROM leads WHERE platform = 'xiaohongshu' AND profile_url LIKE '%huitun%'
  `).get().c;
  console.log(`\n本次补换 ${fixed} 条，重复跳过 ${dup} 条，剩余 ${left} 条回退链接。`);
}

main().catch((err) => {
  console.error(`\n出错了：${err.message}`);
  process.exitCode = 1;
});
