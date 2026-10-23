'use strict';

/**
 * 快手发布适配器。
 *
 * 投稿页：https://cp.kuaishou.com/article/publish/video
 * 快手网页端的正文是「作品描述」（≤500 字），标题会作为描述首行展示；
 * 自定义封面走「封面设置 → 上传封面 → 确认」，没有配置封面时沿用页面默认帧。
 */

const { runWithConfig, evalJs, sleep } = require('./browser-publish');
const browserLogin = require('../browser-login');

const DESC_MAX = 500;
const TAGS_MAX = 4;

// 作品列表是 SPA 内部接口（带反爬签名），这里打开创作者首页，捕获页面自己发出的
// 「最近作品」请求来核验，避免自己拼签名。接口字段：workId / title / uploadTime。
const HOME_URL = 'https://cp.kuaishou.com/';
const WORKS_API = '/rest/cp/works/v2/video/pc/home/photo/list';
const VERIFY_MS = 3 * 60 * 1000;
const VERIFY_INTERVAL_MS = 10 * 1000;
const VERIFY_ATTEMPT_MS = 20 * 1000;

function tagsLine(tags, limit) {
  return (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .map((t) => '#' + t)
    .join(' ');
}

// 快手封面在信息流里接近竖版，优先用 3:4，其余比例按接近程度兜底
const COVER_PREFERENCE = ['3:4', '9:16', 'original', '4:3', '1:1', '16:9', '3:2'];

function ratioLabel(ratio) {
  return !ratio || ratio === 'original' ? '原始比例' : ratio;
}

function pickCover(covers) {
  const list = (covers || []).filter((item) => item && item.path);
  if (!list.length) return null;
  for (const ratio of COVER_PREFERENCE) {
    const hit = list.find((item) => (item.ratio || 'original') === ratio);
    if (hit) return hit;
  }
  return list[0];
}

function visibleExpr() {
  return `
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const area = (el) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
  `;
}

async function clickCoverBox(call, selector) {
  return evalJs(
    call,
    `(() => {
      ${visibleExpr()}
      const boxes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .filter((el) => visible(el));
      const box = boxes.sort((a, b) => area(a) - area(b))[0];
      if (!box) return '';
      box.click();
      return 'ok';
    })()`
  );
}

async function openCoverDialog(call) {
  // 封面缩略图是 _cover-full-editor，外层 _default-cover 不一定绑点击
  const first = await clickCoverBox(call, '[class*="_cover-full-editor"]');
  if (first && (await waitCoverDialog(call, 4000))) return true;
  const fallback = await clickCoverBox(call, '[class*="_default-cover"]');
  if (fallback && (await waitCoverDialog(call, 6000))) return true;
  return false;
}

async function waitCoverDialog(call, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await evalJs(
      call,
      `(() => !!Array.from(document.querySelectorAll('.ant-modal-content')).find((el) => el.getClientRects().length))()`
    ).catch(() => false);
    if (open) return true;
    await sleep(400);
  }
  return false;
}

async function clickUploadCoverTab(call) {
  return evalJs(
    call,
    `(() => {
      ${visibleExpr()}
      const modal = Array.from(document.querySelectorAll('.ant-modal-content')).filter(visible)[0];
      if (!modal) return '';
      const item = Array.from(modal.querySelectorAll('div, span'))
        .filter((el) => visible(el) && (el.innerText || '').trim() === '上传封面')
        .sort((a, b) => area(a) - area(b))[0];
      if (!item) return '';
      item.click();
      return '上传封面';
    })()`
  );
}

/** 封面弹层里的图片上传控件（表单里还有一个封面 input，要用弹层里的那个） */
async function modalImageInput(call) {
  await call('DOM.enable', {});
  const doc = await call('DOM.getDocument', { depth: -1, pierce: true });
  if (!doc || !doc.root) return null;
  const attrOf = (node, name) => {
    const list = node.attributes || [];
    for (let i = 0; i + 1 < list.length; i += 2) {
      if (list[i] === name) return list[i + 1];
    }
    return '';
  };
  let inModal = null;
  let any = null;
  const walk = (node, modal) => {
    if (!node) return;
    let inside = modal;
    if (node.nodeName === 'DIV' && /ant-modal/.test(attrOf(node, 'class'))) inside = true;
    if (node.nodeName === 'INPUT') {
      const isImage =
        String(attrOf(node, 'type')).toLowerCase() === 'file' && /image/i.test(attrOf(node, 'accept'));
      if (isImage) {
        if (inside && inModal === null) inModal = node.nodeId;
        if (any === null) any = node.nodeId;
      }
    }
    (node.children || []).forEach((child) => walk(child, inside));
    (node.shadowRoots || []).forEach((child) => walk(child, inside));
    if (node.contentDocument) walk(node.contentDocument, inside);
  };
  walk(doc.root, false);
  return inModal !== null ? inModal : any;
}

// 快手选完图后「清空上传」立刻出现、确认按钮也立刻可点，但裁剪/压缩要 10s 上下才真正生效，
// 过早确认会用回视频默认帧，所以这里按「全程最短等待 + 加载状态消失」判断就绪
const COVER_MIN_WAIT_MS = 12000;
const COVER_READY_TIMEOUT_MS = 45000;

async function coverModalState(call) {
  return evalJs(
    call,
    `(() => {
      ${visibleExpr()}
      const modal = Array.from(document.querySelectorAll('.ant-modal-content')).filter(visible)[0];
      if (!modal) return null;
      const text = modal.innerText || '';
      const confirm = Array.from(modal.querySelectorAll('button'))
        .filter((el) => visible(el) && (el.innerText || '').trim() === '确认')[0];
      return {
        loading: /加载中|处理中|上传中|裁剪中|生成中|压缩中/.test(text),
        confirmable: !!confirm && confirm.disabled !== true
      };
    })()`
  );
}

async function waitCoverReady(call, timeoutMs) {
  const started = Date.now();
  let readyStreak = 0;
  while (Date.now() - started < timeoutMs) {
    const state = await coverModalState(call).catch(() => null);
    if (state && state.confirmable && !state.loading) readyStreak += 1;
    else readyStreak = 0;
    if (readyStreak >= 2 && Date.now() - started >= COVER_MIN_WAIT_MS) return true;
    await sleep(500);
  }
  return false;
}

async function waitCoverDialogClosed(call, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const open = await evalJs(
      call,
      `(() => !!Array.from(document.querySelectorAll('.ant-modal-content')).find((el) => el.getClientRects().length))()`
    ).catch(() => true);
    if (!open) return true;
    await sleep(400);
  }
  return false;
}

async function confirmCover(call) {
  return evalJs(
    call,
    `(() => {
      ${visibleExpr()}
      const modal = Array.from(document.querySelectorAll('.ant-modal-content')).filter(visible)[0];
      if (!modal) return '';
      const btn = Array.from(modal.querySelectorAll('button'))
        .filter((el) => visible(el) && (el.innerText || '').trim() === '确认' && !el.disabled)[0];
      if (!btn) return '';
      btn.click();
      return '确认';
    })()`
  );
}

async function applyCover(call, ctx) {
  const covers = Array.isArray(ctx.covers) ? ctx.covers.filter((item) => item && item.path) : [];
  if (!covers.length) {
    ctx.log('排期未设置自定义封面，快手沿用默认封面');
    return false;
  }
  const cover = pickCover(covers);

  if (!(await openCoverDialog(call))) {
    ctx.log('快手封面：封面弹层没有打开，跳过', 'warn');
    return false;
  }

  const tab = await clickUploadCoverTab(call);
  if (!tab) {
    ctx.log('快手封面：弹层里没有「上传封面」，跳过', 'warn');
    return false;
  }
  await sleep(700);

  const nodeId = await modalImageInput(call);
  if (nodeId === null) {
    ctx.log('快手封面：弹层里没有图片上传控件，跳过', 'warn');
    return false;
  }
  const setAt = Date.now();
  await call('DOM.setFileInputFiles', { nodeId, files: [cover.path] });
  const ready = await waitCoverReady(call, COVER_READY_TIMEOUT_MS);
  if (!ready) ctx.log('快手封面：等待裁剪就绪超过 ' + Math.round(COVER_READY_TIMEOUT_MS / 1000) + 's，仍尝试确认', 'warn');

  const confirmed = await confirmCover(call);
  if (!confirmed) {
    ctx.log('快手封面：封面已上传但没有找到可点击的「确认」，跳过', 'warn');
    return false;
  }
  if (!(await waitCoverDialogClosed(call, 6000))) {
    ctx.log('快手封面：确认后弹层没有关闭，再确认一次', 'warn');
    await confirmCover(call);
    await waitCoverDialogClosed(call, 6000);
  }
  ctx.log(
    '快手封面：已设置 ' + cover.name + '（' + ratioLabel(cover.ratio) + '），耗时 ' + Math.round((Date.now() - setAt) / 1000) + 's'
  );
  await sleep(600);
  return true;
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

function normalizeText(text) {
  return String(text || '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function taskTimeMs(task) {
  const raw = task && (task.finishedAt || task.startedAt);
  const time = new Date(raw || '').getTime();
  return Number.isFinite(time) ? time : Date.now();
}

/** 在最近作品里按标题（标题+正文+话题）匹配，只接受发布之后上传的作品 */
function matchWork(works, task, sinceMs) {
  const wanted = normalizeText(compose(task, Array.isArray(task.tags) ? task.tags : []).description);
  if (!wanted) return null;
  const hits = [];
  (works || []).forEach((item) => {
    if (!item || !item.workId) return;
    const uploadTime = Number(item.uploadTime) || 0;
    if (sinceMs && uploadTime && uploadTime < sinceMs) return;
    const got = normalizeText(item.title);
    if (!got) return;
    const hit =
      got === wanted ||
      (Math.min(got.length, wanted.length) >= 8 &&
        (got.indexOf(wanted) >= 0 || wanted.indexOf(got) >= 0));
    if (hit) hits.push(item);
  });
  hits.sort((a, b) => (Number(b.uploadTime) || 0) - (Number(a.uploadTime) || 0));
  return hits[0] || null;
}

async function openVerifyTab() {
  const browser = await browserLogin.ensureBrowser({ url: HOME_URL, headless: true });
  const targets = await browserLogin.httpJson(browser.port, '/json/list');
  // 复用已有浏览器时必须用新标签页，避免把用户正在看的页面导航走
  const page = browser.target && browser.target.webSocketDebuggerUrl
    ? browser.target
    : browser.reused
      ? null
      : targets.find((t) => t.type === 'page' && /kuaishou\.com/.test(t.url || ''));
  if (!page || !page.webSocketDebuggerUrl) throw new Error('未能打开新的快手标签页');

  const pending = [];
  const call = await browserLogin.cdpConnect(page.webSocketDebuggerUrl, (msg) => {
    if (msg.method !== 'Network.responseReceived') return;
    const url = (msg.params.response && msg.params.response.url) || '';
    if (url.indexOf(WORKS_API) >= 0) pending.push(msg.params.requestId);
  });
  await call('Network.enable', {});
  await call('Runtime.enable', {});
  return { browser, call, pending };
}

/** 重新加载首页并等页面自己发出作品列表请求，返回接口里的 list */
async function loadRecentWorks(env, timeoutMs) {
  env.pending.length = 0;
  await env.call('Page.navigate', { url: HOME_URL }).catch(() => {});
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!env.pending.length) {
      await sleep(400);
      continue;
    }
    const requestId = env.pending[0];
    try {
      const body = await env.call('Network.getResponseBody', { requestId }, 10000);
      env.pending.shift();
      const json = JSON.parse((body && body.body) || 'null');
      const items = json && json.data && json.data.list;
      return Array.isArray(items) ? items : [];
    } catch (err) {
      // 响应体可能还没生成，稍后重试
      await sleep(300);
    }
  }
  return null;
}

async function closeVerifyTab(env) {
  try {
    if (env.browser && env.browser.reused) await env.call('Page.close', {});
    else await browserLogin.closeBrowser(env.browser);
  } catch (err) {
    /* 关闭失败不影响核验结果 */
  }
  try {
    env.call.close();
  } catch (err) {
    /* 已关闭 */
  }
}

/** waitMs 为 0 时只查一次（供发布队列的定时复核使用） */
async function verifyWork(task, ctx, opts) {
  const o = opts || {};
  const log = (ctx && ctx.log) || (() => {});
  const waitMs = o.waitMs == null ? VERIFY_MS : Number(o.waitMs);
  const sinceMs = taskTimeMs(task) - 10 * 60 * 1000;
  let env = null;
  try {
    env = await openVerifyTab();
    const started = Date.now();
    do {
      const works = await loadRecentWorks(env, VERIFY_ATTEMPT_MS);
      const hit = works ? matchWork(works, task, sinceMs) : null;
      if (hit) {
        log('作品列表已匹配到新作品：' + hit.workId);
        return {
          workId: String(hit.workId),
          publishUrl: 'https://www.kuaishou.com/short-video/' + hit.workId
        };
      }
      if (Date.now() - started >= waitMs) break;
      await sleep(VERIFY_INTERVAL_MS);
    } while (Date.now() - started < waitMs);
    log('未在快手最近作品里匹配到本次发布（可能仍在审核中）', 'warn');
    return null;
  } finally {
    if (env) await closeVerifyTab(env);
  }
}

async function verifySubmitted(task) {
  return verifyWork(task, null, { waitMs: 0 });
}

/**
 * 上次失败会在快手留下未发布草稿，进入投稿页时顶部会提示「还有上次未发布的视频」。
 * 横幅不遮挡上传控件，这里只记录一下，避免用户误以为它挡住了发布。
 */
async function noteDraftBanner(call, ctx) {
  const text = await evalJs(
    call,
    `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!/还有上次未发布的视频/.test(node.nodeValue || '')) continue;
        const parent = node.parentElement;
        if (!parent || !parent.getClientRects().length) continue;
        return (parent.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
      }
      return '';
    })()`
  ).catch(() => '');
  if (text) ctx.log('检测到快手草稿提示横幅（' + text + '），不影响本次上传');
}

const cfg = {
  platform: '快手',
  preparePage: noteDraftBanner,
  prePublish: async (call, ctx) => {
    try {
      await applyCover(call, ctx);
    } catch (err) {
      ctx.log('快手封面设置失败，继续发布：' + err.message, 'warn');
    }
  },
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
  // 1GB 以上的视频按本机上行要 30 分钟上下，发布按钮就绪等待放宽到 45 分钟
  uploadTimeoutMs: 45 * 60 * 1000,
  uploadPercentMarksUpload: true,
  uploadRouteRe: /article\/publish/,
  successRe: /发布成功|提交成功|审核中|发布完成/,
  compose,
  afterPublish: async (call, ctx) => {
    const verified = await verifyWork(ctx.task, ctx, { waitMs: VERIFY_MS });
    if (!verified) {
      ctx.log('未在快手最近作品里核验到新作品（可能仍在审核中），保留「待核验」并继续自动复核', 'warn');
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

module.exports = { key: '快手', supported: true, kinds: ['video'], run, verify: verifySubmitted };
