'use strict';

/**
 * 住宅代理配置（每个用户本机独立）。
 *
 * 落盘 data/proxy.json（受 WB_DATA_DIR 控制，打包分发给不同创作者时各自独立）。
 * 密钥沿用 channel-connections 的约定：读取掩码、写入支持 KEEP 哨兵。
 *
 * 环境变量优先于文件：WB_PROXY_ENABLED / SCHEME / HOST / PORT / USER / PASS /
 * SESSION / TEMPLATE / AUTO_ROTATE。env 提供的密码不会回传到前端。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');
const tunnel = require('./proxy-tunnel');

const CONFIG_PATH = path.join(DATA_DIR, 'proxy.json');
const KEEP = '__KEEP_EXISTING__';
const MASK = '••••••••';
const DEFAULT_SCHEME = 'http';
const PROBE_HOST = 'www.douyin.com';
const PROBE_PORT = 443;
const EXIT_IP_URL = 'http://api.ipify.org?format=json';

const ENV_KEYS = [
  'WB_PROXY_ENABLED',
  'WB_PROXY_SCHEME',
  'WB_PROXY_HOST',
  'WB_PROXY_PORT',
  'WB_PROXY_USER',
  'WB_PROXY_PASS',
  'WB_PROXY_SESSION',
  'WB_PROXY_TEMPLATE',
  'WB_PROXY_AUTO_ROTATE'
];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function hasEnv(name) {
  return process.env[name] !== undefined && process.env[name] !== '';
}

function newSessionId() {
  return crypto.randomBytes(4).toString('hex');
}

function isTrue(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeRaw(file) {
  const src = file && typeof file === 'object' ? file : {};
  const out = {
    enabled: isTrue(src.enabled),
    scheme: String(src.scheme || DEFAULT_SCHEME).toLowerCase(),
    host: String(src.host || '').trim(),
    port: Number(src.port) || 0,
    username: String(src.username || ''),
    password: String(src.password || ''),
    sessionTemplate: String(src.sessionTemplate || ''),
    sessionId: String(src.sessionId || ''),
    autoRotate: isTrue(src.autoRotate),
    updatedAt: src.updatedAt || null
  };
  return out;
}

function applyEnv(raw) {
  if (hasEnv('WB_PROXY_ENABLED')) raw.enabled = isTrue(process.env.WB_PROXY_ENABLED);
  if (hasEnv('WB_PROXY_SCHEME')) raw.scheme = String(process.env.WB_PROXY_SCHEME).toLowerCase();
  if (hasEnv('WB_PROXY_HOST')) raw.host = String(process.env.WB_PROXY_HOST).trim();
  if (hasEnv('WB_PROXY_PORT')) raw.port = Number(process.env.WB_PROXY_PORT) || 0;
  if (hasEnv('WB_PROXY_USER')) raw.username = String(process.env.WB_PROXY_USER);
  if (hasEnv('WB_PROXY_PASS')) raw.password = String(process.env.WB_PROXY_PASS);
  if (hasEnv('WB_PROXY_SESSION')) raw.sessionId = String(process.env.WB_PROXY_SESSION);
  if (hasEnv('WB_PROXY_TEMPLATE')) raw.sessionTemplate = String(process.env.WB_PROXY_TEMPLATE);
  if (hasEnv('WB_PROXY_AUTO_ROTATE')) raw.autoRotate = isTrue(process.env.WB_PROXY_AUTO_ROTATE);
  return raw;
}

function readFileRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeFileRaw(raw) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

/** 只读取文件 + 默认值，不叠加环境变量（写入时用） */
function readStored() {
  return normalizeRaw(readFileRaw());
}

/** 有效配置：文件 + 环境变量覆盖；缺 sessionId 时生成并持久化以保证跨重启稳定 */
function getRaw() {
  const raw = applyEnv(readStored());
  raw.scheme = String(raw.scheme || DEFAULT_SCHEME).toLowerCase();
  raw.host = String(raw.host || '').trim();
  raw.port = Number(raw.port) || 0;
  raw.username = String(raw.username || '');
  raw.password = String(raw.password || '');
  raw.sessionTemplate = String(raw.sessionTemplate || '');
  raw.sessionId = String(raw.sessionId || '');
  if (!raw.sessionId) {
    raw.sessionId = newSessionId();
    if (!hasEnv('WB_PROXY_SESSION')) {
      try {
        writeFileRaw(Object.assign(readStored(), { sessionId: raw.sessionId }));
      } catch (err) {
        /* 落盘失败不阻塞使用 */
      }
    }
  }
  return raw;
}

function isComplete(raw) {
  return !!(
    raw &&
    raw.host &&
    Number(raw.port) > 0 &&
    raw.username &&
    raw.password &&
    String(raw.scheme || 'http').toLowerCase() === 'http'
  );
}

function resolveUsername(raw) {
  const username = String(raw.username || '');
  const template = String(raw.sessionTemplate || '');
  if (template && /\{session\}/.test(template)) {
    return template.split('{session}').join(String(raw.sessionId || ''));
  }
  return username;
}

function envInfo() {
  return {
    any: ENV_KEYS.some(hasEnv),
    password: hasEnv('WB_PROXY_PASS'),
    session: hasEnv('WB_PROXY_SESSION'),
    enabled: hasEnv('WB_PROXY_ENABLED')
  };
}

function getPublic() {
  const raw = getRaw();
  const env = envInfo();
  return {
    enabled: !!raw.enabled,
    configured: isComplete(raw),
    scheme: raw.scheme,
    host: raw.host,
    port: Number(raw.port) || 0,
    username: raw.username,
    password: { value: raw.password ? MASK : '', hasValue: !!raw.password },
    sessionTemplate: raw.sessionTemplate,
    sessionId: raw.sessionId,
    sticky: /\{session\}/.test(String(raw.sessionTemplate || '')),
    autoRotate: !!raw.autoRotate,
    updatedAt: raw.updatedAt || null,
    envOverride: env.any,
    envControlled: env
  };
}

function save(body) {
  const incoming = body || {};
  const next = readStored();

  ['scheme', 'host', 'username', 'sessionTemplate'].forEach((key) => {
    if (hasOwn(incoming, key)) {
      next[key] = String(incoming[key] == null ? '' : incoming[key]).trim();
    }
  });
  if (hasOwn(incoming, 'port')) next.port = Number(incoming.port) || 0;
  if (hasOwn(incoming, 'enabled')) next.enabled = isTrue(incoming.enabled);
  if (hasOwn(incoming, 'autoRotate')) next.autoRotate = isTrue(incoming.autoRotate);
  if (hasOwn(incoming, 'password') && incoming.password !== KEEP) {
    next.password = incoming.password == null ? '' : String(incoming.password).trim();
  }

  next.scheme = String(next.scheme || DEFAULT_SCHEME).toLowerCase();
  if (next.scheme !== 'http') {
    throw httpError(400, '当前仅支持 HTTP 代理（不支持 ' + next.scheme + '）');
  }
  next.host = String(next.host || '').trim();
  next.port = Number(next.port) || 0;
  next.username = String(next.username || '');
  next.password = String(next.password || '');
  next.sessionTemplate = String(next.sessionTemplate || '');
  if (!next.sessionId) next.sessionId = newSessionId();
  next.updatedAt = new Date().toISOString();

  // 启用时必须完整；用环境变量覆盖后的有效值判断，避免 env 配置被误判为不完整
  const effective = applyEnv(normalizeRaw(next));
  if (effective.enabled && !isComplete(effective)) {
    throw httpError(400, '启用代理前请先填写主机、端口、用户名与密码');
  }

  writeFileRaw(next);
  return getPublic();
}

function launchSpec() {
  const raw = getRaw();
  if (!raw.enabled) return null;
  if (!isComplete(raw)) {
    throw httpError(400, '网络代理已启用但配置不完整，请到「连接设置 · 网络代理」补全主机、端口、用户名与密码');
  }
  return {
    scheme: raw.scheme,
    host: raw.host,
    port: Number(raw.port),
    username: resolveUsername(raw),
    password: raw.password
  };
}

/** 代理解析参数的签名：用于判断复用中的浏览器是否是同一代理配置（密码只进哈希） */
function signature(spec) {
  if (!spec) return 'direct';
  const hash = crypto.createHash('sha256');
  hash.update(
    [spec.scheme || 'http', spec.host || '', String(spec.port || ''), spec.username || '', spec.password || ''].join('\n')
  );
  return 'proxy:' + hash.digest('hex');
}

function rotateSession() {
  if (hasEnv('WB_PROXY_SESSION')) {
    throw httpError(409, '代理会话由环境变量 WB_PROXY_SESSION 控制，无法在界面更换出口 IP');
  }
  if (hasEnv('WB_PROXY_USER') && hasEnv('WB_PROXY_PASS')) {
    throw httpError(409, '代理账号由环境变量控制，无法在界面更换出口 IP');
  }
  const next = readStored();
  next.sessionId = newSessionId();
  next.updatedAt = new Date().toISOString();
  writeFileRaw(next);
  const pub = getPublic();
  if (!pub.sticky) {
    pub.note = '未设置包含 {session} 的会话模板，能否固定出口 IP 取决于代理商';
  }
  return pub;
}

function candidateFrom(body) {
  const raw = getRaw();
  const incoming = body || {};
  const pick = (key, fallback) => (hasOwn(incoming, key) ? incoming[key] : fallback);
  let password = raw.password;
  if (hasOwn(incoming, 'password') && incoming.password !== KEEP) {
    password = incoming.password == null ? '' : String(incoming.password).trim();
  }
  const candidate = {
    scheme: String(pick('scheme', raw.scheme) || 'http').toLowerCase(),
    host: String(pick('host', raw.host) || '').trim(),
    port: Number(pick('port', raw.port)) || 0,
    username: String(pick('username', raw.username) || '').trim(),
    password: String(password || ''),
    sessionTemplate: String(pick('sessionTemplate', raw.sessionTemplate) || ''),
    sessionId: raw.sessionId
  };
  candidate.username = resolveUsername(candidate);
  return candidate;
}

async function test(body) {
  const spec = candidateFrom(body);
  if (!spec.host || !spec.port || !spec.username || !spec.password) {
    throw httpError(400, '请填写完整的代理主机、端口、用户名与密码');
  }
  if (spec.scheme !== 'http') {
    throw httpError(400, '当前仅支持 HTTP 代理（不支持 ' + spec.scheme + '）');
  }

  let probe;
  try {
    probe = await tunnel.probeConnect({
      upstream: spec,
      auth: { username: spec.username, password: spec.password },
      targetHost: PROBE_HOST,
      targetPort: PROBE_PORT,
      timeoutMs: 12000
    });
  } catch (err) {
    const status = err && err.code === 'ETIMEDOUT' ? 504 : 502;
    throw httpError(status, '连接代理失败：' + (err && err.message ? err.message : '网络错误'));
  }

  if (!probe.ok) {
    if (probe.statusCode === 407) throw httpError(502, '代理认证失败（407），请检查用户名与密码');
    throw httpError(502, '代理隧道建立失败（HTTP ' + (probe.statusCode || '无响应') + '）');
  }

  let exitIp = '';
  try {
    const res = await tunnel.probeHttpGet({
      upstream: spec,
      auth: { username: spec.username, password: spec.password },
      url: EXIT_IP_URL,
      timeoutMs: 8000
    });
    const match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec((res && res.body) || '');
    if (match) exitIp = match[1];
  } catch (err) {
    /* 出口 IP 查询失败不影响“代理可用”的结论 */
  }

  return {
    ok: true,
    message: exitIp ? '代理可用，出口 IP ' + exitIp : '代理可用',
    latencyMs: probe.latencyMs,
    exitIp
  };
}

module.exports = {
  KEEP,
  MASK,
  CONFIG_PATH,
  getRaw,
  getPublic,
  save,
  launchSpec,
  signature,
  rotateSession,
  test,
  isComplete
};
