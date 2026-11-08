'use strict';

/**
 * 灰豚数据（xhs.huitun.com）接口客户端。
 *
 * 对方网页端只给响应体加密：返回 { encrypt: true, extData: "<base64>" } 时，
 * extData 是 AES-128-ECB + PKCS7（无 IV）的密文，密钥由前端两段字节异或得到。
 * 解密后是普通 JSON。请求本身只需登录 Cookie 和 _t / vs / source 公共参数。
 */

const crypto = require('crypto');

const BASE = 'https://xhsapi.huitun.com';
const WEB_ORIGIN = 'https://xhs.huitun.com';
const VS = '16101520.52.102';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 30000;

// 前端 main.js 中的 f / h 两段常量，逐字节异或后得到解密密钥
const KEY_BYTES = [93, 24, 43, 91, 81, 72, 3, 99, 125, 28, 45, 112, 118, 45, 0, 108];
const MASK_BYTES = [19, 47, 83, 11, 101, 37, 72, 90, 14, 77, 31, 6, 58, 21, 99, 40];

const DECRYPT_KEY = Buffer.from(KEY_BYTES.map((v, i) => v ^ MASK_BYTES[i]));

// 灰豚响应会通过 Set-Cookie 下发/续期设备与接口 Token（XHS_WEB_DEVICE、xhsapiToken 等），
// 浏览器会自动回写；Node 侧必须自己维护 Cookie 罐，否则第二次请求仍带着旧 Cookie 会被判定登录过期。
let jar = { base: '', cookie: '' };
let persistTimer = null;

function cookieJarFor(cookie) {
  const text = String(cookie || '').trim();
  if (jar.base !== text) {
    jar = { base: text, cookie: text };
  }
  return jar.cookie;
}

function mergeSetCookies(cookieString, setCookies) {
  const map = new Map();
  String(cookieString || '')
    .split(';')
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx < 0) return;
      const name = pair.slice(0, idx).trim();
      if (name) map.set(name, pair.slice(idx + 1).trim());
    });
  (setCookies || []).forEach((raw) => {
    const text = String(raw || '');
    const first = text.split(';')[0];
    const idx = first.indexOf('=');
    if (idx < 0) return;
    const name = first.slice(0, idx).trim();
    if (!name) return;
    const value = first.slice(idx + 1).trim();
    const maxAge = /max-age\s*=\s*(-?\d+)/i.exec(text);
    const wiped =
      (maxAge && Number(maxAge[1]) <= 0) || /expires\s*=\s*thu,\s*01\s+jan\s+1970/i.test(text);
    if (wiped) {
      map.delete(name);
      return;
    }
    map.set(name, value);
  });
  return Array.from(map, ([name, value]) => name + '=' + value).join('; ');
}

function persistJar(cookie) {
  if (!cookie) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      require('./channel-connections').saveCaptured('灰豚数据', { Cookie: cookie });
    } catch (err) {
      /* 续期写盘失败不影响本次请求 */
    }
  }, 300);
  if (persistTimer.unref) persistTimer.unref();
}

function setCookiesOf(res) {
  try {
    return typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  } catch (err) {
    return [];
  }
}

class HuitunError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'HuitunError';
    this.code = code;
  }
}

/** 站内登录状态：读取「连接设置 · 灰豚数据」保存的 Cookie */
function connection() {
  try {
    const channelConnections = require('./channel-connections');
    const raw = channelConnections.getRaw('灰豚数据');
    const cookie = raw && raw.fields ? String(raw.fields.Cookie || '') : '';
    return {
      enabled: !!(raw && raw.enabled && cookie),
      configured: !!cookie,
      cookie,
      updatedAt: (raw && raw.updatedAt) || null
    };
  } catch (err) {
    return { enabled: false, configured: false, cookie: '', updatedAt: null };
  }
}

function decodeJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    // 少数接口会返回未加引号的数字键，和前端兜底逻辑保持一致
    return JSON.parse(text.replace(/([{,])(\d+):/g, '$1"$2":'));
  }
}

function decryptExtData(value) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.replace(/ /g, '+').trim();
  const decipher = crypto.createDecipheriv('aes-128-ecb', DECRYPT_KEY, null);
  decipher.setAutoPadding(true);
  const plain = Buffer.concat([
    decipher.update(Buffer.from(normalized, 'base64')),
    decipher.final()
  ]).toString('utf8');
  return decodeJson(plain);
}

function buildUrl(pathname, params) {
  const url = new URL(pathname, BASE);
  const query = Object.assign(
    { _t: Date.now(), vs: VS, source: 'web' },
    params || {}
  );
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

async function request(options) {
  const opts = options || {};
  const explicit = String(opts.cookie || '').trim();
  if (!explicit && !opts.allowAnonymous) {
    throw new HuitunError('缺少灰豚数据 Cookie，请先到「连接设置」完成灰豚数据登录', 'NO_COOKIE');
  }
  // 使用 Cookie 罐：带上服务端上一次 Set-Cookie 下发的设备与接口 Token
  const cookie = explicit ? cookieJarFor(explicit) : jar.cookie;
  const url = buildUrl(opts.path, opts.params);
  const headers = {
    Accept: 'application/json',
    Referer: WEB_ORIGIN + '/',
    Origin: WEB_ORIGIN,
    'User-Agent': UA
  };
  if (cookie) headers.Cookie = cookie;
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs || REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    throw new HuitunError('灰豚数据请求失败（' + (err && err.message ? err.message : '网络错误') + '）', 'NETWORK');
  }
  const setCookies = setCookiesOf(res);
  if (setCookies.length) {
    const merged = mergeSetCookies(jar.cookie, setCookies);
    if (merged !== jar.cookie) {
      jar.cookie = merged;
      // 仅在已登录（有用户 Cookie）时回写，避免把匿名设备 Cookie 写进未配置的连接
      if (explicit) persistJar(merged);
    }
  }
  if (!res.ok) {
    throw new HuitunError('灰豚数据接口返回 HTTP ' + res.status, 'HTTP_' + res.status);
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    throw new HuitunError('灰豚数据返回内容不是 JSON，接口可能已调整', 'BAD_JSON');
  }
  if (json && json.encrypt && typeof json.extData === 'string') {
    try {
      json.extData = decryptExtData(json.extData);
    } catch (err) {
      throw new HuitunError(
        '灰豚数据响应解密失败，前端密钥可能已更新（' + (err && err.message ? err.message : '解密错误') + '）',
        'DECRYPT'
      );
    }
  }
  return json;
}

function ensureOk(json, action) {
  if (json && Number(json.status) === 0) return json;
  const code = json && json.status;
  let message = (json && json.message) || (action ? action + '失败' : '灰豚接口返回异常');
  if (Number(code) === 1000) {
    message = '灰豚登录已过期，请到「连接设置」重新登录灰豚数据';
  } else if (Number(code) === 1001) {
    message = '灰豚数据未登录，请到「连接设置」登录灰豚数据';
  } else if (Number(code) === 2001 && /积分|额度|次数|余额/.test(message)) {
    message = '灰豚数据积分不足或额度已用尽，请到灰豚官网确认后重试';
  }
  const err = new HuitunError(message, code);
  if (Number(code) === 2001 && /积分|额度|次数|余额/.test(message)) err.quota = true;
  return Promise.reject(err);
}

async function currentUser(cookie) {
  const json = await request({ path: '/user/currentUser', cookie });
  return json;
}

async function requireUser(cookie) {
  const json = await currentUser(cookie);
  await ensureOk(json, '读取灰豚账号');
  return json.extData || {};
}

async function searchAnchor(cookie, keyword, options) {
  const opts = options || {};
  const json = await request({
    path: '/anchor/v2/search',
    cookie,
    params: {
      keyword: String(keyword || '').trim(),
      page: opts.page || 1,
      pageSize: opts.pageSize || 10
    }
  });
  await ensureOk(json, '搜索灰豚达人');
  const data = json.extData || {};
  if (Array.isArray(data)) return data;
  return Array.isArray(data.list) ? data.list : [];
}

async function listAnchorNotes(cookie, anchorId, options) {
  const opts = options || {};
  const json = await request({
    path: '/anchor/detail/notesV2',
    cookie,
    params: {
      anchorId: String(anchorId || '').trim(),
      page: opts.page || 1,
      pageSize: opts.pageSize || 30,
      keyword: opts.keyword || '',
      sort: opts.sort || '',
      dateStart: opts.dateStart || '',
      dateEnd: opts.dateEnd || ''
    }
  });
  await ensureOk(json, '读取达人笔记');
  const data = json.extData || {};
  if (Array.isArray(data)) return { list: data, total: data.length };
  return {
    list: Array.isArray(data.list) ? data.list : [],
    total: Number(data.total) || 0
  };
}

/** 用灰豚内部 noteId 换取小红书原始笔记链接（带 xsec_token） */
async function noteUrl(cookie, noteId) {
  const json = await request({
    path: '/note/noteUrl',
    cookie,
    params: { noteId: String(noteId || '').trim() }
  });
  await ensureOk(json, '读取笔记链接');
  return String(json.extData || '').trim();
}

/** 从灰豚达人详情页链接里取 anchorId：...#/anchor/anchor_detail?id=xxx */
function parseAnchorUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch (err) {
    return '';
  }
  if (!/(^|\.)huitun\.com$/i.test(url.hostname)) return '';
  const fromQuery = (text) => {
    try {
      return new URLSearchParams(text).get('id') || new URLSearchParams(text).get('anchorId') || '';
    } catch (err) {
      return '';
    }
  };
  const hash = String(url.hash || '').replace(/^#/, '');
  const hashQuery = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?') + 1) : '';
  const candidates = [fromQuery(hashQuery), url.searchParams.get('id'), url.searchParams.get('anchorId')];
  for (const value of candidates) {
    const id = String(value || '').trim();
    if (/^[0-9A-Za-z]{6,32}$/.test(id)) return id;
  }
  return '';
}

function anchorUrl(anchorId) {
  return 'https://xhs.huitun.com/#/anchor/anchor_detail?id=' + encodeURIComponent(String(anchorId || ''));
}

/** "2026-11-02 20:57:56" 是北京时间，转成 ISO */
function parsePublishedAt(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const normalized = text.replace(' ', 'T');
  const d = new Date(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(normalized) ? normalized + '+08:00' : text);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 120);
}

// 小红书网页端原生笔记 ID 是 24 位十六进制；灰豚笔记列表里的数字 noteId 是内部 ID，
// 不能直接拼 explore 链接，需要再调 /note/noteUrl 换取带 xsec_token 的真实地址。
const XHS_NOTE_ID_RE = /^[0-9a-f]{24}$/i;

function isXhsNoteId(value) {
  return XHS_NOTE_ID_RE.test(String(value || '').trim());
}

/** 灰豚笔记 → 对标作品结构 */
function parseNote(note) {
  const row = note || {};
  const noteId = String(row.noteId || row.note_id || row.id || '').trim();
  if (!noteId) return null;
  const type = String(row.type || row.noteType || '').toLowerCase();
  const cover = row.imageUrl || row.cover || row.coverUrl || '';
  const link = String(row.noteLink || row.noteUrl || row.note_link || row.link || '').trim();
  return {
    workId: noteId,
    title: cleanText(row.title || row.desc || '', 120) || '（无标题笔记）',
    coverUrl: cover,
    itemUrl: link || (isXhsNoteId(noteId) ? 'https://www.xiaohongshu.com/explore/' + noteId : ''),
    itemType: type === 'video' ? 'video' : 'note',
    likes: Math.max(0, Number(row.like) || 0),
    comments: Math.max(0, Number(row.comm) || Number(row.comment) || 0),
    shares: Math.max(0, Number(row.share) || Number(row.sharedCount) || 0),
    collects: Math.max(0, Number(row.coll) || Number(row.collect) || 0),
    reads: Math.max(0, Number(row.read) || 0),
    publishedAt: parsePublishedAt(row.ts || row.postTime || row.updateTime)
  };
}

module.exports = {
  BASE,
  HuitunError,
  connection,
  decryptExtData,
  buildUrl,
  request,
  ensureOk,
  currentUser,
  requireUser,
  searchAnchor,
  listAnchorNotes,
  noteUrl,
  isXhsNoteId,
  parseAnchorUrl,
  anchorUrl,
  parsePublishedAt,
  parseNote
};
