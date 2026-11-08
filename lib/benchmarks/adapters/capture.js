'use strict';

/**
 * 对标账号抓取共用工具：打开主页后由页面自己发请求，通过 CDP 捕获响应。
 * 各平台主页接口都带签名，直接 HTTP 请求容易被风控，复用浏览器登录态最稳。
 */

const browserLogin = require('../../browser-login');
const workspaceBrowser = require('../../trends/browser');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const SHORT_HOSTS = /^(b23\.tv|bili2233\.cn|v\.douyin\.com|xhslink\.com)$/i;
const PROXY_FAIL_RE = /ERR_PROXY|ERR_TUNNEL/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function expandShortUrl(url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (err) {
    return url;
  }
  if (!SHORT_HOSTS.test(host)) return url;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      signal: controller.signal
    }).finally(() => clearTimeout(timer));
    const finalUrl = (res && res.url) || url;
    if (res && res.body && res.body.cancel) res.body.cancel().catch(() => {});
    return finalUrl;
  } catch (err) {
    return url;
  }
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

function proxyError(platform, text) {
  const err = new Error(platform + '请求经代理失败（' + (text || '未知错误') + '），请检查「连接设置 · 网络代理」');
  err.proxy = true;
  return err;
}

/**
 * 打开一个标签页并捕获匹配的响应。
 * options.match(url) 返回 true 时记录该请求，loadingFinished 后取响应体解析成 JSON。
 */
async function openCapture(browser, options) {
  const ws = await workspaceBrowser.openPage(browser);
  const payloads = [];
  const pending = new Map();
  let call = null;
  let networkError = null;

  const onEvent = (msg) => {
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url || '';
      if (options.match(url)) pending.set(msg.params.requestId, url);
      return;
    }
    if (msg.method === 'Network.loadingFailed') {
      const text = (msg.params && msg.params.errorText) || '';
      if (PROXY_FAIL_RE.test(text)) networkError = proxyError(options.platform || '平台', text);
      return;
    }
    if (msg.method !== 'Network.loadingFinished') return;
    const url = pending.get(msg.params.requestId);
    if (!url) return;
    pending.delete(msg.params.requestId);
    const requestId = msg.params.requestId;
    Promise.resolve()
      .then(() => call('Network.getResponseBody', { requestId }))
      .then((res) => {
        const text = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
        payloads.push({ url, json: JSON.parse(text) });
      })
      .catch(() => {
        /* 取不到响应体时忽略，交给调用方超时处理 */
      });
  };

  call = await browserLogin.cdpConnect(ws, onEvent);
  await call('Network.enable', {});
  await call('Page.enable', {});

  return {
    call,
    payloads,
    get networkError() {
      return networkError;
    },
    navigate: (url) => call('Page.navigate', { url }),
    evaluate: (expression) => evalValue(call, expression),
    async waitFor(predicate, timeout, interval) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        if (networkError) throw networkError;
        await sleep(interval || 250);
      }
      return null;
    },
    close() {
      try {
        call.close();
      } catch (err) {
        /* 标签页可能已关闭 */
      }
    }
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function toMs(value) {
  const n = Number(value) || 0;
  if (!n) return 0;
  return n > 100000000000 ? n : n * 1000;
}

function isoFrom(value) {
  const ms = toMs(value);
  if (!ms) return '';
  const d = new Date(ms);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 120);
}

module.exports = {
  UA,
  sleep,
  expandShortUrl,
  openCapture,
  evalValue,
  toNumber,
  toMs,
  isoFrom,
  cleanText
};
