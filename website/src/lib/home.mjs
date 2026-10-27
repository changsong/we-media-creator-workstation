import { layout, absolute, routeTo } from './layout.mjs';
import { PLANS, VERSION } from '../config.mjs';
import { FAQ_PREVIEW, hero, platformBar, painOutcome, workflow, benefits, trustSection, desktopSection, pricingPreview, personasPreview, faqPreview, feedbackBand, finalCta } from './components.mjs';

const META = {
  zh: {
    title: '自媒体内容运营工作台｜八平台一键发布与数据复盘',
    description:
      '本地优先的自媒体运营工具：选题、排期、8 平台自动发布，抖音/小红书/视频号/公众号数据自动复盘，账号与素材留在本机。支持 Windows / macOS / Linux。',
  },
  en: {
    title: 'WeMedia Creator Workstation | Multi-platform publishing & analytics',
    description:
      'A local-first desktop workspace to plan, schedule, auto-publish to 8 Chinese platforms, and review performance. Your accounts and data stay on your machine.',
  },
};

function appJsonLd(lang) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: lang === 'en' ? 'WeMedia Creator Workstation' : '自媒体内容运营工作台',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Windows 10+, macOS 11+, Ubuntu 22.04+',
    softwareVersion: VERSION,
    url: absolute('/', lang),
    downloadUrl: absolute('/download/', lang),
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
