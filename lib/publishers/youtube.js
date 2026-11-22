'use strict';

/**
 * YouTube 发布适配器（Data API v3 resumable upload）。
 *
 * 走官方 OAuth：令牌由 lib/oauth.js 按账号维护。上传分两步：
 *   1. POST 初始化，拿到 resumable upload 的 Location；
 *   2. 按 8MB 分片 PUT，308 表示本片已接收、继续下一片。
 * 默认可见性 unlisted（连接卡可改），默认分类 22（人物与博客）。
 * 境内外网络都支持：请求统一经 lib/http-proxy-agent.js，自动套用「网络代理」。
 */

const fs = require('node:fs');
const path = require('node:path');
const oauth = require('../oauth');
const channelConnections = require('../channel-connections');
const { requestJson, chunkedUpload } = require('../http-proxy-agent');
const proxyConfig = require('../proxy-config');

const PLATFORM = 'YouTube';
const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const CHUNK_SIZE = 8 * 1024 * 1024;

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
  return ['public', 'unlisted', 'private'].indexOf(value) >= 0 ? value : 'unlisted';
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
