import crypto from 'node:crypto';
import { randomInt, sleep } from '../util.mjs';
import {
  assertNoRisk,
  extractComments,
  locateAndPrefill,
  openCommentsPanel,
  parseRelativeTime,
  scrollComments,
} from '../comment-browser.mjs';

const selectors = {
  item: ['.comment-item', '[class*="comment-item"]'],
  content: ['.content', '[class*="comment-content"]', '[class*="comment"] [class*="content"]'],
  author: ['.author', '[class*="author"]', 'a[href*="/user/profile/"]'],
  like: ['.like-wrapper .count', '[class*="like"] [class*="count"]'],
  time: ['.date', '[class*="date"]', '[class*="time"]'],
  scroll: ['[class*="comment-list"]', '[class*="comment-container"]', '[class*="comment"]'],
  editor: ['[contenteditable="true"]', 'textarea', '.ql-editor'],
  replyLabels: ['回复'],
  panel: {
    icon: ['[class*="comment-icon"]', '[class*="comment-btn"]'],
    labels: ['评论', '全部评论'],
  },
};

export const meta = {
  key: 'xiaohongshu',
  label: '小红书',
  needsBrowserForSearch: true,
  needsBrowserForComments: true,
  supportsManual: false,
};

function extractSearchCards() {
  const out = [];
  const seen = new Set();
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const anchors = Array.from(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]'));
  anchors.forEach((anchor) => {
    const match = anchor.href.match(/\/(?:explore|discovery\/item)\/([\w-]+)/);
    if (!match || seen.has(match[1])) return;
    seen.add(match[1]);
    let card = anchor;
    for (let i = 0; i < 6 && card; i += 1) {
      if (norm(card.innerText).length >= 10) break;
      card = card.parentElement;
    }
    const text = norm(card && card.innerText);
    const userLink = card && card.querySelector('a[href*="/user/profile/"]');
    out.push({
      id: match[1],
      url: 'https://www.xiaohongshu.com/explore/' + match[1],
      text: text.slice(0, 500),
      author: userLink ? norm(userLink.innerText) : '',
      author_url: userLink ? userLink.href : '',
    });
  });
  return out;
}

function relativeFromText(text) {
  const match = String(text || '').match(/(\d+\s*(?:分钟|小时|天|周|个月)前|刚刚|昨天|前天)/);
  return match ? parseRelativeTime(match[1]) : '';
}

export async function searchVideos({ session, keyword, limit = 8 }) {
  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`;
  await session.navigate(url, 3200);
  const pageText = await session.text(8000);
  if (/登录后查看|请先登录|扫码登录/.test(pageText)) {
    throw new Error('小红书搜索需要登录：先运行 collect-comments.mjs --platform xiaohongshu --login');
  }
  await assertNoRisk(session, `xiaohongshu-search-${keyword}`);

  const merged = new Map();
  const maxScrolls = Math.max(6, Math.min(20, Math.ceil(limit / 5) + 4));
  for (let i = 0; i < maxScrolls; i += 1) {
    const cards = await session.eval(`(${extractSearchCards.toString()})()`);
    for (const card of cards || []) {
      if (!merged.has(card.id)) merged.set(card.id, card);
    }
    if (merged.size >= limit) break;
    await scrollComments(session, ['[class*="search-result"]', '[class*="feeds"]', '[class*="note-list"]']);
    await sleep(randomInt(1800, 3000));
  }

  return [...merged.values()].slice(0, limit).map((card) => ({
    platform: 'xiaohongshu',
    video_id: card.id,
    video_url: card.url,
    title: card.text.slice(0, 120),
    description: card.text,
    author: card.author,
    author_id: (String(card.author_url || '').match(/\/user\/profile\/([^/?]+)/) || [])[1] || '',
    author_url: card.author_url,
    published_at: relativeFromText(card.text),
    like_count: 0,
    comment_count: 0,
    keyword,
  }));
}

export async function collectComments({ session, video, limit = 30, config = {} }) {
  await session.navigate(video.video_url, 3200);
  await assertNoRisk(session, 'xiaohongshu-video');
  await openCommentsPanel(session, selectors);

  const maxComments = limit > 0
    ? limit
    : Math.max(1, Number(config.settings && config.settings.maxCommentsPerVideo) || 1000);
  const maxScrolls = limit > 0 ? Math.max(14, Math.ceil(limit / 5) + 8) : 100;
  const startedAt = Date.now();
  const maxMs = Math.max(60000, Number(config.settings && config.settings.maxCommentsMinutes) || 5) * 60000;
  const merged = new Map();
  let stale = 0;
  for (let i = 0; i < maxScrolls && merged.size < maxComments; i += 1) {
    if (Date.now() - startedAt > maxMs) break;
    const before = merged.size;
    const list = await extractComments(session, selectors, maxComments - merged.size);
    for (const item of list) {
      if (!item.text) continue;
      const key = item.item_id || item.text;
      if (!merged.has(key)) merged.set(key, item);
    }
    if (merged.size >= maxComments) break;
    stale = merged.size === before ? stale + 1 : 0;
    if (stale >= 3) break;
    await scrollComments(session, selectors.scroll);
    await sleep(randomInt(1000, 1800));
  }

  return [...merged.values()].slice(0, maxComments).map((item) => ({
    platform: 'xiaohongshu',
    video_id: video.video_id,
    comment_id: item.item_id || 'h_' + crypto.createHash('sha1')
      .update(`xiaohongshu|${video.video_id}|${item.author}|${item.text}`)
      .digest('hex').slice(0, 16),
    parent_comment_id: '',
    root_comment_id: item.item_id || '',
    author: item.author,
    author_id: (String(item.author_url || '').match(/\/user\/profile\/([^/?]+)/) || [])[1] || '',
    author_url: item.author_url,
    text: item.text,
    thread_text: '',
    likes: item.likes,
    published_at: item.published_at,
  }));
}

export async function focusComment({ session, comment, draft }) {
  await session.navigate(comment.video_url, 3200);
  await assertNoRisk(session, 'xiaohongshu-focus');
  await openCommentsPanel(session, selectors);
  return locateAndPrefill({ session, comment, selectors, draft });
}

export { selectors };
