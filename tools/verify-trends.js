'use strict';

/**
 * 端到端验证「爆款灵感雷达」：用 mock 适配器起一个独立服务，
 * 走一遍 输入关键词 → 搜索 → 结果卡片 → 转选题 → 保存 → 缓存复用。
 *
 * 用法：NODE_PATH=<含 jsdom 的 node_modules> node tools/verify-trends.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TRENDS_TEST_PORT) || 5199;
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data', '.trends-test-' + Date.now());

const results = [];
let failed = 0;
let server = null;
let serverLog = '';

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000, interval = 120) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let v;
    try {
      v = await fn();
    } catch (err) {
      v = false;
    }
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

function click(win, el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}
function key(win, el, type) {
  el.dispatchEvent(new win.Event(type, { bubbles: true }));
}

async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  server = spawn(process.execPath, ['server.js', '--port', String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      WB_TRENDS_MOCK: '1',
      WB_DATA_DIR: DATA_DIR
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (b) => {
    serverLog += b.toString();
  });
  server.stderr.on('data', (b) => {
    serverLog += b.toString();
  });
  const ok = await waitFor(() => fetch(BASE + '/api/trends/platforms').then((r) => r.ok).catch(() => false), 15000, 250);
  if (!ok) throw new Error('测试服务启动失败：\n' + serverLog);
}

function stopServer() {
  if (!server) return;
  try {
    server.kill();
  } catch (err) {
    /* 已退出 */
  }
  server = null;
}

(async () => {
  await startServer();

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
  const synced = await waitFor(() => /已同步/.test(doc.getElementById('syncText').textContent), 10000);
  check('页面连上本地服务并完成首次加载', !!synced, doc.getElementById('syncText').textContent);

  click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
  await sleep(150);

  check('选题池右侧渲染「爆款灵感雷达」', /爆款灵感雷达/.test(doc.getElementById('view').textContent));
  check('旧版快速录入表单已移除', !doc.getElementById('inlineName') && !doc.getElementById('inlineTopic'));
  check('面板含关键词输入框', !!doc.getElementById('trendKeywords'));
  const pboxes = doc.querySelectorAll('[data-trend-platform]');
  check('面板含 3 个平台勾选（小红书/抖音/B站）', pboxes.length === 3, pboxes.length + ' 个');
  const platformLoaded = await waitFor(() => /演示/.test(doc.getElementById('view').textContent), 8000);
  check('平台登录状态加载完成（mock 显示演示）', !!platformLoaded);

  const kw = doc.getElementById('trendKeywords');
  kw.value = '冒烟爆款';
  key(win, kw, 'input');
  click(win, doc.querySelector('[data-act="trendSearch"]:not([data-force])'));

  const cards = await waitFor(() => {
    const list = doc.querySelectorAll('[data-act="trendToTopic"]');
    return list.length >= 3 ? list : null;
  }, 20000);
  check('搜索后返回结果卡片', !!cards, cards ? cards.length + ' 张卡片' : '无结果');
  const resultsText = doc.getElementById('trendResults').textContent;
  check('结果卡片带平台标识', /小红书/.test(resultsText) && /B站/.test(resultsText));
  check('结果卡片带热度分', /热度\s*\d+/.test(resultsText));
  const heats = (resultsText.match(/热度\s*\d+/g) || []).map((m) => Number(m.replace(/[^\d]/g, '')));
  check(
    '结果按热度整体降序排列',
    heats.length >= 3 && heats.every((v, i) => i === 0 || heats[i - 1] >= v),
    heats.slice(0, 6).join(',')
  );

  const firstCard = doc.querySelector('[data-act="trendToTopic"]');
  click(win, firstCard);
  const opened = await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  check('点「转选题」打开选题弹窗', !!opened);
  check('弹窗为居中选题样式', doc.getElementById('drawer').classList.contains('center-popup') && doc.getElementById('drawer').classList.contains('topic-popup'));
  const titleEl = doc.querySelector('[data-field="选题"]');
  const angleEl = doc.querySelector('[data-field="切入角度"]');
  const refEl = doc.querySelector('[data-field="参考链接"]');
  const scoreEl = doc.querySelector('[data-field="爆款潜力评分"]');
  const tagChecked = doc.querySelectorAll('[data-field="标签"]:checked').length;
  check('转选题已预填标题', !!titleEl && titleEl.value.length > 0, titleEl ? titleEl.value.slice(0, 30) : '');
  check('转选题已预填切入角度', !!angleEl && angleEl.value.length > 0);
  check('转选题已预填参考链接', !!refEl && /^https?:\/\//.test(refEl.value), refEl ? refEl.value : '');
  check('转选题已预填评分与标签', !!scoreEl && Number(scoreEl.value) >= 0 && tagChecked >= 1, 'score=' + (scoreEl && scoreEl.value) + ', tags=' + tagChecked);
  check('选题弹窗仍不包含平台字段', !doc.querySelector('#drawerBody [data-field="平台"]'));

  const savedTitle = titleEl ? titleEl.value : '';
  click(win, doc.getElementById('drawerSave'));
  const closed = await waitFor(() => !doc.getElementById('drawer').classList.contains('on'), 10000);
  check('转选题保存成功', !!closed && /已保存/.test(doc.getElementById('toasts').textContent), doc.getElementById('toasts').textContent.slice(0, 40));

  click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
  await sleep(300);
  const rowHit = savedTitle && doc.getElementById('view').textContent.indexOf(savedTitle.slice(0, 20)) >= 0;
  check('选题池出现转换后的新选题', !!rowHit);

  // 第二次相同关键词：应命中 1 小时缓存
  const kw2 = doc.getElementById('trendKeywords');
  kw2.value = '冒烟爆款';
  key(win, kw2, 'input');
  click(win, doc.querySelector('[data-act="trendSearch"]:not([data-force])'));
  const cachedBadge = await waitFor(() => /含缓存结果/.test(doc.getElementById('trendResults').textContent), 20000);
  check('重复搜索命中缓存', !!cachedBadge);
  const job = await (await fetch(BASE + '/api/trends/status')).json();
  check('缓存任务全部标记 cached', job.tasks.length > 0 && job.tasks.every((t) => t.cached), job.tasks.map((t) => t.platform + ':' + t.cached).join(','));

  const bad = await fetch(BASE + '/api/trends/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: [] })
  });
  check('空关键词返回 400', bad.status === 400, 'HTTP ' + bad.status);

  // 模拟刷新页面：新开一个页面实例，应恢复上次关键词与结果
  const dom2 = await JSDOM.fromURL(BASE + '/#topics', {
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
  const win2 = dom2.window;
  const doc2 = win2.document;
  await new Promise((resolve) => {
    if (doc2.readyState === 'complete') resolve();
    else win2.addEventListener('load', resolve);
  });
  await waitFor(() => /已同步/.test(doc2.getElementById('syncText').textContent), 10000);

  const restoredKw = await waitFor(() => {
    const el = doc2.getElementById('trendKeywords');
    return el && el.value === '冒烟爆款' ? el.value : null;
  }, 10000);
  check('刷新后自动回填上次关键词', restoredKw === '冒烟爆款', 'value=' + (restoredKw || ''));

  const restoredCards = await waitFor(() => {
    const list = doc2.querySelectorAll('[data-act="trendToTopic"]');
    return list.length >= 3 ? list : null;
  }, 10000);
  check('刷新后展示上次搜索结果', !!restoredCards, restoredCards ? restoredCards.length + ' 张卡片' : '无结果');
  const restoredText = doc2.getElementById('trendResults').textContent;
  check('上次结果标注来源', /上次搜索|上次结果/.test(restoredText));

  const latest = await (await fetch(BASE + '/api/trends/latest')).json();
  check(
    '/api/trends/latest 返回上次任务',
    !!(latest.job && latest.job.restored && latest.job.keywords.indexOf('冒烟爆款') >= 0),
    latest.job ? latest.job.keywords.join(',') : 'null'
  );
  win2.close();

  win.close();
  stopServer();
  await sleep(600);
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  } catch (err) {
    console.warn('临时测试数据清理失败：', err.message);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} 项通过${failed ? `，${failed} 项失败` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('验证脚本异常：', err);
  if (serverLog) console.error(serverLog.slice(-2000));
  stopServer();
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch (e) {
    /* 忽略清理失败 */
  }
  process.exit(1);
});
