import path from 'node:path';
import { DATA_DIR, ensureDir, sleep, todayKey } from './util.mjs';

export const RISK_PATTERNS = [
  '安全验证',
  '人机验证',
  '操作频繁',
  '请稍后再试',
  '访问异常',
  '账号存在异常',
  '网络繁忙',
  '验证码',
  '点击两个形状相同的物体',
  '形状相同',
  '请完成验证',
  '拖动滑块',
  '滑块验证',
  '完成验证后继续',
];

export function parseCount(text) {
  const raw = String(text || '').replace(/,/g, '').trim();
  const match = raw.match(/([\d.]+)\s*(万|亿|w|k)?/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = (match[2] || '').toLowerCase();
  if (unit === '亿') return Math.round(value * 100000000);
  if (unit === '万' || unit === 'w') return Math.round(value * 10000);
  if (unit === 'k') return Math.round(value * 1000);
  return Math.round(value);
}

export function parseRelativeTime(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const now = Date.now();
  const minutes = (n) => new Date(now - n * 60 * 1000).toISOString();
  const days = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
  if (/刚刚/.test(raw)) return new Date(now).toISOString();
  let m = raw.match(/(\d+)\s*分钟前/);
  if (m) return minutes(Number(m[1]));
  m = raw.match(/(\d+)\s*小时前/);
  if (m) return minutes(Number(m[1]) * 60);
  m = raw.match(/(\d+)\s*天前/);
  if (m) return days(Number(m[1]));
  m = raw.match(/(\d+)\s*周前/);
  if (m) return days(Number(m[1]) * 7);
  m = raw.match(/(\d+)\s*个月前/);
  if (m) return days(Number(m[1]) * 30);
  if (/昨天/.test(raw)) return days(1);
  if (/前天/.test(raw)) return days(2);
  const date = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (date) {
    const iso = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).toISOString();
    return Number.isFinite(Date.parse(iso)) ? iso : '';
  }
  return '';
}

export async function assertNoRisk(session, label) {
  const text = await session.text(16000);
  const hit = RISK_PATTERNS.find((token) => text.includes(token));
  if (!hit) return;
  ensureDir(path.join(DATA_DIR, 'screenshots'));
  const file = path.join(DATA_DIR, 'screenshots', `comment-${label}-${todayKey()}.png`);
  await session.screenshot(file).catch(() => {});
  const err = new Error(`触发平台验证提示「${hit}」，已停止。截图：${file}`);
  err.code = 'RISK';
  throw err;
}

async function clickAt(session, point) {
  if (!point) return false;
  await session.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await session.cdp('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await session.cdp('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  });
  await sleep(700);
  return true;
}

export async function clickByText(session, texts, scopeSelector = '') {
  const labels = JSON.stringify(texts);
  const scope = JSON.stringify(scopeSelector);
  const point = await session.eval(`(() => {
    const labels = ${labels};
    const root = ${scope} ? document.querySelector(${scope}) : document;
    if (!root) return null;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    const nodes = Array.from(root.querySelectorAll('button, [role="button"], a, span, div'));
    const hits = nodes.filter((el) => {
      const text = (el.textContent || '').trim();
      return labels.includes(text) && visible(el);
    });
    if (!hits.length) return null;
    let target = hits.find((el) => el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') || hits[0];
    let node = target;
    for (let i = 0; i < 4 && node; i += 1) {
      if (node.tagName === 'BUTTON' || node.tagName === 'A' || (node.getAttribute && node.getAttribute('role') === 'button')) {
        target = node;
        break;
      }
      node = node.parentElement;
    }
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const r = target.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  return clickAt(session, point);
}

export async function clickSelectors(session, selectors) {
  const point = await session.eval(`(() => {
    const sels = ${JSON.stringify(selectors)};
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    };
    for (const sel of sels) {
      const el = Array.from(document.querySelectorAll(sel)).filter(visible)[0];
      if (!el) continue;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }
    return null;
  })()`);
  return clickAt(session, point);
}

export async function scrollComments(session, selectors) {
  return session.eval(`(() => {
    const sels = ${JSON.stringify(selectors || [])};
    const candidates = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) candidates.push(el);
    }
    if (!candidates.length) {
      for (const el of document.querySelectorAll('div')) {
        if (el.scrollHeight > el.clientHeight + 200 && el.clientHeight > 200) candidates.push(el);
      }
    }
    let moved = false;
    for (const el of candidates.slice(0, 4)) {
      if (el.scrollHeight > el.clientHeight + 40) {
        el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + Math.max(320, el.clientHeight * 0.85));
        moved = true;
      }
    }
    if (!moved) {
      window.scrollBy(0, 600);
      moved = true;
    }
    return moved;
  })()`);
}

export async function extractComments(session, selectors, limit = 30) {
  const raw = await session.eval(`(() => {
    const selectors = ${JSON.stringify(selectors)};
    const norm = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const pickText = (el, sels) => {
      for (const sel of sels || []) {
        const node = el.querySelector(sel);
        if (node) {
          const text = norm(node.innerText || node.textContent);
          if (text) return text;
        }
      }
      return '';
    };
    const items = [];
    const seenItems = new Set();
    for (const sel of selectors.item || []) {
      for (const el of document.querySelectorAll(sel)) {
        if (seenItems.has(el)) continue;
        seenItems.add(el);
        items.push(el);
      }
    }
    if (!items.length) {
      const linkSelectors = ['a[href*="/user/"]', 'a[href*="/profile/"]', 'a[href*="/explore/"]', 'a[href*="space.bilibili.com"]'];
      for (const el of document.querySelectorAll('[class*="comment"]')) {
        if (linkSelectors.some((sel) => el.querySelector(sel))) items.push(el);
      }
    }
    // [class*="comment-item"] 会匹配 comment-item-avatar 等嵌套节点，只保留最外层评论。
    const topItems = items.filter((el) => !items.some((other) => other !== el && other.contains(el)));
    const out = [];
    const seenText = new Set();
    const timeRe = /(\\d+\\s*(?:分钟|小时|天|周|个月)前|刚刚|昨天|前天)/;
    for (const item of topItems) {
      let text = pickText(item, selectors.content || []);
      const authorLink = item.querySelector('a[href*="/user/"], a[href*="/profile/"], a[href*="/explore/"], a[href*="space.bilibili.com"]');
      if (!text) {
        // 平台改版或没有 content 选择器时，用最长文本块兜底，排除作者、时间、点赞、分享/回复等 UI。
        const candidates = Array.from(item.querySelectorAll('div, span, p'))
          .filter((el) => el !== item)
          .map((el) => ({ el, value: norm(el.innerText || el.textContent) }))
          .filter(({ el, value }) => value.length >= 2
            && !/^\\d+$/.test(value)
            && value !== '...'
            && !value.includes('分享')
            && !value.includes('回复')
            && !timeRe.test(value)
            && !(authorLink && el.contains(authorLink)))
          .sort((a, b) => b.value.length - a.value.length);
        text = candidates.length ? candidates[0].value : '';
      }
      if (!text || text.length < 2) continue;
      const key = text.slice(0, 120);
      if (seenText.has(key)) continue;
      seenText.add(key);
      const authorNode = (selectors.author || []).map((sel) => item.querySelector(sel)).find(Boolean) || null;
      const itemText = String(item.innerText || '').trim();
      const timeMatch = itemText.match(timeRe);
      const timeText = pickText(item, selectors.time || [])
        || (timeMatch ? itemText.slice(timeMatch.index, timeMatch.index + 40).split('\\n')[0].trim() : '');
      let likeText = pickText(item, selectors.like || []);
      if (!likeText) {
        const lines = itemText.split(/\\n+/).map((line) => line.trim()).filter(Boolean);
        const timeIdx = lines.findIndex((line) => timeRe.test(line));
        const after = timeIdx >= 0 ? lines.slice(timeIdx + 1) : lines;
        likeText = after.find((line) => /^\\d+$/.test(line)) || '';
      }
      const itemId = item.getAttribute('data-id') || item.getAttribute('data-comment-id') || item.getAttribute('id') || '';
      const authorName = norm(authorNode && (authorNode.innerText || authorNode.textContent))
        || norm(authorLink && (authorLink.getAttribute('aria-label') || authorLink.getAttribute('title')
          || (authorLink.querySelector('img') && authorLink.querySelector('img').alt)))
        || '';
      out.push({
        text: text.slice(0, 600),
        author: authorName,
        author_url: (authorLink && authorLink.href) || '',
        likes_text: likeText,
        time_text: timeText,
        item_id: itemId,
      });
      if (out.length >= ${Number(limit) || 30}) break;
    }
    return out;
  })()`);
  return (raw || []).map((item) => ({
    text: item.text,
    author: item.author,
    author_url: item.author_url,
    likes: parseCount(item.likes_text),
    published_at: parseRelativeTime(item.time_text),
    item_id: item.item_id,
  }));
}

async function markComment(session, text, itemSelectors) {
  if (!String(text || '').trim()) return false;
  return session.eval(`(() => {
    const target = ${JSON.stringify(String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40))};
    const norm = (value) => (value || '').replace(/\\s+/g, ' ').trim();
    const items = [];
    const seen = new Set();
    for (const sel of ${JSON.stringify(itemSelectors || [])}) {
      for (const el of document.querySelectorAll(sel)) {
        if (seen.has(el)) continue;
        seen.add(el);
        items.push(el);
      }
    }
    const hit = items.find((el) => norm(el.innerText || el.textContent).includes(target));
    if (!hit) return false;
    for (const el of document.querySelectorAll('[data-comment-radar-target]')) {
      el.removeAttribute('data-comment-radar-target');
    }
    hit.setAttribute('data-comment-radar-target', '1');
    hit.scrollIntoView({ block: 'center' });
    return true;
  })()`);
}

async function insertEditorText(session, text, editorSelectors) {
  const focused = await session.eval(`(() => {
    const sels = ${JSON.stringify(editorSelectors || ['[contenteditable="true"]', 'textarea'])};
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 20 && r.height > 10;
    };
    for (const sel of sels) {
      const nodes = Array.from(document.querySelectorAll(sel)).filter(visible);
      if (!nodes.length) continue;
      const el = nodes[nodes.length - 1];
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.select();
      } else {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return true;
    }
    return false;
  })()`);
  if (!focused) return false;

  await session.cdp('Input.insertText', { text });
  await sleep(500);

  let ok = await session.eval(`(() => {
    const sels = ${JSON.stringify(editorSelectors || ['[contenteditable="true"]', 'textarea'])};
    const probe = ${JSON.stringify(String(text || '').slice(0, 8))};
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        const value = (el.value || el.innerText || el.textContent || '').trim();
        if (value.includes(probe)) return true;
      }
    }
    return false;
  })()`);

  if (!ok) {
    ok = await session.eval(`(() => {
      const el = document.activeElement;
      if (!el) return false;
      if (el.isContentEditable) {
        document.execCommand('insertText', false, ${JSON.stringify(String(text || ''))});
        return true;
      }
      return false;
    })()`);
    await sleep(400);
  }
  return !!ok;
}

export async function openCommentsPanel(session, selectors = {}) {
  const panel = selectors.panel || selectors;
  const itemSelectors = selectors.item || panel.item || [];
  const alreadyOpen = itemSelectors.length
    ? await session.eval(`(() => {
        for (const sel of ${JSON.stringify(itemSelectors)}) {
          if (document.querySelector(sel)) return true;
        }
        return false;
      })()`)
    : false;
  if (alreadyOpen) return true;

  if (panel.icon && panel.icon.length) {
    const clicked = await clickSelectors(session, panel.icon);
    if (clicked) {
      await sleep(1200);
      return true;
    }
  }
  const clicked = await clickByText(session, panel.labels || ['评论', '全部评论', '条评论']);
  if (clicked) {
    await sleep(1200);
    return true;
  }
  return false;
}

export async function locateAndPrefill({ session, comment, selectors, draft }) {
  const itemSelectors = selectors.item || [];
  let marked = false;
  for (let i = 0; i < 10 && !marked; i += 1) {
    marked = await markComment(session, comment.text, itemSelectors);
    if (marked) break;
    await scrollComments(session, selectors.scroll || []);
    await sleep(900 + i * 120);
  }
  if (!marked) {
    return { opened: false, prefilled: false, reason: '没有在当前评论区找到这条评论，可能被折叠或已删除' };
  }

  const clicked = await clickByText(session, selectors.replyLabels || ['回复'], '[data-comment-radar-target="1"]');
  if (!clicked) {
    return { opened: false, prefilled: false, reason: '找到了评论，但没找到「回复」按钮' };
  }
  await sleep(700);

  const prefilled = await insertEditorText(session, draft, selectors.editor || []);
  return {
    opened: true,
    prefilled,
    reason: prefilled ? '' : '回复框已打开，但自动填入失败，请手动粘贴',
  };
}
