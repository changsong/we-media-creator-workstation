import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';

export const NICHES_FILE = path.join(ROOT, 'outreach', 'niches.json');

export function loadNiches() {
  try {
    const json = JSON.parse(fs.readFileSync(NICHES_FILE, 'utf8'));
    return Array.isArray(json.domains) ? json.domains : [];
  } catch (err) {
    console.warn('读取领域清单失败：' + err.message);
    return [];
  }
}

// 返回 { domain, keyword } 目标列表：用 keyword 搜索，名单的 niche 记为 domain。
export function nicheTargets(platform) {
  const seen = new Set();
  const targets = [];
  for (const item of loadNiches()) {
    const map = item.keywords || {};
    const keyword = String(map[platform] || map.default || item.domain || '').trim();
    if (!keyword) continue;
    const domain = String(item.domain || keyword).trim();
    const key = domain + '|' + keyword;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ domain, keyword });
  }
  return targets;
}
