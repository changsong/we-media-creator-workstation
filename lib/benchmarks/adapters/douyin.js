'use strict';

/**
 * 抖音对标账号抓取。
 *
 * 打开用户主页，捕获页面自己发出的作品列表接口（a_bogus 等签名由页面生成）。
 * 同时覆盖视频与图文（aweme_type=68 / images 非空）。
 */

const { parseCount } = require('../../trends/util');
const { openCapture, isoFrom, cleanText } = require('./capture');

const PLATFORM = '抖音';
const API_RE = /\/aweme\/v1\/web\/aweme\/post/;
const WAIT_MS = 25000;
const MAX_ITEMS = 30;

function parseAccountUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (err) {
    return null;
  }
  if (!/(^|\.)douyin\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/\/user\/([0-9A-Za-z_-]+)/);
  if (!m || m[1] === 'self') return null;
  return {
    platform: PLATFORM,
    accountId: m[1],
    profileUrl: 'https://www.douyin.com/user/' + m[1]
  };
}

function pickAweme(row) {
  if (!row) return null;
  return row.aweme_info || row.awemeInfo || row.aweme || (row.aweme_id ? row : null);
}

function parseWorks(json) {
  const list = json && (Array.isArray(json.aweme_list) ? json.aweme_list : Array.isArray(json.data) ? json.data : null);
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((row) => {
    const a = pickAweme(row);
    if (!a) return;
    const id = a.aweme_id || a.awemeId;
    if (!id) return;
    const stats = a.statistics || {};
    const video = a.video || {};
    const coverList =
      (video.cover && video.cover.url_list) || (video.origin_cover && video.origin_cover.url_list) || [];
    const images = Array.isArray(a.images) ? a.images : [];
    const isImage = Number(a.aweme_type) === 68 || images.length > 0;
    const author = a.author || {};
    out.push({
      workId: String(id),
      title: cleanText(a.desc || '（无标题作品）', 120),
      author: cleanText(author.nickname || author.unique_id || '', 60),
      avatarUrl:
        (author.avatar_thumb && author.avatar_thumb.url_list && author.avatar_thumb.url_list[0]) ||
        (author.avatar_medium && author.avatar_medium.url_list && author.avatar_medium.url_list[0]) ||
        '',
      coverUrl: coverList[0] || '',
      itemUrl: 'https://www.douyin.com/' + (isImage ? 'note/' : 'video/') + id,
      itemType: isImage ? 'note' : 'video',
      likes: parseCount(stats.digg_count || stats.diggCount),
      comments: parseCount(stats.comment_count || stats.commentCount),
      shares: parseCount(stats.share_count || stats.shareCount),
      collects: parseCount(stats.collect_count || stats.collectCount),
      reads: parseCount(stats.play_count || stats.playCount),
      publishedAt: isoFrom(a.create_time || a.createTime)
    });
  });
  return out;
}

function captchaError() {
  const err = new Error('抖音要求完成人机验证，请稍后重试；若持续出现，请到「连接设置」重新登录抖音');
  err.risk = true;
  return err;
}

async function fetchRecent(account, ctx) {
  const cap = await openCapture(ctx.browser, {
    platform: PLATFORM,
    match: (url) => API_RE.test(url)
  });
  try {
    await cap.navigate(account.profileUrl);
    let lastCheck = 0;
    const hit = await cap.waitFor(async () => {
      const found = cap.payloads.find((p) => parseWorks(p.json).length);
      if (found) return found;
      if (Date.now() - lastCheck > 2500) {
        lastCheck = Date.now();
        const page = await cap.evaluate(
          '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})'
        );
        const pageUrl = (page && page.url) || '';
        const title = (page && page.title) || '';
        const text = (page && page.text) || '';
        if (/captcha|verify/i.test(pageUrl) || /验证码|安全验证/.test(title)) throw captchaError();
        if (/登录后查看|请先登录|扫码登录|登录抖音/.test(text)) {
          throw new Error('抖音需要登录态才能读取账号作品，请到「连接设置」重新登录抖音后再试');
        }
        if (/用户不存在|账号已注销|作品不存在/.test(text)) {
          throw new Error('该抖音账号不存在、已注销或不可见');
        }
      }
      return null;
    }, WAIT_MS);
    if (!hit) throw new Error('未捕获到抖音主页作品接口，可能触发了平台访问限制或页面结构变化');

    const all = [];
    cap.payloads.forEach((p) => {
      parseWorks(p.json).forEach((item) => all.push(item));
    });
    const since = Number(ctx.sinceMs) || 0;
    const seen = new Set();
    const works = [];
    all.forEach((item) => {
      if (seen.has(item.workId)) return;
      if (since && item.publishedAt && new Date(item.publishedAt).getTime() < since) return;
      seen.add(item.workId);
      works.push(item);
    });
    works.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    const limited = works.slice(0, MAX_ITEMS);
    const first = limited[0] || all[0] || {};
    const pageTitle = await cap.evaluate('document.title');
    return {
      account: {
        name: first.author || cleanText(String(pageTitle || '').replace(/[-_|].*$/, ''), 60),
        avatarUrl: first.avatarUrl || '',
        profileUrl: account.profileUrl
      },
      works: limited
    };
  } finally {
    cap.close();
  }
}

module.exports = {
  platform: PLATFORM,
  requiresLogin: true,
  parseAccountUrl,
  fetchRecent
};
