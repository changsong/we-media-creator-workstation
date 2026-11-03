'use strict';

/**
 * 爆款灵感搜索。
 *
 * 用户输入若干关键词 → 串行抓取各平台搜索结果 → 按平台内互动分位算热度 →
 * 落库缓存（同一关键词 1 小时内复用）→ 前端一键转选题。
 *
 * 串行执行一方面是为了共用同一个浏览器 profile，另一方面也避免短时间
 * 高频请求触发平台访问限制。
 */

const crypto = require('crypto');
const db = require('../db');
const channelConnections = require('../channel-connections');
const proxyConfig = require('../proxy-config');
const browser = require('./browser');
const { normalizeKeywords, heatScores } = require('./util');

const mockAdapter = require('./adapters/mock');
const adapters = {
  小红书: require('./adapters/xiaohongshu'),
  抖音: require('./adapters/douyin'),
  B站: require('./adapters/bilibili')
};

const PLATFORMS = ['小红书', '抖音', 'B站'];
const CACHE_TTL_MS = 60 * 60 * 1000;
const KEEP_DAYS = 30;
const MAX_ITEMS = 20;
// 首页预热 + 站内搜索比直连搜索页多一步，留足余量
const TASK_TIMEOUT_MS = 60000;
// 每次风险重试前后的退避：比常规间隔更长，给平台一点冷却时间
const RISK_BACKOFF_MIN_MS = 6000;
const RISK_BACKOFF_MAX_MS = 12000;
const MAX_ATTEMPTS = 2;
const RISK_COOLDOWN_MS = 4 * 60 * 1000;

let current = null;
// 平台级访问限制冷却：命中后同一平台短时间内不再请求，避免连续请求加重限制
const cooldowns = new Map(); // platform -> until(ms)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = () => crypto.randomUUID();

function mockMode() {
  return process.env.WB_TRENDS_MOCK === '1';
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function jitter(taskMock, boost) {
  if (taskMock) return 30;
  if (boost) {
    return RISK_BACKOFF_MIN_MS + Math.floor(Math.random() * (RISK_BACKOFF_MAX_MS - RISK_BACKOFF_MIN_MS));
  }
  return 2000 + Math.floor(Math.random() * 3000);
}

/** 平台是否处于访问限制冷却期，返回剩余毫秒（0 表示不在冷却） */
function cooldownRemain(platform) {
  const until = cooldowns.get(platform) || 0;
  if (until <= Date.now()) {
    if (until) cooldowns.delete(platform);
    return 0;
  }
  return until - Date.now();
}

function setCooldown(platform, ms) {
  cooldowns.set(platform, Date.now() + ms);
}

function proxyStatus() {
  try {
    const pub = proxyConfig.getPublic();
    const info = {
      enabled: !!pub.enabled,
      configured: !!pub.configured,
      host: pub.host,
      port: pub.port,
      envOverride: !!pub.envOverride
    };
    if (pub.enabled && !pub.configured) {
      info.hint = '网络代理已启用但配置不完整，雷达搜索无法启动，请到「连接设置 · 网络代理」补全';
    }
    return info;
  } catch (err) {
    return null;
  }
}

function platformStatuses() {
  const mock = mockMode();
  const proxy = proxyStatus();
  return PLATFORMS.map((p) => {
    const adapter = adapters[p];
    const conn = channelConnections.get(p);
    const connected = !!(conn && conn.enabled);
    const loginRequired = !!adapter.requiresLogin;
    const ready = mock || !loginRequired || connected;
    const remain = cooldownRemain(p);
    return {
      platform: p,
      loginRequired,
      connected: mock ? true : connected,
      ready,
      mock,
      cooldownMs: remain,
      cooldownUntil: remain ? new Date(Date.now() + remain).toISOString() : null,
      proxy,
      hint: mock
        ? '演示模式：使用模拟数据'
        : loginRequired && !connected
          ? '请先在「连接设置」完成' + p + '登录'
          : ''
    };
  });
}

function snapshot(job) {
  if (!job) return { status: 'idle', tasks: [], progress: { done: 0, total: 0 } };
  const tasks = job.tasks.map((t) => ({
    keyword: t.keyword,
    platform: t.platform,
    status: t.status,
    cached: !!t.cached,
    risk: !!t.risk,
    count: t.items.length,
    error: t.error || '',
    fetchedAt: t.fetchedAt || null,
    items: t.status === 'done' ? t.items : []
  }));
  const settled = job.tasks.filter((t) => t.status === 'done' || t.status === 'error').length;
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error || '',
    keywords: job.keywords.slice(),
    platforms: job.platforms.slice(),
    progress: { done: settled, total: job.tasks.length },
    tasks
  };
}

function prepareItems(task, raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .filter((it) => it && it.workId && it.title)
    .slice(0, MAX_ITEMS);
  const heats = heatScores(list, Date.now());
  const fetchedAt = new Date().toISOString();
  return list.map((it, i) => ({
    id: uid(),
    platform: task.platform,
    workId: String(it.workId),
    title: String(it.title).slice(0, 120),
    author: String(it.author || '').slice(0, 60),
    coverUrl: it.coverUrl || '',
    itemUrl: it.itemUrl || '',
    itemType: it.itemType === 'video' ? 'video' : 'note',
    likes: Math.max(0, Number(it.likes) || 0),
    comments: Math.max(0, Number(it.comments) || 0),
    shares: Math.max(0, Number(it.shares) || 0),
    collects: Math.max(0, Number(it.collects) || 0),
    reads: Math.max(0, Number(it.reads) || 0),
    publishedAt: it.publishedAt || '',
    heat: heats[i],
    mock: !!task.mock,
    fetchedAt
  }));
}

function rowToItem(row) {
  return {
    id: row.id,
    platform: row.platform,
    workId: row.work_id,
    title: row.title,
    author: row.author || '',
    coverUrl: row.cover_url || '',
    itemUrl: row.item_url || '',
    itemType: row.item_type,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    collects: row.collects,
    reads: row.reads,
    publishedAt: row.published_at || '',
    heat: row.heat,
    mock: !!row.mock,
    fetchedAt: row.fetched_at
  };
}

/**
 * 把任务元数据落库：只存关键词和每条任务的条目 ID，条目本体仍在 trend_items，
 * 避免同一条结果在两张表里重复存储。
 */
function saveJob(job) {
  const tasks = job.tasks.map((t) => ({
    keyword: t.keyword,
    platform: t.platform,
    status: t.status,
    cached: !!t.cached,
    error: t.error || '',
    fetchedAt: t.fetchedAt || null,
    itemIds: (t.items || []).map((it) => it.id)
  }));
  const now = new Date().toISOString();
  db.open()
    .prepare(
      `INSERT INTO trend_jobs
        (id, keywords, platforms, mock, status, error, tasks_json, started_at, finished_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         error = excluded.error,
         tasks_json = excluded.tasks_json,
         finished_at = excluded.finished_at`
    )
    .run(
      job.id,
      JSON.stringify(job.keywords),
      JSON.stringify(job.platforms),
      job.tasks[0] && job.tasks[0].mock ? 1 : 0,
      job.status,
      job.error || '',
      JSON.stringify(tasks),
      job.startedAt,
      job.finishedAt || null,
      now
    );
}

function readCache(keyword, platform, mock) {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const rows = db
    .open()
    .prepare(
      `SELECT * FROM trend_items
        WHERE keyword = ? AND platform = ? AND mock = ? AND fetched_at >= ?
        ORDER BY heat DESC, likes DESC`
    )
    .all(keyword, platform, mock ? 1 : 0, cutoff);
  return rows.map(rowToItem);
}

function writeCache(keyword, platform, items, mock) {
  if (!items.length) return;
  const now = new Date().toISOString();
  db.transaction((conn) => {
    conn.prepare('DELETE FROM trend_items WHERE keyword = ? AND platform = ?').run(keyword, platform);
    const insert = conn.prepare(
      `INSERT INTO trend_items
        (id, keyword, platform, work_id, title, author, cover_url, item_url, item_type,
         likes, comments, shares, collects, reads, published_at, heat, raw_json, mock, fetched_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    items.forEach((it) => {
      insert.run(
        it.id || uid(),
        keyword,
        platform,
        it.workId,
        it.title,
        it.author,
        it.coverUrl,
        it.itemUrl,
        it.itemType,
        it.likes,
        it.comments,
        it.shares,
        it.collects,
        it.reads,
        it.publishedAt,
        it.heat,
        null,
        mock ? 1 : 0,
        now,
        now
      );
    });
  });
}

function cleanup() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  try {
    const conn = db.open();
    conn.prepare('DELETE FROM trend_items WHERE fetched_at < ?').run(cutoff);
    conn.prepare('DELETE FROM trend_jobs WHERE COALESCE(finished_at, started_at) < ?').run(cutoff);
  } catch (err) {
    /* 清理失败不影响本次搜索 */
  }
}

function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 风险重试前：仅当用户开启自动轮换且使用粘性会话时换出口并重开浏览器 */
async function maybeRotate(session) {
  let pub;
  try {
    pub = proxyConfig.getPublic();
  } catch (err) {
    return;
  }
  if (!pub.enabled || !pub.autoRotate || !pub.sticky) return;
  try {
    proxyConfig.rotateSession();
    const fresh = await browser.restart();
    if (session) session.browser = fresh.browser;
  } catch (err) {
    /* 换 IP 失败不阻断重试，沿用当前出口再试一次 */
  }
}

async function runJob(job, force) {
  const needsBrowser = job.tasks.some((t) => !t.mock);
  let session = null;
  try {
    if (needsBrowser) session = await browser.ensure();
    for (let i = 0; i < job.tasks.length; i++) {
      const task = job.tasks[i];
      task.status = 'running';
      try {
        if (!force) {
          const cached = readCache(task.keyword, task.platform, task.mock);
          if (cached.length) {
            task.items = cached;
            task.cached = true;
            task.fetchedAt = cached[0].fetchedAt;
            task.status = 'done';
            continue;
          }
        }
        // 平台刚返回访问限制：冷却期内快速失败，避免连续请求加重限制
        const remain = task.mock ? 0 : cooldownRemain(task.platform);
        if (remain > 0) {
          task.status = 'error';
          task.risk = true;
          task.error =
            '「' + task.platform + '」刚返回访问限制，冷却 ' + Math.ceil(remain / 60000) + ' 分钟后再试';
          continue;
        }
        const adapter = task.mock ? mockAdapter : adapters[task.platform];
        if (!adapter) throw new Error('暂不支持平台：' + task.platform);

        let raw = null;
        let lastErr = null;
        let attempt = 0;
        while (attempt < MAX_ATTEMPTS) {
          attempt += 1;
          try {
            raw = await withTimeout(
              Promise.resolve().then(() =>
                adapter.search(task.keyword, {
                  browser: session && session.browser,
                  platform: task.platform
                })
              ),
              task.mock ? 8000 : TASK_TIMEOUT_MS,
              '「' + task.platform + ' · ' + task.keyword + '」搜索超时'
            );
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            // 仅风险/代理类错误值得重试；其余（登录失效、结构变化）重试也不会好
            const retriable = !!(err && (err.risk || err.proxy));
            if (task.mock || !retriable || attempt >= MAX_ATTEMPTS) break;
            if (err.risk) await maybeRotate(session);
            await sleep(jitter(false, !!err.risk));
          }
        }
        if (lastErr) throw lastErr;

        const items = prepareItems(task, raw);
        writeCache(task.keyword, task.platform, items, task.mock);
        task.items = items;
        task.cached = false;
        task.fetchedAt = new Date().toISOString();
        task.status = 'done';
      } catch (err) {
        task.status = 'error';
        task.risk = !!(err && err.risk);
        task.error = err && err.message ? err.message : '搜索失败';
        if (task.risk && !task.mock) setCooldown(task.platform, RISK_COOLDOWN_MS);
      }
      if (i < job.tasks.length - 1) await sleep(jitter(task.mock, !!task.risk));
    }
    if (job.tasks.every((t) => t.status === 'error')) {
      job.status = 'error';
      job.error = '所有平台搜索失败，请检查登录状态或稍后重试';
    } else {
      job.status = 'done';
    }
  } catch (err) {
    job.status = 'error';
    job.error = err && err.message ? err.message : '搜索失败';
    job.tasks.forEach((t) => {
      if (t.status === 'pending' || t.status === 'running') {
        t.status = 'error';
        t.error = job.error;
      }
    });
  } finally {
    job.finishedAt = new Date().toISOString();
    try {
      saveJob(job);
    } catch (err) {
      /* 持久化失败不影响本次结果 */
    }
    if (session) await browser.closeSession(session);
    cleanup();
  }
}

function search(input) {
  const opts = input || {};
  const keywords = normalizeKeywords(opts.keywords);
  if (!keywords.length) throw httpError(400, '请至少输入一个关键词');
  let platforms = Array.isArray(opts.platforms) ? opts.platforms : PLATFORMS.slice();
  platforms = PLATFORMS.filter((p) => platforms.indexOf(p) >= 0);
  if (!platforms.length) throw httpError(400, '请至少选择一个平台');
  if (current && current.status === 'running') {
    throw httpError(409, '已有搜索任务进行中，请稍候');
  }

  cleanup();
  const mock = mockMode();
  const tasks = [];
  keywords.forEach((keyword) => {
    platforms.forEach((platform) => {
      tasks.push({
        keyword,
        platform,
        mock,
        status: 'pending',
        cached: false,
        error: '',
        fetchedAt: null,
        items: []
      });
    });
  });

  const job = {
    id: uid(),
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: '',
    keywords,
    platforms,
    tasks
  };
  current = job;
  try {
    saveJob(job);
  } catch (err) {
    /* 持久化失败不影响本次搜索 */
  }
  runJob(job, !!opts.force).catch(() => {
    /* runJob 内部已落状态 */
  });
  return snapshot(job);
}

function status() {
  return snapshot(current);
}

/** 读取缓存：即使超过 1 小时也返回，用 stale 标记，前端可提示重新搜索 */
function cached(keyword, platform) {
  const kw = String(keyword == null ? '' : keyword).trim();
  if (!kw) throw httpError(400, '缺少关键词');
  const plats = platform ? PLATFORMS.filter((p) => p === platform) : PLATFORMS;
  if (!plats.length) throw httpError(400, '未知平台：' + platform);
  const keepCutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const ttlCutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const mock = mockMode();
  const conn = db.open();
  const groups = plats.map((p) => {
    const rows = conn
      .prepare(
        `SELECT * FROM trend_items
          WHERE keyword = ? AND platform = ? AND mock = ? AND fetched_at >= ?
          ORDER BY heat DESC, likes DESC`
      )
      .all(kw, p, mock ? 1 : 0, keepCutoff);
    const items = rows.map(rowToItem);
    return {
      platform: p,
      count: items.length,
      stale: items.length ? items[0].fetchedAt < ttlCutoff : false,
      fetchedAt: items.length ? items[0].fetchedAt : null,
      items
    };
  });
  return { keyword: kw, platforms: groups };
}

/** 最近一次已结束的搜索：用于刷新页面后恢复关键词和结果列表 */
function latest() {
  const mock = mockMode();
  let row = null;
  try {
    row = db
      .open()
      .prepare(
        `SELECT * FROM trend_jobs
          WHERE mock = ? AND status IN ('done', 'error')
          ORDER BY COALESCE(finished_at, started_at) DESC
          LIMIT 1`
      )
      .get(mock ? 1 : 0);
  } catch (err) {
    return null;
  }
  if (!row) return null;

  let keywords = [];
  let platforms = [];
  let tasksMeta = [];
  try {
    keywords = JSON.parse(row.keywords || '[]');
  } catch (err) {
    /* 数据损坏时按空处理 */
  }
  try {
    platforms = JSON.parse(row.platforms || '[]');
  } catch (err) {
    /* 数据损坏时按空处理 */
  }
  try {
    tasksMeta = JSON.parse(row.tasks_json || '[]');
  } catch (err) {
    /* 数据损坏时按空处理 */
  }

  const conn = db.open();
  const byId = conn.prepare('SELECT * FROM trend_items WHERE id = ?');
  const tasks = tasksMeta.map((meta) => {
    const items =
      meta.status === 'done'
        ? (meta.itemIds || [])
            .map((id) => {
              const itemRow = byId.get(String(id));
              return itemRow ? rowToItem(itemRow) : null;
            })
            .filter(Boolean)
        : [];
    return {
      keyword: meta.keyword,
      platform: meta.platform,
      status: meta.status,
      cached: !!meta.cached,
      count: items.length,
      error: meta.error || '',
      fetchedAt: meta.fetchedAt || null,
      items
    };
  });
  const settled = tasks.filter((t) => t.status === 'done' || t.status === 'error').length;
  return {
    id: row.id,
    status: row.status,
    restored: true,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error || '',
    keywords,
    platforms,
    progress: { done: settled, total: tasks.length },
    tasks
  };
}

module.exports = {
  PLATFORMS,
  platformStatuses,
  search,
  status,
  cached,
  latest
};
