import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createCheckout } from './server/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(process.env.SITE_DIR || path.join(__dirname, 'site'));
const dataDir = path.resolve(process.env.WEBSITE_DATA_DIR || path.join(__dirname, 'data'));
const port = Number(process.env.PORT || 4321);
const host = process.env.HOST || '127.0.0.1';
const adminToken = process.env.FEEDBACK_ADMIN_TOKEN || '';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const rateLimit = Number(process.env.FEEDBACK_RATE_LIMIT || 5);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.pdf': 'application/pdf',
};

fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'feedback.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    page TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    ua TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback(created_at);
`);

const insertFeedback = db.prepare(
  `INSERT INTO feedback (created_at, type, message, contact, os, app_version, page, lang, ip, ua)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const recentByIp = db.prepare(`SELECT COUNT(*) AS n FROM feedback WHERE ip = ? AND created_at > ?`);

const checkout = createCheckout();

const TYPES = ['feature', 'bug', 'license', 'partnership', 'suggestion', 'problem'];

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

// 中国大陆/台湾/香港/澳门 IPv4 段，离线数据由 scripts/update-geo.mjs 生成
const zhRegionRanges = (() => {
  try {
    const text = fs.readFileSync(path.join(__dirname, 'geo', 'zh-regions.txt'), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const starts = new Uint32Array(lines.length);
    const ends = new Uint32Array(lines.length);
    lines.forEach((line, i) => {
      const [start, end] = line.split('-').map(Number);
      starts[i] = start;
      ends[i] = end;
    });
    return { starts, ends };
  } catch (error) {
    console.warn(`geo ranges unavailable: ${error.message}`);
    return null;
  }
})();

function ipv4ToInt(ip) {
  const match = String(ip).match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

// 本机/内网请求（部署健康检查、反代自身）不做地域跳转
function isPrivateIp(value) {
  return value >>> 24 === 10 ||
    value >>> 24 === 127 ||
    (value >>> 20) === 0xac1 ||
    (value >>> 16) === 0xc0a8 ||
    (value >>> 16) === 0xa9fe ||
    value === 0;
}

function isZhRegion(ip) {
  if (!zhRegionRanges) return false;
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  const { starts, ends } = zhRegionRanges;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (value < starts[mid]) hi = mid - 1;
    else if (value > ends[mid]) lo = mid + 1;
    else return true;
  }
  return false;
}

const CRAWLER_RE = /googlebot|bingbot|baiduspider|yandex|duckduckbot|sogou|bytespider|applebot|gptbot|claudebot|ccbot|facebookexternalhit|twitterbot|linkedinbot|telegrambot|slackbot|discordbot|petalbot|semrushbot|ahrefsbot|mj12bot/i;

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

// 手动切换语言（cookie）优先；其次看来源地区；爬虫不做地域跳转
function preferredLang(req) {
  const cookie = readCookie(req, 'site_lang');
  if (cookie === 'zh' || cookie === 'en') return cookie;
  if (CRAWLER_RE.test(String(req.headers['user-agent'] || ''))) return '';
  const ip = clientIp(req);
  const value = ipv4ToInt(ip);
  if (value !== null && isPrivateIp(value)) return '';
  return isZhRegion(ip) ? 'zh' : 'en';
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorize(req) {
  if (!adminToken) return false;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const url = new URL(req.url, 'http://localhost');
  return bearer === adminToken || url.searchParams.get('token') === adminToken;
}

async function handleFeedback(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    if (!authorize(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
    const url = new URL(req.url, 'http://localhost');
    const rows = db.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT 500').all();
    if (url.searchParams.get('format') === 'csv') {
      const head = ['id', 'created_at', 'type', 'message', 'contact', 'os', 'app_version', 'page', 'lang'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [head.join(','), ...rows.map((r) => head.map((k) => esc(r[k])).join(','))].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="feedback.csv"',
        'Cache-Control': 'no-store',
      });
      res.end(`﻿${csv}`);
      return;
    }
    return json(res, 200, { ok: true, count: rows.length, items: rows });
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' });

  const origin = req.headers.origin;
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return json(res, 403, { ok: false, error: 'origin-not-allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { ok: false, error: 'invalid-json' });
  }

  if (String(payload.website || '').trim()) return json(res, 200, { ok: true });

  const type = String(payload.type || '').trim();
  const message = String(payload.message || '').trim();
  const contact = String(payload.contact || '').trim().slice(0, 200);
  const os = String(payload.os || '').trim().slice(0, 40);
  const appVersion = String(payload.appVersion || '').trim().slice(0, 40);
  const page = String(payload.page || '').trim().slice(0, 500);
  const lang = String(payload.lang || '').trim().slice(0, 12);

  if (!TYPES.includes(type)) return json(res, 400, { ok: false, error: 'invalid-type' });
  if (message.length < 20 || message.length > 2000) {
    return json(res, 400, { ok: false, error: 'invalid-message' });
  }
  if (contact && !/^[-@.\w一-龥+/:\s]{2,200}$/u.test(contact)) {
    return json(res, 400, { ok: false, error: 'invalid-contact' });
  }

  const ip = clientIp(req);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { n } = recentByIp.get(ip, since);
  if (n >= rateLimit) return json(res, 429, { ok: false, error: 'rate-limited' });

  insertFeedback.run(
    new Date().toISOString(),
    type,
    message,
    contact,
    os,
    appVersion,
    page,
    lang,
    ip,
    String(req.headers['user-agent'] || '').slice(0, 300),
  );
  return json(res, 201, { ok: true });
}

function serveFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = fs.statSync(file);
  const isAsset = file.includes(`${path.sep}assets${path.sep}`);
  const cache = ext === '.html'
    ? 'no-cache'
    : ext === '.woff2'
      ? 'public, max-age=31536000, immutable'
      : ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico'].includes(ext)
        ? 'public, max-age=2592000'
        : isAsset
          ? 'public, max-age=604800'
          : 'public, max-age=3600';
  const headers = {
    'Content-Type': type,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  };

  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [startRaw, endRaw] = range.replace(/^bytes=/, '').split('-');
    const start = Number(startRaw) || 0;
    const end = endRaw ? Math.min(Number(endRaw), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

function resolveStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const cleaned = path.normalize(decoded).replace(/^([/\\])+/, '');
  let file = path.join(siteDir, cleaned);
  if (!file.startsWith(siteDir)) return null;
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  if (!path.extname(file) && fs.existsSync(`${file}.html`)) return `${file}.html`;
  if (!path.extname(file) && fs.existsSync(path.join(file, 'index.html'))) return path.join(file, 'index.html');
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (await checkout.handle(req, res, url)) return;
    if (url.pathname === '/api/feedback') return handleFeedback(req, res);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }

    // 中文站点位于根路径，兼容误用 /zh/ 前缀的地址
    if (url.pathname === '/zh' || url.pathname.startsWith('/zh/')) {
      const rest = url.pathname.replace(/^\/zh\/?/, '');
      res.writeHead(301, { Location: `/${rest}${url.search}` });
      res.end();
      return;
    }

    // 目录索引页统一 301 到目录地址，避免 /index.html 被当成重复页面抓取
    if (url.pathname === '/index.html' || url.pathname.endsWith('/index.html')) {
      const target = url.pathname.slice(0, -'index.html'.length) || '/';
      res.writeHead(301, { Location: `${target}${url.search}` });
      res.end();
      return;
    }

    // 浏览器默认会请求 /favicon.ico，重定向到现有图标，避免 404 噪音
    if (url.pathname === '/favicon.ico') {
      res.writeHead(301, { Location: '/assets/img-1.png' });
      res.end();
      return;
    }

    // 结账与加油站只有中文页面，英文路径统一回落到中文地址
    const zhOnly = url.pathname.match(/^\/en(\/(?:checkout|jiayouzhan)(?:\/.*)?)$/);
    if (zhOnly) {
      const target = zhOnly[1].endsWith('/') ? zhOnly[1] : `${zhOnly[1]}/`;
      res.writeHead(301, { Location: `${target}${url.search}` });
      res.end();
      return;
    }

    // 目录地址统一 301 到带尾斜杠的 canonical 形式
    if (url.pathname !== '/' && !url.pathname.endsWith('/') && !path.extname(url.pathname)) {
      const dir = path.join(siteDir, path.normalize(url.pathname).replace(/^([/\\])+/, ''));
      if (dir.startsWith(siteDir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        res.end();
        return;
      }
    }

    // 首页按访客来源地默认语言：中文地区保持中文，其余地区跳英文；爬虫与手动选择不受影响
    if (url.pathname === '/' || url.pathname === '/en/') {
      const lang = preferredLang(req);
      const target = lang === 'en' && url.pathname === '/' ? '/en/' : lang === 'zh' && url.pathname === '/en/' ? '/' : '';
      if (target) {
        res.writeHead(302, {
          Location: `${target}${url.search}`,
          'Cache-Control': 'no-store',
          Vary: 'Cookie, X-Forwarded-For, User-Agent',
        });
        res.end();
        return;
      }
    }

    const notFound = path.join(siteDir, '404.html');
    const file = resolveStatic(url.pathname);
    if (file && path.resolve(file) !== path.resolve(notFound)) return serveFile(req, res, file);

    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Robots-Tag': 'noindex',
    });
    if (req.method === 'HEAD' || !fs.existsSync(notFound)) {
      res.end();
      return;
    }
    fs.createReadStream(notFound).pipe(res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
});

server.listen(port, host, () => {
  console.log(`website preview: http://${host}:${port}/`);
  console.log(`site dir: ${siteDir}`);
  console.log(`feedback db: ${path.join(dataDir, 'feedback.db')}`);
});

function shutdown() {
  checkout.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
