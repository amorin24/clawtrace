#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createUiServer } = require('../lib/ui-server.js');

function findOpenClawWorkspace(env = process.env) {
  if (env.OPENCLAW_HOME) {
    return env.OPENCLAW_HOME;
  }

  const defaultPath = path.join(os.homedir(), '.openclaw', 'workspace');
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function verifyOpenClaw(workspacePath) {
  const configPath = path.join(workspacePath, '..', 'openclaw.json');
  return fs.existsSync(configPath);
}

function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function install(options = {}) {
  const env = options.env || process.env;
  const stdout = options.stdout || process.stdout;
  const packageRoot = options.packageRoot || path.join(__dirname, '..');

  stdout.write('=== Clawtrace Installer ===\n\n');

  const workspace = findOpenClawWorkspace(env);
  if (!workspace) {
    throw new Error('Could not find OpenClaw workspace. Set OPENCLAW_HOME or ensure ~/.openclaw/workspace exists.');
  }

  stdout.write(`Found OpenClaw workspace: ${workspace}\n`);

  if (!verifyOpenClaw(workspace)) {
    throw new Error(`No openclaw.json found at ${path.join(workspace, '..', 'openclaw.json')}`);
  }

  stdout.write('Verified OpenClaw installation.\n\n');

  const extensionsDir = path.join(workspace, '.openclaw', 'extensions');
  const pluginDir = path.join(extensionsDir, 'clawtrace');
  const pluginSource = path.join(packageRoot, 'plugin');
  const libSource = path.join(packageRoot, 'lib');

  stdout.write(`Installing plugin to: ${pluginDir}\n`);

  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  if (!fs.existsSync(pluginDir)) {
    fs.mkdirSync(pluginDir, { recursive: true });
  }

  copyDirectory(pluginSource, pluginDir);
  copyDirectory(libSource, path.join(pluginDir, 'lib'));

  stdout.write('Plugin files copied successfully.\n\n');
  stdout.write('=== Configuration ===\n\n');
  stdout.write('Add the following environment variables to /etc/openclaw.env:\n\n');
  stdout.write('LANGFUSE_PUBLIC_KEY=pk-lf-...\n');
  stdout.write('LANGFUSE_SECRET_KEY=sk-lf-...\n');
  stdout.write('LANGFUSE_BASE_URL=https://cloud.langfuse.com  # Optional, defaults to Langfuse Cloud\n\n');
  stdout.write('Optional configuration:\n\n');
  stdout.write('LANGFUSE_CAPTURE_INPUT=true                    # Capture user messages\n');
  stdout.write('LANGFUSE_CAPTURE_OUTPUT=true                   # Capture agent responses\n');
  stdout.write('LANGFUSE_MAX_INPUT_CHARS=4000                  # Truncation limit for input\n');
  stdout.write('LANGFUSE_MAX_OUTPUT_CHARS=8000                 # Truncation limit for output\n');
  stdout.write('LANGFUSE_SECURITY_MONITOR=true                 # Enable injection detection\n');
  stdout.write('LANGFUSE_COST_TRACKING=true                    # Enable cost estimation when usage data is available\n');
  stdout.write('LANGFUSE_MULTI_AGENT_LINKING=true              # Enable parent/child trace linking when delegation hooks are available\n');
  stdout.write('LANGFUSE_BUFFER_PATH=' + path.join(os.tmpdir(), 'clawtrace-buffer.ndjson') + '   # Local retry buffer\n\n');
  stdout.write('=== Next Steps ===\n\n');
  stdout.write('1. Add LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to /etc/openclaw.env\n');
  stdout.write('2. Restart the OpenClaw gateway\n');
  stdout.write('3. Agent traces will appear in your Langfuse dashboard\n\n');
  stdout.write('For more information: https://github.com/amorin24/clawtrace\n\n');
  stdout.write('Installation complete!\n');

  return {
    extensionsDir,
    pluginDir,
    workspace
  };
}

function parseCliOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      continue;
    }

    const [flag, inlineValue] = value.split('=');
    const key = flag.replace(/^--/, '');
    options[key] = inlineValue !== undefined ? inlineValue : argv[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }
  }

  return options;
}

async function launchUi(argv = [], options = {}) {
  const stdout = options.stdout || process.stdout;
  const uiOptions = parseCliOptions(argv);
  const server = createUiServer({
    env: options.env || process.env,
    logger: options.logger || console,
    packageRoot: options.packageRoot || path.join(__dirname, '..')
  });

  const address = await server.start({
    host: uiOptions.host || '127.0.0.1',
    port: uiOptions.port ? Number.parseInt(uiOptions.port, 10) : 4310
  });

  stdout.write('=== Clawtrace UI ===\n\n');
  stdout.write(`Dashboard available at ${address.url}\n`);
  stdout.write('Press Ctrl+C to stop the server.\n');

  return {
    address,
    server
  };
}

async function runCommand(argv = process.argv.slice(2), options = {}) {
  const command = argv[0];
  const stderr = options.stderr || process.stderr;

  try {
    if (command === 'install' || !command) {
      install(options);
      return 0;
    }

    if (command === 'ui') {
      await launchUi(argv.slice(1), options);
      return 0;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (err) {
    stderr.write(`ERROR: ${err.message}\n`);
    if (command && !['install', 'ui'].includes(command)) {
      stderr.write('Usage: npx clawtrace install\n');
      stderr.write('   or: npx clawtrace ui [--host 127.0.0.1] [--port 4310]\n');
    }

    if (options.throwOnError) {
      throw err;
    }

    return 1;
  }
}

async function main(argv = process.argv.slice(2)) {
  const code = await runCommand(argv);
  if (code !== 0) {
    process.exit(code);
  }
}

module.exports = {
  copyDirectory,
  findOpenClawWorkspace,
  install,
  launchUi,
  main,
  parseCliOptions,
  runCommand,
  verifyOpenClaw
};

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  });
}
