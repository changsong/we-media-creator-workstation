#!/usr/bin/env node
// 抖音半自动私信：脚本负责排队、起草、复制、自动打开私信面板、记录与限额；
// 每条消息仍由运营人员在浏览器里粘贴并发送，避免全自动群发触发平台风控。
//   node marketing/scripts/send.mjs --login          首次登录（扫码）
//   node marketing/scripts/send.mjs                  预览今天的名单与文案（dry-run）
//   node marketing/scripts/send.mjs --live           正式逐条发送（单键操作）

import path from 'node:path';
import {
  DATA_DIR,
  copyToClipboard,
  createKeyReader,
  createPrompter,
  loadTemplates,
  parseArgs,
  randomInt,
  render,
  sleep,
  todayKey,
} from './lib/util.mjs';
import { getLead, markSent, markSkipped, queue, stats } from './lib/store.mjs';
import { openSession } from './lib/browser.mjs';

const RISK_PATTERNS = ['安全验证', '人机验证', '操作频繁', '请稍后再试', '访问异常', '账号存在异常', '网络繁忙'];
const GONE_PATTERNS = ['该用户不存在', '账号已注销', '无法查看该内容'];
const DAILY_CAP_HARD_LIMIT = 40;

const args = parseArgs();
const bank = loadTemplates();
const cfg = bank.settings;
const keyReader = createKeyReader();

const live = args.live === true && args['dry-run'] !== true;
const limit = Math.max(1, Math.min(Number(args.limit) || 10, 20));
const dailyCap = Math.max(1, Math.min(Number(args.cap) || cfg.dailyCap || 40, DAILY_CAP_HARD_LIMIT));
const cooldownDays = Math.max(1, Number(args['cooldown-days']) || cfg.cooldownDays || 30);
const minFollowers = Math.max(0, Number(args['min-followers']) || 0);
const maxFollowers = Math.max(0, Number(args['max-followers']) || 0);
const noWait = args['no-wait'] === true;
const templateArg = args.template ? String(args.template) : '';

function pickOpener(lead) {
  if (templateArg) {
    const hit = bank.openers.find((item) => item.id === templateArg || item.id.startsWith(templateArg + '-'));
    if (!hit) throw new Error(`找不到模板 ${templateArg}，可选：${bank.openers.map((o) => o.id).join(', ')}`);
    return hit;
  }
  const sorted = [...bank.openers].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[lead.id % sorted.length];
}

function draftFor(lead) {
  const opener = pickOpener(lead);
  const text = render(opener.text, {
    nickname: lead.nickname || '你好',
    niche: lead.niche || '自媒体',
    trial_url: cfg.trialUrl,
    site_url: cfg.siteUrl,
    trial_days: cfg.trialDays,
  });
  return { opener, text };
}

function isDouyinProfile(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)douyin\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith('/user/');
  } catch (err) {
    return false;
  }
}

function showDraft(lead, draft, index, total) {
  console.log(`\n[${index}/${total}] #${lead.id} ${lead.nickname}  粉丝 ${lead.followers}  ${lead.niche || '未标注'}`);
  console.log(`模板：${draft.opener.id}（${draft.opener.title}）`);
  console.log('─'.repeat(60));
  console.log(draft.text);
  console.log('─'.repeat(60));
}

async function runDry() {
  const pending = queue({ limit, cooldownDays, minFollowers, maxFollowers, platform: 'douyin' });
  if (!pending.length) {
    console.log('可触达名单为空。先导入 CSV：node marketing/scripts/leads.mjs import <csv>');
    return;
  }
  console.log(`预览 ${pending.length} 条（dry-run，不会发送、不会改状态）`);
  pending.forEach((lead, index) => {
    const draft = draftFor(lead);
    showDraft(lead, draft, index + 1, pending.length);
  });
  console.log('\n确认无误后运行：node marketing/scripts/send.mjs --live');
}

async function runLogin() {
  const session = await openSession('https://www.douyin.com/');
  console.log('\n浏览器已打开抖音。请扫码登录，登录成功后回到这里按 Enter。');
  console.log('登录态保存在 marketing/data/chrome-profile，下次不用重复登录。');
  const prompter = createPrompter();
  try {
    await prompter.ask('按 Enter 关闭连接（浏览器窗口会保留）：');
  } finally {
    prompter.close();
  }
  session.close();
}

async function runLive() {
  const sentToday = stats().sentToday;
  if (sentToday >= dailyCap) {
    console.log(`今日已发送 ${sentToday} 条，达到上限 ${dailyCap} 条，明天再跑。`);
    return;
  }
  const remaining = Math.min(limit, dailyCap - sentToday);
  let pending;
  if (args.id) {
    const lead = getLead(Number(args.id));
    if (!lead) {
      console.log(`找不到名单 #${args.id}`);
      return;
    }
    if (lead.status === 'sent' && !args.force) {
      console.log(`#${lead.id} 已标记发送过；确认要再发一次请加 --force。`);
      return;
    }
    pending = [lead];
  } else {
    pending = queue({ limit: remaining, cooldownDays, minFollowers, maxFollowers, platform: 'douyin' });
  }
  if (!pending.length) {
    console.log('可触达名单为空。先导入 CSV 或等待冷却期结束。');
    return;
  }

  console.log(`今日额度：剩余 ${dailyCap - sentToday} 条，本次处理 ${pending.length} 条。`);
  const session = await openSession('https://www.douyin.com/');
  console.log('\n若浏览器里还没有登录，请先扫码登录；完成后按 Enter 开始，或 q 退出。');
  const start = await keyReader.key('Enter/任意键开始，q 退出 > ');
  if (start === 'q' || start === '\u0003') {
    session.close();
    return;
  }

  const total = pending.length;
  const handled = new Set();
  let sentCount = 0;
  let skippedCount = 0;
  let aborted = false;

  // 打开一条主页：导航、风控/失效检查、自动点私信、复制文案。
  async function focus(index) {
    const lead = pending[index];
    const draft = draftFor(lead);
    showDraft(lead, draft, index + 1, total);

    if (!isDouyinProfile(lead.profile_url)) {
      console.log(`跳过 #${lead.id}：不是抖音用户主页链接 ${lead.profile_url}`);
      markSkipped(lead.id, '', '', '非抖音主页链接');
      handled.add(index);
      skippedCount++;
      return { status: 'skip' };
    }

    try {
      await session.navigate(lead.profile_url);
      const pageText = await session.text();
      if (GONE_PATTERNS.some((token) => pageText.includes(token))) {
        console.log('主页不可用，已跳过。');
        markSkipped(lead.id, draft.opener.id, draft.text, '主页不可用');
        handled.add(index);
        skippedCount++;
        return { status: 'skip' };
      }
      if (RISK_PATTERNS.some((token) => pageText.includes(token))) {
        const shot = path.join(DATA_DIR, 'screenshots', `${todayKey()}-${lead.id}.png`);
        await session.screenshot(shot).catch(() => {});
        console.error(`\n检测到平台验证/限流提示，立即停止。截图：${shot}`);
        return { status: 'abort' };
      }
    } catch (err) {
      console.error(`打开主页失败：${err.message}`);
      console.error('请确认浏览器窗口还在，然后重新运行。');
      return { status: 'abort' };
    }

    const opened = await session.openDm().catch(() => false);
    console.log(opened ? '已尝试打开私信面板；若没弹出请手动点「私信」。' : '没找到「私信」按钮，请手动点击。');
    const copied = copyToClipboard(draft.text);
    console.log(copied ? '文案已复制：去私信框 Ctrl+V，发送后按 y / Enter 记录。' : '自动复制失败，请手动复制上面的文案。');
    return { status: 'ok' };
  }

  // 从 start 起按方向找下一条未处理的名单；已失效的会自动跳过。
  async function moveTo(startIndex, dir) {
    for (let i = startIndex; i >= 0 && i < total; i += dir) {
      if (handled.has(i)) continue;
      const res = await focus(i);
      if (res.status === 'abort') return { abort: true, index: -1 };
      if (res.status === 'ok') return { abort: false, index: i };
    }
    return { abort: false, index: -1 };
  }

  let cur = await moveTo(0, 1);
  if (cur.abort) aborted = true;
  if (cur.index < 0 && !aborted) console.log('没有可处理的名单。');

  while (cur.index >= 0 && !aborted) {
    const lead = pending[cur.index];
    const draft = draftFor(lead);
    const left = total - handled.size;
    const prompt = `\n[y/Enter]已发  [s]跳过  [j]下一条  [k]上一条  [r]重贴  [o]重开私信  [q]退出  （剩余 ${left} 条）> `;
    const key = await keyReader.key(prompt);

    if (key === 'q' || key === '\u0003') break;

    if (key === 'r') {
      console.log(copyToClipboard(draft.text) ? '已重新复制文案。' : '复制失败，请手动复制。');
      continue;
    }
    if (key === 'o') {
      const ok = await session.openDm().catch(() => false);
      console.log(ok ? '已再次尝试打开私信面板。' : '没找到「私信」按钮，请手动点击。');
      continue;
    }
    if (key === 'j') {
      const nx = await moveTo(cur.index + 1, 1);
      if (nx.abort) { aborted = true; break; }
      if (nx.index < 0) { console.log('已经是最后一条。'); continue; }
      cur = nx;
      continue;
    }
    if (key === 'k') {
      const nx = await moveTo(cur.index - 1, -1);
      if (nx.abort) { aborted = true; break; }
      if (nx.index < 0) { console.log('已经是第一条。'); continue; }
      cur = nx;
      continue;
    }
    if (key === 's') {
      markSkipped(lead.id, draft.opener.id, draft.text, '人工跳过');
      handled.add(cur.index);
      skippedCount++;
      const nx = await moveTo(cur.index + 1, 1);
      if (nx.abort) { aborted = true; break; }
      if (nx.index < 0) break;
      cur = nx;
      continue;
    }
    if (key === 'y' || key === '\r') {
      markSent(lead.id, draft.opener.id, draft.text);
      handled.add(cur.index);
      sentCount++;
      console.log(`已记录 #${lead.id}（今日累计 ${stats().sentToday}/${dailyCap}）`);
      if (total - handled.size > 0 && !noWait) {
        const [min, max] = Array.isArray(cfg.intervalMinutes) ? cfg.intervalMinutes : [3, 8];
        const minutes = randomInt(Number(min) * 60, Number(max) * 60) / 60;
        console.log(`歇 ${minutes.toFixed(1)} 分钟再继续，避免操作过频……`);
        await sleep(minutes * 60 * 1000);
      }
      const nx = await moveTo(cur.index + 1, 1);
      if (nx.abort) { aborted = true; break; }
      if (nx.index < 0) break;
      cur = nx;
      continue;
    }
    // 其他按键忽略，重新提示
  }

  session.close();
  console.log(`\n本次结束：发送 ${sentCount}，跳过 ${skippedCount}${aborted ? '，因风控提示中止' : ''}。`);
  if (aborted) console.log('建议今天不要再发，隔天再试。');
}

async function main() {
  if (args.login) {
    await runLogin();
    return;
  }
  if (live) {
    await runLive();
    return;
  }
  await runDry();
}

main()
  .catch((err) => {
    console.error(`\n出错了：${err.message}`);
    process.exitCode = 1;
  });
