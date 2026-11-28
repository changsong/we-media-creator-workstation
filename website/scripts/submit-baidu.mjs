#!/usr/bin/env node
// 百度普通收录推送：读取 website/site/sitemap.xml，只提交新页面或 lastmod 变化的页面。
// 令牌不入库：通过 BAIDU_SUBMIT_TOKEN 环境变量或 website/.baidu.json（已 gitignore）提供。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sitemapFile = path.join(root, 'site', 'sitemap.xml');
const stateFile = path.join(root, '.baidu-submitted.json');
const configFile = path.join(root, '.baidu.json');
const ENDPOINT = 'http://data.zz.baidu.com/urls';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
};

const dryRun = flag('dry-run');
const submitAll = flag('all');
const optional = flag('optional');
const limit = Math.max(0, Number(option('limit')) || 0);

function readConfig() {
  if (!fs.existsSync(configFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (error) {
    console.error(`submit-baidu: ${path.basename(configFile)} 无法解析：${error.message}`);
    process.exit(1);
  }
}

const config = readConfig();
const site = (option('site') || process.env.BAIDU_SITE || config.site || process.env.SITE_URL || 'https://www.wemediacreator.com')
  .replace(/\/+$/, '');
const token = option('token') || process.env.BAIDU_SUBMIT_TOKEN || config.token || '';

if (!token) {
  const message = 'submit-baidu: 未配置百度推送令牌。请设置环境变量 BAIDU_SUBMIT_TOKEN，或创建 website/.baidu.json（{"site":"https://www.wemediacreator.com","token":"..."}）。token 须与站点验证时使用的百度账号/站点一致。';
  if (optional) {
    console.log(`submit-baidu: 跳过（未配置令牌）。设置 BAIDU_SUBMIT_TOKEN 后自动提交。`);
    process.exit(0);
  }
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(sitemapFile)) {
  console.error('submit-baidu: website/site/sitemap.xml 不存在，请先运行 npm run site:build');
  process.exit(1);
}

function parseSitemap(xml) {
  const out = [];
  for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/);
    if (!loc) continue;
    const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    out.push({ url: loc[1].trim(), lastmod: lastmod ? lastmod[1].trim() : '' });
  }
  return out;
}

function loadState() {
  if (!fs.existsSync(stateFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function priorityOf(url) {
  const pathname = new URL(url).pathname;
  const en = pathname.startsWith('/en/') ? 1 : 0;
  let rank = 3;
  if (pathname === '/' || pathname === '/en/') rank = 0;
  else if (/^\/(en\/)?(download|pricing|features)\//.test(pathname)) rank = 1;
  else if (/^\/jiayouzhan\/[^/]+\//.test(pathname)) rank = 1;
  else if (/^\/(en\/)?(platforms|use-cases)\//.test(pathname)) rank = 2;
  return rank * 2 + en;
}

const siteHost = new URL(site).hostname.replace(/^www\./, '');
const entries = parseSitemap(fs.readFileSync(sitemapFile, 'utf8')).filter((entry) => {
  let host;
  try {
    host = new URL(entry.url).hostname;
  } catch {
    console.warn(`[WARN] 跳过非法 URL：${entry.url}`);
    return false;
  }
  if (host.replace(/^www\./, '') !== siteHost) {
    console.warn(`[WARN] 跳过非本站 URL（${host}）：${entry.url}`);
    return false;
  }
  return true;
});

const state = loadState();
const pending = submitAll
  ? entries
  : entries.filter((entry) => state[entry.url] !== entry.lastmod);
pending.sort((a, b) => priorityOf(a.url) - priorityOf(b.url));

const queued = limit ? pending.slice(0, limit) : pending;
console.log(`submit-baidu: site=${site} 总量 ${entries.length}，待提交 ${pending.length}${limit ? `，本次限 ${queued.length}` : ''}${submitAll ? '（--all 忽略历史状态）' : ''}`);

if (!queued.length) {
  console.log('submit-baidu: 没有需要提交的页面。');
  process.exit(0);
}

if (dryRun) {
  for (const entry of queued) console.log(`  ${entry.lastmod || '-'}  ${entry.url}`);
  console.log('submit-baidu: --dry-run，未实际提交。');
  process.exit(0);
}

const body = queued.map((entry) => entry.url).join('\n');
const url = `${ENDPOINT}?site=${site}&token=${encodeURIComponent(token)}`;

let response;
let text;
try {
  response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'curl/8.5.0' },
    body,
  });
  text = await response.text();
} catch (error) {
  console.error(`submit-baidu: 请求失败：${error.message}`);
  process.exit(1);
}

let result;
try {
  result = JSON.parse(text);
} catch {
  console.error(`submit-baidu: 响应无法解析（HTTP ${response.status}）：${text.slice(0, 300)}`);
  process.exit(1);
}

if (result.error) {
  console.error(`submit-baidu: 百度返回错误 ${result.error}${result.message ? `：${result.message}` : ''}`);
  if (/over quota/i.test(result.message || '')) {
    console.error(queued.length === 1
      ? 'submit-baidu: 今日配额已用完，明天再试（服务器 cron 会自动重试）。'
      : `submit-baidu: 本次 ${queued.length} 条超过今日剩余配额，请用 --limit N 分批提交（未成功的页面不会计入历史状态）。`);
  }
  if (result.message === 'not_same_site' || (result.not_same_site || []).length) {
    console.error(`submit-baidu: token 与站点不匹配。当前 site=${site}，请确认该 token 属于同一百度账号下已验证的 ${site} 站点。`);
  }
  process.exit(1);
}

const rejected = new Set([...(result.not_same_site || []), ...(result.not_valid || [])]);
const accepted = queued.filter((entry) => !rejected.has(entry.url));
const success = Number(result.success) || 0;
// 响应只给出成功条数，按提交顺序记前 success 条，避免把被拒绝的 URL 记成已提交
for (const entry of accepted.slice(0, success)) state[entry.url] = entry.lastmod;

if (!dryRun) {
  try {
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    console.warn(`[WARN] 无法写入 ${path.basename(stateFile)}：${error.message}`);
  }
}

console.log(`submit-baidu: 成功 ${success}，剩余配额 ${result.remain ?? '未知'}${rejected.size ? `，未接受 ${rejected.size}` : ''}`);
if (rejected.size) {
  for (const entry of queued.filter((item) => rejected.has(item.url))) console.warn(`  [拒绝] ${entry.url}`);
  console.warn('submit-baidu: 未接受的 URL 未计入历史状态，下次运行会重试。');
}
if (success < accepted.length) {
  console.warn(`submit-baidu: 还有 ${accepted.length - success} 条因配额或校验未收录，下次运行会继续。`);
}

process.exit(success > 0 ? 0 : 1);
