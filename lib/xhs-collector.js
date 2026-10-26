'use strict';

/**
 * 小红书笔记数据采集器。
 *
 * 小红书创作者数据接口有签名网关，仅凭 Cookie 直接发 HTTP 会返回 406，
 * 因此这里复用「一键登录」的专用浏览器 profile，无头打开数据页，
 * 通过 CDP 捕获页面自己发出的 note/analyze/list 请求，再落库：
 *   - 内容日历：按笔记 ID / 标题匹配，匹配不到则自动建档（阶段=已发布）
 *   - 数据复盘：同一排期每天一条快照，已存在则更新指标
 *
 * 采集期间与登录窗口互斥，避免两个任务争用同一个 profile。
 */

const store = require('./store');
const browserLogin = require('./browser-login');
const channelConnections = require('./channel-connections');

const DASHBOARD_URL = 'https://creator.xiaohongshu.com/statistics/data-analysis';
const NOTE_API = '/api/galaxy/creator/datacenter/note/analyze/list';
const NOTE_PAGE_URL = 'https://www.xiaohongshu.com/explore/';
const PLATFORM = '小红书';
const WAIT_RESPONSE_MS = 30000;
const WAIT_PAGE_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const state = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null
};

/* ---------------- 小工具 ---------------- */

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

function urlParam(url, name) {
  try {
    return Number(new URL(url).searchParams.get(name)) || 0;
  } catch (err) {
    return 0;
  }
}

function parsePayload(json) {
  const data = json && json.data;
  if (!data || !Array.isArray(data.note_infos)) return null;
  return { notes: data.note_infos, total: Number(data.total) || data.note_infos.length };
}

/* ---------------- 主流程 ---------------- */

async function run() {
  if (state.running) {
    const err = new Error('小红书数据同步正在进行，请稍候');
    err.status = 409;
    throw err;
  }
  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') {
    const err = new Error('小红书登录窗口正在进行，请完成登录后再同步');
    err.status = 409;
    throw err;
  }
  const connection = channelConnections.get(PLATFORM);
  if (!connection || !connection.enabled) {
    const err = new Error('请先在「连接设置」完成小红书一键登录');
    err.status = 400;
    throw err;
  }

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;
  browserLogin.acquire('xiaohongshu-collector');

  let browser = null;
  let cdp = null;
  try {
    browser = await browserLogin.ensureBrowser({ url: DASHBOARD_URL, headless: true });
    const result = await collectWithPage(browser, (client) => {
      cdp = client;
    });
    state.lastSuccessAt = new Date().toISOString();
    state.lastResult = result;
    return result;
  } catch (err) {
    state.lastError = err && err.message ? err.message : '采集失败';
    if (err && !err.status) err.status = 502;
    throw err;
  } finally {
    if (cdp && browser && browser.reused && browser.target) {
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
    browserLogin.release('xiaohongshu-collector');
    state.running = false;
  }
}

async function collectWithPage(browser, onCdpReady) {
  const targets = await browserLogin.httpJson(browser.port, '/json/list');
  const page =
    (browser.target && browser.target.webSocketDebuggerUrl ? browser.target : null) ||
    targets.find((t) => t.type === 'page' && /creator\.xiaohongshu\.com/.test(t.url || '')) ||
    targets.find((t) => t.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error('未找到可用的浏览器标签页，请重试');
  }

  const noteResponses = [];
  const pending = new Map();
  const consumed = new Set();
  let call = null;

  const onEvent = (msg) => {
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url || '';
      if (url.indexOf(NOTE_API) >= 0) pending.set(msg.params.requestId, url);
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
        if (parsePayload(json)) noteResponses.push({ url, json });
      })
      .catch(() => {
        /* 响应体取不到时忽略，交给超时逻辑 */
      });
  };

  const ws = page.webSocketDebuggerUrl;
  call = await browserLogin.cdpConnect(ws, onEvent);
  onCdpReady(call);

  const waitForResponse = async (predicate, timeoutMs) => {
    const start = Date.now();
    for (;;) {
      for (let i = 0; i < noteResponses.length; i++) {
        if (consumed.has(i)) continue;
        if (predicate(noteResponses[i])) {
          consumed.add(i);
          return noteResponses[i];
        }
      }
      if (Date.now() - start > timeoutMs) return null;
      await sleep(200);
    }
  };

  await call('Network.enable', {});
  await call('Page.enable', {});
  await call('Runtime.enable', {});
  await call('Page.navigate', { url: DASHBOARD_URL });

  const first = await waitForResponse((item) => !!parsePayload(item.json), WAIT_RESPONSE_MS);
  if (!first) {
    throw await loginOrTimeoutError(call);
  }

  const warnings = [];
  const notes = [];
  const seen = new Set();
  const absorb = (payload) => {
    parsePayload(payload.json).notes.forEach((note) => {
      if (!note || !note.id || seen.has(note.id)) return;
      seen.add(note.id);
      notes.push(note);
    });
  };

  let firstPayload = parsePayload(first.json);
  let pageSize = urlParam(first.url, 'page_size') || 10;
  let total = firstPayload.total;
  absorb(first);
  let pagesFetched = 1;

  // 笔记较多时先尝试把「10 条/页」切成「50 条/页」，减少翻页次数
  if (total > pageSize) {
    const upgraded = await setPageSize(50, call, waitForResponse);
    if (upgraded) {
      pageSize = 50;
      const upPayload = parsePayload(upgraded.json);
      total = upPayload.total || total;
      notes.length = 0;
      seen.clear();
      absorb(upgraded);
      pagesFetched = 1;
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  for (let p = 2; p <= pageCount; p++) {
    const clicked = await clickPage(p, call);
    if (!clicked) {
      warnings.push(`第 ${p} 页翻页失败，已同步 ${notes.length}/${total} 篇`);
      break;
    }
    const payload = await waitForResponse((item) => urlParam(item.url, 'page_num') === p, WAIT_PAGE_MS);
    if (!payload) {
      warnings.push(`第 ${p} 页加载超时，已同步 ${notes.length}/${total} 篇`);
      break;
    }
    absorb(payload);
    pagesFetched++;
  }

  const summary = saveNotes(notes);
  return {
    ok: true,
    platform: PLATFORM,
    total,
    fetched: notes.length,
    pages: pagesFetched,
    pageSize,
    statDate: today(),
    ...summary,
    warnings,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title || '',
      reads: Number(n.read_count) || 0,
      likes: Number(n.like_count) || 0,
      followers: Number(n.increase_fans_count) || 0
    }))
  };
}

async function loginOrTimeoutError(call) {
  let info = null;
  try {
    const res = await call('Runtime.evaluate', {
      expression:
        '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})',
      returnByValue: true
    });
    info = res && res.result ? res.result.value : null;
  } catch (err) {
    /* 页面可能已关闭 */
  }
  if (info && (/\/login/.test(info.url || '') || /扫码登录|验证码登录|登录小红书/.test(info.text || ''))) {
    const err = new Error('小红书登录态已失效，请到「连接设置」重新一键登录');
    err.status = 401;
    return err;
  }
  return new Error('未捕获到小红书笔记数据接口，请稍后重试（若浏览器窗口中被要求登录，请重新一键登录）');
}

async function evalJs(call, expression) {
  try {
    const res = await call('Runtime.evaluate', { expression, returnByValue: true });
    return res && res.result ? res.result.value : null;
  } catch (err) {
    return null;
  }
}

async function setPageSize(size, call, waitForResponse) {
  const opened = await evalJs(
    call,
    `(() => {
      const w = document.querySelector('.pagination .d-select-wrapper') || document.querySelector('.d-select-wrapper');
      if (!w) return false;
      w.click();
      return true;
    })()`
  );
  if (!opened) return null;
  await sleep(600);
  const clicked = await evalJs(
    call,
    `(() => {
      const label = ${JSON.stringify(size + ' 条/页')};
      const hit = Array.prototype.slice.call(document.querySelectorAll('*'))
        .filter((el) => el.children.length === 0 && (el.textContent || '').trim() === label);
      if (!hit.length) return false;
      hit[hit.length - 1].click();
      return true;
    })()`
  );
  if (!clicked) return null;
  return waitForResponse((item) => urlParam(item.url, 'page_size') === size && urlParam(item.url, 'page_num') === 1, WAIT_PAGE_MS);
}

async function clickPage(pageNum, call) {
  return evalJs(
    call,
    `(() => {
      const root = document.querySelector('.pagination') || document.querySelector('.d-pagination');
      if (!root) return false;
      const hit = Array.prototype.slice.call(root.querySelectorAll('*'))
        .filter((el) => el.children.length === 0 && (el.textContent || '').trim() === '${pageNum}');
      if (!hit.length) return false;
      hit[0].click();
      return true;
    })()`
  );
}

function saveNotes(notes) {
  const statDate = today();
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;

  notes.forEach((note) => {
    if (!note || !note.id) return;
    const title = String(note.title || '（无标题笔记）').trim().slice(0, 80);
    let schedule = store.findScheduleByNote(PLATFORM, note.id, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: localMinute(note.post_time),
        当前阶段: '已发布',
        内容形式: Number(note.type) === 2 ? '短视频' : '图文',
        发布链接: NOTE_PAGE_URL + note.id,
        备注: '小红书笔记自动同步（ID: ' + note.id + '）'
      });
      schedulesCreated++;
    }

    const comments = Number(note.comment_count) || 0;
    const favorites = Number(note.fav_count) || 0;
    const shares = Number(note.share_count) || 0;
    const followers = Number(note.increase_fans_count) || 0;
    const snap = store.upsertNoteSnapshot(schedule['排期ID'], PLATFORM, statDate, {
      reads: Number(note.read_count) || 0,
      likes: Number(note.like_count) || 0,
      followers,
      conversions: 0,
      note: `小红书自动同步 · 评论 ${comments} · 收藏 ${favorites} · 分享 ${shares} · 涨粉 ${followers} · 笔记 ID ${note.id}`
    });
    if (snap.updated) snapshotsUpdated++;
    else snapshotsCreated++;
  });

  return { schedulesCreated, schedulesMatched, snapshotsCreated, snapshotsUpdated };
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
