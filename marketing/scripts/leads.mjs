#!/usr/bin/env node
// 名单管理（多平台）：导入 CSV、查看统计与队列、修改状态。
//   node marketing/scripts/leads.mjs import marketing/outreach/lists/multi-sample.csv
//   node marketing/scripts/leads.mjs stats
//   node marketing/scripts/leads.mjs list --platform xiaohongshu --status new --limit 20
//   node marketing/scripts/leads.mjs mark --id 12 --status converted

import path from 'node:path';
import { normalizePlatform, parseArgs, platformLabel, readCsv } from './lib/util.mjs';
import { dbFile, importLeads, listLeads, setLeadStatus, stats } from './lib/store.mjs';

const args = parseArgs();
const command = args._[0] || 'stats';

function platformArg(value) {
  const key = normalizePlatform(value);
  if (!key) {
    console.error(`无法识别的平台：${value}（可选：douyin / kuaishou / xiaohongshu / channels / bilibili）`);
    process.exit(1);
  }
  return key;
}

function rate(numerator, denominator) {
  if (!denominator) return '-';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

if (command === 'import') {
  const file = args._[1];
  if (!file) {
    console.error('用法：node marketing/scripts/leads.mjs import <csv 文件>');
    process.exit(1);
  }
  const rows = readCsv(path.resolve(file));
  const result = importLeads(rows);
  console.log(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}（缺少 profile_url）`);
  const parts = Object.entries(result.byPlatform).map(([key, count]) => `${platformLabel(key)} ${count}`);
  if (parts.length) console.log(`按平台：${parts.join('，')}`);
  console.log(`数据库：${dbFile()}`);
} else if (command === 'stats') {
  const s = stats();
  console.log(`名单总数：${s.total}`);
  console.log(`今日已发送：${s.sentToday}`);
  console.log(`有回复记录：${s.replied}`);
  console.log(`已转化（试用/购买）：${s.converted}`);
  if (s.byPlatform.length) {
    console.log('\n平台分布（已触达 = sent/replied/converted）：');
    console.log('  平台      总数   已触达  回复  转化  拉黑  回复率   转化率');
    for (const row of s.byPlatform) {
      const label = platformLabel(row.platform).padEnd(5, ' ');
      const total = String(row.total).padStart(5);
      const contacted = String(row.contacted).padStart(6);
      const replied = String(row.replied).padStart(5);
      const converted = String(row.converted).padStart(5);
      const blocked = String(row.blocked).padStart(5);
      console.log(`  ${label} ${total}  ${contacted}  ${replied}  ${converted}  ${blocked}  ${rate(row.replied, row.contacted).padStart(6)}  ${rate(row.converted, row.contacted).padStart(6)}`);
    }
  }
  if (s.byStatus.length) {
    console.log('\n状态分布：');
    for (const row of s.byStatus) console.log(`  ${row.status}: ${row.count}`);
  }
} else if (command === 'list') {
  const limit = Math.min(Number(args.limit) || 20, 200);
  const platform = args.platform ? platformArg(args.platform) : '';
  const rows = listLeads({ status: args.status ? String(args.status) : '', platform, limit });
  if (!rows.length) {
    console.log('没有匹配的名单');
    process.exit(0);
  }
  for (const lead of rows) {
    const tag = platformLabel(lead.platform);
    console.log(`#${lead.id}  [${tag}]  ${lead.nickname}  粉丝 ${lead.followers}  ${lead.status}  ${lead.profile_url}`);
  }
} else if (command === 'mark') {
  const id = Number(args.id);
  if (!id || !args.status) {
    console.error('用法：node marketing/scripts/leads.mjs mark --id <id> --status <new|queued|sent|replied|converted|blocked>');
    process.exit(1);
  }
  const status = String(args.status);
  if (setLeadStatus(id, status)) {
    console.log(`名单 #${id} 状态已改为 ${status}`);
  } else {
    console.error(`找不到名单 #${id}`);
    process.exit(1);
  }
} else {
  console.log('用法：');
  console.log('  node marketing/scripts/leads.mjs import <csv>');
  console.log('  node marketing/scripts/leads.mjs stats');
  console.log('  node marketing/scripts/leads.mjs list [--platform douyin] [--status new] [--limit 20]');
  console.log('  node marketing/scripts/leads.mjs mark --id <id> --status <converted|blocked|replied|new>');
}
