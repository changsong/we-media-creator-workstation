'use strict';

/**
 * 主理人资料：名称 + 头像。
 * 头像二进制直接存进 SQLite 的 profile.avatar_blob（BLOB），不落文件系统。
 */

const db = require('./db');

const DEFAULT_NAME = 'Alexandra';
const NAME_MAX = 24;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

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

function row() {
  return conn().prepare('SELECT * FROM profile WHERE id = 1').get() || null;
}

function toPublic(r) {
  const hasAvatar = !!(r && r.avatar_blob && r.avatar_blob.length && r.avatar_mime);
  return {
    name: r ? r.name : DEFAULT_NAME,
    role: '主理人',
    hasAvatar,
    avatarMime: hasAvatar ? r.avatar_mime : null,
    avatarUrl: hasAvatar
      ? '/api/profile/avatar?v=' + encodeURIComponent(r.avatar_updated_at || r.updated_at || '')
      : '/assets/img-4.png',
    updatedAt: r ? r.updated_at : null
  };
}

function getProfile() {
  return toPublic(row());
}

function normalizeName(value) {
  const name = String(value == null ? '' : value).trim();
  if (!name) throw httpError(400, '主理人名称不能为空');
  if (name.length > NAME_MAX) throw httpError(400, `主理人名称最多 ${NAME_MAX} 个字符`);
  if (/[\r\n\t]/.test(name)) throw httpError(400, '主理人名称不能包含换行或制表符');
  return name;
}

function updateName(value) {
  const name = normalizeName(value);
  conn()
    .prepare(
      `INSERT INTO profile (id, name, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
    )
    .run(name, nowIso());
  return getProfile();
}

function setAvatar(buffer, mime) {
  const type = String(mime || '').split(';')[0].trim().toLowerCase();
  if (AVATAR_MIME.indexOf(type) < 0) {
    throw httpError(400, '仅支持 PNG / JPG / WebP / GIF 图片');
  }
  if (!buffer || !buffer.length) throw httpError(400, '上传内容为空');
  if (buffer.length > MAX_AVATAR_BYTES) throw httpError(413, '头像图片不能超过 5MB');
  const now = nowIso();
  conn()
    .prepare(
      `INSERT INTO profile (id, name, avatar_mime, avatar_blob, avatar_updated_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         avatar_mime = excluded.avatar_mime,
         avatar_blob = excluded.avatar_blob,
         avatar_updated_at = excluded.avatar_updated_at,
         updated_at = excluded.updated_at`
    )
    .run(DEFAULT_NAME, type, buffer, now, now);
  return getProfile();
}

function clearAvatar() {
  conn()
    .prepare(
      `UPDATE profile
       SET avatar_mime = NULL, avatar_blob = NULL, avatar_updated_at = NULL, updated_at = ?
       WHERE id = 1`
    )
    .run(nowIso());
  return getProfile();
}

function getAvatar() {
  const r = row();
  if (!r || !r.avatar_blob || !r.avatar_blob.length || !r.avatar_mime) return null;
  return { mime: r.avatar_mime, blob: r.avatar_blob, updatedAt: r.avatar_updated_at };
}

module.exports = {
  DEFAULT_NAME,
  NAME_MAX,
  MAX_AVATAR_BYTES,
  AVATAR_MIME,
  getProfile,
  updateName,
  setAvatar,
  clearAvatar,
  getAvatar
};
