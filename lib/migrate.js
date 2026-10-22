'use strict';

/**
 * 旧数据迁移：把 data/store.json（或任意同结构 JSON）导入 SQLite。
 * 迁移完成后原文件会被移到 data/legacy/ 存档，不会静默删除。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { mapping, tableKeys } = require('./mapping');
const { tables } = require('./schemas');

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function insertRecords(tableKey, records, report) {
  const map = mapping[tableKey];
  const table = tables[tableKey];
  const c = db.open();
  const now = new Date().toISOString();

  const cols = ['id'];
  table.properties.forEach((p) => {
    const col = map.columns[p.name];
    if (col) cols.push(col);
  });
  cols.push('created_at', 'updated_at');

  const sql = `INSERT INTO ${map.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const stmt = c.prepare(sql);

  records.forEach((rec) => {
    const values = [rec._id || makeId(tableKey)];
    table.properties.forEach((p) => {
      const col = map.columns[p.name];
      if (!col) return;
      let value = rec[p.name];
      if (value === undefined || value === '') value = null;
      if (map.json.indexOf(p.name) >= 0) value = JSON.stringify(Array.isArray(value) ? value : []);
      if (p.type === 'number' && value !== null && typeof value === 'string') {
        const n = parseFloat(value);
        value = Number.isNaN(n) ? null : n;
      }
      values.push(value);
    });
    values.push(rec._createdAt || now, rec._updatedAt || now);

    try {
      stmt.run(...values);
      report.counts[tableKey] += 1;
    } catch (err) {
      report.skipped.push({
        table: tableKey,
        code: rec[table.idField] || '(无编号)',
        reason: err.message
      });
    }
  });
}

function restoreSequences() {
  const c = db.open();
  const upsert = c.prepare(
    `INSERT INTO sequences (table_key, month, value) VALUES (?, ?, ?)
     ON CONFLICT(table_key) DO UPDATE SET month = excluded.month, value = excluded.value`
  );
  tableKeys.forEach((key) => {
    const map = mapping[key];
    const rows = c.prepare(`SELECT code, created_at FROM ${map.table}`).all();
    const best = {};
    rows.forEach((row) => {
      const m = new RegExp(`^${map.idPrefix}(\\d{4})-(\\d+)$`).exec(String(row.code || ''));
      if (!m) return;
      const month = m[1];
      const n = parseInt(m[2], 10);
      if (!best[month] || n > best[month]) best[month] = n;
    });
    const months = Object.keys(best).sort();
    if (!months.length) return;
    const latest = months[months.length - 1];
    upsert.run(key, latest, best[latest]);
  });
}

/** 把旧 JSON 里的编号计数器一并带过来，避免历史编号被复用 */
function applySourceSequences(sequences) {
  if (!sequences || typeof sequences !== 'object') return;
  const c = db.open();
  Object.keys(sequences).forEach((key) => {
    if (!mapping[key]) return;
    const seq = sequences[key];
    if (!seq || !seq.month || !Number.isFinite(Number(seq.value))) return;
    const cur = c.prepare('SELECT month, value FROM sequences WHERE table_key = ?').get(key);
    let value = Number(seq.value);
    if (cur && cur.month === seq.month) value = Math.max(value, cur.value);
    if (cur && cur.month === seq.month && cur.value >= value) return;
    c.prepare(
      `INSERT INTO sequences (table_key, month, value) VALUES (?, ?, ?)
       ON CONFLICT(table_key) DO UPDATE SET month = excluded.month, value = excluded.value`
    ).run(key, seq.month, value);
  });
}

function importTables(tablesData, report) {
  db.transaction(() => {
    tableKeys.forEach((key) => {
      const rows = tablesData[key] && Array.isArray(tablesData[key].records) ? tablesData[key].records : [];
      if (!rows.length) return;
      insertRecords(key, rows, report);
    });
    restoreSequences();
  });
}

/**
 * 从 JSON 文件迁移。
 * @param {{source:string, archive?:boolean, force?:boolean}} options
 */
function migrateFromJson(options = {}) {
  const source = options.source || path.join(db.DATA_DIR, 'store.json');
  if (!fs.existsSync(source)) throw new Error(`找不到数据文件：${source}`);
  const raw = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (!raw || !raw.tables) throw new Error('数据文件结构不正确，缺少 tables');

  const existing = tableKeys.reduce((sum, key) => {
    const n = db.open().prepare(`SELECT COUNT(*) AS n FROM ${mapping[key].table}`).get().n;
    return sum + n;
  }, 0);
  if (existing > 0 && !options.force) {
    throw new Error(`数据库里已有 ${existing} 条记录，如需重复导入请加 --force（会产生重复数据）`);
  }

  const expected = {};
  tableKeys.forEach((key) => {
    const rows = raw.tables[key] && Array.isArray(raw.tables[key].records) ? raw.tables[key].records : [];
    expected[key] = rows.length;
  });

  const report = { source, expected, counts: {}, skipped: [], archived: null };
  tableKeys.forEach((key) => {
    report.counts[key] = 0;
  });

  importTables(raw.tables, report);
  applySourceSequences(raw.sequences);

  const mismatched = tableKeys.filter((key) => report.counts[key] !== expected[key]);
  if (mismatched.length) {
    const detail = mismatched
      .map((key) => `${key} 期望 ${expected[key]} 实际 ${report.counts[key]}`)
      .join('；');
    throw new Error(`迁移条数不一致（${detail}），原文件未改动，请检查后重试`);
  }

  if (options.archive !== false) {
    fs.mkdirSync(db.LEGACY_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const target = path.join(db.LEGACY_DIR, `store-${stamp}.json`);
    fs.renameSync(source, target);
    report.archived = target;
  }

  return report;
}

/**
 * 首次启动时用 seed 生成示例数据（不经过 JSON 文件）。
 * @param {(state:object, makeId:Function, nowIso:Function)=>void} populate
 */
function seedToDatabase(populate) {
  const state = { tables: {} };
  tableKeys.forEach((key) => {
    state.tables[key] = { records: [] };
  });
  populate(state, makeId, () => new Date().toISOString());

  const report = { expected: {}, counts: {}, skipped: [], archived: null };
  tableKeys.forEach((key) => {
    report.expected[key] = state.tables[key].records.length;
    report.counts[key] = 0;
  });
  importTables(state.tables, report);
  return report.counts;
}

module.exports = { migrateFromJson, seedToDatabase };
