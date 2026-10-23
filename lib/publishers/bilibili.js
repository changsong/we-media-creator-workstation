'use strict';

/**
 * B 站发布适配器。
 *
 * 投稿页：https://member.bilibili.com/platform/upload/video/frame
 * 标题与简介分开填写，标签走独立输入框；分区是必选项，
 * 这里按「连接设置 → B站 → 默认分区」的关键词做一次尽力选择（支持「知识/科学科普」这种两级写法）。
 */

const { runWithConfig, clickMatch, sleep } = require('./browser-publish');
const channelConnections = require('../channel-connections');

async function selectPartition(call, ctx) {
  const raw = channelConnections.getRaw('B站');
  const configured = String((raw && raw.fields && raw.fields['默认分区']) || '').trim();
  const keyword = configured || '知识';
  const parts = keyword.split('/').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return;

  let opened = await clickMatch(call, '请选择分区|选择分区', false);
  if (!opened) opened = await clickMatch(call, '分区', false);
  if (!opened) {
    ctx.log('未找到分区选择入口，可能账号已记住上次分区（期望：' + keyword + '）');
    return;
  }
  await sleep(700);

  let selected = '';
  for (const part of parts) {
    const hit = await clickMatch(call, part, true);
    if (hit) selected = hit;
    await sleep(650);
  }
  const confirmed = await clickMatch(call, '确定|完成|提交', false);
  if (confirmed) await sleep(500);

  if (selected && selected === parts[parts.length - 1]) {
    ctx.log('已选择分区：' + parts.join('/'));
  } else {
    ctx.log('分区未能自动选中（期望：' + keyword + '），请到「连接设置 → B站 → 默认分区」核对关键词', 'warn');
  }
}

function compose(task) {
  return {
    title: String(task.title || '').trim().slice(0, 80),
    description: String(task.description || '').trim().slice(0, 2000)
  };
}

const cfg = {
  platform: 'B站',
  uploadUrl: 'https://member.bilibili.com/platform/upload/video/frame',
  cookieDomain: '.bilibili.com',
  cookieMode: 'bilibili',
  loginUrlRe: /passport\.bilibili\.com|\/login/i,
  loginTextRe: /扫码登录|登录后投稿|请先登录/,
  titleHintRe: '标题',
  descHintRe: '简介|描述',
  tagHintRe: '标签|tag',
  useTagInput: true,
  titleMax: 80,
  publishButtons: ['立即投稿'],
  uploadRouteRe: /upload\/video/,
  successRe: /投稿成功|投递成功|投稿完成|审核中/,
  compose,
  prePublish: (call, ctx) => selectPartition(call, ctx)
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: 'B站', supported: true, kinds: ['video'], run };
