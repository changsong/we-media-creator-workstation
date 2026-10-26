'use strict';

/**
 * 渠道连接设置（统一存储，零依赖）。
 *
 * 为「连接设置」模块提供后端支撑：按平台存储各渠道的连接凭证与开关。
 * 所有渠道统一使用登录 Cookie（抖音 / 视频号 / 快手 / 微博 / 公众号 /
 * 小红书 / B 站 / 知乎），数据采集与自动发布都复用浏览器的登录态。
 *
 * 数据落盘在 data/channel-connections.json，结构：
 *   { "<平台>": { enabled:bool, fields:{ "<字段名>": "<值>" }, updatedAt:"ISO" } }
 *
 * 安全：密钥类字段在「读取」时一律掩码（返回 '••••••••' 且仅告知 hasValue），
 * 不回传明文；写入时若某密钥字段传 '__KEEP_EXISTING__' 则保留原值，传 '' 则清空。
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const browserLogin = require('./browser-login');

const CONFIG_PATH = path.join(DATA_DIR, 'channel-connections.json');
const KEEP = '__KEEP_EXISTING__';
const MASK = '••••••••';

/**
 * 各渠道连接字段定义（单一信息源，前端直接复用，无需重复声明）。
 *  - note：该渠道打通接口的方式与前提，如实说明。
 *  - apiMode：cookie（登录 Cookie，有风控）/ custom（自定义）。
 *  - fields：凭证字段，secret:true 的字段在读取时掩码、写入支持保留哨兵。
 */
const DEFS = {
  '抖音': {
    apiMode: 'cookie',
    docs: 'https://www.douyin.com/user/self',
    note: '点击「一键登录获取 Cookie」打开独立浏览器窗口，登录抖音后自动回填并保存，后续据此读取个人作品数据。',
    fields: [
      { key: '用户 ID', secret: false, optional: true },
      { key: 'Cookie', secret: true }
    ],
    login: {
      url: 'https://www.douyin.com/user/self',
      cookieDomain: 'douyin.com',
      detect: [['sessionid', 'sessionid_ss']],
      map: { 'Cookie': '*' }
    }
  },
  '视频号': {
    apiMode: 'cookie',
    docs: 'https://channels.weixin.qq.com',
    note: '点击「一键登录获取 Cookie」打开独立浏览器窗口，用微信扫码登录视频号助手，登录成功后自动回填并保存，后续据此读取频道数据。',
    fields: [
      { key: '用户 ID', secret: false, optional: true },
      { key: 'Cookie', secret: true }
    ],
    login: {
      url: 'https://channels.weixin.qq.com',
      cookieDomain: 'weixin.qq.com',
      detect: ['sessionid', 'wxuin'],
      map: { 'Cookie': '*' }
    }
  },
  '快手': {
    apiMode: 'cookie',
    docs: 'https://open.kuaishou.com/',
    note: '快手开放平台（open.kuaishou.com）主要面向授权接入，个人创作者的数据暂无公开接口。点击「一键登录获取 Cookie」打开快手创作者中心，扫码登录后自动回填 Cookie（含 passToken、userId、kuaishou.web.cp.api_st 等），用于自动发布与读取数据。Cookie 过期后需重新获取，存在风控风险。',
    fields: [
      { key: '用户 ID', secret: false, optional: true },
      { key: 'Cookie', secret: true }
    ],
    login: {
      url: 'https://cp.kuaishou.com/',
      cookieDomain: 'kuaishou.com',
      detect: [['passToken', 'kuaishou.web.cp.api_st']],
      map: { 'Cookie': '*' }
    }
  },
  '微博': {
    apiMode: 'cookie',
    docs: 'https://weibo.com/',
    note: '自动发布与数据读取都使用登录 Cookie（含 SUB 等），点「一键登录获取 Cookie」登录微博后自动回填并启用。Cookie 过期后重新一键登录即可。',
    fields: [
      { key: '用户 ID', secret: false, optional: true },
      { key: 'Cookie', secret: true }
    ],
    login: {
      url: 'https://weibo.com/',
      cookieDomain: 'weibo.com',
      detect: ['SUB'],
      map: { 'Cookie': '*' }
    }
  },
  '公众号': {
    apiMode: 'cookie',
    docs: 'https://mp.weixin.qq.com/',
    note: '点击「一键登录获取 Cookie」打开独立浏览器窗口，用绑定了公众号的微信扫码登录公众平台，登录成功后自动回填 Cookie。数据同步与图文 / 视频草稿都复用该登录态；Cookie 过期后重新一键登录即可。启用连接后会按固定间隔自动同步近 7 天数据。',
    fields: [
      { key: '用户 ID', secret: false, optional: true },
      { key: 'Cookie', secret: true }
    ],
    login: {
      url: 'https://mp.weixin.qq.com/',
      cookieDomain: 'mp.weixin.qq.com',
      detect: [['slave_sid', 'slave_user']],
      map: { 'Cookie': '*' }
    }
  },
  '小红书': {
    apiMode: 'cookie',
    docs: 'https://creator.xiaohongshu.com/statistics/data-analysis',
    note: '点击「一键登录获取 Cookie」打开独立浏览器窗口，登录成功后自动回填并保存。',
    fields: [
      { key: '用户 ID', secret: false, optional: true },
      { key: 'Cookie', secret: true }
    ],
    login: {
      url: 'https://creator.xiaohongshu.com/login',
      cookieDomain: 'xiaohongshu.com',
      detect: ['access-token-creator.xiaohongshu.com'],
      map: { 'Cookie': '*' }
    }
  },
  'B站': {
    apiMode: 'cookie',
    docs: 'https://openhome.bilibili.com/doc',
    note: 'B 站开放平台（openhome.bilibili.com/doc）主要面向企业应用与 OAuth 授权；创作中心没有面向个人的公开数据接口，需使用登录 Cookie 读取创作数据。SESSDATA 为必需项，部分接口还需 bili_jct / buvid3；Cookie 约 30 天过期，存在风控风险，仅作兜底。可点「一键登录获取 Cookie」自动打开 B 站登录页，登录成功后回填 SESSDATA、bili_jct 与 UID。自动投稿时按「默认分区」关键词选择分区（如「知识」或「知识/科学科普」），B 站不选分区无法投稿。',
    fields: [
      { key: 'UID', secret: false },
      { key: 'SESSDATA', secret: true },
      { key: 'bili_jct', secret: true, optional: true },
      { key: '默认分区', secret: false, optional: true }
    ],
    login: {
      url: 'https://passport.bilibili.com/login',
      cookieDomain: 'bilibili.com',
      detect: ['SESSDATA'],
      map: { 'UID': 'DedeUserID', 'SESSDATA': 'SESSDATA', 'bili_jct': 'bili_jct' }
    }
  },
  '知乎': {
    apiMode: 'cookie',
    docs: 'https://developer.zhihu.com/',
    note: '知乎数据开放平台（developer.zhihu.com）提供搜索、热榜与用户数据接口，需申请 Access Secret；本工作台暂以登录 Cookie（含 d_c0、z_c0、_xsrf 等）兜底读取个人内容与数据，Cookie 过期后需重新抓取，存在风控风险。可点「一键登录获取 Cookie」自动打开知乎登录页，登录成功后回填 Cookie。自动发布视频时会确认必填的「视频标记」（默认「内容无需标注」），并按「默认领域」关键词选择领域（未填写时默认「科技互联网」，可选如：人文、教育、科技互联网、其他）。',
    fields: [
      { key: 'User ID', secret: false, optional: true },
      { key: 'Cookie', secret: true },
      { key: '默认领域', secret: false, optional: true }
    ],
    login: {
      url: 'https://www.zhihu.com/signin',
      cookieDomain: 'zhihu.com',
      detect: ['z_c0'],
      map: { 'Cookie': '*' }
    }
  }
};

const PLATFORMS = Object.keys(DEFS);

/* ---------------- 小工具 ---------------- */

function readAll() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
  } catch (err) {
    return {};
  }
}

function writeAll(obj) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

function maskValue(def, rawValue) {
  const has = typeof rawValue === 'string' && rawValue.length > 0;
  if (!def || !def.secret) return { value: rawValue || '', hasValue: has };
  return { value: has ? MASK : '', hasValue: has };
}

/* ---------------- 对外接口 ---------------- */

function listPlatforms() {
  return PLATFORMS.slice();
}

function getDefs() {
  // 脱敏后的字段定义（字段名、是否密钥、说明），供前端直接渲染
  const defs = {};
  PLATFORMS.forEach((p) => {
    defs[p] = {
      apiMode: DEFS[p].apiMode,
      docs: DEFS[p].docs || '',
      note: DEFS[p].note,
      fields: DEFS[p].fields.map((f) => ({ key: f.key, secret: !!f.secret, optional: !!f.optional })),
      login: DEFS[p].login ? { available: true } : null
    };
  });
  return defs;
}

/** 读取全量（掩码），供前端一览渲染 */
function getAll() {
  const all = readAll();
  const connections = {};
  PLATFORMS.forEach((p) => {
    const rec = all[p] || { enabled: false, fields: {}, updatedAt: null };
    const def = DEFS[p];
    const fields = {};
    def.fields.forEach((f) => {
      fields[f.key] = maskValue(f, rec.fields ? rec.fields[f.key] : '');
    });
    connections[p] = {
      enabled: rec.enabled === true,
      updatedAt: rec.updatedAt || null,
      fields
    };
  });
  return { platforms: PLATFORMS.slice(), defs: getDefs(), connections };
}

/** 读取单个（掩码，或不存在时返回空结构） */
function get(platform) {
  if (!DEFS[platform]) return null;
  const all = readAll();
  const rec = all[platform] || { enabled: false, fields: {}, updatedAt: null };
  const def = DEFS[platform];
  const fields = {};
  def.fields.forEach((f) => {
    fields[f.key] = maskValue(f, rec.fields ? rec.fields[f.key] : '');
  });
  return { platform, enabled: rec.enabled === true, updatedAt: rec.updatedAt || null, fields };
}

/** 读取单个原始值（仅内部使用，如采集器读取 Cookie），不外发 */
function getRaw(platform) {
  const all = readAll();
  const rec = all[platform];
  if (!rec) return null;
  return { enabled: rec.enabled === true, fields: rec.fields || {}, updatedAt: rec.updatedAt || null };
}

/**
 * 保存单个平台的连接信息。
 * body: { enabled?:bool, fields?: { [key]: string } }
 * 密钥字段传 KEEP 哨兵则保留原值；传 '' 则清空；传其它则覆盖。
 */
function save(platform, body) {
  if (!DEFS[platform]) {
    const err = new Error('未知渠道：' + platform);
    err.status = 404;
    throw err;
  }
  const all = readAll();
  const prev = all[platform] || { enabled: false, fields: {}, updatedAt: null };
  const def = DEFS[platform];
  const incoming = (body && body.fields) || {};

  const nextFields = {};
  def.fields.forEach((f) => {
    const v = incoming[f.key];
    if (typeof v === 'undefined') {
      // 未传该字段：保留原值
      nextFields[f.key] = prev.fields[f.key] || '';
      return;
    }
    if (f.secret && v === KEEP) {
      nextFields[f.key] = prev.fields[f.key] || '';
      return;
    }
    nextFields[f.key] = typeof v === 'string' ? v.trim() : String(v == null ? '' : v);
  });

  const next = {
    enabled: body && (body.enabled === true || body.enabled === 'true'),
    fields: nextFields,
    updatedAt: new Date().toISOString()
  };
  all[platform] = next;
  writeAll(all);

  // 返回掩码后的结果
  const outFields = {};
  def.fields.forEach((f) => {
    outFields[f.key] = maskValue(f, nextFields[f.key]);
  });
  return { platform, enabled: next.enabled, updatedAt: next.updatedAt, fields: outFields };
}

/** 一键登录成功后写入捕获到的凭证，并自动启用连接 */
function saveCaptured(platform, values) {
  const def = DEFS[platform];
  const all = readAll();
  const prev = all[platform] || { enabled: false, fields: {}, updatedAt: null };
  const nextFields = {};
  def.fields.forEach((f) => {
    const v = values[f.key];
    nextFields[f.key] = typeof v === 'string' && v ? v.trim() : (prev.fields[f.key] || '');
  });
  const complete = def.fields
    .filter((f) => !f.optional)
    .every((f) => nextFields[f.key]);
  all[platform] = {
    enabled: complete,
    fields: nextFields,
    updatedAt: new Date().toISOString()
  };
  writeAll(all);
  return complete;
}

/** 启动一键登录：拉起本地浏览器窗口并等待用户完成登录 */
function startLogin(platform) {
  const def = DEFS[platform];
  if (!def) {
    const err = new Error('未知渠道：' + platform);
    err.status = 404;
    throw err;
  }
  if (!def.login) {
    const err = new Error('该渠道不支持一键登录');
    err.status = 400;
    throw err;
  }
  return browserLogin.start({
    platform,
    url: def.login.url,
    cookieDomain: def.login.cookieDomain,
    detect: def.login.detect,
    map: def.login.map,
    onCaptured: (values) => saveCaptured(platform, values)
  });
}

function loginStatus(platform) {
  if (!DEFS[platform]) {
    const err = new Error('未知渠道：' + platform);
    err.status = 404;
    throw err;
  }
  const st = browserLogin.status();
  if (st.platform && st.platform !== platform) {
    const active = st.status === 'launching' || st.status === 'waiting';
    return active
      ? { platform, status: 'idle', message: '其他渠道的登录窗口正在进行', busyPlatform: st.platform }
      : { platform, status: 'idle', message: '' };
  }
  if (st.status === 'idle') return { platform, status: 'idle', message: '' };
  return st;
}

function cancelLogin(platform) {
  if (!DEFS[platform]) {
    const err = new Error('未知渠道：' + platform);
    err.status = 404;
    throw err;
  }
  const st = browserLogin.status();
  if (st.status === 'idle' || (st.platform && st.platform !== platform)) {
    return loginStatus(platform);
  }
  return browserLogin.cancel();
}

/**
 * 实测连接是否可用：所有渠道都是 Cookie 方式，仅校验必填项是否已填，
 * 实时的登录态由采集器/发布器在打开浏览器时验证。
 */
async function test(platform, body) {
  const def = DEFS[platform];
  if (!def) {
    const err = new Error('未知渠道：' + platform);
    err.status = 404;
    throw err;
  }
  const fields = (body && body.fields) || {};
  const missing = def.fields
    .filter((f) => !f.optional && !(fields[f.key] && String(fields[f.key]).length))
    .map((f) => f.key);

  if (missing.length) {
    return { ok: false, platform, apiMode: def.apiMode, message: '请先填写必填项：' + missing.join('、') };
  }
  if (def.apiMode === 'custom') {
    return {
      ok: true,
      platform,
      apiMode: def.apiMode,
      message: '必填项已填写。自定义渠道的连通性请在业务侧自行验证。'
    };
  }
  return {
    ok: true,
    platform,
    apiMode: def.apiMode,
    message: '必填项已填写。Cookie 类渠道无法在线验证，请确认 Cookie 仍有效。'
  };
}

module.exports = {
  KEEP,
  MASK,
  DEFS,
  PLATFORMS,
  listPlatforms,
  getDefs,
  getAll,
  get,
  getRaw,
  save,
  test,
  startLogin,
  loginStatus,
  cancelLogin
};
