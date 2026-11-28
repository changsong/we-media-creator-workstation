#!/usr/bin/env node
// 评论区目标采集：按关键词搜视频，抓公开评论，做意图打分后入库。
// 只读公开信息；不登录平台账号也能跑的渠道会尽量匿名跑，需要登录的会提示先 --login。
//   node marketing/scripts/collect-comments.mjs --platform douyin,bilibili --keyword "自媒体工具" --yes
//   node marketing/scripts/collect-comments.mjs --login --platform douyin,kuaishou,xiaohongshu

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_DIR,
  createPrompter,
  normalizePlatform,
  parseArgs,
  platformLabel,
  randomInt,
  sleep,
  todayKey,
} from './lib/util.mjs';
import { ageDays, isBlockedAuthor, loadCommentsConfig, scoreComment } from './lib/comment-intent.mjs';
import { isRelevantVideo } from './lib/comment-video-filter.mjs';
import {
  collectProgressSummary,
  commentStats,
  ensureCollectProgress,
  getCollectProgress,
  resetCollectProgress,
  setCollectProgress,
  upsertComment,
  upsertVideo,
} from './lib/comments-store.mjs';
import { getPlatform, PLATFORM_KEYS } from './lib/platforms/index.mjs';
import { openSession } from './lib/browser.mjs';

const HOME_URLS = {
  douyin: 'https://www.douyin.com/',
  kuaishou: 'https://www.kuaishou.com/',
  xiaohongshu: 'https://www.xiaohongshu.com/',
  bilibili: 'https://www.bilibili.com/',
  channels: 'https://channels.weixin.qq.com/',
};

const args = parseArgs();
const config = loadCommentsConfig();
const settings = config.settings || {};

function parsePlatforms(raw) {
  const text = String(raw || '').trim();
  if (!text || text === 'all') return [...PLATFORM_KEYS];
  return text
    .split(/[,，]/)
    .map((item) => normalizePlatform(item.trim()))
    .filter(Boolean);
}

const platformKeys = parsePlatforms(args.platform);
const keywords = String(args.keyword || args._.join(',') || '')
  .split(/[,，]/)
  .map((item) => item.trim())
  .filter(Boolean);
const searchKeywords = keywords.length ? keywords : (config.search && config.search.keywords) || [];
const videosPerKeyword = Math.max(1, Math.min(Number(args.videos) || Number(settings.videosPerKeyword) || 100, 100));
const maxCommentsPerVideo = Math.max(1, Number(settings.maxCommentsPerVideo) || 1000);
const rawComments = args.comments !== undefined ? args.comments : settings.commentsPerVideo;
const allComments = args['all-comments'] === true
  || String(rawComments).toLowerCase() === 'all'
  || Number(rawComments) === 0;
const commentsPerVideo = allComments ? 0 : Math.max(1, Math.min(Number(rawComments) || 30, maxCommentsPerVideo));
const minScore = Math.max(0, Number(args['min-score']) || Number(settings.minScore) || 2);
const minLikes = Math.max(0, Number(args['min-likes']) || Number(settings.minLikes) || 0);
const maxCommentAgeDays = args['max-comment-age-days'] !== undefined
  ? Math.max(0, Number(args['max-comment-age-days']) || 0)
  : Math.max(0, Number(settings.maxCommentAgeDays) || 30);
const maxVideoAgeDays = args['max-video-age-days'] !== undefined
  ? Math.max(0, Number(args['max-video-age-days']) || 0)
  : Math.max(0, Number(settings.maxVideoAgeDays) || 60);
const hitsOnly = args['hits-only'] === true;
const autoYes = args.yes === true;
const dryRun = args['dry-run'] === true;
const debug = args.debug === true;
const noResume = args['no-resume'] === true;
const restart = args.restart === true;
const showProgress = args.progress === true;

if (args.help || args.h) {
  console.log(`评论区采集

用法：
  node marketing/scripts/collect-comments.mjs --login --platform douyin,kuaishou,xiaohongshu
  node marketing/scripts/collect-comments.mjs --platform douyin,bilibili --keyword "自媒体工具" --yes
  node marketing/scripts/collect-comments.mjs --platform all --yes

参数：
  --platform a,b      平台：douyin/kuaishou/xiaohongshu/bilibili/channels，all 表示全部（默认全部）
  --keyword a,b       搜索词（省略则用 outreach/comments.json 里的 search.keywords）
  --videos N          每个关键词最多看多少条视频（默认 100，上限 100）
  --comments N        每条视频最多抓多少条评论（默认 0=全部；0/all=全部，单视频上限 maxCommentsPerVideo）
  --all-comments      等同于 --comments 0，抓取全部评论
  --min-score N       意图分数门槛（默认 2）
  --min-likes N       评论最低点赞数（默认 0）
  --max-comment-age-days N  评论最大天数，0 表示不限（默认 30）
  --max-video-age-days N    视频最大天数，0 表示不限（默认 60）
  --hits-only         只入库命中意图的评论
  --dry-run           只统计，不写库
  --debug             采集结果为空时截图到 data/screenshots
  --yes               跳过登录确认（适合已登录后定时跑）
  --login             逐平台打开浏览器扫码登录
  --progress          只看采集进度，不跑采集
  --restart           清空所选平台/关键词的进度，从头开始
  --no-resume         忽略进度，已完成视频也重新抓
`);
  process.exit(0);
}

function waitForEnter(question = '按 Enter 继续：') {
  const prompter = createPrompter();
  return prompter.ask(question).finally(() => prompter.close());
}

function isRiskError(err) {
  return err && (err.code === 'RISK' || [-352, -412, -799].includes(Number(err.code)));
}

async function screenshotDebug(session, key, tag) {
  if (!session) return;
  const file = path.join(DATA_DIR, 'screenshots', `debug-${key}-${tag}-${todayKey()}.png`);
  await session.screenshot(file).catch(() => {});
  console.log(`  已截图：${file}`);
}

function printProgress() {
  const rows = collectProgressSummary();
  const platformFilter = args.platform && String(args.platform) !== 'all' ? new Set(platformKeys) : null;
  const keywordFilter = keywords.length ? new Set(searchKeywords) : null;
  const filtered = rows.filter((row) =>
    (!platformFilter || platformFilter.has(row.platform))
    && (!keywordFilter || keywordFilter.has(row.keyword))
  );
  if (!filtered.length) {
    console.log('还没有采集进度记录。先跑一次 collect-comments.mjs。');
    return;
  }
  console.log('采集进度：');
  for (const row of filtered) {
    console.log(`  ${platformLabel(row.platform)} / ${row.keyword}: ` +
      `完成 ${row.done || 0}，跳过 ${row.skipped || 0}，待跑 ${row.pending || 0}，` +
      `错误 ${row.error || 0}，评论 ${row.comments || 0}`);
  }
}

async function runLogin(keys) {
  for (const key of keys) {
    const adapter = getPlatform(key);
    if (!adapter) continue;
    if (adapter.meta.supportsManual) {
      console.log(`\n${adapter.meta.label}：${adapter.MANUAL_HINT}`);
      continue;
    }
    if (key === 'bilibili') {
      console.log('\nB站：采集评论使用主应用「连接设置 · B站」里的 SESSDATA；');
      console.log('半自动预填使用下面这个浏览器，建议也扫码登录一次。');
      const session = await openSession(HOME_URLS.bilibili);
      await waitForEnter('登录完成后按 Enter：');
      session.close();
      continue;
    }
    const session = await openSession(HOME_URLS[key] || 'about:blank');
    console.log(`\n浏览器已打开 ${adapter.meta.label}。请扫码登录，完成后回到终端按 Enter。`);
    await waitForEnter();
    session.close();
  }
}

function shouldSkipVideo(video) {
  if (!maxVideoAgeDays) return false;
  const days = ageDays(video.published_at);
  return days != null && days > maxVideoAgeDays;
}

function shouldSkipComment(comment, video) {
  if (!comment.text || comment.text.length < 3) return 'empty';
  if (video.author_id && comment.author_id && String(video.author_id) === String(comment.author_id)) {
    return 'video_author';
  }
  if (isBlockedAuthor(comment.author, config)) return 'blocked_author';
  if (maxCommentAgeDays) {
    const days = ageDays(comment.published_at);
    if (days != null && days > maxCommentAgeDays) return 'too_old';
  }
  if (minLikes && Number(comment.likes || 0) < minLikes) return 'low_likes';
  return '';
}

async function collectPlatform(key, stats) {
  const adapter = getPlatform(key);
  if (!adapter) return;
  if (adapter.meta.supportsManual) {
    console.log(`\n${adapter.meta.label}：${adapter.MANUAL_HINT}`);
    return;
  }

  let session = null;
  if (adapter.meta.needsBrowserForSearch || adapter.meta.needsBrowserForComments) {
    session = await openSession(HOME_URLS[key] || 'about:blank');
    if (!autoYes) {
      console.log(`\n浏览器已打开 ${adapter.meta.label}。确认已登录后按 Enter 开始，或 q 退出。`);
      const answer = await waitForEnter('Enter 开始 / q 退出 > ');
      if (String(answer || '').trim().toLowerCase() === 'q') {
        session.close();
        return;
      }
    }
  }

  let consecutiveBrowserFailures = 0;
  const canUseBrowser = !!(adapter.meta.needsBrowserForSearch || adapter.meta.needsBrowserForComments);
  const reopenSession = async () => {
    if (!canUseBrowser) return;
    if (session) {
      try { session.close(); } catch (err) { /* ignore */ }
      session = null;
    }
    session = await openSession(HOME_URLS[key] || 'about:blank');
    await session.eval('1');
  };

  let emptySearchStreak = 0;
  try {
    for (let k = 0; k < searchKeywords.length; k += 1) {
      const keyword = searchKeywords[k];
      console.log(`\n[${adapter.meta.label}] 搜索「${keyword}」`);
      let videos = [];
      try {
        videos = await adapter.searchVideos({ session, keyword, limit: videosPerKeyword, config });
      } catch (err) {
        console.error(`  搜索失败：${err.message}`);
        if (isRiskError(err)) {
          if (session) await screenshotDebug(session, key, 'risk');
          break;
        }
        if (session && /DevTools|WebSocket/i.test(err.message)) {
          try {
            console.error('  浏览器会话异常，尝试重开……');
            await reopenSession();
          } catch (reopenErr) {
            console.error(`  重开浏览器失败：${reopenErr.message}`);
            break;
          }
        }
        continue;
      }
      if (!videos.length) {
        emptySearchStreak += 1;
        console.log('  没有搜到视频。');
        if (debug && session) await screenshotDebug(session, key, `empty-${k}`);
        if (emptySearchStreak >= 2) {
          console.error('  连续 2 个关键词没有搜索结果，搜索页可能被限流；停止该平台，稍后重跑会从进度继续。');
          break;
        }
        continue;
      }
      emptySearchStreak = 0;
      const rawVideoCount = videos.length;
      videos = videos.filter((video) => isRelevantVideo(video, keyword, config));
      if (rawVideoCount && !videos.length) {
        console.log(`  搜索结果 ${rawVideoCount} 个，标题相关性过滤后 0 个，跳过。`);
        continue;
      }
      stats.videos += videos.length;
      if (!dryRun) {
        for (const video of videos) ensureCollectProgress(key, keyword, video.video_id);
      }

      let videoIndex = 0;
      for (const video of videos) {
        videoIndex += 1;
        const progress = dryRun ? null : getCollectProgress(key, keyword, video.video_id);
        const sameCommentLimit = progress && Number(progress.comment_limit) === commentsPerVideo;
        if (!dryRun && !noResume && progress && (progress.status === 'done' || progress.status === 'skipped') && sameCommentLimit) {
          console.log(`  跳过 ${videoIndex}/${videos.length}（已完成）：${String(video.title || video.video_id).slice(0, 40)}`);
          stats.resumed += 1;
          continue;
        }
        if (!dryRun && progress && progress.comment_limit >= 0 && !sameCommentLimit) {
          console.log(`  重抓 ${videoIndex}/${videos.length}（评论上限 ${progress.comment_limit} → ${commentsPerVideo}）：${String(video.title || video.video_id).slice(0, 40)}`);
        }
        if (shouldSkipVideo(video)) {
          if (!dryRun) setCollectProgress(key, keyword, video.video_id, 'skipped', { error: '视频过旧', commentLimit: commentsPerVideo });
          console.log(`  跳过 ${videoIndex}/${videos.length}（视频过旧）：${String(video.title || video.video_id).slice(0, 40)}`);
          continue;
        }
        console.log(`  视频 ${videoIndex}/${videos.length}：${String(video.title || video.video_id).slice(0, 50)}`);
        if (!dryRun) setCollectProgress(key, keyword, video.video_id, 'in_progress', { commentLimit: commentsPerVideo });
        let comments = [];
        try {
          comments = await adapter.collectComments({ session, video, limit: commentsPerVideo, config });
          consecutiveBrowserFailures = 0;
        } catch (err) {
          console.error(`    抓评论失败：${err.message}`);
          if (!dryRun) setCollectProgress(key, keyword, video.video_id, 'error', { error: err.message, commentLimit: commentsPerVideo });
          if (isRiskError(err)) {
            if (session) await screenshotDebug(session, key, 'risk-comments');
            throw err;
          }
          if (session && /DevTools|WebSocket|Target closed|Session closed/i.test(err.message)) {
            consecutiveBrowserFailures += 1;
            console.error(`    浏览器会话异常（连续 ${consecutiveBrowserFailures} 次），尝试重开……`);
            if (consecutiveBrowserFailures >= 3) {
              throw new Error('连续 3 次浏览器会话异常，已停止该平台；下次重跑会从错误进度继续。');
            }
            try {
              await reopenSession();
            } catch (reopenErr) {
              throw new Error(`浏览器会话无法恢复：${reopenErr.message}`);
            }
          } else {
            consecutiveBrowserFailures = 0;
          }
          continue;
        }
        if (!dryRun) setCollectProgress(key, keyword, video.video_id, 'done', { comments: comments.length, commentLimit: commentsPerVideo });
        stats.comments += comments.length;
        if (!comments.length) {
          if (debug && session) await screenshotDebug(session, key, 'empty-comments');
          continue;
        }

        const videoRowId = dryRun ? 0 : upsertVideo(video);
        for (const comment of comments) {
          const skip = shouldSkipComment(comment, video);
          if (skip) {
            stats.skipped += 1;
            continue;
          }
          const intent = scoreComment(comment.text, config);
          const status = intent.eligible ? 'new' : 'ignored';
          if (intent.eligible) stats.hits += 1;
          if (status === 'ignored') stats.ignored += 1;
          if (hitsOnly && status === 'ignored') continue;
          if (!dryRun) {
            upsertComment(videoRowId, comment, { intent: intent.intent, score: intent.score, status });
            stats.inserted += 1;
          }
        }
        const videoWait = key === 'bilibili' ? randomInt(8000, 15000) : randomInt(2200, 4200);
        await sleep(videoWait);
      }

      if (k < searchKeywords.length - 1) {
        const wait = key === 'bilibili' ? randomInt(20000, 30000) : randomInt(9000, 16000);
        console.log(`  等待 ${Math.round(wait / 1000)} 秒后换下一个关键词……`);
        await sleep(wait);
      }
    }
  } catch (err) {
    if (isRiskError(err)) {
      console.error(`\n${adapter.meta.label} 触发风控，停止该平台。建议隔几小时再跑。`);
    } else {
      console.error(`\n${adapter.meta.label} 采集中断：${err.message}`);
    }
  } finally {
    if (session) session.close();
  }
}

async function main() {
  if (args.login) {
    await runLogin(platformKeys);
    return;
  }
  if (restart) {
    let cleared = 0;
    for (const key of platformKeys) {
      for (const keyword of searchKeywords) {
        cleared += resetCollectProgress({ platform: key, keyword });
      }
    }
    console.log(`已清空 ${cleared} 条采集进度记录。`);
  }
  if (showProgress) {
    printProgress();
    return;
  }
  if (!searchKeywords.length) {
    console.error('没有搜索关键词，请用 --keyword 指定，或检查 outreach/comments.json。');
    process.exitCode = 1;
    return;
  }

  const beforeTotal = commentStats().total;
  const stats = { videos: 0, comments: 0, hits: 0, inserted: 0, ignored: 0, skipped: 0, resumed: 0 };
  console.log(`平台：${platformKeys.map((key) => platformLabel(key)).join('、')}`);
  console.log(`关键词：${searchKeywords.join('、')}`);
  const commentLabel = commentsPerVideo === 0 ? `全部（单视频上限 ${maxCommentsPerVideo}）` : commentsPerVideo;
  console.log(`每个词视频数：${videosPerKeyword}，每条视频评论数：${commentLabel}${dryRun ? '（dry-run，不写库）' : ''}`);
  if (commentsPerVideo === 0) {
    console.log('注意：抓取全部评论会显著增加耗时，建议一次只跑 1 个关键词。');
  }
  if (videosPerKeyword > 20) {
    console.log(`注意：每个关键词最多打开 ${videosPerKeyword} 个视频详情页，耗时较长；建议一次只跑 1–2 个关键词，遇到验证码会自动停止。`);
  }

  for (const key of platformKeys) {
    await collectPlatform(key, stats);
  }

  const s = commentStats();
  console.log('\n本次采集完成');
  console.log(`视频 ${stats.videos}，评论 ${stats.comments}，命中 ${stats.hits}，处理 ${stats.inserted}，新增 ${s.total - beforeTotal}，忽略 ${stats.ignored}，跳过 ${stats.skipped}，跳过已完成 ${stats.resumed}`);
  console.log(`库内评论总数 ${s.total}，今日已回复 ${s.sentToday}`);

  const platformSet = new Set(platformKeys);
  const keywordSet = keywords.length ? new Set(searchKeywords) : null;
  const progressRows = collectProgressSummary().filter((row) =>
    platformSet.has(row.platform) && (!keywordSet || keywordSet.has(row.keyword))
  );
  if (progressRows.length) {
    console.log('\n采集进度：');
    for (const row of progressRows) {
      console.log(`  ${platformLabel(row.platform)} / ${row.keyword}: ` +
        `完成 ${row.done || 0}，跳过 ${row.skipped || 0}，待跑 ${row.pending || 0}，` +
        `错误 ${row.error || 0}，评论 ${row.comments || 0}`);
    }
  }
  console.log('\n下次继续：直接重跑同一条命令即可，已完成的视频会自动跳过。');
  console.log(`查看进度：node marketing/scripts/collect-comments.mjs --progress --platform ${platformKeys.join(',')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n出错了：${err.message}`);
    process.exitCode = 1;
  });
}
