'use strict';

/**
 * 抖音发布适配器：用专用浏览器 profile 操作创作者中心页面。
 *
 * 页面选择器会随抖音改版失效，这里的定位优先用 placeholder / 按钮文案等稳定特征，
 * 任何一步找不到目标都会中止并保留日志与截图，绝不盲点。
 */

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function evalJs(call, expression, timeoutMs) {
  return call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: timeoutMs || 15000
  }).then((res) => {
    if (res && res.exceptionDetails) {
      const text = res.exceptionDetails.text || '页面脚本执行失败';
      throw new Error(text);
    }
    return res && res.result ? res.result.value : null;
  });
}

function pageState(call) {
  return evalJs(
    call,
    `(() => {
      ${FIELD_HELPERS}
      const text = (document.body && document.body.innerText || '').slice(0, 12000);
      const inputs = Array.from(document.querySelectorAll('input[type=file]'));
      const title = findTitleField();
      const editor = findDescField();
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
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
        hasForm: /作品描述|作品标题/.test(text) && (!!title || !!editor),
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
      const text = (document.body && document.body.innerText || '').slice(0, 12000);
      const inputs = Array.from(document.querySelectorAll('input[type=file]'));
      const title = findTitleField();
      const editor = findDescField();
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) => {
        const r = b.getBoundingClientRect();
        const s = getComputedStyle(b);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
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
        hasForm: /作品描述|作品标题/.test(text) && (!!title || !!editor),
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
  for (;;) {
    const state = await pageState(call);
    if (state.failed) throw new Error('抖音页面提示上传失败，请查看截图');
    if (looksLoggedOut(state)) throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
    // 必须等「作品描述」编辑区真正出现，避免被页面上其他临时 contenteditable 提前骗过
    const fallback = Date.now() - started > 60000 && (state.hasTitle || state.hasEditor);
    if ((state.hasForm || fallback) && (!state.uploading || state.uploaded || Date.now() - started > 30000)) {
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
    await sleep(2000);
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
  for (;;) {
    const state = await pageImageState(call);
    if (state.failed) throw new Error('抖音页面提示图片上传失败，请查看截图');
    if (looksLoggedOut(state)) throw httpError(401, '抖音登录态已失效，请到「连接设置」重新一键登录');
    if (!state.uploading && (state.hasForm || state.thumbs >= expected)) {
      return state;
    }
    if (Date.now() - started > WAIT_FORM_MS) {
      throw new Error('等待图片上传完成超时（15 分钟）');
    }
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(state.uploading ? `图片上传处理中（已识别 ${state.thumbs} 张）…` : '等待页面进入图文编辑态…');
    }
    await sleep(2000);
  }
}

/** 上传后编辑区是异步渲染的，等标题或正文任一字段真正出现再填 */
async function waitForEditFields(call, timeoutMs) {
  const started = Date.now();
  let last = { hasTitle: false, hasEditor: false };
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
    await sleep(1000);
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
    await sleep(2000);
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
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    if (shot && shot.data) ctx.saveScreenshot(name, shot.data);
  } catch (err) {
    /* 截图失败不阻塞发布 */
  }
}

function composeDescription(task) {
  const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
  const body = String(task.description || '').trim();
  const tagLine = tags.map((t) => '#' + String(t).replace(/^#/, '')).join(' ');
  return [body, tagLine].filter(Boolean).join('\n');
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
  let keepBrowser = false;

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

    call = await browserLogin.cdpConnect(page.webSocketDebuggerUrl);
    await call('Page.enable', {});
    await call('Runtime.enable', {});
    await call('Network.enable', {});
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

    const fields = await waitForEditFields(call, 60000);
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

    await waitPublishReady(call, ctx);
    await captureScreenshot(call, ctx, 'before-publish');

    if (task.mode !== 'auto') {
      keepBrowser = true;
      return {
        status: 'needs_confirm',
        message: '表单已填好，请在浏览器窗口确认后手动点「发布」'
      };
    }

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
      if (!keepBrowser && browser && browser.reused && browser.target) {
        try { await call('Page.close', {}); } catch (err) { /* 页面可能已关闭 */ }
      }
      call.close();
    }
    if (browser && !browser.reused && !keepBrowser) {
      try { await browserLogin.closeBrowser(browser); } catch (err) { /* 浏览器可能已关闭 */ }
    }
    browserLogin.release('publish-douyin');
  }
}

module.exports = { key: PLATFORM, supported: true, run };
