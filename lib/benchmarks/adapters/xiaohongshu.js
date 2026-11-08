'use strict';

/**
 * 小红书对标账号抓取。
 *
 * 默认打开用户主页，捕获页面自己发出的 user_posted 接口响应；
 * 连接设置里启用「灰豚数据」后改走灰豚接口，避免小红书站内风控。
 * 主页链接里的 xsec_token 会保留，作品链接也带上 token，避免点开 404。
 */

const { parseCount } = require('../../trends/util');
const { openCapture, isoFrom, cleanText } = require('./capture');
const huitun = require('../../huitun');
const channelConnections = require('../../channel-connections');

const PLATFORM = '小红书';
const API_RE = /\/api\/sns\/web\/v[12]\/user_posted/;
const WAIT_MS = 25000;
const MAX_ITEMS = 30;
const HUITUN_PAGE_SIZE = 20;
const HUITUN_MAX_PAGES = 5;

function huitunReady() {
  try {
    const raw = channelConnections.getRaw('灰豚数据');
    const cookie = raw && raw.fields ? String(raw.fields.Cookie || '').trim() : '';
    return !!(raw && raw.enabled && cookie);
  } catch (err) {
    return false;
  }
}

/** 灰豚连接开启、或账号本身来自灰豚链接时都不需要再拉起小红书浏览器 */
function needsBrowser(account) {
  if (huitunReady()) return false;
  return !(account && account.huitunAnchorId);
}

function parseAccountUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch (err) {
    return null;
  }
  // 灰豚达人详情链接：https://xhs.huitun.com/#/anchor/anchor_detail?id=<anchorId>
  if (/(^|\.)huitun\.com$/i.test(url.hostname)) {
    const anchorId = huitun.parseAnchorUrl(String(input));
    if (!anchorId) return null;
    return {
      platform: PLATFORM,
      accountId: anchorId,
      profileUrl: huitun.anchorUrl(anchorId),
      huitunAnchorId: anchorId
    };
  }
  if (!/(^|\.)xiaohongshu\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/\/user\/profile\/([0-9A-Za-z]+)/);
  if (!m) return null;
  const xsecToken = url.searchParams.get('xsec_token') || '';
  const profileUrl =
    'https://www.xiaohongshu.com/user/profile/' +
    m[1] +
    (xsecToken ? '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_user' : '');
  return { platform: PLATFORM, accountId: m[1], profileUrl, xsecToken };
}

function coverUrlOf(card) {
  const cover = card.cover || card.image || {};
  if (typeof cover === 'string') return cover;
  const info = Array.isArray(cover.info_list) && cover.info_list[0] ? cover.info_list[0].url : '';
  return cover.url_default || cover.urlDefault || cover.url_pre || cover.url || info || '';
}

function parseNotes(json) {
  const data = (json && json.data) || {};
  const list = data.notes || data.items || data.data;
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((row) => {
    if (!row) return;
    const card = row.note_card || row.noteCard || row;
    const id = row.note_id || row.noteId || row.id || card.note_id;
    if (!id) return;
    const user = card.user || row.user || {};
    const interact = card.interact_info || card.interactInfo || {};
    const xsec = row.xsec_token || card.xsec_token || '';
    const type = String(card.type || card.note_type || '').toLowerCase();
    out.push({
      workId: String(id),
      title: cleanText(card.display_title || card.displayTitle || card.title || '', 120) || '（无标题笔记）',
      author: cleanText(user.nickname || user.nick_name || '', 60),
      avatarUrl: user.avatar || user.image || '',
      coverUrl: coverUrlOf(card),
      itemUrl:
        'https://www.xiaohongshu.com/explore/' +
        id +
        (xsec ? '?xsec_token=' + encodeURIComponent(xsec) + '&xsec_source=pc_user' : ''),
      itemType: type === 'video' ? 'video' : 'note',
      likes: parseCount(interact.liked_count || interact.likedCount),
      comments: parseCount(interact.comment_count || interact.commentCount),
      shares: parseCount(interact.share_count || interact.shareCount),
      collects: parseCount(interact.collected_count || interact.collectedCount),
      reads: 0,
      publishedAt: isoFrom(card.time || row.time || card.last_update_time || row.last_update_time)
    });
  });
  return out;
}

function riskError(url) {
  const err = new Error('小红书返回访问限制，请稍后再试；频繁抓取会加重限制');
  err.risk = true;
  if (/300012/.test(url || '')) err.message = '小红书返回访问限制（错误码 300012：IP 存在风险），请稍后再试';
  return err;
}

/** 灰豚按北京时间（+08:00）筛日期 */
function beijingDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function pickAnchorId(row) {
  return String(row.anchorId || row.anchor_id || row.id || '').trim();
}

function pickAnchorName(row) {
  return cleanText(row.nick || row.nickname || row.name || row.anchorName || row.anchor_name || '', 60);
}

function pickAnchorAvatar(row) {
  return row.headurl || row.avatar || row.image || row.avatarUrl || row.avatar_url || '';
}

/** 在灰豚按昵称搜索达人；优先精确匹配，多个同名候选时要求用户改用达人链接 */
async function resolveAnchor(cookie, keyword) {
  const list = await huitun.searchAnchor(cookie, keyword, { page: 1, pageSize: 10 });
  const candidates = list
    .map((row) => ({
      anchorId: pickAnchorId(row),
      name: pickAnchorName(row),
      avatarUrl: pickAnchorAvatar(row),
      redId: String(row.redId || row.red_id || '')
    }))
    .filter((item) => item.anchorId);

  if (!candidates.length) {
    throw new Error('灰豚数据未搜到「' + keyword + '」，请确认博主昵称，或粘贴灰豚达人主页链接重新添加');
  }
  const exact = candidates.find((item) => item.name === keyword);
  if (exact) return exact;
  if (candidates.length === 1) return candidates[0];
  const names = candidates.slice(0, 3).map((item) => item.name || item.redId || item.anchorId).join('、');
  throw new Error(
    '灰豚数据搜到多个同名达人（' + names + '），请打开灰豚达人主页复制链接重新添加该账号'
  );
}

/**
 * 灰豚笔记列表只给内部 noteId，需逐条换取小红书原始链接；
 * 单条失败不影响整次同步，留空由界面隐藏「看原作」。
 */
async function fillItemUrls(cookie, works) {
  for (const work of works) {
    if (work.itemUrl) continue;
    try {
      const url = await huitun.noteUrl(cookie, work.workId);
      if (url) work.itemUrl = url;
    } catch (err) {
      /* 链接解析失败不阻断同步 */
    }
  }
}

async function fetchFromHuitun(account, ctx) {
  const conn = huitun.connection();
  const cookie = conn.cookie;
  let anchorId = String(account.huitunAnchorId || '').trim() || huitun.parseAnchorUrl(account.profileUrl);
  let name = account.name || '';
  let avatarUrl = '';

  if (!anchorId) {
    const keyword = String(account.name || '').trim();
    if (!keyword) {
      throw new Error('该账号还没有关联灰豚达人，请先在灰豚数据搜索博主，粘贴其达人主页链接重新添加');
    }
    const anchor = await resolveAnchor(cookie, keyword);
    anchorId = anchor.anchorId;
    name = name || anchor.name;
    avatarUrl = anchor.avatarUrl || '';
  }

  const sinceMs = Number(ctx.sinceMs) || 0;
  const seen = new Set();
  const works = [];
  const dateStart = beijingDate(sinceMs);
  const dateEnd = beijingDate(Date.now());
  for (let page = 1; page <= HUITUN_MAX_PAGES && works.length < MAX_ITEMS; page++) {
    const data = await huitun.listAnchorNotes(cookie, anchorId, {
      page,
      pageSize: HUITUN_PAGE_SIZE,
      dateStart,
      dateEnd
    });
    if (!data.list.length) break;
    let oldest = Infinity;
    data.list.forEach((row) => {
      if (!name && row.nick) name = cleanText(row.nick, 60);
      if (!avatarUrl && row.headurl) avatarUrl = row.headurl;
      const item = huitun.parseNote(row);
      if (!item) return;
      const time = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
      if (time) oldest = Math.min(oldest, time);
      if (sinceMs && time && time < sinceMs) return;
      if (seen.has(item.workId)) return;
      seen.add(item.workId);
      works.push(item);
    });
    if (sinceMs && oldest !== Infinity && oldest < sinceMs) break;
    if (data.list.length < HUITUN_PAGE_SIZE) break;
    if (!data.total || page * HUITUN_PAGE_SIZE >= data.total) break;
  }

  works.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  const limited = works.slice(0, MAX_ITEMS);
  await fillItemUrls(cookie, limited);
  return {
    account: {
      name,
      avatarUrl,
      profileUrl: account.profileUrl || huitun.anchorUrl(anchorId),
      huitunAnchorId: anchorId
    },
    works: limited
  };
}

async function fetchFromBrowser(account, ctx) {
  const cap = await openCapture(ctx.browser, {
    platform: PLATFORM,
    match: (url) => API_RE.test(url)
  });
  try {
    await cap.navigate(account.profileUrl);
    let lastCheck = 0;
    const hit = await cap.waitFor(async () => {
      const found = cap.payloads.find((p) => parseNotes(p.json).length);
      if (found) return found;
      if (Date.now() - lastCheck > 2000) {
        lastCheck = Date.now();
        const page = await cap.evaluate(
          '({url: location.href, title: document.title, text: (document.body && document.body.innerText || "").slice(0, 300)})'
        );
        const pageUrl = (page && page.url) || '';
        const title = (page && page.title) || '';
        const text = (page && page.text) || '';
        if (/website-login\/error/.test(pageUrl) || /安全限制/.test(title) || /IP存在风险|网络环境/.test(text)) {
          throw riskError(pageUrl);
        }
        if (/\/login\b/.test(pageUrl) || /扫码登录|登录小红书/.test(text)) {
          throw new Error('小红书需要登录态，请到「连接设置」重新登录小红书后再试');
        }
      }
      return null;
    }, WAIT_MS);
    if (!hit) throw new Error('未捕获到小红书主页作品接口，可能触发了平台访问限制或页面结构变化');

    const all = [];
    cap.payloads.forEach((p) => {
      parseNotes(p.json).forEach((item) => all.push(item));
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

async function fetchRecent(account, ctx) {
  if (huitunReady()) return fetchFromHuitun(account, ctx);
  if (account.huitunAnchorId) {
    throw new Error('该账号使用灰豚达人链接添加，请先在「连接设置」启用灰豚数据');
  }
  return fetchFromBrowser(account, ctx);
}

module.exports = {
  platform: PLATFORM,
  requiresLogin: true,
  needsBrowser,
  huitunReady,
  parseAccountUrl,
  fetchRecent
};
