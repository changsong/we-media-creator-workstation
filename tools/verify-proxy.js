'use strict';

/**
 * 代理模块自检（无需真实住宅代理）。
 *
 * 用本地 mock 上游代理校验：CONNECT 的 Basic 鉴权注入、200 透传、407 映射为 502、
 * absolute-form HTTP 转发，以及 proxy-config 的掩码 / KEEP / 失败即停 / 会话轮换。
 *
 * 运行：node tools/verify-proxy.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-proxy-'));
process.env.WB_DATA_DIR = DATA_DIR;
[
  'WB_PROXY_ENABLED',
  'WB_PROXY_SCHEME',
  'WB_PROXY_HOST',
  'WB_PROXY_PORT',
  'WB_PROXY_USER',
  'WB_PROXY_PASS',
  'WB_PROXY_SESSION',
  'WB_PROXY_TEMPLATE',
  'WB_PROXY_AUTO_ROTATE'
].forEach((key) => delete process.env[key]);

const tunnel = require('../lib/proxy-tunnel');
const proxyConfig = require('../lib/proxy-config');

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  PASS  ' + name);
  } else {
    failures += 1;
    console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''));
  }
}

function startMock(expectedAuth) {
  const state = { expected: expectedAuth, lastConnectAuth: '', lastHttpAuth: '' };
  const server = http.createServer((req, res) => {
    state.lastHttpAuth = req.headers['proxy-authorization'] || '';
    if (state.lastHttpAuth !== state.expected) {
      res.writeHead(407, { 'Content-Type': 'text/plain' });
      return res.end('proxy auth required');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('UPSTREAM_OK');
  });
  server.on('connect', (req, clientSocket) => {
    state.lastConnectAuth = req.headers['proxy-authorization'] || '';
    if (state.lastConnectAuth !== state.expected) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      clientSocket.end();
      return;
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    clientSocket.write('HELLO_FROM_TARGET');
    clientSocket.on('data', (chunk) => {
      try {
        clientSocket.write('echo:' + chunk.toString('latin1'));
      } catch (err) {
        /* 已关闭 */
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        state,
        port: server.address().port,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

function connectThroughTunnel(tunnelPort, label) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: tunnelPort });
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch (err) {
        /* 已关闭 */
      }
      resolve(data);
    };
    const timer = setTimeout(finish, 3000);
    socket.on('connect', () => {
      socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    });
    socket.on('data', (chunk) => {
      data += chunk.toString('latin1');
      if (data.includes('HELLO_FROM_TARGET') || /HTTP\/1\.1 5\d\d/.test(data)) finish();
    });
    socket.on('error', finish);
    socket.on('close', finish);
    if (label) socket.on('close', () => {});
  });
}

function httpThroughTunnel(tunnelPort) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: tunnelPort,
        method: 'GET',
        path: 'http://example.com/probe',
        headers: { host: 'example.com' }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

function resetConfig() {
  try {
    fs.rmSync(proxyConfig.CONFIG_PATH, { force: true });
  } catch (err) {
    /* 不存在 */
  }
}
function resetEnv() {
  [
    'WB_PROXY_ENABLED',
    'WB_PROXY_SCHEME',
    'WB_PROXY_HOST',
    'WB_PROXY_PORT',
    'WB_PROXY_USER',
    'WB_PROXY_PASS',
    'WB_PROXY_SESSION',
    'WB_PROXY_TEMPLATE',
    'WB_PROXY_AUTO_ROTATE'
  ].forEach((key) => delete process.env[key]);
}

async function main() {
  const expected = tunnel.proxyAuthorization('alice', 'secret');
  const mock = await startMock(expected);

  // 1. CONNECT + Basic 鉴权注入 + 200 透传
  {
    const t = await tunnel.createTunnel({
      upstream: { host: '127.0.0.1', port: mock.port, scheme: 'http' },
      auth: { username: 'alice', password: 'secret' }
    });
    const data = await connectThroughTunnel(t.port);
    check('CONNECT 返回 200 并透传目标数据', /200 Connection Established/.test(data) && data.includes('HELLO_FROM_TARGET'), data.slice(0, 80));
    check('CONNECT 注入正确的 Proxy-Authorization', mock.state.lastConnectAuth === expected, mock.state.lastConnectAuth);
    await t.close();
    check('隧道 close 后 isAlive 为 false', t.isAlive() === false);
  }

  // 2. 上游 407 → 本地 502 + onError EAUTH
  {
    let seenCode = '';
    const t = await tunnel.createTunnel({
      upstream: { host: '127.0.0.1', port: mock.port, scheme: 'http' },
      auth: { username: 'alice', password: 'wrong' },
      onError: (err) => {
        seenCode = err && err.code ? err.code : '';
      }
    });
    const data = await connectThroughTunnel(t.port);
    check('鉴权失败时本地返回 502', /HTTP\/1\.1 502/.test(data), data.slice(0, 80));
    check('鉴权失败触发 onError(EAUTH)', seenCode === 'EAUTH', seenCode);
    await t.close();
  }

  // 3. absolute-form HTTP 转发
  {
    const t = await tunnel.createTunnel({
      upstream: { host: '127.0.0.1', port: mock.port, scheme: 'http' },
      auth: { username: 'alice', password: 'secret' }
    });
    const res = await httpThroughTunnel(t.port);
    check('absolute-form HTTP 转发成功', res.status === 200 && res.body === 'UPSTREAM_OK', JSON.stringify(res));
    check('HTTP 请求注入 Proxy-Authorization', mock.state.lastHttpAuth === expected, mock.state.lastHttpAuth);
    await t.close();
  }

  // 4. 配置：掩码 / KEEP / 失败即停
  {
    resetConfig();
    resetEnv();
    const initial = proxyConfig.getPublic();
    check('初始未启用且未配置', initial.enabled === false && initial.configured === false);
    check('初始密码不回显', initial.password.hasValue === false);

    proxyConfig.save({ enabled: false, host: '10.0.0.1', port: 8080, username: 'u', password: 'p' });
    const saved = proxyConfig.getPublic();
    check('保存后 configured 为 true', saved.configured === true);
    check('读取时密码被掩码', saved.password.value === proxyConfig.MASK && saved.password.hasValue === true);
    check('getRaw 保留明文供启动使用', proxyConfig.getRaw().password === 'p');

    proxyConfig.save({ password: proxyConfig.KEEP, host: '10.0.0.2' });
    check('KEEP 保留原密码', proxyConfig.getRaw().password === 'p');
    check('KEEP 同时更新其它字段', proxyConfig.getRaw().host === '10.0.0.2');

    proxyConfig.save({ password: '' });
    check('空值清空密码', proxyConfig.getRaw().password === '');

    let threw = false;
    try {
      proxyConfig.save({ enabled: true, host: '10.0.0.2', port: 8080, username: 'u' });
    } catch (err) {
      threw = err && err.status === 400;
    }
    check('启用但不完整时拒绝保存（400）', threw);

    proxyConfig.save({ enabled: true, host: '10.0.0.2', port: 8080, username: 'u', password: 'p' });
    const spec = proxyConfig.launchSpec();
    check('launchSpec 返回完整参数', !!spec && spec.host === '10.0.0.2' && spec.port === 8080 && spec.username === 'u');
    check('signature 对同一配置稳定', proxyConfig.signature(spec) === proxyConfig.signature(proxyConfig.launchSpec()));
    check('signature 对端口变化敏感', proxyConfig.signature(spec) !== proxyConfig.signature(Object.assign({}, spec, { port: 9090 })));
  }

  // 5. 会话模板与轮换
  {
    resetConfig();
    resetEnv();
    proxyConfig.save({
      enabled: true,
      host: '10.0.0.3',
      port: 8080,
      username: 'base-user',
      password: 'p',
      sessionTemplate: 'base-user-session-{session}'
    });
    const first = proxyConfig.getPublic();
    check('会话模板生效（sticky=true）', first.sticky === true && first.sessionId.length > 0);
    check('launchSpec 用户名注入 sessionId', proxyConfig.launchSpec().username === 'base-user-session-' + first.sessionId);

    const rotated = proxyConfig.rotateSession();
    check('轮换后 sessionId 变化', rotated.sessionId !== first.sessionId);
    check('轮换后 launchSpec 使用新 sessionId', proxyConfig.launchSpec().username === 'base-user-session-' + rotated.sessionId);
  }

  // 6. 环境变量覆盖
  {
    resetConfig();
    resetEnv();
    process.env.WB_PROXY_ENABLED = '1';
    process.env.WB_PROXY_HOST = 'env.example';
    process.env.WB_PROXY_PORT = '9000';
    process.env.WB_PROXY_USER = 'env-user';
    process.env.WB_PROXY_PASS = 'env-pass';
    const raw = proxyConfig.getRaw();
    check('env 覆盖 host/port/user', raw.host === 'env.example' && raw.port === 9000 && raw.username === 'env-user');
    check('env 密码仅回传 hasValue', proxyConfig.getPublic().password.hasValue === true && proxyConfig.getPublic().password.value === proxyConfig.MASK);
    resetEnv();
  }

  // 7. test()：连通成功 / 407
  {
    resetConfig();
    resetEnv();
    proxyConfig.save({ enabled: false, host: '127.0.0.1', port: mock.port, username: 'alice', password: 'secret' });
    mock.state.expected = expected;
    const ok = await proxyConfig.test();
    check('test() 连通成功', ok.ok === true, ok.message);

    let authErr = null;
    try {
      await proxyConfig.test({ password: 'wrong' });
    } catch (err) {
      authErr = err;
    }
    check('test() 密码错误映射为 502 且提示 407', !!authErr && authErr.status === 502 && /407/.test(authErr.message), authErr && authErr.message);
  }

  await mock.close();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  console.log('');
  if (failures) {
    console.log('验证失败：' + failures + ' 项未通过');
    process.exit(1);
  }
  console.log('全部通过');
}

main().catch((err) => {
  console.error('验证脚本异常：', err && err.stack ? err.stack : err);
  process.exit(1);
});
