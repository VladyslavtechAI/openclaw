/**
 * Resource monitor for machine RAM, disk, CPU, swap, and backup status.
 * Based on real incidents:
 *   - Mini 2: 96% RAM caused Tailscale timeouts and SSH unreachable (Mar 31)
 *   - Mac Studio: NO backups configured (discovered Mar 30)
 *   - Mini 1: disk filling up from logs (Mar 29)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type MachineResources = {
  machine: string;
  timestamp: string;
  ram: { total: number; used: number; percent: number };
  disk: { total: number; used: number; percent: number; path: string };
  cpu: { loadAvg1m: number; loadAvg5m: number; loadAvg15m: number; percent?: number };
  swap: { total: number; used: number; percent: number };
};

export type BackupStatus = {
  machine: string;
  lastBackup: string | null;
  ageHours: number;
  sizeBytes: number;
  configured: boolean;
};

export type ResourceAlertSeverity = "warning" | "critical";

export type ResourceAlert = {
  id: string;
  timestamp: string;
  severity: ResourceAlertSeverity;
  rule: string;
  message: string;
  machine: string;
};

export type ResourceThresholds = {
  /** RAM warning threshold percent (default: 80). */
  ramWarningPercent?: number;
  /** RAM critical threshold percent (default: 90). */
  ramCriticalPercent?: number;
  /** Disk warning threshold percent (default: 80). */
  diskWarningPercent?: number;
  /** Disk critical threshold percent (default: 90). */
  diskCriticalPercent?: number;
  /** Swap warning threshold percent (default: 50). */
  swapWarningPercent?: number;
  /** CPU load warning = cores multiplier (default: 1 = number of cores). */
  cpuLoadCores?: number;
  /** Backup age warning hours (default: 24). */
  backupWarningHours?: number;
  /** Backup age critical hours (default: 48). */
  backupCriticalHours?: number;
  /** Seconds with no data before machine-unreachable warning (default: 600 = 10 minutes). */
  unreachableSeconds?: number;
};

export type ResourceMonitorConfig = {
  /** Directory for resource log files. */
  logDir: string;
  /** Days to retain log files (default: 30). */
  retentionDays?: number;
  /** Threshold overrides. */
  thresholds?: ResourceThresholds;
  /** Callback invoked on alerts. */
  onAlert?: (alert: ResourceAlert) => void;
};

/**
 * Monitors machine resources (RAM, disk, CPU, swap) and backup status.
 * Stores snapshots in daily JSONL files with configurable alerting thresholds.
 */
export class ResourceMonitor {
  private logDir: string;
  private retentionDays: number;
  private onAlert: ((alert: ResourceAlert) => void) | undefined;

  // Thresholds
  private ramWarningPercent: number;
  private ramCriticalPercent: number;
  private diskWarningPercent: number;
  private diskCriticalPercent: number;
  private swapWarningPercent: number;
  private cpuLoadCores: number;
  private backupWarningHours: number;
  private backupCriticalHours: number;
  private unreachableSeconds: number;

  /** Latest resource snapshot per machine. */
  private currentStatus: Map<string, MachineResources> = new Map();
  /** Latest backup status per machine. */
  private backupStatuses: Map<string, BackupStatus> = new Map();
  /** In-memory history per machine (capped at 1000 entries). */
  private history: Map<string, MachineResources[]> = new Map();

  constructor(config: ResourceMonitorConfig) {
    this.logDir = config.logDir;
    this.retentionDays = config.retentionDays ?? 30;
    this.onAlert = config.onAlert;

    const t = config.thresholds ?? {};
    this.ramWarningPercent = t.ramWarningPercent ?? 80;
    this.ramCriticalPercent = t.ramCriticalPercent ?? 90;
    this.diskWarningPercent = t.diskWarningPercent ?? 80;
    this.diskCriticalPercent = t.diskCriticalPercent ?? 90;
    this.swapWarningPercent = t.swapWarningPercent ?? 50;
    this.cpuLoadCores = t.cpuLoadCores ?? 1;
    this.backupWarningHours = t.backupWarningHours ?? 24;
    this.backupCriticalHours = t.backupCriticalHours ?? 48;
    this.unreachableSeconds = t.unreachableSeconds ?? 600;

    try {
      fs.mkdirSync(config.logDir, { recursive: true });
    } catch {
      // Never crash on directory creation failure
    }
    this.cleanOldFiles();
  }

  /**
   * Record a resource snapshot for a machine. Returns any alerts triggered.
   */
  record(resources: MachineResources): ResourceAlert[] {
    this.currentStatus.set(resources.machine, resources);

    // Append to in-memory history (capped)
    const hist = this.history.get(resources.machine) ?? [];
    hist.push(resources);
    if (hist.length > 1000) {
      hist.splice(0, hist.length - 1000);
    }
    this.history.set(resources.machine, hist);

    // Persist to JSONL
    try {
      const filePath = this.getResourceLogPath(resources.machine, new Date(resources.timestamp));
      fs.appendFileSync(filePath, JSON.stringify(resources) + "\n");
    } catch {
      // Never crash on log write failure
    }

    return this.evaluateResourceAlerts(resources);
  }

  /**
   * Record backup status. Returns any alerts triggered.
   */
  recordBackup(status: BackupStatus): ResourceAlert[] {
    this.backupStatuses.set(status.machine, status);

    // Persist to JSONL
    try {
      const filePath = path.join(this.logDir, `backups-${new Date().toISOString().slice(0, 10)}.jsonl`);
      fs.appendFileSync(filePath, JSON.stringify({ ...status, timestamp: new Date().toISOString() }) + "\n");
    } catch {
      // Never crash on log write failure
    }

    return this.evaluateBackupAlerts(status);
  }

  /**
   * Get current status for all machines.
   */
  getStatus(): Map<string, MachineResources> {
    return new Map(this.currentStatus);
  }

  /**
   * Get backup status for all machines.
   */
  getBackupStatus(): Map<string, BackupStatus> {
    return new Map(this.backupStatuses);
  }

  /**
   * Check all thresholds across all machines and return alerts.
   */
  checkThresholds(): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];

    // Check resource thresholds
    for (const resources of this.currentStatus.values()) {
      alerts.push(...this.evaluateResourceAlerts(resources));
    }

    // Check backup thresholds
    for (const status of this.backupStatuses.values()) {
      alerts.push(...this.evaluateBackupAlerts(status));
    }

    // Check for unreachable machines
    alerts.push(...this.checkUnreachable());

    return alerts;
  }

  /**
   * Get historical data for a machine within the last N hours.
   * Reads from in-memory history first, falls back to JSONL files.
   */
  getHistory(machine: string, hours: number): MachineResources[] {
    const cutoff = Date.now() - hours * 3_600_000;

    // Try in-memory first
    const memHistory = this.history.get(machine) ?? [];
    const memResults = memHistory.filter(
      (r) => new Date(r.timestamp).getTime() > cutoff,
    );

    if (memResults.length > 0) {
      return memResults;
    }

    // Fall back to reading JSONL files
    return this.readHistoryFromDisk(machine, cutoff);
  }

  private evaluateResourceAlerts(resources: MachineResources): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];
    const pct = (v: number) => (Number.isFinite(v) ? v : 0);

    // RAM
    const ramPct = pct(resources.ram.percent);
    if (ramPct >= this.ramCriticalPercent) {
      alerts.push(this.createAlert(
        "critical",
        "ram_critical",
        `RAM critical on ${resources.machine}: ${ramPct.toFixed(1)}% used`,
        resources.machine,
      ));
    } else if (ramPct >= this.ramWarningPercent) {
      alerts.push(this.createAlert(
        "warning",
        "ram_warning",
        `RAM warning on ${resources.machine}: ${ramPct.toFixed(1)}% used`,
        resources.machine,
      ));
    }

    // Disk
    const diskPct = pct(resources.disk.percent);
    if (diskPct >= this.diskCriticalPercent) {
      alerts.push(this.createAlert(
        "critical",
        "disk_critical",
        `Disk critical on ${resources.machine}: ${diskPct.toFixed(1)}% used (${resources.disk.path})`,
        resources.machine,
      ));
    } else if (diskPct >= this.diskWarningPercent) {
      alerts.push(this.createAlert(
        "warning",
        "disk_warning",
        `Disk warning on ${resources.machine}: ${diskPct.toFixed(1)}% used (${resources.disk.path})`,
        resources.machine,
      ));
    }

    // Swap
    const swapPct = pct(resources.swap.percent);
    if (swapPct >= this.swapWarningPercent) {
      alerts.push(this.createAlert(
        "warning",
        "swap_warning",
        `Swap warning on ${resources.machine}: ${swapPct.toFixed(1)}% used`,
        resources.machine,
      ));
    }

    // CPU load
    const load1m = Number.isFinite(resources.cpu.loadAvg1m) ? resources.cpu.loadAvg1m : 0;
    if (load1m > this.cpuLoadCores) {
      alerts.push(this.createAlert(
        "warning",
        "cpu_load_warning",
        `CPU load warning on ${resources.machine}: 1m avg ${load1m.toFixed(2)} exceeds ${this.cpuLoadCores} cores`,
        resources.machine,
      ));
    }

    // Persist alerts
    for (const alert of alerts) {
      this.persistAlert(alert);
      try {
        this.onAlert?.(alert);
      } catch {
        // Callback errors must not propagate
      }
    }

    return alerts;
  }

  private evaluateBackupAlerts(status: BackupStatus): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];

    if (!status.configured) {
      alerts.push(this.createAlert(
        "critical",
        "backup_not_configured",
        `Backup NOT configured on ${status.machine}`,
        status.machine,
      ));
    } else if (status.lastBackup === null) {
      alerts.push(this.createAlert(
        "critical",
        "backup_never_run",
        `Backup configured but never run on ${status.machine}`,
        status.machine,
      ));
    } else {
      const ageHours = Number.isFinite(status.ageHours) ? status.ageHours : 0;
      if (ageHours >= this.backupCriticalHours) {
        alerts.push(this.createAlert(
          "critical",
          "backup_stale_critical",
          `Backup critically stale on ${status.machine}: ${ageHours.toFixed(1)}h old (threshold: ${this.backupCriticalHours}h)`,
          status.machine,
        ));
      } else if (ageHours >= this.backupWarningHours) {
        alerts.push(this.createAlert(
          "warning",
          "backup_stale_warning",
          `Backup stale on ${status.machine}: ${ageHours.toFixed(1)}h old (threshold: ${this.backupWarningHours}h)`,
          status.machine,
        ));
      }
    }

    // Persist alerts
    for (const alert of alerts) {
      this.persistAlert(alert);
      try {
        this.onAlert?.(alert);
      } catch {
        // Callback errors must not propagate
      }
    }

    return alerts;
  }

  private checkUnreachable(): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];
    const now = Date.now();
    const cutoffMs = this.unreachableSeconds * 1000;

    for (const [machine, resources] of this.currentStatus) {
      try {
        const lastSeen = new Date(resources.timestamp).getTime();
        if (Number.isFinite(lastSeen) && now - lastSeen > cutoffMs) {
          const alert = this.createAlert(
            "warning",
            "machine_unreachable",
            `No resource data from ${machine} in ${Math.round((now - lastSeen) / 60_000)} minutes`,
            machine,
          );
          alerts.push(alert);
          this.persistAlert(alert);
          try {
            this.onAlert?.(alert);
          } catch {
            // Callback errors must not propagate
          }
        }
      } catch {
        // Invalid timestamp — skip
      }
    }

    return alerts;
  }

  private createAlert(
    severity: ResourceAlertSeverity,
    rule: string,
    message: string,
    machine: string,
  ): ResourceAlert {
    return {
      id: crypto.randomBytes(8).toString("hex"),
      timestamp: new Date().toISOString(),
      severity,
      rule,
      message,
      machine,
    };
  }

  private persistAlert(alert: ResourceAlert): void {
    try {
      const filePath = path.join(this.logDir, "resource-alerts.jsonl");
      fs.appendFileSync(filePath, JSON.stringify(alert) + "\n");
    } catch {
      // Never crash on alert write failure
    }
  }

  private getResourceLogPath(machine: string, date: Date): string {
    // Sanitize machine name for filesystem safety
    const safeMachine = machine.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.logDir, `resources-${safeMachine}-${date.toISOString().slice(0, 10)}.jsonl`);
  }

  private readHistoryFromDisk(machine: string, cutoffMs: number): MachineResources[] {
    const results: MachineResources[] = [];
    const safeMachine = machine.replace(/[^a-zA-Z0-9._-]/g, "_");
    const prefix = `resources-${safeMachine}-`;

    try {
      const files = fs.readdirSync(this.logDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".jsonl"))
        .sort();

      for (const file of files) {
        try {
          const lines = fs.readFileSync(path.join(this.logDir, file), "utf-8")
            .trim()
            .split("\n")
            .filter(Boolean);

          for (const line of lines) {
            try {
              const record = JSON.parse(line) as MachineResources;
              if (new Date(record.timestamp).getTime() > cutoffMs) {
                results.push(record);
              }
            } catch {
              // Skip corrupt lines
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory read failure — return empty
    }

    return results;
  }

  private cleanOldFiles(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.logDir).filter(
        (f) => (f.startsWith("resources-") || f.startsWith("backups-")) && f.endsWith(".jsonl"),
      );

      for (const file of files) {
        // Extract date from filename: resources-machine-YYYY-MM-DD.jsonl or backups-YYYY-MM-DD.jsonl
        const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})\.jsonl$/);
        if (!dateMatch) continue;

        const fileDate = new Date(dateMatch[1]);
        if (!Number.isNaN(fileDate.getTime()) && fileDate.getTime() < cutoff) {
          try {
            fs.unlinkSync(path.join(this.logDir, file));
          } catch {
            // Non-critical cleanup
          }
        }
      }
    } catch {
      // Non-critical cleanup; don't crash
    }
  }
}
