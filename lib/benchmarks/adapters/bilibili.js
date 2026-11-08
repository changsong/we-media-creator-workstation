'use strict';

/**
 * B站对标账号抓取。
 *
 * /video 页会由页面自己请求 wbi 签名的投稿列表接口；/dynamic 页请求动态接口。
 * 视频取投稿列表，图文取动态里的图文/专栏动态（跳过视频投稿动态，避免与投稿列表重复）。
 */

const { parseCount } = require('../../trends/util');
const { openCapture, isoFrom, cleanText } = require('./capture');

const PLATFORM = 'B站';
const VIDEO_API_RE = /\/x\/space\/wbi\/arc\/search/;
const DYN_API_RE = /\/x\/polymer\/web\/dynamic\/v1\/feed\/space/;
const WAIT_MS = 25000;
const DYN_WAIT_MS = 12000;
const MAX_ITEMS = 30;
const RISK_CODES = new Set([-352, -412, -799]);

function parseAccountUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch (err) {
    return null;
  }
  if (!/(^|\.)bilibili\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/(?:space\/)?(\d+)(?:\/|$)/);
  if (!m) return null;
  return {
    platform: PLATFORM,
    accountId: m[1],
    profileUrl: 'https://space.bilibili.com/' + m[1] + '/video'
  };
}

function riskError(code) {
  const err = new Error(
    'B站接口返回访问限制（错误码 ' + code + '），请稍后再试；频繁抓取会加重限制'
  );
  err.risk = true;
  return err;
}

function parseVideos(json) {
  if (json && RISK_CODES.has(Number(json.code))) throw riskError(json.code);
  const list = json && json.data && json.data.list && json.data.list.vlist;
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((row) => {
    if (!row) return;
    const bvid = row.bvid || '';
    if (!bvid) return;
    const pic = String(row.pic || '');
    out.push({
      workId: bvid,
      title: cleanText(row.title || '', 120) || '（无标题视频）',
      coverUrl: pic.indexOf('//') === 0 ? 'https:' + pic : pic,
      itemUrl: 'https://www.bilibili.com/video/' + bvid,
      itemType: 'video',
      likes: 0,
      comments: parseCount(row.video_review),
      shares: 0,
      collects: 0,
      reads: parseCount(row.play),
      publishedAt: isoFrom(row.created)
    });
  });
  return out;
}

function dynamicText(dyn) {
  const opus = dyn && dyn.major && dyn.major.opus;
  const draw = dyn && dyn.major && dyn.major.draw;
  const archive = dyn && dyn.major && dyn.major.archive;
  if (opus && opus.title) return opus.title;
  if (dyn && dyn.desc && dyn.desc.text) return dyn.desc.text;
  if (draw && Array.isArray(draw.items) && draw.items.length) return draw.items.length + ' 张图片';
  if (archive && archive.title) return archive.title;
  return '';
}

function dynamicCover(dyn) {
  const opus = dyn && dyn.major && dyn.major.opus;
  if (opus && Array.isArray(opus.pics) && opus.pics[0]) return opus.pics[0].url || '';
  const draw = dyn && dyn.major && dyn.major.draw;
  if (draw && Array.isArray(draw.items) && draw.items[0]) return draw.items[0].src || '';
  const archive = dyn && dyn.major && dyn.major.archive;
  if (archive && archive.pic) {
    const pic = String(archive.pic);
    return pic.indexOf('//') === 0 ? 'https:' + pic : pic;
  }
  return '';
}

function parseDynamics(json) {
  if (json && RISK_CODES.has(Number(json.code))) throw riskError(json.code);
  const items = json && json.data && json.data.items;
  if (!Array.isArray(items)) return [];
  const out = [];
  items.forEach((row) => {
    if (!row) return;
    const type = String(row.type || '');
    if (type === 'DYNAMIC_TYPE_AV') return;
    const id = row.id_str || row.idStr || '';
    if (!id) return;
    const modules = row.modules || {};
    const author = modules.module_author || {};
    const dyn = modules.module_dynamic || {};
    const stat = modules.module_stat || {};
    out.push({
      workId: id,
      title: cleanText(dynamicText(dyn), 120) || '（无标题图文）',
      coverUrl: dynamicCover(dyn),
      itemUrl: 'https://t.bilibili.com/' + id,
      itemType: 'note',
      likes: parseCount(stat.like && stat.like.count),
      comments: parseCount(stat.comment && stat.comment.count),
      shares: parseCount(stat.forward && stat.forward.count),
      collects: 0,
      reads: 0,
      publishedAt: isoFrom(author.pub_ts)
    });
  });
  return out;
}

function dedupeSort(all, sinceMs) {
  const seen = new Set();
  const works = [];
  all.forEach((item) => {
    if (seen.has(item.workId)) return;
    if (sinceMs && item.publishedAt && new Date(item.publishedAt).getTime() < sinceMs) return;
    seen.add(item.workId);
    works.push(item);
  });
  works.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  return works.slice(0, MAX_ITEMS);
}

async function fetchRecent(account, ctx) {
  const cap = await openCapture(ctx.browser, {
    platform: PLATFORM,
    match: (url) => VIDEO_API_RE.test(url) || DYN_API_RE.test(url)
  });
  try {
    let lastCheck = 0;
    const checkPage = async () => {
      if (Date.now() - lastCheck < 2500) return;
      lastCheck = Date.now();
      const page = await cap.evaluate(
        '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})'
      );
      const pageUrl = (page && page.url) || '';
      const title = (page && page.title) || '';
      const text = (page && page.text) || '';
      if (/passport\.bilibili\.com/.test(pageUrl) || /登录/.test(title)) {
        const err = new Error('B站需要登录态才能读取账号主页，请到「连接设置」重新登录B站后再试');
        err.risk = true;
        throw err;
      }
      if (/账号异常|安全验证|访问受限|风控/.test(text)) {
        throw riskError(-352);
      }
      if (/用户不存在|账号已注销|404/.test(text)) {
        throw new Error('该B站账号不存在、已注销或不可见');
      }
    };

    await cap.navigate(account.profileUrl);
    const videoHit = await cap.waitFor(async () => {
      const found = cap.payloads.find((p) => VIDEO_API_RE.test(p.url) && parseVideos(p.json).length);
      if (found) return found;
      await checkPage();
      return null;
    }, WAIT_MS);
    if (!videoHit) {
      const risk = cap.payloads.find((p) => VIDEO_API_RE.test(p.url) && RISK_CODES.has(Number(p.json && p.json.code)));
      if (risk) throw riskError(risk.json.code);
      throw new Error('未捕获到 B站投稿列表接口，可能触发了平台访问限制或页面结构变化');
    }

    const videoPage = await cap.evaluate('document.title');
    let pageName = '';
    let pageAvatar = '';
    const profile = await cap.evaluate(
      '(() => { const n = document.querySelector(".nickname, #h-name, .h-name"); const i = document.querySelector(".h-avatar img, .bili-avatar-img, .avatar img"); return { name: n ? (n.textContent || "").trim() : "", avatar: i ? (i.getAttribute("src") || "") : "" }; })()'
    );
    if (profile) {
      pageName = profile.name || '';
      pageAvatar = profile.avatar || '';
    }

    await cap.navigate('https://space.bilibili.com/' + account.accountId + '/dynamic');
    await cap.waitFor(async () => {
      const found = cap.payloads.find((p) => DYN_API_RE.test(p.url) && parseDynamics(p.json).length);
      if (found) return found;
      await checkPage();
      return null;
    }, DYN_WAIT_MS).catch((err) => {
      if (err && (err.risk || err.proxy)) throw err;
      return null;
    });

    const all = [];
    cap.payloads.forEach((p) => {
      if (VIDEO_API_RE.test(p.url)) parseVideos(p.json).forEach((item) => all.push(item));
      else if (DYN_API_RE.test(p.url)) parseDynamics(p.json).forEach((item) => all.push(item));
    });
    const works = dedupeSort(all, Number(ctx.sinceMs) || 0);
    const first = works[0] || all[0] || {};
    return {
      account: {
        name: pageName || cleanText(String(videoPage || '').replace(/[-_|].*$/, ''), 60),
        avatarUrl: pageAvatar,
        profileUrl: account.profileUrl
      },
      works
    };
  } finally {
    cap.close();
  }
}

module.exports = {
  platform: PLATFORM,
  requiresLogin: false,
  parseAccountUrl,
  fetchRecent
};
