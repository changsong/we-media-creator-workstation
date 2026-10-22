'use strict';

/**
 * 发布素材：视频落盘到 data/videos，图片落盘到 data/images，元数据存 media 表。
 *
 * 上传接口接收原始文件流（非 multipart），边收边写，避免大文件进内存。
 * 素材可以暂存（schedule_id 为空），保存排期时再关联；删除只允许清理未被发布任务引用的素材，
 * 避免排队任务丢失源文件。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const VIDEOS_DIR = path.join(db.DATA_DIR, 'videos');
const IMAGES_DIR = path.join(db.DATA_DIR, 'images');
const VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_COUNT = 30;
const NAME_MAX = 120;
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const ROLES = ['content', 'cover'];

const VIDEO_MIME_EXT = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
  'video/x-ms-wmv': '.wmv',
  'video/x-flv': '.flv',
  'video/mpeg': '.mpeg'
};
const VIDEO_MIME_ALIASES = {
  'video/m4v': 'video/mp4',
  'video/x-m4v': 'video/mp4',
  'video/mov': 'video/quicktime',
  'video/x-quicktime': 'video/quicktime',
  'video/x-ms-asf': 'video/x-ms-wmv'
};
const VIDEO_EXT_MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg'
};
const IMAGE_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const IMAGE_MIME_ALIASES = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg'
};
const IMAGE_EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function conn() {
  return db.open();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ensureDirs() {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function dirFor(kind) {
  return kind === 'image' ? IMAGES_DIR : VIDEOS_DIR;
}

function normalizeName(raw) {
  let name = path.basename(String(raw == null ? '' : raw).trim()).replace(/[\r\n]/g, '');
  if (!name) name = 'material';
  if (name.length > NAME_MAX) {
    const ext = path.extname(name).slice(0, 12);
    name = name.slice(0, NAME_MAX - ext.length) + ext;
  }
  return name;
}

function normalizeMime(raw, originalName, kindHint) {
  const type = String(raw || '').split(';')[0].trim().toLowerCase();
  const ext = path.extname(originalName || '').toLowerCase();
  let mime = type;
  if (!mime || mime === 'application/octet-stream') {
    mime = VIDEO_EXT_MIME[ext] || IMAGE_EXT_MIME[ext] || '';
  }
  mime = VIDEO_MIME_ALIASES[mime] || IMAGE_MIME_ALIASES[mime] || mime;

  const isVideo = mime.indexOf('video/') === 0;
  const isImage = mime.indexOf('image/') === 0;
  if (!isVideo && !isImage) {
    throw httpError(415, '只支持视频（MP4 / MOV / WebM）或图片（JPG / PNG / WebP）文件');
  }
  if (kindHint && ((kindHint === 'video') !== isVideo)) {
    throw httpError(415, kindHint === 'video' ? '请选择视频文件' : '请选择图片文件');
  }
  if (isVideo) {
    if (VIDEO_MIME_EXT[mime]) return { mime, kind: 'video', ext: VIDEO_MIME_EXT[mime] };
    if (VIDEO_EXT_MIME[ext]) return { mime: VIDEO_EXT_MIME[ext], kind: 'video', ext };
    throw httpError(415, '不支持该视频格式，请选择 MP4 / MOV / WebM 文件');
  }
  if (IMAGE_MIME_EXT[mime]) return { mime, kind: 'image', ext: IMAGE_MIME_EXT[mime] };
  if (IMAGE_EXT_MIME[ext]) return { mime: IMAGE_EXT_MIME[ext], kind: 'image', ext };
  throw httpError(415, '不支持该图片格式，请选择 JPG / PNG / WebP 图片');
}

function normalizeRole(raw) {
  const role = String(raw == null ? '' : raw).trim() || 'content';
  if (ROLES.indexOf(role) < 0) throw httpError(400, '素材角色不正确');
  return role;
}

function normalizeDuration(raw) {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(86400, Math.round(n * 10) / 10);
}

function toPublic(row) {
  return {
    id: row.id,
    kind: row.kind,
    role: row.role || 'content',
    name: row.original_name || row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    durationSec: row.duration_sec,
    scheduleId: row.schedule_id || null,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    fileUrl: '/api/media/' + row.id + '/file'
  };
}

function createFromRequest(req, meta) {
  ensureDirs();
  const info = meta || {};
  const role = normalizeRole(info.role);
  const originalName = normalizeName(info.name);
  const normalized = normalizeMime(info.mime || req.headers['content-type'], originalName, info.kind);
  if (role === 'cover' && normalized.kind !== 'image') throw httpError(415, '封面必须是图片');
  const duration = normalized.kind === 'video' ? normalizeDuration(info.duration) : 0;
  const maxBytes = normalized.kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
  const id = crypto.randomUUID();
  const fileName = `${Date.now()}-${id.slice(0, 8)}${normalized.ext}`;
  const filePath = path.join(dirFor(normalized.kind), fileName);
  const createdAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const ws = fs.createWriteStream(filePath, { flags: 'wx' });

    function fail(err) {
      if (settled) return;
      settled = true;
      try { ws.destroy(); } catch (e) { /* noop */ }
      try { req.destroy(); } catch (e) { /* noop */ }
      fs.unlink(filePath, () => {});
      reject(err);
    }

    ws.on('error', (err) => fail(httpError(500, '无法保存素材文件：' + err.message)));
    req.on('error', (err) => fail(httpError(400, '素材上传中断：' + err.message)));
    req.on('aborted', () => fail(httpError(400, '素材上传已取消')));
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(httpError(413, normalized.kind === 'image' ? '单张图片不能超过 20MB' : '视频文件不能超过 4GB'));
      }
    });
    ws.on('finish', () => {
      if (settled) return;
      if (!size) return fail(httpError(400, '文件内容为空'));
      settled = true;
      try {
        const c = conn();
        c.prepare(
          `INSERT INTO media (id, kind, role, file_name, original_name, mime, size_bytes, duration_sec, schedule_id, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
        ).run(id, normalized.kind, role, fileName, originalName, normalized.mime, size, duration, createdAt);
        resolve(toPublic(c.prepare('SELECT * FROM media WHERE id = ?').get(id)));
      } catch (err) {
        fs.unlink(filePath, () => {});
        reject(err);
      }
    });
    req.pipe(ws);
  });
}

function list(options) {
  const opts = options || {};
  const role = normalizeRole(opts.role);
  const c = conn();
  if (opts.scheduleId) {
    return c
      .prepare('SELECT * FROM media WHERE schedule_id = ? AND role = ? ORDER BY sort_order ASC, created_at ASC, rowid ASC')
      .all(String(opts.scheduleId), role)
      .map(toPublic);
  }
  return c
    .prepare('SELECT * FROM media WHERE role = ? ORDER BY created_at DESC, rowid DESC')
    .all(role)
    .map(toPublic);
}

function findRow(id) {
  if (!id) return null;
  return conn().prepare('SELECT * FROM media WHERE id = ?').get(String(id)) || null;
}

function get(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '素材不存在');
  return toPublic(row);
}

function filePathOf(row) {
  return path.join(dirFor(row.kind), path.basename(row.file_name));
}

function getFile(id) {
  const row = findRow(id);
  if (!row) return null;
  const filePath = filePathOf(row);
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mime: row.mime, sizeBytes: row.size_bytes };
}

function listForTask(taskId) {
  return conn()
    .prepare(
      `SELECT m.*, ptm.sort_order AS task_sort
         FROM publish_task_media ptm
         JOIN media m ON m.id = ptm.media_id
        WHERE ptm.task_id = ?
        ORDER BY ptm.sort_order ASC, m.created_at ASC`
    )
    .all(String(taskId))
    .map((row) => {
      const item = toPublic(row);
      item.sortOrder = row.task_sort || 0;
      return item;
    });
}

function listForTasks(taskIds) {
  const ids = (taskIds || []).map(String).filter(Boolean);
  const out = {};
  ids.forEach((id) => {
    out[id] = [];
  });
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = conn()
    .prepare(
      `SELECT ptm.task_id AS task_id, ptm.sort_order AS task_sort, m.*
         FROM publish_task_media ptm
         JOIN media m ON m.id = ptm.media_id
        WHERE ptm.task_id IN (${marks})
        ORDER BY ptm.task_id ASC, ptm.sort_order ASC, m.created_at ASC`
    )
    .all(...ids);
  rows.forEach((row) => {
    if (!out[row.task_id]) out[row.task_id] = [];
    const item = toPublic(row);
    item.sortOrder = row.task_sort || 0;
    out[row.task_id].push(item);
  });
  return out;
}

function taskRefs(mediaId) {
  return conn()
    .prepare('SELECT task_id FROM publish_task_media WHERE media_id = ?')
    .all(String(mediaId))
    .map((r) => r.task_id);
}

function deleteRow(row) {
  conn().prepare('DELETE FROM media WHERE id = ?').run(row.id);
  fs.unlink(filePathOf(row), () => {});
}

function remove(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '素材不存在');
  if (taskRefs(row.id).length) throw httpError(409, '素材已被发布任务引用，无法删除');
  deleteRow(row);
  return { id: row.id };
}

function dedupeIds(ids) {
  const out = [];
  (ids || []).forEach((raw) => {
    const id = String(raw == null ? '' : raw).trim();
    if (id && out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

/**
 * 用给定的素材 ID 顺序替换某条排期的素材集合。
 * 暂存素材在此时挂到排期；被移出的素材若已被任务引用则拒绝整次操作。
 */
function attachToSchedule(scheduleId, ids) {
  if (!scheduleId) throw httpError(400, '缺少排期');
  const wanted = dedupeIds(ids);
  const c = conn();
  const rows = wanted.map((id) => {
    const row = findRow(id);
    if (!row) throw httpError(404, '素材不存在：' + id);
    if ((row.role || 'content') !== 'content') throw httpError(400, '封面不能作为发布素材');
    if (row.schedule_id && row.schedule_id !== String(scheduleId)) {
      throw httpError(409, '素材已属于另一条排期，无法复用');
    }
    return row;
  });

  const kinds = {};
  rows.forEach((row) => {
    kinds[row.kind] = (kinds[row.kind] || 0) + 1;
  });
  if (Object.keys(kinds).length > 1) throw httpError(400, '视频与图片不能混在同一条排期里');
  if (kinds.video > 1) throw httpError(400, '短视频只能保留 1 个视频');
  if (kinds.image > IMAGE_MAX_COUNT) throw httpError(400, `图文最多 ${IMAGE_MAX_COUNT} 张图片`);

  const current = c.prepare("SELECT * FROM media WHERE schedule_id = ? AND role = 'content'").all(String(scheduleId));
  const keep = {};
  wanted.forEach((id) => { keep[id] = true; });
  const removed = current.filter((row) => !keep[row.id]);
  if (removed.length) {
    const blocked = removed.filter((row) => taskRefs(row.id).length);
    if (blocked.length) {
      throw httpError(409, '素材「' + (blocked[0].original_name || blocked[0].file_name) + '」已被发布任务引用，无法移除');
    }
  }

  c.exec('BEGIN');
  try {
    removed.forEach((row) => deleteRow(row));
    wanted.forEach((id, index) => {
      c.prepare('UPDATE media SET schedule_id = ?, sort_order = ? WHERE id = ?').run(String(scheduleId), index, id);
    });
    c.exec('COMMIT');
  } catch (err) {
    try { c.exec('ROLLBACK'); } catch (e) { /* 事务已经结束 */ }
    throw err;
  }
  return list({ scheduleId });
}

function getCover(scheduleId) {
  if (!scheduleId) return null;
  const row = conn()
    .prepare("SELECT * FROM media WHERE schedule_id = ? AND role = 'cover' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(String(scheduleId));
  return row ? toPublic(row) : null;
}

/**
 * 设置或清除排期封面。传空 mediaId 表示清除；旧封面无人引用时连同文件删除。
 */
function attachCover(scheduleId, mediaId) {
  if (!scheduleId) throw httpError(400, '缺少排期');
  const id = mediaId == null ? '' : String(mediaId).trim();
  let next = null;
  if (id) {
    next = findRow(id);
    if (!next) throw httpError(404, '素材不存在：' + id);
    if ((next.role || 'content') !== 'cover') throw httpError(400, '请先上传封面图片');
    if (next.kind !== 'image') throw httpError(400, '封面必须是图片');
    if (next.schedule_id && next.schedule_id !== String(scheduleId)) {
      throw httpError(409, '封面已属于另一条排期，无法复用');
    }
  }

  const c = conn();
  const existing = c
    .prepare("SELECT * FROM media WHERE schedule_id = ? AND role = 'cover'")
    .all(String(scheduleId));
  c.exec('BEGIN');
  try {
    existing.forEach((row) => {
      if (next && row.id === next.id) return;
      if (taskRefs(row.id).length) {
        c.prepare('UPDATE media SET schedule_id = NULL, sort_order = 0 WHERE id = ?').run(row.id);
      } else {
        deleteRow(row);
      }
    });
    if (next) {
      c.prepare('UPDATE media SET schedule_id = ?, sort_order = 0 WHERE id = ?').run(String(scheduleId), next.id);
    }
    c.exec('COMMIT');
  } catch (err) {
    try { c.exec('ROLLBACK'); } catch (e) { /* 事务已经结束 */ }
    throw err;
  }
  return getCover(scheduleId);
}

/** 排期删除：无人引用的素材连同文件一起删除，被任务引用的只解除关联 */
function releaseSchedule(scheduleId) {
  if (!scheduleId) return { removed: 0 };
  const rows = conn().prepare('SELECT * FROM media WHERE schedule_id = ?').all(String(scheduleId));
  let removed = 0;
  rows.forEach((row) => {
    if (taskRefs(row.id).length) {
      conn().prepare('UPDATE media SET schedule_id = NULL, sort_order = 0 WHERE id = ?').run(row.id);
    } else {
      deleteRow(row);
      removed++;
    }
  });
  return { removed };
}

function attachToTask(taskId, ids) {
  const wanted = dedupeIds(ids);
  wanted.forEach((id) => {
    const row = findRow(id);
    if (!row) throw httpError(404, '素材不存在：' + id);
    if ((row.role || 'content') !== 'content') throw httpError(400, '封面不能作为发布素材');
  });
  const c = conn();
  c.exec('BEGIN');
  try {
    c.prepare('DELETE FROM publish_task_media WHERE task_id = ?').run(String(taskId));
    wanted.forEach((id, index) => {
      c.prepare('INSERT INTO publish_task_media (task_id, media_id, sort_order) VALUES (?, ?, ?)').run(
        String(taskId), id, index
      );
    });
    c.exec('COMMIT');
  } catch (err) {
    try { c.exec('ROLLBACK'); } catch (e) { /* 事务已经结束 */ }
    throw err;
  }
  return listForTask(taskId);
}

function detachFromTask(taskId) {
  conn().prepare('DELETE FROM publish_task_media WHERE task_id = ?').run(String(taskId));
}

function gcStaged() {
  const cutoff = new Date(Date.now() - STAGED_TTL_MS).toISOString();
  const rows = conn()
    .prepare(
      `SELECT * FROM media
        WHERE schedule_id IS NULL
          AND created_at < ?
          AND id NOT IN (SELECT media_id FROM publish_task_media)`
    )
    .all(cutoff);
  rows.forEach(deleteRow);
  return rows.length;
}

function kindForFormat(format) {
  const f = String(format || '').trim();
  if (f === '短视频') return 'video';
  if (f === '图文' || f === '长图') return 'image';
  return null;
}

module.exports = {
  VIDEOS_DIR,
  IMAGES_DIR,
  VIDEO_MAX_BYTES,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_COUNT,
  createFromRequest,
  list,
  get,
  getFile,
  listForTask,
  listForTasks,
  attachToSchedule,
  getCover,
  attachCover,
  releaseSchedule,
  attachToTask,
  detachFromTask,
  taskRefs,
  remove,
  gcStaged,
  kindForFormat
};
