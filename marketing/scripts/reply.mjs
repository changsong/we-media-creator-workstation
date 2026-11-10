#!/usr/bin/env node
// 回复建议：把对方发来的私信粘进来，按关键词匹配知识库生成回复；
// 加 --ai 且有 ANTHROPIC_API_KEY 时调用 Claude 生成，失败自动回退模板。
//   node marketing/scripts/reply.mjs --text "这个多少钱？"
//   node marketing/scripts/reply.mjs --ai --log 12 --text "会封号吗？"

import {
  copyToClipboard,
  createPrompter,
  loadTemplates,
  parseArgs,
  render,
} from './lib/util.mjs';
import { markReplied } from './lib/store.mjs';

const args = parseArgs();
const bank = loadTemplates();
const cfg = bank.settings;
const prompter = createPrompter();

const PRIORITY = ['not_interested', 'price', 'trial', 'security', 'features', 'how', 'compare', 'thanks'];

function classify(message) {
  const text = String(message).toLowerCase();
  const scored = bank.replies.map((reply, index) => {
    const hits = reply.keywords.filter((word) => text.includes(String(word).toLowerCase())).length;
    return { reply, index, hits };
  });
  scored.sort((a, b) => {
    const pa = PRIORITY.indexOf(a.reply.intent);
    const pb = PRIORITY.indexOf(b.reply.intent);
    if (a.hits !== b.hits) return b.hits - a.hits;
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb) || a.index - b.index;
  });
  const best = scored.find((item) => item.hits > 0);
  return best ? best.reply : bank.fallback;
}

function fill(text) {
  return render(text, {
    trial_url: cfg.trialUrl,
    site_url: cfg.siteUrl,
    trial_days: cfg.trialDays,
    product_name: cfg.productName,
  });
}

async function aiReply(message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('未设置 ANTHROPIC_API_KEY，改用模板');
  const system = [
    `你在帮「${cfg.productName}」回复抖音私信。产品是桌面端自媒体多平台发布工具，支持 8 个平台，数据本地存储，提供 ${cfg.trialDays} 天免费试用。`,
    '要求：中文，2 到 3 句，口语化，不群发感；只回答对方问题；不要承诺“不会被封”“100% 安全”“永久免费”；',
    `需要链接时用试用入口 ${cfg.trialUrl}，详细功能用 ${cfg.siteUrl}/features/。`,
  ].join('');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: `对方私信：${message}` }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : `API ${res.status}`);
  const text = (data.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim();
  if (!text) throw new Error('AI 返回为空');
  const banned = ['保证不封', '绝对不会封', '100% 安全', '100%安全', '永久免费'];
  if (banned.some((word) => text.includes(word))) throw new Error('AI 回复包含夸大承诺，改用模板');
  return text;
}

async function main() {
  let message = args.text ? String(args.text) : args._.join(' ').trim();
  if (!message) {
    message = (await prompter.ask('粘贴对方发来的私信，回车确认：')).trim();
  }
  if (!message) {
    console.log('没有输入内容。');
    return;
  }

  const matched = classify(message);
  let suggestion = fill(matched.text);
  let source = '模板';

  if (args.ai) {
    try {
      suggestion = await aiReply(message);
      source = 'Claude';
    } catch (err) {
      console.warn(`AI 生成失败（${err.message}），使用模板。`);
    }
  }

  console.log(`\n匹配意图：${matched.intent}（${source}）`);
  console.log('─'.repeat(60));
  console.log(suggestion);
  console.log('─'.repeat(60));

  if (args.copy) {
    console.log(copyToClipboard(suggestion) ? '已复制到剪贴板。' : '复制失败，请手动复制。');
  }
  if (args.log) {
    const leadId = Number(args.log);
    markReplied(leadId, message, matched.intent);
    console.log(`已记录到名单 #${leadId}，状态改为 replied。`);
  }
}

main()
  .catch((err) => {
    console.error(`\n出错了：${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prompter.close());
