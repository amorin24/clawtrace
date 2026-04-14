# Buffering and retries

## When buffering happens

clawtrace buffers batches when ingestion fails with a retryable error:

- `network`
- `server`
- `rate_limit`

It does not buffer:

- `auth`
- `client`

Those failures are treated as non-retryable because resending the same payload will not fix them.

## Buffer format

The retry buffer is newline-delimited JSON. Each line represents one buffered batch with:

- `timestamp`
- `attempts`
- `nextRetryAt`
- `events`

## Retry strategy

- Background flush runs on `LANGFUSE_FLUSH_INTERVAL_MS`
- Individual entries respect `nextRetryAt`
- Delay increases exponentially using `LANGFUSE_FLUSH_BACKOFF_BASE_MS`
- Delay is capped by `LANGFUSE_FLUSH_MAX_BACKOFF_MS`
- Jitter is added to avoid synchronized retries

## Retention behavior

- The buffer is capped by `LANGFUSE_BUFFER_MAX_BYTES`
- Oldest batches are dropped first when the cap is exceeded
- Entries are dropped after `LANGFUSE_FLUSH_MAX_RETRIES`

## Operational advice

- Keep the buffer on a local writable disk
- Monitor buffer growth during Langfuse incidents
- If you intentionally want to discard buffered data, clear the file manually or use the UI companion
