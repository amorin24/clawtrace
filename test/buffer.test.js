const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const Buffer = require('../lib/buffer.js');

describe('Buffer', () => {
  let testBufferPath;
  let mockClient;
  let mockLogger;

  beforeEach(() => {
    testBufferPath = path.join(os.tmpdir(), `clawtrace-test-${Date.now()}-${Math.random()}.ndjson`);
    mockClient = {
      ingest: async () => ({ ok: true })
    };
    mockLogger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  });

  afterEach(async () => {
    await fs.rm(testBufferPath, { force: true });
  });

  test('write creates buffer file with valid NDJSON', async () => {
    const buffer = new Buffer({ bufferPath: testBufferPath, logger: mockLogger }, mockClient);

    const events = [{ type: 'trace-create', id: 'test-1' }];
    await buffer.write(events);

    const content = await fs.readFile(testBufferPath, 'utf8');
    const lines = content.trim().split('\n');
    const parsed = JSON.parse(lines[0]);

    assert.strictEqual(lines.length, 1);
    assert.ok(parsed.timestamp);
    assert.strictEqual(parsed.attempts, 0);
    assert.strictEqual(parsed.nextRetryAt, 0);
    assert.deepStrictEqual(parsed.events, events);
  });

  test('flush successfully ingests buffered events and clears file', async () => {
    const ingestedBatches = [];
    mockClient.ingest = async (events) => {
      ingestedBatches.push(events);
      return { ok: true };
    };

    const buffer = new Buffer({ bufferPath: testBufferPath, logger: mockLogger }, mockClient);
    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.write([{ type: 'trace-create', id: 'test-2' }]);

    await buffer.flush();

    assert.strictEqual(ingestedBatches.length, 2);
    assert.strictEqual(await buffer.count(), 0);
  });

  test('flush failure increments attempts and schedules backoff', async () => {
    let callCount = 0;
    mockClient.ingest = async () => {
      callCount += 1;
      return { ok: false, error: 'server' };
    };

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger,
      backoffBase: 1000
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.flush();

    const lines = await buffer.readLines();
    const entry = JSON.parse(lines[0]);

    assert.strictEqual(entry.attempts, 1);
    assert.ok(entry.nextRetryAt > Date.now());
    assert.strictEqual(callCount, 1);
  });

  test('flush skips entries until retry time is reached', async () => {
    let callCount = 0;
    mockClient.ingest = async () => {
      callCount += 1;
      return { ok: false, error: 'server' };
    };

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger,
      backoffBase: 100000
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.flush();
    await buffer.flush();

    assert.strictEqual(callCount, 1);
  });

  test('entries drop after max retries', async () => {
    const warnings = [];
    mockLogger.warn = (message) => warnings.push(message);
    mockClient.ingest = async () => ({ ok: false, error: 'server' });

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      maxRetries: 2,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.flush();
    let [entry] = (await buffer.readLines()).map((line) => JSON.parse(line));
    entry.nextRetryAt = 0;
    await buffer.writeLines([JSON.stringify(entry)]);
    await buffer.flush();
    [entry] = (await buffer.readLines()).map((line) => JSON.parse(line));
    entry.nextRetryAt = 0;
    await buffer.writeLines([JSON.stringify(entry)]);
    await buffer.flush();

    assert.strictEqual(await buffer.count(), 0);
    assert.ok(warnings.some((warning) => warning.includes('Dropping batch after 2 retries')));
  });

  test('auth and client errors drop batches immediately', async () => {
    const warnings = [];
    mockLogger.warn = (message) => warnings.push(message);

    let mode = 'auth';
    mockClient.ingest = async () => ({ ok: false, error: mode });

    const buffer = new Buffer({ bufferPath: testBufferPath, logger: mockLogger }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'auth' }]);
    await buffer.flush();
    assert.strictEqual(await buffer.count(), 0);

    mode = 'client';
    await buffer.write([{ type: 'trace-create', id: 'client' }]);
    await buffer.flush();
    assert.strictEqual(await buffer.count(), 0);
    assert.ok(warnings.some((warning) => warning.includes('auth error')));
    assert.ok(warnings.some((warning) => warning.includes('client error')));
  });

  test('buffer respects max size and drops oldest entries', async () => {
    const warnings = [];
    mockLogger.warn = (message) => warnings.push(message);

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      maxBytes: 500,
      logger: mockLogger
    }, mockClient);

    for (let index = 0; index < 10; index += 1) {
      await buffer.write([{ type: 'trace-create', id: `test-${index}`, data: 'x'.repeat(100) }]);
    }

    const size = await buffer.size();
    assert.ok(size <= 500, `Buffer size ${size} exceeds max 500 bytes`);
    assert.ok(warnings.some((warning) => warning.includes('dropped')));
  });

  test('start begins background flush worker and stop performs final flush', async () => {
    let flushCalled = false;
    mockClient.ingest = async () => ({ ok: true });

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      flushInterval: 50,
      logger: mockLogger
    }, mockClient);

    const originalFlush = buffer.flush.bind(buffer);
    buffer.flush = async () => {
      flushCalled = true;
      return originalFlush();
    };

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    buffer.start();
    await new Promise((resolve) => setTimeout(resolve, 75));
    await buffer.stop();

    assert.strictEqual(flushCalled, true);
    assert.strictEqual(await buffer.count(), 0);
  });
});
