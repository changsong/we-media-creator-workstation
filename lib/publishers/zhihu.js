'use strict';

/**
 * 知乎发布适配器（视频）。
 *
 * 投稿页：https://www.zhihu.com/creator/video-upload
 * 「视频标记」是必填项（弹窗确认），「所属领域」可选；
 * 发布前按「连接设置 → 知乎 → 默认领域」的关键词选择领域，默认「科技互联网」。
 */

const { runWithConfig, evalJs, clickEl, sleep } = require('./browser-publish');
const channelConnections = require('../channel-connections');

const DEFAULT_DOMAIN = '科技互联网';
const FALLBACK_DOMAIN = '其他';
const DEFAULT_MARK = '内容无需标注';
const WORKS_API =
  'https://www.zhihu.com/api/v4/creators/creations/v2/zvideo?start=0&end=0&limit=20&offset=0&sort_type=created';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
const VERIFY_MS = 90 * 1000;
const VERIFY_INTERVAL_MS = 10 * 1000;

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
  // 必须先滚到视口内再取坐标：表单很长时控件在视口外，
  // 真实鼠标点击会落在错误的滚动位置（或被浮层挡住）而点空。
  return evalJs(call, itemExpr(title, `
    item.scrollIntoView({ block: 'center', inline: 'nearest' });
    const btn = item.querySelector('button[aria-haspopup="true"]')
      || item.querySelector('input[type=checkbox]')
      || item.firstElementChild;
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

/**
 * 简介里的话题联想下拉（#话题 自动补全）会一直浮在表单上方，
 * 真实鼠标点击会落在下拉层上，导致「视频标记」等控件点不开。
 */
async function dismissSuggest(call) {
  try {
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27
    });
  } catch (err) {
    /* 键盘事件失败时退回 blur */
  }
  await evalJs(call, `(() => { const el = document.activeElement; if (el && el.blur) el.blur(); })()`).catch(() => {});
  await sleep(300);
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

  // 控件需要真实鼠标点击（程序化 click 只会把 Popover 标记为展开，不会渲染弹窗），
  // clickEl 会滚动到视口内并校验命中，被话题联想浮层挡住时先关掉再重试。
  const triggerExpr = itemExpr('视频标记', `return item.querySelector('button[aria-haspopup="true"]');`);
  let modalReady = null;
  const modalExpr = `!!document.querySelector('.VideoUploadForm-videoTypeModal')`;
  for (let attempt = 0; attempt < 3 && !modalReady; attempt++) {
    const res = await clickEl(call, triggerExpr, {
      onRetry: () => dismissSuggest(call),
      programmatic: false,
      hitWithin: '.VideoUploadForm-item'
    });
    if (!res.clicked) break;
    modalReady = await waitFor(call, modalExpr, 4000);
  }
  if (!modalReady) {
    ctx.log('视频标记弹窗未打开，跳过', 'warn');
    return false;
  }
  await sleep(300);

  const optionExpr = `(() => {
    const opts = Array.from(document.querySelectorAll('.VideoUploadForm-videoTypeModalOption'));
    return opts.find((el) => String(el.innerText || '').trim() === ${JSON.stringify(wanted)})
      || opts.find((el) => el.querySelector('.ZDI--CheckFill24'))
      || opts[0]
      || null;
  })()`;
  const optionText = await evalJs(call, `(() => { const el = ${optionExpr}; return el ? String(el.innerText || '').trim() : null; })()`);
  await clickEl(call, optionExpr, { afterMs: 400 });

  const confirmExpr = `(() => {
    const modal = document.querySelector('.VideoUploadForm-videoTypeModal');
    if (!modal) return null;
    return Array.from(modal.querySelectorAll('button')).find((el) => String(el.innerText || '').trim() === '确认') || null;
  })()`;
  const confirmRes = await clickEl(call, confirmExpr, { afterMs: 300 });
  if (confirmRes.reason === 'not-found') {
    ctx.log('视频标记弹窗未找到「确认」按钮', 'warn');
    return false;
  }

  // 鼠标点击仍无效时退回程序化 click（对普通按钮有效）
  const stillOpen = await waitFor(call, `!!document.querySelector('.VideoUploadForm-videoTypeModal')`, 1500);
  if (stillOpen) {
    await evalJs(call, `(() => {
      const modal = document.querySelector('.VideoUploadForm-videoTypeModal');
      if (!modal) return;
      const btn = Array.from(modal.querySelectorAll('button')).find((el) => String(el.innerText || '').trim() === '确认');
      if (btn) btn.click();
    })()`).catch(() => {});
    await sleep(500);
  }

  const ok = await waitFor(call, itemExpr('视频标记', `return String(item.innerText || '').indexOf('选择标记') < 0;`), 4000);
  if (!ok) {
    ctx.log('视频标记未能确认，请查看截图', 'warn');
    return false;
  }
  ctx.log('知乎视频标记：已选择「' + (optionText || wanted) + '」');
  return true;
}

/** 原创视频是必填勾选项，未勾选时补上。 */
async function ensureOriginal(call, ctx) {
  const checkedExpr = itemExpr('原创视频', `const i = item.querySelector('input[type=checkbox]'); return !!(i && i.checked);`);
  const boxExpr = itemExpr('原创视频', `return item.querySelector('input[type=checkbox]');`);
  const exists = await evalJs(call, itemExpr('原创视频', `return !!item.querySelector('input[type=checkbox]');`));
  if (!exists) return;
  if (await evalJs(call, checkedExpr)) return;
  await dismissSuggest(call);
  // 原生 checkbox 常被样式隐藏，命中校验失败时 clickEl 会退回程序化 click
  await clickEl(call, boxExpr, { afterMs: 400, onRetry: () => dismissSuggest(call), hitWithin: '.VideoUploadForm-item' });
  const checked = await evalJs(call, checkedExpr);
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

  await dismissSuggest(call);
  const triggerExpr = itemExpr('所属领域', `return item.querySelector('button[aria-haspopup="true"]');`);
  await clickEl(call, triggerExpr, { onRetry: () => dismissSuggest(call), hitWithin: '.VideoUploadForm-item' });
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

  const pickExpr = `(() => {
    const pops = Array.from(document.querySelectorAll('.Popover-content.Select-popoverTarget'));
    const pop = pops[pops.length - 1];
    if (!pop) return null;
    return Array.from(pop.querySelectorAll('button.Select-option')).find((el) => String(el.innerText || '').trim() === ${JSON.stringify(pick)}) || null;
  })()`;
  await clickEl(call, pickExpr, { block: 'nearest', afterMs: 200 });

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

function savedCookie() {
  const raw = channelConnections.getRaw('知乎');
  if (!raw || !raw.enabled) return '';
  return String((raw.fields && raw.fields.Cookie) || '').trim();
}

function taskTimeMs(task) {
  const raw = task && (task.finishedAt || task.startedAt);
  const time = new Date(raw || '').getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function normalizeText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

/** 视频上传在知乎会以「视频想法（pin）」或「视频（zvideo）」两种形态出现。 */
function itemInfo(item) {
  const d = item && item.data;
  if (!d) return null;
  if (item.type === 'pin') {
    const contents = Array.isArray(d.content) ? d.content : [];
    const hasVideo = contents.some((c) => c && c.type === 'video');
    if (!hasVideo) return null;
    const text = contents.find((c) => c && c.type === 'text') || {};
    return {
      workId: String(d.id || ''),
      title: text.title || '',
      body: text.content || text.own_text || '',
      createdMs: (Number(d.created_time) || 0) * 1000,
      publishUrl: 'https://www.zhihu.com/pin/' + d.id
    };
  }
  if (item.type === 'zvideo') {
    return {
      workId: String(d.id || ''),
      title: d.title || '',
      body: d.excerpt || '',
      createdMs: (Number(d.created_time) || 0) * 1000,
      publishUrl: 'https://www.zhihu.com/zvideo/' + d.id
    };
  }
  return null;
}

function matchWork(items, task, sinceMs) {
  const composed = compose(task, Array.isArray(task.tags) ? task.tags : []);
  const wantedTitle = normalizeText(composed.title);
  const wantedBody = normalizeText(composed.description);
  const hits = [];
  (items || []).forEach((item) => {
    const info = itemInfo(item);
    if (!info || !info.workId) return;
    if (sinceMs && info.createdMs && info.createdMs < sinceMs) return;
    const gotTitle = normalizeText(info.title);
    const gotBody = normalizeText(info.body);
    const titleHit =
      !!wantedTitle &&
      !!gotTitle &&
      (gotTitle === wantedTitle ||
        (Math.min(gotTitle.length, wantedTitle.length) >= 6 &&
          (gotTitle.indexOf(wantedTitle) >= 0 || wantedTitle.indexOf(gotTitle) >= 0)));
    const bodyHit =
      !!wantedBody &&
      !!gotBody &&
      (gotBody === wantedBody ||
        (Math.min(gotBody.length, wantedBody.length) >= 8 &&
          (gotBody.indexOf(wantedBody) >= 0 || wantedBody.indexOf(gotBody) >= 0)));
    if (titleHit || bodyHit) hits.push(info);
  });
  hits.sort((a, b) => b.createdMs - a.createdMs);
  return hits[0] || null;
}

async function fetchWorks(cookie) {
  const res = await fetch(WORKS_API, {
    headers: {
      Cookie: cookie,
      'User-Agent': USER_AGENT,
      Referer: 'https://www.zhihu.com/creator/manage/creation/all',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/plain, */*'
    }
  });
  if (!res.ok) throw new Error('作品列表接口 HTTP ' + res.status);
  const json = await res.json();
  return json && Array.isArray(json.data) ? json.data : [];
}

/** waitMs 为 0 时只查一次（供发布队列的定时复核使用） */
async function verifyWork(task, ctx, opts) {
  const o = opts || {};
  const log = (ctx && ctx.log) || (() => {});
  const waitMs = o.waitMs == null ? VERIFY_MS : Number(o.waitMs);
  const cookie = savedCookie();
  if (!cookie) {
    log('没有保存知乎 Cookie，无法自动核验作品，请到「连接设置 → 知乎」填写', 'warn');
    return null;
  }

  const sinceMs = taskTimeMs(task) - 10 * 60 * 1000;
  const started = Date.now();
  do {
    let items = [];
    try {
      items = await fetchWorks(cookie);
    } catch (err) {
      log('读取知乎作品列表失败：' + err.message, 'warn');
    }
    const hit = matchWork(items, task, sinceMs);
    if (hit) {
      log('知乎作品列表已匹配到新作品：' + hit.workId);
      return { workId: hit.workId, publishUrl: hit.publishUrl };
    }
    if (Date.now() - started >= waitMs) break;
    await sleep(VERIFY_INTERVAL_MS);
  } while (Date.now() - started < waitMs);

  log('未在知乎作品列表里匹配到本次发布（可能仍在审核中）', 'warn');
  return null;
}

async function verifySubmitted(task) {
  return verifyWork(task, null, { waitMs: 0 });
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
  // 投稿页会从 /creator/video-upload 重定向到 /upload-video
  uploadRouteRe: /upload-video|video-upload/,
  successRe: /发布成功|已发布|审核中|提交成功/,
  compose,
  prePublish: prepareForm,
  // 上传过程中表单会重渲染，必填项可能没落上；上传结束后再兜底确认一次
  onUploadSettled: prepareForm,
  afterPublish: async (call, ctx) => {
    const verified = await verifyWork(ctx.task, ctx, { waitMs: VERIFY_MS });
    if (!verified) {
      ctx.log('未在知乎作品列表核验到新作品（可能仍在审核中），保留「待核验」并继续自动复核', 'warn');
      return null;
    }
    return {
      status: 'published',
      workId: verified.workId,
      publishUrl: verified.publishUrl,
      message: '已发布并核验作品链接'
    };
  }
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '知乎', supported: true, kinds: ['video'], run, verify: verifySubmitted };
