'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const store = require('./lib/store');
const { tables, tableOrder, publicSchema } = require('./lib/schemas');
const wechatMonitor = require('./lib/wechat-monitor');
const channelConnections = require('./lib/channel-connections');
const xhsCollector = require('./lib/xhs-collector');
const douyinCollector = require('./lib/douyin-collector');
const channelsCollector = require('./lib/channels-collector');
const recordings = require('./lib/recordings');
const media = require('./lib/media');
const publishTasks = require('./lib/publish-tasks');
const profile = require('./lib/profile');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || readFlag('--port') || 5180;
const HOST = process.env.HOST || readFlag('--host') || '127.0.0.1';

/* ---------------- 事件推送（多标签页双向同步） ---------------- */
const clients = new Set();
let lastSelfWrite = 0;

function broadcast(payload) {
  const data = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach((res) => {
    try {
      res.write(data);
    } catch (err) {
      clients.delete(res);
    }
  });
}

/* ---------------- 工具 ---------------- */
function readFlag(name) {
  const idx = process.argv.indexOf(name);
  if (idx > 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
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
  sendJSON(res, status, { error: err && err.message ? err.message : '服务端错误' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(Object.assign(new Error('请求体过大，单条记录请控制在 4MB 内'), { status: 413 }));
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
      version: require('./package.json').version,
      storage: 'sqlite',
      db: store.dbPath,
      integrity: store.integrity(),
      tables: store.stats(),
      orphans: store.orphans(),
      time: new Date().toISOString()
    });
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
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
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
      return sendJSON(res, 200, channelConnections.getAll());
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

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  return res.end(JSON.stringify({ error: '接口不存在' }));
}

function touch(tableKey, action, id) {
  lastSelfWrite = Date.now();
  broadcast({ table: tableKey, action, id, at: new Date().toISOString() });
}

publishTasks.setChangeHook((table, action, id) => touch(table, action, id));

/* ---------------- 服务 ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => sendError(res, err));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  return serveStatic(req, res, url.pathname);
});

try {
  const info = store.init();
  console.log(`[db] SQLite ${store.dbPath}`);
  console.log(`[db] ${JSON.stringify(info.counts)}`);
} catch (err) {
  console.error('[db] 初始化失败：', err.message);
  process.exit(1);
}

try {
  const cleaned = media.gcStaged();
  if (cleaned) console.log(`[media] 已清理 ${cleaned} 个过期的暂存素材`);
  const gcTimer = setInterval(() => {
    try {
      media.gcStaged();
    } catch (err) {
      console.warn('[media] 暂存素材清理失败：', err.message);
    }
  }, 60 * 60 * 1000);
  if (gcTimer.unref) gcTimer.unref();
} catch (err) {
  console.warn('[media] 暂存素材清理失败：', err.message);
}

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
  publishTasks.startScheduler();
  const ps = publishTasks.getStatus();
  console.log(`[publish] 发布队列：每 30 秒巡检，到点自动发布；已排程 ${ps.scheduled} 条`);
} catch (err) {
  console.warn('[publish] 发布队列启动异常：', err.message);
}

server.listen(PORT, HOST, () => {
  console.log(`自媒体内容运营工作台已启动：http://${HOST}:${PORT}`);
  console.log('按 Ctrl+C 停止；数据库 data/workbench.db，每日自动备份到 data/backups/');
});

process.on('SIGINT', () => {
  console.log('\n正在关闭…');
  publishTasks.stopScheduler();
  clients.forEach((res) => {
    try {
      res.end();
    } catch (err) {}
  });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 800);
});
