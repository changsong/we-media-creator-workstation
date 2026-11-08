'use strict';

/**
 * 端到端验证「爆款灵感雷达」：用 mock 适配器起一个独立服务，
 * 走一遍 添加对标账号 → 抓取最近 7 天作品 → 转选题 → 删除 → 文案提取。
 *
 * 关键词搜索已下线，脚本也会确认旧接口和旧表单不再存在。
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
const ACCOUNTS = [
  { platform: '小红书', url: 'https://www.xiaohongshu.com/user/profile/5f0d3b000000000000000001' },
  { platform: '抖音', url: 'https://www.douyin.com/user/MS4wLjABAAAA_mock_profile' },
  { platform: 'B站', url: 'https://space.bilibili.com/123456789' }
];

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
async function jsonPost(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    /* 非 JSON 响应 */
  }
  return { status: res.status, ok: res.ok, data };
}

async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  server = spawn(process.execPath, ['server.js', '--port', String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      WB_BENCH_MOCK: '1',
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
  const ok = await waitFor(
    () => fetch(BASE + '/api/benchmarks/status').then((r) => r.ok).catch(() => false),
    15000,
    250
  );
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

function openPage(hash) {
  return JSDOM.fromURL(BASE + '/' + (hash || ''), {
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
      window.confirm = () => true;
    }
  });
}

async function waitLoaded(win, doc) {
  await new Promise((resolve) => {
    if (doc.readyState === 'complete') resolve();
    else win.addEventListener('load', resolve);
  });
  return waitFor(() => /已同步/.test(doc.getElementById('syncText').textContent), 10000);
}

(async () => {
  await startServer();

  const dom = await openPage('');
  const win = dom.window;
  const doc = win.document;
  const synced = await waitLoaded(win, doc);
  check('页面连上本地服务并完成首次加载', !!synced, doc.getElementById('syncText').textContent);

  click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
  await sleep(200);

  check('选题池右侧渲染「爆款灵感雷达」', /爆款灵感雷达/.test(doc.getElementById('view').textContent));
  check('旧版快速录入表单已移除', !doc.getElementById('inlineName') && !doc.getElementById('inlineTopic'));
  check('旧关键词搜索入口已移除', !doc.getElementById('trendKeywords') && !doc.querySelector('[data-act="trendSearch"]'));
  check('旧平台勾选已移除', doc.querySelectorAll('[data-trend-platform]').length === 0);
  check(
    '面板含对标账号输入框与更新按钮',
    !!doc.getElementById('benchUrl') &&
      !!doc.querySelector('[data-act="benchAdd"]') &&
      !!doc.querySelector('[data-act="benchRefreshAll"]')
  );
  const tabs = doc.querySelectorAll('[data-act="trendTab"]');
  check(
    '面板为「对标账号 / 文案提取」两个 Tab',
    tabs.length === 2 &&
      /对标账号/.test(tabs[0].textContent) &&
      /文案提取/.test(tabs[1].textContent)
  );
  const platformLoaded = await waitFor(() => /演示/.test(doc.getElementById('view').textContent), 8000);
  check('平台状态加载完成（mock 显示演示）', !!platformLoaded);
  check('对标账号面板显示直连 chip', /直连/.test(doc.getElementById('view').textContent));

  const benchRes = await (await fetch(BASE + '/api/benchmarks')).json();
  check(
    '平台状态附带代理信息',
    !!(benchRes.platforms[0] && benchRes.platforms[0].proxy),
    JSON.stringify(benchRes.platforms[0] && benchRes.platforms[0].proxy)
  );
  check('初始化时没有对标账号与作品', benchRes.accounts.length === 0 && benchRes.works.length === 0);
  check(
    '默认每天 09:10 自动更新',
    benchRes.status.enabled === true && benchRes.status.hour === 9 && benchRes.status.minute === 10,
    benchRes.status.hour + ':' + benchRes.status.minute
  );

  // 旧关键词搜索接口应彻底下线
  const oldPlatforms = await fetch(BASE + '/api/trends/platforms');
  const oldSearch = await jsonPost('/api/trends/search', { keywords: ['测试'] });
  const oldLatest = await fetch(BASE + '/api/trends/latest');
  check(
    '旧雷达搜索接口返回 404',
    oldPlatforms.status === 404 && oldSearch.status === 404 && oldLatest.status === 404,
    [oldPlatforms.status, oldSearch.status, oldLatest.status].join('/')
  );

  // 添加账号
  const added = [];
  for (const a of ACCOUNTS) {
    const res = await jsonPost('/api/benchmarks/accounts', { url: a.url });
    if (res.data && res.data.account) added.push(res.data.account);
    check('添加对标账号：' + a.platform, res.status === 201 && res.ok && res.data.created === true, (res.data && res.data.account && res.data.account.accountId) || '');
  }
  check('三个平台账号全部识别', added.length === 3 && added.map((a) => a.platform).join(',') === '小红书,抖音,B站', added.map((a) => a.platform).join(','));

  const dup = await jsonPost('/api/benchmarks/accounts', { url: ACCOUNTS[0].url });
  check('重复添加同一账号不新建记录', dup.ok && dup.data.created === false && dup.data.account.id === added[0].id);

  const badAdd = await jsonPost('/api/benchmarks/accounts', { url: 'https://example.com/not-a-profile' });
  check('无法识别的链接返回 400', badAdd.status === 400, 'HTTP ' + badAdd.status);

  // 全部更新
  const refresh = await jsonPost('/api/benchmarks/refresh');
  check('全部更新接口返回 202 与任务快照', refresh.status === 202 && refresh.data.running === true, JSON.stringify(refresh.data && refresh.data.progress));
  const done = await waitFor(async () => {
    const st = await (await fetch(BASE + '/api/benchmarks/status')).json();
    return !st.running ? st : null;
  }, 25000, 250);
  check('mock 抓取完成且状态为 done', !!done && done.status === 'done' && done.progress.done === 3, done && done.progress.done + '/' + done.progress.total);
  check(
    '每个账号都抓到作品',
    !!done && done.results.length === 3 && done.results.every((r) => r.status === 'done' && r.count >= 8),
    done ? done.results.map((r) => r.platform + ':' + r.count).join(',') : ''
  );

  const overview = await (await fetch(BASE + '/api/benchmarks?days=7&limit=200')).json();
  check('概览返回 3 个账号与 24 条作品', overview.accounts.length === 3 && overview.works.length === 24, overview.accounts.length + ' 账号 / ' + overview.works.length + ' 作品');
  check(
    '账号带最近 7 天作品数与更新时间',
    overview.accounts.every((a) => a.recentCount >= 8 && !!a.lastFetchAt && !a.lastError),
    overview.accounts.map((a) => a.recentCount).join(',')
  );
  check(
    '作品含链接、类型与热度',
    overview.works.every((w) => /^https?:\/\//.test(w.itemUrl) && ['video', 'note'].indexOf(w.itemType) >= 0 && Number(w.heat) > 0)
  );
  check('作品默认按发布时间倒序', overview.works.every((w, i) => i === 0 || String(overview.works[i - 1].publishedAt) >= String(w.publishedAt)));

  // 暂停 / 启用
  const toggled = await fetch(BASE + '/api/benchmarks/accounts/' + added[0].id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false })
  }).then((r) => r.json());
  check('可以暂停单个账号', toggled.account && toggled.account.enabled === false);
  await fetch(BASE + '/api/benchmarks/accounts/' + added[0].id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true })
  });

  // 调度配置
  const scheduleGet = await (await fetch(BASE + '/api/benchmarks/schedule')).json();
  check('调度接口返回当前配置', scheduleGet.enabled === true && scheduleGet.hour === 9 && scheduleGet.minute === 10);
  const schedulePut = await jsonPost('/api/benchmarks/schedule', { enabled: true, hour: 8, minute: 45 });
  check('可以修改自动更新时间', schedulePut.ok && schedulePut.data.hour === 8 && schedulePut.data.minute === 45);
  const rawConfig = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'benchmark-monitor.json'), 'utf8'));
  check('调度配置持久化到本地文件', rawConfig.hour === 8 && rawConfig.minute === 45);
  await jsonPost('/api/benchmarks/schedule', { enabled: true, hour: 9, minute: 10 });

  // 前端：账号与作品渲染
  click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
  const accountRows = await waitFor(() => {
    const rows = doc.querySelectorAll('#benchAccounts > div');
    return rows.length === 3 ? rows : null;
  }, 12000);
  check('前端渲染 3 个对标账号', !!accountRows, accountRows ? accountRows.length + ' 个' : '未渲染');
  const cards = await waitFor(() => {
    const list = doc.querySelectorAll('#benchWorks [data-act="benchToTopic"]');
    return list.length >= 1 ? list : null;
  }, 12000);
  check('前端渲染最近 7 天作品卡片', !!cards, cards ? cards.length + ' 张' : '无结果');
  const worksText = doc.getElementById('benchWorks').textContent;
  check('作品卡片带平台 / 类型 / 热度', /小红书/.test(worksText) && /(视频|图文)/.test(worksText) && /热度\s*\d+/.test(worksText));

  click(win, doc.querySelector('[data-act="benchFilter"][data-val="小红书"]'));
  await sleep(200);
  check(
    '按平台筛选只显示对应作品',
    doc.querySelectorAll('#benchWorks > div').length === 8 &&
      doc.querySelector('[data-act="benchFilter"][data-val="小红书"]').className.indexOf('bg-primary') >= 0
  );
  click(win, doc.querySelector('[data-act="benchSort"]'));
  await sleep(200);
  check('可以切换为按热度排序', /按热度/.test(doc.querySelector('[data-act="benchSort"]').textContent));
  const heats = Array.from(doc.querySelectorAll('#benchWorks .chip'))
    .map((el) => {
      const m = el.textContent.match(/热度\s*(\d+)/);
      return m ? Number(m[1]) : null;
    })
    .filter((v) => v !== null);
  check('按热度排序后从高到低', heats.length >= 8 && heats.every((v, i) => i === 0 || heats[i - 1] >= v), heats.slice(0, 6).join(','));

  // 转选题
  const firstCard = doc.querySelector('#benchWorks [data-act="benchToTopic"]');
  click(win, firstCard);
  const opened = await waitFor(() => doc.getElementById('drawer').classList.contains('on'), 6000);
  check('点「转选题」打开选题弹窗', !!opened);
  check(
    '弹窗为居中选题样式',
    doc.getElementById('drawer').classList.contains('center-popup') && doc.getElementById('drawer').classList.contains('topic-popup')
  );
  const titleEl = doc.querySelector('[data-field="选题"]');
  const angleEl = doc.querySelector('[data-field="切入角度"]');
  const refEl = doc.querySelector('[data-field="参考链接"]');
  const scoreEl = doc.querySelector('[data-field="爆款潜力评分"]');
  const tagChecked = doc.querySelectorAll('[data-field="标签"]:checked').length;
  check('转选题已预填标题', !!titleEl && titleEl.value.length > 0, titleEl ? titleEl.value.slice(0, 30) : '');
  check('转选题已预填切入角度', !!angleEl && /对标账号/.test(angleEl.value), angleEl ? angleEl.value.slice(0, 40) : '');
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

  // 前端进入文案提取
  const txTabBtn = doc.querySelector('[data-act="trendTab"][data-tab="transcript"]');
  click(win, txTabBtn);
  check(
    '雷达可切到文案提取 Tab',
    !!txTabBtn && txTabBtn.classList.contains('on') &&
      !doc.querySelector('[data-trend-panel="transcript"]').classList.contains('hidden') &&
      doc.querySelector('[data-trend-panel="accounts"]').classList.contains('hidden')
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
  check(
    '结果含分段、整篇文案与操作按钮',
    /整篇文案/.test(txBoxText) &&
      !!doc.querySelector('[data-act="transcriptToTopic"]') &&
      !!doc.querySelector('[data-act="transcriptSaveAsset"]') &&
      !!doc.querySelector('[data-act="transcriptCopy"]') &&
      !!doc.querySelector('[data-act="transcriptDownload"]'),
    txBoxText.slice(0, 30)
  );
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

  // 文案提取接口（保留原有能力）
  const txBad = await jsonPost('/api/trends/transcript', { url: 'not-a-link' });
  check('文案提取拒绝非法链接', txBad.status === 400, 'HTTP ' + txBad.status);
  const txPost = await jsonPost('/api/trends/transcript', {
    url: 'https://www.bilibili.com/video/BV1xx411c7mD'
  });
  check(
    '文案提取接口返回 202 与任务快照',
    txPost.status === 202 && !!txPost.data.id && txPost.data.status !== 'error',
    JSON.stringify(txPost.data && txPost.data.status)
  );
  let txFinal = null;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(BASE + '/api/trends/transcript/' + txPost.data.id);
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
  const fileJobRes = await jsonPost('/api/trends/transcript', { fileId: uploadBody.fileId, name: 'local-demo.wav' });
  check(
    '本地文件任务识别为「本地文件」',
    fileJobRes.status === 202 && fileJobRes.data.platform === '本地文件' && fileJobRes.data.title === 'local-demo',
    JSON.stringify({ platform: fileJobRes.data.platform, title: fileJobRes.data.title })
  );
  let fileFinal = null;
  for (let i = 0; i < 20; i++) {
    fileFinal = await (await fetch(BASE + '/api/trends/transcript/' + fileJobRes.data.id)).json();
    if (fileFinal.status === 'done' || fileFinal.status === 'error') break;
    await sleep(200);
  }
  check(
    '演示模式本地文件任务完成',
    !!fileFinal && fileFinal.status === 'done' && fileFinal.platform === '本地文件',
    fileFinal && (fileFinal.error || fileFinal.status)
  );
  const staleUpload = await jsonPost('/api/trends/transcript', { fileId: '00000000-0000-0000-0000-000000000000.mp4' });
  check('不存在的上传文件返回 404', staleUpload.status === 404, 'HTTP ' + staleUpload.status);

  // 代理配置：默认关闭；配置接口需掩码、KEEP 与配置不完整时拒绝启用
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

  await putProxy({ enabled: false });
  const proxyOff = await (await fetch(BASE + '/api/proxy')).json();
  check('可以停用代理', proxyOff.enabled === false);

  // 删除账号：作品级联删除
  const bili = overview.accounts.find((a) => a.platform === 'B站');
  const del = await fetch(BASE + '/api/benchmarks/accounts/' + bili.id, { method: 'DELETE' });
  check('删除对标账号成功', del.ok, 'HTTP ' + del.status);
  const afterDel = await (await fetch(BASE + '/api/benchmarks?days=7&limit=200')).json();
  check(
    '删除账号同时清理其作品',
    afterDel.accounts.length === 2 && afterDel.works.length === 16,
    afterDel.accounts.length + ' 账号 / ' + afterDel.works.length + ' 作品'
  );

  // 刷新页面：应从数据库恢复账号与作品，无需重新搜索
  const dom2 = await openPage('#topics');
  const win2 = dom2.window;
  const doc2 = win2.document;
  await waitLoaded(win2, doc2);
  const restoredAccounts = await waitFor(() => {
    const rows = doc2.querySelectorAll('#benchAccounts > div');
    return rows.length === 2 ? rows : null;
  }, 12000);
  check('刷新后自动恢复对标账号', !!restoredAccounts, restoredAccounts ? restoredAccounts.length + ' 个' : '未渲染');
  const restoredCards = await waitFor(() => {
    const list = doc2.querySelectorAll('#benchWorks [data-act="benchToTopic"]');
    return list.length >= 1 ? list : null;
  }, 12000);
  check('刷新后自动恢复作品列表', !!restoredCards, restoredCards ? restoredCards.length + ' 张卡片' : '无结果');
  check('刷新后不再出现关键词输入框', !doc2.getElementById('trendKeywords'));
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
