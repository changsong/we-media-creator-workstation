import crypto from 'node:crypto';
import { isRelevantVideo } from '../comment-video-filter.mjs';
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
  item: ['[data-e2e="comment-item"]', '[class*="comment-item"]'],
  content: ['[data-e2e="comment-content"]', '[class*="comment-content"]'],
  author: ['a[href*="/user/"]', '[class*="user-name"]'],
  like: ['[data-e2e="comment-like-count"]', '[class*="like-count"]'],
  time: ['[class*="comment-time"]', '[class*="time"]'],
  scroll: ['[data-e2e="comment-list"]', '[class*="comment-list"]', '[class*="comment-container"]'],
  editor: ['[contenteditable="true"]', 'textarea'],
  replyLabels: ['回复'],
  panel: {
    icon: ['[data-e2e="comment-icon"]', '[class*="comment-icon"]'],
    labels: ['评论', '全部评论'],
  },
};

export const meta = {
  key: 'douyin',
  label: '抖音',
  needsBrowserForSearch: true,
  needsBrowserForComments: true,
  supportsManual: false,
};

function extractSearchCards() {
  const out = [];
  const seen = new Set();
  const norm = (value) => (value || '').replace(/\s+/g, ' ').trim();
  // 只取搜索结果卡片，避免滚到底后把推荐流里的视频也当成搜索结果。
  const cards = Array.from(document.querySelectorAll('div.search-result-card'));
  const pairs = cards.length
    ? cards.map((card) => ({ card, anchor: card.querySelector('a[href*="/video/"]') })).filter((item) => item.anchor)
    : Array.from(document.querySelectorAll('[data-e2e="scroll-list"] a[href*="/video/"]'))
      .map((anchor) => ({ card: anchor, anchor }));
  for (const { card, anchor } of pairs) {
    const match = anchor.href.match(/\/video\/(\d+)/);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    const text = norm(card.innerText);
    const userLink = card.querySelector('a[href*="/user/"]');
    out.push({
      id: match[1],
      url: 'https://www.douyin.com/video/' + match[1],
      text: text.slice(0, 500),
      author: userLink ? norm(userLink.innerText) : '',
      author_url: userLink ? userLink.href : '',
    });
  }
  return out;
}

function parseStat(text, label) {
  const match = String(text || '').match(new RegExp(`([\\d.]+)\\s*(万|亿|w|k)?\\s*${label}`, 'i'));
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  const base = unit === '亿' ? 1e8 : unit === '万' || unit === 'w' ? 1e4 : unit === 'k' ? 1e3 : 1;
  return Math.round(value * base);
}

function relativeFromText(text) {
  const match = String(text || '').match(/(\d+\s*(?:分钟|小时|天|周|个月)前|刚刚|昨天|前天)/);
  return match ? parseRelativeTime(match[1]) : '';
}

export async function searchVideos({ session, keyword, limit = 100, config = {} }) {
  const url = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
  await session.navigate(url, 2800);
  await assertNoRisk(session, `douyin-search-${keyword}`);

  const merged = new Map();
  const maxScrolls = Math.max(5, Math.min(20, Math.ceil(limit / 5) + 3));
  let staleScrolls = 0;
  let irrelevantStreak = 0;
  for (let i = 0; i < maxScrolls; i += 1) {
    const before = merged.size;
    const cards = await session.eval(`(${extractSearchCards.toString()})()`);
    for (const card of cards || []) {
      if (merged.has(card.id)) continue;
      if (isRelevantVideo({ title: card.text }, keyword, config)) {
        merged.set(card.id, card);
        irrelevantStreak = 0;
      } else {
        irrelevantStreak += 1;
      }
    }
    if (merged.size >= limit) break;
    staleScrolls = merged.size === before ? staleScrolls + 1 : 0;
    if (staleScrolls >= 3) break;
    if (irrelevantStreak >= 6) break;
    await scrollComments(session, ['[data-e2e="scroll-list"]', '[class*="search-result"]', '[class*="search-list"]']);
    await sleep(randomInt(1500, 2600));
  }

  return [...merged.values()].slice(0, limit).map((card) => ({
    platform: 'douyin',
    video_id: card.id,
    video_url: card.url,
    title: card.text.slice(0, 120),
    description: card.text,
    author: card.author,
    author_id: (String(card.author_url || '').match(/\/user\/([^/?]+)/) || [])[1] || '',
    author_url: card.author_url,
    published_at: relativeFromText(card.text),
    like_count: parseStat(card.text, '点赞') || parseStat(card.text, '赞'),
    comment_count: parseStat(card.text, '评论'),
    keyword,
  }));
}

export async function collectComments({ session, video, limit = 30, config = {} }) {
  await session.navigate(video.video_url, 3000);
  await assertNoRisk(session, 'douyin-video');
  await openCommentsPanel(session, selectors);

  const maxComments = limit > 0
    ? limit
    : Math.max(1, Number(config.settings && config.settings.maxCommentsPerVideo) || 1000);
  const maxScrolls = limit > 0 ? Math.max(12, Math.ceil(limit / 5) + 8) : 100;
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
    await sleep(randomInt(900, 1600));
  }

  return [...merged.values()].slice(0, maxComments).map((item) => ({
    platform: 'douyin',
    video_id: video.video_id,
    comment_id: item.item_id || 'h_' + crypto.createHash('sha1')
      .update(`douyin|${video.video_id}|${item.author}|${item.text}`)
      .digest('hex').slice(0, 16),
    parent_comment_id: '',
    root_comment_id: item.item_id || '',
    author: item.author,
    author_id: (String(item.author_url || '').match(/\/user\/([^/?]+)/) || [])[1] || '',
    author_url: item.author_url,
    text: item.text,
    thread_text: '',
    likes: item.likes,
    published_at: item.published_at,
  }));
}

export async function focusComment({ session, comment, draft }) {
  await session.navigate(comment.video_url, 3000);
  await assertNoRisk(session, 'douyin-focus');
  await openCommentsPanel(session, selectors);
  return locateAndPrefill({ session, comment, selectors, draft });
}

export { selectors };
