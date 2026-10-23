'use strict';

/**
 * 快手发布适配器。
 *
 * 投稿页：https://cp.kuaishou.com/article/publish/video
 * 快手网页端的正文是「作品描述」（≤500 字），标题会作为描述首行展示；
 * 封面标题在封面编辑弹层里，自动化不进入弹层，因此标题与描述合并进描述。
 */

const { runWithConfig } = require('./browser-publish');

const DESC_MAX = 500;
const TAGS_MAX = 4;

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
  const title = String(task.title || '').trim();
  const body = String(task.description || '').trim();
  const parts = [];
  if (title) parts.push(title);
  if (body) parts.push(body);
  if (line) parts.push(line);
  return { title: '', description: parts.join('\n').slice(0, DESC_MAX) };
}

const cfg = {
  platform: '快手',
  uploadUrl: 'https://cp.kuaishou.com/article/publish/video',
  cookieDomain: '.kuaishou.com',
  cookieMode: 'header',
  loginUrlRe: /passport|\/login/i,
  loginTextRe: /扫码登录|登录快手|登录后发布/,
  // 只匹配封面标题；未开封面弹层时找不到，标题已在描述里
  titleHintRe: '封面标题',
  descHintRe: '作品描述|添加描述|描述|说点什么',
  useTagInput: false,
  titleMax: 28,
  publishButtons: ['发布', '发布作品', '立即发布'],
  uploadRouteRe: /article\/publish/,
  successRe: /发布成功|提交成功|审核中|发布完成/,
  compose
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '快手', supported: true, kinds: ['video'], run };
