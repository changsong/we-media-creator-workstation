'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { tables, tableOrder } = require('./schemas');
const { mapping } = require('./mapping');
const db = require('./db');

const dbPath = db.DB_FILE;
const DATA_DIR = db.DATA_DIR;
let backedUp = false;

/* ---------------- 工具 ---------------- */

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function currentMonth() {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}`;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function tableOf(tableKey) {
  const table = tables[tableKey];
  if (!table) throw httpError(404, `未知的表：${tableKey}`);
  return table;
}

function conn() {
  return db.open();
}

function touchBackup() {
  if (backedUp) return;
  backedUp = true;
  db.backupDaily();
}

/** SQLite 约束错误翻译成用户能读的中文 */
function translateDbError(err) {
  const msg = String((err && err.message) || '');
  if (/UNIQUE constraint failed: reviews\.schedule_code, reviews\.stat_date/.test(msg)) {
    return httpError(409, '这条排期在这一天已经有复盘快照了，请直接编辑那一条');
  }
  if (/UNIQUE constraint failed: \w+\.code/.test(msg)) {
    return httpError(409, '业务编号已存在，请换一个');
  }
  if (/CHECK constraint failed: score/.test(msg)) {
    return httpError(400, '「爆款潜力评分」必须在 0 到 10 之间');
  }
  if (/CHECK constraint failed: (reads|likes|followers|conversions)/.test(msg)) {
    return httpError(400, '数据指标不能是负数');
  }
  if (/CHECK constraint failed: word_count/.test(msg)) {
    return httpError(400, '「字数」不能是负数');
  }
  return err;
}

/* ---------------- 类型转换与校验 ---------------- */

function unwrap(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if ('text' in raw) return raw.text;
    if ('number' in raw) return raw.number;
    if ('select' in raw) return raw.select;
    if ('multi_select' in raw) return raw.multi_select;
    if ('tags' in raw) return raw.tags;
    if ('date' in raw) return raw.date;
    if ('url' in raw) return raw.url && raw.url.link !== undefined ? raw.url.link : raw.url;
    if ('checkbox' in raw) return raw.checkbox;
  }
  return raw;
}

function normalizeDate(value, withTime) {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw httpError(400, '日期格式不正确');
  const datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (!withTime) return datePart;
  return `${datePart}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function coerce(prop, raw) {
  const v = unwrap(raw);
  if (v === undefined || v === null || v === '') return undefined;

  switch (prop.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
      if (Number.isNaN(n)) throw httpError(400, `「${prop.name}」需要是数字`);
      const cfg = prop.config || {};
      if (cfg.min != null && n < cfg.min) throw httpError(400, `「${prop.name}」不能小于 ${cfg.min}`);
      if (cfg.max != null && n > cfg.max) throw httpError(400, `「${prop.name}」不能大于 ${cfg.max}`);
      return cfg.precision != null ? Number(n.toFixed(cfg.precision)) : n;
    }
    case 'select':
    case 'radio': {
      const text = String(v).trim();
      const options = ((prop.config && prop.config.options) || []).map((o) => o.text);
      if (options.length && options.indexOf(text) < 0) {
        throw httpError(400, `「${prop.name}」只能是：${options.join('、')}`);
      }
      return text;
    }
    case 'tags': {
      const arr = Array.isArray(v) ? v : String(v).split(/[,，|\s]+/);
      const out = [];
      arr.forEach((item) => {
        const text = String(item).trim();
        if (!text) return;
        if (text.length > 50) throw httpError(400, `「${prop.name}」单个标签最多 50 个字`);
        if (out.indexOf(text) < 0) out.push(text);
      });
      return out;
    }
    case 'multi_select': {
      const arr = Array.isArray(v) ? v : String(v).split(/[,，|]/);
      const options = ((prop.config && prop.config.options) || []).map((o) => o.text);
      const out = [];
      arr.forEach((item) => {
        const text = String(item).trim();
        if (!text) return;
        if (options.length && options.indexOf(text) < 0) {
          throw httpError(400, `「${prop.name}」包含不支持的选项：${text}`);
        }
        if (out.indexOf(text) < 0) out.push(text);
      });
      return out;
    }
    case 'date': {
      const withTime = !!prop.config && String(prop.config.format || '').indexOf('hh') >= 0;
      return normalizeDate(v, withTime);
    }
    case 'url': {
      const link = String(v).trim();
      if (!/^https?:\/\//i.test(link)) throw httpError(400, `「${prop.name}」需要以 http:// 或 https:// 开头`);
      try {
        new URL(link);
      } catch (err) {
        throw httpError(400, `「${prop.name}」不是合法链接`);
      }
      return link;
    }
    case 'checkbox':
      return v === true || v === 'true' || v === 1 || v === '1';
    case 'text':
    case 'long_text':
    default: {
      const text = String(v).trim();
      if (prop.maxLength && text.length > prop.maxLength) {
        throw httpError(400, `「${prop.name}」最多 ${prop.maxLength} 个字`);
      }
      return text;
    }
  }
}

function buildRecord(tableKey, props, existing) {
  const table = tableOf(tableKey);
  if (!props || typeof props !== 'object') throw httpError(400, '缺少 properties');

  const patch = {};
  const errors = [];
  const known = table.properties.map((p) => p.name);

  Object.keys(props).forEach((name) => {
    if (known.indexOf(name) < 0) errors.push(`字段「${name}」不在表结构里`);
  });
  if (errors.length) throw httpError(400, errors.join('；'));

  table.properties.forEach((prop) => {
    if (!(prop.name in props)) return;
    if (prop.readonly) return;
    try {
      const value = coerce(prop, props[prop.name]);
      patch[prop.name] = value === undefined ? null : value;
    } catch (err) {
      errors.push(err.message);
    }
  });
  if (errors.length) throw httpError(400, errors.join('；'));

  table.properties.forEach((prop) => {
    if (!prop.required || prop.readonly) return;
    const next = prop.name in patch ? patch[prop.name] : existing ? existing[prop.name] : undefined;
    if (next == null || next === '' || (Array.isArray(next) && !next.length)) {
      errors.push(`「${prop.name}」不能为空`);
    }
  });
  if (errors.length) throw httpError(400, errors.join('；'));

  return patch;
}

/* ---------------- 行 ↔ 记录 ---------------- */

function toRecord(tableKey, row) {
  const table = tables[tableKey];
  const map = mapping[tableKey];
  const out = { _id: row.id, _createdAt: row.created_at, _updatedAt: row.updated_at };
  table.properties.forEach((prop) => {
    const col = map.columns[prop.name];
    if (!col) return;
    const value = row[col];
    if (map.json.indexOf(prop.name) >= 0) {
      if (!value) {
        out[prop.name] = [];
      } else {
        try {
          out[prop.name] = JSON.parse(value);
        } catch (err) {
          out[prop.name] = [];
        }
      }
    } else if (prop.type === 'checkbox') {
      out[prop.name] = value === undefined || value === null ? false : !!value;
    } else {
      out[prop.name] = value === undefined ? null : value;
    }
  });
  return out;
}

/* ---------------- 业务编号 ---------------- */

function nextBusinessId(tableKey) {
  tableOf(tableKey);
  const map = mapping[tableKey];
  const month = currentMonth();
  const prefix = `${map.idPrefix}${month}-`;
  const c = conn();

  const rows = c.prepare(`SELECT code FROM ${map.table} WHERE code LIKE ?`).all(`${prefix}%`);
  let max = 0;
  rows.forEach((r) => {
    const n = parseInt(String(r.code).slice(prefix.length), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  });

  const seq = c.prepare('SELECT month, value FROM sequences WHERE table_key = ?').get(tableKey);
  if (seq && seq.month === month && seq.value > max) max = seq.value;

  const next = max + 1;
  c.prepare(
    `INSERT INTO sequences (table_key, month, value) VALUES (?, ?, ?)
     ON CONFLICT(table_key) DO UPDATE SET month = excluded.month, value = excluded.value`
  ).run(tableKey, month, next);

  return `${prefix}${pad(next)}`;
}

/* ---------------- CRUD ---------------- */

function list(tableKey, options = {}) {
  tableOf(tableKey);
  const map = mapping[tableKey];
  const pageSize = Math.min(Math.max(parseInt(options.pageSize, 10) || 200, 1), 500);
  const offset = Math.max(parseInt(options.cursor, 10) || 0, 0);
  const q = String(options.q || '').trim();

  let where = '';
  const params = [];
  if (q) {
    where = ` WHERE (${map.searchable.map((col) => `${col} LIKE ?`).join(' OR ')})`;
    map.searchable.forEach(() => params.push(`%${q}%`));
  }

  const c = conn();
  const total = c.prepare(`SELECT COUNT(*) AS n FROM ${map.table}${where}`).get(...params).n;
  const rows = c
    .prepare(`SELECT * FROM ${map.table}${where} ORDER BY created_at ASC, rowid ASC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);

  const next = offset + pageSize < total ? String(offset + pageSize) : null;
  return {
    results: rows.map((row) => toRecord(tableKey, row)),
    hasMore: !!next,
    nextCursor: next,
    total
  };
}

function get(tableKey, id) {
  tableOf(tableKey);
  const map = mapping[tableKey];
  const row = conn().prepare(`SELECT * FROM ${map.table} WHERE id = ?`).get(id);
  if (!row) throw httpError(404, '记录不存在或已被删除');
  return toRecord(tableKey, row);
}

function rowValues(tableKey, patch) {
  const map = mapping[tableKey];
  const cols = [];
  const values = [];
  Object.keys(map.columns).forEach((field) => {
    const col = map.columns[field];
    if (!(field in patch)) return;
    cols.push(col);
    let value = patch[field];
    if (map.json.indexOf(field) >= 0) value = JSON.stringify(value || []);
    if (typeof value === 'boolean') value = value ? 1 : 0;
    values.push(value === undefined ? null : value);
  });
  return { cols, values };
}

function assertReviewUnique(scheduleCode, statDate, ignoreId) {
  const row = conn()
    .prepare('SELECT id, code FROM reviews WHERE schedule_code = ? AND stat_date = ? AND id <> ?')
    .get(scheduleCode, statDate, ignoreId || '');
  if (row) {
    throw httpError(409, `排期 ${scheduleCode} 在 ${statDate} 已有快照 ${row.code}，请直接编辑那一条`);
  }
}

function create(tableKey, props) {
  const table = tableOf(tableKey);
  const map = mapping[tableKey];
  const patch = buildRecord(tableKey, props, null);
  const c = conn();

  // 先做唯一性校验，再取编号：避免失败的写入白白消耗一个序号
  if (tableKey === 'review') assertReviewUnique(patch['排期ID'], patch['统计日期']);

  const explicit = props[table.idField]
    ? coerce({ name: table.idField, type: 'text' }, props[table.idField])
    : '';
  const code = explicit || nextBusinessId(tableKey);
  if (c.prepare(`SELECT 1 FROM ${map.table} WHERE code = ?`).get(code)) {
    throw httpError(409, `「${table.idField}」${code} 已存在`);
  }
  patch[table.idField] = code;

  const now = nowIso();
  const { cols, values } = rowValues(tableKey, patch);
  const allCols = ['id', ...cols, 'created_at', 'updated_at'];
  const allValues = [makeId(tableKey), ...values, now, now];
  const sql = `INSERT INTO ${map.table} (${allCols.join(', ')}) VALUES (${allCols.map(() => '?').join(', ')})`;

  touchBackup();
  try {
    c.prepare(sql).run(...allValues);
  } catch (err) {
    throw translateDbError(err);
  }
  return get(tableKey, allValues[0]);
}

function update(tableKey, id, props) {
  const table = tableOf(tableKey);
  const map = mapping[tableKey];
  const current = get(tableKey, id);
  const patch = buildRecord(tableKey, props, current);

  if (props[table.idField] != null) {
    const nextCode = coerce({ name: table.idField, type: 'text' }, props[table.idField]);
    if (nextCode && nextCode !== current[table.idField]) {
      if (conn().prepare(`SELECT 1 FROM ${map.table} WHERE code = ? AND id <> ?`).get(nextCode, id)) {
        throw httpError(409, `「${table.idField}」${nextCode} 已存在`);
      }
      patch[table.idField] = nextCode;
    }
  }

  if (tableKey === 'review') {
    const schedule = '排期ID' in patch ? patch['排期ID'] : current['排期ID'];
    const statDate = '统计日期' in patch ? patch['统计日期'] : current['统计日期'];
    assertReviewUnique(schedule, statDate, id);
  }

  const { cols, values } = rowValues(tableKey, patch);
  const sets = cols.map((col) => `${col} = ?`);
  sets.push('updated_at = ?');
  const params = [...values, nowIso(), id];

  touchBackup();
  try {
    conn().prepare(`UPDATE ${map.table} SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } catch (err) {
    throw translateDbError(err);
  }
  return get(tableKey, id);
}

function remove(tableKey, id) {
  tableOf(tableKey);
  const map = mapping[tableKey];
  const current = get(tableKey, id);
  touchBackup();
  conn().prepare(`DELETE FROM ${map.table} WHERE id = ?`).run(id);
  return current;
}

function stats() {
  const c = conn();
  const out = {};
  tableOrder.forEach((key) => {
    out[key] = c.prepare(`SELECT COUNT(*) AS n FROM ${mapping[key].table}`).get().n;
  });
  return out;
}

/** 关联完整性：上游记录被删后下游仍保留原编号，这里统计悬空引用 */
function orphans() {
  const c = conn();
  return {
    schedules_without_topic: c
      .prepare(
        `SELECT COUNT(*) AS n FROM schedules s
         LEFT JOIN topics t ON t.code = s.topic_code
         WHERE s.topic_code IS NOT NULL AND s.topic_code <> '' AND t.code IS NULL`
      )
      .get().n,
    reviews_without_schedule: c
      .prepare(
        `SELECT COUNT(*) AS n FROM reviews r
         LEFT JOIN schedules s ON s.code = r.schedule_code
         WHERE s.code IS NULL AND r.schedule_code NOT LIKE '@monitor:%'`
      )
      .get().n,
    assets_without_refs: c
      .prepare(
        `SELECT COUNT(*) AS n FROM assets a
         LEFT JOIN topics t ON t.code = a.topic_code
         LEFT JOIN schedules s ON s.code = a.schedule_code
         WHERE (a.topic_code IS NOT NULL AND a.topic_code <> '' AND t.code IS NULL)
            OR (a.schedule_code IS NOT NULL AND a.schedule_code <> '' AND s.code IS NULL)`
      )
      .get().n
  };
}

/**
 * 公众号监控专用：把公众平台后台的账号级日聚合数据写入 reviews。
 * 不挂具体排期，用哨兵 schedule_code = '@monitor:<平台>' 占位，并在 orphans() 中排除，
 * 因此不会污染孤儿统计，也不触发「排期必填」。同一 (platform, stat_date) 有则更新、无则插入。
 * 注意：followers（净增粉）允许为负，已在 db 层放开该列的 >=0 CHECK（见 db.migrateReviews）。
 */
function upsertMonitor(statDate, metrics) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statDate || '')) {
    throw httpError(400, '统计日期格式应为 yyyy-mm-dd');
  }
  const platform = metrics.platform || '公众号';
  const reads = Math.max(0, parseInt(metrics.reads, 10) || 0);
  const likes = Math.max(0, parseInt(metrics.likes, 10) || 0);
  const followers = parseInt(metrics.followers, 10) || 0; // 净增粉可为负
  const conversions = Math.max(0, parseInt(metrics.conversions, 10) || 0);
  const scheduleCode = '@monitor:' + platform;
  const c = conn();
  const existing = c
    .prepare('SELECT id, code FROM reviews WHERE schedule_code = ? AND stat_date = ? AND platform = ?')
    .get(scheduleCode, statDate, platform);
  const now = nowIso();
  if (existing) {
    c.prepare(
      'UPDATE reviews SET reads = ?, likes = ?, followers = ?, conversions = ?, updated_at = ? WHERE id = ?'
    ).run(reads, likes, followers, conversions, now, existing.id);
    return { code: existing.code, updated: true };
  }
  const code = `WM-${statDate}-${platform}`;
  c.prepare(
    `INSERT INTO reviews (id, code, schedule_code, platform, stat_date, reads, likes, followers, conversions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(makeId('review'), code, scheduleCode, platform, statDate, reads, likes, followers, conversions, now, now);
  return { code, updated: false };
}

/** 读取某天的账号级快照；采集器在部分指标缺失时用它保留上一次的值。 */
function getMonitor(platform, statDate) {
  const row = conn()
    .prepare(
      'SELECT reads, likes, followers, conversions FROM reviews WHERE schedule_code = ? AND stat_date = ? AND platform = ?'
    )
    .get('@monitor:' + platform, statDate, platform);
  return row || null;
}

/**
 * 采集器专用：按「发布链接里的笔记 ID」或「标题」找已存在的排期，
 * 避免每次同步都重复新建内容日历记录。
 */
const PLATFORM_MATCH_SQL = `(CASE WHEN json_valid(schedules.platform)
  THEN EXISTS (SELECT 1 FROM json_each(schedules.platform) WHERE json_each.value = ?)
  ELSE schedules.platform = ? END)`;

function findScheduleByNote(platform, noteId, title) {
  const c = conn();
  if (noteId) {
    const byUrl = c
      .prepare(
        `SELECT * FROM schedules WHERE ${PLATFORM_MATCH_SQL} AND publish_url LIKE ? ORDER BY created_at ASC LIMIT 1`
      )
      .get(platform, platform, `%${noteId}%`);
    if (byUrl) return toRecord('calendar', byUrl);
    // 视频号等平台没有公开作品链接，发布链接为空，改按备注里记录的作品 ID 匹配
    const byNote = c
      .prepare(
        `SELECT * FROM schedules WHERE ${PLATFORM_MATCH_SQL} AND note LIKE ? ORDER BY created_at ASC LIMIT 1`
      )
      .get(platform, platform, `%${noteId}%`);
    if (byNote) return toRecord('calendar', byNote);
  }
  if (title) {
    // 仅匹配没填发布链接的排期；已有链接的是别的作品，同标题也不能并档。
    // 备注里已登记别的作品 ID 的自动同步记录同样跳过，避免同标题作品互相合并。
    const byTitle = noteId
      ? c
          .prepare(
            `SELECT * FROM schedules WHERE ${PLATFORM_MATCH_SQL} AND title = ? AND (publish_url IS NULL OR publish_url = '') ORDER BY created_at ASC`
          )
          .all(platform, platform, title)
          .find((row) => {
            const m = /ID:\s*([^\s）)]+)/.exec(row.note || '');
            return !m || m[1] === String(noteId);
          })
      : c
          .prepare(
            `SELECT * FROM schedules WHERE ${PLATFORM_MATCH_SQL} AND title = ? AND (publish_url IS NULL OR publish_url = '') ORDER BY created_at ASC LIMIT 1`
          )
          .get(platform, platform, title);
    if (byTitle) return toRecord('calendar', byTitle);
  }
  return null;
}

/**
 * 采集器专用：同一排期同一天只保留一条快照。已存在则更新指标，
 * 用户手写的复盘备注不会被自动备注覆盖。
 */
function upsertNoteSnapshot(scheduleCode, platform, statDate, metrics) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statDate || '')) {
    throw httpError(400, '统计日期格式应为 yyyy-mm-dd');
  }
  const reads = Math.max(0, parseInt(metrics.reads, 10) || 0);
  const likes = Math.max(0, parseInt(metrics.likes, 10) || 0);
  const followers = parseInt(metrics.followers, 10) || 0;
  const conversions = Math.max(0, parseInt(metrics.conversions, 10) || 0);
  const autoNote = metrics.note || null;
  const c = conn();
  const existing = c
    .prepare('SELECT id, code, note FROM reviews WHERE schedule_code = ? AND stat_date = ?')
    .get(scheduleCode, statDate);
  const now = nowIso();

  if (existing) {
    const note = existing.note && String(existing.note).trim() ? existing.note : autoNote;
    c.prepare(
      `UPDATE reviews SET platform = ?, reads = ?, likes = ?, followers = ?, conversions = ?, note = ?, updated_at = ?
       WHERE id = ?`
    ).run(platform, reads, likes, followers, conversions, note, now, existing.id);
    return { code: existing.code, updated: true };
  }

  const code = nextBusinessId('review');
  c.prepare(
    `INSERT INTO reviews
       (id, code, schedule_code, platform, stat_date, reads, likes, followers, conversions, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(makeId('review'), code, scheduleCode, platform, statDate, reads, likes, followers, conversions, autoNote, now, now);
  return { code, updated: false };
}

/* ---------------- CSV ---------------- */

function csvCell(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join(' | ') : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCSV(tableKey) {
  const table = tableOf(tableKey);
  const cols = table.properties.map((p) => p.name);
  const lines = [cols.map(csvCell).join(',')];
  const rows = conn()
    .prepare(`SELECT * FROM ${mapping[tableKey].table} ORDER BY created_at ASC, rowid ASC`)
    .all();
  rows.forEach((row) => {
    const rec = toRecord(tableKey, row);
    lines.push(cols.map((c) => csvCell(rec[c])).join(','));
  });
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/* ---------------- 启动 ---------------- */

function init() {
  db.open();
  try {
    if (db.ensureMediaRole()) console.log('[db] 已为发布素材增加封面角色字段');
  } catch (err) {
    console.warn('[db] 发布素材角色字段迁移失败：', err.message);
    throw err;
  }
  try {
    if (db.ensureMediaVariantRatio()) console.log('[db] 已为发布素材增加封面比例字段');
  } catch (err) {
    console.warn('[db] 发布素材封面比例字段迁移失败：', err.message);
    throw err;
  }
  try {
    if (db.ensureRecordingAssetId()) console.log('[db] 已为语音速记增加素材关联字段');
  } catch (err) {
    console.warn('[db] 语音速记素材关联字段迁移失败：', err.message);
    throw err;
  }
  try {
    if (db.ensureAssetVoiceReview()) console.log('[db] 已为素材库增加语音复盘字段');
  } catch (err) {
    console.warn('[db] 素材库语音复盘字段迁移失败：', err.message);
    throw err;
  }
  try {
    const added = db.ensureScheduleFields();
    if (added.length) console.log('[db] 已为内容日历增加发布设置字段：' + added.join(', '));
  } catch (err) {
    console.warn('[db] 内容日历发布设置字段迁移失败：', err.message);
    throw err;
  }
  try {
    const converted = db.ensureCalendarPlatformJson();
    if (converted) console.log('[db] 已把内容日历平台转换为多选：' + converted + ' 条');
  } catch (err) {
    console.warn('[db] 内容日历平台多选迁移失败：', err.message);
    throw err;
  }
  try {
    const relaxed = db.relaxFollowersCheck();
    if (relaxed) console.log('[db] 已放开 reviews.followers 非负约束（净增粉可记录负值）');
  } catch (err) {
    console.warn('[db] 放开 followers 约束失败（可忽略）：', err.message);
  }
  try {
    const migrated = db.migrateMedia();
    if (migrated) {
      console.log(
        `[db] 已迁移发布素材：${migrated.videos} 个视频、${migrated.tasks} 条任务关联` +
          (migrated.droppedVideos ? '，旧 videos 表已删除' : '')
      );
    }
  } catch (err) {
    console.warn('[db] 发布素材迁移失败：', err.message);
    throw err;
  }
  const legacy = path.join(DATA_DIR, 'store.json');
  const hasLegacy = fs.existsSync(legacy);
  const empty = stats().topic === 0 && stats().calendar === 0 && stats().review === 0 && stats().asset === 0;

  if (hasLegacy && empty) {
    const { migrateFromJson } = require('./migrate');
    const report = migrateFromJson({ source: legacy });
    console.log('[migrate] 检测到旧 JSON 数据，已迁移到 SQLite：', JSON.stringify(report.counts));
  } else if (empty) {
    const { populate } = require('./seed');
    const { seedToDatabase } = require('./migrate');
    const counts = seedToDatabase(populate);
    console.log('[seed] 首次启动，已写入示例数据：', JSON.stringify(counts));
  }
  db.open();
  return { dbPath, counts: stats() };
}

module.exports = {
  init,
  list,
  get,
  create,
  update,
  remove,
  upsertMonitor,
  getMonitor,
  findScheduleByNote,
  upsertNoteSnapshot,
  stats,
  orphans,
  integrity: db.integrity,
  toCSV,
  nextBusinessId,
  toRecord,
  tables,
  tableOrder,
  DATA_DIR,
  dbPath
};
