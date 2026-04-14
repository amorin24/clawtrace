const fs = require('fs');
const path = require('path');

function resolveLibDir() {
  const deployedLibDir = path.join(__dirname, 'lib');
  if (fs.existsSync(deployedLibDir)) {
    return deployedLibDir;
  }

  return path.join(__dirname, '..', 'lib');
}

function resolveLibModule(moduleName) {
  return require(path.join(resolveLibDir(), moduleName));
}

const LangfuseClient = resolveLibModule('langfuse-client.js');
const TraceBuffer = resolveLibModule('buffer.js');
const SecurityMonitor = resolveLibModule('security-monitor.js');
const CostEstimator = resolveLibModule('cost-estimator.js');
const AgentLinker = resolveLibModule('agent-linker.js');
const Tracer = resolveLibModule('tracer.js');
const { defaultBufferPath, generateId } = resolveLibModule('utils.js');

function loadManifest() {
  const manifestPath = path.join(__dirname, 'openclaw.plugin.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = true) {
  if (value === undefined) {
    return fallback;
  }

  return value !== 'false';
}

function loadConfig(env = process.env, manifest = loadManifest()) {
  return {
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    sdkVersion: manifest.version,
    pluginVersion: manifest.version,

    bufferPath: env.LANGFUSE_BUFFER_PATH || defaultBufferPath(),
    maxBytes: parseInteger(env.LANGFUSE_BUFFER_MAX_BYTES, 10485760),
    flushInterval: parseInteger(env.LANGFUSE_FLUSH_INTERVAL_MS, 30000),
    maxRetries: parseInteger(env.LANGFUSE_FLUSH_MAX_RETRIES, 5),
    backoffBase: parseInteger(env.LANGFUSE_FLUSH_BACKOFF_BASE_MS, 1000),
    maxBackoffMs: parseInteger(env.LANGFUSE_FLUSH_MAX_BACKOFF_MS, 300000),

    captureInput: parseBoolean(env.LANGFUSE_CAPTURE_INPUT, true),
    captureOutput: parseBoolean(env.LANGFUSE_CAPTURE_OUTPUT, true),
    maxInputChars: parseInteger(env.LANGFUSE_MAX_INPUT_CHARS, 4000),
    maxOutputChars: parseInteger(env.LANGFUSE_MAX_OUTPUT_CHARS, 8000),

    securityMonitoring: parseBoolean(env.LANGFUSE_SECURITY_MONITOR, true),
    costTracking: parseBoolean(env.LANGFUSE_COST_TRACKING, true),
    multiAgentLinking: parseBoolean(env.LANGFUSE_MULTI_AGENT_LINKING, true),

    traceTtlMs: parseInteger(env.LANGFUSE_TRACE_TTL_MS, 300000),
    cleanupIntervalMs: parseInteger(env.LANGFUSE_TRACE_CLEANUP_INTERVAL_MS, 60000),

    logLevel: env.LANGFUSE_LOG_LEVEL || 'warn'
  };
}

function buildLogger(apiLogger, logLevel) {
  return {
    debug: (message) => logLevel === 'debug' && apiLogger?.info?.(message),
    info: (message) => ['debug', 'info'].includes(logLevel) && apiLogger?.info?.(message),
    warn: (message) => ['debug', 'info', 'warn'].includes(logLevel) && apiLogger?.warn?.(message),
    error: (message) => apiLogger?.error?.(message) || apiLogger?.warn?.(message) || console.error(message)
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function extractInput(event) {
  return firstDefined(event?.content, event?.input, event?.message, event?.text, null);
}

function extractOutput(event) {
  return firstDefined(event?.output, event?.content, event?.response, event?.message, event?.text, null);
}

function extractUsage(event) {
  const usage = event?.usage || event?.tokens || {};
  const inputTokens = firstDefined(
    usage.input,
    usage.inputTokens,
    usage.promptTokens,
    usage.prompt_tokens,
    event?.inputTokens
  );
  const outputTokens = firstDefined(
    usage.output,
    usage.outputTokens,
    usage.completionTokens,
    usage.completion_tokens,
    event?.outputTokens
  );

  return {
    inputTokens,
    outputTokens
  };
}

function detectPlatform(event, ctx) {
  return firstDefined(
    ctx?.platform,
    ctx?.channelType,
    event?.platform,
    event?.channelType,
    event?.metadata?.platform,
    null
  );
}

function buildTags(config, event, ctx) {
  const tags = ['openclaw', 'clawtrace', 'basic-mode', `plugin:${config.pluginVersion}`];
  const platform = detectPlatform(event, ctx);
  if (platform) {
    tags.push(`platform:${platform}`);
  }

  return tags;
}

function resolveAgentName(event, ctx) {
  return firstDefined(
    ctx?.agentName,
    ctx?.agentId,
    event?.agentName,
    event?.agentId,
    'openclaw-agent'
  );
}

function resolveSessionId(event, ctx) {
  return firstDefined(
    ctx?.sessionId,
    ctx?.conversationId,
    event?.sessionId,
    event?.conversationId,
    ctx?.channelId,
    event?.channelId,
    'default'
  );
}

function resolveChannelId(event, ctx) {
  return firstDefined(ctx?.channelId, event?.channelId, resolveSessionId(event, ctx), 'default');
}

function resolveUserId(event, ctx) {
  return firstDefined(ctx?.userId, event?.userId, event?.from?.id, null);
}

function resolveEventIdentifier(event, ctx) {
  return firstDefined(
    ctx?.turnId,
    ctx?.messageId,
    ctx?.requestId,
    ctx?.eventId,
    event?.turnId,
    event?.messageId,
    event?.requestId,
    event?.id,
    event?.updateId,
    null
  );
}

function createPendingTurnStore(config, tracer, logger) {
  const pendingById = new Map();
  const channelQueues = new Map();

  function ensureQueue(channelId) {
    if (!channelQueues.has(channelId)) {
      channelQueues.set(channelId, []);
    }

    return channelQueues.get(channelId);
  }

  function removeFromQueue(channelId, turnId) {
    const queue = channelQueues.get(channelId);
    if (!queue) {
      return;
    }

    const nextQueue = queue.filter((entry) => entry.turnId !== turnId);
    if (nextQueue.length === 0) {
      channelQueues.delete(channelId);
    } else {
      channelQueues.set(channelId, nextQueue);
    }
  }

  function remove(turnId, options = {}) {
    const entry = pendingById.get(turnId);
    if (!entry) {
      return null;
    }

    pendingById.delete(turnId);
    removeFromQueue(entry.channelId, turnId);

    if (options.clearTracer !== false) {
      tracer.clearTurn(turnId);
    }

    return entry;
  }

  function cleanup() {
    const now = Date.now();
    const staleIds = [];

    for (const [turnId, entry] of pendingById.entries()) {
      if (now - entry.createdAt > config.traceTtlMs) {
        staleIds.push(turnId);
      }
    }

    for (const turnId of staleIds) {
      const entry = remove(turnId);
      if (entry) {
        logger.warn(`[clawtrace] Cleaned up stale pending trace for channel ${entry.channelId}`);
      }
    }

    tracer.cleanupStaleTurns(config.traceTtlMs);
  }

  return {
    register(event, ctx) {
      const channelId = resolveChannelId(event, ctx);
      const explicitId = resolveEventIdentifier(event, ctx);
      const turnId = explicitId ? `turn-${explicitId}` : generateId('turn');
      const entry = {
        turnId,
        channelId,
        createdAt: Date.now(),
        explicitId
      };

      pendingById.set(turnId, entry);
      ensureQueue(channelId).push(entry);
      return entry;
    },

    resolve(event, ctx) {
      const channelId = resolveChannelId(event, ctx);
      const explicitId = resolveEventIdentifier(event, ctx);

      if (explicitId) {
        const explicitTurnId = `turn-${explicitId}`;
        const entry = pendingById.get(explicitTurnId);
        if (entry) {
          pendingById.delete(explicitTurnId);
          removeFromQueue(entry.channelId, explicitTurnId);
          return entry;
        }
      }

      const queue = channelQueues.get(channelId) || [];
      const entry = queue.shift();
      if (!entry) {
        return null;
      }

      pendingById.delete(entry.turnId);
      if (queue.length === 0) {
        channelQueues.delete(channelId);
      } else {
        channelQueues.set(channelId, queue);
      }

      return entry;
    },

    cleanup,

    stop() {
      for (const turnId of pendingById.keys()) {
        tracer.clearTurn(turnId);
      }

      pendingById.clear();
      channelQueues.clear();
    },

    stats() {
      return {
        pendingCount: pendingById.size,
        channelCount: channelQueues.size
      };
    }
  };
}

function registerProcessHandlers(runtime, api, processRef = process) {
  const flushOnSignal = async (signalName) => {
    try {
      runtime.logger.info(`[clawtrace] Received ${signalName}, flushing buffer before shutdown`);
      runtime.cleanupTimer && clearInterval(runtime.cleanupTimer);
      await runtime.traceBuffer.stop();
      runtime.pendingTurnStore.stop();
    } catch (err) {
      (api.logger?.error || console.error)(`[clawtrace] Error during ${signalName} cleanup: ${err.message}`);
    }
  };

  const onSigterm = () => {
    flushOnSignal('SIGTERM').catch(() => {});
  };
  const onSigint = () => {
    flushOnSignal('SIGINT').catch(() => {});
  };

  processRef.on('SIGTERM', onSigterm);
  processRef.on('SIGINT', onSigint);

  runtime.detachProcessHandlers = () => {
    processRef.off('SIGTERM', onSigterm);
    processRef.off('SIGINT', onSigint);
  };
}

function register(api, options = {}) {
  const manifest = options.manifest || loadManifest();
  const config = loadConfig(options.env || process.env, manifest);
  const logger = buildLogger(api.logger, config.logLevel);
  config.logger = logger;

  const factories = options.factories || {};
  const client = factories.createClient ? factories.createClient(config) : new LangfuseClient(config);

  if (!client.isConfigured()) {
    api.logger?.warn?.('[clawtrace] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set - tracing disabled');
    return null;
  }

  const traceBuffer = factories.createBuffer ? factories.createBuffer(config, client) : new TraceBuffer(config, client);
  const security = factories.createSecurity ? factories.createSecurity(config) : new SecurityMonitor({ enabled: config.securityMonitoring, logger });
  const costEstimator = factories.createCostEstimator ? factories.createCostEstimator(config) : new CostEstimator();
  const agentLinker = factories.createAgentLinker ? factories.createAgentLinker(config) : new AgentLinker({
    enabled: config.multiAgentLinking,
    ttl: config.traceTtlMs,
    cleanupInterval: config.cleanupIntervalMs
  });
  const tracer = factories.createTracer ? factories.createTracer(config, client, traceBuffer) : new Tracer(config, client, traceBuffer);

  traceBuffer.start();

  const pendingTurnStore = createPendingTurnStore(config, tracer, logger);
  const cleanupTimer = setInterval(() => {
    pendingTurnStore.cleanup();
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  const runtime = {
    agentLinker,
    cleanupTimer,
    client,
    config,
    costEstimator,
    logger,
    pendingTurnStore,
    security,
    traceBuffer,
    tracer,
    stop: async () => {
      clearInterval(cleanupTimer);
      pendingTurnStore.stop();
      agentLinker.stop?.();
      await traceBuffer.stop();
      runtime.detachProcessHandlers?.();
    }
  };

  api.on('message_received', async (event, ctx) => {
    try {
      const pending = pendingTurnStore.register(event, ctx);
      tracer.onTurnStart({
        agentId: pending.turnId,
        agentName: resolveAgentName(event, ctx),
        sessionId: resolveSessionId(event, ctx),
        userId: resolveUserId(event, ctx),
        input: extractInput(event),
        metadata: {
          channelId: pending.channelId,
          conversationId: firstDefined(ctx?.conversationId, event?.conversationId, null),
          platform: detectPlatform(event, ctx)
        }
      }, security, agentLinker);
    } catch (err) {
      logger.error(`[clawtrace] Error in message_received handler: ${err.message}`);
    }
  });

  api.on('agent_end', async (event, ctx) => {
    try {
      const pending = pendingTurnStore.resolve(event, ctx);
      if (!pending) {
        logger.warn(`[clawtrace] No pending trace found for channel ${resolveChannelId(event, ctx)}`);
        return;
      }

      const usage = extractUsage(event);
      await tracer.onTurnEnd({
        agentId: pending.turnId,
        output: extractOutput(event),
        model: firstDefined(event?.model, event?.metadata?.model, null),
        modelParameters: firstDefined(event?.modelParameters, event?.metadata?.modelParameters, {}),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        sessionId: resolveSessionId(event, ctx),
        userId: resolveUserId(event, ctx),
        tags: buildTags(config, event, ctx)
      }, costEstimator, agentLinker);
    } catch (err) {
      logger.error(`[clawtrace] Error in agent_end handler: ${err.message}`);
    }
  });

  if (options.attachProcessHandlers !== false) {
    registerProcessHandlers(runtime, api, options.processRef || process);
  }

  api.logger?.info?.(`[clawtrace] Langfuse tracing enabled -> ${config.baseUrl}`);
  api.logger?.warn?.('[clawtrace] Running in basic mode - input/output tracing only. Tool and skill tracing will activate when OpenClaw exposes those hooks.');

  return runtime;
}

module.exports = register;
module.exports._private = {
  buildLogger,
  buildTags,
  createPendingTurnStore,
  detectPlatform,
  extractInput,
  extractOutput,
  extractUsage,
  loadConfig,
  loadManifest,
  resolveAgentName,
  resolveChannelId,
  resolveEventIdentifier,
  resolveLibDir,
  resolveSessionId,
  resolveUserId
};
