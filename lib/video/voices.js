'use strict';

/**
 * 复刻音色管理：录音文件落在 <账号根>/video/voices，元信息存 video_voices。
 * 音色属于账号级资源，可被该账号下任意视频项目选用。
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const db = require('../db');

function conn() {
  return db.open();
}

function voiceDir() {
  return path.join(db.accountRoot(), 'video', 'voices');
}

function ensureDir() {
  const dir = voiceDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT_BY_MIME = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm'
};

function extForMime(mime) {
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || 'mp3';
}

const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  webm: 'audio/webm'
};

function now() {
  return new Date().toISOString();
}

function mapVoice(row) {
  if (!row) return null;
  let meta = {};
  try { meta = JSON.parse(row.meta || '{}'); } catch (err) { meta = {}; }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    voiceCode: row.voice_code,
    customId: row.custom_id,
    modelType: row.model_type,
    status: row.status,
    error: row.error || '',
    hasSource: !!row.source_file,
    hasDemo: !!row.demo_file,
    meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listVoices() {
  return conn()
    .prepare('SELECT * FROM video_voices ORDER BY created_at DESC')
    .all()
    .map(mapVoice);
}

function getVoice(id) {
  if (!id) return null;
  return mapVoice(conn().prepare('SELECT * FROM video_voices WHERE id = ?').get(String(id)));
}

function getVoiceRow(id) {
  if (!id) return null;
  return conn().prepare('SELECT * FROM video_voices WHERE id = ?').get(String(id)) || null;
}

function createVoice(input) {
  const body = input || {};
  const name = String(body.name || '').trim() || '我的音色';
  const id = body.id || randomUUID();
  const ts = now();
  conn()
    .prepare(
      `INSERT INTO video_voices (id, name, provider, voice_code, custom_id, model_type, status, error, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      name,
      body.provider || '豆包语音',
      body.voiceCode || null,
      body.customId || null,
      body.modelType == null ? null : Number(body.modelType),
      body.status || 'training',
      body.error || null,
      JSON.stringify(body.meta || {}),
      ts,
      ts
    );
  return getVoice(id);
}

const PATCH_FIELDS = {
  name: 'name',
  voiceCode: 'voice_code',
  customId: 'custom_id',
  modelType: 'model_type',
  status: 'status',
  error: 'error',
  sourceFile: 'source_file',
  sourceMime: 'source_mime',
  demoFile: 'demo_file',
  demoMime: 'demo_mime',
  meta: 'meta'
};

function updateVoice(id, patch) {
  const body = patch || {};
  const sets = [];
  const values = [];
  Object.keys(PATCH_FIELDS).forEach((k) => {
    if (typeof body[k] === 'undefined') return;
    sets.push(PATCH_FIELDS[k] + ' = ?');
    values.push(k === 'meta' ? JSON.stringify(body[k] || {}) : body[k]);
  });
  if (!sets.length) return getVoice(id);
  sets.push('updated_at = ?');
  values.push(now());
  values.push(String(id));
  conn().prepare('UPDATE video_voices SET ' + sets.join(', ') + ' WHERE id = ?').run(...values);
  return getVoice(id);
}

function removeFile(name) {
  if (!name) return;
  try { fs.rmSync(path.join(voiceDir(), name), { force: true }); } catch (err) { /* noop */ }
}

function deleteVoice(id) {
  const row = getVoiceRow(id);
  if (!row) return { ok: false, deleted: 0 };
  removeFile(row.source_file);
  removeFile(row.demo_file);
  conn().prepare('DELETE FROM video_voices WHERE id = ?').run(String(id));
  return { ok: true, deleted: 1 };
}

function saveSource(id, buffer, mime) {
  const dir = ensureDir();
  const fileName = 'voice-' + id + '.' + extForMime(mime);
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return { fileName, mime: mime || MIME_BY_EXT[extForMime(mime)] || 'audio/mpeg' };
}

function saveDemo(id, buffer, mime) {
  const dir = ensureDir();
  const fileName = 'demo-' + id + '.' + extForMime(mime);
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return { fileName, mime: mime || MIME_BY_EXT[extForMime(mime)] || 'audio/mpeg' };
}

function getFile(id, kind) {
  const row = getVoiceRow(id);
  if (!row) return null;
  const fileName = kind === 'demo' ? row.demo_file : row.source_file;
  if (!fileName) return null;
  const filePath = path.join(voiceDir(), fileName);
  const mime = (kind === 'demo' ? row.demo_mime : row.source_mime) || MIME_BY_EXT[path.extname(fileName).slice(1)] || 'audio/mpeg';
  return { filePath, mime, fileName };
}

module.exports = {
  voiceDir,
  listVoices,
  getVoice,
  getVoiceRow,
  createVoice,
  updateVoice,
  deleteVoice,
  saveSource,
  saveDemo,
  getFile,
  extForMime
};
