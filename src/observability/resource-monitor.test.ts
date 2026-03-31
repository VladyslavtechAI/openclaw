import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupStatus, MachineResources, ResourceAlert } from "./resource-monitor.js";
import { ResourceMonitor } from "./resource-monitor.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "resource-monitor-test-"));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

function makeResources(overrides: Partial<MachineResources> = {}): MachineResources {
  return {
    machine: "mini-2",
    timestamp: new Date().toISOString(),
    ram: { total: 16_000, used: 8_000, percent: 50 },
    disk: { total: 500_000, used: 100_000, percent: 20, path: "/" },
    cpu: { loadAvg1m: 1.0, loadAvg5m: 0.8, loadAvg15m: 0.6 },
    swap: { total: 4_000, used: 500, percent: 12.5 },
    ...overrides,
  };
}

function makeBackup(overrides: Partial<BackupStatus> = {}): BackupStatus {
  return {
    machine: "mini-2",
    lastBackup: new Date().toISOString(),
    ageHours: 2,
    sizeBytes: 1_000_000,
    configured: true,
    ...overrides,
  };
}

// ─── ResourceMonitor ──────────────────────────────────────────────────────

describe("ResourceMonitor", () => {
  let tmpDir: string;
  let monitor: ResourceMonitor;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    monitor = new ResourceMonitor({ logDir: tmpDir });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── RAM thresholds ───────────────────────────────────────────────────

  describe("RAM thresholds", () => {
    it("no alert when RAM usage is normal (below 80%)", () => {
      const alerts = monitor.record(makeResources({ ram: { total: 16_000, used: 8_000, percent: 50 } }));
      expect(alerts).toHaveLength(0);
    });

    it("warning alert when RAM is between 80% and 90%", () => {
      const alerts = monitor.record(makeResources({ ram: { total: 16_000, used: 13_600, percent: 85 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].rule).toBe("ram_warning");
      expect(alerts[0].message).toContain("85.0%");
    });

    it("critical alert when RAM exceeds 90%", () => {
      const alerts = monitor.record(makeResources({ ram: { total: 16_000, used: 15_360, percent: 96 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].rule).toBe("ram_critical");
      expect(alerts[0].message).toContain("96.0%");
    });

    it("critical alert at exactly 90%", () => {
      const alerts = monitor.record(makeResources({ ram: { total: 16_000, used: 14_400, percent: 90 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].rule).toBe("ram_critical");
    });

    it("warning alert at exactly 80%", () => {
      const alerts = monitor.record(makeResources({ ram: { total: 16_000, used: 12_800, percent: 80 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].rule).toBe("ram_warning");
    });
  });

  // ─── Disk thresholds ──────────────────────────────────────────────────

  describe("Disk thresholds", () => {
    it("no alert when disk usage is normal", () => {
      const alerts = monitor.record(makeResources({ disk: { total: 500_000, used: 100_000, percent: 20, path: "/" } }));
      expect(alerts).toHaveLength(0);
    });

    it("warning alert when disk is between 80% and 90%", () => {
      const alerts = monitor.record(makeResources({ disk: { total: 500_000, used: 425_000, percent: 85, path: "/" } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].rule).toBe("disk_warning");
      expect(alerts[0].message).toContain("/");
    });

    it("critical alert when disk exceeds 90%", () => {
      const alerts = monitor.record(makeResources({ disk: { total: 500_000, used: 475_000, percent: 95, path: "/data" } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].rule).toBe("disk_critical");
      expect(alerts[0].message).toContain("/data");
    });

    it("critical alert at exactly 90%", () => {
      const alerts = monitor.record(makeResources({ disk: { total: 500_000, used: 450_000, percent: 90, path: "/" } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("disk_critical");
    });
  });

  // ─── Swap thresholds ──────────────────────────────────────────────────

  describe("Swap thresholds", () => {
    it("no alert when swap is below 50%", () => {
      const alerts = monitor.record(makeResources({ swap: { total: 4_000, used: 1_000, percent: 25 } }));
      expect(alerts).toHaveLength(0);
    });

    it("warning alert when swap exceeds 50%", () => {
      const alerts = monitor.record(makeResources({ swap: { total: 4_000, used: 2_400, percent: 60 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].rule).toBe("swap_warning");
    });

    it("warning alert at exactly 50%", () => {
      const alerts = monitor.record(makeResources({ swap: { total: 4_000, used: 2_000, percent: 50 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("swap_warning");
    });
  });

  // ─── CPU load thresholds ──────────────────────────────────────────────

  describe("CPU load thresholds", () => {
    it("no alert when load is below core count", () => {
      const m = new ResourceMonitor({ logDir: tmpDir, thresholds: { cpuLoadCores: 4 } });
      const alerts = m.record(makeResources({ cpu: { loadAvg1m: 2.0, loadAvg5m: 1.5, loadAvg15m: 1.0 } }));
      expect(alerts).toHaveLength(0);
    });

    it("warning alert when 1m load exceeds core count", () => {
      const m = new ResourceMonitor({ logDir: tmpDir, thresholds: { cpuLoadCores: 4 } });
      const alerts = m.record(makeResources({ cpu: { loadAvg1m: 5.5, loadAvg5m: 3.0, loadAvg15m: 2.0 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].rule).toBe("cpu_load_warning");
      expect(alerts[0].message).toContain("5.50");
      expect(alerts[0].message).toContain("4 cores");
    });

    it("default core count is 1", () => {
      const alerts = monitor.record(makeResources({ cpu: { loadAvg1m: 1.5, loadAvg5m: 1.0, loadAvg15m: 0.5 } }));
      const cpuAlerts = alerts.filter((a) => a.rule === "cpu_load_warning");
      expect(cpuAlerts).toHaveLength(1);
    });
  });

  // ─── Backup freshness ─────────────────────────────────────────────────

  describe("Backup status", () => {
    it("no alert when backup is fresh (under 24h)", () => {
      const alerts = monitor.recordBackup(makeBackup({ ageHours: 2 }));
      expect(alerts).toHaveLength(0);
    });

    it("warning alert when backup is stale (24–48h)", () => {
      const alerts = monitor.recordBackup(makeBackup({ ageHours: 30 }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("warning");
      expect(alerts[0].rule).toBe("backup_stale_warning");
    });

    it("critical alert when backup is very stale (>48h)", () => {
      const alerts = monitor.recordBackup(makeBackup({ ageHours: 72 }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].rule).toBe("backup_stale_critical");
    });

    it("critical alert when backup not configured", () => {
      const alerts = monitor.recordBackup(makeBackup({ configured: false }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].rule).toBe("backup_not_configured");
      expect(alerts[0].message).toContain("NOT configured");
    });

    it("critical alert when backup configured but never run", () => {
      const alerts = monitor.recordBackup(makeBackup({ configured: true, lastBackup: null, ageHours: 0 }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe("critical");
      expect(alerts[0].rule).toBe("backup_never_run");
    });

    it("critical at exactly 48h boundary", () => {
      const alerts = monitor.recordBackup(makeBackup({ ageHours: 48 }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("backup_stale_critical");
    });

    it("warning at exactly 24h boundary", () => {
      const alerts = monitor.recordBackup(makeBackup({ ageHours: 24 }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("backup_stale_warning");
    });
  });

  // ─── Machine unreachable ──────────────────────────────────────────────

  describe("Machine unreachable", () => {
    it("warning when no data for >10 minutes", () => {
      const old = new Date(Date.now() - 15 * 60_000).toISOString();
      monitor.record(makeResources({ machine: "mini-1", timestamp: old }));

      const alerts = monitor.checkThresholds();
      const unreachable = alerts.filter((a) => a.rule === "machine_unreachable");
      expect(unreachable.length).toBeGreaterThanOrEqual(1);
      expect(unreachable[0].severity).toBe("warning");
      expect(unreachable[0].message).toContain("mini-1");
    });

    it("no unreachable alert when data is recent", () => {
      monitor.record(makeResources({ machine: "mini-1", timestamp: new Date().toISOString() }));
      const alerts = monitor.checkThresholds();
      const unreachable = alerts.filter((a) => a.rule === "machine_unreachable");
      expect(unreachable).toHaveLength(0);
    });

    it("configurable unreachable timeout", () => {
      const m = new ResourceMonitor({ logDir: tmpDir, thresholds: { unreachableSeconds: 5 } });
      const old = new Date(Date.now() - 10_000).toISOString();
      m.record(makeResources({ machine: "mini-1", timestamp: old }));

      const alerts = m.checkThresholds();
      const unreachable = alerts.filter((a) => a.rule === "machine_unreachable");
      expect(unreachable.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Historical data ──────────────────────────────────────────────────

  describe("Historical data", () => {
    it("stores and retrieves history for a machine", () => {
      monitor.record(makeResources({ machine: "mini-2", timestamp: new Date().toISOString() }));
      monitor.record(makeResources({ machine: "mini-2", timestamp: new Date().toISOString() }));
      monitor.record(makeResources({ machine: "mini-2", timestamp: new Date().toISOString() }));

      const hist = monitor.getHistory("mini-2", 1);
      expect(hist).toHaveLength(3);
    });

    it("filters history by time window", () => {
      const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const recent = new Date().toISOString();

      monitor.record(makeResources({ machine: "mini-2", timestamp: old }));
      monitor.record(makeResources({ machine: "mini-2", timestamp: recent }));

      const hist = monitor.getHistory("mini-2", 1);
      expect(hist).toHaveLength(1);
    });

    it("returns empty array for unknown machine", () => {
      const hist = monitor.getHistory("nonexistent", 24);
      expect(hist).toHaveLength(0);
    });
  });

  // ─── Multiple machines ────────────────────────────────────────────────

  describe("Multiple machines", () => {
    it("tracks multiple machines independently", () => {
      monitor.record(makeResources({ machine: "mini-1" }));
      monitor.record(makeResources({ machine: "mini-2", ram: { total: 16_000, used: 15_000, percent: 93.75 } }));
      monitor.record(makeResources({ machine: "studio" }));

      const status = monitor.getStatus();
      expect(status.size).toBe(3);
      expect(status.get("mini-1")).toBeTruthy();
      expect(status.get("mini-2")).toBeTruthy();
      expect(status.get("studio")).toBeTruthy();
    });

    it("alerts only for machines with issues", () => {
      const alerts1 = monitor.record(makeResources({ machine: "mini-1", ram: { total: 16_000, used: 8_000, percent: 50 } }));
      const alerts2 = monitor.record(makeResources({ machine: "mini-2", ram: { total: 16_000, used: 15_360, percent: 96 } }));

      expect(alerts1).toHaveLength(0);
      expect(alerts2).toHaveLength(1);
      expect(alerts2[0].machine).toBe("mini-2");
    });

    it("backup status tracked per machine", () => {
      monitor.recordBackup(makeBackup({ machine: "mini-1", configured: true, ageHours: 2 }));
      monitor.recordBackup(makeBackup({ machine: "studio", configured: false }));

      const statuses = monitor.getBackupStatus();
      expect(statuses.size).toBe(2);
      expect(statuses.get("mini-1")!.configured).toBe(true);
      expect(statuses.get("studio")!.configured).toBe(false);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("handles 0% usage without alerts", () => {
      const alerts = monitor.record(makeResources({
        ram: { total: 16_000, used: 0, percent: 0 },
        disk: { total: 500_000, used: 0, percent: 0, path: "/" },
        swap: { total: 4_000, used: 0, percent: 0 },
        cpu: { loadAvg1m: 0, loadAvg5m: 0, loadAvg15m: 0 },
      }));
      expect(alerts).toHaveLength(0);
    });

    it("handles 100% usage with critical alerts", () => {
      const alerts = monitor.record(makeResources({
        ram: { total: 16_000, used: 16_000, percent: 100 },
        disk: { total: 500_000, used: 500_000, percent: 100, path: "/" },
        swap: { total: 4_000, used: 4_000, percent: 100 },
        cpu: { loadAvg1m: 10, loadAvg5m: 10, loadAvg15m: 10 },
      }));
      // ram_critical + disk_critical + swap_warning + cpu_load_warning
      expect(alerts.length).toBeGreaterThanOrEqual(4);
    });

    it("handles NaN values without crashing", () => {
      const alerts = monitor.record(makeResources({
        ram: { total: 16_000, used: NaN, percent: NaN },
        disk: { total: 500_000, used: NaN, percent: NaN, path: "/" },
        swap: { total: 4_000, used: NaN, percent: NaN },
        cpu: { loadAvg1m: NaN, loadAvg5m: NaN, loadAvg15m: NaN },
      }));
      // NaN is treated as 0 by the pct() helper, so no alerts
      expect(alerts).toHaveLength(0);
    });

    it("handles negative values without crashing", () => {
      const alerts = monitor.record(makeResources({
        ram: { total: 16_000, used: -1, percent: -5 },
        disk: { total: 500_000, used: -1, percent: -10, path: "/" },
        swap: { total: 4_000, used: -1, percent: -1 },
        cpu: { loadAvg1m: -1, loadAvg5m: -1, loadAvg15m: -1 },
      }));
      expect(alerts).toHaveLength(0);
    });

    it("handles Infinity values without crashing", () => {
      const alerts = monitor.record(makeResources({
        ram: { total: 16_000, used: Infinity, percent: Infinity },
      }));
      // Infinity is finite=false, treated as 0
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  // ─── Configurable thresholds ──────────────────────────────────────────

  describe("Configurable thresholds", () => {
    it("custom RAM thresholds", () => {
      const m = new ResourceMonitor({
        logDir: tmpDir,
        thresholds: { ramWarningPercent: 50, ramCriticalPercent: 70 },
      });

      const alerts = m.record(makeResources({ ram: { total: 16_000, used: 9_600, percent: 60 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("ram_warning");
    });

    it("custom disk thresholds", () => {
      const m = new ResourceMonitor({
        logDir: tmpDir,
        thresholds: { diskWarningPercent: 60, diskCriticalPercent: 75 },
      });

      const alerts = m.record(makeResources({ disk: { total: 500_000, used: 400_000, percent: 80, path: "/" } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("disk_critical");
    });

    it("custom swap threshold", () => {
      const m = new ResourceMonitor({
        logDir: tmpDir,
        thresholds: { swapWarningPercent: 30 },
      });

      const alerts = m.record(makeResources({ swap: { total: 4_000, used: 1_600, percent: 40 } }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("swap_warning");
    });

    it("custom backup thresholds", () => {
      const m = new ResourceMonitor({
        logDir: tmpDir,
        thresholds: { backupWarningHours: 12, backupCriticalHours: 24 },
      });

      const alerts = m.recordBackup(makeBackup({ ageHours: 15 }));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].rule).toBe("backup_stale_warning");
    });
  });

  // ─── JSONL persistence ────────────────────────────────────────────────

  describe("JSONL persistence", () => {
    it("writes resource snapshots to JSONL file per machine per day", () => {
      monitor.record(makeResources({ machine: "mini-2" }));
      monitor.record(makeResources({ machine: "mini-2" }));

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("resources-mini-2-") && f.endsWith(".jsonl"));
      expect(files).toHaveLength(1);

      const lines = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);

      const parsed = JSON.parse(lines[0]) as MachineResources;
      expect(parsed.machine).toBe("mini-2");
      expect(parsed.ram).toBeDefined();
    });

    it("writes backup status to JSONL file", () => {
      monitor.recordBackup(makeBackup({ machine: "studio" }));

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("backups-") && f.endsWith(".jsonl"));
      expect(files).toHaveLength(1);

      const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim();
      const parsed = JSON.parse(content);
      expect(parsed.machine).toBe("studio");
    });

    it("writes alerts to JSONL file", () => {
      monitor.record(makeResources({ ram: { total: 16_000, used: 15_360, percent: 96 } }));

      const alertFile = path.join(tmpDir, "resource-alerts.jsonl");
      expect(fs.existsSync(alertFile)).toBe(true);

      const content = fs.readFileSync(alertFile, "utf-8").trim();
      const parsed = JSON.parse(content) as ResourceAlert;
      expect(parsed.severity).toBe("critical");
      expect(parsed.rule).toBe("ram_critical");
    });

    it("reads back historical data from JSONL", () => {
      // Create a fresh monitor, record data, then create a new instance to test disk reads
      monitor.record(makeResources({ machine: "mini-2", timestamp: new Date().toISOString() }));
      monitor.record(makeResources({ machine: "mini-2", timestamp: new Date().toISOString() }));

      const freshMonitor = new ResourceMonitor({ logDir: tmpDir });
      // Fresh monitor has no in-memory data, should read from disk
      const hist = freshMonitor.getHistory("mini-2", 1);
      expect(hist).toHaveLength(2);
    });

    it("handles corrupt JSONL lines gracefully", () => {
      const today = new Date().toISOString().slice(0, 10);
      const filePath = path.join(tmpDir, `resources-mini-2-${today}.jsonl`);

      // Write a valid line followed by corrupt data
      fs.writeFileSync(filePath, JSON.stringify(makeResources({ machine: "mini-2" })) + "\n");
      fs.appendFileSync(filePath, "NOT VALID JSON\n");
      fs.appendFileSync(filePath, JSON.stringify(makeResources({ machine: "mini-2" })) + "\n");

      const freshMonitor = new ResourceMonitor({ logDir: tmpDir });
      const hist = freshMonitor.getHistory("mini-2", 1);
      // Should skip corrupt line and return 2 valid records
      expect(hist).toHaveLength(2);
    });

    it("separate JSONL files per machine", () => {
      monitor.record(makeResources({ machine: "mini-1" }));
      monitor.record(makeResources({ machine: "mini-2" }));

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("resources-") && f.endsWith(".jsonl"));
      const machineFiles = files.filter((f) => f.includes("mini-1") || f.includes("mini-2"));
      expect(machineFiles).toHaveLength(2);
    });
  });

  // ─── File rotation ────────────────────────────────────────────────────

  describe("File rotation", () => {
    it("cleans old resource files beyond retention period", () => {
      // Create a file dated 60 days ago
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const oldDateStr = oldDate.toISOString().slice(0, 10);
      const oldFilePath = path.join(tmpDir, `resources-mini-2-${oldDateStr}.jsonl`);
      fs.writeFileSync(oldFilePath, JSON.stringify(makeResources()) + "\n");

      // Create a recent file
      const todayStr = new Date().toISOString().slice(0, 10);
      const recentFilePath = path.join(tmpDir, `resources-mini-2-${todayStr}.jsonl`);
      fs.writeFileSync(recentFilePath, JSON.stringify(makeResources()) + "\n");

      // Re-create monitor to trigger cleanup
      const _m = new ResourceMonitor({ logDir: tmpDir, retentionDays: 30 });

      expect(fs.existsSync(oldFilePath)).toBe(false);
      expect(fs.existsSync(recentFilePath)).toBe(true);
    });

    it("cleans old backup files beyond retention period", () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const oldDateStr = oldDate.toISOString().slice(0, 10);
      const oldFilePath = path.join(tmpDir, `backups-${oldDateStr}.jsonl`);
      fs.writeFileSync(oldFilePath, "{}\n");

      const _m = new ResourceMonitor({ logDir: tmpDir, retentionDays: 30 });
      expect(fs.existsSync(oldFilePath)).toBe(false);
    });

    it("keeps files within retention period", () => {
      const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const dateStr = recentDate.toISOString().slice(0, 10);
      const filePath = path.join(tmpDir, `resources-mini-2-${dateStr}.jsonl`);
      fs.writeFileSync(filePath, JSON.stringify(makeResources()) + "\n");

      const _m = new ResourceMonitor({ logDir: tmpDir, retentionDays: 30 });
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ─── onAlert callback ─────────────────────────────────────────────────

  describe("onAlert callback", () => {
    it("invokes onAlert callback on resource alerts", () => {
      const fired: ResourceAlert[] = [];
      const m = new ResourceMonitor({
        logDir: tmpDir,
        onAlert: (alert) => fired.push(alert),
      });

      m.record(makeResources({ ram: { total: 16_000, used: 15_360, percent: 96 } }));
      expect(fired).toHaveLength(1);
      expect(fired[0].rule).toBe("ram_critical");
    });

    it("invokes onAlert callback on backup alerts", () => {
      const fired: ResourceAlert[] = [];
      const m = new ResourceMonitor({
        logDir: tmpDir,
        onAlert: (alert) => fired.push(alert),
      });

      m.recordBackup(makeBackup({ configured: false }));
      expect(fired).toHaveLength(1);
      expect(fired[0].rule).toBe("backup_not_configured");
    });

    it("callback errors do not propagate", () => {
      const m = new ResourceMonitor({
        logDir: tmpDir,
        onAlert: () => {
          throw new Error("Callback explosion");
        },
      });

      expect(() => {
        m.record(makeResources({ ram: { total: 16_000, used: 15_360, percent: 96 } }));
      }).not.toThrow();
    });
  });

  // ─── getStatus / getBackupStatus ──────────────────────────────────────

  describe("Status queries", () => {
    it("getStatus returns a copy of current state", () => {
      monitor.record(makeResources({ machine: "mini-1" }));
      const status = monitor.getStatus();
      status.delete("mini-1");
      // Original should be unaffected
      expect(monitor.getStatus().has("mini-1")).toBe(true);
    });

    it("getBackupStatus returns a copy of current state", () => {
      monitor.recordBackup(makeBackup({ machine: "mini-1" }));
      const status = monitor.getBackupStatus();
      status.delete("mini-1");
      expect(monitor.getBackupStatus().has("mini-1")).toBe(true);
    });
  });

  // ─── checkThresholds ──────────────────────────────────────────────────

  describe("checkThresholds", () => {
    it("returns alerts for all machines with issues", () => {
      monitor.record(makeResources({ machine: "mini-1", ram: { total: 16_000, used: 14_400, percent: 90 } }));
      monitor.record(makeResources({ machine: "mini-2", disk: { total: 500_000, used: 475_000, percent: 95, path: "/" } }));
      monitor.recordBackup(makeBackup({ machine: "studio", configured: false }));

      const alerts = monitor.checkThresholds();
      const rules = alerts.map((a) => a.rule);
      expect(rules).toContain("ram_critical");
      expect(rules).toContain("disk_critical");
      expect(rules).toContain("backup_not_configured");
    });

    it("returns empty array when all is healthy", () => {
      monitor.record(makeResources({ machine: "mini-1" }));
      monitor.recordBackup(makeBackup({ machine: "mini-1", ageHours: 2 }));

      const alerts = monitor.checkThresholds();
      expect(alerts).toHaveLength(0);
    });
  });

  // ─── Machine name sanitization ────────────────────────────────────────

  describe("Machine name sanitization", () => {
    it("sanitizes machine names with special characters for filenames", () => {
      monitor.record(makeResources({ machine: "my/bad..machine" }));
      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("resources-"));
      // Should not contain / in filename
      expect(files.every((f) => !f.includes("/"))).toBe(true);
      expect(files.length).toBeGreaterThan(0);
    });
  });

  // ─── Write failure resilience ─────────────────────────────────────────

  describe("Write failure resilience", () => {
    it("record does not throw when log dir is unwritable", () => {
      const m = new ResourceMonitor({ logDir: "/nonexistent/path/that/should/fail" });
      expect(() => {
        m.record(makeResources());
      }).not.toThrow();
    });

    it("recordBackup does not throw when log dir is unwritable", () => {
      const m = new ResourceMonitor({ logDir: "/nonexistent/path/that/should/fail" });
      expect(() => {
        m.recordBackup(makeBackup());
      }).not.toThrow();
    });
  });

  // ─── Alert IDs ────────────────────────────────────────────────────────

  describe("Alert structure", () => {
    it("each alert has unique id and timestamp", () => {
      const alerts = monitor.record(makeResources({
        ram: { total: 16_000, used: 15_360, percent: 96 },
        disk: { total: 500_000, used: 475_000, percent: 95, path: "/" },
      }));

      expect(alerts.length).toBeGreaterThanOrEqual(2);
      const ids = alerts.map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const alert of alerts) {
        expect(alert.timestamp).toBeTruthy();
        expect(alert.machine).toBeTruthy();
      }
    });
  });
});
