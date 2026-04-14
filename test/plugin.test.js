const { describe, test } = require('node:test');
const assert = require('node:assert');
const register = require('../plugin/index.js');

function createApi() {
  const handlers = new Map();
  const logs = [];

  return {
    handlers,
    logs,
    logger: {
      info: (message) => logs.push({ level: 'info', message }),
      warn: (message) => logs.push({ level: 'warn', message }),
      error: (message) => logs.push({ level: 'error', message })
    },
    on(eventName, handler) {
      handlers.set(eventName, handler);
    }
  };
}

function createConfiguredEnv(overrides = {}) {
  return {
    LANGFUSE_PUBLIC_KEY: 'pk-test',
    LANGFUSE_SECRET_KEY: 'sk-test',
    LANGFUSE_LOG_LEVEL: 'debug',
    ...overrides
  };
}

describe('Plugin runtime', () => {
  test('register returns null when keys are missing', () => {
    const api = createApi();
    const runtime = register(api, { env: {}, attachProcessHandlers: false });

    assert.strictEqual(runtime, null);
    assert.ok(api.logs.some((entry) => entry.message.includes('tracing disabled')));
  });

  test('register wires a locally runnable plugin and ingests turn traces', async () => {
    const api = createApi();
    const ingested = [];
    let bufferStarted = false;

    const runtime = register(api, {
      env: createConfiguredEnv(),
      attachProcessHandlers: false,
      factories: {
        createClient: (config) => ({
          isConfigured: () => true,
          ingest: async (events) => {
            ingested.push(events);
            return { ok: true, status: 200 };
          },
          sdkVersion: config.sdkVersion
        }),
        createBuffer: () => ({
          start: () => { bufferStarted = true; },
          stop: async () => {},
          write: async () => {}
        })
      }
    });

    await api.handlers.get('message_received')({
      id: 'msg-1',
      content: 'Hello there',
      metadata: { platform: 'telegram' }
    }, {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      agentName: 'Trace Bot',
      platform: 'telegram'
    });

    await api.handlers.get('agent_end')({
      id: 'msg-1',
      output: 'General Kenobi',
      model: 'openai/gpt-4o-mini',
      usage: { inputTokens: 1000, outputTokens: 1000 }
    }, {
      channelId: 'channel-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      platform: 'telegram'
    });

    assert.strictEqual(bufferStarted, true);
    assert.strictEqual(ingested.length, 1);

    const events = ingested[0];
    const trace = events.find((event) => event.type === 'trace-create');
    const generation = events.find((event) => event.type === 'generation-create');

    assert.ok(trace);
    assert.ok(generation);
    assert.strictEqual(trace.body.metadata.channelId, 'channel-1');
    assert.strictEqual(trace.body.sessionId, 'conversation-1');
    assert.ok(trace.body.tags.includes('openclaw'));
    assert.ok(trace.body.tags.includes('clawtrace'));
    assert.ok(trace.body.tags.includes('platform:telegram'));
    assert.strictEqual(generation.body.output, 'General Kenobi');
    assert.strictEqual(generation.body.usage.input, 1000);
    assert.strictEqual(generation.body.usage.output, 1000);
    assert.ok(generation.body.usage.totalCost > 0);

    await runtime.stop();
  });

  test('same-channel turns are queued instead of overwritten', async () => {
    const api = createApi();
    const ingested = [];

    const runtime = register(api, {
      env: createConfiguredEnv(),
      attachProcessHandlers: false,
      factories: {
        createClient: () => ({
          isConfigured: () => true,
          ingest: async (events) => {
            ingested.push(events);
            return { ok: true };
          }
        }),
        createBuffer: () => ({
          start: () => {},
          stop: async () => {},
          write: async () => {}
        })
      }
    });

    await api.handlers.get('message_received')({ content: 'first' }, { channelId: 'same-channel' });
    await api.handlers.get('message_received')({ content: 'second' }, { channelId: 'same-channel' });

    await api.handlers.get('agent_end')({ output: 'first-out' }, { channelId: 'same-channel' });
    await api.handlers.get('agent_end')({ output: 'second-out' }, { channelId: 'same-channel' });

    assert.strictEqual(ingested.length, 2);

    const firstGeneration = ingested[0].find((event) => event.type === 'generation-create');
    const secondGeneration = ingested[1].find((event) => event.type === 'generation-create');

    assert.strictEqual(firstGeneration.body.input, 'first');
    assert.strictEqual(firstGeneration.body.output, 'first-out');
    assert.strictEqual(secondGeneration.body.input, 'second');
    assert.strictEqual(secondGeneration.body.output, 'second-out');

    await runtime.stop();
  });

  test('retryable ingest failures are buffered and client errors are not', async () => {
    const api = createApi();
    const bufferedEvents = [];
    let mode = 'server';

    const runtime = register(api, {
      env: createConfiguredEnv(),
      attachProcessHandlers: false,
      factories: {
        createClient: () => ({
          isConfigured: () => true,
          ingest: async () => ({ ok: false, error: mode })
        }),
        createBuffer: () => ({
          start: () => {},
          stop: async () => {},
          write: async (events) => bufferedEvents.push(events)
        })
      }
    });

    await api.handlers.get('message_received')({ id: 'turn-1', content: 'buffer me' }, { channelId: 'buffer-channel' });
    await api.handlers.get('agent_end')({ id: 'turn-1', output: 'done' }, { channelId: 'buffer-channel' });

    mode = 'client';
    await api.handlers.get('message_received')({ id: 'turn-2', content: 'drop me' }, { channelId: 'buffer-channel' });
    await api.handlers.get('agent_end')({ id: 'turn-2', output: 'done' }, { channelId: 'buffer-channel' });

    assert.strictEqual(bufferedEvents.length, 1);

    await runtime.stop();
  });

  test('private helpers expose stable config parsing', () => {
    const config = register._private.loadConfig(createConfiguredEnv({
      LANGFUSE_MULTI_AGENT_LINKING: 'false',
      LANGFUSE_COST_TRACKING: 'false',
      LANGFUSE_BUFFER_MAX_BYTES: '42'
    }));

    assert.strictEqual(config.multiAgentLinking, false);
    assert.strictEqual(config.costTracking, false);
    assert.strictEqual(config.maxBytes, 42);
    assert.ok(config.sdkVersion);
  });
});
