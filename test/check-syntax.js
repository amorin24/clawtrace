const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function collectFiles(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(entryPath);
    }
  }

  return files;
}

const roots = ['bin', 'lib', 'plugin', 'test', 'ui'].map((dir) => path.join(__dirname, '..', dir));
const files = roots.flatMap(collectFiles);
let hasFailure = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    hasFailure = true;
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }
}

if (hasFailure) {
  process.exit(1);
}
