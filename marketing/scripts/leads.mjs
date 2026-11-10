#!/usr/bin/env node
// 名单管理：导入 CSV、查看统计与队列。
//   node marketing/scripts/leads.mjs import marketing/outreach/lists/douyin.csv
//   node marketing/scripts/leads.mjs stats
//   node marketing/scripts/leads.mjs list --status sent --limit 20

import path from 'node:path';
import { parseArgs, readCsv } from './lib/util.mjs';
import { dbFile, importLeads, listLeads, stats } from './lib/store.mjs';

const args = parseArgs();
const command = args._[0] || 'stats';

if (command === 'import') {
  const file = args._[1];
  if (!file) {
    console.error('用法：node marketing/scripts/leads.mjs import <csv 文件>');
    process.exit(1);
  }
  const rows = readCsv(path.resolve(file));
  const result = importLeads(rows);
  console.log(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}（缺少 profile_url）`);
  console.log(`数据库：${dbFile()}`);
} else if (command === 'stats') {
  const s = stats();
  console.log(`名单总数：${s.total}`);
  console.log(`今日已发送：${s.sentToday}`);
  console.log(`有回复记录：${s.replied}`);
  if (s.byStatus.length) {
    console.log('状态分布：');
    for (const row of s.byStatus) console.log(`  ${row.status}: ${row.count}`);
  }
} else if (command === 'list') {
  const limit = Math.min(Number(args.limit) || 20, 200);
  const rows = listLeads({ status: args.status ? String(args.status) : '', limit });
  if (!rows.length) {
    console.log('没有匹配的名单');
    process.exit(0);
  }
  for (const lead of rows) {
    console.log(`#${lead.id}  ${lead.nickname}  粉丝 ${lead.followers}  ${lead.status}  ${lead.profile_url}`);
  }
} else {
  console.log('用法：');
  console.log('  node marketing/scripts/leads.mjs import <csv>');
  console.log('  node marketing/scripts/leads.mjs stats');
  console.log('  node marketing/scripts/leads.mjs list [--status new] [--limit 20]');
}
