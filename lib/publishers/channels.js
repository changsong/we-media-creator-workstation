'use strict';

/**
 * 视频号发布适配器。
 *
 * 投稿页：https://channels.weixin.qq.com/platform/post/create
 * 视频号没有独立的「视频标题」必填项，正文是「描述」（≤1000 字），
 * 短标题是可选字段且要求 6–16 字，超出范围时只写描述，避免被平台拦下。
 */

const { runWithConfig } = require('./browser-publish');
const channelConnections = require('../channel-connections');
const channelsCollector = require('../channels-collector');

const DESC_MAX = 1000;
const TAGS_MAX = 6;
// 视频号作品可能先经过一段审核才出现在作品列表，发布时轮询几分钟，
// 仍未出现则保留「待核验」，由发布队列定时复核。
const VERIFY_MS = 3 * 60 * 1000;
const VERIFY_INTERVAL_MS = 10 * 1000;
const RECENT_WINDOW_MS = 30 * 60 * 1000;

function tagsLine(tags, limit) {
  return (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .map((t) => '#' + t)
    .join(' ');
}

function compose(task, tags) {
  const line = tagsLine(tags, TAGS_MAX);
  const body = String(task.description || '').trim();
  const description = (body && line ? body + '\n' + line : body || line || String(task.title || '').trim()).slice(
    0,
    DESC_MAX
  );
  const rawTitle = String(task.title || '').trim();
  const title = rawTitle.length >= 6 && rawTitle.length <= 16 ? rawTitle : '';
  return { title, description };
}

function normalizeText(text) {
  return String(text || '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function shortTitleOf(item) {
  const raw = item && item.desc ? item.desc.shortTitle : '';
  if (Array.isArray(raw)) {
    const hit = raw.find((entry) => entry && String(entry.shortTitle || '').trim());
    return hit ? String(hit.shortTitle).trim() : '';
  }
  return String(raw || '').trim();
}

/** 在作品列表里按描述/短标题匹配本次发布的作品，只接受发布之后创建的新作品 */
function matchWork(works, task, sinceMs) {
  const composed = compose(task, Array.isArray(task.tags) ? task.tags : []);
  const wantedDesc = normalizeText(composed.description);
  const wantedTitle = normalizeText(composed.title);
  const sinceSec = Math.floor((Number(sinceMs) || 0) / 1000);
  const nowSec = Math.floor(Date.now() / 1000);
  const hits = [];

  (works || []).forEach((item) => {
    if (!item || !item.objectId) return;
    const createTime = Number(item.createTime) || 0;
    if (sinceSec && createTime && createTime < sinceSec) return;
    if (!sinceSec && createTime && nowSec - createTime > RECENT_WINDOW_MS / 1000) return;

    const gotDesc = normalizeText(item.desc && item.desc.description);
    const gotTitle = normalizeText(shortTitleOf(item));
    // 描述里带话题，比对时统一去掉 # 话题并压缩空白；过短的包含关系容易误匹配
    const descHit =
      !!wantedDesc &&
      !!gotDesc &&
      (gotDesc === wantedDesc ||
        (Math.min(gotDesc.length, wantedDesc.length) >= 8 &&
          (gotDesc.indexOf(wantedDesc) >= 0 || wantedDesc.indexOf(gotDesc) >= 0)));
    const titleHit = !!wantedTitle && !!gotTitle && gotTitle === wantedTitle;
    if (!descHit && !titleHit) return;
    hits.push(item);
  });

  hits.sort((a, b) => (Number(b.createTime) || 0) - (Number(a.createTime) || 0));
  return hits[0] || null;
}

function savedCookie() {
  const raw = channelConnections.getRaw('视频号');
  return raw && raw.enabled ? String((raw.fields && raw.fields['Cookie']) || '') : '';
}

/** 优先用发布浏览器的登录态，回退到「连接设置」里保存的 Cookie */
async function verifyCookie(call) {
  if (call) {
    try {
      const res = await call('Network.getCookies', { urls: ['https://channels.weixin.qq.com'] });
      const header = ((res && res.cookies) || []).map((c) => c.name + '=' + c.value).join('; ');
      if (header) return header;
    } catch (err) {
      /* 取不到浏览器 Cookie 时回退到连接设置 */
    }
  }
  return savedCookie();
}

/**
 * 轮询视频号作品列表核验新作品。
 * waitMs 为 0 时只查一次（供发布队列的定时复核使用）。
 */
async function verifyWork(task, ctx, opts) {
  const o = opts || {};
  const log = (ctx && ctx.log) || (() => {});
  const cookie = await verifyCookie(o.call);
  if (!cookie) {
    log('没有可用的视频号 Cookie，跳过作品列表核验', 'warn');
    return null;
  }

  const sinceMs = Number(o.sinceMs) || Date.now() - RECENT_WINDOW_MS;
  const waitMs = o.waitMs == null ? VERIFY_MS : Number(o.waitMs);
  const deadline = Date.now() + Math.max(0, waitMs);

  do {
    try {
      const works = await channelsCollector.fetchRecentWorks(cookie, 2);
      const hit = matchWork(works, task, sinceMs);
      if (hit) {
        log('作品列表已匹配到新作品：' + hit.objectId);
        return { workId: String(hit.objectId), publishUrl: '' };
      }
    } catch (err) {
      log('作品列表核验失败：' + err.message, 'warn');
      if (err.status === 401) return null;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, VERIFY_INTERVAL_MS));
  } while (Date.now() < deadline);

  return null;
}

function taskTimeMs(task) {
  const raw = task && (task.finishedAt || task.startedAt);
  const time = new Date(raw || '').getTime();
  return Number.isFinite(time) ? time : Date.now();
}

/** 发布队列定时复核「待核验」任务时调用：只查一次 */
async function verifySubmitted(task) {
  return verifyWork(task, null, {
    waitMs: 0,
    sinceMs: taskTimeMs(task) - 10 * 60 * 1000
  });
}

const cfg = {
  platform: '视频号',
  uploadUrl: 'https://channels.weixin.qq.com/platform/post/create',
  cookieDomain: '.weixin.qq.com',
  cookieMode: 'header',
  loginUrlRe: /\/login/i,
  loginTextRe: /扫码登录|微信扫码|请使用微信/,
  titleHintRe: '短标题|标题',
  descHintRe: '描述|说点什么|简介',
  tagHintRe: '话题|标签',
  useTagInput: false,
  titleMax: 16,
  publishButtons: ['发表'],
  // 视频号用无界微前端承载页面，表单、文件框和「发表」按钮都在 <wujie-app> 的 shadow root 里
  shadowHosts: ['wujie-app', '.wujie_iframe'],
  // 视频号会先渲染描述区，短标题框有时随后才出现
  descFirst: true,
  uploadRouteRe: /post\/create/,
  successRe: /发表成功|发布成功/,
  compose,
  afterPublish: async (call, ctx) => {
    const verified = await verifyWork(ctx.task, ctx, { call });
    if (!verified) {
      ctx.log('未在视频号作品列表核验到新作品（可能仍在审核中），保留「待核验」并继续自动复核', 'warn');
      return null;
    }
    // 视频号作品没有公开链接，核验到作品 ID 即可确认发布成功
    return {
      status: 'published',
      workId: verified.workId,
      publishUrl: '',
      message: '已发布并核验作品（视频号无公开链接，作品 ID：' + verified.workId + '）'
    };
  }
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '视频号', supported: true, kinds: ['video'], run, verify: verifySubmitted };
