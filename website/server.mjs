import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

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

const TYPES = ['feature', 'bug', 'license', 'partnership', 'suggestion', 'problem'];

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '';
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
  const cache = ext === '.html' ? 'no-cache' : isAsset ? 'public, max-age=604800' : 'public, max-age=3600';
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
    if (url.pathname === '/api/feedback') return handleFeedback(req, res);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }

    const file = resolveStatic(url.pathname);
    if (file) return serveFile(req, res, file);

    const notFound = path.join(siteDir, '404.html');
    if (fs.existsSync(notFound)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      fs.createReadStream(notFound).pipe(res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
