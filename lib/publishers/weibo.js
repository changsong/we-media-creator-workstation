'use strict';

/**
 * 微博发布适配器。
 *
 * 微博没有独立的投稿页，走首页顶部的发布框：先点「视频 / 图片」按钮展开上传，
 * 再把素材交给页面里的 input[type=file]，最后在发布框填写正文并点「发送」。
 * 微博正文长度上限约 2000 字，话题以 #tag# 形式随正文写入；
 * 视频作品会多出一个「标题」输入框（≥6 字），图文作品没有标题，标题并入正文首行。
 */

const { runWithConfig, evalJs, sleep } = require('./browser-publish');

const DESC_MAX = 2000;
const TAGS_MAX = 6;

function tagsLine(tags, limit) {
  return (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .map((t) => '#' + t + '#')
    .join(' ');
}

function compose(task, tags, kind) {
  const line = tagsLine(tags, TAGS_MAX);
  const title = String(task.title || '').trim();
  const body = String(task.description || '').trim();
  if (kind === 'image') {
    const parts = [title, body, line].filter(Boolean);
    return { title: '', description: parts.join('\n').slice(0, DESC_MAX) };
  }
  return {
    title: title.slice(0, 30),
    description: [body, line].filter(Boolean).join('\n').slice(0, DESC_MAX)
  };
}

/** 首页已有文件输入时不再点击，避免弹出系统文件选择框 */
async function openComposerEntry(call, ctx, kind) {
  const existing = await evalJs(
    call,
    `document.querySelectorAll('input[type=file]').length`
  ).catch(() => 0);
  if (existing > 0) {
    ctx.log('页面已存在上传控件，跳过点击发布入口');
    return;
  }

  const labels = kind === 'image' ? ['图片', '相册', '上传图片'] : ['视频', '上传视频'];
  const clicked = await evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const area = (el) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
      };
      const labels = ${JSON.stringify(labels)};
      const nodes = Array.from(document.querySelectorAll('[title], [aria-label], a, span, li, button'));
      const items = nodes
        .filter(visible)
        .map((el) => ({
          el,
          label: (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim(),
          text: (el.innerText || '').trim()
        }));
      // 优先取带 title/aria-label 的工具栏按钮，避免点到左侧导航
      const byTitle = items.filter((it) => labels.indexOf(it.label) >= 0)
        .sort((a, b) => area(a.el) - area(b.el))[0];
      const topArea = (el) => el.getBoundingClientRect().top < 620;
      const byText = items
        .filter((it) => it.text && labels.indexOf(it.text) >= 0 && topArea(it.el))
        .sort((a, b) => area(a.el) - area(b.el))[0];
      const hit = byTitle || byText;
      if (!hit) return '';
      hit.el.click();
      return hit.label || hit.text;
    })()`
  ).catch(() => '');

  if (clicked) {
    ctx.log('已点击发布入口：' + clicked);
    await sleep(1500);
  } else {
    ctx.log('未找到「' + (kind === 'image' ? '图片' : '视频') + '」发布入口，尝试直接使用页面上传控件', 'warn');
  }
}

const cfg = {
  platform: '微博',
  uploadUrl: 'https://weibo.com/',
  cookieDomain: '.weibo.com',
  cookieMode: 'header',
  loginUrlRe: /passport\.weibo|\/signin|\/login/i,
  loginTextRe: /登录微博|扫码登录|立即登录/,
  kinds: ['video', 'image'],
  maxImages: 18,
  titleHintRe: '标题',
  descHintRe: '新鲜事|说点什么|分享|正文|内容',
  useTagInput: false,
  titleMax: 30,
  descFirst: true,
  publishButtons: ['发送', '发布'],
  successRe: /发布成功|发送成功|已发布|审核中/,
  preparePage: openComposerEntry,
  compose
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '微博', supported: true, kinds: ['video', 'image'], run };
