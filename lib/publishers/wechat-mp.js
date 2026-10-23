'use strict';

/**
 * 公众号发布适配器（官方接口）。
 *
 * 公众号没有对外的「直接发表」接口：个人主体订阅号自 2025-07 起也陆续失去
 * 发布接口权限。因此这里走稳定路径——创建图文草稿：
 *   1. 正文图片：POST /cgi-bin/media/uploadimg         → mmbiz 图片 URL
 *   2. 封面图：  POST /cgi-bin/material/add_material    → thumb_media_id
 *   3. 草稿：    POST /cgi-bin/draft/add                → media_id
 * 任务以「待核验」结束，作者到 mp.weixin.qq.com 草稿箱确认排版后手动发表。
 * 凭证优先读「连接设置 → 公众号」，缺失时回退到 wechat-monitor 的配置。
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../db');
const channelConnections = require('../channel-connections');
const wechatMonitor = require('../wechat-monitor');

const API_BASE = 'https://api.weixin.qq.com';
const TOKEN_PATH = path.join(DATA_DIR, 'wechat-mp-token.json');
const TITLE_MAX = 64;
const DIGEST_MAX = 120;
const CONTENT_MAX = 20000;

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function credentials() {
  const raw = channelConnections.getRaw('公众号');
  const fields = (raw && raw.fields) || {};
  let appid = String(fields['App ID'] || '').trim();
  let appsecret = String(fields['App Secret'] || '').trim();
  if (!appid || !appsecret) {
    const cfg = wechatMonitor.loadConfig();
    appid = appid || cfg.appid || '';
    appsecret = appsecret || cfg.appsecret || '';
  }
  return { appid, appsecret };
}

function wxError(json) {
  const err = new Error('微信接口错误 ' + json.errcode + '：' + (json.errmsg || '未知错误'));
  err.wxCode = json.errcode;
  return err;
}

async function fetchJson(url, options) {
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    throw new Error('无法连通微信接口：' + err.message);
  }
  try {
    return await resp.json();
  } catch (err) {
    throw new Error('微信接口返回非 JSON（HTTP ' + resp.status + '）');
  }
}

async function getToken(force) {
  const { appid, appsecret } = credentials();
  if (!appid || !appsecret) {
    throw new Error('公众号未配置 App ID / App Secret，请到「连接设置 → 公众号」填写');
  }
  const cached = readJson(TOKEN_PATH, null);
  const now = Date.now();
  if (
    !force &&
    cached &&
    cached.appid === appid &&
    cached.access_token &&
    cached.expires_at &&
    cached.expires_at - 300000 > now
  ) {
    return cached.access_token;
  }
  const url =
    API_BASE +
    '/cgi-bin/token?grant_type=client_credential&appid=' +
    encodeURIComponent(appid) +
    '&secret=' +
    encodeURIComponent(appsecret);
  const json = await fetchJson(url);
  if (json.errcode) throw wxError(json);
  if (!json.access_token) throw new Error('微信接口未返回 access_token');
  const expiresIn = Number(json.expires_in) || 7200;
  writeJson(TOKEN_PATH, { appid, access_token: json.access_token, expires_at: now + expiresIn * 1000 });
  return json.access_token;
}

/** token 失效时刷新一次再重试 */
async function withToken(fn) {
  let token = await getToken(false);
  try {
    return await fn(token);
  } catch (err) {
    if (err && (err.wxCode === 40001 || err.wxCode === 40014 || err.wxCode === 42001)) {
      token = await getToken(true);
      return fn(token);
    }
    throw err;
  }
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function imageForm(file) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(file)], { type: mimeOf(file) });
  form.append('media', blob, path.basename(file));
  return form;
}

async function uploadContentImage(token, file) {
  const json = await fetchJson(
    API_BASE + '/cgi-bin/media/uploadimg?access_token=' + encodeURIComponent(token),
    { method: 'POST', body: imageForm(file) }
  );
  if (json.errcode) throw wxError(json);
  if (!json.url) throw new Error('图片上传成功但未返回 URL');
  return json.url;
}

async function uploadThumb(token, file) {
  const json = await fetchJson(
    API_BASE + '/cgi-bin/material/add_material?type=image&access_token=' + encodeURIComponent(token),
    { method: 'POST', body: imageForm(file) }
  );
  if (json.errcode) throw wxError(json);
  if (!json.media_id) throw new Error('封面图上传成功但未返回 media_id');
  return json.media_id;
}

async function addDraft(token, article) {
  const json = await fetchJson(
    API_BASE + '/cgi-bin/draft/add?access_token=' + encodeURIComponent(token),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles: [article] })
    }
  );
  if (json.errcode) throw wxError(json);
  if (!json.media_id) throw new Error('草稿创建成功但未返回 media_id');
  return json.media_id;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildContent(description, imageUrls, tags) {
  let body = String(description || '').trim();
  if (tags.length) {
    body += (body ? '\n\n' : '') + tags.map((t) => '#' + String(t).replace(/^#+/, '')).join(' ');
  }
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br/>') + '</p>')
    .join('');
  const images = imageUrls.map((url) => '<p><img src="' + escapeHtml(url) + '" /></p>').join('');
  let content = images + paragraphs;
  if (content.length > CONTENT_MAX) {
    const cut = content.lastIndexOf('</p>', CONTENT_MAX);
    content = content.slice(0, cut > 0 ? cut + 4 : CONTENT_MAX);
  }
  return { content, plain: body };
}

async function run(ctx) {
  const task = ctx.task || {};
  if (task.platform !== '公众号') throw new Error('该任务不是公众号平台');
  if (ctx.kind !== 'image') {
    throw new Error('「公众号」目前只支持图文自动发布，短视频请手动发布');
  }
  const files = (ctx.imagePaths || []).filter(Boolean);
  if (!files.length) throw new Error('任务没有图片素材');
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) {
    throw new Error('图片文件不存在：' + missing.map((f) => path.basename(f)).join('、'));
  }

  const { appid } = credentials();
  ctx.log(
    '公众号：准备创建图文草稿（' + files.length + ' 张图片，App ID：' +
      (appid ? appid.slice(0, 4) + '****' : '未配置') + '）'
  );

  const imageUrls = [];
  for (let i = 0; i < files.length; i++) {
    const url = await withToken((token) => uploadContentImage(token, files[i]));
    imageUrls.push(url);
    ctx.log('已上传正文图片 ' + (i + 1) + '/' + files.length);
  }

  const thumbId = await withToken((token) => uploadThumb(token, files[0]));
  ctx.log('已上传封面图');

  const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
  const { content, plain } = buildContent(task.description, imageUrls, tags);
  const title = String(task.title || '').trim().slice(0, TITLE_MAX);
  if (!title) throw new Error('公众号草稿需要标题');
  const digest =
    plain.replace(/\s+/g, ' ').trim().slice(0, DIGEST_MAX) || title;

  const mediaId = await withToken((token) =>
    addDraft(token, {
      title,
      author: '',
      digest,
      content,
      content_source_url: '',
      thumb_media_id: thumbId,
      need_open_comment: 0,
      only_fans_can_comment: 0
    })
  );
  ctx.log('草稿已创建：' + mediaId);

  return {
    status: 'submitted',
    workId: mediaId,
    message:
      '已在公众号草稿箱创建图文草稿（media_id: ' + mediaId +
      '），请打开 mp.weixin.qq.com 确认排版后手动发表'
  };
}

module.exports = { key: '公众号', supported: true, kinds: ['image'], run };
