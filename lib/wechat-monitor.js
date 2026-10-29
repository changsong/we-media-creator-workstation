'use strict';

/**
 * 公众号数据监控模块（Cookie + 浏览器）。
 *
 * 复用「连接设置 → 公众号」一键登录保存的 Cookie，用无头浏览器打开
 * mp.weixin.qq.com 后台，读取近 7 天的用户分析、内容分析，以及「发表记录」里
 * 每条作品的实时数据，写入 reviews。
 *
 * 指标映射：
 *   - 作品快照（按排期）：阅读人数 / 点赞人数 / 分享人数 ← 「发表记录」页每条作品
 *   - 账号日汇总（@monitor）：阅读 ← 内容分析按日汇总；互动取「分享」；涨粉 ← 用户分析净增
 *   - 转化 (conversions) ← 后台无通用转化指标，暂记 0
 * 作品只采集最近 30 天发表的，避免把多年历史文章全部建成排期；已匹配到排期的作品
 * 每天一条快照，重复同步只更新当天指标。
 *
 * 配置：data/wechat-monitor.json 只使用 enabled / intervalMinutes / platform；
 * 旧版本遗留的 appid / appsecret 字段不再读取，但保留在文件中以免破坏历史数据。
 * 定时：默认每 60 分钟一次（intervalMinutes 可调），连接启用后由服务端自动开启。
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const store = require('./store');
const browserLogin = require('./browser-login');
const channelConnections = require('./channel-connections');

const CONFIG_PATH = path.join(DATA_DIR, 'wechat-monitor.json');
const PLATFORM = '公众号';
const HOME_URL = 'https://mp.weixin.qq.com/';
const USER_URL = 'https://mp.weixin.qq.com/misc/useranalysis';
const CONTENT_URL = 'https://mp.weixin.qq.com/misc/appmsganalysis';
const PUBLISH_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish';
const COOKIE_DOMAIN = 'mp.weixin.qq.com';
const DEFAULT_INTERVAL = 60; // 分钟
const TOKEN_WAIT_MS = 30000;
const PAGE_WAIT_MS = 20000;
const TREND_WAIT_MS = 25000;
const WORK_PAGE_SIZE = 20;
const WORK_MAX_PAGES = 3;
const WORK_WINDOW_DAYS = 30;

const state = {
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastStats: null,
  nextRunAt: null,
  timer: null
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------- 小工具 ---------------- */

function readJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 后台趋势接口按 UTC+8 的零点时间戳统计。 */
function dayStartTs(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000) - 8 * 3600;
}

function dayEndTs(dateStr) {
  return dayStartTs(dateStr) + 86399;
}

/** 公众号数据每日 8 点后才完整，取最近 7 个已结束的自然日（截止昨天）。 */
function recentDates() {
  const out = [];
  const today = new Date();
  for (let i = 7; i >= 1; i--) out.push(ymd(addDays(today, -i)));
  return out;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function evalJs(call, expression, timeoutMs) {
  const limit = timeoutMs || 20000;
  return call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, timeout: limit },
    limit
  ).then((res) => {
    if (res && res.exceptionDetails) {
      const detail = res.exceptionDetails;
      const text = (detail.exception && detail.exception.description) || detail.text || '页面脚本执行失败';
      throw new Error(String(text).split('\n')[0]);
    }
    return res && res.result ? res.result.value : null;
  });
}

async function safeEvalJs(call, expression, timeoutMs) {
  try {
    return await evalJs(call, expression, timeoutMs);
  } catch (err) {
    return null;
  }
}

/** Cookie 请求头 → Network.setCookie，绕开 profile 丢失登录态的情况。 */
async function applyCookies(call, header) {
  const pairs = [];
  String(header || '')
    .split(';')
    .forEach((pair) => {
      const item = pair.trim();
      const idx = item.indexOf('=');
      if (idx > 0) pairs.push([item.slice(0, idx).trim(), item.slice(idx + 1)]);
    });
  let count = 0;
  for (const [name, value] of pairs) {
    if (!name || !value) continue;
    try {
      await call('Network.setCookie', {
        name,
        value,
        domain: COOKIE_DOMAIN,
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

function pageInfoExpr() {
  return `(() => {
    const token = (() => {
      const m = location.href.match(/[?&]token=(\\d+)/);
      if (m) return m[1];
      try {
        if (window.wx && wx.commonData && wx.commonData.data && wx.commonData.data.token) {
          return String(wx.commonData.data.token);
        }
        if (window.wx && wx.commonData && wx.commonData.token) return String(wx.commonData.token);
      } catch (err) { /* 页面变量结构可能变化 */ }
      try {
        const html = document.documentElement ? document.documentElement.innerHTML.slice(0, 200000) : '';
        const hit = html.match(/[?&]token=(\\d+)/) || html.match(/["']token["']\\s*[:=]\\s*["']?(\\d{5,})/);
        return hit ? hit[1] : '';
      } catch (err) {
        return '';
      }
    })();
    return {
      url: location.href,
      title: document.title,
      text: document.body ? String(document.body.innerText || '').slice(0, 800) : '',
      token
    };
  })()`;
}

function isLoginPage(info) {
  if (!info) return false;
  if (/\/cgi-bin\/loginpage|loginpage/i.test(info.url || '')) return true;
  return /扫码登录|请使用微信扫一扫|验证码登录|登录公众平台/.test(info.text || '');
}

async function readPageInfo(call) {
  return safeEvalJs(call, pageInfoExpr(), 10000);
}

/** 打开后台首页并取得带 token 的后台地址；登录失效时抛 401。 */
async function openHome(call) {
  await call('Page.navigate', { url: HOME_URL });
  const started = Date.now();
  let last = null;
  while (Date.now() - started < TOKEN_WAIT_MS) {
    const info = await readPageInfo(call);
    if (info) {
      last = info;
      if (isLoginPage(info)) {
        throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
      }
      if (info.token) return { token: info.token, url: info.url };
    }
    await sleep(800);
  }
  const hint = last && last.url ? `（当前页面：${last.url.replace(/^https?:\/\/[^/]+/, '')}）` : '';
  throw httpError(401, '未能进入公众号后台' + hint + '，请到「连接设置」重新一键登录');
}

/* ---------------- 用户分析：新增 / 取消关注 ---------------- */

/**
 * 页面内执行：找到带「新增/取消/净增」表头的表格，按日期读取每日数据。
 * 公众号后台页面结构偶有改版，用表头文字定位列，不绑死 class。
 */
function scrapeUserRows() {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
  const num = (s) => {
    const m = norm(s).replace(/[,，]/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const dateRe = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/;
  const out = [];
  const seen = new Set();
  const tables = Array.from(document.querySelectorAll('table'));
  tables.forEach((table) => {
    const trs = Array.from(table.querySelectorAll('tr'));
    let header = null;
    let cols = null;
    for (const tr of trs) {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      const text = cells.join('|');
      if (!/新增|取消|净增|累计|累积/.test(text)) continue;
      const find = function () {
        for (let i = 0; i < arguments.length; i++) {
          const word = arguments[i];
          const idx = cells.findIndex((c) => c.indexOf(word) >= 0);
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const next = {
        date: find('日期', '时间'),
        added: find('新增'),
        canceled: find('取消'),
        net: find('净增'),
        total: find('累计', '累积', '总关注')
      };
      if (next.added < 0 && next.canceled < 0) continue;
      header = tr;
      cols = next;
      break;
    }
    if (!cols) return;
    trs.forEach((tr) => {
      if (tr === header) return;
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      let date = '';
      for (const cell of cells) {
        const m = cell.match(dateRe);
        if (m) {
          date = m[1] + '-' + (m[2].length < 2 ? '0' + m[2] : m[2]) + '-' + (m[3].length < 2 ? '0' + m[3] : m[3]);
          break;
        }
      }
      if (!date || seen.has(date)) return;
      const at = (idx) => (idx >= 0 && idx < cells.length ? num(cells[idx]) : null);
      out.push({ date, added: at(cols.added), canceled: at(cols.canceled), net: at(cols.net), total: at(cols.total) });
      seen.add(date);
    });
  });
  return out;
}

async function collectUsers(call, token, dates) {
  const url =
    USER_URL +
    '?1=1&begin_date=' + encodeURIComponent(dates[0]) +
    '&end_date=' + encodeURIComponent(dates[dates.length - 1]) +
    '&token=' + encodeURIComponent(token) +
    '&lang=zh_CN';
  await call('Page.navigate', { url });
  const started = Date.now();
  let rows = [];
  while (Date.now() - started < PAGE_WAIT_MS) {
    const info = await readPageInfo(call);
    if (isLoginPage(info)) {
      throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
    }
    rows = (await safeEvalJs(call, `(${scrapeUserRows.toString()})()`, 10000)) || [];
    if (rows.length) break;
    await sleep(1000);
  }
  return rows;
}

function toUserMap(rows, dates) {
  const wanted = new Set(dates);
  const map = {};
  rows.forEach((row) => {
    if (!row || !wanted.has(row.date)) return;
    if (map[row.date]) return;
    const added = Number(row.added) || 0;
    const canceled = Number(row.canceled) || 0;
    const net = Number.isFinite(row.net) ? Number(row.net) : added - canceled;
    map[row.date] = { added, canceled, net };
  });
  return map;
}

/* ---------------- 内容分析：每日阅读 / 分享 ---------------- */

const DATE_KEYS = ['ref_date', 'stat_date', 'date', 'day', 'publish_date', 'publishDate'];
const READ_KEYS = [
  'read_uv', 'read_pv', 'read_num', 'read_count', 'int_page_read_count',
  'read_user', 'read_times', 'reads', 'read_user_count'
];
const SHARE_KEYS = [
  'share_uv', 'share_pv', 'share_num', 'share_count', 'share_user', 'share_times', 'shares'
];
const SCENE_KEYS = ['scene', 'scene_id', 'src', 'source'];

function pickField(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null) return obj[key];
  }
  return null;
}

/** 趋势接口的 date 是 UTC+8 零点的 unix 秒；也兼容毫秒时间戳。 */
function fromUnix(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const seconds = n > 1e12 ? Math.floor(n / 1000) : n;
  if (seconds < 1e9 || seconds > 4e9) return '';
  const d = new Date(seconds * 1000 + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function normalizeDate(raw) {
  if (raw == null) return '';
  if (raw instanceof Date) return ymd(raw);
  const s = String(raw).trim();
  let m = s.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  if (/^\d{9,13}$/.test(s)) {
    const fromTs = fromUnix(s);
    if (fromTs) return fromTs;
  }
  m = s.match(/^(\d{1,2})[-/月](\d{1,2})日?$/);
  if (m) return `${new Date().getFullYear()}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  return '';
}

function toNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[,，%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 趋势接口返回结构不固定：可能是列表、嵌套对象，或 Highcharts 的 x/y 平行数组。
 * 这里递归寻找「带日期 + 阅读/分享字段」的对象，按日期聚合；scene=9999 为总量。
 */
function extractTrendRows(json) {
  const byDate = new Map();

  const absorb = (date, scene, reads, shares) => {
    if (!date || (reads == null && shares == null)) return;
    let row = byDate.get(date);
    if (!row) {
      row = { date, scenes: new Map() };
      byDate.set(date, row);
    }
    const key = Number.isFinite(scene) ? scene : -1;
    const prev = row.scenes.get(key) || { reads: 0, shares: 0 };
    row.scenes.set(key, {
      reads: prev.reads + (reads || 0),
      shares: prev.shares + (shares || 0)
    });
  };

  const visit = (node, depth) => {
    if (!node || depth > 10) return;
    if (Array.isArray(node)) {
      node.forEach((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return;
        const date = normalizeDate(pickField(item, DATE_KEYS));
        if (!date) return;
        const sceneRaw = pickField(item, SCENE_KEYS);
        const scene = sceneRaw == null ? null : Number(sceneRaw);
        absorb(date, scene, toNumber(pickField(item, READ_KEYS)), toNumber(pickField(item, SHARE_KEYS)));
      });
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node !== 'object') return;

    // Highcharts 风格：{ name: '阅读', x: [日期...], y: [数值...] }
    if (Array.isArray(node.x) && Array.isArray(node.y) && node.x.length === node.y.length) {
      const name = String(node.name || node.key || '');
      const isRead = /阅读|read/i.test(name);
      const isShare = /分享|转发|share/i.test(name);
      if (isRead || isShare) {
        node.x.forEach((x, i) => {
          const date = normalizeDate(x);
          const value = toNumber(node.y[i]);
          absorb(date, null, isRead ? value : null, isShare ? value : null);
        });
      }
    }

    Object.keys(node).forEach((key) => visit(node[key], depth + 1));
  };

  visit(json, 0);

  const out = [];
  byDate.forEach((row) => {
    let picked = row.scenes.get(9999);
    if (!picked) {
      const entries = Array.from(row.scenes.entries());
      const noScene = entries.filter(([key]) => key < 0);
      const use = noScene.length ? noScene : entries;
      picked = use.reduce(
        (acc, [, v]) => ({ reads: acc.reads + v.reads, shares: acc.shares + v.shares }),
        { reads: 0, shares: 0 }
      );
    }
    out.push({ date: row.date, reads: picked.reads, shares: picked.shares });
  });
  return out;
}

async function fetchTrend(call, token, begin, end) {
  // 接口只认 begin_timestamp / end_timestamp（UTC+8 秒级时间戳），传日期字符串会返回 ret=-2。
  const attempts = [
    {
      action: 'get_article_stat_tendency_and_source',
      begin_timestamp: dayStartTs(begin),
      end_timestamp: dayEndTs(end)
    },
    {
      action: 'get_article_stat_tendency_and_source',
      begin_timestamp: dayStartTs(begin),
      end_timestamp: dayEndTs(end),
      type: 'int'
    }
  ];
  for (const params of attempts) {
    const query = new URLSearchParams(
      Object.assign({}, params, { token, lang: 'zh_CN', f: 'json', ajax: '1', front_type: 'without_notice' })
    );
    const relative = '/misc/appmsganalysis?' + query.toString();
    const body = await safeEvalJs(
      call,
      `(async () => {
        try {
          const resp = await fetch(${JSON.stringify(relative)}, {
            credentials: 'include',
            headers: { 'X-Requested-With': 'XMLHttpRequest' }
          });
          return await resp.text();
        } catch (err) {
          return '';
        }
      })()`,
      TREND_WAIT_MS
    );
    if (!body || body.charAt(0) === '<') continue;
    let json;
    try {
      json = JSON.parse(body);
    } catch (err) {
      continue;
    }
    const rows = extractTrendRows(json);
    if (rows.length) return rows;
  }
  return null;
}

/** 页面内执行：从内容分析页的表格里兜底读取每日阅读 / 分享。 */
function scrapeContentRows() {
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, '');
  const num = (s) => {
    const m = norm(s).replace(/[,，]/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  };
  const dateRe = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/;
  const out = [];
  const seen = new Set();
  Array.from(document.querySelectorAll('table')).forEach((table) => {
    const trs = Array.from(table.querySelectorAll('tr'));
    let header = null;
    let cols = null;
    for (const tr of trs) {
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      if (!/阅读/.test(cells.join('|'))) continue;
      const find = function () {
        for (let i = 0; i < arguments.length; i++) {
          const word = arguments[i];
          const idx = cells.findIndex((c) => c.indexOf(word) >= 0);
          if (idx >= 0) return idx;
        }
        return -1;
      };
      const next = {
        date: find('日期', '时间'),
        reads: find('阅读次数', '阅读人数', '阅读'),
        shares: find('分享次数', '分享人数', '分享', '转发')
      };
      if (next.reads < 0 && next.shares < 0) continue;
      header = tr;
      cols = next;
      break;
    }
    if (!cols) return;
    trs.forEach((tr) => {
      if (tr === header) return;
      const cells = Array.from(tr.children).map((td) => norm(td.textContent));
      let date = '';
      for (const cell of cells) {
        const m = cell.match(dateRe);
        if (m) {
          date = m[1] + '-' + (m[2].length < 2 ? '0' + m[2] : m[2]) + '-' + (m[3].length < 2 ? '0' + m[3] : m[3]);
          break;
        }
      }
      if (!date || seen.has(date)) return;
      const at = (idx) => (idx >= 0 && idx < cells.length ? num(cells[idx]) : null);
      out.push({ date, reads: at(cols.reads), shares: at(cols.shares) });
      seen.add(date);
    });
  });
  return out;
}

async function collectContent(call, token, dates) {
  const begin = dates[0];
  const end = dates[dates.length - 1];
  const trend = await fetchTrend(call, token, begin, end);
  if (trend && trend.length) return { rows: trend, source: 'trend' };

  // 注意：action=all 是「单篇文章列表」（仅统计发表后 7 天），窗口内没发文就显示暂无数据；
  // 账号级日汇总在 action=report&type=daily_v2 页面。
  const url =
    CONTENT_URL +
    '?action=report&type=daily_v2&begin_date=' + encodeURIComponent(begin) +
    '&end_date=' + encodeURIComponent(end) +
    '&token=' + encodeURIComponent(token) +
    '&lang=zh_CN';
  await call('Page.navigate', { url });
  const started = Date.now();
  let rows = [];
  while (Date.now() - started < PAGE_WAIT_MS) {
    const info = await readPageInfo(call);
    if (isLoginPage(info)) {
      throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
    }
    rows = (await safeEvalJs(call, `(${scrapeContentRows.toString()})()`, 10000)) || [];
    if (rows.length) break;
    await sleep(1000);
  }
  return { rows, source: rows.length ? 'page' : 'none' };
}

function toContentMap(rows, dates) {
  const wanted = new Set(dates);
  const map = {};
  rows.forEach((row) => {
    if (!row || !wanted.has(row.date) || map[row.date]) return;
    map[row.date] = { reads: Number(row.reads) || 0, shares: Number(row.shares) || 0 };
  });
  return map;
}

/* ---------------- 发表记录：作品级阅读 / 点赞 / 分享 ---------------- */

/**
 * 页面内执行：发表记录每条作品都带标题链接、发表时间与数据行。
 * 数据行是「数值 + 悬浮标签」成对出现（阅读人数 / 点赞人数 / 分享人数 / ...），
 * 标签在页面里是隐藏的 tooltip，但仍在 DOM 中，可直接取文本。
 */
function scrapePublishedWorks() {
  const text = (el) => String((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  return Array.from(document.querySelectorAll('.publish_hover_content')).map((item) => {
    const link = Array.from(item.querySelectorAll('a[href]')).find((a) =>
      /^https?:\/\/mp\.weixin\.qq\.com\/s(\/|\?)/.test(String(a.getAttribute('href') || ''))
    );
    const metrics = {};
    Array.from(item.querySelectorAll('.weui-desktop-tooltip__wrp')).forEach((wrap) => {
      const label = text(wrap.querySelector('.weui-desktop-tooltip'));
      const value = text(
        wrap.querySelector('.weui-desktop-mass-media__data__inner') || wrap.querySelector('.weui-desktop-link')
      );
      if (label && value) metrics[label] = value;
    });
    return {
      title: link ? String(link.innerText || '').split('\n')[0].trim() : '',
      url: link ? String(link.href || link.getAttribute('href') || '') : '',
      timeText: text(item.querySelector('.weui-desktop-mass__time')),
      metrics
    };
  }).filter((item) => item.title && item.url);
}

/** 发表记录里的时间显示为「今天 10:43 / 星期X 16:04 / 2025年02月02日」，转成日期。 */
function parsePublishTime(label) {
  const s = String(label || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const now = new Date();
  const clockMatch = s.match(/(\d{1,2}):(\d{2})/);
  const clock = clockMatch ? pad(Number(clockMatch[1])) + ':' + clockMatch[2] : '';
  if (/^今天/.test(s)) return { date: ymd(now), clock };
  if (/^昨天/.test(s)) return { date: ymd(addDays(now, -1)), clock };
  if (/^前天/.test(s)) return { date: ymd(addDays(now, -2)), clock };
  const weekday = s.match(/^星期([一二三四五六日天])/);
  if (weekday) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let diff = today.getDay() - map[weekday[1]];
    if (diff <= 0) diff += 7; // 当天会显示「今天」，星期几只可能指过去
    return { date: ymd(addDays(today, -diff)), clock };
  }
  const full = s.match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
  if (full) return { date: `${full[1]}-${pad(Number(full[2]))}-${pad(Number(full[3]))}`, clock };
  const short = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (short) return { date: `${now.getFullYear()}-${pad(Number(short[1]))}-${pad(Number(short[2]))}`, clock };
  return null;
}

function dateValue(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

async function collectPublished(call, token) {
  const works = [];
  const seen = new Set();
  const cutoff = dateValue(ymd(addDays(new Date(), -WORK_WINDOW_DAYS)));
  let pages = 0;
  for (let page = 0; page < WORK_MAX_PAGES; page++) {
    const url =
      PUBLISH_URL +
      '?sub=list&begin=' + page * WORK_PAGE_SIZE +
      '&count=' + WORK_PAGE_SIZE +
      '&token=' + encodeURIComponent(token) +
      '&lang=zh_CN';
    await call('Page.navigate', { url });
    const started = Date.now();
    let items = [];
    while (Date.now() - started < PAGE_WAIT_MS) {
      const info = await readPageInfo(call);
      if (isLoginPage(info)) {
        throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
      }
      items = (await safeEvalJs(call, `(${scrapePublishedWorks.toString()})()`, 10000)) || [];
      if (items.length) break;
      await sleep(1000);
    }
    if (!items.length) break;
    pages++;
    let fresh = 0;
    items.forEach((item) => {
      const when = parsePublishTime(item.timeText);
      if (!when || dateValue(when.date) < cutoff) return;
      const key = item.url + '|' + item.title;
      if (seen.has(key)) return;
      seen.add(key);
      fresh++;
      works.push(Object.assign({}, item, when));
    });
    // 整页都早于采集窗口时，后面的页只会更早
    if (!fresh) break;
  }
  return { works, pages };
}

function saveWorks(works, statDate) {
  let schedulesCreated = 0;
  let schedulesMatched = 0;
  let snapshotsCreated = 0;
  let snapshotsUpdated = 0;
  let totalReads = 0;
  let totalLikes = 0;

  works.forEach((item) => {
    const pick = (label) => toNumber(item.metrics[label]) || 0;
    const reads = pick('阅读人数');
    const likes = pick('点赞人数');
    const share = pick('分享人数');
    const recommend = pick('推荐人数');
    const comment = pick('留言条数');
    const shortId = (item.url.match(/\/s\/([A-Za-z0-9_-]+)/) || [])[1] || '';
    const title = String(item.title || '').slice(0, 80);

    let schedule = store.findScheduleByNote(PLATFORM, shortId, title);
    if (schedule) {
      schedulesMatched++;
    } else {
      schedule = store.create('calendar', {
        标题: title,
        平台: PLATFORM,
        计划发布时间: item.date + 'T' + (item.clock || '00:00'),
        当前阶段: '已发布',
        内容形式: '图文',
        发布链接: item.url,
        备注: '公众号发表记录自动同步'
      });
      schedulesCreated++;
    }

    const snap = store.upsertNoteSnapshot(schedule['排期ID'], PLATFORM, statDate, {
      reads,
      likes,
      followers: 0,
      conversions: 0,
      note:
        '公众号自动同步 · 点赞 ' + likes +
        ' · 分享 ' + share +
        ' · 留言 ' + comment +
        (recommend ? ' · 推荐 ' + recommend : '')
    });
    if (snap.updated) snapshotsUpdated++;
    else snapshotsCreated++;
    totalReads += reads;
    totalLikes += likes;
  });

  return { schedulesCreated, schedulesMatched, snapshotsCreated, snapshotsUpdated, totalReads, totalLikes };
}

/* ---------------- 主流程 ---------------- */

async function runOnce() {
  if (state.running) throw httpError(409, '公众号数据同步正在进行，请稍候');
  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') {
    throw httpError(409, '公众号登录窗口正在进行，请完成登录后再同步');
  }

  const raw = channelConnections.getRaw(PLATFORM);
  const cookie = raw && raw.enabled ? String((raw.fields && raw.fields['Cookie']) || '').trim() : '';
  if (!cookie) throw httpError(400, '请先在「连接设置」完成公众号一键登录');

  state.running = true;
  state.lastRunAt = new Date().toISOString();
  state.lastError = null;
  browserLogin.acquire('wechat-monitor');

  let browser = null;
  let cdp = null;
  try {
    browser = await browserLogin.ensureBrowser({ url: HOME_URL, headless: true });
    const targets = await browserLogin.httpJson(browser.port, '/json/list');
    const page =
      (browser.target && browser.target.webSocketDebuggerUrl ? browser.target : null) ||
      targets.find((t) => t.type === 'page' && /mp\.weixin\.qq\.com/.test(t.url || '')) ||
      targets.find((t) => t.type === 'page');
    if (!page || !page.webSocketDebuggerUrl) {
      throw new Error('未找到可用的浏览器标签页，请重试');
    }

    cdp = await browserLogin.cdpConnect(page.webSocketDebuggerUrl);
    await cdp('Page.enable', {});
    await cdp('Runtime.enable', {});

    await applyCookies(cdp, cookie);
    const home = await openHome(cdp);

    const dates = recentDates();
    const warnings = [];

    const userRows = await collectUsers(cdp, home.token, dates);
    if (!userRows.length) {
      warnings.push('未读取到用户分析数据（页面结构可能已改版），涨粉保留上次快照');
    }
    const userMap = toUserMap(userRows, dates);

    const content = await collectContent(cdp, home.token, dates);
    if (!content.rows.length) {
      warnings.push('未读取到内容分析数据，账号级阅读 / 互动保留上次快照');
    }
    const contentMap = toContentMap(content.rows, dates);

    let published = { works: [], pages: 0 };
    try {
      published = await collectPublished(cdp, home.token);
    } catch (err) {
      if (err && err.status === 401) throw err;
      warnings.push('未读取到发表记录作品数据：' + (err && err.message ? err.message : '页面结构可能已改版'));
    }
    if (!published.works.length && !warnings.some((w) => w.indexOf('发表记录') >= 0)) {
      warnings.push('发表记录里没有近 ' + WORK_WINDOW_DAYS + ' 天的新作品，作品级指标保留上次快照');
    }
    const workSummary = saveWorks(published.works, ymd(new Date()));

    const results = dates.map((date) => {
      const prev = store.getMonitor(PLATFORM, date) || {};
      const user = userMap[date];
      const contentRow = contentMap[date];
      const reads = contentRow ? contentRow.reads : Number(prev.reads) || 0;
      const likes = contentRow ? contentRow.shares : Number(prev.likes) || 0;
      const followers = user ? user.net : Number(prev.followers) || 0;
      const saved = store.upsertMonitor(date, {
        platform: PLATFORM,
        reads,
        likes,
        followers,
        conversions: 0
      });
      return { date, reads, likes, followers, code: saved.code, updated: saved.updated };
    });

    const lastStats = {
      window: { begin: dates[0], end: dates[dates.length - 1] },
      platform: PLATFORM,
      rows: results.length,
      totalReads: results.reduce((sum, row) => sum + row.reads, 0),
      totalFollowers: results.reduce((sum, row) => sum + row.followers, 0),
      works: published.works.length,
      worksPages: published.pages,
      worksReads: workSummary.totalReads,
      worksLikes: workSummary.totalLikes,
      schedulesCreated: workSummary.schedulesCreated,
      schedulesMatched: workSummary.schedulesMatched,
      snapshotsCreated: workSummary.snapshotsCreated,
      snapshotsUpdated: workSummary.snapshotsUpdated,
      sources: {
        users: userRows.length ? 'page' : 'none',
        content: content.source,
        works: published.works.length ? 'publish' : 'none'
      },
      warnings
    };
    state.lastSuccessAt = new Date().toISOString();
    state.lastStats = lastStats;
    return { ok: true, ...lastStats, results };
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
    browserLogin.release('wechat-monitor');
    state.running = false;
  }
}

/* ---------------- 配置与定时任务 ---------------- */

function loadConfig() {
  const file = readJson(CONFIG_PATH, {});
  return {
    platform: process.env.WX_PLATFORM || file.platform || PLATFORM,
    enabled: file.enabled === true,
    intervalMinutes: Number(file.intervalMinutes) || DEFAULT_INTERVAL
  };
}

/** 只更新控制字段；旧版本遗留的 appid / appsecret 原样保留但不再使用。 */
function saveConfig(input) {
  const cur = readJson(CONFIG_PATH, {});
  const next = Object.assign({}, cur, {
    platform: input.platform ? String(input.platform).trim() : cur.platform || PLATFORM,
    enabled: input.enabled === true || input.enabled === 'true',
    intervalMinutes: Number(input.intervalMinutes) || cur.intervalMinutes || DEFAULT_INTERVAL
  });
  writeJson(CONFIG_PATH, next);
  return next;
}

function scheduleNext(intervalMs) {
  state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  state.timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      /* 错误已写入 state.lastError */
    }
    scheduleNext(intervalMs);
  }, intervalMs);
}

function startScheduler() {
  stopScheduler();
  const cfg = loadConfig();
  const raw = channelConnections.getRaw(PLATFORM);
  const connected = !!raw && raw.enabled && !!String((raw.fields && raw.fields['Cookie']) || '').trim();
  if (!cfg.enabled || !connected) return false;
  const intervalMs = Math.max(5, cfg.intervalMinutes) * 60 * 1000;
  // 启动后稍候先跑一次，立即拿到数据
  state.nextRunAt = new Date(Date.now() + 5000).toISOString();
  state.timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      /* 错误已写入 state.lastError */
    }
    scheduleNext(intervalMs);
  }, 5000);
  return true;
}

function stopScheduler() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.nextRunAt = null;
}

function getStatus() {
  const cfg = loadConfig();
  const raw = channelConnections.getRaw(PLATFORM);
  const hasCookie = !!raw && raw.enabled && !!String((raw.fields && raw.fields['Cookie']) || '').trim();
  return {
    enabled: cfg.enabled,
    platform: cfg.platform,
    intervalMinutes: cfg.intervalMinutes,
    configured: hasCookie,
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastStats: state.lastStats,
    nextRunAt: state.nextRunAt
  };
}

module.exports = {
  loadConfig,
  saveConfig,
  runOnce,
  startScheduler,
  stopScheduler,
  getStatus
};
