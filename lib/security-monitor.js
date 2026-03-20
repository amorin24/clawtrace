const INJECTION_PATTERNS = [
  // Role/persona override attempts
  { pattern: /ignore (previous|all|above|prior) instructions/i, name: 'ignore_instructions', severity: 'high' },
  { pattern: /you are now/i, name: 'role_override', severity: 'high' },
  { pattern: /act as (a|an|the)/i, name: 'act_as', severity: 'medium' },
  { pattern: /pretend (you are|to be)/i, name: 'pretend', severity: 'medium' },
  { pattern: /your (new|real|actual) (instructions|role|purpose|goal)/i, name: 'new_instructions', severity: 'high' },
  { pattern: /disregard (your|all|previous)/i, name: 'disregard', severity: 'high' },
  { pattern: /forget (your|all|previous)/i, name: 'forget', severity: 'high' },
  { pattern: /system prompt/i, name: 'system_prompt', severity: 'high' },
  { pattern: /\[system\]/i, name: 'system_tag', severity: 'high' },
  { pattern: /\[\[.*\]\]/, name: 'double_bracket', severity: 'medium' },

  // Command injection attempts
  { pattern: /```(bash|sh|shell|cmd|powershell)/i, name: 'code_block_shell', severity: 'medium' },
  { pattern: /rm -rf/i, name: 'rm_rf', severity: 'high' },
  { pattern: /sudo /i, name: 'sudo', severity: 'high' },
  { pattern: /eval\(/i, name: 'eval', severity: 'high' },
  { pattern: /exec\(/i, name: 'exec', severity: 'high' },

  // Encoding-based evasion
  { pattern: /base64/i, name: 'base64', severity: 'low' },
  { pattern: /atob\(/i, name: 'atob', severity: 'medium' },
  { pattern: /btoa\(/i, name: 'btoa', severity: 'medium' },

  // Data exfiltration patterns
  { pattern: /send (this|the|all|my|your) (to|via|through)/i, name: 'send_data', severity: 'high' },
  { pattern: /exfiltrate/i, name: 'exfiltrate', severity: 'high' },
  { pattern: /leak/i, name: 'leak', severity: 'low' },
];

const DESTRUCTIVE_TOOL_PATTERNS = [
  { pattern: /delete|remove|rm|unlink/i, category: 'file_deletion' },
  { pattern: /send|reply|compose|draft/i, category: 'outbound_communication' },
  { pattern: /exec|run|execute|shell/i, category: 'command_execution' },
  { pattern: /write|edit|modify|update/i, category: 'file_modification' },
];

class SecurityMonitor {
  constructor(config) {
    this.enabled = config?.enabled !== false;
    this.logger = config?.logger || console;
  }

  scanInput(message) {
    if (!this.enabled || !message) {
      return { detected: false, patterns: [], severity: 'low' };
    }

    const detectedPatterns = [];
    let maxSeverity = 'low';

    for (const { pattern, name, severity } of INJECTION_PATTERNS) {
      if (pattern.test(message)) {
        detectedPatterns.push({ name, severity });

        if (severity === 'high') {
          maxSeverity = 'high';
        } else if (severity === 'medium' && maxSeverity !== 'high') {
          maxSeverity = 'medium';
        }
      }
    }

    const result = {
      detected: detectedPatterns.length > 0,
      patterns: detectedPatterns,
      severity: maxSeverity
    };

    if (result.detected) {
      this.logger.warn(`[clawtrace] Security: Detected ${detectedPatterns.length} injection pattern(s) — severity: ${maxSeverity}`);
    }

    return result;
  }

  scanToolCall(name, args) {
    if (!this.enabled || !name) {
      return null;
    }

    const toolString = `${name} ${JSON.stringify(args || {})}`.toLowerCase();

    for (const { pattern, category } of DESTRUCTIVE_TOOL_PATTERNS) {
      if (pattern.test(toolString)) {
        const result = {
          destructive: true,
          category,
          reason: `Tool matches destructive pattern: ${category}`
        };

        this.logger.warn(`[clawtrace] Security: Destructive tool call detected — ${category}: ${name}`);
        return result;
      }
    }

    return null;
  }

  buildSecuritySpan(detection) {
    if (!detection || !detection.detected) {
      return null;
    }

    const timestamp = new Date().toISOString();
    const spanId = `security-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    return {
      id: spanId,
      type: 'span-create',
      body: {
        id: spanId,
        name: 'security-check',
        startTime: timestamp,
        endTime: timestamp,
        metadata: {
          detected: detection.detected,
          severity: detection.severity,
          patterns: detection.patterns.map(p => p.name),
          pattern_count: detection.patterns.length
        },
        level: detection.severity === 'high' ? 'ERROR' : detection.severity === 'medium' ? 'WARNING' : 'DEFAULT',
        statusMessage: `Detected ${detection.patterns.length} potential injection pattern(s)`
      }
    };
  }
}

module.exports = SecurityMonitor;
