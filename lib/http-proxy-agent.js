'use strict';

/**
 * 零依赖的代理 HTTP 客户端（仅支持 https 目标 + HTTP CONNECT 代理）。
 *
 * 海外平台（Google / TikTok）的接口与上传都需要在境内通过代理访问，
 * 而 Node 自带的 https.Agent 不支持代理。这里实现一个最小可用的
 * CONNECT 隧道 Agent，并提供 JSON 请求与分片上传两个辅助函数。
 *
 * 代理配置来自 lib/proxy-config.js 的 launchSpec()：
 *   { scheme, host, port, username, password } | null
 */

const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const fs = require('node:fs');

const agents = new Map();

function proxyKey(proxy) {
  return [proxy.host, proxy.port, proxy.username || '', proxy.password || ''].join('|');
}

function authHeader(proxy) {
  if (!proxy.username && !proxy.password) return null;
  const raw = String(proxy.username || '') + ':' + String(proxy.password || '');
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

function isLoopback(host) {
  const h = String(host || '').trim().toLowerCase();
  return !h || h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function createAgent(proxy) {
  const proxyHost = String(proxy.host || '').trim();
  const proxyPort = Number(proxy.port) || 0;
  const proxyAuth = authHeader(proxy);
  const agent = new https.Agent({ keepAlive: false });

  // https.Agent 在建立连接时会调用 this.createConnection(options, cb)，
  // 这里替换成「先 CONNECT 到代理，再在隧道上做 TLS」。
  agent.createConnection = function createConnection(options, callback) {
    const targetHost = options.host;
    const targetPort = options.port || 443;
    let settled = false;
    const done = (err, socket) => {
      if (settled) {
        if (socket) socket.destroy();
        return;
      }
      settled = true;
      callback(err, socket);
    };

    const socket = net.connect(proxyPort, proxyHost, () => {
      let head = 'CONNECT ' + targetHost + ':' + targetPort + ' HTTP/1.1\r\n';
      head += 'Host: ' + targetHost + ':' + targetPort + '\r\n';
      if (proxyAuth) head += 'Proxy-Authorization: ' + proxyAuth + '\r\n';
      head += '\r\n';
      socket.write(head);
    });

    let buffered = '';
    const onData = (chunk) => {
      buffered += chunk.toString('latin1');
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) return;
      socket.removeListener('data', onData);

      const statusLine = buffered.slice(0, buffered.indexOf('\r\n'));
      const match = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
      const code = match ? Number(match[1]) : 0;
      if (code !== 200) {
        socket.destroy();
        const err = new Error(
          code === 407
            ? '代理认证失败（407），请检查「连接设置 → 网络代理」的账号密码'
            : '代理连接失败（HTTP ' + (code || '未知') + '）'
        );
        err.code = code === 407 ? 'EAUTH' : 'EPROXY';
        return done(err);
      }

      const secure = tls.connect(
        { socket, servername: options.servername || targetHost },
        () => done(null, secure)
      );
      secure.on('error', (err) => done(err));
    };

    socket.on('data', onData);
    socket.once('error', (err) => done(err));
  };

  return agent;
}

/** 返回代理 Agent；未配置代理或目标是本机时返回 null（直连）。 */
function agentFor(proxy) {
  if (!proxy || !proxy.host) return null;
  if (isLoopback(proxy.host)) return null;
  const key = proxyKey(proxy);
  if (!agents.has(key)) agents.set(key, createAgent(proxy));
  return agents.get(key);
}

function requestOnce(url, options) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return reject(new Error('接口地址无效：' + url));
    }
    if (parsed.protocol !== 'https:') {
      return reject(new Error('仅支持 https 接口：' + url));
    }

    const agent = agentFor(options.proxy);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        agent: agent || undefined
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (err) {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );

    req.setTimeout(options.timeoutMs || 60000, () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

/** JSON/表单请求：返回 { status, headers, text, json }。 */
async function requestJson(url, options = {}) {
  return requestOnce(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    proxy: options.proxy,
    timeoutMs: options.timeoutMs || 60000
  });
}

function putRangeOnce(url, spec) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const agent = agentFor(spec.proxy);
    const length = spec.end - spec.start + 1;
    const headers = Object.assign({}, spec.headers || {}, {
      'Content-Length': length,
      'Content-Range': 'bytes ' + spec.start + '-' + spec.end + '/' + spec.totalSize
    });

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'PUT',
        headers,
        agent: agent || undefined
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (err) {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );

    req.setTimeout(spec.timeoutMs || 300000, () => req.destroy(new Error('上传超时')));
    req.on('error', fail);

    const stream = fs.createReadStream(spec.filePath, { start: spec.start, end: spec.end });
    stream.on('error', (err) => {
      req.destroy();
      fail(err);
    });
    stream.pipe(req);
  });
}

/**
 * 分片上传。每片带 Content-Range，按顺序发送。
 * - 2xx / 308 视为本片已接收，继续下一片；
 * - 5xx 或网络错误在同一位置重试（默认 3 次）；
 * - 4xx 直接返回给调用方处理。
 */
async function chunkedUpload(url, spec) {
  const size = spec.sizeBytes;
  const chunkSize = spec.chunkSize;
  let start = 0;
  let last = null;

  while (start < size) {
    if (spec.shouldAbort && spec.shouldAbort()) {
      throw new Error('任务已取消');
    }
    const end = Math.min(start + chunkSize, size) - 1;
    let attempt = 0;
    let res = null;
    for (;;) {
      try {
        res = await putRangeOnce(url, {
          filePath: spec.filePath,
          start,
          end,
          totalSize: size,
          headers: typeof spec.makeHeaders === 'function' ? spec.makeHeaders(start, end) : spec.headers,
          proxy: spec.proxy,
          timeoutMs: spec.timeoutMs
        });
        break;
      } catch (err) {
        attempt += 1;
        const retryable = !err.code || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
        if (attempt >= (spec.retries || 3) || !retryable) throw err;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
    last = res;
    if (res.status >= 400) return res;
    start = end + 1;
    if (spec.onProgress) spec.onProgress(start, size);
  }

  return last;
}

module.exports = { agentFor, requestJson, putRange: putRangeOnce, chunkedUpload };
