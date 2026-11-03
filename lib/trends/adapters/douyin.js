'use strict';

/**
 * 抖音搜索适配器。
 *
 * 网页搜索请求带 a_bogus / msToken 等动态签名，cookie 直连容易被平台限制，
 * 因此无头打开搜索页，捕获页面自己发出的 web 搜索接口响应。
 */

const browserLogin = require('../../browser-login');
const channelConnections = require('../../channel-connections');
const browser = require('../browser');
const { parseCount, dedupe, isoFromSeconds } = require('../util');

const PLATFORM = '抖音';
const API_RE = /\/aweme\/v1\/web\/(general\/search\/single|search\/item|search\/single)/;
const WAIT_MS = 30000;
const MAX_ITEMS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PROXY_FAIL_RE = /ERR_PROXY|ERR_TUNNEL/i;

function captchaError() {
  const err = new Error('抖音要求完成人机验证，请稍后重试；若持续出现，请到「连接设置」重新登录抖音');
  err.risk = true;
  return err;
}

function proxyError(text) {
  const err = new Error(
    '抖音请求经代理失败（' + (text || '未知错误') + '），请检查「连接设置 · 网络代理」'
  );
  err.proxy = true;
  return err;
}

function available() {
  const conn = channelConnections.get(PLATFORM);
  return !!(conn && conn.enabled);
}

function searchUrl(keyword) {
  return 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=video';
}

function pickAweme(row) {
  if (!row) return null;
  return row.aweme_info || row.awemeInfo || row.aweme || (row.aweme_id ? row : null);
}

function parseItems(json) {
  const list = json && (Array.isArray(json.data) ? json.data : json.aweme_list);
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((row) => {
    const a = pickAweme(row);
    if (!a) return;
    const id = a.aweme_id || a.awemeId;
    if (!id) return;
    const stats = a.statistics || {};
    const video = a.video || {};
    const coverList = (video.cover && video.cover.url_list) || (video.origin_cover && video.origin_cover.url_list) || [];
    out.push({
      workId: String(id),
      title: String(a.desc || '（无标题视频）').trim(),
      author: (a.author && (a.author.nickname || a.author.unique_id)) || '',
      coverUrl: coverList[0] || '',
      itemUrl: 'https://www.douyin.com/video/' + id,
      itemType: 'video',
      likes: parseCount(stats.digg_count || stats.diggCount),
      comments: parseCount(stats.comment_count || stats.commentCount),
      shares: parseCount(stats.share_count || stats.shareCount),
      collects: parseCount(stats.collect_count || stats.collectCount),
      reads: parseCount(stats.play_count || stats.playCount),
      publishedAt: isoFromSeconds(a.create_time || a.createTime)
    });
  });
  return dedupe(out).slice(0, MAX_ITEMS);
}

async function search(keyword, ctx) {
  const ws = await browser.openPage(ctx.browser);
  const payloads = [];
  const pending = new Map();
  let call = null;
  let networkError = null;

  const onEvent = (msg) => {
    if (msg.method === 'Network.responseReceived') {
      const url = msg.params.response.url || '';
      if (API_RE.test(url)) pending.set(msg.params.requestId, url);
      return;
    }
    if (msg.method === 'Network.loadingFailed') {
      const errorText = (msg.params && msg.params.errorText) || '';
      if (PROXY_FAIL_RE.test(errorText)) networkError = proxyError(errorText);
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
        payloads.push(JSON.parse(text));
      })
      .catch(() => {
        /* 忽略取不到响应体的请求 */
      });
  };

  try {
    call = await browserLogin.cdpConnect(ws, onEvent);
    await call('Network.enable', {});
    await call('Page.enable', {});

    // 先打开首页预热，再在站内搜索框里发起搜索，直接跳搜索 URL 更容易触发验证码
    await call('Page.navigate', { url: 'https://www.douyin.com/' });
    const warmed = await browser.waitForEval(
      call,
      'location.hostname === "www.douyin.com" && location.pathname.indexOf("/search/") !== 0',
      10000
    );
    if (warmed) {
      await browser.waitForEval(call, 'document.readyState === "complete"', 5000);
      await browser.waitForEval(
        call,
        '!!document.querySelector(\'input[data-e2e="searchbar-input"], input[placeholder*="搜索"]\')',
        6000
      );
      await browser.submitSearch(
        call,
        ['input[data-e2e="searchbar-input"]', 'input[placeholder*="搜索"]'],
        keyword,
        '[data-e2e="searchbar-button"]'
      );
      const jumped = await browser.waitForEval(call, 'location.pathname.indexOf("/search/") === 0', 5000);
      if (!jumped) await call('Page.navigate', { url: searchUrl(keyword) });
    } else {
      await call('Page.navigate', { url: searchUrl(keyword) });
    }

    const deadline = Date.now() + WAIT_MS;
    let lastCheck = 0;
    while (Date.now() < deadline) {
      const hit = payloads.find((p) => parseItems(p).length);
      if (hit) return parseItems(hit);
      if (networkError) throw networkError;
      // 验证码中间页正文为空，只能靠标题/URL 识别，命中后立即失败而不是干等超时
      if (Date.now() - lastCheck > 3000) {
        lastCheck = Date.now();
        const page = await evalJs(call, '({url: location.href, title: document.title})');
        if (page && (/captcha|verify/i.test(page.url || '') || /验证码|安全验证/.test(page.title || ''))) {
          throw captchaError();
        }
      }
      await sleep(250);
    }

    const info = await evalJs(
      call,
      '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})'
    );
    if (
      info &&
      (/captcha|verify/i.test(info.url || '') ||
        /验证码/.test(info.title || '') ||
        /验证|登录/.test(info.text || ''))
    ) {
      throw captchaError();
    }
    if (networkError) throw networkError;
    throw new Error('未捕获到抖音搜索接口，可能触发了平台访问限制或页面结构变化，请稍后重试');
  } finally {
    if (call) call.close();
  }
}

async function evalJs(call, expression) {
  try {
    const res = await call('Runtime.evaluate', { expression, returnByValue: true });
    return res && res.result ? res.result.value : null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  platform: PLATFORM,
  requiresLogin: true,
  available,
  search
};
