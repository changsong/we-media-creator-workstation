'use strict';

/**
 * 账号与授权：对接 Keygate 的邮箱验证码登录与许可证激活。
 *
 * 所有网络请求都在本地服务进程里发起，渲染进程只访问 /api/license/*。
 * 许可证 token 是 Ed25519 签名的 JSON，内置公钥即可离线验签；联网只用于
 * 首次激活、定期续验（默认 6 小时）和发现用户名下的授权。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const db = require('./db');

const BASE_URL = String(process.env.WB_KEYGATE_URL || 'https://keygate.unionuser.com').replace(/\/+$/, '');
const PRODUCT_SLUG = String(process.env.WB_KEYGATE_PRODUCT || 'we-media-creator');
// FreeTrial 套餐的 checkout_id：邮箱验证码通过自助领证（self-signup）
// 直接开一张试用许可证，而不是只建账号。
const TRIAL_CHECKOUT_ID = String(process.env.WB_KEYGATE_TRIAL_CHECKOUT || '4917722b').trim();
// 取自 Keygate GET /api/v1/license/pubkey，与 LICENSE_SIGNING_KEY 派生出的公钥一致。
const PINNED_PUBKEY = 'bf17435ee7b937b3592808941683c21d37c4e124d95d4e8fdd86fe775dd23b11';
const SPKI_PREFIX = '302a300506032b6570032100';

const STATE_FILE = path.join(db.DATA_DIR, 'license.json');
const REQUEST_TIMEOUT_MS = 15 * 1000;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const PUBLISH_FRESH_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const PLAN_CACHE_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = ['revoked', 'expired', 'canceled', 'suspended'];
const USABLE_STATUSES = ['active', 'trialing', 'past_due'];

let state = null;
let machineId = '';
let refreshTimer = null;
let planCache = { at: 0, ids: [] };

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function emptyState() {
  return {
    version: 1,
    machineId: '',
    user: null,
    session: null,
    license: null,
    lastSeenAt: 0,
    clockSkew: false
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state = Object.assign(emptyState(), parsed);
      return true;
    }
  } catch (err) {
    // 首次运行或状态文件损坏：从空状态开始，不影响应用启动。
  }
  state = emptyState();
  return false;
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.warn('[license] 状态写入失败：', err.message);
  }
}

/* ---------------- 设备指纹 ---------------- */

function readPlatformMachineId() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000 }
      );
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 5000
      });
      const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return m[1];
    } else {
      const candidates = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
      for (const file of candidates) {
        try {
          const id = fs.readFileSync(file, 'utf8').trim();
          if (id) return id;
        } catch (err) {
          // 换下一个来源
        }
      }
    }
  } catch (err) {
    // 注册表/命令不可用时退回基础信息
  }
  return '';
}

function resolveMachineId() {
  const override = String(process.env.WB_MACHINE_ID || '').trim();
  if (override) return override.slice(0, 256);
  let raw = readPlatformMachineId();
  if (!raw) raw = os.hostname() + '|' + os.platform() + '|' + os.arch();
  const digest = crypto.createHash('sha256').update('wemedia:' + raw).digest('hex').slice(0, 32);
  return 'wm-' + digest;
}

function deviceLabel() {
  return String(os.hostname() || 'this device').slice(0, 64);
}

/* ---------------- 离线验签 ---------------- */

function publicKeyHex() {
  const override = String(process.env.WB_KEYGATE_PUBKEY || '').trim();
  const hex = override || PINNED_PUBKEY;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw httpError(500, '内置授权公钥格式错误', 'PUBKEY_INVALID');
  }
  return hex.toLowerCase();
}

function fingerprintFor(identifier, productId) {
  return crypto.createHash('sha256').update(identifier + ':' + productId).digest('hex').slice(0, 16);
}

function verifyToken(raw, opts) {
  const options = opts || {};
  const identifier = options.identifier || machineId;
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'token_missing' };

  const idx = raw.lastIndexOf('.');
  if (idx <= 0 || idx === raw.length - 1) return { ok: false, reason: 'token_malformed' };
  const payloadB64 = raw.slice(0, idx);
  const signature = Buffer.from(raw.slice(idx + 1), 'base64url');
  if (signature.length !== 64) return { ok: false, reason: 'token_malformed' };

  let key;
  try {
    const der = Buffer.concat([
      Buffer.from(SPKI_PREFIX, 'hex'),
      Buffer.from(options.publicKeyHex || publicKeyHex(), 'hex')
    ]);
    key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch (err) {
    return { ok: false, reason: 'signature_invalid' };
  }

  // Keygate 签名的是 payload 的 base64 字符串本身，而不是解码后的 JSON。
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(payloadB64, 'ascii'), key, signature);
  } catch (err) {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'signature_invalid' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch (err) {
    return { ok: false, reason: 'token_malformed' };
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'token_malformed' };

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now > payload.exp) return { ok: false, reason: 'token_expired' };
  if (payload.did && payload.did !== identifier) return { ok: false, reason: 'device_mismatch' };
  if (payload.pid && payload.fpr && payload.fpr !== fingerprintFor(identifier, payload.pid)) {
    return { ok: false, reason: 'device_mismatch' };
  }
  if (payload.sts && TERMINAL_STATUSES.indexOf(payload.sts) >= 0) {
    return { ok: false, reason: 'license_inactive' };
  }
  const grace = Number(payload.grc) || 0;
  const validUntil = Number(payload.vun) || 0;
  const licenseDeadline = validUntil > 0 ? validUntil + grace * 86400 : 0;
  if (licenseDeadline > 0 && now > licenseDeadline) {
    return { ok: false, reason: 'license_expired' };
  }
  if (payload.ftr && Object.prototype.hasOwnProperty.call(payload.ftr, 'publish') && payload.ftr.publish === false) {
    return { ok: false, reason: 'feature_not_entitled' };
  }
  return {
    ok: true,
    reason: 'ok',
    payload,
    offlineUntil: licenseDeadline > 0 ? Math.min(payload.exp, licenseDeadline) : payload.exp
  };
}

/* ---------------- Keygate HTTP ---------------- */

function parseEnvelope(res, text) {
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (err) {
      body = null;
    }
  }
  if (!res.ok || (body && body.success === false)) {
    const info = (body && body.error) || {};
    const status = res.status >= 400 ? res.status : 502;
    const err = httpError(status, info.message || '授权服务请求失败（HTTP ' + res.status + '）', info.code || 'KEYGATE_ERROR');
    err.details = info.details;
    throw err;
  }
  return body ? body.data : null;
}

async function requestJson(pathname, opts) {
  const options = opts || {};
  const headers = { Accept: 'application/json' };
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.token) headers.Authorization = 'Bearer ' + options.token;

  let res;
  try {
    res = await fetch(BASE_URL + '/api/v1' + pathname, {
      method: options.method || 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(
      err && err.name === 'TimeoutError' ? 504 : 503,
      '无法连接授权服务，请检查网络后重试',
      'KEYGATE_UNREACHABLE'
    );
  }
  const text = await res.text();
  return { data: parseEnvelope(res, text), res };
}

function normalizeEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw httpError(400, '请输入有效的邮箱地址');
  }
  return email;
}

function readSetCookies(res) {
  if (res.headers && typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers && res.headers.get ? res.headers.get('set-cookie') : '';
  return raw ? [raw] : [];
}

function cookieValue(cookies, name) {
  for (const cookie of cookies) {
    const first = String(cookie).split(';')[0];
    const idx = first.indexOf('=');
    if (idx > 0 && first.slice(0, idx).trim() === name) return first.slice(idx + 1);
  }
  return '';
}

/* ---------------- 会话 ---------------- */

async function refreshSession() {
  const refreshToken = state.session && state.session.refreshToken;
  if (!refreshToken) throw httpError(401, '登录已过期，请重新登录', 'LOGIN_REQUIRED');
  let data;
  try {
    data = (await requestJson('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } })).data;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      throw httpError(401, '登录已过期，请重新登录', 'LOGIN_REQUIRED');
    }
    throw err;
  }
  if (!data || !data.access_token) {
    throw httpError(401, '登录已过期，请重新登录', 'LOGIN_REQUIRED');
  }
  state.session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    accessExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null
  };
  if (data.user) state.user = { email: data.user.email || '', name: data.user.name || '' };
  state.clockSkew = false;
  state.lastSeenAt = Math.max(state.lastSeenAt || 0, Date.now());
  saveState();
  return data;
}

async function authRequest(pathname, opts) {
  const options = Object.assign({}, opts);
  if (!state.session || !state.session.accessToken) {
    throw httpError(401, '请先登录', 'LOGIN_REQUIRED');
  }
  options.token = state.session.accessToken;
  try {
    return await requestJson(pathname, options);
  } catch (err) {
    if (err.status !== 401) throw err;
    await refreshSession();
    options.token = state.session.accessToken;
    return requestJson(pathname, options);
  }
}

/* ---------------- 授权发现与激活 ---------------- */

async function productPlanIds() {
  if (Date.now() - planCache.at < PLAN_CACHE_MS) return planCache.ids;
  try {
    const data = (await requestJson('/products/' + encodeURIComponent(PRODUCT_SLUG) + '/plans')).data;
    planCache = {
      at: Date.now(),
      ids: ((data && data.plans) || []).map((plan) => plan.id).filter(Boolean)
    };
  } catch (err) {
    planCache = { at: Date.now(), ids: [] };
  }
  return planCache.ids;
}

async function pickPortalLicense(list) {
  if (!list.length) return null;
  const planIds = await productPlanIds();
  let candidates = planIds.length ? list.filter((item) => planIds.indexOf(item.plan_id) >= 0) : [];
  if (!candidates.length) {
    candidates = list.filter((item) => item.product && item.product.slug === PRODUCT_SLUG);
  }
  // 单租户、单产品时门户里通常只有这一条授权。
  if (!candidates.length && list.length === 1) candidates = list;
  if (!candidates.length) return null;

  const usable = candidates.filter((item) => USABLE_STATUSES.indexOf(item.status) >= 0);
  const pool = usable.length ? usable : candidates;
  // 已有付费授权的邮箱仍可能通过自助领证再拿到一张 trial；同一账号下
  // 同时存在两种证时，优先用非 trialing 的那张，避免试用覆盖付费授权。
  const trialRank = (item) => (String((item && item.status) || '').toLowerCase() === 'trialing' ? 1 : 0);
  pool.sort((a, b) => {
    const ar = trialRank(a);
    const br = trialRank(b);
    if (ar !== br) return ar - br;
    const at = a.valid_until ? new Date(a.valid_until).getTime() : Infinity;
    const bt = b.valid_until ? new Date(b.valid_until).getTime() : Infinity;
    if (at !== bt) return bt - at;
    return (b.activation_count || 0) - (a.activation_count || 0);
  });
  return pool[0];
}

function featuresFromPortal(portalLicense) {
  if (!portalLicense || !Array.isArray(portalLicense.features)) return null;
  const out = {};
  portalLicense.features.forEach((ent) => {
    if (ent && ent.feature) out[ent.feature] = ent.value;
  });
  return out;
}

function applyVerifyData(data, previous) {
  const prev = previous || state.license || {};
  const src = data || {};
  state.license = Object.assign({}, prev, {
    productId: prev.productId || '',
    planId: src.plan_id || prev.planId || '',
    planName: src.plan_name || prev.planName || '',
    status: src.status || prev.status || 'active',
    validUntil: src.valid_until || null,
    updatesUntil: src.updates_until || null,
    graceDays: src.grace_days != null ? src.grace_days : prev.graceDays || 0,
    features: src.features || prev.features || null,
    token: src.token || prev.token || '',
    lastVerifiedAt: new Date().toISOString(),
    invalid: false
  });
  state.clockSkew = false;
  state.lastSeenAt = Math.max(state.lastSeenAt || 0, Date.now());
}

async function activateKey(rawKey, portalLicense) {
  const licenseKey = String(rawKey == null ? '' : rawKey).trim();
  if (!licenseKey) throw httpError(400, '请输入授权码');

  const activated = (await requestJson('/license/activate', {
    method: 'POST',
    body: {
      license_key: licenseKey,
      identifier: machineId,
      identifier_type: 'device',
      label: deviceLabel()
    }
  })).data || {};

  let verified = null;
  try {
    verified = (await requestJson('/license/verify', {
      method: 'POST',
      body: { license_key: licenseKey, identifier: machineId }
    })).data;
  } catch (err) {
    // 激活已成功但续验暂时失败（网络抖动）时，先用激活返回的 token。
    if (err.status === 404) throw err;
  }

  const meta = activated.meta || {};
  const portal = portalLicense || {};
  state.license = {
    licenseKey,
    productId: portal.product_id || meta.product_id || (state.license && state.license.productId) || '',
    planId: (verified && verified.plan_id) || portal.plan_id || meta.plan_id || '',
    planName: (verified && verified.plan_name) || meta.plan_name || (portal.plan && portal.plan.name) || '',
    status: (verified && verified.status) || 'active',
    validUntil: (verified && verified.valid_until) || portal.valid_until || null,
    updatesUntil: (verified && verified.updates_until) || portal.updates_until || null,
    graceDays: verified && verified.grace_days != null ? verified.grace_days : 0,
    features: (verified && verified.features) || featuresFromPortal(portal),
    activationLimit: portal.activation_limit != null ? portal.activation_limit : null,
    activationCount: portal.activation_count != null ? portal.activation_count : null,
    token: (verified && verified.token) || activated.token || '',
    lastVerifiedAt: new Date().toISOString(),
    invalid: false
  };
  state.clockSkew = false;
  state.lastSeenAt = Math.max(state.lastSeenAt || 0, Date.now());
  saveState();
  return state.license;
}

async function discoverAndActivate() {
  const data = (await authRequest('/portal/licenses')).data || {};
  const chosen = await pickPortalLicense(data.licenses || []);
  if (!chosen || !chosen.license_key) return { needsLicenseKey: true, user: publicUser() };
  const license = await activateKey(chosen.license_key, chosen);
  return { needsLicenseKey: false, user: publicUser(), license: publicLicense(license) };
}

/* ---------------- 对外状态 ---------------- */

function publicUser() {
  if (!state || !state.user) return null;
  return { email: state.user.email || '', name: state.user.name || '' };
}

function maskKey(key) {
  const value = String(key || '');
  if (value.length <= 8) return value ? '••••' : '';
  return value.slice(0, 4) + '••••••' + value.slice(-4);
}

function tokenExpiresAt(token) {
  const result = verifyToken(token || '', { identifier: machineId });
  if (!result.ok || !result.payload || !result.payload.exp) return null;
  return new Date(result.payload.exp * 1000).toISOString();
}

function publicLicense(lic) {
  if (!lic) return { present: false };
  return {
    present: true,
    status: lic.invalid ? 'invalid' : lic.status || 'active',
    planName: lic.planName || '',
    maskedKey: maskKey(lic.licenseKey),
    validUntil: lic.validUntil || null,
    updatesUntil: lic.updatesUntil || null,
    graceDays: lic.graceDays || 0,
    activationLimit: lic.activationLimit != null ? lic.activationLimit : null,
    activationCount: lic.activationCount != null ? lic.activationCount : null,
    features: lic.features || null,
    lastVerifiedAt: lic.lastVerifiedAt || null,
    tokenExpiresAt: tokenExpiresAt(lic.token)
  };
}

function publishCheck() {
  if (!state || !state.license) return { allowed: false, reason: 'not_activated' };
  if (state.license.invalid) return { allowed: false, reason: 'license_invalid' };
  if (state.clockSkew) return { allowed: false, reason: 'clock_skew' };
  const result = verifyToken(state.license.token || '', { identifier: machineId });
  if (!result.ok) return { allowed: false, reason: result.reason };
  return {
    allowed: true,
    reason: 'ok',
    expiresAt: result.payload.exp,
    offlineUntil: result.offlineUntil
  };
}

function getStatus() {
  const check = publishCheck();
  return {
    configured: true,
    baseUrl: BASE_URL,
    product: PRODUCT_SLUG,
    machineId,
    loggedIn: !!(state && state.session && state.session.refreshToken),
    user: publicUser(),
    license: publicLicense(state && state.license),
    publish: check,
    checkedAt: new Date().toISOString()
  };
}

/* ---------------- 登录 ---------------- */

async function sendLoginCode(email) {
  const address = normalizeEmail(email);
  try {
    await requestJson('/signup/' + encodeURIComponent(TRIAL_CHECKOUT_ID) + '/send', {
      method: 'POST',
      body: { email: address }
    });
  } catch (err) {
    if (err.status === 429) {
      throw httpError(
        429,
        err.code === 'SIGNUP_LIMIT_REACHED'
          ? '今日试用名额已用完，请明天再试'
          : '验证码发送过于频繁，请稍后再试',
        err.code || 'RATE_LIMITED'
      );
    }
    if (err.status === 404) {
      throw httpError(503, '试用授权领取暂未开放，请联系客服', 'SIGNUP_UNAVAILABLE');
    }
    throw err;
  }
  return { sent: true };
}

async function verifyLoginCode(email, code) {
  const address = normalizeEmail(email);
  const otp = String(code == null ? '' : code).trim();
  if (!/^\d{6}$/.test(otp)) throw httpError(400, '请输入 6 位验证码');

  let res;
  try {
    res = await fetch(BASE_URL + '/api/v1/signup/' + encodeURIComponent(TRIAL_CHECKOUT_ID) + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: address, code: otp }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw httpError(503, '无法连接授权服务，请检查网络后重试', 'KEYGATE_UNREACHABLE');
  }
  const text = await res.text();
  let data;
  try {
    data = parseEnvelope(res, text);
  } catch (err) {
    if (err.status === 401) throw httpError(401, '验证码错误或已过期', 'INVALID_CODE');
    if (err.status === 429) {
      throw httpError(
        429,
        err.code === 'SIGNUP_LIMIT_REACHED'
          ? '今日试用名额已用完，请明天再试'
          : '尝试次数过多，请稍后再试',
        err.code || 'RATE_LIMITED'
      );
    }
    if (err.status === 404) {
      throw httpError(503, '试用授权领取暂未开放，请联系客服', 'SIGNUP_UNAVAILABLE');
    }
    if (err.status === 409 && err.code === 'PLAN_CHANGED') {
      throw httpError(409, '试用套餐配置刚刚变更，请重试', 'PLAN_CHANGED');
    }
    throw err;
  }

  const refreshToken = cookieValue(readSetCookies(res), 'refresh_token');
  if (!refreshToken) {
    throw httpError(502, '授权服务未返回登录凭证，请稍后重试', 'LOGIN_FAILED');
  }

  state.user = {
    email: (data && data.email) || address,
    name: (data && data.name) || ''
  };
  state.session = { accessToken: '', refreshToken, accessExpiresAt: null };
  await refreshSession();

  let discovered;
  try {
    discovered = await discoverAndActivate();
  } catch (err) {
    if (err.code === 'LOGIN_REQUIRED') throw err;
    // 登录成功但发现/激活失败：保留登录态，让用户在面板里手动输入授权码。
    discovered = { needsLicenseKey: true, user: publicUser(), warning: err.message };
  }
  saveState();
  return Object.assign({ user: publicUser(), status: getStatus() }, discovered);
}

async function logout() {
  const token = state && state.session && state.session.accessToken;
  if (token) {
    try {
      await requestJson('/auth/logout', { method: 'POST', token });
    } catch (err) {
      // 退出登录不因网络失败而卡住；本地会话照常清除。
    }
  }
  state.session = null;
  state.user = null;
  saveState();
  return getStatus();
}

/* ---------------- 激活 / 解绑 / 续验 ---------------- */

async function activate(rawKey) {
  await activateKey(rawKey, null);
  return getStatus();
}

async function deactivate() {
  const lic = state && state.license;
  if (!lic || !lic.licenseKey) throw httpError(400, '当前没有已激活的授权');
  try {
    await requestJson('/license/deactivate', {
      method: 'POST',
      body: { license_key: lic.licenseKey, identifier: machineId }
    });
  } catch (err) {
    // 授权已不存在时也清掉本地状态；网络失败则保留，避免丢设备位。
    if (err.status !== 404) throw err;
  }
  state.license = null;
  saveState();
  return getStatus();
}

async function refresh() {
  const lic = state && state.license;
  if (!lic || !lic.licenseKey) throw httpError(400, '当前没有已激活的授权');
  try {
    const data = (await requestJson('/license/verify', {
      method: 'POST',
      body: { license_key: lic.licenseKey, identifier: machineId }
    })).data;
    applyVerifyData(data, lic);
    saveState();
  } catch (err) {
    if (err.status === 404 || err.code === 'LICENSE_NOT_FOUND') {
      lic.invalid = true;
      lic.status = 'invalid';
      lic.token = '';
      saveState();
    } else {
      throw err;
    }
  }
  return getStatus();
}

/* ---------------- 发布校验 ---------------- */

async function ensureFreshForPublish() {
  const check = publishCheck();
  if (!state || !state.license || !state.license.licenseKey) return;
  const dueSoon = check.allowed && check.expiresAt &&
    check.expiresAt * 1000 - Date.now() < PUBLISH_FRESH_MS;
  if (!check.allowed || dueSoon) {
    try {
      await refresh();
    } catch (err) {
      // 离线或服务不可用时保留现有 token，由 assertPublishLicense 判定。
    }
  }
}

function assertPublishLicense() {
  const check = publishCheck();
  if (!check.allowed) {
    const err = httpError(402, '发布功能需要有效授权', 'LICENSE_REQUIRED');
    err.details = { reason: check.reason, license: publicLicense(state && state.license) };
    throw err;
  }
}

function canPublishSync() {
  return publishCheck().allowed;
}

/* ---------------- 生命周期 ---------------- */

function init() {
  loadState();
  machineId = resolveMachineId();
  if (!state.machineId) state.machineId = machineId;

  const previousSeen = Number(state.lastSeenAt) || 0;
  const now = Date.now();
  if (previousSeen > 0 && now < previousSeen - CLOCK_SKEW_MS) {
    state.clockSkew = true;
  }
  state.lastSeenAt = Math.max(previousSeen, now);
  saveState();
  return getStatus();
}

function startRefreshTimer() {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    const lic = state && state.license;
    if (!lic || !lic.licenseKey) return;
    refresh().catch(() => {
      // 后台续验失败静默处理；离线宽限由 token exp 决定。
    });
  }, REFRESH_MS);
  if (refreshTimer.unref) refreshTimer.unref();

  const lic = state && state.license;
  if (lic && lic.licenseKey) {
    const kick = setTimeout(() => {
      refresh().catch(() => {});
    }, 5000);
    if (kick.unref) kick.unref();
  }
}

function stopRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

module.exports = {
  init,
  startRefreshTimer,
  stopRefreshTimer,
  getStatus,
  sendLoginCode,
  verifyLoginCode,
  logout,
  activate,
  deactivate,
  refresh,
  ensureFreshForPublish,
  assertPublishLicense,
  canPublishSync,
  publishCheck,
  verifyToken
};
