const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const DEFAULT_UA = 'Mozilla/5.0 (compatible; WeMediaJiayouzhan/1.0)';

export function decodeEntities(text = '') {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z#0-9]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

function cleanText(raw = '') {
  return decodeEntities(
    String(raw)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? cleanText(match[1]) : '';
}

function atomLink(block) {
  const alternate = block.match(/<link\b[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*\/?>/i);
  if (alternate) return decodeEntities(alternate[1]).trim();
  const any = block.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/i);
  return any ? decodeEntities(any[1]).trim() : '';
}

function parseDate(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export function parseFeed(xml) {
  const blocks = [
    ...[...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]),
    ...[...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]),
  ];
  const items = [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    if (!title) continue;
    const link = tagText(block, 'link') || atomLink(block);
    if (!/^https?:\/\//i.test(link)) continue;
    const dateRaw = tagText(block, 'pubDate') || tagText(block, 'published')
      || tagText(block, 'updated') || tagText(block, 'dc:date');
    const summary = tagText(block, 'description') || tagText(block, 'summary')
      || tagText(block, 'content:encoded') || tagText(block, 'content');
    items.push({
      title,
      url: link,
      date: parseDate(dateRaw)?.toISOString().slice(0, 10) || '',
      summary: summary.slice(0, 600),
    });
  }
  return items;
}

export async function fetchFeed(feed, { timeout = 15000, userAgent = DEFAULT_UA } = {}) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'user-agent': userAgent, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(timeout),
      redirect: 'follow',
    });
    if (!res.ok) return { feed, items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const items = parseFeed(xml).map((item) => ({ ...item, source: feed.name }));
    return { feed, items, error: items.length ? '' : '未解析出条目' };
  } catch (error) {
    return { feed, items: [], error: error.name === 'TimeoutError' ? '请求超时' : error.message };
  }
}

export async function fetchAllFeeds(feeds, options) {
  const results = await Promise.all(feeds.map((feed) => fetchFeed(feed, options)));
  return {
    items: results.flatMap((result) => result.items),
    results: results.map(({ feed, items, error }) => ({ name: feed.name, url: feed.url, count: items.length, error })),
  };
}
