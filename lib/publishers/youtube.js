'use strict';

/**
 * YouTube 发布适配器（Data API v3 resumable upload）。
 *
 * 走官方 OAuth：令牌由 lib/oauth.js 按账号维护。上传分两步：
 *   1. POST 初始化，拿到 resumable upload 的 Location；
 *   2. 按 8MB 分片 PUT，308 表示本片已接收、继续下一片。
 * 默认可见性 public（连接卡可改），默认分类 22（人物与博客）。
 * 上传成功后如任务带封面，会用 thumbnails.set 设置自定义缩略图（需频道已验证）。
 * 境内外网络都支持：请求统一经 lib/http-proxy-agent.js，自动套用「网络代理」。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const oauth = require('../oauth');
const channelConnections = require('../channel-connections');
const { requestJson, chunkedUpload } = require('../http-proxy-agent');
const proxyConfig = require('../proxy-config');

const PLATFORM = 'YouTube';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const THUMB_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';
const CHUNK_SIZE = 8 * 1024 * 1024;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;

function proxySpec() {
  try {
    return proxyConfig.launchSpec();
  } catch (err) {
    return null;
  }
}

function fieldValue(key) {
  const raw = channelConnections.getRaw(PLATFORM);
  return raw && raw.fields ? String(raw.fields[key] || '').trim() : '';
}

function privacyStatus() {
  const value = fieldValue('默认可见性').toLowerCase();
  return ['public', 'unlisted', 'private'].indexOf(value) >= 0 ? value : 'public';
}

function categoryId() {
  const value = fieldValue('默认分类ID');
  return /^\d+$/.test(value) ? value : '22';
}

function normalizeTags(tags) {
  const out = [];
  let budget = 500;
  (Array.isArray(tags) ? tags : []).forEach((item) => {
    const text = String(item == null ? '' : item).trim().replace(/^#+/, '').slice(0, 30);
    if (!text || out.indexOf(text) >= 0) return;
    if (text.length > budget) return;
    budget -= text.length;
    out.push(text);
  });
  return out;
}

function buildSnippet(task) {
  const tags = normalizeTags(task.tags);
  const title = String(task.title || '').trim().slice(0, 100) || '未命名视频';
  let description = String(task.description || '').trim();
  const hashtags = tags.map((t) => '#' + t.replace(/\s+/g, '')).join(' ');
  if (hashtags) description = (description ? description + '\n\n' : '') + hashtags;
  return {
    title,
    description: description.slice(0, 4900),
    tags,
    categoryId: categoryId()
  };
}

function videoMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

function apiError(res) {
  const json = res && res.json;
  const err = (json && json.error) || {};
  const message = err.message || (res && res.text ? String(res.text).slice(0, 300) : '') || 'YouTube 接口错误（HTTP ' + (res && res.status) + '）';
  return message;
}

async function initUpload(token, snippet, filePath, sizeBytes) {
  const res = await requestJson(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(sizeBytes),
      'X-Upload-Content-Type': videoMime(filePath)
    },
    body: JSON.stringify({
      snippet,
      status: { privacyStatus: privacyStatus(), selfDeclaredMadeForKids: false }
    }),
    proxy: proxySpec(),
    timeoutMs: 60000
  });
  if (res.status === 401) {
    const err = new Error('YouTube 授权已失效');
    err.code = 401;
    throw err;
  }
  const location = res.headers && res.headers.location;
  if (res.status >= 400 || !location) {
    const message = apiError(res);
    if (/quotaExceeded/i.test(message)) {
      throw new Error('YouTube 每日上传配额已用尽（单次上传约 1600 单位，每日约 6 次），请明天再试');
    }
    throw new Error('YouTube 初始化上传失败：' + message);
  }
  return location;
}

function pickCover(covers) {
  const list = (covers || []).filter((c) => c && c.path);
  if (!list.length) return null;
  return (
    list.find((c) => c.ratio === '16:9') ||
    list.find((c) => c.ratio === 'original') ||
    list[0]
  );
}

function findFfmpeg() {
  const env = process.env.WB_FFMPEG_PATH;
  if (env && fs.existsSync(env)) return env;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const bundled = path.join(__dirname, '..', '..', 'vendor', 'ffmpeg', exe);
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

function transcodeThumb(bin, src, dest) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y', '-i', src,
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black',
      '-frames:v', '1', '-q:v', '3', dest
    ];
    const proc = spawn(bin, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg 退出码 ' + code))));
  });
}

/** 把封面整理成 YouTube 可用的缩略图（≤2MB、1280×720 JPEG）。失败返回 null。 */
async function prepareThumbnail(cover) {
  if (!cover || !cover.path) return null;
  let stat;
  try {
    stat = fs.statSync(cover.path);
  } catch (err) {
    return null;
  }
  const dest = path.join(os.tmpdir(), `wm-yt-thumb-${process.pid}-${Date.now()}.jpg`);
  const ffmpeg = findFfmpeg();
  if (ffmpeg) {
    try {
      await transcodeThumb(ffmpeg, cover.path, dest);
      if (fs.existsSync(dest) && fs.statSync(dest).size <= THUMB_MAX_BYTES) {
        return { path: dest, mime: 'image/jpeg', cleanup: true };
      }
    } catch (err) {
      /* 转码失败则退回原图 */
    }
    try { fs.unlinkSync(dest); } catch (err) { /* 不存在 */ }
  }
  const ext = path.extname(cover.path).toLowerCase();
  if (stat.size <= THUMB_MAX_BYTES && (ext === '.jpg' || ext === '.jpeg' || ext === '.png')) {
    return { path: cover.path, mime: ext === '.png' ? 'image/png' : 'image/jpeg', cleanup: false };
  }
  return null;
}

async function setThumbnail(token, videoId, ctx) {
  const cover = pickCover(ctx.covers);
  if (!cover) {
    ctx.log('任务没有封面素材，跳过 YouTube 缩略图', 'warn');
    return;
  }
  const prep = await prepareThumbnail(cover);
  if (!prep) {
    ctx.log('封面无法转为 YouTube 可用缩略图（需 ≤2MB、≥640×360），已跳过，可在 Studio 手动设置', 'warn');
    return;
  }
  try {
    const upload = (tok) =>
      requestJson(`${THUMB_URL}?videoId=${encodeURIComponent(videoId)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + tok,
          'Content-Type': prep.mime,
          'Content-Length': String(fs.statSync(prep.path).size)
        },
        body: fs.readFileSync(prep.path),
        proxy: proxySpec(),
        timeoutMs: 120000
      });
    let res = await upload(token);
    if (res.status === 401) {
      const fresh = await oauth.forceRefresh(PLATFORM);
      res = await upload(fresh);
    }
    if (res.status >= 400) {
      let msg = apiError(res);
      if (res.status === 403) msg = '频道未完成验证或不允许自定义缩略图（403）：' + msg;
      ctx.log('设置 YouTube 缩略图失败：' + msg, 'warn');
    } else {
      ctx.log('已设置 YouTube 缩略图');
    }
  } catch (err) {
    ctx.log('设置 YouTube 缩略图失败：' + (err && err.message ? err.message : err), 'warn');
  } finally {
    if (prep.cleanup) {
      try { fs.unlinkSync(prep.path); } catch (err) { /* 已删除 */ }
    }
  }
}

async function run(ctx) {
  if (!ctx.videoPath) throw new Error('YouTube 只支持视频发布，请为任务添加视频素材');
  const size = fs.statSync(ctx.videoPath).size;
  if (!size) throw new Error('视频文件为空，无法上传');

  let token = await oauth.getAccessToken(PLATFORM);
  const snippet = buildSnippet(ctx.task);
  ctx.log(`准备上传 YouTube：${snippet.title}（${(size / 1024 / 1024).toFixed(1)}MB，可见性 ${privacyStatus()}）`);

  let location;
  try {
    location = await initUpload(token, snippet, ctx.videoPath, size);
  } catch (err) {
    if (err.code !== 401) throw err;
    ctx.log('YouTube 令牌已失效，刷新后重试', 'warn');
    token = await oauth.forceRefresh(PLATFORM);
    location = await initUpload(token, snippet, ctx.videoPath, size);
  }

  const res = await chunkedUpload(location, {
    filePath: ctx.videoPath,
    sizeBytes: size,
    chunkSize: CHUNK_SIZE,
    headers: { 'Content-Type': videoMime(ctx.videoPath) },
    proxy: proxySpec(),
    shouldAbort: ctx.isAborted,
    timeoutMs: 10 * 60 * 1000,
    onProgress: (sent, total) => {
      ctx.log(`已上传 ${(sent / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)}MB`);
    }
  });

  if (!res || res.status >= 400 || !res.json) {
    throw new Error('YouTube 上传失败：' + apiError(res));
  }
  const id = res.json.id;
  if (!id) throw new Error('YouTube 上传完成但未返回视频 ID，请到 Studio 确认');

  await setThumbnail(token, id, ctx);

  return {
    status: 'published',
    workId: id,
    publishUrl: 'https://youtu.be/' + id,
    message:
      '已上传至 YouTube（' + privacyStatus() + '）' +
      (privacyStatus() === 'unlisted' ? '，拿到链接后可分享，搜索不可见' : '')
  };
}

module.exports = { key: PLATFORM, supported: true, kinds: ['video'], run };
