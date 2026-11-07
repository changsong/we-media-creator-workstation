import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createCheckout } from '../server/index.mjs';

const quietLogger = { log() {}, error() {} };

async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmc-http-test-'));
  const checkout = createCheckout({
    env: {
      WECHAT_MOCK: '1',
      KEYGATE_MOCK: '1',
      CHECKOUT_DB: path.join(dir, 'checkout.db'),
      CHECKOUT_RATE_LIMIT: '100',
    },
    logger: quietLogger,
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (await checkout.handle(req, res, url)) return;
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    async close() {
      checkout.close();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function post(base, urlPath, body, headers = {}) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

test('checkout HTTP flow: create order, mock pay, poll status', async () => {
  const server = await startServer();
  try {
    const health = await fetch(`${server.base}/api/checkout/health`).then((res) => res.json());
    assert.equal(health.wechat_configured, true);
    assert.deepEqual(Object.keys(health).sort(), ['keygate_configured', 'mock', 'ok', 'wechat_configured']);

    const created = await post(server.base, '/api/checkout/orders', { plan: 'yearly', email: 'buyer@example.com' });
    assert.equal(created.status, 201);
    assert.equal(created.body.channel, 'native');
    assert.equal(created.body.amount_fen, 50000);
    assert.match(created.body.code_url, /^mock:\/\//);
    assert.match(created.body.return_url, /^\/checkout\/return\/\?order=/);

    const { order_id: orderId, token } = created.body;

    const pending = await fetch(`${server.base}/api/checkout/orders/${orderId}?token=${encodeURIComponent(token)}`).then((res) => res.json());
    assert.equal(pending.order.status, 'pending');
    assert.equal(pending.order.email_masked, 'bu***@example.com');

    const paid = await post(server.base, '/api/checkout/admin/mock-pay', { order_id: orderId, token });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.order.status, 'fulfilled');
    assert.ok(paid.body.order.valid_until);

    const rejected = await fetch(`${server.base}/api/checkout/orders/${orderId}?token=nope`);
    assert.equal(rejected.status, 404);
  } finally {
    await server.close();
  }
});

test('checkout rejects invalid input and guides WeChat browser users', async () => {
  const server = await startServer();
  try {
    assert.equal((await post(server.base, '/api/checkout/orders', { plan: 'gold', email: 'buyer@example.com' })).status, 400);
    assert.equal((await post(server.base, '/api/checkout/orders', { plan: 'monthly', email: 'not-an-email' })).status, 400);

    const inWeChat = await post(
      server.base,
      '/api/checkout/orders',
      { plan: 'monthly', email: 'buyer@example.com' },
      { 'User-Agent': 'Mozilla/5.0 MicroMessenger/8.0.40' },
    );
    assert.equal(inWeChat.status, 200);
    assert.equal(inWeChat.body.wechat_browser, true);

    const refund = await post(server.base, '/api/checkout/admin/refund', { order_id: 'ord_x' });
    assert.equal(refund.status, 401);
  } finally {
    await server.close();
  }
});
