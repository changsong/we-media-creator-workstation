import crypto from 'node:crypto';
import { normalizeEmail, validEmail } from '../config.mjs';
import { applyPaidOrder } from '../fulfill.mjs';
import {
  absoluteOrRelativeJoin,
  clientIp,
  inWeChat,
  isMobile,
  readJsonBody,
  sendJson,
} from '../http.mjs';
import {
  createOrder,
  findOrderForToken,
  getOrder,
  markClosed,
  markRefundPending,
  publicOrder,
  setPrepay,
} from '../orders.mjs';

function refundNoFor(orderId) {
  return `rf_${orderId.slice(4)}_${Date.now().toString(36)}`;
}

function returnUrlFor(config, orderId, token) {
  return absoluteOrRelativeJoin(config.wechat.h5RedirectBase, orderId, token);
}

function adminAuthorized(req, config) {
  if (!config.adminToken) return false;
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(config.adminToken, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function createCheckoutOrder(req, res, ctx) {
  const { config, db, wechat, limiter } = ctx;
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid-json' });
  }

  const plan = config.plans[String(body.plan || '')];
  if (!plan) return sendJson(res, 400, { ok: false, error: 'invalid-plan' });
  if (!validEmail(body.email)) return sendJson(res, 400, { ok: false, error: 'invalid-email' });

  if (!config.wechatConfigured || !config.keygateConfigured) {
    return sendJson(res, 503, { ok: false, error: 'payment-unavailable' });
  }

  const ip = clientIp(req);
  const emailNorm = normalizeEmail(body.email);
  if (!limiter.hit(`ip:${ip}`) || !limiter.hit(`email:${emailNorm}`)) {
    return sendJson(res, 429, { ok: false, error: 'rate-limited' });
  }

  const ua = req.headers['user-agent'] || '';
  if (inWeChat(ua)) {
    return sendJson(res, 200, {
      ok: true,
      wechat_browser: true,
      message: '微信内暂不支持直接支付，请点击右上角选择「在浏览器打开」后再支付。',
    });
  }

  const channel =
    isMobile(ua) && config.wechat.h5Appid && config.wechat.h5RedirectBase ? 'h5' : 'native';

  const { order, token } = createOrder(db, {
    plan: plan.id,
    email: String(body.email).trim(),
    emailNorm,
    amountFen: plan.amountFen,
    channel,
  });

  const description = `媒管家-${plan.labelZh}`;
  const returnUrl = returnUrlFor(config, order.id, token);

  let prepay;
  try {
    prepay =
      channel === 'h5'
        ? await wechat.h5({
            outTradeNo: order.id,
            description,
            amountFen: order.amount_fen,
            notifyUrl: config.wechat.notifyUrl,
            payerClientIp: ip,
            redirectUrl: returnUrl,
          })
        : await wechat.native({
            outTradeNo: order.id,
            description,
            amountFen: order.amount_fen,
            notifyUrl: config.wechat.notifyUrl,
          });
  } catch (error) {
    markClosed(db, order.id);
    ctx.logger.error(`checkout: order ${order.id} prepay failed: ${error.code || error.message}`);
    return sendJson(res, 502, {
      ok: false,
      error: 'wechat-error',
      code: error.code || 'WECHAT_ERROR',
      message: error.message || '微信支付下单失败，请稍后重试。',
    });
  }

  setPrepay(db, order.id, prepay);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  return sendJson(res, 201, {
    ok: true,
    order_id: order.id,
    token,
    channel,
    plan: plan.id,
    plan_label: plan.labelZh,
    amount_fen: order.amount_fen,
    expires_at: expiresAt,
    return_url: returnUrl,
    ...(channel === 'native' ? { code_url: prepay.code_url || '' } : { h5_url: prepay.h5_url || '' }),
  });
}

async function orderStatus(req, res, url, ctx) {
  const { config, db, reconciler, statusLimiter } = ctx;
  const match = url.pathname.match(/^\/api\/checkout\/orders\/([A-Za-z0-9_]+)$/);
  if (!match) {
    sendJson(res, 404, { ok: false, error: 'not-found' });
    return;
  }

  const ip = clientIp(req);
  if (statusLimiter && !statusLimiter.hit(`status:${ip}`)) {
    return sendJson(res, 429, { ok: false, error: 'rate-limited' });
  }

  let order = findOrderForToken(db, match[1], url.searchParams.get('token'));
  if (!order) return sendJson(res, 404, { ok: false, error: 'not-found' });

  if (order.status === 'pending') {
    const last = order.last_queried_at ? new Date(order.last_queried_at).getTime() : 0;
    if (Date.now() - last > 10_000) {
      try {
        await reconciler.queryOrder(order);
      } catch (error) {
        ctx.logger.error(`checkout: status query failed for ${order.id}: ${error.message}`);
      }
      order = getOrder(db, order.id) || order;
    }
  }

  return sendJson(res, 200, { ok: true, order: publicOrder(order) });
}

async function adminRefund(req, res, ctx) {
  const { config, db, wechat } = ctx;
  if (!adminAuthorized(req, config)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid-json' });
  }

  const order = getOrder(db, String(body.order_id || ''));
  if (!order) return sendJson(res, 404, { ok: false, error: 'not-found' });
  if (order.status === 'refunded' || order.status === 'refund_pending') {
    return sendJson(res, 200, { ok: true, order: publicOrder(order) });
  }
  if (!['paid', 'fulfilling', 'fulfilled', 'fulfill_failed'].includes(order.status)) {
    return sendJson(res, 409, { ok: false, error: 'not-refundable' });
  }

  const refundNo = order.refund_no || refundNoFor(order.id);
  try {
    await wechat.refund({
      outTradeNo: order.id,
      outRefundNo: refundNo,
      totalFen: order.amount_fen,
      refundFen: order.amount_fen,
      reason: String(body.reason || '').slice(0, 80),
      notifyUrl: config.wechat.refundNotifyUrl || config.wechat.notifyUrl,
    });
  } catch (error) {
    ctx.logger.error(`checkout: refund failed for ${order.id}: ${error.code || error.message}`);
    return sendJson(res, 502, {
      ok: false,
      error: 'wechat-error',
      code: error.code || 'WECHAT_ERROR',
      message: error.message || '退款请求失败。',
    });
  }

  markRefundPending(db, order.id, refundNo);
  return sendJson(res, 200, { ok: true, refund_no: refundNo, order: publicOrder(getOrder(db, order.id)) });
}

async function mockPay(req, res, url, ctx) {
  const { config, db, keygate } = ctx;
  if (!config.wechat.mock) return false;
  if (!config.keygate.mock && !adminAuthorized(req, config)) {
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }
  const orderId = url.searchParams.get('order') || body.order_id;
  const token = url.searchParams.get('token') || body.token;
  const order = findOrderForToken(db, orderId, token);
  if (!order) return sendJson(res, 404, { ok: false, error: 'not-found' });

  if (order.status === 'pending') {
    await applyPaidOrder({
      db,
      order,
      config,
      keygate,
      transactionId: `mock_${order.id}`,
      payload: { mock: true },
      logger: ctx.logger,
    });
  }
  sendJson(res, 200, { ok: true, order: publicOrder(getOrder(db, order.id)) });
  return true;
}

export async function handleCheckout(req, res, url, ctx) {
  const { pathname } = url;

  if (pathname === '/api/checkout/health') {
    sendJson(res, 200, {
      ok: true,
      wechat_configured: ctx.config.wechatConfigured,
      keygate_configured: ctx.config.keygateConfigured,
      mock: ctx.config.wechat.mock,
    });
    return true;
  }

  if (pathname === '/api/checkout/orders') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return true;
    }
    await createCheckoutOrder(req, res, ctx);
    return true;
  }

  if (pathname.startsWith('/api/checkout/orders/')) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return true;
    }
    await orderStatus(req, res, url, ctx);
    return true;
  }

  if (pathname === '/api/checkout/admin/refund') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return true;
    }
    await adminRefund(req, res, ctx);
    return true;
  }

  if (pathname === '/api/checkout/admin/mock-pay') {
    if (req.method !== 'POST') return false;
    return (await mockPay(req, res, url, ctx)) !== false;
  }

  return false;
}
