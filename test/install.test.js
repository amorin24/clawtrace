const { describe, test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { install, findOpenClawWorkspace, parseCliOptions, runCommand, verifyOpenClaw } = require('../bin/install.js');

describe('Installer', () => {
  test('findOpenClawWorkspace prefers OPENCLAW_HOME', () => {
    assert.strictEqual(findOpenClawWorkspace({ OPENCLAW_HOME: '/custom/workspace' }), '/custom/workspace');
  });

  test('verifyOpenClaw checks for sibling openclaw.json', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'clawtrace-install-'));
    const workspace = path.join(root, 'workspace');
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.writeFile(path.join(root, 'openclaw.json'), '{}', 'utf8');

    assert.strictEqual(verifyOpenClaw(workspace), true);

    await fsp.rm(root, { recursive: true, force: true });
  });

  test('install copies plugin and library files into the extension directory', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'clawtrace-install-'));
    const workspace = path.join(root, 'workspace');
    const stdout = [];
    const stderr = [];

    await fsp.mkdir(workspace, { recursive: true });
    await fsp.writeFile(path.join(root, 'openclaw.json'), '{}', 'utf8');

    const result = install({
      env: { OPENCLAW_HOME: workspace },
      packageRoot: path.join(__dirname, '..'),
      stdout: { write: (chunk) => stdout.push(chunk) },
      stderr: { write: (chunk) => stderr.push(chunk) }
    });

    const pluginRoot = path.join(result.pluginDir);
    assert.ok(fs.existsSync(path.join(pluginRoot, 'index.js')));
    assert.ok(fs.existsSync(path.join(pluginRoot, 'openclaw.plugin.json')));
    assert.ok(fs.existsSync(path.join(pluginRoot, 'lib', 'tracer.js')));
    assert.strictEqual(stderr.length, 0);
    assert.ok(stdout.join('').includes('Installation complete!'));

    await fsp.rm(root, { recursive: true, force: true });
  });

  test('parseCliOptions handles inline and spaced values', () => {
    const options = parseCliOptions(['--host', '0.0.0.0', '--port=4400']);
    assert.deepStrictEqual(options, { host: '0.0.0.0', port: '4400' });
  });

  test('runCommand reports usage on invalid command', async () => {
    const stderr = [];
    const code = await runCommand(['unknown'], {
      stderr: { write: (chunk) => stderr.push(chunk) }
    });

    assert.strictEqual(code, 1);
    assert.ok(stderr.join('').includes('Usage: npx clawtrace install'));
    assert.ok(stderr.join('').includes('npx clawtrace ui'));
  });
});
