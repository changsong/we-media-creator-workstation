#!/usr/bin/env node
// 补全快手名单的粉丝数：顺序请求公开主页 HTML，读取 SSR 里的 ownerCount.fan。
// 只读公开资料；遇到验证/限流自动暂停并重试，连续失败就停。
//   node marketing/scripts/fill-kuaishou-followers.mjs
//   node marketing/scripts/fill-kuaishou-followers.mjs --limit 200
//   node marketing/scripts/fill-kuaishou-followers.mjs --min-delay 1500 --max-delay 3000

import {
  kuaishouFollowerStats,
  kuaishouLeadsWithoutFollowers,
  updateLeadFollowers,
} from './lib/store.mjs';
import { openSession } from './lib/browser.mjs';
import { parseArgs, randomInt, sleep } from './lib/util.mjs';

const RISK_PATTERNS = ['安全验证', '人机验证', '操作频繁', '请稍后再试', '访问异常', '账号存在异常', '访问过于频繁'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const args = parseArgs();
const limit = Math.max(0, Number(args.limit) || 0);
const minDelay = Math.max(400, Number(args['min-delay']) || 1200);
const maxDelay = Math.max(minDelay, Number(args['max-delay']) || 2200);
const cooldownMin = Math.max(0, Number(args.cooldown) || 15);
const maxRounds = Math.max(1, Math.min(Number(args['max-rounds']) || 8, 24));
const dryRun = args['dry-run'] === true;

function showHelp() {
  console.log(`补全快手粉丝数

前置：已用 collect-kuaishou.mjs --login 登录（读取 chrome-profile 的 Cookie）。

用法：
  node marketing/scripts/fill-kuaishou-followers.mjs [--limit N] [--cooldown 15] [--max-rounds 8] [--dry-run]

参数：
  --limit N        本次最多补多少条（默认全部待补）
  --min-delay N    每条之间最小间隔毫秒（默认 1200）
  --max-delay N    每条之间最大间隔毫秒（默认 2200）
  --cooldown N     遇到限流后等多少分钟再续（默认 15）
  --max-rounds N   最多自动续几轮（默认 8）
  --dry-run        只测试前 5 条，不写库
`);
}

async function readCookie() {
  const session = await openSession('https://www.kuaishou.com/');
  await session.cdp('Network.enable').catch(() => {});
  const result = await session.cdp('Network.getAllCookies');
  session.close();
  const cookies = (result && result.cookies) || [];
  if (!cookies.some((c) => c.name === 'userId' && /kuaishou\.com$/i.test(String(c.domain || '').replace(/^\./, '')))) {
    throw new Error('没有读到快手登录 Cookie，请先运行 collect-kuaishou.mjs --login');
  }
  return cookies
    .filter((c) => /kuaishou\.com$/i.test(String(c.domain || '').replace(/^\./, '')))
    .map((c) => c.name + '=' + c.value)
    .join('; ');
}

async function fetchFollowers(cookie, profileUrl) {
  try {
    const res = await fetch(profileUrl, {
      headers: { cookie, 'user-agent': UA, referer: 'https://www.kuaishou.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { followers: 0, kind: res.status === 403 || res.status === 412 ? 'risk' : 'error' };
    const html = await res.text();
    if (RISK_PATTERNS.some((token) => html.includes(token))) return { followers: 0, kind: 'risk' };
    const m = html.match(/"ownerCount":\{"fan":(\d+)/);
    if (m) return { followers: Number(m[1]) || 0, kind: 'ok' };
    // 200 但没有 SSR 数据：多半是软的限流/降级页，不是“粉丝为 0”。
    return { followers: 0, kind: 'throttled' };
  } catch (err) {
    return { followers: 0, kind: 'error' };
  }
}

async function main() {
  if (args.help || args.h) {
    showHelp();
    return;
  }

  const before = kuaishouFollowerStats();
  console.log(`快手名单共 ${before.total} 条，已知粉丝 ${before.known}，待补 ${before.unknown}`);
  if (!kuaishouLeadsWithoutFollowers(1).length) {
    console.log('没有待补的名单。');
    return;
  }

  const cookie = await readCookie();
  let updated = 0;
  let failed = 0;
  let throttled = 0;
  let cooldown = cooldownMin;

  for (let round = 1; round <= (dryRun ? 1 : maxRounds); round++) {
    const rows = kuaishouLeadsWithoutFollowers(dryRun ? 5 : limit);
    if (!rows.length) {
      console.log('待补名单已全部处理完。');
      break;
    }
    console.log(`\n第 ${round} 轮：待补 ${rows.length} 条${round > 1 ? '（冷却后继续）' : ''}`);

    let softStreak = 0;
    let riskStreak = 0;
    let gained = 0;
    let stopped = false;

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const result = await fetchFollowers(cookie, row.profile_url);

      if (result.kind === 'ok') {
        updated++;
        gained++;
        softStreak = 0;
        riskStreak = 0;
        if (!dryRun) updateLeadFollowers(row.profile_url, result.followers);
        console.log(`  [${index + 1}/${rows.length}] ${row.nickname || row.profile_url}：${result.followers} 粉`);
      } else if (result.kind === 'throttled') {
        throttled++;
        failed++;
        softStreak++;
        console.warn(`  [${index + 1}/${rows.length}] 页面无粉丝数据（疑似限流），连续 ${softStreak} 次`);
        if (softStreak >= 5) {
          console.warn('连续 5 次拿不到粉丝数据，判断为限流，本轮停止。');
          stopped = true;
          break;
        }
        await sleep(randomInt(30000, 45000));
        continue;
      } else {
        failed++;
        if (result.kind === 'risk') {
          riskStreak++;
          console.warn(`  [${index + 1}/${rows.length}] 触发验证/限流，暂停 60 秒（连续 ${riskStreak} 次）`);
          if (riskStreak >= 2) {
            console.warn('连续触发验证，本轮停止。');
            stopped = true;
            break;
          }
          await sleep(randomInt(55000, 75000));
        } else {
          console.warn(`  [${index + 1}/${rows.length}] 请求失败：${row.profile_url}`);
          await sleep(randomInt(2500, 5000));
        }
        continue;
      }

      await sleep(randomInt(minDelay, maxDelay));
    }

    console.log(`第 ${round} 轮结束：本轮补全 ${gained} 条`);
    if (!stopped || dryRun) break;
    const remaining = kuaishouFollowerStats().unknown;
    if (!remaining) break;
    if (round < maxRounds) {
      // 本轮补得太少说明冷却不够，逐步延长；补得多说明配额已恢复，回到基础冷却。
      cooldown = gained >= 20 ? cooldownMin : Math.min(cooldown * 2, 60);
      console.log(`等待 ${cooldown} 分钟冷却后继续（剩余 ${remaining} 条）……`);
      await sleep(cooldown * 60 * 1000);
    }
  }

  const after = kuaishouFollowerStats();
  console.log(`\n补全结束：本次成功 ${updated}，失败 ${failed}（其中疑似限流 ${throttled}）`);
  console.log(`当前快手名单 ${after.total} 条：已知粉丝 ${after.known}，仍未知 ${after.unknown}`);
  if (dryRun) console.log('（--dry-run 未写库）');
}

main().catch((err) => {
  console.error(`\n出错了：${err.message}`);
  process.exitCode = 1;
});
