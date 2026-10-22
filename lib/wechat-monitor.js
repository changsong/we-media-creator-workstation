'use strict';

/**
 * 公众号数据监控模块（零依赖，使用 Node 内置 fetch）。
 *
 * 通过微信【官方数据分析接口】拉取近 7 天账号级日聚合数据，写入 reviews 表，
 * 让首页「全网表现走势」自动变成真实数据。
 *
 * 指标映射：
 *   - 阅读播放 (reads)      ← getarticlesummary 的 int_page_read_count（阅读次数）按日汇总
 *   - 点赞/互动 (likes)     ← 微信自 2018 起不再返回「点赞」数据，这里用「分享人数 + 收藏人数」作互动代理
 *   - 涨粉 (followers)      ← getusersummary 的 (new_user - cancel_user) 净增，允许为负
 *   - 转化 (conversions)    ← 官方接口无通用转化指标，暂记 0
 *
 * 配置：优先读环境变量 WX_APPID / WX_APPSECRET / WX_PLATFORM，否则读 data/wechat-monitor.json。
 * 定时：默认每 60 分钟一次（config.intervalMinutes 可调）。
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const store = require('./store');

const CONFIG_PATH = path.join(DATA_DIR, 'wechat-monitor.json');
const TOKEN_PATH = path.join(DATA_DIR, 'wechat-token.json');
const API_BASE = 'https://api.weixin.qq.com';
const DEFAULT_INTERVAL = 60; // 分钟

const state = {
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastStats: null,
  nextRunAt: null,
  timer: null
};

class WxError extends Error {
  constructor(code, msg) {
    super(`微信接口错误 ${code}: ${msg}`);
    this.code = code;
    this.wx = true;
  }
}

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

function ymd(d) {
  const z = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ---------------- 配置 ---------------- */

function loadConfig() {
  const file = readJson(CONFIG_PATH, {});
  return {
    appid: process.env.WX_APPID || file.appid || '',
    appsecret: process.env.WX_APPSECRET || file.appsecret || '',
    platform: process.env.WX_PLATFORM || file.platform || '公众号',
    enabled: file.enabled === true,
    intervalMinutes: Number(file.intervalMinutes) || DEFAULT_INTERVAL
  };
}

function saveConfig(input) {
  const cur = readJson(CONFIG_PATH, {});
  const next = {
    appid: input.appid != null ? String(input.appid).trim() : (cur.appid || ''),
    appsecret: input.appsecret != null ? String(input.appsecret).trim() : (cur.appsecret || ''),
    platform: input.platform ? String(input.platform).trim() : (cur.platform || '公众号'),
    enabled: input.enabled === true || input.enabled === 'true',
    intervalMinutes: Number(input.intervalMinutes) || cur.intervalMinutes || DEFAULT_INTERVAL
  };
  writeJson(CONFIG_PATH, next);
  return next;
}

/* ---------------- 凭证与接口 ---------------- */

async function getAccessToken(force) {
  const cfg = loadConfig();
  if (!cfg.appid || !cfg.appsecret) {
    throw new Error('未配置 appid / appsecret：请调用 POST /api/monitor/wechat/config 提交，或设置环境变量 WX_APPID、WX_APPSECRET');
  }
  const cached = readJson(TOKEN_PATH, null);
  const now = Date.now();
  if (!force && cached && cached.access_token && cached.expires_at && cached.expires_at - 300000 > now) {
    return cached.access_token;
  }
  const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
    cfg.appid
  )}&secret=${encodeURIComponent(cfg.appsecret)}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.errcode) throw new WxError(json.errcode, json.errmsg || '获取 access_token 失败');
  const token = json.access_token;
  const expiresIn = Number(json.expires_in) || 7200;
  writeJson(TOKEN_PATH, { access_token: token, expires_at: now + expiresIn * 1000 });
  return token;
}

/**
 * 在连接设置里实测一对 appid/appsecret 是否可用：直接换 access_token，
 * 成功即说明凭证有效，但不落盘、不写监控配置；失败则回传微信错误码。
 */
async function testCredentials(appid, appsecret) {
  if (!appid || !appsecret) {
    return { ok: false, message: '请先填写 App ID 与 App Secret' };
  }
  const url = `${API_BASE}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(
    appid
  )}&secret=${encodeURIComponent(appsecret)}`;
  try {
    const resp = await fetch(url);
    const json = await resp.json();
    if (json.errcode) {
      return { ok: false, code: json.errcode, message: `微信返回 ${json.errcode}: ${json.errmsg || '凭证无效'}` };
    }
    return { ok: true, message: '凭证有效，access_token 获取成功' };
  } catch (err) {
    return { ok: false, message: '网络异常，无法连通微信接口：' + err.message };
  }
}

async function callCube(endpoint, begin, end, token) {
  const url = `${API_BASE}/datacube/${endpoint}?access_token=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ begin_date: begin, end_date: end })
  });
  const json = await resp.json();
  if (json.errcode) throw new WxError(json.errcode, json.errmsg || endpoint);
  return json.list || [];
}

async function callCubeWithRetry(endpoint, begin, end) {
  let token = await getAccessToken(false);
  try {
    return await callCube(endpoint, begin, end, token);
  } catch (err) {
    if (err.wx && (err.code === 40001 || err.code === 42001)) {
      token = await getAccessToken(true);
      return await callCube(endpoint, begin, end, token);
    }
    throw err;
  }
}

/* ---------------- 主流程 ---------------- */

async function runOnce() {
  const started = new Date();
  state.lastRunAt = started.toISOString();
  state.lastError = null;
  try {
    const cfg = loadConfig();
    if (!cfg.appid || !cfg.appsecret) throw new Error('未配置 appid / appsecret');

    const today = new Date();
    const todayStr = ymd(today);
    const dates = [];
    for (let i = 6; i >= 0; i--) dates.push(ymd(addDays(today, -i)));
    const begin = dates[0];
    const end = dates[dates.length - 1]; // 含今天

    // getarticlesummary 单次最多查 1 天，且 end_date 最晚为昨日：逐日拉取
    const articleList = [];
    for (const d of dates) {
      if (d >= todayStr) continue;
      articleList.push(...(await callCubeWithRetry('getarticlesummary', d, d)));
    }

    const userList = await callCubeWithRetry('getusersummary', begin, end);

    const byDate = {};
    dates.forEach((d) => {
      byDate[d] = { reads: 0, likes: 0, followers: 0 };
    });

    articleList.forEach((it) => {
      const d = it.ref_date;
      if (!byDate[d]) byDate[d] = { reads: 0, likes: 0, followers: 0 };
      byDate[d].reads += Number(it.int_page_read_count) || 0;
      // 互动代理：分享人数 + 收藏人数（微信接口已下线「点赞」字段）
      byDate[d].likes += (Number(it.share_user) || 0) + (Number(it.add_to_fav_user) || 0);
    });

    userList.forEach((it) => {
      const d = it.ref_date;
      if (!byDate[d]) byDate[d] = { reads: 0, likes: 0, followers: 0 };
      byDate[d].followers += (Number(it.new_user) || 0) - (Number(it.cancel_user) || 0);
    });

    const platform = cfg.platform || '公众号';
    const results = dates.map((d) => {
      const m = byDate[d];
      const r = store.upsertMonitor(d, {
        platform,
        reads: m.reads,
        likes: m.likes,
        followers: m.followers,
        conversions: 0
      });
      return { date: d, reads: m.reads, likes: m.likes, followers: m.followers, code: r.code, updated: r.updated };
    });

    const lastStats = {
      window: { begin, end },
      platform,
      rows: results.length,
      totalReads: results.reduce((a, x) => a + x.reads, 0),
      totalFollowers: results.reduce((a, x) => a + x.followers, 0)
    };
    state.lastSuccessAt = new Date().toISOString();
    state.lastStats = lastStats;
    return { ok: true, ...lastStats, results };
  } catch (err) {
    state.lastError = err.message;
    throw err;
  }
}

/* ---------------- 定时任务 ---------------- */

function scheduleNext(intervalMs) {
  state.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  state.timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      // 错误已写入 state.lastError
    }
    scheduleNext(intervalMs);
  }, intervalMs);
}

function startScheduler() {
  stopScheduler();
  const cfg = loadConfig();
  if (!cfg.enabled) return false;
  const intervalMs = Math.max(5, cfg.intervalMinutes) * 60 * 1000;
  // 启动后稍候先跑一次，立即拿到数据
  state.nextRunAt = new Date(Date.now() + 5000).toISOString();
  state.timer = setTimeout(async () => {
    try {
      await runOnce();
    } catch (err) {
      // 错误已写入 state.lastError
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

/* ---------------- 状态 ---------------- */

function getStatus() {
  const cfg = loadConfig();
  let maskedAppid = '';
  if (cfg.appid) {
    maskedAppid = cfg.appid.length > 6 ? `${cfg.appid.slice(0, 4)}****${cfg.appid.slice(-2)}` : '****';
  }
  return {
    enabled: cfg.enabled,
    platform: cfg.platform,
    intervalMinutes: cfg.intervalMinutes,
    appid: maskedAppid,
    configured: !!(cfg.appid && cfg.appsecret),
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
  getAccessToken,
  testCredentials,
  runOnce,
  startScheduler,
  stopScheduler,
  getStatus
};
