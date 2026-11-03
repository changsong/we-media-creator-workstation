'use strict';

/**
 * B站搜索适配器。
 *
 * B站搜索结果页首屏是 SSR，结果直接渲染进 DOM（.bili-video-card），
 * 搜索接口另有 wbi 签名，因此直接解析结果卡片，不做接口拦截。
 * B站搜索一般无需登录。
 */

const browserLogin = require('../../browser-login');
const browser = require('../browser');
const { parseCount, dedupe, stripHtml } = require('../util');

const PLATFORM = 'B站';
const WAIT_MS = 30000;
const MAX_ITEMS = 20;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function available() {
  return true;
}

function searchUrl(keyword) {
  return 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(keyword) + '&search_type=video';
}

const EXTRACT_ROWS = `(() => {
  const out = [];
  document.querySelectorAll('.bili-video-card').forEach((card) => {
    const a = card.querySelector('a[href*="/video/BV"]');
    if (!a) return;
    const titEl = card.querySelector('.bili-video-card__info--tit');
    const title = titEl ? (titEl.textContent || '').trim() : '';
    if (!title) return;
    const authorEl = card.querySelector('.bili-video-card__info--author');
    const dateEl = card.querySelector('.bili-video-card__info--date');
    const img = card.querySelector('img');
    out.push({
      href: a.getAttribute('href') || '',
      title: title,
      author: authorEl ? (authorEl.textContent || '').trim() : '',
      date: dateEl ? (dateEl.textContent || '').trim() : '',
      stats: Array.from(card.querySelectorAll('.bili-video-card__stats--item')).map((e) => (e.textContent || '').trim()),
      cover: img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : ''
    });
  });
  return out;
})()`;

const STATE_EXPR = '({ readyState: document.readyState, rows: ' + EXTRACT_ROWS + ' })';

/** 搜索卡片只显示「· 10月1日」，没有年份，跨年时按去年处理 */
function parsePublishedAt(text) {
  const s = String(text || '');
  const now = new Date();
  let m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString();
  m = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    const year = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    return new Date(year, month, day).toISOString();
  }
  if (/昨天/.test(s)) return new Date(now.getTime() - 86400000).toISOString();
  if (/前天/.test(s)) return new Date(now.getTime() - 2 * 86400000).toISOString();
  if (/今天|刚刚|分钟前|小时前/.test(s)) return now.toISOString();
  m = s.match(/(\d+)\s*天前/);
  if (m) return new Date(now.getTime() - Number(m[1]) * 86400000).toISOString();
  return '';
}

function toItems(rows) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const m = String(row && row.href || '').match(/\/video\/(BV[0-9A-Za-z]+)/);
    if (!m) return;
    const cover = String(row.cover || '');
    const stats = Array.isArray(row.stats) ? row.stats : [];
    out.push({
      workId: m[1],
      title: stripHtml(row.title) || '（无标题视频）',
      author: stripHtml(row.author).slice(0, 60),
      coverUrl: cover.indexOf('//') === 0 ? 'https:' + cover : cover,
      itemUrl: 'https://www.bilibili.com/video/' + m[1],
      itemType: 'video',
      // 搜索结果卡片只有播放量和弹幕数，没有点赞/收藏
      likes: 0,
      comments: parseCount(stats[1]),
      shares: 0,
      collects: 0,
      reads: parseCount(stats[0]),
      publishedAt: parsePublishedAt(row.date)
    });
  });
  return dedupe(out).slice(0, MAX_ITEMS);
}

async function evalJs(call, expression) {
  try {
    const res = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (res && res.exceptionDetails) return null;
    return res && res.result ? res.result.value : null;
  } catch (err) {
    return null;
  }
}

async function search(keyword, ctx) {
  const ws = await browser.openPage(ctx.browser);
  let call = null;
  try {
    call = await browserLogin.cdpConnect(ws);
    await call('Page.enable', {});
    await call('Page.navigate', { url: searchUrl(keyword) });

    let lastItems = [];
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const state = await evalJs(call, STATE_EXPR);
      if (state && Array.isArray(state.rows)) {
        lastItems = toItems(state.rows);
        if (lastItems.length >= 3 || (state.readyState === 'complete' && lastItems.length)) {
          return lastItems;
        }
      }
      await sleep(500);
    }
    if (lastItems.length) return lastItems;

    const info = await evalJs(
      call,
      '({ url: location.href, text: (document.body && document.body.innerText || "").slice(0, 300) })'
    );
    if (info && (/captcha|verify/i.test(info.url || '') || /验证|登录/.test(info.text || ''))) {
      throw new Error('B站搜索被要求登录或完成验证，请稍后重试');
    }
    throw new Error('未解析到 B站搜索结果，可能页面结构变化或触发了平台访问限制，请稍后重试');
  } finally {
    if (call) call.close();
  }
}

module.exports = {
  platform: PLATFORM,
  requiresLogin: false,
  available,
  search
};
