import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../server/db.mjs';
import { loadConfig } from '../server/config.mjs';
import { MockKeygateClient } from '../server/keygate.mjs';
import { createOrder, findOrderForToken, getOrder, paymentEventCount } from '../server/orders.mjs';
import { addMonths, applyPaidOrder, rfc3339, syncRefundLicense } from '../server/fulfill.mjs';

const quietLogger = { log() {}, error() {} };

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmc-checkout-test-'));
  const db = openDb(path.join(dir, 'checkout.db'));
  return { db, cleanup: () => { closeDb(db); fs.rmSync(dir, { recursive: true, force: true }); } };
}

async function paidOrder(db, config, keygate, { plan = 'monthly', email = 'buyer@example.com', txn = 'txn_1' } = {}) {
  const { order } = createOrder(db, {
    plan,
    email,
    emailNorm: email,
    amountFen: config.plans[plan].amountFen,
    channel: 'native',
  });
  return applyPaidOrder({ db, order, config, keygate, transactionId: txn, payload: { test: true }, logger: quietLogger });
}

test('addMonths clamps to the last day of the target month', () => {
  assert.equal(rfc3339(addMonths('2027-01-31T10:00:00Z', 1)), '2027-02-28T10:00:00Z');
  assert.equal(rfc3339(addMonths('2024-01-31T00:00:00Z', 1)), '2024-02-29T00:00:00Z');
  assert.equal(rfc3339(addMonths('2024-02-29T00:00:00Z', 12)), '2025-02-28T00:00:00Z');
});

test('first purchase creates a license, duplicate payment is idempotent', async () => {
  const { db, cleanup } = freshDb();
  try {
    const config = loadConfig({ KEYGATE_MOCK: '1' });
    const keygate = new MockKeygateClient();
    const order = await paidOrder(db, config, keygate);

    assert.equal(order.status, 'fulfilled');
    assert.equal(keygate.licenses.length, 1);
    assert.ok(order.keygate_valid_until);

    const again = await applyPaidOrder({
      db,
      order: getOrder(db, order.id),
      config,
      keygate,
      transactionId: 'txn_1',
      payload: { test: true },
      logger: quietLogger,
    });
    assert.equal(again.status, 'fulfilled');
    assert.equal(keygate.licenses.length, 1);
    assert.equal(paymentEventCount(db, order.id), 1);
  } finally {
    cleanup();
  }
});

test('a second purchase extends the same license and records the previous expiry', async () => {
  const { db, cleanup } = freshDb();
  try {
    const config = loadConfig({ KEYGATE_MOCK: '1' });
    const keygate = new MockKeygateClient();

    const first = await paidOrder(db, config, keygate, { txn: 'txn_1' });
    const second = await paidOrder(db, config, keygate, { txn: 'txn_2' });

    assert.equal(keygate.licenses.length, 1);
    assert.equal(first.keygate_license_id, second.keygate_license_id);
    assert.equal(second.keygate_prior_valid_until, first.keygate_valid_until);
    assert.equal(
      second.keygate_valid_until,
      rfc3339(addMonths(first.keygate_valid_until, 1)),
    );
    assert.equal(keygate.licenses[0].valid_until, second.keygate_valid_until);
  } finally {
    cleanup();
  }
});

test('buying lifetime twice does not issue a second license', async () => {
  const { db, cleanup } = freshDb();
  try {
    const config = loadConfig({ KEYGATE_MOCK: '1' });
    const keygate = new MockKeygateClient();

    const first = await paidOrder(db, config, keygate, { plan: 'lifetime', txn: 'txn_l1' });
    const second = await paidOrder(db, config, keygate, { plan: 'lifetime', txn: 'txn_l2' });

    assert.equal(first.status, 'fulfilled');
    assert.equal(second.status, 'fulfilled');
    assert.equal(keygate.licenses.length, 1);
    assert.equal(second.keygate_license_id, first.keygate_license_id);
    assert.equal(second.keygate_valid_until, null);
  } finally {
    cleanup();
  }
});

test('order tokens are verified against the stored hash', () => {
  const { db, cleanup } = freshDb();
  try {
    const config = loadConfig({ KEYGATE_MOCK: '1' });
    const { order, token } = createOrder(db, {
      plan: 'monthly',
      email: 'buyer@example.com',
      emailNorm: 'buyer@example.com',
      amountFen: config.plans.monthly.amountFen,
      channel: 'native',
    });
    assert.equal(findOrderForToken(db, order.id, token)?.id, order.id);
    assert.equal(findOrderForToken(db, order.id, `${token}x`), null);
    assert.equal(findOrderForToken(db, order.id, ''), null);
  } finally {
    cleanup();
  }
});

test('refunding a brand-new purchase revokes the license', async () => {
  const { db, cleanup } = freshDb();
  try {
    const keygate = new MockKeygateClient();
    const license = await keygate.createLicense({
      planId: 'monthly',
      email: 'buyer@example.com',
      validUntil: '2026-12-05T00:00:00Z',
      externalWorkspaceId: 'wemediacreator:buyer@example.com',
    });
    const order = { id: 'ord_refund_new', keygate_license_id: license.id, keygate_prior_valid_until: null };

    await syncRefundLicense({ db, order, keygate, logger: quietLogger });
    assert.equal(keygate.licenses[0].status, 'revoked');
  } finally {
    cleanup();
  }
});

test('refunding a renewal restores the previous expiry', async () => {
  const { db, cleanup } = freshDb();
  try {
    const keygate = new MockKeygateClient();
    const license = await keygate.createLicense({
      planId: 'monthly',
      email: 'buyer@example.com',
      validUntil: '2027-06-05T00:00:00Z',
      externalWorkspaceId: 'wemediacreator:buyer@example.com',
    });
    const order = {
      id: 'ord_refund_renewal',
      keygate_license_id: license.id,
      keygate_prior_valid_until: '2026-12-05T00:00:00Z',
    };

    await syncRefundLicense({ db, order, keygate, logger: quietLogger });
    assert.equal(keygate.licenses[0].status, 'active');
    assert.equal(keygate.licenses[0].valid_until, '2026-12-05T00:00:00Z');
  } finally {
    cleanup();
  }
});

test('refunding a renewal whose previous expiry has passed revokes the license', async () => {
  const { db, cleanup } = freshDb();
  try {
    const keygate = new MockKeygateClient();
    const license = await keygate.createLicense({
      planId: 'monthly',
      email: 'buyer@example.com',
      validUntil: '2027-06-05T00:00:00Z',
      externalWorkspaceId: 'wemediacreator:buyer@example.com',
    });
    const order = {
      id: 'ord_refund_expired',
      keygate_license_id: license.id,
      keygate_prior_valid_until: '2020-01-01T00:00:00Z',
    };

    await syncRefundLicense({ db, order, keygate, logger: quietLogger });
    assert.equal(keygate.licenses[0].status, 'revoked');
  } finally {
    cleanup();
  }
});

test('refunding a perpetual renewal leaves the license untouched', async () => {
  const { db, cleanup } = freshDb();
  try {
    const keygate = new MockKeygateClient();
    const license = await keygate.createLicense({
      planId: 'monthly',
      email: 'buyer@example.com',
      externalWorkspaceId: 'wemediacreator:buyer@example.com',
    });
    const order = { id: 'ord_refund_perpetual', keygate_license_id: license.id, keygate_prior_valid_until: '' };

    await syncRefundLicense({ db, order, keygate, logger: quietLogger });
    assert.equal(keygate.licenses[0].status, 'active');
    assert.equal(keygate.licenses[0].valid_until, null);
  } finally {
    cleanup();
  }
});
