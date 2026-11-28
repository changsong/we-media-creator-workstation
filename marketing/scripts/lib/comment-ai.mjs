import { generateJson, loadAiConfig } from './ai-deepseek.mjs';
import { loadCommentsConfig } from './comment-intent.mjs';

const FALLBACKS = {
  multi_platform: [
    '多平台发布确实最耗时间，尤其是每个平台重复上传、改标题。建议先把一周内容集中排期，再按平台微调。我们做的「媒管家」就是桌面端一次排期发到多个平台，{cta}，需要的话回我。',
    '同感，号一多光切后台就够呛。我现在固定一周排一次稿，把发布时间错开，省不少来回切换。我们自己的工具「媒管家」支持一次排期发到 8 个平台，{cta}。',
  ],
  matrix: [
    '多账号管理最怕账号多了记混。建议先按平台分组，再固定一个排期表。我们做的「媒管家」可以在桌面端统一管多个账号、一次排期发布，{cta}。',
    '矩阵号一多，发布和数据统计很容易乱。我现在的做法是把账号分组、按周排期，再用工具统一发。我们自己的「媒管家」就是干这个的，{cta}。',
  ],
  management: [
    '自媒体管理工具别贪功能多，先看能不能把发布和复盘串起来。建议先把发布流程固定下来，再选工具。我们做的「媒管家」桌面端支持排期发布和数据回流，{cta}。',
    '管理工具我试过不少，核心还是排期和数据能不能放一起。我们现在用「媒管家」做排期和数据回流，{cta}，你可以试试。',
  ],
  pain: [
    '一个个传确实顶不住，尤其是号多的时候。建议先把内容集中排期，再按平台改格式。我们做的「媒管家」可以一次排期发到多个平台，{cta}。',
    '手动发太耗时间了，我之前也是切后台切到崩溃。后来把发布集中排期，能省一半时间。我们自己的工具「媒管家」就是做这个的，{cta}。',
  ],
  ask: [
    '可以先从排期工具入手，把发布流程固定下来。我们做的「媒管家」桌面端支持多平台排期发布和数据回流，{cta}，需要的话回我。',
    '看你现在主要做视频还是图文。视频多平台发布的话，可以试试我们做的「媒管家」，一次排期发到 8 个平台，{cta}。',
  ],
  competitor: [
    '你提到的绑定流程确实是最容易劝退的一步。我们做的「媒管家」在这块是登录态只存本机，绑定一次后桌面端排期发布，不用反复扫码，{cta}，你可以对比下绑定流程。',
    '你用的那个工具我没深度用过，不好评价；不过绑定麻烦确实是大家共同的痛点。我们的「媒管家」把登录态放在本地，绑定一次后多平台排期发布，{cta}。',
  ],
  security: [
    '多平台自动发布确实有风控风险，关键看登录态是不是只存在本机、发布频率能不能自己控。我们做的「媒管家」登录态和数据都放本地，频率自己排，但不承诺零风险，{cta}，可以先小规模试。',
    '封号这事没人能保证百分百避免，能控制的是登录环境和发布频率。我们的「媒管家」把登录态放在本机，不经过第三方服务器，{cta}，你可以先用小号试。',
  ],
  default: [
    '这个要看你现在主要做哪些平台、最头疼的是发布还是数据。我们做的「媒管家」是桌面端多平台发布工具，{cta}，可以说下你的情况我帮你看看。',
  ],
};

function siteHost(settings) {
  try {
    return new URL(settings.siteUrl || 'https://www.wemediacreator.com').hostname.replace(/^www\./, '');
  } catch (err) {
    return 'wemediacreator.com';
  }
}

export function ctaFor(settings) {
  const days = Number(settings.trialDays) || 31;
  const host = siteHost(settings);
  switch (settings.ctaMode) {
    case 'url':
      return `试用入口 ${settings.trialUrl}`;
    case 'domain':
      return `官网 ${host}`;
    case 'none':
      return '';
    case 'trial':
    default:
      return `官网 ${host} 可以领 ${days} 天试用`;
  }
}

function normalize(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text) {
  const clean = String(text || '').replace(/[^\p{L}\p{N}]/gu, '');
  const out = [];
  for (let i = 0; i < clean.length - 1; i += 1) out.push(clean.slice(i, i + 2));
  return out;
}

function diceSimilarity(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let overlap = 0;
  for (const gram of left) if (rightSet.has(gram)) overlap += 1;
  return (2 * overlap) / (left.length + right.length);
}

function renderFallback(template, settings) {
  return normalize((template || '').replace(/\{cta\}/g, ctaFor(settings)));
}

function buildSystemPrompt(config, cta) {
  const settings = config.settings || {};
  const product = settings.productName || '媒管家';
  const linkRule = settings.ctaMode === 'url'
    ? '9. 结尾可以带完整试用链接；不要留微信号、手机号；'
    : '9. 不要贴完整 http 链接，不要留微信号、手机号；';
  return [
    `你是「${product}」团队的运营，产品是桌面端自媒体多平台发布工具。`,
    '现在你要在一个视频评论区回复一个真实创作者。',
    '产品事实：支持抖音、快手、小红书、视频号、B站、微博、知乎、公众号 8 个平台；一次排期自动发布，发布后数据回流到本地 SQLite；桌面端运行，登录态和数据保存在用户本机。',
    '写作要求：',
    '1. 先回应评论里的具体问题或痛点，不要答非所问；',
    '2. 给一个具体、可执行的小建议；',
    '3. 自然说明你是媒管家团队（工具方），不要伪装普通路人；',
    '4. 介绍媒管家时只讲 1 个最相关的点，不要堆功能；',
    `5. 结尾直接带试用信息：${cta}；`,
    '6. 总共 2-3 句，口语化，像真人在评论区聊天，不要客服腔、不要营销腔；',
    '7. 不承诺“不会被封”“100% 安全”“永久免费”，不贬低其他工具，不提竞品名字；',
    '8. 不要堆 emoji，最多 1 个；',
    linkRule,
    '10. 只输出 JSON，格式：{"candidates":[{"text":"回复正文","angle":"共情|干货|推荐","score":0}],"best":0}。',
    '11. 如果评论提到其他工具或竞品，先认可对方的使用体验，不贬低、不点名竞品，再说明媒管家在一个具体点上的不同（如登录态本地保存、一次绑定、31 天试用）。',
  ].join('\n');
}

function buildUserPrompt({ video, comment, intent, cta }) {
  return [
    `平台：${comment.platform || ''}`,
    `视频标题：${video && video.title ? video.title : ''}`,
    `视频简介：${video && video.description ? String(video.description).slice(0, 300) : ''}`,
    `评论作者：${comment.author || '匿名用户'}`,
    `评论原文：${comment.text || ''}`,
    `同楼上下文：${comment.thread_text || '无'}`,
    `命中意图：${intent && intent.intentLabel ? intent.intentLabel : '潜在需求'}`,
    `试用信息（原样自然带进结尾）：${cta}`,
    '请生成 3 个不同角度的回复候选，score 综合评估相关性、自然度、非广告感和试用信息完整度。',
  ].join('\n');
}

function validateCandidate(text, { config, cta, recentDrafts }) {
  const prompt = config.prompt || {};
  const settings = config.settings || {};
  const min = Number(prompt.minChars) || 20;
  const max = Number(prompt.maxChars) || 180;
  if (text.length < min || text.length > max) return { ok: false, reason: '长度不合适' };
  if ((prompt.banned || []).some((word) => text.includes(word))) {
    return { ok: false, reason: '包含夸大承诺' };
  }
  if (settings.ctaMode !== 'url' && /https?:\/\//i.test(text)) {
    return { ok: false, reason: '包含完整链接' };
  }
  if (/(微信号|加微信|加微|vx|wechat)/i.test(text)) {
    return { ok: false, reason: '包含联系方式' };
  }
  if (cta) {
    const host = siteHost(settings);
    if (!text.includes('试用') && !text.includes(host)) {
      return { ok: false, reason: '缺少试用信息' };
    }
  }
  if (recentDrafts.some((draft) => diceSimilarity(text, draft) >= 0.82)) {
    return { ok: false, reason: '与近期文案重复' };
  }
  return { ok: true };
}

export async function generateReply({ video, comment, intent, config, recentDrafts = [] }) {
  const settings = config.settings || {};
  const cta = ctaFor(settings);
  let aiModel = '';
  try {
    aiModel = loadAiConfig().model;
  } catch (err) {
    /* 没有 key 时直接走模板 */
  }

  let candidates = [];
  let warning = '';
  let usedFallback = false;

  try {
    const payload = await generateJson({
      system: buildSystemPrompt(config, cta),
      user: buildUserPrompt({ video, comment, intent, cta }),
      maxTokens: 1200,
      temperature: 0.9,
    });
    const list = Array.isArray(payload.candidates)
      ? payload.candidates
      : (payload.text ? [{ text: payload.text, angle: '', score: 70 }] : []);
    for (const item of list) {
      const text = normalize(item && item.text);
      const check = validateCandidate(text, { config, cta, recentDrafts });
      if (!check.ok) {
        warning = `已过滤一版 AI 文案：${check.reason}`;
        continue;
      }
      candidates.push({
        text,
        angle: String((item && item.angle) || ''),
        score: Number(item && item.score) || 0,
      });
    }
  } catch (err) {
    warning = `AI 生成失败（${err.message}），使用模板`;
  }

  if (!candidates.length) {
    usedFallback = true;
    const pool = FALLBACKS[intent && intent.intent] || FALLBACKS.default;
    const text = renderFallback(pool[Math.floor(Math.random() * pool.length)], settings);
    candidates = [{ text, angle: '模板', score: 60 }];
    warning = warning || 'AI 候选未通过校验，使用模板';
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    text: candidates[0].text,
    candidates,
    source: usedFallback ? '模板' : 'DeepSeek',
    warning,
    model: usedFallback ? '' : (aiModel || 'deepseek-chat'),
  };
}

export function fallbackReply({ intent, config }) {
  const settings = config.settings || {};
  const pool = FALLBACKS[intent && intent.intent] || FALLBACKS.default;
  return renderFallback(pool[Math.floor(Math.random() * pool.length)], settings);
}

export { loadCommentsConfig };
