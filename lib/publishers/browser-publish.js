'use strict';

/**
 * 浏览器发布内核：视频号 / 快手 / B站 / 微博 / 小红书 / 知乎 共用的投稿流程。
 *
 * 各平台页面字段结构不同，这里只用「占位文案 + 可见性 + 面积」定位控件，
 * 不绑死具体 class；任何一步找不到目标都会中止并保留日志与截图，绝不盲点。
 */

const browserLogin = require('../browser-login');
const channelConnections = require('../channel-connections');

const POLL_MIN_MS = 1000;
const POLL_MAX_MS = 3000;
const NAV_WAIT_MS = 30000;
// 投稿页跳转后平台会做一轮初始化/解析，先静默等待，避免撞上渲染最忙的窗口
const RENDER_SETTLE_MS = 2500;
const WAIT_FORM_MS = 15 * 60 * 1000;
const SUBMIT_WAIT_MS = 60 * 1000;
const MAX_TITLE = 80;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function evalJs(call, expression, timeoutMs) {
  const limit = timeoutMs || 15000;
  return call(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true, timeout: limit },
    limit
  ).then((res) => {
    if (res && res.exceptionDetails) {
      throw new Error(res.exceptionDetails.text || '页面脚本执行失败');
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
          // 跳过 display:none 的模板/弹层文案，避免误判「上传失败」等隐藏提示
          if (!parent.getClientRects().length) continue;
          const chunk = node.nodeValue;
          if (chunk) out += chunk;
        }
      } catch (err) { /* 页面结构异常时降级为空文本 */ }
      return out.replace(/\\s+/g, ' ').slice(0, 12000);
    })();
  `;
}

// 部分平台（小红书）把发布按钮放在 closed shadow DOM 里，只能通过宿主元素暴露的 shadowRoot/_sr 取到
function buttonRootsExpr(cfg) {
  return `
    const roots = [document];
    ${JSON.stringify(cfg.shadowHosts || [])}.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((host) => {
          const root = host._sr || host.shadowRoot;
          if (root && roots.indexOf(root) < 0) roots.push(root);
        });
      } catch (err) { /* 宿主尚未渲染 */ }
    });
  `;
}

function fieldHelpers(cfg) {
  return `
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
      (el.getAttribute('placeholder') || '') + ' ' +
      (el.getAttribute('data-placeholder') || '') + ' ' +
      (el.getAttribute('aria-label') || '');
    const titleRe = new RegExp(${JSON.stringify(cfg.titleHintRe)});
    const descRe = new RegExp(${JSON.stringify(cfg.descHintRe)});
    const tagRe = new RegExp(${JSON.stringify(cfg.tagHintRe || '标签')});
    const findTitleField = () =>
      fieldAll('input:not([type="search"]):not([type="hidden"]):not([type="file"]), textarea')
        .find((el) => titleRe.test(fieldHint(el))) || null;
    const findDescField = () => {
      const title = findTitleField();
      const candidates = fieldAll(
        'textarea, input:not([type="search"]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"][contenteditable]'
      ).filter((el) => el !== title);
      if (!candidates.length) return null;
      const hinted = candidates.filter((el) => descRe.test(fieldHint(el)));
      const pool = hinted.length ? hinted : candidates.filter((el) => !tagRe.test(fieldHint(el)));
      pool.sort((a, b) => fieldArea(b) - fieldArea(a));
      return pool[0] || null;
    };
    const findTagField = () => ${
      cfg.useTagInput
        ? `fieldAll('input:not([type="search"]):not([type="hidden"]):not([type="file"])')
        .find((el) => tagRe.test(fieldHint(el))) || null`
        : 'null'
    };
  `;
}

function pageState(call, cfg) {
  return evalJs(
    call,
    `(() => {
      ${fieldHelpers(cfg)}
      ${pageTextExpr()}
      ${buttonRootsExpr(cfg)}
      const text = pageText;
      const inputs = Array.from(document.querySelectorAll('input[type=file]'));
      const title = findTitleField();
      const desc = findDescField();
      const buttonEls = [];
      roots.forEach((root) => {
        Array.from(root.querySelectorAll('button, [role="button"], a')).forEach((b) => {
          const r = b.getBoundingClientRect();
          const s = getComputedStyle(b);
          if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') {
            buttonEls.push(b);
          }
        });
      });
      const buttonText = (b) => (b.innerText || '').trim();
      return {
        url: location.href,
        text,
        fileInputs: inputs.length,
        hasTitle: !!title,
        hasDesc: !!desc,
        buttons: buttonEls.map(buttonText).filter(Boolean).slice(0, 200),
        ready: buttonEls
          .filter((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true')
          .map(buttonText)
          .filter(Boolean)
          .slice(0, 200),
        uploading: /上传中|上传进度|转码中|正在处理|取消上传|图片上传中|图片处理中|合成中/.test(text),
        failed: /上传失败|发布失败|投稿失败|网络异常|请检查网络/.test(text)
      };
    })()`
  );
}

function shortUrl(url) {
  return String(url || '').replace(/^https?:\/\/[^/]+/, '');
}

function looksLoggedOut(state, cfg) {
  if (!state) return false;
  if (cfg.loginUrlRe && cfg.loginUrlRe.test(state.url || '')) return true;
  if (!state.fileInputs && cfg.loginTextRe) return cfg.loginTextRe.test(String(state.text || ''));
  return false;
}

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
  if (ctx && last) ctx.log('未检测到投稿页跳转（当前：' + shortUrl(last) + '），继续等待编辑区', 'warn');
  return '';
}

// 页面跳转/重连瞬间执行上下文会被销毁，探测失败按「页面还没准备好」处理
async function safeState(call, cfg) {
  try {
    return await pageState(call, cfg);
  } catch (err) {
    return null;
  }
}

async function waitFor(call, cfg, predicate, timeoutMs, intervalMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await safeState(call, cfg);
    if (last && predicate(last)) return last;
    await sleep(intervalMs || 1000);
  }
  return last;
}

async function injectCookies(call, cfg, ctx) {
  const raw = channelConnections.getRaw(cfg.platform);
  if (!raw || !raw.enabled) return 0;

  const pairs = [];
  if (cfg.cookieMode === 'bilibili') {
    const fields = raw.fields || {};
    pairs.push(['SESSDATA', fields['SESSDATA']]);
    pairs.push(['bili_jct', fields['bili_jct']]);
    pairs.push(['DedeUserID', fields['UID']]);
  } else {
    String(raw.fields['Cookie'] || '')
      .split(';')
      .forEach((pair) => {
        const item = pair.trim();
        const idx = item.indexOf('=');
        if (idx > 0) pairs.push([item.slice(0, idx).trim(), item.slice(idx + 1)]);
      });
  }

  let count = 0;
  for (const [name, value] of pairs) {
    if (!name || !value) continue;
    try {
      await call('Network.setCookie', {
        name,
        value,
        domain: cfg.cookieDomain,
        path: '/',
        secure: true,
        sameSite: 'Lax'
      });
      count++;
    } catch (err) {
      /* 个别 Cookie 格式不被接受时跳过 */
    }
  }
  if (count && ctx) ctx.log('已注入 ' + count + ' 条 Cookie');
  return count;
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

async function clickUploadEntry(call, ctx) {
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
      // 取文本最短的命中元素，避免点到包住整块上传区的容器
      const target = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
        .filter(visible)
        .map((el) => ({ el, text: (el.innerText || '').trim() }))
        .filter((item) => item.text.length > 0 && item.text.length <= 20 && /(上传视频|添加视频|选择视频|点击上传|上传作品)/.test(item.text))
        .sort((a, b) => area(a.el) - area(b.el))[0];
      if (!target) return '';
      target.el.click();
      return target.text;
    })()`
  ).catch(() => '');
  if (clicked) ctx.log('已点击上传入口：' + clicked);
  return clicked;
}

async function ensureUploadReady(call, ctx, cfg) {
  let state = await waitFor(
    call,
    cfg,
    (s) => s.fileInputs > 0 || looksLoggedOut(s, cfg),
    20000,
    1000
  );
  if (state && state.fileInputs > 0) return state;

  if (looksLoggedOut(state, cfg)) {
    ctx.log('检测到「' + cfg.platform + '」登录态失效，尝试注入已保存的 Cookie');
    const n = await injectCookies(call, cfg, ctx);
    if (n) {
      await call('Page.navigate', { url: cfg.uploadUrl });
      state = await waitFor(
        call,
        cfg,
        (s) => s.fileInputs > 0 || looksLoggedOut(s, cfg),
        30000,
        1000
      );
      if (state && state.fileInputs > 0) return state;
    }
    throw httpError(401, '「' + cfg.platform + '」登录态已失效，请到「连接设置」更新 Cookie 后重试');
  }

  const clicked = await clickUploadEntry(call, ctx);
  if (clicked) {
    const next = await waitFor(call, cfg, (s) => s.fileInputs > 0, 10000, 1000);
    if (next && next.fileInputs > 0) return next;
    state = next || state;
  }
  if (state && looksLoggedOut(state, cfg)) {
    throw httpError(401, '「' + cfg.platform + '」登录态已失效，请到「连接设置」更新 Cookie 后重试');
  }
  throw new Error('「' + cfg.platform + '」投稿页加载超时：没有找到上传控件');
}

async function attachFiles(call, files, cfg, ctx, kind) {
  let candidates = await fileInputCandidates(call);
  if (!candidates.length) {
    await clickUploadEntry(call, ctx);
    await sleep(1200);
    candidates = await fileInputCandidates(call);
  }
  if (!candidates.length) throw new Error('「' + cfg.platform + '」没有找到上传控件');

  const wantImage = kind === 'image';
  const ranked = candidates.slice().sort((a, b) => {
    const score = (item) => {
      const accept = String(item.accept || '');
      if (!accept) return 1;
      const hit = wantImage ? /image|jpg|jpeg|png|webp/i.test(accept) : /video|mp4|mov/i.test(accept);
      return hit ? 0 : 2;
    };
    return score(a) - score(b);
  });
  for (let i = 0; i < ranked.length; i++) {
    const c = ranked[i];
    try {
      await call('DOM.setFileInputFiles', { nodeId: c.nodeId, files });
      ctx.log(`已交入第 ${i + 1} 个上传控件（${files.length} 个文件）`);
      return true;
    } catch (err) {
      ctx.log(`第 ${i + 1} 个上传控件不可用：${err.message}`, 'warn');
    }
  }
  throw new Error('「' + cfg.platform + '」素材未能交入投稿页，请检查文件格式或重试');
}

async function waitEditorReady(call, ctx, cfg) {
  const started = Date.now();
  let lastLog = 0;
  let delay = POLL_MIN_MS;
  if (cfg.uploadRouteRe) await waitForRoute(call, cfg.uploadRouteRe, NAV_WAIT_MS, ctx);
  await sleep(RENDER_SETTLE_MS);
  for (;;) {
    if (Date.now() - started > WAIT_FORM_MS) {
      throw new Error('等待「' + cfg.platform + '」投稿页编辑区超时（15 分钟），请查看截图');
    }
    const state = await safeState(call, cfg);
    if (!state) {
      await sleep(delay);
      continue;
    }
    if (state.failed) throw new Error('「' + cfg.platform + '」页面提示上传失败，请查看截图');
    if (looksLoggedOut(state, cfg)) {
      throw httpError(401, '「' + cfg.platform + '」登录态已失效，请到「连接设置」更新 Cookie 后重试');
    }
    if ((state.hasTitle || state.hasDesc) && (!state.uploading || Date.now() - started > 60000)) {
      return state;
    }
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(state.uploading ? '素材上传/转码中…' : '等待页面进入编辑态…');
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
}

async function fillTitle(call, ctx, cfg, value) {
  const text = String(value || '').slice(0, cfg.titleMax || MAX_TITLE);
  if (!text) return false;
  const result = await evalJs(
    call,
    `(() => {
      ${fieldHelpers(cfg)}
      const el = findTitleField();
      if (!el) return 'missing';
      if (el.isContentEditable) {
        el.focus();
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (err) { /* 光标定位失败时仍尝试输入 */ }
        return 'editable';
      }
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === ${JSON.stringify(text)} ? 'ok' : 'unconfirmed';
    })()`
  );
  if (result === 'editable') {
    await call('Input.insertText', { text });
    ctx.log('已填写标题');
    await sleep(300);
    return true;
  }
  if (result === 'missing') {
    ctx.log('未找到标题输入框', 'warn');
    return false;
  }
  if (result === 'unconfirmed') ctx.log('标题已写入，但页面未确认输入值', 'warn');
  else ctx.log('已填写标题');
  return true;
}

async function fillDescription(call, ctx, cfg, value) {
  const text = String(value || '');
  if (!text) return false;

  const focus = await evalJs(
    call,
    `(() => {
      ${fieldHelpers(cfg)}
      const el = findDescField();
      if (!el) return 'missing';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, ${JSON.stringify(text)});
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

  if (focus === 'missing') {
    throw new Error('没有找到「' + cfg.platform + '」简介/描述输入框，页面可能已改版，请查看截图');
  }

  if (focus === 'editable') {
    try {
      await call('Input.insertText', { text });
    } catch (err) {
      /* 下面统一校验并兜底 */
    }
    const head = text.replace(/\s+/g, '').slice(0, 8);
    const filled = await evalJs(
      call,
      `(() => {
        ${fieldHelpers(cfg)}
        const el = findDescField();
        if (!el) return '';
        return String(el.value || el.innerText || el.textContent || '').replace(/\\s+/g, '');
      })()`
    );
    if (!filled || (head && filled.indexOf(head) < 0)) {
      const retried = await evalJs(
        call,
        `(() => {
          ${fieldHelpers(cfg)}
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
          try { ok = document.execCommand('insertText', false, ${JSON.stringify(text)}); } catch (err) { /* 忽略 */ }
          if (!ok) el.textContent = ${JSON.stringify(text)};
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(text)} }));
          return true;
        })()`
      );
      if (!retried) throw new Error('「' + cfg.platform + '」描述编辑区无法写入内容，请查看截图');
    }
  }

  ctx.log(focus === 'textarea' ? '已填写简介/描述' : '已填写简介/描述（富文本编辑区）');
  return true;
}

async function fillTagInput(call, ctx, cfg, tags) {
  const list = (tags || []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
  if (!list.length) return false;

  const focus = await evalJs(
    call,
    `(() => {
      ${fieldHelpers(cfg)}
      const el = findTagField();
      if (!el) return 'missing';
      el.focus();
      return 'ok';
    })()`
  );
  if (focus === 'missing') {
    ctx.log('未找到标签输入框，话题标签已跳过', 'warn');
    return false;
  }

  for (const tag of list) {
    await call('Input.insertText', { text: tag });
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await sleep(350);
  }
  ctx.log('已填写标签：' + list.map((t) => '#' + t.replace(/^#/, '')).join(' '));
  return true;
}

async function waitPublishReady(call, ctx, cfg) {
  const started = Date.now();
  let lastLog = 0;
  let delay = 2000;
  for (;;) {
    if (Date.now() - started > WAIT_FORM_MS) {
      throw new Error('等待「' + cfg.platform + '」发布按钮就绪超时（15 分钟）');
    }
    const state = await safeState(call, cfg);
    if (!state) {
      await sleep(delay);
      continue;
    }
    if (state.failed) throw new Error('「' + cfg.platform + '」页面提示发布失败，请查看截图');
    const hit = (state.ready || []).some((text) => cfg.publishButtons.indexOf(text) >= 0);
    if (hit && !state.uploading) return state;
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(state.uploading ? '上传/转码尚未完成…' : '等待发布按钮可用…');
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.25), POLL_MAX_MS);
  }
}

async function clickPublish(call, ctx, cfg) {
  const clicked = await evalJs(
    call,
    `(() => {
      ${buttonRootsExpr(cfg)}
      const wanted = ${JSON.stringify(cfg.publishButtons)};
      const buttons = [];
      roots.forEach((root) => {
        Array.from(root.querySelectorAll('button, [role="button"]')).forEach((b) => {
          const r = b.getBoundingClientRect();
          const s = getComputedStyle(b);
          if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') buttons.push(b);
        });
      });
      const target = buttons.find((b) => {
        const text = (b.innerText || '').trim();
        return wanted.indexOf(text) >= 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
      });
      if (!target) return '';
      target.click();
      return (target.innerText || '').trim();
    })()`
  );
  if (!clicked) throw new Error('没有找到可点击的「发布」按钮（可能需要先完成必填项，或页面已改版）');
  ctx.log('已点击「' + clicked + '」按钮');
}

/** 按文本精确/模糊点击页面元素（分区、领域等下拉选项用） */
async function clickMatch(call, source, exact) {
  try {
    return await evalJs(
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
        const re = new RegExp(${JSON.stringify(source)});
        const hit = Array.from(document.querySelectorAll('button, [role="button"], div, span, li, label, a'))
          .filter(visible)
          .map((el) => ({ el, text: (el.innerText || '').trim() }))
          .filter((item) => item.text && item.text.length <= 24 && (${exact ? `item.text === ${JSON.stringify(source)}` : 're.test(item.text)'}))
          .sort((a, b) => area(a.el) - area(b.el))[0];
        if (!hit) return '';
        hit.el.click();
        return hit.text;
      })()`
    );
  } catch (err) {
    return '';
  }
}

async function waitSubmitResult(call, ctx, cfg, beforeUrl) {
  const started = Date.now();
  while (Date.now() - started < SUBMIT_WAIT_MS) {
    const state = await safeState(call, cfg);
    if (state && cfg.successRe && cfg.successRe.test(String(state.text || ''))) {
      ctx.log('页面提示发布成功');
      return true;
    }
    if (state && beforeUrl && state.url && state.url !== beforeUrl) {
      ctx.log('页面已跳转：' + shortUrl(state.url));
      return true;
    }
    await sleep(1500);
  }
  return false;
}

async function captureScreenshot(call, ctx, name) {
  try {
    const shot = await call('Page.captureScreenshot', { format: 'png' }, 10000);
    if (shot && shot.data) ctx.saveScreenshot(name, shot.data);
  } catch (err) {
    /* 截图失败不阻塞发布 */
  }
}

/** 建立带自动重连的 CDP 会话 */
async function openSession(ctx, cfg, uploadUrl) {
  const browser = await browserLogin.ensureBrowser({
    url: uploadUrl || cfg.uploadUrl,
    headless: process.env.WB_PUBLISH_HEADLESS === '1'
  });
  const targets = await browserLogin.httpJson(browser.port, '/json/list');
  const host = String(cfg.cookieDomain || '').replace(/^\./, '');
  const page =
    (browser.target && browser.target.webSocketDebuggerUrl ? browser.target : null) ||
    targets.find((t) => t.type === 'page' && t.url && t.url.indexOf(host) >= 0) ||
    targets.find((t) => t.type === 'page' && !/^devtools:/.test(t.url || ''));
  if (!page || !page.webSocketDebuggerUrl) throw new Error('未找到可用的浏览器标签页');

  let live = null;
  const onEvent = (msg) => {
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

  const call = async function call(method, params, timeoutMs) {
    try {
      return await live(method, params, timeoutMs);
    } catch (err) {
      const text = err && err.message ? err.message : '';
      if (!/超时|连接已关闭|WebSocket/.test(text)) throw err;
      ctx.log('DevTools 会话无响应（' + text + '），尝试重新连接投稿页…', 'warn');
      try { live.close(); } catch (e) { /* 旧连接可能已断开 */ }
      const list = await browserLogin.httpJson(browser.port, '/json/list');
      const next =
        list.find((t) => t.id === page.id) ||
        list.find((t) => t.type === 'page' && t.url && t.url.indexOf(host) >= 0);
      if (!next || !next.webSocketDebuggerUrl) {
        throw new Error('投稿页面已关闭或不可用，请重新执行任务');
      }
      live = await connectPage(next);
      ctx.log('已重新连接投稿页面，继续执行');
      try {
        return await live(method, params, timeoutMs);
      } catch (retryErr) {
        const retryText = retryErr && retryErr.message ? retryErr.message : '';
        if (/超时|连接已关闭|WebSocket/.test(retryText)) {
          throw new Error('「' + cfg.platform + '」页面无响应（重连后仍无法执行），请查看浏览器窗口后重新执行任务');
        }
        throw retryErr;
      }
    }
  };
  call.close = () => { try { live.close(); } catch (err) { /* 已关闭 */ } };

  return {
    browser,
    page,
    call,
    closePage: async () => {
      try { await call('Page.close', {}); } catch (err) { /* 页面可能已关闭 */ }
    },
    closeBrowser: async () => {
      try { await browserLogin.closeBrowser(browser); } catch (err) { /* 浏览器可能已关闭 */ }
    }
  };
}

/**
 * 通用投稿流程。cfg 由各平台适配器提供：
 *  platform / uploadUrl | uploadUrls / cookieDomain / cookieMode / loginUrlRe / loginTextRe
 *  kinds / maxImages / titleHintRe / descHintRe / tagHintRe / useTagInput / titleMax / descFirst
 *  shadowHosts / preparePage / publishButtons / successRe / uploadRouteRe
 *  compose / onAttached / prePublish
 */
async function runWithConfig(ctx, cfg) {
  const task = ctx.task;
  if (task.platform !== cfg.platform) throw new Error('该任务不是' + cfg.platform + '平台');
  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') {
    throw httpError(409, '登录窗口正在进行，请完成后再发布');
  }

  const kind = ctx.kind === 'image' ? 'image' : 'video';
  const kinds = cfg.kinds || ['video'];
  if (kinds.indexOf(kind) < 0) {
    throw new Error('「' + cfg.platform + '」不支持' + (kind === 'image' ? '图文' : '短视频') + '自动发布');
  }
  let files = kind === 'image' ? (ctx.imagePaths || []).slice() : (ctx.videoPath ? [ctx.videoPath] : []);
  if (kind === 'image' && cfg.maxImages) files = files.slice(0, cfg.maxImages);
  if (!files.length) throw new Error(kind === 'image' ? '任务没有图片素材' : '任务没有视频素材');

  const uploadUrl = typeof cfg.uploadUrlFor === 'function' ? cfg.uploadUrlFor(kind) : (cfg.uploadUrls && cfg.uploadUrls[kind]) || cfg.uploadUrl;
  // 让内部所有等待/重连逻辑都使用本次实际打开的地址
  const runCfg = Object.assign({}, cfg, { uploadUrl });

  browserLogin.acquire('publish-' + cfg.platform);
  let session = null;

  try {
    ctx.log('启动本地浏览器（专用 profile）');
    session = await openSession(ctx, runCfg);
    const call = session.call;

    await call('Page.navigate', { url: uploadUrl });
    ctx.log('已打开「' + cfg.platform + '」投稿页');
    await sleep(1500);

    if (runCfg.preparePage) await runCfg.preparePage(call, ctx, kind);

    await ensureUploadReady(call, ctx, runCfg);

    ctx.log(kind === 'image' ? '开始上传图片：' + files.length + ' 张' : '开始上传视频：' + (ctx.video ? ctx.video.name : ''));
    await attachFiles(call, files, runCfg, ctx, kind);
    ctx.log(kind === 'image' ? '图片已进入上传流程' : '视频已进入上传流程');

    if (runCfg.onAttached) await runCfg.onAttached(call, ctx, kind);

    const state = await waitEditorReady(call, ctx, runCfg);
    ctx.log('页面已进入编辑态');

    const fields = { hasTitle: state.hasTitle, hasDesc: state.hasDesc };
    if (!fields.hasTitle && !fields.hasDesc) {
      throw new Error('上传后没有找到「' + cfg.platform + '」的标题/简介输入框，请查看截图确认页面是否已改版');
    }

    const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
    const composition = runCfg.compose(task, tags, kind);

    const fillDesc = async () => {
      if (!composition.description) return;
      if (!fields.hasDesc) {
        ctx.log('未找到「' + cfg.platform + '」简介/描述输入框，描述内容未写入', 'warn');
        return;
      }
      await fillDescription(call, ctx, runCfg, composition.description);
    };

    if (runCfg.descFirst) {
      await fillDesc();
      if (composition.title) {
        // 部分平台（视频号）的标题框要在描述填完后才出现
        await sleep(800);
        await fillTitle(call, ctx, runCfg, composition.title);
      }
    } else {
      if (composition.title) await fillTitle(call, ctx, runCfg, composition.title);
      await fillDesc();
    }

    if (runCfg.useTagInput) {
      await fillTagInput(call, ctx, runCfg, tags);
    } else if (tags.length) {
      const desc = String(composition.description || '');
      const missing = tags.filter((t) => desc.indexOf('#' + String(t).replace(/^#/, '')) < 0);
      if (missing.length) {
        ctx.log('部分话题未能合并进简介：' + missing.join('、'), 'warn');
      } else {
        ctx.log('话题已合并进简介：' + tags.map((t) => '#' + t.replace(/^#/, '')).join(' '));
      }
    }

    if (runCfg.prePublish) await runCfg.prePublish(call, ctx, task, kind);

    await waitPublishReady(call, ctx, runCfg);
    await captureScreenshot(call, ctx, 'before-publish');
    const beforeUrl = await currentPageUrl(call);
    await clickPublish(call, ctx, runCfg);
    const confirmed = await waitSubmitResult(call, ctx, runCfg, beforeUrl);

    return {
      status: 'submitted',
      message: confirmed
        ? '已提交发布，请在「' + cfg.platform + '」作品列表核验作品链接'
        : '已点击发布，但未检测到成功提示，请到「' + cfg.platform + '」确认后标记发布链接'
    };
  } catch (err) {
    if (session) await captureScreenshot(session.call, ctx, 'failed');
    throw err;
  } finally {
    if (session) {
      if (session.browser && session.browser.reused && session.browser.target) {
        await session.closePage();
      }
      session.call.close();
      if (session.browser && !session.browser.reused) await session.closeBrowser();
    }
    browserLogin.release('publish-' + cfg.platform);
  }
}

module.exports = {
  runWithConfig,
  evalJs,
  pageState,
  fieldHelpers,
  clickMatch,
  sleep,
  httpError
};
