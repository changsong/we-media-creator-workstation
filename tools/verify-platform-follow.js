'use strict';

/**
 * 聚焦验证：修复「录入选题」抽屉的平台默认值不跟随头部渠道的问题（Bug C）。
 *
 * 验证两条关键路径：
 *   1) 头部渠道选「抖音」后，点「录入选题」打开的抽屉，平台默认应为「抖音」；
 *   2) localStorage 中残留的「公众号」草稿，不应在头部已选「小红书」时覆盖它。
 *
 * 用法：NODE_PATH=<含 jsdom 的 node_modules> node tools/verify-platform-follow.js
 */

const { JSDOM } = require('jsdom');

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5180';
const results = [];
let failed = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitFor(fn, timeout = 8000, interval = 80) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let v; try { v = fn(); } catch (e) { v = false; }
    if (v) return v;
    await sleep(interval);
  }
  return null;
}
function key(el, type) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
function click(win, el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

(async () => {
  const dom = await JSDOM.fromURL(BASE + '/', {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? new URL(input, BASE) : input;
        return fetch(url, init);
      };
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
    }
  });

  const win = dom.window;
  const doc = win.document;

  await new Promise((resolve) => {
    if (doc.readyState === 'complete') resolve();
    else win.addEventListener('load', resolve);
  });

  const synced = await waitFor(() => /已同步/.test(doc.getElementById('syncText').textContent), 8000);
  check('页面连上本地服务并完成首次加载', !!synced, doc.getElementById('syncText').textContent);

  const pfH = doc.getElementById('pfFilter');
  check('头部渠道选择器存在(pfFilter)', !!pfH);

  // 基线清理：移除以前可能残留的草稿，避免干扰
  try { win.localStorage.removeItem('wb_workbench_draft_topic_new'); } catch (e) {}

  // ---------- 场景 1：头部选「抖音」→ 新建默认平台跟随 ----------
  pfH.value = '抖音';
  key(pfH, 'change');
  await sleep(80);

  let newBtn = doc.querySelector('[data-act="new"][data-db="topic"]');
  check('首页存在「录入选题」按钮', !!newBtn);
  click(win, newBtn);
  const opened1 = await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  check('点击录入选题抽屉打开', !!opened1);
  let pf1 = doc.querySelector('[data-field="平台"]');
  check('头部选「抖音」→ 新建默认平台=抖音', pf1 && pf1.value === '抖音', pf1 ? pf1.value : '缺字段');
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // ---------- 场景 2：残留「公众号」草稿不覆盖头部「小红书」 ----------
  // 先打开抽屉，写一个「公众号」平台 + 标题，触发 saveDraft 防抖落盘
  newBtn = doc.querySelector('[data-act="new"][data-db="topic"]');
  click(win, newBtn);
  await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  let pfSeed = doc.querySelector('[data-field="平台"]');
  pfSeed.value = '公众号';
  key(pfSeed, 'change');
  let tSeed = doc.querySelector('[data-field="选题"]');
  if (tSeed) { tSeed.value = '草稿占位'; key(tSeed, 'input'); }
  await sleep(450); // 等 saveDraft 的 300ms 防抖写盘
  const draftSaved = (function () {
    try { return !!win.localStorage.getItem('wb_workbench_draft_topic_new'); } catch (e) { return false; }
  })();
  check('草稿已写入 localStorage', draftSaved);
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // 头部切到「小红书」再新建
  pfH.value = '小红书';
  key(pfH, 'change');
  await sleep(80);
  newBtn = doc.querySelector('[data-act="new"][data-db="topic"]');
  click(win, newBtn);
  const opened2 = await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  let pf2 = doc.querySelector('[data-field="平台"]');
  check('残留「公众号」草稿不覆盖头部「小红书」', pf2 && pf2.value === '小红书', pf2 ? pf2.value : '缺字段');
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // ---------- 场景 3：头部选「全部」时，新建默认回落到「公众号」 ----------
  pfH.value = 'all';
  key(pfH, 'change');
  await sleep(80);
  newBtn = doc.querySelector('[data-act="new"][data-db="topic"]');
  click(win, newBtn);
  await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  let pf3 = doc.querySelector('[data-field="平台"]');
  check('头部选「全部」→ 新建默认回落「公众号」', pf3 && (pf3.value === '' || pf3.value === '公众号'), pf3 ? pf3.value : '缺字段');
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // 清理：恢复基线
  try { win.localStorage.removeItem('wb_workbench_draft_topic_new'); } catch (e) {}
  pfH.value = 'all';
  key(pfH, 'change');

  win.close();
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} 项通过${failed ? `，${failed} 项失败` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('验证脚本异常：', err);
  process.exit(1);
});
