# UI companion

clawtrace ships with a minimal local dashboard for operators who want quick visibility into configuration and retry-buffer state.

## Start the UI

```bash
npx clawtrace ui
```

By default the server binds to:

- Host: `127.0.0.1`
- Port: `4310`

You can override both:

```bash
npx clawtrace ui --host 127.0.0.1 --port 4400
```

## What the UI shows

- Package version
- Node runtime and host platform
- Effective Langfuse base URL
- Whether the Langfuse keys are configured
- Capture and monitoring flags
- Buffer path, size, last buffered time, and batch count
- Recent buffered batches with attempts and next retry time
- Pricing table metadata

## What the UI does not do

- It does not query Langfuse directly
- It does not inspect live OpenClaw process memory
- It does not replace the Langfuse dashboard

The UI is intentionally local, simple, and operational.

## Clear buffer action

The dashboard includes a `Clear Buffer` button.

Use it only when you intentionally want to discard all buffered retry batches. This is most useful when:

- You changed keys and want to drop stale failed batches
- You are cleaning up after a test run
- You do not want old retries to be resent

## Security model

The UI binds to localhost by default and reads only local configuration and the configured retry-buffer path.
