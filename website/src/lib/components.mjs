import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_BASE, VERSION, PLANS, PLATFORMS, PLAN_FEATURES_ZH, PLAN_FEATURES_EN } from '../config.mjs';
import { esc, routeTo, asset } from './layout.mjs';
import { ui } from './i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCKUP = fs.readFileSync(path.join(__dirname, '..', 'partials', 'app-mockup.html'), 'utf8').trim();
const ASSET_BASE = `${SITE_BASE}/assets`;

export function checkoutUrl(plan, lang = 'zh', checkout = '') {
  if (checkout) {
    const sep = checkout.includes('?') ? '&' : '?';
    return `${checkout}${sep}plan=${encodeURIComponent(plan)}&lang=${lang === 'en' ? 'en' : 'zh'}`;
  }
  return routeTo(`/feedback/?type=license&plan=${encodeURIComponent(plan)}`, lang);
}

export function sectionHeading({ lang, eyebrow, title, desc = '', center = true, light = false }) {
  return `<div class="${center ? 'text-center' : ''} max-w-2xl ${center ? 'mx-auto' : ''} mb-space-2xl">
  ${eyebrow ? `<span class="section-eyebrow">${esc(eyebrow)}</span>` : ''}
  <h2 class="font-headline-lg text-headline-lg ${light ? 'text-text-light-primary' : 'text-on-surface'} mt-1">${title}</h2>
  ${desc ? `<p class="font-body-md text-body-md ${light ? 'text-text-light-secondary' : 'text-on-surface-variant'} mt-2">${desc}</p>` : ''}
</div>`;
}

export function icon(name, extra = '') {
  return `<span class="material-symbols-outlined ${extra}">${name}</span>`;
}

/* ---------------------------------------------------------------- Hero */

const HERO = {
  zh: {
    badge: '2026 全新架构',
    badgeNote: '本地优先桌面端 · 适配主流新媒体改版',
    titlePrefix: '八个平台，',
    titleAccent: '一张工作台。',
    sub: '选题、排期、发布、复盘、沉淀，全在一个本地应用里完成。到点自动发布，数据自动回填，账号与素材始终留在你自己的电脑上。',
    download: '下载桌面版 (Windows / macOS / Linux)',
    pricing: '查看授权价格 (¥49.9起)',
    micro: 'Windows 10+ · macOS 11+ · Ubuntu 22.04+ ｜ <span class="text-on-surface font-medium">无需申请 API</span> ｜ 数据完全保存在本机 SQLite',
  },
  en: {
    badge: 'New in 2026',
    badgeNote: 'Local-first desktop · Kept current with platform changes',
    titlePrefix: 'Eight platforms. ',
    titleAccent: 'One workbench.',
    sub: 'Plan, schedule, publish, review, and archive everything from one local app. It publishes on time, pulls the numbers back, and keeps your accounts and files on your own computer.',
    download: 'Download for desktop (Windows / macOS / Linux)',
    pricing: 'See pricing (from $10)',
    micro: 'Windows 10+ · macOS 11+ · Ubuntu 22.04+ ｜ <span class="text-on-surface font-medium">No API keys</span> ｜ Everything stays in local SQLite',
  },
};

export function hero({ lang }) {
  const c = HERO[lang] || HERO.zh;
  const mockup = MOCKUP.replaceAll('{{ASSET}}', ASSET_BASE);
  return `<section class="relative w-full pt-space-xl pb-space-3xl flex flex-col items-center">
  <div class="absolute top-10 left-1/2 -translate-x-1/2 w-[720px] h-[360px] bg-gold-accent/10 rounded-full blur-[110px] pointer-events-none -z-10"></div>
  <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface-white text-on-surface text-body-sm font-label-capsule shadow-sm mb-space-md border-0 transition-transform hover:scale-105">
    <span class="w-2 h-2 rounded-full bg-status-success animate-pulse"></span>
    <span class="text-on-surface-variant font-medium">🚀 ${esc(c.badge)}</span>
    <span class="hidden sm:inline text-outline-variant">|</span>
    <span class="hidden sm:inline">${esc(c.badgeNote)}</span>
  </div>
  <div class="max-w-4xl text-center px-margin-mobile flex flex-col items-center">
    <h1 class="font-display-hero text-headline-lg lg:text-display-hero text-on-surface tracking-tight leading-tight mb-space-md">
      ${esc(c.titlePrefix)}<span class="relative inline-block text-primary">${esc(c.titleAccent)}<svg class="absolute -bottom-2 left-0 w-full h-3 text-gold-accent/60 -z-10" preserveAspectRatio="none" viewBox="0 0 100 12"><path d="M0,8 Q50,0 100,8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="6"></path></svg></span>
    </h1>
    <p class="font-body-lg text-body-lg text-on-surface-variant max-w-2xl text-center mb-space-xl leading-relaxed">${esc(c.sub)}</p>
    <div class="flex flex-wrap items-center justify-center gap-space-md mb-space-sm">
      <a class="inline-flex items-center gap-3 px-8 py-3.5 rounded-full bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark font-label-capsule text-label-capsule shadow-lg shadow-gold-accent/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0" href="${routeTo('/download/', lang)}">
        ${icon('download', 'text-[20px] fill')}
        <span>${esc(c.download)}</span>
      </a>
      <a class="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-surface-white hover:bg-surface-container-low text-on-surface font-label-capsule text-label-capsule shadow-sm transition-all hover:shadow" href="${routeTo('/pricing/', lang)}">
        ${icon('verified', 'text-[18px]')}
        <span>${esc(c.pricing)}</span>
      </a>
    </div>
    <p class="font-body-sm text-body-sm text-text-dark-secondary">${c.micro}</p>
  </div>
  <div class="app-mockup w-full flex justify-center">${mockup}</div>
</section>`;
}

/* ------------------------------------------------------- Platform bar */

const BAR_META = {
  douyin: { dot: 'bg-black', barZh: '视频/图文 · 回流', barEn: 'Video/posts · analytics' },
  channels: { dot: 'bg-emerald-600', barZh: '长短视频 · 回流', barEn: 'Video · analytics' },
  xiaohongshu: { dot: 'bg-red-500', barZh: '图文/视频 · 回流', barEn: 'Posts/video · analytics' },
  wechat: { dot: 'bg-green-700', barZh: '文章/草稿 · 回流', barEn: 'Articles · analytics' },
  bilibili: { dot: 'bg-pink-500', barZh: '4K视频/动态', barEn: '4K video/feeds' },
  kuaishou: { dot: 'bg-amber-500', barZh: '短视频/双封面', barEn: 'Short video/covers' },
  weibo: { dot: 'bg-orange-600', barZh: '视频/9图长文', barEn: 'Video/photo posts' },
  zhihu: { dot: 'bg-blue-600', barZh: '专栏/视频/想法', barEn: 'Columns/video/pins' },
};

export function platformBar({ lang }) {
  const isEn = lang === 'en';
  const cards = PLATFORMS.map((p) => {
    const meta = BAR_META[p.id];
    return `<a class="p-3 rounded-xl bg-surface-white shadow-sm flex flex-col items-center text-center hover:shadow-md transition-shadow" href="${routeTo(`/platforms/${p.id}/`, lang)}">
      <div class="w-8 h-8 rounded-full ${meta.dot} text-white flex items-center justify-center text-sm font-bold mb-1.5">${esc(isEn ? p.markEn : p.markZh)}</div>
      <span class="font-label-capsule text-body-sm font-semibold text-on-surface">${esc(isEn ? p.nameEn : p.nameZh)}</span>
      <span class="text-[10px] ${p.dataBack ? 'text-status-success font-medium' : 'text-on-surface-variant'}">${esc(isEn ? meta.barEn : meta.barZh)}</span>
    </a>`;
  }).join('');
  return `<section class="w-full py-space-xl bg-surface-container-low/70 rounded-2xl my-space-lg">
  <div class="max-w-6xl mx-auto px-margin-mobile">
    <div class="text-center mb-space-md">
      <span class="section-eyebrow">${isEn ? 'Native support for major platforms' : '原生支持主流媒体生态'}</span>
      <h2 class="font-headline-sm text-headline-sm text-on-surface mt-1">${isEn ? 'All eight platforms in one place · automatic analytics for four' : '八大平台一网打尽 · 4 平台独家数据自动回流'}</h2>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">${cards}</div>
  </div>
</section>`;
}

/* ------------------------------------------------------ Pain / outcome */

const PAIN = {
  zh: [
    {
      pain: '一条内容打开8个网页标签，重复复制标题简介、反复裁剪封面、多次勾选发布选项，耗时且极易漏发。',
      title: '一次排期，八个平台自动完成',
      body: '准备好主素材、勾选目标网络与裁切格式，到点后台安静唤醒执行。任务失败自动重试，发布完毕自动核验回执。',
      icon: 'schedule',
      win: '每天释放 2–3 小时机械劳作',
    },
    {
      pain: '数据散落在各个后台，次日复盘得纯靠手工抄表；一旦忙碌就放弃复盘，内容优化彻底流于形式。',
      title: '数据自动回流，打开就能复盘',
      body: '抖音、小红书、视频号、公众号关键播放、点赞与涨粉数据自动归集，互动率与完播转化一目了然，即开即看。',
      icon: 'query_stats',
      win: '告别手动抄表，数据真实留存',
    },
    {
      pain: '担心云端托管工具泄露 Cookie 导致封号或隐私泄露，通用开放平台接口个人博主又根本申请不下来。',
      title: '数据留在电脑，不用注册云账号',
      body: '基于 Local-First 本地优先架构设计。所有登录 Cookie、素材、复盘数据库均存在你电脑的 SQLite 中，零云端托管。',
      icon: 'encrypted',
      win: '绝对掌控资产，远离平台风控',
    },
  ],
  en: [
    {
      pain: 'One post means eight browser tabs: retyping titles, resizing covers, ticking the same options, and still missing one.',
      title: 'Schedule once. Eight platforms publish.',
      body: 'Prepare the master asset, pick the networks and cover ratios, and let the app wake up on time. Failed tasks retry, and results are verified automatically.',
      icon: 'schedule',
      win: 'Reclaim 2–3 hours of mechanical work every day',
    },
    {
      pain: 'Numbers are scattered across dashboards. Reviews mean copying figures by hand — and when you get busy, reviews stop.',
      title: 'Analytics come back to you.',
      body: 'Views, likes, and follower growth from Douyin, Xiaohongshu, WeChat Channels, and Official Accounts land in one review table, with rates calculated for you.',
      icon: 'query_stats',
      win: 'No more manual copy-paste; your data stays',
    },
    {
      pain: 'Cloud tools make you worry about cookie leaks, bans, and privacy — while platform APIs are out of reach for individual creators.',
      title: 'Your data stays on your computer.',
      body: 'Built local-first. Login cookies, assets, and review databases live in SQLite on your machine, with no cloud hosting.',
      icon: 'encrypted',
      win: 'Full control of your assets and risk',
    },
  ],
};

export function painOutcome({ lang }) {
  const isEn = lang === 'en';
  const cards = (PAIN[lang] || PAIN.zh).map((c) => `<article class="group flex flex-col rounded-2xl bg-surface-white p-6 shadow-sm ring-1 ring-border-light transition-shadow hover:shadow-md">
    <div class="rounded-xl bg-surface-container-low p-4">
      <div class="mb-2 flex items-center gap-2">
        <span class="h-1.5 w-1.5 rounded-full bg-status-error"></span>
        <span class="font-label-capsule text-[11px] uppercase tracking-wider text-on-surface-variant">${isEn ? 'The old way' : '过去痛点'}</span>
      </div>
      <p class="font-body-sm text-body-sm leading-relaxed text-on-surface-variant">${esc(c.pain)}</p>
    </div>
    <div class="my-5 flex items-center gap-3">
      <span class="h-px flex-1 bg-border-light"></span>
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-subtle text-primary ring-1 ring-gold-accent/30">${icon('arrow_downward', 'text-[18px]')}</span>
      <span class="h-px flex-1 bg-border-light"></span>
    </div>
    <div class="flex-1">
      <h3 class="mb-1.5 font-headline-sm text-[17px] font-semibold text-on-surface">${esc(c.title)}</h3>
      <p class="font-body-md text-body-md leading-relaxed text-on-surface-variant">${esc(c.body)}</p>
    </div>
    <div class="mt-5 flex items-start gap-2 border-t border-border-light pt-4 font-label-capsule text-body-sm text-primary">
      ${icon(c.icon, 'text-[18px]')}<span>${esc(c.win)}</span>
    </div>
  </article>`).join('');
  return `<section class="w-full py-space-3xl">
  <div class="max-w-6xl mx-auto">
    <div class="text-center max-w-3xl mx-auto mb-space-2xl">
      <span class="section-eyebrow">${isEn ? 'Pain versus outcome' : '痛点与结果强烈对比'}</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface mt-1 text-balance">${isEn ? 'We are not selling a feature list.<br class="hidden sm:block"/> We are selling three outcomes.' : '我们卖的不是“功能清单”，<br class="hidden sm:block"/>而是三种真切的结果'}</h2>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter">${cards}</div>
  </div>
</section>`;
}

/* ----------------------------------------------------------- Workflow */

const STEPS = {
  zh: [
    ['选题池储备', '记录灵感、爆款潜力评分与目标发布平台标签，随时搜索筛选导出。', 'lightbulb'],
    ['内容日历甘特', '九个制作阶段（文案、粗剪、精剪、成片、审核），全月节奏一清二楚。', 'calendar_view_month'],
    ['发布中心执行', '八个平台排期队列，支持多比例封面自动适配，到点自动唤醒、发布后核验。', 'rocket_launch'],
    ['自动数据复盘', '4大平台指标全自动写入本地报表，互动率、完播率、增粉率自动算妥。', 'monitoring'],
    ['永久素材沉淀', '成稿正文、语音复盘录音、关键词关联打通归档，优质资产可持续复用。', 'inventory_2'],
  ],
  en: [
    ['Build an idea pool', 'Capture ideas, potential scores, and target platforms. Search, filter, and export whenever you need.', 'lightbulb'],
    ['Plan the month', 'Nine production stages — copy, rough cut, fine cut, final, review — on one timeline.', 'calendar_view_month'],
    ['Run the publish queue', 'Schedule all eight platforms with multi-ratio covers. It wakes up on time and verifies the result.', 'rocket_launch'],
    ['Review automatically', 'Metrics from four platforms land in your local reports, with engagement and growth rates calculated.', 'monitoring'],
    ['Archive and reuse', 'Final copy, image notes, keywords, and voice memos stay linked to ideas and schedules.', 'inventory_2'],
  ],
};

export function workflow({ lang }) {
  const isEn = lang === 'en';
  const steps = (STEPS[lang] || STEPS.zh).map(([title, body, ic], i) => `<div class="p-4 rounded-xl bg-surface-container-low flex flex-col justify-between">
    <div>
      <span class="w-7 h-7 rounded-full ${i === 2 ? 'bg-gold-accent text-canvas-dark' : 'bg-canvas-dark text-text-light-primary'} text-[12px] font-bold flex items-center justify-center mb-3">0${i + 1}</span>
      <div class="font-headline-sm text-[16px] text-on-surface font-semibold mb-1">${esc(title)}</div>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(body)}</p>
    </div>
    ${icon(ic, 'text-primary mt-4 text-[24px]')}
  </div>`).join('');
  return `<section class="w-full py-space-3xl bg-surface-white rounded-3xl my-space-lg" id="workflow">
  <div class="max-w-6xl mx-auto px-margin-mobile">
    ${sectionHeading({
      lang,
      eyebrow: isEn ? 'One continuous loop' : '全流程贯通',
      title: isEn ? 'From first idea to review, in five simple steps' : '从灵感到复盘，五步极简闭环',
      desc: isEn
        ? 'Stop stitching together scattered tools. Every key moment of a creator’s day is covered.'
        : '不再四处拼凑碎片工具，完整覆盖专业创作者日常的每一个关键节点。',
    })}
    <div class="grid grid-cols-1 md:grid-cols-5 gap-4">${steps}</div>
  </div>
</section>`;
}

/* ----------------------------------------------------------- Benefits */

const BENEFITS = {
  zh: [
    ['选题池：灵感有处安放', '记录平台、角度、标签和爆款潜力评分，搜索、筛选、导出，下一条内容不再靠翻备忘录。', 'psychology'],
    ['内容日历：整月节奏一眼看清', '九个制作阶段、负责人、内容形式和发布时间，一张时间轴排完整个月的生产节奏。', 'date_range'],
    ['发布中心：排好队，它自己发', '八个平台一次排期，视频、图文、多比例封面；失败可重试，发布后自动核验。', 'queue'],
    ['数据复盘：不用再手抄', '抖音、小红书、视频号、公众号数据自动回流，互动率、涨粉率、更新频率实时算好。', 'insights'],
    ['素材库：好内容可以复用', '成稿、配图说明、关键词、语音复盘统一归档，和选题、排期互相打通。', 'library_books'],
    ['一键登录：不用申请 API', '独立浏览器窗口扫码登录，Cookie 只留在本机；过期了重新登录即可，无需开发者认证。', 'vpn_key'],
    ['本地优先：数据只属于你', 'SQLite 存储、每日快照、CSV 导出；不用注册云端账号，无任何隐私外泄顾虑。', 'database'],
    ['桌面常驻：关窗也在跑', '最小化到托盘，定时发布和数据同步继续；客户端自动更新，平台改版跟着适配。', 'laptop_mac'],
  ],
  en: [
    ['A home for every idea', 'Capture platform, angle, tags, and potential score. Search, filter, export — never dig through notes again.', 'psychology'],
    ['See the whole month', 'Nine production stages, owners, formats, and publish times on one timeline.', 'date_range'],
    ['Queue it. It publishes', 'All eight platforms at once — video, image posts, multi-ratio covers. Retry failures, verify results.', 'queue'],
    ['Stop copying numbers', 'Douyin, Xiaohongshu, Channels, and Official Accounts flow back automatically, with rates calculated.', 'insights'],
    ['Reuse what works', 'Manuscripts, image notes, keywords, and voice memos archived and linked to ideas and schedules.', 'library_books'],
    ['No API keys required', 'Sign in through an isolated browser window. Cookies stay local; sign in again when they expire.', 'vpn_key'],
    ['Local-first by design', 'SQLite storage, daily snapshots, CSV export. No cloud account and no privacy worries.', 'database'],
    ['Close the window, keep working', 'Run in the tray while publishing and syncing continue. Auto-updates as platforms change.', 'laptop_mac'],
  ],
};

export function benefits({ lang }) {
  const isEn = lang === 'en';
  const cards = (BENEFITS[lang] || BENEFITS.zh).map(([title, body, ic]) => `<div class="p-5 rounded-2xl bg-surface-white shadow-sm flex flex-col justify-between">
    <div>
      <div class="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary mb-3">${icon(ic)}</div>
      <div class="font-headline-sm text-headline-sm text-on-surface mb-1">${esc(title)}</div>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(body)}</p>
    </div>
  </div>`).join('');
  return `<section class="w-full py-space-3xl" id="benefits">
  <div class="max-w-6xl mx-auto">
    ${sectionHeading({
      lang,
      eyebrow: isEn ? 'Benefits at a glance' : '功能收益网格',
      title: isEn ? 'Every capability saves you something concrete' : '每个能力，都为你明确省下时间',
    })}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">${cards}</div>
  </div>
</section>`;
}

/* ------------------------------------------------------ Trust / limits */

const LIMITS = {
  zh: [
    ['devices', '依赖本机浏览器', '发布与部分数据采集依赖本机安装的 Chrome 或 Edge 浏览器环境驱动。'],
    ['verified_user', '扫码授权登录态', '首次需在独立窗口登录平台账号，会话 Cookie 仅保存在本机，过期需轻点重登。'],
    ['update', '平台风控与改版响应', '平台更新前端时可能出现短暂异常，开发团队会持续发布热更新补丁进行适配。'],
    ['person', '单机单人专注设计', '当前版本专为独立创作者设计，暂不支持云端跨团队协同或多人远程共享。'],
  ],
  en: [
    ['devices', 'Needs a local browser', 'Publishing and some data collection rely on Chrome or Edge installed on your machine.'],
    ['verified_user', 'Sign in with a scan', 'Log in to each platform once in an isolated window. Cookies stay local; sign in again when they expire.'],
    ['update', 'Platform changes happen', 'Pages change and may cause brief failures. We ship compatibility updates and let you retry safely.'],
    ['person', 'Built for one person', 'This version is designed for individual creators — no cloud team collaboration or remote sharing yet.'],
  ],
};

const LOCAL_TILES = {
  zh: [
    ['database', '本地 SQLite', '排期、素材、复盘数据都在这台电脑上。'],
    ['history', '每日快照', '数据每天自动快照，误删也能找回。'],
    ['table_view', 'CSV 导出', '四张业务表随时导出，Excel 直接打开。'],
    ['cloud_off', '不注册云账号', '没有云端账户，也没有中转服务器。'],
  ],
  en: [
    ['database', 'Local SQLite', 'Schedules, assets, and analytics live on this computer.'],
    ['history', 'Daily snapshots', 'A snapshot every day, so a mistake is recoverable.'],
    ['table_view', 'CSV export', 'Export all four business tables, ready for Excel.'],
    ['cloud_off', 'No cloud account', 'No cloud account and no relay server.'],
  ],
};

export function trustSection({ lang }) {
  const isEn = lang === 'en';
  const cards = (LIMITS[lang] || LIMITS.zh).map(([ic, title, body]) => `<div class="p-4 rounded-xl bg-surface-dark border-0">
    <div class="font-headline-sm text-[15px] text-text-light-primary font-semibold mb-1 flex items-center gap-1.5">
      ${icon(ic, 'text-gold-accent text-[18px]')} ${esc(title)}
    </div>
    <p class="font-body-sm text-body-sm text-text-light-secondary">${esc(body)}</p>
  </div>`).join('');
  const tiles = (LOCAL_TILES[lang] || LOCAL_TILES.zh).map(([ic, title, body]) => `<div class="flex items-start gap-3 rounded-xl bg-surface-dark/60 p-3">
    ${icon(ic, 'text-gold-accent text-[20px]')}
    <div><div class="font-label-capsule text-label-capsule text-text-light-primary">${esc(title)}</div><div class="font-body-sm text-body-sm text-text-light-secondary">${esc(body)}</div></div>
  </div>`).join('');
  return `<section class="w-full py-space-2xl bg-canvas-dark text-text-light-secondary rounded-3xl my-space-lg" id="local-first">
  <div class="max-w-6xl mx-auto px-margin-mobile">
    <div class="flex flex-col md:flex-row md:items-end justify-between mb-space-xl gap-4">
      <div>
        <span class="font-label-capsule text-label-capsule text-gold-accent uppercase tracking-wider">${isEn ? 'Honest boundaries, by design' : '诚实披露与技术边界'}</span>
        <h2 class="font-headline-lg text-headline-lg text-text-light-primary mt-1">${isEn ? 'Trust starts with saying what we cannot do' : '建立信任的前提，是坦白不隐瞒'}</h2>
      </div>
      <p class="font-body-sm text-body-sm text-text-light-secondary max-w-md">${isEn ? 'No exaggerated claims and no magic. We spell out the limits so you can buy with confidence.' : '我们不夸大宣传，也不承诺无法企及的技术黑魔法。把边界交代清楚，让您买得踏实、用得放心。'}</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-space-xl">${cards}</div>
    <div class="rounded-2xl border border-border-dark bg-surface-dark/40 p-4 sm:p-5">
      <div class="flex items-center justify-between mb-space-md">
        <div class="font-label-capsule text-label-capsule text-text-light-primary uppercase tracking-wider">${isEn ? 'Your data, on your machine' : '你的数据，只在你的电脑上'}</div>
        <a class="font-body-sm text-body-sm text-gold-accent hover:text-text-light-primary transition-colors" href="${routeTo('/#local-first', lang)}">${isEn ? 'How local-first works' : '了解本地优先架构'}</a>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">${tiles}</div>
    </div>
  </div>
</section>`;
}

/* ------------------------------------------------------ Desktop/video */

export function desktopSection({ lang, hasVideo = false }) {
  const isEn = lang === 'en';
  const media = hasVideo
    ? `<div class="video-shell" data-video-demo><video preload="metadata" playsinline muted loop poster="${asset('img-2.jpg')}"><source src="${asset('video/demo.mp4')}" type="video/mp4"/></video><div class="video-poster" data-video-poster><button class="video-play" type="button" aria-label="${isEn ? 'Play product demo' : '播放产品演示'}">${icon('play_arrow', 'text-[32px]')}</button><div class="font-label-capsule text-label-capsule text-text-light-primary">${isEn ? 'Product demo' : '产品演示视频'}</div></div></div>`
    : `<div class="relative overflow-hidden rounded-2xl bg-canvas-dark shadow-2xl shadow-canvas-dark/20">
      <img alt="${isEn ? 'A creator workspace with a monitor showing an editing timeline' : '创作者工作台实景：显示器上正在剪辑内容'}" class="h-full w-full object-cover" src="${asset('img-2.jpg')}" width="512" height="279" loading="lazy"/>
      <div class="absolute inset-0 bg-gradient-to-t from-canvas-dark/90 via-canvas-dark/20 to-transparent"></div>
      <div class="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
        <div class="text-text-light-primary">
          <div class="font-label-capsule text-label-capsule text-gold-accent">${isEn ? 'Desktop app' : '桌面客户端'}</div>
          <div class="font-headline-sm text-headline-sm">${isEn ? 'Close the window. The schedule keeps running.' : '关掉窗口，排期照常在跑'}</div>
        </div>
        <span class="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-surface-dark/80 px-3 py-1.5 font-label-capsule text-body-sm text-text-light-secondary backdrop-blur">${icon('schedule', 'text-[15px] text-status-success')} ${isEn ? 'Tray resident' : '托盘常驻'}</span>
      </div>
    </div>`;
  const points = [
    ['minimize', isEn ? 'Minimize to the tray' : '最小化到托盘', isEn ? 'Scheduled publishing and data sync keep running after you close the window.' : '关闭窗口后，定时发布与数据同步继续执行，不必让浏览器一直开着。'],
    ['autorenew', isEn ? 'Updates as platforms change' : '平台改版跟着适配', isEn ? 'The client auto-updates on Windows and Linux with compatibility patches.' : 'Windows 与 Linux 客户端自动更新，平台改版时持续推送适配补丁。'],
    ['devices', isEn ? 'Windows, macOS, Linux' : 'Windows / macOS / Linux', isEn ? 'Native installers for all three. macOS builds are unsigned and open via right-click.' : '三套系统原生安装包。macOS 当前未签名，首次打开需右键「打开」。'],
  ].map(([ic, title, body]) => `<div class="flex items-start gap-3">
    <div class="w-10 h-10 shrink-0 rounded-full bg-surface-container-low flex items-center justify-center text-primary">${icon(ic, 'text-[20px]')}</div>
    <div><div class="font-headline-sm text-[16px] text-on-surface font-semibold">${esc(title)}</div><p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${esc(body)}</p></div>
  </div>`).join('');
  return `<section class="w-full py-space-3xl">
  <div class="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-space-xl lg:gap-space-2xl items-center">
    <div>
      <span class="section-eyebrow">${isEn ? 'Why a desktop app' : '为什么是桌面应用'}</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface mt-1 mb-3">${isEn ? 'It runs quietly, so you do not have to babysit it' : '它安静地跑，你安心做内容'}</h2>
      <p class="font-body-md text-body-md text-on-surface-variant mb-space-lg">${isEn ? 'Publishing needs your own browser session and big local files. A desktop app handles both, and keeps working after the window is closed.' : '发布需要你自己的登录态和大体积素材，桌面端才能安全处理这两件事，并且在窗口关闭后继续运行。'}</p>
      <div class="space-y-space-md">${points}</div>
    </div>
    <div>${media}</div>
  </div>
</section>`;
}

/* ------------------------------------------------------------ Pricing */

const PREVIEW_FEATURES = {
  zh: {
    monthly: ['8 大平台定时自动发布', '4 大平台数据自动回流复盘', '授权激活 3 台个人设备', '订阅期内全功能更新与支持'],
    yearly: ['<strong>包含全部功能与全平台发布</strong>', '4 大平台数据回流及导出 CSV', '授权同时激活 3 台设备', '1 年内版本自动升级与改版适配', '优先邮件与社群工单技术答疑'],
    lifetime: ['永久使用 WeMedia 全部核心模块', '终身常规适配补丁与故障修复', '3 台设备授权，支持自助换机解绑', '专属创作者交流内测渠道'],
  },
  en: {
    monthly: ['Scheduled publishing to all 8 platforms', 'Automatic analytics for 4 platforms', 'Activate up to 3 personal devices', 'Every feature and update while subscribed'],
    yearly: ['<strong>All features, every platform</strong>', 'Analytics for 4 platforms plus CSV export', 'Activate up to 3 devices', 'Version updates and platform fixes for a year', 'Priority email and community support'],
    lifetime: ['Every core module, permanently', 'Lifetime compatibility patches and fixes', '3 devices with self-service transfer', 'Private creator channel for early builds'],
  },
};

const PREVIEW_LABELS = {
  zh: {
    eyebrow: '透明价格方案',
    title: '一份授权，三种买法 · 功能完全一致',
    desc: '没有低版本阉割功能的套路，全功能开放，按您的现金流节奏自由选择。',
    cta: { monthly: '按月试水', yearly: '立即订阅年付', lifetime: '终身一次买断' },
    popular: '最受欢迎 · 省 ¥98.8',
    once: '一次买断',
  },
  en: {
    eyebrow: 'Transparent pricing',
    title: 'One license, three ways to pay. Same features in every plan.',
    desc: 'No cut-down tiers. Every feature included — choose the rhythm that fits your cash flow.',
    cta: { monthly: 'Start monthly', yearly: 'Subscribe yearly', lifetime: 'Buy lifetime' },
    popular: 'Most popular · Save $20',
    once: 'one-time',
  },
};

export function pricingCards({ lang, detailed = false, preview = false, checkout = '' }) {
  const isEn = lang === 'en';
  const labels = PREVIEW_LABELS[lang] || PREVIEW_LABELS.zh;
  const feats = PREVIEW_FEATURES[lang] || PREVIEW_FEATURES.zh;
  return PLANS.map((plan) => {
    const featured = plan.id === 'yearly';
    const listItems = preview || detailed ? feats[plan.id] : isEn ? PLAN_FEATURES_EN : PLAN_FEATURES_ZH;
    const list = listItems
      .map((f) => `<li class="check-item">${icon('check_circle')} <span>${f}</span></li>`)
      .join('');
    const badge = featured
      ? `<div class="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-canvas-dark text-gold-accent font-label-capsule text-[11px] uppercase tracking-wider shadow">${esc(labels.popular)}</div>`
      : '';
    const unit = isEn ? plan.unitEn : plan.unitZh;
    const tagline = isEn ? plan.taglineEn : plan.taglineZh;
    const amount = isEn ? plan.priceUsd : plan.price;
    const symbol = isEn ? '$' : '¥';
    const ctaCls = featured
      ? 'bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark shadow'
      : 'bg-surface-container-low hover:bg-surface-container text-on-surface';
    return `<div class="price-card ${featured ? 'price-card-featured' : ''}">
      ${badge}
      <div>
        <div class="font-label-capsule text-label-capsule ${featured ? 'text-primary' : 'text-on-surface-variant'} uppercase">${esc(isEn ? plan.nameEn : plan.nameZh)}</div>
        <div class="mt-4 flex items-baseline gap-1">
          <span class="text-display-hero-mobile font-bold text-on-surface">${symbol}${amount}</span>
          <span class="text-body-sm text-on-surface-variant">${esc(unit)}</span>
        </div>
        <p class="font-body-sm text-body-sm ${featured ? 'text-status-success' : 'text-on-surface-variant'} mt-2">${esc(tagline)}</p>
        <ul class="mt-6 space-y-3 font-body-sm text-on-surface">${list}</ul>
      </div>
      <a class="mt-8 w-full py-3 rounded-full ${ctaCls} text-center font-label-capsule text-label-capsule transition-colors" href="${checkoutUrl(plan.id, lang, checkout)}">${esc(labels.cta[plan.id])}</a>
    </div>`;
  }).join('');
}

export function pricingPreview({ lang, checkout = '' }) {
  const isEn = lang === 'en';
  const labels = PREVIEW_LABELS[lang] || PREVIEW_LABELS.zh;
  return `<section class="w-full py-space-3xl" id="pricing">
  <div class="max-w-6xl mx-auto">
    ${sectionHeading({ lang, eyebrow: labels.eyebrow, title: labels.title, desc: labels.desc })}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter items-stretch">${pricingCards({ lang, preview: true, checkout })}</div>
    <p class="mt-6 text-center font-body-sm text-body-sm text-on-surface-variant">${isEn ? 'Prices are in USD. Licensing and refund terms are shown at checkout.' : '价格为人民币（CNY）；授权与退款条款以购买页为准。'} <a class="text-primary underline decoration-gold-accent decoration-2 underline-offset-2" href="${routeTo('/pricing/', lang)}">${isEn ? 'Compare plans' : '查看完整价格页'}</a></p>
  </div>
</section>`;
}

/* ----------------------------------------------------------- Personas */

const PERSONAS = {
  zh: [
    ['solo', 'person', '一人创作者 · 副业博主', '每周 3–10 条，分发 4–8 个平台。', '一个人，也能稳定运营八个平台', '用排期与自动发布守住节奏，不再靠熬夜补更。'],
    ['team', 'groups', '小团队主理人', '1–3 人，编辑 + 运营。', '小团队的排期、审稿与复盘，放在同一张表', '阶段、负责人和数据口径统一，沟通成本降下来。'],
    ['overseas', 'public', '海外中文创作者', '人在海外，运营国内平台。', '人在海外，内容按时出现在国内平台', '跨时区定时、桌面常驻，不用守在国内的发布时间。'],
  ],
  en: [
    ['solo', 'person', 'Solo creator', '3–10 posts a week across 4–8 platforms.', 'One person can keep eight platforms running', 'Schedules and automatic publishing hold the rhythm.'],
    ['team', 'groups', 'Small team lead', '1–3 people: editor plus operations.', 'Schedules, reviews, and analytics on one table', 'Aligned stages, owners, and metrics cut coordination cost.'],
    ['overseas', 'public', 'Creator abroad', 'Living overseas, publishing to Chinese platforms.', 'Your content lands on time back home', 'Cross-timezone schedules and a desktop app that stays resident.'],
  ],
};

export function personasPreview({ lang }) {
  const isEn = lang === 'en';
  const cards = (PERSONAS[lang] || PERSONAS.zh).map(([slug, ic, who, meta, title, body]) => `<a class="group p-6 rounded-2xl bg-surface-white shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between" href="${routeTo(`/use-cases/${slug}/`, lang)}">
    <div>
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary">${icon(ic, 'text-[20px]')}</div>
        <div>
          <div class="font-label-capsule text-label-capsule text-on-surface">${esc(who)}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(meta)}</div>
        </div>
      </div>
      <div class="font-headline-sm text-headline-sm text-on-surface mb-2">${esc(title)}</div>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(body)}</p>
    </div>
    <span class="mt-5 inline-flex items-center gap-1 font-label-capsule text-body-sm text-primary group-hover:gap-2 transition-all">${isEn ? 'Read the use case' : '查看使用场景'} ${icon('arrow_forward', 'text-[16px]')}</span>
  </a>`).join('');
  return `<section class="w-full py-space-3xl">
  <div class="max-w-6xl mx-auto">
    ${sectionHeading({ lang, eyebrow: isEn ? 'Who it is for' : '适用人群', title: isEn ? 'Built for people who publish every week' : '看看你属于哪一种', desc: isEn ? 'Different setups, same need: a stable rhythm and numbers you can trust.' : '不同的身份，相同的诉求：稳定的节奏，和看得懂的数据。' })}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-gutter">${cards}</div>
  </div>
</section>`;
}

/* ---------------------------------------------------------------- FAQ */

export const FAQ_PREVIEW = {
  zh: [
    ['会不会把我账号封了？安全吗？', '工作台通过您本机的 Chrome/Edge 环境直接与平台交互，使用您自身的 IP 与 Cookie 登录态，绝不共享中转。同时内置防风控执行间隔与失败温和重试机制。自动化仍受平台风控策略影响，我们不能承诺 100% 不受影响。'],
    ['我的内容素材和数据保存在哪里？', '全部存储在您自己电脑本地的 SQLite 数据库文件中。不向任何云端上传，即使断网也能完全浏览历史排期、素材与本地复盘报表，支持随时一键导出为通用 CSV。'],
    ['我需要申请各平台的开发者 API 资质吗？', '完全不需要。普通个人作者根本拿不到各平台的官方企业开发者资质。WeMedia 采用桌面原生一键扫码登录，扫码成功后登录态自动保存在本机，零门槛开箱即用。'],
    ['平台界面改版导致自动化失败怎么办？', '维护团队持续监测各平台的结构变动。一旦检测到改版，会推送桌面端热适配更新；发布任务会自动核验，失败可安全重试，不会因为一次失败丢失排期。'],
    ['一份授权码支持在几台电脑上使用？', '每个授权码标准支持同时激活 3 台设备（例如工作台式机、随身笔记本与备用机）。换新电脑时，可以通过客户端自助解绑旧设备进行迁移。'],
    ['月付、年付与终身买断的功能有差异吗？', '功能完全一致，不设功能墙或低价阉割。唯一的差异是付费周期与授权期限：年付最具性价比，终身买断一次付费、终身免续费。'],
  ],
  en: [
    ['Could my account get banned?', 'The app talks to platforms through Chrome or Edge on your own machine, using your own IP and signed-in session — never a shared relay. We add pacing and gentle retries. Automation is still subject to platform risk controls, so we cannot promise zero risk.'],
    ['Where are my assets and data stored?', 'In a local SQLite database on your computer. Nothing is uploaded. You can browse schedules and reviews offline, and export CSV at any time.'],
    ['Do I need developer API credentials?', 'No. Individual creators cannot usually obtain enterprise API access anyway. Sign in with a QR code in an isolated browser window; the session stays on your machine.'],
    ['What if a platform redesign breaks automation?', 'We monitor platform changes and ship compatibility updates. Every publish is verified, and failed tasks can be retried safely without losing the schedule.'],
    ['How many computers can use one license?', 'Each license activates up to three devices — a desktop, a laptop, and a spare, for example. You can unbind an old device in the client when you move.'],
    ['Are the three plans different in features?', 'No. Features are identical; only billing and duration differ. Yearly offers the best value, and lifetime is a one-time payment with no renewals.'],
  ],
};

export function faqList({ lang, items, openFirst = false }) {
  return items.map(([q, a], i) => `<details class="faq-item"${openFirst && i === 0 ? ' open' : ''}>
    <summary>${esc(q)}${icon('expand_more', 'faq-chevron')}</summary>
    <div class="faq-answer">${esc(a)}</div>
  </details>`).join('');
}

export function faqPreview({ lang }) {
  const isEn = lang === 'en';
  const items = FAQ_PREVIEW[lang] || FAQ_PREVIEW.zh;
  return `<section class="w-full py-space-3xl bg-surface-container-low/50 rounded-3xl my-space-lg" id="faq">
  <div class="max-w-4xl mx-auto px-margin-mobile">
    <div class="text-center mb-space-2xl">
      <span class="section-eyebrow">${isEn ? 'Clear the doubts' : '解除疑虑'}</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface mt-1">${isEn ? 'Six questions before you buy' : '购买前的 6 个核心问答'}</h2>
    </div>
    <div class="space-y-3" id="faq-list">${faqList({ lang, items, openFirst: true })}</div>
    <p class="mt-6 text-center font-body-sm text-body-sm text-on-surface-variant"><a class="text-primary underline decoration-gold-accent decoration-2 underline-offset-2" href="${routeTo('/faq/', lang)}">${isEn ? 'See all frequently asked questions' : '查看全部常见问题'}</a></p>
  </div>
</section>`;
}

/* ------------------------------------------------------- Feedback band */

export function feedbackBand({ lang }) {
  const isEn = lang === 'en';
  return `<section class="w-full py-space-2xl my-space-lg">
  <div class="max-w-6xl mx-auto rounded-3xl bg-surface-container-low p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
    <div class="flex items-start gap-4">
      <div class="w-12 h-12 shrink-0 rounded-full bg-gold-accent flex items-center justify-center text-canvas-dark">${icon('forum', 'text-[22px]')}</div>
      <div>
        <div class="font-headline-sm text-headline-sm text-on-surface">${isEn ? 'Tell us what it should solve for you' : '告诉我们，你希望它替你解决什么'}</div>
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-1 max-w-xl">${isEn ? 'Feature ideas, problems, and licensing questions are all welcome. Purchase inquiries are answered within one business day.' : '功能建议、问题反馈与购买咨询都可以提交。购买咨询会在 1 个工作日内回复。'}</p>
      </div>
    </div>
    <a class="shrink-0 inline-flex items-center justify-center gap-2 rounded-full bg-canvas-dark px-6 py-3 font-label-capsule text-label-capsule text-text-light-primary hover:bg-surface-dark-elevated transition-colors" href="${routeTo('/feedback/', lang)}">${icon('edit_note', 'text-[18px]')} ${isEn ? 'Send feedback' : '提交反馈'}</a>
  </div>
</section>`;
}

/* --------------------------------------------------------- Final CTA */

export function finalCta({ lang }) {
  const isEn = lang === 'en';
  return `<section class="w-full py-space-3xl mb-space-2xl" id="download">
  <div class="max-w-6xl mx-auto rounded-3xl bg-canvas-dark text-text-light-primary p-8 md:p-14 relative overflow-hidden flex flex-col items-center text-center">
    <div class="absolute -top-24 right-1/4 w-96 h-96 bg-gold-accent/20 rounded-full blur-[100px] pointer-events-none"></div>
    <div class="relative z-10 max-w-2xl flex flex-col items-center">
      <span class="px-3.5 py-1 rounded-full bg-surface-dark text-gold-accent font-label-capsule text-body-sm mb-4">${isEn ? 'Give the time back to creating' : '把时间还给好创作'}</span>
      <h2 class="font-headline-lg text-headline-lg md:text-display-hero text-text-light-primary mb-4 leading-tight">${isEn ? 'Stop reposting and copying dashboards' : '告别重复发帖与手抄后台'}</h2>
      <p class="font-body-lg text-body-lg text-text-light-secondary mb-8">${isEn ? 'Download the workbench and run an eight-platform content matrix from one computer and one table.' : '现在就下载 WeMedia 本地工作台，用一台电脑、一张表，轻松稳固运营八个平台的内容矩阵。'}</p>
      <div class="flex flex-wrap items-center justify-center gap-4">
        <a class="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark font-label-capsule text-label-capsule shadow-xl transition-all transform hover:-translate-y-0.5" href="${routeTo('/download/', lang)}">
          ${icon('download', 'text-[20px] fill')}<span>${isEn ? `Download free (v${VERSION})` : `免费下载体验 (v${VERSION})`}</span>
        </a>
        <a class="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-surface-dark hover:bg-surface-dark-elevated text-text-light-primary font-label-capsule text-label-capsule transition-colors" href="${routeTo('/pricing/', lang)}"><span>${isEn ? 'Buy a license' : '购买正式授权'}</span></a>
      </div>
      <div class="mt-8 flex flex-wrap items-center justify-center gap-6 text-body-sm text-text-light-secondary">
        <span class="flex items-center gap-1.5">${icon('verified', 'text-[16px] text-status-success')} ${isEn ? 'No cloud account' : '免注册云端账号'}</span>
        <span class="flex items-center gap-1.5">${icon('verified', 'text-[16px] text-status-success')} ${isEn ? 'Single-machine install' : '绿色单机安装'}</span>
        <span class="flex items-center gap-1.5">${icon('verified', 'text-[16px] text-status-success')} ${isEn ? '14-day refund policy' : '14 天退款无忧保证'}</span>
      </div>
    </div>
  </div>
</section>`;
}

/* --------------------------------------------------------- Page hero */

export function pageHero({ lang, eyebrow, title, description, breadcrumbHtml = '', actions = '', narrow = false }) {
  return `<section class="relative w-full pt-space-xl pb-space-xl">
  <div class="absolute top-0 left-1/2 -translate-x-1/2 w-[640px] h-[280px] bg-gold-accent/10 rounded-full blur-[100px] pointer-events-none -z-10"></div>
  ${breadcrumbHtml}
  <div class="${narrow ? 'max-w-3xl' : 'max-w-4xl'} mt-space-lg">
    ${eyebrow ? `<span class="section-eyebrow">${esc(eyebrow)}</span>` : ''}
    <h1 class="font-display-hero text-headline-lg-mobile lg:text-headline-lg text-on-surface tracking-tight leading-tight mt-2 mb-space-md">${title}</h1>
    <p class="font-body-lg text-body-lg text-on-surface-variant max-w-3xl">${esc(description)}</p>
    ${actions ? `<div class="mt-space-xl flex flex-wrap items-center gap-space-md">${actions}</div>` : ''}
  </div>
</section>`;
}

export function primaryButton({ href, label, download = false }) {
  return `<a class="inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-gold-accent hover:bg-gold-accent-hover text-canvas-dark font-label-capsule text-label-capsule shadow-lg shadow-gold-accent/25 transition-all transform hover:-translate-y-0.5" href="${href}">
    ${icon(download ? 'download' : 'arrow_forward', 'text-[18px]')}<span>${esc(label)}</span>
  </a>`;
}

export function secondaryButton({ href, label }) {
  return `<a class="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-surface-white hover:bg-surface-container-low text-on-surface font-label-capsule text-label-capsule shadow-sm transition-all" href="${href}">${esc(label)}</a>`;
}

/* --------------------------------------------------------- Card grids */

export function cardGrid({ items, cols = 3, className = '' }) {
  const colClass = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[cols] || 'md:grid-cols-3';
  return `<div class="grid grid-cols-1 ${colClass} gap-gutter ${className}">${items.join('')}</div>`;
}

export function featureCard({ iconName, title, body, href = '' }) {
  const inner = `<div class="p-6 rounded-2xl bg-surface-white shadow-sm flex flex-col h-full ${href ? 'hover:shadow-md transition-shadow' : ''}">
    <div class="w-10 h-10 rounded-full bg-surface-container-low flex items-center justify-center text-primary mb-4">${icon(iconName, 'text-[22px]')}</div>
    <div class="font-headline-sm text-headline-sm text-on-surface mb-2">${esc(title)}</div>
    <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(body)}</p>
  </div>`;
  return href ? `<a href="${href}" class="group flex">${inner}</a>` : inner;
}

export function infoCard({ title, body, tag = '', tone = 'light' }) {
  const toneCls = tone === 'dark' ? 'bg-surface-dark text-text-light-secondary' : 'bg-surface-white text-on-surface-variant';
  const titleCls = tone === 'dark' ? 'text-text-light-primary' : 'text-on-surface';
  return `<div class="p-6 rounded-2xl ${toneCls} shadow-sm">
    ${tag ? `<span class="inline-block mb-3 rounded-full ${tone === 'dark' ? 'bg-canvas-dark text-gold-accent' : 'bg-gold-subtle text-primary'} px-3 py-1 font-label-capsule text-[11px] uppercase tracking-wider">${esc(tag)}</span>` : ''}
    <div class="font-headline-sm text-headline-sm ${titleCls} mb-2">${esc(title)}</div>
    <p class="font-body-sm text-body-sm">${esc(body)}</p>
  </div>`;
}

export function table({ head, rows }) {
  return `<div class="overflow-x-auto rounded-2xl bg-surface-white shadow-sm">
  <table class="compare-table">
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>
</div>`;
}

export { MOCKUP };
