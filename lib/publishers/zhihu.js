'use strict';

/**
 * 知乎发布适配器（视频）。
 *
 * 投稿页：https://www.zhihu.com/creator/video-upload
 * 标题 ≥5 字、≤50 字；视频必须选择「领域」（分区）后才能发布，
 * 这里按「连接设置 → 知乎 → 默认领域」的关键词做一次尽力选择，默认「知识」。
 */

const { runWithConfig, clickMatch, sleep } = require('./browser-publish');
const channelConnections = require('../channel-connections');

async function selectTopic(call, ctx) {
  const raw = channelConnections.getRaw('知乎');
  const keyword = String((raw && raw.fields && raw.fields['默认领域']) || '').trim() || '知识';

  const opened = await clickMatch(call, '选择领域|所属领域|领域|分类', false);
  if (!opened) {
    ctx.log('未找到领域选择入口，可能账号已记住上次领域（期望：' + keyword + '）');
    return;
  }
  await sleep(700);

  const hit = (await clickMatch(call, keyword, true)) || (await clickMatch(call, keyword, false));
  if (!hit) {
    ctx.log('领域未能自动选中（期望：' + keyword + '），请到「连接设置 → 知乎 → 默认领域」核对关键词', 'warn');
    return;
  }
  await sleep(600);
  const confirmed = await clickMatch(call, '确定|完成|保存', false);
  if (confirmed) await sleep(400);
  ctx.log('已选择领域：' + hit);
}

function compose(task, tags) {
  const line = (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => '#' + t)
    .join(' ');
  const body = String(task.description || '').trim();
  return {
    title: String(task.title || '').trim().slice(0, 50),
    description: [body, line].filter(Boolean).join('\n').slice(0, 2000)
  };
}

const cfg = {
  platform: '知乎',
  uploadUrl: 'https://www.zhihu.com/creator/video-upload',
  cookieDomain: '.zhihu.com',
  cookieMode: 'header',
  loginUrlRe: /signin|\/login/i,
  loginTextRe: /扫码登录|登录知乎|密码登录|验证码登录/,
  kinds: ['video'],
  titleHintRe: '标题',
  descHintRe: '描述|简介|正文|视频简介|添加描述',
  useTagInput: false,
  titleMax: 50,
  publishButtons: ['发布', '发布视频'],
  uploadRouteRe: /video-upload/,
  successRe: /发布成功|已发布|审核中|提交成功/,
  compose,
  prePublish: selectTopic
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '知乎', supported: true, kinds: ['video'], run };
