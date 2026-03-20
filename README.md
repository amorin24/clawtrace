# clawtrace

Production-grade observability for OpenClaw agents. Traces agent turns, tool calls, skill invocations, multi-agent delegation chains, and security events to Langfuse.

## What you get

Full visibility into your OpenClaw deployment:

- **Agent turn tracking** — every agent interaction captured with full context
- **Tool call observability** — see every tool invocation, arguments, and results
- **Multi-agent chains** — visualize delegation flows from parent to specialist agents
- **Cost tracking** — automatic token and cost calculation per turn
- **Security monitoring** — detect prompt injection attempts and destructive tool usage
- **Offline resilience** — local buffer when Langfuse is unreachable, auto-flush when back online

All traces appear in your Langfuse dashboard with full lineage, metadata, and cost breakdowns.

## Quick start

```bash
npm install clawtrace
npx clawtrace install
```

Add to `/etc/openclaw.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

Restart OpenClaw gateway. Done.

## Installation

### npm-based deployments (GCE, bare metal)

```bash
npm install clawtrace
npx clawtrace install
```

The installer will:
1. Detect your OpenClaw workspace (`OPENCLAW_HOME` or `~/.openclaw/workspace`)
2. Verify OpenClaw is installed
3. Copy plugin files to `.openclaw/extensions/clawtrace/`
4. Display configuration instructions

### Manual installation

If auto-install fails:

```bash
mkdir -p ~/.openclaw/workspace/.openclaw/extensions/clawtrace
cp -r node_modules/clawtrace/plugin/* ~/.openclaw/workspace/.openclaw/extensions/clawtrace/
cp -r node_modules/clawtrace/lib ~/.openclaw/workspace/.openclaw/extensions/clawtrace/
```

## Configuration reference

### Required

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...    # Get from Langfuse dashboard
LANGFUSE_SECRET_KEY=sk-lf-...    # Get from Langfuse dashboard
```

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse endpoint (cloud or self-hosted) |
| `LANGFUSE_CAPTURE_INPUT` | `true` | Capture user messages |
| `LANGFUSE_CAPTURE_OUTPUT` | `true` | Capture agent responses |
| `LANGFUSE_MAX_INPUT_CHARS` | `4000` | Truncation limit for input |
| `LANGFUSE_MAX_OUTPUT_CHARS` | `8000` | Truncation limit for output |
| `LANGFUSE_SECURITY_MONITOR` | `true` | Enable injection detection |
| `LANGFUSE_COST_TRACKING` | `true` | Enable cost estimation |
| `LANGFUSE_MULTI_AGENT_LINKING` | `true` | Enable parent/child trace linking |
| `LANGFUSE_BUFFER_PATH` | `/tmp/clawtrace-buffer.ndjson` | Local buffer file path |
| `LANGFUSE_BUFFER_MAX_BYTES` | `10485760` | Buffer size limit (10MB) |
| `LANGFUSE_FLUSH_INTERVAL_MS` | `30000` | Flush interval (30s) |
| `LANGFUSE_FLUSH_MAX_RETRIES` | `5` | Max retry attempts per batch |
| `LANGFUSE_LOG_LEVEL` | `warn` | Log level: `debug` \| `info` \| `warn` \| `error` |

## Multi-agent setup

clawtrace automatically tracks delegation chains across your agent workforce. When Optimus Prime delegates to Bumblebee, the full chain appears as linked parent/child traces in Langfuse.

**How it works:**

1. Parent agent starts a turn → trace created with ID `trace-A`
2. Parent delegates to child → delegation recorded
3. Child starts turn → new trace `trace-B` with `parentObservationId = trace-A`
4. Langfuse displays the full chain with proper hierarchy

**Example deployment:**

```
Optimus Prime (orchestrator)
├── Bumblebee (data specialist)
├── Ironhide (security specialist)
├── Ratchet (diagnostics specialist)
└── Jazz (communication specialist)
```

All delegation flows will be visible in Langfuse with full lineage.

**Disable if not needed:**

```bash
LANGFUSE_MULTI_AGENT_LINKING=false
```

## Self-hosted Langfuse

clawtrace works with self-hosted Langfuse out of the box:

```bash
LANGFUSE_BASE_URL=https://langfuse.yourdomain.com
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

Self-hosted Langfuse deployment: https://langfuse.com/docs/deployment/self-host

## Security monitoring

clawtrace detects and logs potential prompt injection attempts and destructive tool usage.

**Detected patterns:**

- Role/persona override attempts (`ignore previous instructions`, `you are now`)
- Command injection (`rm -rf`, `sudo`, `eval`)
- Encoding-based evasion (`base64`, `atob`)
- Data exfiltration (`send this to`, `exfiltrate`)
- Destructive tool calls (`deleteFile`, `sendEmail`, `executeCommand`)

**What happens on detection:**

1. Pattern detected in user input
2. Security span added to trace with severity level
3. Warning logged to gateway logs
4. Full payload logged for audit
5. **Execution continues normally** — detection only, no blocking

Security events appear in Langfuse with `ERROR` or `WARNING` level for easy filtering.

**Disable if not needed:**

```bash
LANGFUSE_SECURITY_MONITOR=false
```

## Local buffer and resilience

If Langfuse is unreachable, traces are buffered locally and flushed when connectivity returns.

**How it works:**

1. Ingestion fails → events written to NDJSON buffer
2. Background worker retries every 30s
3. Exponential backoff on repeated failures
4. After 5 retries, batch is dropped with warning
5. Auth errors (`401`) drop immediately — no retry

**Buffer behavior:**

- Max size: 10MB (configurable)
- When exceeded: oldest entries dropped
- Format: NDJSON (one JSON object per line)
- Location: `/tmp/clawtrace-buffer.ndjson` (configurable)

**Graceful shutdown:**

On `SIGTERM` or `SIGINT`, clawtrace attempts a final flush before exiting.

## Cost tracking

clawtrace estimates cost per turn based on model pricing and token usage.

**Supported models:**

- Anthropic Claude (Sonnet, Opus, Haiku)
- OpenAI GPT-4o, GPT-4o-mini
- Google Gemini Pro, Gemini Flash
- Meta Llama models
- And more (see `lib/model-pricing.json`)

**How it works:**

1. Agent turn completes with model name and token counts
2. Cost estimator looks up pricing
3. Calculates: `(tokens / 1,000,000) * price_per_million`
4. Adds to trace: `inputCost`, `outputCost`, `totalCost`

**Unknown models:**

If model is not in pricing table, cost fields are omitted (no error).

**Updating prices:**

See [Updating model pricing](#updating-model-pricing) below.

## Privacy and data capture

**What gets sent to Langfuse:**

- User messages (if `LANGFUSE_CAPTURE_INPUT=true`)
- Agent responses (if `LANGFUSE_CAPTURE_OUTPUT=true`)
- Tool names and arguments
- Model names and token counts
- Metadata (agent IDs, session IDs, timestamps)

**What does NOT get sent:**

- Environment variables
- Credentials
- File contents (unless in tool args)

**Disable input/output capture for sensitive deployments:**

```bash
LANGFUSE_CAPTURE_INPUT=false
LANGFUSE_CAPTURE_OUTPUT=false
```

Traces will still include metadata, tool calls, and cost data.

## Updating model pricing

Model prices change frequently. To update:

1. Edit `lib/model-pricing.json`
2. Update prices in USD per million tokens
3. Rebuild: `npm run build` (if applicable)
4. Reinstall: `npx clawtrace install`

**Format:**

```json
{
  "version": "2026-03",
  "models": {
    "anthropic/claude-sonnet-4-6": {
      "input": 3.00,
      "output": 15.00
    }
  }
}
```

Pull requests welcome for price updates.

## Contributing

Contributions welcome! Please:

1. Run tests: `npm test`
2. Follow existing code style
3. Update tests for new features
4. Update README if changing config or behavior

## Zero dependencies

clawtrace has **zero runtime npm dependencies**. It uses only Node.js built-ins:

- `fs`, `path`, `os` for file operations
- `fetch` for HTTP (Node.js 18+)
- `node:test` for testing

This keeps the install lightweight and reduces supply chain risk.

## Requirements

- Node.js 22+
- OpenClaw (any version with plugin support)
- Langfuse account (cloud or self-hosted)

## License

MIT — see [LICENSE](LICENSE)

## Support

- Issues: https://github.com/amorin24/clawtrace/issues
- Docs: https://github.com/amorin24/clawtrace
- OpenClaw: https://openclaw.dev
- Langfuse: https://langfuse.com

---

Built with care for the OpenClaw community by [WNGSPAN](https://github.com/wngspan).
