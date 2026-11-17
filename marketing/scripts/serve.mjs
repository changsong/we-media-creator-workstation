#!/usr/bin/env node
// 本地营销看板服务：读取 SQLite 工作台，提供平台概览、名单与发送台。
//   node marketing/scripts/serve.mjs              默认 http://127.0.0.1:4173
//   node marketing/scripts/serve.mjs --port 8080  换端口
//   node marketing/scripts/serve.mjs --host 0.0.0.0  局域网可访问（谨慎）

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemplates, normalizePlatform, parseArgs, platformLabel } from './lib/util.mjs';
import { draftFor } from './lib/draft.mjs';
import { dbFile, getLead, listLeads, markSent, markSkipped, queue, setLeadStatus, stats } from './lib/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(HERE, '..', 'web');
const args = parseArgs();
const PORT = Number(args.port) || 4173;
const HOST = args.host ? String(args.host) : '127.0.0.1';
const bank = loadTemplates();

// 轮询顺序：一条抖音 → 一条 B站 → 一条小红书 → 一条视频号，循环。
// 想临时关掉某平台的发送，在 templates.json 的 settings.sendExcludePlatforms 里加平台键。
const PLATFORM_ORDER = ['douyin', 'bilibili', 'kuaishou', 'xiaohongshu', 'channels', 'unknown'];
const EXCLUDED_PLATFORMS = (Array.isArray(bank.settings.sendExcludePlatforms) ? bank.settings.sendExcludePlatforms : [])
  .map((item) => normalizePlatform(item))
  .filter(Boolean);
const SEND_PLATFORMS = PLATFORM_ORDER.filter((platform) => !EXCLUDED_PLATFORMS.includes(platform));

// 懒加载浏览器模块：只有点「自动打开私信」时才启动/复用 CDP Chrome。
let browserLib = null;
let openChain = Promise.resolve();

async function openDouyinProfile(profileUrl) {
  if (!browserLib) browserLib = await import('./lib/browser.mjs');
  const run = async () => {
    const session = await browserLib.openSession(profileUrl);
    try {
      await session.navigate(profileUrl, 1500);
      return await session.openDm();
    } finally {
      session.close();
    }
  };
  // 串行执行，避免连点导致同时拉起多个 Chrome 窗口。
  const result = openChain.then(run, run);
  openChain = result.catch(() => {});
  return result;
}

function isDouyinUrl(raw) {
  try {
    const target = new URL(raw);
    return /^https?:$/.test(target.protocol) && /(^|\.)douyin\.com$/i.test(target.hostname);
  } catch (err) {
    return false;
  }
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function serveFile(res, name) {
  const file = path.join(WEB_DIR, name);
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('页面文件缺失：marketing/web/' + name);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('请求体过大'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function withDraft(lead) {
  const { opener, text } = draftFor(bank, lead);
  return { ...lead, platform_label: platformLabel(lead.platform), template_id: opener.id, draft: text };
}

// 按平台轮询交错，避免连续发同一平台。
function interleave(leads, limit) {
  const buckets = new Map();
  for (const lead of leads) {
    const key = lead.platform || 'unknown';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(lead);
  }
  const keys = [
    ...PLATFORM_ORDER.filter((key) => buckets.has(key)),
    ...[...buckets.keys()].filter((key) => !PLATFORM_ORDER.includes(key)),
  ];
  const out = [];
  while (out.length < limit) {
    let moved = false;
    for (const key of keys) {
      const arr = buckets.get(key);
      if (arr && arr.length) {
        out.push(arr.shift());
        moved = true;
        if (out.length >= limit) break;
      }
    }
    if (!moved) break;
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      serveFile(res, 'index.html');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/send.html') {
      serveFile(res, 'send.html');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/overview') {
      sendJson(res, 200, { ...stats(), db: dbFile() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const platform = normalizePlatform(url.searchParams.get('platform'));
      const status = url.searchParams.get('status') || '';
      const search = (url.searchParams.get('q') || '').trim();
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
      sendJson(res, 200, listLeads({ status, platform, search, limit }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/queue') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
      const minFollowers = Math.max(0, Number(url.searchParams.get('min-followers')) || 0);
      const maxFollowers = Math.max(0, Number(url.searchParams.get('max-followers')) || 0);
      const cooldownDays = Math.max(1, Number(url.searchParams.get('cooldown-days')) || bank.settings.cooldownDays || 30);
      // 每个平台各自取候选，再做交错，保证多平台名单都轮到，不被抖音大户挤占。
      const pool = [];
      for (const platform of SEND_PLATFORMS) {
        pool.push(...queue({ limit, cooldownDays, minFollowers, maxFollowers, platform }));
      }
      const items = interleave(pool, limit).map(withDraft);
      const s = stats();
      sendJson(res, 200, {
        items,
        sentToday: s.sentToday,
        dailyCap: bank.settings.dailyCap || 20,
        intervalSeconds: { min: 60, max: 120 },
        excludedPlatforms: EXCLUDED_PLATFORMS.map((platform) => ({ key: platform, label: platformLabel(platform) })),
      });
      return;
    }

    const openMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/open$/);
    if (req.method === 'POST' && openMatch) {
      const id = Number(openMatch[1]);
      const lead = getLead(id);
      if (!lead) {
        sendJson(res, 404, { error: `找不到名单 #${id}` });
        return;
      }
      if (lead.platform !== 'douyin') {
        sendJson(res, 400, { error: '目前只有抖音支持自动打开私信面板' });
        return;
      }
      if (!isDouyinUrl(lead.profile_url)) {
        sendJson(res, 400, { error: '名单缺少有效的抖音主页链接' });
        return;
      }
      const dmClicked = await openDouyinProfile(lead.profile_url);
      sendJson(res, 200, { ok: true, dmClicked: !!dmClicked });
      return;
    }

    const actionMatch = url.pathname.match(/^\/api\/leads\/(\d+)\/(status|sent|skip)$/);
    if (req.method === 'POST' && actionMatch) {
      const id = Number(actionMatch[1]);
      const action = actionMatch[2];
      const lead = getLead(id);
      if (!lead) {
        sendJson(res, 404, { error: `找不到名单 #${id}` });
        return;
      }
      if (action === 'sent' || action === 'skip') {
        const { opener, text } = draftFor(bank, lead);
        if (action === 'sent') {
          markSent(id, opener.id, text);
          sendJson(res, 200, { ok: true, sentToday: stats().sentToday });
        } else {
          markSkipped(id, opener.id, text, '人工跳过');
          sendJson(res, 200, { ok: true });
        }
        return;
      }
      const raw = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(raw || '{}');
      } catch (err) {
        sendJson(res, 400, { error: 'JSON 解析失败' });
        return;
      }
      const ok = setLeadStatus(id, String(payload.status || ''));
      sendJson(res, ok ? 200 : 404, ok ? { ok: true } : { error: `找不到名单 #${id}` });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`营销看板已启动：http://${HOST}:${PORT}`);
  console.log(`发送台：http://${HOST}:${PORT}/send.html`);
  console.log(`数据库：${dbFile()}`);
  console.log('按 Ctrl+C 关闭。');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
