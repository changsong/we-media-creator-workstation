export class KeygateError extends Error {
  constructor(code, message, status = 0) {
    super(message || code || 'keygate error');
    this.name = 'KeygateError';
    this.code = code || 'KEYGATE_ERROR';
    this.status = status;
  }
}

export class KeygateClient {
  constructor({ baseUrl, apiKey, productId, fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.productId = productId;
    this.fetchImpl = fetchImpl;
  }

  async request(method, urlPath, body) {
    const response = await this.fetchImpl(`${this.baseUrl}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }
    if (!response.ok || payload.success === false) {
      throw new KeygateError(
        payload.error?.code || `HTTP_${response.status}`,
        payload.error?.message || 'Keygate rejected the request',
        response.status,
      );
    }
    return payload.data ?? payload;
  }

  async listByWorkspace(workspace) {
    const query = new URLSearchParams({
      product_id: this.productId,
      external_workspace_id: workspace,
      limit: '100',
    });
    const data = await this.request('GET', `/api/v1/admin/licenses?${query}`);
    return Array.isArray(data.licenses) ? data.licenses : [];
  }

  async createLicense({ planId, email, validUntil, externalCustomerId, externalWorkspaceId, notes }) {
    return this.request('POST', '/api/v1/admin/licenses', {
      product_id: this.productId,
      plan_id: planId,
      email,
      external_customer_id: externalCustomerId,
      external_workspace_id: externalWorkspaceId,
      notes,
      ...(validUntil ? { valid_until: validUntil } : {}),
    });
  }

  async setValidUntil(licenseId, validUntil) {
    return this.request('POST', `/api/v1/admin/licenses/${encodeURIComponent(licenseId)}/valid-until`, {
      valid_until: validUntil,
    });
  }

  async revoke(licenseId) {
    return this.request('POST', `/api/v1/admin/licenses/${encodeURIComponent(licenseId)}/revoke`);
  }

  async reinstate(licenseId) {
    return this.request('POST', `/api/v1/admin/licenses/${encodeURIComponent(licenseId)}/reinstate`);
  }

  async resendEmail(licenseId) {
    return this.request('POST', `/api/v1/admin/licenses/${encodeURIComponent(licenseId)}/resend-email`);
  }
}

// In-memory stand-in used by KEYGATE_MOCK=1 so the whole checkout flow can be
// exercised without touching production licenses.
export class MockKeygateClient {
  constructor() {
    this.licenses = [];
    this.counter = 0;
  }

  async listByWorkspace(workspace) {
    return this.licenses.filter((license) => license.external_workspace_id === workspace).map(clone);
  }

  async createLicense({ planId, email, validUntil, externalCustomerId, externalWorkspaceId }) {
    this.counter += 1;
    const license = {
      id: `lic_mock_${this.counter}`,
      product_id: 'prod_mock',
      plan_id: planId,
      email,
      status: 'active',
      valid_until: validUntil || null,
      external_customer_id: externalCustomerId,
      external_workspace_id: externalWorkspaceId,
      created_at: new Date().toISOString(),
    };
    this.licenses.push(license);
    return clone(license);
  }

  async setValidUntil(licenseId, validUntil) {
    const license = this.licenses.find((item) => item.id === licenseId);
    if (!license) throw new KeygateError('NOT_FOUND', 'license not found', 404);
    license.valid_until = validUntil;
    return clone(license);
  }

  async revoke(licenseId) {
    const license = this.licenses.find((item) => item.id === licenseId);
    if (!license) throw new KeygateError('NOT_FOUND', 'license not found', 404);
    license.status = 'revoked';
    return clone(license);
  }

  async reinstate(licenseId) {
    const license = this.licenses.find((item) => item.id === licenseId);
    if (!license) throw new KeygateError('NOT_FOUND', 'license not found', 404);
    license.status = 'active';
    return clone(license);
  }

  async resendEmail() {
    return { queued: true };
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
