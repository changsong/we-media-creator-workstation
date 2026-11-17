const SHINGLE = 15;
const SLUG_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAGS = new Set(['拍摄', '剪辑', '运营', '选题', '封面', '收音', '灯光', '账号']);

const count = (text) => [...String(text || '')].length;

function normalize(text) {
  return String(text || '').replace(/[\s\p{P}\p{S}]/gu, '');
}

function shingles(text) {
  const clean = normalize(text);
  const chars = [...clean];
  const out = new Set();
  for (let i = 0; i + SHINGLE <= chars.length; i += 1) out.add(chars.slice(i, i + SHINGLE).join(''));
  return out;
}

export function overlapRatio(generated, source) {
  const generatedShingles = shingles(generated);
  if (!generatedShingles.size) return 0;
  const sourceShingles = shingles(source);
  let shared = 0;
  for (const shingle of generatedShingles) if (sourceShingles.has(shingle)) shared += 1;
  return shared / generatedShingles.size;
}

export function slugifyAscii(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
}

export function buildArticle(raw, candidate, { today, existingSlugs = new Set(), existingTitles = new Set() }) {
  const errors = [];
  const title = String(raw?.title || '').trim();
  const description = String(raw?.description || '').trim();
  const intro = String(raw?.intro || '').trim();
  const tag = String(raw?.tag || candidate.tag || '').trim();
  const sections = Array.isArray(raw?.sections) ? raw.sections : [];
  const takeaways = Array.isArray(raw?.takeaways) ? raw.takeaways.map((s) => String(s).trim()).filter(Boolean) : [];

  const titleLen = count(title);
  if (titleLen < 12 || titleLen > 40) errors.push(`标题 ${titleLen} 字（应为 12-40）`);
  if (title && existingTitles.has(normalize(title))) errors.push(`标题与已有文章重复：${title}`);
  const descLen = count(description);
  if (descLen < 50 || descLen > 90) errors.push(`描述 ${descLen} 字（应为 50-90）`);
  if (!TAGS.has(tag)) errors.push(`标签「${tag}」不在允许范围`);
  if (count(intro) < 60) errors.push('开场过短');

  if (sections.length < 2 || sections.length > 5) errors.push(`sections 数量 ${sections.length}（应为 2-5）`);
  let bodyChars = count(intro);
  for (const [index, section] of sections.entries()) {
    const h2 = String(section?.h2 || '').trim();
    const ps = Array.isArray(section?.ps) ? section.ps.map((p) => String(p).trim()).filter(Boolean) : [];
    if (!h2) errors.push(`第 ${index + 1} 节缺少小标题`);
    if (!ps.length) errors.push(`第 ${index + 1} 节没有段落`);
    bodyChars += count(h2) + ps.reduce((sum, p) => sum + count(p), 0);
  }
  if (bodyChars < 700) errors.push(`正文 ${bodyChars} 字（下限 700）`);
  if (takeaways.length < 3 || takeaways.length > 5) errors.push(`takeaways 数量 ${takeaways.length}（应为 3-5）`);

  const bodyText = [intro, ...sections.flatMap((s) => [s?.h2 || '', ...(s?.ps || [])])].join('\n');
  const ratio = overlapRatio(`${title}\n${bodyText}`, candidate.summary || '');
  if (ratio > 0.3) errors.push(`与来源摘要重合率 ${(ratio * 100).toFixed(1)}%（上限 30%）`);

  const slugBase = slugifyAscii(raw?.slugEn) || slugifyAscii(candidate.title) || 'jiayouzhan';
  const slug = `${today}-${slugBase}`;
  if (!SLUG_RE.test(slug)) errors.push(`slug 不合法：${slug}`);
  if (existingSlugs.has(slug)) errors.push(`slug 已存在：${slug}`);

  const article = {
    slug,
    date: today,
    title,
    description,
    tag,
    intro,
    sections: sections.map((s) => ({
      h2: String(s.h2 || '').trim(),
      ps: (s.ps || []).map((p) => String(p).trim()).filter(Boolean),
    })),
    takeaways,
    sourceName: candidate.source,
    sourceUrl: candidate.url,
    status: 'published',
  };

  return { ok: errors.length === 0, errors, article, ratio, bodyChars };
}

export function findBannedWords(article, bannedWords = []) {
  const text = [article.title, article.description, article.intro, ...(article.takeaways || [])].join('\n');
  return bannedWords.filter((word) => word && text.includes(word));
}
