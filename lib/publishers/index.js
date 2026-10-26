'use strict';

const douyin = require('./douyin');
const channels = require('./channels');
const kuaishou = require('./kuaishou');
const bilibili = require('./bilibili');
const weibo = require('./weibo');
const xiaohongshu = require('./xiaohongshu');
const zhihu = require('./zhihu');
const wechatMp = require('./wechat-mp');
const mock = require('./mock');

const ADAPTERS = {
  抖音: douyin,
  视频号: channels,
  快手: kuaishou,
  B站: bilibili,
  微博: weibo,
  小红书: xiaohongshu,
  知乎: zhihu,
  公众号: wechatMp
};

// 各平台实际支持的素材类型；未列出的类型会被 create/autoEnqueue 直接拒绝
const KINDS = {
  抖音: ['video', 'image'],
  视频号: ['video'],
  快手: ['video'],
  B站: ['video'],
  微博: ['video', 'image'],
  小红书: ['video', 'image'],
  知乎: ['video'],
  公众号: ['image', 'video']
};

function get(platform) {
  if (process.env.WB_PUBLISH_MOCK === '1') return mock;
  return ADAPTERS[platform] || null;
}

function supported(platform) {
  return !!get(platform);
}

function supportsKind(platform, kind) {
  if (process.env.WB_PUBLISH_MOCK === '1') return true;
  const kinds = KINDS[platform];
  return !!kinds && kinds.indexOf(kind) >= 0;
}

function list() {
  return Object.keys(ADAPTERS).map((platform) => ({
    platform,
    supported: true,
    mode: 'browser',
    kinds: (KINDS[platform] || []).slice()
  }));
}

module.exports = { get, supported, supportsKind, list };
