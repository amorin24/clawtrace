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

  test('isConfigured returns true when keys are provided', () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });
    assert.strictEqual(client.isConfigured(), true);
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

  test('buildAuthHeader returns null when not configured', () => {
    const client = new LangfuseClient({});
    assert.strictEqual(client.buildAuthHeader(), null);
  });

  test('ingest returns not_configured error when keys missing', async () => {
    const client = new LangfuseClient({});
    const result = await client.ingest([{ type: 'trace-create' }]);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'not_configured');
  });

  test('ingest returns success for empty array', async () => {
    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });
    const result = await client.ingest([]);
    assert.strictEqual(result.ok, true);
  });

  test('successful batch ingest returns ok: true', async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'OK'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    const events = [{ type: 'trace-create', id: 'test-123' }];
    const result = await client.ingest(events);

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(global.fetch.mock.calls.length, 1);
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

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'auth');
    assert.strictEqual(result.status, 401);
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

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'server');
    assert.strictEqual(result.status, 500);
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

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'network');
  });

  test('uses correct base URL from config', async () => {
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

    const callArgs = global.fetch.mock.calls[0].arguments;
    assert.strictEqual(callArgs[0], 'https://custom.langfuse.com/api/public/ingestion');
  });

  test('includes correct headers in request', async () => {
    global.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'OK'
    }));

    const client = new LangfuseClient({
      publicKey: 'pk-test',
      secretKey: 'sk-test'
    });

    await client.ingest([{ type: 'trace-create' }]);

    const callArgs = global.fetch.mock.calls[0].arguments;
    const options = callArgs[1];

    assert.strictEqual(options.method, 'POST');
    assert.strictEqual(options.headers['Content-Type'], 'application/json');
    assert.ok(options.headers['Authorization'].startsWith('Basic '));
  });
});
