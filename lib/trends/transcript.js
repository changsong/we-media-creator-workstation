'use strict';

/**
 * 视频文案提取。
 *
 * 链接：识别平台与视频 ID → 暖浏览器打开视频页，捕获播放器/详情接口取平台字幕。
 * 本地文件：ffmpeg 抽音频 + whisper.cpp 本地转写，模型首次使用时下载。
 * 小红书、快手暂无稳定平台字幕，提示下载后上传本地文件。
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const browserLogin = require('../browser-login');
const browser = require('./browser');
const asr = require('../asr');
const { DATA_DIR } = require('../db');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const JOB_TIMEOUT_MS = 90000;
const CAPTION_WAIT_MS = 25000;
const MAX_JOBS = 20;
const MAX_TEXT = 200000;
const UPLOAD_DIR = path.join(DATA_DIR, 'tmp');
const FILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/i;
const UPLOAD_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.flv', '.ts', '.mpg', '.mpeg', '.wmv',
  '.mp3', '.m4a', '.wav', '.aac', '.flac', '.ogg', '.opus'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = () => crypto.randomUUID();

let current = null;
const jobs = new Map(); // id -> job

function mockMode() {
  return process.env.WB_TRENDS_MOCK === '1';
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/** 分享短链（b23.tv / v.douyin.com / xhslink.com / v.kuaishou.com）展开为视频页 URL */
async function expandUrl(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (err) {
    return url;
  }
  const shortHosts = /^(b23\.tv|bili2233\.cn|v\.douyin\.com|xhslink\.com|v\.kuaishou\.com)$/i;
  if (!shortHosts.test(host)) return url;
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' }
      },
      10000
    );
    const finalUrl = (res && res.url) || url;
    if (res && res.body && res.body.cancel) res.body.cancel().catch(() => {});
    return finalUrl;
  } catch (err) {
    return url;
  }
}

function detectTarget(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return null;
  }
  const host = parsed.hostname || '';
  const full = url;

  if (/bilibili\.com|b23\.tv|bili2233\.cn/i.test(host)) {
    let m = full.match(/\/video\/(BV[0-9A-Za-z]+)/i);
    if (!m) m = full.match(/[?&]bvid=(BV[0-9A-Za-z]+)/i);
    if (m) return { platform: 'B站', workId: m[1], pageUrl: 'https://www.bilibili.com/video/' + m[1] };
    m = full.match(/\/video\/av(\d+)/i);
    if (m) return { platform: 'B站', workId: 'av' + m[1], pageUrl: 'https://www.bilibili.com/video/av' + m[1] };
    return { platform: 'B站', workId: '', pageUrl: '' };
  }

  if (/douyin\.com|iesdouyin\.com/i.test(host)) {
    const m =
      full.match(/\/video\/(\d+)/) ||
      full.match(/\/share\/video\/(\d+)/) ||
      full.match(/[?&]modal_id=(\d+)/);
    if (m) return { platform: '抖音', workId: m[1], pageUrl: 'https://www.douyin.com/video/' + m[1] };
    return { platform: '抖音', workId: '', pageUrl: '' };
  }

  if (/xiaohongshu\.com|xhslink\.com/i.test(host)) {
    const m = full.match(/\/(?:explore|discovery\/item)\/([0-9A-Za-z]+)/);
    return { platform: '小红书', workId: m ? m[1] : '', pageUrl: m ? 'https://www.xiaohongshu.com/explore/' + m[1] : '' };
  }

  if (/kuaishou\.com/i.test(host)) {
    const m =
      full.match(/\/short-video\/([\w-]+)/) ||
      full.match(/\/fw\/photo\/([\w-]+)/) ||
      full.match(/[?&]photoId=([\w-]+)/);
    return { platform: '快手', workId: m ? m[1] : '', pageUrl: m ? 'https://www.kuaishou.com/short-video/' + m[1] : '' };
  }

  return { platform: '', workId: '', pageUrl: '' };
}

function parseTimestamp(value) {
  const s = String(value || '').trim().replace(',', '.');
  const m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  const ms = Number((m[4] || '0').padEnd(3, '0'));
  return h * 3600 + min * 60 + sec + ms / 1000;
}

function stripCue(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析 WebVTT / SRT 字幕 */
function parseVtt(text) {
  const segments = [];
  const blocks = String(text || '')
    .replace(/\r/g, '')
    .split(/\n{2,}/);
  blocks.forEach((block) => {
    const lines = block.split('\n').map((l) => l.trim());
    const idx = lines.findIndex((l) => l.indexOf('-->') >= 0);
    if (idx < 0) return;
    const parts = lines[idx].split('-->');
    const start = parseTimestamp(parts[0]);
    const end = parseTimestamp(String(parts[1] || '').split(/\s+/)[0]);
    const content = stripCue(lines.slice(idx + 1).join(' '));
    if (content) segments.push({ start, end, text: content });
  });
  return segments;
}

function toSegment(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = stripCue(entry.content || entry.text || entry.utterance || entry.subtitle || '');
  if (!text) return null;
  const start = Number(entry.from != null ? entry.from : entry.start != null ? entry.start : entry.start_time != null ? entry.start_time : 0);
  const end = Number(entry.to != null ? entry.to : entry.end != null ? entry.end : entry.end_time != null ? entry.end_time : start);
  return { start: Number.isFinite(start) ? start : 0, end: Number.isFinite(end) ? end : start, text };
}

/** 解析 B站字幕 JSON 或通用字幕 JSON */
function parseJsonSubtitle(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return [];
  }
  let list = null;
  if (Array.isArray(data)) list = data;
  else if (data && Array.isArray(data.body)) list = data.body;
  else if (data && Array.isArray(data.utterances)) list = data.utterances;
  else if (data && Array.isArray(data.segments)) list = data.segments;
  else if (data && data.data && Array.isArray(data.data.body)) list = data.data.body;
  if (!list) return [];
  return list.map(toSegment).filter(Boolean);
}

function appendText(currentText, nextText) {
  if (!currentText) return nextText;
  const tail = currentText.charAt(currentText.length - 1);
  const head = nextText.charAt(0);
  return currentText + (/[A-Za-z0-9]$/.test(tail) && /^[A-Za-z0-9]/.test(head) ? ' ' : '') + nextText;
}

/** 把字幕按停顿/长度合并成段落文本 */
function joinSegments(segments) {
  const paras = [];
  let cur = '';
  let lastEnd = -1;
  (segments || []).forEach((seg) => {
    const text = stripCue(seg.text);
    if (!text) return;
    if (cur && (seg.start - lastEnd > 2 || cur.length > 220)) {
      paras.push(cur);
      cur = '';
    }
    cur = appendText(cur, text);
    lastEnd = seg.end;
  });
  if (cur) paras.push(cur);
  let text = paras.join('\n');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\n…（内容过长，已截断）';
  return text;
}

async function evalAwait(call, expression) {
  try {
    const res = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res && res.exceptionDetails) return null;
    return res && res.result ? res.result.value : null;
  } catch (err) {
    return null;
  }
}

/** 在页面上下文取文本（带 Cookie），失败时退回 Node 请求 */
async function fetchTextInPage(call, url, referer) {
  const expr = `fetch(${JSON.stringify(url)},{credentials:'include'}).then(r=>r.text()).catch(()=>'')`;
  const text = await evalAwait(call, expr);
  if (text && String(text).trim()) return String(text);
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': UA,
          Referer: referer || 'https://www.bilibili.com/',
          Accept: '*/*'
        }
      },
      15000
    );
    if (res && res.ok) return await res.text();
  } catch (err) {
    /* 两种方式都失败时由调用方处理 */
  }
  return '';
}

async function pageTitle(call, platform) {
  const title = await browser.evalValue(call, 'document.title');
  const suffix = platform === 'B站' ? /(?:^|\s*[-_|]\s*)(?:哔哩哔哩|bilibili).*$/i : /(?:^|\s*[-_|]\s*)(?:抖音|douyin).*$/i;
  return String(title || '').replace(suffix, '').trim();
}

function normalizeDuration(value) {
  const n = Number(value) || 0;
  if (n <= 0) return 0;
  return n > 10000 ? Math.round(n / 1000) : Math.round(n);
}

/** 抖音接口的 video.duration 固定为毫秒 */
function normalizeDurationMs(value) {
  const n = Number(value) || 0;
  return n > 0 ? Math.round(n / 1000) : 0;
}

async function bilibiliTranscript(target, job, session) {
  const ws = await browser.openPage(session.browser);
  let call = null;
  const payloads = [];
  const pending = new Map();
  let meta = {};

  const onEvent = (msg) => {
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url || '';
      if (/\/x\/(?:player\/(?:wbi\/)?v2|web-interface\/view)/.test(url)) {
        pending.set(msg.params.requestId, url);
      }
      return;
    }
    if (msg.method !== 'Network.loadingFinished') return;
    const url = pending.get(msg.params.requestId);
    if (!url) return;
    pending.delete(msg.params.requestId);
    const requestId = msg.params.requestId;
    Promise.resolve()
      .then(() => call('Network.getResponseBody', { requestId }))
      .then((res) => {
        const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
        payloads.push({ url, json: JSON.parse(text) });
      })
      .catch(() => {
        /* 取不到响应体时忽略 */
      });
  };

  try {
    call = await browserLogin.cdpConnect(ws, onEvent);
    await call('Network.enable', {});
    await call('Page.enable', {});
    job.stage = '打开 B站视频页';
    job.progress = 20;
    await call('Page.navigate', { url: target.pageUrl || target.url });

    let subtitleUrl = '';
    const deadline = Date.now() + CAPTION_WAIT_MS;
    while (Date.now() < deadline) {
      for (const p of payloads) {
        const data = p.json && p.json.data;
        if (!data) continue;
        if (p.url.indexOf('/x/web-interface/view') >= 0 && data.title) {
          meta.title = meta.title || data.title;
          meta.author = meta.author || (data.owner && data.owner.name) || '';
          meta.duration = meta.duration || normalizeDuration(data.duration);
        }
        const subs = data.subtitle && data.subtitle.subtitles;
        if (!subtitleUrl && Array.isArray(subs) && subs.length) {
          const pick = subs.find((s) => /^zh|ai-zh/i.test(String(s.lan || ''))) || subs[0];
          if (pick && pick.subtitle_url) subtitleUrl = pick.subtitle_url;
        }
      }
      if (subtitleUrl) break;
      await sleep(300);
    }

    if (!subtitleUrl && target.workId && /^BV/i.test(target.workId)) {
      job.stage = '读取字幕列表';
      job.progress = 45;
      const info = await evalAwait(
        call,
        `(async () => {
          const v = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + ${JSON.stringify(target.workId)}, {credentials:'include'}).then(r=>r.json()).catch(()=>null);
          if (!v || v.code !== 0 || !v.data) return null;
          const p = await fetch('https://api.bilibili.com/x/player/v2?aid=' + v.data.aid + '&cid=' + v.data.cid, {credentials:'include'}).then(r=>r.json()).catch(()=>null);
          const subs = p && p.code === 0 && p.data && p.data.subtitle ? p.data.subtitle.subtitles : null;
          return { title: v.data.title, author: v.data.owner && v.data.owner.name, duration: v.data.duration, subtitles: subs || [] };
        })()`
      );
      if (info) {
        meta.title = meta.title || info.title || '';
        meta.author = meta.author || info.author || '';
        meta.duration = meta.duration || normalizeDuration(info.duration);
        if (Array.isArray(info.subtitles) && info.subtitles.length) {
          const pick = info.subtitles.find((s) => /^zh|ai-zh/i.test(String(s.lan || ''))) || info.subtitles[0];
          if (pick && pick.subtitle_url) subtitleUrl = pick.subtitle_url;
        }
      }
    }

    if (!subtitleUrl) {
      const title = meta.title || (await pageTitle(call, 'B站'));
      const err = new Error('该视频没有可用字幕（B站仅部分视频提供字幕）。可下载视频后在本页上传，用本地语音识别提取');
      err.title = title;
      throw err;
    }

    if (subtitleUrl.indexOf('//') === 0) subtitleUrl = 'https:' + subtitleUrl;
    job.stage = '下载并整理字幕';
    job.progress = 75;
    const raw = await fetchTextInPage(call, subtitleUrl, target.pageUrl || target.url);
    let segments = parseJsonSubtitle(raw);
    if (!segments.length) segments = parseVtt(raw);
    if (!segments.length) throw new Error('字幕内容为空，请稍后重试');

    return {
      title: meta.title || (await pageTitle(call, 'B站')) || 'B站视频',
      author: meta.author || '',
      duration: meta.duration || 0,
      segments,
      source: 'caption'
    };
  } finally {
    if (call) call.close();
  }
}

function findCaptionInfos(value, depth) {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findCaptionInfos(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (Array.isArray(value.caption_infos) && value.caption_infos.length) return value.caption_infos;
  for (const key of Object.keys(value)) {
    const hit = findCaptionInfos(value[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** 在服务端渲染数据里找作品对象（aweme_id + desc/video） */
function findAweme(value, depth) {
  if (!value || typeof value !== 'object' || depth > 10) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findAweme(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (value.aweme_id && (value.desc != null || value.video)) return value;
  for (const key of Object.keys(value)) {
    const hit = findAweme(value[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

function applyDouyinMeta(meta, aweme) {
  if (!aweme) return;
  meta.title = meta.title || String(aweme.desc || '').trim();
  meta.author = meta.author || (aweme.author && (aweme.author.nickname || aweme.author.unique_id)) || '';
  meta.duration = meta.duration || normalizeDurationMs(aweme.video && aweme.video.duration);
}

/** 抖音页面可能不发详情 XHR，改从内嵌的 SSR 数据里找字幕 */
async function readDouyinPageState(call) {
  return evalAwait(
    call,
    `(() => {
      const out = {};
      try { if (window._ROUTER_DATA) out.router = window._ROUTER_DATA; } catch (e) {}
      try { if (window.__INITIAL_STATE__) out.initial = window.__INITIAL_STATE__; } catch (e) {}
      try { if (window.__NEXT_DATA__) out.next = window.__NEXT_DATA__; } catch (e) {}
      try {
        const el = document.getElementById('RENDER_DATA');
        if (el && el.textContent) out.render = JSON.parse(decodeURIComponent(el.textContent));
      } catch (e) {}
      return out;
    })()`
  );
}

async function douyinTranscript(target, job, session) {
  const ws = await browser.openPage(session.browser);
  let call = null;
  const payloads = [];
  const pending = new Map();
  let networkError = null;

  const onEvent = (msg) => {
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url || '';
      if (/\/aweme\/v1\/web\/aweme\/detail\//.test(url)) pending.set(msg.params.requestId, url);
      return;
    }
    if (msg.method === 'Network.loadingFailed') {
      const text = (msg.params && msg.params.errorText) || '';
      if (/ERR_PROXY|ERR_TUNNEL/i.test(text)) networkError = new Error('抖音请求经代理失败（' + text + '）');
      return;
    }
    if (msg.method !== 'Network.loadingFinished') return;
    const url = pending.get(msg.params.requestId);
    if (!url) return;
    pending.delete(msg.params.requestId);
    const requestId = msg.params.requestId;
    Promise.resolve()
      .then(() => call('Network.getResponseBody', { requestId }))
      .then((res) => {
        const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
        payloads.push(JSON.parse(text));
      })
      .catch(() => {
        /* 忽略取不到响应体的请求 */
      });
  };

  try {
    call = await browserLogin.cdpConnect(ws, onEvent);
    await call('Network.enable', {});
    await call('Page.enable', {});
    job.stage = '打开抖音视频页';
    job.progress = 20;
    await call('Page.navigate', { url: target.pageUrl || target.url });

    let captionInfos = null;
    let meta = {};
    const deadline = Date.now() + CAPTION_WAIT_MS;
    while (Date.now() < deadline) {
      for (const json of payloads) {
        const aweme =
          (json && json.aweme_detail) ||
          (json && json.aweme_detail_list && json.aweme_detail_list[0]) ||
          (json && json.aweme_list && json.aweme_list[0]);
        if (!aweme) continue;
        applyDouyinMeta(meta, aweme);
        const infos = findCaptionInfos(aweme, 0);
        if (infos) {
          captionInfos = infos;
          break;
        }
      }
      if (captionInfos) break;
      if (networkError) throw networkError;
      await sleep(300);
    }

    // 页面直接走 SSR、没有详情 XHR 时，从内嵌数据里再找一次
    if (!captionInfos) {
      job.stage = '读取页面字幕';
      job.progress = 45;
      const state = await readDouyinPageState(call);
      if (state) {
        const aweme = findAweme(state, 0);
        applyDouyinMeta(meta, aweme);
        captionInfos = findCaptionInfos(aweme || state, 0) || findCaptionInfos(state, 0);
      }
    }

    const info = captionInfos && captionInfos.find((it) => it && (it.url || it.Url || it.caption_url));
    if (!info) {
      const page = await browser.evalValue(
        call,
        '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 500)})'
      );
      const pageUrl = (page && page.url) || '';
      const pageTitle = (page && page.title) || '';
      const pageText = (page && page.text) || '';
      if (/captcha|verify/i.test(pageUrl) || /验证码|安全验证/.test(pageTitle) || /验证码|安全验证/.test(pageText)) {
        throw new Error('抖音要求完成人机验证，请稍后重试；若持续出现，请到「连接设置」重新登录抖音');
      }
      if (/登录后查看|请先登录|扫码登录|登录抖音/.test(pageText)) {
        throw new Error('抖音需要登录态才能读取视频信息，请到「连接设置」重新登录抖音后再试');
      }
      if (/作品不存在|作品已删除|该作品无法查看|私密作品|作者已设置/.test(pageText)) {
        throw new Error('该抖音作品不存在、已删除或不可见');
      }
      const err = new Error('该视频没有平台字幕。可下载视频后在本页上传，用本地语音识别提取');
      err.title = meta.title || '';
      throw err;
    }

    let captionUrl = info.url || info.Url || info.caption_url;
    if (captionUrl.indexOf('//') === 0) captionUrl = 'https:' + captionUrl;
    job.stage = '下载并整理字幕';
    job.progress = 75;
    const raw = await fetchTextInPage(call, captionUrl, target.pageUrl || target.url);
    let segments = parseJsonSubtitle(raw);
    if (!segments.length) segments = parseVtt(raw);
    if (!segments.length && info.content) {
      segments = [{ start: 0, end: 0, text: stripCue(info.content) }].filter((it) => it.text);
    }
    if (!segments.length) throw new Error('字幕内容为空，请稍后重试');

    return {
      title: meta.title || '抖音视频',
      author: meta.author || '',
      duration: meta.duration || 0,
      segments,
      source: 'caption'
    };
  } finally {
    if (call) call.close();
  }
}

function mockResult(job) {
  const segments = [
    { start: 0, end: 3.2, text: '大家好，今天用一分钟讲清楚视频文案的结构。' },
    { start: 3.2, end: 7.8, text: '第一句先抛结论，让观众知道这条视频和自己有关。' },
    { start: 7.8, end: 12.4, text: '中间用三个具体步骤展开，每一步都给一个可执行的例子。' },
    { start: 12.4, end: 16.5, text: '最后用一句提问收尾，把评论区变成下一次选题的来源。' }
  ];
  return {
    title: job.title || '演示视频：爆款文案的三段式结构',
    author: job.author || '演示账号',
    duration: 17,
    segments,
    source: 'caption'
  };
}

function snapshot(job) {
  if (!job) return null;
  return {
    id: job.id,
    url: job.url,
    resolvedUrl: job.resolvedUrl || '',
    platform: job.platform || '',
    workId: job.workId || '',
    status: job.status,
    stage: job.stage || '',
    progress: job.progress || 0,
    title: job.title || '',
    author: job.author || '',
    duration: job.duration || 0,
    source: job.source || '',
    text: job.text || '',
    segments: (job.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
    error: job.error || '',
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null
  };
}

function applyResult(job, result) {
  job.title = result.title || '';
  job.author = result.author || '';
  job.duration = result.duration || 0;
  job.source = result.source || 'caption';
  job.segments = result.segments || [];
  job.text = joinSegments(job.segments);
  job.stage = '完成';
  job.progress = 100;
  job.status = 'done';
}

async function run(job) {
  let session = null;
  try {
    job.status = 'running';
    job.stage = job.inputFile ? '准备本地转写' : '解析视频链接';
    job.progress = 5;

    let target = null;
    if (!job.inputFile) {
      const resolved = mockMode() ? job.url : await expandUrl(job.url);
      target = detectTarget(resolved);
      job.platform = (target && target.platform) || '';
      job.workId = (target && target.workId) || '';
      job.resolvedUrl = (target && target.pageUrl) || resolved;
    }

    if (mockMode()) {
      await sleep(600);
      applyResult(job, mockResult(job));
      return;
    }

    if (job.inputFile) {
      const result = await asr.transcribe(job, job.inputFile);
      const segments = parseVtt(result.srt);
      if (!segments.length) throw new Error('语音识别没有返回可用文字，请确认视频包含清晰人声');
      const lastEnd = segments[segments.length - 1].end || 0;
      applyResult(job, {
        title: job.title || '本地视频文案',
        author: '本地文件',
        duration: result.duration || Math.round(lastEnd),
        segments,
        source: 'whisper'
      });
      return;
    }

    if (!target || !target.platform) {
      throw new Error('暂不支持该链接，请粘贴 B站 / 抖音 / 小红书 / 快手的视频页链接');
    }
    if (target.platform === '小红书') {
      throw new Error('小红书暂未提供可用平台字幕；请下载视频后在本页上传，用本地语音识别提取');
    }
    if (target.platform === '快手') {
      throw new Error('快手平台字幕覆盖有限；请下载视频后在本页上传，用本地语音识别提取');
    }
    if (!target.workId) {
      throw new Error('未能识别视频 ID，请粘贴完整的视频页链接');
    }

    if (browserLogin.isBusy()) {
      throw httpError(409, '另一个浏览器任务正在进行，请稍后再试');
    }

    job.stage = '启动浏览器';
    job.progress = 10;
    session = await browser.ensure();
    const runner = target.platform === 'B站' ? bilibiliTranscript : douyinTranscript;
    const result = await withTimeout(
      runner(target, job, session),
      JOB_TIMEOUT_MS,
      '文案提取超时，请稍后重试'
    );
    applyResult(job, result);
  } catch (err) {
    job.status = 'error';
    job.stage = '失败';
    job.error = err && err.message ? err.message : '文案提取失败';
    if (err && err.title) job.title = err.title;
  } finally {
    job.finishedAt = new Date().toISOString();
    if (session) await browser.closeSession(session);
    if (job.inputFile) await fsp.rm(job.inputFile, { force: true }).catch(() => {});
    if (current === job) current = null;
  }
}

function prune() {
  if (jobs.size <= MAX_JOBS) return;
  const finished = Array.from(jobs.values())
    .filter((j) => j.status === 'done' || j.status === 'error')
    .sort((a, b) => String(a.finishedAt || '').localeCompare(String(b.finishedAt || '')));
  while (jobs.size > MAX_JOBS && finished.length) {
    jobs.delete(finished.shift().id);
  }
}

function uploadedPath(fileId) {
  const id = String(fileId || '').trim();
  if (!FILE_ID_RE.test(id)) throw httpError(400, '上传文件无效，请重新选择');
  const file = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(file)) throw httpError(404, '上传文件已过期，请重新选择');
  return file;
}

function baseName(name) {
  const raw = String(name || '').split(/[\\/]/).pop() || '';
  return raw.replace(/\.[a-z0-9]{1,8}$/i, '').trim().slice(0, 80);
}

function start(input) {
  const fileId = String((input && input.fileId) || '').trim();
  const url = String((input && input.url) || '').trim();
  let inputFile = '';
  if (fileId) {
    inputFile = uploadedPath(fileId);
  } else {
    if (!url) throw httpError(400, '请粘贴视频链接或选择本地文件');
    if (!/^https?:\/\//i.test(url)) throw httpError(400, '请输入 http(s) 开头的视频链接');
  }
  if (current && (current.status === 'queued' || current.status === 'running')) {
    throw httpError(409, '已有文案提取任务进行中，请稍候');
  }

  const job = {
    id: uid(),
    url,
    resolvedUrl: '',
    platform: inputFile ? '本地文件' : '',
    workId: '',
    inputFile,
    status: 'queued',
    stage: '排队中',
    progress: 0,
    title: inputFile ? baseName(input && input.name) || '本地视频' : '',
    author: '',
    duration: 0,
    source: '',
    segments: [],
    text: '',
    error: '',
    createdAt: new Date().toISOString(),
    finishedAt: null
  };
  jobs.set(job.id, job);
  prune();
  current = job;
  run(job).catch(() => {
    /* run 内部已落状态 */
  });
  return snapshot(job);
}

function status(id) {
  const job = jobs.get(String(id || ''));
  if (!job) throw httpError(404, '任务不存在或已过期');
  return snapshot(job);
}

module.exports = { start, status, detectTarget, UPLOAD_DIR, UPLOAD_EXTS, baseName };
