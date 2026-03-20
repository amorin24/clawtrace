const LangfuseClient = require('../lib/langfuse-client.js');
const Buffer = require('../lib/buffer.js');
const SecurityMonitor = require('../lib/security-monitor.js');

function loadConfig() {
  return {
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',

    bufferPath: process.env.LANGFUSE_BUFFER_PATH || '/tmp/clawtrace-buffer.ndjson',
    maxBytes: parseInt(process.env.LANGFUSE_BUFFER_MAX_BYTES || '10485760', 10),
    flushInterval: parseInt(process.env.LANGFUSE_FLUSH_INTERVAL_MS || '30000', 10),
    maxRetries: parseInt(process.env.LANGFUSE_FLUSH_MAX_RETRIES || '5', 10),
    backoffBase: parseInt(process.env.LANGFUSE_FLUSH_BACKOFF_BASE_MS || '1000', 10),

    captureInput: process.env.LANGFUSE_CAPTURE_INPUT !== 'false',
    captureOutput: process.env.LANGFUSE_CAPTURE_OUTPUT !== 'false',
    maxInputChars: parseInt(process.env.LANGFUSE_MAX_INPUT_CHARS || '4000', 10),
    maxOutputChars: parseInt(process.env.LANGFUSE_MAX_OUTPUT_CHARS || '8000', 10),

    securityMonitoring: process.env.LANGFUSE_SECURITY_MONITOR !== 'false',

    logLevel: process.env.LANGFUSE_LOG_LEVEL || 'warn'
  };
}

function truncate(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + `\n\n[truncated at ${maxLength} chars]`;
}

function generateId(prefix = 'trace') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

module.exports = function register(api) {
  const config = loadConfig();

  const logger = {
    debug: (msg) => config.logLevel === 'debug' && api.logger?.info?.(msg),
    info: (msg) => ['debug', 'info'].includes(config.logLevel) && api.logger?.info?.(msg),
    warn: (msg) => ['debug', 'info', 'warn'].includes(config.logLevel) && api.logger?.warn?.(msg),
    error: (msg) => api.logger?.warn?.(msg) || console.error(msg)
  };

  config.logger = logger;

  const client = new LangfuseClient(config);

  if (!client.isConfigured()) {
    api.logger?.warn?.('[clawtrace] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled');
    return;
  }

  const buffer = new Buffer(config, client);
  const security = new SecurityMonitor(config);

  buffer.start();

  const pendingTraces = new Map();

  api.on('message_received', async (event, ctx) => {
    try {
      const traceId = generateId('trace');
      const timestamp = new Date().toISOString();
      const conversationId = ctx.conversationId || 'default';

      const trace = {
        traceId,
        conversationId,
        channelId: ctx.channelId,
        startTime: timestamp,
        input: config.captureInput ? event.content : null,
        metadata: event.metadata || {},
        spans: []
      };

      if (config.securityMonitoring && security && event.content) {
        const detection = security.scanInput(event.content);
        if (detection.detected) {
          const securitySpan = security.buildSecuritySpan(detection);
          if (securitySpan) {
            securitySpan.body.traceId = traceId;
            trace.spans.push(securitySpan);
            trace.securityDetection = {
              severity: detection.severity,
              patterns: detection.patterns.map(p => p.name)
            };
          }
        }
      }

      pendingTraces.set(conversationId, trace);
    } catch (err) {
      logger.error(`[clawtrace] Error in message_received handler: ${err.message}`);
    }
  });

  api.on('message_sending', async (event, ctx) => {
    try {
      const conversationId = ctx.conversationId || 'default';
      const pending = pendingTraces.get(conversationId);

      if (!pending) {
        return;
      }

      pendingTraces.delete(conversationId);

      const endTime = new Date().toISOString();
      const startTimeMs = new Date(pending.startTime).getTime();
      const endTimeMs = new Date(endTime).getTime();
      const durationMs = endTimeMs - startTimeMs;

      const generationId = generateId('generation');
      const generation = {
        id: generationId,
        type: 'generation-create',
        body: {
          id: generationId,
          traceId: pending.traceId,
          name: 'agent-response',
          startTime: pending.startTime,
          endTime: endTime,
          input: config.captureInput ? truncate(pending.input, config.maxInputChars) : null,
          output: config.captureOutput ? truncate(event.content, config.maxOutputChars) : null,
          metadata: {
            conversationId: pending.conversationId,
            channelId: pending.channelId,
            durationMs,
            securityDetection: pending.securityDetection || null
          },
          level: 'DEFAULT'
        }
      };

      const traceEvent = {
        id: pending.traceId,
        type: 'trace-create',
        body: {
          id: pending.traceId,
          name: `conversation:${pending.conversationId}`,
          timestamp: pending.startTime,
          metadata: {
            conversationId: pending.conversationId,
            channelId: pending.channelId,
            durationMs,
            ...pending.metadata
          },
          sessionId: pending.conversationId,
          tags: ['openclaw', 'v2026.3.13', 'basic-mode']
        }
      };

      const events = [traceEvent, ...pending.spans, generation];

      const result = await client.ingest(events);

      if (!result.ok) {
        logger.warn(`[clawtrace] Ingestion failed (${result.error}) — writing to buffer`);
        await buffer.write(events);
      }
    } catch (err) {
      logger.error(`[clawtrace] Error in message_sending handler: ${err.message}`);
    }
  });

  process.on('SIGTERM', async () => {
    try {
      (api.logger?.warn || console.warn)('[clawtrace] Flushing buffer before shutdown...');
      await buffer.stop();
    } catch (err) {
      console.error(`[clawtrace] Error during SIGTERM cleanup: ${err.message}`);
    }
  });

  process.on('SIGINT', async () => {
    try {
      (api.logger?.warn || console.warn)('[clawtrace] Flushing buffer before shutdown...');
      await buffer.stop();
      process.exit(0);
    } catch (err) {
      console.error(`[clawtrace] Error during SIGINT cleanup: ${err.message}`);
      process.exit(1);
    }
  });

  api.logger?.info?.(`[clawtrace] Langfuse tracing enabled → ${config.baseUrl}`);
  api.logger?.warn?.('[clawtrace] Running in basic mode — input/output tracing only. Tool call and skill tracing requires future OpenClaw plugin API expansion.');
};
