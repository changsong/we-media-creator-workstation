'use strict';

/**
 * 页面冒烟测试：用 jsdom 打开真实页面，跑一遍读取、新建、筛选、检索、删除。
 * 用法：node tools/smoke-test.js [baseUrl]
 * 需要 jsdom：NODE_PATH=<node_modules 路径> node tools/smoke-test.js
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeout = 6000, interval = 80) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let value;
    try {
      value = fn();
    } catch (err) {
      value = false;
    }
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

function key(el, type) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  const viewText = doc.getElementById('view').textContent;
  const kpis = doc.querySelectorAll('#view .text-display-lg');
  check('首页渲染 4 张统计卡', kpis.length === 4, `${kpis.length} 张`);
  check('首页有本周待发布清单', /本周待发布清单/.test(viewText));
  check('首页有每周更新频率柱状图', /近 8 周更新频率节奏/.test(viewText));
  check('首页有近 7 天趋势折线', doc.querySelectorAll('#view svg path').length >= 3, `${doc.querySelectorAll('#view svg path').length} 条`);

  // 痛点4 / 痛点5：首页风险与待办区块
  check('首页含「逾期排期」清单卡片', /逾期排期/.test(viewText), /逾期排期/.test(viewText) ? '已渲染' : '缺失');
  check('首页含「今日待录数据」清单卡片', /今日待录数据/.test(viewText), /今日待录数据/.test(viewText) ? '已渲染' : '缺失');
  check('首页逾期清单带逾期天数标记', /天前/.test(viewText) || /都按时发布或尚未到期/.test(viewText), /天前/.test(viewText) ? '有逾期天数' : '无逾期');
  check('首页今日待录带「记一条」入口', doc.querySelectorAll('[data-act="rec"][data-calcode]').length > 0 || /今天都记过了/.test(viewText), doc.querySelectorAll('[data-act="rec"]').length + ' 个');

  const topicTab = doc.querySelector('.nav-link[data-tab="topics"]');
  click(win, topicTab);
  await sleep(60);
  const rowsBefore = doc.querySelectorAll('.tbl tbody tr').length;
  check('选题池渲染表格', rowsBefore > 0, `${rowsBefore} 行`);
  check('选题池有状态筛选', !!doc.getElementById('statusFilter'));

  // 新建一条选题
  click(win, doc.querySelector('[data-act="new"][data-db="topic"]'));
  await sleep(80);
  check('抽屉打开', doc.getElementById('drawer').classList.contains('on'));

  const idInput = doc.querySelector('#drawerBody input[readonly]');
  check('业务 ID 为只读、保存后自动生成', !!idInput && idInput.readOnly && !idInput.value, idInput ? (idInput.value || '待生成') : '未找到');

  const title = doc.querySelector('[data-field="选题"]');
  title.value = '冒烟测试选题 ' + Date.now().toString().slice(-5);
  key(title, 'input');
  const platform = doc.querySelector('[data-field="平台"]');
  platform.value = '小红书';
  key(platform, 'change');
  const score = doc.querySelector('[data-field="爆款潜力评分"]');
  score.value = '8.8';
  key(score, 'input');

  click(win, doc.getElementById('drawerSave'));
  const saved = await waitFor(() => !doc.getElementById('drawer').classList.contains('on'), 8000);
  check('保存后抽屉关闭', !!saved);

  const toastText = Array.from(doc.querySelectorAll('.toast')).map((t) => t.textContent).join(' ');
  check('保存有成功反馈', /已保存/.test(toastText), toastText.trim().slice(0, 60));

  await sleep(300);
  const rowsAfter = doc.querySelectorAll('.tbl tbody tr').length;
  check('列表新增一行', rowsAfter === rowsBefore + 1, `${rowsBefore} → ${rowsAfter}`);

  const newRow = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => /冒烟测试选题/.test(tr.textContent));
  check('新行显示自动生成的选题ID', !!newRow && /TP\d{4}-\d{2}/.test(newRow.textContent), newRow ? newRow.textContent.trim().slice(0, 60) : '');

  // 校验失败反馈
  click(win, doc.querySelector('[data-act="new"][data-db="topic"]'));
  await sleep(60);
  click(win, doc.getElementById('drawerSave'));
  await sleep(200);
  check('空表单提交有失败反馈', /不能为空|至少填写/.test(doc.getElementById('toasts').textContent));
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // 平台筛选
  const pf = doc.getElementById('pfFilter');
  pf.value = '小红书';
  key(pf, 'change');
  await sleep(80);
  const platforms = Array.from(doc.querySelectorAll('.tbl tbody tr .chip.pf')).map((c) => c.textContent.trim());
  check('平台筛选只留小红书', platforms.length > 0 && platforms.every((p) => p === '小红书'), platforms.join(','));
  pf.value = 'all';
  key(pf, 'change');
  await sleep(60);

  // 痛点修复：头部渠道筛选应驱动新建记录的平台默认值
  const pfNow = doc.getElementById('pfFilter');
  pfNow.value = '小红书';
  key(pfNow, 'change');
  await sleep(60);
  click(win, doc.querySelector('[data-act="new"][data-db="topic"]'));
  await sleep(80);
  const pfFollow = doc.querySelector('[data-field="平台"]');
  check('头部选「小红书」后新建选题默认平台跟随', pfFollow && pfFollow.value === '小红书', pfFollow ? pfFollow.value : '缺字段');
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);

  // 残留「公众号」草稿不应覆盖头部渠道默认值
  click(win, doc.querySelector('[data-act="new"][data-db="topic"]'));
  await sleep(60);
  const pfSeed = doc.querySelector('[data-field="平台"]');
  pfSeed.value = '公众号'; key(pfSeed, 'change');
  const tSeed = doc.querySelector('[data-field="选题"]');
  if (tSeed) { tSeed.value = '草稿占位'; key(tSeed, 'input'); }
  await sleep(450); // 等待草稿防抖落盘（saveDraft 300ms）
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);
  pfNow.value = '抖音';
  key(pfNow, 'change');
  await sleep(60);
  click(win, doc.querySelector('[data-act="new"][data-db="topic"]'));
  await sleep(80);
  const pfStale = doc.querySelector('[data-field="平台"]');
  check('残留「公众号」草稿不覆盖头部「抖音」', pfStale && pfStale.value === '抖音', pfStale ? pfStale.value : '缺字段');
  click(win, doc.getElementById('drawerCancel'));
  await sleep(60);
  try { win.localStorage.removeItem('wb_workbench_draft_topic_new'); } catch (e) {}
  pfNow.value = 'all';
  key(pfNow, 'change');
  await sleep(60);

  // 一键排期：预填检查
  let schedRow = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => /冒烟测试选题/.test(tr.textContent));
  const toSchedBtn = schedRow && schedRow.querySelector('[data-act="toSchedule"]');
  check('待写选题有「排期」按钮', !!toSchedBtn);
  if (toSchedBtn) {
    click(win, toSchedBtn);
    await sleep(120);
    check('一键排期打开日历表单', doc.getElementById('drawer').classList.contains('on') && /内容日历/.test(doc.getElementById('drawerTitle').textContent));
    const fillId = doc.querySelector('[data-field="选题ID"]') ? doc.querySelector('[data-field="选题ID"]').value : '';
    const fillTitle = doc.querySelector('[data-field="标题"]') ? doc.querySelector('[data-field="标题"]').value : '';
    const fillPf = doc.querySelector('[data-field="平台"]') ? doc.querySelector('[data-field="平台"]').value : '';
    check('一键排期已带入选题ID/标题/平台', /TP\d{4}-\d{2}/.test(fillId) && /冒烟测试选题/.test(fillTitle) && fillPf === '小红书', `${fillId} / ${fillTitle} / ${fillPf}`);
    click(win, doc.getElementById('drawerCancel'));
    await sleep(60);
  }

  // 行内状态修改
  const statusSel = schedRow && schedRow.querySelector('select[data-qfield="状态"]');
  check('选题状态支持行内修改', !!statusSel);
  if (statusSel) {
    statusSel.value = '写作中';
    key(statusSel, 'change');
    await waitFor(() => /「状态」已更新/.test(doc.getElementById('toasts').textContent), 6000);
    check('行内改状态有成功反馈', /「状态」已更新/.test(doc.getElementById('toasts').textContent));
    await sleep(250);
    schedRow = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => /冒烟测试选题/.test(tr.textContent));
    check('行内改状态已生效', !!schedRow && schedRow.querySelector('select[data-qfield="状态"]').value === '写作中');
  }

  // 内容日历
  click(win, doc.querySelector('.nav-link[data-tab="calendar"]'));
  await sleep(80);
  check('日历渲染 42 个日期格', doc.querySelectorAll('.cal .cell').length >= 35, `${doc.querySelectorAll('.cal .cell').length} 格`);
  check('日历有阶段筛选', !!doc.getElementById('stageFilter'));
  const stage = doc.getElementById('stageFilter');
  stage.value = '待发布';
  key(stage, 'change');
  await sleep(80);
  const evs = doc.querySelectorAll('.cal .ev');
  check('阶段筛选只留「待发布」排期', evs.length > 0, `${evs.length} 条事件`);
  stage.value = '已复盘';
  key(stage, 'change');
  await sleep(80);
  // 阶段列现在是行内下拉，读选中项
  const chips = Array.from(doc.querySelectorAll('.tbl tbody tr select.st')).map((el) => el.options[el.selectedIndex].textContent.trim());
  check('切换阶段后列表只留该阶段', chips.length > 0 && chips.every((c) => c === '已复盘'), chips.join(','));
  stage.value = 'all';
  key(stage, 'change');
  await sleep(60);

  // 标记已发布 → 引导记快照
  let createdSchedTitle = '';
  click(win, doc.querySelector('.nav-link[data-tab="home"]'));
  await sleep(100);
  let pubBtn = doc.querySelector('[data-act="publish"]');
  // 种子数据按相对日期生成，若本周恰好无待发布排期（周末/周初常见），新建一条本周待发布排期再测，避免测试看天吃饭
  if (!pubBtn) {
    click(win, doc.querySelector('.nav-link[data-tab="calendar"]'));
    await sleep(80);
    click(win, doc.querySelector('[data-act="new"][data-db="calendar"]'));
    await sleep(80);
    const cTitle = doc.querySelector('[data-field="标题"]');
    cTitle.value = '冒烟测试待发布排期 ' + Date.now().toString().slice(-5);
    key(cTitle, 'input');
    const cTime = doc.querySelector('[data-field="计划发布时间"]');
    cTime.value = localToday() + 'T20:00';
    key(cTime, 'change');
    const cStage = doc.querySelector('[data-field="当前阶段"]');
    if (cStage) { cStage.value = '待发布'; key(cStage, 'change'); }
    const cPlatform = doc.querySelector('[data-field="平台"]');
    if (cPlatform) { cPlatform.value = '公众号'; key(cPlatform, 'change'); }
    click(win, doc.getElementById('drawerSave'));
    await waitFor(() => !doc.getElementById('drawer').classList.contains('on'), 8000);
    await sleep(300);
    createdSchedTitle = cTitle.value;
    click(win, doc.querySelector('.nav-link[data-tab="home"]'));
    await sleep(120);
    pubBtn = doc.querySelector('[data-act="publish"]');
  }
  check('本周待发布有「标记已发布」', !!pubBtn);
  if (pubBtn) {
    const rowEl = pubBtn.closest('.row');
    const rowSel = rowEl.querySelector('select[data-qfield="当前阶段"]');
    const origStage = rowSel ? rowSel.value : '待发布';
    const schedCode = (rowEl.textContent.match(/SC\d{4}-\d{2}/) || [])[0] || '';
    click(win, pubBtn);
    const ask = await waitFor(() => doc.querySelector('.toast.ask'), 6000);
    check('标记已发布后弹出记快照提示', !!ask);
    if (ask) {
      click(win, ask.querySelector('.tbtn'));
      await sleep(200);
      const drawerOn = doc.getElementById('drawer').classList.contains('on');
      const rvCode = doc.querySelector('[data-field="排期ID"]') ? doc.querySelector('[data-field="排期ID"]').value : '';
      const rvDate = doc.querySelector('[data-field="统计日期"]') ? doc.querySelector('[data-field="统计日期"]').value : '';
      check('快照表单已预填排期与今天日期', drawerOn && rvCode === schedCode && rvDate === localToday(), `${rvCode || '未填'} / ${rvDate || '未填'}`);
      click(win, doc.getElementById('drawerCancel'));
      await sleep(80);
    }
    // 还原：把排期阶段改回去，再还原被联动的选题状态
    click(win, doc.querySelector('.nav-link[data-tab="calendar"]'));
    await sleep(120);
    const calRow = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => schedCode && tr.textContent.includes(schedCode));
    if (calRow && origStage) {
      const sel = calRow.querySelector('select[data-qfield="当前阶段"]');
      if (sel && sel.value !== origStage) {
        sel.value = origStage;
        key(sel, 'change');
        await waitFor(() => /「当前阶段」已更新/.test(doc.getElementById('toasts').textContent), 6000);
        check('快捷改阶段可还原排期', true);
        await sleep(500);
        const topicCode = (calRow.textContent.match(/TP\d{4}-\d{2}/) || [])[0];
        click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
        await sleep(150);
        const linkedRow = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => topicCode && tr.textContent.includes(topicCode));
        const linkedSel = linkedRow && linkedRow.querySelector('select[data-qfield="状态"]');
        if (linkedSel && linkedSel.value !== '待写') {
          linkedSel.value = '待写';
          key(linkedSel, 'change');
          await waitFor(() => /「状态」已更新/.test(doc.getElementById('toasts').textContent), 6000);
          await sleep(250);
        }
      }
    }
  }

  // 数据复盘
  click(win, doc.querySelector('.nav-link[data-tab="review"]'));
  await sleep(80);
  const calc = Array.from(doc.querySelectorAll('.tbl .calc')).map((td) => td.textContent.trim()).filter(Boolean);
  check('复盘表实时算出互动率/涨粉率', calc.length > 0 && calc.every((c) => /%|—/.test(c)), calc.slice(0, 3).join(' '));

  // 痛点6：复盘页「按排期聚合」视图
  const aggBtn = doc.querySelector('[data-act="rvMode"][data-mode="agg"]');
  check('复盘页有「按排期聚合」切换', !!aggBtn);
  if (aggBtn) {
    click(win, aggBtn);
    await sleep(150);
    const viewText = doc.getElementById('view').textContent;
    check('切换后进入聚合视图', /发布以来走势/.test(viewText) && !!doc.querySelector('.tbl'));
    check('聚合视图含走势 sparkline', doc.querySelectorAll('svg polyline').length > 0, `${doc.querySelectorAll('svg polyline').length} 条`);
    check('聚合视图一篇一行含「记一条」', doc.querySelectorAll('[data-act="rec"][data-calcode]').length > 0);
    // 切回流水账
    const listBtn = doc.querySelector('[data-act="rvMode"][data-mode="list"]');
    if (listBtn) { click(win, listBtn); await sleep(100); }
  }

  // 素材库全文检索
  click(win, doc.querySelector('.nav-link[data-tab="assets"]'));
  await sleep(80);
  const q = doc.getElementById('qAsset');
  q.value = '视觉焦点';
  key(q, 'input');
  await sleep(120);
  const hits = doc.querySelectorAll('.acard').length;
  check('全文检索命中正文', hits >= 1, `${hits} 篇`);

  const card = doc.querySelector('.acard');
  click(win, card);
  await sleep(80);
  check('素材详情渲染 Markdown', !!doc.querySelector('.md h1, .md h2, .md p'));

  click(win, doc.querySelector('[data-act="backAsset"]'));
  await sleep(60);

  // 删除刚建的测试选题
  click(win, doc.querySelector('.nav-link[data-tab="topics"]'));
  await sleep(80);
  const target = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => /冒烟测试选题/.test(tr.textContent));
  check('找到待删除的测试行', !!target);
  if (target) {
    const delBtn = target.querySelector('[data-act="del"]');
    click(win, delBtn);
    await sleep(60);
    check('删除前弹确认框', doc.getElementById('modal').classList.contains('on'));
    click(win, doc.getElementById('modalOk'));
    await waitFor(() => !/冒烟测试选题/.test(doc.getElementById('view').textContent), 6000);
    check('删除后列表移除该行', !/冒烟测试选题/.test(doc.getElementById('view').textContent));
  }

  // 删除新建的测试排期（若有）
  if (createdSchedTitle) {
    click(win, doc.querySelector('.nav-link[data-tab="calendar"]'));
    await sleep(100);
    const schedTarget = Array.from(doc.querySelectorAll('.tbl tbody tr')).find((tr) => tr.textContent.includes(createdSchedTitle));
    if (schedTarget) {
      const delBtn = schedTarget.querySelector('[data-act="del"]');
      if (delBtn) {
        click(win, delBtn);
        await sleep(60);
        click(win, doc.getElementById('modalOk'));
        await waitFor(() => !doc.getElementById('view').textContent.includes(createdSchedTitle), 6000);
      }
    }
  }

  win.close();
  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${okCount}/${results.length} 项通过${failed ? `，${failed} 项失败` : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('测试脚本异常：', err);
  process.exit(1);
});
