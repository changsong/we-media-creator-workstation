#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fetchAllFeeds } from './rss.mjs';
import { fetchBilibiliTopics } from './search.mjs';
import { SYSTEM_PROMPT, buildMockArticle, buildUserPrompt } from './prompt.mjs';
import { generateArticle, loadAiConfig } from './ai.mjs';
import { buildArticle, findBannedWords } from './validate.mjs';
import {
  contentFiles,
  loadArticles,
  loadState,
  pickCandidates,
  rememberUsed,
  saveArticles,
  saveState,
} from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'config.json');

let SEED = [];
try {
  ({ JIAYOUZHAN_SEED: SEED } = await import('../../src/data/jiayouzhan-seed.mjs'));
} catch {
  SEED = [];
}

function parseArgs(argv) {
  const args = { dryRun: false, fetchOnly: false, mock: false, noBuild: false, max: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--fetch-only') args.fetchOnly = true;
    else if (arg === '--mock') args.mock = true;
    else if (arg === '--no-build') args.noBuild = true;
    else if (arg === '--max') args.max = Number(argv[++i]) || 0;
    else if (arg.startsWith('--max=')) args.max = Number(arg.slice(6)) || 0;
  }
  return args;
}

function log(level, message) {
  console.log(`[${new Date().toISOString()}] ${level} ${message}`);
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function mockSlug(url) {
  let hash = 0;
  for (const char of String(url)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return `practice-${hash.toString(36)}`;
}

function rebuild() {
  const script = path.join(__dirname, 'rebuild.mjs');
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  return result.status === 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const files = contentFiles();
  const today = todayInShanghai();
  let articles = loadArticles(files.articles);
  if (!fs.existsSync(files.articles) && SEED.length) {
    articles = [...SEED];
    saveArticles(articles, files.articles);
    log('INFO', `初始化内容库，写入 ${articles.length} 篇起步文章`);
  }
  const state = loadState(files.state);

  log('INFO', `开始：${today}，已有 ${articles.length} 篇`);

  const [rss, bilibili] = await Promise.all([
    fetchAllFeeds(config.feeds, { userAgent: config.userAgent }),
    fetchBilibiliTopics(config.bilibiliQueries || [], { timeout: 15000 }),
  ]);
  for (const result of rss.results) {
    log(result.error ? 'WARN' : 'INFO', `${result.name}：${result.error || `${result.count} 条`}`);
  }
  for (const result of bilibili.results) {
    log(result.error ? 'WARN' : 'INFO', `B站搜索「${result.query}」：${result.error || `${result.count} 条`}`);
  }
  const items = [...rss.items, ...bilibili.items];
  if (!items.length) {
    log('WARN', '所有 RSS 源都没有可用条目，退出');
    return 0;
  }

  const max = args.max || config.maxPerDay || 2;
  const candidates = pickCandidates(items, { config, state, articles, today, max });
  if (!candidates.length) {
    log('INFO', '没有新的匹配选题，退出');
    return 0;
  }
  for (const candidate of candidates) {
    log('INFO', `候选 ${candidate.score} 分 · ${candidate.source} · ${candidate.date || '无日期'} · ${candidate.title}`);
  }
  if (args.fetchOnly) return 0;

  if (args.dryRun) {
    for (const candidate of candidates) {
      console.log(`\n----- ${candidate.title} -----`);
      console.log(buildUserPrompt(candidate, { today }));
    }
    return 0;
  }

  let aiConfig = null;
  if (!args.mock) {
    try {
      aiConfig = loadAiConfig();
    } catch (error) {
      log('ERROR', error.message);
      return 1;
    }
    if (!aiConfig) {
      log('WARN', `未配置 AI 接口（${path.resolve(__dirname, '../../.ai.json')}），本次跳过`);
      return 0;
    }
  }

  const existingSlugs = new Set(articles.map((article) => article.slug));
  const existingTitles = new Set(articles.map((article) => article.title));
  const created = [];
  for (const candidate of candidates) {
    try {
      const raw = args.mock
        ? { ...buildMockArticle(candidate, { today }), slugEn: mockSlug(candidate.url) }
        : await generateArticle({
            config: aiConfig,
            system: SYSTEM_PROMPT,
            user: buildUserPrompt(candidate, { today }),
          });
      const result = buildArticle(raw, candidate, { today, existingSlugs, existingTitles });
      if (!result.ok) {
        log('WARN', `丢弃「${candidate.title}」：${result.errors.join('；')}`);
        continue;
      }
      const banned = findBannedWords(result.article, config.bannedWords);
      if (banned.length) {
        log('WARN', `丢弃「${candidate.title}」：含禁用词 ${banned.join('、')}`);
        continue;
      }
      articles.push(result.article);
      existingSlugs.add(result.article.slug);
      existingTitles.add(result.article.title);
      saveArticles(articles, files.articles);
      const usedState = rememberUsed(state, [result.article]);
      Object.assign(state, usedState);
      saveState(state, files.state);
      created.push(result.article);
      log('INFO', `写入《${result.article.title}》/jiayouzhan/${result.article.slug}/（${result.bodyChars} 字）`);
    } catch (error) {
      log('ERROR', `生成「${candidate.title}」失败：${error.message}`);
    }
  }

  if (!created.length) {
    log('WARN', '本次没有产出新文章');
    return 0;
  }

  state.runs = [...(state.runs || []), { at: new Date().toISOString(), slugs: created.map((a) => a.slug) }].slice(-60);
  saveState(state, files.state);

  if (args.noBuild) {
    log('INFO', `已跳过构建（--no-build），共新增 ${created.length} 篇`);
    return 0;
  }
  log('INFO', '开始重建站点');
  if (!rebuild()) {
    log('ERROR', '站点重建失败，内容已保存，线上保持旧版本');
    return 1;
  }
  log('INFO', `完成：新增 ${created.length} 篇`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[${new Date().toISOString()}] FATAL ${error.stack || error.message}`);
    process.exit(1);
  });
