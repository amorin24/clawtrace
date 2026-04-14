const fs = require('fs');
const fsp = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');

const { defaultBufferPath } = require('./utils.js');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function loadUiConfig(env = process.env) {
  return {
    publicKey: env.LANGFUSE_PUBLIC_KEY || null,
    secretKey: env.LANGFUSE_SECRET_KEY || null,
    baseUrl: env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com',
    captureInput: parseBoolean(env.LANGFUSE_CAPTURE_INPUT, true),
    captureOutput: parseBoolean(env.LANGFUSE_CAPTURE_OUTPUT, true),
    securityMonitoring: parseBoolean(env.LANGFUSE_SECURITY_MONITOR, true),
    costTracking: parseBoolean(env.LANGFUSE_COST_TRACKING, true),
    multiAgentLinking: parseBoolean(env.LANGFUSE_MULTI_AGENT_LINKING, true),
    maxInputChars: parseInteger(env.LANGFUSE_MAX_INPUT_CHARS, 4000),
    maxOutputChars: parseInteger(env.LANGFUSE_MAX_OUTPUT_CHARS, 8000),
    flushInterval: parseInteger(env.LANGFUSE_FLUSH_INTERVAL_MS, 30000),
    maxRetries: parseInteger(env.LANGFUSE_FLUSH_MAX_RETRIES, 5),
    backoffBase: parseInteger(env.LANGFUSE_FLUSH_BACKOFF_BASE_MS, 1000),
    maxBackoffMs: parseInteger(env.LANGFUSE_FLUSH_MAX_BACKOFF_MS, 300000),
    maxBytes: parseInteger(env.LANGFUSE_BUFFER_MAX_BYTES, 10485760),
    bufferPath: env.LANGFUSE_BUFFER_PATH || defaultBufferPath()
  };
}

async function readBufferEntries(bufferPath) {
  try {
    const content = await fsp.readFile(bufferPath, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }

    throw err;
  }
}

function summarizeBatch(entry) {
  const firstEvent = entry.events[0] || {};
  const traceEvent = entry.events.find((event) => event.type === 'trace-create');
  const generationEvent = entry.events.find((event) => event.type === 'generation-create');
  const traceName = traceEvent?.body?.name || generationEvent?.body?.metadata?.agentName || firstEvent.type || 'unknown';

  return {
    timestamp: entry.timestamp,
    attempts: entry.attempts,
    nextRetryAt: entry.nextRetryAt || 0,
    eventCount: Array.isArray(entry.events) ? entry.events.length : 0,
    traceId: traceEvent?.id || generationEvent?.body?.traceId || null,
    traceName,
    model: generationEvent?.body?.model || null,
    status: entry.nextRetryAt && entry.nextRetryAt > Date.now() ? 'waiting' : 'ready'
  };
}

async function buildDashboardState(options = {}) {
  const packageRoot = options.packageRoot || path.join(__dirname, '..');
  const packageJson = readJson(path.join(packageRoot, 'package.json'));
  const pricing = readJson(path.join(packageRoot, 'lib', 'model-pricing.json'));
  const config = loadUiConfig(options.env || process.env);
  const bufferEntries = await readBufferEntries(config.bufferPath);

  let bufferStats = {
    exists: false,
    sizeBytes: 0
  };

  try {
    const stats = await fsp.stat(config.bufferPath);
    bufferStats = {
      exists: true,
      sizeBytes: stats.size
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  const latestEntry = bufferEntries.length > 0 ? bufferEntries[bufferEntries.length - 1] : null;

  return {
    package: {
      name: packageJson.name,
      version: packageJson.version
    },
    host: {
      platform: os.platform(),
      nodeVersion: process.version
    },
    langfuse: {
      configured: Boolean(config.publicKey && config.secretKey),
      baseUrl: config.baseUrl,
      publicKeyPreview: config.publicKey ? `${config.publicKey.slice(0, 6)}...` : null
    },
    capture: {
      input: config.captureInput,
      output: config.captureOutput,
      securityMonitoring: config.securityMonitoring,
      costTracking: config.costTracking,
      multiAgentLinking: config.multiAgentLinking
    },
    limits: {
      maxInputChars: config.maxInputChars,
      maxOutputChars: config.maxOutputChars,
      maxBytes: config.maxBytes,
      maxRetries: config.maxRetries,
      flushInterval: config.flushInterval,
      backoffBase: config.backoffBase,
      maxBackoffMs: config.maxBackoffMs
    },
    buffer: {
      path: config.bufferPath,
      exists: bufferStats.exists,
      sizeBytes: bufferStats.sizeBytes,
      batchCount: bufferEntries.length,
      lastBufferedAt: latestEntry?.timestamp || null
    },
    pricing: {
      version: pricing.version,
      knownModels: Object.keys(pricing.models).length
    },
    recentBatches: bufferEntries.slice(-20).reverse().map(summarizeBatch)
  };
}

async function clearBuffer(bufferPath) {
  try {
    await fsp.unlink(bufferPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }

    throw err;
  }
}

function getContentType(filePath) {
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.js')) {
    return 'application/javascript; charset=utf-8';
  }
  if (filePath.endsWith('.html')) {
    return 'text/html; charset=utf-8';
  }
  return 'text/plain; charset=utf-8';
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function createUiServer(options = {}) {
  const packageRoot = options.packageRoot || path.join(__dirname, '..');
  const uiDir = path.join(packageRoot, 'ui');
  const env = options.env || process.env;
  const logger = options.logger || console;

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/api/status') {
        const state = await buildDashboardState({ env, packageRoot });
        sendJson(response, 200, state);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/buffer/clear') {
        const config = loadUiConfig(env);
        await clearBuffer(config.bufferPath);
        const state = await buildDashboardState({ env, packageRoot });
        sendJson(response, 200, state);
        return;
      }

      const assetPath = requestUrl.pathname === '/'
        ? path.join(uiDir, 'index.html')
        : path.join(uiDir, requestUrl.pathname.replace(/^\/+/, ''));

      if (!assetPath.startsWith(uiDir)) {
        sendJson(response, 403, { error: 'forbidden' });
        return;
      }

      const content = await fsp.readFile(assetPath);
      response.writeHead(200, {
        'Content-Type': getContentType(assetPath),
        'Cache-Control': 'no-store'
      });
      response.end(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }

      logger.error?.(`[clawtrace-ui] Request failed: ${err.message}`);
      sendJson(response, 500, { error: 'internal_error', message: err.message });
    }
  });

  return {
    async start({ host = '127.0.0.1', port = 4310 } = {}) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });

      const address = server.address();
      return {
        host: address.address,
        port: address.port,
        url: `http://${address.address}:${address.port}`
      };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
    server
  };
}

module.exports = {
  buildDashboardState,
  clearBuffer,
  createUiServer,
  loadUiConfig,
  readBufferEntries,
  summarizeBatch
};
