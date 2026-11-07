export function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export function readRawBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function readJsonBody(req, limit = 64 * 1024) {
  return readRawBody(req, limit).then((buffer) => {
    if (!buffer.length) return {};
    return JSON.parse(buffer.toString('utf8'));
  });
}

export function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

export function isMobile(ua) {
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(String(ua || ''));
}

export function inWeChat(ua) {
  return /MicroMessenger/i.test(String(ua || ''));
}

export function absoluteOrRelativeJoin(base, orderId, token) {
  const params = new URLSearchParams({ order: orderId, token });
  if (!base) return `/checkout/return/?${params}`;
  if (/^https?:\/\//i.test(base)) {
    const url = new URL(base);
    url.searchParams.set('order', orderId);
    url.searchParams.set('token', token);
    return url.toString();
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${params}`;
}
