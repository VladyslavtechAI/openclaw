/**
 * Health checker with restart loop and zombie process detection.
 * Based on the Mar 17 Boris incident — stale-socket restart loop every 30 minutes.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type RestartEvent = {
  id: string;
  timestamp: string;
  machine: string;
  pid?: number;
  port?: number;
  reason?: string;
  /** Time in ms from restart to port listen (0 if not yet listening). */
  portBindTimeMs?: number;
};

export type ErrorEvent = {
  id: string;
  timestamp: string;
  machine: string;
  error: string;
  count?: number;
};

export type HealthAlert = {
  id: string;
  timestamp: string;
  severity: "warning" | "critical";
  rule: string;
  message: string;
  machine: string;
  details?: Record<string, unknown>;
};

export type HealthStatus = {
  machine: string;
  gatewayRunning: boolean;
  portListening: boolean;
  restartsLastHour: number;
  errorsLastHour: number;
  lastRestart?: string;
  lastError?: string;
  inRestartLoop: boolean;
  inErrorLoop: boolean;
};

export type HealthCheckerConfig = {
  /** Directory for health check log files. */
  logDir: string;
  /** Max restarts per hour before loop alert (default: 3). */
  restartLoopThreshold?: number;
  /** Max same-error repeats in window before loop alert (default: 5). */
  errorLoopThreshold?: number;
  /** Error loop window in ms (default: 600_000 = 10 minutes). */
  errorLoopWindowMs?: number;
  /** Max times same alert sent before escalation loop detected (default: 3). */
  escalationLoopThreshold?: number;
  /** Callback invoked on alerts. */
  onAlert?: (alert: HealthAlert) => void;
};

/**
 * Tracks gateway health, detects restart loops, error loops, and zombie processes.
 */
export class HealthChecker {
  private logDir: string;
  private restartLoopThreshold: number;
  private errorLoopThreshold: number;
  private errorLoopWindowMs: number;
  private escalationLoopThreshold: number;
  private onAlert: ((alert: HealthAlert) => void) | undefined;

  /** Restart timestamps per machine. */
  private restartHistory: Map<string, RestartEvent[]> = new Map();
  /** Error history per machine, keyed by error message. */
  private errorHistory: Map<string, ErrorEvent[]> = new Map();
  /** Alert send counts per rule+machine. */
  private alertSendCounts: Map<string, number> = new Map();
  /** Gateway status per machine. */
  private gatewayStatus: Map<string, { pid: number; port: number; running: boolean; listening: boolean }> = new Map();

  constructor(config: HealthCheckerConfig) {
    this.logDir = config.logDir;
    this.restartLoopThreshold = config.restartLoopThreshold ?? 3;
    this.errorLoopThreshold = config.errorLoopThreshold ?? 5;
    this.errorLoopWindowMs = config.errorLoopWindowMs ?? 600_000;
    this.escalationLoopThreshold = config.escalationLoopThreshold ?? 3;
    this.onAlert = config.onAlert;
    try {
      fs.mkdirSync(config.logDir, { recursive: true });
    } catch {
      // Never crash on directory creation failure
    }
  }

  /**
   * Record a gateway restart event.
   */
  recordRestart(event: Omit<RestartEvent, "id" | "timestamp"> & { timestamp?: string }): RestartEvent {
    const stored: RestartEvent = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: event.timestamp ?? new Date().toISOString(),
      machine: event.machine,
      ...(event.pid !== undefined && { pid: event.pid }),
      ...(event.port !== undefined && { port: event.port }),
      ...(event.reason !== undefined && { reason: event.reason }),
      ...(event.portBindTimeMs !== undefined && { portBindTimeMs: event.portBindTimeMs }),
    };

    const history = this.restartHistory.get(stored.machine) ?? [];
    history.push(stored);
    this.restartHistory.set(stored.machine, history);

    try {
      const filePath = path.join(this.logDir, `restarts-${new Date(stored.timestamp).toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(filePath, JSON.stringify(stored) + "\n");
    } catch {
      // Never crash on log write failure
    }

    // Check for restart loop
    this.checkRestartLoop(stored.machine, stored.timestamp);

    // Check for stale-socket pattern
    if (stored.reason?.includes("stale") || stored.reason?.includes("socket")) {
      this.checkStaleSocketPattern(stored);
    }

    return stored;
  }

  /**
   * Record an error event.
   */
  recordError(event: Omit<ErrorEvent, "id" | "timestamp"> & { timestamp?: string }): ErrorEvent {
    const stored: ErrorEvent = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: event.timestamp ?? new Date().toISOString(),
      machine: event.machine,
      error: event.error,
      ...(event.count !== undefined && { count: event.count }),
    };

    const key = `${stored.machine}:${stored.error}`;
    const history = this.errorHistory.get(key) ?? [];
    history.push(stored);
    this.errorHistory.set(key, history);

    try {
      const filePath = path.join(this.logDir, `errors-${new Date(stored.timestamp).toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(filePath, JSON.stringify(stored) + "\n");
    } catch {
      // Never crash on log write failure
    }

    this.checkErrorLoop(stored);

    return stored;
  }

  /**
   * Update gateway process status for a machine.
   */
  updateGatewayStatus(machine: string, status: { pid: number; port: number; running: boolean; listening: boolean }): void {
    this.gatewayStatus.set(machine, status);

    // Zombie detection: running but not listening
    if (status.running && !status.listening) {
      this.fireAlert({
        severity: "critical",
        rule: "zombie_gateway",
        message: `Gateway PID ${status.pid} running on ${machine} but port ${status.port} not listening (zombie)`,
        machine,
        details: { pid: status.pid, port: status.port },
      });
    }
  }

  /**
   * Get health status for a specific machine.
   */
  getStatus(machine: string): HealthStatus {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;

    const restarts = this.restartHistory.get(machine) ?? [];
    const recentRestarts = restarts.filter((r) => new Date(r.timestamp).getTime() > oneHourAgo);

    let recentErrors = 0;
    let lastError: string | undefined;
    for (const [key, errors] of this.errorHistory) {
      if (!key.startsWith(`${machine}:`)) continue;
      const recent = errors.filter((e) => new Date(e.timestamp).getTime() > oneHourAgo);
      recentErrors += recent.length;
      for (const err of recent) {
        if (!lastError || err.timestamp > lastError) {
          lastError = err.timestamp;
        }
      }
    }

    const gateway = this.gatewayStatus.get(machine);

    return {
      machine,
      gatewayRunning: gateway?.running ?? false,
      portListening: gateway?.listening ?? false,
      restartsLastHour: recentRestarts.length,
      errorsLastHour: recentErrors,
      lastRestart: recentRestarts.length > 0 ? recentRestarts[recentRestarts.length - 1].timestamp : undefined,
      lastError,
      inRestartLoop: recentRestarts.length >= this.restartLoopThreshold,
      inErrorLoop: this.isInErrorLoop(machine),
    };
  }

  /**
   * Get health status for all tracked machines.
   */
  getAllStatus(): HealthStatus[] {
    const machines = new Set<string>();
    for (const key of this.restartHistory.keys()) machines.add(key);
    for (const key of this.errorHistory.keys()) machines.add(key.split(":")[0]);
    for (const key of this.gatewayStatus.keys()) machines.add(key);

    return [...machines].map((m) => this.getStatus(m));
  }

  /**
   * Get restart count for a machine in the last hour.
   */
  getRestartCount(machine: string, windowMs?: number): number {
    const cutoff = Date.now() - (windowMs ?? 3_600_000);
    const restarts = this.restartHistory.get(machine) ?? [];
    return restarts.filter((r) => new Date(r.timestamp).getTime() > cutoff).length;
  }

  private checkRestartLoop(machine: string, timestamp: string): void {
    const oneHourAgo = new Date(timestamp).getTime() - 3_600_000;
    const restarts = this.restartHistory.get(machine) ?? [];
    const recentRestarts = restarts.filter((r) => new Date(r.timestamp).getTime() > oneHourAgo);

    if (recentRestarts.length >= this.restartLoopThreshold) {
      this.fireAlert({
        severity: "critical",
        rule: "restart_loop",
        message: `Restart loop detected: ${recentRestarts.length} restarts on ${machine} in last hour`,
        machine,
        details: { restartCount: recentRestarts.length, threshold: this.restartLoopThreshold },
      });
    }
  }

  private checkStaleSocketPattern(event: RestartEvent): void {
    this.fireAlert({
      severity: "warning",
      rule: "stale_socket",
      message: `Stale socket restart on ${event.machine}: ${event.reason}`,
      machine: event.machine,
      details: { reason: event.reason, pid: event.pid },
    });
  }

  private checkErrorLoop(event: ErrorEvent): void {
    const key = `${event.machine}:${event.error}`;
    const history = this.errorHistory.get(key) ?? [];
    const cutoff = new Date(event.timestamp).getTime() - this.errorLoopWindowMs;
    const recent = history.filter((e) => new Date(e.timestamp).getTime() > cutoff);

    if (recent.length >= this.errorLoopThreshold) {
      this.fireAlert({
        severity: "critical",
        rule: "error_loop",
        message: `Error loop detected: "${event.error}" repeated ${recent.length} times on ${event.machine} in ${this.errorLoopWindowMs / 60_000} minutes`,
        machine: event.machine,
        details: { error: event.error, count: recent.length },
      });
    }
  }

  private isInErrorLoop(machine: string): boolean {
    const cutoff = Date.now() - this.errorLoopWindowMs;
    for (const [key, errors] of this.errorHistory) {
      if (!key.startsWith(`${machine}:`)) continue;
      const recent = errors.filter((e) => new Date(e.timestamp).getTime() > cutoff);
      if (recent.length >= this.errorLoopThreshold) return true;
    }
    return false;
  }

  private fireAlert(partial: Omit<HealthAlert, "id" | "timestamp">): void {
    // Escalation loop detection
    const alertKey = `${partial.rule}:${partial.machine}`;
    const count = (this.alertSendCounts.get(alertKey) ?? 0) + 1;
    this.alertSendCounts.set(alertKey, count);

    if (count > this.escalationLoopThreshold) {
      // Suppress further alerts for this rule+machine to avoid wasting money
      if (count === this.escalationLoopThreshold + 1) {
        const escalationAlert: HealthAlert = {
          id: crypto.randomBytes(8).toString("hex"),
          timestamp: new Date().toISOString(),
          severity: "warning",
          rule: "escalation_loop",
          message: `Escalation loop: alert "${partial.rule}" on ${partial.machine} sent ${count} times — suppressing further`,
          machine: partial.machine,
          details: { suppressedRule: partial.rule, sendCount: count },
        };
        this.persistAlert(escalationAlert);
        try {
          this.onAlert?.(escalationAlert);
        } catch {
          // Callback errors must not propagate
        }
      }
      return;
    }

    const alert: HealthAlert = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    this.persistAlert(alert);

    try {
      this.onAlert?.(alert);
    } catch {
      // Callback errors must not propagate
    }
  }

  private persistAlert(alert: HealthAlert): void {
    try {
      const filePath = path.join(this.logDir, "health-alerts.jsonl");
      fs.appendFileSync(filePath, JSON.stringify(alert) + "\n");
    } catch {
      // Never crash on alert write failure
    }
  }
}
