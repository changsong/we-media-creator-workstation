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

  // 住宅代理：默认关闭；配置接口需掩码、KEEP 与配置不完整时拒绝启用
  const platRes = await (await fetch(BASE + '/api/trends/platforms')).json();
  check(
    '平台状态附带代理信息',
    !!(platRes.platforms[0] && platRes.platforms[0].proxy),
    JSON.stringify(platRes.platforms[0] && platRes.platforms[0].proxy)
  );
  check('雷达面板显示直连 chip', /直连/.test(doc.getElementById('view').textContent));

  const proxy0 = await (await fetch(BASE + '/api/proxy')).json();
  check('初始代理未启用且未配置', proxy0.enabled === false && proxy0.configured === false);
  check('初始代理密码不回显', proxy0.password.value === '' && proxy0.password.hasValue === false);

  const putProxy = (body) =>
    fetch(BASE + '/api/proxy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const incomplete = await putProxy({ enabled: true, host: '10.0.0.9', port: 8080, username: 'u' });
  check('启用但缺少密码时拒绝保存（400）', incomplete.status === 400, 'HTTP ' + incomplete.status);

  const putOk = await putProxy({
    enabled: true,
    host: '10.0.0.9',
    port: 8080,
    username: 'u',
    password: 'secret',
    sessionTemplate: 'u-s-{session}'
  });
  check('保存代理配置成功', putOk.ok, 'HTTP ' + putOk.status);

  const proxy1 = await (await fetch(BASE + '/api/proxy')).json();
  check('启用后 configured 为 true', proxy1.enabled === true && proxy1.configured === true);
  check(
    '读取时密码被掩码',
    proxy1.password.value === '••••••••' && proxy1.password.hasValue === true,
    JSON.stringify(proxy1.password)
  );
  check('会话模板标记为粘性', proxy1.sticky === true && !!proxy1.sessionId);

  await putProxy({ password: '__KEEP_EXISTING__', host: '10.0.0.10' });
  const rawProxy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'proxy.json'), 'utf8'));
  check('KEEP 保留原密码并更新主机', rawProxy.password === 'secret' && rawProxy.host === '10.0.0.10', rawProxy.host);

  const connRes = await (await fetch(BASE + '/api/connections')).json();
  check(
    '/api/connections 附带掩码后的代理配置',
    !!connRes.proxy && connRes.proxy.password.hasValue === true && connRes.proxy.password.value === '••••••••',
    JSON.stringify(connRes.proxy && connRes.proxy.password)
  );

  click(win, doc.querySelector('.nav-link[data-tab="connections"]'));
  await waitFor(() => /网络代理 · 住宅出口/.test(doc.getElementById('view').textContent), 8000);
  const connViewText = doc.getElementById('view').textContent;
  check('连接设置渲染代理卡片', /网络代理 · 住宅出口/.test(connViewText));
  check('代理卡片不泄漏密码明文', connViewText.indexOf('secret') < 0);

  const platformsTabBtn = doc.querySelector('[data-act="connTab"][data-tab="platforms"]');
  const proxyTabBtn = doc.querySelector('[data-act="connTab"][data-tab="proxy"]');
  const platformsPanel = doc.querySelector('[data-conn-panel="platforms"]');
  const proxyPanel = doc.querySelector('[data-conn-panel="proxy"]');
  check(
    '连接设置默认选中渠道 Cookie 设置 Tab',
    !!platformsTabBtn && platformsTabBtn.classList.contains('on') && !!proxyTabBtn && !proxyTabBtn.classList.contains('on')
  );
  check(
    '默认显示渠道卡片、隐藏网络代理面板',
    !!platformsPanel && !platformsPanel.classList.contains('hidden') &&
      !!proxyPanel && proxyPanel.classList.contains('hidden')
  );
  click(win, proxyTabBtn);
  check(
    '切到网络代理 Tab 后代理面板可见、渠道隐藏',
    !!proxyPanel && !proxyPanel.classList.contains('hidden') &&
      !!platformsPanel && platformsPanel.classList.contains('hidden') &&
      proxyTabBtn.classList.contains('on') && !platformsTabBtn.classList.contains('on')
  );
  click(win, platformsTabBtn);
  check(
    '切回渠道 Tab 后代理面板隐藏',
    !!proxyPanel && proxyPanel.classList.contains('hidden') &&
      !!platformsPanel && !platformsPanel.classList.contains('hidden')
  );
  click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
  await sleep(250);

  await putProxy({ enabled: false });
  const proxyOff = await (await fetch(BASE + '/api/proxy')).json();
  check('可以停用代理', proxyOff.enabled === false);

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

  // 文案提取：接口与前端 Tab
  const txBad = await fetch(BASE + '/api/trends/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'not-a-link' })
  });
  check('文案提取拒绝非法链接', txBad.status === 400, 'HTTP ' + txBad.status);
  const txPost = await fetch(BASE + '/api/trends/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1xx411c7mD' })
  });
  const txJob = await txPost.json();
  check('文案提取接口返回 202 与任务快照', txPost.status === 202 && !!txJob.id && txJob.status !== 'error', JSON.stringify(txJob && txJob.status));
  let txFinal = null;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(BASE + '/api/trends/transcript/' + txJob.id);
    txFinal = await r.json();
    if (txFinal.status === 'done' || txFinal.status === 'error') break;
    await sleep(250);
  }
  check('演示模式文案提取完成', txFinal && txFinal.status === 'done', txFinal && txFinal.error);
  check(
    '文案快照包含分段与整篇文本',
    !!txFinal && Array.isArray(txFinal.segments) && txFinal.segments.length >= 3 && /视频文案的结构/.test(txFinal.text),
    txFinal ? txFinal.segments.length + ' 段' : '无分段'
  );
  const txMissing = await fetch(BASE + '/api/trends/transcript/no-such-job');
  check('不存在的文案任务返回 404', txMissing.status === 404, 'HTTP ' + txMissing.status);

  // 本地文件：上传接口与 ASR 状态
  const asrRes = await fetch(BASE + '/api/asr/status');
  const asrBody = await asrRes.json();
  check(
    '/api/asr/status 返回 ffmpeg / whisper / 模型状态',
    asrRes.ok && !!asrBody.ffmpeg && !!asrBody.whisper && !!asrBody.model && asrBody.offline === true,
    JSON.stringify(asrBody.model)
  );
  const uploadBad = await fetch(BASE + '/api/trends/transcript/upload?name=note.txt', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: 'hello'
  });
  check('上传接口拒绝不支持的格式', uploadBad.status === 400, 'HTTP ' + uploadBad.status);
  const uploadEmpty = await fetch(BASE + '/api/trends/transcript/upload?name=empty.mp4', {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: Buffer.alloc(0)
  });
  check('上传接口拒绝空文件', uploadEmpty.status === 400, 'HTTP ' + uploadEmpty.status);
  const uploadOk = await fetch(BASE + '/api/trends/transcript/upload?name=local-demo.wav', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: Buffer.alloc(4096, 1)
  });
  const uploadBody = await uploadOk.json();
  check(
    '上传本地音视频返回 fileId 与大小',
    uploadOk.status === 201 && /^[0-9a-f-]{36}\.wav$/i.test(uploadBody.fileId || '') && uploadBody.size === 4096,
    JSON.stringify(uploadBody)
  );
  const fileJobRes = await fetch(BASE + '/api/trends/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: uploadBody.fileId, name: 'local-demo.wav' })
  });
  const fileJob = await fileJobRes.json();
  check(
    '本地文件任务识别为「本地文件」',
    fileJobRes.status === 202 && fileJob.platform === '本地文件' && fileJob.title === 'local-demo',
    JSON.stringify({ platform: fileJob.platform, title: fileJob.title })
  );
  let fileFinal = null;
  for (let i = 0; i < 20; i++) {
    fileFinal = await (await fetch(BASE + '/api/trends/transcript/' + fileJob.id)).json();
    if (fileFinal.status === 'done' || fileFinal.status === 'error') break;
    await sleep(200);
  }
  check(
    '演示模式本地文件任务完成',
    !!fileFinal && fileFinal.status === 'done' && fileFinal.platform === '本地文件',
    fileFinal && (fileFinal.error || fileFinal.status)
  );
  const staleUpload = await fetch(BASE + '/api/trends/transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: '00000000-0000-0000-0000-000000000000.mp4' })
  });
  check('不存在的上传文件返回 404', staleUpload.status === 404, 'HTTP ' + staleUpload.status);

  const txTabBtn = doc.querySelector('[data-act="trendTab"][data-tab="transcript"]');
  const searchTabBtn = doc.querySelector('[data-act="trendTab"][data-tab="search"]');
  click(win, txTabBtn);
  check(
    '雷达可切到文案提取 Tab',
    !!txTabBtn && txTabBtn.classList.contains('on') &&
      !doc.querySelector('[data-trend-panel="transcript"]').classList.contains('hidden') &&
      doc.querySelector('[data-trend-panel="search"]').classList.contains('hidden')
  );
  const txUrl = doc.getElementById('transcriptUrl');
  txUrl.value = 'https://www.douyin.com/video/7300000000000000000';
  key(win, txUrl, 'input');
  click(win, doc.querySelector('[data-act="transcriptStart"]'));
  const txBox = await waitFor(() => {
    const box = doc.getElementById('transcriptResult');
    return box && /演示视频/.test(box.textContent) ? box : null;
  }, 15000);
  check('前端文案提取展示结果', !!txBox);
  const txBoxText = txBox ? txBox.textContent : '';
  check('结果含分段、整篇文案与操作按钮', /整篇文案/.test(txBoxText) &&
    !!doc.querySelector('[data-act="transcriptToTopic"]') &&
    !!doc.querySelector('[data-act="transcriptSaveAsset"]') &&
    !!doc.querySelector('[data-act="transcriptCopy"]') &&
    !!doc.querySelector('[data-act="transcriptDownload"]'), txBoxText.slice(0, 30));
  check(
    '文案提取面板含本地上传入口',
    !!doc.getElementById('transcriptFile') &&
      !!doc.querySelector('[data-act="transcriptPick"]') &&
      /文件不会上传云端/.test(doc.getElementById('view').textContent)
  );
  const asrCard = await waitFor(() => {
    const el = doc.getElementById('asrStatus');
    return el && /whisper\.cpp/.test(el.textContent) && /模型 small/.test(el.textContent) ? el : null;
  }, 10000);
  check('前端展示本地语音识别环境', !!asrCard, asrCard ? asrCard.textContent.slice(0, 40) : '未渲染');
  check(
    '模型未下载时提供下载入口或安装提示',
    !!(asrCard && (asrCard.querySelector('[data-act="transcriptAsrDownload"]') || /安装 whisper\.cpp/.test(asrCard.textContent)))
  );
  click(win, searchTabBtn);

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
