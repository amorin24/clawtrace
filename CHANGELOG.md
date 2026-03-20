# Changelog

All notable changes to clawtrace will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/amorin24/clawtrace/releases/tag/v1.0.0
