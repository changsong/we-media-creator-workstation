const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const COOKIE = 'buvid3=0f1a2b3c-1234-5678-9abc-def012345678infoc';

function stripHtml(text = '') {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function shanghaiDate(unix) {
  if (!unix) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unix * 1000));
}

async function searchOnce(query, { timeout, perQuery }) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&order=pubdate&page=1&keyword=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', accept: 'application/json', cookie: COOKIE },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.code !== 0) throw new Error(data?.message || `接口返回 ${data?.code}`);
  const list = Array.isArray(data?.data?.result) ? data.data.result : [];
  return list
    .filter((video) => video.bvid && video.title)
    .slice(0, perQuery)
    .map((video) => ({
      title: stripHtml(video.title),
      url: `https://www.bilibili.com/video/${video.bvid}`,
      date: shanghaiDate(video.pubdate),
      summary: stripHtml(video.description || '').slice(0, 600),
      source: 'B站',
    }));
}

export async function fetchBilibiliTopics(queries = [], { timeout = 15000, perQuery = 15 } = {}) {
  const items = [];
  const results = [];
  for (const query of queries) {
    try {
      const found = await searchOnce(query, { timeout, perQuery });
      items.push(...found);
      results.push({ query, count: found.length, error: found.length ? '' : '没有结果' });
    } catch (error) {
      results.push({ query, count: 0, error: error.name === 'TimeoutError' ? '请求超时' : error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { items, results };
}
