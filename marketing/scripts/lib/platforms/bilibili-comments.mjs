import fs from 'node:fs';
import path from 'node:path';
import { ROOT, randomInt, sleep } from '../util.mjs';
import { assertNoRisk, locateAndPrefill, openCommentsPanel, parseCount, parseRelativeTime } from '../comment-browser.mjs';
import { isRelevantVideo } from '../comment-video-filter.mjs';

const REPO_ROOT = path.resolve(ROOT, '..');
const CONNECTIONS_FILE = path.join(REPO_ROOT, 'data', 'channel-connections.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const selectors = {
  item: ['.reply-item', '[class*="reply-item"]', '.sub-reply-item'],
  content: ['.reply-content', '[class*="reply-content"]'],
  author: ['.user-name', '[class*="user-name"]'],
  like: ['.like', '[class*="like"]'],
  scroll: ['.reply-list', '[class*="reply-list"]'],
  editor: ['[contenteditable="true"]', 'textarea', '.ql-editor'],
  replyLabels: ['回复'],
  panel: { labels: ['评论', '全部评论'] },
};

export const meta = {
  key: 'bilibili',
  label: 'B站',
  needsBrowserForSearch: true,
  needsBrowserForComments: false,
  supportsManual: false,
};

function readCookie() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf8'));
    const fields = (cfg['B站'] && cfg['B站'].fields) || {};
    const parts = [];
    if (fields.SESSDATA) parts.push('SESSDATA=' + fields.SESSDATA);
    if (fields.bili_jct) parts.push('bili_jct=' + fields.bili_jct);
    if (fields.UID) parts.push('DedeUserID=' + fields.UID);
    return parts.join('; ');
  } catch (err) {
    return '';
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim();
}

async function api(pathname) {
  const cookie = readCookie();
  const headers = {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    referer: 'https://www.bilibili.com/',
    origin: 'https://www.bilibili.com',
  };
  if (cookie) headers.cookie = cookie;
  const res = await fetch('https://api.bilibili.com' + pathname, { headers });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error('B站接口返回非 JSON，可能被风控，请稍后重试');
  }
  if (data.code !== 0) {
    const hint = [-352, -412, -799].includes(Number(data.code))
      ? '（B站限流）。建议先在主应用「连接设置 · B站」登录，或等 10 分钟再跑、换关键词。'
      : '';
    const error = new Error(`B站接口 ${data.code}：${data.message || '未知错误'}${hint}`);
    error.code = data.code;
    throw error;
  }
  return data.data;
}

async function searchVideosApi({ keyword, limit = 100 }) {
  const pageSize = 50;
  const pages = Math.max(1, Math.min(Math.ceil(limit / pageSize), 4));
  const all = [];
  for (let page = 1; page <= pages; page += 1) {
    const data = await api(
      `/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&page=${page}&page_size=${pageSize}`
    );
    const list = Array.isArray(data && data.result) ? data.result : [];
    all.push(...list);
    if (list.length < pageSize) break;
    if (page < pages) await sleep(randomInt(700, 1500));
  }
  const unique = [];
  const seen = new Set();
  for (const item of all) {
    if (!item.bvid || seen.has(item.bvid)) continue;
    seen.add(item.bvid);
    unique.push(item);
  }
  return unique
    .slice(0, limit)
    .map((item) => ({
      platform: 'bilibili',
      video_id: item.bvid,
      video_url: `https://www.bilibili.com/video/${item.bvid}`,
      title: stripHtml(item.title),
      description: stripHtml(item.description || ''),
      author: item.author || '',
      author_id: item.mid ? String(item.mid) : '',
      author_url: item.mid ? `https://space.bilibili.com/${item.mid}` : '',
      published_at: item.pubdate ? new Date(item.pubdate * 1000).toISOString() : '',
      like_count: Number(item.like) || 0,
      comment_count: Number(item.review) || 0,
      keyword,
    }));
}

function extractBiliSearchCards() {
  const out = [];
  const seen = new Set();
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
  document.querySelectorAll('div.bili-video-card').forEach((card) => {
    const anchor = card.querySelector('a[href*="/video/BV"]');
    if (!anchor) return;
    const match = anchor.href.match(/\/video\/(BV[\w]+)/);
    if (!match || seen.has(match[1])) return;
    seen.add(match[1]);
    const lines = String(card.innerText || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const dateIdx = lines.findIndex((line) => line.startsWith('·'));
    let title = '';
    let author = '';
    let dateText = '';
    if (dateIdx >= 2) {
      title = lines[dateIdx - 2];
      author = lines[dateIdx - 1];
      dateText = lines[dateIdx];
    } else {
      const anchors = Array.from(card.querySelectorAll('a[href*="/video/BV"]'));
      title = anchors.map((item) => norm(item.innerText)).find((text) => text.length > 6 && !/^\d/.test(text)) || '';
      author = lines[lines.length - 1] || '';
    }
    const authorLink = card.querySelector('a[href*="space.bilibili.com"]');
    out.push({
      id: match[1],
      url: 'https://www.bilibili.com/video/' + match[1] + '/',
      title: title.slice(0, 200),
      author,
      author_url: authorLink ? authorLink.href : '',
      date_text: dateText,
      text: norm(card.innerText).slice(0, 600),
      stats: lines.slice(0, Math.max(0, dateIdx - 2)),
    });
  });
  return out;
}

function parseBiliDate(text) {
  const raw = String(text || '').replace(/^·\s*/, '').trim();
  if (!raw) return '';
  if (/前|刚刚|昨天|前天/.test(raw)) return parseRelativeTime(raw);
  const full = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (full) {
    const date = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  const short = raw.match(/(\d{1,2})月(\d{1,2})日/);
  if (short) {
    const now = new Date();
    let date = new Date(now.getFullYear(), Number(short[1]) - 1, Number(short[2]));
    if (date.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      date = new Date(now.getFullYear() - 1, Number(short[1]) - 1, Number(short[2]));
    }
    return date.toISOString();
  }
  return '';
}

async function searchVideosBrowser({ session, keyword, limit, config }) {
  const merged = new Map();
  const maxPages = Math.max(1, Math.min(Math.ceil(limit / 20), 10));
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://search.bilibili.com/video?keyword=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
    await session.navigate(url, 3200);
    await assertNoRisk(session, `bilibili-search-${page}`);
    const cards = await session.eval(`(${extractBiliSearchCards.toString()})()`);
    let added = 0;
    for (const card of cards || []) {
      if (!card.id || merged.has(card.id)) continue;
      const video = {
        platform: 'bilibili',
        video_id: card.id,
        video_url: card.url,
        title: card.title,
        description: card.text,
        author: card.author,
        author_id: '',
        author_url: card.author_url,
        published_at: parseBiliDate(card.date_text),
        like_count: parseCount(card.stats && card.stats[0]),
        comment_count: parseCount(card.stats && card.stats[1]),
        keyword,
      };
      if (!isRelevantVideo(video, keyword, config)) continue;
      merged.set(card.id, video);
      added += 1;
      if (merged.size >= limit) break;
    }
    if (merged.size >= limit) break;
    if (!added) break;
    if (page < maxPages) await sleep(randomInt(900, 1800));
  }
  return [...merged.values()].slice(0, limit);
}

export async function searchVideos({ session, keyword, limit = 100, config = {} }) {
  if (session) {
    try {
      return await searchVideosBrowser({ session, keyword, limit, config });
    } catch (err) {
      console.warn(`B站网页搜索失败，回退 API：${err.message}`);
    }
  }
  return searchVideosApi({ keyword, limit });
}

function toComment(reply, videoId, parent) {
  return {
    platform: 'bilibili',
    video_id: videoId,
    comment_id: String(reply.rpid),
    parent_comment_id: parent ? String(reply.parent || '') : '',
    root_comment_id: parent ? String(reply.root || parent.rpid) : String(reply.rpid),
    author: (reply.member && reply.member.uname) || '',
    author_id: reply.mid ? String(reply.mid) : '',
    author_url: reply.mid ? `https://space.bilibili.com/${reply.mid}` : '',
    text: (reply.content && reply.content.message) || '',
    thread_text: parent
      ? `回复 @${(parent.member && parent.member.uname) || ''}：${(parent.content && parent.content.message) || ''}`
      : '',
    likes: Number(reply.like) || 0,
    published_at: reply.ctime ? new Date(reply.ctime * 1000).toISOString() : '',
  };
}

export async function collectComments({ video, limit = 30, config = {} }) {
  const view = await api(`/x/web-interface/view?bvid=${encodeURIComponent(video.video_id)}`);
  const aid = view && view.aid;
  if (!aid) throw new Error(`B站视频 ${video.video_id} 没有拿到 aid`);

  const maxComments = limit > 0
    ? limit
    : Math.max(1, Number(config.settings && config.settings.maxCommentsPerVideo) || 1000);
  const pageSize = 20;
  const pages = Math.max(1, Math.min(Math.ceil(maxComments / pageSize), 50));
  const topLevel = [];
  for (let page = 1; page <= pages; page += 1) {
    const data = await api(
      `/x/v2/reply?type=1&oid=${aid}&sort=2&ps=${pageSize}&pn=${page}`
    );
    const replies = (data && data.replies) || [];
    topLevel.push(...replies);
    if (replies.length < pageSize) break;
    if (topLevel.length >= maxComments) break;
    await sleep(randomInt(1500, 3000));
  }

  const byId = new Map(topLevel.map((item) => [String(item.rpid), item]));
  const out = [];
  for (const reply of topLevel) {
    out.push(toComment(reply, video.video_id, null));
    for (const sub of reply.replies || []) {
      const parent = byId.get(String(sub.parent)) || reply;
      out.push(toComment(sub, video.video_id, parent));
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, maxComments);
}

export async function focusComment({ session, comment, draft }) {
  const match = String(comment.video_url || '').match(/\/video\/(BV[\w]+)/);
  const url = match
    ? `https://www.bilibili.com/video/${match[1]}#reply${comment.comment_id}`
    : comment.video_url;
  await session.navigate(url, 2600);
  await assertNoRisk(session, 'bilibili');
  await openCommentsPanel(session, selectors);
  return locateAndPrefill({ session, comment, selectors, draft });
}

export { selectors };
