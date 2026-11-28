import { normalizePlatform } from '../util.mjs';
import * as bilibili from './bilibili-comments.mjs';
import * as douyin from './douyin-comments.mjs';
import * as kuaishou from './kuaishou-comments.mjs';
import * as xiaohongshu from './xiaohongshu-comments.mjs';
import * as channels from './channels-comments.mjs';

export const PLATFORMS = {
  douyin,
  kuaishou,
  xiaohongshu,
  bilibili,
  channels,
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS);

export function getPlatform(key) {
  const normalized = normalizePlatform(key) || String(key || '').trim();
  return PLATFORMS[normalized] || null;
}

export function platformMetas() {
  return Object.values(PLATFORMS).map((adapter) => adapter.meta);
}

export function autoPlatforms() {
  return platformMetas().filter((meta) => !meta.supportsManual);
}
