#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { contentFiles, loadArticles, loadState, saveArticles, saveState } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function log(level, message) {
  console.log(`[${new Date().toISOString()}] ${level} ${message}`);
}

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith('-'));
const noBuild = args.includes('--no-build');

if (!slug) {
  console.error('用法：node takedown.mjs <slug> [--no-build]');
  process.exit(1);
}

const files = contentFiles();
const articles = loadArticles(files.articles);
const article = articles.find((item) => item.slug === slug);
if (!article) {
  log('ERROR', `找不到文章 ${slug}`);
  process.exit(1);
}

article.status = 'removed';
saveArticles(articles, files.articles);

const state = loadState(files.state);
state.runs = [...(state.runs || []), { at: new Date().toISOString(), removed: [slug] }].slice(-60);
saveState(state, files.state);
log('INFO', `已下架《${article.title}》/jiayouzhan/${slug}/`);

if (noBuild) process.exit(0);

const result = spawnSync(process.execPath, [path.join(__dirname, 'rebuild.mjs')], { stdio: 'inherit' });
process.exit(result.status === 0 ? 0 : 1);
