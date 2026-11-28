import { layout, absolute, assetAbsolute, routeTo, siteRoot } from './layout.mjs';
import { PLANS, RELEASES, VERSION } from '../config.mjs';
import { FAQ_PREVIEW, hero, aboutApp, platformBar, painOutcome, workflow, studioSection, benefits, multiAccount, trustSection, desktopSection, pricingPreview, personasPreview, faqPreview, feedbackBand, finalCta } from './components.mjs';

const META = {
  zh: {
    title: '媒管家 WeMedia Creator｜自媒体多平台发布与数据复盘工具',
    description:
      '自媒体多平台发布与数据复盘工具：视频工坊做片、爆款雷达找选题、8 平台自动发布、8 平台作品数据回流（知乎覆盖视频作品），本机多运营账号独立隔离、一份授权通用。',
  },
  en: {
    title: 'WeMedia Creator | Video workshop, publishing & analytics',
    description:
      'Local-first desktop app: make videos in the video workshop, auto-publish to 8 Chinese platforms, review analytics, and run isolated accounts on one machine, one license.',
  },
};

function appJsonLd(lang) {
  const win = RELEASES.platforms.win.x64.exe;
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: lang === 'en' ? 'WeMedia Creator' : '媒管家',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Windows 10+, macOS 11+, Ubuntu 22.04+',
    softwareVersion: VERSION,
    description: lang === 'en'
      ? 'Local-first desktop workspace for planning, publishing, and reviewing content across eight Chinese social platforms.'
      : '本地优先的自媒体桌面工作台，面向八个平台完成内容排期、自动发布与数据复盘。',
    url: absolute('/', lang),
    downloadUrl: win.url,
    fileSize: String(win.size),
    datePublished: String(RELEASES.releaseDate).slice(0, 10),
    inLanguage: lang === 'en' ? 'en' : 'zh-CN',
    image: assetAbsolute('og.png'),
    screenshot: assetAbsolute('og.png'),
    publisher: { '@type': 'Organization', '@id': `${siteRoot()}/#organization`, name: 'WeMedia Studio' },
    offers: PLANS.map((plan) => ({
      '@type': 'Offer',
      name: lang === 'en' ? plan.nameEn : plan.nameZh,
      price: lang === 'en' ? plan.priceUsd : plan.price,
      priceCurrency: lang === 'en' ? 'USD' : 'CNY',
      url: absolute('/pricing/', lang),
      availability: 'https://schema.org/InStock',
    })),
  };
}

function faqJsonLd(lang) {
  const items = FAQ_PREVIEW[lang] || FAQ_PREVIEW.zh;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

export function renderHome({ lang = 'zh', checkout = '', hasVideo = false } = {}) {
  const meta = META[lang] || META.zh;
  const body = [
    hero({ lang }),
    aboutApp({ lang }),
    platformBar({ lang }),
    painOutcome({ lang }),
    workflow({ lang }),
    studioSection({ lang }),
    benefits({ lang }),
    multiAccount({ lang }),
    trustSection({ lang }),
    desktopSection({ lang, hasVideo }),
    pricingPreview({ lang, checkout }),
    personasPreview({ lang }),
    faqPreview({ lang }),
    feedbackBand({ lang }),
    finalCta({ lang }),
  ].join('\n');
  return layout({
    lang,
    route: '/',
    title: meta.title,
    description: meta.description,
    body,
    jsonLd: [appJsonLd(lang), faqJsonLd(lang)],
  });
}

export { META as homeMeta };
