#!/usr/bin/env node
// 文案体检：扫描构建后的核心页面，拦截“AI 味”回潮。
// 只读 website/site，不依赖第三方包。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  ['index.html', 'zh'], ['en/index.html', 'en'],
  ['features/index.html', 'zh'], ['en/features/index.html', 'en'],
  ['pricing/index.html', 'zh'], ['en/pricing/index.html', 'en'],
  ['download/index.html', 'zh'], ['en/download/index.html', 'en'],
  ['platforms/index.html', 'zh'], ['en/platforms/index.html', 'en'],
  ['use-cases/solo/index.html', 'zh'], ['en/use-cases/solo/index.html', 'en'],
  ['use-cases/team/index.html', 'zh'], ['en/use-cases/team/index.html', 'en'],
  ['use-cases/overseas/index.html', 'zh'], ['en/use-cases/overseas/index.html', 'en'],
  ['faq/index.html', 'zh'], ['en/faq/index.html', 'en'],
  ['about/index.html', 'zh'], ['en/about/index.html', 'en'],
  ['blog/index.html', 'zh'], ['en/blog/index.html', 'en'],
  ['changelog/index.html', 'zh'], ['en/changelog/index.html', 'en'],
];

const ZH_HARD = ['赋能', '一站式', '闭环', '抓手', '底层逻辑', '护城河', '组合拳', '降本增效', '数智化', '生态位'];
const ZH_SOFT = ['打造', '引领', '无缝', '极致', '全方位', '助力', '势能', '范式'];
const ZH_SUPERLATIVE = ['顶级', '最强', '最佳', '完美', '革命性', '颠覆性', '划时代', '行业领先', '首屈一指', '独一无二'];
const EN_BUZZ = ['leverage', 'seamless', 'robust', 'cutting-edge', 'game-changer', 'empower', 'unlock', 'elevate', 'streamline', 'delve', 'best-in-class', 'world-class', 'state-of-the-art', 'revolutionary', 'groundbreaking', 'holistic', 'synergy'];
const EN_FILLER = ["it's important to note", "it's worth noting", "in today's fast-paced", 'in the ever-evolving', 'needless to say', 'in conclusion', 'furthermore', 'moreover'];
const EN_PSEUDO = ['plays a crucial role', 'serves as a testament', 'stands as a', 'underscores the importance', 'in the realm of', 'when it comes to', 'a testament to'];

function decode(html) {
  return html
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function visibleText(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  let body = main ? main[1] : html.replace(/<head\b[\s\S]*?<\/head>/i, '');
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(span|i|div)\b[^>]*material-(?:symbols|icons)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(h[1-6])\b[^>]*>/gi, (_, t) => '\n\n' + '#'.repeat(Number(t[1])) + ' ')
    .replace(/<\/(h[1-6])>/gi, '\n\n')
    .replace(/<(p|li|blockquote|div|section|tr|td|th|dt|dd)\b[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(body)
    .replace(/[ \t]+/g, ' ')
    .split('\n').map((line) => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
}

const count = (text, phrase) => text.split(phrase).length - 1;
const sentenceLength = (s) => (/[一-鿿]/.test(s) ? s.length : s.trim().split(/\s+/).filter(Boolean).length);

function sentences(text, zh) {
  const re = zh ? /[。！？；;\n]+/ : /[.!?;\n]+/;
  return text.split(re).map((s) => s.replace(/^#+\s*/, '').trim())
    .filter((s) => sentenceLength(s) > (zh ? 3 : 3));
}

function variation(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (!mean) return 0;
  return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length) / mean;
}

function words(text, list) {
  return list.filter((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text));
}

let failures = 0;
let warnings = 0;
let scanned = 0;

for (const [route, lang] of pages) {
  const file = path.join(root, 'site', route);
  if (!fs.existsSync(file)) {
    console.warn(`[WARN] ${route}  页面不存在，已跳过`);
    warnings++;
    continue;
  }
  scanned++;
  const text = visibleText(fs.readFileSync(file, 'utf8'));
  const page = route.replace(/\/index\.html$/, '').replace(/\.html$/, '') || 'home';
  const problems = [];
  const notes = [];

  if (lang === 'en') {
    const dashes = count(text, '—');
    if (dashes > 5) problems.push(`英文破折号 ${dashes} 处（上限 5）`);
    else if (dashes > 2) notes.push(`英文破折号 ${dashes} 处（超过 2 处）`);
    const buzz = words(text, EN_BUZZ);
    if (buzz.length) notes.push(`英文营销词：${buzz.join(', ')}`);
    const filler = words(text, EN_FILLER);
    if (filler.length) notes.push(`英文填充语：${filler.join(', ')}`);
    const pseudo = words(text, EN_PSEUDO);
    if (pseudo.length) notes.push(`英文空话：${pseudo.join(', ')}`);
  } else {
    const hard = words(text, ZH_HARD);
    if (hard.length) problems.push(`中文套话：${hard.join('、')}`);
    const soft = words(text, ZH_SOFT);
    if (soft.length) notes.push(`中文套话（弱）：${soft.join('、')}`);
    const sup = words(text, ZH_SUPERLATIVE);
    if (sup.length) notes.push(`空泛最高级：${sup.join('、')}`);
    const sents = sentences(text, true);
    const lens = sents.map(sentenceLength);
    const longRatio = lens.length ? lens.filter((n) => n > 45).length / lens.length : 0;
    if (longRatio > 0.5) problems.push(`中文长句占比 ${longRatio.toFixed(2)}（上限 0.5）`);
    else if (longRatio > 0.35) notes.push(`中文长句占比 ${longRatio.toFixed(2)}（超过 0.35）`);
    if (lens.length >= 20) {
      const cv = variation(lens);
      if (cv < 0.3) notes.push(`中文句长过于均匀 CV=${cv.toFixed(2)}`);
    }
  }

  for (const p of problems) {
    console.error(`[FAIL] ${page}  ${p}`);
    failures++;
  }
  for (const n of notes) {
    console.warn(`[WARN] ${page}  ${n}`);
    warnings++;
  }
}

if (!scanned) {
  console.error('copy-check: website/site 不存在，请先运行 npm run site:build');
  process.exit(1);
}
if (failures) {
  console.error(`\ncopy-check: ${scanned} 页，${failures} 个错误，${warnings} 个提醒`);
  process.exit(1);
}
console.log(`copy-check: ${scanned} 页通过${warnings ? `（${warnings} 个提醒）` : ''}`);
