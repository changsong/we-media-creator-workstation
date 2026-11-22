'use strict';

/**
 * TikTok 发布适配器（Content Posting API · 收件箱上传）。
 *
 * 未通过审核的应用不能直接公开发布，但可以把视频上传到用户的
 * TikTok「收件箱」：上传完成后用户在 App 的通知里补文案并点发布。
 *   1. POST /v2/post/publish/inbox/video/init/ 拿 publish_id 与 upload_url；
 *   2. 按片 PUT upload_url（单文件 ≤64MB 一片，否则 10MB/片）。
 * 任务停在「待核验」状态，因为发布动作发生在 App 内，服务端无法代发。
 */

const fs = require('node:fs');
const oauth = require('../oauth');
const { requestJson, putRange } = require('../http-proxy-agent');
const proxyConfig = require('../proxy-config');

const PLATFORM = 'TikTok';
const INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const MAX_SINGLE = 64 * 1024 * 1024;
const DEFAULT_CHUNK = 10 * 1024 * 1024;

function proxySpec() {
  try {
    return proxyConfig.launchSpec();
  } catch (err) {
    return null;
  }
}

function videoMime(filePath) {
  return /\.mov$/i.test(filePath) ? 'video/quicktime' : 'video/mp4';
}

function chunkPlan(size) {
  if (size <= MAX_SINGLE) return { chunkSize: size, count: 1 };
  const chunkSize = DEFAULT_CHUNK;
  return { chunkSize, count: Math.ceil(size / chunkSize) };
}

function apiError(res) {
  const json = res && res.json;
  const err = (json && json.error) || {};
  const message = err.message || (res && res.text ? String(res.text).slice(0, 300) : '') || 'TikTok 接口错误（HTTP ' + (res && res.status) + '）';
  const detail = err.code && err.code !== 'ok' ? '（' + err.code + '）' : '';
  return message + detail;
}

async function initUpload(token, size, plan) {
  const res = await requestJson(INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.count
      }
    }),
    proxy: proxySpec(),
    timeoutMs: 60000
  });
  if (res.status === 401) {
    const err = new Error('TikTok 授权已失效');
    err.code = 401;
    throw err;
  }
  const json = res.json || {};
  const errorCode = json.error && json.error.code;
  if (res.status >= 400 || (errorCode && errorCode !== 'ok') || !json.data || !json.data.upload_url) {
    throw new Error('TikTok 初始化上传失败：' + apiError(res));
  }
  return { uploadUrl: json.data.upload_url, publishId: json.data.publish_id };
}

async function uploadChunks(uploadUrl, filePath, size, plan, ctx) {
  const mime = videoMime(filePath);
  for (let start = 0; start < size; start += plan.chunkSize) {
    if (ctx.isAborted && ctx.isAborted()) throw new Error('任务已取消');
    const end = Math.min(start + plan.chunkSize, size) - 1;
    let attempt = 0;
    for (;;) {
      try {
        const res = await putRange(uploadUrl, {
          filePath,
          start,
          end,
          totalSize: size,
          headers: { 'Content-Type': mime },
          proxy: proxySpec(),
          timeoutMs: 10 * 60 * 1000
        });
        if (res.status === 403) {
          throw Object.assign(new Error('TikTok 上传地址已失效，请重试发布'), { fatal: true });
        }
        if (res.status >= 400) {
          throw Object.assign(new Error('TikTok 分片上传失败：HTTP ' + res.status), { fatal: res.status < 500 });
        }
        break;
      } catch (err) {
        attempt += 1;
        if (err.fatal || attempt >= 3) throw err;
        ctx.log('TikTok 分片上传第 ' + attempt + ' 次重试：' + err.message, 'warn');
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    ctx.log(`已上传 ${(Math.min(start + plan.chunkSize, size) / 1024 / 1024).toFixed(1)} / ${(size / 1024 / 1024).toFixed(1)}MB`);
  }
}

async function run(ctx) {
  if (!ctx.videoPath) throw new Error('TikTok 只支持视频发布，请为任务添加视频素材');
  const size = fs.statSync(ctx.videoPath).size;
  if (!size) throw new Error('视频文件为空，无法上传');
  const plan = chunkPlan(size);
  const title = String(ctx.task.title || '').trim();

  async function attempt() {
    const token = await oauth.getAccessToken(PLATFORM);
    const init = await initUpload(token, size, plan);
    await uploadChunks(init.uploadUrl, ctx.videoPath, size, plan, ctx);
    return init;
  }

  ctx.log(`准备上传 TikTok：${title || '未命名视频'}（${(size / 1024 / 1024).toFixed(1)}MB，分 ${plan.count} 片）`);
  let init;
  try {
    init = await attempt();
  } catch (err) {
    if (err.code !== 401) throw err;
    ctx.log('TikTok 令牌已失效，刷新后重试', 'warn');
    await oauth.forceRefresh(PLATFORM);
    init = await attempt();
  }

  return {
    status: 'submitted',
    workId: init.publishId,
    message: '已上传到 TikTok 收件箱，请在 TikTok App 的通知里补充文案并完成发布'
  };
}

module.exports = { key: PLATFORM, supported: true, kinds: ['video'], run };
