import crypto from 'node:crypto';
import { immediate } from './db.mjs';
import { maskEmail } from './config.mjs';

const ACTIVE_AFTER_PAYMENT = ['paid', 'fulfilling', 'fulfilled', 'fulfill_failed', 'refund_pending', 'refunded'];

function nowIso() {
  return new Date().toISOString();
}

export function newOrderId() {
  return `ord_${crypto.randomBytes(12).toString('hex')}`;
}

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function getOrder(db, id) {
  return db.prepare('SELECT * FROM checkout_orders WHERE id = ?').get(String(id || '')) || null;
}

export function findOrderForToken(db, id, token) {
  const order = getOrder(db, id);
  if (!order) return null;
  const expected = Buffer.from(order.token_hash, 'hex');
  const actual = Buffer.from(hashToken(token), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return order;
}

export function createOrder(db, { plan, email, emailNorm, amountFen, channel }) {
  const id = newOrderId();
  const token = newToken();
  const at = nowIso();
  db.prepare(
    `INSERT INTO checkout_orders
      (id, token_hash, plan, email, email_norm, amount_fen, currency, channel, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'CNY', ?, 'pending', ?, ?)`,
  ).run(id, hashToken(token), plan, email, emailNorm, amountFen, channel, at, at);
  return { order: getOrder(db, id), token };
}

export function setPrepay(db, id, payload) {
  db.prepare('UPDATE checkout_orders SET prepay_payload = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(payload),
    nowIso(),
    id,
  );
}

export function recordEvent(db, orderId, type, externalId, payload) {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO checkout_events (order_id, type, external_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(orderId, type, String(externalId), payload == null ? null : JSON.stringify(payload), nowIso());
  return result.changes > 0;
}

export function markPaid(db, { orderId, transactionId, payload }) {
  return immediate(db, () => {
    const order = getOrder(db, orderId);
    if (!order) return { status: 'missing', order: null };
    if (ACTIVE_AFTER_PAYMENT.includes(order.status)) {
      recordEvent(db, orderId, 'payment', transactionId, payload);
      return { status: 'already', order };
    }
    if (order.status !== 'pending') return { status: 'conflict', order };

    recordEvent(db, orderId, 'payment', transactionId, payload);
    const at = nowIso();
    const result = db
      .prepare(
        `UPDATE checkout_orders
            SET status = 'paid', transaction_id = ?, paid_at = COALESCE(paid_at, ?), updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(transactionId, at, at, orderId);
    const fresh = getOrder(db, orderId);
    if (!result.changes) return { status: fresh?.status === 'pending' ? 'conflict' : 'already', order: fresh };
    return { status: 'paid', order: fresh };
  });
}

export function markFulfilling(db, orderId) {
  const at = nowIso();
  const result = db
    .prepare(
      `UPDATE checkout_orders SET status = 'fulfilling', updated_at = ?
        WHERE id = ? AND status IN ('paid', 'fulfill_failed')`,
    )
    .run(at, orderId);
  return result.changes > 0;
}

export function markFulfilled(db, orderId, { licenseId, validUntil = null, priorValidUntil = null }) {
  const at = nowIso();
  const result = db
    .prepare(
      `UPDATE checkout_orders
          SET status = 'fulfilled', keygate_license_id = ?, keygate_valid_until = ?,
              keygate_prior_valid_until = ?, fulfilled_at = ?, updated_at = ?,
              attempts = 0, last_error = NULL
        WHERE id = ? AND status = 'fulfilling'`,
    )
    .run(licenseId, validUntil, priorValidUntil, at, at, orderId);
  return result.changes > 0;
}

export function markFulfillFailed(db, orderId, message) {
  const at = nowIso();
  db.prepare(
    `UPDATE checkout_orders
        SET status = 'fulfill_failed', attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'fulfilling'`,
  ).run(String(message || 'fulfillment failed').slice(0, 500), at, orderId);
}

export function markRefundPending(db, orderId, refundNo) {
  const at = nowIso();
  const result = db
    .prepare(
      `UPDATE checkout_orders
          SET status = 'refund_pending', refund_no = ?, updated_at = ?
        WHERE id = ? AND status IN ('paid', 'fulfilling', 'fulfilled', 'fulfill_failed')`,
    )
    .run(refundNo, at, orderId);
  return result.changes > 0 || (getOrder(db, orderId)?.status === 'refund_pending' && getOrder(db, orderId)?.refund_no === refundNo);
}

export function markRefunded(db, orderId, refundNo) {
  const at = nowIso();
  const result = db
    .prepare(
      `UPDATE checkout_orders
          SET status = 'refunded', refund_no = COALESCE(?, refund_no), refunded_at = COALESCE(refunded_at, ?), updated_at = ?
        WHERE id = ? AND status IN ('paid', 'fulfilling', 'fulfilled', 'fulfill_failed', 'refund_pending')`,
    )
    .run(refundNo || null, at, at, orderId);
  return result.changes > 0;
}

export function markClosed(db, orderId) {
  const at = nowIso();
  return (
    db
      .prepare(`UPDATE checkout_orders SET status = 'closed', updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(at, orderId).changes > 0
  );
}

export function touchQueried(db, orderId) {
  db.prepare('UPDATE checkout_orders SET last_queried_at = ? WHERE id = ?').run(nowIso(), orderId);
}

export function publicOrder(order) {
  const status = order.status === 'fulfilling' ? 'paid' : order.status;
  return {
    order_id: order.id,
    plan: order.plan,
    status,
    amount_fen: order.amount_fen,
    currency: order.currency,
    email_masked: maskEmail(order.email),
    paid_at: order.paid_at,
    fulfilled_at: order.fulfilled_at,
    valid_until: order.keygate_valid_until,
    refunded_at: order.refunded_at,
  };
}

function isoBefore(seconds, now = Date.now()) {
  return new Date(now - seconds * 1000).toISOString();
}

export function listPendingForQuery(db, { now = Date.now() } = {}) {
  return db
    .prepare(
      `SELECT * FROM checkout_orders
        WHERE status = 'pending'
          AND created_at > ?
          AND (last_queried_at IS NULL OR last_queried_at < ?)
        ORDER BY created_at ASC LIMIT 50`,
    )
    .all(isoBefore(2 * 60 * 60, now), isoBefore(30, now));
}

export function listStalePending(db, { now = Date.now() } = {}) {
  return db
    .prepare(
      `SELECT * FROM checkout_orders
        WHERE status = 'pending' AND created_at <= ?
        ORDER BY created_at ASC LIMIT 50`,
    )
    .all(isoBefore(2 * 60 * 60, now));
}

export function listFulfillRetries(db, { now = Date.now(), limit = 20 } = {}) {
  const rows = db
    .prepare(
      `SELECT * FROM checkout_orders
        WHERE status = 'fulfill_failed' AND attempts < 10
        ORDER BY updated_at ASC LIMIT ?`,
    )
    .all(limit);
  return rows.filter((row) => {
    const backoffSeconds = Math.min(3600, 60 * 2 ** Math.max(0, row.attempts));
    return new Date(row.updated_at).getTime() <= now - backoffSeconds * 1000;
  });
}

export function listRefundsForQuery(db, { now = Date.now() } = {}) {
  return db
    .prepare(
      `SELECT * FROM checkout_orders
        WHERE status = 'refund_pending' AND updated_at < ?
        ORDER BY updated_at ASC LIMIT 20`,
    )
    .all(isoBefore(60, now));
}

export function listRefundSyncRetries(db, { now = Date.now() } = {}) {
  return db
    .prepare(
      `SELECT o.* FROM checkout_orders o
        WHERE o.status = 'refunded'
          AND o.keygate_license_id IS NOT NULL
          AND o.refunded_at > ?
          AND NOT EXISTS (
            SELECT 1 FROM checkout_events e
             WHERE e.order_id = o.id AND e.type = 'refund-sync'
          )
        ORDER BY o.refunded_at ASC LIMIT 20`,
    )
    .all(isoBefore(7 * 24 * 60 * 60, now));
}

export function paymentEventCount(db, orderId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM checkout_events WHERE order_id = ? AND type = 'payment'`).get(orderId).n;
}

export { nowIso };
