'use strict';

/** 演示 / 测试用适配器：不联网，按关键词与平台生成稳定的模拟爆款数据 */

const PLATFORMS = ['小红书', '抖音', 'B站'];

const TITLES = [
  '{kw}：3 个反常识用法，第 2 个直接省下 2 小时',
  '我用 {kw} 做了 7 天实验，结果和想象完全相反',
  '别再用错 {kw}：90% 的人第一步就走偏了',
  '{kw} 从 0 到 1：我把完整流程整理成 5 张图',
  '{kw} 真正的门槛不是工具，而是这一步',
  '一条 {kw} 视频涨粉 800，我复盘出 4 个细节',
  '{kw} 模板直接抄：3 套排版 + 5 条标题',
  '为什么你的 {kw} 没人看？问题出在开头 3 秒'
];

const AUTHORS = ['阿May的成长笔记', '内容实验室', '小林做内容', '运营小酒馆', '周末研究所', '一只剪辑猫'];

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function searchUrl(platform, keyword) {
  const kw = encodeURIComponent(keyword);
  if (platform === '小红书') return `https://www.xiaohongshu.com/search_result?keyword=${kw}`;
  if (platform === '抖音') return `https://www.douyin.com/search/${kw}`;
  return `https://search.bilibili.com/all?keyword=${kw}`;
}

async function search(keyword, ctx) {
  const platform = (ctx && ctx.platform) || '小红书';
  const rand = rng(hash(platform + '|' + keyword));
  const now = Date.now();
  const count = 8;
  const items = [];
  for (let i = 0; i < count; i++) {
    const likes = Math.round(200 + rand() * 78000);
    const comments = Math.round(likes * (0.04 + rand() * 0.16));
    const collects = Math.round(likes * (0.15 + rand() * 0.7));
    const shares = Math.round(likes * (0.02 + rand() * 0.15));
    const reads = Math.round(likes * (4 + rand() * 16));
    const daysAgo = Math.round(rand() * 45);
    const title = TITLES[i % TITLES.length].replace(/\{kw\}/g, keyword);
    items.push({
      workId: 'mock-' + hash(platform + keyword + i).toString(36),
      title,
      author: AUTHORS[Math.floor(rand() * AUTHORS.length)],
      coverUrl: '',
      itemUrl: searchUrl(platform, keyword),
      itemType: platform === '小红书' ? (i % 3 === 0 ? 'video' : 'note') : 'video',
      likes,
      comments,
      shares,
      collects,
      reads: platform === '小红书' ? 0 : reads,
      publishedAt: new Date(now - daysAgo * 86400000).toISOString()
    });
  }
  return items;
}

module.exports = {
  platform: 'mock',
  platforms: PLATFORMS,
  requiresLogin: false,
  available: () => true,
  search
};
