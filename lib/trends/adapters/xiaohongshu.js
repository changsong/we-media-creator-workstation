'use strict';

/**
 * 小红书搜索适配器。
 *
 * 搜索接口有 X-s 签名，直接发 HTTP 会 406，所以无头打开搜索页，
 * 捕获页面自己发出的 /api/sns/web/v1/search/notes 响应。
 */

const browserLogin = require('../../browser-login');
const channelConnections = require('../../channel-connections');
const browser = require('../browser');
const { parseCount, dedupe } = require('../util');

const PLATFORM = '小红书';
const API_RE = /\/api\/sns\/web\/v[12]\/search\/notes/;
const WAIT_MS = 30000;
const MAX_ITEMS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function riskControlError(url) {
  // 300012：IP/环境被判定为风险，搜索页会跳到 /website-login/error 安全限制页。
  // 该 URL 里也含 /login，不能当成登录失效处理。
  const hint = /300012/.test(url || '') ? '（错误码 300012：IP 存在风险）' : '';
  const err = new Error('小红书返回访问限制' + hint + '，请稍后重试，频繁搜索会加重限制');
  err.risk = true;
  return err;
}

const PROXY_FAIL_RE = /ERR_PROXY|ERR_TUNNEL/i;

function proxyError(text) {
  const err = new Error(
    '小红书请求经代理失败（' + (text || '未知错误') + '），请检查「连接设置 · 网络代理」'
  );
  err.proxy = true;
  return err;
}

function available() {
  const conn = channelConnections.get(PLATFORM);
  return !!(conn && conn.enabled);
}

function searchUrl(keyword) {
  return 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_search_result_notes';
}

function parseItems(json) {
  const data = json && json.data;
  const list = data && (data.items || data.notes || data.data);
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((raw) => {
    if (!raw) return;
    const card = raw.note_card || raw.noteCard || raw;
    const id = card.note_id || card.noteId || card.id || raw.id;
    if (!id) return;
    const interact = card.interact_info || card.interactInfo || {};
    const cover = card.cover || {};
    const coverUrl =
      cover.url_default ||
      cover.urlDefault ||
      cover.url_pre ||
      cover.url ||
      (Array.isArray(cover.info_list) && cover.info_list[0] && cover.info_list[0].url) ||
      '';
    const xsec = raw.xsec_token || card.xsec_token || '';
    const title = String(card.display_title || card.displayTitle || card.title || '').trim();
    out.push({
      workId: String(id),
      title: title || '（无标题笔记）',
      author: (card.user && (card.user.nickname || card.user.nick_name)) || '',
      coverUrl,
      itemUrl:
        'https://www.xiaohongshu.com/explore/' +
        id +
        (xsec ? '?xsec_token=' + encodeURIComponent(xsec) + '&xsec_source=pc_search' : ''),
      itemType: card.type === 'video' ? 'video' : 'note',
      likes: parseCount(interact.liked_count || interact.likedCount),
      comments: parseCount(interact.comment_count || interact.commentCount),
      shares: parseCount(interact.share_count || interact.shareCount),
      collects: parseCount(interact.collected_count || interact.collectedCount),
      reads: 0,
      publishedAt: ''
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
        /* 响应体取不到时忽略，交给超时逻辑 */
      });
  };

  try {
    call = await browserLogin.cdpConnect(ws, onEvent);
    await call('Network.enable', {});
    await call('Page.enable', {});

    // 先打开首页预热，再在站内搜索框里发起搜索，比直接跳搜索 URL 更接近常规浏览路径
    await call('Page.navigate', { url: 'https://www.xiaohongshu.com/explore' });
    const warmed = await browser.waitForEval(call, 'location.pathname === "/explore"', 10000);
    if (warmed) {
      await browser.waitForEval(call, 'document.readyState === "complete"', 5000);
      await browser.waitForEval(
        call,
        '!!document.querySelector(\'#search-input, input[placeholder*="搜索"]\')',
        6000
      );
      await browser.submitSearch(
        call,
        ['#search-input', 'input[placeholder*="搜索"]'],
        keyword,
        '.search-icon'
      );
      const jumped = await browser.waitForEval(
        call,
        'location.pathname.indexOf("search_result") >= 0',
        5000
      );
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
      // 平台限制会立刻跳到安全限制页，早失败而不是干等 30 秒超时
      if (Date.now() - lastCheck > 2000) {
        lastCheck = Date.now();
        const page = await evalJs(call, '({url: location.href, title: document.title})');
        const pageUrl = (page && page.url) || '';
        if (/website-login\/error/.test(pageUrl) || /安全限制/.test((page && page.title) || '')) {
          throw riskControlError(pageUrl);
        }
        if (/\/login\b/.test(pageUrl) && !/website-login/.test(pageUrl)) {
          throw new Error('小红书需要主站登录态，请到「连接设置」重新登录小红书后再试');
        }
      }
      await sleep(250);
    }

    const info = await evalJs(
      call,
      '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})'
    );
    const infoUrl = (info && info.url) || '';
    const infoTitle = (info && info.title) || '';
    const infoText = (info && info.text) || '';
    if (/website-login\/error/.test(infoUrl) || /安全限制/.test(infoTitle) || /IP存在风险|网络环境/.test(infoText)) {
      throw riskControlError(infoUrl);
    }
    if ((/\/login\b/.test(infoUrl) && !/website-login/.test(infoUrl)) || /扫码登录|登录小红书|验证码登录/.test(infoText)) {
      throw new Error('小红书需要主站登录态，请到「连接设置」重新登录小红书后再试');
    }
    if (networkError) throw networkError;
    throw new Error('未捕获到小红书搜索接口，可能触发了平台访问限制或页面结构变化，请稍后重试');
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
