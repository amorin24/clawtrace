const crypto = require('crypto');
const os = require('os');
const path = require('path');

function generateId(prefix = 'trace') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function truncate(text, maxLength) {
  if (text === null || text === undefined) {
    return text;
  }

  const value = String(text);
  if (value.length <= maxLength) {
    return value;
  }

  return value.substring(0, maxLength) + `\n\n[truncated at ${maxLength} chars]`;
}

function defaultBufferPath() {
  return path.join(os.tmpdir(), 'clawtrace-buffer.ndjson');
}

function coerceTokenCount(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

module.exports = {
  coerceTokenCount,
  defaultBufferPath,
  generateId,
  truncate
};
