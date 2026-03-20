# clawtrace
## Engineering Specification v1.0
### Built for Claude Code

---

## Project Overview

Build a production-grade, open-source OpenClaw plugin that sends full agent observability traces to Langfuse. This is not a minimal logging script — it is a best-in-class observability layer for multi-agent OpenClaw deployments, designed to be published as an npm package and used by the broader OpenClaw community.

**Package name:** `clawtrace`  
**License:** MIT  
**Target runtime:** Node.js 22+  
**Distribution:** npm (public) + GitHub  

---

## Goals

1. Capture complete agent observability — not just LLM calls, but tool calls, skill invocations, multi-agent delegation chains, and security events
2. Production resilient — buffer locally when Langfuse is unreachable, flush when back online
3. Zero friction to install — two env vars and done
4. Multi-agent aware — trace delegation chains across agents as linked parent/child traces in Langfuse
5. Security observability — detect and log prompt injection attempts and destructive tool calls
6. Works with both Langfuse Cloud and self-hosted Langfuse from day one
7. npm installable with an auto-install CLI command

---

## Repository Structure

```
clawtrace/
├── package.json
├── README.md
├── SECURITY.md
├── CHANGELOG.md
├── .github/
│   └── workflows/
│       ├── test.yml           # Run tests on PR
│       └── publish.yml        # Publish to npm on release tag
├── bin/
│   └── install.js             # CLI installer — detects workspace and drops plugin in place
├── plugin/
│   ├── openclaw.plugin.json   # OpenClaw plugin manifest
│   └── index.js               # Plugin entry point — registers hooks with OpenClaw plugin API
├── lib/
│   ├── tracer.js              # Core trace assembly logic
│   ├── langfuse-client.js     # Langfuse REST API client (no SDK dependency)
│   ├── buffer.js              # Local NDJSON buffer + background flush worker
│   ├── cost-estimator.js      # Per-model cost calculation from pricing table
│   ├── security-monitor.js    # Prompt injection detection + audit logging
│   ├── agent-linker.js        # Multi-agent parent/child trace ID management
│   └── model-pricing.json     # Pricing table for known models (updated manually)
└── test/
    ├── tracer.test.js
    ├── langfuse-client.test.js
    ├── buffer.test.js
    ├── cost-estimator.test.js
    ├── security-monitor.test.js
    └── agent-linker.test.js
```

---

## OpenClaw Plugin System

OpenClaw auto-discovers plugins from `{workspaceDir}/.openclaw/extensions/` at gateway startup. Each plugin directory must contain:

- `openclaw.plugin.json` — manifest with id, name, version, configSchema
- `index.js` — plugin implementation that receives the OpenClaw `api` object

The plugin API exposes hooks via `api.on(event, handler)`. Relevant hooks:

| Hook | Fires when |
|---|---|
| `before_agent_start` | Agent turn begins, before LLM call |
| `agent_end` | Agent turn completes with response |
| `tool_call` | Agent invokes a tool |
| `tool_result` | Tool returns a result |
| `skill_invoke` | Agent loads and uses a skill |
| `agent_delegate` | Agent delegates to another agent |
| `agent_delegate_result` | Delegated agent returns result |

Plugin receives `api` object with at minimum:
- `api.on(event, handler)` — register hook
- `api.log(level, message)` — log to gateway log
- `api.config` — plugin config from openclaw.json if defined

---

## Plugin Manifest

```json
{
  "id": "clawtrace",
  "name": "Clawtrace",
  "version": "1.0.0",
  "description": "Production-grade observability for OpenClaw agents. Traces agent turns, tool calls, skill invocations, multi-agent chains, and security events to Langfuse.",
  "author": "WNGSPAN",
  "license": "MIT",
  "homepage": "https://github.com/wngspan-admin/clawtrace",
  "configSchema": {
    "type": "object",
    "properties": {}
  }
}
```

---

## Configuration

### Required environment variables

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

### Optional environment variables with defaults

```bash
# Langfuse endpoint — cloud or self-hosted
LANGFUSE_BASE_URL=https://cloud.langfuse.com

# Local buffer for offline resilience
LANGFUSE_BUFFER_PATH=/tmp/clawtrace-buffer.ndjson
LANGFUSE_BUFFER_MAX_BYTES=10485760        # 10MB before oldest entries dropped
LANGFUSE_FLUSH_INTERVAL_MS=30000          # 30s between flush attempts
LANGFUSE_FLUSH_MAX_RETRIES=5              # Max retry attempts per flush
LANGFUSE_FLUSH_BACKOFF_BASE_MS=1000       # Base for exponential backoff

# Content capture
LANGFUSE_CAPTURE_INPUT=true               # Capture user messages
LANGFUSE_CAPTURE_OUTPUT=true             # Capture agent responses
LANGFUSE_MAX_INPUT_CHARS=4000            # Truncation limit for input
LANGFUSE_MAX_OUTPUT_CHARS=8000           # Truncation limit for output

# Features
LANGFUSE_SECURITY_MONITOR=true           # Enable injection detection
LANGFUSE_COST_TRACKING=true             # Enable cost estimation
LANGFUSE_MULTI_AGENT_LINKING=true        # Enable parent/child trace linking

# Logging
LANGFUSE_LOG_LEVEL=warn                  # debug | info | warn | error
```

---

## Module Specifications

### `lib/langfuse-client.js`

Thin HTTP client wrapping the Langfuse `/api/public/ingestion` batch endpoint. No external dependencies — uses Node.js native `fetch`.

**Responsibilities:**
- Construct batch ingestion payloads from trace/span/generation objects
- POST to `${LANGFUSE_BASE_URL}/api/public/ingestion` with Basic Auth header
- Return success/failure without throwing
- Validate that required env vars are present on init — if missing, log warning and return a no-op client

**Key methods:**
```javascript
class LangfuseClient {
  constructor(config)           // config: { publicKey, secretKey, baseUrl }
  isConfigured()                // returns bool — false if keys missing
  async ingest(events)          // POST batch of events, returns { ok, status, error }
  buildAuthHeader()             // returns Basic auth header string
}
```

**Ingestion event types to support:**
- `trace-create` — root trace
- `span-create` — child span within a trace
- `span-update` — update span end time and output
- `generation-create` — LLM call span with model/token/cost data
- `generation-update` — update generation with output after streaming completes
- `score-create` — optional quality score (reserved for future use)

**Error handling:**
- Network errors → return `{ ok: false, error: 'network' }`
- 4xx errors → return `{ ok: false, error: 'auth' }` — log warning, do not retry
- 5xx errors → return `{ ok: false, error: 'server' }` — eligible for retry via buffer
- Never throw — always return a result object

---

### `lib/buffer.js`

Local NDJSON file buffer that stores failed ingestion payloads and retries them on a background interval.

**Responsibilities:**
- Accept event batches that failed to ingest
- Write to NDJSON file (one JSON object per line)
- Background worker flushes buffer on interval
- Exponential backoff on repeated flush failures
- Drop oldest entries when buffer exceeds max size
- Emit log warnings when dropping entries
- Graceful shutdown — attempt final flush on process exit

**Key methods:**
```javascript
class Buffer {
  constructor(config, langfuseClient)
  async write(events)           // append events to buffer file
  async flush()                 // attempt to send buffered events to Langfuse
  start()                       // start background flush worker
  async stop()                  // stop worker, attempt final flush
  async size()                  // return current buffer size in bytes
  async count()                 // return number of buffered event batches
}
```

**File format:**
Each line in the buffer file is a JSON object:
```json
{"timestamp": "2026-03-20T10:00:00Z", "attempts": 2, "events": [...]}
```

**Flush logic:**
1. Read all lines from buffer file
2. Group into batches of max 50 events
3. Attempt ingest for each batch
4. On success: remove those lines from file
5. On failure: increment attempt counter, apply backoff
6. After max retries: drop batch, log warning with event count

---

### `lib/tracer.js`

Core trace assembly. Receives raw hook data from OpenClaw and converts it into structured Langfuse trace/span/generation objects.

**Responsibilities:**
- Assemble complete trace from multiple hook events
- Maintain in-memory turn state (start time, spans, metadata)
- Coordinate with `agent-linker.js` for multi-agent traces
- Coordinate with `security-monitor.js` for injection detection
- Coordinate with `cost-estimator.js` for cost data
- Finalize and dispatch trace to `langfuse-client.js` (or buffer on failure)

**Turn lifecycle:**
```
before_agent_start
  → create trace record in memory
  → record start timestamp
  → run security monitor on input
  → if multi-agent: check for parent trace ID

tool_call (0 or more)
  → create span record attached to trace
  → record tool name, args, start time

tool_result (paired with tool_call)
  → update span with result, end time
  → flag if tool is destructive (delete, send, exec, write)

skill_invoke (0 or more)
  → create span record for skill

agent_delegate
  → create span for delegation
  → pass current trace ID to child agent via agent-linker

agent_end
  → attach LLM generation data (model, tokens, cost)
  → finalise all open spans
  → assemble complete batch payload
  → attempt ingest → on failure write to buffer
  → clear in-memory turn state
```

**Trace structure sent to Langfuse:**
```
trace-create (root)
  └── span-create: security-check (if injection detected)
  └── span-create: tool_call (one per tool)
  └── span-create: skill_invoke (one per skill)
  └── span-create: agent_delegate (if delegated)
  └── generation-create: llm-call (the actual LLM call)
```

**Truncation:**
- Apply `LANGFUSE_MAX_INPUT_CHARS` and `LANGFUSE_MAX_OUTPUT_CHARS` limits
- Append `[truncated]` marker when truncated
- Never truncate security events

---

### `lib/cost-estimator.js`

Estimates cost per LLM call based on token counts and a maintained pricing table.

**Responsibilities:**
- Load `model-pricing.json` at startup
- Accept model name + token counts, return estimated cost in USD
- Handle unknown models gracefully (return null, do not error)
- Normalise model name formats (openrouter/anthropic/claude-sonnet-4-6 → anthropic/claude-sonnet-4-6)

**Key methods:**
```javascript
class CostEstimator {
  constructor()                                    // loads pricing table
  estimate(model, inputTokens, outputTokens)       // returns { inputCost, outputCost, totalCost } | null
  normaliseModel(modelString)                      // strips provider prefix
  isKnownModel(model)                              // bool
}
```

**model-pricing.json format:**
```json
{
  "version": "2026-03",
  "note": "Prices in USD per million tokens. Update monthly.",
  "models": {
    "anthropic/claude-sonnet-4-6": {
      "input": 3.00,
      "output": 15.00
    },
    "anthropic/claude-opus-4-6": {
      "input": 15.00,
      "output": 75.00
    },
    "anthropic/claude-haiku-4-5": {
      "input": 0.80,
      "output": 4.00
    },
    "google/gemini-flash-1.5": {
      "input": 0.075,
      "output": 0.30
    },
    "google/gemini-pro-1.5": {
      "input": 1.25,
      "output": 5.00
    },
    "openai/gpt-4o": {
      "input": 2.50,
      "output": 10.00
    },
    "openai/gpt-4o-mini": {
      "input": 0.15,
      "output": 0.60
    },
    "meta-llama/llama-3.1-8b-instruct": {
      "input": 0.05,
      "output": 0.05
    },
    "openrouter/auto": {
      "input": null,
      "output": null,
      "note": "Variable — depends on routed model"
    }
  }
}
```

---

### `lib/security-monitor.js`

Detects prompt injection attempts in incoming content and logs destructive tool calls as audit events.

**Responsibilities:**
- Scan incoming messages for injection patterns
- Scan tool arguments for suspicious content
- Return structured detection results for inclusion in traces
- Never block execution — detection only, defence is the agent's responsibility
- Log all detections with full payload for audit purposes

**Injection patterns to detect:**
```javascript
const INJECTION_PATTERNS = [
  // Role/persona override attempts
  /ignore (previous|all|above|prior) instructions/i,
  /you are now/i,
  /act as (a|an|the)/i,
  /pretend (you are|to be)/i,
  /your (new|real|actual) (instructions|role|purpose|goal)/i,
  /disregard (your|all|previous)/i,
  /forget (your|all|previous)/i,
  /system prompt/i,
  /\[system\]/i,
  /\[\[.*\]\]/,

  // Command injection attempts
  /```(bash|sh|shell|cmd|powershell)/i,
  /rm -rf/i,
  /sudo /i,
  /eval\(/i,
  /exec\(/i,

  // Encoding-based evasion
  /base64/i,
  /atob\(/i,
  /btoa\(/i,

  // Data exfiltration patterns
  /send (this|the|all|my|your) (to|via|through)/i,
  /exfiltrate/i,
  /leak/i,
]
```

**Destructive tool call detection:**
Flag any tool call where the tool name or arguments match:
- `delete`, `remove`, `rm`, `unlink` — file deletion
- `send`, `reply`, `compose`, `draft` — outbound communication
- `exec`, `run`, `execute`, `shell` — command execution
- `write`, `edit`, `modify`, `update` — file modification

**Key methods:**
```javascript
class SecurityMonitor {
  constructor(config)
  scanInput(message)              // returns { detected: bool, patterns: [], severity: 'low|medium|high' }
  scanToolCall(name, args)        // returns { destructive: bool, reason: string } | null
  buildSecuritySpan(detection)    // returns Langfuse span object for security event
}
```

---

### `lib/agent-linker.js`

Manages trace ID propagation across multi-agent delegation chains so the full chain appears as linked traces in Langfuse.

**Responsibilities:**
- Maintain a registry of active trace IDs keyed by agent ID
- When agent delegates to specialist, pass parent trace ID
- When specialist completes, link its trace to parent
- Clean up stale trace IDs after configurable TTL
- Thread-safe in-memory Map (single process, no shared state issues)

**Key methods:**
```javascript
class AgentLinker {
  constructor(config)
  setActiveTrace(agentId, traceId)           // register active trace for agent
  getParentTrace(agentId)                    // get parent trace ID if delegated
  recordDelegation(parentAgentId, childAgentId, traceId)  // link delegation
  clearTrace(agentId)                        // clear on turn complete
  buildDelegationSpan(parentTraceId, childAgentId)  // returns span object
}
```

---

### `plugin/index.js`

Main plugin entry point. Receives the OpenClaw `api` object and wires all hooks together.

```javascript
module.exports = function(api) {
  // Initialise all modules
  const config = loadConfig()
  const client = new LangfuseClient(config)
  const buffer = new Buffer(config, client)
  const tracer = new Tracer(config, client, buffer)
  const security = new SecurityMonitor(config)
  const linker = new AgentLinker(config)
  const cost = new CostEstimator()

  // Guard — if not configured, log once and exit gracefully
  if (!client.isConfigured()) {
    api.log('warn', '[clawtrace] LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set — tracing disabled')
    return
  }

  // Start buffer flush worker
  buffer.start()

  // Register hooks
  api.on('before_agent_start', (ctx) => tracer.onTurnStart(ctx, security, linker))
  api.on('tool_call', (ctx) => tracer.onToolCall(ctx, security))
  api.on('tool_result', (ctx) => tracer.onToolResult(ctx))
  api.on('skill_invoke', (ctx) => tracer.onSkillInvoke(ctx))
  api.on('agent_delegate', (ctx) => tracer.onDelegate(ctx, linker))
  api.on('agent_delegate_result', (ctx) => tracer.onDelegateResult(ctx, linker))
  api.on('agent_end', (ctx) => tracer.onTurnEnd(ctx, cost, linker))

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    api.log('info', '[clawtrace] Flushing buffer before shutdown...')
    await buffer.stop()
  })

  api.log('info', `[clawtrace] Langfuse tracing enabled → ${config.baseUrl}`)
}
```

---

### `bin/install.js`

CLI installer that auto-detects the OpenClaw workspace and installs the plugin.

**Behaviour:**
1. Detect OpenClaw workspace path — check `OPENCLAW_HOME`, then `~/.openclaw/workspace`
2. Verify OpenClaw is installed by checking for `openclaw.json`
3. Create `{workspace}/.openclaw/extensions/clawtrace/` directory
4. Copy plugin files into directory
5. Print instructions for adding env vars to `/etc/openclaw.env`
6. Remind user to restart gateway

**Usage after npm install:**
```bash
npx clawtrace install
```

---

## Testing Requirements

All modules must have unit tests. Use Node.js built-in `node:test` runner — no test framework dependencies.

### Test coverage requirements

**`langfuse-client.test.js`**
- Successful batch ingest returns `{ ok: true }`
- Network failure returns `{ ok: false, error: 'network' }`
- 401 returns `{ ok: false, error: 'auth' }`
- 500 returns `{ ok: false, error: 'server' }`
- Missing keys returns no-op client with `isConfigured() === false`
- Auth header is correctly constructed from public/secret keys

**`buffer.test.js`**
- Events written to buffer file on ingest failure
- Flush successfully ingests buffered events and clears file
- Flush failure increments attempt counter
- Buffer respects max size — drops oldest when exceeded
- NDJSON format is valid after write

**`cost-estimator.test.js`**
- Known model returns correct cost for given token counts
- Unknown model returns null without error
- OpenRouter model prefix correctly stripped
- Zero token counts return zero cost

**`security-monitor.test.js`**
- Each injection pattern is detected correctly
- Clean message returns `{ detected: false }`
- Destructive tool names flagged correctly
- Non-destructive tool names not flagged
- Severity levels assigned correctly

**`agent-linker.test.js`**
- Active trace registered and retrieved by agent ID
- Delegation correctly links parent and child trace IDs
- Stale traces cleaned up after TTL
- Unknown agent ID returns null without error

---

## README Structure

````markdown
# clawtrace

Production-grade observability for OpenClaw agents. Traces agent turns, 
tool calls, skill invocations, multi-agent delegation chains, and security 
events to Langfuse.

## What you get
[screenshot of Langfuse dashboard with OpenClaw traces]

## Quick start
## Installation
## Configuration reference
## Multi-agent setup
## Self-hosted Langfuse
## Security monitoring
## Local buffer and resilience
## Contributing
## Updating model pricing
## License
````

---

## SECURITY.md

Must include:
- What data this plugin sends to Langfuse (inputs, outputs, tool args)
- How to disable input/output capture for sensitive deployments
- How to report vulnerabilities
- Note that this plugin never stores credentials, only reads env vars

---

## package.json

```json
{
  "name": "clawtrace",
  "version": "1.0.0",
  "description": "Production-grade Langfuse observability for OpenClaw agents",
  "main": "plugin/index.js",
  "bin": {
    "clawtrace": "bin/install.js"
  },
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "lint": "node --check lib/*.js plugin/*.js bin/*.js"
  },
  "dependencies": {},
  "devDependencies": {},
  "engines": {
    "node": ">=22.0.0"
  },
  "keywords": [
    "openclaw",
    "langfuse",
    "observability",
    "tracing",
    "ai-agents",
    "llm-ops"
  ],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/wngspan-admin/clawtrace"
  }
}
```

**Zero runtime dependencies** — this is a hard requirement. The plugin must have no `dependencies` in package.json. Only `devDependencies` are permitted if needed for development tooling.

---

## GitHub Actions

### `test.yml` — runs on every PR
```yaml
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node --test test/**/*.test.js
```

### `publish.yml` — runs on release tag
```yaml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          registry-url: 'https://registry.npmjs.org'
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Build Order for Claude Code

Build in this order to respect dependencies:

1. `package.json` and repo scaffold
2. `lib/model-pricing.json`
3. `lib/langfuse-client.js` + `test/langfuse-client.test.js`
4. `lib/buffer.js` + `test/buffer.test.js`
5. `lib/cost-estimator.js` + `test/cost-estimator.test.js`
6. `lib/security-monitor.js` + `test/security-monitor.test.js`
7. `lib/agent-linker.js` + `test/agent-linker.test.js`
8. `lib/tracer.js` + `test/tracer.test.js`
9. `plugin/openclaw.plugin.json`
10. `plugin/index.js`
11. `bin/install.js`
12. `README.md`
13. `SECURITY.md`
14. `CHANGELOG.md`
15. `.github/workflows/test.yml`
16. `.github/workflows/publish.yml`
17. Run all tests — all must pass before done

---

## Acceptance Criteria

Before this is considered complete:

- [ ] All tests pass with `node --test`
- [ ] Zero npm runtime dependencies
- [ ] Plugin loads silently when env vars missing — no crash
- [ ] Plugin logs `[clawtrace] Langfuse tracing enabled → {url}` on successful init
- [ ] Failed ingestion writes to buffer — buffer file exists and contains valid NDJSON
- [ ] Buffer flushes successfully after Langfuse becomes reachable again
- [ ] Security monitor detects all patterns in test suite
- [ ] Cost estimator returns null for unknown models without throwing
- [ ] `npx clawtrace install` completes without error on a machine with OpenClaw installed
- [ ] README is complete with configuration reference table
- [ ] SECURITY.md is complete
- [ ] GitHub Actions workflows are valid YAML

---

*Spec version: 1.0 — March 2026*  
*Author: WNGSPAN*
