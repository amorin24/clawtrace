# Security and privacy

## Prompt-injection detection

`lib/security-monitor.js` scans incoming input for patterns such as:

- instruction override attempts
- role reassignment
- command execution prompts
- encoding-based evasion
- data exfiltration language

Detection is observational. clawtrace logs and traces the signal but does not block execution.

## Destructive-tool awareness

The security monitor can also classify tool calls when those hooks become available from the host. The categories already exist in the runtime, but the current OpenClaw plugin surface does not expose tool events.

## Privacy controls

Disable content capture if you do not want raw prompts or outputs sent to Langfuse:

```bash
LANGFUSE_CAPTURE_INPUT=false
LANGFUSE_CAPTURE_OUTPUT=false
```

## Retry buffer contents

The retry buffer may contain full trace payloads, including captured inputs and outputs. Protect it accordingly.

Recommended controls:

- keep the buffer on a machine-local path
- set file permissions appropriate for the OpenClaw runtime user
- avoid shared directories unless you intentionally need them

## Credential handling

Langfuse credentials are read from environment variables and used only for request authentication. They are not written to the retry buffer or UI companion output.
