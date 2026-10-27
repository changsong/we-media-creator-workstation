import { SITE_URL, SITE_BASE, VERSION, RELEASES, PLANS, PLATFORMS, PLAN_FEATURES_ZH, PLAN_FEATURES_EN, faqTopics } from '../config.mjs';
import { BLOG_POSTS, findPost } from '../data/blog.mjs';
import { FEATURE_BLOCKS } from '../data/features.mjs';
import { USE_CASES } from '../data/use-cases.mjs';
import { PLATFORM_DETAILS } from '../data/platforms.mjs';
import { LEGAL } from '../data/legal.mjs';
import { CHANGELOG } from '../data/changelog.mjs';
import { absolute, asset, breadcrumbs, esc, layout, routeTo } from './layout.mjs';
import { ui } from './i18n.mjs';
import {
  checkoutUrl,
  faqList,
  feedbackBand,
  finalCta,
  icon,
  pageHero,
  pricingCards,
  primaryButton,
  secondaryButton,
  sectionHeading,
  table,
} from './components.mjs';

const L = (lang, zh, en) => (lang === 'en' ? en : zh);

function rich(text, lang) {
  return esc(text).replace(/\{\{link:([^|]+)\|([^}]+)\}\}/g, (_m, route, label) => {
    return `<a href="${routeTo(route.trim(), lang)}">${esc(label)}</a>`;
  });
}

function crumb(lang, items) {
  return breadcrumbs({ lang, items });
}

function formatDate(iso, lang) {
  const date = String(iso || '').slice(0, 10);
  return lang === 'en' ? date : date.replace(/-/g, '.');
}

function formatSize(bytes) {
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
}

function page({ lang, route, title, description, body, jsonLd = [], priority = 0.7, lastmod, noindex = false, ogType = 'website' }) {
  return {
    lang,
    route,
    priority,
    lastmod,
    noindex,
    html: layout({ lang, route, title, description, body, jsonLd, noindex, ogType }),
  };
}

function contentSection({ id = '', className = '', body }) {
  return `<section${id ? ` id="${id}"` : ''} class="w-full py-space-2xl scroll-mt-28 ${className}">${body}</section>`;
}

function ctaPanel(lang, { title, body, primaryLabel, primaryHref, secondaryLabel, secondaryHref }) {
  return `<section class="w-full py-space-2xl mb-space-lg">
  <div class="max-w-6xl mx-auto rounded-3xl bg-canvas-dark text-text-light-primary p-8 md:p-12 relative overflow-hidden flex flex-col md:flex-row md:items-center md:justify-between gap-8">
    <div class="absolute -top-20 right-10 w-80 h-80 bg-gold-accent/20 rounded-full blur-[100px] pointer-events-none"></div>
    <div class="relative z-10 max-w-xl">
      <h2 class="font-headline-lg text-headline-lg text-text-light-primary mb-3">${esc(title)}</h2>
      <p class="font-body-md text-body-md text-text-light-secondary">${esc(body)}</p>
    </div>
    <div class="relative z-10 flex flex-wrap gap-3 shrink-0">
      <a class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark font-label-capsule text-label-capsule transition-colors" href="${primaryHref}">${icon('download', 'text-[18px] fill')}${esc(primaryLabel)}</a>
      ${secondaryLabel ? `<a class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-surface-dark hover:bg-surface-dark-elevated text-text-light-primary font-label-capsule text-label-capsule transition-colors" href="${secondaryHref}">${esc(secondaryLabel)}</a>` : ''}
    </div>
  </div>
</section>`;
}

/* ------------------------------------------------------------- Features */

const FEATURE_HERO = {
  zh: {
    eyebrow: '功能特性',
    title: '把八个平台的工作，压进一张工作台',
    desc: '从选题到复盘，每一步都留在同一个本地应用里。没有云端账号，也没有重复填写的表单。',
  },
  en: {
    eyebrow: 'Features',
    title: 'Eight platforms of work, one workbench',
    desc: 'From the first idea to the final review, every step stays in one local app. No cloud account and no repeated forms.',
  },
};

const FEATURE_STATS = {
  ideas: {
    zh: [['0–10', '爆款潜力评分'], ['标签', '平台与角度'], ['CSV', '随时导出']],
    en: [['0–10', 'potential score'], ['Tags', 'platform and angle'], ['CSV', 'export anytime']],
  },
  calendar: {
    zh: [['9', '个制作阶段'], ['1', '张月度时间轴'], ['多选', '负责人与平台']],
    en: [['9', 'production stages'], ['1', 'monthly timeline'], ['Multi', 'owners and platforms']],
  },
  publish: {
    zh: [['8', '个平台统一队列'], ['固定', '浏览器窗口尺寸'], ['核验', '发布结果自动确认']],
    en: [['8', 'platforms in one queue'], ['Fixed', 'browser window size'], ['Verify', 'results checked for you']],
  },
  analytics: {
    zh: [['4', '个平台自动回流'], ['3', '种比率自动计算'], ['CSV', 'Excel 直接打开']],
    en: [['4', 'platforms sync automatically'], ['3', 'rates calculated'], ['CSV', 'opens in Excel']],
  },
  library: {
    zh: [['成稿', '与配图说明'], ['关键词', '串联选题与复盘'], ['语音', '复盘直接归档']],
    en: [['Copy', 'and image notes'], ['Keywords', 'link ideas and reviews'], ['Voice', 'memos archived directly']],
  },
  connect: {
    zh: [['扫码', '独立浏览器窗口'], ['本机', 'Cookie 不上传'], ['0', 'API 申请']],
    en: [['QR', 'isolated browser window'], ['Local', 'cookies never uploaded'], ['0', 'API applications']],
  },
};

function featuresPage(lang) {
  const hero = FEATURE_HERO[lang] || FEATURE_HERO.zh;
  const isEn = lang === 'en';
  const nav = FEATURE_BLOCKS.map(
    (b, i) => `<a class="inline-flex items-center gap-2 rounded-full bg-surface-white px-4 py-2 font-label-capsule text-body-sm text-on-surface shadow-sm hover:shadow transition-shadow" href="#${b.id}"><span class="text-primary">0${i + 1}</span>${esc(isEn ? b.titleEn : b.titleZh)}</a>`,
  ).join('');

  const blocks = FEATURE_BLOCKS.map((b, i) => {
    const title = isEn ? b.titleEn : b.titleZh;
    const body = isEn ? b.bodyEn : b.bodyZh;
    const bullets = isEn ? b.bulletsEn : b.bulletsZh;
    const stats = (FEATURE_STATS[b.id][lang] || FEATURE_STATS[b.id].zh);
    const copy = `<div>
      <span class="section-eyebrow">0${i + 1} / 06</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface mt-2 mb-3">${esc(title)}</h2>
      <p class="font-body-md text-body-md text-on-surface-variant mb-5">${esc(body)}</p>
      <ul class="space-y-3">
        ${bullets.map((item) => `<li class="flex items-start gap-2 font-body-sm text-body-sm text-on-surface">${icon('check_circle', 'text-[18px] text-status-success mt-px')}<span>${esc(item)}</span></li>`).join('')}
      </ul>
      ${b.id === 'publish' ? `<a class="mt-5 inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary hover:gap-2 transition-all" href="${routeTo('/download/', lang)}">${isEn ? 'Try the publish queue' : '下载体验发布队列'} ${icon('arrow_forward', 'text-[16px]')}</a>` : ''}
    </div>`;
    const panel = `<div class="relative overflow-hidden rounded-3xl bg-canvas-dark p-6 sm:p-8 text-text-light-secondary shadow-xl shadow-canvas-dark/10">
      <div class="absolute -top-16 -right-10 w-52 h-52 bg-gold-accent/15 rounded-full blur-3xl pointer-events-none"></div>
      <div class="relative z-10 flex items-start justify-between">
        <div class="w-12 h-12 rounded-full bg-surface-dark flex items-center justify-center text-gold-accent">${icon(b.icon, 'text-[26px]')}</div>
        <span class="rounded-full bg-surface-dark px-3 py-1 font-label-capsule text-[11px] uppercase tracking-wider text-text-light-secondary">${b.id}</span>
      </div>
      <div class="relative z-10 mt-8 grid grid-cols-3 gap-3">
        ${stats.map(([value, label]) => `<div class="rounded-xl bg-surface-dark/70 p-3"><div class="font-headline-sm text-headline-sm text-text-light-primary">${esc(value)}</div><div class="font-body-sm text-[11px] text-text-light-secondary mt-0.5">${esc(label)}</div></div>`).join('')}
      </div>
      <div class="relative z-10 mt-4 rounded-xl border border-border-dark p-4 font-body-sm text-body-sm text-text-light-secondary">${esc(bullets[0])}</div>
    </div>`;
    return contentSection({
      id: b.id,
      body: `<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-space-xl items-center">
        ${i % 2 === 0 ? copy + panel : panel + copy}
      </div>`,
    });
  }).join('\n');

  const body = [
    pageHero({
      lang,
      eyebrow: hero.eyebrow,
      title: hero.title,
      description: hero.desc,
      breadcrumbHtml: crumb(lang, [
        { label: isEn ? 'Home' : '首页', route: '/' },
        { label: hero.eyebrow, route: '/features/' },
      ]).html,
      actions: primaryButton({ href: routeTo('/download/', lang), label: isEn ? 'Download desktop app' : '下载桌面版', download: true }) + secondaryButton({ href: routeTo('/pricing/', lang), label: isEn ? 'See pricing' : '查看价格' }),
    }),
    `<div class="max-w-6xl mx-auto flex flex-wrap gap-2 pb-space-lg">${nav}</div>`,
    blocks,
    `<section class="w-full py-space-2xl"><div class="max-w-6xl mx-auto rounded-3xl bg-surface-white p-6 sm:p-8 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-gutter">
      ${[
        ['lock', isEn ? 'Local by default' : '默认本地', isEn ? 'Schedules, assets, and analytics live in a local SQLite database.' : '排期、素材与复盘数据都存在本机 SQLite 数据库里。'],
        ['bolt', isEn ? 'No API keys' : '无需 API', isEn ? 'Sign in by QR code in an isolated browser window. No developer account.' : '独立浏览器窗口扫码登录，不需要开发者资质。'],
        ['autorenew', isEn ? 'Kept current' : '持续适配', isEn ? 'Compatibility updates ship as platforms change their pages.' : '平台改版时推送适配补丁，发布任务可安全重试。'],
      ].map(([ic, title, desc]) => `<div class="flex items-start gap-3"><div class="w-10 h-10 shrink-0 rounded-full bg-surface-container-low flex items-center justify-center text-primary">${icon(ic, 'text-[20px]')}</div><div><div class="font-headline-sm text-[16px] text-on-surface font-semibold">${esc(title)}</div><p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${esc(desc)}</p></div></div>`).join('')}
    </div></section>`,
    finalCta({ lang }),
  ].join('\n');

  return page({
    lang,
    route: '/features/',
    title: isEn ? 'Features — planning, scheduling, publishing, analytics' : '功能特性｜选题、排期、八平台发布与数据复盘',
    description: isEn
      ? 'Explore the idea pool, content calendar, publish queue, automatic analytics, asset library, and one-click sign-in in WeMedia Creator Workstation.'
      : '了解 WeMedia 工作台的选题池、内容日历、八平台发布队列、自动数据复盘、素材库与一键登录能力。',
    body,
    priority: 0.9,
  });
}

/* ------------------------------------------------------------ Platforms */

const PLATFORM_HERO = {
  zh: {
    eyebrow: '支持平台',
    title: '八个平台，一套发布流程',
    desc: '自动发布覆盖八个平台，自动数据回流覆盖四个。每个平台的规则、封面比例与限制，都在各自的指南里写清楚。',
  },
  en: {
    eyebrow: 'Platforms',
    title: 'Eight platforms, one publishing flow',
    desc: 'Publishing covers eight platforms; automatic analytics covers four. Each guide spells out formats, cover ratios, and limits.',
  },
};

function platformsPage(lang) {
  const hero = PLATFORM_HERO[lang] || PLATFORM_HERO.zh;
  const isEn = lang === 'en';
  const rows = PLATFORMS.map((p) => [
    `<a class="inline-flex items-center gap-2 hover:text-on-surface" href="${routeTo(`/platforms/${p.id}/`, lang)}"><span class="inline-flex h-6 w-6 items-center justify-center rounded-full ${p.dot} text-[11px] font-bold text-white">${esc(isEn ? p.markEn : p.markZh)}</span>${esc(isEn ? p.nameEn : p.nameZh)}</a>`,
    esc(isEn ? p.formatsEn : p.formatsZh),
    `${icon('check_circle', 'text-[18px] text-status-success')} ${isEn ? 'Supported' : '支持'}`,
    p.dataBack ? `${icon('check_circle', 'text-[18px] text-status-success')} ${isEn ? 'Automatic' : '自动回流'}` : `<span class="text-on-surface-variant">${isEn ? 'Manual entry' : '手动记录'}</span>`,
  ]);

  const cards = PLATFORMS.map((p) => `<a class="group rounded-2xl bg-surface-white p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between" href="${routeTo(`/platforms/${p.id}/`, lang)}">
    <div>
      <div class="flex items-center gap-3">
        <span class="inline-flex h-10 w-10 items-center justify-center rounded-full ${p.dot} text-sm font-bold text-white">${esc(isEn ? p.markEn : p.markZh)}</span>
        <div>
          <div class="font-headline-sm text-headline-sm text-on-surface">${esc(isEn ? p.nameEn : p.nameZh)}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(isEn ? p.formatsEn : p.formatsZh)}</div>
        </div>
      </div>
      <p class="mt-4 font-body-sm text-body-sm text-on-surface-variant">${esc(isEn ? p.noteEn : p.noteZh)}</p>
    </div>
    <div class="mt-5 flex items-center justify-between">
      <span class="rounded-full px-2.5 py-1 font-label-capsule text-[11px] ${p.dataBack ? 'bg-status-success/10 text-status-success' : 'bg-surface-container-low text-on-surface-variant'}">${esc(p.dataBack ? (isEn ? 'Analytics' : '自动数据') : (isEn ? 'No analytics yet' : '暂未回流'))}</span>
      <span class="inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary group-hover:gap-2 transition-all">${isEn ? 'Guide' : '平台指南'} ${icon('arrow_forward', 'text-[16px]')}</span>
    </div>
  </a>`).join('');

  const body = [
    pageHero({
      lang,
      eyebrow: hero.eyebrow,
      title: hero.title,
      description: hero.desc,
      breadcrumbHtml: crumb(lang, [
        { label: isEn ? 'Home' : '首页', route: '/' },
        { label: hero.eyebrow, route: '/platforms/' },
      ]).html,
      actions: primaryButton({ href: routeTo('/download/', lang), label: isEn ? 'Download desktop app' : '下载桌面版', download: true }) + secondaryButton({ href: routeTo('/features/#publish', lang), label: isEn ? 'How publishing works' : '了解发布流程' }),
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'Coverage at a glance' : '支持矩阵', title: isEn ? 'What is automatic, and what is manual' : '哪些是自动的，哪些需要手动', desc: isEn ? 'Publishing is automatic on all eight. Analytics is automatic on four; the rest can be entered manually in the review table.' : '八个平台都能自动发布；数据自动回流覆盖四个平台，其余平台可在复盘表中手动记录。' })}
        ${table({ head: [isEn ? 'Platform' : '平台', isEn ? 'Formats' : '内容形式', isEn ? 'Publishing' : '自动发布', isEn ? 'Analytics' : '数据回流'], rows })}
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'Platform guides' : '平台指南', title: isEn ? 'Pick a platform to see the details' : '选择一个平台，查看具体规则', desc: isEn ? 'Formats, cover ratios, verification, and what to expect after publishing.' : '内容形式、封面比例、结果核验，以及发布之后会发生什么。' })}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">${cards}</div>
      </div>`,
    }),
    finalCta({ lang }),
  ].join('\n');

  return page({
    lang,
    route: '/platforms/',
    title: isEn ? 'Supported platforms — eight Chinese social networks' : '支持平台｜抖音、视频号、小红书、公众号等 8 个平台',
    description: isEn
      ? 'Publishing support for Douyin, WeChat Channels, Xiaohongshu, Official Accounts, Bilibili, Kuaishou, Weibo, and Zhihu, with automatic analytics on four.'
      : '支持抖音、视频号、小红书、公众号、B站、快手、微博、知乎八个平台发布，其中四个平台支持数据自动回流。',
    body,
    priority: 0.9,
  });
}

function platformPage(lang, slug) {
  const p = PLATFORMS.find((item) => item.id === slug);
  const detail = PLATFORM_DETAILS[slug]?.[lang];
  if (!p || !detail) return null;
  const isEn = lang === 'en';
  const name = isEn ? p.nameEn : p.nameZh;
  const total = detail.manual.reduce((sum, [, time]) => sum + (Number(String(time).replace(/[^\d]/g, '')) || 0), 0);
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: isEn ? 'Platforms' : '支持平台', route: '/platforms/' },
    { label: name, route: `/platforms/${slug}/` },
  ]);

  const caps = detail.capabilities.map(([title, desc]) => `<div class="rounded-2xl bg-surface-white p-5 shadow-sm">
    <div class="font-headline-sm text-[16px] text-on-surface font-semibold mb-1">${esc(title)}</div>
    <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(desc)}</p>
  </div>`).join('');

  const manual = detail.manual.map(([action, time]) => `<li class="flex items-center justify-between gap-4 border-b border-border-light py-3 last:border-0"><span class="font-body-sm text-body-sm text-on-surface-variant">${esc(action)}</span><span class="shrink-0 font-label-capsule text-body-sm text-on-surface">${esc(time)}</span></li>`).join('');
  const appSteps = [
    ['event', isEn ? 'Schedule the post once' : '排一次期', isEn ? 'Set the platform, time, and pre-cropped cover.' : '选好平台、时间和提前裁好的封面。'],
    ['rocket_launch', isEn ? 'It publishes on time' : '到点自动发布', isEn ? 'The local browser wakes up and publishes with your session.' : '本机浏览器唤起，用你的登录态发布。'],
    ['fact_check', isEn ? 'The result is verified' : '发布后自动核验', isEn ? 'Failures stay in the queue and can be retried.' : '失败任务留在队列里，可安全重试。'],
    [p.dataBack ? 'insights' : 'edit_note', p.dataBack ? (isEn ? 'Analytics flow back' : '数据自动回流') : (isEn ? 'Log key numbers' : '手动记录关键数据'), p.dataBack ? (isEn ? 'Views, likes, and growth land in your review table.' : '播放、点赞与涨粉回到复盘表。') : (isEn ? 'Automatic analytics is not covered yet; add key numbers manually.' : '该平台暂未覆盖自动回流，可在复盘表手动补充。')],
  ].map(([ic, title, desc]) => `<li class="flex items-start gap-3"><div class="w-9 h-9 shrink-0 rounded-full bg-surface-dark flex items-center justify-center text-gold-accent">${icon(ic, 'text-[18px]')}</div><div><div class="font-label-capsule text-label-capsule text-text-light-primary">${esc(title)}</div><p class="font-body-sm text-body-sm text-text-light-secondary mt-0.5">${esc(desc)}</p></div></li>`).join('');

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: detail.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };

  const others = PLATFORMS.filter((item) => item.id !== slug)
    .map((item) => `<a class="flex items-center gap-2 rounded-full bg-surface-white px-3.5 py-2 shadow-sm hover:shadow transition-shadow font-label-capsule text-body-sm text-on-surface" href="${routeTo(`/platforms/${item.id}/`, lang)}"><span class="inline-flex h-5 w-5 items-center justify-center rounded-full ${item.dot} text-[10px] font-bold text-white">${esc(isEn ? item.markEn : item.markZh)}</span>${esc(isEn ? item.nameEn : item.nameZh)}</a>`)
    .join('');

  const body = [
    pageHero({
      lang,
      eyebrow: name,
      title: esc(detail.h1),
      description: detail.intro,
      breadcrumbHtml: bc.html,
      actions: primaryButton({ href: routeTo('/download/', lang), label: isEn ? `Download — publish to ${name}` : `下载桌面版，发布到${name}`, download: true }) + secondaryButton({ href: routeTo('/platforms/', lang), label: isEn ? 'All platforms' : '全部平台' }),
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'What the app handles' : '工作台能做什么', title: isEn ? `Publishing to ${name}, handled` : `${name}的发布与记录，交给工作台`, center: false })}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">${caps}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-gutter items-stretch">
        <div class="rounded-3xl bg-surface-white p-6 sm:p-8 shadow-sm">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-headline-md text-headline-md text-on-surface">${isEn ? 'Doing it by hand' : '手动发布一次'}</h2>
            <span class="rounded-full bg-error-container/40 px-3 py-1 font-label-capsule text-[11px] text-on-error-container">≈ ${total} ${isEn ? 'min' : '分钟'}</span>
          </div>
          <ul>${manual}</ul>
          <p class="mt-4 font-body-sm text-body-sm text-on-surface-variant">${isEn ? 'Every post repeats these steps — and the numbers still need copying later.' : '每发一条都要重复一遍，数据还要另外抄。'}</p>
        </div>
        <div class="rounded-3xl bg-canvas-dark p-6 sm:p-8 text-text-light-secondary shadow-sm">
          <h2 class="font-headline-md text-headline-md text-text-light-primary mb-5">${isEn ? 'With the workbench' : '用工作台发布'}</h2>
          <ul class="space-y-4">${appSteps}</ul>
          <p class="mt-6 rounded-xl border border-border-dark bg-surface-dark/60 p-3 font-body-sm text-body-sm">${isEn ? 'Your computer stays on; the app can sit in the tray.' : '电脑保持开机即可，客户端可以最小化到托盘。'}</p>
        </div>
      </div>`,
    }),
    contentSection({
      id: 'platform-faq',
      body: `<div class="max-w-4xl mx-auto">
        ${sectionHeading({ lang, eyebrow: 'FAQ', title: isEn ? `${name} questions` : `关于${name}的常见问题` })}
        <div class="space-y-3">${faqList({ lang, items: detail.faq })}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto rounded-3xl bg-surface-container-low/70 p-6 sm:p-8">
        <div class="font-label-capsule text-label-capsule text-on-surface-variant uppercase tracking-wider mb-4">${isEn ? 'Other platforms' : '其他平台'}</div>
        <div class="flex flex-wrap gap-2">${others}</div>
      </div>`,
    }),
    finalCta({ lang }),
  ].join('\n');

  return page({
    lang,
    route: `/platforms/${slug}/`,
    title: isEn ? `${name} publishing & analytics — WeMedia Workstation` : `${name}发布与数据复盘｜自媒体内容运营工作台`,
    description: (isEn ? detail.intro : detail.intro).slice(0, 150),
    body,
    jsonLd: [bc.jsonLd, faqLd],
    priority: 0.8,
  });
}

/* --------------------------------------------------------------- Pricing */

function pricingPage(lang, checkout = '') {
  const isEn = lang === 'en';
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: isEn ? 'Pricing' : '价格方案', route: '/pricing/' },
  ]);
  const purchase = faqTopics[lang].find((group) => group.group === (isEn ? 'Purchasing' : '购买'))?.items || [];
  const included = isEn ? PLAN_FEATURES_EN : PLAN_FEATURES_ZH;
  const stats = isEn
    ? [['$120', '12 months paid monthly'], ['$100', 'yearly — save $20'], ['$200', 'lifetime — about 20 months of monthly']]
    : [['¥598.8', '按月付满一年'], ['¥500', '年付，省 ¥98.8'], ['¥980', '终身，约等于 20 个月月付']];

  const body = [
    pageHero({
      lang,
      eyebrow: isEn ? 'Pricing' : '价格方案',
      title: isEn ? 'One license. Three ways to pay.' : '一份授权，三种买法',
      description: isEn
        ? 'Every plan includes all features and all eight platforms. Only the billing rhythm and duration differ — no cut-down tiers.'
        : '所有方案都包含全部功能与八个平台，区别只在付费周期与有效期。没有功能阉割版本，也没有隐藏加价。',
      breadcrumbHtml: bc.html,
      actions: primaryButton({ href: routeTo('/download/', lang), label: isEn ? 'Download free first' : '先免费下载体验', download: true }),
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter items-stretch">${pricingCards({ lang, detailed: true, checkout })}</div>
        <p class="mt-6 text-center font-body-sm text-body-sm text-on-surface-variant">${isEn ? 'Prices are in USD. A license activates up to three devices. Checkout shows the final refund terms.' : '价格为人民币（CNY）。每份授权最多同时激活 3 台设备，退款条款以购买页为准。'}</p>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto rounded-3xl bg-canvas-dark p-6 sm:p-10 text-text-light-secondary">
        <div class="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <span class="font-label-capsule text-label-capsule text-gold-accent uppercase tracking-wider">${isEn ? 'Simple arithmetic' : '算一笔简单的账'}</span>
            <h2 class="font-headline-lg text-headline-lg text-text-light-primary mt-1">${isEn ? 'What each plan costs over time' : '三种买法，长期差多少'}</h2>
          </div>
          <p class="font-body-sm text-body-sm max-w-md">${isEn ? 'Yearly saves about 17% versus monthly. Lifetime pays for itself around month 20.' : '年付比月付省约 16.5%；终身版大约在第 20 个月追上月付总支出，之后不再付费。'}</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          ${stats.map(([value, label]) => `<div class="rounded-2xl bg-surface-dark/60 border border-border-dark p-5"><div class="font-headline-lg text-headline-lg text-text-light-primary">${esc(value)}</div><div class="font-body-sm text-body-sm mt-1">${esc(label)}</div></div>`).join('')}
        </div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        <div class="rounded-3xl bg-surface-white p-6 sm:p-8 shadow-sm">
          <h2 class="font-headline-md text-headline-md text-on-surface mb-2">${isEn ? 'Included in every plan' : '每个方案都包含'}</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant mb-5">${isEn ? 'No tier locks away a feature.' : '不设功能墙，不按价格拆分能力。'}</p>
          <ul class="space-y-3">${included.map((item) => `<li class="check-item">${icon('check_circle')} <span>${esc(item)}</span></li>`).join('')}</ul>
        </div>
        <div class="rounded-3xl bg-surface-white p-6 sm:p-8 shadow-sm">
          <h2 class="font-headline-md text-headline-md text-on-surface mb-2">${isEn ? 'Licensing and refunds' : '授权与退款'}</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant mb-4">${isEn ? 'Questions we get before checkout.' : '购买前最常问的几件事。'}</p>
          <div class="space-y-3">${faqList({ lang, items: purchase.slice(0, 3).map((item) => [item.q, item.a]) })}</div>
          <a class="mt-4 inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary hover:gap-2 transition-all" href="${routeTo('/faq/#purchase', lang)}">${isEn ? 'More purchasing questions' : '查看全部购买问题'} ${icon('arrow_forward', 'text-[16px]')}</a>
        </div>
      </div>`,
    }),
    feedbackBand({ lang }),
    finalCta({ lang }),
  ].join('\n');

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: isEn ? 'WeMedia Creator Workstation' : '自媒体内容运营工作台',
    description: isEn
      ? 'Local-first desktop workspace for publishing to eight Chinese platforms with automatic analytics.'
      : '本地优先的自媒体桌面工作台，支持八个平台发布与四个平台数据自动回流。',
    brand: { '@type': 'Brand', name: 'WeMedia Studio' },
    offers: PLANS.map((plan) => ({
      '@type': 'Offer',
      name: isEn ? plan.nameEn : plan.nameZh,
      price: isEn ? plan.priceUsd : plan.price,
      priceCurrency: isEn ? 'USD' : 'CNY',
      availability: 'https://schema.org/InStock',
      url: absolute('/pricing/', lang),
    })),
  };

  return page({
    lang,
    route: '/pricing/',
    title: isEn ? 'Pricing — monthly $10, yearly $100, lifetime $200' : '价格方案｜月付 ¥49.9、年付 ¥500、终身 ¥980',
    description: isEn
      ? 'One license, all features, all eight platforms. Monthly $10, yearly $100 (save $20), lifetime $200. Activate up to three devices.'
      : '一份授权包含全部功能与八个平台：月付 ¥49.9、年付 ¥500（省 ¥98.8）、终身买断 ¥980，最多同时激活 3 台设备。',
    body,
    jsonLd: [bc.jsonLd, productLd],
    priority: 0.9,
  });
}

/* -------------------------------------------------------------- Download */

function downloadCard({ lang, os, iconName, title, subtitle, children }) {
  const isEn = lang === 'en';
  return `<article class="os-card relative rounded-3xl bg-surface-white p-6 shadow-sm" data-os-card="${os}">
    <div class="flex items-start justify-between">
      <div class="w-11 h-11 rounded-full bg-surface-container-low flex items-center justify-center text-primary">${icon(iconName, 'text-[22px]')}</div>
      <span class="os-detected-badge hidden items-center gap-1 rounded-full bg-gold-subtle px-2.5 py-1 font-label-capsule text-[11px] text-primary">${icon('check_circle', 'text-[14px]')}${isEn ? 'Detected' : '当前系统'}</span>
    </div>
    <div class="mt-4 font-headline-md text-headline-md text-on-surface">${esc(title)}</div>
    <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(subtitle)}</div>
    <div class="mt-5 space-y-3">${children}</div>
  </article>`;
}

function downloadRow({ lang, label, file, primary = false, note = '' }) {
  const btn = lang === 'en' ? 'Download' : '下载';
  return `<div class="rounded-xl border border-border-light p-3">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="font-label-capsule text-label-capsule text-on-surface">${esc(label)}</div>
        <div class="font-body-sm text-[11px] text-on-surface-variant truncate">${esc(file.name)} · ${formatSize(file.size)}</div>
      </div>
      <a class="shrink-0 inline-flex items-center gap-1.5 rounded-full ${primary ? 'bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark' : 'bg-surface-container-low hover:bg-surface-container text-on-surface'} px-4 py-2 font-label-capsule text-body-sm transition-colors" href="${esc(file.url)}" download>${icon('download', 'text-[16px]')}${btn}</a>
    </div>
    ${note ? `<p class="mt-2 font-body-sm text-[11px] text-on-surface-variant">${esc(note)}</p>` : ''}
    <details class="mt-2">
      <summary class="cursor-pointer font-body-sm text-[11px] text-on-surface-variant">SHA512</summary>
      <code class="mt-1 block break-all rounded-lg bg-surface-container-low p-2 text-[10px] text-on-surface-variant">${esc(file.sha512)}</code>
    </details>
  </div>`;
}

function downloadPage(lang) {
  const isEn = lang === 'en';
  const r = RELEASES.platforms;
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: isEn ? 'Download' : '下载', route: '/download/' },
  ]);
  const date = formatDate(RELEASES.releaseDate, lang);

  const win = r.win.x64.exe;
  const macArmDmg = r.mac.arm64.dmg;
  const macArmZip = r.mac.arm64.zip;
  const macX64Dmg = r.mac.x64.dmg;
  const macX64Zip = r.mac.x64.zip;
  const appImage = r.linux.x64.appimage;
  const deb = r.linux.x64.deb;

  const cards = [
    downloadCard({
      lang,
      os: 'win',
      iconName: 'desktop_windows',
      title: 'Windows',
      subtitle: isEn ? 'Windows 10 and later · x64' : 'Windows 10 及以上 · x64',
      children: downloadRow({ lang, label: isEn ? 'NSIS installer (.exe)' : 'NSIS 安装包 (.exe)', file: win, primary: true }) +
        `<p class="font-body-sm text-[11px] text-on-surface-variant">${isEn ? 'Installs per user without administrator rights. SmartScreen may warn because the build is unsigned.' : '按当前用户安装，无需管理员权限。构建未签名，SmartScreen 可能提示，选择“更多信息 → 仍要运行”即可。'}</p>`,
    }),
    downloadCard({
      lang,
      os: 'mac',
      iconName: 'laptop_mac',
      title: 'macOS',
      subtitle: isEn ? 'macOS 11 and later · Apple Silicon & Intel' : 'macOS 11 及以上 · Apple Silicon 与 Intel',
      children: downloadRow({ lang, label: isEn ? 'Apple Silicon (.dmg)' : 'Apple Silicon 芯片 (.dmg)', file: macArmDmg, primary: true }) +
        downloadRow({ lang, label: isEn ? 'Intel (.dmg)' : 'Intel 芯片 (.dmg)', file: macX64Dmg }) +
        `<details class="rounded-xl border border-border-light p-3">
          <summary class="cursor-pointer font-label-capsule text-label-capsule text-on-surface">${isEn ? 'Zip archives (alternative)' : 'Zip 压缩包（备用）'}</summary>
          <div class="mt-2 space-y-2 font-body-sm text-body-sm">
            <a class="block text-primary underline decoration-gold-accent underline-offset-2" href="${esc(macArmZip.url)}" download>${esc(macArmZip.name)} · ${formatSize(macArmZip.size)}</a>
            <a class="block text-primary underline decoration-gold-accent underline-offset-2" href="${esc(macX64Zip.url)}" download>${esc(macX64Zip.name)} · ${formatSize(macX64Zip.size)}</a>
          </div>
        </details>
        <p class="font-body-sm text-[11px] text-on-surface-variant">${isEn ? 'Unsigned build: right-click the app and choose Open the first time. macOS does not auto-update.' : '构建未签名：首次打开请右键应用选择“打开”。macOS 版不启用自动更新，需要手动下载新版本。'}</p>`,
    }),
    downloadCard({
      lang,
      os: 'linux',
      iconName: 'terminal',
      title: 'Linux',
      subtitle: isEn ? 'Ubuntu 22.04 and later · x64' : 'Ubuntu 22.04 及以上 · x64',
      children: downloadRow({ lang, label: 'AppImage', file: appImage, primary: true }) +
        downloadRow({ lang, label: '.deb', file: deb }) +
        `<p class="font-body-sm text-[11px] text-on-surface-variant">${isEn ? 'AppImage: chmod +x and run. Deb: install with your package manager. Auto-update works for AppImage.' : 'AppImage：chmod +x 后直接运行。deb：使用系统包管理器安装。AppImage 支持自动更新。'}</p>`,
    }),
  ].join('');

  const steps = [
    ['download', isEn ? 'Download' : '下载', isEn ? 'Pick the installer for your system. The highlighted card is your current OS.' : '选择对应系统的安装包，上方会自动标出当前系统。'],
    ['install_desktop', isEn ? 'Install & sign in' : '安装并登录', isEn ? 'Install, open the app, and scan the QR code once per platform you use.' : '安装后打开应用，为常用平台各扫码登录一次。'],
    ['schedule', isEn ? 'Schedule your first post' : '排期第一条内容', isEn ? 'Add a post to the publish center and let it run on time.' : '把第一条内容放进发布中心，让它在设定时间自动发布。'],
  ].map(([ic, title, desc], i) => `<div class="rounded-2xl bg-surface-white p-5 shadow-sm">
    <div class="flex items-center gap-3 mb-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-canvas-dark text-[11px] font-bold text-gold-accent">0${i + 1}</span><span class="text-primary">${icon(ic, 'text-[20px]')}</span></div>
    <div class="font-headline-sm text-[16px] text-on-surface font-semibold">${esc(title)}</div>
    <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${esc(desc)}</p>
  </div>`).join('');

  const body = [
    pageHero({
      lang,
      eyebrow: isEn ? 'Download' : '下载桌面版',
      title: isEn ? `Get v${VERSION} for your computer` : `下载 v${VERSION}，装到你的电脑上`,
      description: isEn
        ? 'A local-first desktop app for Windows, macOS, and Linux. Install it, sign in by QR code, and schedule your first post in minutes.'
        : 'Windows、macOS、Linux 三个系统的本地桌面应用。安装后扫码登录，几分钟内就能排好第一条内容。',
      breadcrumbHtml: bc.html,
      actions: `<span class="inline-flex items-center gap-2 rounded-full bg-surface-white px-4 py-2 font-label-capsule text-body-sm text-on-surface-variant shadow-sm">${icon('verified', 'text-[16px] text-status-success')} ${isEn ? `Version ${VERSION} · released ${date}` : `版本 ${VERSION} · 更新于 ${date}`}</span>`,
    }),
    `<p hidden data-os-banner data-label-win="${esc(isEn ? 'Windows detected — the highlighted installer below matches your system.' : '检测到 Windows，下方已加亮对应的安装包。')}" data-label-mac="${esc(isEn ? 'macOS detected — pick Apple Silicon or Intel below.' : '检测到 macOS，请在下方选择 Apple Silicon 或 Intel 版本。')}" data-label-linux="${esc(isEn ? 'Linux detected — AppImage is the quickest option.' : '检测到 Linux，AppImage 是最快的安装方式。')}" class="max-w-6xl mx-auto mb-4 font-body-sm text-body-sm text-status-success"></p>`,
    `<div class="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-gutter">${cards}</div>`,
    `<div class="max-w-6xl mx-auto mt-4 rounded-2xl bg-surface-container-low/70 px-5 py-4 font-body-sm text-body-sm text-on-surface-variant flex items-start gap-2">${icon('info', 'text-[18px] text-primary mt-0.5')}<span>${isEn ? 'The desktop app needs a local Chrome or Edge installation for publishing. Mobile phones are not supported; the app is a desktop workbench.' : '发布依赖本机安装的 Chrome 或 Edge 浏览器。暂不支持手机端，工作台是桌面应用。'}</span></div>`,
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'First run' : '第一次使用', title: isEn ? 'Three steps to your first scheduled post' : '三步完成第一次排期' })}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter">${steps}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        <div class="rounded-3xl bg-surface-white p-6 sm:p-8 shadow-sm">
          <h2 class="font-headline-md text-headline-md text-on-surface mb-4">${isEn ? 'System requirements' : '系统要求'}</h2>
          <ul class="space-y-3 font-body-sm text-body-sm text-on-surface">
            <li class="check-item">${icon('check_circle')}<span>Windows 10+ / macOS 11+ / Ubuntu 22.04+</span></li>
            <li class="check-item">${icon('check_circle')}<span>${isEn ? 'Chrome or Edge installed on the same machine' : '同一台电脑安装 Chrome 或 Edge'}</span></li>
            <li class="check-item">${icon('check_circle')}<span>${isEn ? 'About 500 MB for the app plus your media files' : '应用约 500 MB，另需空间存放素材'}</span></li>
            <li class="check-item">${icon('check_circle')}<span>${isEn ? 'The computer must stay on for scheduled publishing' : '定时发布时电脑需保持开机'}</span></li>
          </ul>
        </div>
        <div class="rounded-3xl bg-canvas-dark p-6 sm:p-8 text-text-light-secondary">
          <h2 class="font-headline-md text-headline-md text-text-light-primary mb-4">${isEn ? 'Updates and data' : '更新与数据'}</h2>
          <ul class="space-y-3 font-body-sm text-body-sm">
            <li class="flex items-start gap-2">${icon('autorenew', 'text-[18px] text-gold-accent mt-0.5')}<span>${isEn ? 'Windows and Linux AppImage update automatically. deb and macOS users download new versions manually.' : 'Windows 与 Linux AppImage 自动更新；deb 与 macOS 用户手动下载新版本。'}</span></li>
            <li class="flex items-start gap-2">${icon('database', 'text-[18px] text-gold-accent mt-0.5')}<span>${isEn ? 'Data lives in a local data directory. Back it up before switching computers.' : '数据保存在本机用户数据目录，换电脑前请先备份。'}</span></li>
            <li class="flex items-start gap-2">${icon('support_agent', 'text-[18px] text-gold-accent mt-0.5')}<span>${isEn ? 'Install trouble? Send a note through the feedback form and include your OS.' : '安装遇到问题？通过反馈表单告诉我们，并附上系统版本。'}</span></li>
          </ul>
          <a class="mt-5 inline-flex items-center gap-1 font-label-capsule text-body-sm text-gold-accent hover:gap-2 transition-all" href="${routeTo('/feedback/', lang)}">${isEn ? 'Contact support' : '联系支持'} ${icon('arrow_forward', 'text-[16px]')}</a>
        </div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-4xl mx-auto">
        ${sectionHeading({ lang, eyebrow: 'FAQ', title: isEn ? 'Download questions' : '下载常见问题' })}
        <div class="space-y-3">${faqList({
          lang,
          items: isEn
            ? [
                ['Is it free to try?', 'The download is free. You can organize ideas and schedules without a license; publishing requires an active license.'],
                ['Why is the macOS build unsigned?', 'We do not yet have an Apple developer account. The dmg works, but macOS blocks automatic updates and asks you to confirm the first launch.'],
                ['Will installing remove my old data?', 'No. Reinstalling keeps the data directory. Back it up before switching computers or clearing the app.'],
              ]
            : [
                ['可以免费试用吗？', '下载免费。没有授权也可以整理选题与排期；执行自动发布需要有效授权。'],
                ['macOS 为什么未签名？', '目前还没有 Apple 开发者账号。dmg 可以正常安装，但系统会拦截自动更新，首次打开需要手动确认。'],
                ['重装会删除旧数据吗？', '不会。重装会保留数据目录；换电脑或清理应用前请先备份。'],
              ],
        })}</div>
      </div>`,
    }),
    feedbackBand({ lang }),
  ].join('\n');

  const appLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: isEn ? 'WeMedia Creator Workstation' : '自媒体内容运营工作台',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Windows 10+, macOS 11+, Ubuntu 22.04+',
    softwareVersion: VERSION,
    downloadUrl: absolute('/download/', lang),
    fileSize: formatSize(win.size),
    datePublished: String(RELEASES.releaseDate).slice(0, 10),
  };

  return page({
    lang,
    route: '/download/',
    title: isEn ? `Download v${VERSION} — Windows, macOS, Linux` : `下载 v${VERSION}｜Windows / macOS / Linux 桌面版`,
    description: isEn
      ? `Download WeMedia Creator Workstation v${VERSION} for Windows, macOS, and Linux. Local-first, no cloud account.`
      : `下载自媒体内容运营工作台 v${VERSION}，支持 Windows、macOS 与 Linux。本地优先，无需注册云账号。`,
    body,
    jsonLd: [bc.jsonLd, appLd],
    priority: 0.95,
  });
}

/* ------------------------------------------------------------- Use cases */

function useCasePage(lang, slug) {
  const data = USE_CASES[slug];
  if (!data) return null;
  const isEn = lang === 'en';
  const f = (key) => data[`${key}${isEn ? 'En' : 'Zh'}`];
  const label = isEn ? data.labelEn : data.labelZh;
  const h1 = f('h1');
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: isEn ? 'Use cases' : '使用场景', route: '/use-cases/solo/' },
    { label, route: `/use-cases/${slug}/` },
  ]);

  const story = f('story')
    .map(([time, text], i) => `<div class="relative rounded-2xl bg-surface-white p-5 shadow-sm">
      <div class="flex items-center gap-2 mb-2"><span class="inline-flex h-7 w-7 items-center justify-center rounded-full ${i === 1 ? 'bg-gold-accent text-canvas-dark' : 'bg-canvas-dark text-gold-accent'} text-[11px] font-bold">0${i + 1}</span><span class="font-label-capsule text-label-capsule text-primary">${esc(time)}</span></div>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(text)}</p>
    </div>`)
    .join('');

  const scenarios = f('scenarios')
    .map(([title, text]) => `<div class="rounded-2xl bg-surface-white p-5 shadow-sm"><div class="font-headline-sm text-[16px] text-on-surface font-semibold mb-1">${esc(title)}</div><p class="font-body-sm text-body-sm text-on-surface-variant">${esc(text)}</p></div>`)
    .join('');

  const metrics = f('metrics')
    .map(([value, note]) => `<div class="rounded-2xl bg-surface-dark/60 border border-border-dark p-5"><div class="font-headline-lg text-headline-lg text-text-light-primary">${esc(value)}</div><div class="font-body-sm text-body-sm text-text-light-secondary mt-1">${esc(note)}</div></div>`)
    .join('');

  const others = Object.entries(USE_CASES)
    .filter(([key]) => key !== slug)
    .map(([key, item]) => `<a class="group flex items-center justify-between rounded-2xl bg-surface-white p-5 shadow-sm hover:shadow-md transition-shadow" href="${routeTo(`/use-cases/${key}/`, lang)}">
      <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary">${icon(item.icon, 'text-[20px]')}</div><div><div class="font-label-capsule text-label-capsule text-on-surface">${esc(isEn ? item.labelEn : item.labelZh)}</div><div class="font-body-sm text-body-sm text-on-surface-variant">${esc(isEn ? item.h1En : item.h1Zh)}</div></div></div>
      <span class="text-primary group-hover:translate-x-0.5 transition-transform">${icon('arrow_forward', 'text-[18px]')}</span>
    </a>`).join('');

  const body = [
    pageHero({
      lang,
      eyebrow: label,
      title: esc(h1),
      description: f('intro'),
      breadcrumbHtml: bc.html,
      actions: primaryButton({ href: routeTo('/download/', lang), label: isEn ? 'Try it on your own flow' : '用自己的流程试一试', download: true }) + secondaryButton({ href: routeTo('/pricing/', lang), label: isEn ? 'See pricing' : '查看价格' }),
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'A day in the workflow' : '一天的工作流', title: isEn ? 'What the schedule changes' : '排期之后，一天变成什么样' })}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-gutter">${story}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'Common situations' : '典型场景', title: isEn ? 'Where it helps most' : '最容易见效的三个场景' })}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter">${scenarios}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto rounded-3xl bg-canvas-dark p-6 sm:p-10">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">${metrics}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        <div class="font-label-capsule text-label-capsule text-on-surface-variant uppercase tracking-wider mb-4">${isEn ? 'Other setups' : '其他适用人群'}</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-gutter">${others}</div>
      </div>`,
    }),
    finalCta({ lang }),
  ].join('\n');

  return page({
    lang,
    route: `/use-cases/${slug}/`,
    title: isEn ? `${h1} — WeMedia Workstation` : `${h1}｜自媒体内容运营工作台`,
    description: f('intro').slice(0, 150),
    body,
    jsonLd: [bc.jsonLd],
    priority: 0.7,
  });
}

/* ------------------------------------------------------------------ Blog */

function blogIndex(lang) {
  const t = ui(lang);
  const isEn = lang === 'en';
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: t.blog.title, route: '/blog/' },
  ]);
  const [featured, ...rest] = BLOG_POSTS;
  const featTitle = isEn ? featured.titleEn : featured.titleZh;
  const featDesc = isEn ? featured.descEn : featured.descZh;

  const card = (post) => {
    const title = isEn ? post.titleEn : post.titleZh;
    const desc = isEn ? post.descEn : post.descZh;
    return `<a class="group flex flex-col justify-between rounded-2xl bg-surface-white p-6 shadow-sm hover:shadow-md transition-shadow" href="${routeTo(`/blog/${post.slug}/`, lang)}">
      <div>
        <div class="flex flex-wrap items-center gap-2 text-body-sm font-body-sm text-on-surface-variant">
          <span class="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-label-capsule text-on-surface">${esc(isEn ? post.tagEn : post.tagZh)}</span>
          <span>${formatDate(post.date, lang)}</span>
          <span>·</span>
          <span>${post[isEn ? 'readEn' : 'readZh']} ${t.blog.minRead}</span>
        </div>
        <div class="mt-3 font-headline-sm text-headline-sm text-on-surface group-hover:text-primary transition-colors">${esc(title)}</div>
        <p class="mt-2 font-body-sm text-body-sm text-on-surface-variant">${esc(desc)}</p>
      </div>
      <span class="mt-5 inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary group-hover:gap-2 transition-all">${t.blog.readMore} ${icon('arrow_forward', 'text-[16px]')}</span>
    </a>`;
  };

  const body = [
    pageHero({
      lang,
      eyebrow: t.blog.title,
      title: isEn ? 'Notes on publishing, calendars, and analytics' : '关于发布、日历与复盘的工作笔记',
      description: t.blog.intro,
      breadcrumbHtml: bc.html,
    }),
    `<div class="max-w-6xl mx-auto pb-space-2xl">
      <a class="group grid grid-cols-1 lg:grid-cols-2 gap-0 rounded-3xl bg-canvas-dark overflow-hidden shadow-xl shadow-canvas-dark/10" href="${routeTo(`/blog/${featured.slug}/`, lang)}">
        <div class="relative min-h-[240px] overflow-hidden">
          <img alt="" class="absolute inset-0 h-full w-full object-cover opacity-70 transition-transform duration-500 group-hover:scale-105" src="${asset('img-3.jpg')}" loading="lazy"/>
          <div class="absolute inset-0 bg-gradient-to-t from-canvas-dark via-canvas-dark/30 to-transparent"></div>
          <span class="absolute left-5 top-5 rounded-full bg-gold-accent px-3 py-1 font-label-capsule text-[11px] uppercase tracking-wider text-canvas-dark">${isEn ? 'Latest' : '最新'}</span>
        </div>
        <div class="p-6 sm:p-10 flex flex-col justify-center">
          <div class="flex flex-wrap items-center gap-3 text-body-sm font-body-sm text-text-light-secondary">
            <span class="rounded-full bg-surface-dark px-2.5 py-1 text-[11px] font-label-capsule text-gold-accent">${esc(isEn ? featured.tagEn : featured.tagZh)}</span>
            <span>${formatDate(featured.date, lang)}</span>
            <span>·</span>
            <span>${featured[isEn ? 'readEn' : 'readZh']} ${t.blog.minRead}</span>
          </div>
          <h2 class="mt-4 font-headline-lg text-headline-lg text-text-light-primary">${esc(featTitle)}</h2>
          <p class="mt-3 font-body-md text-body-md text-text-light-secondary">${esc(featDesc)}</p>
          <span class="mt-6 inline-flex items-center gap-1 font-label-capsule text-body-sm text-gold-accent group-hover:gap-2 transition-all">${t.blog.readMore} ${icon('arrow_forward', 'text-[16px]')}</span>
        </div>
      </a>
      <div class="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">${rest.map(card).join('')}</div>
    </div>`,
    feedbackBand({ lang }),
  ].join('\n');

  const blogLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: t.blog.title,
    url: absolute('/blog/', lang),
    inLanguage: isEn ? 'en' : 'zh-CN',
    blogPost: BLOG_POSTS.slice(0, 8).map((post) => ({
      '@type': 'BlogPosting',
      headline: isEn ? post.titleEn : post.titleZh,
      datePublished: post.date,
      url: absolute(`/blog/${post.slug}/`, lang),
    })),
  };

  return page({
    lang,
    route: '/blog/',
    title: isEn ? 'Blog — publishing workflows and creator analytics' : '博客｜发布流程、内容日历与数据复盘',
    description: t.blog.intro,
    body,
    jsonLd: [bc.jsonLd, blogLd],
    priority: 0.7,
    lastmod: BLOG_POSTS[0]?.date,
  });
}

function blogPostPage(lang, slug) {
  const post = findPost(slug);
  if (!post) return null;
  const isEn = lang === 'en';
  const t = ui(lang);
  const title = isEn ? post.titleEn : post.titleZh;
  const desc = isEn ? post.descEn : post.descZh;
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: t.blog.title, route: '/blog/' },
    { label: title, route: `/blog/${slug}/` },
  ]);

  const sections = post.sections
    .map(
      (section) => `<h2>${esc(isEn ? section.h2En : section.h2Zh)}</h2>
      ${(isEn ? section.psEn : section.psZh).map((p) => `<p>${rich(p, lang)}</p>`).join('')}`,
    )
    .join('\n');

  const takeaways = (isEn ? post.takeawaysEn : post.takeawaysZh)
    .map((item) => `<li>${esc(item)}</li>`)
    .join('');

  const related = BLOG_POSTS.filter((item) => item.slug !== slug)
    .slice(0, 2)
    .map((item) => `<a class="group rounded-2xl bg-surface-white p-5 shadow-sm hover:shadow-md transition-shadow" href="${routeTo(`/blog/${item.slug}/`, lang)}">
      <div class="flex items-center gap-2 text-body-sm font-body-sm text-on-surface-variant"><span class="rounded-full bg-surface-container-low px-2.5 py-1 text-[11px] font-label-capsule text-on-surface">${esc(isEn ? item.tagEn : item.tagZh)}</span>${formatDate(item.date, lang)}</div>
      <div class="mt-2 font-headline-sm text-[16px] text-on-surface font-semibold group-hover:text-primary transition-colors">${esc(isEn ? item.titleEn : item.titleZh)}</div>
    </a>`)
    .join('');

  const body = [
    `<div class="max-w-3xl mx-auto pt-space-lg">
      ${bc.html}
      <div class="mt-space-lg flex flex-wrap items-center gap-3 font-body-sm text-body-sm text-on-surface-variant">
        <span class="rounded-full bg-surface-white px-3 py-1 font-label-capsule text-[11px] uppercase tracking-wider text-primary shadow-sm">${esc(isEn ? post.tagEn : post.tagZh)}</span>
        <span>${t.blog.published} ${formatDate(post.date, lang)}</span>
        <span>·</span>
        <span>${post[isEn ? 'readEn' : 'readZh']} ${t.blog.minRead}</span>
      </div>
      <h1 class="mt-4 font-display-hero text-headline-lg-mobile lg:text-headline-lg text-on-surface tracking-tight leading-tight">${esc(title)}</h1>
      <p class="mt-4 font-body-lg text-body-lg text-on-surface-variant">${esc(desc)}</p>
      <div class="mt-space-xl prose-site">
        <p>${rich(isEn ? post.introEn : post.introZh, lang)}</p>
        ${sections}
        <div class="my-8 rounded-2xl bg-surface-container-low p-6">
          <div class="font-headline-sm text-headline-sm text-on-surface mb-3">${isEn ? 'Takeaways' : '要点小结'}</div>
          <ul class="list-disc pl-5 space-y-2 font-body-md text-body-md text-on-surface">${takeaways}</ul>
        </div>
      </div>
    </div>`,
    contentSection({
      body: `<div class="max-w-3xl mx-auto">
        <div class="font-label-capsule text-label-capsule text-on-surface-variant uppercase tracking-wider mb-4">${isEn ? 'Keep reading' : '继续阅读'}</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-gutter">${related}</div>
        <div class="mt-8 flex flex-wrap items-center gap-3">
          ${primaryButton({ href: routeTo('/download/', lang), label: isEn ? 'Download the workbench' : '下载工作台', download: true })}
          ${secondaryButton({ href: routeTo('/blog/', lang), label: isEn ? 'All articles' : '返回博客' })}
        </div>
      </div>`,
    }),
  ].join('\n');

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description: desc,
    datePublished: post.date,
    dateModified: post.date,
    inLanguage: isEn ? 'en' : 'zh-CN',
    mainEntityOfPage: absolute(`/blog/${slug}/`, lang),
    author: { '@type': 'Organization', name: 'WeMedia Studio' },
    publisher: { '@type': 'Organization', name: 'WeMedia Studio' },
  };

  return page({
    lang,
    route: `/blog/${slug}/`,
    title: isEn ? `${title} — WeMedia Blog` : `${title}｜WeMedia 博客`,
    description: desc,
    body,
    jsonLd: [bc.jsonLd, articleLd],
    ogType: 'article',
    priority: 0.6,
    lastmod: post.date,
  });
}

/* ------------------------------------------------------------------- FAQ */

function faqPage(lang) {
  const isEn = lang === 'en';
  const groups = faqTopics[lang] || faqTopics.zh;
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: isEn ? 'FAQ' : '常见问题', route: '/faq/' },
  ]);
  const anchors = { Product: 'product', Usage: 'usage', Data: 'data', Purchasing: 'purchase', Limitations: 'limits' };
  const zhAnchors = { 产品: 'product', 使用: 'usage', 数据: 'data', 购买: 'purchase', 限制: 'limits' };

  const nav = groups
    .map((group) => `<a class="rounded-full bg-surface-white px-4 py-2 font-label-capsule text-body-sm text-on-surface shadow-sm hover:shadow transition-shadow" href="#${(isEn ? anchors : zhAnchors)[group.group] || 'product'}">${esc(group.group)}</a>`)
    .join('');

  let index = 0;
  const sections = groups
    .map((group) => {
      const id = (isEn ? anchors : zhAnchors)[group.group] || 'product';
      const start = index;
      index += group.items.length;
      const html = faqList({ lang, items: group.items.map((item) => [item.q, item.a]), openFirst: start === 0 });
      return `<section id="${id}" class="scroll-mt-28">
        <h2 class="font-headline-md text-headline-md text-on-surface mb-3">${esc(group.group)}</h2>
        <div class="space-y-3">${html}</div>
      </section>`;
    })
    .join('');

  const all = groups.flatMap((group) => group.items);
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: all.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
  };

  const body = [
    pageHero({
      lang,
      eyebrow: isEn ? 'FAQ' : '常见问题',
      title: isEn ? 'Answers before you install' : '安装之前，先把疑问说清楚',
      description: isEn
        ? 'Accounts, data, pricing, and the limits we would rather admit than hide.'
        : '账号安全、数据存放、价格与退款，以及我们宁愿提前说明的边界。',
      breadcrumbHtml: bc.html,
    }),
    `<div class="max-w-4xl mx-auto flex flex-wrap gap-2 pb-space-lg">${nav}</div>`,
    `<div class="max-w-4xl mx-auto space-y-space-xl pb-space-2xl">${sections}</div>`,
    ctaPanel(lang, {
      title: isEn ? 'Still unsure?' : '还有没说清楚的？',
      body: isEn ? 'Send us the question you would ask before buying. Licensing questions get a reply within one business day.' : '把你购买前最想问的问题发给我们，购买咨询会在 1 个工作日内回复。',
      primaryLabel: isEn ? 'Send feedback' : '提交反馈',
      primaryHref: routeTo('/feedback/', lang),
      secondaryLabel: isEn ? 'See pricing' : '查看价格',
      secondaryHref: routeTo('/pricing/', lang),
    }),
  ].join('\n');

  return page({
    lang,
    route: '/faq/',
    title: isEn ? 'FAQ — accounts, data, pricing, limitations' : '常见问题｜账号安全、数据存放、价格与限制',
    description: isEn
      ? 'Frequently asked questions about WeMedia Creator Workstation: account safety, local data, platform support, pricing, refunds, and limitations.'
      : '关于自媒体内容运营工作台的常见问题：账号安全、本地数据、平台支持、价格退款与产品边界。',
    body,
    jsonLd: [bc.jsonLd, faqLd],
    priority: 0.7,
  });
}

/* -------------------------------------------------------------- Feedback */

function feedbackPage(lang) {
  const isEn = lang === 'en';
  const t = ui(lang);
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: t.feedback.title, route: '/feedback/' },
  ]);

  const typeOptions = [
    ['feature', isEn ? 'Feature request' : '功能建议', 'lightbulb'],
    ['bug', isEn ? 'Problem report' : '问题反馈', 'bug_report'],
    ['license', isEn ? 'Licensing question' : '购买咨询', 'verified_user'],
    ['partnership', isEn ? 'Partnership' : '合作', 'handshake'],
  ];

  const msgRequired = esc(t.feedback.required);
  const radios = typeOptions
    .map(
      ([value, label, ic]) => `<label class="flex cursor-pointer items-center gap-2 rounded-xl border border-border-light bg-white px-4 py-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-gold-subtle">
        <input class="peer sr-only" type="radio" name="type" value="${value}"/>
        ${icon(ic, 'text-[18px] text-on-surface-variant peer-checked:text-primary')}
        <span class="font-label-capsule text-label-capsule text-on-surface">${esc(label)}</span>
      </label>`,
    )
    .join('');

  const form = `<form id="feedback-form" class="rounded-3xl bg-surface-white p-6 sm:p-8 shadow-sm space-y-5"
    data-msg-required="${msgRequired}"
    data-msg-short="${esc(t.feedback.short)}"
    data-msg-long="${esc(t.feedback.long)}"
    data-msg-consent="${esc(t.feedback.consentRequired)}"
    data-msg-error="${esc(t.feedback.error)}"
    data-msg-rate-limited="${esc(t.feedback.rateLimited)}"
    data-msg-unavailable="${esc(t.feedback.unavailable)}"
    data-msg-submitting="${esc(t.feedback.submitting)}"
    data-msg-submit="${esc(t.feedback.submit)}"
    data-plan-monthly="${esc(PLANS[0].nameZh)}"
    data-plan-yearly="${esc(PLANS[1].nameZh)}"
    data-plan-lifetime="${esc(PLANS[2].nameZh)}"
    data-plan-monthly-en="${esc(PLANS[0].nameEn)}"
    data-plan-yearly-en="${esc(PLANS[1].nameEn)}"
    data-plan-lifetime-en="${esc(PLANS[2].nameEn)}">
    <div data-field="type">
      <span class="field-label">${esc(t.feedback.type)} *</span>
      <div class="grid grid-cols-2 gap-2">${radios}</div>
      <p class="field-error">${esc(t.feedback.required)}</p>
    </div>
    <div data-field>
      <label class="field-label" for="fb-message">${esc(t.feedback.message)} *</label>
      <textarea class="field-input" id="fb-message" name="message" rows="7" maxlength="2000" placeholder="${esc(isEn ? 'What should it solve for you? The more concrete, the better.' : '你希望它替你解决什么？越具体越好。')}"></textarea>
      <span class="field-hint">${esc(t.feedback.messageHint)}</span>
      <p class="field-error">${esc(t.feedback.short)}</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div data-field>
        <label class="field-label" for="fb-contact">${esc(t.feedback.contact)}</label>
        <input class="field-input" id="fb-contact" name="contact" type="text" autocomplete="email" placeholder="${esc(isEn ? 'Email or WeChat' : '邮箱或微信')}"/>
        <span class="field-hint">${esc(t.feedback.contactHint)}</span>
      </div>
      <div data-field>
        <label class="field-label" for="fb-os">${esc(t.feedback.os)}</label>
        <select class="field-input" id="fb-os" name="os">
          ${t.feedback.osOptions.map((label, i) => `<option value="${esc(['', 'Windows', 'macOS', 'Linux'][i] || '')}">${esc(label)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div data-field>
      <label class="field-label" for="fb-version">${esc(t.feedback.version)}</label>
      <input class="field-input" id="fb-version" name="appVersion" type="text" value="${esc(VERSION)}"/>
    </div>
    <div class="hidden" aria-hidden="true">
      <label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"/></label>
    </div>
    <div data-field>
      <label class="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">
        <input class="mt-0.5 h-4 w-4 rounded border-border-light text-primary focus:ring-gold-accent" id="fb-consent" name="consent" type="checkbox"/>
        <span>${esc(t.feedback.consent)} <a class="text-primary underline decoration-gold-accent underline-offset-2" href="${routeTo('/legal/privacy/', lang)}">${esc(t.footer.privacy)}</a></span>
      </label>
      <p class="field-error">${esc(t.feedback.consentRequired)}</p>
    </div>
    <div class="flex flex-wrap items-center gap-4 pt-1">
      <button class="inline-flex items-center gap-2 rounded-full bg-gold-accent hover:bg-gold-accent-hover px-7 py-3 font-label-capsule text-label-capsule text-canvas-dark shadow-lg shadow-gold-accent/25 transition-colors disabled:opacity-60" type="submit">${icon('send', 'text-[18px]')}${esc(t.feedback.submit)}</button>
      <p class="font-body-sm text-body-sm text-on-surface-variant" id="feedback-status" role="status" aria-live="polite"></p>
    </div>
  </form>
  <div class="feedback-success mt-4" id="feedback-success" tabindex="-1" hidden>
    <div class="w-14 h-14 rounded-full bg-status-success/15 text-status-success flex items-center justify-center">${icon('check_circle', 'text-[30px] fill')}</div>
    <div class="font-headline-md text-headline-md text-on-surface">${esc(t.feedback.successTitle)}</div>
    <p class="font-body-md text-body-md text-on-surface-variant max-w-md">${esc(t.feedback.successBody)}</p>
    <div class="flex flex-wrap justify-center gap-3">
      <a class="rounded-full bg-surface-container-low px-5 py-2.5 font-label-capsule text-label-capsule text-on-surface" href="${routeTo('/download/', lang)}">${esc(t.feedback.nextDownload)}</a>
      <a class="rounded-full bg-canvas-dark px-5 py-2.5 font-label-capsule text-label-capsule text-text-light-primary" href="${routeTo('/pricing/', lang)}">${esc(t.feedback.nextPricing)}</a>
    </div>
  </div>`;

  const body = [
    pageHero({
      lang,
      eyebrow: t.feedback.title,
      title: isEn ? 'Tell us what it should solve for you' : '告诉我们，你希望它替你解决什么',
      description: t.feedback.intro,
      breadcrumbHtml: bc.html,
      narrow: true,
    }),
    `<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-gutter pb-space-2xl">
      <div class="lg:col-span-2">${form}</div>
      <aside class="space-y-4">
        <div class="rounded-2xl bg-surface-white p-5 shadow-sm">
          <div class="font-label-capsule text-label-capsule text-on-surface mb-1">${isEn ? 'Reply time' : '回复时间'}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">${isEn ? 'Licensing questions within one business day. Feature requests are read weekly.' : '购买咨询 1 个工作日内回复，功能建议每周集中阅读。'}</p>
        </div>
        <div class="rounded-2xl bg-surface-white p-5 shadow-sm">
          <div class="font-label-capsule text-label-capsule text-on-surface mb-1">${isEn ? 'What we store' : '我们保存什么'}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">${isEn ? 'Your message, optional contact, OS, app version, and page URL — used to reply and prevent abuse.' : '反馈内容、可选联系方式、系统与版本、页面地址，仅用于回复和防滥用。'} <a class="text-primary underline decoration-gold-accent underline-offset-2" href="${routeTo('/legal/privacy/', lang)}">${isEn ? 'Privacy policy' : '隐私政策'}</a></p>
        </div>
        <div class="rounded-2xl bg-surface-container-low p-5">
          <div class="font-label-capsule text-label-capsule text-on-surface mb-1">${isEn ? 'Need pricing first?' : '想先看价格？'}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant mb-3">${isEn ? 'Monthly $10, yearly $100, lifetime $200 — same features in every plan.' : '月付 ¥49.9、年付 ¥500、终身 ¥980，所有方案功能一致。'}</p>
          <a class="font-label-capsule text-body-sm text-primary underline decoration-gold-accent underline-offset-2" href="${routeTo('/pricing/', lang)}">${isEn ? 'See pricing' : '查看价格方案'}</a>
        </div>
      </aside>
    </div>`,
  ].join('\n');

  return page({
    lang,
    route: '/feedback/',
    title: isEn ? 'Feedback & licensing questions' : '反馈与购买咨询',
    description: t.feedback.intro,
    body,
    priority: 0.6,
  });
}

/* ----------------------------------------------------------------- About */

function aboutPage(lang) {
  const isEn = lang === 'en';
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: isEn ? 'About' : '关于我们', route: '/about/' },
  ]);
  const principles = [
    ['lock', isEn ? 'Local first, not cloud first' : '本地优先，而不是云端优先', isEn ? 'Cookies, media, and analytics stay in a local SQLite database. No relay servers and no uploaded passwords.' : 'Cookie、素材与复盘数据保存在本机 SQLite，不经过中转服务器，也不上传账号密码。'],
    ['visibility', isEn ? 'Say what it cannot do' : '把不能做的说清楚', isEn ? 'Four platforms sync analytics automatically, not eight. macOS does not auto-update yet. The site repeats those limits instead of hiding them.' : '自动数据回流覆盖四个平台而不是八个；macOS 暂不自动更新。这些限制会反复写明，而不是藏起来。'],
    ['tune', isEn ? 'Built around a real workflow' : '围绕真实工作流打磨', isEn ? 'The app follows the actual sequence of planning, making, publishing, and reviewing — not an idealized dashboard.' : '应用按真实顺序组织：选题、制作、发布、复盘，而不是拼一个好看的仪表盘。'],
  ].map(([ic, title, desc]) => `<div class="rounded-2xl bg-surface-white p-6 shadow-sm">
    <div class="w-11 h-11 rounded-full bg-surface-container-low flex items-center justify-center text-primary mb-4">${icon(ic, 'text-[22px]')}</div>
    <div class="font-headline-sm text-headline-sm text-on-surface mb-2">${esc(title)}</div>
    <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(desc)}</p>
  </div>`).join('');

  const body = [
    pageHero({
      lang,
      eyebrow: isEn ? 'About' : '关于我们',
      title: isEn ? 'A small studio building tools for serious creators' : '一个小团队，为认真做内容的人做工具',
      description: isEn
        ? 'WeMedia Studio builds local-first software for creators who publish across Chinese platforms. We would rather ship a narrower product that tells the truth than a dashboard that inflates what it does.'
        : 'WeMedia Studio 为跨平台发布的中文创作者做本地优先的工具。比起把功能说满，我们更愿意把产品做窄、把边界说清。',
      breadcrumbHtml: bc.html,
    }),
    `<div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-space-xl items-center pb-space-2xl">
      <div class="relative overflow-hidden rounded-3xl shadow-xl shadow-canvas-dark/10">
        <img alt="${isEn ? 'A bright desk with a laptop showing analytics' : '明亮的工作台，笔记本上显示数据面板'}" class="h-full w-full object-cover" src="${asset('img-3.jpg')}" loading="lazy"/>
        <div class="absolute bottom-4 left-4 right-4 rounded-xl bg-surface-white/90 backdrop-blur px-4 py-3">
          <div class="font-label-capsule text-[11px] uppercase tracking-wider text-primary">${isEn ? 'The problem we started with' : '最初的起点'}</div>
          <div class="font-body-sm text-body-sm text-on-surface">${isEn ? 'Eight tabs, eight forms, and a spreadsheet of numbers copied by hand.' : '八个标签页、八份表单，还有一张手抄的数据表。'}</div>
        </div>
      </div>
      <div class="prose-site">
        <p>${isEn ? 'The workbench began as an internal script. Publishing to several Chinese platforms meant repeating the same form eight times, then copying results into a spreadsheet late at night.' : '工作台最初只是一段内部脚本。把一条内容发到几个中文平台，意味着把同一份表单填八遍，再在深夜把结果抄进表格。'}</p>
        <p>${isEn ? 'We kept the parts that removed real work: a queue that runs on time, verification after publishing, and analytics that come back on their own. We removed the parts that required a cloud account or a developer API.' : '我们留下了真正省事的部分：按时执行的队列、发布后的核验、自己回流的数据；去掉了需要云账号或开发者 API 的部分。'}</p>
        <p>${isEn ? 'Today it is used by solo creators, two-person teams, and people running Chinese accounts from another time zone. The product is still small on purpose.' : '现在它在被一人创作者、两三人小团队，以及在海外运营国内账号的人使用。产品仍然刻意保持克制。'}</p>
      </div>
    </div>`,
    contentSection({
      body: `<div class="max-w-6xl mx-auto">
        ${sectionHeading({ lang, eyebrow: isEn ? 'How we work' : '我们的原则', title: isEn ? 'Three principles we do not trade away' : '三条不拿来交换的原则' })}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter">${principles}</div>
      </div>`,
    }),
    contentSection({
      body: `<div class="max-w-6xl mx-auto rounded-3xl bg-canvas-dark p-8 sm:p-10 text-text-light-secondary grid grid-cols-1 md:grid-cols-3 gap-6">
        <div><div class="font-metric-large text-metric-large text-text-light-primary">8</div><div class="font-body-sm text-body-sm">${isEn ? 'platforms supported for publishing' : '个平台支持自动发布'}</div></div>
        <div><div class="font-metric-large text-metric-large text-text-light-primary">4</div><div class="font-body-sm text-body-sm">${isEn ? 'platforms with automatic analytics' : '个平台数据自动回流'}</div></div>
        <div><div class="font-metric-large text-metric-large text-text-light-primary">0</div><div class="font-body-sm text-body-sm">${isEn ? 'cloud accounts or relay servers' : '个云账号与中转服务器'}</div></div>
      </div>`,
    }),
    ctaPanel(lang, {
      title: isEn ? 'Have a workflow that does not fit?' : '你的流程和这里不一样？',
      body: isEn ? 'Tell us how you publish today. We read every message and use it to decide what to build next.' : '告诉我们你现在怎么发布。每条反馈都会读，也会影响下一步做什么。',
      primaryLabel: isEn ? 'Send feedback' : '提交反馈',
      primaryHref: routeTo('/feedback/', lang),
      secondaryLabel: isEn ? 'Download' : '下载体验',
      secondaryHref: routeTo('/download/', lang),
    }),
  ].join('\n');

  return page({
    lang,
    route: '/about/',
    title: isEn ? 'About WeMedia Studio' : '关于我们｜WeMedia Studio',
    description: isEn
      ? 'A small studio building local-first publishing and analytics software for Chinese content creators.'
      : 'WeMedia Studio 是一个为中文创作者做本地优先发布与复盘工具的小团队。',
    body,
    jsonLd: [bc.jsonLd],
    priority: 0.5,
  });
}

/* ------------------------------------------------------------- Changelog */

function changelogPage(lang) {
  const isEn = lang === 'en';
  const t = ui(lang);
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: t.changelog.title, route: '/changelog/' },
  ]);
  const entries = CHANGELOG.map((entry) => `<article class="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 md:gap-8 py-space-lg border-t border-border-light first:border-0">
    <div>
      <div class="flex items-center gap-2">
        <span class="rounded-full ${entry.current ? 'bg-gold-accent text-canvas-dark' : 'bg-surface-container-low text-on-surface'} px-3 py-1 font-label-capsule text-body-sm">v${esc(entry.version)}</span>
        ${entry.current ? `<span class="font-body-sm text-body-sm text-status-success">${isEn ? 'Current' : '当前版本'}</span>` : ''}
      </div>
      <div class="mt-2 font-body-sm text-body-sm text-on-surface-variant">${formatDate(entry.date, lang)}</div>
    </div>
    <div>
      <h2 class="font-headline-md text-headline-md text-on-surface">${esc(isEn ? entry.titleEn : entry.titleZh)}</h2>
      <ul class="mt-3 space-y-2">
        ${(isEn ? entry.itemsEn : entry.itemsZh).map((item) => `<li class="flex items-start gap-2 font-body-sm text-body-sm text-on-surface-variant">${icon('arrow_right', 'text-[16px] text-primary mt-0.5')}<span>${esc(item)}</span></li>`).join('')}
      </ul>
    </div>
  </article>`).join('');

  const body = [
    pageHero({
      lang,
      eyebrow: t.changelog.title,
      title: isEn ? 'Every release, in plain language' : '每个版本改了什么，写清楚',
      description: t.changelog.intro,
      breadcrumbHtml: bc.html,
      actions: primaryButton({ href: routeTo('/download/', lang), label: isEn ? `Download v${VERSION}` : `下载 v${VERSION}`, download: true }),
    }),
    `<div class="max-w-4xl mx-auto pb-space-2xl">${entries}</div>`,
    `<div class="max-w-4xl mx-auto mb-space-2xl rounded-2xl bg-surface-container-low/70 p-5 font-body-sm text-body-sm text-on-surface-variant flex items-start gap-2">${icon('info', 'text-[18px] text-primary mt-0.5')}<span>${isEn ? 'Windows and Linux AppImage builds update automatically. deb and macOS users download the latest installer manually.' : 'Windows 与 Linux AppImage 会自动更新；deb 与 macOS 用户需要手动下载最新安装包。'}</span></div>`,
    feedbackBand({ lang }),
  ].join('\n');

  return page({
    lang,
    route: '/changelog/',
    title: isEn ? 'Changelog — WeMedia Creator Workstation' : '更新日志｜自媒体内容运营工作台',
    description: isEn ? 'Release notes for WeMedia Creator Workstation: new platform support, fixes, and compatibility updates.' : '自媒体内容运营工作台的版本更新记录：平台支持、修复与适配变化。',
    body,
    jsonLd: [bc.jsonLd],
    priority: 0.5,
    lastmod: CHANGELOG[0]?.date,
  });
}

/* ----------------------------------------------------------------- Legal */

function legalPage(lang, kind) {
  const doc = LEGAL[kind];
  if (!doc) return null;
  const isEn = lang === 'en';
  const title = isEn ? doc.titleEn : doc.titleZh;
  const intro = isEn ? doc.introEn : doc.introZh;
  const sections = isEn ? doc.sectionsEn : doc.sectionsZh;
  const route = `/legal/${kind}/`;
  const bc = crumb(lang, [
    { label: isEn ? 'Home' : '首页', route: '/' },
    { label: title, route },
  ]);

  const body = [
    `<div class="max-w-3xl mx-auto pt-space-lg">
      ${bc.html}
      <h1 class="mt-space-lg font-display-hero text-headline-lg-mobile lg:text-headline-lg text-on-surface tracking-tight leading-tight">${esc(title)}</h1>
      <p class="mt-4 font-body-lg text-body-lg text-on-surface-variant">${esc(intro)}</p>
      <p class="mt-3 font-body-sm text-body-sm text-on-surface-variant">${isEn ? 'Last updated' : '最后更新'}：${formatDate(doc.updated, lang)}</p>
      <div class="mt-space-xl prose-site pb-space-2xl">
        ${sections.map((section) => `<h2>${esc(section.h)}</h2>${section.ps.map((p) => `<p>${esc(p)}</p>`).join('')}`).join('\n')}
        <p>${isEn ? 'Questions about this page? ' : '对本页有疑问？'} <a href="${routeTo('/feedback/', lang)}">${isEn ? 'Contact us through the feedback form.' : '通过反馈表单联系我们。'}</a></p>
      </div>
    </div>`,
  ].join('\n');

  return page({
    lang,
    route,
    title: isEn ? `${title} — WeMedia Creator Workstation` : `${title}｜自媒体内容运营工作台`,
    description: intro.slice(0, 150),
    body,
    jsonLd: [bc.jsonLd],
    priority: 0.3,
  });
}

/* ------------------------------------------------------------------- 404 */

export function render404() {
  const isEn = false;
  const body = `<div class="min-h-[60vh] flex flex-col items-center justify-center text-center py-space-3xl">
    <div class="font-display-hero text-display-hero text-on-surface">404</div>
    <p class="mt-3 font-body-lg text-body-lg text-on-surface-variant max-w-md">这个页面不存在，可能已经调整了地址。</p>
    <div class="mt-8 flex flex-wrap justify-center gap-3">
      <a class="inline-flex items-center gap-2 rounded-full bg-gold-accent px-6 py-3 font-label-capsule text-label-capsule text-canvas-dark" href="${routeTo('/', 'zh')}">${icon('home', 'text-[18px]')}返回首页</a>
      <a class="inline-flex items-center gap-2 rounded-full bg-surface-container-low px-6 py-3 font-label-capsule text-label-capsule text-on-surface" href="${routeTo('/download/', 'zh')}">${icon('download', 'text-[18px]')}下载桌面版</a>
    </div>
  </div>`;
  return layout({
    lang: 'zh',
    route: '/',
    title: '页面不存在｜自媒体内容运营工作台',
    description: '你访问的页面不存在，返回首页或下载桌面版。',
    body,
    noindex: true,
  });
}

/* --------------------------------------------------------------- Routing */

export function renderRoutes({ checkout = '' } = {}) {
  const pages = [];
  for (const lang of ['zh', 'en']) {
    pages.push(featuresPage(lang));
    pages.push(platformsPage(lang));
    for (const slug of PLATFORMS.map((p) => p.id)) pages.push(platformPage(lang, slug));
    pages.push(pricingPage(lang, checkout));
    pages.push(downloadPage(lang));
    for (const slug of Object.keys(USE_CASES)) pages.push(useCasePage(lang, slug));
    pages.push(blogIndex(lang));
    for (const post of BLOG_POSTS) pages.push(blogPostPage(lang, post.slug));
    pages.push(faqPage(lang));
    pages.push(feedbackPage(lang));
    pages.push(aboutPage(lang));
    pages.push(changelogPage(lang));
    pages.push(legalPage(lang, 'privacy'));
    pages.push(legalPage(lang, 'terms'));
  }
  return pages.filter(Boolean);
}

function urlFor(route, lang) {
  return absolute(route, lang);
}

export function renderSitemap(routes) {
  const entries = routes
    .filter((r) => !r.noindex)
    .map(
      (r) => `  <url>
    <loc>${urlFor(r.route, r.lang)}</loc>
    <lastmod>${(r.lastmod || RELEASES.releaseDate || new Date().toISOString()).slice(0, 10)}</lastmod>
    <changefreq>${r.route === '/' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${(r.priority ?? 0.7).toFixed(1)}</priority>
  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export function renderRobots() {
  return `User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${SITE_URL}${SITE_BASE}/sitemap.xml
`;
}

export function renderLlms() {
  const base = `${SITE_URL}${SITE_BASE}`;
  const short = `# WeMedia Creator Workstation

> Local-first desktop workbench for Chinese content creators: plan, schedule, publish to 8 platforms, and review analytics without cloud accounts.

## Key facts

- Platforms: Douyin, WeChat Channels, Xiaohongshu, WeChat Official Accounts, Bilibili, Kuaishou, Weibo, Zhihu.
- Automatic analytics: Douyin, Xiaohongshu, WeChat Channels, WeChat Official Accounts.
- Platforms require Chrome or Edge on the same machine; no API keys.
- Data lives in a local SQLite database; the app is single-user and does not upload content.
- Current version: ${VERSION}.
- Pricing: monthly $10, yearly $100, lifetime $200 (USD, one license covers three devices).

## Pages

- [Home](${base}/): product overview.
- [Features](${base}/features/): planning, scheduling, publishing, analytics.
- [Platforms](${base}/platforms/): support matrix and platform guides.
- [Pricing](${base}/pricing/): plans and licensing.
- [Download](${base}/download/): Windows, macOS, and Linux installers.
- [Use cases](${base}/use-cases/solo/): solo creators, small teams, creators abroad.
- [Blog](${base}/blog/): publishing workflows and analytics notes.
- [FAQ](${base}/faq/): accounts, data, pricing, limitations.
- [Changelog](${base}/changelog/): release history.

## Limitations

- No team collaboration or cloud sync.
- Desktop UI is Simplified Chinese.
- macOS build is unsigned and does not auto-update.
- Automation is subject to platform risk controls.
`;
  const full = `${short}
## Detailed capabilities

The app covers five stages: idea pool, content calendar, publish center, analytics review, and asset archive. It publishes through the user's own browser session, verifies each result, retries failed tasks, and stores everything locally. Automatic analytics currently covers four platforms; other platforms require manual entry.

## Pricing

Every plan includes all features and publishes to all eight platforms. Monthly is $10, yearly is $100 (equivalent to $8.3/month, saving $20), and lifetime is $200 one-time. A license activates up to three devices. Refunds follow the 14-day policy shown at checkout.

## Contact

Feedback and licensing questions are collected through ${base}/feedback/.
`;
  return { short, full };
}
