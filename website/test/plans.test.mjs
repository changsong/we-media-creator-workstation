import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKOUT_PLANS } from '../server/plans.mjs';
import { PLANS } from '../src/config.mjs';

test('server checkout catalog mirrors the public price list', () => {
  const publicPlans = Object.fromEntries(PLANS.map((plan) => [plan.id, plan]));
  assert.deepEqual(Object.keys(CHECKOUT_PLANS).sort(), Object.keys(publicPlans).sort());

  for (const [id, plan] of Object.entries(CHECKOUT_PLANS)) {
    const pub = publicPlans[id];
    assert.equal(plan.amountFen, Math.round(pub.price * 100), `amount for ${id}`);
    assert.equal(plan.labelZh, pub.nameZh, `label for ${id}`);
  }
});
