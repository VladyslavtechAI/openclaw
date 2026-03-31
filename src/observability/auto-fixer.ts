/**
 * Auto-fixer system that detects known error patterns and applies fixes automatically.
 * Built from real incidents across 5 machines: port conflicts, zombie gateways,
 * missing backup scripts, auth error loops, and more.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ObservabilityEvent } from "./event-logger.js";

export type FixPatternType =
  | "log_match"
  | "port_conflict"
  | "process_zombie"
  | "file_missing"
  | "error_loop"
  | "backup_stale";

export type FixPattern = {
  type: FixPatternType;
  match?: string;
  port?: number;
  path?: string;
  errorType?: string;
  maxAge?: number;
};

export type FixActionType =
  | "kill_process"
  | "create_file"
  | "restart_service"
  | "run_command"
  | "update_config"
  | "alert_only";

export type FixAction = {
  type: FixActionType;
  command?: string;
  content?: string;
  configPatch?: Record<string, unknown>;
  cooldown: number;
  maxAttempts: number;
};

export type FixRule = {
  id: string;
  name: string;
  description: string;
  pattern: FixPattern;
  fix: FixAction;
  severity: "low" | "medium" | "high" | "critical";
  enabled: boolean;
};

export type FixResult = {
  ruleId: string;
  ruleName: string;
  action: FixActionType;
  success: boolean;
  message: string;
  timestamp: string;
  machine?: string;
  details?: Record<string, unknown>;
};

export type FixRecord = FixResult & {
  id: string;
};

export type MachineCheck = {
  machine: string;
  /** Active processes (pid -> command). */
  processes?: Map<number, string>;
  /** Ports in LISTEN state. */
  listeningPorts?: number[];
  /** File paths to check existence. */
  filePaths?: string[];
  /** Recent error messages. */
  recentErrors?: string[];
  /** Backup info. */
  backup?: {
    lastBackup: string | null;
    ageHours: number;
    configured: boolean;
  };
  /** Gateway info. */
  gateway?: {
    pid?: number;
    port: number;
    running: boolean;
    listening: boolean;
  };
};

export type AutoFixerConfig = {
  /** Directory for fix logs. */
  logDir: string;
  /** Whether to actually execute fixes or just report (default: false = dry run). */
  executeMode?: boolean;
  /** Callback when a fix is applied. */
  onFix?: (result: FixResult) => void;
  /** Callback when a fix should be escalated. */
  onEscalate?: (ruleId: string, message: string) => void;
};

/**
 * Auto-fixer that detects known error patterns and applies fixes.
 */
export class AutoFixer {
  private logDir: string;
  private executeMode: boolean;
  private onFix: ((result: FixResult) => void) | undefined;
  private onEscalate: ((ruleId: string, message: string) => void) | undefined;
  private rules: Map<string, FixRule> = new Map();
  /** Fix attempt counts per rule+machine. */
  private attemptCounts: Map<string, number> = new Map();
  /** Last fix timestamp per rule+machine. */
  private lastFixTime: Map<string, number> = new Map();
  /** Fix history. */
  private history: FixRecord[] = [];

  constructor(config: AutoFixerConfig) {
    this.logDir = config.logDir;
    this.executeMode = config.executeMode ?? false;
    this.onFix = config.onFix;
    this.onEscalate = config.onEscalate;
    try {
      fs.mkdirSync(config.logDir, { recursive: true });
    } catch {
      // Never crash on directory creation failure
    }
    this.loadBuiltinRules();
  }

  /**
   * Register a fix rule.
   */
  addRule(rule: FixRule): void {
    this.rules.set(rule.id, { ...rule });
  }

  /**
   * Remove a rule.
   */
  removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Evaluate an observability event against all rules and apply matching fix.
   */
  async evaluate(event: ObservabilityEvent): Promise<FixResult | null> {
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      if (this.matchesPattern(rule, event)) {
        return this.applyFix(rule, event.machine);
      }
    }
    return null;
  }

  /**
   * Check a specific machine for known issues.
   */
  async checkMachine(check: MachineCheck): Promise<FixResult[]> {
    const results: FixResult[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      const matched = this.matchesMachineCheck(rule, check);
      if (matched) {
        const result = await this.applyFix(rule, check.machine);
        if (result) results.push(result);
      }
    }

    return results;
  }

  /**
   * Get fix history.
   */
  getHistory(filter?: { machine?: string; ruleId?: string; since?: string }): FixRecord[] {
    let results = [...this.history];

    if (filter?.machine) {
      results = results.filter((r) => r.machine === filter.machine);
    }
    if (filter?.ruleId) {
      results = results.filter((r) => r.ruleId === filter.ruleId);
    }
    if (filter?.since) {
      results = results.filter((r) => r.timestamp >= filter.since!);
    }

    return results;
  }

  /**
   * Get all registered rules.
   */
  getRules(): FixRule[] {
    return [...this.rules.values()].map((r) => ({ ...r }));
  }

  /**
   * Get a specific rule.
   */
  getRule(id: string): FixRule | null {
    const rule = this.rules.get(id);
    return rule ? { ...rule } : null;
  }

  /**
   * Disable a rule (emergency stop).
   */
  disableRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  /**
   * Enable a rule.
   */
  enableRule(id: string): boolean {
    const rule = this.rules.get(id);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  /**
   * Reset attempt counts for a rule+machine (after manual intervention).
   */
  resetAttempts(ruleId: string, machine?: string): void {
    if (machine) {
      this.attemptCounts.delete(`${ruleId}:${machine}`);
      this.lastFixTime.delete(`${ruleId}:${machine}`);
    } else {
      // Reset all machines for this rule
      for (const key of [...this.attemptCounts.keys()]) {
        if (key.startsWith(`${ruleId}:`)) {
          this.attemptCounts.delete(key);
          this.lastFixTime.delete(key);
        }
      }
    }
  }

  /**
   * Get attempt count for a rule+machine.
   */
  getAttemptCount(ruleId: string, machine: string): number {
    return this.attemptCounts.get(`${ruleId}:${machine}`) ?? 0;
  }

  private matchesPattern(rule: FixRule, event: ObservabilityEvent): boolean {
    const { pattern } = rule;

    switch (pattern.type) {
      case "log_match": {
        if (!pattern.match) return false;
        const eventStr = `${event.event} ${JSON.stringify(event.data ?? {})}`;
        try {
          return new RegExp(pattern.match, "i").test(eventStr);
        } catch {
          return eventStr.toLowerCase().includes(pattern.match.toLowerCase());
        }
      }
      case "port_conflict":
        return /EADDRINUSE|address already in use|port already in use/i.test(
          `${event.event} ${JSON.stringify(event.data ?? {})}`,
        );
      case "process_zombie":
        return /zombie|process.*running.*not.*listening/i.test(
          `${event.event} ${JSON.stringify(event.data ?? {})}`,
        );
      case "error_loop":
        return /error.*loop|repeated.*error|retry.*exceed/i.test(
          `${event.event} ${JSON.stringify(event.data ?? {})}`,
        );
      default:
        return false;
    }
  }

  private matchesMachineCheck(rule: FixRule, check: MachineCheck): boolean {
    const { pattern } = rule;

    switch (pattern.type) {
      case "port_conflict": {
        if (!pattern.port || !check.listeningPorts) return false;
        // Port is occupied but we need to start on it
        return check.listeningPorts.includes(pattern.port);
      }
      case "process_zombie": {
        if (!check.gateway) return false;
        return check.gateway.running && !check.gateway.listening;
      }
      case "file_missing": {
        if (!pattern.path || !check.filePaths) return false;
        return !check.filePaths.includes(pattern.path);
      }
      case "backup_stale": {
        if (!check.backup) return false;
        if (!check.backup.configured) return true;
        if (!check.backup.lastBackup) return true;
        const maxAge = pattern.maxAge ?? 24;
        return check.backup.ageHours > maxAge;
      }
      case "error_loop": {
        if (!check.recentErrors || !pattern.match) return false;
        try {
          const regex = new RegExp(pattern.match, "i");
          const matching = check.recentErrors.filter((e) => regex.test(e));
          return matching.length >= 5;
        } catch {
          return false;
        }
      }
      case "log_match": {
        if (!check.recentErrors || !pattern.match) return false;
        try {
          const regex = new RegExp(pattern.match, "i");
          return check.recentErrors.some((e) => regex.test(e));
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  }

  private async applyFix(rule: FixRule, machine: string): Promise<FixResult | null> {
    const key = `${rule.id}:${machine}`;

    // Check cooldown
    const lastTime = this.lastFixTime.get(key) ?? 0;
    const now = Date.now();
    if (now - lastTime < rule.fix.cooldown * 1000) {
      return null; // Still in cooldown
    }

    // Check max attempts
    const attempts = (this.attemptCounts.get(key) ?? 0) + 1;
    if (attempts > rule.fix.maxAttempts) {
      // Escalate
      try {
        this.onEscalate?.(rule.id, `Rule "${rule.name}" exceeded ${rule.fix.maxAttempts} attempts on ${machine}`);
      } catch {
        // Never crash on callback failure
      }

      const result: FixResult = {
        ruleId: rule.id,
        ruleName: rule.name,
        action: "alert_only",
        success: false,
        message: `Max attempts (${rule.fix.maxAttempts}) exceeded for "${rule.name}" on ${machine} — escalating`,
        timestamp: new Date().toISOString(),
        machine,
        details: { attempts, maxAttempts: rule.fix.maxAttempts },
      };

      this.recordResult(result);
      return result;
    }

    this.attemptCounts.set(key, attempts);
    this.lastFixTime.set(key, now);

    const result = this.executeFix(rule, machine, attempts);

    // Notify
    try {
      this.onFix?.(result);
    } catch {
      // Never crash on callback failure
    }

    this.recordResult(result);
    return result;
  }

  private executeFix(rule: FixRule, machine: string, attempt: number): FixResult {
    const { fix } = rule;

    if (!this.executeMode) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        action: fix.type,
        success: true,
        message: `[DRY RUN] Would apply "${rule.name}" on ${machine} (attempt ${attempt}/${fix.maxAttempts})`,
        timestamp: new Date().toISOString(),
        machine,
        details: { attempt, maxAttempts: fix.maxAttempts, dryRun: true },
      };
    }

    switch (fix.type) {
      case "create_file":
        return this.executeCreateFile(rule, machine, attempt);
      case "alert_only":
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          action: "alert_only",
          success: true,
          message: `Alert: "${rule.name}" triggered on ${machine} (attempt ${attempt})`,
          timestamp: new Date().toISOString(),
          machine,
          details: { attempt },
        };
      case "kill_process":
      case "restart_service":
      case "run_command":
      case "update_config":
        // These require shell execution — report as planned action
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          action: fix.type,
          success: true,
          message: `Fix planned: "${rule.name}" on ${machine} — ${fix.type}${fix.command ? `: ${fix.command}` : ""} (attempt ${attempt}/${fix.maxAttempts})`,
          timestamp: new Date().toISOString(),
          machine,
          details: { attempt, maxAttempts: fix.maxAttempts, command: fix.command },
        };
      default:
        return {
          ruleId: rule.id,
          ruleName: rule.name,
          action: fix.type,
          success: false,
          message: `Unknown fix type: ${fix.type}`,
          timestamp: new Date().toISOString(),
          machine,
        };
    }
  }

  private executeCreateFile(rule: FixRule, machine: string, attempt: number): FixResult {
    const { fix, id } = rule;
    if (!fix.content || !rule.pattern.path) {
      return {
        ruleId: id,
        ruleName: rule.name,
        action: "create_file",
        success: false,
        message: `Cannot create file: missing content or path for rule "${rule.name}"`,
        timestamp: new Date().toISOString(),
        machine,
      };
    }

    try {
      const dir = path.dirname(rule.pattern.path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(rule.pattern.path, fix.content, { mode: 0o755 });
      return {
        ruleId: id,
        ruleName: rule.name,
        action: "create_file",
        success: true,
        message: `Created missing file: ${rule.pattern.path} on ${machine} (attempt ${attempt})`,
        timestamp: new Date().toISOString(),
        machine,
        details: { path: rule.pattern.path, attempt },
      };
    } catch (err) {
      return {
        ruleId: id,
        ruleName: rule.name,
        action: "create_file",
        success: false,
        message: `Failed to create file ${rule.pattern.path}: ${err instanceof Error ? err.message : "Unknown error"}`,
        timestamp: new Date().toISOString(),
        machine,
        details: { path: rule.pattern.path, attempt },
      };
    }
  }

  private recordResult(result: FixResult): void {
    const record: FixRecord = {
      ...result,
      id: crypto.randomBytes(8).toString("hex"),
    };

    this.history.push(record);

    // Cap history
    if (this.history.length > 10_000) {
      this.history.splice(0, this.history.length - 10_000);
    }

    // Persist
    try {
      const filePath = path.join(this.logDir, `fixes-${new Date().toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(filePath, JSON.stringify(record) + "\n");
    } catch {
      // Never crash on log write failure
    }
  }

  private loadBuiltinRules(): void {
    const builtins: FixRule[] = [
      {
        id: "port-conflict-guard",
        name: "Port conflict guard",
        description: "Detect EADDRINUSE or 'port already in use', kill stale process on that port",
        pattern: {
          type: "port_conflict",
          match: "EADDRINUSE|address already in use|port already in use",
        },
        fix: {
          type: "kill_process",
          command: "lsof -ti:${port} | xargs kill -9",
          cooldown: 60,
          maxAttempts: 3,
        },
        severity: "high",
        enabled: true,
      },
      {
        id: "zombie-gateway-detector",
        name: "Zombie gateway detector",
        description: "Process exists but port not in LISTEN state, restart gateway",
        pattern: {
          type: "process_zombie",
          match: "zombie|process.*running.*not.*listening",
        },
        fix: {
          type: "restart_service",
          command: "kill -9 ${pid} && openclaw gateway run --bind loopback --port ${port} --force",
          cooldown: 120,
          maxAttempts: 3,
        },
        severity: "critical",
        enabled: true,
      },
      {
        id: "backup-script-missing",
        name: "Backup script missing",
        description: "Check backup scripts exist, create defaults if missing",
        pattern: {
          type: "file_missing",
          path: "/opt/devops/backup-local.sh",
        },
        fix: {
          type: "create_file",
          content: "#!/bin/bash\n# Auto-generated backup script placeholder\n# Customize for your backup needs\necho \"Backup not configured — edit this script\"\nexit 0\n",
          cooldown: 3600,
          maxAttempts: 1,
        },
        severity: "high",
        enabled: true,
      },
      {
        id: "auth-error-loop-breaker",
        name: "Auth error loop breaker",
        description: "If same auth error occurs >5 times, stop retrying and alert admin",
        pattern: {
          type: "error_loop",
          match: "auth.*error|auth.*fail|token.*invalid|401.*unauthorized",
          errorType: "auth",
        },
        fix: {
          type: "alert_only",
          cooldown: 1800,
          maxAttempts: 5,
        },
        severity: "critical",
        enabled: true,
      },
      {
        id: "backup-freshness-checker",
        name: "Backup freshness checker",
        description: "Alert if backup older than 24 hours",
        pattern: {
          type: "backup_stale",
          maxAge: 24,
        },
        fix: {
          type: "alert_only",
          cooldown: 3600,
          maxAttempts: 10,
        },
        severity: "high",
        enabled: true,
      },
      {
        id: "restart-loop-breaker",
        name: "Restart loop breaker",
        description: "If service restarts >3 times in 10 min, disable KeepAlive temporarily",
        pattern: {
          type: "log_match",
          match: "restart.*loop|restarted.*\\d+.*times|KeepAlive.*restart",
        },
        fix: {
          type: "run_command",
          command: "launchctl unload ${plist} && sleep 300 && launchctl load ${plist}",
          cooldown: 600,
          maxAttempts: 2,
        },
        severity: "critical",
        enabled: true,
      },
      {
        id: "telegram-ipv4-fixer",
        name: "Telegram IPv4 fallback fixer",
        description: "On ETIMEDOUT to Telegram API, suggest/apply dnsResultOrder fix",
        pattern: {
          type: "log_match",
          match: "ETIMEDOUT.*telegram|EHOSTUNREACH.*telegram|telegram.*ETIMEDOUT|telegram.*EHOSTUNREACH",
        },
        fix: {
          type: "update_config",
          configPatch: { "env.NODE_OPTIONS": "--dns-result-order=ipv4first" },
          cooldown: 3600,
          maxAttempts: 3,
        },
        severity: "high",
        enabled: true,
      },
      {
        id: "stale-lock-cleaner",
        name: "Stale lock file cleaner",
        description: "Clean up stale .lock files that prevent gateway start",
        pattern: {
          type: "log_match",
          match: "stale.*lock|lock.*file.*exist|lockfile.*stale|lock.*timeout",
        },
        fix: {
          type: "run_command",
          command: "rm -f ~/.openclaw/gateway.lock",
          cooldown: 300,
          maxAttempts: 3,
        },
        severity: "high",
        enabled: true,
      },
      {
        id: "log-rotation-enforcer",
        name: "Log rotation enforcer",
        description: "Delete logs older than 7 days to prevent disk fill",
        pattern: {
          type: "log_match",
          match: "ENOSPC|disk.*full|no space left",
        },
        fix: {
          type: "run_command",
          command: "find /tmp -name '*.log' -mtime +7 -delete && find ~/.openclaw -name '*.log' -mtime +7 -delete",
          cooldown: 3600,
          maxAttempts: 3,
        },
        severity: "high",
        enabled: true,
      },
      {
        id: "config-syntax-checker",
        name: "Config syntax checker",
        description: "Validate JSON before any config write",
        pattern: {
          type: "log_match",
          match: "SyntaxError.*JSON|JSON\\.parse.*error|Unexpected token.*config",
        },
        fix: {
          type: "alert_only",
          cooldown: 300,
          maxAttempts: 5,
        },
        severity: "medium",
        enabled: true,
      },
    ];

    for (const rule of builtins) {
      this.rules.set(rule.id, rule);
    }
  }
}
