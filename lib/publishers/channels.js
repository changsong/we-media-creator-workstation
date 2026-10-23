'use strict';

/**
 * 视频号发布适配器。
 *
 * 投稿页：https://channels.weixin.qq.com/platform/post/create
 * 视频号没有独立的「视频标题」必填项，正文是「描述」（≤1000 字），
 * 短标题是可选字段且要求 6–16 字，超出范围时只写描述，避免被平台拦下。
 */

const { runWithConfig } = require('./browser-publish');

const DESC_MAX = 1000;
const TAGS_MAX = 6;

function tagsLine(tags, limit) {
  return (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .map((t) => '#' + t)
    .join(' ');
}

function compose(task, tags) {
  const line = tagsLine(tags, TAGS_MAX);
  const body = String(task.description || '').trim();
  const description = (body && line ? body + '\n' + line : body || line || String(task.title || '').trim()).slice(
    0,
    DESC_MAX
  );
  const rawTitle = String(task.title || '').trim();
  const title = rawTitle.length >= 6 && rawTitle.length <= 16 ? rawTitle : '';
  return { title, description };
}

const cfg = {
  platform: '视频号',
  uploadUrl: 'https://channels.weixin.qq.com/platform/post/create',
  cookieDomain: '.weixin.qq.com',
  cookieMode: 'header',
  loginUrlRe: /\/login/i,
  loginTextRe: /扫码登录|微信扫码|请使用微信/,
  titleHintRe: '短标题|标题',
  descHintRe: '描述|说点什么|简介',
  tagHintRe: '话题|标签',
  useTagInput: false,
  titleMax: 16,
  publishButtons: ['发表'],
  // 视频号会先渲染描述区，短标题框有时随后才出现
  descFirst: true,
  uploadRouteRe: /post\/create/,
  successRe: /发表成功|发布成功/,
  compose
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '视频号', supported: true, kinds: ['video'], run };
