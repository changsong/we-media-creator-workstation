import crypto from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

export function verifyNotifySignature({
  timestamp,
  nonce,
  signature,
  body,
  publicKey,
  publicKeyId = '',
  headerSerial = '',
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = Math.floor(Date.now() / 1000),
}) {
  if (!publicKey) return { ok: false, reason: 'platform public key is not configured' };
  if (publicKeyId && headerSerial && headerSerial !== publicKeyId) {
    return { ok: false, reason: 'unexpected Wechatpay-Serial' };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing Wechatpay-Timestamp' };
  if (Math.abs(now - ts) > toleranceSeconds) return { ok: false, reason: 'timestamp outside tolerance' };
  if (!nonce || !signature) return { ok: false, reason: 'missing signature headers' };

  const message = `${timestamp}\n${nonce}\n${body}\n`;
  try {
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(message, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
    return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' };
  } catch {
    return { ok: false, reason: 'signature could not be verified' };
  }
}

export function decryptResource({ apiV3Key, associatedData = '', nonce, ciphertext }) {
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== 32) throw new Error('WECHAT_API_V3_KEY must be 32 bytes');
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length <= 16) throw new Error('ciphertext too short');
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(0, raw.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
