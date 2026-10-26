'use strict';

/**
 * 浏览器发布内核：视频号 / 快手 / B站 / 微博 / 小红书 / 知乎 / 公众号 共用的浏览器会话与投稿工具。
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

/** 队列里的任务被删除时，适配器在下一个检查点主动中止，避免继续点击发布 */
function ensureActive(ctx) {
  if (ctx && typeof ctx.isAborted === 'function' && ctx.isAborted()) {
    throw new Error('发布任务已被删除，自动发布已中止');
  }
}

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
      // exceptionDetails.text 只有「Uncaught」，真正的错误在 exception.description
      const detail = res.exceptionDetails;
      const text = (detail.exception && detail.exception.description) || detail.text || '页面脚本执行失败';
      throw new Error(String(text).split('\n')[0]);
    }
    return res && res.result ? res.result.value : null;
  });
}

function pageTextExpr() {
  // innerText 会强制整页布局，上传/转码阶段容易把渲染线程拖住；
  // 改用 TreeWalker 限量取文本节点，不触发布局。roots 由 buttonRootsExpr 提供。
  return `
    const pageText = (() => {
      let out = '';
      try {
        roots.forEach((root) => {
          const top = root === document ? (document.body || document.documentElement) : root;
          if (!top) return;
          const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode()) && out.length < 12000) {
            const parent = node.parentElement;
            if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName)) continue;
            // 跳过 display:none 的模板/弹层文案，避免误判「上传失败」等隐藏提示
            if (!parent.getClientRects().length) continue;
            const chunk = node.nodeValue;
            if (chunk) out += chunk;
          }
        });
      } catch (err) { /* 页面结构异常时降级为空文本 */ }
      return out.replace(/\\s+/g, ' ').slice(0, 12000);
    })();
  `;
}

// 部分平台把表单放在 shadow DOM 里（视频号用无界微前端包了一层 <wujie-app>），
// 递归收集 document、各层 shadow root 和同源 iframe，后续查找统一遍历 roots。
function buttonRootsExpr(cfg) {
  return `
    const roots = [document];
    const addRoot = (root) => {
      if (!root || roots.indexOf(root) >= 0) return false;
      roots.push(root);
      return true;
    };
    const expand = (root, depth) => {
      if (!root || depth > 4) return;
      let all = [];
      try { all = Array.from(root.querySelectorAll('*')); } catch (err) { return; }
      all.forEach((el) => {
        const sr = el._sr || el.shadowRoot;
        if (sr && addRoot(sr)) expand(sr, depth + 1);
        if (el.tagName === 'IFRAME') {
          try {
            const doc = el.contentDocument;
            if (doc && addRoot(doc)) expand(doc, depth + 1);
          } catch (err) { /* 跨域 iframe 读不到 */ }
        }
      });
    };
    expand(document, 0);
    ${JSON.stringify(cfg.shadowHosts || [])}.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((host) => {
          const root = host._sr || host.shadowRoot;
          if (root && addRoot(root)) expand(root, 1);
        });
      } catch (err) { /* 宿主尚未渲染 */ }
    });
  `;
}

function fieldHelpers(cfg) {
  return `
    ${buttonRootsExpr(cfg)}
    const fieldVisible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const fieldAll = (sel) => {
      const out = [];
      roots.forEach((root) => {
        try {
          Array.from(root.querySelectorAll(sel)).forEach((el) => {
            if (fieldVisible(el) && out.indexOf(el) < 0) out.push(el);
          });
        } catch (err) { /* 该 root 结构异常时跳过 */ }
      });
      return out;
    };
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
        'textarea, input:not([type="search"]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
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
      const text = pageText;
      const inputs = [];
      roots.forEach((root) => {
        try {
          Array.from(root.querySelectorAll('input[type=file]')).forEach((el) => {
            if (inputs.indexOf(el) < 0) inputs.push(el);
          });
        } catch (err) { /* 跳过异常 root */ }
      });
      const title = findTitleField();
      const desc = findDescField();
      // B站等平台的发布按钮是 span/div（如 .submit-add），disabled 也可能挂在外层容器上
      const buttonSel = ${JSON.stringify(cfg.publishSelector || 'button, [role="button"], a')};
      const publishDisabled = (el) => {
        let node = el;
        for (let i = 0; i < 4 && node && node !== document.documentElement; i++, node = node.parentElement) {
          if (node.disabled === true) return true;
          if (node.getAttribute && (node.getAttribute('aria-disabled') === 'true' || node.getAttribute('disabled') !== null)) return true;
          const cls = String(node.className || '');
          if (/(^|[\\s_-])(disabled|is-disabled|btn-disabled)([\\s_-]|$)/i.test(cls)) return true;
        }
        return false;
      };
      const buttonEls = [];
      roots.forEach((root) => {
        try {
          Array.from(root.querySelectorAll(buttonSel)).forEach((b) => {
            const r = b.getBoundingClientRect();
            const s = getComputedStyle(b);
            if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') {
              buttonEls.push(b);
            }
          });
        } catch (err) { /* 跳过异常 root */ }
      });
      const buttonText = (b) => (b.innerText || '').trim();
      const wanted = ${JSON.stringify(cfg.publishButtons || [])};
      // 快手等平台的发布按钮是裸 div（没有 role 也不是 button），
      // 标准选择器找不到时按文案在 div/span 叶子节点里兜底。
      const hasWanted = buttonEls.some((b) => wanted.indexOf(buttonText(b)) >= 0);
      if (!hasWanted && wanted.length) {
        const extra = [];
        roots.forEach((root) => {
          try {
            Array.from(root.querySelectorAll('div, span')).forEach((el) => {
              if (buttonEls.indexOf(el) >= 0 || el.childElementCount > 0) return;
              const t = (el.textContent || '').trim();
              if (wanted.indexOf(t) < 0) return;
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') extra.push(el);
            });
          } catch (err) { /* 跳过异常 root */ }
        });
        extra.forEach((el) => buttonEls.push(el));
      }
      // 微博的进度环显示「1.3%」这类小数，且没有「上传中」字样。
      // 只在页面顶部（发布框区域）找独立百分比节点，避免把信息流正文里的「50%」当成上传进度。
      const percentNearTop = (el) => {
        if (!el || !el.getClientRects().length) return false;
        const r = el.getBoundingClientRect();
        // 微博把进度百分比放在零高度的 span 里（可见的是外层进度环），
        // 所以只校验宽度和纵向位置，不能要求高度
        return r.width >= 4 && r.top <= 700;
      };
      const percentEl = (() => {
        let found = '';
        roots.forEach((root) => {
          if (found) return;
          const top = root === document ? (document.body || document.documentElement) : root;
          if (!top) return;
          try {
            // 文本可能被拆成多个节点，先按叶子元素整体匹配
            Array.from(top.querySelectorAll('div, span, i, em, b, strong, p')).forEach((el) => {
              if (found || el.childElementCount) return;
              const m = String(el.textContent || '').trim().match(/^(\\d{1,3}(?:\\.\\d+)?)%$/);
              if (!m || !percentNearTop(el)) return;
              found = m[1];
            });
            if (found) return;
            // SVG/画布文本节点不在上面的选择器里，再按文本节点兜底
            const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
              const t = String(node.nodeValue || '').trim();
              if (!t || t.length > 24) continue;
              const m = t.match(/(\\d{1,3}(?:\\.\\d+)?)%/);
              if (!m || !percentNearTop(node.parentElement)) continue;
              found = m[1];
              break;
            }
          } catch (err) { /* 跳过异常 root */ }
        });
        return found;
      })();
      const progress = percentEl;
      // 快手的上传进度条会随重渲染短暂卸载，百分比还在时一律视为未完成
      const percentUploading = ${cfg.uploadPercentMarksUpload ? 'true' : 'false'} && !!progress && Number(progress) < 100;
      const uploadingRe = new RegExp(${JSON.stringify(
        '上传中|上传进度|转码中|正在处理|取消上传|图片上传中|图片处理中|合成中' +
          (cfg.uploadingExtraRe ? '|' + cfg.uploadingExtraRe : '')
      )});
      return {
        url: location.href,
        text,
        fileInputs: inputs.length,
        hasTitle: !!title,
        hasDesc: !!desc,
        buttons: buttonEls.map(buttonText).filter(Boolean).slice(0, 200),
        ready: buttonEls
          .filter((b) => !publishDisabled(b))
          .map(buttonText)
          .filter(Boolean)
          .slice(0, 200),
        uploading: uploadingRe.test(text) || percentUploading,
        progress,
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
    ensureActive(ctx);
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
  if (!doc || !doc.root) return [];
  // DOM.querySelectorAll 不穿透 shadow root，直接在 pierced 节点树里递归找
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.nodeName === 'INPUT') {
      const attrs = {};
      const list = node.attributes || [];
      for (let i = 0; i + 1 < list.length; i += 2) attrs[list[i]] = list[i + 1];
      if (String(attrs.type || '').toLowerCase() === 'file') {
        out.push({ nodeId: node.nodeId, accept: String(attrs.accept || '') });
      }
    }
    (node.children || []).forEach(walk);
    (node.shadowRoots || []).forEach(walk);
    if (node.contentDocument) walk(node.contentDocument);
  };
  walk(doc.root);
  return out;
}

async function clickUploadEntry(call, ctx, cfg) {
  const clicked = await evalJs(
    call,
    `(() => {
      ${buttonRootsExpr(cfg)}
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
      const candidates = [];
      roots.forEach((root) => {
        try {
          Array.from(root.querySelectorAll('button, [role="button"], div, span')).forEach((el) => {
            if (visible(el) && candidates.indexOf(el) < 0) candidates.push(el);
          });
        } catch (err) { /* 跳过异常 root */ }
      });
      const target = candidates
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

  const clicked = await clickUploadEntry(call, ctx, cfg);
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
    await clickUploadEntry(call, ctx, cfg);
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
    ensureActive(ctx);
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
  // 大视频（1GB 以上）上传可能远超表单填写的 15 分钟，平台可单独放宽
  const limit = cfg.uploadTimeoutMs || WAIT_FORM_MS;
  let lastLog = 0;
  let delay = 2000;
  // 上传进度条会随页面重渲染短暂卸载，连续多次确认就绪才点击，避免传到一半就提交
  let okStreak = 0;
  let settled = false;
  for (;;) {
    ensureActive(ctx);
    if (Date.now() - started > limit) {
      throw new Error('等待「' + cfg.platform + '」发布按钮就绪超时（' + Math.round(limit / 60000) + ' 分钟）');
    }
    const state = await safeState(call, cfg);
    if (!state) {
      okStreak = 0;
      await sleep(delay);
      continue;
    }
    if (state.failed) throw new Error('「' + cfg.platform + '」页面提示发布失败，请查看截图');
    const hit = (state.ready || []).some((text) => cfg.publishButtons.indexOf(text) >= 0);
    if (hit && !state.uploading) {
      if (!settled) {
        // 上传结束才是平台渲染完整表单的时机（微博此时才出现标题框）
        settled = true;
        if (typeof cfg.onUploadSettled === 'function') {
          try {
            await cfg.onUploadSettled(call, ctx);
          } catch (err) {
            ctx.log('上传完成后补全表单失败：' + err.message, 'warn');
          }
          okStreak = 0;
          await sleep(delay);
          continue;
        }
      }
      okStreak++;
      if (okStreak >= 3) return state;
    } else {
      okStreak = 0;
    }
    // 按钮已经渲染但仍是禁用态：通常是必填项（分区/创作声明等）没选
    const seen = (state.buttons || []).some((text) => cfg.publishButtons.indexOf(text) >= 0);
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      ctx.log(
        state.uploading
          ? '上传/转码尚未完成' + (state.progress ? '（' + state.progress + '%）' : '') + '…'
          : seen
            ? '发布按钮已出现但不可点击，等待必填项完成…'
            : '等待发布按钮可用…'
      );
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
      const buttonSel = ${JSON.stringify(cfg.publishSelector || 'button, [role="button"], a')};
      const publishDisabled = (el) => {
        let node = el;
        for (let i = 0; i < 4 && node && node !== document.documentElement; i++, node = node.parentElement) {
          if (node.disabled === true) return true;
          if (node.getAttribute && (node.getAttribute('aria-disabled') === 'true' || node.getAttribute('disabled') !== null)) return true;
          const cls = String(node.className || '');
          if (/(^|[\\s_-])(disabled|is-disabled|btn-disabled)([\\s_-]|$)/i.test(cls)) return true;
        }
        return false;
      };
      const buttons = [];
      roots.forEach((root) => {
        try {
          Array.from(root.querySelectorAll(buttonSel)).forEach((b) => {
            const r = b.getBoundingClientRect();
            const s = getComputedStyle(b);
            if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') buttons.push(b);
          });
        } catch (err) { /* 跳过异常 root */ }
      });
      const area = (el) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
      };
      const pick = (list) => {
        const hit = list
          .map((el) => ({ el, text: (el.innerText || el.textContent || '').trim() }))
          .filter((item) => wanted.indexOf(item.text) >= 0 && !publishDisabled(item.el))
          // 先按 publishButtons 的优先顺序（「发布」优先于「发布作品」「立即发布」），再取最小的点击目标
          .sort((a, b) => wanted.indexOf(a.text) - wanted.indexOf(b.text) || area(a.el) - area(b.el))[0];
        return hit ? hit.el : null;
      };
      let target = pick(buttons);
      if (!target && wanted.length) {
        // 发布按钮可能是裸 div（快手），按文案找最内层节点，点击会冒泡到按钮处理器
        const extra = [];
        roots.forEach((root) => {
          try {
            Array.from(root.querySelectorAll('div, span')).forEach((el) => {
              if (el.childElementCount > 0) return;
              const t = (el.textContent || '').trim();
              if (wanted.indexOf(t) < 0) return;
              const r = el.getBoundingClientRect();
              const s = getComputedStyle(el);
              if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !publishDisabled(el)) {
                extra.push(el);
              }
            });
          } catch (err) { /* 跳过异常 root */ }
        });
        target = pick(extra);
      }
      if (!target) return '';
      target.click();
      return (target.innerText || target.textContent || '').trim();
    })()`
  );
  if (!clicked) throw new Error('没有找到可点击的「发布」按钮（可能需要先完成必填项，或页面已改版）');
  ctx.log('已点击「' + clicked + '」按钮');
}

/**
 * 稳健点击：把元素滚进视口 → 用 elementFromPoint 确认坐标真的命中目标 → 发真实鼠标事件。
 * 被浮层/固定头挡住时回调 onRetry（例如关掉话题联想层）后重试，仍失败则退回程序化 click。
 * hitWithin 指定“可接受的容器”：控件上常盖着同组件的透明代理按钮（如知乎的
 * videoTypeSelectOverlay），命中容器内任意元素都算有效点击。
 * expr 必须是返回 Element 的 JS 表达式。
 */
async function clickEl(call, expr, opts) {
  const o = opts || {};
  const attempts = o.attempts || 3;
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const info = await evalJs(
      call,
      `(() => {
        const el = ${expr};
        if (!el) return null;
        el.scrollIntoView({ block: ${JSON.stringify(o.block || 'center')}, inline: 'nearest', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2);
        const y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        const within = ${JSON.stringify(o.hitWithin || '')};
        const box = within ? el.closest(within) : null;
        return {
          x, y,
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          inView: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
          hit: !!hit && (hit === el || el.contains(hit) || !!(box && (box === hit || box.contains(hit)))),
          hitTag: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 40) : ''
        };
      })()`
    ).catch(() => null);
    if (!info) return { clicked: false, reason: 'not-found' };
    last = info;
    if (info.rect[2] > 0 && info.rect[3] > 0 && info.inView && info.hit) {
      if (typeof o.beforeClick === 'function') await o.beforeClick(info, i);
      try { await call('Page.bringToFront', {}); } catch (err) { /* 无窗口可聚焦时继续 */ }
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: info.x, y: info.y, button: 'none' });
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await sleep(o.afterMs == null ? 200 : o.afterMs);
      return { clicked: true, method: 'mouse', x: info.x, y: info.y, rect: info.rect };
    }
    if (typeof o.onRetry === 'function') await o.onRetry(info, i);
    await sleep(150);
  }
  if (o.programmatic !== false) {
    const ok = await evalJs(call, `(() => { const el = ${expr}; if (!el) return false; el.click(); return true; })()`).catch(() => false);
    if (ok) {
      await sleep(o.afterMs == null ? 200 : o.afterMs);
      return { clicked: true, method: 'programmatic', rect: last && last.rect };
    }
  }
  return { clicked: false, reason: 'obscured-or-offscreen', info: last };
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
    // 不要启用 Network 域：大视频上传时 Chrome 会因 DevTools 网络事件过载而断开连接
    // （表现：上传几秒后「DevTools 连接已关闭」，重连后反复超时）。Network.setCookie 无需 enable。
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
 *  shadowHosts / preparePage / publishButtons / publishSelector / successRe / uploadRouteRe
 *  compose / onAttached / prePublish / afterPublish
 *
 * afterPublish 可返回 { status, workId, publishUrl, message, keepOpen }：
 * keepOpen 为 true 时不关闭本次投稿页/浏览器（例如微博视频仍在转码，
 * 需要保留页面等待平台自动发博）。
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
  // 平台要求保留页面时（如微博视频转码中），不要在 finally 里关页/关浏览器
  let keepOpen = false;

  try {
    ensureActive(ctx);
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

    ensureActive(ctx);
    if (runCfg.prePublish) await runCfg.prePublish(call, ctx, task, kind);

    ensureActive(ctx);
    await waitPublishReady(call, ctx, runCfg);
    await captureScreenshot(call, ctx, 'before-publish');
    // 点击发布前最后确认一次：任务在等待/截图期间被删除就不要再提交
    ensureActive(ctx);
    const beforeUrl = await currentPageUrl(call);
    await clickPublish(call, ctx, runCfg);
    const confirmed = await waitSubmitResult(call, ctx, runCfg, beforeUrl);

    // 平台支持核验时，拿到作品链接可直接返回 published（如B站稿件列表）；
    // 核验本身失败不能把已经投递成功的任务判成失败
    if (runCfg.afterPublish) {
      try {
        const verified = await runCfg.afterPublish(call, ctx, { confirmed, beforeUrl });
        if (verified) {
          keepOpen = verified.keepOpen === true;
          return verified;
        }
      } catch (err) {
        ctx.log('发布后核验失败，保留待核验状态：' + err.message, 'warn');
      }
    }

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
      if (!keepOpen && session.browser && session.browser.reused && session.browser.target) {
        await session.closePage();
      }
      session.call.close();
      if (!keepOpen && session.browser && !session.browser.reused) await session.closeBrowser();
    }
    browserLogin.release('publish-' + cfg.platform);
  }
}

module.exports = {
  runWithConfig,
  openSession,
  injectCookies,
  captureScreenshot,
  evalJs,
  pageState,
  fieldHelpers,
  fillTitle,
  clickMatch,
  clickEl,
  attachFiles,
  fileInputCandidates,
  sleep,
  httpError
};
