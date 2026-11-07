import { markClosed, touchQueried } from './orders.mjs';
import {
  listFulfillRetries,
  listPendingForQuery,
  listRefundSyncRetries,
  listRefundsForQuery,
  listStalePending,
  markRefunded,
} from './orders.mjs';
import { syncRefundLicense, applyPaidOrder, fulfillOrder } from './fulfill.mjs';

const DEAD_STATES = new Set(['CLOSED', 'REVOKED', 'PAYERROR', 'REFUND']);

export function verifyPaidTransaction(result, order, config) {
  if (result.trade_state !== 'SUCCESS') return { ok: false, reason: `trade_state=${result.trade_state}` };
  if (result.out_trade_no && result.out_trade_no !== order.id) return { ok: false, reason: 'out_trade_no mismatch' };
  if (result.mchid && result.mchid !== config.wechat.mchid) return { ok: false, reason: 'mchid mismatch' };
  if (result.appid && result.appid !== config.wechat.appid && result.appid !== config.wechat.h5Appid) {
    return { ok: false, reason: 'appid mismatch' };
  }
  const total = result.amount?.total;
  if (Number(total) !== Number(order.amount_fen)) return { ok: false, reason: 'amount mismatch' };
  if (result.amount?.currency && result.amount.currency !== 'CNY') return { ok: false, reason: 'currency mismatch' };
  if (!result.transaction_id) return { ok: false, reason: 'missing transaction_id' };
  return { ok: true };
}

export function createReconciler({ db, config, wechat, keygate, logger = console, intervalMs = 60_000 }) {
  let timer = null;

  async function queryOrder(order, { closeWhenDead = false } = {}) {
    touchQueried(db, order.id);
    let result;
    try {
      result = await wechat.queryByOutTradeNo(order.id);
    } catch (error) {
      logger.error(`checkout: query failed for ${order.id}: ${error.code || error.message}`);
      return null;
    }

    if (result.trade_state === 'SUCCESS') {
      const check = verifyPaidTransaction(result, order, config);
      if (!check.ok) {
        logger.error(`checkout: query success rejected for ${order.id}: ${check.reason}`);
        return result.trade_state;
      }
      await applyPaidOrder({
        db,
        order,
        config,
        keygate,
        transactionId: result.transaction_id,
        payload: result,
        logger,
      });
      return result.trade_state;
    }

    if (closeWhenDead && DEAD_STATES.has(result.trade_state)) {
      markClosed(db, order.id);
    }
    return result.trade_state;
  }

  async function tick() {
    for (const order of listPendingForQuery(db)) {
      await queryOrder(order);
    }

    for (const order of listStalePending(db)) {
      const state = await queryOrder(order, { closeWhenDead: true });
      if (state === 'NOTPAY') {
        try {
          await wechat.close(order.id);
        } catch (error) {
          logger.error(`checkout: close failed for ${order.id}: ${error.code || error.message}`);
        }
        markClosed(db, order.id);
      }
    }

    for (const order of listFulfillRetries(db)) {
      await fulfillOrder({ db, order, config, keygate, logger });
    }

    for (const order of listRefundsForQuery(db)) {
      if (!order.refund_no) continue;
      try {
        const result = await wechat.queryRefund(order.refund_no);
        if (result.status === 'SUCCESS') {
          markRefunded(db, order.id, order.refund_no);
          await syncRefundLicense({ db, order: { ...order, status: 'refunded' }, keygate, logger });
        } else if (result.status === 'CLOSED' || result.status === 'ABNORMAL') {
          logger.error(`checkout: refund ${order.refund_no} for ${order.id} is ${result.status}`);
        }
      } catch (error) {
        logger.error(`checkout: refund query failed for ${order.id}: ${error.code || error.message}`);
      }
    }

    for (const order of listRefundSyncRetries(db)) {
      await syncRefundLicense({ db, order, keygate, logger });
    }
  }

  function start() {
    tick().catch((error) => logger.error(`checkout: reconcile tick failed: ${error.message}`));
    timer = setInterval(() => {
      tick().catch((error) => logger.error(`checkout: reconcile tick failed: ${error.message}`));
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick, queryOrder };
}
