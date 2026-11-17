import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JIAYOUZHAN_SEED } from '../data/jiayouzhan-seed.mjs';
import { absolute, assetAbsolute, breadcrumbs, clampText, esc, layout, routeTo, siteRoot } from './layout.mjs';
import { feedbackBand, icon, pageHero, primaryButton, secondaryButton } from './components.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_TITLE = '加油站｜自媒体拍摄、剪辑与运营技巧';
const SITE_DESC = '每天一篇拍摄、剪辑与账号运营的实用方法：布光、收音、剪辑节奏、封面与选题，写给认真做内容的自媒体创作者。';
const PAGE_SIZE = 20;

export function articlesFile() {
  return process.env.JIAYOUZHAN_CONTENT || path.resolve(__dirname, '../../content/jiayouzhan.json');
}

export function loadArticles({ file = articlesFile() } = {}) {
  let list = JIAYOUZHAN_SEED;
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.articles;
    if (Array.isArray(items)) list = items;
  }
  return list
    .filter((article) => article.status !== 'removed')
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.slug).localeCompare(String(a.slug)));
}

function formatDate(iso) {
  return String(iso || '').slice(0, 10).replace(/-/g, '.');
}

function readMinutes(article) {
  if (article.read) return article.read;
  const chars = [article.intro, ...(article.sections || []).flatMap((s) => s.ps || [])].join('').length;
  return Math.max(3, Math.round(chars / 400));
}

function page({ route, title, description, body, jsonLd = [], noindex = false, alternates = 'zh-only', ogType = 'website', article = null, priority = 0.7, lastmod }) {
  return {
    lang: 'zh',
    route,
    priority,
    lastmod,
    noindex,
    html: layout({
      lang: 'zh',
      route,
      title,
      description,
      body,
      jsonLd,
      noindex,
      alternates,
      ogType,
      article,
    }),
  };
}

function orgRef() {
  return { '@type': 'Organization', '@id': `${siteRoot()}/#organization`, name: 'WeMedia Studio' };
}

function pageRoute(pageNumber) {
  return pageNumber === 1 ? '/jiayouzhan/' : `/jiayouzhan/page/${pageNumber}/`;
}

function articleRoute(slug) {
  return `/jiayouzhan/${slug}/`;
}

function card(article) {
  return `<a class="group flex flex-col justify-between rounded-2xl bg-surface-white p-6 shadow-sm hover:shadow-md transition-shadow" href="${routeTo(articleRoute(article.slug), 'zh')}">
    <div>
      <div class="flex flex-wrap items-center gap-2 text-body-sm font-body-sm text-on-surface-variant">
        <span class="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-label-capsule text-on-surface">${esc(article.tag)}</span>
        <span>${formatDate(article.date)}</span>
        <span>·</span>
        <span>${readMinutes(article)} 分钟阅读</span>
      </div>
      <div class="mt-3 font-headline-sm text-headline-sm text-on-surface group-hover:text-primary transition-colors">${esc(article.title)}</div>
      <p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">${esc(article.description)}</p>
    </div>
    <span class="mt-5 inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary group-hover:gap-2 transition-all">阅读全文 ${icon('arrow_forward', 'text-[16px]')}</span>
  </a>`;
}

function pagination(pageNumber, totalPages) {
  if (totalPages <= 1) return '';
  const prev = pageNumber > 1
    ? `<a class="inline-flex items-center gap-1 rounded-full bg-surface-white px-4 py-2 font-label-capsule text-body-sm text-on-surface shadow-sm hover:bg-surface-container-low transition-colors" href="${routeTo(pageRoute(pageNumber - 1), 'zh')}">${icon('chevron_left', 'text-[16px]')}上一页</a>`
    : '';
  const next = pageNumber < totalPages
    ? `<a class="inline-flex items-center gap-1 rounded-full bg-surface-white px-4 py-2 font-label-capsule text-body-sm text-on-surface shadow-sm hover:bg-surface-container-low transition-colors" href="${routeTo(pageRoute(pageNumber + 1), 'zh')}">下一页${icon('chevron_right', 'text-[16px]')}</a>`
    : '';
  return `<nav class="mt-space-xl flex items-center justify-center gap-3" aria-label="分页">
    ${prev}
    <span class="font-body-sm text-body-sm text-on-surface-variant">第 ${pageNumber} / ${totalPages} 页</span>
    ${next}
  </nav>`;
}

function indexPage(articles, pageNumber = 1) {
  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, pageNumber), totalPages);
  const pageArticles = articles.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const bc = breadcrumbs({
    lang: 'zh',
    items: [
      { label: '首页', route: '/' },
      { label: '加油站', route: '/jiayouzhan/' },
    ],
  });
  const title = current === 1 ? SITE_TITLE : `加油站第 ${current} 页｜自媒体拍摄、剪辑与运营技巧`;
  const description = current === 1
    ? SITE_DESC
    : `加油站文章列表第 ${current} 页：拍摄布光、收音、剪辑节奏与账号运营的实用方法，每天更新。`;

  const body = [
    pageHero({
      lang: 'zh',
      eyebrow: '加油站',
      title: '每天加一点油：拍摄、剪辑与账号运营',
      description: '把复杂的方法拆成今天就能用上的动作。每天精选行业里的好题目，重新整理成创作者视角的实操笔记。',
      breadcrumbHtml: bc.html,
    }),
    `<div class="max-w-6xl mx-auto pb-space-2xl">
      <div class="mb-space-lg flex flex-wrap items-center justify-between gap-3">
        <p class="font-body-sm text-body-sm text-on-surface-variant">共 ${articles.length} 篇 · 每天更新</p>
        <a class="inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary" href="${routeTo('/blog/', 'zh')}">也看看博客工作笔记 ${icon('arrow_forward', 'text-[16px]')}</a>
      </div>
      ${pageArticles.length
        ? `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">${pageArticles.map(card).join('')}</div>`
        : '<div class="rounded-2xl bg-surface-white p-8 text-center font-body-md text-body-md text-on-surface-variant">文章正在准备中，明天再来看看。</div>'}
      ${pagination(current, totalPages)}
    </div>`,
    feedbackBand({ lang: 'zh' }),
  ].join('\n');

  const blogLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: '加油站',
    url: absolute('/jiayouzhan/', 'zh'),
    inLanguage: 'zh-CN',
    image: assetAbsolute('og.png'),
    publisher: orgRef(),
    ...(articles.length
      ? {
          blogPost: articles.slice(0, 8).map((article) => ({
            '@type': 'BlogPosting',
            headline: article.title,
            datePublished: article.date,
            dateModified: article.date,
            image: assetAbsolute('og.png'),
            url: absolute(articleRoute(article.slug), 'zh'),
          })),
        }
      : {}),
  };

  return page({
    route: pageRoute(current),
    title,
    description,
    body,
    jsonLd: [bc.jsonLd, blogLd],
    noindex: current > 1,
    alternates: current > 1 ? false : 'zh-only',
    priority: current === 1 ? 0.7 : 0.3,
    lastmod: articles[0]?.date,
  });
}

function articlePage(article, articles) {
  const bc = breadcrumbs({
    lang: 'zh',
    items: [
      { label: '首页', route: '/' },
      { label: '加油站', route: '/jiayouzhan/' },
      { label: article.title, route: articleRoute(article.slug) },
    ],
  });

  const sections = (article.sections || [])
    .map((section) => `<h2>${esc(section.h2)}</h2>\n${(section.ps || []).map((p) => `<p>${esc(p)}</p>`).join('')}`)
    .join('\n');
  const takeaways = (article.takeaways || []).map((item) => `<li>${esc(item)}</li>`).join('');
  const source = article.sourceUrl
    ? `参考来源：<a class="text-primary hover:underline" href="${esc(article.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${esc(article.sourceName || '原文')}</a>`
    : `参考来源：${esc(article.sourceName || '公开资料')}`;
  const related = articles
    .filter((item) => item.slug !== article.slug)
    .slice(0, 2)
    .map((item) => `<a class="group rounded-2xl bg-surface-white p-5 shadow-sm hover:shadow-md transition-shadow" href="${routeTo(articleRoute(item.slug), 'zh')}">
      <div class="flex items-center gap-2 text-body-sm font-body-sm text-on-surface-variant"><span class="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-label-capsule text-on-surface">${esc(item.tag)}</span>${formatDate(item.date)}</div>
      <div class="mt-2 font-headline-sm text-[16px] text-on-surface font-semibold group-hover:text-primary transition-colors">${esc(item.title)}</div>
    </a>`)
    .join('');

  const body = [
    `<div class="max-w-3xl mx-auto pt-space-lg">
      ${bc.html}
      <div class="mt-space-lg flex flex-wrap items-center gap-3 font-body-sm text-body-sm text-on-surface-variant">
        <span class="rounded-full bg-surface-white px-3 py-1 font-label-capsule text-[11px] uppercase tracking-wider text-primary shadow-sm">${esc(article.tag)}</span>
        <span>发布 ${formatDate(article.date)}</span>
        <span>·</span>
        <span>${readMinutes(article)} 分钟阅读</span>
      </div>
      <h1 class="mt-4 font-display-hero text-headline-lg-mobile lg:text-headline-lg text-on-surface tracking-tight leading-tight">${esc(article.title)}</h1>
      <p class="mt-4 font-body-lg text-body-lg text-on-surface-variant">${esc(article.description)}</p>
      <div class="mt-space-xl prose-site">
        <p>${esc(article.intro)}</p>
        ${sections}
        <div class="my-8 rounded-2xl bg-surface-container-low p-6">
          <div class="font-headline-sm text-headline-sm text-on-surface mb-3">要点小结</div>
          <ul class="list-disc pl-5 space-y-2 font-body-md text-body-md text-on-surface">${takeaways}</ul>
        </div>
        <div class="rounded-2xl bg-surface-white p-5 font-body-sm text-body-sm text-on-surface-variant shadow-sm">
          <p>本文由 AI 辅助整理与改写，参考公开的行业文章与平台教程，用于分享创作方法，不构成平台官方建议。</p>
          <p class="mt-2">${source}</p>
        </div>
      </div>
    </div>`,
    `<section class="w-full py-space-2xl"><div class="max-w-3xl mx-auto">
      <div class="font-label-capsule text-label-capsule text-on-surface-variant uppercase tracking-wider mb-4">继续阅读</div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-gutter">${related}</div>
      <div class="mt-8 flex flex-wrap items-center gap-3">
        ${primaryButton({ href: routeTo('/download/', 'zh'), label: '下载媒管家', download: true })}
        ${secondaryButton({ href: routeTo('/jiayouzhan/', 'zh'), label: '返回加油站' })}
      </div>
    </div></section>`,
  ].join('\n');

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.description,
    datePublished: article.date,
    dateModified: article.date,
    inLanguage: 'zh-CN',
    url: absolute(articleRoute(article.slug), 'zh'),
    mainEntityOfPage: absolute(articleRoute(article.slug), 'zh'),
    image: assetAbsolute('og.png'),
    keywords: article.tag,
    isBasedOn: article.sourceUrl || undefined,
    isPartOf: { '@id': `${absolute('/jiayouzhan/', 'zh')}#blog` },
    author: { '@type': 'Organization', name: 'WeMedia Studio' },
    publisher: {
      ...orgRef(),
      logo: { '@type': 'ImageObject', url: assetAbsolute('img-1.png'), width: 512, height: 512 },
    },
  };

  return page({
    route: articleRoute(article.slug),
    title: `${article.title}｜加油站`,
    description: clampText(article.description || article.intro, 90, 'zh'),
    body,
    jsonLd: [bc.jsonLd, articleLd],
    ogType: 'article',
    alternates: 'zh-only',
    article: { published: article.date, modified: article.date, section: article.tag },
    priority: 0.6,
    lastmod: article.date,
  });
}

export function jiayouzhanRoutes(articles = loadArticles()) {
  if (!articles.length) return [indexPage([], 1)];
  const totalPages = Math.ceil(articles.length / PAGE_SIZE);
  const pages = [];
  for (let number = 1; number <= totalPages; number += 1) pages.push(indexPage(articles, number));
  for (const article of articles) pages.push(articlePage(article, articles));
  return pages;
}
