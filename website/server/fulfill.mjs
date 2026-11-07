import { workspaceId } from './config.mjs';
import {
  getOrder,
  markFulfilled,
  markFulfillFailed,
  markFulfilling,
  markPaid,
  recordEvent,
} from './orders.mjs';

export function rfc3339(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function addMonths(date, months) {
  const base = new Date(date);
  const day = base.getUTCDate();
  const first = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1, base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()),
  );
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first;
}

function parseValidUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endTime(license) {
  const date = parseValidUntil(license.valid_until);
  return date ? date.getTime() : Number.POSITIVE_INFINITY;
}

export function pickExisting(licenses, planId) {
  const usable = licenses.filter(
    (license) => license.plan_id === planId && (license.status === 'active' || license.status === 'trialing'),
  );
  if (!usable.length) return null;
  usable.sort((a, b) => endTime(b) - endTime(a));
  return usable[0];
}

export async function fulfillOrder({ db, order, config, keygate, logger = console }) {
  if (!order) return null;
  if (!markFulfilling(db, order.id)) return getOrder(db, order.id);

  try {
    const plan = config.plans[order.plan];
    if (!plan) throw new Error(`unknown plan: ${order.plan}`);
    const planId = plan.keygatePlanId || plan.id;
    const workspace = workspaceId(order.email_norm, config.keygate.workspacePrefix);
    const licenses = await keygate.listByWorkspace(workspace);
    const existing = pickExisting(licenses, planId);
    const now = new Date();

    let licenseId = '';
    let validUntil = null;
    let priorValidUntil = null;

    if (plan.months === null) {
      if (existing) {
        licenseId = existing.id;
        validUntil = existing.valid_until || null;
      } else {
        const created = await keygate.createLicense({
          planId,
          email: order.email,
          externalCustomerId: order.id,
          externalWorkspaceId: workspace,
          notes: `wechat:${order.id}`,
        });
        licenseId = created.id;
        validUntil = created.valid_until || null;
      }
    } else if (existing) {
      const prior = parseValidUntil(existing.valid_until);
      if (!prior) {
        // A perpetual license already covers this customer; never shorten it.
        licenseId = existing.id;
        validUntil = null;
        priorValidUntil = '';
      } else {
        const base = prior.getTime() > now.getTime() ? prior : now;
        const end = addMonths(base, plan.months);
        await keygate.setValidUntil(existing.id, rfc3339(end));
        licenseId = existing.id;
        validUntil = rfc3339(end);
        priorValidUntil = rfc3339(prior);
      }
    } else {
      const end = addMonths(now, plan.months);
      const created = await keygate.createLicense({
        planId,
        email: order.email,
        validUntil: rfc3339(end),
        externalCustomerId: order.id,
        externalWorkspaceId: workspace,
        notes: `wechat:${order.id}`,
      });
      licenseId = created.id;
      validUntil = created.valid_until || rfc3339(end);
    }

    if (!licenseId) throw new Error('Keygate did not return a license id');

    markFulfilled(db, order.id, { licenseId, validUntil, priorValidUntil });
    recordEvent(db, order.id, 'fulfill', licenseId, { validUntil, priorValidUntil });
    logger.log(`checkout: order ${order.id} fulfilled license ${licenseId}`);
    return getOrder(db, order.id);
  } catch (error) {
    markFulfillFailed(db, order.id, error.message);
    logger.error(`checkout: fulfillment failed for ${order.id}: ${error.code || error.message}`);
    return getOrder(db, order.id);
  }
}

export async function applyPaidOrder({ db, order, config, keygate, transactionId, payload, logger }) {
  const paid = markPaid(db, { orderId: order.id, transactionId, payload });
  if (paid.status === 'missing' || paid.status === 'conflict') {
    logger.error(`checkout: payment for ${order.id} could not be applied (${paid.status})`);
    return paid.order;
  }
  if (!paid.order || paid.order.status === 'fulfilled' || paid.order.status === 'refunded') return paid.order;
  if (paid.order.status === 'fulfill_failed') return paid.order;
  return fulfillOrder({ db, order: paid.order, config, keygate, logger });
}

export async function syncRefundLicense({ db, order, keygate, logger = console }) {
  if (!order?.keygate_license_id) {
    if (order) recordEvent(db, order.id, 'refund-sync', 'none', null);
    return;
  }
  try {
    if (order.keygate_prior_valid_until === null) {
      await keygate.revoke(order.keygate_license_id);
    } else if (order.keygate_prior_valid_until === '') {
      // Renewal of a perpetual license: nothing to roll back.
    } else {
      const prior = parseValidUntil(order.keygate_prior_valid_until);
      if (prior && prior.getTime() > Date.now()) {
        await keygate.setValidUntil(order.keygate_license_id, rfc3339(prior));
      } else {
        await keygate.revoke(order.keygate_license_id);
      }
    }
    recordEvent(db, order.id, 'refund-sync', order.keygate_license_id, {
      prior: order.keygate_prior_valid_until,
    });
    logger.log(`checkout: refund synced for order ${order.id}`);
  } catch (error) {
    logger.error(`checkout: refund sync failed for ${order.id}: ${error.code || error.message}`);
  }
}
