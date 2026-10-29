'use strict';

/**
 * 快手个人作品数据采集器。
 *
 * 快手创作者中心的接口带 __NS_sig3 签名，Node 里无法自行构造，这里复用
 * 「一键登录」的专用浏览器 profile，无头打开「数据中心 → 作品分析」，
 * 通过 CDP 捕获页面自己发出的 photo/list 响应，再落库：
 *   - 内容日历：按作品 ID / 标题匹配，匹配不到则自动建档（阶段=已发布）
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 *
 * 列表接口提供播放 / 点赞 / 评论 / 收藏 / 涨粉；分享数只在单篇详情的
 * 「互动效果」里，需要逐篇打开页面，暂不采集。
 */

const store = require('./store');
const browserLogin = require('./browser-login');
const channelConnections = require('./channel-connections');

const PLATFORM = '快手';
const ANALYSIS_URL = 'https://cp.kuaishou.com/statistics/article';
const PHOTO_LIST_API = '/rest/cp/creator/analysis/pc/photo/list';
const WORK_PAGE_URL = 'https://www.kuaishou.com/short-video/';
const WAIT_RESPONSE_MS = 30000;
const SCROLL_ROUNDS = 4;
const SCROLL_WAIT_MS = 3000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null
};

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function localMinute(ms) {
  const d = new Date(Number(ms) || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parsePayload(json) {
  const data = json && json.data;
  const photoList = data && data.photoList;
  if (!photoList || !Array.isArray(photoList.photoItems)) return null;
  return { items: photoList.photoItems };
}

async function evalJs(call, expression) {
  try {
    const res = await call('Runtime.evaluate', { expression, returnByValue: true });
    return res && res.result ? res.result.value : null;
  } catch (err) {
    return null;
  }
}

async function applyCookies(call, cookie) {
  let count = 0;
  for (const pair of String(cookie || '').split(';')) {
    const item = pair.trim();
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    try {
      await call('Network.setCookie', {
        name: item.slice(0, idx).trim(),
        value: item.slice(idx + 1),
        domain: '.kuaishou.com',
        path: '/',
        secure: true,
        sameSite: 'Lax'
      });
      count++;
    } catch (err) {
      /* 个别 Cookie 格式不被接受时跳过 */
    }
  }
  return count;
}

/** 打开作品分析页，收集页面自己请求到的作品列表（含滚动加载） */
async function collectWithPage(browser, cookie, onCdpReady) {
  const targets = await browserLogin.httpJson(browser.port, '/json/list');
  const page =
    (browser.target && browser.target.webSocketDebuggerUrl ? browser.target : null) ||
    targets.find((t) => t.type === 'page' && /cp\.kuaishou\.com/.test(t.url || '')) ||
    targets.find((t) => t.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error('未找到可用的浏览器标签页，请重试');
  }

  const responses = [];
  const pending = new Map();
  const consumed = new Set();
  let call = null;

  call = await browserLogin.cdpConnect(page.webSocketDebuggerUrl, (msg) => {
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url || '';
      if (url.indexOf(PHOTO_LIST_API) >= 0) pending.set(msg.params.requestId, url);
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
        const json = JSON.parse(text);
        if (parsePayload(json)) responses.push({ url, json });
      })
      .catch(() => {
        /* 响应体取不到时忽略，交给超时逻辑 */
      });
  });

  const waitForResponse = async (timeoutMs) => {
    const start = Date.now();
    for (;;) {
      for (let i = 0; i < responses.length; i++) {
        if (consumed.has(i)) continue;
        consumed.add(i);
        return responses[i];
      }
      if (Date.now() - start > timeoutMs) return null;
      await sleep(200);
    }
  };

  onCdpReady(call);
  await call('Network.enable', {});
  await call('Page.enable', {});
  await call('Runtime.enable', {});
  await applyCookies(call, cookie);
  await call('Page.navigate', { url: ANALYSIS_URL });

  const first = await waitForResponse(WAIT_RESPONSE_MS);
  if (!first) throw await loginOrTimeoutError(call);

  const warnings = [];
  const works = [];
  const seen = new Set();
  const absorb = (payload) => {
    parsePayload(payload.json).items.forEach((item) => {
      if (!item || !item.photoId) return;
      const id = String(item.photoId);
      if (seen.has(id)) return;
      seen.add(id);
      works.push(item);
    });
  };

  absorb(first);

  // 作品较多时页面是滚动加载的，继续滚动直到没有新增或达到轮次上限
  for (let round = 0; round < SCROLL_ROUNDS; round++) {
    const before = works.length;
    await evalJs(call, 'window.scrollTo(0, document.body.scrollHeight)');
    const more = await waitForResponse(SCROLL_WAIT_MS);
    if (more) absorb(more);
    if (works.length === before) break;
  }

  return { works, warnings };
}

async function loginOrTimeoutError(call) {
  const info = await evalJs(
    call,
    '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})'
  );
  if (info && (/passport|\/login/.test(info.url || '') || /扫码登录|登录快手|登录后发布/.test(info.text || ''))) {
    return httpError(401, '快手登录态已失效，请到「连接设置」重新一键登录');
  }
  return httpError(502, '未捕获到快手作品数据接口，请稍后重试（若浏览器窗口中被要求登录，请重新一键登录）');
}

function saveWorks(works) {
  const statDate = today();
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  let totalReads = 0;
  let totalLikes = 0;

  works.forEach((item) => {
    const id = String(item.photoId || '').trim();
    if (!id) return;
    const rawTitle = String(item.title || '').trim();
    const firstLine = rawTitle.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
    const title = (firstLine || '快手作品 ' + id).slice(0, 80);

    let schedule = store.findScheduleByNote(PLATFORM, id, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute(item.publishTime),
        当前阶段: '已发布',
        内容形式: item.video === false ? '图文' : '短视频',
        发布链接: WORK_PAGE_URL + id,
        备注: '快手作品自动同步（ID: ' + id + '）'
      });
      schedulesCreated++;
    }

    const reads = Number(item.playCount) || 0;
    const likes = Number(item.likeCount) || 0;
    const comments = Number(item.commentCount) || 0;
    const collects = Number(item.collectCount) || 0;
    const followers = Number(item.followCount) || 0;
    const snap = store.upsertNoteSnapshot(schedule['排期ID'], PLATFORM, statDate, {
      reads,
      likes,
      followers,
      conversions: 0,
      note:
        '快手自动同步 · 评论 ' + comments +
        ' · 收藏 ' + collects +
        ' · 涨粉 ' + followers +
        ' · 作品 ID ' + id
    });
    if (snap.updated) snapshotsUpdated++;
    else snapshotsCreated++;
    totalReads += reads;
    totalLikes += likes;
  });

  return { schedulesCreated, schedulesMatched, snapshotsCreated, snapshotsUpdated, totalReads, totalLikes };
}

async function run() {
  if (state.running) throw httpError(409, '快手数据同步正在进行，请稍候');
  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') {
    throw httpError(409, '快手登录窗口正在进行，请完成登录后再同步');
  }
  const connection = channelConnections.getRaw(PLATFORM);
  const cookie = connection && connection.enabled ? String(connection.fields['Cookie'] || '') : '';
  if (!cookie) throw httpError(400, '请先在「连接设置」完成快手一键登录');

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;
  browserLogin.acquire('kuaishou-collector');

  let browser = null;
  let cdp = null;
  try {
    browser = await browserLogin.ensureBrowser({ url: 'about:blank', headless: true });
    const { works, warnings } = await collectWithPage(browser, cookie, (client) => {
      cdp = client;
    });
    const summary = saveWorks(works);
    if (!works.length) {
      warnings.push('作品分析里没有近 90 天的公开作品，暂未写入快照');
    }
    const result = {
      ok: true,
      platform: PLATFORM,
      total: works.length,
      fetched: works.length,
      statDate: today(),
      ...summary,
      warnings
    };
    state.lastSuccessAt = new Date().toISOString();
    state.lastResult = result;
    return result;
  } catch (err) {
    state.lastError = err && err.message ? err.message : '采集失败';
    if (err && !err.status) err.status = 502;
    throw err;
  } finally {
    if (cdp && browser && browser.reused && browser.target) {
      // 复用已有浏览器时只关掉本次打开的标签页
      try {
        await cdp('Page.close', {});
      } catch (err) {
        /* 标签页可能已被关闭 */
      }
    }
    if (cdp) cdp.close();
    if (browser && !browser.reused) {
      try {
        await browserLogin.closeBrowser(browser);
      } catch (err) {
        /* 浏览器可能已被关闭 */
      }
    }
    browserLogin.release('kuaishou-collector');
    state.running = false;
  }
}

function getStatus() {
  return {
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastResult: state.lastResult
  };
}

module.exports = { run, getStatus };
