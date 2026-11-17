import { render } from './util.mjs';

export function pickOpener(bank, lead, templateArg = '') {
  if (templateArg) {
    const hit = bank.openers.find((item) => item.id === templateArg || item.id.startsWith(templateArg + '-'));
    if (!hit) throw new Error(`找不到模板 ${templateArg}，可选：${bank.openers.map((o) => o.id).join(', ')}`);
    return hit;
  }
  const sorted = [...bank.openers].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[lead.id % sorted.length];
}

export function draftFor(bank, lead, templateArg = '') {
  const opener = pickOpener(bank, lead, templateArg);
  const cfg = bank.settings;
  const text = render(opener.text, {
    nickname: lead.nickname || '你好',
    niche: lead.niche || '自媒体',
    trial_url: cfg.trialUrl,
    site_url: cfg.siteUrl,
    trial_days: cfg.trialDays,
  });
  return { opener, text };
}
