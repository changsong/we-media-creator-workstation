'use strict';

/**
 * 运营账号注册表。
 *
 * 每个账号是一套独立工作区：默认账号沿用 data/ 根目录，新账号放在
 * data/accounts/<id>/。账号列表与上次使用记录保存在 data/accounts.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const accountContext = require('./account-context');

const REGISTRY_FILE = path.join(db.DATA_DIR, 'accounts.json');
const DEFAULT_ID = accountContext.DEFAULT_ACCOUNT_ID;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function nowIso() {
  return new Date().toISOString();
}

function readRegistry() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.accounts) || !parsed.accounts.length) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function writeRegistry(registry) {
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  const tmp = REGISTRY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
  fs.renameSync(tmp, REGISTRY_FILE);
}

/** 首次升级时创建默认账号；已有注册表时补齐默认账号与合法 activeAccountId */
function ensureRegistry() {
  let registry = readRegistry();
  if (!registry) {
    registry = {
      version: 1,
      activeAccountId: DEFAULT_ID,
      accounts: [{ id: DEFAULT_ID, name: '', createdAt: nowIso(), lastActiveAt: nowIso() }]
    };
    writeRegistry(registry);
    return registry;
  }
  let changed = false;
  if (!registry.accounts.some((account) => account.id === DEFAULT_ID)) {
    registry.accounts.unshift({ id: DEFAULT_ID, name: '', createdAt: nowIso(), lastActiveAt: null });
    changed = true;
  }
  registry.accounts.forEach((account) => {
    if (!account.createdAt) {
      account.createdAt = nowIso();
      changed = true;
    }
    if (typeof account.name !== 'string') {
      account.name = '';
      changed = true;
    }
  });
  if (!registry.accounts.some((account) => account.id === registry.activeAccountId)) {
    registry.activeAccountId = DEFAULT_ID;
    changed = true;
  }
  if (changed) writeRegistry(registry);
  return registry;
}

function listIds() {
  return ensureRegistry().accounts.map((account) => account.id);
}

function getActiveId() {
  return ensureRegistry().activeAccountId || DEFAULT_ID;
}

function exists(accountId) {
  return ensureRegistry().accounts.some((account) => account.id === accountId);
}

/** 解析请求里携带的账号 ID；未知或非法时返回 null（由调用方回落到上次使用） */
function resolveId(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || !ID_RE.test(text)) return null;
  return exists(text) ? text : null;
}

function setActive(accountId) {
  const registry = ensureRegistry();
  const account = registry.accounts.find((item) => item.id === accountId);
  if (!account) throw httpError(404, '账号不存在');
  account.lastActiveAt = nowIso();
  registry.activeAccountId = account.id;
  writeRegistry(registry);
  return account;
}

function validateName(value) {
  const profile = require('./profile');
  const name = String(value == null ? '' : value).trim();
  if (!name) throw httpError(400, '账号名称不能为空');
  if (name.length > profile.NAME_MAX) {
    throw httpError(400, `账号名称最多 ${profile.NAME_MAX} 个字符`);
  }
  if (/[\r\n\t]/.test(name)) throw httpError(400, '账号名称不能包含换行或制表符');
  return name;
}

function channelSummary() {
  try {
    const channelConnections = require('./channel-connections');
    const data = channelConnections.getAll();
    let connected = 0;
    let total = 0;
    data.platforms.forEach((platform) => {
      if (data.defs[platform] && data.defs[platform].group === 'data') return;
      total++;
      if (data.connections[platform] && data.connections[platform].enabled) connected++;
    });
    return { connected, total };
  } catch (err) {
    return { connected: 0, total: 8 };
  }
}

function describe(account) {
  return accountContext.run(account.id, () => {
    let profile = null;
    try {
      profile = require('./profile').getProfile();
    } catch (err) {
      profile = null;
    }
    return {
      id: account.id,
      name: (profile && profile.name) || account.name || '账号',
      hasAvatar: !!(profile && profile.hasAvatar),
      avatarUrl: profile ? profile.avatarUrl : '/assets/img-4.png',
      channels: channelSummary(),
      createdAt: account.createdAt || null,
      lastActiveAt: account.lastActiveAt || null,
      system: account.id === DEFAULT_ID
    };
  });
}

function list() {
  const registry = ensureRegistry();
  return {
    activeAccountId: registry.activeAccountId || DEFAULT_ID,
    accounts: registry.accounts.map(describe)
  };
}

function create(body) {
  const name = validateName(body && body.name);
  const registry = ensureRegistry();
  let id = '';
  do {
    id = 'acc_' + crypto.randomBytes(4).toString('hex');
  } while (registry.accounts.some((account) => account.id === id));
  const root = db.accountRoot(id);
  fs.mkdirSync(root, { recursive: true });
  try {
    accountContext.run(id, () => {
      db.open();
      require('./profile').updateName(name);
    });
  } catch (err) {
    try {
      db.closeAccount(id);
    } catch (e) {
      /* 忽略 */
    }
    fs.rmSync(root, { recursive: true, force: true });
    throw err;
  }
  const account = { id, name, createdAt: nowIso(), lastActiveAt: null };
  registry.accounts.push(account);
  writeRegistry(registry);
  return describe(account);
}

function rename(accountId, body) {
  const name = validateName(body && body.name);
  const registry = ensureRegistry();
  const account = registry.accounts.find((item) => item.id === accountId);
  if (!account) throw httpError(404, '账号不存在');
  accountContext.run(accountId, () => {
    require('./profile').updateName(name);
  });
  account.name = name;
  writeRegistry(registry);
  return describe(account);
}

/** 删除账号：先把整个账号目录移到 legacy/accounts 下，避免误删无法恢复 */
function remove(accountId) {
  if (accountId === DEFAULT_ID) throw httpError(400, '默认账号不能删除');
  const registry = ensureRegistry();
  const account = registry.accounts.find((item) => item.id === accountId);
  if (!account) throw httpError(404, '账号不存在');

  const root = db.accountRoot(accountId);
  db.closeAccount(accountId);
  if (fs.existsSync(root)) {
    const targetDir = path.join(db.LEGACY_DIR, 'accounts');
    fs.mkdirSync(targetDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(targetDir, `${accountId}-${stamp}`);
    try {
      fs.renameSync(root, target);
    } catch (err) {
      throw httpError(409, '账号目录正被浏览器占用，请先关闭该账号的登录窗口后重试');
    }
  }
  registry.accounts = registry.accounts.filter((item) => item.id !== accountId);
  if (registry.activeAccountId === accountId) registry.activeAccountId = DEFAULT_ID;
  writeRegistry(registry);
  return { ok: true, backupDir: path.join(db.LEGACY_DIR, 'accounts') };
}

module.exports = {
  DEFAULT_ID,
  REGISTRY_FILE,
  ensureRegistry,
  listIds,
  getActiveId,
  resolveId,
  setActive,
  list,
  create,
  rename,
  remove
};
