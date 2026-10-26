'use strict';

/**
 * 公众号图文 / 视频草稿适配器（浏览器方案）。
 *
 * 复用「连接设置 → 公众号」一键登录的 Cookie，打开公众平台图文编辑器：
 *   1. 打开 mp.weixin.qq.com 后台并取得当前登录的 token
 *   2. 进入「新建图文」编辑器（优先新版 appmsg_edit_v2，失败回退旧版）
 *   3. 填写标题与正文；图片通过粘贴交给编辑器上传
 *   4. 视频通过「视频」弹窗的「本地上传」进入新开的视频编辑页：上传、填标题、
 *      同意服务规则并保存到素材库，再回素材库选中插入正文
 *   5. 从图片库选择排期封面作为分享封面
 *   6. 点击「保存为草稿」，由作者到草稿箱确认排版（视频还需审核）后手动发表
 *
 * 公众号没有面向个人账号的稳定发表接口，因此任务以「待核验」结束。
 */

const fs = require('fs');
const path = require('path');
const channelConnections = require('../channel-connections');
const browserLogin = require('../browser-login');
const bp = require('./browser-publish');

const PLATFORM = '公众号';
const HOME_URL = 'https://mp.weixin.qq.com/';
const COOKIE_DOMAIN = 'mp.weixin.qq.com';
const TITLE_MAX = 64;
const BODY_MAX = 20000;
const EDITOR_WAIT_MS = 25000;
const IMAGE_WAIT_MS = 90000;
const MAX_PASTE_BYTES = 25 * 1024 * 1024;
const VIDEO_UPLOAD_WAIT_MS = 30 * 60 * 1000;
const VIDEO_TAB_WAIT_MS = 20000;
const VIDEO_SAVE_WAIT_MS = 90000;
const VIDEO_INSERT_WAIT_MS = 90000;
const VIDEO_LIST_WAIT_MS = 3 * 60 * 1000;
const VIDEO_TITLE_MAX = 64;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function composeText(task, tags) {
  let body = String(task.description || '').trim();
  if (tags.length) {
    body += (body ? '\n\n' : '') + tags.map((t) => '#' + String(t).replace(/^#+/, '')).join(' ');
  }
  return body.slice(0, BODY_MAX);
}

function infoExpr() {
  return `(() => {
    const token = (() => {
      const m = location.href.match(/[?&]token=(\\d+)/);
      if (m) return m[1];
      try {
        if (window.wx && wx.commonData && wx.commonData.data && wx.commonData.data.token) {
          return String(wx.commonData.data.token);
        }
        if (window.wx && wx.commonData && wx.commonData.token) return String(wx.commonData.token);
      } catch (err) { /* 页面变量结构可能变化 */ }
      try {
        const html = document.documentElement ? document.documentElement.innerHTML.slice(0, 200000) : '';
        const hit = html.match(/[?&]token=(\\d+)/) || html.match(/["']token["']\\s*[:=]\\s*["']?(\\d{5,})/);
        return hit ? hit[1] : '';
      } catch (err) {
        return '';
      }
    })();
    return {
      url: location.href,
      title: document.title,
      text: document.body ? String(document.body.innerText || '').slice(0, 800) : '',
      token
    };
  })()`;
}

function findersExpr() {
  return `
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 8 && r.height > 8 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const docOf = (sel) => {
      const frame = document.querySelector(sel);
      try { return frame ? frame.contentDocument : null; } catch (err) { return null; }
    };
    const areaOf = (el) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
    // 视频上传弹窗可能位于主文档，也可能在 UEditor 的 iframe 里；只收集弹窗作用域，
    // 避免把正文 iframe 或整页文本当成弹窗状态，也避免误点页面上的同名按钮。
    const dialogScopes = () => {
      const scopes = [];
      Array.from(document.querySelectorAll(
        '[class*="dialog"], [class*="modal"], [class*="popup"], [class*="iframeholder"], [id*="dialog"]'
      )).forEach((el) => {
        if (visible(el) && areaOf(el) > 8000) scopes.push(el);
      });
      Array.from(document.querySelectorAll('iframe')).forEach((frame) => {
        if (!visible(frame)) return;
        const wrap = frame.closest('[class*="dialog"], [class*="modal"], [class*="popup"], [class*="iframeholder"], [id*="dialog"]');
        if (!wrap) return;
        try {
          const doc = frame.contentDocument;
          if (doc && doc.body) scopes.push(doc.body);
        } catch (err) { /* 跨域忽略 */ }
      });
      return scopes;
    };
    const findTitle = () => {
      const list = Array.from(document.querySelectorAll(
        'textarea#title, textarea.js_title, #title, textarea[placeholder*="标题"], input[placeholder*="标题"]'
      ));
      return list.find(visible) || list[0] || null;
    };
    const findBody = () => {
      const direct = Array.from(document.querySelectorAll(
        '.ProseMirror[contenteditable="true"], .edui-body-container[contenteditable="true"], [contenteditable="true"]'
      )).filter(visible);
      if (direct.length) {
        direct.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.width * rb.height - ra.width * ra.height;
        });
        return direct[0];
      }
      const docs = [
        docOf('#ueditor_0'),
        docOf('iframe.edui-body-container'),
        docOf('.edui-body-container iframe')
      ].filter(Boolean);
      for (const doc of docs) {
        const el =
          doc.querySelector('[contenteditable="true"]') ||
          (doc.body && doc.body.isContentEditable ? doc.body : null) ||
          doc.body;
        if (el) return el;
      }
      return null;
    };
  `;
}

function isLoginPage(info) {
  if (!info) return false;
  if (/\/cgi-bin\/loginpage|loginpage/i.test(info.url || '')) return true;
  return /扫码登录|请使用微信扫一扫|验证码登录|登录公众平台/.test(info.text || '');
}

async function readInfo(call) {
  try {
    return await bp.evalJs(call, infoExpr(), 10000);
  } catch (err) {
    return null;
  }
}

async function openHome(call, ctx) {
  await call('Page.navigate', { url: HOME_URL });
  const started = Date.now();
  let last = null;
  while (Date.now() - started < 30000) {
    const info = await readInfo(call);
    if (info) {
      last = info;
      if (isLoginPage(info)) {
        throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
      }
      if (info.token) {
        ctx.log('已进入公众号后台');
        return info.token;
      }
    }
    await bp.sleep(800);
  }
  const hint = last && last.url ? `（当前页面：${last.url.replace(/^https?:\/\/[^/]+/, '')}）` : '';
  throw httpError(401, '未能进入公众号后台' + hint + '，请到「连接设置」重新一键登录');
}

async function openEditor(call, ctx, token) {
  const urls = [
    'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=0' +
      '&token=' + encodeURIComponent(token) + '&lang=zh_CN',
    'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=10&isMul=1&isNew=1' +
      '&token=' + encodeURIComponent(token) + '&lang=zh_CN'
  ];
  for (let i = 0; i < urls.length; i++) {
    await call('Page.navigate', { url: urls[i] });
    const started = Date.now();
    while (Date.now() - started < EDITOR_WAIT_MS) {
      const info = await readInfo(call);
      if (isLoginPage(info)) {
        throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
      }
      const ready = await bp
        .evalJs(
          call,
          `(() => {
            ${findersExpr()}
            return { title: !!findTitle(), body: !!findBody() };
          })()`,
          10000
        )
        .catch(() => null);
      if (ready && ready.title && ready.body) return true;
      await bp.sleep(800);
    }
    if (i < urls.length - 1) ctx.log('新版图文编辑器未就绪，尝试旧版编辑器…', 'warn');
  }
  throw new Error('公众号图文编辑器加载超时：没有找到标题或正文编辑区，页面可能已改版');
}

async function fillTitle(call, ctx, title) {
  const result = await bp.evalJs(
    call,
    `(() => {
      ${findersExpr()}
      const el = findTitle();
      if (!el) return 'missing';
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, ${JSON.stringify(title)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === ${JSON.stringify(title)} ? 'ok' : 'unconfirmed';
    })()`
  ).catch(() => 'missing');

  if (result === 'ok' || result === 'unconfirmed') {
    ctx.log('已填写标题');
    return true;
  }
  const ok = await bp.fillTitle(
    call,
    ctx,
    { titleHintRe: '标题|请输入标题', titleMax: TITLE_MAX },
    title
  );
  if (!ok) throw new Error('没有找到公众号标题输入框，页面可能已改版');
  return true;
}

/** 聚焦正文并清空占位内容，再把光标放到末尾，供文字输入和图片粘贴使用。 */
async function focusBodyEnd(call) {
  return bp
    .evalJs(
      call,
      `(() => {
        ${findersExpr()}
        const el = findBody();
        if (!el) return null;
        const doc = el.ownerDocument || document;
        const win = doc.defaultView || window;
        el.focus();
        const sel = win.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        return { tag: el.tagName, editable: !!el.isContentEditable };
      })()`
    )
    .catch(() => null);
}

async function fillBody(call, ctx, text) {
  const focus = await focusBodyEnd(call);
  if (!focus) throw new Error('没有找到公众号正文编辑区，页面可能已改版');

  // 先全选清空占位文案，再用真实输入事件写入，兼容 ProseMirror / UEditor 等富文本内核。
  await bp.evalJs(
    call,
    `(() => {
      ${findersExpr()}
      const el = findBody();
      if (!el) return false;
      const doc = el.ownerDocument || document;
      const win = doc.defaultView || window;
      el.focus();
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    })()`
  ).catch(() => false);
  await call('Input.insertText', { text });
  await bp.sleep(400);

  const length = await bp
    .evalJs(
      call,
      `(() => {
        ${findersExpr()}
        const el = findBody();
        if (!el) return 0;
        return String(el.innerText || el.textContent || '').replace(/\\s+/g, '').length;
      })()`
    )
    .catch(() => 0);
  if (!length) throw new Error('公众号正文编辑区无法写入内容，页面可能已改版');
  ctx.log('已填写正文');
  await focusBodyEnd(call);
}

function imageCountExpr() {
  return `(() => {
    ${findersExpr()}
    const el = findBody();
    if (!el) return null;
    const doc = el.ownerDocument || document;
    let root = el;
    try {
      if (el.tagName === 'BODY' && doc.body) root = doc.body;
    } catch (err) { /* 使用元素本身兜底 */ }
    const imgs = Array.from(root.querySelectorAll('img'));
    return {
      total: imgs.length,
      uploaded: imgs.filter((img) => /mmbiz\\.qpic\\.cn|mmbiz\\.qlogo\\.cn/.test(img.src || '')).length
    };
  })()`;
}

async function pasteImages(call, ctx, files) {
  const totalBytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  if (totalBytes > MAX_PASTE_BYTES) {
    ctx.log('图片合计超过 25MB，已跳过正文图片上传，请到草稿箱手动补充', 'warn');
    return false;
  }

  const baseline = (await bp.evalJs(call, imageCountExpr()).catch(() => null)) || { total: 0, uploaded: 0 };
  const payload = [];
  for (const file of files) {
    try {
      payload.push({
        name: path.basename(file),
        mime: mimeOf(file),
        b64: fs.readFileSync(file).toString('base64')
      });
    } catch (err) {
      ctx.log('读取图片失败，已跳过：' + path.basename(file), 'warn');
    }
  }
  if (!payload.length) return false;

  const pasted = await bp
    .evalJs(
      call,
      `(() => {
        ${findersExpr()}
        const el = findBody();
        if (!el) return false;
        const doc = el.ownerDocument || document;
        const win = doc.defaultView || window;
        el.focus();
        const range = doc.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        const dt = new DataTransfer();
        const files = ${JSON.stringify(payload)};
        for (const item of files) {
          const bin = atob(item.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          dt.items.add(new File([bytes], item.name, { type: item.mime }));
        }
        let event;
        try {
          event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        } catch (err) {
          event = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', { value: dt });
        }
        el.dispatchEvent(event);
        return true;
      })()`,
      60000
    )
    .catch(() => false);

  if (!pasted) {
    ctx.log('未能把图片粘贴进正文，请到草稿箱手动补充图片', 'warn');
    return false;
  }

  ctx.log('已粘贴 ' + payload.length + ' 张图片，等待公众号编辑器上传…');
  const started = Date.now();
  let last = baseline;
  while (Date.now() - started < IMAGE_WAIT_MS) {
    last = (await bp.evalJs(call, imageCountExpr()).catch(() => null)) || last;
    if (last && last.total >= baseline.total + payload.length) {
      ctx.log('图片已插入正文（' + last.total + ' 张）');
      return true;
    }
    await bp.sleep(1500);
  }
  ctx.log('图片上传等待超时，草稿可能仍在后台上传，请到草稿箱确认', 'warn');
  return false;
}

/** 点击视频弹窗里的「确定 / 插入」按钮。 */
function clickVideoConfirmExpr() {
  return `(() => {
    ${findersExpr()}
    // 只点真正的 button / a：按钮外层常包着 div.weui-desktop-btn_wrp，
    // 按面积排序会先选中这层包裹元素，点它不会触发弹窗的确认逻辑。
    const hits = [];
    dialogScopes().forEach((scope) => {
      if (!/选择视频|已选择\\s*\\d+\\s*\\/\\s*\\d+\\s*条视频/.test(String(scope.innerText || ''))) return;
      Array.from(scope.querySelectorAll('button, a, [role="button"]')).forEach((el) => {
        if (!visible(el)) return;
        const label = String(el.innerText || el.textContent || '').trim();
        if (['确定', '插入', '完成', '确认'].indexOf(label) < 0) return;
        const disabled = !!el.disabled || el.getAttribute('aria-disabled') === 'true' ||
          /disabled/i.test(String(el.className || ''));
        if (!disabled) hits.push({ el, label, area: areaOf(el) });
      });
    });
    hits.sort((a, b) => a.area - b.area);
    if (!hits.length) return '';
    hits[0].el.click();
    return hits[0].label;
  })()`;
}

/** 正文里是否已经出现视频组件。 */
function bodyVideoExpr() {
  return `(() => {
    ${findersExpr()}
    const el = findBody();
    if (!el) return false;
    const doc = el.ownerDocument || document;
    const scope = (el.tagName === 'BODY' && doc.body) ? doc.body : el;
    const nodes = Array.from(scope.querySelectorAll(
      'mpvideo, mp-video, video, embed[type*="video"], iframe[class*="video"], ' +
      'iframe[src*="videoplayer"], iframe[src*="mpvideo"], [class*="video_iframe"], ' +
      '[class*="js_mpvideo"], [data-mpvid]'
    ));
    return nodes.length > 0;
  })()`;
}

/**
 * 视频编辑页（本地上传新开的 videomsg_edit 页）标题规则与图文标题不同：
 * 最多 64 字，且不接受符号 / emoji（平台会提示「标题中不能含有特殊字符」）。
 */
function sanitizeVideoTitle(title) {
  const cleaned = String(title || '')
    .replace(/[☀-➿⬀-⯿㊑-㊰]/g, '')
    .replace(/[\uD83C\uD83D][\uDC00-\uDFFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, VIDEO_TITLE_MAX).join('') || '视频素材';
}

/** 视频编辑页状态：保存按钮是否可用（= 上传完成 + 标题已填 + 已同意规则）。 */
function videoPageStateExpr() {
  return `(() => {
    const text = String(document.body ? document.body.innerText : '');
    const shown = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const save = Array.from(document.querySelectorAll('button'))
      .find((b) => shown(b) && String(b.innerText || b.textContent || '').trim() === '保存');
    const saveDisabled = !save || !!save.disabled || save.getAttribute('aria-disabled') === 'true' ||
      /weui-desktop-btn_disabled/.test(String(save.className || ''));
    const titleEl = document.querySelector('input[name="title"], textarea[name="title"]');
    const ruleBox = Array.from(document.querySelectorAll('input[type="checkbox"]')).find((b) =>
      /公众平台视频上传服务规则/.test(String((b.closest('label') || b.parentElement || {}).innerText || '')));
    const percent = text.match(/已上传[:：]\\s*(\\d{1,3}(?:\\.\\d+)?)\\s*%/) ||
      text.match(/(\\d{1,3})\\s*%/);
    return {
      url: location.href,
      login: /loginpage|扫码登录|请使用微信扫一扫/.test(location.href + text.slice(0, 300)),
      saveReady: !!save && !saveDisabled,
      title: titleEl ? String(titleEl.value || '') : '',
      agreed: !!(ruleBox && ruleBox.checked),
      percent: percent ? Math.floor(Number(percent[1])) : 0,
      uploading: /上传中|正在上传|处理中|转码中|正在提交/.test(text),
      uploaded: /视频上传成功/.test(text),
      failed: /上传失败/.test(text),
      saved: /action=list_video/.test(location.href),
      text: text.slice(0, 1200)
    };
  })()`;
}

/** 页面 Vue 实例里的保存/上传状态，作为 DOM 之外的补充判断。 */
function videoVueStateExpr() {
  return `(() => {
    const walk = (vm, depth) => {
      if (!vm || depth > 8) return null;
      if (typeof vm.videoStatus !== 'undefined' && vm.form && typeof vm.form.vid !== 'undefined') {
        return {
          videoStatus: vm.videoStatus,
          vid: vm.form.vid,
          title: vm.form.title,
          agree: vm.form.agree,
          saveDisabled: !!vm.isSaveBtnDisabled,
          saving: !!vm.isSaveBtnLoading,
          coverValid: !!(vm.coverInfo && vm.coverInfo.isValidated),
          covers: Array.isArray(vm.recommendCovers) ? vm.recommendCovers.length : 0
        };
      }
      const kids = vm.$children || [];
      for (const kid of kids) {
        const hit = walk(kid, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    const app = document.querySelector('#app');
    const root = app && app.__vue__;
    return root ? walk(root, 0) : null;
  })()`;
}

function fillVideoTitleExpr(value) {
  return `(() => {
    const el = document.querySelector('input[name="title"], textarea[name="title"]');
    if (!el) return null;
    const next = ${JSON.stringify(value)};
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  })()`;
}

/** 勾选「我已阅读并同意《公众平台视频上传服务规则》」。 */
function checkVideoRuleExpr() {
  return `(() => {
    const box = Array.from(document.querySelectorAll('input[type="checkbox"]')).find((b) =>
      /公众平台视频上传服务规则/.test(String((b.closest('label') || b.parentElement || {}).innerText || '')));
    if (!box) return 'missing';
    if (!box.checked) {
      const label = box.closest('label');
      if (label) label.click();
      if (!box.checked) box.click();
    }
    return box.checked ? 'ok' : 'unchecked';
  })()`;
}

/** 点击视频编辑页的「保存」（精确匹配，避开「保存并发表」）。 */
function clickVideoSaveExpr() {
  return `(() => {
    const save = Array.from(document.querySelectorAll('button'))
      .find((b) => String(b.innerText || b.textContent || '').trim() === '保存');
    if (!save) return 'missing';
    if (save.disabled || save.getAttribute('aria-disabled') === 'true' ||
      /weui-desktop-btn_disabled/.test(String(save.className || ''))) return 'disabled';
    save.click();
    return 'ok';
  })()`;
}

/**
 * 未声明原创时点「保存」会返回 ret=64716，平台弹出「提交视频」确认框；
 * 必须点「继续提交」才会真正保存到素材库。
 */
function confirmVideoSubmitExpr() {
  return `(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 8 && r.height > 8 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const scopes = Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')).filter(visible);
    for (const scope of scopes) {
      if (!/提交视频|视频未声明原创/.test(String(scope.innerText || ''))) continue;
      const btn = Array.from(scope.querySelectorAll('button'))
        .find((b) => visible(b) && String(b.innerText || b.textContent || '').trim() === '继续提交');
      if (btn) {
        btn.click();
        return 'ok';
      }
    }
    return 'missing';
  })()`;
}

/**
 * 视频上传完成后平台才会生成推荐封面（异步加载，可能要十几秒）。
 * 点击推荐封面会打开「编辑封面」对话框，必须在对话框里点「完成」才真正生效。
 */
function coverItemRectExpr() {
  return `(() => {
    const item = Array.from(document.querySelectorAll('.cover__options__item'))
      .find((el) => el.querySelector('img.cover__options__item__image'));
    if (!item) return null;
    item.scrollIntoView({ block: 'center' });
    const r = item.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`;
}

function clickCoverDoneExpr() {
  return `(() => {
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 8 && r.height > 8 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const btn = Array.from(document.querySelectorAll('button')).find((b) => {
      if (!visible(b) || String(b.innerText || b.textContent || '').trim() !== '完成') return false;
      const wrap = b.closest('.weui-desktop-dialog, .weui-desktop-dialog__wrp');
      return wrap && /编辑封面/.test(String(wrap.innerText || '').slice(0, 200));
    });
    if (!btn) return 'missing';
    btn.click();
    return 'ok';
  })()`;
}

/** 图文页视频素材库状态：是否已出现同名素材、是否可选、已选数量。 */
function pickerStateExpr(title) {
  return `(() => {
    ${findersExpr()}
    const target = ${JSON.stringify(String(title || '').replace(/\s+/g, ' ').trim())};
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const match = (label) => !!label && !!target &&
      (label === target || label.indexOf(target) === 0 || target.indexOf(label) === 0);
    const scopes = dialogScopes();
    if (!scopes.length) return { open: false, count: 0, selected: 0, footer: '', match: null };
    const items = [];
    let footer = '';
    let selected = 0;
    scopes.forEach((scope) => {
      Array.from(scope.querySelectorAll('li.more-video__item')).forEach((li) => {
        const titleEl = li.querySelector('.more-video__item-title');
        const span = titleEl ? titleEl.querySelector('span') : null;
        const label = norm(span ? span.innerText : (titleEl ? titleEl.innerText : ''));
        const statusEl = li.querySelector('.more-video__item-status');
        items.push({
          label,
          status: norm(statusEl ? statusEl.innerText : ''),
          disabled: /more-video__item_disabled/.test(String(li.className || ''))
        });
      });
      if (!footer) {
        const m = String(scope.innerText || '').match(/已选择\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*条视频/);
        if (m) {
          footer = m[0].replace(/\\s+/g, ' ');
          selected = Number(m[1]);
        }
      }
    });
    return {
      open: true,
      count: items.length,
      selected,
      footer,
      match: items.find((it) => match(it.label)) || null
    };
  })()`;
}

/** 在素材库中勾选与标题匹配的视频。 */
function clickVideoItemExpr(title) {
  return `(() => {
    ${findersExpr()}
    const target = ${JSON.stringify(String(title || '').replace(/\s+/g, ' ').trim())};
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const match = (label) => !!label && !!target &&
      (label === target || label.indexOf(target) === 0 || target.indexOf(label) === 0);
    for (const scope of dialogScopes()) {
      for (const li of Array.from(scope.querySelectorAll('li.more-video__item'))) {
        const titleEl = li.querySelector('.more-video__item-title');
        const span = titleEl ? titleEl.querySelector('span') : null;
        const label = norm(span ? span.innerText : (titleEl ? titleEl.innerText : ''));
        if (!match(label)) continue;
        if (/more-video__item_disabled/.test(String(li.className || ''))) return 'disabled';
        const box = li.querySelector('input[type="checkbox"]');
        const labelEl = li.querySelector('label.weui-desktop-form__check-label');
        if (box && box.checked) return 'selected';
        if (labelEl) labelEl.click();
        else if (box) box.click();
        else li.click();
        return 'clicked';
      }
    }
    return 'missing';
  })()`;
}

/** 关闭图文页的视频弹窗（点「取消」）。 */
function closeVideoDialogExpr() {
  return `(() => {
    ${findersExpr()}
    const hits = [];
    dialogScopes().forEach((scope) => {
      if (!/选择视频|已选择\\s*\\d+\\s*\\/\\s*\\d+\\s*条视频/.test(String(scope.innerText || ''))) return;
      Array.from(scope.querySelectorAll('button, a, [role="button"]')).forEach((el) => {
        if (!visible(el)) return;
        if (String(el.innerText || el.textContent || '').trim() !== '取消') return;
        hits.push({ el, area: areaOf(el) });
      });
    });
    hits.sort((a, b) => a.area - b.area);
    if (!hits.length) return false;
    hits[0].el.click();
    return true;
  })()`;
}

/** 点击编辑器工具栏的「视频」入口，打开上传弹窗。 */
async function openVideoDialog(call, ctx) {
  const label = await bp
    .evalJs(
      call,
      `(() => {
        ${findersExpr()}
        const body = findBody();
        const usable = (el) => visible(el) && !(body && (el === body || body.contains(el)));
        const selectors = [
          '#js_editor_insertvideo', '.js_editor_insertvideo', '.edui-for-insertvideo',
          '[data-name="video"]', '[data-action="video"]', '[data-tooltip="视频"]',
          '[data-title="视频"]', '[title="视频"]', '[aria-label="视频"]', '[data-testid*="video"]'
        ];
        let target = null;
        for (const sel of selectors) {
          target = Array.from(document.querySelectorAll(sel)).find(usable) || null;
          if (target) break;
        }
        if (!target) {
          const scope = Array.from(document.querySelectorAll(
            '[class*="toolbar"] *, [class*="tool"] *, [class*="menu"] *, [class*="editor"] *'
          )).filter(usable);
          const exact = scope
            .filter((el) => String(el.innerText || '').trim() === '视频')
            .sort((a, b) => areaOf(a) - areaOf(b));
          target = exact[0] || null;
        }
        if (!target) return '';
        target.click();
        return (target.getAttribute('title') || target.getAttribute('aria-label') ||
          String(target.innerText || '').trim() || '视频').slice(0, 20);
      })()`
    )
    .catch(() => '');
  if (!label) throw new Error('没有找到公众号编辑器的「视频」入口，页面可能已改版');
  ctx.log('已点击「' + label + '」');
}

/**
 * 在视频弹窗里切到「上传视频 / 本地上传」页签。
 * 「本地上传」会 window.open 打开视频编辑页，浏览器只认真实用户手势；
 * 程序化 click() 会被弹窗拦截，因此这里用 CDP 派发真实鼠标事件。
 */
async function clickUploadTab(call) {
  const hit = await bp
    .evalJs(
      call,
      `(() => {
        ${findersExpr()}
        const wanted = ['上传视频', '本地上传', '选择视频', '添加视频', '点击上传', '上传'];
        const hits = [];
        dialogScopes().forEach((scope) => {
          Array.from(scope.querySelectorAll('a, button, [role="button"], li, span, div')).forEach((el) => {
            if (!visible(el)) return;
            const text = String(el.innerText || el.textContent || '').trim();
            const rank = wanted.indexOf(text);
            if (rank < 0) return;
            hits.push({ el, text, rank, area: areaOf(el) });
          });
        });
        hits.sort((a, b) => a.rank - b.rank || a.area - b.area);
        if (!hits.length) return null;
        const el = hits[0].el;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { label: hits[0].text, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`
    )
    .catch(() => null);
  if (!hit || !hit.label) return '';
  if (hit.x > 0 && hit.y > 0) {
    try {
      await bp.sleep(300);
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y }, 5000);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, 5000);
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 }, 5000);
      return hit.label;
    } catch (err) {
      /* 坐标点击失败时退回程序化点击 */
    }
  }
  await bp
    .evalJs(
      call,
      `(() => {
        const el = Array.from(document.querySelectorAll('a, button, [role="button"]'))
          .find((x) => String(x.innerText || x.textContent || '').trim() === ${JSON.stringify(hit.label)});
        if (el) el.click();
        return true;
      })()`
    )
    .catch(() => '');
  return hit.label;
}

async function bodyHasVideo(call) {
  return bp.evalJs(call, bodyVideoExpr()).catch(() => false);
}

function ensureActive(ctx) {
  if (ctx && typeof ctx.isAborted === 'function' && ctx.isAborted()) {
    throw new Error('任务已取消');
  }
}

/** 公众号「本地上传」会新开一个 videomsg_edit 标签页；等它出现。 */
async function waitForNewTab(browser, knownIds, ctx) {
  const started = Date.now();
  while (Date.now() - started < VIDEO_TAB_WAIT_MS) {
    ensureActive(ctx);
    const list = await browserLogin.httpJson(browser.port, '/json/list').catch(() => []);
    const fresh = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && !knownIds.has(t.id));
    const page =
      fresh.find((t) => /videomsg_edit|video_edit/.test(t.url || '')) ||
      fresh.find((t) => !/^devtools:/.test(t.url || ''));
    if (page) return page;
    await bp.sleep(500);
  }
  return null;
}

async function connectTab(page, ctx) {
  let tabCall = null;
  tabCall = await browserLogin.cdpConnect(page.webSocketDebuggerUrl, (msg) => {
    if (!msg || msg.method !== 'Page.javascriptDialogOpening') return;
    const params = msg.params || {};
    const text = String(params.message || params.type || '').replace(/\s+/g, ' ').slice(0, 120);
    if (ctx) ctx.log('视频编辑页弹窗：' + (text || '确认框') + '，已自动确认', 'warn');
    Promise.resolve()
      .then(() => tabCall && tabCall('Page.handleJavaScriptDialog', { accept: true }, 5000))
      .catch(() => {});
  });
  await tabCall('Page.enable', {});
  await tabCall('Runtime.enable', {});
  try {
    await tabCall('Page.bringToFront', {});
  } catch (err) {
    /* 置前失败不影响后续操作 */
  }
  return tabCall;
}

/** 保存后页面可能跳到素材库列表；顺手关掉这些多余标签，避免影响后续复用。 */
async function closeStrayListTabs(browser) {
  const list = await browserLogin.httpJson(browser.port, '/json/list').catch(() => []);
  for (const t of list) {
    if (t.type !== 'page' || !t.id || !/action=list_video/.test(t.url || '')) continue;
    try {
      await browserLogin.httpJson(browser.port, '/json/close/' + t.id);
    } catch (err) {
      /* 标签可能已关闭 */
    }
  }
}

async function waitVideoPageReady(vcall, ctx) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    ensureActive(ctx);
    const info = await bp
      .evalJs(
        vcall,
        `(() => ({
          url: location.href,
          ready: !!document.querySelector('input[name="vid"]'),
          login: /loginpage|扫码登录/.test(location.href)
        }))()`,
        8000
      )
      .catch(() => null);
    if (info && info.login) {
      throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
    }
    if (info && info.ready) return true;
    await bp.sleep(500);
  }
  throw new Error('公众号视频编辑页加载超时，页面可能已改版');
}

async function fillVideoTitle(vcall, ctx, value) {
  const filled = await bp.evalJs(vcall, fillVideoTitleExpr(value), 10000).catch(() => null);
  if (filled !== value) throw new Error('没有找到视频标题输入框，页面可能已改版');
  let vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
  if (vue && vue.title !== value) {
    await bp.evalJs(vcall, fillVideoTitleExpr(value), 8000).catch(() => null);
    await bp.sleep(200);
    vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
  }
  if (vue && vue.title !== value) {
    ctx.log('视频标题未能同步到页面表单，保存可能被拦截', 'warn');
  } else {
    ctx.log('已填写视频标题');
  }
}

async function checkVideoRule(vcall, ctx) {
  const agreed = await bp.evalJs(vcall, checkVideoRuleExpr(), 10000).catch(() => '');
  const vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
  const synced = vue ? !!vue.agree : agreed === 'ok';
  if (synced) ctx.log('已勾选视频上传服务规则');
  else if (agreed === 'missing') ctx.log('没有找到视频上传服务规则勾选项，继续尝试保存', 'warn');
  else ctx.log('未能勾选视频上传服务规则，保存可能被拦截', 'warn');
}

async function waitVideoUploaded(vcall, ctx, baseName, videoTitle) {
  const started = Date.now();
  let lastLog = 0;
  let repairs = 0;
  let state = null;
  while (Date.now() - started < VIDEO_UPLOAD_WAIT_MS) {
    ensureActive(ctx);
    state = (await bp.evalJs(vcall, videoPageStateExpr(), 10000).catch(() => null)) || state;
    if (state && state.login) {
      throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
    }
    if (state && state.failed) {
      throw new Error('公众号视频上传失败（' + baseName + '），请检查视频格式、大小或网络后重试');
    }
    const vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
    const uploaded = !!(state && state.uploaded) || !!(vue && vue.videoStatus >= 2);
    if (uploaded && state && state.saveReady) {
      ctx.log('视频上传完成，已可保存');
      return true;
    }
    if (uploaded && repairs < 3) {
      // 上传已完成但保存条件未满足：优先补填标题 / 勾选服务规则
      repairs++;
      await bp.evalJs(vcall, fillVideoTitleExpr(videoTitle), 8000).catch(() => null);
      await bp.evalJs(vcall, checkVideoRuleExpr(), 8000).catch(() => null);
      await bp.sleep(500);
      continue;
    }
    if (uploaded) {
      const missing = [];
      if (vue && vue.title !== videoTitle) missing.push('标题');
      if (vue && !vue.agree) missing.push('服务规则');
      throw new Error(
        '视频已上传，但保存条件未满足' + (missing.length ? '（' + missing.join('、') + '）' : '') + '，请到公众号后台确认'
      );
    }
    const elapsed = Date.now() - started;
    if (elapsed - lastLog >= 20000) {
      lastLog = elapsed;
      const note = state && state.percent
        ? '（' + state.percent + '%）'
        : state && state.uploading
          ? '（处理中）'
          : '';
      ctx.log('视频上传/处理中' + note + '…');
    }
    await bp.sleep(2000);
  }
  const vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
  const detail = vue ? '（状态 ' + vue.videoStatus + '）' : '';
  throw new Error(
    '公众号视频上传等待超时（' +
      Math.round(VIDEO_UPLOAD_WAIT_MS / 60000) +
      ' 分钟）' +
      detail +
      '，请检查网络或视频格式'
  );
}

/** 上传完成后选择一张推荐封面：点封面 → 在「编辑封面」对话框点「完成」。 */
async function pickVideoCover(vcall, ctx) {
  const started = Date.now();
  let clickedAt = 0;
  let lastLog = 0;
  while (Date.now() - started < 90000) {
    ensureActive(ctx);
    const vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
    if (vue && vue.coverValid) {
      ctx.log('已设置视频封面');
      return true;
    }
    const done = await bp.evalJs(vcall, clickCoverDoneExpr(), 8000).catch(() => '');
    if (done === 'ok') {
      ctx.log('已确认封面裁剪');
      await bp.sleep(1000);
      const after = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
      if (after && after.coverValid) {
        ctx.log('已设置视频封面');
        return true;
      }
      clickedAt = 0;
      continue;
    }
    // 封面点击要真实鼠标事件，程序化 click() 不会触发平台的编辑封面弹窗。
    if (!clickedAt || Date.now() - clickedAt > 10000) {
      const rect = await bp.evalJs(vcall, coverItemRectExpr(), 10000).catch(() => null);
      if (rect && rect.x > 0 && rect.y > 0) {
        try {
          await bp.sleep(300);
          await vcall('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y }, 5000);
          await vcall('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, 5000);
          await vcall('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, 5000);
          clickedAt = Date.now();
          ctx.log('已选择推荐封面');
          await bp.sleep(1500);
          continue;
        } catch (err) {
          /* 鼠标事件失败时继续等待下一轮 */
        }
      }
    }
    const elapsed = Date.now() - started;
    if (elapsed - lastLog >= 10000) {
      lastLog = elapsed;
      ctx.log('等待公众号生成推荐封面…');
    }
    await bp.sleep(1500);
  }
  return false;
}

async function saveVideoMaterial(vcall, ctx, browser, pageId) {
  const clicked = await bp.evalJs(vcall, clickVideoSaveExpr(), 10000).catch(() => '');
  if (clicked !== 'ok') {
    const state = await bp.evalJs(vcall, videoPageStateExpr(), 8000).catch(() => null);
    const hint = state && !state.agreed ? '（请确认已勾选《公众平台视频上传服务规则》）' : '';
    throw new Error('公众号视频已上传，但「保存」按钮不可用' + hint);
  }
  ctx.log('已点击「保存」，等待视频入库…');

  const started = Date.now();
  let last = null;
  let confirmations = 0;
  while (Date.now() - started < VIDEO_SAVE_WAIT_MS) {
    ensureActive(ctx);
    // 未声明原创时保存接口返回 ret=64716，平台弹「提交视频」确认框，需点「继续提交」
    if (confirmations < 3) {
      const confirmed = await bp.evalJs(vcall, confirmVideoSubmitExpr(), 8000).catch(() => '');
      if (confirmed === 'ok') {
        confirmations++;
        ctx.log('已确认「视频未声明原创」提示，继续提交');
        await bp.sleep(1000);
        continue;
      }
    }
    // 保存成功后平台可能弹确认框、跳转素材库或直接关闭该标签页，
    // 这些情况下页面内的状态读取会失效，改从浏览器目标列表判断。
    if (browser) {
      const targets = await browserLogin.httpJson(browser.port, '/json/list').catch(() => []);
      const target = targets.find((t) => t.id === pageId);
      if (!target) {
        ctx.log('视频编辑页已关闭，按保存成功处理');
        return true;
      }
      if (/action=list_video/.test(target.url || '')) {
        ctx.log('视频素材已保存');
        return true;
      }
    }
    last = (await bp.evalJs(vcall, videoPageStateExpr(), 10000).catch(() => null)) || last;
    const vue = await bp.evalJs(vcall, videoVueStateExpr(), 8000).catch(() => null);
    if ((last && last.saved) || (vue && vue.videoStatus === 3)) {
      ctx.log('视频素材已保存');
      return true;
    }
    if (last && /请完善表单信息|请设置封面|保存失败|系统异常|上传失败/.test(last.text || '')) {
      const hit = String(last.text).match(/请完善表单信息|请设置封面|保存失败[^\n]*|系统异常[^\n]*|上传失败[^\n]*/);
      throw new Error('公众号视频保存失败：' + ((hit && hit[0]) || '请到公众号后台确认'));
    }
    await bp.sleep(1000);
  }
  throw new Error('公众号视频保存超时，请到公众号素材库确认视频是否已入库');
}

/**
 * 通过编辑器「视频」弹窗上传本地视频并插入正文。
 * 注意：点击「本地上传」并不会在当前页上传，而是新开 videomsg_edit 页；
 * 在那里上传、填写标题、勾选规则并保存到素材库后，再回素材库选中插入。
 */
async function insertVideo(call, ctx, file, title, browser) {
  const baseName = path.basename(file);
  const videoTitle = sanitizeVideoTitle(title);

  await openVideoDialog(call, ctx);
  await bp.sleep(800);

  const before = await browserLogin.httpJson(browser.port, '/json/list').catch(() => []);
  const knownIds = new Set(before.map((t) => t.id));
  const tab = await clickUploadTab(call);
  if (tab) ctx.log('已切换到「' + tab + '」');

  const page = await waitForNewTab(browser, knownIds, ctx);
  if (!page) {
    throw new Error('点击「本地上传」后没有打开公众号视频编辑页，请确认浏览器未拦截弹窗后重试');
  }
  ctx.log('已打开视频编辑页，开始上传视频');

  let vcall = null;
  try {
    vcall = await connectTab(page, ctx);
    await waitVideoPageReady(vcall, ctx);
    await bp.attachFiles(vcall, [file], { platform: PLATFORM }, ctx, 'video');
    ctx.log('视频已交入上传控件，等待公众号处理（大文件可能需要较长时间）…');
    await fillVideoTitle(vcall, ctx, videoTitle);
    await checkVideoRule(vcall, ctx);
    await waitVideoUploaded(vcall, ctx, baseName, videoTitle);
    if (!(await pickVideoCover(vcall, ctx))) {
      throw new Error('公众号视频封面未能自动设置，请到公众号后台确认后重试');
    }
    await saveVideoMaterial(vcall, ctx, browser, page.id);
  } finally {
    if (vcall) {
      try { await vcall('Page.close', {}, 5000); } catch (err) { /* 页面可能已关闭 */ }
      try { vcall.close(); } catch (err) { /* 连接可能已断开 */ }
    }
    await closeStrayListTabs(browser);
  }

  await selectUploadedVideo(call, ctx, videoTitle);
}

/** 回图文页刷新素材库，选中刚上传的视频并插入正文。 */
async function selectUploadedVideo(call, ctx, title) {
  const started = Date.now();
  let lastLog = 0;
  let first = true;
  while (Date.now() - started < VIDEO_LIST_WAIT_MS) {
    ensureActive(ctx);
    if (first) {
      first = false;
    } else {
      await bp.evalJs(call, closeVideoDialogExpr()).catch(() => false);
      await bp.sleep(600);
      await openVideoDialog(call, ctx);
      await bp.sleep(1500);
    }

    const state = await bp.evalJs(call, pickerStateExpr(title), 15000).catch(() => null);
    if (state && state.open && state.match) {
      if (state.match.disabled) {
        ctx.log('素材库已出现该视频，仍在处理（' + (state.match.status || '转码/审核中') + '），继续等待…');
      } else {
        await bp.evalJs(call, clickVideoItemExpr(title), 12000).catch(() => '');
        await bp.sleep(400);
        const checked = await bp.evalJs(call, pickerStateExpr(title), 12000).catch(() => null);
        if (checked && checked.selected > 0) {
          ctx.log('已在素材库选中刚上传的视频');
          const clicked = await bp.evalJs(call, clickVideoConfirmExpr(), 10000).catch(() => '');
          if (clicked) ctx.log('已点击「' + clicked + '」，等待视频插入正文');
          const deadline = Date.now() + VIDEO_INSERT_WAIT_MS;
          let stillOpen = true;
          while (Date.now() < deadline) {
            ensureActive(ctx);
            if (await bodyHasVideo(call)) {
              ctx.log('视频已插入正文');
              return true;
            }
            const picker = await bp.evalJs(call, pickerStateExpr(title), 10000).catch(() => null);
            stillOpen = !!(picker && picker.open);
            if (!stillOpen) break;
            await bp.sleep(1500);
          }
          if (!stillOpen) {
            // 弹窗已关闭说明平台已接受插入；重复点击「确定」会插入多条视频
            ctx.log('视频弹窗已关闭，按已插入处理（请到草稿箱确认视频位置）', 'warn');
            return true;
          }
          ctx.log('视频未能插入正文，重试选择…', 'warn');
        }
      }
    }

    const elapsed = Date.now() - started;
    if (elapsed - lastLog >= 20000) {
      lastLog = elapsed;
      ctx.log(
        '等待视频出现在素材库' +
          (state && state.open ? '（当前 ' + state.count + ' 条）' : '') +
          '…'
      );
    }
    await bp.sleep(3000);
  }
  throw new Error('视频素材已保存，但未能自动插入正文，请到公众号草稿箱手动插入');
}

/**
 * 正文插入视频后，公众号还要求设置分享封面：
 * 悬停封面预览 → 点「换一张」→ 从图片库选择 → 下一步 → 确认。
 * 图片库按排期封面的文件名匹配（形如 <hash>_<时间戳>_<序号>.png），找不到就跳过并告警。
 */
async function setArticleCover(call, ctx, covers) {
  const list = (covers || []).filter((item) => item && item.name);
  const cover = list.find((item) => item.ratio === 'original') || list[0];
  if (!cover) {
    ctx.log('没有排期封面，跳过公众号封面设置', 'warn');
    return false;
  }
  const stem = path.basename(String(cover.name), path.extname(String(cover.name))).replace(/-original$/i, '');
  const hash = (stem.match(/[0-9a-f]{32}/i) || [])[0] || stem;

  // 封面操作条只在悬停时出现，且程序化 click() 不会触发弹层，必须用真实鼠标事件。
  const rect = await bp
    .evalJs(
      call,
      `(() => {
        const preview = document.querySelector('.js_cover_preview_new');
        const anchor = document.querySelector('a.js_chooseCover');
        if (!preview || !anchor) return null;
        preview.scrollIntoView({ block: 'center' });
        const pr = preview.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        return {
          hoverX: pr.left + pr.width / 2,
          hoverY: pr.top + pr.height / 2,
          x: ar.left + ar.width / 2,
          y: ar.top + ar.height / 2
        };
      })()`,
      10000
    )
    .catch(() => null);
  if (!rect) {
    ctx.log('没有找到封面选择入口，跳过封面设置', 'warn');
    return false;
  }

  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.hoverX, y: rect.hoverY }, 5000).catch(() => {});
  await bp.sleep(700);
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y }, 5000).catch(() => {});
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, 5000).catch(() => {});
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, 5000).catch(() => {});

  let menu = false;
  for (let i = 0; i < 20 && !menu; i++) {
    menu = !!(await bp
      .evalJs(
        call,
        `(() => {
          const btn = document.querySelector('.pop-opr__button.js_imagedialog');
          if (!btn) return false;
          const r = btn.getBoundingClientRect();
          const s = getComputedStyle(btn);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        })()`,
        8000
      )
      .catch(() => false));
    if (!menu) await bp.sleep(400);
  }
  if (!menu) {
    ctx.log('封面「换一张」菜单没有出现，跳过封面设置', 'warn');
    return false;
  }

  await bp
    .evalJs(
      call,
      `(() => {
        const btn = document.querySelector('.pop-opr__button.js_imagedialog');
        if (btn) btn.click();
        return !!btn;
      })()`,
      8000
    )
    .catch(() => false);

  let items = 0;
  for (let i = 0; i < 30 && !items; i++) {
    items = await bp
      .evalJs(call, `document.querySelectorAll('.weui-desktop-dialog_img-picker .weui-desktop-img-picker__item').length`, 8000)
      .catch(() => 0);
    if (!items) await bp.sleep(500);
  }
  if (!items) {
    ctx.log('图片库没有加载出来，跳过封面设置', 'warn');
    return false;
  }

  const picked = await bp
    .evalJs(
      call,
      `(() => {
        const items = Array.from(document.querySelectorAll('.weui-desktop-dialog_img-picker .weui-desktop-img-picker__item'));
        if (!items.length) return '';
        const texts = items.map((item) => String(item.innerText || '').replace(/\\s+/g, ' ').trim());
        let idx = texts.findIndex((text) => text.indexOf(${JSON.stringify(stem)}) >= 0);
        if (idx < 0) idx = texts.findIndex((text) => text.indexOf(${JSON.stringify(hash)}) >= 0);
        if (idx < 0) return '';
        const item = items[idx];
        const thumb = item.querySelector('.weui-desktop-img-picker__img-thumb') || item;
        thumb.click();
        return texts[idx];
      })()`,
      12000
    )
    .catch(() => '');
  if (!picked) {
    ctx.log('图片库中没有找到排期封面（' + stem + '），跳过封面设置', 'warn');
    await bp
      .evalJs(
        call,
        `(() => {
          const box = document.querySelector('.weui-desktop-dialog_img-picker');
          const btn = box && Array.from(box.querySelectorAll('button, a')).find((b) => String(b.innerText || '').trim() === '取消');
          if (btn) btn.click();
          return !!btn;
        })()`,
        8000
      )
      .catch(() => false);
    return false;
  }
  ctx.log('已从图片库选中封面：' + picked);

  await bp
    .evalJs(
      call,
      `(() => {
        const box = document.querySelector('.weui-desktop-dialog_img-picker');
        if (!box) return '';
        const btn = Array.from(box.querySelectorAll('button, a')).find((b) => String(b.innerText || '').trim() === '下一步');
        if (!btn) return '';
        btn.click();
        return '下一步';
      })()`,
      8000
    )
    .catch(() => '');

  const cropVisibleExpr = `(() => {
    return Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')).some((dialog) => {
      const r = dialog.getBoundingClientRect();
      const s = getComputedStyle(dialog);
      return r.width > 8 && r.height > 8 && s.display !== 'none' && s.visibility !== 'hidden' &&
        /编辑封面/.test(String(dialog.innerText || ''));
    });
  })()`;

  let crop = false;
  for (let i = 0; i < 30 && !crop; i++) {
    crop = !!(await bp.evalJs(call, cropVisibleExpr, 8000).catch(() => false));
    if (!crop) await bp.sleep(500);
  }
  if (!crop) {
    ctx.log('封面裁剪页没有出现，请到公众号后台确认封面', 'warn');
    return false;
  }

  const confirmed = await bp
    .evalJs(
      call,
      `(() => {
        const scopes = Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')).filter((dialog) => {
          const r = dialog.getBoundingClientRect();
          const s = getComputedStyle(dialog);
          return r.width > 8 && r.height > 8 && s.display !== 'none' && s.visibility !== 'hidden' &&
            /编辑封面/.test(String(dialog.innerText || ''));
        });
        for (const scope of scopes) {
          const btn = Array.from(scope.querySelectorAll('button, a')).find((b) => String(b.innerText || '').trim() === '确认');
          if (btn) {
            btn.click();
            return '确认';
          }
        }
        return '';
      })()`,
      10000
    )
    .catch(() => '');
  if (!confirmed) {
    ctx.log('封面裁剪页没有找到「确认」，请到公众号后台确认封面', 'warn');
    return false;
  }

  let closed = false;
  for (let i = 0; i < 20 && !closed; i++) {
    await bp.sleep(500);
    closed = !(await bp.evalJs(call, cropVisibleExpr, 8000).catch(() => true));
  }
  if (!closed) {
    ctx.log('封面弹窗未关闭，请到公众号后台确认封面', 'warn');
    return false;
  }
  ctx.log('已从图片库设置公众号封面');
  return true;
}

async function saveDraft(call, ctx) {
  const clicked = await bp
    .evalJs(
      call,
      `(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        const area = (el) => {
          const r = el.getBoundingClientRect();
          return r.width * r.height;
        };
        const wanted = ['保存为草稿', '保存'];
        const hits = Array.from(document.querySelectorAll('button, a, [role="button"], div, span'))
          .filter(visible)
          .map((el) => ({ el, text: String(el.innerText || el.textContent || '').trim(), area: area(el) }))
          .filter((item) => wanted.indexOf(item.text) >= 0)
          .sort((a, b) => wanted.indexOf(a.text) - wanted.indexOf(b.text) || a.area - b.area);
        if (!hits.length) return '';
        hits[0].el.click();
        return hits[0].text;
      })()`
    )
    .catch(() => '');
  if (!clicked) throw new Error('没有找到「保存为草稿」按钮，页面可能已改版');
  ctx.log('已点击「' + clicked + '」');

  const started = Date.now();
  let confirmed = false;
  while (Date.now() - started < 30000) {
    const info = await readInfo(call);
    if (isLoginPage(info)) {
      throw httpError(401, '公众号登录态已失效，请到「连接设置」重新一键登录');
    }
    if (info && /保存成功|已保存|草稿已保存/.test(info.text || '')) {
      confirmed = true;
      break;
    }
    await bp.sleep(1000);
  }
  if (confirmed) ctx.log('草稿保存成功');
  else ctx.log('未检测到保存成功提示，请到公众号草稿箱确认', 'warn');

  const info = await readInfo(call);
  let workId = '';
  try {
    const url = new URL(info.url);
    workId = url.searchParams.get('appmsgid') || url.searchParams.get('media_id') || '';
  } catch (err) {
    /* URL 解析失败时不影响任务结果 */
  }
  return { confirmed, workId };
}

async function run(ctx) {
  const task = ctx.task || {};
  if (task.platform !== PLATFORM) throw new Error('该任务不是公众号平台');
  const kind = ctx.kind === 'video' ? 'video' : 'image';
  const files =
    kind === 'image' ? (ctx.imagePaths || []).filter(Boolean) : ctx.videoPath ? [ctx.videoPath] : [];
  if (!files.length) throw new Error(kind === 'image' ? '任务没有图片素材' : '任务没有视频素材');
  const missing = files.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(
      (kind === 'image' ? '图片' : '视频') +
        '文件不存在：' +
        missing.map((file) => path.basename(file)).join('、')
    );
  }

  const connection = channelConnections.getRaw(PLATFORM);
  if (!connection || !connection.enabled) {
    throw httpError(400, '请先在「连接设置」完成公众号一键登录');
  }
  if (!String((connection.fields && connection.fields['Cookie']) || '').trim()) {
    throw httpError(400, '公众号缺少登录 Cookie，请到「连接设置」重新一键登录');
  }

  const title = String(task.title || '').trim().slice(0, TITLE_MAX);
  if (!title) throw new Error('公众号草稿需要标题');
  const tags = Array.isArray(task.tags) ? task.tags.filter(Boolean) : [];
  const bodyText = composeText(task, tags);

  const login = browserLogin.status();
  if (login.status === 'launching' || login.status === 'waiting') {
    throw httpError(409, '登录窗口正在进行，请完成后再发布');
  }

  browserLogin.acquire('publish-' + PLATFORM);
  const cfg = { platform: PLATFORM, cookieDomain: COOKIE_DOMAIN, uploadUrl: HOME_URL };
  let session = null;

  try {
    ctx.log('启动本地浏览器（专用 profile）');
    session = await bp.openSession(ctx, cfg);
    const call = session.call;

    await bp.injectCookies(call, cfg, ctx);
    const token = await openHome(call, ctx);
    await openEditor(call, ctx, token);
    ctx.log('图文编辑器已打开');

    await fillTitle(call, ctx, title);
    if (bodyText) await fillBody(call, ctx, bodyText);
    if (kind === 'image') {
      await pasteImages(call, ctx, files);
    } else {
      await insertVideo(call, ctx, files[0], title, session.browser);
      await setArticleCover(call, ctx, ctx.covers).catch((err) => {
        ctx.log('封面设置失败：' + (err && err.message ? err.message : err), 'warn');
        return false;
      });
    }

    const saved = await saveDraft(call, ctx);
    const kindLabel = kind === 'image' ? '图文' : '视频';
    const reviewHint = kind === 'video' ? '（视频需审核通过后才会对外展示）' : '';
    return {
      status: 'submitted',
      workId: saved.workId || undefined,
      message:
        '已在公众号草稿箱保存' +
        kindLabel +
        '草稿' +
        (saved.workId ? '（' + saved.workId + '）' : '') +
        '，请打开 mp.weixin.qq.com 草稿箱确认排版' +
        reviewHint +
        '后手动发表'
    };
  } catch (err) {
    if (session) await bp.captureScreenshot(session.call, ctx, 'failed');
    throw err;
  } finally {
    if (session) {
      if (session.browser && session.browser.reused && session.browser.target) {
        try {
          await session.closePage();
        } catch (err) {
          /* 页面可能已关闭 */
        }
      }
      session.call.close();
      if (session.browser && !session.browser.reused) {
        await session.closeBrowser();
      }
    }
    browserLogin.release('publish-' + PLATFORM);
  }
}

module.exports = { key: PLATFORM, supported: true, kinds: ['image', 'video'], run };
