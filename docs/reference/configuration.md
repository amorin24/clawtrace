# Configuration reference

## Required

| Variable | Description |
| --- | --- |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key |

## Optional

| Variable | Default | Description |
| --- | --- | --- |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse Cloud or self-hosted base URL |
| `LANGFUSE_CAPTURE_INPUT` | `true` | Capture user input text |
| `LANGFUSE_CAPTURE_OUTPUT` | `true` | Capture model output text |
| `LANGFUSE_MAX_INPUT_CHARS` | `4000` | Input truncation threshold |
| `LANGFUSE_MAX_OUTPUT_CHARS` | `8000` | Output truncation threshold |
| `LANGFUSE_SECURITY_MONITOR` | `true` | Enable prompt-injection and destructive-tool detection |
| `LANGFUSE_COST_TRACKING` | `true` | Estimate cost if token usage is available |
| `LANGFUSE_MULTI_AGENT_LINKING` | `true` | Keep delegation support enabled for future host hooks |
| `LANGFUSE_BUFFER_PATH` | OS temp directory | Retry buffer file path |
| `LANGFUSE_BUFFER_MAX_BYTES` | `10485760` | Maximum retry-buffer size |
| `LANGFUSE_FLUSH_INTERVAL_MS` | `30000` | Background flush interval |
| `LANGFUSE_FLUSH_MAX_RETRIES` | `5` | Max retry count per buffered batch |
| `LANGFUSE_FLUSH_BACKOFF_BASE_MS` | `1000` | Initial retry delay before backoff |
| `LANGFUSE_FLUSH_MAX_BACKOFF_MS` | `300000` | Max backoff delay |
| `LANGFUSE_TRACE_TTL_MS` | `300000` | Pending-turn TTL before cleanup |
| `LANGFUSE_TRACE_CLEANUP_INTERVAL_MS` | `60000` | Cleanup cadence for pending turns |
| `LANGFUSE_LOG_LEVEL` | `warn` | `debug`, `info`, `warn`, or `error` |

## Notes

- `LANGFUSE_COST_TRACKING` only has effect when the host exposes token usage in the completion event.
- `LANGFUSE_MULTI_AGENT_LINKING` is future-facing until OpenClaw exposes delegation hooks.
- `LANGFUSE_BUFFER_PATH` should point to a writable location owned by the OpenClaw process.
