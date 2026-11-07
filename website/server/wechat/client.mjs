import { buildAuthorization } from './sign.mjs';

const BASE_URL = 'https://api.mch.weixin.qq.com';
const MAX_DESCRIPTION_BYTES = 127;

export class WeChatError extends Error {
  constructor(code, message, status = 0) {
    super(message || code || 'wechat error');
    this.name = 'WeChatError';
    this.code = code || 'WECHAT_ERROR';
    this.status = status;
  }
}

export function truncateDescription(text) {
  const value = String(text || '').trim() || '媒管家';
  let out = '';
  for (const char of value) {
    if (Buffer.byteLength(out + char, 'utf8') > MAX_DESCRIPTION_BYTES) break;
    out += char;
  }
  return out;
}

function isoExpire(minutes = 120, now = Date.now()) {
  return new Date(now + minutes * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export class WeChatClient {
  constructor(config, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async request(method, urlPath, bodyObject) {
    const body = bodyObject === undefined ? '' : JSON.stringify(bodyObject);
    const authorization = buildAuthorization({
      mchid: this.config.mchid,
      serialNo: this.config.merchantSerialNo,
      privateKey: this.config.merchantPrivateKey,
      method,
      urlPath,
      body,
      timestamp: Math.floor(this.now() / 1000),
    });

    const headers = {
      Authorization: authorization,
      Accept: 'application/json',
      'User-Agent': 'wemediacreator-checkout/1.0',
    };
    if (body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await this.fetchImpl(`${BASE_URL}${urlPath}`, {
        method,
        headers,
        body: body || undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new WeChatError('WECHAT_UNREACHABLE', `could not reach WeChat Pay: ${error.message}`);
    }

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 200) };
      }
    }

    if (!response.ok) {
      throw new WeChatError(
        payload.code || `HTTP_${response.status}`,
        payload.message || 'WeChat Pay rejected the request',
        response.status,
      );
    }
    return payload;
  }

  async native({ outTradeNo, description, amountFen, notifyUrl }) {
    return this.request('POST', '/v3/pay/transactions/native', {
      appid: this.config.appid,
      mchid: this.config.mchid,
      description: truncateDescription(description),
      out_trade_no: outTradeNo,
      time_expire: isoExpire(120, this.now()),
      notify_url: notifyUrl,
      amount: { total: amountFen, currency: 'CNY' },
    });
  }

  async h5({ outTradeNo, description, amountFen, notifyUrl, payerClientIp, redirectUrl }) {
    return this.request('POST', '/v3/pay/transactions/h5', {
      appid: this.config.h5Appid || this.config.appid,
      mchid: this.config.mchid,
      description: truncateDescription(description),
      out_trade_no: outTradeNo,
      time_expire: isoExpire(120, this.now()),
      notify_url: notifyUrl,
      amount: { total: amountFen, currency: 'CNY' },
      scene_info: {
        payer_client_ip: payerClientIp || '127.0.0.1',
        h5_info: { type: 'Wap' },
      },
      ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
    });
  }

  async queryByOutTradeNo(outTradeNo) {
    return this.request(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(this.config.mchid)}`,
    );
  }

  async close(outTradeNo) {
    return this.request('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`, {
      mchid: this.config.mchid,
    });
  }

  async refund({ outTradeNo, outRefundNo, totalFen, refundFen, reason, notifyUrl }) {
    return this.request('POST', '/v3/refund/domestic/refunds', {
      out_trade_no: outTradeNo,
      out_refund_no: outRefundNo,
      reason: reason ? String(reason).slice(0, 80) : undefined,
      notify_url: notifyUrl,
      amount: { refund: refundFen, total: totalFen, currency: 'CNY' },
    });
  }

  async queryRefund(outRefundNo) {
    return this.request('GET', `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`);
  }
}
