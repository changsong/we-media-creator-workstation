import { SITE_URL, SITE_BASE, VERSION, RELEASES } from '../config.mjs';
import { ui } from './i18n.mjs';

export function esc(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function routeTo(route, lang = 'zh') {
  if (/^(https?:|mailto:|tel:)/.test(route)) return route;
  const hashAt = route.indexOf('#');
  const hash = hashAt >= 0 ? route.slice(hashAt) : '';
  const withoutHash = hashAt >= 0 ? route.slice(0, hashAt) : route;
  const queryAt = withoutHash.indexOf('?');
  const query = queryAt >= 0 ? withoutHash.slice(queryAt) : '';
  const pathPart = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  const prefix = lang === 'en' ? '/en' : '';
  const clean = pathPart === '/' || pathPart === '' ? '/' : `${pathPart.replace(/\/$/, '')}/`;
  return `${SITE_BASE}${prefix}${clean === '/' && !prefix ? '/' : clean}${query}${hash}`;
}

export function asset(path) {
  return `${SITE_BASE}/assets/${String(path).replace(/^\//, '')}`;
}

export function absolute(route, lang = 'zh') {
  return `${SITE_URL}${routeTo(route, lang)}`;
}

export function langLabel(lang) {
  return lang === 'en' ? 'EN' : '中';
}

export function header({ lang, route }) {
  const t = ui(lang);
  const isActive = (navRoute) => {
    const base = navRoute.split('#')[0];
    if (base === '/') return false;
    return route === base || route.startsWith(base);
  };
  const navLinks = t.nav
    .map((item) => {
      const active = isActive(item.route);
      const cls = active
        ? 'whitespace-nowrap transition-colors text-on-surface font-headline-sm font-semibold'
        : 'whitespace-nowrap text-on-surface-variant hover:text-on-surface transition-colors font-body-md text-body-md';
      return `<a class="${cls}" href="${routeTo(item.route, lang)}"${active ? ' aria-current="page"' : ''}>${esc(item.label)}</a>`;
    })
    .join('');

  const mobileLinks = t.nav
    .map((item) => `<a class="px-4 py-3 rounded-xl hover:bg-surface-container-low transition-colors font-body-md text-body-md text-on-surface" href="${routeTo(item.route, lang)}">${esc(item.label)}</a>`)
    .join('');

  return `<header id="site-header" class="fixed top-0 left-0 w-full z-50 bg-surface/85 backdrop-blur-xl shadow-[0_1px_8px_rgba(9,12,13,0.04)]">
  <div class="h-20 max-w-[1440px] mx-auto px-margin flex items-center justify-between gap-space-md">
    <a class="flex items-center gap-space-md shrink-0" href="${routeTo('/', lang)}" aria-label="${esc(t.brand)}">
      <img alt="WeMedia Logo" class="h-8 w-auto object-contain" src="${asset('img-1.png')}" width="32" height="32"/>
      <span class="flex flex-col">
        <span class="flex items-center gap-space-sm">
          <span class="font-headline-sm text-headline-sm text-on-surface tracking-tight">${esc(t.brand)}</span>
          <span class="hidden 2xl:inline text-on-surface-variant font-body-sm text-body-sm">${esc(t.brandShort)}</span>
          <span class="hidden sm:inline px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface font-label-capsule text-body-sm text-[11px]">v${esc(VERSION)}</span>
        </span>
      </span>
    </a>
    <nav class="hidden xl:flex items-center gap-space-md 2xl:gap-space-lg" aria-label="${lang === 'en' ? 'Primary' : '主导航'}">${navLinks}</nav>
    <div class="flex items-center gap-space-sm shrink-0">
      <div class="hidden sm:flex items-center bg-surface-container-low px-2 py-1 rounded-full text-on-surface-variant font-label-capsule text-body-sm" aria-label="${esc(t.language)}">
        <a class="px-2 py-0.5 rounded-full ${lang === 'zh' ? 'bg-surface-white text-on-surface shadow-[0_1px_3px_rgba(9,12,13,0.05)]' : 'hover:text-on-surface'}" href="${routeTo(route, 'zh')}" hreflang="zh-CN" lang="zh-CN">中</a>
        <a class="px-2 py-0.5 rounded-full ${lang === 'en' ? 'bg-surface-white text-on-surface shadow-[0_1px_3px_rgba(9,12,13,0.05)]' : 'hover:text-on-surface'}" href="${routeTo(route, 'en')}" hreflang="en" lang="en">EN</a>
      </div>
      <div class="hidden 2xl:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-low text-on-surface font-body-sm text-body-sm">
        <span class="w-2 h-2 rounded-full bg-status-success"></span><span>macOS / Win</span>
      </div>
      <a class="hidden xl:inline-flex items-center px-4 py-2 rounded-full bg-surface-container-low text-on-surface font-label-capsule text-label-capsule hover:bg-surface-container transition-colors" href="${routeTo('/pricing/', lang)}">${esc(t.seePricing)}</a>
      <a class="hidden sm:inline-flex items-center px-5 py-2.5 rounded-full bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark font-label-capsule text-label-capsule shadow-[0_4px_14px_rgba(255,217,117,0.4)] transition-all" href="${routeTo('/download/', lang)}">${esc(t.downloadFree)}</a>
      <a class="hidden md:flex w-8 h-8 rounded-full bg-primary items-center justify-center shrink-0" href="${routeTo('/feedback/', lang)}" aria-label="${esc(t.feedback.title)}"><span class="material-symbols-outlined text-on-primary text-[18px]">person</span></a>
      <button id="menu-toggle" class="xl:hidden inline-flex w-9 h-9 rounded-full bg-surface-container-low items-center justify-center text-on-surface" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="${esc(t.menu)}" data-label-open="${esc(t.menu)}" data-label-close="${esc(t.closeMenu)}">
        <span class="material-symbols-outlined text-[20px]">menu</span>
      </button>
    </div>
  </div>
  <div id="mobile-menu" class="hidden xl:hidden border-t border-border-light bg-surface-white/95 backdrop-blur-xl">
    <div class="max-w-[1440px] mx-auto px-margin py-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
      ${mobileLinks}
      <a class="px-4 py-3 rounded-xl bg-gold-accent text-canvas-dark font-label-capsule text-label-capsule" href="${routeTo('/download/', lang)}">${esc(t.downloadFree)}</a>
      <a class="px-4 py-3 rounded-xl bg-surface-container-low text-on-surface font-label-capsule text-label-capsule" href="${routeTo('/pricing/', lang)}">${esc(t.seePricing)}</a>
    </div>
  </div>
</header>`;
}

export function footer({ lang }) {
  const t = ui(lang);
  const cols = t.footer.cols
    .map(
      (col) => `<div>
        <div class="font-label-capsule text-label-capsule text-text-light-primary uppercase tracking-wider mb-space-md">${esc(col.title)}</div>
        <ul class="space-y-space-sm font-body-md text-body-md">
          ${col.links.map((l) => `<li><a class="hover:text-text-light-primary transition-colors" href="${routeTo(l.route, lang)}">${esc(l.label)}</a></li>`).join('')}
        </ul>
      </div>`,
    )
    .join('');

  return `<footer class="w-full bg-canvas-dark text-text-light-secondary mt-space-3xl">
  <div class="max-w-[1440px] mx-auto px-margin py-space-3xl">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-gutter mb-space-2xl">
      <div class="lg:col-span-2 flex flex-col items-start">
        <a class="flex items-center gap-space-sm mb-space-md" href="${routeTo('/', lang)}">
          <img alt="WeMedia Logo" class="h-8 w-auto object-contain" src="${asset('img-1.png')}" width="32" height="32" loading="lazy"/>
          <span class="font-headline-sm text-headline-sm text-text-light-primary">WeMedia ${lang === 'en' ? 'Workstation' : '工作台'}</span>
        </a>
        <p class="font-body-md text-body-md text-text-light-secondary mb-space-lg max-w-sm">${esc(t.footer.desc)}</p>
        <div class="flex items-center gap-space-sm flex-wrap">
          <span class="px-3 py-1 rounded-full bg-surface-dark text-text-light-primary font-label-capsule text-body-sm border border-border-dark flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-status-success"></span>${esc(t.footer.status)}</span>
          <span class="px-3 py-1 rounded-full bg-surface-dark text-text-light-secondary font-label-capsule text-body-sm border border-border-dark">${esc(t.footer.stack)}</span>
        </div>
      </div>
      ${cols}
    </div>
    <div class="border-t border-border-dark pt-space-lg flex flex-col md:flex-row md:items-center md:justify-between gap-3 font-body-sm text-body-sm">
      <p>© 2026 ${esc(t.footer.copyright)}</p>
      <div class="flex flex-wrap items-center gap-4">
        <a class="hover:text-text-light-primary transition-colors" href="${routeTo('/legal/terms/', lang)}">${esc(t.footer.terms)}</a>
        <a class="hover:text-text-light-primary transition-colors" href="${routeTo('/legal/privacy/', lang)}">${esc(t.footer.privacy)}</a>
        <a class="hover:text-text-light-primary transition-colors" href="https://github.com/changsong/we-media-creator-workstation" target="_blank" rel="noopener">GitHub</a>
        <span>${esc(t.footer.icp)}</span>
        <span>${esc(t.footer.police)}</span>
      </div>
    </div>
  </div>
</footer>`;
}

export function mobileCta({ lang }) {
  const t = ui(lang);
  return `<div class="xl:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-xl border-t border-border-light px-3 py-2 grid grid-cols-2 gap-2">
    <a class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-gold-accent text-canvas-dark font-label-capsule text-label-capsule" href="${routeTo('/download/', lang)}"><span class="material-symbols-outlined text-[18px]">download</span>${esc(t.download)}</a>
    <a class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full bg-surface-container-low text-on-surface font-label-capsule text-label-capsule" href="${routeTo('/pricing/', lang)}">${esc(t.seePricing)}</a>
  </div>`;
}

function globalJsonLd(lang) {
  const org = {
    '@type': 'Organization',
    name: 'WeMedia Studio',
    url: absolute('/', lang),
    logo: absolute('/assets/img-1.png', lang),
  };
  const site = {
    '@type': 'WebSite',
    name: lang === 'en' ? 'WeMedia Creator Workstation' : '自媒体内容运营工作台',
    alternateName: 'WeMedia Creator Workstation',
    url: absolute('/', lang),
    inLanguage: lang === 'en' ? 'en' : 'zh-CN',
  };
  return { '@context': 'https://schema.org', '@graph': [org, site] };
}

export function head({ lang, route, title, description, jsonLd = [], ogType = 'website', noindex = false }) {
  const t = ui(lang);
  const canonical = absolute(route, lang);
  const zhHref = absolute(route, 'zh');
  const enHref = absolute(route, 'en');
  const ogImage = absolute('/assets/og.png', lang);
  const ld = [globalJsonLd(lang), ...jsonLd].map(
    (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`,
  ).join('\n');
  const version = esc(VERSION);
  const config = JSON.stringify({
    lang,
    route,
    version,
    feedbackEndpoint: process.env.FEEDBACK_ENDPOINT || '/api/feedback',
    checkoutUrl: process.env.CHECKOUT_URL || '',
    contactEmail: process.env.CONTACT_EMAIL || '',
    releases: {
      version: RELEASES.version,
      platforms: {
        win: RELEASES.platforms.win,
        linux: RELEASES.platforms.linux,
        mac: RELEASES.platforms.mac,
      },
    },
  }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="theme-color" content="#090c0d"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
${noindex ? '<meta name="robots" content="noindex, follow"/>' : '<meta name="robots" content="index, follow, max-image-preview:large"/>'}
<link rel="canonical" href="${canonical}"/>
<link rel="alternate" hreflang="zh-CN" href="${zhHref}"/>
<link rel="alternate" hreflang="en" href="${enHref}"/>
<link rel="alternate" hreflang="x-default" href="${zhHref}"/>
<meta property="og:type" content="${ogType}"/>
<meta property="og:site_name" content="WeMedia Creator Workstation"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:url" content="${canonical}"/>
<meta property="og:image" content="${ogImage}"/>
<meta property="og:locale" content="${lang === 'en' ? 'en_US' : 'zh_CN'}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${ogImage}"/>
<link rel="icon" type="image/png" href="${asset('img-1.png')}"/>
<link rel="stylesheet" href="${asset('fonts-text.css')}"/>
<link rel="stylesheet" href="${asset('fonts-icons2.css')}"/>
<link rel="stylesheet" href="${asset('site.css')}"/>
<script>window.__SITE__=${config};</script>
${ld}
</head>`;
}

export function layout({
  lang,
  route,
  title,
  description,
  body,
  jsonLd = [],
  ogType = 'website',
  noindex = false,
  mainClass = '',
  bodyClass = '',
}) {
  return `${head({ lang, route, title, description, jsonLd, ogType, noindex })}
<body class="bg-background font-body-md text-on-surface antialiased overflow-x-hidden pb-20 xl:pb-0 ${bodyClass}">
<a class="skip-link" href="#main">${lang === 'en' ? 'Skip to content' : '跳到主要内容'}</a>
${header({ lang, route })}
<main id="main" class="w-full pt-20 bg-background max-w-[1440px] mx-auto px-margin ${mainClass}">${body}</main>
${footer({ lang })}
${mobileCta({ lang })}
<script src="${asset('site.js')}" defer></script>
</body>
</html>`;
}

export function breadcrumbs({ lang, items }) {
  const t = ui(lang);
  const links = items
    .map((item, idx) => {
      const last = idx === items.length - 1;
      if (last) return `<span class="text-on-surface" aria-current="page">${esc(item.label)}</span>`;
      return `<a class="hover:text-on-surface transition-colors" href="${routeTo(item.route, lang)}">${esc(item.label)}</a><span class="material-symbols-outlined text-[14px]">chevron_right</span>`;
    })
    .join('');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.label,
      item: absolute(item.route, lang),
    })),
  };
  return {
    html: `<nav class="flex items-center gap-1.5 text-body-sm font-body-sm text-on-surface-variant pt-space-lg" aria-label="${lang === 'en' ? 'Breadcrumb' : '面包屑'}">${links}</nav>`,
    jsonLd: ld,
  };
}

export { ui as translate };
