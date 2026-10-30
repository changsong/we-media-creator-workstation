'use strict';

/** 把「1.2万 / 3.4w / 1亿 / 12,345」统一转成整数 */
function parseCount(value) {
  if (typeof value === 'number') return Math.max(0, Math.round(value));
  const text = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!text) return 0;
  const m = text.match(/^([\d.]+)\s*([万wW亿]?)/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (isNaN(n)) return 0;
  const unit = m[2];
  if (unit === '万' || unit === 'w' || unit === 'W') n *= 10000;
  else if (unit === '亿') n *= 100000000;
  return Math.max(0, Math.round(n));
}

function stripHtml(text) {
  return String(text == null ? '' : text)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isoFromSeconds(sec) {
  const n = Number(sec);
  if (!n) return '';
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  items.forEach((it) => {
    if (!it || !it.workId) return;
    const key = it.platform + ':' + it.workId;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  });
  return out;
}

/** 互动量加权：评论/分享/收藏比单纯点赞更能说明内容被讨论和收藏的程度 */
function engagementOf(item) {
  return (
    (Number(item.likes) || 0) +
    (Number(item.comments) || 0) * 2 +
    (Number(item.shares) || 0) * 3 +
    (Number(item.collects) || 0) * 2
  );
}

function percentileRanks(values) {
  const n = values.length;
  if (!n) return [];
  const order = values
    .map((v, i) => ({ v: Number(v) || 0, i }))
    .sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1].v === order[i].v) j++;
    const rank = n === 1 ? 100 : ((i + j) / 2 / (n - 1)) * 100;
    for (let k = i; k <= j; k++) ranks[order[k].i] = rank;
    i = j + 1;
  }
  return ranks;
}

function recencyScore(publishedAt, now) {
  if (!publishedAt) return 50;
  const t = new Date(publishedAt).getTime();
  if (isNaN(t)) return 50;
  const days = Math.max(0, (now - t) / 86400000);
  if (days <= 3) return 100;
  if (days >= 60) return 0;
  return Math.max(0, 100 * (1 - (days - 3) / 57));
}

/**
 * 热度 0-100：同一平台、同一关键词的结果集内做分位排名，
 * 互动 60% + 阅读/播放 30% + 新鲜度 10%；没有阅读数时把阅读权重并入互动。
 */
function heatScores(items, nowMs) {
  const engagement = items.map(engagementOf);
  const reads = items.map((it) => Number(it.reads) || 0);
  const recency = items.map((it) => recencyScore(it.publishedAt, nowMs));
  const pe = percentileRanks(engagement);
  const pr = percentileRanks(reads);
  const hasReads = reads.some((v) => v > 0);
  return items.map((it, i) => {
    const score = hasReads ? 0.6 * pe[i] + 0.3 * pr[i] + 0.1 * recency[i] : 0.86 * pe[i] + 0.14 * recency[i];
    return Math.round(Math.min(100, Math.max(1, score)) * 10) / 10;
  });
}

function normalizeKeywords(input) {
  const raw = Array.isArray(input) ? input : String(input == null ? '' : input).split(/[\s,，、;；]+/);
  const out = [];
  raw.forEach((k) => {
    const s = String(k == null ? '' : k).trim().slice(0, 30);
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out.slice(0, 5);
}

module.exports = {
  parseCount,
  stripHtml,
  isoFromSeconds,
  dedupe,
  heatScores,
  normalizeKeywords
};
