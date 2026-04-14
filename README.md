# clawtrace

Production-grade Langfuse observability for OpenClaw agents.

`clawtrace` installs an OpenClaw plugin that captures agent turns, security detections, metadata, retryable delivery failures, and best-effort cost data when token usage is available. It also ships with a minimal local UI companion for operators who want quick visibility into configuration and retry-buffer state.

## What you get

- Input and output tracing for OpenClaw agent turns
- Prompt-injection and destructive-tool detection
- Retry buffering for transient Langfuse failures
- Best-effort cost estimation when usage counts are exposed
- A local operator dashboard via `clawtrace ui`
- Zero runtime npm dependencies

## Current OpenClaw compatibility

OpenClaw `v2026.3.13` exposes a basic plugin surface today. In that mode clawtrace supports:

- Input and output tracing
- Conversation, session, user, and channel metadata
- Security monitoring
- Retry buffering and replay
- Cost estimation when `agent_end` includes usage data

OpenClaw does not currently expose plugin hooks for:

- Tool calls
- Skill invocations
- Delegation chains

The runtime already contains the corresponding modules, but those spans are inactive until the host exposes the hooks.

## Install

```bash
npm install clawtrace
npx clawtrace install
```

The installer:

1. Detects the OpenClaw workspace
2. Verifies the installation
3. Copies `plugin/` and `lib/` into `.openclaw/extensions/clawtrace/`
4. Prints the required environment variables

## Required configuration

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

## CLI

```bash
npx clawtrace install
npx clawtrace ui
```

UI example with custom bind address:

```bash
npx clawtrace ui --host 127.0.0.1 --port 4400
```

## UI companion

The UI companion is intentionally small and local. It shows:

- package version
- effective Langfuse target
- capture and monitoring flags
- retry-buffer path, size, and batch count
- recent buffered batches and retry timing

It does not replace Langfuse. It is an operational helper for local inspection and cleanup.

## Key configuration

| Variable | Default | Description |
| --- | --- | --- |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse Cloud or self-hosted base URL |
| `LANGFUSE_CAPTURE_INPUT` | `true` | Capture user input text |
| `LANGFUSE_CAPTURE_OUTPUT` | `true` | Capture agent output text |
| `LANGFUSE_SECURITY_MONITOR` | `true` | Enable injection and destructive-tool detection |
| `LANGFUSE_COST_TRACKING` | `true` | Estimate cost when usage data is present |
| `LANGFUSE_MULTI_AGENT_LINKING` | `true` | Keep delegation support enabled for future host hooks |
| `LANGFUSE_BUFFER_PATH` | OS temp directory | Retry buffer file path |
| `LANGFUSE_BUFFER_MAX_BYTES` | `10485760` | Buffer size limit |
| `LANGFUSE_FLUSH_INTERVAL_MS` | `30000` | Background flush interval |
| `LANGFUSE_FLUSH_MAX_RETRIES` | `5` | Max retries before dropping a batch |
| `LANGFUSE_FLUSH_BACKOFF_BASE_MS` | `1000` | Initial retry delay |
| `LANGFUSE_FLUSH_MAX_BACKOFF_MS` | `300000` | Maximum retry delay |
| `LANGFUSE_LOG_LEVEL` | `warn` | `debug`, `info`, `warn`, or `error` |

## Development

```bash
npm run lint
npm test
```

Current validation includes plugin-entrypoint tests, installer tests, retry-buffer tests, and UI server tests.

## Documentation

Additional documentation lives in [`docs/`](./docs/README.md):

- [Installation](./docs/getting-started/installation.md)
- [UI companion](./docs/getting-started/ui-companion.md)
- [CLI reference](./docs/reference/cli.md)
- [Configuration reference](./docs/reference/configuration.md)
- [Runtime architecture](./docs/architecture/runtime.md)
- [Buffering and retries](./docs/operations/buffering-and-retries.md)
- [Security and privacy](./docs/operations/security-and-privacy.md)
- [Testing and validation](./docs/development/testing.md)

## Security and privacy

- Input and output capture can be disabled with `LANGFUSE_CAPTURE_INPUT=false` and `LANGFUSE_CAPTURE_OUTPUT=false`
- Credentials are read from environment variables and never written to the retry buffer
- The local retry buffer contains trace payloads but not credentials
- See [`SECURITY.md`](./SECURITY.md) for the security policy

## Requirements

- Node.js 22+
- OpenClaw with plugin support
- A Langfuse project

## License

MIT
