'use strict';

/**
 * 海外渠道 OAuth 授权（YouTube / TikTok）。
 *
 * 流程：用户在连接卡填好 Client ID/Secret → 点「授权连接」→ 打开独立浏览器
 * 完成同意页 → 回调到本机 loopback 地址 → 换取并保存令牌。
 * 令牌按账号存放在 <accountRoot>/oauth-tokens.json，读取时只返回状态。
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const accountContext = require('./account-context');
const channelConnections = require('./channel-connections');
const browserLogin = require('./browser-login');
const proxyConfig = require('./proxy-config');
const httpClient = require('./http-proxy-agent');

const PENDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
const pending = new Map(); // state -> 授权会话
const refreshing = new Map(); // accountId:provider -> Promise

let serverPort = 5180;

function configure(options) {
  if (options && Number(options.port)) serverPort = Number(options.port);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    idKey: 'Client ID',
    secretKey: 'Client Secret',
    pkce: true
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: 'user.info.basic,video.upload',
    idKey: 'Client Key',
    secretKey: 'Client Secret',
    pkce: false
  }
};

function platformProvider(platform) {
  const def = channelConnections.DEFS[platform];
  return def && def.oauth ? def.oauth.provider : null;
}

function redirectUri(platform) {
  return 'http://127.0.0.1:' + serverPort + '/api/oauth/' + encodeURIComponent(platform) + '/callback';
}

function currentProxy() {
  try {
    return proxyConfig.launchSpec();
  } catch (err) {
    return null;
  }
}

function tokenPath(accountId) {
  return path.join(db.accountRoot(accountId || accountContext.currentOrDefault()), 'oauth-tokens.json');
}

function readTokens(accountId) {
  try {
    const raw = fs.readFileSync(tokenPath(accountId), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch (err) {
    return {};
  }
}

function writeTokens(accountId, data) {
  const file = tokenPath(accountId);
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function tokenBucket(provider) {
  return String(provider || '').toLowerCase();
}

function credentialValues(platform, provider) {
  const cfg = PROVIDERS[provider];
  const raw = channelConnections.getRaw(platform);
  const fields = (raw && raw.fields) || {};
  const clientId = String(fields[cfg.idKey] || '').trim();
  const clientSecret = String(fields[cfg.secretKey] || '').trim();
  if (!clientId || !clientSecret) {
    throw httpError(400, '请先保存 ' + cfg.idKey + ' 和 ' + cfg.secretKey + '，再发起授权');
  }
  return { clientId, clientSecret };
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildAuthUrl(platform, provider, clientId, state, verifier, redirect) {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams();
  if (provider === 'tiktok') params.set('client_key', clientId);
  else params.set('client_id', clientId);
  params.set('response_type', 'code');
  params.set('redirect_uri', redirect);
  params.set('scope', cfg.scope);
  params.set('state', state);
  if (cfg.pkce && verifier) {
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', 'S256');
  }
  if (provider === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
  }
  return cfg.authUrl + '?' + params.toString();
}

function accountPending(platform, accountId) {
  let found = null;
  for (const item of pending.values()) {
    if (item.platform !== platform || item.accountId !== accountId) continue;
    if (!found || item.createdAt > found.createdAt) found = item;
  }
  return found;
}

function expireStale(now) {
  for (const [state, item] of pending) {
    if (now - item.createdAt < PENDING_TTL_MS) continue;
    if (item.status === 'waiting') {
      item.status = 'error';
      item.message = '授权超时，请重新发起';
      item.finishedAt = Date.now();
      releasePending(item);
    } else if (now - item.createdAt > PENDING_TTL_MS * 3) {
      pending.delete(state);
    }
  }
}

function releasePending(item) {
  if (!item) return;
  const browser = item.browser;
  item.browser = null;
  if (browser) {
    browserLogin.closeBrowser(browser).catch(() => {});
  }
  if (item.owner) {
    browserLogin.release(item.owner);
    item.owner = null;
  }
}

function publicStatus(item, platform) {
  if (!item) {
    return { platform, status: 'idle', message: '', redirectUri: redirectUri(platform) };
  }
  return {
    platform,
    status: item.status,
    message: item.message || '',
    redirectUri: item.redirectUri,
    startedAt: item.startedAt || null,
    finishedAt: item.finishedAt ? new Date(item.finishedAt).toISOString() : null
  };
}

async function start(platform) {
  const provider = platformProvider(platform);
  if (!provider) throw httpError(400, '该渠道不支持 OAuth 授权');
  const accountId = accountContext.currentOrDefault();
  const { clientId } = credentialValues(platform, provider);

  // 同一账号下重复点击：先取消上一次未完成的会话
  const previous = accountPending(platform, accountId);
  if (previous && (previous.status === 'waiting' || previous.status === 'launching')) {
    previous.status = 'cancelled';
    previous.message = '已重新发起授权';
    previous.finishedAt = Date.now();
    releasePending(previous);
  }

  const state = base64url(crypto.randomBytes(24));
  const verifier = PROVIDERS[provider].pkce ? base64url(crypto.randomBytes(32)) : null;
  const redirect = redirectUri(platform);
  const authUrl = buildAuthUrl(platform, provider, clientId, state, verifier, redirect);

  const item = {
    state,
    platform,
    provider,
    accountId,
    verifier,
    redirectUri: redirect,
    status: 'waiting',
    message: '请在打开的浏览器窗口完成授权',
    createdAt: Date.now(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    browser: null,
    owner: 'oauth:' + platform + ':' + state
  };
  pending.set(state, item);

  try {
    browserLogin.acquire(item.owner);
  } catch (err) {
    item.status = 'error';
    item.message = err.message || '浏览器正忙，请稍后再试';
    item.finishedAt = Date.now();
    throw err;
  }

  try {
    item.browser = await browserLogin.ensureBrowser({
      url: authUrl,
      headless: false,
      profileDir: db.browserProfileDir(accountId),
      proxy: currentProxy()
    });
  } catch (err) {
    item.status = 'error';
    item.message = '打开授权窗口失败：' + (err.message || '未知错误');
    item.finishedAt = Date.now();
    releasePending(item);
    throw httpError(500, item.message);
  }

  return { status: 'waiting', authUrl, redirectUri: redirect, message: item.message };
}

function status(platform) {
  expireStale(Date.now());
  const accountId = accountContext.currentOrDefault();
  return publicStatus(accountPending(platform, accountId), platform);
}

function tokenStatus(platform) {
  const provider = platformProvider(platform);
  if (!provider) return { connected: false };
  const rec = readTokens()[tokenBucket(provider)];
  if (!rec || !rec.accessToken) return { connected: false };
  return {
    connected: true,
    accountLabel: rec.accountLabel || '',
    expiresAt: rec.expiresAt ? new Date(rec.expiresAt).toISOString() : null,
    scope: rec.scope || ''
  };
}

function tokenError(res) {
  const json = res && res.json ? res.json : {};
  return (
    json.error_description ||
    json.message ||
    json.error ||
    (res && res.text ? String(res.text).slice(0, 200) : '') ||
    'OAuth 请求失败（HTTP ' + (res ? res.status : '未知') + '）'
  );
}

async function exchangeWithCredentials(platform, provider, code, redirect, clientId, clientSecret, accountId, verifier) {
  const cfg = PROVIDERS[provider];
  if (!clientId || !clientSecret) {
    const creds = credentialValues(platform, provider);
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;
  }
  const form = new URLSearchParams();
  if (provider === 'tiktok') form.set('client_key', clientId);
  else form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  form.set('code', code);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', redirect);
  if (cfg.pkce && verifier) form.set('code_verifier', verifier);

  const res = await httpClient.requestJson(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    proxy: currentProxy(),
    timeoutMs: 30000
  });

  if (res.status >= 400 || !res.json || !res.json.access_token) {
    throw httpError(res.status >= 400 ? res.status : 502, tokenError(res));
  }

  const json = res.json;
  const record = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || '',
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    scope: json.scope || cfg.scope,
    tokenType: json.token_type || 'Bearer',
    accountLabel: '',
    updatedAt: new Date().toISOString()
  };
  if (provider === 'tiktok' && json.access_token) {
    record.accountLabel = (await fetchTikTokName(json.access_token)) || '';
  }

  const all = readTokens(accountId);
  all[tokenBucket(provider)] = record;
  writeTokens(accountId, all);

  accountContext.run(accountId, () => {
    try {
      channelConnections.save(platform, { enabled: true });
    } catch (err) {
      /* 连接记录不可写不影响令牌可用 */
    }
  });

  return record;
}

async function fetchTikTokName(accessToken) {
  try {
    const res = await httpClient.requestJson(
      'https://open.tiktokapis.com/v2/user/info/?fields=display_name',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + accessToken },
        proxy: currentProxy(),
        timeoutMs: 15000
      }
    );
    const user = res.json && res.json.data && res.json.data.user;
    return (user && user.display_name) || '';
  } catch (err) {
    return '';
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function sendHtml(res, statusCode, title, message) {
  const html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' +
    escapeHtml(title) +
    '</title></head><body style="margin:0;font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif;background:#f7f6f2;color:#2c2c2a;display:flex;min-height:100vh;align-items:center;justify-content:center">' +
    '<div style="max-width:420px;padding:32px;text-align:center"><h2 style="margin:0 0 12px;font-size:20px">' +
    escapeHtml(title) +
    '</h2><p style="margin:0;color:#6b6b66;line-height:1.6">' +
    escapeHtml(message) +
    '</p></div></body></html>';
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleCallback(req, res, url) {
  const parts = url.pathname.split('/');
  const platform = decodeURIComponent(parts[3] || '');
  if (parts[4] !== 'callback') {
    return sendHtml(res, 404, '授权回调无效', '未找到对应的授权回调地址');
  }
  const provider = platformProvider(platform);
  if (!provider) {
    return sendHtml(res, 404, '未知渠道', '该平台不支持 OAuth 授权');
  }

  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';

  expireStale(Date.now());
  const item = pending.get(state);
  if (!item || item.platform !== platform) {
    return sendHtml(res, 400, '授权已失效', '请回到工作台重新点击「授权连接」');
  }

  if (error) {
    item.status = 'error';
    item.message = url.searchParams.get('error_description') || error;
    item.finishedAt = Date.now();
    releasePending(item);
    return sendHtml(res, 400, '授权未完成', item.message);
  }
  if (!code) {
    return sendHtml(res, 400, '授权未完成', '未收到授权码，请重新发起授权');
  }

  try {
    await accountContext.run(item.accountId, () =>
      exchangeWithCredentials(platform, provider, code, item.redirectUri, null, null, item.accountId, item.verifier)
    );
    item.status = 'success';
    item.message = '授权成功';
    item.finishedAt = Date.now();
    releasePending(item);
    return sendHtml(res, 200, '授权成功', '可以关闭此窗口，回到工作台继续操作。');
  } catch (err) {
    item.status = 'error';
    item.message = err.message || '换取令牌失败';
    item.finishedAt = Date.now();
    releasePending(item);
    return sendHtml(res, 400, '授权失败', item.message);
  }
}

async function manual(platform, input) {
  const provider = platformProvider(platform);
  if (!provider) throw httpError(400, '该渠道不支持 OAuth 授权');
  const text = String(input || '').trim();
  if (!text) throw httpError(400, '请粘贴回调地址或授权码');

  let code = text;
  let state = '';
  if (/^https?:\/\//i.test(text)) {
    let parsed;
    try {
      parsed = new URL(text);
    } catch (err) {
      throw httpError(400, '回调地址无法解析');
    }
    const err = parsed.searchParams.get('error');
    if (err) throw httpError(400, parsed.searchParams.get('error_description') || err);
    code = parsed.searchParams.get('code') || '';
    state = parsed.searchParams.get('state') || '';
  }
  if (!code) throw httpError(400, '回调地址里没有授权码');

  expireStale(Date.now());
  const accountId = accountContext.currentOrDefault();
  let item = state ? pending.get(state) : null;
  if (item && item.platform !== platform) item = null;
  if (!item) item = accountPending(platform, accountId);
  if (!item) {
    if (provider === 'google') {
      throw httpError(400, '未找到授权会话（可能已超时），请重新点击「授权连接」');
    }
    item = {
      platform,
      provider,
      accountId,
      verifier: null,
      redirectUri: redirectUri(platform),
      status: 'waiting',
      createdAt: Date.now()
    };
  }

  await accountContext.run(accountId, () =>
    exchangeWithCredentials(platform, provider, code, item.redirectUri, null, null, accountId, item.verifier)
  );
  item.status = 'success';
  item.message = '授权成功';
  item.finishedAt = Date.now();
  releasePending(item);
  return { status: 'success', message: '授权成功', token: tokenStatus(platform) };
}

function cancel(platform) {
  const accountId = accountContext.currentOrDefault();
  const item = accountPending(platform, accountId);
  if (!item) return publicStatus(null, platform);
  if (item.status === 'waiting' || item.status === 'launching') {
    item.status = 'cancelled';
    item.message = '已取消授权';
    item.finishedAt = Date.now();
    releasePending(item);
  }
  return publicStatus(item, platform);
}

function disconnect(platform) {
  const provider = platformProvider(platform);
  if (!provider) throw httpError(400, '该渠道不支持 OAuth 授权');
  const accountId = accountContext.currentOrDefault();
  const all = readTokens(accountId);
  delete all[tokenBucket(provider)];
  writeTokens(accountId, all);
  return { ok: true };
}

async function refreshAccessToken(platform, provider, record, accountId, bucket) {
  const cfg = PROVIDERS[provider];
  const { clientId, clientSecret } = credentialValues(platform, provider);
  const form = new URLSearchParams();
  if (provider === 'tiktok') form.set('client_key', clientId);
  else form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  form.set('refresh_token', record.refreshToken);
  form.set('grant_type', 'refresh_token');

  const res = await httpClient.requestJson(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    proxy: currentProxy(),
    timeoutMs: 30000
  });

  if (res.status >= 400 || !res.json || !res.json.access_token) {
    const message = tokenError(res);
    if (/invalid_grant|invalid_token/i.test(message + ' ' + (res.json && res.json.error))) {
      const all = readTokens(accountId);
      delete all[bucket];
      writeTokens(accountId, all);
    }
    throw httpError(401, platform + ' 授权已失效，请到「连接设置」重新授权：' + message);
  }

  const json = res.json;
  const next = Object.assign({}, record, {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || record.refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    scope: json.scope || record.scope,
    updatedAt: new Date().toISOString()
  });
  const all = readTokens(accountId);
  all[bucket] = next;
  writeTokens(accountId, all);
  return next.accessToken;
}

/** 强制刷新一次令牌（接口返回 401 时使用），失败按常规错误抛出。 */
async function forceRefresh(platform) {
  const provider = platformProvider(platform);
  if (!provider) throw httpError(400, '该渠道不支持 OAuth 授权');
  const accountId = accountContext.currentOrDefault();
  const bucket = tokenBucket(provider);
  const record = readTokens(accountId)[bucket];
  if (!record || !record.refreshToken) {
    throw httpError(401, '尚未完成 ' + platform + ' 授权，请到「连接设置」点「授权连接」');
  }
  return refreshAccessToken(platform, provider, record, accountId, bucket);
}

async function getAccessToken(platform) {
  const provider = platformProvider(platform);
  if (!provider) throw httpError(400, '该渠道不支持 OAuth 授权');
  const accountId = accountContext.currentOrDefault();
  const bucket = tokenBucket(provider);
  const record = readTokens(accountId)[bucket];
  if (!record || !record.accessToken) {
    throw httpError(401, '尚未完成 ' + platform + ' 授权，请到「连接设置」点「授权连接」');
  }
  if (record.expiresAt && record.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
    return record.accessToken;
  }
  if (!record.refreshToken) {
    throw httpError(401, platform + ' 授权已过期，请重新授权');
  }

  const key = accountId + ':' + bucket;
  if (refreshing.has(key)) return refreshing.get(key);
  const task = refreshAccessToken(platform, provider, record, accountId, bucket).finally(() => {
    refreshing.delete(key);
  });
  refreshing.set(key, task);
  return task;
}

module.exports = {
  configure,
  start,
  status,
  manual,
  handleCallback,
  cancel,
  tokenStatus,
  getAccessToken,
  forceRefresh,
  disconnect,
  redirectUri
};
