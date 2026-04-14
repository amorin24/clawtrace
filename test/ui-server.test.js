const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { buildDashboardState, clearBuffer, createUiServer, loadUiConfig } = require('../lib/ui-server.js');
const { launchUi } = require('../bin/install.js');

describe('UI server', () => {
  test('loadUiConfig returns parsed defaults and booleans', () => {
    const config = loadUiConfig({
      LANGFUSE_CAPTURE_INPUT: 'false',
      LANGFUSE_BUFFER_MAX_BYTES: '2048'
    });

    assert.strictEqual(config.captureInput, false);
    assert.strictEqual(config.maxBytes, 2048);
    assert.ok(config.bufferPath);
  });

  test('buildDashboardState summarizes buffer entries', async () => {
    const bufferPath = path.join(os.tmpdir(), `clawtrace-ui-${Date.now()}.ndjson`);
    const entry = {
      timestamp: new Date().toISOString(),
      attempts: 2,
      nextRetryAt: Date.now() + 1000,
      events: [
        {
          id: 'trace-1',
          type: 'trace-create',
          body: { id: 'trace-1', name: 'agent-turn:Ops Bot' }
        },
        {
          type: 'generation-create',
          body: { traceId: 'trace-1', model: 'openai/gpt-4o-mini' }
        }
      ]
    };

    await fs.writeFile(bufferPath, JSON.stringify(entry) + '\n', 'utf8');

    const state = await buildDashboardState({
      env: {
        LANGFUSE_PUBLIC_KEY: 'pk-test',
        LANGFUSE_SECRET_KEY: 'sk-test',
        LANGFUSE_BUFFER_PATH: bufferPath
      },
      packageRoot: path.join(__dirname, '..')
    });

    assert.strictEqual(state.langfuse.configured, true);
    assert.strictEqual(state.buffer.batchCount, 1);
    assert.strictEqual(state.recentBatches[0].traceId, 'trace-1');
    assert.strictEqual(state.recentBatches[0].model, 'openai/gpt-4o-mini');

    await fs.rm(bufferPath, { force: true });
  });

  test('clearBuffer removes the configured file', async () => {
    const bufferPath = path.join(os.tmpdir(), `clawtrace-ui-${Date.now()}-clear.ndjson`);
    await fs.writeFile(bufferPath, '{"events":[]}\n', 'utf8');

    await clearBuffer(bufferPath);

    await assert.rejects(() => fs.stat(bufferPath));
  });

  test('createUiServer serves assets and status endpoints', async () => {
    const bufferPath = path.join(os.tmpdir(), `clawtrace-ui-${Date.now()}-server.ndjson`);
    await fs.writeFile(bufferPath, '', 'utf8');

    const ui = createUiServer({
      env: {
        LANGFUSE_PUBLIC_KEY: 'pk-test',
        LANGFUSE_SECRET_KEY: 'sk-test',
        LANGFUSE_BUFFER_PATH: bufferPath
      },
      packageRoot: path.join(__dirname, '..'),
      logger: { error: () => {} }
    });

    const address = await ui.start({ host: '127.0.0.1', port: 0 });

    const htmlResponse = await fetch(`${address.url}/`);
    const statusResponse = await fetch(`${address.url}/api/status`);

    assert.strictEqual(htmlResponse.ok, true);
    assert.ok((await htmlResponse.text()).includes('clawtrace ui'));
    assert.strictEqual(statusResponse.ok, true);

    const payload = await statusResponse.json();
    assert.strictEqual(payload.package.name, 'clawtrace');

    await ui.stop();
    await fs.rm(bufferPath, { force: true });
  });

  test('launchUi starts the server and reports the address', async () => {
    const stdout = [];
    const result = await launchUi(['--host', '127.0.0.1', '--port', '0'], {
      env: {},
      stdout: { write: (chunk) => stdout.push(chunk) }
    });

    assert.ok(stdout.join('').includes('Dashboard available at http://127.0.0.1:'));
    assert.ok(result.address.url.startsWith('http://127.0.0.1:'));

    await result.server.stop();
  });
});
