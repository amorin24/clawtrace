# Security Policy

## What clawtrace sends

clawtrace sends Langfuse ingestion payloads that may include:

- User input text when `LANGFUSE_CAPTURE_INPUT=true`
- Agent output text when `LANGFUSE_CAPTURE_OUTPUT=true`
- Session, user, conversation, and channel metadata
- Security detections and severity
- Model name and usage counts when the host exposes them
- Best-effort cost estimates derived from usage counts

## What clawtrace does not send

- Environment variables
- Langfuse credentials
- Local configuration files
- Arbitrary filesystem contents unless the host includes them in event payloads

## Credential handling

- `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are read from environment variables
- Credentials are used only to build the Basic auth header for Langfuse
- Credentials are never written to the retry buffer

## Retry buffer

By default, the retry buffer lives in the operating system temp directory as `clawtrace-buffer.ndjson`.

- The buffer contains trace batches only
- Retryable failures are retained for replay
- Non-retryable failures such as auth or client errors are dropped immediately
- You can move the buffer with `LANGFUSE_BUFFER_PATH`

If you need to clear the buffer manually, delete the file configured by `LANGFUSE_BUFFER_PATH`, or the default file in your OS temp directory.

## Privacy controls

Disable content capture if your agents handle sensitive material:

```bash
LANGFUSE_CAPTURE_INPUT=false
LANGFUSE_CAPTURE_OUTPUT=false
```

Traces will still include metadata and any non-content fields exposed by OpenClaw.

## Current OpenClaw limitations

OpenClaw `v2026.3.13` does not currently expose plugin hooks for:

- Tool calls
- Skill invocations
- Delegation events

Cost tracking only works when the `agent_end` event includes token usage counts.

## Reporting vulnerabilities

Do not open public issues for security vulnerabilities.

Contact: `security@wngspan.com`

Include:

1. A clear description of the issue
2. Steps to reproduce it
3. Impact assessment
4. Suggested mitigation if you have one
