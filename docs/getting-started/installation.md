# Installation

## Requirements

- Node.js 22+
- OpenClaw with plugin support
- A Langfuse project with public and secret keys

## Standard install

```bash
npm install clawtrace
npx clawtrace install
```

The installer will:

1. Discover the OpenClaw workspace
2. Verify that the host looks like a real OpenClaw installation
3. Copy `plugin/` and `lib/` into `.openclaw/extensions/clawtrace/`
4. Print the environment variables you should add to your gateway environment

## Workspace discovery

The installer checks these locations in order:

1. `OPENCLAW_HOME`
2. `~/.openclaw/workspace`

The target installation path is:

```text
<workspace>/.openclaw/extensions/clawtrace
```

## Required environment variables

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

## Recommended first-run steps

1. Install the package.
2. Add the Langfuse keys to your OpenClaw environment file.
3. Restart the OpenClaw gateway.
4. Send a simple test message through OpenClaw.
5. Confirm the trace appears in Langfuse.
6. Optionally run `npx clawtrace ui` to inspect local buffer and config state.

## Manual install fallback

If you cannot use the installer, copy these folders into the extension directory:

- `plugin/`
- `lib/`

The deployed extension must contain `index.js`, `openclaw.plugin.json`, and the `lib/` directory beside them.
