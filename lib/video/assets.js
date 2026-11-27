'use strict';

/**
 * 视频工坊素材层：AI 生成结果（图片 / 视频 / 配音 / 片段 / 成片）的落盘与登记。
 *
 * 文件放在 <账号数据根>/video/<项目编号>/{assets,segments,final}/，
 * 每个文件在 video_assets 表登记一行，供分镜引用与前端按 id 读取。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');
const projects = require('./projects');
const asr = require('../asr');

const KIND_DIR = {
  image: 'assets',
  audio: 'assets',
  video: 'assets',
  segment: 'segments',
  final: 'final'
};

const EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus'
};

function now() {
  return new Date().toISOString();
}

function uid() {
  return crypto.randomUUID();
}

function conn() {
  return db.open();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function extFromMime(mime, fallback) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('png') >= 0) return 'png';
  if (m.indexOf('jpeg') >= 0 || m.indexOf('jpg') >= 0) return 'jpg';
  if (m.indexOf('webp') >= 0) return 'webp';
  if (m.indexOf('m4a') >= 0 || m === 'audio/mp4') return 'm4a';
  if (m.indexOf('ogg') >= 0) return 'ogg';
  if (m.indexOf('opus') >= 0) return 'opus';
  if (m.indexOf('mp4') >= 0) return 'mp4';
  if (m.indexOf('webm') >= 0) return 'webm';
  if (m.indexOf('wav') >= 0) return 'wav';
  if (m.indexOf('mpeg') >= 0 || m.indexOf('mp3') >= 0) return 'mp3';
  return fallback || 'bin';
}

function extFromUrl(url, fallback) {
  try {
    const p = new URL(url).pathname;
    const ext = path.extname(p).replace('.', '').toLowerCase();
    return /^[a-z0-9]{2,5}$/.test(ext) ? ext : (fallback || 'bin');
  } catch (err) {
    return fallback || 'bin';
  }
}

function mimeFor(ext) {
  return EXT_MIME[String(ext || '').toLowerCase()] || 'application/octet-stream';
}

function mapAsset(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sceneId: row.scene_id,
    kind: row.kind,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    provider: row.provider || '',
    model: row.model || '',
    prompt: row.prompt || '',
    seed: row.seed,
    costCents: row.cost_cents,
    meta: safeJSON(row.meta, {}),
    createdAt: row.created_at
  };
}

function safeJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function projectRow(projectId) {
  const row = conn().prepare('SELECT id, code FROM video_projects WHERE id = ?').get(projectId);
  if (!row) throw httpError(404, '视频项目不存在');
  return row;
}

function assetFileName(kind, sceneId, ext) {
  const tag = sceneId ? String(sceneId).slice(0, 8) : 'proj';
  return kind + '-' + tag + '-' + crypto.randomBytes(5).toString('hex') + '.' + ext;
}

/**
 * 把已就绪的字节写入项目素材目录并登记。
 * opts: { kind, sceneId, buffer, ext, mime, provider, model, prompt, seed,
 *         width, height, durationMs, costCents, meta }
 */
function saveBuffer(projectId, opts) {
  const o = opts || {};
  const kind = KIND_DIR[o.kind] ? o.kind : 'image';
  if (!Buffer.isBuffer(o.buffer) || !o.buffer.length) {
    throw httpError(400, '素材内容为空');
  }
  const proj = projectRow(projectId);
  const ext = String(o.ext || 'bin').toLowerCase();
  const fileName = assetFileName(kind, o.sceneId, ext);
  const dir = path.join(projects.projectRoot(proj.code), KIND_DIR[kind]);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, o.buffer);

  const id = uid();
  const ts = now();
  conn()
    .prepare(
      `INSERT INTO video_assets
        (id, project_id, scene_id, kind, file_name, mime, size_bytes, width, height, duration_ms,
         provider, model, prompt, seed, cost_cents, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      projectId,
      o.sceneId || null,
      kind,
      fileName,
      o.mime || mimeFor(ext),
      o.buffer.length,
      numOrNull(o.width),
      numOrNull(o.height),
      numOrNull(o.durationMs),
      o.provider || null,
      o.model || null,
      o.prompt || null,
      Number.isInteger(o.seed) ? o.seed : null,
      Number.isInteger(o.costCents) ? o.costCents : null,
      JSON.stringify(o.meta || {}),
      ts
    );
  return getAsset(id).asset;
}

function numOrNull(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** 远端地址/内联 data URL → 落盘。opts 同 saveBuffer，另支持 url / dataUrl / timeoutMs。 */
async function saveFromUrl(projectId, opts) {
  const o = opts || {};
  let buffer;
  let mime = o.mime || '';
  let ext = o.ext || '';

  if (o.url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs || 120000);
    try {
      const res = await fetch(o.url, { signal: controller.signal });
      if (!res.ok) throw httpError(502, '下载素材失败（HTTP ' + res.status + '）');
      mime = mime || res.headers.get('content-type') || '';
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (err && err.name === 'AbortError') throw httpError(504, '下载素材超时');
      throw err;
    } finally {
      clearTimeout(timer);
    }
    ext = ext || extFromUrl(o.url, extFromMime(mime, 'bin'));
  } else if (o.dataUrl) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(o.dataUrl));
    if (!m) throw httpError(400, '无效的内联素材');
    mime = mime || m[1] || '';
    buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
    ext = ext || extFromMime(mime, 'bin');
  } else {
    throw httpError(400, '缺少素材来源');
  }

  // 方舟输出的视频是 HEVC 10-bit，Chromium/Electron 无法解码（表现为全黑），
  // 入库前统一转成 H.264 8-bit，保证页面预览与成片拼接都能用
  if (o.kind === 'video' && buffer && buffer.length) {
    const conv = await transcodeToH264(buffer);
    if (conv) {
      buffer = conv.buffer;
      mime = 'video/mp4';
      ext = 'mp4';
    }
  }

  return saveBuffer(projectId, Object.assign({}, o, {
    buffer,
    mime: mime || mimeFor(ext),
    ext: ext || extFromMime(mime, 'bin')
  }));
}

function runFfmpeg(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
      reject(new Error('ffmpeg 转码超时'));
    }, timeoutMs || 600000);
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(String(err).slice(-500)));
    });
  });
}

/** 返回 {buffer} 成功；无 ffmpeg 或转码失败返回 null（继续用原文件，不阻断生成） */
async function transcodeToH264(buffer) {
  let bin;
  try {
    const found = asr.findFfmpeg();
    if (!found) return null;
    bin = found.path;
  } catch (e) {
    return null;
  }
  const tag = crypto.randomBytes(6).toString('hex');
  const inPath = path.join(os.tmpdir(), 'wmc-in-' + tag + '.mp4');
  const outPath = path.join(os.tmpdir(), 'wmc-out-' + tag + '.mp4');
  try {
    fs.writeFileSync(inPath, buffer);
    await runFfmpeg(bin, [
      '-y', '-i', inPath,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart',
      outPath
    ], 600000);
    return { buffer: fs.readFileSync(outPath) };
  } catch (err) {
    console.warn('[assets] 视频转码 H.264 失败，保留原文件：' + ((err && err.message) || err));
    return null;
  } finally {
    try { fs.rmSync(inPath, { force: true }); } catch (e) { /* noop */ }
    try { fs.rmSync(outPath, { force: true }); } catch (e) { /* noop */ }
  }
}

function getAsset(id) {
  const row = conn().prepare('SELECT * FROM video_assets WHERE id = ?').get(id);
  if (!row) return null;
  const asset = mapAsset(row);
  const proj = conn().prepare('SELECT code FROM video_projects WHERE id = ?').get(row.project_id);
  const dir = KIND_DIR[asset.kind] || 'assets';
  const filePath = proj ? path.join(projects.projectRoot(proj.code), dir, row.file_name) : '';
  return { asset, filePath, mime: asset.mime || mimeFor(path.extname(row.file_name)) };
}

/** 供静态文件接口使用：返回 {filePath, mime}，找不到文件返回 null */
function getFile(id) {
  const found = getAsset(id);
  if (!found || !found.filePath) return null;
  try {
    fs.statSync(found.filePath);
  } catch (err) {
    return null;
  }
  return { filePath: found.filePath, mime: found.mime };
}

function listAssets(projectId, kind) {
  const rows = kind
    ? conn().prepare('SELECT * FROM video_assets WHERE project_id = ? AND kind = ? ORDER BY created_at DESC').all(projectId, kind)
    : conn().prepare('SELECT * FROM video_assets WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  return rows.map(mapAsset);
}

function deleteAsset(id) {
  const found = getAsset(id);
  if (!found) return { ok: true };
  conn().prepare('DELETE FROM video_assets WHERE id = ?').run(id);
  try {
    if (found.filePath) fs.rmSync(found.filePath, { force: true });
  } catch (err) {
    /* 文件可能已被清理 */
  }
  return { ok: true };
}

module.exports = {
  KIND_DIR,
  EXT_MIME,
  mimeFor,
  extFromMime,
  extFromUrl,
  saveBuffer,
  saveFromUrl,
  getAsset,
  getFile,
  listAssets,
  deleteAsset
};
