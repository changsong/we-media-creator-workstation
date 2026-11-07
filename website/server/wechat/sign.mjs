import crypto from 'node:crypto';

export function buildAuthorization({
  mchid,
  serialNo,
  privateKey,
  method,
  urlPath,
  body = '',
  timestamp = Math.floor(Date.now() / 1000),
  nonce = crypto.randomBytes(16).toString('hex'),
}) {
  const message = `${method.toUpperCase()}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(message, 'utf8'), privateKey).toString('base64');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`;
}
