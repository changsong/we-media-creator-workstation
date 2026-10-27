'use strict';

/**
 * 发布任务队列。
 *
 * 任务 = 一条内容日历排期 + 一个视频 + 发布参数，交给 lib/publishers 下的渠道适配器执行。
 * 同一时间只跑一条；应用重启后，残留的「进行中」任务标记为失败，避免重复投稿。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const media = require('./media');
const publishers = require('./publishers');
const browserLogin = require('./browser-login');

const PUBLISH_DIR = path.join(db.DATA_DIR, 'publish-logs');
const SEQUENCE_KEY = 'publish';
const TICK_MS = 30 * 1000;
const MISS_WINDOW_MS = 6 * 60 * 60 * 1000;
const LOG_MAX_BYTES = 200 * 1024;
// 「待核验」任务的自动复核间隔与最长复核窗口（视频号等平台需要过审后才出现在作品列表）
const VERIFY_SWEEP_MS = 10 * 60 * 1000;
const VERIFY_MAX_AGE_MS = 72 * 60 * 60 * 1000;

const STATUSES = ['draft', 'scheduled', 'running', 'needs_confirm', 'submitted', 'published', 'failed', 'canceled'];
const STATUS_LABELS = {
  draft: '草稿',
  scheduled: '已排程',
  running: '进行中',
  needs_confirm: '待确认',
  submitted: '待核验',
  published: '已发布',
  failed: '失败',
  canceled: '已取消'
};
const EDITABLE = ['draft', 'scheduled', 'failed', 'canceled'];

let timer = null;
let runningId = null;
// 执行中被删除的任务：适配器在下一次检查点中止，避免删除后仍继续点击发布
const abortedRuns = new Set();
let changeHook = null;
let lastVerifySweepAt = 0;

function conn() {
  return db.open();
}

function nowIso() {
  return new Date().toISOString();
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function localMinute(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

function localNowMinute() {
  return localMinute(new Date());
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function setChangeHook(fn) {
  changeHook = typeof fn === 'function' ? fn : null;
}

function notify(table, action, id) {
  if (changeHook) changeHook(table, action, id);
}

function nextCode() {
  const d = new Date();
  const month = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}`;
  const prefix = `PUB${month}-`;
  const c = conn();
  const rows = c.prepare('SELECT code FROM publish_tasks WHERE code LIKE ?').all(`${prefix}%`);
  let max = 0;
  rows.forEach((r) => {
    const n = parseInt(String(r.code).slice(prefix.length), 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  });
  const seq = c.prepare('SELECT month, value FROM sequences WHERE table_key = ?').get(SEQUENCE_KEY);
  if (seq && seq.month === month && seq.value > max) max = seq.value;
  const next = max + 1;
  c.prepare(
    `INSERT INTO sequences (table_key, month, value) VALUES (?, ?, ?)
     ON CONFLICT(table_key) DO UPDATE SET month = excluded.month, value = excluded.value`
  ).run(SEQUENCE_KEY, month, next);
  return `${prefix}${pad(next)}`;
}

function parseTags(raw) {
  const arr = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[,，\s]+/);
  const out = [];
  arr.forEach((item) => {
    let text = String(item == null ? '' : item).trim().replace(/^#+/, '');
    if (!text) return;
    text = text.slice(0, 20);
    if (out.indexOf(text) < 0) out.push(text);
  });
  return out.slice(0, 10);
}

function toPublic(row, mediaItems) {
  let tags = [];
  try {
    tags = row.tags ? JSON.parse(row.tags) : [];
  } catch (err) {
    tags = [];
  }
  const items = Array.isArray(mediaItems) ? mediaItems : [];
  const kind = items.length ? (items[0].kind === 'image' ? 'image' : 'video') : '';
  return {
    _id: row.id,
    code: row.code,
    scheduleCode: row.schedule_code,
    scheduleTitle: row.schedule_title || '',
    platform: row.platform,
    title: row.title,
    description: row.description || '',
    tags,
    kind,
    media: items,
    scheduledAt: row.scheduled_at,
    mode: row.mode,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    publishUrl: row.publish_url || '',
    workId: row.work_id || '',
    error: row.error || '',
    attempts: row.attempts || 0,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SELECT_SQL = `SELECT t.*, s.id AS schedule_id, s.title AS schedule_title
  FROM publish_tasks t
  LEFT JOIN schedules s ON s.code = t.schedule_code`;

function findRow(id) {
  if (!id) return null;
  return conn().prepare(SELECT_SQL + ' WHERE t.id = ?').get(String(id)) || null;
}

function get(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  return toPublic(row, media.listForTask(id));
}

function list() {
  const rows = conn()
    .prepare(SELECT_SQL + ' ORDER BY t.created_at DESC, t.rowid DESC')
    .all();
  const map = media.listForTasks(rows.map((row) => row.id));
  return rows.map((row) => toPublic(row, map[row.id]));
}

/** 排期平台存储为 JSON 数组；兼容旧的纯字符串 */
function schedulePlatforms(row) {
  const raw = row && row.platform;
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return [];
    if (text.charAt(0) === '[') {
      try {
        const parsed = JSON.parse(text);
        list = Array.isArray(parsed) ? parsed : [text];
      } catch (err) {
        list = [text];
      }
    } else {
      list = [text];
    }
  }
  const out = [];
  list.forEach((item) => {
    const text = String(item == null ? '' : item).trim();
    if (text && out.indexOf(text) < 0) out.push(text);
  });
  return out;
}

function activeTaskForSchedule(scheduleCode, platform, ignoreId) {
  let sql = `SELECT * FROM publish_tasks
    WHERE schedule_code = ? AND status IN ('scheduled','running','needs_confirm','submitted') AND id <> ?`;
  const params = [scheduleCode, ignoreId || ''];
  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }
  return conn().prepare(sql + ' LIMIT 1').get(...params);
}

/** 自动排期幂等：同排期同平台已有任务（未取消/未失败）就不再建 */
function existingTaskForSchedule(scheduleCode, platform) {
  return conn()
    .prepare(
      `SELECT * FROM publish_tasks
       WHERE schedule_code = ? AND platform = ? AND status NOT IN ('canceled','failed')
       LIMIT 1`
    )
    .get(scheduleCode, platform);
}

/**
 * 日历「备注」补全到待执行任务的描述里。
 * 只补空描述，不覆盖在发布中心人工改过的描述。
 */
function syncNoteDescription(taskRow, schedule) {
  if (!taskRow || ['draft', 'scheduled'].indexOf(taskRow.status) < 0) return false;
  if (String(taskRow.description || '').trim()) return false;
  const note = String((schedule && schedule.note) || '').trim().slice(0, 2000);
  if (!note) return false;
  conn()
    .prepare('UPDATE publish_tasks SET description = ?, updated_at = ? WHERE id = ?')
    .run(note, nowIso(), taskRow.id);
  notify('publish', 'update', taskRow.id);
  return true;
}

/**
 * 日历「计划发布时间」同步到已有任务：时间变了直接改队列，没变返回 false。
 * 只同步还没开始执行的任务，避免改动正在投稿或已投稿的记录。
 */
function syncScheduledAt(taskRow, schedule) {
  if (!taskRow || ['draft', 'scheduled'].indexOf(taskRow.status) < 0) return false;
  const raw = String((schedule && schedule.publish_at) || '').trim();
  if (!raw) return false;
  const next = localMinute(raw);
  if (Number.isNaN(new Date(next).getTime())) return false;
  if (next === taskRow.scheduled_at) return false;
  conn()
    .prepare('UPDATE publish_tasks SET scheduled_at = ?, updated_at = ? WHERE id = ?')
    .run(next, nowIso(), taskRow.id);
  notify('publish', 'update', taskRow.id);
  return next;
}

/** 启动时补全历史遗留的空描述任务（例如本次升级前已排好的任务） */
function syncScheduledNotes() {
  const rows = conn()
    .prepare(
      `SELECT t.id, t.description, t.status, s.note
       FROM publish_tasks t
       JOIN schedules s ON s.code = t.schedule_code
       WHERE t.status IN ('draft','scheduled')`
    )
    .all();
  let count = 0;
  rows.forEach((row) => {
    if (syncNoteDescription(row, { note: row.note })) count++;
  });
  return count;
}

function create(body) {
  const b = body || {};
  const scheduleCode = String(b.scheduleCode || b['排期ID'] || '').trim();
  if (!scheduleCode) throw httpError(400, '请选择要发布的排期');
  const schedule = conn().prepare('SELECT * FROM schedules WHERE code = ?').get(scheduleCode);
  if (!schedule) throw httpError(404, '排期不存在：' + scheduleCode);

  const platforms = schedulePlatforms(schedule);
  const requested = String(b.platform || '').trim();
  if (requested && platforms.indexOf(requested) < 0) {
    throw httpError(400, `「${requested}」不在该排期的平台里`);
  }
  const platform = requested || platforms.find((p) => publishers.supported(p)) || platforms[0] || '';
  if (!platform) throw httpError(400, '请选择要发布的平台');
  if (!publishers.supported(platform)) {
    throw httpError(400, `「${platform}」暂未接入自动发布`);
  }
  const formatKind = media.kindForFormat(schedule.format);
  if (schedule.format && !formatKind) {
    throw httpError(400, `「${schedule.format}」暂不支持自动发布`);
  }
  if (activeTaskForSchedule(scheduleCode, platform)) {
    throw httpError(409, `「${platform}」已有进行中的发布任务`);
  }

  let ids = Array.isArray(b.mediaIds) ? b.mediaIds.map((x) => String(x)) : [];
  if (!ids.length) ids = media.list({ scheduleId: schedule.id }).map((m) => m.id);
  if (!ids.length) throw httpError(400, '请先在内容日历上传视频/图片素材');

  const items = ids.map((id) => {
    const item = media.get(id);
    if ((item.role || 'content') !== 'content') throw httpError(400, '封面不能作为发布素材');
    if (item.scheduleId && item.scheduleId !== schedule.id) {
      throw httpError(409, '素材不属于这条排期：' + item.name);
    }
    return item;
  });
  const kinds = {};
  items.forEach((item) => { kinds[item.kind] = true; });
  if (Object.keys(kinds).length > 1) throw httpError(400, '视频与图片不能混在同一次发布里');
  const kind = items[0].kind;
  if (formatKind && kind !== formatKind) {
    throw httpError(400, schedule.format === '短视频' ? '短视频排期需要 1 个视频素材' : '图文排期需要图片素材');
  }
  if (kind === 'video' && items.length > 1) throw httpError(400, '短视频只能发布 1 个视频');
  if (kind === 'image' && items.length > media.IMAGE_MAX_COUNT) {
    throw httpError(400, `图文最多 ${media.IMAGE_MAX_COUNT} 张图片`);
  }
  if (!publishers.supportsKind(platform, kind)) {
    throw httpError(400, `「${platform}」目前不支持${kind === 'image' ? '图文' : '短视频'}自动发布`);
  }

  const staged = items.filter((item) => !item.scheduleId);
  if (staged.length) {
    if (media.list({ scheduleId: schedule.id }).length) {
      throw httpError(400, '排期已有素材，请先到内容日历确认素材');
    }
    media.attachToSchedule(schedule.id, staged.map((item) => item.id));
  }

  let title = String(b.title == null ? schedule.title : b.title).trim();
  if (!title) title = String(schedule.title || '').trim();
  if (!title) throw httpError(400, '作品标题不能为空');
  if (title.length > 80) title = title.slice(0, 80);

  // 未显式传描述时，用内容日历的「备注」作为发布文案（抖音落「描述」、B站落「简介」等）
  const rawDescription = b.description == null ? schedule.note : b.description;
  const description = String(rawDescription == null ? '' : rawDescription).trim().slice(0, 2000);
  // 自动排期时没显式传话题，就沿用内容日历里填好的「标签」
  let scheduleTags = [];
  try {
    scheduleTags = schedule.tags ? JSON.parse(schedule.tags) : [];
  } catch (err) {
    scheduleTags = [];
  }
  const tags = parseTags(typeof b.tags === 'undefined' ? scheduleTags : b.tags);
  // 发布任务统一自动执行，不再有「等待人工确认」模式
  const mode = 'auto';

  let scheduledAt = b.scheduledAt ? localMinute(b.scheduledAt) : '';
  if (!scheduledAt) scheduledAt = localMinute(schedule.publish_at || new Date());
  if (Number.isNaN(new Date(scheduledAt).getTime())) throw httpError(400, '计划执行时间格式不正确');

  const id = 'pub_' + crypto.randomBytes(6).toString('hex');
  const code = nextCode();
  const now = nowIso();
  conn()
    .prepare(
      `INSERT INTO publish_tasks
        (id, code, schedule_code, platform, title, description, tags, scheduled_at, mode, status,
         publish_url, work_id, error, attempts, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL, NULL, 0, NULL, NULL, ?, ?)`
    )
    .run(
      id, code, scheduleCode, platform, title, description || null, JSON.stringify(tags),
      scheduledAt, mode, now, now
    );
  media.attachToTask(id, ids);
  notify('publish', 'create', id);
  return get(id);
}

function update(id, body) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  if (EDITABLE.indexOf(row.status) < 0) {
    throw httpError(409, `任务当前状态为「${STATUS_LABELS[row.status] || row.status}」，不能修改`);
  }
  const b = body || {};
  let title = row.title;
  let description = row.description;
  let tags = row.tags;
  let scheduledAt = row.scheduled_at;
  const mode = 'auto';

  if (typeof b.title !== 'undefined') {
    const next = String(b.title == null ? '' : b.title).trim();
    if (!next) throw httpError(400, '作品标题不能为空');
    title = next.slice(0, 80);
  }
  if (typeof b.description !== 'undefined') {
    description = String(b.description == null ? '' : b.description).trim().slice(0, 2000) || null;
  }
  if (typeof b.tags !== 'undefined') tags = JSON.stringify(parseTags(b.tags));
  if (typeof b.scheduledAt !== 'undefined') {
    if (!b.scheduledAt) throw httpError(400, '计划执行时间不能为空');
    scheduledAt = localMinute(b.scheduledAt);
    if (Number.isNaN(new Date(scheduledAt).getTime())) throw httpError(400, '计划执行时间格式不正确');
  }
  conn()
    .prepare(
      `UPDATE publish_tasks
       SET title = ?, description = ?, tags = ?, scheduled_at = ?, mode = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(title, description, tags, scheduledAt, mode, nowIso(), id);
  notify('publish', 'update', id);
  return get(id);
}

function setStatus(id, status, patch) {
  const p = patch || {};
  conn()
    .prepare(
      `UPDATE publish_tasks
       SET status = ?, publish_url = COALESCE(?, publish_url), work_id = COALESCE(?, work_id),
           error = ?, finished_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      p.publishUrl || null,
      p.workId || null,
      p.error == null ? null : String(p.error),
      p.finishedAt || null,
      nowIso(),
      id
    );
  notify('publish', 'update', id);
}

function cancel(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  if (row.status === 'running') throw httpError(409, '任务正在执行，无法取消');
  if (row.status === 'published' || row.status === 'submitted') {
    throw httpError(409, '任务已提交，无法取消');
  }
  setStatus(id, 'canceled', { finishedAt: nowIso() });
  appendLog(row.code, '任务已取消');
  return get(id);
}

function retry(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  if (row.status !== 'failed' && row.status !== 'canceled') {
    throw httpError(409, '只有失败或已取消的任务可以重试');
  }
  conn()
    .prepare(
      `UPDATE publish_tasks
       SET status = 'scheduled', scheduled_at = ?, error = NULL, finished_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(localNowMinute(), nowIso(), id);
  notify('publish', 'update', id);
  appendLog(row.code, '已重新排入队列');
  kick();
  return get(id);
}

function runNow(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  if (row.status === 'running') throw httpError(409, '任务正在执行');
  if (row.status === 'published' || row.status === 'submitted') {
    throw httpError(409, '任务已发布或已提交，不能重复执行');
  }
  conn()
    .prepare(
      `UPDATE publish_tasks
       SET status = 'scheduled', scheduled_at = ?, error = NULL, finished_at = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(localNowMinute(), nowIso(), id);
  notify('publish', 'update', id);
  kick();
  return get(id);
}

function complete(id, body) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  if (row.status === 'running') throw httpError(409, '任务正在执行，请任务结束后再标记');
  const b = body || {};
  let publishUrl = String(b.publishUrl || '').trim();
  if (publishUrl) {
    if (!/^https?:\/\//i.test(publishUrl)) throw httpError(400, '发布链接需要以 http:// 或 https:// 开头');
    try {
      new URL(publishUrl);
    } catch (err) {
      throw httpError(400, '发布链接格式不正确');
    }
  }
  setStatus(id, 'published', {
    publishUrl: publishUrl || null,
    finishedAt: nowIso(),
    error: ''
  });
  appendLog(row.code, '已人工标记为发布成功' + (publishUrl ? '：' + publishUrl : ''));
  updateCalendar(row, publishUrl);
  return get(id);
}

function remove(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  if (row.status === 'running') abortedRuns.add(id);
  conn().prepare('DELETE FROM publish_tasks WHERE id = ?').run(id);
  media.detachFromTask(id);
  try {
    fs.rmSync(path.join(PUBLISH_DIR, row.code), { recursive: true, force: true });
  } catch (err) {
    /* 日志目录可能被占用，下次清理 */
  }
  notify('publish', 'delete', id);
  return { id };
}

function logPath(code) {
  return path.join(PUBLISH_DIR, code, 'run.log');
}

function appendLog(code, message, level) {
  if (!code) return;
  const dir = path.join(PUBLISH_DIR, code);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    fs.appendFileSync(logPath(code), `[${stamp}]${level === 'warn' ? ' WARN' : ''} ${message}\n`, 'utf8');
  } catch (err) {
    /* 日志失败不阻塞发布 */
  }
}

function getLog(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '发布任务不存在');
  try {
    const file = logPath(row.code);
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - LOG_MAX_BYTES);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return '';
  }
}

function saveScreenshot(code, name, base64) {
  try {
    const dir = path.join(PUBLISH_DIR, code);
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || 'shot').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'shot';
    fs.writeFileSync(path.join(dir, `${safe}-${Date.now()}.png`), Buffer.from(base64, 'base64'));
  } catch (err) {
    /* 截图失败不阻塞发布 */
  }
}

function listScreenshots(id) {
  const row = findRow(id);
  if (!row) return [];
  const dir = path.join(PUBLISH_DIR, row.code);
  let names;
  try {
    names = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f));
  } catch (err) {
    return [];
  }
  return names
    .map((name) => {
      let createdAt = '';
      try {
        createdAt = fs.statSync(path.join(dir, name)).mtime.toISOString();
      } catch (err) {
        /* 文件可能刚被清理 */
      }
      return {
        name,
        createdAt,
        url: `/api/publish/tasks/${id}/screenshot/${encodeURIComponent(name)}`
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function getScreenshot(id, name) {
  const row = findRow(id);
  if (!row) return null;
  const safe = path.basename(String(name || ''));
  if (!/^[a-z0-9_.-]+\.png$/i.test(safe)) return null;
  const filePath = path.join(PUBLISH_DIR, row.code, safe);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mime: 'image/png' };
}

function updateCalendar(taskRow, publishUrl) {
  const schedule = conn().prepare('SELECT * FROM schedules WHERE code = ?').get(taskRow.schedule_code);
  if (!schedule) return;
  // 多平台排期：还有其他平台的任务没结束时，先不把阶段改成「已发布」
  const pending = conn()
    .prepare(
      `SELECT COUNT(*) AS n FROM publish_tasks
       WHERE schedule_code = ? AND id <> ?
         AND status IN ('scheduled','running','needs_confirm','submitted')`
    )
    .get(taskRow.schedule_code, taskRow.id).n;
  const finished = ['已发布', '二次分发', '已复盘'].indexOf(schedule.stage) >= 0;
  const nextStage = pending || finished ? schedule.stage : '已发布';
  const nextUrl = publishUrl || schedule.publish_url || '';
  conn()
    .prepare('UPDATE schedules SET stage = ?, publish_url = ?, updated_at = ? WHERE id = ?')
    .run(nextStage, nextUrl, nowIso(), schedule.id);
  notify('calendar', 'update', schedule.id);
}

/**
 * 保存排期后自动排队：阶段「待发布」、平台已接入、素材齐全时，
 * 每个已接入平台各建一条自动发布任务；已有任务时同步计划执行时间，
 * 时间没变则静默跳过；不满足条件则返回跳过原因。
 */
function autoEnqueue(scheduleCode) {
  const code = String(scheduleCode || '').trim();
  if (!code) throw httpError(400, '缺少排期编号');
  const schedule = conn().prepare('SELECT * FROM schedules WHERE code = ?').get(code);
  if (!schedule) throw httpError(404, '排期不存在：' + code);

  const result = {
    scheduleCode: schedule.code,
    scheduleTitle: schedule.title || '',
    scanned: 1,
    created: [],
    updated: [],
    skipped: []
  };
  const skip = (platform, reason) => result.skipped.push({ platform: platform || '', reason });

  if (schedule.stage !== '待发布') {
    skip('', '当前阶段不是「待发布」');
    return result;
  }
  const platforms = schedulePlatforms(schedule);
  if (!platforms.length) {
    skip('', '还没有选择平台');
    return result;
  }
  const formatKind = media.kindForFormat(schedule.format);
  if (!formatKind) {
    skip('', `「${schedule.format || '未填内容形式'}」暂不支持自动发布`);
    return result;
  }
  const items = media.list({ scheduleId: schedule.id });
  if (!items.length) {
    skip('', '还没有上传发布素材');
    return result;
  }
  const want = schedule.format === '短视频' ? 'video' : 'image';
  if (!items.some((item) => item.kind === want)) {
    skip('', schedule.format === '短视频' ? '需要上传 1 个视频素材' : '需要上传图片素材');
    return result;
  }

  const supported = [];
  platforms.forEach((p) => {
    if (!publishers.supported(p)) skip(p, `「${p}」暂未接入自动发布`);
    else if (!publishers.supportsKind(p, want)) {
      skip(p, `「${p}」暂不支持${want === 'image' ? '图文' : '短视频'}自动发布`);
    } else supported.push(p);
  });
  if (!supported.length) return result;

  const publishAt = new Date(schedule.publish_at || '');
  const overdue = Number.isFinite(publishAt.getTime()) && publishAt.getTime() < Date.now();

  supported.forEach((platform) => {
    const existing = existingTaskForSchedule(code, platform);
    if (existing) {
      syncNoteDescription(existing, schedule);
      const nextAt = syncScheduledAt(existing, schedule);
      if (nextAt) {
        result.updated.push({
          platform,
          taskId: existing.id,
          code: existing.code,
          previousAt: existing.scheduled_at,
          scheduledAt: nextAt
        });
      }
      skip(platform, '已有发布任务 ' + existing.code);
      return;
    }
    try {
      const body = { scheduleCode: code, platform };
      if (overdue) body.scheduledAt = localNowMinute();
      const task = create(body);
      result.created.push({ _id: task._id, code: task.code, platform });
    } catch (err) {
      skip(platform, err && err.message ? err.message : '创建失败');
    }
  });
  return result;
}

async function execute(taskId) {
  if (runningId) throw httpError(409, '另一个发布任务正在执行');
  const row = findRow(taskId);
  if (!row) throw httpError(404, '发布任务不存在');
  if (row.status !== 'scheduled') throw httpError(409, '任务状态不是已排程');

  const mediaItems = media.listForTask(taskId);
  if (!mediaItems.length) {
    setStatus(taskId, 'failed', { error: '任务没有可发布的素材', finishedAt: nowIso() });
    appendLog(row.code, '任务没有可发布的素材，任务失败');
    return get(taskId);
  }
  const missing = mediaItems.filter((item) => !media.getFile(item.id));
  if (missing.length) {
    const message = '素材文件已丢失：' + missing.map((item) => item.name).join('、');
    setStatus(taskId, 'failed', { error: message, finishedAt: nowIso() });
    appendLog(row.code, message + '，任务失败');
    return get(taskId);
  }

  const adapter = publishers.get(row.platform);
  if (!adapter) {
    setStatus(taskId, 'failed', { error: `「${row.platform}」暂未接入自动发布`, finishedAt: nowIso() });
    return get(taskId);
  }

  runningId = taskId;
  conn()
    .prepare(
      `UPDATE publish_tasks
       SET status = 'running', attempts = attempts + 1, started_at = ?, finished_at = NULL, error = NULL, updated_at = ?
       WHERE id = ?`
    )
    .run(nowIso(), nowIso(), taskId);
  notify('publish', 'update', taskId);
  appendLog(row.code, `开始执行（第 ${(row.attempts || 0) + 1} 次）`);
  if (process.env.WB_PUBLISH_MOCK === '1') appendLog(row.code, '使用模拟渠道适配器', 'warn');

  const task = get(taskId);
  const videoItem = mediaItems.find((item) => item.kind === 'video') || null;
  const videoFile = videoItem ? media.getFile(videoItem.id) : null;
  const covers = row.schedule_id
    ? media
        .listCovers(row.schedule_id)
        .map((item) => {
          const file = media.getFile(item.id);
          return file ? { id: item.id, ratio: item.ratio, name: item.name, path: file.filePath } : null;
        })
        .filter(Boolean)
    : [];
  const isAborted = () => abortedRuns.has(taskId);
  const ctx = {
    task,
    media: mediaItems,
    kind: mediaItems[0].kind,
    video: videoItem,
    videoPath: videoFile ? videoFile.filePath : null,
    covers,
    imagePaths: mediaItems
      .filter((item) => item.kind === 'image')
      .map((item) => media.getFile(item.id).filePath),
    isAborted,
    log: (message, level) => {
      if (!isAborted()) appendLog(row.code, message, level);
    },
    saveScreenshot: (name, base64) => {
      if (!isAborted()) saveScreenshot(row.code, name, base64);
    }
  };

  try {
    const result = (await adapter.run(ctx)) || {};
    if (isAborted()) return null;
    const status = STATUSES.indexOf(result.status) >= 0 ? result.status : 'failed';
    const patch = {
      publishUrl: result.publishUrl || null,
      workId: result.workId || null,
      error: status === 'failed' ? result.message || '发布失败' : '',
      finishedAt: nowIso()
    };
    setStatus(taskId, status, patch);
    appendLog(row.code, '任务结束：' + (STATUS_LABELS[status] || status) + (result.message ? ' · ' + result.message : ''));
    if (result.message && status === 'failed') appendLog(row.code, result.message, 'warn');
    if (status === 'published') updateCalendar(row, result.publishUrl || null);
  } catch (err) {
    if (isAborted()) return null;
    const message = err && err.message ? err.message : '发布失败';
    setStatus(taskId, 'failed', { error: message, finishedAt: nowIso() });
    appendLog(row.code, '任务失败：' + message, 'warn');
  } finally {
    runningId = null;
    abortedRuns.delete(taskId);
  }
  return get(taskId);
}

function recoverInterrupted() {
  const rows = conn().prepare("SELECT id, code FROM publish_tasks WHERE status = 'running'").all();
  rows.forEach((row) => {
    conn()
      .prepare(
        `UPDATE publish_tasks
         SET status = 'failed', error = '上次运行中断，请确认作品状态后重试', finished_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), nowIso(), row.id);
    appendLog(row.code, '检测到上次运行中断，任务已标记为失败', 'warn');
    notify('publish', 'update', row.id);
  });

  // 「等待人工确认」模式已取消，遗留任务转为失败，用户重试后会直接自动发布
  const pending = conn().prepare("SELECT id, code FROM publish_tasks WHERE status = 'needs_confirm'").all();
  pending.forEach((row) => {
    conn()
      .prepare(
        `UPDATE publish_tasks
         SET status = 'failed', error = '「等待人工确认」模式已取消，请重试（将自动发布）', finished_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(nowIso(), nowIso(), row.id);
    appendLog(row.code, '「等待人工确认」模式已取消，任务已标记为失败，可重试自动发布', 'warn');
    notify('publish', 'update', row.id);
  });
  return rows.length + pending.length;
}

function markMissed() {
  const cutoff = Date.now() - MISS_WINDOW_MS;
  const rows = conn().prepare("SELECT id, code, scheduled_at FROM publish_tasks WHERE status = 'scheduled'").all();
  let count = 0;
  rows.forEach((row) => {
    const t = new Date(row.scheduled_at).getTime();
    if (Number.isFinite(t) && t < cutoff) {
      conn()
        .prepare(
          `UPDATE publish_tasks
           SET status = 'failed', error = '已错过计划发布时间（超过 6 小时），可调整时间后重试', finished_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nowIso(), nowIso(), row.id);
      appendLog(row.code, '任务已超过补发窗口，标记为失败', 'warn');
      notify('publish', 'update', row.id);
      count++;
    }
  });
  return count;
}

/**
 * 定时复核「待核验」任务。
 * 部分平台（如视频号）的作品提交后需要先过审才会出现在作品列表里，
 * 发布时轮询不到不代表失败；这里定期再查一次，查到后自动改为「已发布」。
 */
async function reverifySubmitted() {
  const now = Date.now();
  if (now - lastVerifySweepAt < VERIFY_SWEEP_MS) return 0;
  lastVerifySweepAt = now;

  const since = new Date(now - VERIFY_MAX_AGE_MS).toISOString();
  const rows = conn()
    .prepare(
      `SELECT * FROM publish_tasks
       WHERE status = 'submitted' AND finished_at IS NOT NULL AND finished_at >= ?`
    )
    .all(since);

  let count = 0;
  for (const row of rows) {
    const adapter = publishers.get(row.platform);
    if (!adapter || typeof adapter.verify !== 'function') continue;
    try {
      const found = await adapter.verify(toPublic(row, []));
      if (!found) continue;
      setStatus(row.id, 'published', {
        workId: found.workId || null,
        publishUrl: found.publishUrl || null,
        finishedAt: nowIso(),
        error: ''
      });
      appendLog(
        row.code,
        '自动核验成功：作品已出现在平台列表' + (found.workId ? '（ID: ' + found.workId + '）' : '')
      );
      updateCalendar(row, found.publishUrl || null);
      count++;
    } catch (err) {
      console.warn('[publish] ' + row.platform + ' 自动核验失败：', err.message);
    }
  }
  return count;
}

/** 外部信号（如微博保留页观察器）确认平台已发布时，跳过复核冷却立刻扫一轮 */
function requestVerifySweep() {
  lastVerifySweepAt = 0;
  if (runningId) return;
  setTimeout(() => {
    reverifySubmitted().catch((err) => {
      console.warn('[publish] 自动核验异常：', err.message);
    });
  }, 50);
}

async function tick() {
  if (runningId) return null;
  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') return null;
  markMissed();
  const due = conn()
    .prepare(
      `SELECT id FROM publish_tasks
       WHERE status = 'scheduled' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC, rowid ASC LIMIT 1`
    )
    .get(localNowMinute());
  if (due) {
    try {
      return await execute(due.id);
    } catch (err) {
      console.warn('[publish] 任务执行异常：', err.message);
      return null;
    }
  }
  try {
    await reverifySubmitted();
  } catch (err) {
    console.warn('[publish] 自动核验异常：', err.message);
  }
  return null;
}

function kick() {
  setTimeout(() => { tick(); }, 50);
}

function startScheduler() {
  recoverInterrupted();
  // 升级前生成的任务描述为空，按日历备注补全，避免本轮发布漏掉文案
  syncScheduledNotes();
  if (timer) return true;
  timer = setInterval(() => { tick(); }, TICK_MS);
  if (timer.unref) timer.unref();
  setTimeout(() => { tick(); }, 1500);
  return true;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

function getStatus() {
  const c = conn();
  const running = runningId ? findRow(runningId) : null;
  return {
    scheduler: !!timer,
    running: running ? { id: running.id, code: running.code, title: running.title } : null,
    scheduled: c.prepare("SELECT COUNT(*) AS n FROM publish_tasks WHERE status = 'scheduled'").get().n,
    platforms: publishers.list()
  };
}

module.exports = {
  STATUSES,
  STATUS_LABELS,
  PUBLISH_DIR,
  setChangeHook,
  create,
  autoEnqueue,
  update,
  list,
  get,
  cancel,
  retry,
  runNow,
  complete,
  remove,
  getLog,
  listScreenshots,
  getScreenshot,
  getStatus,
  startScheduler,
  stopScheduler,
  tick,
  kick,
  requestVerifySweep
};
