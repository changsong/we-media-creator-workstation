import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../scripts/jiayouzhan/rss.mjs';
import { buildMockArticle } from '../scripts/jiayouzhan/prompt.mjs';
import { buildArticle, findBannedWords, slugifyAscii } from '../scripts/jiayouzhan/validate.mjs';
import { pickCandidates } from '../scripts/jiayouzhan/store.mjs';
import { jiayouzhanRoutes } from '../src/lib/jiayouzhan.mjs';

const TODAY = '2026-11-17';

const candidate = {
  title: '手机口播不翻车：窗边布光与收音的 5 个细节',
  summary: '很多创作者卡在画面能看但不像专业账号，问题往往在光线方向和收音距离。',
  source: '少数派',
  url: 'https://sspai.com/post/1',
  tag: '拍摄',
  date: '2026-11-16',
};

test('parseFeed 解析 RSS 与 CDATA', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[剪辑节奏 & 气口]]></title>
      <link>https://example.com/a</link>
      <pubDate>Mon, 16 Nov 2026 08:00:00 +0800</pubDate>
      <description><![CDATA[<p>第一段&nbsp;内容</p><script>x()</script>]]></description>
    </item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '剪辑节奏 & 气口');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].summary.includes('<'), false);
  assert.equal(items[0].summary.includes('x()'), false);
  assert.equal(items[0].date, '2026-11-16');
});

test('parseFeed 解析 Atom 的 alternate 链接', () => {
  const xml = `<feed><entry>
    <title>收音距离</title>
    <link rel="self" href="https://example.com/self"/>
    <link rel="alternate" href="https://example.com/post"/>
    <updated>2026-11-15T10:00:00Z</updated>
    <summary type="html">摘要</summary>
  </entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.url, 'https://example.com/post');
  assert.equal(item.date, '2026-11-15');
});

test('pickCandidates 按关键词与时效筛选并去重', () => {
  const config = { skillKeywords: ['剪辑', '布光'], maxAgeDays: 10, maxPerDay: 2 };
  const items = [
    { title: '剪辑节奏的三个判断', summary: '布光与剪辑', url: 'https://a/1', date: '2026-11-16', source: 'A' },
    { title: '剪辑节奏的三个判断', summary: '', url: 'https://a/1', date: '2026-11-16', source: 'A' },
    { title: '旧闻：剪辑', summary: '', url: 'https://a/2', date: '2026-10-01', source: 'A' },
    { title: '与行业无关', summary: '天气', url: 'https://a/3', date: '2026-11-16', source: 'A' },
  ];
  const picked = pickCandidates(items, { config, today: TODAY });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].url, 'https://a/1');
  assert.equal(picked[0].tag, '剪辑');
});

test('pickCandidates 跳过已使用的来源与标题', () => {
  const config = { skillKeywords: ['剪辑'], maxAgeDays: 10, maxPerDay: 2 };
  const items = [
    { title: '剪辑节奏', summary: '', url: 'https://a/1', date: '2026-11-16', source: 'A' },
    { title: '剪辑节奏', summary: '', url: 'https://a/2', date: '2026-11-16', source: 'A' },
  ];
  const picked = pickCandidates(items, { config, today: TODAY, state: { usedUrls: ['https://a/1'] } });
  assert.equal(picked.length, 0);
});

test('pickCandidates 过滤商业新闻并要求创作相关性', () => {
  const config = {
    skillKeywords: ['剪辑'],
    platformKeywords: ['抖音', 'B站'],
    practicalKeywords: ['如何'],
    excludeKeywords: ['品牌'],
    maxAgeDays: 10,
    maxPerDay: 2,
  };
  const items = [
    { title: 'B站迎来泼天流量，其直播业务可以冲吗？', summary: '', url: 'https://a/1', date: '2026-11-17', source: 'A' },
    { title: '品牌如何在大促中收获生意爆发？', summary: '', url: 'https://a/2', date: '2026-11-17', source: 'A' },
    { title: '抖音账号如何做剪辑？', summary: '', url: 'https://a/3', date: '2026-11-17', source: 'A' },
  ];
  const picked = pickCandidates(items, { config, today: TODAY });
  assert.equal(picked.length, 1);
  assert.equal(picked[0].url, 'https://a/3');
  assert.equal(picked[0].tag, '剪辑');
});

test('slugifyAscii 生成合法英文 slug', () => {
  assert.equal(slugifyAscii('Video Editing Rhythm!'), 'video-editing-rhythm');
  assert.equal(slugifyAscii('剪辑'), '');
});

test('buildArticle 通过校验并生成日期前缀 slug', () => {
  const result = buildArticle(buildMockArticle(candidate, { today: TODAY }), candidate, { today: TODAY });
  assert.equal(result.ok, true, result.errors.join('；'));
  assert.equal(result.article.slug, `2026-11-17-creator-practice-checklist`);
  assert.equal(result.article.sourceUrl, candidate.url);
  assert.equal(result.article.status, 'published');
});

test('buildArticle 拒绝重复 slug 与高重合内容', () => {
  const raw = buildMockArticle(candidate, { today: TODAY });
  const duplicate = buildArticle(raw, candidate, { today: TODAY, existingSlugs: new Set([`${TODAY}-creator-practice-checklist`]) });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((error) => error.includes('已存在')));

  const copied = buildArticle(
    { ...raw, intro: candidate.summary, sections: [{ h2: '照搬', ps: [candidate.summary] }] },
    candidate,
    { today: TODAY },
  );
  assert.equal(copied.ok, false);
  assert.ok(copied.errors.some((error) => error.includes('重合率')));
});

test('findBannedWords 命中夸大用词', () => {
  const words = findBannedWords({ title: '保证涨粉的方法', description: '', intro: '', takeaways: [] }, ['保证涨粉', '最好']);
  assert.deepEqual(words, ['保证涨粉']);
});

test('加油站路由为 zh-only 且分页 noindex', () => {
  const article = { ...buildArticle(buildMockArticle(candidate, { today: TODAY }), candidate, { today: TODAY }).article };
  const routes = jiayouzhanRoutes([article]);
  assert.equal(routes.length, 2);

  const [index, detail] = routes;
  assert.equal(index.route, '/jiayouzhan/');
  assert.equal(index.lang, 'zh');
  assert.match(index.html, /hreflang="zh-CN"/);
  assert.match(index.html, /hreflang="x-default"/);
  assert.doesNotMatch(index.html, /hreflang="en"/);

  assert.equal(detail.route, `/jiayouzhan/${article.slug}/`);
  assert.match(detail.html, /参考来源/);
  assert.match(detail.html, /BlogPosting/);

  const many = Array.from({ length: 21 }, (_, i) => ({ ...article, slug: `${TODAY}-item-${i}` }));
  const paginated = jiayouzhanRoutes(many);
  const page2 = paginated.find((page) => page.route === '/jiayouzhan/page/2/');
  assert.ok(page2);
  assert.equal(page2.noindex, true);
  assert.doesNotMatch(page2.html, /hreflang=/);
});
