const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const AgentLinker = require('../lib/agent-linker.js');

describe('AgentLinker', () => {
  let linker;

  beforeEach(() => {
    linker = new AgentLinker({ cleanupInterval: 1000000 });
  });

  afterEach(() => {
    if (linker) {
      linker.stop();
    }
  });

  test('setActiveTrace registers trace for agent', () => {
    linker.setActiveTrace('agent-1', 'trace-123');

    assert.ok(linker.activeTraces.has('agent-1'));
    assert.strictEqual(linker.activeTraces.get('agent-1').traceId, 'trace-123');
  });

  test('setActiveTrace ignores null values', () => {
    linker.setActiveTrace(null, 'trace-123');
    linker.setActiveTrace('agent-1', null);

    assert.strictEqual(linker.activeTraces.size, 0);
  });

  test('getParentTrace returns null for unknown agent', () => {
    const parentTrace = linker.getParentTrace('unknown-agent');

    assert.strictEqual(parentTrace, null);
  });

  test('recordDelegation links parent and child traces', () => {
    linker.recordDelegation('optimus-prime', 'bumblebee', 'trace-parent-123');

    const parentTrace = linker.getParentTrace('bumblebee');
    assert.strictEqual(parentTrace, 'trace-parent-123');
  });

  test('recordDelegation stores parent agent ID', () => {
    linker.recordDelegation('optimus-prime', 'bumblebee', 'trace-parent-123');

    const delegation = linker.delegations.get('bumblebee');
    assert.ok(delegation);
    assert.strictEqual(delegation.parentAgentId, 'optimus-prime');
    assert.strictEqual(delegation.parentTraceId, 'trace-parent-123');
  });

  test('recordDelegation ignores null values', () => {
    linker.recordDelegation(null, 'bumblebee', 'trace-123');
    linker.recordDelegation('optimus', null, 'trace-123');
    linker.recordDelegation('optimus', 'bumblebee', null);

    assert.strictEqual(linker.delegations.size, 0);
  });

  test('clearTrace removes both active trace and delegation', () => {
    linker.setActiveTrace('bumblebee', 'trace-456');
    linker.recordDelegation('optimus-prime', 'bumblebee', 'trace-parent-123');

    linker.clearTrace('bumblebee');

    assert.strictEqual(linker.activeTraces.has('bumblebee'), false);
    assert.strictEqual(linker.delegations.has('bumblebee'), false);
  });

  test('clearTrace handles unknown agent gracefully', () => {
    linker.clearTrace('unknown-agent');

    assert.strictEqual(linker.activeTraces.size, 0);
  });

  test('buildDelegationSpan creates span object', () => {
    const span = linker.buildDelegationSpan('trace-parent-123', 'bumblebee');

    assert.ok(span);
    assert.strictEqual(span.type, 'span-create');
    assert.strictEqual(span.body.name, 'agent-delegation');
    assert.strictEqual(span.body.traceId, 'trace-parent-123');
    assert.strictEqual(span.body.metadata.childAgent, 'bumblebee');
  });

  test('buildDelegationSpan returns null for missing parameters', () => {
    assert.strictEqual(linker.buildDelegationSpan(null, 'bumblebee'), null);
    assert.strictEqual(linker.buildDelegationSpan('trace-123', null), null);
  });

  test('stale traces cleaned up after TTL', async () => {
    const shortTTL = new AgentLinker({ ttl: 100, cleanupInterval: 1000000 });

    shortTTL.setActiveTrace('agent-1', 'trace-123');
    shortTTL.recordDelegation('agent-1', 'agent-2', 'trace-123');

    await new Promise(resolve => setTimeout(resolve, 150));

    shortTTL.cleanup();

    assert.strictEqual(shortTTL.activeTraces.size, 0);
    assert.strictEqual(shortTTL.delegations.size, 0);

    shortTTL.stop();
  });

  test('getParentTrace returns null for expired delegation', async () => {
    const shortTTL = new AgentLinker({ ttl: 100, cleanupInterval: 1000000 });

    shortTTL.recordDelegation('optimus-prime', 'bumblebee', 'trace-parent-123');

    await new Promise(resolve => setTimeout(resolve, 150));

    const parentTrace = shortTTL.getParentTrace('bumblebee');
    assert.strictEqual(parentTrace, null);

    shortTTL.stop();
  });

  test('non-expired traces are not cleaned up', async () => {
    const longTTL = new AgentLinker({ ttl: 10000, cleanupInterval: 1000000 });

    longTTL.setActiveTrace('agent-1', 'trace-123');
    longTTL.recordDelegation('agent-1', 'agent-2', 'trace-123');

    await new Promise(resolve => setTimeout(resolve, 50));

    longTTL.cleanup();

    assert.strictEqual(longTTL.activeTraces.size, 1);
    assert.strictEqual(longTTL.delegations.size, 1);

    longTTL.stop();
  });

  test('disabled linker does not store traces', () => {
    const disabled = new AgentLinker({ enabled: false });

    disabled.setActiveTrace('agent-1', 'trace-123');
    disabled.recordDelegation('agent-1', 'agent-2', 'trace-123');

    assert.strictEqual(disabled.activeTraces.size, 0);
    assert.strictEqual(disabled.delegations.size, 0);

    disabled.stop();
  });

  test('multiple agents can have active traces', () => {
    linker.setActiveTrace('optimus-prime', 'trace-1');
    linker.setActiveTrace('bumblebee', 'trace-2');
    linker.setActiveTrace('ironhide', 'trace-3');

    assert.strictEqual(linker.activeTraces.size, 3);
    assert.strictEqual(linker.activeTraces.get('optimus-prime').traceId, 'trace-1');
    assert.strictEqual(linker.activeTraces.get('bumblebee').traceId, 'trace-2');
    assert.strictEqual(linker.activeTraces.get('ironhide').traceId, 'trace-3');
  });

  test('delegation chain can be tracked', () => {
    linker.recordDelegation('optimus-prime', 'bumblebee', 'trace-1');
    linker.recordDelegation('bumblebee', 'ratchet', 'trace-2');

    assert.strictEqual(linker.getParentTrace('bumblebee'), 'trace-1');
    assert.strictEqual(linker.getParentTrace('ratchet'), 'trace-2');
  });

  test('startCleanup initializes timer', () => {
    const linker2 = new AgentLinker({ cleanupInterval: 100 });
    assert.ok(linker2.cleanupTimer);
    linker2.stop();
  });

  test('stop clears cleanup timer', () => {
    const linker2 = new AgentLinker({ cleanupInterval: 100 });
    linker2.stop();
    assert.strictEqual(linker2.cleanupTimer, null);
  });
});
