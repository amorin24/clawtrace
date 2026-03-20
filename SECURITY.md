# Security Policy

## Data Transmission

### What clawtrace sends to Langfuse

clawtrace transmits the following data to Langfuse (cloud or self-hosted):

**By default:**
- User input messages (full text)
- Agent output responses (full text)
- Tool names and arguments (full JSON payloads)
- Skill names and versions
- Model names and token counts
- Agent metadata (agent IDs, session IDs, user IDs)
- Timestamps and trace lineage
- Cost estimates (calculated locally, not from Langfuse)

**When security monitoring is enabled:**
- Detected injection patterns (pattern names, not full payloads)
- Destructive tool call flags (tool name, category)

### What clawtrace does NOT send

- Environment variables
- Langfuse API keys (only used for authentication headers)
- File contents (unless included in tool arguments)
- System paths (unless included in tool arguments or metadata)
- OpenClaw configuration files

### Credential handling

**clawtrace never stores credentials.** It reads `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` from environment variables at startup and uses them to construct Basic Auth headers for Langfuse API requests. Keys are held in memory only and are never written to disk.

The local buffer file (`/tmp/clawtrace-buffer.ndjson`) does not contain credentials — only trace events.

## Privacy controls

### Disable input/output capture for sensitive deployments

If your agents handle PII, credentials, or other sensitive data, disable content capture:

```bash
LANGFUSE_CAPTURE_INPUT=false
LANGFUSE_CAPTURE_OUTPUT=false
```

**What still gets tracked:**
- Tool calls (tool names and args — review these for sensitive data)
- Metadata (agent IDs, session IDs)
- Token counts and cost estimates
- Trace lineage and timing

**What no longer gets tracked:**
- User messages
- Agent responses

### Truncation limits

Even with capture enabled, clawtrace truncates long inputs/outputs:

```bash
LANGFUSE_MAX_INPUT_CHARS=4000   # Default
LANGFUSE_MAX_OUTPUT_CHARS=8000  # Default
```

Truncated content is marked with `[truncated at N chars]`.

### Security event logging

When `LANGFUSE_SECURITY_MONITOR=true`, detected injection patterns are logged to:

1. Langfuse trace (pattern names only, not full payloads)
2. OpenClaw gateway logs (full payload for audit)

Security events are **never truncated** regardless of truncation settings.

## Self-hosted Langfuse

For maximum data sovereignty, use self-hosted Langfuse:

```bash
LANGFUSE_BASE_URL=https://langfuse.yourdomain.com
```

All trace data stays within your infrastructure. See: https://langfuse.com/docs/deployment/self-host

## Local buffer security

**Buffer file location:**

Default: `/tmp/clawtrace-buffer.ndjson`

**Permissions:**

The buffer file inherits permissions from your Node.js process. Ensure the OpenClaw gateway runs with appropriate user permissions and file system access controls.

**Buffer contents:**

The buffer contains full trace events including any captured inputs/outputs. If `LANGFUSE_CAPTURE_INPUT=false`, the buffer will not contain user messages.

**Cleanup:**

The buffer auto-flushes and clears on successful ingestion. If ingestion permanently fails, old entries are dropped when the buffer exceeds `LANGFUSE_BUFFER_MAX_BYTES`.

To manually clear the buffer:

```bash
rm /tmp/clawtrace-buffer.ndjson
```

## Reporting vulnerabilities

**DO NOT open public issues for security vulnerabilities.**

Instead, email: security@wngspan.com

Include:
- Vulnerability description
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We will respond within 48 hours and work with you on a fix and disclosure timeline.

## Threat model

### What clawtrace protects against

- **Prompt injection detection** — logs attempts, does not block
- **Destructive tool call awareness** — flags dangerous operations
- **Data loss** — local buffer prevents trace loss during Langfuse outages

### What clawtrace does NOT protect against

- **Agent security** — clawtrace does not block malicious input, only detects and logs
- **Tool execution** — clawtrace does not prevent destructive tools from running
- **Network MITM** — ensure `LANGFUSE_BASE_URL` uses HTTPS
- **Compromised environment variables** — protect your env files with proper file permissions

clawtrace is an observability tool, not a security enforcement layer. Use it alongside proper agent security practices:

- Input validation
- Tool sandboxing
- Least-privilege execution
- Network security
- Secrets management

## Compliance

**GDPR / data privacy:**

If you are subject to GDPR or similar regulations:

1. Disable input/output capture: `LANGFUSE_CAPTURE_INPUT=false`, `LANGFUSE_CAPTURE_OUTPUT=false`
2. Use self-hosted Langfuse for data residency
3. Review tool arguments for PII before deployment
4. Implement data retention policies in Langfuse (see Langfuse docs)

**clawtrace does not:**
- Make decisions about what data to capture (you control this via env vars)
- Implement data retention policies (managed by Langfuse)
- Provide GDPR compliance guarantees (consult your legal team)

## Dependency security

**clawtrace has zero runtime npm dependencies.**

All functionality uses Node.js built-ins:
- `fs`, `path`, `os` for file operations
- `fetch` for HTTP (Node.js 18+)
- `node:test` for testing

This eliminates supply chain risk from third-party dependencies.

## Secure deployment checklist

- [ ] Review tool arguments for sensitive data
- [ ] Set `LANGFUSE_CAPTURE_INPUT=false` if handling PII
- [ ] Use self-hosted Langfuse if data sovereignty required
- [ ] Protect `/etc/openclaw.env` with appropriate file permissions (`600` or `640`)
- [ ] Use HTTPS for `LANGFUSE_BASE_URL`
- [ ] Rotate Langfuse API keys periodically
- [ ] Monitor buffer file size and location
- [ ] Review Langfuse dashboard access controls

---

For questions, contact: security@wngspan.com
