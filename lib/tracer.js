class Tracer {
  constructor(config, client, buffer) {
    this.config = config;
    this.client = client;
    this.buffer = buffer;
    this.activeTurns = new Map();
    this.logger = config.logger || console;

    this.captureInput = config.captureInput !== false;
    this.captureOutput = config.captureOutput !== false;
    this.maxInputChars = config.maxInputChars || 4000;
    this.maxOutputChars = config.maxOutputChars || 8000;
    this.securityMonitoring = config.securityMonitoring !== false;
    this.costTracking = config.costTracking !== false;
    this.multiAgentLinking = config.multiAgentLinking !== false;
  }

  generateId(prefix = 'trace') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  truncate(text, maxLength, label = '') {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + `\n\n[truncated at ${maxLength} chars]`;
  }

  onTurnStart(ctx, security, linker) {
    const traceId = this.generateId('trace');
    const timestamp = new Date().toISOString();

    const turn = {
      traceId,
      agentId: ctx.agentId || 'default',
      startTime: timestamp,
      input: this.captureInput ? ctx.input : null,
      spans: [],
      metadata: {
        agentName: ctx.agentName || ctx.agentId || 'unknown',
        sessionId: ctx.sessionId || null,
        userId: ctx.userId || null
      }
    };

    if (this.securityMonitoring && security && ctx.input) {
      const detection = security.scanInput(ctx.input);
      if (detection.detected) {
        const securitySpan = security.buildSecuritySpan(detection);
        if (securitySpan) {
          securitySpan.body.traceId = turn.traceId;
          turn.spans.push(securitySpan);
          turn.metadata.securityDetection = {
            severity: detection.severity,
            patterns: detection.patterns.map(p => p.name)
          };
        }
      }
    }

    if (this.multiAgentLinking && linker) {
      const parentTraceId = linker.getParentTrace(turn.agentId);
      if (parentTraceId) {
        turn.parentTraceId = parentTraceId;
        turn.metadata.parentTraceId = parentTraceId;
      }
      linker.setActiveTrace(turn.agentId, traceId);
    }

    this.activeTurns.set(turn.agentId, turn);
  }

  onToolCall(ctx, security) {
    const turn = this.activeTurns.get(ctx.agentId || 'default');
    if (!turn) {
      return;
    }

    const spanId = this.generateId('span-tool');
    const timestamp = new Date().toISOString();

    const span = {
      id: spanId,
      type: 'span-create',
      body: {
        id: spanId,
        traceId: turn.traceId,
        name: `tool:${ctx.toolName || 'unknown'}`,
        startTime: timestamp,
        metadata: {
          toolName: ctx.toolName,
          arguments: ctx.arguments || {}
        },
        level: 'DEFAULT'
      }
    };

    if (this.securityMonitoring && security) {
      const toolCheck = security.scanToolCall(ctx.toolName, ctx.arguments);
      if (toolCheck && toolCheck.destructive) {
        span.body.metadata.destructive = true;
        span.body.metadata.destructiveCategory = toolCheck.category;
        span.body.level = 'WARNING';
        turn.metadata.destructiveToolUsed = true;
      }
    }

    turn.spans.push(span);
  }

  onToolResult(ctx) {
    const turn = this.activeTurns.get(ctx.agentId || 'default');
    if (!turn) {
      return;
    }

    const toolSpan = turn.spans.find(s =>
      s.body && s.body.name === `tool:${ctx.toolName}` && !s.body.endTime
    );

    if (toolSpan) {
      toolSpan.body.endTime = new Date().toISOString();
      toolSpan.body.output = ctx.result ? String(ctx.result).substring(0, 1000) : null;
      if (ctx.error) {
        toolSpan.body.level = 'ERROR';
        toolSpan.body.statusMessage = ctx.error;
      }
    }
  }

  onSkillInvoke(ctx) {
    const turn = this.activeTurns.get(ctx.agentId || 'default');
    if (!turn) {
      return;
    }

    const spanId = this.generateId('span-skill');
    const timestamp = new Date().toISOString();

    const span = {
      id: spanId,
      type: 'span-create',
      body: {
        id: spanId,
        traceId: turn.traceId,
        name: `skill:${ctx.skillName || 'unknown'}`,
        startTime: timestamp,
        endTime: timestamp,
        metadata: {
          skillName: ctx.skillName,
          skillVersion: ctx.skillVersion || null
        },
        level: 'DEFAULT'
      }
    };

    turn.spans.push(span);
  }

  onDelegate(ctx, linker) {
    const turn = this.activeTurns.get(ctx.agentId || 'default');
    if (!turn) {
      return;
    }

    if (this.multiAgentLinking && linker) {
      linker.recordDelegation(ctx.agentId, ctx.targetAgentId, turn.traceId);

      const delegationSpan = linker.buildDelegationSpan(turn.traceId, ctx.targetAgentId);
      if (delegationSpan) {
        turn.spans.push(delegationSpan);
      }
    }
  }

  onDelegateResult(ctx, linker) {
    const turn = this.activeTurns.get(ctx.agentId || 'default');
    if (!turn) {
      return;
    }

    const delegationSpan = turn.spans.find(s =>
      s.body && s.body.name === 'agent-delegation' &&
      s.body.metadata && s.body.metadata.childAgent === ctx.targetAgentId
    );

    if (delegationSpan) {
      delegationSpan.body.endTime = new Date().toISOString();
      delegationSpan.body.output = ctx.result ? String(ctx.result).substring(0, 500) : null;
    }
  }

  async onTurnEnd(ctx, cost, linker) {
    const turn = this.activeTurns.get(ctx.agentId || 'default');
    if (!turn) {
      return;
    }

    const endTime = new Date().toISOString();

    const generationId = this.generateId('generation');
    const generation = {
      id: generationId,
      type: 'generation-create',
      body: {
        id: generationId,
        traceId: turn.traceId,
        name: 'llm-call',
        startTime: turn.startTime,
        endTime: endTime,
        model: ctx.model || 'unknown',
        modelParameters: ctx.modelParameters || {},
        input: this.captureInput ? this.truncate(turn.input, this.maxInputChars) : null,
        output: this.captureOutput ? this.truncate(ctx.output, this.maxOutputChars) : null,
        metadata: {
          agentId: turn.agentId,
          agentName: turn.metadata.agentName
        },
        usage: {
          input: ctx.inputTokens || 0,
          output: ctx.outputTokens || 0,
          total: (ctx.inputTokens || 0) + (ctx.outputTokens || 0)
        },
        level: 'DEFAULT'
      }
    };

    if (this.costTracking && cost && ctx.model && ctx.inputTokens && ctx.outputTokens) {
      const costData = cost.estimate(ctx.model, ctx.inputTokens, ctx.outputTokens);
      if (costData) {
        generation.body.usage.inputCost = costData.inputCost;
        generation.body.usage.outputCost = costData.outputCost;
        generation.body.usage.totalCost = costData.totalCost;
      }
    }

    const trace = {
      id: turn.traceId,
      type: 'trace-create',
      body: {
        id: turn.traceId,
        name: `agent-turn:${turn.metadata.agentName}`,
        timestamp: turn.startTime,
        metadata: turn.metadata,
        userId: ctx.userId || null,
        sessionId: ctx.sessionId || null,
        tags: ctx.tags || []
      }
    };

    if (turn.parentTraceId) {
      trace.body.parentObservationId = turn.parentTraceId;
    }

    const events = [trace, ...turn.spans, generation];

    const result = await this.client.ingest(events);

    if (!result.ok) {
      this.logger.warn(`[clawtrace] Ingestion failed (${result.error}) — writing to buffer`);
      await this.buffer.write(events);
    }

    if (this.multiAgentLinking && linker) {
      linker.clearTrace(turn.agentId);
    }

    this.activeTurns.delete(turn.agentId);
  }
}

module.exports = Tracer;
