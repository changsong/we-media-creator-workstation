'use strict';

/**
 * 本地无认证 HTTP 代理转发层。
 *
 * Chrome 启动参数无法携带代理用户名/密码（`--proxy-server` 里的 userinfo 会被忽略），
 * 因此这里在 127.0.0.1 起一个只本机可连的转发代理，替 Chrome 向上游住宅代理补上
 * `Proxy-Authorization: Basic ...`。Chrome 只需 `--proxy-server=http://127.0.0.1:<port>`。
 *
 * 一个隧道实例对应一个浏览器会话 = 一个稳定上游连接（粘性会话的前提是代理商按
 * 用户名保持会话，见 proxy-config 的 sessionTemplate）。
 */

const net = require('net');
const http = require('http');

const DEFAULT_CONNECT_TIMEOUT_MS = 10000;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 4096;

function proxyAuthorization(username, password) {
  const raw = String(username == null ? '' : username) + ':' + String(password == null ? '' : password);
  return 'Basic ' + Buffer.from(raw, 'utf8').toString('base64');
}

function assertNoCrlf(value, name) {
  if (/[\r\n]/.test(String(value == null ? '' : value))) {
    throw new Error(name + ' 不能包含换行');
  }
}

function parseStatusCode(headerText) {
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(String(headerText || ''));
  return match ? Number(match[1]) : 0;
}

function normalizeUpstream(upstream) {
  const src = upstream || {};
  const scheme = String(src.scheme || 'http').toLowerCase();
  if (scheme !== 'http') {
    throw new Error('暂不支持的上游代理协议：' + scheme + '（当前仅支持 HTTP 代理）');
  }
  const host = String(src.host || '').trim();
  const port = Number(src.port);
  assertNoCrlf(host, '代理主机');
  if (!host) throw new Error('缺少代理主机');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('代理端口无效');
  return { host, port };
}

function normalizeAuth(auth) {
  if (!auth || (!auth.username && !auth.password)) return null;
  const username = String(auth.username == null ? '' : auth.username);
  const password = String(auth.password == null ? '' : auth.password);
  assertNoCrlf(username, '代理用户名');
  assertNoCrlf(password, '代理密码');
  return { username, password };
}

/** 从 socket 读到 \r\n\r\n 为止，返回响应头文本与剩余字节 */
function readHeaderBlock(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => done(new Error('代理响应超时')), timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    }
    function done(err, headerText, rest) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve({ headerText, rest: rest || Buffer.alloc(0) });
    }
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx >= 0) {
        done(null, buf.slice(0, idx).toString('latin1'), buf.slice(idx + 4));
      } else if (buf.length > MAX_HEADER_BYTES) {
        done(new Error('代理响应头过大'));
      }
    }
    function onError(err) {
      done(err);
    }
    function onClose() {
      done(new Error('代理连接提前关闭'));
    }
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

/**
 * 启动本地转发代理。
 * @returns {Promise<{port:number,url:string,isAlive:()=>boolean,close:()=>Promise<void>}>}
 */
async function createTunnel(options) {
  const opts = options || {};
  const upstream = normalizeUpstream(opts.upstream);
  const auth = normalizeAuth(opts.auth);
  const authHeader = auth ? proxyAuthorization(auth.username, auth.password) : '';
  const connectTimeoutMs = Number(opts.connectTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS;
  const onError = typeof opts.onError === 'function' ? opts.onError : () => {};

  const sockets = new Set();
  let alive = true;

  function track(socket) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {
      try {
        socket.destroy();
      } catch (err) {
        /* 已销毁 */
      }
    });
  }

  function applyAuth(headers) {
    const out = Object.assign({}, headers || {});
    if (authHeader) out['Proxy-Authorization'] = authHeader;
    return out;
  }

  const server = http.createServer((req, res) => {
    // 代理转发只接受 absolute-form（http://host/path）；origin-form 说明不是经代理访问
    if (!/^https?:\/\//i.test(req.url || '')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('仅支持作为 HTTP 代理使用');
      return;
    }
    let target;
    try {
      target = new URL(req.url);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('无效的请求地址');
      return;
    }
    const headers = applyAuth();
    Object.keys(req.headers).forEach((key) => {
      const lower = key.toLowerCase();
      if (lower === 'proxy-authorization' || lower === 'proxy-connection') return;
      headers[key] = req.headers[key];
    });
    headers.host = target.host;
    const upstreamReq = http.request(
      { host: upstream.host, port: upstream.port, method: req.method, path: req.url, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstreamReq.setTimeout(connectTimeoutMs, () => upstreamReq.destroy(new Error('上游代理超时')));
    upstreamReq.on('error', (err) => {
      onError(err);
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('代理请求失败');
    });
    req.pipe(upstreamReq);
  });

  server.on('connect', (req, clientSocket, head) => {
    track(clientSocket);
    const authority = String(req.url || '');
    try {
      assertNoCrlf(authority, '目标地址');
    } catch (err) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    const upstreamSocket = net.connect({ host: upstream.host, port: upstream.port });
    track(upstreamSocket);
    upstreamSocket.setTimeout(connectTimeoutMs, () => upstreamSocket.destroy(new Error('上游代理连接超时')));

    let settled = false;
    function fail(statusLine) {
      if (settled) return;
      settled = true;
      try {
        clientSocket.end(statusLine || 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
      } catch (err) {
        /* 已关闭 */
      }
      try {
        upstreamSocket.destroy();
      } catch (err) {
        /* 已关闭 */
      }
    }

    upstreamSocket.on('connect', () => {
      const lines = ['CONNECT ' + authority + ' HTTP/1.1', 'Host: ' + authority];
      if (authHeader) lines.push('Proxy-Authorization: ' + authHeader);
      upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n');

      readHeaderBlock(upstreamSocket, connectTimeoutMs)
        .then((result) => {
          if (settled) return;
          const code = parseStatusCode(result.headerText);
          if (code !== 200) {
            if (code === 407) {
              onError(Object.assign(new Error('代理认证失败（407）'), { code: 'EAUTH' }));
            } else {
              onError(Object.assign(new Error('代理隧道建立失败（' + (code || '无响应') + '）'), { code: 'ETUNNEL' }));
            }
            fail('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            return;
          }
          settled = true;
          upstreamSocket.setTimeout(0);
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head && head.length) upstreamSocket.write(head);
          if (result.rest && result.rest.length) clientSocket.write(result.rest);
          upstreamSocket.pipe(clientSocket);
          clientSocket.pipe(upstreamSocket);
        })
        .catch((err) => {
          if (settled) return;
          onError(err);
          fail('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
        });
    });

    upstreamSocket.on('error', (err) => {
      if (settled) return;
      onError(err);
      fail('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    clientSocket.on('error', () => {
      try {
        upstreamSocket.destroy();
      } catch (err) {
        /* 已关闭 */
      }
    });
    clientSocket.on('close', () => {
      try {
        upstreamSocket.destroy();
      } catch (err) {
        /* 已关闭 */
      }
    });
    upstreamSocket.on('close', () => {
      try {
        clientSocket.destroy();
      } catch (err) {
        /* 已关闭 */
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const port = server.address().port;

  return {
    port,
    url: 'http://127.0.0.1:' + port,
    isAlive() {
      return alive && server.listening;
    },
    close() {
      if (!alive) return Promise.resolve();
      alive = false;
      sockets.forEach((socket) => {
        try {
          socket.destroy();
        } catch (err) {
          /* 已关闭 */
        }
      });
      sockets.clear();
      return new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch (err) {
          resolve();
        }
      });
    }
  };
}

/**
 * 不经本地服务器，直接向上游代理发 CONNECT，验证账号密码与连通性。
 * 网络层错误（超时/拒绝/解析）会 reject；有 HTTP 响应时 resolve { ok, statusCode }。
 */
function probeConnect(options) {
  const opts = options || {};
  const upstream = normalizeUpstream(opts.upstream);
  const auth = normalizeAuth(opts.auth);
  const authHeader = auth ? proxyAuthorization(auth.username, auth.password) : '';
  const targetHost = String(opts.targetHost || 'www.douyin.com');
  const targetPort = Number(opts.targetPort || 443);
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: upstream.host, port: upstream.port });
    let settled = false;
    const timer = setTimeout(() => {
      done(Object.assign(new Error('连接代理超时'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch (err) {
        /* 已关闭 */
      }
    }
    function done(err, result) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result);
    }

    socket.on('connect', () => {
      const authority = targetHost + ':' + targetPort;
      const lines = ['CONNECT ' + authority + ' HTTP/1.1', 'Host: ' + authority];
      if (authHeader) lines.push('Proxy-Authorization: ' + authHeader);
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      readHeaderBlock(socket, timeoutMs)
        .then((result) => {
          const statusCode = parseStatusCode(result.headerText);
          done(null, { ok: statusCode === 200, statusCode, latencyMs: Date.now() - started });
        })
        .catch((err) => done(err));
    });
    socket.on('error', (err) => done(err));
    socket.on('close', () => done(Object.assign(new Error('代理连接已关闭'), { code: 'ECONNRESET' })));
  });
}

/** 经上游代理发一个 absolute-form GET，用于尽力获取出口 IP */
function probeHttpGet(options) {
  const opts = options || {};
  const upstream = normalizeUpstream(opts.upstream);
  const auth = normalizeAuth(opts.auth);
  const headers = {};
  if (auth) headers['Proxy-Authorization'] = proxyAuthorization(auth.username, auth.password);
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS;
  const url = String(opts.url || '');

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: upstream.host, port: upstream.port, method: 'GET', path: url, headers },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (raw.length < MAX_BODY_BYTES) raw += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, body: raw.slice(0, MAX_BODY_BYTES) }));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('读取出口 IP 超时'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

module.exports = {
  createTunnel,
  probeConnect,
  probeHttpGet,
  proxyAuthorization
};
