// Amounts mirror PLANS in src/config.mjs; website/test/plans.test.mjs keeps
// the two in sync. The server cannot import src/ because only site/, server.mjs
// and server/ are deployed to /opt/we-media-site.

export const CHECKOUT_PLANS = {
  monthly: {
    id: 'monthly',
    labelZh: '月付体验方案',
    amountFen: 4990,
    months: 1,
    keygateEnv: 'KEYGATE_PLAN_MONTHLY',
  },
  yearly: {
    id: 'yearly',
    labelZh: '年付最具性价比',
    amountFen: 50000,
    months: 12,
    keygateEnv: 'KEYGATE_PLAN_YEARLY',
  },
  lifetime: {
    id: 'lifetime',
    labelZh: '终身买断方案',
    amountFen: 98000,
    months: null,
    keygateEnv: 'KEYGATE_PLAN_LIFETIME',
  },
};

export function checkoutPlan(id) {
  return Object.hasOwn(CHECKOUT_PLANS, id) ? CHECKOUT_PLANS[id] : null;
}

export function formatCny(fen) {
  return `¥${(fen / 100).toFixed(fen % 100 === 0 ? 0 : 2)}`;
}
