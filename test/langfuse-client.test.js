const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const LangfuseClient = require('../lib/langfuse-client.js');

describe('LangfuseClient', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('isConfigured returns false when keys are missing', () => {
    const client = new LangfuseClient({});
    assert.strictEqual(client.isConfigured(), false);
  });

  test('buildAuthHeader constructs correct Basic auth header', () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const header = client.buildAuthHeader();
    const expected = 'Basic ' + Buffer.from('pk-test:sk-test').toString('base64');
    assert.strictEqual(header, expected);
  });

  test('ingest returns not_configured error when keys missing', async () => {
    const client = new LangfuseClient({});
    const result = await client.ingest([{ type: 'trace-create' }]);

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'not_configured');
  });

  test('successful batch ingest returns ok: true and includes sdk version metadata', async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'OK'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      sdkVersion: '9.9.9'
    });

    const result = await client.ingest([{ type: 'trace-create', id: 'test-123' }]);
    const payload = JSON.parse(global.fetch.mock.calls[0].arguments[1].body);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(payload.metadata.sdk_version, '9.9.9');
  });

  test('401 error returns auth error', async () => {
    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const result = await client.ingest([{ type: 'trace-create' }]);
    assert.strictEqual(result.error, 'auth');
  });

  test('429 error returns rate_limit error', async () => {
    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => 'Too Many Requests'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const result = await client.ingest([{ type: 'trace-create' }]);
    assert.strictEqual(result.error, 'rate_limit');
  });

  test('400 error returns client error', async () => {
    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'Bad Request'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const result = await client.ingest([{ type: 'trace-create' }]);
    assert.strictEqual(result.error, 'client');
  });

  test('500 error returns server error', async () => {
    global.fetch = mock.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const result = await client.ingest([{ type: 'trace-create' }]);
    assert.strictEqual(result.error, 'server');
  });

  test('network failure returns network error', async () => {
    global.fetch = mock.fn(async () => {
      const err = new Error('Network error');
      err.cause = { code: 'ENOTFOUND' };
      throw err;
    });

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const result = await client.ingest([{ type: 'trace-create' }]);
    assert.strictEqual(result.error, 'network');
  });

  test('uses correct base URL and headers', async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'OK'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: 'https://custom.langfuse.com'
    });

    await client.ingest([{ type: 'trace-create' }]);

    const [url, options] = global.fetch.mock.calls[0].arguments;
    assert.strictEqual(url, 'https://custom.langfuse.com/api/public/ingestion');
    assert.strictEqual(options.method, 'POST');
    assert.strictEqual(options.headers['Content-Type'], 'application/json');
    assert.ok(options.headers.Authorization.startsWith('Basic '));
  });
});
