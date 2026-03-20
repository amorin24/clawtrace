const fs = require('fs').promises;
const path = require('path');
const { Buffer: NodeBuffer } = require('buffer');

class Buffer {
  constructor(config, langfuseClient) {
    this.bufferPath = config.bufferPath || '/tmp/clawtrace-buffer.ndjson';
    this.maxBytes = config.maxBytes || 10485760; // 10MB
    this.flushInterval = config.flushInterval || 30000; // 30s
    this.maxRetries = config.maxRetries || 5;
    this.backoffBase = config.backoffBase || 1000;
    this.client = langfuseClient;
    this.flushTimer = null;
    this.isShuttingDown = false;
    this.logger = config.logger || console;
  }

  async write(events) {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    try {
      await this.ensureDirectory();

      const entry = {
        timestamp: new Date().toISOString(),
        attempts: 0,
        events
      };

      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.bufferPath, line, 'utf8');

      await this.enforceMaxSize();
    } catch (err) {
      this.logger.error(`[clawtrace] Failed to write to buffer: ${err.message}`);
    }
  }

  async ensureDirectory() {
    const dir = path.dirname(this.bufferPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }
  }

  async enforceMaxSize() {
    try {
      const currentSize = await this.size();
      if (currentSize <= this.maxBytes) {
        return;
      }

      const lines = await this.readLines();
      const kept = [];
      const dropped = [];
      let currentBytes = 0;

      for (let i = lines.length - 1; i >= 0; i--) {
        const lineBytes = NodeBuffer.byteLength(lines[i] + '\n', 'utf8');
        if (currentBytes + lineBytes <= this.maxBytes) {
          kept.unshift(lines[i]);
          currentBytes += lineBytes;
        } else {
          dropped.push(lines[i]);
        }
      }

      if (dropped.length > 0) {
        await this.writeLines(kept);
        const totalEvents = dropped.reduce((sum, line) => {
          try {
            return sum + JSON.parse(line).events.length;
          } catch {
            return sum;
          }
        }, 0);
        this.logger.warn(`[clawtrace] Buffer exceeded ${this.maxBytes} bytes — dropped ${dropped.length} batches (${totalEvents} events)`);
      }
    } catch (err) {
      this.logger.error(`[clawtrace] Failed to enforce buffer size limit: ${err.message}`);
    }
  }

  async flush() {
    if (this.isShuttingDown && this.flushTimer) {
      return;
    }

    try {
      const lines = await this.readLines();
      if (lines.length === 0) {
        return;
      }

      const entries = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      const remaining = [];
      const succeeded = [];

      for (const entry of entries) {
        if (entry.attempts >= this.maxRetries) {
          const eventCount = entry.events.length;
          this.logger.warn(`[clawtrace] Dropping batch after ${this.maxRetries} retries (${eventCount} events)`);
          continue;
        }

        const result = await this.client.ingest(entry.events);

        if (result.ok) {
          succeeded.push(entry);
        } else {
          entry.attempts += 1;

          if (result.error === 'auth') {
            this.logger.warn(`[clawtrace] Auth error during flush — dropping batch (${entry.events.length} events)`);
            continue;
          }

          remaining.push(entry);
        }
      }

      await this.writeLines(remaining.map(e => JSON.stringify(e)));

      if (succeeded.length > 0) {
        const totalEvents = succeeded.reduce((sum, e) => sum + e.events.length, 0);
        this.logger.info(`[clawtrace] Flushed ${succeeded.length} batches (${totalEvents} events)`);
      }
    } catch (err) {
      this.logger.error(`[clawtrace] Flush failed: ${err.message}`);
    }
  }

  async readLines() {
    try {
      const content = await fs.readFile(this.bufferPath, 'utf8');
      return content.trim().split('\n').filter(line => line.length > 0);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async writeLines(lines) {
    if (lines.length === 0) {
      try {
        await fs.unlink(this.bufferPath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      return;
    }

    const content = lines.join('\n') + '\n';
    await fs.writeFile(this.bufferPath, content, 'utf8');
  }

  async size() {
    try {
      const stats = await fs.stat(this.bufferPath);
      return stats.size;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return 0;
      }
      throw err;
    }
  }

  async count() {
    const lines = await this.readLines();
    return lines.length;
  }

  start() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch(err => {
        this.logger.error(`[clawtrace] Background flush error: ${err.message}`);
      });
    }, this.flushInterval);

    this.flushTimer.unref();
  }

  async stop() {
    this.isShuttingDown = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }
}

module.exports = Buffer;
