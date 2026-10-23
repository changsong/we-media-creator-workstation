'use strict';

/**
 * B 站发布适配器。
 *
 * 投稿页：https://member.bilibili.com/platform/upload/video/frame
 * 标题与简介分开填写，标签走独立输入框；分区是必选项，
 * 这里按「连接设置 → B站 → 默认分区」的关键词做一次尽力选择（支持「知识/科学科普」这种两级写法）。
 * 封面按任务封面变体自动上传（优先 16:9）；创作声明是必填项，默认选「无需标注」。
 * 投稿成功后从创作中心稿件列表按标题核验，拿到 BV 号即回填链接并标记为已发布。
 */

const fs = require('fs');
const { runWithConfig, clickMatch, sleep, evalJs } = require('./browser-publish');
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

/**
 * 创作声明：新版投稿页是必填项，标题文案为「创作声明（必填）」，控件是 .bcc-select 下拉。
 * 优先选「无需标注」（旧版叫「内容无需标注」），找不到时兜底选下拉里的第一个声明选项。
 */
function declarationProbeExpr() {
  return `(() => {
    const norm = (s) => (s || '').replace(/\\s+/g, '');
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const area = (el) => {
      const r = el.getBoundingClientRect();
      return r.width * r.height;
    };
    let container = Array.from(document.querySelectorAll('.creation-statement-container')).filter(visible)[0] || null;
    if (!container) {
      const labels = Array.from(document.querySelectorAll('div, span, label, p, dt'))
        .filter((el) => visible(el) && /创作声明/.test(norm(el.innerText)) && norm(el.innerText).length <= 20)
        .sort((a, b) => area(a) - area(b));
      if (!labels.length) return { state: 'missing' };
      let node = labels[0];
      for (let i = 0; i < 5 && node && !container; i++, node = node.parentElement) {
        // 只认声明行附近的小容器，避免误抓到分区等其他下拉
        if (node.querySelector('.bcc-select, [role="combobox"], select') && norm(node.innerText).length <= 200) {
          container = node;
        }
      }
      if (!container) container = labels[0].parentElement;
    }
    if (!container) return { state: 'missing' };

    const trigger =
      container.querySelector('.bcc-select-input-wrap') ||
      container.querySelector('.bcc-select') ||
      container.querySelector('[role="combobox"]') ||
      container.querySelector('select');
    if (!trigger) {
      const inline = Array.from(container.querySelectorAll('div, span, label, li'))
        .filter((el) => visible(el) && /无需标注/.test(norm(el.innerText)) && norm(el.innerText).length <= 30)
        .filter((el) => !Array.from(el.children).some((ch) => /无需标注/.test(norm(ch.innerText))))
        .sort((a, b) => area(a) - area(b))[0];
      if (!inline) return { state: 'no-control' };
      inline.click();
      return { state: 'clicked', text: (inline.innerText || '').trim() };
    }
    const shown = trigger.tagName === 'SELECT'
      ? (trigger.options[trigger.selectedIndex] || {}).text || ''
      : (trigger.innerText || '').trim();
    if (/无需标注/.test(norm(shown))) return { state: 'selected', text: shown };
    trigger.setAttribute('data-wb-declaration-trigger', '1');
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
    return { state: 'opened', text: shown };
  })()`;
}

async function pickDeclarationOption(call) {
  return evalJs(
    call,
    `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const area = (el) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
      };
      const leaf = (el) => !Array.from(el.children).some((ch) => norm(ch.innerText) === norm(el.innerText));
      const inPopup = (el) =>
        !!el.closest('[role="listbox"], [role="menu"], [role="option"], [class*="bcc-select"], [class*="popup"], [class*="Popover"], [class*="popper"], [class*="dropdown"]');
      const pointerish = (el) => {
        let node = el;
        for (let i = 0; i < 3 && node; i++, node = node.parentElement) {
          if (getComputedStyle(node).cursor === 'pointer') return true;
        }
        return false;
      };
      const all = Array.from(document.querySelectorAll('div, span, li, label, p, [role="option"]'))
        .filter((el) => visible(el) && leaf(el))
        .filter((el) => {
          const t = norm(el.innerText);
          return t && t.length <= 30;
        });
      const scoped = all.filter(inPopup);
      let pool = scoped.length ? scoped : all;
      // 排除区块里的说明文案，优先取真正可点的选项
      const clickable = pool.filter(pointerish);
      if (clickable.length) pool = clickable;
      const noMark = pool
        .filter((el) => /无需标注/.test(norm(el.innerText)))
        .sort((a, b) => area(a) - area(b));
      let target = noMark[0] || null;
      if (!target) {
        // 兜底按列表顺序取第一个声明选项
        target = pool
          .filter((el) => /虚构|AI|营销|转载|个人观点/.test(norm(el.innerText)))
          .sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return ra.top - rb.top || ra.left - rb.left;
          })[0] || null;
      }
      if (!target) return '';
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
  let state = await evalJs(call, declarationProbeExpr()).catch(() => null);
  if (state && state.state === 'missing') {
    // 旧版界面把声明收在「更多设置」里
    const expanded = await clickMatch(call, '更多设置|展开更多|更多选项', false);
    if (expanded) {
      ctx.log('B站创作声明：已展开「' + expanded + '」');
      await sleep(700);
      state = await evalJs(call, declarationProbeExpr()).catch(() => null);
    }
  }

  if (!state) {
    ctx.log('B站创作声明：检测失败，跳过', 'warn');
    return false;
  }
  if (state.state === 'missing') {
    ctx.log('B站创作声明：未找到设置项，跳过', 'warn');
    return false;
  }
  if (state.state === 'no-control') {
    ctx.log('B站创作声明：未找到选择控件，请手动选择「无需标注」', 'warn');
    return false;
  }
  if (state.state === 'selected') {
    ctx.log('B站创作声明已是「' + (state.text || '无需标注') + '」');
    return true;
  }

  let picked = '';
  if (state.state === 'opened') {
    ctx.log('B站创作声明：已展开选择器' + (state.text ? '（' + state.text + '）' : ''));
    await sleep(700);
  } else if (state.state === 'clicked') {
    picked = state.text || '无需标注';
  } else {
    await sleep(300);
  }

  for (let i = 0; i < 3 && !picked; i++) {
    await sleep(i ? 600 : 0);
    picked = await pickDeclarationOption(call);
  }
  if (!picked) {
    await pressEscape(call);
    ctx.log('B站创作声明：未找到「无需标注」选项，请手动选择', 'warn');
    return false;
  }

  await sleep(500);
  const shown = await evalJs(
    call,
    `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const box = Array.from(document.querySelectorAll('.creation-statement-container')).find((el) => el.getClientRects().length);
      const trigger =
        document.querySelector('[data-wb-declaration-trigger="1"]') ||
        (box && (box.querySelector('.bcc-select-input-wrap') || box.querySelector('.bcc-select')));
      const el = trigger || box;
      return el ? norm(el.innerText) : '';
    })()`
  ).catch(() => '');
  if (shown && !/无需标注/.test(shown)) {
    ctx.log('B站创作声明：已点击「' + picked + '」，但页面未显示为已选中，请手动确认', 'warn');
    return false;
  }
  ctx.log('B站创作声明已选择「' + picked + '」');
  return true;
}

async function selectPartition(call, ctx) {
  const raw = channelConnections.getRaw('B站');
  const configured = String((raw && raw.fields && raw.fields['默认分区']) || '').trim();
  const keyword = configured || '知识';
  const parts = keyword.split('/').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return;

  let opened = await clickMatch(call, '请选择分区|选择分区', false);
  if (!opened) opened = await clickMatch(call, '分区', false);
  if (!opened) {
    ctx.log('未找到分区选择入口，可能账号已记住上次分区（期望：' + keyword + '）');
    return;
  }
  await sleep(700);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let selected = '';
  for (const part of parts) {
    // 分区项文案可能带后缀（如「知识区」），用前缀匹配而不是全等
    const hit = await clickMatch(call, '^' + escapeRe(part) + '($|[\\s/·-])', false);
    if (hit) selected = hit;
    await sleep(650);
  }
  const confirmed = await clickMatch(call, '确定|完成|提交', false);
  if (confirmed) await sleep(500);

  const want = parts[parts.length - 1];
  const shown = await evalJs(
    call,
    `(() => {
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const area = (el) => {
        const r = el.getBoundingClientRect();
        return r.width * r.height;
      };
      const label = Array.from(document.querySelectorAll('div, span, label, dt, p'))
        .filter((el) => visible(el) && norm(el.innerText) === '分区')
        .sort((a, b) => area(a) - area(b))[0];
      if (!label) return '';
      let row = label.parentElement;
      for (let i = 0; i < 4 && row; i++, row = row.parentElement) {
        const text = norm(row.innerText);
        if (text.length > 8) return text.slice(0, 80);
      }
      return '';
    })()`
  ).catch(() => '');

  if (shown && shown.indexOf(want) >= 0) {
    ctx.log('已选择分区：' + keyword);
  } else if (selected && selected === want) {
    ctx.log('已选择分区：' + keyword);
  } else {
    ctx.log(
      '分区未能自动选中（期望：' + keyword + '）。B站分区需要选到二级，请在「连接设置 → B站 → 默认分区」填写「知识/科学科普」这种两级写法',
      'warn'
    );
  }
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
