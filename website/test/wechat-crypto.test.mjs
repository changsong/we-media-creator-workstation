import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decryptResource, verifyNotifySignature } from '../server/wechat/crypto.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const API_V3_KEY = '0123456789abcdef0123456789abcdef';
const PUBLIC_KEY_ID = 'PUB_KEY_ID_TEST';

function sign(message) {
  return crypto.sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKey).toString('base64');
}

function encrypt({ associatedData = '', nonce, plaintext }) {
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(API_V3_KEY, 'utf8'), Buffer.from(nonce, 'utf8'));
  if (associatedData) cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return encrypted.toString('base64');
}

const NOW = 1_760_000_000;

test('accepts a correctly signed notification', () => {
  const body = '{"id":"notify-1"}';
  const message = `${NOW}\nnonce-1\n${body}\n`;
  const result = verifyNotifySignature({
    timestamp: String(NOW),
    nonce: 'nonce-1',
    signature: sign(message),
    body,
    publicKey: publicPem,
    publicKeyId: PUBLIC_KEY_ID,
    headerSerial: PUBLIC_KEY_ID,
    now: NOW,
  });
  assert.deepEqual(result, { ok: true });
});

test('rejects tampered bodies, stale timestamps and unknown key serials', () => {
  const body = '{"id":"notify-1"}';
  const signature = sign(`${NOW}\nnonce-1\n${body}\n`);
  const base = { timestamp: String(NOW), nonce: 'nonce-1', signature, publicKey: publicPem, publicKeyId: PUBLIC_KEY_ID, headerSerial: PUBLIC_KEY_ID, now: NOW };

  assert.equal(verifyNotifySignature({ ...base, body: '{"id":"notify-2"}' }).ok, false);
  assert.equal(verifyNotifySignature({ ...base, body, now: NOW + 600 }).ok, false);
  assert.equal(verifyNotifySignature({ ...base, body, headerSerial: 'PUB_KEY_ID_OTHER' }).ok, false);
  assert.equal(verifyNotifySignature({ ...base, body, publicKey: '' }).ok, false);
});

test('decrypts an AES-256-GCM resource payload', () => {
  const nonce = 'abcdefghijkl';
  const associatedData = 'transaction';
  const plaintext = JSON.stringify({ out_trade_no: 'ord_1', trade_state: 'SUCCESS' });
  const ciphertext = encrypt({ associatedData, nonce, plaintext });

  const decoded = decryptResource({ apiV3Key: API_V3_KEY, associatedData, nonce, ciphertext });
  assert.equal(decoded, plaintext);
});

test('rejects resource payloads decrypted with the wrong key', () => {
  const nonce = 'abcdefghijkl';
  const ciphertext = encrypt({ nonce, plaintext: 'hello' });
  assert.throws(() => decryptResource({ apiV3Key: 'ffffffffffffffffffffffffffffffff', nonce, ciphertext }));
  assert.throws(() => decryptResource({ apiV3Key: 'too-short', nonce, ciphertext }));
});
