import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, ensureDir, sleep } from './util.mjs';

const PROFILE_DIR = path.join(DATA_DIR, 'chrome-profile');
const LAUNCH_TIMEOUT_MS = 20000;
const CALL_TIMEOUT_MS = 30000;

function browserCandidates() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    list.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    list.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }
  return list.filter(Boolean);
}

export function findBrowser() {
  for (const file of browserCandidates()) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function httpJson(port, pathname, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`DevTools HTTP ${res.status}`);
  return res.json();
}

function readActivePort() {
  try {
    const [portLine, wsLine] = fs.readFileSync(path.join(PROFILE_DIR, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    const port = Number(portLine);
    return port && wsLine ? { port, wsPath: wsLine } : null;
  } catch (err) {
    return null;
  }
}

async function isAlive(port) {
  try {
    await httpJson(port, '/json/version');
    return true;
  } catch (err) {
    return false;
  }
}

export async function ensureBrowser(url) {
  ensureDir(PROFILE_DIR);
  const existing = readActivePort();
  if (existing && (await isAlive(existing.port))) {
    try {
      await httpJson(existing.port, '/json/new?' + encodeURIComponent(url), 'PUT');
    } catch (err) {
      /* 复用已有窗口，新标签打开失败不影响后续定位 */
    }
    return { port: existing.port, reused: true };
  }

  const executable = findBrowser();
  if (!executable) {
    throw new Error('未找到 Chrome/Edge，请安装浏览器或设置 CHROME_PATH');
  }
  try {
    fs.unlinkSync(path.join(PROFILE_DIR, 'DevToolsActivePort'));
  } catch (err) {
    /* 文件不存在 */
  }

  const args = [
    '--user-data-dir=' + PROFILE_DIR,
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1440,900',
    '--window-position=60,40',
    url,
  ];
  const proc = spawn(executable, args, { detached: true, stdio: 'ignore' });
  proc.on('error', () => {});
  proc.unref();

  const started = Date.now();
  while (Date.now() - started < LAUNCH_TIMEOUT_MS) {
    const info = readActivePort();
    if (info && (await isAlive(info.port))) return { port: info.port, reused: false };
    await sleep(300);
  }
  throw new Error('浏览器启动超时，请确认 Chrome/Edge 可以正常打开');
}

function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    const timer = setTimeout(() => {
      try { ws.close(); } catch (err) {}
      reject(new Error('DevTools WebSocket 连接超时'));
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve(call);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('DevTools WebSocket 连接失败'));
    };
    ws.onclose = () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('DevTools 连接已关闭'));
      }
      pending.clear();
    };
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      if (!msg.id || !pending.has(msg.id)) return;
      const entry = pending.get(msg.id);
      clearTimeout(entry.timer);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    };

    function call(method, params, timeoutMs) {
      const id = ++seq;
      const limit = timeoutMs || CALL_TIMEOUT_MS;
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (err) {
        return Promise.reject(err);
      }
      return new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectCall(new Error(`DevTools 调用超时：${method}`));
        }, limit);
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      });
    }
    call.close = () => {
      try { ws.close(); } catch (err) {}
    };
  });
}

export async function openSession(url) {
  const { port } = await ensureBrowser(url);
  let list = [];
  for (let i = 0; i < 20; i++) {
    try {
      list = await httpJson(port, '/json/list');
      if (list.some((t) => t.type === 'page')) break;
    } catch (err) {
      /* 等页面注册 */
    }
    await sleep(500);
  }
  const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('没有找到可控制的页面标签');
  const origin = new URL(url).origin;
  const target = pages.find((t) => t.url.startsWith(origin)) || pages[pages.length - 1];
  const cdp = await cdpConnect(target.webSocketDebuggerUrl);
  await cdp('Page.enable').catch(() => {});
  await cdp('Page.bringToFront').catch(() => {});

  return {
    cdp,
    port,
    async eval(expression) {
      const res = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res && res.exceptionDetails) {
        const detail = res.exceptionDetails;
        throw new Error((detail.exception && detail.exception.description) || detail.text || '页面脚本执行失败');
      }
      return res && res.result ? res.result.value : null;
    },
    async navigate(nextUrl, settleMs = 2200) {
      await cdp('Page.navigate', { url: nextUrl });
      for (let i = 0; i < 30; i++) {
        await sleep(400);
        try {
          const state = await this.eval('document.readyState');
          if (state === 'complete') break;
        } catch (err) {
          /* 页面切换中 */
        }
      }
      await cdp('Page.bringToFront').catch(() => {});
      await sleep(settleMs);
    },
    async text(limit = 6000) {
      const raw = await this.eval(`(document.body && document.body.innerText ? document.body.innerText : '').slice(0, ${limit})`);
      return String(raw || '');
    },
    // 尽力点击主页上的「私信」按钮，只打开面板，不填内容、不发送。
    // 用 CDP 派发真实鼠标事件：合成 el.click() 抖音的 semi/React 组件不响应。
    async openDm() {
      const coords = await this.eval(`(() => {
        const label = '私信';
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        };
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
        const hits = nodes.filter((el) => (el.textContent || '').trim() === label && visible(el));
        if (!hits.length) return null;
        let target = hits.find((el) => el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') || hits[0];
        let node = target;
        for (let i = 0; i < 4 && node; i++) {
          if (node.tagName === 'BUTTON' || node.tagName === 'A' || (node.getAttribute && node.getAttribute('role') === 'button')) {
            target = node;
            break;
          }
          node = node.parentElement;
        }
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const r = target.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`);
      if (!coords) return false;
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: coords.x, y: coords.y });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(1200);
      return true;
    },
    async screenshot(file) {
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      ensureDir(path.dirname(file));
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    },
    close() {
      cdp.close();
    },
  };
}
