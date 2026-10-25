'use strict';

/**
 * 微博发布适配器。
 *
 * 图文走首页顶部的发布框：先点「图片」按钮展开上传，再把素材交给页面里的
 * input[type=file]，最后填写正文并点「发送」。图文没有标题，标题并入正文首行。
 *
 * 视频走官方的视频投稿工具 https://video.weibo.com/upload：首页发布框不支持
 * 自定义封面，只有这个工具能选视频帧或上传自定义封面。流程是多步向导：
 * 上传视频 → 下一步 → 确认「视频投稿」→ 填博文内容/视频标题 → 上传封面 →
 * 勾选「快速发布」→ 发布。博文内容上限 250 字，视频标题 6~30 字。
 */

const path = require('path');
const { runWithConfig, evalJs, sleep, fieldHelpers } = require('./browser-publish');
const channelConnections = require('../channel-connections');

const HOME_URL = 'https://weibo.com/';
const VIDEO_URL = 'https://video.weibo.com/upload#/';
const POSTS_API = 'https://weibo.com/ajax/statuses/mymblog';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
// 发布成功后在个人博文列表里轮询一小段时间；仍查不到就保留「待核验」，交给发布队列定时复核
const VERIFY_MS = 90 * 1000;
const VERIFY_INTERVAL_MS = 10 * 1000;

const IMAGE_DESC_MAX = 2000;
const VIDEO_DESC_MAX = 250;
const TAGS_MAX = 6;

// 微博视频封面在信息流里按 2:1 展示，优先用最接近的 16:9
const COVER_PREFERENCE = ['16:9', 'original', '3:2', '4:3', '1:1', '9:16', '3:4'];

const UPLOAD_LIMIT_MS = 60 * 60 * 1000;

function tagsLine(tags, limit) {
  return (tags || [])
    .map((t) => String(t || '').trim().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, limit)
    .map((t) => '#' + t + '#')
    .join(' ');
}

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

function compose(task, tags, kind) {
  const line = tagsLine(tags, TAGS_MAX);
  const title = String(task.title || '').trim();
  const body = String(task.description || '').trim();
  if (kind === 'image') {
    const parts = [title, body, line].filter(Boolean);
    return { title: '', description: parts.join('\n').slice(0, IMAGE_DESC_MAX) };
  }
  const parts = [body, line].filter(Boolean);
  // 博文内容在视频投稿工具里是必填项，正文为空时用标题兜底
  const description = (parts.join('\n') || title).slice(0, VIDEO_DESC_MAX);
  return { title: title.slice(0, 30), description };
}

/** 发布用的登录态与「连接设置」里的 Cookie 来自同一个浏览器 profile，直接据此核验博文列表 */
function savedCookie() {
  const raw = channelConnections.getRaw('微博');
  return raw && raw.enabled ? String((raw.fields && raw.fields['Cookie']) || '').trim() : '';
}

let cachedUid = '';

/** 首页 CONFIG 里带有当前登录用户的 uid，用它拉取个人博文列表 */
async function fetchUid(cookie) {
  if (cachedUid) return cachedUid;
  const resp = await fetch(HOME_URL, {
    headers: { Cookie: cookie, 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }
  });
  if (!resp.ok) throw new Error('微博首页返回 HTTP ' + resp.status);
  const html = await resp.text();
  const m = html.match(/"uid"\s*:\s*"?(\d+)/);
  if (!m) return '';
  cachedUid = m[1];
  return cachedUid;
}

async function fetchPosts(cookie, uid) {
  const url = POSTS_API + '?uid=' + encodeURIComponent(uid) + '&page=1&feature=0';
  const resp = await fetch(url, {
    headers: {
      Cookie: cookie,
      'User-Agent': UA,
      Referer: HOME_URL,
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest'
    }
  });
  if (!resp.ok) throw new Error('博文列表返回 HTTP ' + resp.status);
  const json = await resp.json().catch(() => null);
  if (!json || json.ok !== 1) throw new Error((json && json.message) || '博文列表接口返回异常');
  return (json.data && json.data.list) || [];
}

function normalizeText(text) {
  return String(text || '')
    .replace(/#[^#\s]*#?/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function taskTimeMs(task) {
  const raw = task && (task.finishedAt || task.startedAt);
  const time = new Date(raw || '').getTime();
  return Number.isFinite(time) ? time : Date.now();
}

/** 定时复核拿到的是公共任务对象（没有 kind），图文/视频两种文案都参与匹配 */
function wantedTexts(task) {
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const kinds = task.kind === 'image' || task.kind === 'video' ? [task.kind] : ['video', 'image'];
  return kinds.map((kind) => normalizeText(compose(task, tags, kind).description)).filter(Boolean);
}

/** 在个人博文列表里按正文匹配，只接受发布之后创建的博文 */
function matchPost(posts, task, sinceMs) {
  const wantedList = wantedTexts(task);
  if (!wantedList.length) return null;
  const now = Date.now();
  const hits = [];
  (posts || []).forEach((item) => {
    if (!item || !item.id) return;
    const at = new Date(item.created_at || '').getTime();
    if (!Number.isFinite(at)) return;
    if (sinceMs && at < sinceMs) return;
    if (at > now + 10 * 60 * 1000) return;
    const got = normalizeText(item.text_raw || item.text);
    if (!got) return;
    const hit = wantedList.some(
      (wanted) =>
        got === wanted ||
        (Math.min(got.length, wanted.length) >= 8 &&
          (got.indexOf(wanted) >= 0 || wanted.indexOf(got) >= 0))
    );
    if (hit) hits.push(item);
  });
  hits.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return hits[0] || null;
}

/**
 * 轮询个人博文列表核验新博文。
 * waitMs 为 0 时只查一次（供发布队列的定时复核使用），此时博文可能在
 * 微博转码/审核完成后才出现，查到后由发布队列自动改判「已发布」。
 */
async function verifyWork(task, ctx, opts) {
  const o = opts || {};
  const log = (ctx && ctx.log) || (() => {});
  const waitMs = o.waitMs == null ? VERIFY_MS : Number(o.waitMs);
  const cookie = savedCookie();
  if (!cookie) {
    log('没有可用的微博 Cookie，跳过博文列表核验', 'warn');
    return null;
  }

  let uid = '';
  try {
    uid = await fetchUid(cookie);
  } catch (err) {
    log('读取微博用户 ID 失败：' + err.message, 'warn');
    return null;
  }
  if (!uid) {
    log('未能从微博首页识别当前登录用户，跳过博文列表核验', 'warn');
    return null;
  }

  const sinceMs = taskTimeMs(task) - 10 * 60 * 1000;
  const started = Date.now();
  do {
    try {
      const posts = await fetchPosts(cookie, uid);
      const hit = matchPost(posts, task, sinceMs);
      if (hit) {
        const mblogid = String(hit.mblogid || hit.id);
        const workId = String(hit.id || mblogid);
        log('博文列表已匹配到新博文：' + workId);
        return { workId, publishUrl: 'https://weibo.com/' + uid + '/' + mblogid };
      }
    } catch (err) {
      log('博文列表核验失败：' + err.message, 'warn');
    }
    if (Date.now() - started >= waitMs) break;
    await sleep(VERIFY_INTERVAL_MS);
  } while (Date.now() - started < waitMs);

  return null;
}

/** 发布队列定时复核「待核验」任务时调用：只查一次 */
async function verifySubmitted(task) {
  return verifyWork(task, null, { waitMs: 0 });
}

async function clickByText(call, label) {
  return evalJs(
    call,
    `(() => {
      const want = ${JSON.stringify(label)};
      const hit = Array.from(document.querySelectorAll('button, [role=button], a, div, span, li'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (el.innerText || '').replace(/\\s+/g, '') === want;
        })
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return ra.width * ra.height - rb.width * rb.height;
        })[0];
      if (!hit) return '';
      hit.click();
      return 'ok';
    })()`
  ).catch(() => '');
}

/** 等文件上传完成：工具此时才渲染「选择发布类型」和「下一步」 */
async function waitVideoUploaded(call, ctx) {
  const started = Date.now();
  let lastLog = 0;
  for (;;) {
    if (ctx.isAborted && ctx.isAborted()) throw new Error('发布任务已被删除，自动发布已中止');
    if (Date.now() - started > UPLOAD_LIMIT_MS) {
      throw new Error('微博视频上传超时（60 分钟），请检查网络后重试');
    }
    const text = await evalJs(
      call,
      `String(document.body ? document.body.innerText : '')`
    ).catch(() => '');
    const failed = text.match(/[^\n]{0,30}上传失败[^\n]{0,30}/);
    if (failed) throw new Error('微博视频上传失败：' + failed[0].trim());
    if (/选择发布类型/.test(text) && /上传成功/.test(text)) {
      ctx.log('视频已上传完成（' + Math.round((Date.now() - started) / 1000) + 's）');
      return;
    }
    if (Date.now() - lastLog > 20000) {
      lastLog = Date.now();
      const percent = (text.match(/已完成[:：]?\s*(\d+(?:\.\d+)?%)/) || [])[1] || '';
      const speed = (text.match(/当前速度[:：]?\s*([^\s]+)/) || [])[1] || '';
      ctx.log('微博视频上传中' + (percent ? '（' + percent + '）' : '') + (speed ? '，' + speed : '') + '…');
    }
    await sleep(2000);
  }
}

async function waitFormReady(call, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await evalJs(
      call,
      `(() => {
        ${fieldHelpers(cfg)}
        return !!(findTitleField() && findDescField());
      })()`
    ).catch(() => false);
    if (ok) return true;
    await sleep(1000);
  }
  return false;
}

/** 上传完成后点「下一步」，确认「视频投稿」，等表单出现 */
async function openPublishForm(call, ctx) {
  await waitVideoUploaded(call, ctx);

  if (!(await clickByText(call, '下一步'))) {
    throw new Error('微博投稿工具没有出现「下一步」按钮，页面可能已改版，请查看截图');
  }
  ctx.log('已点击「下一步」，确认发布类型');

  // 发布类型确认弹窗渲染有延迟，这里轮询点击；确认后类型不可修改
  let confirmed = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (await clickByText(call, '确定')) {
      confirmed = true;
      break;
    }
  }
  if (confirmed) ctx.log('已确认「视频投稿」发布类型');
  else ctx.log('未出现发布类型确认弹窗，继续等待投稿表单', 'warn');

  if (!(await waitFormReady(call, 60000))) {
    throw new Error('确认发布类型后没有进入投稿表单，请查看截图');
  }
}

async function imageInputNode(call) {
  await call('DOM.enable', {});
  const doc = await call('DOM.getDocument', { depth: -1, pierce: true });
  if (!doc || !doc.root) return null;
  let found = null;
  const walk = (node) => {
    if (!node || found !== null) return;
    if (node.nodeName === 'INPUT') {
      const attrs = {};
      const list = node.attributes || [];
      for (let i = 0; i + 1 < list.length; i += 2) attrs[list[i]] = list[i + 1];
      if (String(attrs.type || '').toLowerCase() === 'file' && /image/i.test(String(attrs.accept || ''))) {
        found = node.nodeId;
        return;
      }
    }
    (node.children || []).forEach(walk);
    (node.shadowRoots || []).forEach(walk);
    if (node.contentDocument) walk(node.contentDocument);
  };
  walk(doc.root);
  return found;
}

/** 交入封面图后，工具会把它上传到微博并写入发布参数，等左侧封面预览出现即成功 */
async function waitCoverPreview(call, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evalJs(
      call,
      `(() => {
        const img = document.querySelector('.multimediaPublishCover .image-covers img');
        const text = String(document.body ? document.body.innerText : '');
        return {
          ready: !!(img && img.src),
          rejected: /文件格式不正确|封面.*失败|上传图片失败/.test(text)
        };
      })()`
    ).catch(() => null);
    if (state && state.ready) return true;
    if (state && state.rejected) return false;
    await sleep(500);
  }
  return false;
}

async function applyCover(call, ctx) {
  const covers = Array.isArray(ctx.covers) ? ctx.covers.filter((item) => item && item.path) : [];
  if (!covers.length) {
    ctx.log('微博封面：排期未设置封面，沿用视频截图作为封面');
    return false;
  }
  const cover = pickCover(covers);

  const nodeId = await imageInputNode(call);
  if (nodeId === null) {
    ctx.log('微博封面：没有找到封面图片上传控件，跳过', 'warn');
    return false;
  }
  await call('DOM.setFileInputFiles', { nodeId, files: [path.resolve(cover.path)] });
  if (!(await waitCoverPreview(call, 20000))) {
    ctx.log('微博封面：上传后没有出现封面预览，继续发布', 'warn');
    return false;
  }
  ctx.log('微博封面：已设置 ' + cover.name + '（' + ratioLabel(cover.ratio) + '）');
  return true;
}

const CHANNEL_PARENT = '知识';
const CHANNEL_CHILD = '互联网';

function channelValueExpr() {
  return `(() => {
    const wrap = Array.from(document.querySelectorAll('.el-form-item')).find((el) => {
      const l = el.querySelector('label');
      return l && (l.innerText || '').trim() === '频道';
    });
    const input = wrap && wrap.querySelector('input');
    return input ? String(input.value || '') : '';
  })()`;
}

/**
 * 频道是必填的级联选择器，默认选「知识 / 互联网」。
 *
 * Element Plus 的级联节点只响应真实鼠标事件，脚本 dispatch 的 .click() 打不开二级；
 * 而且页签不在前台时下拉不会展开，所以先 bringToFront，再用 CDP Input 点击。
 */
async function selectChannel(call, ctx) {
  const current = await evalJs(call, channelValueExpr()).catch(() => '');
  if (current.indexOf(CHANNEL_PARENT) >= 0 && current.indexOf(CHANNEL_CHILD) >= 0) return true;

  try {
    await call('Page.bringToFront', {});
  } catch (err) { /* 无窗口可聚焦时继续 */ }

  const clickAt = async (pt) => {
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none', clickCount: 0 });
    await sleep(120);
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(80);
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  };

  const pointOf = (label) =>
    evalJs(
      call,
      `(() => {
        const popper = Array.from(document.querySelectorAll('.el-cascader__dropdown'))
          .filter((el) => /VLOG/.test(el.innerText || '') && getComputedStyle(el).display !== 'none')[0];
        if (!popper) return null;
        const want = ${JSON.stringify(label)};
        const hit = Array.from(popper.querySelectorAll('.el-cascader-node'))
          .find((n) => String((n.querySelector('.el-cascader-node__label') || {}).innerText || '').trim() === want);
        if (!hit) return null;
        hit.scrollIntoView({ block: 'nearest' });
        const r = hit.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`
    ).catch(() => null);

  const field = await evalJs(
    call,
    `(() => {
      const wrap = Array.from(document.querySelectorAll('.el-form-item')).find((el) => {
        const l = el.querySelector('label');
        return l && (l.innerText || '').trim() === '频道';
      });
      const input = wrap && wrap.querySelector('input');
      if (!input) return null;
      input.scrollIntoView({ block: 'center' });
      const r = input.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`
  ).catch(() => null);
  if (!field) {
    ctx.log('微博频道：没有找到频道选择器', 'warn');
    return false;
  }

  const dropdownOpen = await evalJs(
    call,
    `(() => Array.from(document.querySelectorAll('.el-cascader__dropdown'))
      .some((el) => /VLOG/.test(el.innerText || '') && getComputedStyle(el).display !== 'none'))()`
  ).catch(() => false);
  if (!dropdownOpen) {
    await clickAt(field);
    await sleep(600);
  }

  const parentPt = await pointOf(CHANNEL_PARENT);
  if (!parentPt) {
    ctx.log('微博频道：下拉里没有找到「' + CHANNEL_PARENT + '」', 'warn');
    return false;
  }
  await clickAt(parentPt);
  await sleep(900);

  const childPt = await pointOf(CHANNEL_CHILD);
  if (!childPt) {
    ctx.log('微博频道：「' + CHANNEL_PARENT + '」下没有找到「' + CHANNEL_CHILD + '」', 'warn');
    return false;
  }
  await clickAt(childPt);
  await sleep(700);

  const final = await evalJs(call, channelValueExpr()).catch(() => '');
  if (final.indexOf(CHANNEL_PARENT) >= 0 && final.indexOf(CHANNEL_CHILD) >= 0) {
    ctx.log('微博频道：已选择 ' + final);
    return true;
  }
  ctx.log('微博频道：选择后当前值为「' + final + '」', 'warn');
  return false;
}

const TAG_MAX = 10;

function normalizeTags(tags) {
  const out = [];
  for (const raw of tags || []) {
    const tag = String(raw || '').trim().replace(/^#+|#+$/g, '');
    if (tag && out.indexOf(tag) < 0) out.push(tag);
  }
  return out.slice(0, TAG_MAX);
}

/**
 * 投稿信息里的「标签」是必填项（按回车创建），不填发布会校验失败。
 * 任务没有标签时用频道默认值兜底，保证至少有一个标签。
 */
async function fillTags(call, ctx, tags) {
  let list = normalizeTags(tags);
  if (!list.length) {
    list = [CHANNEL_PARENT, CHANNEL_CHILD];
    ctx.log('微博标签：任务没有标签，使用频道默认标签 ' + list.join('、'));
  }

  const tagStateExpr = `(() => {
    const wrap = Array.from(document.querySelectorAll('.el-form-item')).find((el) => {
      const l = el.querySelector('label');
      return l && (l.innerText || '').trim() === '标签';
    });
    if (!wrap) return null;
    const input = wrap.querySelector('input');
    return {
      hasInput: !!input,
      tags: Array.from(wrap.querySelectorAll('.el-tag')).map((el) => String(el.innerText || '').replace(/\\s+/g, ' ').trim())
    };
  })()`;

  const before = await evalJs(call, tagStateExpr).catch(() => null);
  if (!before || !before.hasInput) {
    ctx.log('微博标签：没有找到标签输入框', 'warn');
    return false;
  }

  const focused = await evalJs(
    call,
    `(() => {
      const wrap = Array.from(document.querySelectorAll('.el-form-item')).find((el) => {
        const l = el.querySelector('label');
        return l && (l.innerText || '').trim() === '标签';
      });
      const input = wrap && wrap.querySelector('input');
      if (!input) return false;
      input.focus();
      return document.activeElement === input;
    })()`
  ).catch(() => false);
  if (!focused) {
    ctx.log('微博标签：标签输入框无法聚焦', 'warn');
    return false;
  }

  for (const tag of list) {
    if (before.tags.indexOf(tag) >= 0) continue;
    await call('Input.insertText', { text: tag });
    await sleep(150);
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13
    });
    await sleep(350);
  }

  const after = await evalJs(call, tagStateExpr).catch(() => null);
  const got = after ? after.tags : [];
  const missing = list.filter((tag) => got.indexOf(tag) < 0);
  if (!missing.length) {
    ctx.log('微博标签：已设置 ' + list.join('、'));
    return true;
  }
  ctx.log('微博标签：未成功设置 ' + missing.join('、') + '（当前：' + (got.join('、') || '空') + '）', 'warn');
  return false;
}

/** 勾选「快速发布」，标清视频转出后即可发博，不必等高清转码 */
async function ensureQuickPublish(call, ctx) {
  const initial = await evalJs(
    call,
    `(() => {
      const box = Array.from(document.querySelectorAll('.el-checkbox'))
        .filter((el) => el.getClientRects().length && /快速发布/.test(el.innerText || ''))[0];
      if (!box) return 'missing';
      const input = box.querySelector('.el-checkbox__input');
      const checked = !!input && /is-checked/.test(input.className);
      if (!checked) box.click();
      return checked ? 'checked' : 'clicked';
    })()`
  ).catch(() => 'missing');

  if (initial === 'missing') {
    ctx.log('微博：没有找到「快速发布」选项，等转码完成后再发布', 'warn');
    return false;
  }
  if (initial === 'checked') {
    ctx.log('微博：「快速发布」已勾选');
    return true;
  }

  await sleep(400);
  const checked = await evalJs(
    call,
    `(() => {
      const box = Array.from(document.querySelectorAll('.el-checkbox'))
        .filter((el) => el.getClientRects().length && /快速发布/.test(el.innerText || ''))[0];
      const input = box && box.querySelector('.el-checkbox__input');
      return !!input && /is-checked/.test(input.className);
    })()`
  ).catch(() => false);
  if (checked) ctx.log('微博：已勾选「快速发布」');
  else ctx.log('微博：「快速发布」未能勾选，等转码完成后再发布', 'warn');
  return checked;
}

/** 首页已有文件输入时不再点击，避免弹出系统文件选择框（图文走这里） */
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
  uploadUrlFor: (kind) => (kind === 'video' ? VIDEO_URL : HOME_URL),
  cookieDomain: '.weibo.com',
  cookieMode: 'header',
  loginUrlRe: /passport\.weibo|\/signin|\/login/i,
  loginTextRe: /登录微博|扫码登录|立即登录/,
  kinds: ['video', 'image'],
  maxImages: 18,
  // 两套页面（首页发布框 / 视频投稿工具）的占位文案合在一起匹配
  titleHintRe: '视频标题|输入标题|标题',
  descHintRe: '博文内容|和大家分享|新鲜事|说点什么|分享|正文|内容',
  useTagInput: false,
  titleMax: 30,
  descFirst: true,
  publishButtons: ['发布'],
  successRe: /视频发布成功|发布成功|发布完成|提交成功|审核中/,
  preparePage: async (call, ctx, kind) => {
    if (kind === 'image') await openComposerEntry(call, ctx, kind);
  },
  onAttached: async (call, ctx, kind) => {
    if (kind === 'video') await openPublishForm(call, ctx);
  },
  compose,
  // 视频上传是否完成已在 onAttached 里由「上传成功/选择发布类型」判定；
  // 表单页顶部的「视频处理 18%」是转码进度，勾选「快速发布」后无需等它跑完，
  // 若仍按百分比判 uploading，会在这里一直等到 100%
  uploadPercentMarksUpload: false,
  // 1GB 以上的视频上传 + 标清转码可能接近一小时
  uploadTimeoutMs: UPLOAD_LIMIT_MS,
  prePublish: async (call, ctx, task, kind) => {
    if (kind !== 'video') return;
    const title = String((task && task.title) || '').trim();
    if (title.length < 6) {
      ctx.log('微博视频标题不足 6 字（当前 ' + title.length + ' 字），平台校验可能不通过', 'warn');
    }
    try {
      // 频道是必填项，失败时重试一次（下拉展开受页面焦点影响）
      if (!(await selectChannel(call, ctx))) {
        await sleep(800);
        await selectChannel(call, ctx);
      }
    } catch (err) {
      ctx.log('微博频道选择失败，继续发布：' + err.message, 'warn');
    }
    try {
      await fillTags(call, ctx, task && task.tags);
    } catch (err) {
      ctx.log('微博标签设置失败，继续发布：' + err.message, 'warn');
    }
    try {
      await applyCover(call, ctx);
    } catch (err) {
      ctx.log('微博封面设置失败，继续发布：' + err.message, 'warn');
    }
    try {
      await ensureQuickPublish(call, ctx);
    } catch (err) {
      ctx.log('勾选「快速发布」失败：' + err.message, 'warn');
    }
  },
  afterPublish: async (call, ctx) => {
    // 视频还在转码时点发布，工具会先受理，处理完成后自动发博。
    // 处理期间不要关闭投稿页，保留页面便于观察进度并等待自动发博完成。
    const text = await evalJs(
      call,
      `String(document.body ? document.body.innerText : '')`
    ).catch(() => '');
    if (/视频处理完成后将会自动发布/.test(text)) {
      ctx.log('微博已受理发布，视频仍在转码，保持投稿页打开等待自动发博', 'warn');
      return {
        status: 'submitted',
        keepOpen: true,
        message: '视频仍在转码，投稿页已保持打开，微博处理完成后会自动发博，请稍后核验'
      };
    }

    // 已正常发博时，到个人博文列表核验链接；查不到就保留「待核验」继续自动复核
    const verified = await verifyWork(ctx.task, ctx, { waitMs: VERIFY_MS });
    if (!verified) {
      ctx.log('未在微博博文列表核验到新博文（可能仍在转码或审核），保留「待核验」并继续自动复核', 'warn');
      return null;
    }
    return {
      status: 'published',
      workId: verified.workId,
      publishUrl: verified.publishUrl,
      message: '已发布并核验博文链接'
    };
  }
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '微博', supported: true, kinds: ['video', 'image'], run, verify: verifySubmitted };
