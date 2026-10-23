'use strict';

/**
 * 小红书发布适配器。
 *
 * 投稿页：https://creator.xiaohongshu.com/publish/publish（视频）
 *        ?from=menu_left&target=image（图文）
 * 标题 ≤20 字；正文是 tiptap 富文本，话题以 #tag 形式随正文写入。
 * 发布按钮封装在 closed shadow DOM（<xhs-publish-btn>）里，内核通过宿主元素的
 * shadowRoot/_sr 取到按钮，因此这里需要声明 shadowHosts。
 */

const { runWithConfig, clickMatch, sleep } = require('./browser-publish');

const TITLE_MAX = 20;
const DESC_MAX = 1000;
const TAGS_MAX = 10;

function tagsLine(tags, limit) {
  return (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .map((t) => '#' + t)
    .join(' ');
}

function compose(task, tags, kind) {
  const line = tagsLine(tags, TAGS_MAX);
  const title = String(task.title || '').trim().slice(0, kind === 'image' ? TITLE_MAX : 80);
  const body = String(task.description || '').trim();
  const desc = [body, line].filter(Boolean).join('\n');
  return { title, description: desc.slice(0, DESC_MAX) };
}

async function chooseTab(call, ctx, kind) {
  // 视频投稿页默认就是「上传视频」，不再点击，避免误触导航；
  // 图文必须确认切到「上传图文」页签，否则图片会被交给视频控件。
  if (kind !== 'image') return;
  const hit = await clickMatch(call, '上传图文|图文', false);
  if (hit) {
    ctx.log('已切换到「' + hit + '」发布页签');
    await sleep(900);
  }
}

const cfg = {
  platform: '小红书',
  uploadUrls: {
    video: 'https://creator.xiaohongshu.com/publish/publish',
    image: 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image'
  },
  cookieDomain: '.xiaohongshu.com',
  cookieMode: 'header',
  loginUrlRe: /\/login/i,
  loginTextRe: /扫码登录|登录小红书|手机号登录|密码登录/,
  kinds: ['video', 'image'],
  maxImages: 18,
  titleHintRe: '标题',
  descHintRe: '正文|描述|输入正文|添加正文',
  useTagInput: false,
  titleMax: TITLE_MAX,
  descFirst: true,
  shadowHosts: ['xhs-publish-btn'],
  publishButtons: ['发布', '发布笔记'],
  uploadRouteRe: /publish\/publish/,
  successRe: /发布成功|已发布|审核中|发布完成/,
  preparePage: chooseTab,
  compose
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '小红书', supported: true, kinds: ['video', 'image'], run };
