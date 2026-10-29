'use strict';

/**
 * B 站发布适配器。
 *
 * 投稿页：https://member.bilibili.com/platform/upload/video/frame
 * 标题与简介分开填写，标签走独立输入框；分区是必选项，
 * 这里按「连接设置 → B站 → 默认分区」的关键词在分区下拉里选择（新版投稿页只有一级，如「知识」；
 * 旧版写成「知识/科学科普」时会先选一级、若出现二级列表再继续选）。
 * 封面按任务封面变体自动上传（优先 16:9）；创作声明是必填项，默认选「无需标注」。
 * 投稿成功后从创作中心稿件列表按标题核验，拿到 BV 号即回填链接并标记为已发布。
 */

const fs = require('fs');
const { runWithConfig, clickMatch, sleep, evalJs, fileInputCandidates } = require('./browser-publish');
const channelConnections = require('../channel-connections');

// B站封面推荐 16:9，其余比例按接近程度兜底
const COVER_PREFERENCE = ['16:9', 'original', '3:2', '4:3', '1:1', '9:16', '3:4'];
const COVER_ENTRY = ['添加封面', '上传封面', '更换封面', '选择封面'];
const COVER_CONFIRM = ['使用此封面', '确定', '完成', '保存'];
const NOTICE_CLOSE = ['知道了', '我知道了', '暂不开启', '稍后再说'];

// 投稿成功后从创作中心稿件列表核验 BV 号；审核中的稿件也会立即出现在列表里
const VERIFY_API = 'https://member.bilibili.com/x2/creative/web/archives/sp?pn=1&ps=10';
const VERIFY_MS = 150 * 1000;
const VERIFY_INTERVAL_MS = 8000;
const VERIFY_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';

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

/** 关闭上传完成后弹出的通知/引导类对话框，避免挡住封面与表单 */
async function closeNotices(call, ctx) {
  let closed = 0;
  for (let round = 0; round < 2; round++) {
    let hit = '';
    for (const text of NOTICE_CLOSE) {
      hit = await clickMatch(call, text, true);
      if (hit) break;
    }
    if (!hit) break;
    closed++;
    ctx.log('已关闭B站提示弹窗：' + hit);
    await sleep(500);
  }
  return closed;
}

/** 只点弹层内的按钮，避免误触页面上的表单按钮 */
async function clickDialogButton(call, texts) {
  return evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const scopes = Array.from(document.querySelectorAll(
        '[role="dialog"], [class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"]'
      )).filter(visible);
      if (!scopes.length) return '';
      const want = ${JSON.stringify(texts)};
      const hits = [];
      scopes.forEach((scope) => {
        Array.from(scope.querySelectorAll('button, [role="button"], span, div')).forEach((el) => {
          if (!visible(el)) return;
          const text = (el.innerText || '').trim();
          if (!text || text.length > 8 || want.indexOf(text) < 0) return;
          if (Array.from(el.children).some((c) => want.indexOf((c.innerText || '').trim()) >= 0)) return;
          hits.push({ el, text, button: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' });
        });
      });
      if (!hits.length) return '';
      const hit = hits.find((item) => item.button) || hits[hits.length - 1];
      hit.el.click();
      return hit.text;
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

/** 标记封面图片控件；同页面还有视频控件时按 accept 排除 */
async function markCoverInput(call) {
  return evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      document.querySelectorAll('input[data-wb-cover-input="1"]').forEach((el) => el.removeAttribute('data-wb-cover-input'));
      const isImageInput = (el) => {
        const accept = el.getAttribute('accept') || '';
        if (/video/i.test(accept)) return false;
        return /image|jpe?g|png|webp/i.test(accept) || !accept;
      };
      const list = Array.from(document.querySelectorAll('input[type=file]')).filter(isImageInput);
      if (!list.length) return '';
      // 优先封面区域或弹层内的控件，多个时取最后一个（通常是最新打开的封面弹层）
      const scoped = list.filter((el) =>
        !!el.closest('[class*="cover"], [class*="Cover"], [class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"]')
      );
      const pick = scoped[scoped.length - 1] || list[list.length - 1];
      pick.setAttribute('data-wb-cover-input', '1');
      try { pick.value = ''; } catch (err) { /* 部分控件不允许重置 */ }
      return pick.accept || '未限制';
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

async function injectCoverFile(call, cover) {
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

async function uploadCoverFile(call, ctx, cover) {
  const nodeId = await markedCoverNodeId(call);
  if (!nodeId) return false;
  try {
    await call('DOM.setFileInputFiles', { nodeId, files: [cover.path] });
  } catch (err) {
    ctx.log('B站封面：写入上传控件失败：' + err.message, 'warn');
  }
  if (await coverFilesReady(call)) return true;
  // 部分版本 input 被隐藏时 setFileInputFiles 不生效，退回页面侧注入文件
  return injectCoverFile(call, cover);
}

async function clickCoverEntry(call, ctx) {
  for (const text of COVER_ENTRY) {
    const hit = await clickMatch(call, text, true);
    if (hit) {
      ctx.log('B站封面：已点击「' + hit + '」');
      return hit;
    }
  }
  return '';
}

/** 上传封面：点「添加封面」→ 写入封面图 → 确认弹层 */
async function applyCover(call, ctx) {
  const covers = Array.isArray(ctx.covers) ? ctx.covers.filter((item) => item && item.path) : [];
  if (!covers.length) {
    ctx.log('排期未设置自定义封面，B站沿用页面默认封面', 'info');
    return false;
  }
  const cover = pickCover(covers);
  // 封面入口必须先点开：B站的上传控件只在封面弹层里渲染，直接写隐藏 input 不会被页面接收
  const entry = await clickCoverEntry(call, ctx);
  if (entry) await sleep(900);
  let accept = await markCoverInput(call);
  if (!accept && entry) {
    // 有的版本先打开封面弹层，弹层里还要再点一次「上传封面」；只在弹层内点，避免再次命中「添加封面」
    const again = await clickDialogButton(call, ['上传封面', '选择封面', '点击上传']);
    if (again) {
      ctx.log('B站封面：已点击弹层内「' + again + '」');
      await sleep(700);
      accept = await markCoverInput(call);
    }
  }
  if (!accept) {
    const diag = await evalJs(
      call,
      `(() => ({
        dialogs: document.querySelectorAll('[class*="dialog"], [class*="Dialog"], [class*="modal"], [class*="Modal"]').length,
        fileInputs: document.querySelectorAll('input[type=file]').length,
        imageInputs: document.querySelectorAll('input[type=file][accept*="image"]').length
      }))()`
    ).catch(() => null);
    ctx.log('B站封面：没有找到图片上传控件 · 诊断 ' + JSON.stringify(diag), 'warn');
    return false;
  }

  const ok = await uploadCoverFile(call, ctx, cover);
  if (!ok) {
    ctx.log('B站封面：封面文件没有写入上传控件', 'warn');
    return false;
  }
  ctx.log('B站封面：已上传 ' + cover.name + '（' + ratioLabel(cover.ratio) + '）');
  await sleep(1800);
  const confirmed = await clickDialogButton(call, COVER_CONFIRM);
  if (confirmed) {
    ctx.log('B站封面：已点击「' + confirmed + '」');
    await sleep(500);
  }
  return true;
}

const DECLARATION_BOX = '.creation-statement-container';

/**
 * 创作声明当前值：新版控件把选中项写进只读 input（默认已是「内容无需标注」），
 * 旧版只能从 .bcc-option.selected 取文案。
 */
const DECLARATION_STATE = `(() => {
  const box = document.querySelector('${DECLARATION_BOX}');
  if (!box) return { state: 'missing' };
  const input = box.querySelector('.bcc-select-input-wrap input');
  const selected = box.querySelector('.bcc-option.selected');
  const value = String((input && input.value) || (selected && selected.innerText) || '').replace(/\\s+/g, '');
  if (/无需标注/.test(value)) return { state: 'selected', text: value };
  return { state: 'unset', text: value };
})()`;

async function openDeclarationMenu(call) {
  return evalJs(
    call,
    `(() => {
      const box = document.querySelector('${DECLARATION_BOX}');
      if (!box) return false;
      const wrap = box.querySelector('.bcc-select-list-wrap');
      if (wrap && getComputedStyle(wrap).display !== 'none') return true;
      const trigger = box.querySelector('.bcc-select-input-wrap') || box.querySelector('.bcc-select');
      if (!trigger) return false;
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trigger.click();
      return true;
    })()`
  ).catch(() => false);
}

/** 只在声明下拉自己的选项里选，避免误点页面其它含「AI/虚构」字样的内容 */
async function pickDeclarationOption(call) {
  return evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const box = document.querySelector('${DECLARATION_BOX}');
      if (!box) return '';
      const options = Array.from(box.querySelectorAll('.bcc-option')).filter(visible);
      if (!options.length) return '';
      const target = options.find((el) => /无需标注/.test(el.innerText || '')) || options[0];
      const text = (target.innerText || '').trim();
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.click();
      return text;
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

async function pressEscape(call) {
  for (const type of ['keyDown', 'keyUp']) {
    await call('Input.dispatchKeyEvent', {
      type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27
    }).catch(() => {});
  }
}

async function setCreationDeclaration(call, ctx) {
  let state = await evalJs(call, DECLARATION_STATE).catch(() => null);
  if (state && state.state === 'missing') {
    // 旧版界面把声明收在「更多设置」里
    const expanded = await clickMatch(call, '更多设置|展开更多|更多选项', false);
    if (expanded) {
      ctx.log('B站创作声明：已展开「' + expanded + '」');
      await sleep(700);
      state = await evalJs(call, DECLARATION_STATE).catch(() => null);
    }
  }

  if (!state || state.state === 'missing') {
    ctx.log('B站创作声明：未找到设置项，跳过', 'warn');
    return false;
  }
  if (state.state === 'selected') {
    ctx.log('B站创作声明已是「' + state.text + '」');
    return true;
  }

  if (!(await openDeclarationMenu(call))) {
    ctx.log('B站创作声明：未找到选择控件，请手动选择「无需标注」', 'warn');
    return false;
  }

  let picked = '';
  for (let i = 0; i < 4 && !picked; i++) {
    await sleep(i ? 500 : 600);
    picked = await pickDeclarationOption(call);
  }
  if (!picked) {
    await pressEscape(call);
    ctx.log('B站创作声明：未找到「无需标注」选项，请手动选择', 'warn');
    return false;
  }

  await sleep(400);
  const after = await evalJs(call, DECLARATION_STATE).catch(() => null);
  const shown = (after && after.text) || '';
  if (!/无需标注/.test(shown)) {
    ctx.log('B站创作声明：已点击「' + picked + '」，但页面未显示为已选中，请手动确认', 'warn');
    return false;
  }
  ctx.log('B站创作声明已选择「' + picked + '」');
  return true;
}

/** 新版投稿页的分区是 .select-controller 弹出的一级列表（human-type-list） */
async function openPartitionList(call) {
  return evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      if (Array.from(document.querySelectorAll('.drop-list-v2-container')).some(visible)) return true;
      const trigger =
        document.querySelector('.video-human-type .select-controller') ||
        document.querySelector('.selector-container .select-controller');
      if (!trigger) return false;
      trigger.click();
      return true;
    })()`
  ).catch(() => false);
}

async function partitionListOpen(call) {
  return evalJs(
    call,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      return Array.from(document.querySelectorAll('.drop-list-v2-container')).some(visible);
    })()`
  ).catch(() => false);
}

async function partitionCurrentText(call) {
  return evalJs(
    call,
    `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const trigger =
        document.querySelector('.video-human-type .select-controller') ||
        document.querySelector('.selector-container .select-controller');
      return trigger ? norm(trigger.innerText) : '';
    })()`
  ).catch(() => '');
}

async function clickPartitionItem(call, label) {
  return evalJs(
    call,
    `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const want = norm(${JSON.stringify(label)});
      const items = Array.from(document.querySelectorAll('.drop-list-v2-item')).filter(visible);
      let target =
        items.find((el) => {
          const main = el.querySelector('.item-cont-main');
          return norm(main ? main.innerText : el.innerText) === want;
        }) || null;
      if (!target) {
        // 旧版界面的分区项是普通可点文本
        const scopes = Array.from(
          document.querySelectorAll('[class*="drop-list"], [class*="select-list"], [class*="popup"], [class*="popper"], [role="listbox"]')
        ).filter(visible);
        for (const scope of scopes) {
          const hit = Array.from(scope.querySelectorAll('div, span, li, p, a'))
            .filter((el) => visible(el) && norm(el.innerText) === want)
            .sort(
              (a, b) =>
                a.getBoundingClientRect().width * a.getBoundingClientRect().height -
                b.getBoundingClientRect().width * b.getBoundingClientRect().height
            )[0];
          if (hit) {
            target = hit;
            break;
          }
        }
      }
      if (!target) return '';
      target.click();
      return norm(target.innerText);
    })()`
  )
    .catch(() => '')
    .then((value) => value || '');
}

async function selectPartition(call, ctx) {
  const raw = channelConnections.getRaw('B站');
  const configured = String((raw && raw.fields && raw.fields['默认分区']) || '').trim();
  const keyword = configured || '知识';
  const parts = keyword.split('/').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return;

  if (!(await openPartitionList(call))) {
    ctx.log('未找到分区选择入口，可能账号已记住上次分区（期望：' + keyword + '）');
    return;
  }
  await sleep(700);

  for (const part of parts) {
    const hit = await clickPartitionItem(call, part);
    if (!hit) break;
    await sleep(700);
    // 新版投稿页分区只有一级，选完列表就收起；旧版会继续出现二级列表
    if (!(await partitionListOpen(call))) break;
  }

  const shown = await partitionCurrentText(call);
  const want = parts[parts.length - 1];
  if (shown && shown.indexOf(want) >= 0) {
    ctx.log('已选择分区：' + keyword);
    return;
  }
  if (shown && shown.indexOf(parts[0]) >= 0) {
    ctx.log('已选择分区：' + shown + '（该版本投稿页只提供一级分区）');
    return;
  }
  ctx.log(
    '分区未能自动选中（期望：' + keyword + (shown ? '，当前：' + shown : '') + '）。请在「连接设置 → B站 → 默认分区」填写页面上显示的分区名，如「知识」',
    'warn'
  );
}

// 判断页面是否已经离开初始上传区；上传中/编辑态都算已接收文件
const UPLOAD_PROBE = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, '');
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const leafHas = (re) =>
    Array.from(document.querySelectorAll('div, span, p, button')).some(
      (el) => visible(el) && el.childElementCount <= 1 && re.test(norm(el.innerText))
    );
  const titleReady = Array.from(document.querySelectorAll('input, textarea')).some((el) => {
    if (!visible(el)) return false;
    const hint = (el.getAttribute('placeholder') || '') + (el.getAttribute('data-placeholder') || '');
    return /标题/.test(hint);
  });
  return {
    idle: leafHas(/点击上传|拖拽到此区域/),
    started: titleReady || leafHas(/上传中|上传完成|重新上传|更换视频|取消上传|转码|正在处理/)
  };
})()`;

async function waitUploadStarted(call, timeoutMs) {
  const started = Date.now();
  let quiet = 0;
  while (Date.now() - started < timeoutMs) {
    const state = await evalJs(call, UPLOAD_PROBE).catch(() => null);
    if (state && state.started) return true;
    if (state && state.idle) {
      quiet = 0;
    } else if (state) {
      // 连续两次不在初始上传区，才认为已开始，避免渲染空档误判
      quiet++;
      if (quiet >= 2) return true;
    }
    await sleep(400);
  }
  return false;
}

/**
 * 投稿页是 SPA，文件控件可能在首次渲染后被 Vue 重建；写入过早的文件会随旧控件一起丢失，
 * 页面就一直停在「点击上传」状态。写入后确认已进入上传/编辑态，否则重新定位控件再写一次。
 */
async function ensureVideoAttached(call, ctx) {
  const file = ctx.videoPath;
  if (!file) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) {
      const candidates = await fileInputCandidates(call);
      const target =
        candidates.find((item) => /video|mp4|mov|flv|mkv|webm/i.test(item.accept || '')) || candidates[0];
      if (!target) break;
      ctx.log('B站投稿页没有进入上传状态，重新写入视频文件（第 ' + attempt + ' 次重试）', 'warn');
      // 同一个控件再写同一个文件不会触发 change，先清空再写入
      await evalJs(
        call,
        `(() => { document.querySelectorAll('input[type=file]').forEach((el) => { try { el.value = ''; } catch (err) {} }); return true; })()`
      ).catch(() => false);
      await call('DOM.setFileInputFiles', { nodeId: target.nodeId, files: [file] });
      await sleep(1200);
    }
    if (await waitUploadStarted(call, attempt ? 12000 : 6000)) return true;
  }
  const state = await evalJs(call, UPLOAD_PROBE).catch(() => null);
  if (state && state.idle && !state.started) {
    throw new Error('B站视频文件没有被投稿页接收（页面仍停在上传区），已自动重试 3 次，请手动选择视频后再执行');
  }
  return false;
}

function normalizeTitle(text) {
  return String(text || '')
    .replace(/#[^\s#]+/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

/** 优先用浏览器里的 Cookie 核验，回退到连接设置里保存的 Cookie */
async function verifyCookieHeader(call) {
  try {
    const res = await call('Network.getCookies', {
      urls: ['https://member.bilibili.com', 'https://www.bilibili.com']
    });
    const header = ((res && res.cookies) || []).map((c) => c.name + '=' + c.value).join('; ');
    if (header) return header;
  } catch (err) {
    /* CDP 取不到时回退到连接设置 */
  }
  const raw = channelConnections.getRaw('B站');
  const fields = (raw && raw.enabled && raw.fields) || {};
  return [
    fields.SESSDATA ? 'SESSDATA=' + fields.SESSDATA : '',
    fields.bili_jct ? 'bili_jct=' + fields.bili_jct : '',
    fields.UID ? 'DedeUserID=' + fields.UID : ''
  ].filter(Boolean).join('; ');
}

async function fetchArchives(cookie) {
  let resp;
  try {
    resp = await fetch(VERIFY_API, {
      headers: {
        Cookie: cookie,
        'User-Agent': VERIFY_UA,
        Referer: 'https://member.bilibili.com/platform/upload-manager/article',
        Accept: 'application/json, text/plain, */*'
      },
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    throw new Error('无法连接B站稿件接口：' + err.message);
  }
  if (!resp.ok) throw new Error('B站稿件接口返回 HTTP ' + resp.status);
  const json = await resp.json().catch(() => null);
  if (!json) throw new Error('B站稿件接口返回的不是合法 JSON');
  if (json.code === -101) {
    const err = new Error('B站登录态已失效，无法核验稿件列表');
    err.status = 401;
    throw err;
  }
  if (json.code !== 0) throw new Error('B站稿件接口错误 ' + json.code + '：' + (json.message || '未知原因'));
  const data = json.data;
  if (Array.isArray(data)) return data;
  return data && Array.isArray(data.arc_audits) ? data.arc_audits : [];
}

/** 在稿件列表里按标题匹配刚提交的稿件，拿到 BV 号 */
async function verifyNewArchive(call, ctx, title) {
  const wanted = normalizeTitle(title);
  if (!wanted) {
    ctx.log('任务没有标题，跳过B站稿件列表核验', 'warn');
    return null;
  }
  const cookie = await verifyCookieHeader(call);
  if (!cookie) {
    ctx.log('没有可用的B站 Cookie，跳过稿件列表核验', 'warn');
    return null;
  }

  ctx.log('正在核验B站稿件列表…');
  const started = Date.now();
  while (Date.now() - started < VERIFY_MS) {
    try {
      const rows = await fetchArchives(cookie);
      const now = Math.floor(Date.now() / 1000);
      const hits = [];
      rows.forEach((item) => {
        const arc = item && (item.Archive || item.archive || item);
        if (!arc || !arc.bvid) return;
        const got = normalizeTitle(arc.title);
        if (!got) return;
        const sameTitle =
          got === wanted || (wanted.length >= 6 && (got.indexOf(wanted) >= 0 || wanted.indexOf(got) >= 0));
        if (!sameTitle) return;
        // ctime 为 0 时无法判断新旧，只能信任标题匹配
        const ctime = Number(arc.ctime) || 0;
        if (ctime && now - ctime > 30 * 60) return;
        hits.push(arc);
      });
      if (hits.length) {
        hits.sort((a, b) => (Number(b.ctime) || 0) - (Number(a.ctime) || 0));
        const arc = hits[0];
        ctx.log('稿件列表已匹配到新稿件：' + arc.bvid + (arc.state_desc ? '（' + arc.state_desc + '）' : ''));
        return {
          workId: arc.bvid,
          publishUrl: 'https://www.bilibili.com/video/' + arc.bvid
        };
      }
    } catch (err) {
      ctx.log('稿件列表核验失败：' + err.message, 'warn');
      if (err.status === 401) return null;
    }
    await sleep(VERIFY_INTERVAL_MS);
  }
  return null;
}

function compose(task) {
  return {
    title: String(task.title || '').trim().slice(0, 80),
    description: String(task.description || '').trim().slice(0, 2000)
  };
}

const cfg = {
  platform: 'B站',
  uploadUrl: 'https://member.bilibili.com/platform/upload/video/frame',
  cookieDomain: '.bilibili.com',
  cookieMode: 'bilibili',
  loginUrlRe: /passport\.bilibili\.com|\/login/i,
  loginTextRe: /扫码登录|登录后投稿|请先登录/,
  titleHintRe: '标题',
  descHintRe: '简介|描述',
  tagHintRe: '标签|tag',
  useTagInput: true,
  titleMax: 80,
  publishButtons: ['立即投稿'],
  // 投稿按钮实际是 <span class="submit-add">立即投稿</span>，不是 <button>
  publishSelector: 'button, [role="button"], a, .submit-add',
  uploadRouteRe: /upload\/video/,
  successRe: /投稿成功|投递成功|投稿完成|审核中/,
  compose,
  onAttached: async (call, ctx) => {
    await ensureVideoAttached(call, ctx);
  },
  prePublish: async (call, ctx) => {
    await closeNotices(call, ctx);
    // 上传入口可能自身触发系统文件框，拦掉以免挡住后续操作
    await call('Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => {});
    try {
      await applyCover(call, ctx);
    } catch (err) {
      ctx.log('B站封面设置失败，继续投稿：' + err.message, 'warn');
    } finally {
      await call('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    }
    await closeNotices(call, ctx);
    try {
      await setCreationDeclaration(call, ctx);
    } catch (err) {
      ctx.log('B站创作声明设置失败，继续投稿：' + err.message, 'warn');
    }
    await selectPartition(call, ctx);
  },
  afterPublish: async (call, ctx) => {
    const verified = await verifyNewArchive(call, ctx, ctx.task && ctx.task.title);
    if (!verified) {
      ctx.log('未在稿件列表核验到新稿件，保留「待核验」状态，请人工确认', 'warn');
      return null;
    }
    return {
      status: 'published',
      workId: verified.workId,
      publishUrl: verified.publishUrl,
      message: '已发布并核验稿件链接'
    };
  }
};

async function run(ctx) {
  return runWithConfig(ctx, cfg);
}

module.exports = { key: 'B站', supported: true, kinds: ['video'], run };
