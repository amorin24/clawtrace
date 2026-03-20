class LangfuseClient {
  constructor(config) {
    this.publicKey = config.publicKey || null;
    this.secretKey = config.secretKey || null;
    this.baseUrl = config.baseUrl || 'https://cloud.langfuse.com';
    this.configured = !!(this.publicKey && this.secretKey);
  }

  isConfigured() {
    return this.configured;
  }

  buildAuthHeader() {
    if (!this.configured) {
      return null;
    }
    const credentials = Buffer.from(`${this.publicKey}:${this.secretKey}`).toString('base64');
    return `Basic ${credentials}`;
  }

  async ingest(events) {
    if (!this.configured) {
      return { ok: false, error: 'not_configured' };
    }

    if (!Array.isArray(events) || events.length === 0) {
      return { ok: true, status: 200 };
    }

    const url = `${this.baseUrl}/api/public/ingestion`;
    const authHeader = this.buildAuthHeader();

    const payload = {
      batch: events,
      metadata: {
        sdk_name: 'clawtrace',
        sdk_version: '1.0.0',
        public_key: this.publicKey
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        return { ok: true, status: response.status };
      }

      if (response.status >= 400 && response.status < 500) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { ok: false, error: 'auth', status: response.status, details: errorText };
      }

      if (response.status >= 500) {
        const errorText = await response.text().catch(() => 'Unknown error');
        return { ok: false, error: 'server', status: response.status, details: errorText };
      }

      return { ok: false, error: 'unknown', status: response.status };
    } catch (err) {
      if (err.cause?.code === 'ENOTFOUND' || err.cause?.code === 'ECONNREFUSED' || err.name === 'TypeError') {
        return { ok: false, error: 'network', details: err.message };
      }
      return { ok: false, error: 'network', details: err.message };
    }
  }
}

module.exports = LangfuseClient;
