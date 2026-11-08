'use strict';

/**
 * 对标账号监控。
 *
 * 每天固定时间串行打开各平台账号主页，由页面自己请求作品列表接口，
 * 抓取最近 7 天的视频 / 图文，按 (账号, 作品) 去重落库并更新互动数据。
 *
 * 串行 + 随机间隔 + 平台冷却：关键词搜索已下线，避免高频请求触发访问限制。
 * 应用每天 09:10 自动跑一次；若到点时程序没开，启动后会补跑当天漏掉的一轮。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const channelConnections = require('../channel-connections');
const proxyConfig = require('../proxy-config');
const browserLogin = require('../browser-login');
const browser = require('../trends/browser');
const huitun = require('../huitun');
const { heatScores } = require('../trends/util');
const { expandShortUrl } = require('./adapters/capture');

const PLATFORMS = ['小红书', '抖音', 'B站'];
const adapters = {
  小红书: require('./adapters/xiaohongshu'),
  抖音: require('./adapters/douyin'),
  B站: require('./adapters/bilibili')
};

const CONFIG_PATH = path.join(db.DATA_DIR, 'benchmark-monitor.json');
const WINDOW_DAYS = 7;
const KEEP_DAYS = 90;
const MAX_ITEMS = 30;
const TASK_TIMEOUT_MS = 120000;
const RISK_COOLDOWN_MS = 4 * 60 * 1000;
const RISK_BACKOFF_MIN_MS = 8000;
const RISK_BACKOFF_MAX_MS = 15000;
const MAX_ATTEMPTS = 2;
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 10;

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  status: 'idle',
  error: '',
  auto: false,
  progress: { done: 0, total: 0 },
  results: []
};

const cooldowns = new Map(); // platform -> until(ms)
let timer = null;
let nextRunAt = null;
let broadcastFn = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = () => crypto.randomUUID();

function mockMode() {
  return process.env.WB_BENCH_MOCK === '1';
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function setBroadcast(fn) {
  broadcastFn = typeof fn === 'function' ? fn : null;
}

function broadcast() {
  if (!broadcastFn) return;
  try {
    broadcastFn({ type: 'benchmarks', job: snapshot() });
  } catch (err) {
    /* 推送失败不影响抓取 */
  }
}

/* ---------------- 配置 ---------------- */

function readJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8')) || fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function loadConfig() {
  const file = readJson(CONFIG_PATH, {});
  return {
    enabled: file.enabled !== false,
    hour: clampInt(file.hour, 0, 23, DEFAULT_HOUR),
    minute: clampInt(file.minute, 0, 59, DEFAULT_MINUTE),
    lastAutoRunDate: String(file.lastAutoRunDate || '')
  };
}

function saveConfig(input) {
  const cur = readJson(CONFIG_PATH, {});
  const next = Object.assign({}, cur, {
    enabled: input.enabled === true || input.enabled === 'true',
    hour: clampInt(input.hour, 0, 23, cur.hour != null ? clampInt(cur.hour, 0, 23, DEFAULT_HOUR) : DEFAULT_HOUR),
    minute: clampInt(
      input.minute,
      0,
      59,
      cur.minute != null ? clampInt(cur.minute, 0, 59, DEFAULT_MINUTE) : DEFAULT_MINUTE
    )
  });
  writeJson(CONFIG_PATH, next);
  return loadConfig();
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function localDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function markAutoRun(dateKey) {
  const cur = readJson(CONFIG_PATH, {});
  cur.lastAutoRunDate = dateKey;
  writeJson(CONFIG_PATH, cur);
}

/* ---------------- 平台状态与冷却 ---------------- */

function proxyStatus() {
  try {
    const pub = proxyConfig.getPublic();
    return {
      enabled: !!pub.enabled,
      configured: !!pub.configured,
      host: pub.host,
      port: pub.port,
      envOverride: !!pub.envOverride
    };
  } catch (err) {
    return null;
  }
}

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

function platformStatuses() {
  const mock = mockMode();
  const proxy = proxyStatus();
  return PLATFORMS.map((p) => {
    const adapter = adapters[p];
    const external = typeof adapter.huitunReady === 'function' && adapter.huitunReady();
    const conn = channelConnections.get(p);
    const connected = external || !!(conn && conn.enabled);
    const loginRequired = !!adapter.requiresLogin;
    const ready = mock || !loginRequired || connected;
    const remain = cooldownRemain(p);
    return {
      platform: p,
      loginRequired,
      connected: mock ? true : connected,
      ready,
      mock,
      dataSource: external ? '灰豚数据' : '',
      cooldownMs: remain,
      cooldownUntil: remain ? new Date(Date.now() + remain).toISOString() : null,
      proxy,
      hint: mock
        ? '演示模式：使用模拟数据'
        : !ready
          ? '请先在「连接设置」完成' + p + '登录'
          : ''
    };
  });
}

/* ---------------- 账号 ---------------- */

function parseRaw(row) {
  try {
    const parsed = JSON.parse((row && row.raw_json) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function mergeRaw(current, patch) {
  return JSON.stringify(Object.assign({}, parseRaw({ raw_json: current }), patch));
}

function accountStub(row) {
  const raw = parseRaw(row);
  return {
    platform: row.platform,
    accountId: row.account_id,
    profileUrl: row.profile_url,
    name: row.name || '',
    huitunAnchorId: raw.huitunAnchorId || ''
  };
}

function rowToAccount(row, extra) {
  const out = {
    id: row.id,
    platform: row.platform,
    accountId: row.account_id,
    name: row.name || '',
    avatarUrl: row.avatar_url || '',
    profileUrl: row.profile_url,
    huitunAnchorId: parseRaw(row).huitunAnchorId || '',
    enabled: !!row.enabled,
    lastFetchAt: row.last_fetch_at || null,
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (extra) Object.assign(out, extra);
  return out;
}

function listAccounts() {
  const windowCutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const rows = db
    .open()
    .prepare(
      `SELECT a.*,
              COUNT(w.id) AS work_count,
              SUM(CASE WHEN w.published_at >= ? THEN 1 ELSE 0 END) AS recent_count,
              MAX(w.published_at) AS latest_published_at
         FROM bench_accounts a
         LEFT JOIN bench_works w ON w.account_row_id = a.id
        GROUP BY a.id
        ORDER BY a.created_at ASC`
    )
    .all(windowCutoff);
  return rows.map((row) =>
    rowToAccount(row, {
      workCount: Number(row.work_count) || 0,
      recentCount: Number(row.recent_count) || 0,
      latestPublishedAt: row.latest_published_at || null
    })
  );
}

function getAccountRow(id) {
  return db.open().prepare('SELECT * FROM bench_accounts WHERE id = ?').get(String(id || ''));
}

const URL_INPUT_RE = /^(https?:\/\/|(www\.)?(xiaohongshu\.com|douyin\.com|bilibili\.com|b23\.tv|v\.douyin\.com|xhslink\.com|huitun\.com)(\/|\b))/i;

function isUrlInput(text) {
  return URL_INPUT_RE.test(String(text || '').trim());
}

function anchorCandidate(row) {
  return {
    anchorId: String(row.anchorId || row.anchor_id || row.id || '').trim(),
    name: String(row.nick || row.nickname || row.name || row.anchorName || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60),
    avatarUrl: row.headurl || row.avatar || row.image || row.avatarUrl || ''
  };
}

/** 小红书按昵称在灰豚搜索达人，只传昵称，不加其它查询条件 */
async function resolveNickname(nickname) {
  const raw = channelConnections.getRaw('灰豚数据');
  const cookie = raw && raw.fields ? String(raw.fields.Cookie || '').trim() : '';
  if (!(raw && raw.enabled && cookie)) {
    throw httpError(400, '按昵称添加小红书账号需要先在「连接设置」启用灰豚数据');
  }
  let rows;
  try {
    rows = await huitun.searchAnchor(cookie, nickname, { page: 1, pageSize: 20 });
  } catch (err) {
    throw httpError(400, err && err.message ? err.message : '灰豚数据搜索失败');
  }
  const candidates = rows.map(anchorCandidate).filter((item) => item.anchorId);
  if (!candidates.length) {
    throw httpError(404, '灰豚数据没有搜到「' + nickname + '」，请检查昵称是否准确');
  }
  const lower = nickname.toLowerCase();
  const exact =
    candidates.find((item) => item.name === nickname) ||
    candidates.find((item) => item.name.toLowerCase() === lower);
  const hit = exact || candidates[0];
  return {
    platform: '小红书',
    accountId: hit.anchorId,
    name: hit.name || nickname,
    avatarUrl: hit.avatarUrl || '',
    profileUrl: huitun.anchorUrl(hit.anchorId),
    huitunAnchorId: hit.anchorId,
    nickname,
    ambiguous: !exact && candidates.length > 1
  };
}

async function addAccount(input) {
  const rawInput = String((input && input.url) || '').trim();
  if (!rawInput) throw httpError(400, '请输入小红书博主昵称，或粘贴账号主页链接');
  const wantPlatform = input.platform && adapters[input.platform] ? String(input.platform) : '';

  let parsed = null;
  if (!isUrlInput(rawInput)) {
    if (wantPlatform && wantPlatform !== '小红书') {
      throw httpError(400, '抖音 / B站 请粘贴账号主页链接');
    }
    parsed = await resolveNickname(rawInput);
  } else {
    const expanded = await expandShortUrl(rawInput);
    const candidates = wantPlatform ? [wantPlatform] : PLATFORMS;
    for (const p of candidates) {
      parsed = adapters[p].parseAccountUrl(expanded);
      if (parsed) break;
    }
    if (!parsed) {
      throw httpError(400, '无法识别该账号链接，请粘贴账号主页链接或输入小红书昵称');
    }
  }

  const rawJson = parsed.huitunAnchorId
    ? JSON.stringify({ huitunAnchorId: parsed.huitunAnchorId })
    : '';
  const conn = db.open();
  const existing = conn
    .prepare('SELECT * FROM bench_accounts WHERE platform = ? AND account_id = ?')
    .get(parsed.platform, parsed.accountId);
  const now = new Date().toISOString();
  if (existing) {
    conn
      .prepare(
        'UPDATE bench_accounts SET enabled = 1, name = ?, avatar_url = ?, profile_url = ?, raw_json = ?, updated_at = ? WHERE id = ?'
      )
      .run(
        parsed.name || existing.name || '',
        parsed.avatarUrl || existing.avatar_url || '',
        parsed.profileUrl,
        parsed.huitunAnchorId ? mergeRaw(existing.raw_json, { huitunAnchorId: parsed.huitunAnchorId }) : existing.raw_json || '',
        now,
        existing.id
      );
    return {
      account: rowToAccount(getAccountRow(existing.id)),
      created: false,
      warning: addAccountWarning(parsed)
    };
  }

  const id = uid();
  conn
    .prepare(
      `INSERT INTO bench_accounts
        (id, platform, account_id, name, avatar_url, profile_url, raw_json, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`
    )
    .run(
      id,
      parsed.platform,
      parsed.accountId,
      parsed.name || '',
      parsed.avatarUrl || '',
      parsed.profileUrl,
      rawJson,
      now,
      now
    );
  return {
    account: rowToAccount(getAccountRow(id)),
    created: true,
    warning: addAccountWarning(parsed)
  };
}

function addAccountWarning(parsed) {
  const huitunOn = adapters['小红书'].huitunReady();
  if (parsed.ambiguous) {
    return '昵称「' + parsed.nickname + '」匹配到多个达人，已选择「' + parsed.name + '」，如不是目标账号请删除后换更精确的昵称';
  }
  if (parsed.platform === '小红书' && parsed.huitunAnchorId && !huitunOn) {
    return '这是灰豚达人链接，请先在「连接设置」启用灰豚数据，否则无法抓取该账号';
  }
  const base = platformWarning(parsed.platform);
  if (base) return base;
  if (parsed.platform === '小红书' && huitunOn && !parsed.huitunAnchorId) {
    return '已启用灰豚数据：将按已保存的博主昵称匹配灰豚达人；若该账号还没抓取过，请改用灰豚达人主页链接添加';
  }
  return '';
}

function platformWarning(platform) {
  const item = platformStatuses().find((p) => p.platform === platform);
  return item && !item.ready ? item.hint : '';
}

function setAccountEnabled(id, enabled) {
  const row = getAccountRow(id);
  if (!row) throw httpError(404, '账号不存在');
  db.open()
    .prepare('UPDATE bench_accounts SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, new Date().toISOString(), row.id);
  return rowToAccount(getAccountRow(row.id));
}

function removeAccount(id) {
  const row = getAccountRow(id);
  if (!row) throw httpError(404, '账号不存在');
  db.transaction((conn) => {
    conn.prepare('DELETE FROM bench_works WHERE account_row_id = ?').run(row.id);
    conn.prepare('DELETE FROM bench_accounts WHERE id = ?').run(row.id);
  });
  return { removed: row.id, platform: row.platform };
}

/* ---------------- 作品 ---------------- */

function rowToWork(row) {
  return {
    id: row.id,
    accountRowId: row.account_row_id,
    accountName: row.account_name || '',
    accountAvatar: row.account_avatar || '',
    platform: row.platform,
    workId: row.work_id,
    title: row.title,
    coverUrl: row.cover_url || '',
    itemUrl: row.item_url || '',
    itemType: row.item_type || 'note',
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    collects: row.collects,
    reads: row.reads,
    publishedAt: row.published_at || '',
    heat: row.heat,
    fetchedAt: row.fetched_at
  };
}

function listWorks(query) {
  const opts = query || {};
  const where = [];
  const params = [];
  const platform = PLATFORMS.indexOf(opts.platform) >= 0 ? opts.platform : '';
  if (platform) {
    where.push('w.platform = ?');
    params.push(platform);
  }
  if (opts.accountId) {
    where.push('w.account_row_id = ?');
    params.push(String(opts.accountId));
  }
  const days = opts.days === undefined || opts.days === null || opts.days === '' ? WINDOW_DAYS : Number(opts.days);
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    where.push("(w.published_at IS NULL OR w.published_at = '' OR w.published_at >= ?)");
    params.push(cutoff);
  }
  const limit = clampInt(opts.limit, 1, 500, 200);
  const order =
    opts.sort === 'heat'
      ? 'w.heat DESC, w.likes DESC, w.published_at DESC'
      : "COALESCE(NULLIF(w.published_at, ''), w.fetched_at) DESC";
  const rows = db
    .open()
    .prepare(
      `SELECT w.*, a.name AS account_name, a.avatar_url AS account_avatar
         FROM bench_works w
         JOIN bench_accounts a ON a.id = w.account_row_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ${order}
        LIMIT ?`
    )
    .all(...params, limit);
  return rows.map(rowToWork);
}

function normalizeWork(item) {
  const itemType = item.itemType === 'video' ? 'video' : 'note';
  return {
    workId: String(item.workId),
    title: String(item.title || '（无标题作品）').slice(0, 120),
    coverUrl: item.coverUrl || '',
    itemUrl: item.itemUrl || '',
    itemType,
    likes: Math.max(0, Number(item.likes) || 0),
    comments: Math.max(0, Number(item.comments) || 0),
    shares: Math.max(0, Number(item.shares) || 0),
    collects: Math.max(0, Number(item.collects) || 0),
    reads: Math.max(0, Number(item.reads) || 0),
    publishedAt: item.publishedAt || ''
  };
}

function saveWorks(accountRow, works) {
  const list = (Array.isArray(works) ? works : [])
    .filter((it) => it && it.workId)
    .map(normalizeWork)
    .slice(0, MAX_ITEMS);
  if (!list.length) return 0;
  const heats = heatScores(list, Date.now());
  const now = new Date().toISOString();
  db.transaction((conn) => {
    const upsert = conn.prepare(
      `INSERT INTO bench_works
        (id, account_row_id, platform, work_id, title, cover_url, item_url, item_type,
         likes, comments, shares, collects, reads, published_at, heat, fetched_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(account_row_id, work_id) DO UPDATE SET
         title = excluded.title,
         cover_url = excluded.cover_url,
         item_url = excluded.item_url,
         item_type = excluded.item_type,
         likes = excluded.likes,
         comments = excluded.comments,
         shares = excluded.shares,
         collects = excluded.collects,
         reads = excluded.reads,
         published_at = excluded.published_at,
         heat = excluded.heat,
         fetched_at = excluded.fetched_at`
    );
    list.forEach((it, i) => {
      upsert.run(
        uid(),
        accountRow.id,
        accountRow.platform,
        it.workId,
        it.title,
        it.coverUrl,
        it.itemUrl,
        it.itemType,
        it.likes,
        it.comments,
        it.shares,
        it.collects,
        it.reads,
        it.publishedAt,
        heats[i],
        now,
        now
      );
    });
  });
  return list.length;
}

function touchAccount(row, patch) {
  const now = new Date().toISOString();
  const next = Object.assign(
    {
      name: row.name || '',
      avatar_url: row.avatar_url || '',
      profile_url: row.profile_url,
      raw_json: row.raw_json || '',
      last_fetch_at: now,
      last_error: ''
    },
    patch || {}
  );
  db.open()
    .prepare(
      `UPDATE bench_accounts
          SET name = ?, avatar_url = ?, profile_url = ?, raw_json = ?, last_fetch_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(
      next.name,
      next.avatar_url,
      next.profile_url,
      next.raw_json || '',
      next.last_fetch_at,
      next.last_error || '',
      now,
      row.id
    );
}

function cleanup() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  try {
    db.open().prepare('DELETE FROM bench_works WHERE fetched_at < ?').run(cutoff);
  } catch (err) {
    /* 清理失败不影响抓取 */
  }
}

/* ---------------- 抓取 ---------------- */

function jitter(isMock, risk) {
  if (isMock) return 30;
  if (risk) {
    return RISK_BACKOFF_MIN_MS + Math.floor(Math.random() * (RISK_BACKOFF_MAX_MS - RISK_BACKOFF_MIN_MS));
  }
  return 3000 + Math.floor(Math.random() * 3000);
}

function withTimeout(promise, ms, message) {
  let timerId = null;
  const timeout = new Promise((resolve, reject) => {
    timerId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

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
    /* 换 IP 失败不阻断重试 */
  }
}

function mockWorks(account, sinceMs) {
  const now = Date.now();
  const titles = [
    '实测：新手做账号最容易忽略的三个细节',
    '一条视频讲清楚选题到发布的完整流程',
    '为什么你的内容完播率上不去？',
    '本周复盘：流量波动背后的真实原因',
    '图文也能涨粉？我整理了一套模板',
    '评论区问得最多的五个问题',
    '从 0 到 1 拆解一个爆款结构',
    '别急着追热点，先把这件事做好'
  ];
  const works = [];
  for (let i = 0; i < 8; i++) {
    const publishedAt = new Date(now - (i * 9 + 2) * 3600 * 1000).toISOString();
    if (sinceMs && new Date(publishedAt).getTime() < sinceMs) continue;
    const base = 800 + ((i * 733) % 4200);
    works.push({
      workId: 'mock-' + account.platform + '-' + i,
      title: titles[i % titles.length],
      coverUrl: '',
      itemUrl: account.profileUrl,
      itemType: i % 3 === 0 ? 'note' : 'video',
      likes: base,
      comments: Math.round(base * 0.08),
      shares: Math.round(base * 0.04),
      collects: Math.round(base * 0.12),
      reads: base * 18,
      publishedAt
    });
  }
  return {
    account: {
      name: '模拟账号 · ' + account.platform,
      avatarUrl: '',
      profileUrl: account.profileUrl
    },
    works
  };
}

function rowNeedsBrowser(row) {
  const adapter = adapters[row.platform];
  if (!adapter) return false;
  return typeof adapter.needsBrowser === 'function' ? adapter.needsBrowser(accountStub(row)) : true;
}

async function fetchOne(row, session) {
  const account = accountStub(row);
  const sinceMs = Date.now() - WINDOW_DAYS * 86400000;
  if (mockMode()) return mockWorks(account, sinceMs);
  const adapter = adapters[row.platform];
  if (!adapter) throw new Error('暂不支持平台：' + row.platform);
  return adapter.fetchRecent(account, { browser: session && session.browser, sinceMs });
}

function snapshot() {
  return {
    running: state.running,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error,
    auto: state.auto,
    progress: { done: state.progress.done, total: state.progress.total },
    results: state.results.map((r) => Object.assign({}, r)),
    nextRunAt
  };
}

async function runJob(rows, auto) {
  const isMock = mockMode();
  let session = null;
  try {
    state.results = rows.map((row) => ({
      accountRowId: row.id,
      platform: row.platform,
      name: row.name || '',
      status: 'pending',
      error: '',
      count: 0,
      risk: false
    }));
    state.progress = { done: 0, total: rows.length };
    // 小红书已切到灰豚时不需要拉起浏览器；只有确实要走浏览器的账号才启动会话
    if (!isMock && rows.some(rowNeedsBrowser)) session = await browser.ensure();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const result = state.results[i];
      result.status = 'running';
      broadcast();
      try {
        const remain = isMock ? 0 : cooldownRemain(row.platform);
        if (remain > 0) {
          const err = new Error(
            '「' + row.platform + '」刚返回访问限制，冷却 ' + Math.ceil(remain / 60000) + ' 分钟后再试'
          );
          err.risk = true;
          throw err;
        }

        let data = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            data = await withTimeout(
              Promise.resolve().then(() => fetchOne(row, session)),
              isMock ? 8000 : TASK_TIMEOUT_MS,
              '「' + row.platform + ' · ' + (row.name || row.account_id) + '」抓取超时'
            );
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            const retriable = !!(err && (err.risk || err.proxy));
            if (isMock || !retriable || attempt >= MAX_ATTEMPTS) break;
            if (err.risk) await maybeRotate(session);
            await sleep(jitter(false, !!err.risk));
          }
        }
        if (lastErr) throw lastErr;

        const works = (data && data.works) || [];
        const saved = saveWorks(row, works);
        const info = (data && data.account) || {};
        const patch = {
          name: info.name || row.name || '',
          avatar_url: info.avatarUrl || row.avatar_url || '',
          profile_url: info.profileUrl || row.profile_url,
          last_error: ''
        };
        if (info.huitunAnchorId) {
          patch.raw_json = mergeRaw(row.raw_json, { huitunAnchorId: info.huitunAnchorId });
        }
        touchAccount(row, patch);
        result.status = 'done';
        result.count = saved;
        result.name = info.name || row.name || '';
      } catch (err) {
        result.status = 'error';
        result.risk = !!(err && err.risk);
        result.error = err && err.message ? err.message : '抓取失败';
        if (err && err.risk && !isMock) setCooldown(row.platform, RISK_COOLDOWN_MS);
        touchAccount(row, { last_error: result.error });
      }
      state.progress.done = i + 1;
      broadcast();
      if (i < rows.length - 1) await sleep(jitter(isMock, !!result.risk));
    }

    const failed = state.results.filter((r) => r.status === 'error').length;
    if (failed === state.results.length) {
      state.status = 'error';
      state.error = '所有账号抓取失败，请检查登录状态或稍后重试';
    } else {
      state.status = 'done';
      state.error = failed ? failed + ' 个账号抓取失败' : '';
    }
  } catch (err) {
    state.status = 'error';
    state.error = err && err.message ? err.message : '抓取失败';
    state.results.forEach((r) => {
      if (r.status === 'pending' || r.status === 'running') {
        r.status = 'error';
        r.error = state.error;
      }
    });
    throw err;
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    cleanup();
    try {
      if (session) browser.closeSession();
    } catch (err) {
      /* 浏览器已关闭 */
    }
    broadcast();
  }
}

function startJob(rows, auto) {
  if (state.running) throw httpError(409, '对标账号正在更新，请稍候');
  const isMock = mockMode();
  if (!isMock && rows.some(rowNeedsBrowser) && browserLogin.isBusy()) {
    throw httpError(409, '另一个浏览器任务正在进行，请稍后再试');
  }
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.status = 'running';
  state.error = '';
  state.auto = !!auto;
  state.progress = { done: 0, total: rows.length };
  state.results = [];
  runJob(rows, !!auto).catch((err) => {
    if (err && err.status === 409) {
      state.running = false;
      state.status = 'error';
      state.error = err.message;
      broadcast();
    }
  });
  return snapshot();
}

function enabledRows() {
  return db
    .open()
    .prepare('SELECT * FROM bench_accounts WHERE enabled = 1 ORDER BY platform ASC, created_at ASC')
    .all();
}

function refreshAll() {
  const rows = enabledRows();
  if (!rows.length) throw httpError(400, '请先添加并启用至少一个对标账号');
  return startJob(rows, false);
}

function refreshAccount(id) {
  const row = getAccountRow(id);
  if (!row) throw httpError(404, '账号不存在');
  return startJob([row], false);
}

/* ---------------- 定时任务 ---------------- */

function nextDailyAt(hour, minute) {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

function arm(ms, cb) {
  if (timer) clearTimeout(timer);
  nextRunAt = new Date(Date.now() + ms).toISOString();
  timer = setTimeout(() => {
    timer = null;
    Promise.resolve()
      .then(cb)
      .catch((err) => {
        state.error = err && err.message ? err.message : '定时任务失败';
      });
  }, Math.max(0, ms));
}

function scheduleNextDaily() {
  const cfg = loadConfig();
  const next = nextDailyAt(cfg.hour, cfg.minute);
  arm(next.getTime() - Date.now(), onDaily);
}

async function runAutoOnce() {
  const cfg = loadConfig();
  if (!cfg.enabled) return true;
  const today = localDateKey(new Date());
  if (cfg.lastAutoRunDate === today) return true;
  const rows = enabledRows();
  if (!rows.length) {
    markAutoRun(today);
    return true;
  }
  try {
    await new Promise((resolve, reject) => {
      try {
        startJob(rows, true);
      } catch (err) {
        reject(err);
        return;
      }
      const check = setInterval(() => {
        if (!state.running) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
    markAutoRun(today);
    return true;
  } catch (err) {
    // 浏览器被其它任务占用时，10 分钟后再试，不把当天标记为已完成
    if (err && err.status === 409) return false;
    markAutoRun(today);
    return true;
  }
}

async function onDaily() {
  const cfg = loadConfig();
  if (!cfg.enabled) return;
  const done = await runAutoOnce();
  if (!done) {
    arm(10 * 60 * 1000, onDaily);
    return;
  }
  scheduleNextDaily();
}

function startScheduler() {
  stopScheduler();
  const cfg = loadConfig();
  if (!cfg.enabled) return false;

  const now = new Date();
  const today = localDateKey(now);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cfg.hour, cfg.minute, 0, 0);
  // 应用启动时已过今天的抓取时间且今天还没跑过：稍等片刻补跑一轮
  if (now.getTime() >= target.getTime() && cfg.lastAutoRunDate !== today && enabledRows().length) {
    arm(8000, onDaily);
  } else {
    scheduleNextDaily();
  }
  return true;
}

function stopScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  nextRunAt = null;
}

function getStatus() {
  const cfg = loadConfig();
  return {
    enabled: cfg.enabled,
    hour: cfg.hour,
    minute: cfg.minute,
    lastAutoRunDate: cfg.lastAutoRunDate,
    running: state.running,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error,
    auto: state.auto,
    progress: { done: state.progress.done, total: state.progress.total },
    results: state.results.map((r) => Object.assign({}, r)),
    nextRunAt,
    windowDays: WINDOW_DAYS
  };
}

function overview(query) {
  return {
    status: getStatus(),
    platforms: platformStatuses(),
    accounts: listAccounts(),
    works: listWorks(query)
  };
}

module.exports = {
  PLATFORMS,
  setBroadcast,
  addAccount,
  removeAccount,
  setAccountEnabled,
  listAccounts,
  listWorks,
  overview,
  refreshAll,
  refreshAccount,
  platformStatuses,
  getStatus,
  loadConfig,
  saveConfig,
  startScheduler,
  stopScheduler,
  snapshot
};
