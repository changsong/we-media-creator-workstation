// Local-only stand-in for the WeChat Pay APIv3 client. Orders created while
// WECHAT_MOCK=1 are settled through /api/checkout/admin/mock-pay instead of a
// real notification.

export class MockWeChatClient {
  constructor() {
    this.kind = 'mock';
  }

  async native({ outTradeNo }) {
    return { code_url: `mock://pay/${outTradeNo}` };
  }

  async h5({ outTradeNo, redirectUrl }) {
    return { h5_url: redirectUrl || `/checkout/return/?mock=${encodeURIComponent(outTradeNo)}` };
  }

  async queryByOutTradeNo(outTradeNo) {
    return { trade_state: 'NOTPAY', out_trade_no: outTradeNo, amount: { total: 0, currency: 'CNY' } };
  }

  async close() {
    return {};
  }

  async refund({ outRefundNo }) {
    return { refund_id: `mock_refund_${outRefundNo}`, out_refund_no: outRefundNo, status: 'PROCESSING' };
  }

  async queryRefund() {
    return { status: 'SUCCESS' };
  }
}
