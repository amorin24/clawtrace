# CLI reference

## Commands

### `clawtrace install`

Installs the plugin files into the OpenClaw extension directory.

```bash
npx clawtrace install
```

### `clawtrace ui`

Starts the local operator dashboard.

```bash
npx clawtrace ui
```

#### Options

- `--host <value>`: bind host, default `127.0.0.1`
- `--port <value>`: bind port, default `4310`

Examples:

```bash
npx clawtrace ui --port 4400
npx clawtrace ui --host 0.0.0.0 --port 4310
```

## Exit behavior

- `install` exits after copying files or reporting an error
- `ui` stays in the foreground until interrupted

## Intended usage

- Use `install` during deployment or package upgrades
- Use `ui` during troubleshooting, validation, or local ops review
