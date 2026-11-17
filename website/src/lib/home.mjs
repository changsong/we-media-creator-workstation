import { layout, absolute, assetAbsolute, routeTo, siteRoot } from './layout.mjs';
import { PLANS, RELEASES, VERSION } from '../config.mjs';
import { FAQ_PREVIEW, hero, platformBar, painOutcome, workflow, benefits, trustSection, desktopSection, pricingPreview, personasPreview, faqPreview, feedbackBand, finalCta } from './components.mjs';

const META = {
  zh: {
    title: '媒管家｜自媒体多平台发布与数据复盘工具',
    description:
      '自媒体多平台发布与数据复盘工具：爆款雷达找选题、8 平台自动发布、8 平台作品数据回流（知乎覆盖视频作品），账号与素材留在本机。',
  },
  en: {
    title: 'WeMedia Creator | Multi-platform publishing & analytics',
    description:
      'Local-first desktop app to find ideas, auto-publish to 8 Chinese platforms, and review performance across all eight. Accounts and data stay on your machine.',
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
    platformBar({ lang }),
    painOutcome({ lang }),
    workflow({ lang }),
    benefits({ lang }),
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
