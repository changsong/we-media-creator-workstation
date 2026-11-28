#!/usr/bin/env node
// 评论区雷达：查看候选评论、用 DeepSeek 生成回复、半自动打开回复框并预填、记录状态。
//   node marketing/scripts/comments.mjs list
//   node marketing/scripts/comments.mjs draft --limit 5
//   node marketing/scripts/comments.mjs open --id 12
//   node marketing/scripts/comments.mjs sent --id 12
//   node marketing/scripts/comments.mjs run --limit 5

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyToClipboard,
  createKeyReader,
  normalizePlatform,
  parseArgs,
  platformLabel,
  randomInt,
  sleep,
  todayKey,
} from './lib/util.mjs';
import {
  commentStats,
  commentsForRescore,
  getComment,
  lastUserTouch,
  listComments,
  markCommentSent,
  markCommentSkipped,
  queueComments,
  recentDrafts,
  saveDraft,
  setCommentStatus,
  todaySentCount,
  updateCommentScore,
  upsertComment,
  upsertVideo,
  videoSentCount,
} from './lib/comments-store.mjs';
import { loadCommentsConfig, scoreComment } from './lib/comment-intent.mjs';
import { generateReply } from './lib/comment-ai.mjs';
import { getPlatform } from './lib/platforms/index.mjs';
import { openSession } from './lib/browser.mjs';

const args = parseArgs();
const config = loadCommentsConfig();
const settings = config.settings || {};
const command = args._[0] || 'help';
const keyReader = createKeyReader();

function printComment(comment) {
  console.log(`\n#${comment.id} [${platformLabel(comment.platform)}] ` +
    `意图 ${comment.intent || '未知'} · 分数 ${comment.score} · 赞 ${comment.likes}`);
  console.log(`视频：${comment.video_title || comment.video_url || ''}`);
  console.log(`作者：${comment.author || '匿名'}`);
  console.log(`评论：${comment.text}`);
  if (comment.thread_text) console.log(`上下文：${comment.thread_text}`);
  if (comment.draft) {
    console.log('─'.repeat(60));
    console.log(comment.draft);
    console.log('─'.repeat(60));
  }
}

async function draftOne(comment, { regenerate = false, quiet = false } = {}) {
  if (comment.draft && !regenerate) return comment;
  const scored = scoreComment(comment.text, config);
  const intent = scored.intent
    ? scored
    : { intent: comment.intent || '', intentLabel: '' };
  const result = await generateReply({
    video: { title: comment.video_title, description: comment.video_description },
    comment,
    intent,
    config,
    recentDrafts: recentDrafts(30),
  });
  saveDraft(comment.id, result.text, result.model);
  if (!quiet) {
    console.log(`\nAI：${result.source}${result.warning ? `（${result.warning}）` : ''}`);
    console.log(result.text);
  }
  return { ...comment, draft: result.text, draft_model: result.model };
}

async function openOne(comment, draft) {
  const adapter = getPlatform(comment.platform);
  if (!adapter) throw new Error(`未知平台 ${comment.platform}`);
  if (comment.platform === 'channels' || adapter.meta.supportsManual) {
    const copied = copyToClipboard(draft);
    console.log('视频号没有网页评论区：文案已复制，请到微信视频号里手动回复。');
    return { manual: true, copied, prefilled: false };
  }
  if (!comment.video_url) throw new Error('这条评论没有视频链接，无法打开原视频');
  const session = await openSession(comment.video_url);
  try {
    const result = await adapter.focusComment({ session, comment, draft });
    if (result.prefilled) {
      console.log('已定位到评论并填入回复框，请在浏览器里检查后亲手点发送。');
    } else if (result.opened) {
      copyToClipboard(draft);
      console.log(`${result.reason || '自动填入失败'}；文案已复制，请手动粘贴。`);
    } else {
      copyToClipboard(draft);
      console.log(`${result.reason || '没能自动定位评论'}；文案已复制，请打开原视频手动回复。`);
    }
    return result;
  } finally {
    session.close();
  }
}

async function cmdList() {
  const items = listComments({
    platform: normalizePlatform(args.platform) || '',
    status: String(args.status || ''),
    intent: String(args.intent || ''),
    search: String(args.q || ''),
    limit: Number(args.limit) || 30,
    includeIgnored: args['include-ignored'] === true,
  });
  if (!items.length) {
    console.log('没有符合条件的评论。先跑 collect-comments.mjs，或用 add 手动添加。');
    return;
  }
  for (const item of items) printComment(item);
  console.log(`\n共 ${items.length} 条。`);
}

async function cmdDraft() {
  if (args.id) {
    const comment = getComment(Number(args.id));
    if (!comment) throw new Error(`找不到评论 #${args.id}`);
    const result = await draftOne(comment, { regenerate: args.regenerate === true });
    printComment(result);
    return;
  }
  const items = listComments({
    platform: normalizePlatform(args.platform) || '',
    status: String(args.status || 'new'),
    intent: String(args.intent || ''),
    limit: Number(args.limit) || 5,
  });
  if (!items.length) {
    console.log('没有待起草的评论。');
    return;
  }
  for (let i = 0; i < items.length; i += 1) {
    const comment = items[i];
    console.log(`\n[${i + 1}/${items.length}]`);
    const result = await draftOne(comment, { regenerate: args.regenerate === true });
    printComment(result);
    if (i < items.length - 1) await sleep(randomInt(800, 1600));
  }
}

async function cmdOpen() {
  if (!args.id) throw new Error('用法：comments.mjs open --id 12');
  let comment = getComment(Number(args.id));
  if (!comment) throw new Error(`找不到评论 #${args.id}`);
  comment = await draftOne(comment);
  await openOne(comment, comment.draft);
}

async function cmdSent() {
  if (!args.id) throw new Error('用法：comments.mjs sent --id 12');
  const comment = getComment(Number(args.id));
  if (!comment) throw new Error(`找不到评论 #${args.id}`);
  const draft = String(args.draft || comment.draft || '');
  if (!draft) throw new Error('这条评论还没有草稿，先运行 draft --id ' + args.id);
  markCommentSent(comment.id, draft);
  console.log(`已记录 #${comment.id} 为 sent。今日已回复 ${todaySentCount()} 条。`);
}

async function cmdSkip() {
  if (!args.id) throw new Error('用法：comments.mjs skip --id 12');
  const ok = markCommentSkipped(Number(args.id), String(args.reason || '人工跳过'));
  console.log(ok ? `已跳过 #${args.id}。` : `找不到评论 #${args.id}。`);
}

async function cmdBlock() {
  if (!args.id) throw new Error('用法：comments.mjs block --id 12');
  const ok = setCommentStatus(Number(args.id), 'blocked');
  console.log(ok ? `已拉黑 #${args.id}，后续不会再出现在队列。` : `找不到评论 #${args.id}。`);
}

async function cmdRestore() {
  if (!args.id) throw new Error('用法：comments.mjs restore --id 12');
  const comment = getComment(Number(args.id));
  if (!comment) throw new Error(`找不到评论 #${args.id}`);
  setCommentStatus(comment.id, 'new');
  console.log(`已恢复 #${comment.id} 到 new；原有草稿${comment.draft ? '保留' : '为空'}。`);
}

function printStats() {
  const s = commentStats();
  console.log(`评论总数 ${s.total}，视频 ${s.videos}，今日已回复 ${s.sentToday}，累计回复 ${s.sentTotal}`);
  if (s.byStatus.length) {
    console.log('\n状态：');
    for (const row of s.byStatus) console.log(`  ${row.status}: ${row.count}`);
  }
  if (s.byPlatform.length) {
    console.log('\n平台：');
    for (const row of s.byPlatform) {
      console.log(`  ${platformLabel(row.platform)}: 总 ${row.total} / 待处理 ${row.pending || 0} / 已起草 ${row.drafted || 0} / 已回复 ${row.sent || 0}`);
    }
  }
  if (s.byIntent.length) {
    console.log('\n意图：');
    for (const row of s.byIntent) console.log(`  ${row.intent}: ${row.count}`);
  }
}

async function cmdRescore() {
  const rows = commentsForRescore();
  let hits = 0;
  let changed = 0;
  for (const row of rows) {
    const scored = scoreComment(row.text, config);
    const status = scored.eligible ? 'new' : 'ignored';
    if (scored.eligible) hits += 1;
    if (updateCommentScore(row.id, scored.intent, scored.score, status)) changed += 1;
  }
  console.log(`重新打分 ${rows.length} 条，命中 ${hits} 条，更新 ${changed} 条。`);
}

function deriveVideoId(platform, videoUrl, text) {
  const url = String(videoUrl || '').trim();
  const match = url.match(/\/([A-Za-z0-9_-]{6,})(?:[/?#]|$)/);
  if (match) return match[1];
  return 'manual_' + crypto.createHash('sha1')
    .update(`${platform}|${url}|${text}`)
    .digest('hex').slice(0, 16);
}

async function cmdAdd() {
  const platform = normalizePlatform(args.platform) || 'channels';
  const text = String(args.text || args._.slice(1).join(' ') || '').trim();
  if (!text) {
    throw new Error('用法：comments.mjs add --platform channels --video-url "..." --text "评论内容"');
  }
  const videoUrl = String(args['video-url'] || '').trim();
  const videoId = String(args['video-id'] || '').trim() || deriveVideoId(platform, videoUrl, text);
  const title = String(args.title || '').trim();
  const author = String(args.author || '').trim();
  const publishedAt = String(args['published-at'] || '').trim();
  const videoRowId = upsertVideo({
    platform,
    video_id: videoId,
    video_url: videoUrl,
    title,
    description: String(args.description || ''),
    author,
    author_url: String(args['author-url'] || ''),
    published_at: publishedAt,
  });
  const scored = scoreComment(text, config);
  const commentId = upsertComment(videoRowId, {
    platform,
    comment_id: String(args['comment-id'] || ''),
    author,
    author_url: String(args['author-url'] || ''),
    text,
    likes: Number(args.likes) || 0,
    published_at: publishedAt,
  }, { intent: scored.intent, score: scored.score, status: 'new' });
  console.log(`已添加评论 #${commentId}（${platformLabel(platform)}，意图 ${scored.intent || '未识别'}，分数 ${scored.score}）。`);
  if (args.draft) {
    const comment = getComment(commentId);
    const result = await draftOne(comment, { regenerate: true });
    printComment(result);
  }
}

function blockReason(comment) {
  const exclude = (settings.replyExcludePlatforms || [])
    .map((item) => normalizePlatform(item))
    .filter(Boolean);
  if (exclude.includes(comment.platform)) return `${platformLabel(comment.platform)} 在排除列表`;
  const perPlatform = Number(settings.perPlatformDailyCap) || 5;
  if (todaySentCount(comment.platform) >= perPlatform) {
    return `${platformLabel(comment.platform)} 今日已达上限 ${perPlatform}`;
  }
  const perVideo = Number(settings.perVideoCap) || 1;
  if (videoSentCount(comment.video_id) >= perVideo) return '该视频已经回复过';
  const cooldownDays = Number(settings.perUserCooldownDays) || 30;
  if (comment.author_id) {
    const last = lastUserTouch(comment.platform, comment.author_id);
    if (last && Date.now() - Date.parse(last) < cooldownDays * 24 * 60 * 60 * 1000) {
      return '该用户还在冷却期';
    }
  }
  return '';
}

async function cmdRun() {
  const limit = Math.max(1, Math.min(Number(args.limit) || 5, 30));
  const exclude = (settings.replyExcludePlatforms || [])
    .map((item) => normalizePlatform(item))
    .filter(Boolean);
  const items = queueComments({
    limit: limit * 2,
    platform: normalizePlatform(args.platform) || '',
    excludePlatforms: exclude,
    minScore: Number(args['min-score']) || Number(settings.minScore) || 0,
  });
  if (!items.length) {
    console.log('队列为空。先跑 collect-comments.mjs，或 comments.mjs add 手动添加。');
    return;
  }

  let index = 0;
  let handled = 0;
  let sent = 0;
  while (index < items.length && handled < limit) {
    const comment = items[index];
    if (todaySentCount() >= Number(settings.dailyCap || 15)) {
      console.log(`今日总上限 ${settings.dailyCap || 15} 条已到，明天再跑。`);
      break;
    }
    const blocked = blockReason(comment);
    if (blocked) {
      console.log(`跳过 #${comment.id}：${blocked}`);
      index += 1;
      continue;
    }

    let current = comment;
    if (!current.draft) current = await draftOne(current, { quiet: true });
    console.log(`\n[${handled + 1}/${limit}]`);
    printComment(current);

    const opened = await openOne(current, current.draft).catch((err) => {
      console.log(`打开失败：${err.message}`);
      copyToClipboard(current.draft);
      console.log('文案已复制，请手动去原视频回复。');
      return { prefilled: false, opened: false };
    });
    if (opened && opened.manual) console.log('视频号：复制文案后到微信里手动回复。');

    const key = await keyReader.key(
      '\n[y/Enter]已回复  [s]跳过  [j]下一条  [k]上一条  [r]重贴  [o]重开  [q]退出 > '
    );
    if (key === 'q' || key === '\u0003') break;
    if (key === 'r') {
      console.log(copyToClipboard(current.draft) ? '已重新复制文案。' : '复制失败，请手动复制。');
      continue;
    }
    if (key === 'o') {
      await openOne(current, current.draft).catch((err) => console.log(`打开失败：${err.message}`));
      continue;
    }
    if (key === 'j') {
      index += 1;
      continue;
    }
    if (key === 'k') {
      index = Math.max(0, index - 1);
      continue;
    }
    if (key === 's') {
      markCommentSkipped(current.id, '人工跳过');
      index += 1;
      handled += 1;
      continue;
    }
    if (key === 'y' || key === '\r') {
      markCommentSent(current.id, current.draft);
      sent += 1;
      handled += 1;
      index += 1;
      console.log(`已记录 #${current.id}，今日累计 ${todaySentCount()}/${settings.dailyCap || 15}。`);
      if (args['no-wait'] !== true && handled < limit) {
        const [min, max] = Array.isArray(settings.minIntervalMinutes) ? settings.minIntervalMinutes : [3, 8];
        const minutes = randomInt(Number(min) * 60, Number(max) * 60) / 60;
        console.log(`歇 ${minutes.toFixed(1)} 分钟再继续……`);
        await sleep(minutes * 60 * 1000);
      }
    }
  }
  console.log(`\n本次结束：回复 ${sent} 条。`);
}

function showHelp() {
  console.log(`评论区雷达

用法：
  node marketing/scripts/comments.mjs list [--platform douyin] [--status new] [--q 关键词]
  node marketing/scripts/comments.mjs draft [--id 12] [--limit 5] [--regenerate]
  node marketing/scripts/comments.mjs open --id 12
  node marketing/scripts/comments.mjs sent --id 12
  node marketing/scripts/comments.mjs skip --id 12
  node marketing/scripts/comments.mjs block --id 12
  node marketing/scripts/comments.mjs restore --id 12
  node marketing/scripts/comments.mjs stats
  node marketing/scripts/comments.mjs rescore
  node marketing/scripts/comments.mjs add --platform channels --video-url "..." --text "评论内容" [--draft]
  node marketing/scripts/comments.mjs run [--platform douyin] [--limit 5]

说明：
  - 默认生成 3 个 AI 候选并自选最佳；没有 DeepSeek key 或校验不通过时回退模板。
  - open / run 只负责定位评论、打开回复框、预填文案；发送动作始终由人完成。
  - 视频号没有网页评论区，用 add 手动导入，复制文案到微信里回复。
`);
}

async function main() {
  switch (command) {
    case 'list':
      await cmdList();
      break;
    case 'draft':
      await cmdDraft();
      break;
    case 'open':
      await cmdOpen();
      break;
    case 'sent':
      await cmdSent();
      break;
    case 'skip':
      await cmdSkip();
      break;
    case 'block':
      await cmdBlock();
      break;
    case 'restore':
      await cmdRestore();
      break;
    case 'stats':
      printStats();
      break;
    case 'rescore':
      await cmdRescore();
      break;
    case 'add':
      await cmdAdd();
      break;
    case 'run':
      await cmdRun();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      showHelp();
      process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n出错了：${err.message}`);
    process.exitCode = 1;
  });
}
