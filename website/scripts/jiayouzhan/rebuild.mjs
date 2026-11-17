#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, '../..');
const liveDir = path.join(siteRoot, 'site');
const nextDir = path.join(siteRoot, 'site.next');
const oldDir = path.join(siteRoot, 'site.old');
const SITE_URL = process.env.SITE_URL || 'https://www.wemediacreator.com';

function log(level, message) {
  console.log(`[${new Date().toISOString()}] ${level} ${message}`);
}

function run(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: siteRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function cleanup() {
  fs.rmSync(nextDir, { recursive: true, force: true });
}

function main() {
  if (!fs.existsSync(path.join(siteRoot, 'build.mjs'))) {
    log('ERROR', `找不到 ${path.join(siteRoot, 'build.mjs')}，无法重建`);
    return 1;
  }
  if (!fs.existsSync(path.join(liveDir, 'assets', 'site.css'))) {
    log('ERROR', '线上 site/assets/site.css 不存在，无法复用样式');
    return 1;
  }

  cleanup();
  log('INFO', `构建到 ${nextDir}`);
  const build = run(['build.mjs'], {
    SITE_OUT: nextDir,
    SKIP_TAILWIND: '1',
    SITE_URL,
  });
  if (build.status !== 0) {
    cleanup();
    log('ERROR', '构建失败，线上保持原样');
    return 1;
  }

  log('INFO', 'SEO 自检');
  const check = run(['scripts/seo-check.mjs'], { SITE_DIR: nextDir, SITE_URL });
  if (check.status !== 0) {
    cleanup();
    log('ERROR', 'SEO 自检未通过，线上保持原样');
    return 1;
  }

  if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true });
  fs.renameSync(liveDir, oldDir);
  try {
    fs.renameSync(nextDir, liveDir);
  } catch (error) {
    fs.renameSync(oldDir, liveDir);
    cleanup();
    log('ERROR', `切换失败，已回滚：${error.message}`);
    return 1;
  }

  log('INFO', `完成：新站点已上线，旧版本保留在 ${oldDir}`);
  return 0;
}

process.exit(main());
