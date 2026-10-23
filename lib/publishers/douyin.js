'use strict';

/**
 * 抖音发布适配器：用专用浏览器 profile 操作创作者中心页面。
 *
 * 页面选择器会随抖音改版失效，这里的定位优先用 placeholder / 按钮文案等稳定特征，
 * 任何一步找不到目标都会中止并保留日志与截图，绝不盲点。
 */

const fs = require('fs');
const browserLogin = require('../browser-login');
const channelConnections = require('../channel-connections');
const douyinCollector = require('../douyin-collector');

const PLATFORM = '抖音';
const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
const MANAGE_PATH = '/creator-micro/content/manage';
const WAIT_FORM_MS = 15 * 60 * 1000;
const WAIT_PUBLISH_MS = 90 * 1000;
const VERIFY_MS = 5 * 60 * 1000;
const TITLE_MAX = 30;
const NAV_WAIT_MS = 30000;
// 投稿页跳转后抖音会做一轮初始化/封面解析，先静默等待，避免撞上渲染最忙的窗口
const RENDER_SETTLE_MS = 2500;
const POLL_MIN_MS = 1000;
const POLL_MAX_MS = 3000;

/**
 * 各渠道页面字段结构不同，定位逻辑放在各自适配器里。
 * 抖音的「作品描述」在改版后可能是 input / textarea / contenteditable，
 * 这里统一按可见性 + 语义文案查找，避免绑死某一种标签或旧 placeholder。
 */
const FIELD_HELPERS = `
  const fieldVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const fieldAll = (sel) => Array.from(document.querySelectorAll(sel)).filter(fieldVisible);
  const fieldArea = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };
  const fieldHint = (el) =>
    (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('data-placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '');
  const findTitleField = () =>
    fieldAll('input[placeholder*="标题"]:not([type="search"]):not([type="hidden"]), textarea[placeholder*="标题"]')[0] || null;
  const findDescField = () => {
    const title = findTitleField();
    const candidates = fieldAll(
      'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"][contenteditable]'
    ).filter((el) => el !== title && !/标题/.test(fieldHint(el)));
    if (!candidates.length) return null;
    // 新版抖音把标题输入框放在「作品描述」卡片里，正文编辑区通常是面积最大的可编辑块
    const hinted = candidates.filter((el) => /描述|简介|说点什么|话题|添加/.test(fieldHint(el)));
    const pool = hinted.length ? hinted : candidates;
    pool.sort((a, b) => fieldArea(b) - fieldArea(a));
    return pool[0] || null;
  };
`;

// 封面弹窗结构随改版变化，这里统一按「可见弹层」定位，避免误触页面其它上传控件
const MODAL_HELPERS = `
  const modalVisible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 10 && r.height > 10 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const modalScopes = () =>
    Array.from(document.querySelectorAll(
      '[role="dialog"], .semi-modal, .ant-modal, .modal, [class*="modal"], [class*="Modal"], [class*="dialog"], [class*="Dialog"], [class*="sheet"], [class*="Sheet"], [class*="drawer"], [class*="Drawer"]'
    )).filter(modalVisible);
`;

// 页面未标注横/竖封面比例时的兜底偏好：视频优先竖版 9:16，图文优先 3:4
const COVER_PREFERENCE = {
  video: ['9:16', '3:4', 'original', '1:1', '4:3', '16:9', '3:2'],
  image: ['3:4', 'original', '9:16', '1:1', '16:9', '4:3', '3:2']
};

// 抖音封面弹窗的确认按钮是「设置」，旧版是确定/完成
const COVER_CONFIRM_RE = /^(设置|确定|确认|完成|应用|保存|使用|使用此封面)$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function evalJs(call, expression, timeoutMs) {
  const limit = timeoutMs || 15000;
  // 页面侧和客户端都设超时：渲染线程卡住时客户端超时会触发重连，避免整条任务挂死
  return call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: limit
  }, limit).then((res) => {
    if (res && res.exceptionDetails) {
      const text = res.exceptionDetails.text || '页面脚本执行失败';
      throw new Error(text);
    }
    return res && res.result ? res.result.value : null;
  });
}

function pageTextExpr() {
  // innerText 会强制整页布局，上传/转码阶段容易把渲染线程拖住；
  // 改用 TreeWalker 限量取文本节点，不触发布局。
  return `
    const pageText = (() => {
      let out = '';
      try {
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && out.length < 12000) {
          const parent = node.parentElement;
          if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) continue;
          const chunk = node.nodeValue;
          if (chunk) out += chunk;
        }
      } catch (err) { /* 页面结构异常时降级为空文本 */ }
      return out.replace(/\\s+/g, ' ').slice(0, 12000);
    })();
  `;
}

function pageState(call) {
  return evalJs(
    call,
    `(() => {
      ${FIELD_HELPERS}
      ${pageTextExpr()}
      const text = pageText;
      const inputs = Array.from(document.querySelectorAll('input[type=file]'));
      const title = findTitleField();
      const editor = findDescField();
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const publishBtn = buttons.find((b) => (b.innerText || '').trim() === '发布');
      const m = /(\\d{1,3})\\s*%/.exec(text);
      return {
        url: location.href,
        title: document.title,
        text: text,
        fileInputs: inputs.length,
        fileAccepts: inputs.map((el) => el.accept || ''),
        hasTitle: !!title,
        hasEditor: !!editor,
        hasForm: !!title || !!editor,
        hasPublish: !!publishBtn,
        publishDisabled: publishBtn ? !!publishBtn.disabled || publishBtn.getAttribute('aria-disabled') === 'true' : true,
        uploading: /上传中|上传进度|取消上传/.test(text),
        uploaded: /重新上传|上传成功/.test(text),
        failed: /上传失败|上传出错|视频上传失败|上传异常/.test(text),
        percent: m ? Number(m[1]) : null
      };
    })()`
  );
}

function pageImageState(call) {
  return evalJs(
    call,
    `(() => {
      ${FIELD_HELPERS}
      ${pageTextExpr()}
      const text = pageText;
      const inputs = Array.from(document.querySelectorAll('input[type=file]'));
      const title = findTitleField();
      const editor = findDescField();
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const publishBtn = buttons.find((b) => (b.innerText || '').trim() === '发布');
      const thumbs = Array.from(document.querySelectorAll('img')).filter((img) => {
        const src = img.src || '';
        const r = img.getBoundingClientRect();
        return r.width > 20 && r.height > 20 && (/^blob:|^data:image/.test(src) || /douyinpic|byteimg/.test(src));
      }).length;
      return {
        url: location.href,
        title: document.title,
        text: text,
        fileInputs: inputs.length,
        fileAccepts: inputs.map((el) => el.accept || ''),
        hasTitle: !!title,
        hasEditor: !!editor,
        hasForm: !!title || !!editor,
        hasPublish: !!publishBtn,
        publishDisabled: publishBtn ? !!publishBtn.disabled || publishBtn.getAttribute('aria-disabled') === 'true' : true,
        uploading: /上传中|上传进度|取消上传|图片处理中/.test(text),
        failed: /上传失败|上传出错|图片上传失败|上传异常/.test(text),
        thumbs: thumbs
      };
    })()`
  );
}

async function waitFor(call, predicate, timeoutMs, intervalMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await pageState(call);
    if (predicate(last, started)) return last;
    await sleep(intervalMs || 1000);
  }
  return null;
}

function cookieHeaderForDouyin() {
  const raw = channelConnections.getRaw(PLATFORM);
  return raw && raw.enabled ? raw.fields['Cookie'] || '' : '';
}

async function injectCookies(call, header) {
  if (!header) return 0;
  let count = 0;
  const pairs = String(header).split(';');
  for (const pair of pairs) {
    const item = pair.trim();
    const idx = item.indexOf('=');
    if (idx <= 0) continue;
    const name = item.slice(0, idx).trim();
    const value = item.slice(idx + 1);
    try {
      await call('Network.setCookie', {
        name,
        value,
        domain: '.douyin.com',
        path: '/',
        secure: true,
        sameSite: 'Lax'
      });
      count++;
    } catch (err) {
      /* 个别 Cookie 格式不被接受时跳过 */
    }
  }
  return count;
}

function looksLoggedOut(state) {
  if (!state) return false;
  if (/\/login/.test(state.url || '')) return true;
  const text = String(state.text || '');
  return !state.fileInputs && /扫码登录|手机号登录|登录抖音|验证码登录/.test(text);
}

function shortUrl(url) {
  return String(url || '').replace(/^https?:\/\/[^/]+/, '');
}

/** 导航历史由浏览器进程维护，不走页面 JS，渲染线程繁忙时也能响应 */
async function currentPageUrl(call) {
  try {
    const hist = await call('Page.getNavigationHistory');
    const entries = (hist && hist.entries) || [];
    const idx = hist ? hist.currentIndex : -1;
    return entries[idx] ? entries[idx].url || '' : '';
  } catch (err) {
    return '';
  }
}

async function waitForRoute(call, pattern, timeoutMs, ctx) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    last = await currentPageUrl(call);
    if (pattern.test(last)) {
      if (ctx) ctx.log('投稿页已跳转：' + shortUrl(last));
      return last;
    }
    await sleep(500);
  }
  if (ctx) ctx.log('未检测到投稿页跳转（当前：' + (shortUrl(last) || '未知') + '），继续等待编辑区', 'warn');
  return '';
}

async function dismissDraftDialog(call, ctx) {
  const clicked = await evalJs(
    call,
    `(() => {
      const text = (document.body && document.body.innerText || '');
      if (!/继续编辑|未提交的视频|草稿/.test(text)) return '';
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const target = buttons.find((b) => /^(不用了|放弃|新建视频|开始创作)$/.test((b.innerText || '').trim()));
      if (!target) return '';
      target.click();
      return (target.innerText || '').trim();
    })()`
  ).catch(() => '');
  if (clicked) ctx.log('已关闭旧草稿提示：' + clicked);
  return clicked;
}

async function ensureFileInputs(call, ctx) {
  let state = await waitFor(call, (s) => s.fileInputs > 0 || looksLoggedOut(s), 20000, 1000);
  if (!state) state = await pageState(call);
  if (state && state.fileInputs > 0) return state;

  if (looksLoggedOut(state)) {
    ctx.log('检测到抖音登录态失效，尝试注入已保存的 Cookie');
    const header = cookieHeaderForDouyin();
    const n = await injectCookies(call, header);
    ctx.log(n ? '已注入 ' + n + ' 条 Cookie，重新加载投稿页' : '没有可用的已保存 Cookie');
    if (n) {
      await call('Page.navigate', { url: UPLOAD_URL });
      state = await waitFor(call, (s) => s.fileInputs > 0 || looksLoggedOut(s), 30000, 1000);
      if (state && state.fileInputs > 0) return state;
    }
    throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
  }
  throw new Error('投稿页加载超时：没有找到上传控件');
}

async function fileInputCandidates(call) {
  await call('DOM.enable', {});
  const doc = await call('DOM.getDocument', { depth: -1, pierce: true });
  const root = doc && doc.root ? doc.root.nodeId : null;
  if (!root) return [];
  const found = await call('DOM.querySelectorAll', { nodeId: root, selector: 'input[type=file]' });
  const nodeIds = (found && found.nodeIds) || [];
  if (!nodeIds.length) return [];
  const accepts = await evalJs(
    call,
    `Array.from(document.querySelectorAll('input[type=file]')).map((el) => el.accept || '')`
  );
  return nodeIds.map((nodeId, i) => ({ nodeId, accept: String((accepts && accepts[i]) || '') }));
}

async function attachVideo(call, videoPath, ctx) {
  const candidates = await fileInputCandidates(call);
  if (!candidates.length) throw new Error('没有找到视频上传控件');
  const ranked = candidates.slice().sort((a, b) => {
    const score = (item) => (/video|mp4|mov/i.test(item.accept) ? 0 : item.accept ? 2 : 1);
    return score(a) - score(b);
  });
  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    try {
      await call('DOM.setFileInputFiles', { nodeId: c.nodeId, files: [videoPath] });
      ctx.log(`已交入第 ${i + 1} 个上传控件（accept: ${c.accept || '未限制'}）`);
    } catch (err) {
      ctx.log(`第 ${i + 1} 个上传控件不可用：${err.message}`, 'warn');
      continue;
    }
    const moved = await waitFor(
      call,
      (s) =>
        s.failed ||
        s.uploading ||
        s.uploaded ||
        s.hasTitle ||
        s.hasEditor ||
        /\/content\/(publish|post)/.test(s.url || ''),
      10000,
      700
    );
    if (moved) return moved;
    ctx.log('页面没有响应，尝试下一个上传控件', 'warn');
  }
  throw new Error('视频未能交给投稿页，请检查文件格式或重试');
}

async function waitUploadSettled(call, ctx) {
  const started = Date.now();
  let lastLog = 0;
  let delay = POLL_MIN_MS;
  // 上传后页面会 SPA 跳转到 content/post，先等路由落定再开始探测
  await waitForRoute(call, /\/content\/(post|publish)\//, NAV_WAIT_MS, ctx);
  await sleep(RENDER_SETTLE_MS);
  for (;;) {
    const state = await pageState(call);
    if (state.failed) throw new Error('抖音页面提示上传失败，请查看截图');
    if (looksLoggedOut(state)) throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
    // 编辑区出现且上传不再占满页面时返回；长时间上传则放宽，避免一直空等
    if ((state.hasTitle || state.hasEditor) && (!state.uploading || state.uploaded || Date.now() - started > 60000)) {
      return state;
    }
    if (Date.now() - started > WAIT_FORM_MS) {
      throw new Error(
        state.uploaded || state.percent === 100
          ? '视频已上传，但没有找到「作品描述」编辑区，抖音页面可能已改版，请查看截图'
          : '等待视频上传完成超时（15 分钟）'
      );
    }
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(
        state.uploading
          ? '视频上传中' + (state.percent != null ? `：${state.percent}%` : '…')
          : '等待页面进入编辑态…'
      );
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
}

async function selectImageTab(call, ctx) {
  const clicked = await evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const candidates = Array.from(document.querySelectorAll('[role="tab"], button, a, span, div'))
        .filter((el) => /^(发布图文|图文发布|图文)$/.test((el.innerText || '').trim()) && visible(el));
      const target = candidates.find((el) => el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'tab')
        || candidates[0];
      if (!target) return '';
      target.click();
      return (target.innerText || '').trim();
    })()`
  );
  if (!clicked) throw new Error('没有找到「图文」发布入口，请查看截图确认页面是否改版');
  ctx.log('已切换到图文发布：' + clicked);
  await sleep(1500);
  const state = await waitFor(call, (s) => s.fileInputs > 0 || looksLoggedOut(s), 20000, 1000);
  if (!state) throw new Error('图文发布页加载超时：没有找到图片上传控件');
  if (looksLoggedOut(state)) throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
  return state;
}

async function attachImages(call, paths, ctx) {
  const files = (paths || []).filter(Boolean);
  if (!files.length) throw new Error('没有可上传的图片');
  const candidates = await fileInputCandidates(call);
  if (!candidates.length) throw new Error('没有找到图片上传控件');
  const score = (item) => {
    if (/image|jpe?g|png|webp/i.test(item.accept)) return 0;
    if (!item.accept) return 1;
    if (/video/i.test(item.accept)) return 3;
    return 2;
  };
  const ranked = candidates.slice().sort((a, b) => score(a) - score(b));
  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    try {
      await call('DOM.setFileInputFiles', { nodeId: c.nodeId, files });
      ctx.log(`已交入第 ${i + 1} 个上传控件（accept: ${c.accept || '未限制'}，${files.length} 张图片）`);
    } catch (err) {
      ctx.log(`第 ${i + 1} 个上传控件不可用：${err.message}`, 'warn');
      continue;
    }
    const moved = await waitFor(
      call,
      (s) =>
        s.failed ||
        s.uploading ||
        s.thumbs > 0 ||
        s.hasTitle ||
        s.hasEditor ||
        /\/content\/(publish|post)/.test(s.url || ''),
      12000,
      700
    );
    if (moved) return moved;
    ctx.log('页面没有响应，尝试下一个上传控件', 'warn');
  }
  throw new Error('图片未能交给图文投稿页，请检查文件格式或重试');
}

async function waitImagesSettled(call, ctx, expected) {
  const started = Date.now();
  let lastLog = 0;
  let delay = POLL_MIN_MS;
  await sleep(1200);
  for (;;) {
    const state = await pageImageState(call);
    if (state.failed) throw new Error('抖音页面提示图片上传失败，请查看截图');
    if (looksLoggedOut(state)) throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
    if (!state.uploading && (state.hasTitle || state.hasEditor || state.thumbs >= expected)) {
      return state;
    }
    if (Date.now() - started > WAIT_FORM_MS) {
      throw new Error('等待图片上传完成超时（15 分钟）');
    }
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(state.uploading ? `图片上传处理中（已识别 ${state.thumbs} 张）…` : '等待页面进入图文编辑态…');
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
}

/* ---------- 封面：按发布页要求选择比例并上传 ---------- */

function ratioLabel(ratio) {
  return !ratio || ratio === 'original' ? '原始比例' : ratio;
}

function pickCover(covers, isImage, hint) {
  const list = (covers || []).filter((item) => item && item.path);
  if (!list.length) return null;
  // 发布页会直接标注「横封面4:3」「竖封面3:4」，优先按页面要求取图
  if (hint) {
    const hit = list.find((item) => (item.ratio || 'original') === hint);
    if (hit) return hit;
  }
  const want = COVER_PREFERENCE[isImage ? 'image' : 'video'];
  for (const ratio of want) {
    const hit = list.find((item) => (item.ratio || 'original') === ratio);
    if (hit) return hit;
  }
  return list[0] || null;
}

/** 读取页面上的封面槽位，如「横封面4:3」「竖封面3:4」，按出现顺序返回 */
async function listCoverSlots(call) {
  const slots = await evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const out = [];
      const nodes = Array.from(document.querySelectorAll('[class*="cover"], [class*="Cover"]'));
      for (const el of nodes) {
        if (!visible(el)) continue;
        const text = (el.innerText || '').trim();
        if (!text || text.length > 24) continue;
        const m = text.match(/(横|竖)封面\\s*[:：]?\\s*(\\d+)\\s*[:：]\\s*(\\d+)/);
        if (!m) continue;
        const item = { ori: m[1], ratio: m[2] + ':' + m[3] };
        if (!out.some((h) => h.ori === item.ori && h.ratio === item.ratio)) out.push(item);
      }
      return out;
    })()`
  ).catch(() => []);
  return Array.isArray(slots) ? slots : [];
}

/**
 * 封面在视频上传后是异步生成的，生成期间入口不可点、上传控件也不存在。
 * 等到「生成中」消失且「选择封面」出现再继续；超时后仍尝试一次，不阻断发布。
 */
async function waitForCoverReady(call, ctx, timeoutMs) {
  const started = Date.now();
  let waited = false;
  let delay = POLL_MIN_MS;
  while (Date.now() - started < timeoutMs) {
    const state = await evalJs(
      call,
      `(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const entryPat = /^(选择封面|更换封面|设置封面|编辑封面|上传封面)$/;
        const entries = Array.from(document.querySelectorAll('button, [role="button"], a, span, div')).filter(
          (el) => visible(el) && (el.innerText || '').trim().length <= 12 && entryPat.test((el.innerText || '').trim())
        );
        // 只认封面区域内的「生成中」，避免被页面其它异步模块拖住
        const generating = Array.from(
          document.querySelectorAll('[class*="cover"] div, [class*="cover"] span, [class*="Cover"] div, [class*="Cover"] span')
        ).some((el) => visible(el) && (el.innerText || '').trim() === '生成中');
        return { entry: entries.length, generating };
      })()`
    ).catch(() => ({ entry: 0, generating: true }));
    if (state && state.entry && !state.generating) return true;
    if (state && !state.entry && !state.generating && Date.now() - started > 20000) {
      ctx.log('页面上没有找到「选择封面」入口，跳过自动封面', 'warn');
      return false;
    }
    if (!waited && state && state.generating) {
      ctx.log('封面仍在生成，等待封面就绪…');
      waited = true;
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
  ctx.log('等待封面就绪超时，继续尝试设置封面', 'warn');
  return false;
}

/** 文案节点多半绑定在 div 上，直接点叶子并补发鼠标事件序列，事件会冒泡到真正的监听容器 */
async function clickCoverEntry(call) {
  return evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const pat = /^(选择封面|更换封面|设置封面|编辑封面|上传封面|封面)$/;
      const els = Array.from(document.querySelectorAll('button, [role="button"], a, span, div, label'))
        .filter((el) => visible(el) && (el.innerText || '').trim().length <= 12 && pat.test((el.innerText || '').trim()))
        .map((el) => {
          const text = (el.innerText || '').trim();
          // 优先封面区域内的节点，其次完整文案，最后才考虑单独的「封面」二字
          const score = (el.closest('[class*="cover"], [class*="Cover"]') ? 0 : 2) + (text === '封面' ? 1 : 0);
          return { el, score };
        })
        .sort((a, b) => a.score - b.score);
      if (!els.length) return '';
      const picked =
        els.find((item) => !Array.from(item.el.children).some((c) => pat.test((c.innerText || '').trim()))) || els[0];
      const leaf = picked.el || picked;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        const Ev = type.indexOf('pointer') === 0 && window.PointerEvent ? window.PointerEvent : MouseEvent;
        leaf.dispatchEvent(new Ev(type, { bubbles: true, cancelable: true, view: window }));
      });
      return (leaf.innerText || '').trim() || '封面';
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

/** 封面弹窗可能不在常见弹层容器里，系统推荐封面（presetItem）出现也视为已打开 */
async function coverEditorOpened(call) {
  const state = await evalJs(
    call,
    `(() => {
      ${MODAL_HELPERS}
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const presets = Array.from(
        document.querySelectorAll('[class*="presetItem"], [class*="PresetItem"], [class*="preset-"], [class*="Preset-"]')
      ).filter(visible).length;
      return { modals: modalScopes().length, presets };
    })()`
  ).catch(() => null);
  return !!state && (state.modals > 0 || state.presets > 0);
}

async function clickModalText(call, re) {
  const literal = re.source;
  const flags = re.flags.replace(/g/g, '');
  return evalJs(
    call,
    `(() => {
      ${MODAL_HELPERS}
      const re = new RegExp(${JSON.stringify(literal)}, ${JSON.stringify(flags)});
      const scopes = modalScopes();
      if (!scopes.length) scopes.push(document.body);
      const hits = [];
      scopes.forEach((scope) => {
        Array.from(scope.querySelectorAll('button, [role="button"], a, span, div')).forEach((el) => {
          if (!modalVisible(el)) return;
          const text = (el.innerText || '').trim();
          if (!text || text.length > 12 || !re.test(text)) return;
          // 只取最内层节点，避免点到大容器
          if (Array.from(el.children).some((child) => re.test((child.innerText || '').trim()))) return;
          hits.push({ el, text });
        });
      });
      const hit =
        hits.find((item) => item.el.tagName === 'BUTTON' || item.el.tagName === 'A' || item.el.getAttribute('role') === 'button') ||
        hits[0];
      if (!hit) return '';
      hit.el.click();
      return hit.text;
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

async function markCoverInput(call) {
  return evalJs(
    call,
    `(() => {
      ${MODAL_HELPERS}
      document.querySelectorAll('input[data-wb-cover-input="1"]').forEach((el) => el.removeAttribute('data-wb-cover-input'));
      const isImageInput = (el) => {
        const accept = el.getAttribute('accept') || '';
        if (/video/i.test(accept)) return false;
        return /image|jpe?g|png|webp/i.test(accept) || !accept;
      };
      const mark = (pick) => {
        pick.setAttribute('data-wb-cover-input', '1');
        // 同一 input 会在横/竖封面两个步骤间复用，先清掉上一次选择的文件，避免误判为已上传
        try { pick.value = ''; } catch (err) { /* 部分控件不允许重置 */ }
        return pick.accept || '未限制';
      };
      const pickImage = (nodes) => {
        const list = nodes.filter(isImageInput);
        // semi-upload 的真实控件是 hidden-input，优先它
        return list.find((el) => /hidden-input/.test(String(el.className || ''))) || list[0] || null;
      };
      const scopes = modalScopes();
      for (const scope of scopes) {
        // 两个步骤可能各挂一个上传区域，只认当前可见的那个，避免把图传到另一个比例的面板
        const boxes = Array.from(
          scope.querySelectorAll('.semi-upload, [class*="upload"], [class*="Upload"]')
        ).filter(modalVisible);
        for (const box of boxes) {
          const pick = pickImage(Array.from(box.querySelectorAll('input[type=file]')));
          if (pick) return mark(pick);
        }
        const pick = pickImage(Array.from(scope.querySelectorAll('input[type=file]')));
        if (pick) return mark(pick);
      }
      // 有的版本弹层容器 class 不在识别范围内，退回全页找图片上传框
      const fallback = Array.from(document.querySelectorAll('input[type=file]')).filter(isImageInput);
      if (!fallback.length) return '';
      return mark(fallback[fallback.length - 1]);
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

async function markedCoverNodeId(call) {
  await call('DOM.enable', {});
  const doc = await call('DOM.getDocument', { depth: -1, pierce: true });
  if (!doc || !doc.root) return null;
  const found = await call('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[data-wb-cover-input="1"]'
  });
  return found && found.nodeId ? found.nodeId : null;
}

function slotLabel(slot) {
  if (!slot) return '封面';
  const name = (slot.ori || '') + '封面';
  return slot.ratio ? name + ' ' + slot.ratio : name;
}

async function openCoverEditor(call, ctx) {
  const clicked = await clickCoverEntry(call);
  if (!clicked) {
    ctx.log('未找到「选择封面」入口，跳过自动封面', 'warn');
    return '';
  }
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    if (await coverEditorOpened(call)) {
      ctx.log('已打开封面设置弹窗');
      return clicked;
    }
  }
  // 入口文案节点偶尔在首帧不可交互，再点一次；仍无弹层就明确记录
  await sleep(500);
  const retried = await clickCoverEntry(call);
  for (let i = 0; i < 6 && retried; i++) {
    await sleep(300);
    if (await coverEditorOpened(call)) {
      ctx.log('已打开封面设置弹窗（重试点击）');
      return retried;
    }
  }
  ctx.log('点击「选择封面」后没有出现封面弹窗，跳过自动封面（可手动设置）', 'warn');
  return '';
}

async function waitCoverEditorClosed(call, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await coverEditorOpened(call))) return true;
    await sleep(400);
  }
  return false;
}

async function closeCoverDialog(call) {
  const closed = await clickModalText(call, /^(取消|关闭|×)$/);
  if (closed) return closed;
  try {
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27
    });
  } catch (err) {
    /* 关闭失败不影响后续发布 */
  }
  return '';
}

async function coverFilesReady(call) {
  const count = await evalJs(
    call,
    `(() => {
      const el = document.querySelector('input[data-wb-cover-input="1"]');
      return el && el.files ? el.files.length : 0;
    })()`
  ).catch(() => 0);
  return !!count;
}

async function injectCoverFiles(call, cover) {
  const mime = /\.png$/i.test(cover.path)
    ? 'image/png'
    : /\.webp$/i.test(cover.path)
      ? 'image/webp'
      : 'image/jpeg';
  const base64 = fs.readFileSync(cover.path).toString('base64');
  const count = await evalJs(
    call,
    `(async () => {
      const el = document.querySelector('input[data-wb-cover-input="1"]');
      if (!el) return 0;
      const bin = atob(${JSON.stringify(base64)});
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], ${JSON.stringify(cover.name || 'cover.jpg')}, { type: ${JSON.stringify(mime)} }));
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.files.length;
    })()`
  ).catch(() => 0);
  return !!count;
}

/** 没有可用自定义封面时，直接沿用系统推荐封面并点「设置」 */
async function acceptRecommendedCover(call, ctx, reason, level) {
  ctx.log(reason + '，使用系统推荐封面', level || 'warn');
  const confirmed = await clickModalText(call, COVER_CONFIRM_RE);
  if (confirmed) {
    ctx.log('已确认封面：' + confirmed);
    await sleep(800);
    return true;
  }
  ctx.log('没有找到封面确认按钮，关闭封面弹窗', 'warn');
  await closeCoverDialog(call);
  return false;
}

/** 精确匹配比例：只有任务里确实存在该比例的封面变体才上传，否则沿用系统推荐封面 */
function pickExactCover(covers, ratio) {
  if (!ratio) return null;
  return (covers || []).find((item) => item && item.path && (item.ratio || 'original') === ratio) || null;
}

/**
 * 读取封面弹窗的步骤与底部按钮。
 * 新版弹窗是「设置横封面」→「设置竖封面」两步，步骤节点带 active 类。
 */
async function coverModalState(call) {
  return evalJs(
    call,
    `(() => {
      ${MODAL_HELPERS}
      const scopes = modalScopes();
      const root =
        scopes.find((scope) => /设置\\s*(横|竖)封面|上传封面|封面检测|封面预览/.test(scope.innerText || '')) ||
        scopes[scopes.length - 1] ||
        document.body;
      const activeCls = (el) => {
        const pat = /(^|[\\s_-])active([\\s_-]|$)/i;
        if (pat.test(String(el.className || ''))) return true;
        return Array.from(el.children).some((child) => pat.test(String(child.className || '')));
      };
      const found = [];
      let order = 0;
      Array.from(root.querySelectorAll('[class*="step"], [class*="Step"]')).forEach((el) => {
        if (!modalVisible(el)) return;
        const text = (el.innerText || '').trim();
        if (!text || text.length > 24) return;
        const hasH = /设置\\s*横封面/.test(text);
        const hasV = /设置\\s*竖封面/.test(text);
        // 同时包含两步的是外层容器，只保留单个步骤节点
        if (hasH === hasV) return;
        found.push({
          ori: hasH ? '横' : '竖',
          text: hasH ? '设置横封面' : '设置竖封面',
          active: activeCls(el),
          depth: el.querySelectorAll('*').length,
          order: order++
        });
      });
      const steps = [];
      found.forEach((item) => {
        const idx = steps.findIndex((s) => s.ori === item.ori);
        if (idx < 0) steps.push(item);
        else if (item.depth < steps[idx].depth) steps[idx] = Object.assign({}, item, { active: item.active || steps[idx].active });
        else if (item.active) steps[idx].active = true;
      });
      steps.sort((a, b) => a.order - b.order);
      const buttons = Array.from(root.querySelectorAll('button, [role="button"]'))
        .filter(modalVisible)
        .map((el) => ({
          text: (el.innerText || '').trim(),
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          primary: /primary/i.test(String(el.className || ''))
        }))
        .filter((item) => item.text && item.text.length <= 16);
      return { modal: scopes.length > 0, steps, buttons };
    })()`
  ).catch(() => null);
}

async function waitForActiveStep(call, ori, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await coverModalState(call);
    const steps = (state && state.steps) || [];
    if (!steps.length) return false;
    const active = steps.find((item) => item.active);
    if (active && active.ori === ori) return true;
    await sleep(400);
  }
  return false;
}

/** 只点弹窗底部的按钮，避免误点顶部的步骤标签 */
async function clickModalButton(call, re) {
  return evalJs(
    call,
    `(() => {
      ${MODAL_HELPERS}
      const re = new RegExp(${JSON.stringify(re.source)}, ${JSON.stringify(re.flags.replace(/g/g, ''))});
      const scopes = modalScopes();
      if (!scopes.length) scopes.push(document.body);
      const hits = [];
      const push = (el) => {
        if (!modalVisible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        const text = (el.innerText || '').trim();
        if (!text || text.length > 16 || !re.test(text)) return;
        hits.push({
          el,
          text,
          primary: /primary/i.test(String(el.className || ''))
        });
      };
      scopes.forEach((scope) => {
        Array.from(
          scope.querySelectorAll('[class*="buttons"], [class*="Buttons"], [class*="footer"], [class*="Footer"]')
        )
          .filter(modalVisible)
          .forEach((box) => Array.from(box.querySelectorAll('button, [role="button"]')).forEach(push));
      });
      if (!hits.length) {
        scopes.forEach((scope) => Array.from(scope.querySelectorAll('button, [role="button"]')).forEach(push));
      }
      if (!hits.length) return '';
      const hit = hits.find((item) => item.primary) || hits[hits.length - 1];
      hit.el.click();
      return hit.text;
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

/** 把封面文件写入当前步骤的上传控件，返回是否成功 */
async function uploadCoverToModal(call, ctx, cover, slot) {
  const label = slotLabel(slot);
  let accept = await markCoverInput(call);
  if (!accept) {
    const tab = await clickModalText(call, /上传封面|本地上传|上传图片|自定义封面/);
    if (tab) {
      ctx.log(label + '：已切换封面上传入口 ' + tab);
      await sleep(1000);
      accept = await markCoverInput(call);
    }
  }
  if (!accept) {
    const diag = await evalJs(
      call,
      `(() => {
        ${MODAL_HELPERS}
        return {
          modals: modalScopes().length,
          fileInputs: document.querySelectorAll('input[type=file]').length,
          imageInputs: document.querySelectorAll('input[type=file][accept*="image"]').length
        };
      })()`
    ).catch(() => null);
    ctx.log(label + '：封面弹窗里没有找到图片上传控件 · 诊断 ' + JSON.stringify(diag), 'warn');
    return { ok: false, reason: '没有可用的自定义封面上传入口' };
  }

  const nodeId = await markedCoverNodeId(call);
  if (!nodeId) return { ok: false, reason: '封面图片控件不可用' };

  await call('DOM.setFileInputFiles', { nodeId, files: [cover.path] });
  if (!(await coverFilesReady(call))) {
    // 部分版本 input 被隐藏时 setFileInputFiles 不生效，退回页面侧注入文件
    await injectCoverFiles(call, cover);
  }
  if (!(await coverFilesReady(call))) {
    return { ok: false, reason: '封面文件没有写入上传控件' };
  }
  ctx.log(label + '：已上传封面 ' + cover.name + '（' + ratioLabel(cover.ratio) + '）');
  return { ok: true };
}

/**
 * 单个弹窗内依次完成两步：横封面 →「设置横封面」→ 竖封面 →「完成」。
 * 有对应比例的封面变体才上传，没有就沿用系统推荐封面；
 * 确认横封面步骤切走后才会继续竖封面，尽量保证两个封面都设置后再点「完成」。
 */
async function driveCoverModal(call, ctx, isImage, pageSlots) {
  const initial = await coverModalState(call);
  const steps = (initial && initial.steps) || [];
  const advance = initial && initial.buttons.find((item) => /^设置(横|竖)封面$/.test(item.text));
  let order;
  if (steps.length >= 2) order = steps.map((item) => item.ori);
  else if (advance) order = advance.text.indexOf('横') >= 0 ? ['横', '竖'] : ['竖'];
  else return fillSingleCover(call, ctx, isImage, (pageSlots || [])[0] || null);

  const hasCovers = Array.isArray(ctx.covers) && ctx.covers.length > 0;
  let applied = false;
  let interrupted = false;

  // 弹窗默认停在横封面；若当前激活的不是第一步，先点顶部步骤标签切回
  if (steps.length) {
    const active = steps.find((item) => item.active);
    if (active && active.ori !== order[0]) {
      const switched = await clickModalText(call, new RegExp('^设置' + order[0] + '封面$'));
      if (switched) {
        ctx.log('已切换到「设置' + order[0] + '封面」');
        await sleep(800);
      }
    }
  }

  for (let i = 0; i < order.length; i++) {
    const ori = order[i];
    const isLast = i === order.length - 1;
    const slot =
      (pageSlots || []).find((item) => item.ori === ori) || { ori, ratio: ori === '横' ? '4:3' : '3:4' };
    const cover = pickExactCover(ctx.covers, slot.ratio);
    if (cover) {
      const res = await uploadCoverToModal(call, ctx, cover, slot);
      applied = applied || res.ok;
      if (!res.ok) ctx.log(slotLabel(slot) + '：' + res.reason + '，沿用系统推荐封面', 'warn');
      await sleep(2500);
    } else {
      ctx.log(
        slotLabel(slot) + '：' + (hasCovers ? '没有该比例的封面变体，' : '未设置自定义封面，') + '沿用系统推荐封面',
        'info'
      );
    }

    if (!isLast) {
      const adv = await clickModalButton(call, /^设置(横|竖)封面$/);
      if (!adv) {
        ctx.log('未找到「设置' + ori + '封面」按钮，停止后续封面设置', 'warn');
        interrupted = true;
        break;
      }
      ctx.log(slotLabel(slot) + '：已点击「' + adv + '」，进入下一步');
      if (steps.length) {
        if (!(await waitForActiveStep(call, order[i + 1], 6000))) {
          const retry = await clickModalButton(call, /^设置(横|竖)封面$/);
          if (!retry || !(await waitForActiveStep(call, order[i + 1], 5000))) {
            ctx.log('未能确认切换到「设置' + order[i + 1] + '封面」，停止后续封面设置', 'warn');
            interrupted = true;
            break;
          }
        }
      } else {
        await sleep(1200);
      }
      // 步骤类名切换后留一点时间给面板渲染，避免把下一张图传进上一个封面的控件
      await sleep(400);
      continue;
    }

    const done = await clickModalButton(call, /^(完成|设置|确定|确认)$/);
    if (done) {
      ctx.log('封面设置完成：已点击「' + done + '」');
      applied = true;
    } else {
      ctx.log('未找到封面「完成」按钮', 'warn');
    }
  }

  if (interrupted) {
    const done = await clickModalButton(call, /^(完成|设置|确定|确认)$/);
    if (done) ctx.log('封面未全部设置，已点击「' + done + '」结束', 'warn');
  }
  return applied;
}

/** 旧版单封面弹窗：上传后直接点「设置」/「完成」 */
async function fillSingleCover(call, ctx, isImage, slot) {
  const label = slotLabel(slot);
  const hasCovers = Array.isArray(ctx.covers) && ctx.covers.length > 0;
  const cover = hasCovers ? pickCover(ctx.covers, isImage, (slot && slot.ratio) || '') : null;
  if (!cover) {
    return hasCovers
      ? acceptRecommendedCover(call, ctx, label + ' 没有可用封面变体')
      : acceptRecommendedCover(call, ctx, '排期未设置自定义封面', 'info');
  }
  ctx.log(label + '：按 ' + ((slot && slot.ratio) || '默认') + ' 比例选用 ' + ratioLabel(cover.ratio));

  const res = await uploadCoverToModal(call, ctx, cover, slot);
  if (!res.ok) return acceptRecommendedCover(call, ctx, label + ' ' + res.reason);
  await sleep(2500);

  const done = (await clickModalButton(call, COVER_CONFIRM_RE)) || (await clickModalText(call, COVER_CONFIRM_RE));
  if (done) {
    ctx.log('封面设置完成：已点击「' + done + '」');
    return true;
  }
  ctx.log(label + '：未找到封面确认按钮，请查看截图确认封面是否已设置', 'warn');
  return true;
}

/** 在发布页设置封面：打开一次弹窗，按弹窗内的横/竖两步依次设置 */
async function applyCover(call, ctx, isImage) {
  await waitForCoverReady(call, ctx, 90000);
  const slots = await listCoverSlots(call);
  if (slots.length) ctx.log('检测到 ' + slots.length + ' 个封面槽位：' + slots.map(slotLabel).join('、'));

  const opened = await openCoverEditor(call, ctx);
  if (!opened) return false;

  // 上传区域本身可能触发系统文件框，拦掉以免挡住后续操作
  await call('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
  let applied = false;
  try {
    applied = await driveCoverModal(call, ctx, isImage, slots);
  } finally {
    await call('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }

  if (!(await waitCoverEditorClosed(call, 8000))) {
    const closed = await closeCoverDialog(call);
    ctx.log('封面弹窗未自动关闭' + (closed ? '，已点击：' + closed : ''), 'warn');
  }
  await sleep(600);
  return applied;
}

/** 上传后编辑区是异步渲染的，等标题或正文任一字段真正出现再填 */
async function waitForEditFields(call, timeoutMs, ctx) {
  const started = Date.now();
  let last = { hasTitle: false, hasEditor: false };
  let delay = POLL_MIN_MS;
  if (ctx) ctx.log('等待「作品描述」编辑区渲染…');
  while (Date.now() - started < timeoutMs) {
    const state = await evalJs(
      call,
      `(() => {
        ${FIELD_HELPERS}
        return { hasTitle: !!findTitleField(), hasEditor: !!findDescField() };
      })()`
    );
    if (state) last = state;
    // 描述编辑区是必填目标，标题框可能先渲染，等描述区出现再返回
    if (last.hasEditor) return last;
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
  return last;
}

async function fillTitle(call, title, ctx) {
  const value = String(title || '').slice(0, TITLE_MAX);
  const result = await evalJs(
    call,
    `(() => {
      ${FIELD_HELPERS}
      const el = findTitleField();
      if (!el) return 'missing';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === ${JSON.stringify(value)} ? 'ok' : 'unconfirmed';
    })()`
  );
  if (result === 'missing') {
    ctx.log('未找到独立标题输入框，标题并入作品描述', 'warn');
    return false;
  }
  if (result === 'unconfirmed') ctx.log('标题已写入，但页面未确认输入值', 'warn');
  else ctx.log('已填写作品标题');
  return true;
}

async function fillDescription(call, text, ctx) {
  const value = String(text || '');
  if (!value) return false;

  const focus = await evalJs(
    call,
    `(() => {
      ${FIELD_HELPERS}
      const el = findDescField();
      if (!el) return 'missing';
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value ? 'textarea' : 'missing';
      }
      el.focus();
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (err) { /* 光标定位失败时仍尝试输入 */ }
      return 'editable';
    })()`
  );

  if (focus === 'missing') throw new Error('没有找到「作品描述」输入框，页面可能已改版，请查看截图');

  if (focus === 'editable') {
    try {
      await call('Input.insertText', { text: value });
    } catch (err) {
      /* 下面统一校验并兜底 */
    }
    const head = value.replace(/\s+/g, '').slice(0, 8);
    const filled = await evalJs(
      call,
      `(() => {
        ${FIELD_HELPERS}
        const el = findDescField();
        if (!el) return '';
        return String(el.innerText || el.textContent || '').replace(/\\s+/g, '');
      })()`
    );
    if (!filled || (head && filled.indexOf(head) < 0)) {
      const retried = await evalJs(
        call,
        `(() => {
          ${FIELD_HELPERS}
          const el = findDescField();
          if (!el) return false;
          el.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (err) { /* 忽略 */ }
          let ok = false;
          try { ok = document.execCommand('insertText', false, ${JSON.stringify(value)}); } catch (err) { /* 忽略 */ }
          if (!ok) el.textContent = ${JSON.stringify(value)};
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
          return true;
        })()`
      );
      if (!retried) throw new Error('「作品描述」编辑区无法写入内容，请查看截图');
    }
  }

  ctx.log(focus === 'textarea' ? '已填写作品描述' : '已填写作品描述（富文本编辑区）');
  return true;
}

async function waitPublishReady(call, ctx) {
  const started = Date.now();
  let lastLog = 0;
  let delay = 2000;
  for (;;) {
    const state = await pageState(call);
    if (state.failed) throw new Error('抖音页面提示上传失败，请查看截图');
    if (state.hasPublish && !state.publishDisabled && !state.uploading) {
      ctx.log('发布按钮已就绪');
      return state;
    }
    if (Date.now() - started > WAIT_FORM_MS) throw new Error('等待发布按钮就绪超时（15 分钟）');
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(state.uploading ? '上传/转码尚未完成…' : '等待发布按钮可用…');
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
}

async function clickPublish(call, ctx) {
  const clicked = await evalJs(
    call,
    `(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !b.disabled;
      });
      const target = buttons.find((b) => (b.innerText || '').trim() === '发布')
        || buttons.find((b) => /^发布$/.test((b.innerText || '').trim()));
      if (!target) return '';
      target.click();
      return (target.innerText || '').trim();
    })()`
  );
  if (!clicked) throw new Error('没有找到可点击的「发布」按钮');
  ctx.log('已点击发布按钮');

  await sleep(1200);
  const confirmed = await evalJs(
    call,
    `(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .semi-modal, .modal, .ant-modal'));
      const buttons = [];
      dialogs.forEach((d) => buttons.push.apply(buttons, Array.from(d.querySelectorAll('button'))));
      const target = buttons.find((b) => /^(确认发布|确定发布|确认|发布)$/.test((b.innerText || '').trim()));
      if (!target) return '';
      target.click();
      return (target.innerText || '').trim();
    })()`
  ).catch(() => '');
  if (confirmed) ctx.log('已点击二次确认：' + confirmed);
}

async function waitPublished(call, ctx) {
  const started = Date.now();
  while (Date.now() - started < WAIT_PUBLISH_MS) {
    const state = await pageState(call);
    if (state.url.indexOf(MANAGE_PATH) >= 0 || /发布成功|作品发布成功|发布完成/.test(state.text || '')) {
      ctx.log('页面提示发布成功');
      return true;
    }
    await sleep(1500);
  }
  ctx.log('未捕获到明确的发布成功提示，转交作品列表核验', 'warn');
  return false;
}

function normalizeTitle(text) {
  return String(text || '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

async function verifyWork(title, ctx, kind) {
  const cookie = cookieHeaderForDouyin();
  if (!cookie) {
    ctx.log('没有已保存的 Cookie，跳过作品列表核验', 'warn');
    return null;
  }
  const wanted = normalizeTitle(title);
  const started = Date.now();
  while (Date.now() - started < VERIFY_MS) {
    try {
      const works = await douyinCollector.fetchRecentWorks(cookie, 2);
      const nowSec = Math.floor(Date.now() / 1000);
      const hit = works.find((item) => {
        const desc = normalizeTitle(item.desc || item.item_title || item.caption || '');
        if (!desc || !wanted) return false;
        if (!(desc.indexOf(wanted) >= 0 || wanted.indexOf(desc) >= 0)) return false;
        return !item.create_time || nowSec - Number(item.create_time) < 20 * 60;
      });
      if (hit && hit.aweme_id) {
        ctx.log('作品列表已匹配到新作品：' + hit.aweme_id);
        return {
          workId: String(hit.aweme_id),
          publishUrl: (kind === 'image' ? 'https://www.douyin.com/note/' : 'https://www.douyin.com/video/') + hit.aweme_id
        };
      }
    } catch (err) {
      ctx.log('作品列表核验失败：' + err.message, 'warn');
    }
    await sleep(15000);
  }
  return null;
}

async function captureScreenshot(call, ctx, name) {
  try {
    // 失败截图不能拖住任务收尾，页面卡死时最多等 10 秒
    const shot = await call('Page.captureScreenshot', { format: 'png' }, 10000);
    if (shot && shot.data) ctx.saveScreenshot(name, shot.data);
  } catch (err) {
    /* 截图失败不阻塞发布 */
  }
}

function composeDescription(task) {
  const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
  const body = String(task.description || '').trim();
  const tagLine = tags.map((t) => '#' + String(t).replace(/^#/, '')).join(' ');
  // 抖音作品描述上限 1000 字，超出会被截断或拒绝
  return [body, tagLine].filter(Boolean).join('\n').slice(0, 1000);
}

async function run(ctx) {
  const task = ctx.task;
  if (task.platform !== PLATFORM) throw new Error('该任务不是抖音平台');
  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') {
    throw httpError(409, '抖音登录窗口正在进行，请完成后再发布');
  }

  browserLogin.acquire('publish-douyin');
  let browser = null;
  let call = null;

  try {
    ctx.log('启动本地浏览器（专用 profile）');
    browser = await browserLogin.ensureBrowser({
      url: UPLOAD_URL,
      headless: process.env.WB_PUBLISH_HEADLESS === '1'
    });

    const targets = await browserLogin.httpJson(browser.port, '/json/list');
    const page =
      (browser.target && browser.target.webSocketDebuggerUrl ? browser.target : null) ||
      targets.find((t) => t.type === 'page' && /creator\.douyin\.com/.test(t.url || '')) ||
      targets.find((t) => t.type === 'page' && !/^devtools:/.test(t.url || ''));
    if (!page || !page.webSocketDebuggerUrl) throw new Error('未找到可用的浏览器标签页');

    // 投稿页上传后会跳转到 content/post/video，旧 DevTools 会话偶尔会收不到响应；
    // 调用超时或连接断开时重连当前创作者页，避免整条任务静默挂死。
    let live = null;
    const onEvent = (msg) => {
      // 原生 JS 对话框会冻结页面，Runtime.evaluate 会一直等不到结果；自动取消
      if (msg && msg.method === 'Page.javascriptDialogOpening') {
        ctx.log('页面弹出浏览器对话框，已自动取消：' + ((msg.params && msg.params.message) || ''), 'warn');
        if (live) live('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
      }
    };
    const connectPage = async (target) => {
      const c = await browserLogin.cdpConnect(target.webSocketDebuggerUrl, onEvent);
      await c('Page.enable', {});
      await c('Runtime.enable', {});
      await c('Network.enable', {});
      return c;
    };
    live = await connectPage(page);
    call = async function call(method, params, timeoutMs) {
      try {
        return await live(method, params, timeoutMs);
      } catch (err) {
        const text = err && err.message ? err.message : '';
        if (!/超时|连接已关闭|WebSocket/.test(text)) throw err;
        ctx.log('DevTools 会话无响应（' + text + '），尝试重新连接发布页面…', 'warn');
        try { live.close(); } catch (e) { /* 旧连接可能已断开 */ }
        const list = await browserLogin.httpJson(browser.port, '/json/list');
        const next =
          list.find((t) => t.id === page.id) ||
          list.find((t) => t.type === 'page' && /creator\.douyin\.com/.test(t.url || ''));
        if (!next || !next.webSocketDebuggerUrl) {
          throw new Error('发布页面已关闭或不可用，请重新执行任务');
        }
        live = await connectPage(next);
        ctx.log('已重新连接发布页面，继续执行');
        try {
          return await live(method, params, timeoutMs);
        } catch (retryErr) {
          const retryText = retryErr && retryErr.message ? retryErr.message : '';
          // 重连后仍然超时，说明是页面渲染进程卡住，重试已无意义，直接给出可读的失败原因
          if (/超时|连接已关闭|WebSocket/.test(retryText)) {
            throw new Error('抖音页面无响应（重连后仍无法执行），请查看浏览器窗口后重新执行任务');
          }
          throw retryErr;
        }
      }
    };
    call.close = () => { try { live.close(); } catch (err) { /* 已关闭 */ } };
    await call('Page.navigate', { url: UPLOAD_URL });
    ctx.log('已打开抖音投稿页');
    await sleep(1500);

    const isImage = ctx.kind === 'image';
    await dismissDraftDialog(call, ctx);
    await ensureFileInputs(call, ctx);
    await dismissDraftDialog(call, ctx);

    if (isImage) {
      const images = (ctx.imagePaths || []).filter(Boolean);
      if (!images.length) throw new Error('任务没有图片素材');
      await selectImageTab(call, ctx);
      await dismissDraftDialog(call, ctx);
      ctx.log('开始上传图片：' + images.length + ' 张');
      const attachedImages = await attachImages(call, images, ctx);
      if (attachedImages && attachedImages.failed) throw new Error('抖音页面提示图片上传失败');
      ctx.log('图片已进入上传流程');
      await waitImagesSettled(call, ctx, images.length);
      ctx.log('页面已进入图文编辑态');
    } else {
      if (!ctx.videoPath) throw new Error('任务没有视频素材');
      ctx.log('开始上传视频：' + ctx.video.name);
      const attached = await attachVideo(call, ctx.videoPath, ctx);
      if (attached && attached.failed) throw new Error('抖音页面提示上传失败');
      ctx.log('视频已进入上传流程');
      await waitUploadSettled(call, ctx);
      ctx.log('页面已进入作品编辑态');
    }

    const fields = await waitForEditFields(call, 60000, ctx);
    if (!fields || (!fields.hasTitle && !fields.hasEditor)) {
      throw new Error('上传后没有找到「作品描述」编辑区，请查看截图确认抖音页面是否已改版');
    }
    const titleUsed = fields.hasTitle ? await fillTitle(call, task.title, ctx) : false;
    if (!titleUsed) ctx.log('未找到独立标题输入框，标题并入作品描述', 'warn');
    const description = composeDescription(task);
    if (fields.hasEditor) {
      const text = titleUsed
        ? description
        : [String(task.title || '').slice(0, TITLE_MAX), description].filter(Boolean).join('\n');
      if (text) await fillDescription(call, text, ctx);
    } else if (description) {
      throw new Error('没有找到「作品描述」输入框，无法填写简介，请查看截图');
    }
    if (Array.isArray(task.tags) && task.tags.length) {
      ctx.log('话题已合并进简介：' + task.tags.map((t) => '#' + t).join(' '));
    }

    try {
      await applyCover(call, ctx, isImage);
    } catch (err) {
      ctx.log('封面上传失败，继续发布：' + err.message, 'warn');
    }

    await waitPublishReady(call, ctx);
    await captureScreenshot(call, ctx, 'before-publish');

    await clickPublish(call, ctx);
    await waitPublished(call, ctx);
    const verified = await verifyWork(task.title, ctx, isImage ? 'image' : 'video');
    if (verified) {
      return {
        status: 'published',
        workId: verified.workId,
        publishUrl: verified.publishUrl,
        message: '已发布并核验作品链接'
      };
    }
    return {
      status: 'submitted',
      message: '已点击发布，但 5 分钟内未在作品列表核验到，请稍后确认'
    };
  } catch (err) {
    if (call) await captureScreenshot(call, ctx, 'failed');
    throw err;
  } finally {
    if (call) {
      if (browser && browser.reused && browser.target) {
        try { await call('Page.close', {}); } catch (err) { /* 页面可能已关闭 */ }
      }
      call.close();
    }
    if (browser && !browser.reused) {
      try { await browserLogin.closeBrowser(browser); } catch (err) { /* 浏览器可能已关闭 */ }
    }
    browserLogin.release('publish-douyin');
  }
}

module.exports = { key: PLATFORM, supported: true, run };
