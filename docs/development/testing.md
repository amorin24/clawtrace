# Testing and validation

## Commands

```bash
npm run lint
npm test
```

## What `npm run lint` does

The project uses a cross-platform syntax checker in `test/check-syntax.js`. It walks:

- `bin/`
- `lib/`
- `plugin/`
- `test/`
- `ui/`

and runs `node --check` against each JavaScript file.

## What `npm test` covers

The test suite includes:

- unit coverage for runtime modules
- plugin-entrypoint integration tests
- installer tests
- UI server tests
- retry and buffering behavior
- correlation behavior for same-channel turns

## Why the test harness is single-process

The repository uses `test/all.test.js` to load all suites inside one `node:test` run. This avoids the subprocess spawning problems that can appear in constrained environments and keeps the package testable on more hosts.
