'use strict';

/**
 * 一键登录助手（Cookie 兜底渠道通用）。
 *
 * 网页受同源策略限制无法读取其它域的 Cookie，因此由本地服务拉起一个
 * 独立的 Chrome/Edge 窗口（专用 profile，不触碰日常浏览器），用户登录后
 * 通过 Chrome DevTools Protocol 读取目标域 Cookie，自动关窗并回调保存。
 *
 * 同一时间只允许一个登录会话；登录窗口 5 分钟未完成会自动关闭。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./db');
const { createTunnel } = require('./proxy-tunnel');

const DEFAULT_PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1000;
const LAUNCH_TIMEOUT_MS = 20000;
const CLOSE_DELAY_MS = 800;
// 单个 DevTools 调用必须有客户端超时：页面卡死或调试连接半断开时，
// 否则 Promise 永远不落地，发布任务会一直挂在 running 且不写日志。
const CALL_TIMEOUT_MS = 30000;

let session = null;
let busyOwner = null;

// 进程内启动登记：记录当前浏览器由哪种代理配置拉起、对应的本地隧道。
// 复用已存活调试端口前必须校验一次：代理配置变了或隧道已死就关掉重开。
let launch = null; // { profileDir, sig, tunnel, port }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 浏览器互斥：登录窗口与数据采集不能同时操作同一个 profile */
function acquire(owner) {
  if (busyOwner) {
    const err = new Error('另一个浏览器任务正在进行，请稍后再试');
    err.status = 409;
    throw err;
  }
  busyOwner = owner;
}

function release(owner) {
  if (busyOwner === owner) busyOwner = null;
}

/** 是否还有任务（采集/发布/登录）正在使用浏览器 */
function isBusy() {
  if (busyOwner) return true;
  return !!(session && (session.status === 'launching' || session.status === 'waiting'));
}

function findBrowserExecutable() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'];
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }
  for (const file of candidates) {
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

function httpJson(port, pathname, method) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: method || 'GET', timeout: 2500 },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(new Error('DevTools 响应解析失败'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('DevTools 连接超时')));
    req.on('error', reject);
    req.end();
  });
}

function readActivePort(profileDir) {
  try {
    const lines = fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    const port = Number(lines[0]);
    const wsPath = lines[1] || '';
    if (!port || !wsPath) return null;
    return { port, wsPath };
  } catch (err) {
    return null;
  }
}

async function isDevToolsAlive(info) {
  try {
    await httpJson(info.port, '/json/version');
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 解析调用方的代理意图：
 *   proxy === undefined → 'any'（旧行为：复用任意存活浏览器）
 *   proxy === null      → 'direct'（明确直连）
 *   proxy 对象          → 'proxy'（含配置签名，用于判断能否复用）
 */
function resolveDesiredProxy(config) {
  const rawProxy = config ? config.proxy : undefined;
  if (typeof rawProxy === 'undefined') {
    return { mode: 'any', sig: null, spec: null };
  }
  if (rawProxy === null) {
    return { mode: 'direct', sig: 'direct', spec: null };
  }
  const spec = {
    scheme: String(rawProxy.scheme || 'http').toLowerCase(),
    host: String(rawProxy.host || '').trim(),
    port: Number(rawProxy.port) || 0,
    username: String(rawProxy.username || ''),
    password: String(rawProxy.password || '')
  };
  const hash = crypto.createHash('sha256');
  hash.update([spec.scheme, spec.host, String(spec.port), spec.username, spec.password].join('\n'));
  return { mode: 'proxy', sig: 'proxy:' + hash.digest('hex'), spec };
}

function canReuseBrowser(profileDir, desired, headless) {
  // 需要可见窗口的任务（一键登录、默认的自动发布）不能复用无头会话
  if (!headless) return false;
  if (desired.mode === 'any') return true;
  if (!launch || launch.profileDir !== profileDir) {
    // 上个进程留下的浏览器：直连可复用；代理浏览器因其隧道随进程消亡，必须重开
    return desired.mode === 'direct';
  }
  if (desired.mode === 'direct') return launch.sig === 'direct';
  return launch.sig === desired.sig && !!launch.tunnel && launch.tunnel.isAlive();
}

function buildProxyArgs(tunnelPort) {
  return [
    '--proxy-server=http://127.0.0.1:' + tunnelPort,
    // 显式保持本地直连；不要用 <-loopback>（那是把 loopback 也送进代理）
    '--proxy-bypass-list=127.0.0.1;localhost',
    '--webrtc-ip-handling-policy=disable_non_proxied_udp'
  ];
}

async function recycleLaunch(profileDir) {
  if (!launch) return;
  if (profileDir && launch.profileDir !== profileDir) return;
  const current = launch;
  launch = null;
  if (current.tunnel) {
    try {
      await current.tunnel.close();
    } catch (err) {
      /* 已关闭 */
    }
  }
}

function releaseSession(state) {
  if (state && state.owner) {
    release(state.owner);
    state.owner = null;
  }
}

async function ensureBrowser(config) {
  const profileDir = config.profileDir || DEFAULT_PROFILE_DIR;
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');

  const desired = resolveDesiredProxy(config);

  const existing = readActivePort(profileDir);
  if (existing && (await isDevToolsAlive(existing))) {
    if (canReuseBrowser(profileDir, desired, config.headless)) {
      let target = null;
      try {
        target = await httpJson(existing.port, '/json/new?' + encodeURIComponent(config.url), 'PUT');
      } catch (err) {
        /* 复用已有调试端口时打不开新标签也不影响后续轮询 */
      }
      existing.profileDir = profileDir;
      existing.reused = true;
      existing.target = target;
      return existing;
    }
    // 需要可见窗口，或代理配置已变化 / 旧隧道已失效：关掉重开
    await closeBrowser({ port: existing.port, wsPath: existing.wsPath, profileDir });
    // 等旧进程释放 user-data-dir 锁，否则新实例可能因 profile 被占用而启动失败
    await sleep(400);
  } else if (launch && launch.profileDir === profileDir) {
    // Chrome 已不在但登记表残留：回收可能泄漏的隧道
    await recycleLaunch(profileDir);
  }

  const executable = findBrowserExecutable();
  if (!executable) {
    throw new Error('未找到 Chrome/Edge，请先安装浏览器，或通过环境变量 CHROME_PATH 指定路径');
  }

  fs.mkdirSync(profileDir, { recursive: true });
  try {
    fs.unlinkSync(activePortFile);
  } catch (err) {
    /* 文件不存在 */
  }

  let tunnel = null;
  if (desired.mode === 'proxy') {
    try {
      tunnel = await createTunnel({
        upstream: desired.spec,
        auth: { username: desired.spec.username, password: desired.spec.password },
        onError: () => {
          /* 单连接错误不致命，由页面加载失败兜底 */
        }
      });
    } catch (err) {
      throw new Error('启动本地代理转发失败：' + (err && err.message ? err.message : '未知错误'));
    }
  }

  const args = [
    '--user-data-dir=' + profileDir,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    // 抖音发布页会跑浏览器环境检测脚本，尽量降低自动化特征
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    // 专用 profile 会沿用上次窗口尺寸；窗口太小时表单/弹窗底部会落在视口外，
    // 坐标点击直接失效，因此每次启动都固定一个足够大的窗口。
    '--window-size=1600,1000',
    '--window-position=0,0',
    '--new-window'
  ];
  if (config.headless) args.unshift('--headless=new');
  if (desired.mode === 'proxy' && tunnel) args.push.apply(args, buildProxyArgs(tunnel.port));
  args.push(config.url);

  let proc = null;
  try {
    proc = spawn(executable, args, { detached: true, stdio: 'ignore' });
  } catch (err) {
    if (tunnel) await tunnel.close();
    throw err;
  }
  proc.on('error', () => {});
  proc.unref();

  const started = Date.now();
  while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
    const info = readActivePort(profileDir);
    if (info && (await isDevToolsAlive(info))) {
      info.profileDir = profileDir;
      info.reused = false;
      info.target = null;
      // 登记本次启动的代理配置与隧道，供后续复用判定 / 关闭回收
      launch = {
        profileDir,
        sig: desired.mode === 'proxy' ? desired.sig : 'direct',
        tunnel,
        port: info.port
      };
      return info;
    }
    await sleep(300);
  }
  if (tunnel) await tunnel.close();
  throw new Error('浏览器启动超时，请确认本机 Chrome/Edge 可正常打开');
}

function cdpConnect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const timer = setTimeout(() => {
      try { ws.close(); } catch (err) {}
      reject(new Error('DevTools WebSocket 连接超时'));
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(call);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('DevTools WebSocket 连接失败'));
    };
    ws.onclose = () => {
      pending.forEach((entry) => {
        clearTimeout(entry.timer);
        entry.reject(new Error('DevTools 连接已关闭'));
      });
      pending.clear();
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (!msg.id) {
        if (onEvent) onEvent(msg);
        return;
      }
      if (!pending.has(msg.id)) return;
      const entry = pending.get(msg.id);
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    };

    function call(method, params, timeoutMs) {
      const id = ++seq;
      const limit = timeoutMs || CALL_TIMEOUT_MS;
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (err) {
        return Promise.reject(err);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevTools 调用超时（${Math.round(limit / 1000)}s）：${method}`));
        }, limit);
        pending.set(id, { resolve, reject, timer });
      });
    }
    call.close = () => {
      try { ws.close(); } catch (err) {}
    };
  });
}

async function getAllCookies(info) {
  let cdp = null;
  try {
    cdp = await cdpConnect('ws://127.0.0.1:' + info.port + info.wsPath);
    const result = await cdp('Storage.getCookies', {});
    return result.cookies || [];
  } catch (err) {
    const targets = await httpJson(info.port, '/json/list');
    const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw err;
    const pageCdp = await cdpConnect(page.webSocketDebuggerUrl);
    try {
      const result = await pageCdp('Network.getAllCookies', {});
      return result.cookies || [];
    } finally {
      pageCdp.close();
    }
  } finally {
    if (cdp) cdp.close();
  }
}

async function closeBrowser(info) {
  if (!info) return;
  let cdp = null;
  try {
    cdp = await cdpConnect('ws://127.0.0.1:' + info.port + info.wsPath);
    await cdp('Browser.close', {});
  } catch (err) {
    /* 用户可能已手动关闭窗口 */
  } finally {
    if (cdp) cdp.close();
  }
  // 浏览器已关闭，对应本地隧道一并回收，避免端口与 socket 泄漏
  await recycleLaunch(info.profileDir);
}

function normalizeDomain(domain) {
  return String(domain || '').replace(/^\./, '').toLowerCase();
}

function domainMatches(cookieDomain, baseDomain) {
  const cookie = normalizeDomain(cookieDomain);
  const base = String(baseDomain || '').toLowerCase();
  return !!base && (cookie === base || cookie.endsWith('.' + base));
}

function isExpired(cookie) {
  return typeof cookie.expires === 'number' && cookie.expires > 0 && cookie.expires * 1000 <= Date.now();
}

/** 把 detect 配置（字符串或候选数组）摊平成 Cookie 名列表 */
function detectNames(required) {
  const out = [];
  (required || []).forEach((name) => {
    const list = Array.isArray(name) ? name : [name];
    list.forEach((item) => {
      const text = String(item == null ? '' : item);
      if (text && out.indexOf(text) < 0) out.push(text);
    });
  });
  return out;
}

/** Cookie 数组 → name → value；同名按 path 更长者优先，与请求头拼接规则一致 */
function valuesByName(cookies) {
  const byName = new Map();
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name) return;
    const prev = byName.get(cookie.name);
    if (!prev || String(cookie.path || '').length > String(prev.path || '').length) {
      byName.set(cookie.name, cookie);
    }
  });
  const out = new Map();
  byName.forEach((cookie, name) => out.set(name, cookie.value));
  return out;
}

function headerFromCookies(cookies) {
  const byName = new Map();
  cookies.forEach((cookie) => {
    if (!cookie || !cookie.name) return;
    const prev = byName.get(cookie.name);
    if (!prev || String(cookie.path || '').length > String(prev.path || '').length) {
      byName.set(cookie.name, cookie);
    }
  });
  return Array.from(byName.values())
    .map((cookie) => cookie.name + '=' + cookie.value)
    .join('; ');
}

function mapCookies(cookies, mapping) {
  const out = {};
  const header = headerFromCookies(cookies);
  Object.keys(mapping || {}).forEach((field) => {
    const spec = mapping[field];
    if (spec === '*') {
      out[field] = header;
      return;
    }
    const hit = cookies.find((cookie) => cookie.name === spec && cookie.value);
    if (hit) out[field] = hit.value;
  });
  return out;
}

function publicStatus(state) {
  if (!state) return { platform: null, status: 'idle', message: '' };
  return {
    platform: state.platform,
    status: state.status,
    message: state.message || '',
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    cookieCount: state.cookieCount || 0
  };
}

async function run(state, config) {
  const browser = await ensureBrowser(config);
  state.browser = browser;

  if (session !== state || state.status === 'cancelled') {
    await closeBrowser(browser);
    return;
  }

  const requiredNames = detectNames(config.detect);

  // 旧 Cookie 不能直接算登录成功：先记录基线，只有本次登录让 Cookie 值发生变化才保存并关窗，
  // 否则浏览器 profile 里残留的失效登录态会让窗口刚打开就被关掉。
  // 稍等页面完成首次加载，避免把页面刚下发的访客 Cookie 误判成登录后的新 Cookie。
  await sleep(2500);
  if (session !== state || state.status === 'cancelled') return;
  let baseline = new Map();
  try {
    const initial = await getAllCookies(browser);
    baseline = valuesByName(
      initial.filter(
        (cookie) =>
          cookie && domainMatches(cookie.domain, config.cookieDomain) && !isExpired(cookie)
      )
    );
  } catch (err) {
    /* 读不到基线时按空基线处理，仍允许用户正常登录 */
  }
  if (session !== state || state.status === 'cancelled') return;
  const hadDetectCookie = requiredNames.some((name) => baseline.get(name));

  state.status = 'waiting';
  state.message = hadDetectCookie
    ? '检测到旧的登录 Cookie，请在窗口内重新登录（必要时先退出）以刷新 Cookie；成功后窗口会自动关闭'
    : '请在弹出的浏览器窗口完成登录，成功后窗口会自动关闭';

  const deadline = Date.now() + (config.timeoutMs || DEFAULT_TIMEOUT_MS);
  let captured = false;

  while (Date.now() < deadline) {
    if (session !== state || state.status === 'cancelled') return;

    let cookies;
    try {
      cookies = await getAllCookies(browser);
    } catch (err) {
      await sleep(POLL_INTERVAL_MS);
      if (!(await isDevToolsAlive(browser))) {
        throw new Error('登录窗口已被关闭，未检测到登录 Cookie');
      }
      continue;
    }

    const relevant = cookies.filter(
      (cookie) => domainMatches(cookie.domain, config.cookieDomain) && !isExpired(cookie)
    );
    const present = valuesByName(relevant);
    const detectOk = (config.detect || []).every((name) =>
      Array.isArray(name) ? name.some((alt) => !!present.get(alt)) : !!present.get(name)
    );
    const refreshed = requiredNames.some(
      (name) => !!present.get(name) && baseline.get(name) !== present.get(name)
    );
    const loggedIn = detectOk && refreshed;

    if (loggedIn) {
      state.cookieCount = relevant.length;
      const mapped = mapCookies(relevant, config.map);
      await config.onCaptured(mapped, relevant);
      if (session !== state || state.status === 'cancelled') return;
      state.status = 'success';
      state.message = '登录成功，Cookie 已自动保存';
      state.finishedAt = new Date().toISOString();
      captured = true;
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (!captured) {
    throw new Error('等待登录超时（5 分钟），请重新点击一键登录');
  }

  await sleep(CLOSE_DELAY_MS);
  await closeBrowser(browser);
  state.browser = null;
}

function start(config) {
  if (busyOwner) {
    const err = new Error('数据同步正在进行，请稍后再点一键登录');
    err.status = 409;
    throw err;
  }
  if (session && (session.status === 'launching' || session.status === 'waiting')) {
    const err = new Error('已有登录窗口正在进行，请先完成或取消');
    err.status = 409;
    throw err;
  }

  const state = {
    platform: config.platform,
    status: 'launching',
    message: '正在启动本地浏览器窗口…',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cookieCount: 0,
    browser: null,
    owner: 'login:' + (config.platform || 'channel')
  };
  // 登录期间独占浏览器，避免雷达搜索因代理变更把它误关
  acquire(state.owner);
  session = state;

  run(state, config)
    .then(() => {
      releaseSession(state);
    })
    .catch(async (err) => {
      try {
        if (state.status === 'cancelled') return;
        const browser = state.browser;
        state.browser = null;
        if (browser) await closeBrowser(browser);
        state.status = 'error';
        state.message = err && err.message ? err.message : '登录流程失败';
        state.finishedAt = new Date().toISOString();
      } finally {
        releaseSession(state);
      }
    });

  return publicStatus(state);
}

function status() {
  return publicStatus(session);
}

function cancel() {
  if (!session) return publicStatus(null);
  if (session.status === 'launching' || session.status === 'waiting') {
    session.status = 'cancelled';
    session.message = '已取消登录';
    session.finishedAt = new Date().toISOString();
    const browser = session.browser;
    session.browser = null;
    if (browser) closeBrowser(browser);
  }
  return publicStatus(session);
}

module.exports = {
  start,
  status,
  cancel,
  acquire,
  release,
  isBusy,
  ensureBrowser,
  cdpConnect,
  closeBrowser,
  httpJson,
  findBrowserExecutable,
  domainMatches,
  headerFromCookies,
  mapCookies,
  DEFAULT_PROFILE_DIR
};
