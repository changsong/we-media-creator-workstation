'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { URL } = require('url');
const store = require('./lib/store');
const accountContext = require('./lib/account-context');
const accounts = require('./lib/accounts');
const { tables, tableOrder, publicSchema } = require('./lib/schemas');
const wechatMonitor = require('./lib/wechat-monitor');
const channelConnections = require('./lib/channel-connections');
const aiConfig = require('./lib/ai-config');
const oauth = require('./lib/oauth');
const xhsCollector = require('./lib/xhs-collector');
const douyinCollector = require('./lib/douyin-collector');
const channelsCollector = require('./lib/channels-collector');
const kuaishouCollector = require('./lib/kuaishou-collector');
const weiboCollector = require('./lib/weibo-collector');
const bilibiliCollector = require('./lib/bilibili-collector');
const zhihuCollector = require('./lib/zhihu-collector');
const benchmarks = require('./lib/benchmarks');
const trendsBrowser = require('./lib/trends/browser');
const transcript = require('./lib/trends/transcript');
const asr = require('./lib/asr');
const proxyConfig = require('./lib/proxy-config');
const browserLogin = require('./lib/browser-login');
const recordings = require('./lib/recordings');
const media = require('./lib/media');
const videoProjects = require('./lib/video/projects');
const videoAssets = require('./lib/video/assets');
const videoGenerate = require('./lib/video/generate');
const videoRender = require('./lib/video/render');
const videoVoices = require('./lib/video/voices');
const videoTts = require('./lib/video/tts');
const videoReference = require('./lib/video/reference');
const ai = require('./lib/ai');
const publishTasks = require('./lib/publish-tasks');
const profile = require('./lib/profile');
const license = require('./lib/license');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || readFlag('--port') || 5180;
const HOST = process.env.HOST || readFlag('--host') || '127.0.0.1';
// OAuth 回调用本机 loopback 地址，端口必须与实际监听端口一致
oauth.configure({ port: PORT });
// 桌面版 app-server 不带 package.json，版本由主进程通过 APP_VERSION 注入
const APP_VERSION = process.env.APP_VERSION || readPackageVersion();

/* ---------------- 事件推送（多标签页双向同步） ---------------- */
const clients = new Set();
let lastSelfWrite = 0;

function broadcast(payload) {
  const data = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  const accountId = payload && payload.accountId ? payload.accountId : null;
  clients.forEach((res) => {
    // 事件只推给同一账号的标签页，避免切换账号后看到别的账号的变更
    if (accountId && res.accountId && res.accountId !== accountId) return;
    try {
      res.write(data);
    } catch (err) {
      clients.delete(res);
    }
  });
}

benchmarks.setBroadcast(broadcast);

/* ---------------- 工具 ---------------- */
function readFlag(name) {
  const idx = process.argv.indexOf(name);
  if (idx > 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function readPackageVersion() {
  try {
    return require('./package.json').version;
  } catch (err) {
    return '0.0.0';
  }
}

function sendJSON(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store'
  });
  res.end(text);
}

function sendError(res, err) {
  const status = err && err.status ? err.status : 500;
  if (status >= 500) console.error('[error]', err);
  const body = { error: err && err.message ? err.message : '服务端错误' };
  if (err && err.code) body.code = err.code;
  if (err && err.details) body.details = err.details;
  sendJSON(res, status, body);
}

function readBody(req, limit) {
  const maxBytes = limit || 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('请求体过大，单条记录请控制在 ' + Math.round(maxBytes / 1024 / 1024) + 'MB 内'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('头像图片不能超过 5MB'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

// 视频文件直接流式落盘，不经过内存，避免大文件打爆服务端。
function saveUpload(req, target, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const out = fs.createWriteStream(target);
    const cleanup = (err) => {
      if (settled) return;
      settled = true;
      out.destroy();
      fs.promises.rm(target, { force: true }).catch(() => {}).then(() => reject(err));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        cleanup(Object.assign(new Error('视频文件不能超过 2GB'), { status: 413 }));
        req.destroy();
        return;
      }
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    });
    req.on('end', () => {
      if (settled) return;
      out.end(() => {
        if (settled) return;
        settled = true;
        resolve(size);
      });
    });
    req.on('error', cleanup);
    req.on('aborted', () => cleanup(Object.assign(new Error('上传已取消'), { status: 400 })));
    req.on('close', () => {
      if (!settled && !req.complete) cleanup(Object.assign(new Error('上传已取消'), { status: 400 }));
    });
    out.on('error', cleanup);
  });
}

function cleanupUploads() {
  fs.promises
    .readdir(transcript.UPLOAD_DIR)
    .then((names) => {
      const cutoff = Date.now() - UPLOAD_TTL_MS;
      return Promise.all(
        names.map(async (name) => {
          if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(name)) return;
          const file = path.join(transcript.UPLOAD_DIR, name);
          const stat = await fs.promises.stat(file).catch(() => null);
          if (stat && stat.isFile() && stat.mtimeMs < cutoff) {
            await fs.promises.rm(file, { force: true }).catch(() => {});
          }
        })
      );
    })
    .catch(() => {});
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/** 播放音视频文件：支持 Range，便于拖动进度条 */
function serveMediaFile(req, res, found, notFoundMessage) {
  let stat;
  try {
    stat = fs.statSync(found.filePath);
  } catch (err) {
    return sendJSON(res, 404, { error: notFoundMessage });
  }
  const total = stat.size;
  const base = {
    'Content-Type': found.mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end)) end = total - 1;
      if (start >= total || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        return res.end();
      }
      end = Math.min(end, total - 1);
      res.writeHead(206, {
        ...base,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(found.filePath, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { ...base, 'Content-Length': total });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(found.filePath).pipe(res);
}

function serveRecordingAudio(req, res, id) {
  const found = recordings.getAudio(id);
  if (!found) return sendJSON(res, 404, { error: '录音不存在或文件已丢失' });
  return serveMediaFile(req, res, found, '录音文件不存在');
}

function serveMediaAsset(req, res, id) {
  const found = media.getFile(id);
  if (!found) return sendJSON(res, 404, { error: '素材不存在或文件已丢失' });
  return serveMediaFile(req, res, found, '素材文件不存在');
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'tables', ...]
  const method = req.method || 'GET';

  if (url.pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      version: APP_VERSION,
      accountId: accountContext.currentOrDefault(),
      storage: 'sqlite',
      db: store.dbPath(),
      integrity: store.integrity(),
      tables: store.stats(),
      orphans: store.orphans(),
      time: new Date().toISOString()
    });
  }

  // 多账号管理：列表 / 新建 / 重命名 / 删除 / 设为当前
  if (parts[1] === 'accounts') {
    const targetId = parts[2] || '';
    const action = parts[3] || '';
    try {
      if (!targetId && method === 'GET') return sendJSON(res, 200, accounts.list());
      if (!targetId && method === 'POST') {
        const body = await readBody(req);
        const created = accounts.create(body);
        // 新账号从空工作区起步，配置为未启用；仍为它挂上定时链，后续启用时无需重启
        try {
          wechatMonitor.startAccount(created.id);
        } catch (err) {
          /* 忽略 */
        }
        try {
          benchmarks.startAccount(created.id);
        } catch (err) {
          /* 忽略 */
        }
        return sendJSON(res, 201, created);
      }
      if (targetId && !action && (method === 'PUT' || method === 'PATCH')) {
        const body = await readBody(req);
        return sendJSON(res, 200, accounts.rename(targetId, body));
      }
      if (targetId && !action && method === 'DELETE') {
        const removed = accounts.remove(targetId);
        // 注册表已更新，重建定时链以摘除该账号
        try {
          wechatMonitor.startScheduler();
        } catch (err) {
          /* 忽略 */
        }
        try {
          benchmarks.startScheduler();
        } catch (err) {
          /* 忽略 */
        }
        return sendJSON(res, 200, removed);
      }
      if (targetId && action === 'activate' && method === 'POST') {
        const account = accounts.setActive(targetId);
        // 旧账号的暖浏览器不能留给新账号复用，空闲时立即关闭
        try {
          Promise.resolve(trendsBrowser.resetWarm()).catch(() => {});
        } catch (err) {
          /* 忽略 */
        }
        return sendJSON(res, 200, {
          ok: true,
          activeAccountId: account.id,
          accounts: accounts.list()
        });
      }
    } catch (err) {
      return sendError(res, err);
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 账号与授权（Keygate）
  if (parts[1] === 'license') {
    const action = parts.slice(2).join('/');
    if ((!action || action === 'status') && method === 'GET') return sendJSON(res, 200, license.getStatus());
    if (method === 'POST') {
      try {
        if (action === 'login/send') {
          const body = await readBody(req);
          return sendJSON(res, 200, await license.sendLoginCode(body.email));
        }
        if (action === 'login/verify') {
          const body = await readBody(req);
          return sendJSON(res, 200, await license.verifyLoginCode(body.email, body.code));
        }
        if (action === 'logout') {
          return sendJSON(res, 200, await license.logout());
        }
        if (action === 'activate') {
          const body = await readBody(req);
          return sendJSON(res, 200, await license.activate(body.license_key));
        }
        if (action === 'deactivate') {
          return sendJSON(res, 200, await license.deactivate());
        }
        if (action === 'refresh') {
          return sendJSON(res, 200, await license.refresh());
        }
      } catch (err) {
        return sendError(res, err);
      }
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 主理人资料
  if (url.pathname === '/api/profile') {
    if (method === 'GET') return sendJSON(res, 200, profile.getProfile());
    if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
      const body = await readBody(req);
      try {
        return sendJSON(res, 200, profile.updateName(body.name));
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    res.writeHead(405, { Allow: 'GET, PUT' });
    return res.end();
  }

  if (url.pathname === '/api/profile/avatar') {
    if (method === 'GET') {
      const avatar = profile.getAvatar();
      if (!avatar) return sendJSON(res, 404, { error: '尚未上传头像' });
      res.writeHead(200, {
        'Content-Type': avatar.mime,
        'Content-Length': avatar.blob.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(avatar.blob);
    }
    if (method === 'POST' || method === 'PUT') {
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const blob = await readRawBody(req, profile.MAX_AVATAR_BYTES);
      try {
        return sendJSON(res, 200, profile.setAvatar(blob, mime));
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    if (method === 'DELETE') {
      return sendJSON(res, 200, profile.clearAvatar());
    }
    res.writeHead(405, { Allow: 'GET, POST, DELETE' });
    return res.end();
  }

  if (url.pathname === '/api/schema') {
    const out = {};
    tableOrder.forEach((key) => {
      out[key] = publicSchema(tables[key]);
    });
    return sendJSON(res, 200, { schemas: out });
  }

  if (parts[1] === 'schema' && parts[2]) {
    const table = tables[parts[2]];
    if (!table) return sendJSON(res, 404, { error: `未知的表：${parts[2]}` });
    return sendJSON(res, 200, publicSchema(table));
  }

  if (url.pathname === '/api/stats') {
    return sendJSON(res, 200, { counts: store.stats() });
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    res.write(
      `event: ready\ndata: ${JSON.stringify({ ok: true, accountId: accountContext.currentOrDefault() })}\n\n`
    );
    res.accountId = accountContext.currentOrDefault();
    clients.add(res);
    const timer = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        clearInterval(timer);
        clients.delete(res);
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(timer);
      clients.delete(res);
    });
    return undefined;
  }

  // /api/tables/:table/records[/:id]
  if (parts[1] === 'tables' && parts[2]) {
    const tableKey = parts[2];
    const table = tables[tableKey];
    if (!table) return sendJSON(res, 404, { error: `未知的表：${tableKey}` });

    const isExport = url.pathname.endsWith('/export.csv');
    if (isExport && method === 'GET') {
      const csv = store.toCSV(tableKey);
      const name = `${table.name}-${new Date().toISOString().slice(0, 10)}.csv`;
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'no-store'
      });
      return res.end(csv);
    }

    const id = parts[4];

    if (parts[3] === 'records' && !id) {
      if (method === 'GET') {
        const list = store.list(tableKey, {
          pageSize: url.searchParams.get('pageSize'),
          cursor: url.searchParams.get('cursor') || url.searchParams.get('startCursor'),
          q: url.searchParams.get('q')
        });
        return sendJSON(res, 200, list);
      }
      if (method === 'POST') {
        // 数据快照只由平台采集器写入，不接受手工新增
        if (tableKey === 'review') {
          return sendJSON(res, 405, { error: '数据快照由平台数据自动同步生成，不支持手工新增' });
        }
        const body = await readBody(req);
        const row = store.create(tableKey, body.properties || body);
        touch(tableKey, 'create', row._id);
        return sendJSON(res, 201, { record: row });
      }
      res.writeHead(405, { Allow: 'GET, POST' });
      return res.end();
    }

    if (parts[3] === 'records' && id) {
      if (tableKey === 'calendar' && parts[5] === 'media') {
        if (method === 'GET') {
          store.get('calendar', id);
          return sendJSON(res, 200, {
            media: media.list({ scheduleId: id }),
            cover: media.getCover(id),
            covers: media.listCovers(id)
          });
        }
        if (method === 'PUT' || method === 'POST') {
          const body = await readBody(req);
          store.get('calendar', id);
          const list = media.attachToSchedule(id, body.ids || body.mediaIds || []);
          touch('calendar', 'update', id);
          return sendJSON(res, 200, { media: list });
        }
        res.writeHead(405, { Allow: 'GET, PUT' });
        return res.end();
      }
      if (tableKey === 'calendar' && parts[5] === 'cover') {
        store.get('calendar', id);
        if (method === 'GET') {
          return sendJSON(res, 200, { cover: media.getCover(id), covers: media.listCovers(id) });
        }
        if (method === 'PUT' || method === 'POST') {
          const body = await readBody(req);
          const batch = body.mediaIds || body.ids;
          const covers = batch
            ? media.attachCovers(id, batch)
            : media.attachCovers(id, body.mediaId || body.coverId || null);
          touch('calendar', 'update', id);
          return sendJSON(res, 200, { cover: covers[0] || null, covers });
        }
        if (method === 'DELETE') {
          const covers = media.attachCovers(id, []);
          touch('calendar', 'update', id);
          return sendJSON(res, 200, { cover: null, covers });
        }
        res.writeHead(405, { Allow: 'GET, PUT, DELETE' });
        return res.end();
      }
      if (method === 'GET') {
        return sendJSON(res, 200, { record: store.get(tableKey, id) });
      }
      if (method === 'PATCH' || method === 'PUT') {
        const body = await readBody(req);
        const row = store.update(tableKey, id, body.properties || body);
        touch(tableKey, 'update', row._id);
        return sendJSON(res, 200, { record: row });
      }
      if (method === 'DELETE') {
        const row = store.remove(tableKey, id);
        if (tableKey === 'calendar') media.releaseSchedule(id);
        touch(tableKey, 'delete', row._id);
        return sendJSON(res, 200, { deleted: row._id });
      }
      res.writeHead(405, { Allow: 'GET, PATCH, DELETE' });
      return res.end();
    }
  }

  // 公众号数据监控
  if (url.pathname === '/api/monitor/wechat/status') {
    return sendJSON(res, 200, wechatMonitor.getStatus());
  }
  if (url.pathname === '/api/monitor/wechat/run' && method === 'POST') {
    try {
      const result = await wechatMonitor.runOnce();
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }
  if (url.pathname === '/api/monitor/wechat/config') {
    if (method === 'GET') {
      return sendJSON(res, 200, wechatMonitor.getStatus());
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const cfg = wechatMonitor.saveConfig(body);
      wechatMonitor.startScheduler(); // 按新配置重启定时（enabled=false 会停止）
      return sendJSON(res, 200, {
        ok: true,
        enabled: cfg.enabled,
        platform: cfg.platform,
        intervalMinutes: cfg.intervalMinutes
      });
    }
    res.writeHead(405, { Allow: 'GET, POST' });
    return res.end();
  }

  // 对标账号：每天抓取最近 7 天的视频 / 图文
  if (url.pathname === '/api/benchmarks' && method === 'GET') {
    return sendJSON(
      res,
      200,
      benchmarks.overview({
        platform: url.searchParams.get('platform') || '',
        accountId: url.searchParams.get('accountId') || '',
        days: url.searchParams.get('days'),
        sort: url.searchParams.get('sort') || '',
        limit: url.searchParams.get('limit')
      })
    );
  }
  if (url.pathname === '/api/benchmarks/status' && method === 'GET') {
    return sendJSON(res, 200, benchmarks.getStatus());
  }
  if (url.pathname === '/api/benchmarks/accounts' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 201, await benchmarks.addAccount(body));
    } catch (err) {
      return sendError(res, err);
    }
  }
  if (url.pathname === '/api/benchmarks/refresh' && method === 'POST') {
    try {
      return sendJSON(res, 202, benchmarks.refreshAll());
    } catch (err) {
      return sendError(res, err);
    }
  }
  if (url.pathname === '/api/benchmarks/schedule') {
    if (method === 'GET') {
      const cfg = benchmarks.loadConfig();
      return sendJSON(res, 200, {
        enabled: cfg.enabled,
        hour: cfg.hour,
        minute: cfg.minute,
        status: benchmarks.getStatus()
      });
    }
    if (method === 'PUT' || method === 'POST') {
      try {
        const body = await readBody(req);
        const cfg = benchmarks.saveConfig(body);
        benchmarks.startScheduler();
        return sendJSON(res, 200, { ok: true, enabled: cfg.enabled, hour: cfg.hour, minute: cfg.minute });
      } catch (err) {
        return sendError(res, err);
      }
    }
    res.writeHead(405, { Allow: 'GET, PUT, POST' });
    return res.end();
  }
  const benchRefresh = url.pathname.match(/^\/api\/benchmarks\/accounts\/([\w-]+)\/refresh$/);
  if (benchRefresh && method === 'POST') {
    try {
      return sendJSON(res, 202, benchmarks.refreshAccount(benchRefresh[1]));
    } catch (err) {
      return sendError(res, err);
    }
  }
  const benchAccount = url.pathname.match(/^\/api\/benchmarks\/accounts\/([\w-]+)$/);
  if (benchAccount) {
    if (method === 'DELETE') {
      try {
        return sendJSON(res, 200, benchmarks.removeAccount(benchAccount[1]));
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (method === 'PATCH' || method === 'PUT') {
      try {
        const body = await readBody(req);
        return sendJSON(res, 200, {
          account: benchmarks.setAccountEnabled(benchAccount[1], body.enabled === true || body.enabled === 'true')
        });
      } catch (err) {
        return sendError(res, err);
      }
    }
    res.writeHead(405, { Allow: 'DELETE, PATCH, PUT' });
    return res.end();
  }
  // 视频文案提取：B站 / 抖音平台字幕（小红书、快手友好降级）
  if (url.pathname === '/api/trends/transcript' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 202, transcript.start(body));
    } catch (err) {
      return sendError(res, err);
    }
  }
  const transcriptMatch = url.pathname.match(/^\/api\/trends\/transcript\/([\w-]+)$/);
  if (transcriptMatch && method === 'GET') {
    try {
      return sendJSON(res, 200, transcript.status(transcriptMatch[1]));
    } catch (err) {
      return sendError(res, err);
    }
  }
  // 用整篇文案让 AI 起候选选题标题
  const transcriptTitleMatch = url.pathname.match(/^\/api\/trends\/transcript\/([\w-]+)\/title$/);
  if (transcriptTitleMatch && method === 'POST') {
    try {
      return sendJSON(res, 200, await transcript.suggestTitles(transcriptTitleMatch[1]));
    } catch (err) {
      return sendError(res, err);
    }
  }
  // AI 纠错：手动粘贴的文案直接纠错返回
  if (url.pathname === '/api/trends/transcript/correct' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 200, await transcript.correctText(body && body.text));
    } catch (err) {
      return sendError(res, err);
    }
  }
  // AI 纠错：把已提取文案纠错后写回任务
  const transcriptFixMatch = url.pathname.match(/^\/api\/trends\/transcript\/([\w-]+)\/correct$/);
  if (transcriptFixMatch && method === 'POST') {
    try {
      return sendJSON(res, 200, await transcript.correct(transcriptFixMatch[1]));
    } catch (err) {
      return sendError(res, err);
    }
  }
  // 平台没有字幕时，把作品视频代理给前端下载（带上平台需要的 Referer）
  const transcriptMediaMatch = url.pathname.match(/^\/api\/trends\/transcript\/([\w-]+)\/media$/);
  if (transcriptMediaMatch && method === 'GET') {
    let src;
    try {
      src = transcript.mediaSource(transcriptMediaMatch[1]);
    } catch (err) {
      return sendError(res, err);
    }
    try {
      const headers = { 'User-Agent': 'Mozilla/5.0', Accept: '*/*' };
      if (src.referer) headers.Referer = src.referer;
      if (req.headers.range) headers.Range = String(req.headers.range);
      const upstream = await fetch(src.url, { headers, redirect: 'follow' });
      if (!upstream.ok) {
        if (upstream.body && upstream.body.cancel) upstream.body.cancel().catch(() => {});
        return sendJSON(res, 502, { error: '视频下载失败（HTTP ' + upstream.status + '）' });
      }
      const outHeaders = {
        'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Disposition': 'attachment; filename="' + src.fileName + '"'
      };
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) outHeaders['Content-Length'] = contentLength;
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) outHeaders['Content-Range'] = contentRange;
      res.writeHead(upstream.status === 206 ? 206 : 200, outHeaders);
      if (!upstream.body) return res.end();
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => { try { res.destroy(); } catch (e) { /* noop */ } });
      stream.pipe(res);
      return;
    } catch (err) {
      return sendError(res, Object.assign(new Error('视频下载失败：' + (err.message || err)), { status: 502 }));
    }
  }
  // 本地视频上传：原始二进制流，返回 fileId 供文案任务使用
  if (url.pathname === '/api/trends/transcript/upload' && method === 'POST') {
    const rawName = String(url.searchParams.get('name') || '');
    const ext = path.extname(rawName).toLowerCase();
    if (!transcript.UPLOAD_EXTS.has(ext)) {
      return sendJSON(res, 400, { error: '不支持的视频格式，请上传 mp4 / mov / mkv / webm / mp3 等常见格式' });
    }
    const declared = Number(req.headers['content-length']) || 0;
    if (declared > UPLOAD_MAX_BYTES) {
      return sendJSON(res, 413, { error: '视频文件不能超过 2GB' });
    }
    const fileId = crypto.randomUUID() + ext;
    const target = path.join(transcript.UPLOAD_DIR, fileId);
    try {
      await fs.promises.mkdir(transcript.UPLOAD_DIR, { recursive: true });
      const size = await saveUpload(req, target, UPLOAD_MAX_BYTES);
      if (!size) throw Object.assign(new Error('上传内容为空'), { status: 400 });
      cleanupUploads();
      return sendJSON(res, 201, { fileId, name: transcript.baseName(rawName), size });
    } catch (err) {
      await fs.promises.rm(target, { force: true }).catch(() => {});
      return sendError(res, err);
    }
  }

  // 本地语音识别：ffmpeg / whisper.cpp / 模型状态
  if (url.pathname === '/api/asr/status' && method === 'GET') {
    return sendJSON(res, 200, asr.status());
  }
  if (url.pathname === '/api/asr/model' && method === 'POST') {
    if (!asr.modelReady()) asr.downloadModel().catch(() => {});
    return sendJSON(res, 202, asr.status());
  }

  // 住宅代理配置（对标账号抓取与小红书/抖音登录共用出口，各用户本机独立）
  if (url.pathname === '/api/proxy') {
    if (method === 'GET') {
      return sendJSON(res, 200, proxyConfig.getPublic());
    }
    if (method === 'PUT' || method === 'POST') {
      try {
        const body = await readBody(req);
        const saved = proxyConfig.save(body);
        // 配置变化后空闲时关掉暖浏览器，下次抓取按新配置重开
        await trendsBrowser.resetWarm();
        return sendJSON(res, 200, { ok: true, proxy: saved });
      } catch (err) {
        return sendError(res, err);
      }
    }
    res.writeHead(405, { Allow: 'GET, PUT, POST' });
    return res.end();
  }
  if (url.pathname === '/api/proxy/test' && method === 'POST') {
    try {
      const body = await readBody(req);
      return sendJSON(res, 200, await proxyConfig.test(body));
    } catch (err) {
      return sendError(res, err);
    }
  }
  if (url.pathname === '/api/proxy/rotate' && method === 'POST') {
    // 搜索/登录/采集进行中不能换出口，否则会打断正在进行的会话
    if (browserLogin.isBusy()) {
      return sendJSON(res, 409, { error: '有浏览器任务正在进行，请等待任务结束后再更换出口 IP' });
    }
    try {
      const rotated = proxyConfig.rotateSession();
      await trendsBrowser.resetWarm({ force: true });
      return sendJSON(res, 200, { ok: true, proxy: rotated });
    } catch (err) {
      return sendError(res, err);
    }
  }

  // 小红书笔记数据采集（复用一键登录的浏览器 profile）
  if (url.pathname === '/api/collectors/xiaohongshu/status' && method === 'GET') {
    return sendJSON(res, 200, xhsCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/xiaohongshu/run' && method === 'POST') {
    try {
      const result = await xhsCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // 抖音个人作品数据采集（复用一键登录保存的 Cookie）
  if (url.pathname === '/api/collectors/douyin/status' && method === 'GET') {
    return sendJSON(res, 200, douyinCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/douyin/run' && method === 'POST') {
    try {
      const result = await douyinCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // 视频号个人作品数据采集（复用一键登录保存的 Cookie）
  if (url.pathname === '/api/collectors/channels/status' && method === 'GET') {
    return sendJSON(res, 200, channelsCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/channels/run' && method === 'POST') {
    try {
      const result = await channelsCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // 快手个人作品数据采集（复用一键登录的浏览器会话）
  if (url.pathname === '/api/collectors/kuaishou/status' && method === 'GET') {
    return sendJSON(res, 200, kuaishouCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/kuaishou/run' && method === 'POST') {
    try {
      const result = await kuaishouCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // 微博个人作品 + 账号涨粉数据采集（复用一键登录保存的 Cookie）
  if (url.pathname === '/api/collectors/weibo/status' && method === 'GET') {
    return sendJSON(res, 200, weiboCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/weibo/run' && method === 'POST') {
    try {
      const result = await weiboCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // B站个人稿件数据采集（复用一键登录保存的 Cookie）
  if (url.pathname === '/api/collectors/bilibili/status' && method === 'GET') {
    return sendJSON(res, 200, bilibiliCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/bilibili/run' && method === 'POST') {
    try {
      const result = await bilibiliCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // 知乎个人视频作品数据采集（复用一键登录保存的 Cookie）
  if (url.pathname === '/api/collectors/zhihu/status' && method === 'GET') {
    return sendJSON(res, 200, zhihuCollector.getStatus());
  }
  if (url.pathname === '/api/collectors/zhihu/run' && method === 'POST') {
    try {
      const result = await zhihuCollector.run();
      touch('review', 'sync', '');
      touch('calendar', 'sync', '');
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, err.status || 502, { error: err.message });
    }
  }

  // 语音速记：录音文件与转写文本
  if (parts[1] === 'recordings') {
    const id = parts[2] || '';
    const sub = parts[3] || '';
    if (!id && method === 'GET') {
      return sendJSON(res, 200, {
        recordings: recordings.list({ assetId: url.searchParams.get('assetId') || '' })
      });
    }
    if (!id && method === 'POST') {
      try {
        const rec = await recordings.createFromRequest(req, {
          title: url.searchParams.get('title') || '',
          duration: url.searchParams.get('duration') || '',
          mime: url.searchParams.get('mime') || '',
          assetId: url.searchParams.get('assetId') || ''
        });
        touch('recordings', 'add', rec.id);
        return sendJSON(res, 201, { recording: rec });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && !sub && method === 'GET') {
      try {
        return sendJSON(res, 200, { recording: recordings.get(id) });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && !sub && (method === 'PATCH' || method === 'PUT')) {
      try {
        const body = await readBody(req);
        const rec = recordings.update(id, body);
        touch('recordings', 'update', rec.id);
        return sendJSON(res, 200, { recording: rec });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && !sub && method === 'DELETE') {
      try {
        const out = recordings.remove(id);
        touch('recordings', 'delete', id);
        return sendJSON(res, 200, out);
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && sub === 'audio' && (method === 'GET' || method === 'HEAD')) {
      return serveRecordingAudio(req, res, id);
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 发布素材：上传原始视频 / 图片流
  if (parts[1] === 'media') {
    const id = parts[2] || '';
    const sub = parts[3] || '';
    if (!id && method === 'GET') {
      return sendJSON(res, 200, {
        media: media.list({ scheduleId: url.searchParams.get('scheduleId') || '' })
      });
    }
    if (!id && method === 'POST') {
      try {
        const item = await media.createFromRequest(req, {
          name: url.searchParams.get('name') || '',
          kind: url.searchParams.get('kind') || '',
          role: url.searchParams.get('role') || 'content',
          ratio: url.searchParams.get('ratio') || '',
          duration: url.searchParams.get('duration') || '',
          mime: req.headers['content-type'] || ''
        });
        touch('media', 'add', item.id);
        return sendJSON(res, 201, { media: item });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && !sub && method === 'GET') {
      try {
        return sendJSON(res, 200, { media: media.get(id) });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && !sub && method === 'DELETE') {
      try {
        const removed = media.remove(id);
        touch('media', 'remove', removed.id);
        return sendJSON(res, 200, { removed: removed.id });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (id && sub === 'file' && (method === 'GET' || method === 'HEAD')) {
      return serveMediaAsset(req, res, id);
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 发布中心：任务队列
  if (parts[1] === 'publish') {
    if (parts[2] === 'status' && method === 'GET') {
      return sendJSON(res, 200, publishTasks.getStatus());
    }
    if (parts[2] === 'auto-queue' && method === 'POST') {
      try {
        await license.ensureFreshForPublish();
        license.assertPublishLicense();
        const body = await readBody(req);
        if (body && body.all) {
          const rows = [];
          let cursor = 0;
          for (;;) {
            const page = store.list('calendar', { pageSize: 500, cursor });
            rows.push(...page.results);
            if (!page.hasMore) break;
            cursor = Number(page.nextCursor) || 0;
          }
          const summary = { scanned: 0, created: [], skipped: [] };
          rows
            .filter((r) => r['当前阶段'] === '待发布')
            .forEach((r) => {
              const result = publishTasks.autoEnqueue(r['排期ID']);
              summary.scanned++;
              result.created.forEach((item) => summary.created.push(Object.assign({
                scheduleCode: result.scheduleCode,
                scheduleTitle: result.scheduleTitle
              }, item)));
              result.skipped.forEach((item) => summary.skipped.push(Object.assign({
                scheduleCode: result.scheduleCode,
                scheduleTitle: result.scheduleTitle
              }, item)));
            });
          return sendJSON(res, 200, { result: summary });
        }
        return sendJSON(res, 200, { result: publishTasks.autoEnqueue(body && body.scheduleCode) });
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (parts[2] === 'tasks') {
      const id = parts[3] || '';
      const action = parts[4] || '';
      if (!id && method === 'GET') {
        return sendJSON(res, 200, { tasks: publishTasks.list() });
      }
      if (!id && method === 'POST') {
        try {
          const body = await readBody(req);
          return sendJSON(res, 201, { task: publishTasks.create(body) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && !action && method === 'GET') {
        try {
          return sendJSON(res, 200, { task: publishTasks.get(id) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && !action && (method === 'PATCH' || method === 'PUT')) {
        try {
          const body = await readBody(req);
          return sendJSON(res, 200, { task: publishTasks.update(id, body) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && !action && method === 'DELETE') {
        try {
          return sendJSON(res, 200, publishTasks.remove(id));
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'run' && method === 'POST') {
        try {
          await license.ensureFreshForPublish();
          license.assertPublishLicense();
          return sendJSON(res, 200, { task: publishTasks.runNow(id) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'cancel' && method === 'POST') {
        try {
          return sendJSON(res, 200, { task: publishTasks.cancel(id) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'retry' && method === 'POST') {
        try {
          await license.ensureFreshForPublish();
          license.assertPublishLicense();
          return sendJSON(res, 200, { task: publishTasks.retry(id) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'complete' && method === 'POST') {
        try {
          const body = await readBody(req);
          return sendJSON(res, 200, { task: publishTasks.complete(id, body) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'log' && method === 'GET') {
        try {
          return sendJSON(res, 200, { log: publishTasks.getLog(id) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'screenshots' && method === 'GET') {
        try {
          return sendJSON(res, 200, { screenshots: publishTasks.listScreenshots(id) });
        } catch (err) {
          return sendError(res, err);
        }
      }
      if (id && action === 'screenshot' && (method === 'GET' || method === 'HEAD')) {
        const name = parts[5] ? decodeURIComponent(parts[5]) : '';
        const shot = publishTasks.getScreenshot(id, name);
        if (!shot) return sendJSON(res, 404, { error: '截图不存在' });
        res.writeHead(200, { 'Content-Type': shot.mime, 'Cache-Control': 'no-store' });
        if (method === 'HEAD') return res.end();
        return fs.createReadStream(shot.filePath).pipe(res);
      }
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 渠道连接设置
  if (parts[1] === 'connections') {
    const platform = decodeURIComponent(parts[2] || '');
    // GET /api/connections  → 全量（含定义与掩码）
    if (!platform && method === 'GET') {
      const data = channelConnections.getAll();
      try {
        data.proxy = proxyConfig.getPublic();
      } catch (err) {
        // 代理配置文件损坏不影响连接页展示
        data.proxy = null;
      }
      // AI 服务密钥（视频工坊使用），与渠道配置同页展示，读取时掩码
      try {
        data.ai = aiConfig.getAll();
      } catch (err) {
        data.ai = null;
      }
      // 海外 OAuth 渠道的授权状态（不含令牌明文）
      data.oauthStatus = {};
      Object.keys(data.defs || {}).forEach((p) => {
        if (!data.defs[p].oauth) return;
        try {
          data.oauthStatus[p] = oauth.tokenStatus(p);
        } catch (err) {
          data.oauthStatus[p] = { connected: false };
        }
      });
      return sendJSON(res, 200, data);
    }
    if (!platform) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '未指定渠道' }));
    }
    // 一键登录（Cookie 渠道）：POST 启动 / GET status 轮询 / DELETE 取消
    if (parts[3] === 'login') {
      if (method === 'POST') {
        try {
          return sendJSON(res, 202, { ok: true, login: channelConnections.startLogin(platform) });
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      if (method === 'GET' && parts[4] === 'status') {
        try {
          return sendJSON(res, 200, channelConnections.loginStatus(platform));
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      if (method === 'DELETE') {
        try {
          return sendJSON(res, 200, { ok: true, login: channelConnections.cancelLogin(platform) });
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      res.writeHead(405, { Allow: 'GET, POST, DELETE' });
      return res.end();
    }
    // 海外渠道 OAuth：POST start 发起 / GET status 轮询 / POST manual 粘贴回调 /
    // DELETE 断开授权
    if (parts[3] === 'oauth') {
      if (method === 'POST' && (!parts[4] || parts[4] === 'start')) {
        try {
          return sendJSON(res, 202, { ok: true, oauth: await oauth.start(platform) });
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      if (method === 'GET' && parts[4] === 'status') {
        try {
          return sendJSON(res, 200, oauth.status(platform));
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      if (method === 'POST' && parts[4] === 'manual') {
        const body = await readBody(req);
        try {
          const result = await oauth.manual(platform, body && body.input);
          return sendJSON(res, 200, result);
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      if (method === 'DELETE') {
        try {
          return sendJSON(res, 200, oauth.disconnect(platform));
        } catch (err) {
          return sendJSON(res, err.status || 400, { error: err.message });
        }
      }
      res.writeHead(405, { Allow: 'GET, POST, DELETE' });
      return res.end();
    }
    // GET /api/connections/:platform
    if (method === 'GET') {
      const rec = channelConnections.get(platform);
      if (!rec) return sendJSON(res, 404, { error: '未知渠道：' + platform });
      return sendJSON(res, 200, rec);
    }
    // POST /api/connections/:platform/test  （必须置于通用 POST 之前，否则会被 save 拦截）
    if (method === 'POST' && parts[3] === 'test') {
      const body = await readBody(req);
      try {
        const result = await channelConnections.test(platform, body);
        return sendJSON(res, 200, result);
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    // PUT /api/connections/:platform  { enabled, fields }
    if (method === 'PUT' || method === 'POST') {
      const body = await readBody(req);
      try {
        const rec = channelConnections.save(platform, body);
        // 公众号连接启用/停用时，同步开关数据监控定时任务
        if (platform === '公众号') {
          const raw = channelConnections.getRaw('公众号');
          if (raw) {
            wechatMonitor.saveConfig({
              platform: '公众号',
              enabled: raw.enabled
            });
            wechatMonitor.startScheduler();
          }
        }
        return sendJSON(res, 200, { ok: true, connection: rec });
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    res.writeHead(405, { Allow: 'GET, PUT, POST' });
    return res.end();
  }

  // 视频工坊：项目 / 脚本 / 分镜 / 角色
  if (parts[1] === 'video') {
    const wrap = (fn) => {
      try {
        return fn();
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    };
    const wrapAsync = async (fn) => {
      try {
        return await fn();
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    };

    if (parts[2] === 'meta' && method === 'GET') {
      return sendJSON(res, 200, {
        aspects: videoProjects.ASPECTS,
        statuses: videoProjects.STATUSES,
        renderModes: videoProjects.RENDER_MODES,
        sceneStatuses: videoProjects.SCENE_STATUSES
      });
    }

    // GET /api/video/models?provider=  列出可用模型（按用途分组）
    if (parts[2] === 'models' && method === 'GET') {
      const provider = url.searchParams.get('provider') || '';
      return wrapAsync(async () => {
        const grouped = await ai.listModels(provider);
        return sendJSON(res, 200, { provider: provider || ai.DEFAULT_PROVIDER, models: grouped });
      });
    }

    // GET /api/video/assets/:id/file  读取素材文件（支持 Range，前端用 ?account= 指定账号）
    if (parts[2] === 'assets' && parts[3] && parts[4] === 'file' && (method === 'GET' || method === 'HEAD')) {
      const found = videoAssets.getFile(decodeURIComponent(parts[3]));
      if (!found) return sendJSON(res, 404, { error: '素材不存在或文件已丢失' });
      return serveMediaFile(req, res, found, '素材文件不存在');
    }
    // GET/DELETE /api/video/assets/:id  素材元信息 / 删除
    if (parts[2] === 'assets' && parts[3] && !parts[4]) {
      const assetId = decodeURIComponent(parts[3]);
      if (method === 'GET') {
        const found = videoAssets.getAsset(assetId);
        if (!found) return sendJSON(res, 404, { error: '素材不存在' });
        return sendJSON(res, 200, { asset: found.asset });
      }
      if (method === 'DELETE') {
        return wrap(() => sendJSON(res, 200, videoAssets.deleteAsset(assetId)));
      }
      res.writeHead(405, { Allow: 'GET, DELETE' });
      return res.end();
    }

    // 复刻音色（账号级）：列表 / 上传录音并训练 / 刷新状态 / 试听音频 / 删除
    if (parts[2] === 'voices') {
      const voiceId = parts[3] ? decodeURIComponent(parts[3]) : '';
      if (!voiceId) {
        if (method === 'GET') {
          return wrap(() => sendJSON(res, 200, { voices: videoVoices.listVoices(), provider: videoTts.DOUBAO_PROVIDER }));
        }
        if (method === 'POST') {
          const body = await readBody(req, 16 * 1024 * 1024);
          return wrapAsync(async () => {
            const m = /^data:([^;,]+);base64,(.+)$/i.exec(String(body.dataUrl || ''));
            if (!m) return sendJSON(res, 400, { error: '请上传一段录音（wav / mp3 / m4a / ogg / aac）' });
            const mime = m[1].toLowerCase();
            const buffer = Buffer.from(m[2], 'base64');
            if (!buffer.length) return sendJSON(res, 400, { error: '录音内容为空' });
            if (buffer.length > 10 * 1024 * 1024) return sendJSON(res, 400, { error: '录音需小于 10MB' });
            const format = videoVoices.extForMime(mime);
            if (['wav', 'mp3', 'ogg', 'm4a', 'aac', 'pcm'].indexOf(format) < 0) {
              return sendJSON(res, 400, { error: '不支持该音频格式，请上传 wav / mp3 / m4a / ogg / aac' });
            }
            const draft = videoVoices.createVoice({ name: body.name, status: 'training' });
            const saved = videoVoices.saveSource(draft.id, buffer, mime);
            // 先落库 speaker 代号：即使训练请求失败，之后也能用原录音「重新提交复刻」
            const customId = videoTts.customSpeakerId();
            videoVoices.updateVoice(draft.id, { customId, sourceFile: saved.fileName, sourceMime: saved.mime });
            try {
              const cloned = await videoTts.cloneVoice({ buffer, format, name: body.name, customId });
              let demoFile = null;
              if (cloned.demoAudio) {
                try {
                  const demo = await videoTts.downloadAudio(cloned.demoAudio);
                  demoFile = videoVoices.saveDemo(draft.id, demo.buffer, demo.mime);
                } catch (err) { /* 试听下载失败不影响训练 */ }
              }
              const voice = videoVoices.updateVoice(draft.id, {
                provider: videoTts.DOUBAO_PROVIDER,
                voiceCode: cloned.voiceCode,
                customId: cloned.customId,
                modelType: cloned.modelType,
                status: cloned.status,
                error: cloned.status === 'failed' ? (cloned.message || '声音复刻失败') : '',
                sourceFile: saved.fileName,
                sourceMime: saved.mime,
                demoFile: demoFile ? demoFile.fileName : null,
                demoMime: demoFile ? demoFile.mime : null,
                meta: { demoAudio: cloned.demoAudio || '', message: cloned.message || '' }
              });
              return sendJSON(res, 200, { voice });
            } catch (err) {
              videoVoices.updateVoice(draft.id, {
                status: 'failed',
                error: (err && err.message) || '声音复刻失败',
                sourceFile: saved.fileName,
                sourceMime: saved.mime
              });
              throw err;
            }
          });
        }
        res.writeHead(405, { Allow: 'GET, POST' });
        return res.end();
      }

      if (parts[4] === 'audio' && (method === 'GET' || method === 'HEAD')) {
        const kind = url.searchParams.get('kind') === 'source' ? 'source' : 'demo';
        const found = videoVoices.getFile(voiceId, kind);
        if (!found) return sendJSON(res, 404, { error: '音色音频不存在或文件已丢失' });
        return serveMediaFile(req, res, found, '音色音频文件不存在');
      }

      if (method === 'POST' && parts[4] === 'refresh') {
        return wrapAsync(async () => {
          const voice = videoVoices.getVoice(voiceId);
          if (!voice) return sendJSON(res, 404, { error: '音色不存在' });
          const latest = await videoTts.queryVoice(voice);
          const patch = {
            voiceCode: latest.voiceCode || voice.voiceCode,
            modelType: latest.modelType == null ? voice.modelType : latest.modelType,
            status: latest.status,
            error: latest.status === 'failed' ? (latest.message || '声音复刻失败') : ''
          };
          if (latest.demoAudio && latest.status === 'ready') {
            try {
              const demo = await videoTts.downloadAudio(latest.demoAudio);
              const savedDemo = videoVoices.saveDemo(voiceId, demo.buffer, demo.mime);
              patch.demoFile = savedDemo.fileName;
              patch.demoMime = savedDemo.mime;
            } catch (err) { /* 忽略试听下载失败 */ }
          }
          const meta = Object.assign({}, voice.meta || {});
          if (latest.demoAudio) meta.demoAudio = latest.demoAudio;
          patch.meta = meta;
          return sendJSON(res, 200, { voice: videoVoices.updateVoice(voiceId, patch) });
        });
      }

      // 用已保存的原始录音重新提交复刻（适合开通服务 / 换项目后重试，无需重录）
      if (method === 'POST' && parts[4] === 'retry') {
        return wrapAsync(async () => {
          const voice = videoVoices.getVoice(voiceId);
          if (!voice) return sendJSON(res, 404, { error: '音色不存在' });
          const source = videoVoices.getFile(voiceId, 'source');
          if (!source) return sendJSON(res, 400, { error: '原始录音已丢失，请重新录制并提交复刻' });
          const buffer = fs.readFileSync(source.filePath);
          if (!buffer.length) return sendJSON(res, 400, { error: '原始录音文件为空，请重新录制' });
          const format = videoVoices.extForMime(source.mime);
          const customId = videoTts.customSpeakerId();
          videoVoices.updateVoice(voiceId, { customId, status: 'training', error: '' });
          try {
            const cloned = await videoTts.cloneVoice({ buffer, format, name: voice.name, customId });
            let demoFile = null;
            if (cloned.demoAudio) {
              try {
                const demo = await videoTts.downloadAudio(cloned.demoAudio);
                demoFile = videoVoices.saveDemo(voiceId, demo.buffer, demo.mime);
              } catch (err) { /* 试听下载失败不影响训练 */ }
            }
            const updated = videoVoices.updateVoice(voiceId, {
              voiceCode: cloned.voiceCode,
              customId: cloned.customId,
              modelType: cloned.modelType,
              status: cloned.status,
              error: cloned.status === 'failed' ? (cloned.message || '声音复刻失败') : '',
              demoFile: demoFile ? demoFile.fileName : null,
              demoMime: demoFile ? demoFile.mime : null,
              meta: { demoAudio: cloned.demoAudio || '', message: cloned.message || '' }
            });
            return sendJSON(res, 200, { voice: updated });
          } catch (err) {
            videoVoices.updateVoice(voiceId, { status: 'failed', error: (err && err.message) || '声音复刻失败', customId });
            throw err;
          }
        });
      }

      if (method === 'DELETE') {
        return wrap(() => sendJSON(res, 200, videoVoices.deleteVoice(voiceId)));
      }

      res.writeHead(405, { Allow: 'GET, POST, DELETE' });
      return res.end();
    }

    if (parts[2] === 'projects') {
      const id = parts[3] ? decodeURIComponent(parts[3]) : '';
      const sub = parts[4] || '';

      if (!id) {
        if (method === 'GET') return wrap(() => sendJSON(res, 200, { projects: videoProjects.listProjects() }));
        if (method === 'POST') {
          const body = await readBody(req);
          return wrap(() => sendJSON(res, 200, { project: videoProjects.createProject(body) }));
        }
        res.writeHead(405, { Allow: 'GET, POST' });
        return res.end();
      }

      if (!sub) {
        if (method === 'GET') {
          const project = videoProjects.getProject(id);
          if (!project) return sendJSON(res, 404, { error: '视频项目不存在' });
          return sendJSON(res, 200, { project });
        }
        if (method === 'PUT' || method === 'PATCH') {
          const body = await readBody(req);
          return wrap(() => sendJSON(res, 200, { project: videoProjects.updateProject(id, body) }));
        }
        if (method === 'DELETE') {
          return wrap(() => sendJSON(res, 200, videoProjects.deleteProject(id)));
        }
        res.writeHead(405, { Allow: 'GET, PUT, PATCH, DELETE' });
        return res.end();
      }

      if (sub === 'script') {
        if (method === 'POST' && parts[5] === 'generate') {
          const body = await readBody(req);
          return wrapAsync(async () => sendJSON(res, 200, await videoGenerate.generateScript(id, body)));
        }
        if (method === 'GET') {
          const versionParam = url.searchParams.get('version');
          const script = versionParam
            ? videoProjects.getScriptVersion(id, Number(versionParam))
            : videoProjects.getLatestScript(id);
          if (!script) return sendJSON(res, 404, { error: '脚本版本不存在' });
          return sendJSON(res, 200, { script });
        }
        if (method === 'POST') {
          const body = await readBody(req);
          return wrap(() => sendJSON(res, 200, { script: videoProjects.saveScript(id, body) }));
        }
        res.writeHead(405, { Allow: 'GET, POST' });
        return res.end();
      }

      if (sub === 'scenes') {
        if (method === 'POST' && parts[5] === 'plan') {
          const body = await readBody(req);
          return wrapAsync(async () => sendJSON(res, 200, await videoGenerate.planScenes(id, body)));
        }
        if (method === 'GET') return wrap(() => sendJSON(res, 200, { scenes: videoProjects.listScenes(id) }));
        if (method === 'POST') {
          const body = await readBody(req);
          return wrap(() => sendJSON(res, 200, { scene: videoProjects.addScene(id, body) }));
        }
        if (method === 'PUT' || method === 'PATCH') {
          const body = await readBody(req);
          return wrap(() => sendJSON(res, 200, { scenes: videoProjects.reorderScenes(id, body.ids) }));
        }
        res.writeHead(405, { Allow: 'GET, POST, PUT' });
        return res.end();
      }

      // 片头标题：PUT 保存标题文字与显示秒数
      if (sub === 'title' && (method === 'PUT' || method === 'PATCH')) {
        const body = await readBody(req);
        return wrapAsync(async () => sendJSON(res, 200, videoRender.setTitle(id, body)));
      }

      // 背景音乐：POST 上传/替换 · PUT 调整音量 · DELETE 清除
      if (sub === 'bgm') {
        if (method === 'POST') {
          const body = await readBody(req, 20 * 1024 * 1024);
          return wrapAsync(async () => sendJSON(res, 200, await videoRender.setBgm(id, body)));
        }
        if (method === 'PUT' || method === 'PATCH') {
          const body = await readBody(req);
          return wrapAsync(async () => sendJSON(res, 200, videoRender.setBgmVolume(id, body)));
        }
        if (method === 'DELETE') {
          return wrapAsync(async () => sendJSON(res, 200, videoRender.clearBgm(id)));
        }
        res.writeHead(405, { Allow: 'POST, PUT, DELETE' });
        return res.end();
      }

      // 参考视频：POST 接入（body.fileId 或 body.url）· GET 预览文件 · DELETE 解绑
      if (sub === 'reference') {
        if (method === 'POST' && parts[5] === 'frames') {
          return wrapAsync(async () => sendJSON(res, 200, await videoReference.applyFramesToProject(id, {})));
        }
        if (method === 'POST') {
          const body = await readBody(req);
          return wrapAsync(async () => sendJSON(res, 200, await videoReference.attach(id, body)));
        }
        if ((method === 'GET' || method === 'HEAD') && parts[5] === 'file') {
          const project = videoProjects.getProject(id);
          if (!project) return sendJSON(res, 404, { error: '视频项目不存在' });
          const filePath = videoReference.referenceFilePath(project);
          if (!filePath || !videoReference.referenceFileExists(project)) {
            return sendJSON(res, 404, { error: '参考视频不存在' });
          }
          const ext = path.extname(filePath).replace('.', '').toLowerCase() || 'mp4';
          return serveMediaFile(req, res, { filePath, mime: videoAssets.mimeFor(ext) }, '参考视频文件丢失');
        }
        if (method === 'DELETE') {
          return wrap(() => sendJSON(res, 200, videoReference.clear(id)));
        }
        res.writeHead(405, { Allow: 'GET, POST, DELETE' });
        return res.end();
      }

      // POST /api/video/projects/:id/render  合成整片（缺失片段自动渲染）
      if (sub === 'render' && method === 'POST') {
        const body = await readBody(req);
        return wrapAsync(async () => sendJSON(res, 200, await videoRender.assembleProject(id, body)));
      }

      // POST /api/video/projects/:id/voice  { voiceId }  绑定/解绑项目配音音色
      if (sub === 'voice' && method === 'POST') {
        const body = await readBody(req);
        return wrap(() => {
          const project = videoProjects.getProject(id);
          if (!project) return sendJSON(res, 404, { error: '视频项目不存在' });
          const voiceId = body.voiceId ? String(body.voiceId) : '';
          if (voiceId && !videoVoices.getVoice(voiceId)) return sendJSON(res, 404, { error: '音色不存在' });
          const settings = Object.assign({}, project.settings || {});
          if (voiceId) settings.ttsVoiceId = voiceId;
          else delete settings.ttsVoiceId;
          return sendJSON(res, 200, { project: videoProjects.updateProject(id, { settings }) });
        });
      }

      if (sub === 'assets') {
        if (method === 'GET') {
          const kind = url.searchParams.get('kind') || '';
          return wrap(() => sendJSON(res, 200, { assets: videoAssets.listAssets(id, kind) }));
        }
        res.writeHead(405, { Allow: 'GET' });
        return res.end();
      }

      if (sub === 'characters') {
        if (method === 'GET') return wrap(() => sendJSON(res, 200, { characters: videoProjects.listCharacters(id) }));
        if (method === 'POST') {
          const body = await readBody(req);
          return wrap(() => sendJSON(res, 200, { character: videoProjects.addCharacter(id, body) }));
        }
        res.writeHead(405, { Allow: 'GET, POST' });
        return res.end();
      }

      return sendJSON(res, 404, { error: '接口不存在' });
    }

    const sceneId = parts[2] === 'scenes' && parts[3] ? decodeURIComponent(parts[3]) : '';
    if (sceneId) {
      // POST /api/video/scenes/:id/image  生成该分镜的图片素材
      if (method === 'POST' && parts[4] === 'image') {
        const body = await readBody(req);
        return wrapAsync(async () => {
          const scene = videoProjects.getSceneRow(sceneId);
          if (!scene) return sendJSON(res, 404, { error: '分镜不存在' });
          return sendJSON(res, 200, await videoGenerate.generateSceneImage(scene.project_id, sceneId, body));
        });
      }
      // POST /api/video/scenes/:id/audio  用旁白生成配音
      if (method === 'POST' && parts[4] === 'audio') {
        const body = await readBody(req);
        return wrapAsync(async () => {
          const scene = videoProjects.getSceneRow(sceneId);
          if (!scene) return sendJSON(res, 404, { error: '分镜不存在' });
          return sendJSON(res, 200, await videoGenerate.generateSceneAudio(scene.project_id, sceneId, body));
        });
      }
      // POST /api/video/scenes/:id/video  以该分镜图片为首帧创建图生视频任务
      if (method === 'POST' && parts[4] === 'video') {
        const body = await readBody(req);
        return wrapAsync(async () => {
          const scene = videoProjects.getSceneRow(sceneId);
          if (!scene) return sendJSON(res, 404, { error: '分镜不存在' });
          return sendJSON(res, 200, await videoGenerate.createSceneVideo(scene.project_id, sceneId, body));
        });
      }
      // GET /api/video/scenes/:id/video  轮询图生视频任务
      if (method === 'GET' && parts[4] === 'video') {
        return wrapAsync(async () => {
          const scene = videoProjects.getSceneRow(sceneId);
          if (!scene) return sendJSON(res, 404, { error: '分镜不存在' });
          return sendJSON(res, 200, await videoGenerate.pollSceneVideo(sceneId));
        });
      }
      // POST /api/video/scenes/:id/segment  渲染该分镜为统一规格片段
      if (method === 'POST' && parts[4] === 'segment') {
        const body = await readBody(req);
        return wrapAsync(async () => {
          const scene = videoProjects.getSceneRow(sceneId);
          if (!scene) return sendJSON(res, 404, { error: '分镜不存在' });
          return sendJSON(res, 200, await videoRender.renderSceneSegment(scene.project_id, sceneId, body));
        });
      }
      // POST /api/video/scenes/:id/ref-frame  取参考视频对应时间点的画面作为首帧
      if (method === 'POST' && parts[4] === 'ref-frame') {
        const body = await readBody(req);
        return wrapAsync(async () => {
          const scene = videoProjects.getSceneRow(sceneId);
          if (!scene) return sendJSON(res, 404, { error: '分镜不存在' });
          return sendJSON(res, 200, await videoReference.applyFrameToScene(scene.project_id, sceneId, body));
        });
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readBody(req);
        return wrap(() => sendJSON(res, 200, { scene: videoProjects.updateScene(sceneId, body) }));
      }
      if (method === 'DELETE') {
        return wrap(() => sendJSON(res, 200, videoProjects.deleteScene(sceneId)));
      }
      return sendJSON(res, 405, { error: '不支持的请求方式' });
    }

    const characterId = parts[2] === 'characters' && parts[3] ? decodeURIComponent(parts[3]) : '';
    if (characterId) {
      // POST /api/video/characters/:id/refs  上传角色参考图（内联 data URL）
      if (method === 'POST' && parts[4] === 'refs') {
        const body = await readBody(req);
        return wrapAsync(async () => {
          const row = videoProjects.getCharacterRow(characterId);
          if (!row) return sendJSON(res, 404, { error: '角色不存在' });
          if (!body.dataUrl) return sendJSON(res, 400, { error: '缺少参考图内容' });
          const asset = await videoAssets.saveFromUrl(row.project_id, {
            kind: 'image',
            dataUrl: body.dataUrl,
            provider: 'upload',
            meta: { role: 'character-ref', characterId }
          });
          let refs = [];
          try { refs = JSON.parse(row.refs || '[]'); } catch (e) { refs = []; }
          refs = refs.concat(asset.id).slice(-4);
          return sendJSON(res, 200, { character: videoProjects.updateCharacter(characterId, { refs }), asset });
        });
      }
      // DELETE /api/video/characters/:id/refs/:assetId  删除参考图
      if (method === 'DELETE' && parts[4] === 'refs' && parts[5]) {
        const assetId = decodeURIComponent(parts[5]);
        return wrap(() => {
          const row = videoProjects.getCharacterRow(characterId);
          if (!row) return sendJSON(res, 404, { error: '角色不存在' });
          let refs = [];
          try { refs = JSON.parse(row.refs || '[]'); } catch (e) { refs = []; }
          videoAssets.deleteAsset(assetId);
          return sendJSON(res, 200, { character: videoProjects.updateCharacter(characterId, { refs: refs.filter((r) => r !== assetId) }) });
        });
      }
      // POST /api/video/characters/:id/anchor/active  把某张候选设为当前定妆图
      if (method === 'POST' && parts[4] === 'anchor' && parts[5] === 'active') {
        const body = await readBody(req);
        return wrap(() => {
          const row = videoProjects.getCharacterRow(characterId);
          if (!row) return sendJSON(res, 404, { error: '角色不存在' });
          let anchors = [];
          try { anchors = JSON.parse(row.anchors || '[]'); } catch (e) { anchors = []; }
          const assetId = String(body.assetId || '');
          const found = (Array.isArray(anchors) ? anchors : []).some((a) => a && a.assetId === assetId);
          if (!found) return sendJSON(res, 400, { error: '定妆图候选不存在' });
          return sendJSON(res, 200, { character: videoProjects.updateCharacter(characterId, { anchorAssetId: assetId }) });
        });
      }
      // DELETE /api/video/characters/:id/anchor/:assetId  删除某张候选定妆图
      if (method === 'DELETE' && parts[4] === 'anchor' && parts[5]) {
        const assetId = decodeURIComponent(parts[5]);
        return wrap(() => {
          const row = videoProjects.getCharacterRow(characterId);
          if (!row) return sendJSON(res, 404, { error: '角色不存在' });
          let anchors = [];
          try { anchors = JSON.parse(row.anchors || '[]'); } catch (e) { anchors = []; }
          const all = Array.isArray(anchors) ? anchors : [];
          if (!all.some((a) => a && a.assetId === assetId)) {
            return sendJSON(res, 404, { error: '定妆图候选不存在' });
          }
          const list = all.filter((a) => a && a.assetId !== assetId);
          videoAssets.deleteAsset(assetId);
          const patch = { anchors: list };
          if (row.anchor_asset_id === assetId) patch.anchorAssetId = list.length ? list[list.length - 1].assetId : null;
          return sendJSON(res, 200, { character: videoProjects.updateCharacter(characterId, patch) });
        });
      }
      // POST /api/video/characters/:id/anchor  生成定妆图（可传 style / setActive / profile）
      if (method === 'POST' && parts[4] === 'anchor' && !parts[5]) {
        const body = await readBody(req);
        return wrapAsync(async () => sendJSON(res, 200, await videoGenerate.generateCharacterAnchor(characterId, body)));
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readBody(req);
        return wrap(() => sendJSON(res, 200, { character: videoProjects.updateCharacter(characterId, body) }));
      }
      if (method === 'DELETE') {
        return wrap(() => sendJSON(res, 200, videoProjects.deleteCharacter(characterId)));
      }
      return sendJSON(res, 405, { error: '不支持的请求方式' });
    }

    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // AI 服务密钥（视频工坊）
  if (parts[1] === 'ai-config') {
    const provider = decodeURIComponent(parts[2] || '');
    // GET /api/ai-config → 全量（含定义与掩码）
    if (!provider && method === 'GET') {
      return sendJSON(res, 200, aiConfig.getAll());
    }
    if (!provider) {
      return sendJSON(res, 404, { error: '未指定 AI 服务' });
    }
    if (!aiConfig.DEFS[provider]) {
      return sendJSON(res, 404, { error: '未知 AI 服务：' + provider });
    }
    // GET /api/ai-config/:provider
    if (method === 'GET') {
      return sendJSON(res, 200, aiConfig.get(provider));
    }
    // POST /api/ai-config/:provider/test  （必须置于通用保存之前）
    if (method === 'POST' && parts[3] === 'test') {
      const body = await readBody(req);
      try {
        return sendJSON(res, 200, await aiConfig.test(provider, body));
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    // PUT /api/ai-config/:provider  { enabled, fields }
    if (method === 'PUT' || method === 'POST') {
      const body = await readBody(req);
      try {
        const rec = aiConfig.save(provider, body);
        return sendJSON(res, 200, { ok: true, config: rec });
      } catch (err) {
        return sendJSON(res, err.status || 400, { error: err.message });
      }
    }
    res.writeHead(405, { Allow: 'GET, PUT, POST' });
    return res.end();
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify({ error: '接口不存在' }));
}

function touch(tableKey, action, id) {
  lastSelfWrite = Date.now();
  broadcast({
    table: tableKey,
    action,
    id,
    accountId: accountContext.currentOrDefault(),
    at: new Date().toISOString()
  });
}

publishTasks.setChangeHook((table, action, id) => touch(table, action, id));

/* ---------------- 服务 ---------------- */

/**
 * 解析请求所属账号：前端用 X-Account-Id 头，无法自定义头的请求
 * （img/audio/video、CSV 下载、EventSource）用 ?account= 查询参数。
 * 未知或缺失时回落到注册表里上次使用的账号。
 */
function resolveAccountId(req, url) {
  const header = req.headers['x-account-id'];
  const raw = (Array.isArray(header) ? header[0] : header) || url.searchParams.get('account') || '';
  return accounts.resolveId(raw) || accounts.getActiveId();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  // OAuth 回调由浏览器直接打开，不带账号头：账号由 state 决定，
  // 必须在解析当前账号之前拦截。
  if (url.pathname.startsWith('/api/oauth/')) {
    oauth.handleCallback(req, res, url).catch((err) => {
      console.error('[oauth] 回调处理失败：', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('授权回调处理失败：' + err.message);
      }
    });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    const accountId = resolveAccountId(req, url);
    accountContext
      .run(accountId, () => handleApi(req, res, url))
      .catch((err) => {
        if (!res.headersSent) sendError(res, err);
        else {
          console.error('[error]', err);
          try { res.end(); } catch (e) { /* noop */ }
        }
      });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  return serveStatic(req, res, url.pathname);
});

// 账号注册表必须先建立，后续所有数据库/文件路径才能按账号落位
let accountIds = [accountContext.DEFAULT_ACCOUNT_ID];
try {
  accounts.ensureRegistry();
  accountIds = accounts.listIds();
} catch (err) {
  console.warn('[accounts] 账号注册表初始化失败，按默认账号启动：', err.message);
}

try {
  accountIds.forEach((id) => {
    accountContext.run(id, () => {
      // 默认账号沿用旧逻辑（含首次示例数据 / 旧数据迁移），新账号从空工作区开始
      const info = id === accounts.DEFAULT_ID ? store.init() : store.init({ seed: false });
      console.log(`[db] 账号 ${id}：SQLite ${store.dbPath()}`);
      if (id === accounts.getActiveId()) console.log(`[db] ${JSON.stringify(info.counts)}`);
    });
  });
} catch (err) {
  console.error('[db] 初始化失败：', err.message);
  process.exit(1);
}

function gcStagedAllAccounts() {
  let ids = accountIds;
  try {
    ids = accounts.listIds();
  } catch (err) {
    /* 注册表暂不可读时沿用启动时的账号列表 */
  }
  ids.forEach((id) => {
    try {
      accountContext.run(id, () => {
        const cleaned = media.gcStaged();
        if (cleaned) console.log(`[media] 账号 ${id}：已清理 ${cleaned} 个过期的暂存素材`);
      });
    } catch (err) {
      console.warn(`[media] 账号 ${id} 暂存素材清理失败：`, err.message);
    }
  });
}

try {
  gcStagedAllAccounts();
  const gcTimer = setInterval(gcStagedAllAccounts, 60 * 60 * 1000);
  if (gcTimer.unref) gcTimer.unref();
} catch (err) {
  console.warn('[media] 暂存素材清理失败：', err.message);
}

accountIds.forEach((id) => accountContext.run(id, () => cleanupUploads()));

try {
  const started = wechatMonitor.startScheduler();
  const ms = wechatMonitor.getStatus();
  console.log(
    `[monitor] 公众号监控：${started ? `已启用，每 ${ms.intervalMinutes} 分钟抓取（平台：${ms.platform}）` : '未启用（在「连接设置」完成公众号一键登录后自动启用）'}`
  );
} catch (err) {
  console.warn('[monitor] 定时器启动异常（可稍后配置）：', err.message);
}

try {
  const ls = license.init();
  license.startRefreshTimer();
  console.log(
    `[license] 授权状态：${ls.license.present ? `${ls.license.planName || '已激活'}` : '未激活'}；发布${ls.publish.allowed ? '已授权' : '受限（需激活授权码）'}`
  );
} catch (err) {
  console.warn('[license] 授权模块启动异常：', err.message);
}

try {
  publishTasks.startScheduler();
  const ps = publishTasks.getStatus();
  console.log(`[publish] 发布队列：每 30 秒巡检，到点自动发布；已排程 ${ps.scheduled} 条`);
} catch (err) {
  console.warn('[publish] 发布队列启动异常：', err.message);
}

try {
  const started = benchmarks.startScheduler();
  const bs = benchmarks.getStatus();
  console.log(
    `[benchmarks] 对标账号：${started ? `每天 ${String(bs.hour).padStart(2, '0')}:${String(bs.minute).padStart(2, '0')} 自动更新，下次 ${bs.nextRunAt || '—'}` : '未启用'}`
  );
} catch (err) {
  console.warn('[benchmarks] 定时器启动异常：', err.message);
}

server.on('error', (err) => {
  console.error('[server] 启动失败：', err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const dataDir = path.dirname(accounts.REGISTRY_FILE);
  console.log(`媒管家已启动：http://${HOST}:${PORT}`);
  console.log(
    `按 Ctrl+C 停止；共 ${accountIds.length} 个运营账号，数据目录 ${dataDir}（每日自动备份到 backups/）`
  );
});

let shuttingDown = false;
function gracefulShutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n正在关闭…' + (reason ? `（${reason}）` : ''));
  try {
    publishTasks.stopScheduler();
  } catch (err) {}
  try {
    benchmarks.stopScheduler();
  } catch (err) {}
  try {
    license.stopRefreshTimer();
  } catch (err) {}
  try {
    browserLogin.cancel();
  } catch (err) {}
  // 尽力关闭暖浏览器并回收本地代理隧道（不阻塞退出）
  try {
    Promise.resolve(trendsBrowser.resetWarm({ force: true })).catch(() => {});
  } catch (err) {}
  clients.forEach((res) => {
    try {
      res.end();
    } catch (err) {}
  });
  const timer = setTimeout(() => process.exit(0), 2000);
  if (timer.unref) timer.unref();
  server.close(() => {
    clearTimeout(timer);
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
if (process.send) {
  process.on('message', (msg) => {
    if (msg && msg.type === 'shutdown') gracefulShutdown('desktop');
  });
}
