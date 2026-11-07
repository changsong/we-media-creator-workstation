import { applyPaidOrder, syncRefundLicense } from '../fulfill.mjs';
import { readRawBody, sendJson } from '../http.mjs';
import { getOrder, markRefunded } from '../orders.mjs';
import { decryptResource, verifyNotifySignature } from '../wechat/crypto.mjs';

async function readNotification(req, res, ctx) {
  const { config } = ctx;
  if (!config.wechatConfigured) {
    sendJson(res, 503, { code: 'FAIL', message: 'payment is not configured' });
    return null;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    sendJson(res, 413, { code: 'FAIL', message: 'body too large' });
    return null;
  }

  const verify = verifyNotifySignature({
    timestamp: req.headers['wechatpay-timestamp'],
    nonce: req.headers['wechatpay-nonce'],
    signature: req.headers['wechatpay-signature'],
    headerSerial: req.headers['wechatpay-serial'],
    body: raw.toString('utf8'),
    publicKey: config.wechat.platformPublicKey,
    publicKeyId: config.wechat.platformPublicKeyId,
  });
  if (!verify.ok) {
    ctx.logger.error(`checkout: notification rejected: ${verify.reason}`);
    sendJson(res, 401, { code: 'FAIL', message: verify.reason });
    return null;
  }

  let envelope;
  try {
    envelope = JSON.parse(raw.toString('utf8'));
  } catch {
    sendJson(res, 400, { code: 'FAIL', message: 'invalid json' });
    return null;
  }

  const resource = envelope.resource;
  if (!resource?.ciphertext || !resource?.nonce) {
    sendJson(res, 400, { code: 'FAIL', message: 'missing resource' });
    return null;
  }

  let data;
  try {
    data = JSON.parse(
      decryptResource({
        apiV3Key: config.wechat.apiV3Key,
        associatedData: resource.associated_data,
        nonce: resource.nonce,
        ciphertext: resource.ciphertext,
      }),
    );
  } catch (error) {
    ctx.logger.error(`checkout: notification decrypt failed: ${error.message}`);
    sendJson(res, 400, { code: 'FAIL', message: 'could not decrypt resource' });
    return null;
  }

  return { envelope, data };
}

function appMatches(data, config) {
  return data.appid === config.wechat.appid || data.appid === config.wechat.h5Appid;
}

async function handlePayment(req, res, ctx) {
  const notification = await readNotification(req, res, ctx);
  if (!notification) return;
  const { data } = notification;

  const order = getOrder(ctx.db, String(data.out_trade_no || ''));
  if (!order) {
    ctx.logger.error(`checkout: payment notification for unknown order ${data.out_trade_no}`);
    sendJson(res, 500, { code: 'FAIL', message: 'unknown order' });
    return;
  }

  if (data.trade_state !== 'SUCCESS' || !data.transaction_id) {
    ctx.logger.log(`checkout: order ${order.id} state ${data.trade_state}`);
    sendJson(res, 200, { code: 'SUCCESS', message: '成功' });
    return;
  }
  if (data.mchid !== ctx.config.wechat.mchid || !appMatches(data, ctx.config)) {
    ctx.logger.error(`checkout: merchant mismatch on order ${order.id}`);
    sendJson(res, 400, { code: 'FAIL', message: 'merchant mismatch' });
    return;
  }
  if (Number(data.amount?.total) !== Number(order.amount_fen) || data.amount?.currency !== 'CNY') {
    ctx.logger.error(`checkout: amount mismatch on order ${order.id}`);
    sendJson(res, 400, { code: 'FAIL', message: 'amount mismatch' });
    return;
  }

  await applyPaidOrder({
    db: ctx.db,
    order,
    config: ctx.config,
    keygate: ctx.keygate,
    transactionId: data.transaction_id,
    payload: { trade_state: data.trade_state, amount: data.amount },
    logger: ctx.logger,
  });

  sendJson(res, 200, { code: 'SUCCESS', message: '成功' });
}

async function handleRefund(req, res, ctx) {
  const notification = await readNotification(req, res, ctx);
  if (!notification) return;
  const { envelope, data } = notification;

  const order = getOrder(ctx.db, String(data.out_trade_no || ''));
  if (!order) {
    ctx.logger.error(`checkout: refund notification for unknown order ${data.out_trade_no}`);
    sendJson(res, 500, { code: 'FAIL', message: 'unknown order' });
    return;
  }

  if (data.mchid !== ctx.config.wechat.mchid || !appMatches(data, ctx.config)) {
    ctx.logger.error(`checkout: refund merchant mismatch on order ${order.id}`);
    sendJson(res, 400, { code: 'FAIL', message: 'merchant mismatch' });
    return;
  }

  if (data.refund_status === 'SUCCESS') {
    const refunded = Number(data.amount?.refund);
    if (Number.isFinite(refunded) && refunded < order.amount_fen) {
      ctx.logger.error(`checkout: partial refund on order ${order.id}; license left unchanged`);
    } else {
      markRefunded(ctx.db, order.id, data.out_refund_no || order.refund_no);
      const refreshed = getOrder(ctx.db, order.id);
      await syncRefundLicense({ db: ctx.db, order: refreshed, keygate: ctx.keygate, logger: ctx.logger });
    }
  } else {
    ctx.logger.error(
      `checkout: refund for order ${order.id} reported ${data.refund_status || envelope.event_type}`,
    );
  }

  sendJson(res, 200, { code: 'SUCCESS', message: '成功' });
}

export async function handleWeChat(req, res, url, ctx) {
  const path = url.pathname;
  if (path !== '/api/wechat/notify' && path !== '/api/wechat/refund-notify') return false;

  if (req.method !== 'POST') {
    sendJson(res, 405, { code: 'FAIL', message: 'method not allowed' });
    return true;
  }

  if (path === '/api/wechat/notify') await handlePayment(req, res, ctx);
  else await handleRefund(req, res, ctx);
  return true;
}
