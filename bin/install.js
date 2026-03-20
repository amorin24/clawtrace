#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

function findOpenClawWorkspace() {
  if (process.env.OPENCLAW_HOME) {
    return process.env.OPENCLAW_HOME;
  }

  const defaultPath = path.join(os.homedir(), '.openclaw', 'workspace');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

function verifyOpenClaw(workspacePath) {
  const configPath = path.join(workspacePath, 'openclaw.json');
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

function install() {
  console.log('=== Clawtrace Installer ===\n');

  const workspace = findOpenClawWorkspace();

  if (!workspace) {
    console.error('ERROR: Could not find OpenClaw workspace.');
    console.error('       Set OPENCLAW_HOME or ensure ~/.openclaw/workspace exists.');
    process.exit(1);
  }

  console.log(`Found OpenClaw workspace: ${workspace}`);

  if (!verifyOpenClaw(workspace)) {
    console.error(`ERROR: No openclaw.json found in ${workspace}`);
    console.error('       This does not appear to be a valid OpenClaw installation.');
    process.exit(1);
  }

  console.log('Verified OpenClaw installation.\n');

  const extensionsDir = path.join(workspace, '.openclaw', 'extensions');
  const pluginDir = path.join(extensionsDir, 'clawtrace');

  console.log(`Installing plugin to: ${pluginDir}`);

  const packageRoot = path.join(__dirname, '..');
  const pluginSource = path.join(packageRoot, 'plugin');
  const libSource = path.join(packageRoot, 'lib');

  try {
    if (!fs.existsSync(extensionsDir)) {
      fs.mkdirSync(extensionsDir, { recursive: true });
    }

    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }

    copyDirectory(pluginSource, pluginDir);

    const libDest = path.join(pluginDir, 'lib');
    copyDirectory(libSource, libDest);

    console.log('Plugin files copied successfully.\n');

    console.log('=== Configuration ===\n');
    console.log('Add the following environment variables to /etc/openclaw.env:\n');
    console.log('LANGFUSE_PUBLIC_KEY=pk-lf-...');
    console.log('LANGFUSE_SECRET_KEY=sk-lf-...');
    console.log('LANGFUSE_BASE_URL=https://cloud.langfuse.com  # Optional, defaults to Langfuse Cloud\n');
    console.log('Optional configuration:\n');
    console.log('LANGFUSE_CAPTURE_INPUT=true                    # Capture user messages');
    console.log('LANGFUSE_CAPTURE_OUTPUT=true                   # Capture agent responses');
    console.log('LANGFUSE_MAX_INPUT_CHARS=4000                  # Truncation limit for input');
    console.log('LANGFUSE_MAX_OUTPUT_CHARS=8000                 # Truncation limit for output');
    console.log('LANGFUSE_SECURITY_MONITOR=true                 # Enable injection detection');
    console.log('LANGFUSE_COST_TRACKING=true                    # Enable cost estimation');
    console.log('LANGFUSE_MULTI_AGENT_LINKING=true              # Enable parent/child trace linking\n');

    console.log('=== Next Steps ===\n');
    console.log('1. Add LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to /etc/openclaw.env');
    console.log('2. Restart the OpenClaw gateway');
    console.log('3. Agent traces will appear in your Langfuse dashboard\n');

    console.log('For more information: https://github.com/wngspan/clawtrace\n');
    console.log('Installation complete!');

  } catch (err) {
    console.error(`ERROR: Installation failed: ${err.message}`);
    process.exit(1);
  }
}

const command = process.argv[2];

if (command === 'install' || !command) {
  install();
} else {
  console.error(`Unknown command: ${command}`);
  console.error('Usage: npx clawtrace install');
  process.exit(1);
}
