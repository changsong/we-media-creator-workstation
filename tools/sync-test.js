'use strict';

/**
 * 双向同步验证：订阅 SSE，再用 API 改一条记录，确认事件被推送到所有打开的页面。
 * 用法：node tools/sync-test.js [baseUrl]
 */

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:5180';

(async () => {
  const listRes = await fetch(`${BASE}/api/tables/topic/records?pageSize=1`);
  const { results } = await listRes.json();
  const record = results[0];
  if (!record) throw new Error('没有可用的选题记录，先启动服务生成示例数据');

  const controller = new AbortController();
  const stream = await fetch(`${BASE}/api/events`, { signal: controller.signal });
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const readUntilChange = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('event: change')) return buffer;
    }
    return buffer;
  };

  const wait = readUntilChange();

  await new Promise((r) => setTimeout(r, 200));
  const patch = await fetch(`${BASE}/api/tables/topic/records/${record._id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { 状态: { select: record['状态'] } } })
  });
  if (!patch.ok) throw new Error(`更新失败：${patch.status} ${await patch.text()}`);

  const received = await wait;
  controller.abort();

  const ok = /event: change/.test(received) && received.includes('"table":"topic"');
  console.log(ok ? 'PASS  写入事件已推送到订阅端' : 'FAIL  未收到同步事件');
  console.log(received.trim().split('\n').slice(0, 3).join(' | '));
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('同步测试失败：', err.message);
  process.exit(1);
});
