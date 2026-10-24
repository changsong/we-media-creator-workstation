'use strict';

/**
 * 知乎发布适配器（视频）。
 *
 * 投稿页：https://www.zhihu.com/creator/video-upload
 * 「视频标记」是必填项（弹窗确认），「所属领域」可选；
 * 发布前按「连接设置 → 知乎 → 默认领域」的关键词选择领域，默认「科技互联网」。
 */

const { runWithConfig, evalJs, sleep } = require('./browser-publish');
const channelConnections = require('../channel-connections');

const DEFAULT_DOMAIN = '科技互联网';
const FALLBACK_DOMAIN = '其他';
const DEFAULT_MARK = '内容无需标注';

async function mouseClick(call, rect) {
  const x = Math.round(rect[0] + rect[2] / 2);
  const y = Math.round(rect[1] + rect[3] / 2);
  try { await call('Page.bringToFront', {}); } catch (err) { /* 无窗口可聚焦时继续 */ }
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

function itemExpr(title, extra) {
  return `(() => {
    const item = Array.from(document.querySelectorAll('.VideoUploadForm-item')).find((el) => {
      const t = el.querySelector('.VideoUploadForm-itemTitle');
      return t && String(t.innerText || '').replace(/\\s+/g, '') === ${JSON.stringify(title)};
    });
    if (!item) return null;
    ${extra || ''}
  })()`;
}

async function itemState(call, title) {
  return evalJs(call, itemExpr(title, `
    const btn = item.querySelector('button[aria-haspopup="true"]');
    const r = btn && btn.getBoundingClientRect();
    return {
      text: String(item.innerText || '').replace(/\\s+/g, ' ').trim(),
      rect: r && r.width > 0 ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null
    };
  `));
}

async function waitFor(call, expr, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < (timeoutMs || 4000)) {
    const value = await evalJs(call, expr).catch(() => null);
    if (value) return value;
    await sleep(250);
  }
  return null;
}

/** 视频标记为必填项：未选择时打开弹窗，选中标记后点「确认」。 */
async function ensureVideoMark(call, ctx) {
  const raw = channelConnections.getRaw('知乎');
  const wanted = String((raw && raw.fields && raw.fields['视频标记']) || '').trim() || DEFAULT_MARK;

  const state = await itemState(call, '视频标记');
  if (!state) {
    ctx.log('未找到「视频标记」控件，跳过', 'warn');
    return false;
  }
  if (state.text.indexOf('选择标记') < 0) {
    ctx.log('知乎视频标记：已为「' + state.text.replace(/^.*视频标记\s*/, '') + '」');
    return true;
  }
  if (!state.rect) {
    ctx.log('「视频标记」控件不可见，跳过', 'warn');
    return false;
  }

  await mouseClick(call, state.rect);
  const modalReady = await waitFor(call, `!!document.querySelector('.VideoUploadForm-videoTypeModal')`, 4000);
  if (!modalReady) {
    ctx.log('视频标记弹窗未打开，跳过', 'warn');
    return false;
  }
  await sleep(300);

  const option = await evalJs(call, `(() => {
    const opts = Array.from(document.querySelectorAll('.VideoUploadForm-videoTypeModalOption'));
    const hit = opts.find((el) => String(el.innerText || '').trim() === ${JSON.stringify(wanted)})
      || opts.find((el) => el.querySelector('.ZDI--CheckFill24'))
      || opts[0];
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { text: String(hit.innerText || '').trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  })()`);
  if (option && option.rect) await mouseClick(call, option.rect);
  await sleep(400);

  const confirm = await evalJs(call, `(() => {
    const modal = document.querySelector('.VideoUploadForm-videoTypeModal');
    if (!modal) return null;
    const btn = Array.from(modal.querySelectorAll('button')).find((el) => String(el.innerText || '').trim() === '确认');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  })()`);
  if (!confirm) {
    ctx.log('视频标记弹窗未找到「确认」按钮', 'warn');
    return false;
  }
  await mouseClick(call, confirm);

  const ok = await waitFor(call, itemExpr('视频标记', `return String(item.innerText || '').indexOf('选择标记') < 0;`), 4000);
  if (!ok) {
    ctx.log('视频标记未能确认，请查看截图', 'warn');
    return false;
  }
  ctx.log('知乎视频标记：已选择「' + (option ? option.text : wanted) + '」');
  return true;
}

/** 原创视频是必填勾选项，未勾选时补上。 */
async function ensureOriginal(call, ctx) {
  const state = await evalJs(call, itemExpr('原创视频', `
    const input = item.querySelector('input[type=checkbox]');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    return { checked: !!input.checked, rect: r.width > 0 ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null };
  `));
  if (!state) return;
  if (state.checked) return;
  if (state.rect) await mouseClick(call, state.rect);
  else await evalJs(call, itemExpr('原创视频', `const i = item.querySelector('input[type=checkbox]'); if (i) i.click();`));
  await sleep(400);
  const checked = await evalJs(call, itemExpr('原创视频', `const i = item.querySelector('input[type=checkbox]'); return !!(i && i.checked);`));
  if (checked) ctx.log('知乎原创视频：已勾选');
  else ctx.log('知乎原创视频未能勾选，请查看截图', 'warn');
}

/** 所属领域：按「默认领域」关键词选择；已选过则保留。 */
async function selectTopic(call, ctx) {
  const raw = channelConnections.getRaw('知乎');
  const keyword = String((raw && raw.fields && raw.fields['默认领域']) || '').trim() || DEFAULT_DOMAIN;

  const state = await itemState(call, '所属领域');
  if (!state) {
    ctx.log('未找到「所属领域」控件，跳过', 'warn');
    return false;
  }
  const current = state.text.replace(/^所属领域\s*/, '');
  if (current && current.indexOf('选择领域') < 0) {
    ctx.log('知乎领域：已为「' + current + '」');
    return true;
  }
  if (!state.rect) {
    ctx.log('「所属领域」控件不可见，跳过', 'warn');
    return false;
  }

  await mouseClick(call, state.rect);
  let options = await waitFor(call, `(() => {
    const pops = Array.from(document.querySelectorAll('.Popover-content.Select-popoverTarget'));
    const pop = pops[pops.length - 1];
    if (!pop) return null;
    const list = Array.from(pop.querySelectorAll('button.Select-option'));
    return list.length ? list.map((el) => String(el.innerText || '').trim()).filter(Boolean) : null;
  })()`, 4000);

  if (!options) {
    // 个别情况下真实鼠标事件没触发弹层，退回程序化点击一次
    await evalJs(call, itemExpr('所属领域', `const b = item.querySelector('button[aria-haspopup="true"]'); if (b) b.click();`));
    options = await waitFor(call, `(() => {
      const pops = Array.from(document.querySelectorAll('.Popover-content.Select-popoverTarget'));
      const pop = pops[pops.length - 1];
      if (!pop) return null;
      const list = Array.from(pop.querySelectorAll('button.Select-option'));
      return list.length ? list.map((el) => String(el.innerText || '').trim()).filter(Boolean) : null;
    })()`, 4000);
  }
  if (!options) {
    ctx.log('领域下拉框未打开，跳过', 'warn');
    return false;
  }
  await sleep(250);

  const pick = [keyword, DEFAULT_DOMAIN, FALLBACK_DOMAIN].find((k) => options.indexOf(k) >= 0);
  if (!pick) {
    ctx.log('领域无法选择（期望：' + keyword + '），可选：' + options.join('、'), 'warn');
    return false;
  }
  if (pick !== keyword) {
    ctx.log('领域「' + keyword + '」不在知乎可选列表，改用「' + pick + '」', 'warn');
  }

  const target = await evalJs(call, `(() => {
    const pops = Array.from(document.querySelectorAll('.Popover-content.Select-popoverTarget'));
    const pop = pops[pops.length - 1];
    if (!pop) return null;
    const btn = Array.from(pop.querySelectorAll('button.Select-option')).find((el) => String(el.innerText || '').trim() === ${JSON.stringify(pick)});
    if (!btn) return null;
    btn.scrollIntoView({ block: 'nearest' });
    const r = btn.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  })()`);
  if (target) await mouseClick(call, target);
  else await evalJs(call, `(() => {
    const pops = Array.from(document.querySelectorAll('.Popover-content.Select-popoverTarget'));
    const pop = pops[pops.length - 1];
    const btn = pop && Array.from(pop.querySelectorAll('button.Select-option')).find((el) => String(el.innerText || '').trim() === ${JSON.stringify(pick)});
    if (btn) btn.click();
  })()`);

  const done = await waitFor(call, itemExpr('所属领域', `return String(item.innerText || '').indexOf(${JSON.stringify(pick)}) >= 0;`), 4000);
  if (!done) {
    ctx.log('领域未能自动选中（期望：' + pick + '），请到「连接设置 → 知乎 → 默认领域」核对关键词', 'warn');
    return false;
  }
  ctx.log('知乎领域：已选择「' + pick + '」');
  return true;
}

async function prepareForm(call, ctx) {
  await ensureVideoMark(call, ctx);
  await ensureOriginal(call, ctx);
  await selectTopic(call, ctx);
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
  prePublish: prepareForm
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '知乎', supported: true, kinds: ['video'], run };
