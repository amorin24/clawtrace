# Runtime architecture

## High-level flow

The live runtime is driven by `plugin/index.js`.

1. OpenClaw emits `message_received`
2. clawtrace creates a pending turn and captures initial metadata
3. Security monitoring runs against the input payload
4. OpenClaw emits `agent_end`
5. clawtrace correlates the completion to the pending turn
6. `lib/tracer.js` builds the trace, spans, and generation payload
7. `lib/langfuse-client.js` attempts ingestion
8. Retryable failures are persisted through `lib/buffer.js`

## Main modules

- `plugin/index.js`: plugin registration, event wiring, lifecycle, and turn correlation
- `lib/tracer.js`: trace assembly and event normalization
- `lib/langfuse-client.js`: Langfuse ingestion client
- `lib/buffer.js`: retry buffer and flush scheduling
- `lib/security-monitor.js`: prompt-injection and destructive-tool detection
- `lib/cost-estimator.js`: pricing lookup and cost estimation
- `lib/agent-linker.js`: parent/child trace support for future delegation hooks
- `lib/ui-server.js`: local dashboard companion
- `lib/utils.js`: shared utility helpers

## Correlation model

Pending turns are stored in a queue per channel. If OpenClaw provides a stable event or message identifier, clawtrace uses it directly. If not, it falls back to ordered queue resolution within the channel.

That queue-based fallback prevents the older overwrite problem where concurrent same-channel turns could stomp each other.

## Packaging model

The plugin entrypoint can resolve `lib/` in two layouts:

1. The repo layout during local development
2. The deployed extension layout after `clawtrace install`

This keeps the plugin locally runnable and testable.
