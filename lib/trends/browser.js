'use strict';

/**
 * 爆款搜索共用浏览器会话。
 *
 * 搜索签名（小红书 X-s、抖音 a_bogus、B站 wbi）都由页面自己的 JS 生成，
 * 因此这里沿用数据采集器的做法：复用「一键登录」的专用 profile，无头打开搜索页，
 * 通过 CDP 捕获页面自己发出的搜索接口响应。
 *
 * 搜索任务结束后浏览器保持 12 分钟再关：小红书的登录态是会话级 Cookie，
 * 抖音的 ttwid/msToken 也需要保温，频繁冷启动不仅会丢登录态，也不符合正常浏览器使用节奏。
 * 空闲期间其它任务（采集/发布/登录）可以直接复用它或把它关掉。
 */

const browserLogin = require('../browser-login');
const proxyConfig = require('../proxy-config');

const OWNER = 'trend-search';
const IDLE_CLOSE_MS = 12 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let warm = null; // { browser, timer }

function clearWarmTimer() {
  if (warm && warm.timer) {
    clearTimeout(warm.timer);
    warm.timer = null;
  }
}

async function ensure() {
  browserLogin.acquire(OWNER);
  try {
    const browser = await browserLogin.ensureBrowser({
      url: 'about:blank',
      headless: true,
      proxy: proxyConfig.launchSpec()
    });
    clearWarmTimer();
    warm = { browser, timer: null };
    return { browser };
  } catch (err) {
    browserLogin.release(OWNER);
    throw err;
  }
}

function dropWarm() {
  const current = warm;
  if (!current) return null;
  clearWarmTimer();
  warm = null;
  return current;
}

/** 关闭暖浏览器（force 时即使有其它任务也关，用于退出保存） */
async function resetWarm(options) {
  const force = !!(options && options.force);
  const current = warm;
  if (!current) return;
  // 别的任务正复用同一浏览器时，交给它收尾
  if (!force && browserLogin.isBusy()) return;
  dropWarm();
  await browserLogin.closeBrowser(current.browser).catch(() => {});
}

/** 风险重试用：调用方持有 OWNER 时丢弃当前会话并重开（可带新出口） */
async function restart() {
  const current = dropWarm();
  if (current) {
    await browserLogin.closeBrowser(current.browser).catch(() => {});
    // 等旧进程释放 user-data-dir 锁，否则新实例可能因 profile 被占用而启动失败
    await sleep(500);
  }
  const browser = await browserLogin.ensureBrowser({
    url: 'about:blank',
    headless: true,
    proxy: proxyConfig.launchSpec()
  });
  warm = { browser, timer: null };
  return { browser };
}

function scheduleIdleClose() {
  if (!warm) return;
  clearWarmTimer();
  warm.timer = setTimeout(() => {
    const current = warm;
    warm = null;
    if (!current) return;
    // 其它任务可能正在复用同一个浏览器，交给它自己收尾
    if (browserLogin.isBusy()) return;
    browserLogin.closeBrowser(current.browser).catch(() => {});
  }, IDLE_CLOSE_MS);
  if (warm.timer.unref) warm.timer.unref();
}

async function pageTarget(browser) {
  const targets = await browserLogin.httpJson(browser.port, '/json/list');
  const page =
    (browser.target && browser.target.webSocketDebuggerUrl ? browser.target : null) ||
    targets.find((t) => t.type === 'page' && !/^devtools:/.test(t.url || '')) ||
    targets.find((t) => t.type === 'page');
  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error('未找到可用的浏览器标签页，请重试');
  }
  return page.webSocketDebuggerUrl;
}

async function openPage(browser) {
  return pageTarget(browser);
}

/** 搜索任务结束：不立即关浏览器，留给下一轮复用 */
function closeSession() {
  scheduleIdleClose();
  browserLogin.release(OWNER);
}

async function evalValue(call, expression) {
  try {
    const res = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (res && res.exceptionDetails) return null;
    return res && res.result ? res.result.value : null;
  } catch (err) {
    return null;
  }
}

/** 轮询直到表达式返回真值，超时返回 null */
async function waitForEval(call, expression, timeout = 8000, interval = 250) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await evalValue(call, expression);
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

/**
 * 在页面搜索框里输入关键词并提交（优先点按钮，回车兜底）。
 * 找不到输入框时返回 false，调用方回退到直接跳转搜索页。
 */
async function submitSearch(call, selectors, keyword, submitSelector) {
  const typed = await evalValue(
    call,
    `(() => {
      const sels = ${JSON.stringify(selectors)};
      let el = null;
      for (const s of sels) {
        el = document.querySelector(s);
        if (el && el.offsetParent !== null) break;
      }
      if (!el) return false;
      el.focus();
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(String(keyword))});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`
  );
  if (!typed) return false;
  await sleep(150);
  if (submitSelector) {
    const clicked = await evalValue(
      call,
      `(() => {
        const btn = document.querySelector(${JSON.stringify(submitSelector)});
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    );
    if (clicked) return true;
  }
  return !!(await evalValue(
    call,
    `(() => {
      const el = document.activeElement;
      if (!el) return false;
      ['keydown', 'keypress', 'keyup'].forEach((type) =>
        el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
      );
      return true;
    })()`
  ));
}

module.exports = { ensure, openPage, closeSession, resetWarm, restart, evalValue, waitForEval, submitSearch, OWNER };
