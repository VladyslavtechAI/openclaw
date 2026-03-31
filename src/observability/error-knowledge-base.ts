/**
 * Knowledge base of all known errors with causes, fixes, and occurrence history.
 * Pre-populated with real incidents from the fleet of 5 machines.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ErrorOccurrence = {
  timestamp: string;
  machine: string;
  details?: string;
};

export type KnownError = {
  id: string;
  pattern: string;
  category: string;
  title: string;
  cause: string;
  fix: string;
  automated: boolean;
  severity: "low" | "medium" | "high" | "critical";
  occurrences: ErrorOccurrence[];
  preventionStrategy: string;
};

export type ErrorKnowledgeBaseConfig = {
  /** Directory for knowledge base persistence. */
  logDir?: string;
};

/**
 * Knowledge base of all known errors with causes, fixes, and occurrence tracking.
 */
export class ErrorKnowledgeBase {
  private errors: Map<string, KnownError> = new Map();
  private logDir: string | undefined;

  constructor(config: ErrorKnowledgeBaseConfig = {}) {
    this.logDir = config.logDir;
    if (this.logDir) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
      } catch {
        // Never crash on directory creation failure
      }
    }
    this.loadBuiltinErrors();
  }

  /**
   * Match an error message to known errors.
   */
  identify(errorMsg: string): KnownError | null {
    if (!errorMsg || typeof errorMsg !== "string") return null;

    for (const error of this.errors.values()) {
      try {
        const regex = new RegExp(error.pattern, "i");
        if (regex.test(errorMsg)) {
          return { ...error, occurrences: [...error.occurrences] };
        }
      } catch {
        // Invalid regex pattern — try substring match
        if (errorMsg.toLowerCase().includes(error.pattern.toLowerCase())) {
          return { ...error, occurrences: [...error.occurrences] };
        }
      }
    }

    return null;
  }

  /**
   * Record an occurrence of a known error.
   */
  record(errorId: string, machine: string, details?: string): void {
    const error = this.errors.get(errorId);
    if (!error) return;

    const occurrence: ErrorOccurrence = {
      timestamp: new Date().toISOString(),
      machine,
      ...(details !== undefined && { details }),
    };

    error.occurrences.push(occurrence);

    // Persist occurrence
    if (this.logDir) {
      try {
        const filePath = path.join(this.logDir, `error-occurrences-${new Date().toISOString().slice(0, 10)}.jsonl`);
        fs.appendFileSync(filePath, JSON.stringify({ errorId, ...occurrence }) + "\n");
      } catch {
        // Never crash on log write failure
      }
    }
  }

  /**
   * Get all known errors.
   */
  getAll(): KnownError[] {
    return [...this.errors.values()].map((e) => ({
      ...e,
      occurrences: [...e.occurrences],
    }));
  }

  /**
   * Get a specific known error by id.
   */
  get(id: string): KnownError | null {
    const error = this.errors.get(id);
    if (!error) return null;
    return { ...error, occurrences: [...error.occurrences] };
  }

  /**
   * Get errors sorted by occurrence frequency (most common first).
   */
  getTopErrors(limit: number): KnownError[] {
    return [...this.errors.values()]
      .sort((a, b) => b.occurrences.length - a.occurrences.length)
      .slice(0, Math.max(0, limit))
      .map((e) => ({ ...e, occurrences: [...e.occurrences] }));
  }

  /**
   * Get errors by category.
   */
  getByCategory(category: string): KnownError[] {
    return [...this.errors.values()]
      .filter((e) => e.category === category)
      .map((e) => ({ ...e, occurrences: [...e.occurrences] }));
  }

  /**
   * Get errors by severity.
   */
  getBySeverity(severity: KnownError["severity"]): KnownError[] {
    return [...this.errors.values()]
      .filter((e) => e.severity === severity)
      .map((e) => ({ ...e, occurrences: [...e.occurrences] }));
  }

  /**
   * Add a new known error.
   */
  add(error: KnownError): void {
    this.errors.set(error.id, {
      ...error,
      occurrences: [...error.occurrences],
    });
  }

  /**
   * Remove a known error by id.
   */
  remove(id: string): boolean {
    return this.errors.delete(id);
  }

  /**
   * Get total number of known errors.
   */
  size(): number {
    return this.errors.size;
  }

  /**
   * Export knowledge base as JSON string.
   */
  export(): string {
    const errors = this.getAll();
    return JSON.stringify(errors, null, 2);
  }

  /**
   * Import errors from a JSON string. Merges with existing.
   */
  import(json: string): number {
    let imported = 0;
    try {
      const errors = JSON.parse(json) as KnownError[];
      if (!Array.isArray(errors)) return 0;
      for (const error of errors) {
        if (error && typeof error === "object" && error.id && error.pattern) {
          this.errors.set(error.id, {
            ...error,
            occurrences: Array.isArray(error.occurrences) ? error.occurrences : [],
          });
          imported++;
        }
      }
    } catch {
      // Invalid JSON
    }
    return imported;
  }

  private loadBuiltinErrors(): void {
    const builtins: KnownError[] = [
      {
        id: "eaddrinuse",
        pattern: "EADDRINUSE|address already in use|port already in use|port.*already.*bound",
        category: "port",
        title: "Port already in use (EADDRINUSE)",
        cause: "Another process is already listening on the required port. Common with gateway restarts or token-dashboard on port 3848.",
        fix: "Kill the stale process: `lsof -ti:<port> | xargs kill -9`, then restart the service.",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Check port availability before starting. Use SO_REUSEADDR. Add pre-start check to launchagent.",
      },
      {
        id: "exit-127",
        pattern: "exit code:?\\s*127|exit 127|command not found|No such file or directory.*\\.sh",
        category: "script",
        title: "Command or script not found (exit 127)",
        cause: "Binary or script does not exist at the expected path. Often backup-local.sh or backup-central.sh missing from Mini 2.",
        fix: "Create the missing script or fix PATH. For backup scripts: create default scripts at /opt/devops/backup-*.sh",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Validate script existence in deployment checklist. Add file existence pre-check to launchagent.",
      },
      {
        id: "gateway-already-running",
        pattern: "gateway.*already running|lock timeout|another instance|lockfile.*held",
        category: "gateway",
        title: "Gateway lock conflict",
        cause: "A previous gateway process left a stale lock file, preventing new instance from starting.",
        fix: "Remove the stale lock file and restart. Check for zombie processes first.",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Add lock file cleanup to graceful shutdown. Use PID-based lock validation.",
      },
      {
        id: "stale-socket-restart",
        pattern: "stale.*socket|socket.*stale|ECONNREFUSED.*restart",
        category: "gateway",
        title: "Stale socket restart loop",
        cause: "Gateway socket left behind after crash. LaunchAgent detects unhealthy state and restarts every 30 minutes.",
        fix: "Remove the stale socket file and restart once. Based on Mar 17 Boris incident.",
        automated: true,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "Clean up socket files on startup. Add socket file age check.",
      },
      {
        id: "auth-profiles-parse",
        pattern: "auth-profiles.*parse|JSON\\.parse.*auth|SyntaxError.*auth-profiles|Unexpected token.*auth",
        category: "auth",
        title: "Auth profiles JSON parse error",
        cause: "auth-profiles.json is malformed or contains trailing comma, BOM, or invalid encoding.",
        fix: "Validate and fix the JSON. Use `openclaw config validate` to check all config files.",
        automated: false,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "Always validate JSON before writing. Use config guardian pre-commit validation.",
      },
      {
        id: "auth-suffix-format",
        pattern: "type.*contains.*colon|anthropic:main|provider:suffix",
        category: "auth",
        title: "Auth profile suffix format wrong",
        cause: "Profile type uses wrong format 'provider:suffix' instead of just 'provider'. Based on Mar 23 Trinity incident.",
        fix: "Change type from 'anthropic:main' to just 'anthropic' in auth-profiles.json.",
        automated: false,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Auth validator checks for colon in type field. Use config guardian warnings.",
      },
      {
        id: "config-field-typo",
        pattern: "fallbacks.*fallback|fallback.*fallbacks|possible typo",
        category: "config",
        title: "Configuration field typo",
        cause: "Common field name typos: 'fallbacks' vs 'fallback', 'models' vs 'model'.",
        fix: "Correct the field name. Config guardian detects known typos automatically.",
        automated: false,
        severity: "medium",
        occurrences: [],
        preventionStrategy: "Use config guardian validation on all config writes.",
      },
      {
        id: "cost-field-wrong-location",
        pattern: "cost.*should be.*models|cost.*provider level",
        category: "config",
        title: "Cost field in wrong location",
        cause: "'cost' placed at provider level instead of inside models[] array.",
        fix: "Move 'cost' inside the appropriate models[] entry.",
        automated: false,
        severity: "medium",
        occurrences: [],
        preventionStrategy: "Config guardian validates provider structure on write.",
      },
      {
        id: "network-timeout",
        pattern: "ETIMEDOUT|EHOSTUNREACH|ECONNREFUSED|ENETUNREACH|network.*timeout|connection.*timed.*out",
        category: "network",
        title: "Network timeout or unreachable host",
        cause: "Target host unreachable. For Telegram: IPv6 routing issue on Mac Studio. General: DNS or firewall issue.",
        fix: "For Telegram IPv4: set `--dns-result-order=ipv4first` or `NODE_OPTIONS=--dns-result-order=ipv4first`. General: check DNS and firewall.",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Configure dnsResultOrder in openclaw.json env. Add network health check to monitoring.",
      },
      {
        id: "backup-stale",
        pattern: "backup.*stale|backup.*old|no.*recent.*backup|backup.*not.*running",
        category: "backup",
        title: "Backup is stale or not running",
        cause: "Backup cron/launchagent not configured, disabled, or script failing silently.",
        fix: "Check launchagent status. Verify backup script exists and is executable. Check cron logs.",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Resource monitor checks backup freshness. Alert on backup age > 24h.",
      },
      {
        id: "auth-error-loop",
        pattern: "auth.*error.*loop|repeated.*auth.*fail|auth.*retry.*exceed",
        category: "auth",
        title: "Auth error retry loop",
        cause: "VPS autofix keeps retrying failed auth fix every 30 min without success. Based on Mini 2/3 incidents.",
        fix: "Stop the autofix retry loop. Fix the root auth issue manually, then re-enable autofix.",
        automated: true,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "Auto-fixer has maxAttempts limit and cooldown. Escalate after 5 failures.",
      },
      {
        id: "agent-frozen",
        pattern: "agent.*frozen|agent.*hung|agent.*not responding|agent.*stuck",
        category: "agent",
        title: "Agent frozen or unresponsive",
        cause: "Agent process is alive but not processing requests. May be stuck in a long-running tool call or deadlocked.",
        fix: "Send SIGTERM to the agent process. If unresponsive, SIGKILL and restart.",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Health checker monitors agent response times. Kill after configurable timeout.",
      },
      {
        id: "telegram-bot-error",
        pattern: "telegram.*invalid.*token|401.*telegram|bot.*token.*invalid|Unauthorized.*telegram",
        category: "telegram",
        title: "Telegram bot token invalid",
        cause: "Bot token is expired, revoked, or malformed. Raw token stored with prefix.",
        fix: "Regenerate bot token via @BotFather. Store raw token only (no DISCORD_BOT_TOKEN= prefix).",
        automated: false,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "Auth validator checks token format. Alert immediately on 401.",
      },
      {
        id: "version-outdated",
        pattern: "version.*outdated|update.*available|newer.*version",
        category: "maintenance",
        title: "OpenClaw version outdated",
        cause: "Running an old version of OpenClaw. May miss bug fixes and security patches.",
        fix: "`sudo npm i -g openclaw@latest` on each machine.",
        automated: false,
        severity: "low",
        occurrences: [],
        preventionStrategy: "Regular update schedule. Version check in monitoring dashboard.",
      },
      {
        id: "gateway-down",
        pattern: "gateway.*down|gateway.*not.*running|port.*not.*listening|gateway.*unreachable",
        category: "gateway",
        title: "Gateway not running",
        cause: "Gateway process crashed, was killed, or failed to start.",
        fix: "Check logs, restart gateway: `pkill -9 -f openclaw-gateway || true; nohup openclaw gateway run --bind loopback --port 18789 --force > /tmp/openclaw-gateway.log 2>&1 &`",
        automated: true,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "LaunchAgent KeepAlive. Health checker monitors gateway port.",
      },
      {
        id: "ssh-unreachable",
        pattern: "ssh.*unreachable|SSH.*timeout|Connection.*refused.*22|ssh.*connection.*reset",
        category: "network",
        title: "SSH unreachable",
        cause: "Machine is down, network issue, or SSH service not running. Often caused by high RAM pressure on Mini 2.",
        fix: "Check machine status via alternative access (web terminal, physical). May need hard reboot.",
        automated: false,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "RAM monitoring with alert at 80%. Tailscale mesh for backup connectivity.",
      },
      {
        id: "sigterm-exit",
        pattern: "SIGTERM|signal.*15|exit.*signal.*TERM|killed.*graceful",
        category: "process",
        title: "Process terminated (SIGTERM)",
        cause: "Process received SIGTERM signal. Usually from a clean shutdown or service manager restart.",
        fix: "Check if intentional. If not, check who sent the signal (launchagent, user, OOM killer).",
        automated: false,
        severity: "medium",
        occurrences: [],
        preventionStrategy: "Log signal source. Check if launchagent KeepAlive is causing restart loops.",
      },
      {
        id: "sigkill-exit",
        pattern: "SIGKILL|signal.*9|exit.*signal.*KILL|killed.*force|killed.*-9",
        category: "process",
        title: "Process force-killed (SIGKILL)",
        cause: "Process was force-killed. Often OOM killer or manual intervention.",
        fix: "Check system logs for OOM events. Review memory usage trends.",
        automated: false,
        severity: "high",
        occurrences: [],
        preventionStrategy: "RAM monitoring. Set memory limits. Investigate memory leaks.",
      },
      {
        id: "memory-pressure",
        pattern: "memory.*pressure|OOM|out of memory|cannot allocate|allocation.*fail|mach_vm_map",
        category: "resource",
        title: "Memory pressure / OOM",
        cause: "System running low on RAM. Can cause Tailscale timeouts, SSH unreachable, and process kills.",
        fix: "Identify memory-hungry processes. Restart agents with high RSS. Consider adding swap.",
        automated: true,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "RAM alerts at 80%/90%. Resource monitor tracks per-machine memory.",
      },
      {
        id: "path-not-found",
        pattern: "PATH.*not.*found|binary.*not found|which.*not found|command not found",
        category: "environment",
        title: "Binary not found in PATH",
        cause: "Required binary not in PATH. Common in launchagent/cron contexts where PATH is minimal.",
        fix: "Add the binary's directory to PATH in openclaw.json env.PATH or launchagent EnvironmentVariables.",
        automated: true,
        severity: "medium",
        occurrences: [],
        preventionStrategy: "Auth validator checks env.PATH includes homebrew paths. LaunchAgent should set full PATH.",
      },
      {
        id: "zombie-gateway",
        pattern: "zombie.*gateway|process.*running.*not.*listening|pid.*exists.*port.*not",
        category: "gateway",
        title: "Gateway zombie process",
        cause: "Gateway process exists (PID alive) but port is not in LISTEN state. Based on Mini 1 SIGUSR1 incident.",
        fix: "Kill the zombie process and restart: `kill -9 <pid>`, then start gateway.",
        automated: true,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "Health checker monitors both PID and port LISTEN state. Alert on mismatch.",
      },
      {
        id: "stale-lock-file",
        pattern: "stale.*lock|lock.*file.*exist|\\.lock.*already|lockfile.*stale",
        category: "gateway",
        title: "Stale lock file preventing start",
        cause: "Lock file left behind by crashed process. New process refuses to start.",
        fix: "Remove the stale lock file after verifying no process is actually running.",
        automated: true,
        severity: "high",
        occurrences: [],
        preventionStrategy: "Validate lock file PID on startup. Auto-clean locks from dead processes.",
      },
      {
        id: "disk-full",
        pattern: "ENOSPC|no space left|disk.*full|disk.*quota|write.*failed.*space",
        category: "resource",
        title: "Disk full (ENOSPC)",
        cause: "Disk is full. Often from unrotated logs or accumulated backup files.",
        fix: "Clean old logs: `find /tmp -name '*.log' -mtime +7 -delete`. Check backup retention. Clean npm cache.",
        automated: true,
        severity: "critical",
        occurrences: [],
        preventionStrategy: "Log rotation enforcer. Disk usage monitoring at 80%/90% thresholds.",
      },
    ];

    for (const error of builtins) {
      this.errors.set(error.id, error);
    }
  }
}
