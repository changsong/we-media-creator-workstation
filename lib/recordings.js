'use strict';

/**
 * 语音速记：音频文件落在 data/recordings/，元数据与转写文本存 SQLite。
 *
 * 上传接口接收原始音频流（非 multipart），边收边写文件，避免整段音频进内存；
 * 单个文件上限 200MB。转写文本由前端浏览器听写后通过 PATCH 写入。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const RECORDINGS_DIR = path.join(db.DATA_DIR, 'recordings');
const MAX_BYTES = 200 * 1024 * 1024;
const TITLE_MAX = 80;
const TRANSCRIPT_MAX = 200000;
const SEQUENCE_KEY = 'recording';

const MIME_EXT = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/aac': '.aac'
};
const MIME_ALIASES = {
  'video/webm': 'audio/webm',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/vnd.wave': 'audio/wav'
};

function conn() {
  return db.open();
}

function nowIso() {
  return new Date().toISOString();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function ensureDir() {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

function nextCode() {
  const d = new Date();
  const month = `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}`;
  const prefix = `REC${month}-`;
  const c = conn();
  const rows = c.prepare('SELECT code FROM recordings WHERE code LIKE ?').all(`${prefix}%`);
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

function normalizeMime(raw) {
  const type = String(raw || '').split(';')[0].trim().toLowerCase();
  if (!type) return 'audio/webm';
  const mime = MIME_ALIASES[type] || type;
  if (!MIME_EXT[mime]) throw httpError(415, '不支持的音频格式：' + type);
  return mime;
}

function normalizeTitle(raw, date) {
  let title = String(raw == null ? '' : raw).trim();
  if (!title) {
    const d = date || new Date();
    title = `语音速记 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX);
  return title;
}

function normalizeDuration(raw) {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(86400, Math.round(n * 10) / 10);
}

function toPublic(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    durationSec: row.duration_sec,
    transcript: row.transcript || '',
    transcriptStatus: row.transcript_status,
    assetId: row.asset_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    audioUrl: `/api/recordings/${row.id}/audio`
  };
}

/** 关联素材必须真实存在，避免录音挂在已删除的素材 ID 上 */
function normalizeAssetId(raw) {
  const id = String(raw == null ? '' : raw).trim();
  if (!id) return null;
  const row = conn().prepare('SELECT id FROM assets WHERE id = ?').get(id);
  if (!row) throw httpError(400, '关联的素材不存在或已被删除');
  return row.id;
}

/** 从 HTTP 请求流式落盘并建记录 */
function createFromRequest(req, meta) {
  ensureDir();
  const mime = normalizeMime((meta && meta.mime) || req.headers['content-type']);
  const now = new Date();
  const id = crypto.randomUUID();
  const code = nextCode();
  const fileName = `${code}-${id.slice(0, 8)}${MIME_EXT[mime]}`;
  const filePath = path.join(RECORDINGS_DIR, fileName);
  const title = normalizeTitle(meta && meta.title, now);
  const duration = normalizeDuration(meta && meta.duration);
  const assetId = normalizeAssetId(meta && meta.assetId);
  const createdAt = now.toISOString();

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

    ws.on('error', (err) => fail(httpError(500, '无法保存录音文件：' + err.message)));
    req.on('error', (err) => fail(httpError(400, '录音上传中断：' + err.message)));
    req.on('aborted', () => fail(httpError(400, '录音上传已取消')));
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) fail(httpError(413, '录音文件不能超过 200MB'));
    });
    ws.on('finish', () => {
      if (settled) return;
      if (!size) return fail(httpError(400, '录音内容为空'));
      settled = true;
      try {
        const c = conn();
        c.prepare(
          `INSERT INTO recordings
             (id, code, title, file_name, mime, size_bytes, duration_sec, transcript, transcript_status, asset_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'none', ?, ?, ?)`
        ).run(id, code, title, fileName, mime, size, duration, assetId, createdAt, createdAt);
        resolve(toPublic(c.prepare('SELECT * FROM recordings WHERE id = ?').get(id)));
      } catch (err) {
        fs.unlink(filePath, () => {});
        reject(err);
      }
    });
    req.pipe(ws);
  });
}

function list(options = {}) {
  const assetId = String(options.assetId || '').trim();
  const rows = assetId
    ? conn()
        .prepare('SELECT * FROM recordings WHERE asset_id = ? ORDER BY created_at DESC, rowid DESC')
        .all(assetId)
    : conn().prepare('SELECT * FROM recordings ORDER BY created_at DESC, rowid DESC').all();
  return rows.map(toPublic);
}

function findRow(id) {
  if (!id) return null;
  return conn().prepare('SELECT * FROM recordings WHERE id = ?').get(String(id)) || null;
}

function get(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '录音不存在');
  return toPublic(row);
}

function update(id, body) {
  const row = findRow(id);
  if (!row) throw httpError(404, '录音不存在');
  const patch = {
    title: row.title,
    transcript: row.transcript,
    transcript_status: row.transcript_status,
    asset_id: row.asset_id || null
  };

  if (body && typeof body.title !== 'undefined') {
    patch.title = normalizeTitle(body.title);
  }
  if (body && typeof body.transcript !== 'undefined') {
    const text = String(body.transcript == null ? '' : body.transcript).trim();
    if (text.length > TRANSCRIPT_MAX) throw httpError(400, '转写文本过长');
    patch.transcript = text || null;
    patch.transcript_status = text ? 'browser' : 'none';
  }
  if (body && typeof body.assetId !== 'undefined') {
    patch.asset_id = normalizeAssetId(body.assetId);
  }

  conn()
    .prepare(
      'UPDATE recordings SET title = ?, transcript = ?, transcript_status = ?, asset_id = ?, updated_at = ? WHERE id = ?'
    )
    .run(patch.title, patch.transcript, patch.transcript_status, patch.asset_id, nowIso(), row.id);
  return get(row.id);
}

function remove(id) {
  const row = findRow(id);
  if (!row) throw httpError(404, '录音不存在');
  conn().prepare('DELETE FROM recordings WHERE id = ?').run(row.id);
  fs.unlink(path.join(RECORDINGS_DIR, path.basename(row.file_name)), () => {});
  return { id: row.id };
}

/** 供音频播放接口使用：返回文件路径与 MIME */
function getAudio(id) {
  const row = findRow(id);
  if (!row) return null;
  const filePath = path.join(RECORDINGS_DIR, path.basename(row.file_name));
  if (!fs.existsSync(filePath)) return null;
  return { filePath, mime: row.mime };
}

module.exports = {
  RECORDINGS_DIR,
  MAX_BYTES,
  createFromRequest,
  list,
  get,
  update,
  remove,
  getAudio
};
