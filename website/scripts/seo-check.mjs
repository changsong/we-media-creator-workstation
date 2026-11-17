#!/usr/bin/env node
// SEO 体检：只读 website/site 构建产物，不依赖第三方包。
// 硬性错误返回退出码 1，文案类问题先以 WARN 呈现。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(root, 'site');
const SITE_URL = (process.env.SITE_URL || 'https://we-media.example.com').replace(/\/+$/, '');
const SITE_BASE = (process.env.SITE_BASE || '').replace(/\/+$/, '');
const PRODUCTION_ORIGIN = 'https://www.wemediacreator.com';
const strictOrigin = Boolean(process.env.SITE_URL);

if (!fs.existsSync(siteDir)) {
  console.error(`seo-check: ${siteDir} 不存在，请先运行 npm run site:build`);
  process.exit(1);
}

function decode(text = '') {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(path.relative(siteDir, full).split(path.sep).join('/'));
  }
  return out;
}

function urlForFile(rel) {
  if (rel === 'index.html') return `${SITE_URL}${SITE_BASE}/`;
  if (rel.endsWith('/index.html')) return `${SITE_URL}${SITE_BASE}/${rel.slice(0, -'index.html'.length)}`;
  return `${SITE_URL}${SITE_BASE}/${rel}`;
}

function fileForUrl(url) {
  const pathname = new URL(url).pathname;
  let rel = decodeURIComponent(pathname);
  if (SITE_BASE && rel.startsWith(SITE_BASE)) rel = rel.slice(SITE_BASE.length);
  rel = rel.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  return rel;
}

const attr = (html, re) => {
  const m = html.match(re);
  return m ? decode(m[1]).trim() : '';
};
const titleOf = (html) => attr(html, /<title>([\s\S]*?)<\/title>/i);
const descOf = (html) => attr(html, /<meta\s+name="description"\s+content="([^"]*)"/i);
const isNoindex = (html) => /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
const countOf = (html, re) => (html.match(re) || []).length;

const titles = new Map();
const sitemapUrls = new Set();
const indexableUrls = new Set();
let failures = 0;
let warnings = 0;
let scanned = 0;

function fail(page, msg) {
  console.error(`[FAIL] ${page}  ${msg}`);
  failures++;
}
function warn(page, msg) {
  console.warn(`[WARN] ${page}  ${msg}`);
  warnings++;
}

const pages = htmlFiles(siteDir).sort();

for (const rel of pages) {
  const page = rel === 'index.html' ? 'home' : rel.replace(/\/index\.html$/, '');
  const html = fs.readFileSync(path.join(siteDir, rel), 'utf8');
  const lang = attr(html, /<html\s+lang="([^"]+)"/i).toLowerCase().startsWith('en') ? 'en' : 'zh';
  const noindex = isNoindex(html);
  scanned++;

  const title = titleOf(html);
  const desc = descOf(html);

  if (!title) fail(page, '缺少 <title>');
  if (!desc) fail(page, '缺少 meta description');

  if (title) {
    const len = [...title].length;
    if (titles.has(title)) fail(page, `标题重复：与 ${titles.get(title)} 相同`);
    else titles.set(title, page);
    if (!noindex) {
      if (lang === 'en') {
        if (len > 80) fail(page, `英文标题 ${len} 字符（上限 80）`);
        else if (len > 60) warn(page, `英文标题 ${len} 字符（建议 ≤60）`);
      } else if (len > 50) {
        warn(page, `中文标题 ${len} 字（建议 ≤40）`);
      }
    }
  }

  if (desc && !noindex) {
    const len = [...desc].length;
    if (lang === 'zh') {
      if (len < 25) fail(page, `中文描述 ${len} 字（下限 25）`);
      else if (len < 45) warn(page, `中文描述 ${len} 字（建议 ≥60）`);
    } else {
      if (len > 175) fail(page, `英文描述 ${len} 字符（上限 175）`);
      else if (len > 160) warn(page, `英文描述 ${len} 字符（建议 ≤160）`);
    }
  }

  const canonical = countOf(html, /<link\s+rel="canonical"/gi);
  const canonicalUrl = attr(html, /<link\s+rel="canonical"\s+href="([^"]*)"/i);
  if (canonical !== 1) fail(page, `canonical 数量 ${canonical}（应为 1）`);
  if (canonicalUrl) {
    if (!/^https?:\/\//i.test(canonicalUrl)) fail(page, `canonical 不是绝对地址：${canonicalUrl}`);
    if (strictOrigin && !canonicalUrl.startsWith(PRODUCTION_ORIGIN)) {
      fail(page, `canonical 域名不是 ${PRODUCTION_ORIGIN}：${canonicalUrl}`);
    } else if (!strictOrigin && !canonicalUrl.startsWith(PRODUCTION_ORIGIN)) {
      warn(page, `canonical 域名不是 ${PRODUCTION_ORIGIN}（SITE_URL 未设置，仅提示）`);
    }
  }

  const ogImage = attr(html, /<meta\s+property="og:image"\s+content="([^"]*)"/i);
  if (!ogImage) {
    fail(page, '缺少 og:image');
  } else {
    if (!/^https?:\/\//i.test(ogImage)) fail(page, `og:image 不是绝对地址：${ogImage}`);
    if (/\/$/.test(ogImage)) fail(page, `og:image 带尾斜杠（会 404）：${ogImage}`);
    if (!/\.(png|jpe?g|webp|gif)$/i.test(ogImage)) fail(page, `og:image 不是图片文件：${ogImage}`);
    try {
      const relAsset = fileForUrl(ogImage);
      if (!fs.existsSync(path.join(siteDir, relAsset))) fail(page, `og:image 本地文件不存在：${relAsset}`);
    } catch {
      fail(page, `og:image 不是合法 URL：${ogImage}`);
    }
  }
  for (const prop of ['og:image:width', 'og:image:height', 'og:image:type', 'og:image:alt']) {
    if (!new RegExp(`<meta\\s+property="${prop}"\\s+content="[^"]+"`, 'i').test(html)) {
      fail(page, `缺少 ${prop}`);
    }
  }

  const lds = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (!lds.length) warn(page, '没有 JSON-LD 结构化数据');
  for (const [, raw] of lds) {
    try {
      const data = JSON.parse(raw);
      const context = Array.isArray(data) ? data[0]?.['@context'] : data['@context'];
      if (!/schema\.org/.test(String(context))) fail(page, `JSON-LD 的 @context 不是 schema.org`);
    } catch (err) {
      fail(page, `JSON-LD 无法解析：${err.message}`);
    }
  }

  const hreflangs = ['zh-CN', 'en', 'x-default'].filter((code) =>
    new RegExp(`<link\\s+rel="alternate"\\s+hreflang="${code}"`, 'i').test(html));
  const zhOnly = rel.startsWith('jiayouzhan/');
  if (noindex) {
    if (hreflangs.length) warn(page, `noindex 页仍输出 hreflang：${hreflangs.join(', ')}`);
  } else {
    indexableUrls.add(urlForFile(rel));
    const expected = zhOnly ? ['zh-CN', 'x-default'] : ['zh-CN', 'en', 'x-default'];
    const ok = hreflangs.length === expected.length && expected.every((code) => hreflangs.includes(code));
    if (!ok) fail(page, `hreflang 不正确（${zhOnly ? '中文独有页' : '双语页'}应输出 ${expected.join(', ')}，实际发现 ${hreflangs.join(', ') || '无'}）`);
    const h1 = countOf(html, /<h1\b/gi);
    if (h1 !== 1) fail(page, `可索引页 <h1> 数量 ${h1}（应为 1）`);
  }

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((tag) => !/(^|\s)alt=/.test(tag)).length;
  if (noAlt) fail(page, `${noAlt} 个 <img> 缺少 alt 属性`);
  const noSize = imgs.filter((tag) => !/(^|\s)width=/.test(tag) || !/(^|\s)height=/.test(tag)).length;
  if (noSize) warn(page, `${noSize} 个 <img> 缺少 width/height`);
}

const sitemapFile = path.join(siteDir, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) {
  fail('sitemap', 'sitemap.xml 不存在');
} else {
  const xml = fs.readFileSync(sitemapFile, 'utf8');
  if (!/xmlns:xhtml=/.test(xml)) warn('sitemap', '缺少 xmlns:xhtml 命名空间（hreflang alternates）');
  for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapUrls.add(decode(loc).trim());
  const missing = [...indexableUrls].filter((url) => !sitemapUrls.has(url));
  const extra = [...sitemapUrls].filter((url) => !indexableUrls.has(url));
  for (const url of missing) fail('sitemap', `可索引页未收录：${url}`);
  for (const url of extra) fail('sitemap', `sitemap 含非可索引页：${url}`);
}

const robotsFile = path.join(siteDir, 'robots.txt');
if (!fs.existsSync(robotsFile)) {
  fail('robots', 'robots.txt 不存在');
} else if (!/^Sitemap:\s*\S+/im.test(fs.readFileSync(robotsFile, 'utf8'))) {
  fail('robots', 'robots.txt 缺少 Sitemap 行');
}
for (const name of ['llms.txt', 'llms-full.txt']) {
  if (!fs.existsSync(path.join(siteDir, name))) fail('llms', `${name} 不存在`);
}

if (!scanned) {
  fail('site', '没有找到任何 HTML 页面');
}
if (failures) {
  console.error(`\nseo-check: ${scanned} 页，${failures} 个错误，${warnings} 个提醒`);
  process.exit(1);
}
console.log(`seo-check: ${scanned} 页通过${warnings ? `（${warnings} 个提醒）` : ''}`);
