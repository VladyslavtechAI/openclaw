/**
 * Detects destructive agent interventions — bulk deletions, LaunchAgent modifications,
 * and critical path changes. Based on the Mar 2 incident where an agent deleted all
 * LaunchAgents thinking they were duplicates.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type InterventionType =
  | "file_delete"
  | "service_stop"
  | "config_overwrite"
  | "launchagent_modify"
  | "critical_path_modify";

export type InterventionEvent = {
  id: string;
  timestamp: string;
  type: InterventionType;
  machine: string;
  agentId?: string;
  filePath: string;
  details?: string;
};

export type InterventionAlert = {
  id: string;
  timestamp: string;
  severity: "warning" | "critical";
  rule: string;
  message: string;
  events: InterventionEvent[];
};

export type InterventionDetectorConfig = {
  /** Directory for intervention log files. */
  logDir: string;
  /** Max deletions before alerting (default: 3). */
  bulkDeleteThreshold?: number;
  /** Window in ms for bulk operations (default: 60_000). */
  bulkWindowMs?: number;
  /** Critical paths to monitor. */
  criticalPaths?: string[];
  /** Callback invoked on alerts. */
  onAlert?: (alert: InterventionAlert) => void;
};

const DEFAULT_CRITICAL_PATHS = [
  "/.openclaw/",
  "/opt/devops/",
  "/Library/LaunchAgents/",
  "/Library/LaunchDaemons/",
];

const LAUNCHAGENT_PATTERNS = [
  "/LaunchAgents/",
  "/LaunchDaemons/",
  ".plist",
];

/**
 * Tracks destructive operations and alerts on suspicious patterns.
 */
export class InterventionDetector {
  private logDir: string;
  private bulkDeleteThreshold: number;
  private bulkWindowMs: number;
  private criticalPaths: string[];
  private onAlert: ((alert: InterventionAlert) => void) | undefined;

  /** Recent events by type, keyed by machine. */
  private recentEvents: Map<string, InterventionEvent[]> = new Map();

  constructor(config: InterventionDetectorConfig) {
    this.logDir = config.logDir;
    this.bulkDeleteThreshold = config.bulkDeleteThreshold ?? 3;
    this.bulkWindowMs = config.bulkWindowMs ?? 60_000;
    this.criticalPaths = config.criticalPaths ?? DEFAULT_CRITICAL_PATHS;
    this.onAlert = config.onAlert;
    try {
      fs.mkdirSync(config.logDir, { recursive: true });
    } catch {
      // Never crash on directory creation failure
    }
  }

  /**
   * Record a file system or service intervention.
   */
  record(event: Omit<InterventionEvent, "id" | "timestamp"> & { timestamp?: string }): InterventionEvent {
    const stored: InterventionEvent = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: event.timestamp ?? new Date().toISOString(),
      type: event.type,
      machine: event.machine,
      filePath: event.filePath,
      ...(event.agentId !== undefined && { agentId: event.agentId }),
      ...(event.details !== undefined && { details: event.details }),
    };

    try {
      const filePath = this.getLogFilePath(new Date(stored.timestamp));
      fs.appendFileSync(filePath, JSON.stringify(stored) + "\n");
    } catch {
      // Never crash on log write failure
    }

    // Track in-memory for window-based detection
    const key = stored.machine;
    const events = this.recentEvents.get(key) ?? [];
    events.push(stored);
    this.recentEvents.set(key, events);

    // Evaluate alert rules
    this.evaluate(stored);

    return stored;
  }

  /**
   * Query stored intervention events.
   */
  query(filter?: { machine?: string; type?: InterventionType; since?: string; until?: string }): InterventionEvent[] {
    const dates = this.getDateRange(filter?.since, filter?.until);
    const results: InterventionEvent[] = [];

    for (const date of dates) {
      const records = this.readDailyRecords(date);
      for (const record of records) {
        if (filter?.machine && record.machine !== filter.machine) continue;
        if (filter?.type && record.type !== filter.type) continue;
        if (filter?.since && record.timestamp < filter.since) continue;
        if (filter?.until && record.timestamp > filter.until) continue;
        results.push(record);
      }
    }

    return results;
  }

  /**
   * Get count of recent events in the current window per machine.
   */
  getRecentCounts(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [machine, events] of this.recentEvents) {
      result[machine] = events.length;
    }
    return result;
  }

  private evaluate(event: InterventionEvent): void {
    // Rule 1: Bulk deletions
    this.checkBulkDeletions(event);

    // Rule 2: LaunchAgent modifications
    this.checkLaunchAgentModification(event);

    // Rule 3: Critical path modifications
    this.checkCriticalPathModification(event);
  }

  private checkBulkDeletions(event: InterventionEvent): void {
    if (event.type !== "file_delete") return;

    const now = new Date(event.timestamp).getTime();
    const cutoff = now - this.bulkWindowMs;
    const events = this.recentEvents.get(event.machine) ?? [];
    const recentDeletes = events.filter(
      (e) => e.type === "file_delete" && new Date(e.timestamp).getTime() > cutoff,
    );

    if (recentDeletes.length >= this.bulkDeleteThreshold) {
      this.fireAlert({
        severity: "critical",
        rule: "bulk_delete",
        message: `Bulk deletion detected: ${recentDeletes.length} files deleted on ${event.machine} within ${this.bulkWindowMs / 1000}s`,
        events: recentDeletes,
      });
    }
  }

  private checkLaunchAgentModification(event: InterventionEvent): void {
    const isLaunchAgent = LAUNCHAGENT_PATTERNS.some((p) => event.filePath.includes(p));
    if (!isLaunchAgent) return;

    this.fireAlert({
      severity: "critical",
      rule: "launchagent_modify",
      message: `LaunchAgent/plist modification detected: ${event.filePath} on ${event.machine}`,
      events: [event],
    });
  }

  private checkCriticalPathModification(event: InterventionEvent): void {
    const isCritical = this.criticalPaths.some((p) => event.filePath.includes(p));
    if (!isCritical) return;

    this.fireAlert({
      severity: "warning",
      rule: "critical_path_modify",
      message: `Critical path modification: ${event.filePath} on ${event.machine}`,
      events: [event],
    });
  }

  private fireAlert(partial: Omit<InterventionAlert, "id" | "timestamp">): void {
    const alert: InterventionAlert = {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    try {
      const filePath = path.join(this.logDir, "intervention-alerts.jsonl");
      fs.appendFileSync(filePath, JSON.stringify(alert) + "\n");
    } catch {
      // Never crash on alert write failure
    }

    try {
      this.onAlert?.(alert);
    } catch {
      // Callback errors must not propagate
    }
  }

  private readDailyRecords(date: Date): InterventionEvent[] {
    const filePath = this.getLogFilePath(date);
    if (!fs.existsSync(filePath)) return [];
    try {
      return fs
        .readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as InterventionEvent);
    } catch {
      return [];
    }
  }

  private getLogFilePath(date: Date): string {
    return path.join(this.logDir, `interventions-${date.toISOString().slice(0, 10)}.jsonl`);
  }

  private getDateRange(since?: string, until?: string): Date[] {
    const end = until ? new Date(until) : new Date();
    const start = since ? new Date(since) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const dates: Date[] = [];
    const current = new Date(start.toISOString().slice(0, 10));
    let count = 0;
    while (current <= end && count < 90) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
      count++;
    }
    return dates;
  }
}
