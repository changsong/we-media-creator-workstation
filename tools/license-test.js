'use strict';

/**
 * 许可证 token 离线验签测试：自签 Ed25519 token，不依赖 Keygate 线上服务。
 * 用法：node --test tools/license-test.js
 */

process.env.WB_DATA_DIR = process.env.WB_DATA_DIR || require('path').join(require('os').tmpdir(), 'wemedia-license-test');

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const license = require('../lib/license');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const IDENTIFIER = 'wm-test-device';
const PRODUCT = 'prod_test';
const FPR = crypto.createHash('sha256').update(IDENTIFIER + ':' + PRODUCT).digest('hex').slice(0, 16);

function now() {
  return Math.floor(Date.now() / 1000);
}

function basePayload(overrides = {}) {
  return Object.assign(
    {
      lid: 'lic_test',
      pid: PRODUCT,
      pln: 'monthly',
      sts: 'active',
      did: IDENTIFIER,
      ftr: { publish: true },
      iat: now() - 60,
      exp: now() + 86400,
      vun: now() + 30 * 86400,
      upd: now() + 30 * 86400,
      grc: 7,
      fpr: FPR
    },
    overrides
  );
}

function sign(payload, key = privateKey) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(payloadB64, 'ascii'), key);
  return payloadB64 + '.' + sig.toString('base64url');
}

function verify(payload, options = {}) {
  return license.verifyToken(sign(payload), Object.assign({ identifier: IDENTIFIER, publicKeyHex: PUBLIC_HEX }, options));
}

test('有效 token 通过验签并返回离线截止时间', () => {
  const payload = basePayload();
  const result = verify(payload);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'ok');
  assert.equal(result.payload.lid, 'lic_test');
  assert.equal(result.offlineUntil, Math.min(payload.exp, payload.vun + payload.grc * 86400));
});

test('payload 被篡改后签名失效', () => {
  const signed = sign(basePayload());
  const [payloadB64, sig] = signed.split('.');
  const tampered = Buffer.from(JSON.stringify(basePayload({ pln: 'lifetime' }))).toString('base64url');
  const result = license.verifyToken(tampered + '.' + sig, { identifier: IDENTIFIER, publicKeyHex: PUBLIC_HEX });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature_invalid');
  assert.notEqual(tampered, payloadB64);
});

test('其他密钥签发的 token 被拒绝', () => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const result = license.verifyToken(sign(basePayload(), other), { identifier: IDENTIFIER, publicKeyHex: PUBLIC_HEX });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature_invalid');
});

test('设备指纹不一致时拒绝', () => {
  assert.equal(verify(basePayload({ did: 'wm-other' })).reason, 'device_mismatch');
  assert.equal(verify(basePayload({ fpr: '0000000000000000' })).reason, 'device_mismatch');
});

test('过期 token 拒绝', () => {
  assert.equal(verify(basePayload({ exp: now() - 10 })).reason, 'token_expired');
});

test('吊销/失效状态拒绝', () => {
  assert.equal(verify(basePayload({ sts: 'revoked' })).reason, 'license_inactive');
  assert.equal(verify(basePayload({ sts: 'suspended' })).reason, 'license_inactive');
});

test('授权期 + 宽限期结束后拒绝', () => {
  const payload = basePayload({ vun: now() - 10 * 86400, grc: 7 });
  assert.equal(verify(payload).reason, 'license_expired');
});

test('发布权益被关闭时拒绝', () => {
  assert.equal(verify(basePayload({ ftr: { publish: false } })).reason, 'feature_not_entitled');
  assert.equal(verify(basePayload({ ftr: { other: true } })).ok, true);
});

test('畸形 token 不抛异常', () => {
  assert.equal(license.verifyToken('', { identifier: IDENTIFIER }).reason, 'token_missing');
  assert.equal(license.verifyToken('nodot', { identifier: IDENTIFIER }).reason, 'token_malformed');
  assert.equal(license.verifyToken('abc.', { identifier: IDENTIFIER }).reason, 'token_malformed');
  assert.equal(
    license.verifyToken(Buffer.from('not json').toString('base64url') + '.' + Buffer.alloc(64).toString('base64url'), {
      identifier: IDENTIFIER,
      publicKeyHex: PUBLIC_HEX
    }).reason,
    'signature_invalid'
  );
});

test('未激活时发布校验返回 not_activated', () => {
  const check = license.publishCheck();
  assert.equal(check.allowed, false);
  assert.equal(check.reason, 'not_activated');
  assert.equal(license.canPublishSync(), false);
});
