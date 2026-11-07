import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKOUT_PLANS } from './plans.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteDir = path.resolve(__dirname, '..');

function isOn(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function readPem(file) {
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.WEBSITE_DATA_DIR || path.join(websiteDir, 'data'));

  const plans = {};
  for (const [id, def] of Object.entries(CHECKOUT_PLANS)) {
    plans[id] = { ...def, keygatePlanId: String(env[def.keygateEnv] || '').trim() };
  }

  const wechat = {
    mock: isOn(env.WECHAT_MOCK),
    mchid: String(env.WECHAT_MCHID || '').trim(),
    appid: String(env.WECHAT_APPID || '').trim(),
    h5Appid: String(env.WECHAT_H5_APPID || env.WECHAT_APPID || '').trim(),
    apiV3Key: String(env.WECHAT_API_V3_KEY || '').trim(),
    merchantSerialNo: String(env.WECHAT_MERCHANT_SERIAL_NO || '').trim(),
    merchantPrivateKeyFile: String(env.WECHAT_MERCHANT_PRIVATE_KEY_FILE || '').trim(),
    platformPublicKeyFile: String(env.WECHAT_PLATFORM_PUBLIC_KEY_FILE || '').trim(),
    platformPublicKeyId: String(env.WECHAT_PLATFORM_PUBLIC_KEY_ID || '').trim(),
    notifyUrl: String(env.WECHAT_NOTIFY_URL || '').trim(),
    refundNotifyUrl: String(env.WECHAT_REFUND_NOTIFY_URL || '').trim(),
    h5RedirectBase: String(env.WECHAT_H5_REDIRECT_BASE || '').trim(),
    merchantPrivateKey: '',
    platformPublicKey: '',
  };

  if (!wechat.mock) {
    wechat.merchantPrivateKey = readPem(wechat.merchantPrivateKeyFile);
    wechat.platformPublicKey = readPem(wechat.platformPublicKeyFile);
  }

  const wechatConfigured =
    wechat.mock ||
    Boolean(
      wechat.mchid &&
        wechat.appid &&
        wechat.apiV3Key.length === 32 &&
        wechat.merchantSerialNo &&
        wechat.merchantPrivateKey &&
        wechat.platformPublicKey &&
        wechat.platformPublicKeyId &&
        wechat.notifyUrl,
    );

  const keygate = {
    mock: isOn(env.KEYGATE_MOCK),
    baseUrl: String(env.KEYGATE_BASE_URL || 'https://keygate.unionuser.com').replace(/\/+$/, ''),
    apiKey: String(env.KEYGATE_API_KEY || '').trim(),
    productId: String(env.KEYGATE_PRODUCT_ID || '').trim(),
    workspacePrefix: String(env.KEYGATE_WORKSPACE_PREFIX || 'wemediacreator').trim(),
  };

  const keygateConfigured =
    keygate.mock ||
    Boolean(
      keygate.apiKey &&
        keygate.productId &&
        Object.values(plans).every((plan) => plan.keygatePlanId),
    );

  return {
    dataDir,
    dbPath: path.resolve(env.CHECKOUT_DB || path.join(dataDir, 'checkout.db')),
    plans,
    wechat,
    wechatConfigured,
    keygate,
    keygateConfigured,
    adminToken: String(env.CHECKOUT_ADMIN_TOKEN || '').trim(),
    rateLimit: Math.max(1, Number(env.CHECKOUT_RATE_LIMIT || 10) || 10),
  };
}

export function workspaceId(emailNorm, prefix = 'wemediacreator') {
  return `${prefix}:${emailNorm}`;
}

export function validEmail(value) {
  const email = String(value || '').trim();
  if (email.length < 3 || email.length > 254) return false;
  if (/[\u0000-\u0020\u007f]/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
