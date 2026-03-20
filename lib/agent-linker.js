class AgentLinker {
  constructor(config) {
    this.activeTraces = new Map();
    this.delegations = new Map();
    this.ttl = config?.ttl || 3600000; // 1 hour default
    this.cleanupInterval = config?.cleanupInterval || 300000; // 5 minutes
    this.enabled = config?.enabled !== false;

    if (this.enabled) {
      this.startCleanup();
    }
  }

  setActiveTrace(agentId, traceId) {
    if (!this.enabled || !agentId || !traceId) {
      return;
    }

    this.activeTraces.set(agentId, {
      traceId,
      timestamp: Date.now()
    });
  }

  getParentTrace(agentId) {
    if (!this.enabled || !agentId) {
      return null;
    }

    const delegation = this.delegations.get(agentId);
    if (!delegation) {
      return null;
    }

    if (Date.now() - delegation.timestamp > this.ttl) {
      this.delegations.delete(agentId);
      return null;
    }

    return delegation.parentTraceId;
  }

  recordDelegation(parentAgentId, childAgentId, parentTraceId) {
    if (!this.enabled || !parentAgentId || !childAgentId || !parentTraceId) {
      return;
    }

    this.delegations.set(childAgentId, {
      parentAgentId,
      parentTraceId,
      timestamp: Date.now()
    });
  }

  clearTrace(agentId) {
    if (!this.enabled || !agentId) {
      return;
    }

    this.activeTraces.delete(agentId);
    this.delegations.delete(agentId);
  }

  buildDelegationSpan(parentTraceId, childAgentId) {
    if (!parentTraceId || !childAgentId) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const spanId = `delegation-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    return {
      id: spanId,
      type: 'span-create',
      body: {
        id: spanId,
        traceId: parentTraceId,
        name: 'agent-delegation',
        startTime: timestamp,
        metadata: {
          childAgent: childAgentId,
          delegationType: 'specialist'
        },
        level: 'DEFAULT',
        statusMessage: `Delegated to ${childAgentId}`
      }
    };
  }

  startCleanup() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    this.cleanupTimer.unref();
  }

  cleanup() {
    const now = Date.now();

    for (const [agentId, trace] of this.activeTraces.entries()) {
      if (now - trace.timestamp > this.ttl) {
        this.activeTraces.delete(agentId);
      }
    }

    for (const [agentId, delegation] of this.delegations.entries()) {
      if (now - delegation.timestamp > this.ttl) {
        this.delegations.delete(agentId);
      }
    }
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

module.exports = AgentLinker;
