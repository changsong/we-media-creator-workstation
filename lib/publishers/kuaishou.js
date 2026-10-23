'use strict';

/**
 * 快手发布适配器。
 *
 * 投稿页：https://cp.kuaishou.com/article/publish/video
 * 快手网页端的正文是「作品描述」（≤500 字），标题会作为描述首行展示；
 * 自定义封面走「封面设置 → 上传封面 → 确认」，没有配置封面时沿用页面默认帧。
 */

const { runWithConfig, evalJs, sleep } = require('./browser-publish');

const DESC_MAX = 500;
const TAGS_MAX = 4;

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

// 上传后弹层里会出现「清空上传」，表示图片已经进入裁剪区，此时再确认才不会用视频默认帧
async function waitCoverLoaded(call, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const loaded = await evalJs(
      call,
      `(() => {
        ${visibleExpr()}
        const modal = Array.from(document.querySelectorAll('.ant-modal-content')).filter(visible)[0];
        return !!modal && /清空上传/.test(modal.innerText || '');
      })()`
    ).catch(() => false);
    if (loaded) return true;
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
  await call('DOM.setFileInputFiles', { nodeId, files: [cover.path] });
  const loaded = await waitCoverLoaded(call, 8000);
  if (!loaded) ctx.log('快手封面：图片预览没有出现，仍尝试确认', 'warn');

  const confirmed = await confirmCover(call);
  if (!confirmed) {
    ctx.log('快手封面：封面已上传但没有找到可点击的「确认」，跳过', 'warn');
    return false;
  }
  ctx.log('快手封面：已设置 ' + cover.name + '（' + ratioLabel(cover.ratio) + '）');
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
  uploadRouteRe: /article\/publish/,
  successRe: /发布成功|提交成功|审核中|发布完成/,
  compose
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: '快手', supported: true, kinds: ['video'], run };
