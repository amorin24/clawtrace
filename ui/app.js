const refreshButton = document.getElementById('refreshButton');
const clearBufferButton = document.getElementById('clearBufferButton');
const statusText = document.getElementById('statusText');
const batchMeta = document.getElementById('batchMeta');

function formatBoolean(value) {
  return value ? 'enabled' : 'disabled';
}

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) {
    return 'n/a';
  }

  return new Date(value).toLocaleString();
}

function renderFacts(targetId, entries) {
  const element = document.getElementById(targetId);
  element.innerHTML = entries.map(([label, value]) => (
    `<div><dt>${label}</dt><dd>${value}</dd></div>`
  )).join('');
}

function renderFlags(flags) {
  const list = document.getElementById('captureFlags');
  list.innerHTML = Object.entries(flags).map(([label, enabled]) => (
    `<li class="${enabled ? 'pill pill-on' : 'pill pill-off'}">${label}: ${formatBoolean(enabled)}</li>`
  )).join('');
}

function renderBatches(state) {
  const tbody = document.getElementById('batchTable');
  if (state.recentBatches.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty">No buffered batches. The retry buffer is empty.</td>
      </tr>
    `;
    batchMeta.textContent = '0 buffered batches';
    return;
  }

  batchMeta.textContent = `${state.buffer.batchCount} buffered batch${state.buffer.batchCount === 1 ? '' : 'es'} at ${state.buffer.path}`;
  tbody.innerHTML = state.recentBatches.map((batch) => `
    <tr>
      <td>
        <strong>${batch.traceName}</strong>
        <div class="subtle">${batch.traceId || 'no trace id'}</div>
      </td>
      <td>${batch.eventCount}</td>
      <td>${batch.attempts}</td>
      <td><span class="status-chip ${batch.status === 'waiting' ? 'status-waiting' : 'status-ready'}">${batch.status}</span></td>
      <td>${formatDate(batch.timestamp)}</td>
      <td>${batch.nextRetryAt ? formatDate(batch.nextRetryAt) : 'ready now'}</td>
    </tr>
  `).join('');
}

async function fetchState() {
  statusText.textContent = 'Refreshing...';
  const response = await fetch('/api/status', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

function renderState(state) {
  renderFacts('packageSummary', [
    ['name', state.package.name],
    ['version', state.package.version],
    ['pricing table', `${state.pricing.knownModels} models (${state.pricing.version})`]
  ]);

  renderFacts('langfuseSummary', [
    ['configured', state.langfuse.configured ? 'yes' : 'no'],
    ['base url', state.langfuse.baseUrl],
    ['public key', state.langfuse.publicKeyPreview || 'not set']
  ]);

  renderFacts('bufferSummary', [
    ['path', state.buffer.path],
    ['exists', state.buffer.exists ? 'yes' : 'no'],
    ['size', formatBytes(state.buffer.sizeBytes)],
    ['last buffered', formatDate(state.buffer.lastBufferedAt)]
  ]);

  renderFacts('limitsSummary', [
    ['flush interval', `${state.limits.flushInterval} ms`],
    ['max retries', state.limits.maxRetries],
    ['retry base', `${state.limits.backoffBase} ms`],
    ['buffer limit', formatBytes(state.limits.maxBytes)]
  ]);

  renderFacts('hostSummary', [
    ['platform', state.host.platform],
    ['node', state.host.nodeVersion],
    ['input chars', state.limits.maxInputChars],
    ['output chars', state.limits.maxOutputChars]
  ]);

  renderFlags({
    input: state.capture.input,
    output: state.capture.output,
    security: state.capture.securityMonitoring,
    cost: state.capture.costTracking,
    linking: state.capture.multiAgentLinking
  });

  renderBatches(state);
  statusText.textContent = 'Up to date';
}

async function refresh() {
  try {
    const state = await fetchState();
    renderState(state);
  } catch (error) {
    statusText.textContent = `Error: ${error.message}`;
  }
}

async function clearBuffer() {
  statusText.textContent = 'Clearing buffer...';
  const response = await fetch('/api/buffer/clear', { method: 'POST' });
  if (!response.ok) {
    statusText.textContent = `Error: ${response.status}`;
    return;
  }

  const state = await response.json();
  renderState(state);
}

refreshButton.addEventListener('click', refresh);
clearBufferButton.addEventListener('click', clearBuffer);

refresh();
window.setInterval(refresh, 5000);
