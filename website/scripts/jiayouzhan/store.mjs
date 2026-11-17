import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function websiteRoot() {
  return path.resolve(__dirname, '../..');
}

export function contentDir() {
  return process.env.JIAYOUZHAN_DIR ? path.resolve(process.env.JIAYOUZHAN_DIR) : path.join(websiteRoot(), 'content');
}

export function contentFiles() {
  const dir = contentDir();
  return {
    dir,
    articles: path.join(dir, 'jiayouzhan.json'),
    state: path.join(dir, 'jiayouzhan-state.json'),
  };
}

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadArticles(file = contentFiles().articles) {
  const raw = readJson(file, []);
  const items = Array.isArray(raw) ? raw : raw.articles;
  return Array.isArray(items) ? items : [];
}

export function saveArticles(articles, file = contentFiles().articles) {
  writeJsonAtomic(file, { articles });
}

export function loadState(file = contentFiles().state) {
  const state = readJson(file, {});
  return {
    usedUrls: Array.isArray(state.usedUrls) ? state.usedUrls : [],
    usedTitles: Array.isArray(state.usedTitles) ? state.usedTitles : [],
    runs: Array.isArray(state.runs) ? state.runs : [],
  };
}

export function saveState(state, file = contentFiles().state) {
  writeJsonAtomic(file, state);
}

export function normalizeTitle(title) {
  return String(title || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

function daysSince(date, today) {
  if (!date) return Infinity;
  const diff = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(diff) ? Infinity : diff / 86400000;
}

export function pickCandidates(items, { config, state = {}, articles = [], today, max = config.maxPerDay } = {}) {
  const usedUrls = new Set(state.usedUrls || []);
  const usedTitles = new Set([...(state.usedTitles || []), ...articles.map((a) => normalizeTitle(a.title))]);
  const skillKeywords = config.skillKeywords || [];
  const platformKeywords = config.platformKeywords || [];
  const practicalKeywords = config.practicalKeywords || [];
  const excludeKeywords = config.excludeKeywords || [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  const scored = [];

  for (const item of items) {
    if (!item.url || seenUrls.has(item.url)) continue;
    const titleKey = normalizeTitle(item.title);
    if (!titleKey || seenTitles.has(titleKey) || usedTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    if (usedUrls.has(item.url)) continue;
    const age = daysSince(item.date, today);
    if (age > (config.maxAgeDays ?? 10)) continue;

    const title = item.title;
    const summary = item.summary || '';
    if (excludeKeywords.some((word) => title.includes(word))) continue;

    const skillHits = skillKeywords.filter((word) => title.includes(word)).length;
    const platformHits = platformKeywords.filter((word) => title.includes(word)).length;
    const practicalHits = practicalKeywords.filter((word) => title.includes(word)).length;
    if (!skillHits && !(practicalHits && platformHits)) continue;

    let score = skillHits * 3 + platformHits * 2 + practicalHits * 2;
    for (const keyword of [...skillKeywords, ...platformKeywords]) {
      if (summary.includes(keyword)) score += 1;
    }
    if (age <= 2) score += 2;
    else if (age <= 5) score += 1;

    const tag = ['剪辑', '收音', '灯光', '封面', '选题', '拍摄'].find((name) => title.includes(name))
      || (title.includes('布光') ? '灯光' : '')
      || (title.includes('运镜') || title.includes('分镜') || title.includes('口播') ? '拍摄' : '')
      || (title.includes('运营') || title.includes('涨粉') || title.includes('账号') ? '运营' : '');
    scored.push({ ...item, score, tag, age });
    seenUrls.add(item.url);
  }

  return scored
    .sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)))
    .slice(0, max);
}

export function rememberUsed(state, articles) {
  const usedUrls = new Set(state.usedUrls);
  const usedTitles = new Set(state.usedTitles);
  for (const article of articles) {
    if (article.sourceUrl) usedUrls.add(article.sourceUrl);
    usedTitles.add(normalizeTitle(article.title));
  }
  return { ...state, usedUrls: [...usedUrls], usedTitles: [...usedTitles] };
}
