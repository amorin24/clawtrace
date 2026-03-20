const LangfuseClient = require('../lib/langfuse-client.js');
const Buffer = require('../lib/buffer.js');
const Tracer = require('../lib/tracer.js');
const SecurityMonitor = require('../lib/security-monitor.js');
const AgentLinker = require('../lib/agent-linker.js');
const CostEstimator = require('../lib/cost-estimator.js');

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
    costTracking: process.env.LANGFUSE_COST_TRACKING !== 'false',
    multiAgentLinking: process.env.LANGFUSE_MULTI_AGENT_LINKING !== 'false',

    logLevel: process.env.LANGFUSE_LOG_LEVEL || 'warn'
  };
}

module.exports = function(api) {
  const config = loadConfig();

  const logger = {
    debug: (msg) => config.logLevel === 'debug' && api.log('debug', msg),
    info: (msg) => ['debug', 'info'].includes(config.logLevel) && api.log('info', msg),
    warn: (msg) => ['debug', 'info', 'warn'].includes(config.logLevel) && api.log('warn', msg),
    error: (msg) => api.log('error', msg)
  };

  config.logger = logger;

  const client = new LangfuseClient(config);

  if (!client.isConfigured()) {
    api.log('warn', '[clawtrace] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled');
    return;
  }

  const buffer = new Buffer(config, client);
  const tracer = new Tracer(config, client, buffer);
  const security = new SecurityMonitor(config);
  const linker = new AgentLinker(config);
  const cost = new CostEstimator();

  buffer.start();

  api.on('before_agent_start', (ctx) => {
    tracer.onTurnStart(ctx, security, linker);
  });

  api.on('tool_call', (ctx) => {
    tracer.onToolCall(ctx, security);
  });

  api.on('tool_result', (ctx) => {
    tracer.onToolResult(ctx);
  });

  api.on('skill_invoke', (ctx) => {
    tracer.onSkillInvoke(ctx);
  });

  api.on('agent_delegate', (ctx) => {
    tracer.onDelegate(ctx, linker);
  });

  api.on('agent_delegate_result', (ctx) => {
    tracer.onDelegateResult(ctx, linker);
  });

  api.on('agent_end', async (ctx) => {
    await tracer.onTurnEnd(ctx, cost, linker);
  });

  process.on('SIGTERM', async () => {
    api.log('info', '[clawtrace] Flushing buffer before shutdown...');
    await buffer.stop();
    linker.stop();
  });

  process.on('SIGINT', async () => {
    api.log('info', '[clawtrace] Flushing buffer before shutdown...');
    await buffer.stop();
    linker.stop();
    process.exit(0);
  });

  api.log('info', `[clawtrace] Langfuse tracing enabled → ${config.baseUrl}`);
};
