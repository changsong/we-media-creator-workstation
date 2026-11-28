import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './util.mjs';

export const COMMENTS_CONFIG_FILE = path.join(ROOT, 'outreach', 'comments.json');

export function loadCommentsConfig(file = process.env.MARKETING_COMMENTS_CONFIG || COMMENTS_CONFIG_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function scoreComment(text, config) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = raw.toLowerCase();
  const hits = [];
  let score = 0;
  let best = { key: '', label: '', weight: 0 };

  for (const [key, group] of Object.entries(config.intent || {})) {
    const matched = (group.keywords || []).filter((word) =>
      lower.includes(String(word).toLowerCase())
    );
    if (!matched.length) continue;
    const groupScore = (Number(group.weight) || 1) * Math.min(matched.length, 3);
    score += groupScore;
    hits.push(...matched);
    if (groupScore > best.weight) {
      best = { key, label: group.label || key, weight: groupScore };
    }
  }

  const negative = (config.negative || [])
    .find((word) => lower.includes(String(word).toLowerCase())) || '';
  const questionBonus = /[?？]/.test(raw) ? 1 : 0;
  score += questionBonus;

  const minScore = Number(config.settings && config.settings.minScore) || 2;
  return {
    text: raw,
    score,
    intent: best.key,
    intentLabel: best.label,
    hits: [...new Set(hits)],
    negative,
    eligible: !negative && score >= minScore,
    minScore,
  };
}

export function isBlockedAuthor(author, config) {
  const name = String(author || '').toLowerCase();
  if (!name) return false;
  return (config.blockedAuthors || []).some((word) =>
    name.includes(String(word).toLowerCase())
  );
}

export function ageDays(isoText) {
  if (!isoText) return null;
  const time = Date.parse(isoText);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / (24 * 60 * 60 * 1000));
}
