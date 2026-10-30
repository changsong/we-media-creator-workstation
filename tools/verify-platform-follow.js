'use strict';

/**
 * 聚焦验证：选题与平台解绑后，「录入选题」弹窗不再出现平台控件，保存也不携带平台字段。
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

  try { win.localStorage.removeItem('wb_workbench_draft_topic_new'); } catch (e) {}

  const newBtn = doc.querySelector('[data-act="new"][data-db="topic"]');
  check('存在「录入选题」按钮', !!newBtn);
  click(win, newBtn);
  const opened = await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  check('点击录入选题抽屉打开', !!opened);
  check('选题表单不再包含平台字段', !doc.querySelector('#drawerBody [data-field="平台"]'));
  check('选题表单仍保留选题名称', !!doc.querySelector('#drawerBody [data-field="选题"]'));
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // 选题池表格不再展示平台列
  const topicTab = doc.querySelector('.nav-link[data-tab="topics"]');
  if (topicTab) {
    click(win, topicTab);
    await sleep(120);

    // 选题池页的「录入新选题」应打开居中弹窗
    const topicNewBtn = doc.querySelector('#view [data-act="topicNew"]');
    check('选题池存在「录入新选题」按钮', !!topicNewBtn);
    if (topicNewBtn) {
      click(win, topicNewBtn);
      const popped = await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 4000);
      check('选题池点「录入新选题」弹出居中弹窗', !!popped && doc.getElementById('drawer').classList.contains('center-popup'));
      check('弹窗内仍无平台字段', !doc.querySelector('#drawerBody [data-field="平台"]'));
      click(win, doc.getElementById('drawerCancel'));
      await sleep(60);
    }

    const headText = Array.from(doc.querySelectorAll('#view table thead th')).map((th) => th.textContent.trim()).join('|');
    check('选题池表头不含「目标平台」', headText.indexOf('目标平台') < 0, headText);
  }

  win.close();
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} 项通过${failed ? `，${failed} 项失败` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('验证脚本异常：', err);
  process.exit(1);
});
