const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const path = require('path');
const Buffer = require('../lib/buffer.js');

describe('Buffer', () => {
  const testBufferPath = path.join('/tmp', `clawtrace-test-${Date.now()}.ndjson`);
  let mockClient;
  let mockLogger;

  beforeEach(() => {
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
    try {
      await fs.unlink(testBufferPath);
    } catch (err) {
      // Ignore if file doesn't exist
    }
  });

  test('write creates buffer file with valid NDJSON', async () => {
    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    const events = [{ type: 'trace-create', id: 'test-1' }];
    await buffer.write(events);

    const content = await fs.readFile(testBufferPath, 'utf8');
    const lines = content.trim().split('\n');

    assert.strictEqual(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.ok(parsed.timestamp);
    assert.strictEqual(parsed.attempts, 0);
    assert.deepStrictEqual(parsed.events, events);
  });

  test('write appends multiple entries', async () => {
    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.write([{ type: 'trace-create', id: 'test-2' }]);

    const count = await buffer.count();
    assert.strictEqual(count, 2);
  });

  test('write ignores empty arrays', async () => {
    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    await buffer.write([]);

    const count = await buffer.count();
    assert.strictEqual(count, 0);
  });

  test('flush successfully ingests buffered events and clears file', async () => {
    const ingestedBatches = [];
    mockClient.ingest = async (events) => {
      ingestedBatches.push(events);
      return { ok: true };
    };

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.write([{ type: 'trace-create', id: 'test-2' }]);

    await buffer.flush();

    assert.strictEqual(ingestedBatches.length, 2);
    const count = await buffer.count();
    assert.strictEqual(count, 0);
  });

  test('flush failure increments attempt counter', async () => {
    let callCount = 0;
    mockClient.ingest = async () => {
      callCount++;
      return { ok: false, error: 'server' };
    };

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.flush();

    const lines = await buffer.readLines();
    const entry = JSON.parse(lines[0]);

    assert.strictEqual(entry.attempts, 1);
    assert.strictEqual(callCount, 1);
  });

  test('entries dropped after max retries', async () => {
    const warnings = [];
    mockLogger.warn = (msg) => warnings.push(msg);

    mockClient.ingest = async () => ({ ok: false, error: 'server' });

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      maxRetries: 3,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);

    for (let i = 0; i < 4; i++) {
      await buffer.flush();
    }

    const count = await buffer.count();
    assert.strictEqual(count, 0);
    assert.ok(warnings.some(w => w.includes('Dropping batch after 3 retries')));
  });

  test('auth errors drop batch immediately', async () => {
    const warnings = [];
    mockLogger.warn = (msg) => warnings.push(msg);

    mockClient.ingest = async () => ({ ok: false, error: 'auth' });

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);
    await buffer.flush();

    const count = await buffer.count();
    assert.strictEqual(count, 0);
    assert.ok(warnings.some(w => w.includes('Auth error')));
  });

  test('buffer respects max size and drops oldest entries', async () => {
    const warnings = [];
    mockLogger.warn = (msg) => warnings.push(msg);

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      maxBytes: 500,
      logger: mockLogger
    }, mockClient);

    for (let i = 0; i < 10; i++) {
      const events = [{ type: 'trace-create', id: `test-${i}`, data: 'x'.repeat(100) }];
      await buffer.write(events);
    }

    const size = await buffer.size();
    assert.ok(size <= 500, `Buffer size ${size} exceeds max 500 bytes`);
    assert.ok(warnings.some(w => w.includes('dropped')));
  });

  test('size returns 0 for non-existent file', async () => {
    const buffer = new Buffer({
      bufferPath: '/tmp/non-existent-buffer.ndjson',
      logger: mockLogger
    }, mockClient);

    const size = await buffer.size();
    assert.strictEqual(size, 0);
  });

  test('count returns 0 for non-existent file', async () => {
    const buffer = new Buffer({
      bufferPath: '/tmp/non-existent-buffer.ndjson',
      logger: mockLogger
    }, mockClient);

    const count = await buffer.count();
    assert.strictEqual(count, 0);
  });

  test('start begins background flush worker', async () => {
    let flushCalled = false;
    const buffer = new Buffer({
      bufferPath: testBufferPath,
      flushInterval: 100,
      logger: mockLogger
    }, mockClient);

    const originalFlush = buffer.flush.bind(buffer);
    buffer.flush = async () => {
      flushCalled = true;
      return originalFlush();
    };

    buffer.start();

    await new Promise(resolve => setTimeout(resolve, 150));

    await buffer.stop();
    assert.ok(flushCalled);
  });

  test('stop clears timer and performs final flush', async () => {
    mockClient.ingest = async () => ({ ok: true });

    const buffer = new Buffer({
      bufferPath: testBufferPath,
      logger: mockLogger
    }, mockClient);

    await buffer.write([{ type: 'trace-create', id: 'test-1' }]);

    buffer.start();
    await buffer.stop();

    const count = await buffer.count();
    assert.strictEqual(count, 0);
  });
});
