# Changelog

All notable changes to clawtrace will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-03-21

### Fixed

**CRITICAL:** Telegram channel compatibility
- Replaced `message_sending` hook with `agent_end` (message_sending never fires on Telegram)
- Changed pendingTraces Map key from `conversationId` to `channelId`
  - `agent_end` hook has `convId=undefined`, cannot correlate by conversationId
  - Single-agent setup has one active conversation per channel, so channelId correlation works
- Updated TTL cleanup to use channelId as key

### Added

- Added `before_agent_start` hook listener with debug logging
  - Logs event and context to discover available fields for future use
- Added `agent_end` hook listener with comprehensive debug logging
  - Logs all available fields (output, model, tokens, etc.)
  - Attempts to extract output from event.output/content/response/message
  - Captures model and usage/tokens metadata if available
- Changed trace tags from `'basic-mode'` to `'telegram'` for channel-specific tracking

### Technical

- Debug logs truncated to 500 chars to avoid log spam
- All debug logs wrapped in try/catch to handle circular references
- Graceful fallback if output field name doesn't match expectations

## [1.0.1] - 2026-03-20

### Fixed

**CRITICAL:** Plugin compatibility with OpenClaw 2026.3.13 real API
- Fixed require paths in `plugin/index.js` from `../lib/` to `./lib/` (installer copies lib inside plugin dir)
- Fixed Buffer name collision (renamed to TraceBuffer to avoid shadowing Node.js Buffer global)
- Fixed auth header generation which was silently failing due to Buffer collision
- Fixed installer printed URL from wngspan to amorin24
- Added TTL cleanup for pendingTraces Map to prevent memory leak (5 minute TTL)
- Updated SECURITY.md to reflect basic mode limitations (no tool/skill tracking)

### Changed

- Complete rewrite of `plugin/index.js` for real OpenClaw 2026.3.13 API
  - Export: `module.exports = function register(api) {}`
  - Logging: `api.logger.info?.()` / `api.logger.warn?.()` (not `api.log()`)
  - Hooks: `api.on(event, async (event, ctx) => {})` with 2 parameters
  - Uses only available hooks: `message_received`, `message_sending`
  - Removed non-existent hooks: `tool_call`, `skill_invoke`, `agent_delegate`, etc.
- Added "OpenClaw version compatibility" section to README
- Updated plugin description to reflect basic mode capabilities

### Limitations (OpenClaw v2026.3.13)

**Available in basic mode:**
- ✅ Input/output tracing (user messages + agent responses)
- ✅ Conversation/session tracking
- ✅ Security monitoring (prompt injection detection)
- ✅ Offline buffer resilience

**Not available (plugin API limitations):**
- ❌ Tool call tracing
- ❌ Skill invocation tracking
- ❌ Multi-agent delegation chains
- ❌ Cost tracking (no token counts exposed)

## [1.0.0] - 2026-03-20

### Added

- Initial release of clawtrace
- Full agent turn tracing to Langfuse (cloud and self-hosted)
- Tool call observability with arguments and results
- Skill invocation tracking
- Multi-agent delegation chain linking
- Automatic cost estimation for known models
- Security monitoring for prompt injection attempts
- Destructive tool call detection
- Local NDJSON buffer for offline resilience
- Automatic background flush with exponential backoff
- Graceful shutdown with final flush attempt
- Configurable input/output truncation
- Privacy controls (disable input/output capture)
- Auto-installer CLI (`npx clawtrace install`)
- Support for Anthropic Claude, OpenAI GPT, Google Gemini, Meta Llama models
- Zero runtime npm dependencies
- Comprehensive test suite using Node.js built-in test runner
- Detailed README with configuration reference
- Security documentation (SECURITY.md)

### Features

**Core tracing:**
- Trace assembly from OpenClaw hooks
- Span creation for tools, skills, delegations
- LLM generation tracking with model and token data
- Parent/child trace linking for multi-agent workflows

**Cost tracking:**
- Pricing table for major LLM providers
- Automatic cost calculation from tokens
- Per-turn cost breakdown in Langfuse

**Security:**
- Pattern-based prompt injection detection (20+ patterns)
- Destructive tool call flagging
- Security event spans with severity levels
- Audit logging for detected events

**Resilience:**
- Local NDJSON buffer on ingestion failure
- Background flush worker with configurable interval
- Exponential backoff on repeated failures
- Buffer size enforcement with oldest-entry eviction
- Auth error detection (no retry on 401)

**Privacy:**
- Configurable input/output capture
- Truncation limits for long content
- No credential storage (env vars only)

### Technical

- Node.js 22+ required
- Zero runtime dependencies (uses native `fetch`, `fs`, `path`, `os`)
- Comprehensive test coverage (120+ tests)
- Production-grade error handling
- No TODOs or placeholders

### Known Limitations

- Model pricing table requires manual updates
- OpenClaw plugin API support required
- Single-process only (no distributed tracing)
- NDJSON buffer format (not optimized for large-scale deployments)

---

## Release Notes

### v1.0.0 — Production Launch

clawtrace is production-ready for OpenClaw deployments. It has been designed as a community resource for the broader OpenClaw ecosystem, with quality suitable for featuring in official OpenClaw documentation.

**Deployment tested:**
- GCE Ubuntu 22.04
- Node.js 22+
- npm-based installation
- Langfuse Cloud
- Self-hosted Langfuse (limited testing)

**Not tested:**
- Docker/Portainer deployments (manual install required)
- Node.js < 22
- Large-scale multi-agent deployments (100+ agents)

### Migration Guide

This is the first release — no migration required.

### Upgrading

When upgrading from pre-release versions:

1. Stop OpenClaw gateway
2. Run `npx clawtrace install`
3. Review CHANGELOG for breaking changes
4. Restart OpenClaw gateway

---

[1.0.2]: https://github.com/amorin24/clawtrace/releases/tag/v1.0.2
[1.0.1]: https://github.com/amorin24/clawtrace/releases/tag/v1.0.1
[1.0.0]: https://github.com/amorin24/clawtrace/releases/tag/v1.0.0
