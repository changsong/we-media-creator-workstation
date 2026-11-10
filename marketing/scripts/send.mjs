#!/usr/bin/env node
// 抖音半自动私信：脚本负责排队、起草、复制到剪贴板、记录与限额；
// 每条消息由运营人员在浏览器里确认发送，避免全自动群发触发平台风控。
//   node marketing/scripts/send.mjs --login          首次登录（扫码）
//   node marketing/scripts/send.mjs                  预览今天的名单与文案（dry-run）
//   node marketing/scripts/send.mjs --live           正式逐条发送

import path from 'node:path';
import {
  DATA_DIR,
  copyToClipboard,
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
const DAILY_CAP_HARD_LIMIT = 30;

const args = parseArgs();
const bank = loadTemplates();
const cfg = bank.settings;
const prompter = createPrompter();

const live = args.live === true && args['dry-run'] !== true;
const limit = Math.max(1, Math.min(Number(args.limit) || 10, 20));
const dailyCap = Math.max(1, Math.min(Number(args.cap) || cfg.dailyCap || 20, DAILY_CAP_HARD_LIMIT));
const cooldownDays = Math.max(1, Number(args['cooldown-days']) || cfg.cooldownDays || 30);
const minFollowers = Math.max(0, Number(args['min-followers']) || 0);
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
  const pending = queue({ limit, cooldownDays, minFollowers });
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
  await prompter.ask('按 Enter 关闭连接（浏览器窗口会保留）：');
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
    pending = queue({ limit: remaining, cooldownDays, minFollowers });
  }
  if (!pending.length) {
    console.log('可触达名单为空。先导入 CSV 或等待冷却期结束。');
    return;
  }

  console.log(`今日额度：剩余 ${dailyCap - sentToday} 条，本次处理 ${pending.length} 条。`);
  const session = await openSession('https://www.douyin.com/');
  console.log('\n若浏览器里还没有登录，请先扫码登录；完成后按 Enter 开始。');
  const start = (await prompter.ask('Enter 开始 / q 退出 > ')).trim().toLowerCase();
  if (start === 'q') {
    session.close();
    return;
  }

  let sent = 0;
  let skipped = 0;
  let aborted = false;

  for (let index = 0; index < pending.length; index++) {
    const lead = pending[index];

    if (!isDouyinProfile(lead.profile_url)) {
      console.log(`跳过 #${lead.id}：不是抖音用户主页链接 ${lead.profile_url}`);
      markSkipped(lead.id, '', '', '非抖音主页链接');
      skipped++;
      continue;
    }

    const draft = draftFor(lead);
    showDraft(lead, draft, index + 1, pending.length);

    try {
      await session.navigate(lead.profile_url);
      const pageText = await session.text();
      if (GONE_PATTERNS.some((token) => pageText.includes(token))) {
        console.log('主页不可用，已跳过。');
        markSkipped(lead.id, draft.opener.id, draft.text, '主页不可用');
        skipped++;
        continue;
      }
      if (RISK_PATTERNS.some((token) => pageText.includes(token))) {
        const shot = path.join(DATA_DIR, 'screenshots', `${todayKey()}-${lead.id}.png`);
        await session.screenshot(shot).catch(() => {});
        console.error(`\n检测到平台验证/限流提示，立即停止。截图：${shot}`);
        aborted = true;
        break;
      }
    } catch (err) {
      console.error(`打开主页失败：${err.message}`);
      console.error('请确认浏览器窗口还在，然后重新运行。');
      aborted = true;
      break;
    }

    const copied = copyToClipboard(draft.text);
    console.log(copied ? '文案已复制到剪贴板，去浏览器里点击「私信」并粘贴发送。' : '自动复制失败，请手动复制上面的文案。');
    const answer = (await prompter.ask('发送后按 Enter 记录；s 跳过；q 退出 > ')).trim().toLowerCase();

    if (answer === 'q') {
      session.close();
      break;
    }
    if (answer === 's') {
      markSkipped(lead.id, draft.opener.id, draft.text, '人工跳过');
      skipped++;
      continue;
    }

    markSent(lead.id, draft.opener.id, draft.text);
    sent++;
    console.log(`已记录 #${lead.id}（今日累计 ${stats().sentToday}/${dailyCap}）`);

    if (index < pending.length - 1 && !noWait) {
      const [min, max] = Array.isArray(cfg.intervalMinutes) ? cfg.intervalMinutes : [3, 8];
      const minutes = randomInt(Number(min) * 60, Number(max) * 60) / 60;
      console.log(`歇 ${minutes.toFixed(1)} 分钟再继续，避免操作过频……`);
      await sleep(minutes * 60 * 1000);
    }
  }

  session.close();
  console.log(`\n本次结束：发送 ${sent}，跳过 ${skipped}${aborted ? '，因风控提示中止' : ''}。`);
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
  })
  .finally(() => prompter.close());
