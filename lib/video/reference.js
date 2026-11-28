'use strict';

/**
 * 视频工坊参考片层：接入一段参考视频，按旁白字数比例定位到各分镜时间点，
 * 再抽取对应时刻的画面，直接作为分镜首帧图，走现有图生视频链路口径出片。
 *
 * 文件放在 <账号数据根>/video/<项目编号>/reference/，仅记录在项目 settings.reference。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const projects = require('./projects');
const assets = require('./assets');
const asr = require('../asr');
const transcript = require('../trends/transcript');

// 与文案提取上传保持一致的 fileId 形态：uuid + 扩展名
const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.flv', '.ts', '.mpg', '.mpeg', '.wmv']);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function ffmpegPath() {
  const found = asr.findFfmpeg();
  if (!found) throw httpError(500, '未找到 ffmpeg，无法处理参考视频');
  return found.path;
}

function ffprobePath(ffmpegBin) {
  const dir = path.dirname(ffmpegBin);
  const ext = path.extname(ffmpegBin);
  const candidate = path.join(dir, 'ffprobe' + ext);
  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch (err) { /* 打包版可能不带 ffprobe */ }
  return '';
}

function runCapture(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* noop */ }
      resolve({ code: -1, out, err });
    }, timeoutMs || 60000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(text || ''));
  if (!m) return 0;
  return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
}

function parseSize(text) {
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(String(text || ''));
  if (!m) return { width: 0, height: 0 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** 读取时长与分辨率；ffprobe 缺失或解析失败时退回 ffmpeg -i 的 stderr */
async function probeMedia(filePath) {
  const bin = ffmpegPath();
  const probe = ffprobePath(bin);
  if (probe) {
    const r = await runCapture(probe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'format=duration:stream=width,height',
      '-of', 'json', filePath
    ], 60000);
    try {
      const info = JSON.parse(r.out);
      const stream = (info.streams && info.streams[0]) || {};
      const durationMs = Math.round(Number(info.format && info.format.duration || 0) * 1000);
      const width = Number(stream.width) || 0;
      const height = Number(stream.height) || 0;
      if (durationMs > 0 && width > 0 && height > 0) return { durationMs, width, height };
    } catch (err) { /* 落到 ffmpeg 解析 */ }
  }
  const r = await runCapture(bin, ['-hide_banner', '-i', filePath], 60000);
  const text = (r.err || '') + (r.out || '');
  const size = parseSize(text);
  return { durationMs: parseDuration(text), width: size.width, height: size.height };
}

function projectOrThrow(projectId) {
  const project = projects.getProject(projectId);
  if (!project) throw httpError(404, '视频项目不存在');
  return project;
}

function referenceOf(project) {
  const ref = project.settings && project.settings.reference;
  return ref && ref.storedName ? ref : null;
}

function referenceFilePath(project) {
  const ref = referenceOf(project);
  if (!ref) return '';
  return path.join(projects.projectRoot(project.code), 'reference', ref.storedName);
}

function referenceFileExists(project) {
  const p = referenceFilePath(project);
  if (!p) return false;
  try { return fs.statSync(p).isFile(); } catch (err) { return false; }
}

async function downloadToFile(url, target, referer) {
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
  if (referer) headers.Referer = referer;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    if (!res.ok || !res.body) throw httpError(502, '下载参考视频失败（HTTP ' + res.status + '）');
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(target);
      const stream = require('stream').Readable.fromWeb(res.body);
      stream.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      stream.pipe(ws);
    });
  } catch (err) {
    await fs.promises.rm(target, { force: true }).catch(() => {});
    if (err && err.name === 'AbortError') throw httpError(504, '下载参考视频超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 接入参考视频：fileId（文案上传临时文件）优先，其次 url；落盘后探测时长分辨率 */
async function attach(projectId, input) {
  const body = input || {};
  const project = projectOrThrow(projectId);
  const fileId = String(body.fileId || '').trim();
  const url = String(body.url || '').trim();
  let sourceFile = '';
  let ext = '';

  if (fileId) {
    if (!FILE_ID_RE.test(fileId)) throw httpError(400, '参考视频无效，请重新选择');
    ext = path.extname(fileId).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) throw httpError(400, '参考片需要是视频文件（mp4 / mov / mkv / webm 等）');
    sourceFile = path.join(transcript.UPLOAD_DIR, fileId);
    if (!fs.existsSync(sourceFile)) throw httpError(404, '参考视频已过期，请重新选择文件');
  } else if (url) {
    if (!/^https?:\/\//i.test(url)) throw httpError(400, '请输入 http(s) 开头的视频链接');
    ext = path.extname(new URL(url).pathname).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) ext = '.mp4';
  } else {
    throw httpError(400, '请选择本地视频或粘贴视频链接');
  }

  const dir = path.join(projects.projectRoot(project.code), 'reference');
  fs.mkdirSync(dir, { recursive: true });
  const storedName = 'source' + ext;
  const target = path.join(dir, storedName);

  if (fileId) {
    await fs.promises.copyFile(sourceFile, target);
  } else {
    await downloadToFile(url, target, body.referer);
  }

  const stat = fs.statSync(target);
  if (!stat.size) {
    await fs.promises.rm(target, { force: true }).catch(() => {});
    throw httpError(400, '参考视频内容为空');
  }

  let probe = { durationMs: 0, width: 0, height: 0 };
  try {
    probe = await probeMedia(target);
  } catch (err) { /* 探测失败不阻断接入，取帧时再报错 */ }

  const settings = Object.assign({}, project.settings || {});
  settings.reference = {
    storedName,
    fileName: String(body.name || '').trim() || (fileId ? fileId : path.basename(new URL(url).pathname) || 'reference' + ext),
    sizeBytes: stat.size,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    source: fileId ? 'upload' : 'url',
    addedAt: new Date().toISOString()
  };
  projects.updateProject(projectId, { settings });
  return { reference: settings.reference, project: projects.getProject(projectId) };
}

function clear(projectId) {
  const project = projectOrThrow(projectId);
  const settings = Object.assign({}, project.settings || {});
  delete settings.reference;
  const dir = path.join(projects.projectRoot(project.code), 'reference');
  try {
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach((name) => {
        fs.rmSync(path.join(dir, name), { force: true, recursive: true });
      });
    }
  } catch (err) { /* 文件清理失败不影响解绑 */ }
  projects.updateProject(projectId, { settings });
  return { ok: true, project: projects.getProject(projectId) };
}

/**
 * 按旁白字数比例把各分镜映射到参考片时间点（取每段中点）。
 * 旁白缺失时按标题字数、再退回均分，保证每镜都有落点。
 */
function sceneTimes(project) {
  const ref = referenceOf(project);
  const durationMs = ref ? Number(ref.durationMs) || 0 : 0;
  const scenes = project.scenes || [];
  if (!durationMs || !scenes.length) return [];
  const weights = scenes.map((s) => {
    const label = String(s.narration || '').replace(/\s+/g, '') || String(s.title || '').replace(/\s+/g, '');
    return Math.max(1, label.length);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  const limit = Math.max(0, durationMs - 200);
  let acc = 0;
  return scenes.map((scene, i) => {
    const span = (durationMs * weights[i]) / total;
    const atMs = Math.max(0, Math.min(limit, Math.round(acc + span / 2)));
    acc += span;
    return { sceneId: scene.id, idx: scene.idx, atMs };
  });
}

function frameAt(projectId, atMs) {
  const project = projectOrThrow(projectId);
  const ref = referenceOf(project);
  if (!ref) throw httpError(400, '还没有接入参考视频');
  const source = referenceFilePath(project);
  if (!referenceFileExists(project)) throw httpError(404, '参考视频文件已丢失，请重新接入');
  const duration = Number(ref.durationMs) || 0;
  const sec = Math.max(0, Math.min(duration ? duration - 0.2 : 3600, Number(atMs) / 1000 || 0));
  const w = Math.max(2, Math.round((Number(project.width) || 1280) / 2) * 2);
  const h = Math.max(2, Math.round((Number(project.height) || 720) / 2) * 2);
  const outPath = path.join(os.tmpdir(), 'wmc-ref-' + crypto.randomBytes(6).toString('hex') + '.jpg');
  const bin = ffmpegPath();
  return runCapture(bin, [
    '-y', '-ss', sec.toFixed(3), '-i', source,
    '-frames:v', '1',
    '-vf', 'scale=' + w + ':' + h + ':force_original_aspect_ratio=increase,crop=' + w + ':' + h,
    '-q:v', '3', outPath
  ], 120000).then((r) => {
    try {
      if (r.code !== 0) throw httpError(502, '从参考视频取帧失败：' + String(r.err).slice(-300));
      const buffer = fs.readFileSync(outPath);
      if (!buffer.length) throw httpError(502, '从参考视频取到的画面为空');
      return buffer;
    } finally {
      try { fs.rmSync(outPath, { force: true }); } catch (e) { /* noop */ }
    }
  });
}

/** 抽取某个分镜时间点的原片画面，作为该分镜首帧图 */
async function applyFrameToScene(projectId, sceneId, input) {
  const body = input || {};
  const project = projectOrThrow(projectId);
  if (!referenceOf(project)) throw httpError(400, '请先接入参考视频');
  const scene = (project.scenes || []).find((s) => s.id === sceneId);
  if (!scene) throw httpError(404, '分镜不存在');

  let atMs = body.atMs != null && body.atMs !== '' ? Number(body.atMs) : NaN;
  if (!isFinite(atMs)) {
    const slot = sceneTimes(project).find((t) => t.sceneId === sceneId);
    atMs = slot ? slot.atMs : 0;
  }
  const buffer = await frameAt(projectId, atMs);
  const oldImage = scene.imageAssetId;
  const asset = assets.saveBuffer(projectId, {
    kind: 'image',
    sceneId,
    buffer,
    ext: 'jpg',
    mime: 'image/jpeg',
    provider: 'reference',
    model: 'reference-frame',
    width: project.width,
    height: project.height,
    meta: { role: 'reference-frame', atMs: Math.round(atMs) }
  });
  const updated = projects.updateScene(sceneId, { imageAssetId: asset.id, status: 'ready' });
  if (oldImage && oldImage !== asset.id) {
    try { assets.deleteAsset(oldImage); } catch (err) { /* 旧图删除失败不影响新帧 */ }
  }
  return { scene: updated, asset, atMs: Math.round(atMs) };
}

/** 一次性把参考片画面铺到所有分镜 */
async function applyFramesToProject(projectId, input) {
  const body = input || {};
  const project = projectOrThrow(projectId);
  if (!referenceOf(project)) throw httpError(400, '请先接入参考视频');
  if (!project.scenes || !project.scenes.length) throw httpError(400, '还没有分镜，先拆分分镜再取自原片画面');
  if (!Number(project.settings.reference.durationMs)) {
    throw httpError(400, '参考视频时长未知，无法按片段取帧；请重新接入参考视频');
  }
  const times = sceneTimes(project);
  const applied = [];
  const failed = [];
  for (const slot of times) {
    if (body.atMs && body.atMs[slot.sceneId] != null) slot.atMs = Number(body.atMs[slot.sceneId]);
    try {
      const out = await applyFrameToScene(projectId, slot.sceneId, { atMs: slot.atMs });
      applied.push({ sceneId: slot.sceneId, atMs: out.atMs, assetId: out.asset.id });
    } catch (err) {
      failed.push({ sceneId: slot.sceneId, error: (err && err.message) || String(err) });
    }
  }
  return {
    applied: applied.length,
    failed,
    frames: applied,
    scenes: projects.listScenes(projectId)
  };
}

module.exports = {
  attach,
  clear,
  referenceOf,
  referenceFilePath,
  referenceFileExists,
  sceneTimes,
  frameAt,
  applyFrameToScene,
  applyFramesToProject
};
