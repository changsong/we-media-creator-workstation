'use strict';

/**
 * 聚焦验证：store.upsertMonitor 的写入 / 更新 / 多平台隔离逻辑，以及放开后的 followers 负值约束。
 * 直接在 Node 进程内操作共享 SQLite（与运行中的服务并发安全，WAL + busy_timeout）。
 * 用法：node tools/verify-monitor.js
 */

const store = require('../lib/store');
const { open } = require('../lib/db');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
}

store.init();

const DATE = '2000-01-01'; // 远过去日期，不与真实监控数据冲突
const PLATFORM = '公众号';

// 1) 首次写入（含负净增粉 -3）
const r1 = store.upsertMonitor(DATE, { platform: PLATFORM, reads: 100, likes: 5, followers: -3, conversions: 0 });
check('首次 upsert 返回 inserted', r1 && r1.updated === false, JSON.stringify(r1));

// 2) 读取回写，确认负值已落库
let row = open().prepare('SELECT * FROM reviews WHERE code = ?').get(r1.code);
check('schedule_code 为监控哨兵', row && row.schedule_code === '@monitor:' + PLATFORM, row ? row.schedule_code : 'null');
check('reads=100', row && row.reads === 100, row && String(row.reads));
check('followers 负值得以保存 (-3)', row && row.followers === -3, row && String(row.followers));

// 3) 同日再次 upsert（有则更新）
const r2 = store.upsertMonitor(DATE, { platform: PLATFORM, reads: 200, likes: 8, followers: -10, conversions: 1 });
check('二次 upsert 返回 updated', r2 && r2.updated === true, JSON.stringify(r2));
row = open().prepare('SELECT * FROM reviews WHERE code = ?').get(r1.code);
check('更新后 reads=200', row && row.reads === 200, row && String(row.reads));
check('更新后 followers=-10', row && row.followers === -10, row && String(row.followers));

// 4) 不同平台同日不互相覆盖
const r3 = store.upsertMonitor(DATE, { platform: '小红书', reads: 50, likes: 2, followers: 1, conversions: 0 });
const xhs = open().prepare('SELECT * FROM reviews WHERE schedule_code = ? AND stat_date = ? AND platform = ?').get('@monitor:小红书', DATE, '小红书');
check('不同平台独立成行', xhs && xhs.reads === 50, xhs && String(xhs.reads));
const gzh = open().prepare('SELECT * FROM reviews WHERE schedule_code = ? AND stat_date = ? AND platform = ?').get('@monitor:' + PLATFORM, DATE, PLATFORM);
check('公众号行未被小红书覆盖', gzh && gzh.reads === 200, gzh && String(gzh.reads));

// 5) 孤儿统计不应被污染（监控哨兵行不计入 reviews_without_schedule）
const orph = store.orphans();
check('孤儿统计不受监控行影响', orph && orph.reviews_without_schedule === 0, JSON.stringify(orph));

// 清理测试行
open().prepare('DELETE FROM reviews WHERE code = ?').run(r1.code);
open().prepare('DELETE FROM reviews WHERE code = ?').run(r3.code);
check('测试数据已清理', !open().prepare('SELECT 1 FROM reviews WHERE code = ?').get(r1.code));

console.log(`\n${failed ? failed + ' 项失败' : '全部通过'}`);
process.exit(failed ? 1 : 0);
