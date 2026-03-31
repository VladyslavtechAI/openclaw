import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogAggregator } from "./log-aggregator.js";
import type { LogEntry } from "./log-aggregator.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "log-aggregator-test-"));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

// ─── LogAggregator ───────────────────────────────────────────────────────

describe("LogAggregator", () => {
  let tmpDir: string;
  let aggregator: LogAggregator;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    aggregator = new LogAggregator({ logDir: tmpDir });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── Parsing gateway logs ─────────────────────────────────────────────

  describe("parseGatewayLog", () => {
    it("parses ISO timestamp with bracketed level (format 1)", () => {
      const raw = "2025-03-31T10:15:00.000Z [ERROR] gateway: Connection refused on port 18789";
      const entries = aggregator.parseGatewayLog(raw, "mac-mini-1");
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe("error");
      expect(entries[0].source).toBe("gateway");
      expect(entries[0].machine).toBe("mac-mini-1");
      expect(entries[0].message).toBe("Connection refused on port 18789");
      expect(entries[0].metadata?.component).toBe("gateway");
    });

    it("parses bracketed timestamp with level (format 2)", () => {
      const raw = "[2025-03-31 10:15:00] ERROR: Something went wrong";
      const entries = aggregator.parseGatewayLog(raw, "mac-studio");
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe("error");
      expect(entries[0].message).toBe("Something went wrong");
    });

    it("parses timestamp-only lines (format 3)", () => {
      const raw = "2025-03-31T10:15:00.000Z Gateway started successfully";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe("info");
      expect(entries[0].message).toBe("Gateway started successfully");
    });

    it("infers error level from message content", () => {
      const raw = "2025-03-31T10:15:00.000Z Fatal crash in gateway subsystem";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries[0].level).toBe("fatal");
    });

    it("infers warn level from message content", () => {
      const raw = "2025-03-31T10:15:00.000Z Warning: deprecated API usage detected";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries[0].level).toBe("warn");
    });

    it("handles unparseable lines as raw info", () => {
      const raw = "some random text without timestamp";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe("info");
      expect(entries[0].message).toBe("some random text without timestamp");
    });

    it("parses multiple lines", () => {
      const raw = [
        "2025-03-31T10:00:00.000Z [INFO] gateway: Started",
        "2025-03-31T10:01:00.000Z [ERROR] gateway: Port conflict",
        "2025-03-31T10:02:00.000Z [WARN] gateway: High memory",
      ].join("\n");
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries.length).toBe(3);
      expect(entries[0].level).toBe("info");
      expect(entries[1].level).toBe("error");
      expect(entries[2].level).toBe("warn");
    });

    it("skips empty lines", () => {
      const raw = "2025-03-31T10:00:00.000Z [INFO] gateway: OK\n\n\n2025-03-31T10:01:00.000Z [ERROR] gateway: Fail";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries.length).toBe(2);
    });

    it("returns empty array for empty input", () => {
      expect(aggregator.parseGatewayLog("", "m1")).toEqual([]);
      expect(aggregator.parseGatewayLog(null as unknown as string, "m1")).toEqual([]);
    });

    it("normalizes level aliases", () => {
      const raw = "2025-03-31T10:00:00.000Z [WARNING] gateway: Something";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries[0].level).toBe("warn");
    });

    it("normalizes CRITICAL to fatal", () => {
      const raw = "2025-03-31T10:00:00.000Z [CRITICAL] gateway: System down";
      const entries = aggregator.parseGatewayLog(raw, "m1");
      expect(entries[0].level).toBe("fatal");
    });
  });

  // ─── Parsing launchctl output ─────────────────────────────────────────

  describe("parseLaunchctlOutput", () => {
    it("parses exit code lines", () => {
      const raw = "com.openclaw.gateway: exit code: 127";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe("error"); // exit 127 = error
      expect(entries[0].source).toBe("launchagent");
      expect(entries[0].metadata?.service).toBe("com.openclaw.gateway");
      expect(entries[0].metadata?.exitCode).toBe(127);
    });

    it("parses exit code 0 as info", () => {
      const raw = "com.openclaw.gateway: exit code: 0";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries[0].level).toBe("info");
    });

    it("parses non-zero non-127 exit code as warn", () => {
      const raw = "com.openclaw.gateway: exit code: 1";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries[0].level).toBe("warn");
    });

    it("parses PID status lines", () => {
      const raw = "PID = 1234";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries.length).toBe(1);
      expect(entries[0].metadata?.pid).toBe(1234);
    });

    it("parses status = N lines", () => {
      const raw = "status = 0";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries[0].metadata?.status).toBe(0);
    });

    it("detects error keywords in launchctl output", () => {
      const raw = "Service crashed with error";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries[0].level).toBe("error");
    });

    it("detects fail keyword", () => {
      const raw = "Service failed to start";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries[0].level).toBe("error");
    });

    it("treats generic lines as info", () => {
      const raw = "Service is running normally";
      const entries = aggregator.parseLaunchctlOutput(raw, "m1");
      expect(entries[0].level).toBe("info");
    });

    it("returns empty for empty input", () => {
      expect(aggregator.parseLaunchctlOutput("", "m1")).toEqual([]);
      expect(aggregator.parseLaunchctlOutput(null as unknown as string, "m1")).toEqual([]);
    });
  });

  // ─── Parsing PM2 logs ─────────────────────────────────────────────────

  describe("parsePM2Log", () => {
    it("parses standard PM2 format", () => {
      const raw = "2025-03-31T10:00:00: 0|gateway  | Server listening on port 18789";
      const entries = aggregator.parsePM2Log(raw, "vps-1");
      expect(entries.length).toBe(1);
      expect(entries[0].source).toBe("pm2");
      expect(entries[0].machine).toBe("vps-1");
      expect(entries[0].message).toBe("Server listening on port 18789");
      expect(entries[0].metadata?.app).toBe("gateway");
      expect(entries[0].level).toBe("info");
    });

    it("infers error level from PM2 message", () => {
      const raw = "2025-03-31T10:00:00: 0|gateway  | Error: EADDRINUSE port 18789";
      const entries = aggregator.parsePM2Log(raw, "vps-1");
      expect(entries[0].level).toBe("error");
    });

    it("infers fatal level from PM2 message", () => {
      const raw = "2025-03-31T10:00:00: 0|gateway  | Fatal: panic in subsystem";
      const entries = aggregator.parsePM2Log(raw, "vps-1");
      expect(entries[0].level).toBe("fatal");
    });

    it("handles non-standard PM2 output", () => {
      const raw = "Some plain text output from PM2";
      const entries = aggregator.parsePM2Log(raw, "vps-1");
      expect(entries.length).toBe(1);
      expect(entries[0].source).toBe("pm2");
      expect(entries[0].message).toBe("Some plain text output from PM2");
    });

    it("parses multiple PM2 lines", () => {
      const raw = [
        "2025-03-31T10:00:00: 0|app  | Starting",
        "2025-03-31T10:00:01: 0|app  | Error: failed to bind",
        "2025-03-31T10:00:02: 0|app  | Retrying...",
      ].join("\n");
      const entries = aggregator.parsePM2Log(raw, "vps-1");
      expect(entries.length).toBe(3);
    });

    it("returns empty for empty input", () => {
      expect(aggregator.parsePM2Log("", "m1")).toEqual([]);
      expect(aggregator.parsePM2Log(null as unknown as string, "m1")).toEqual([]);
    });
  });

  // ─── Ingest and query ─────────────────────────────────────────────────

  describe("ingest and query", () => {
    it("ingests entries and assigns ids", () => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        machine: "m1",
        source: "gateway",
        level: "info",
        message: "Started",
      };
      const stored = aggregator.ingestOne(entry);
      expect(stored.id).toBeTruthy();
      expect(stored.message).toBe("Started");
    });

    it("ingests batch of entries", () => {
      const entries: LogEntry[] = [
        { timestamp: new Date().toISOString(), machine: "m1", source: "gateway", level: "info", message: "a" },
        { timestamp: new Date().toISOString(), machine: "m1", source: "gateway", level: "error", message: "b" },
      ];
      const stored = aggregator.ingest(entries);
      expect(stored.length).toBe(2);
      expect(stored[0].id).not.toBe(stored[1].id);
    });

    it("queries with no filter returns all buffered entries", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "a" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m2", source: "gw", level: "error", message: "b" });
      const results = aggregator.query();
      expect(results.length).toBe(2);
    });

    it("filters by machine", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "a" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m2", source: "gw", level: "info", message: "b" });
      const results = aggregator.query({ machine: "m1" });
      expect(results.length).toBe(1);
      expect(results[0].machine).toBe("m1");
    });

    it("filters by source", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gateway", level: "info", message: "a" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "pm2", level: "info", message: "b" });
      const results = aggregator.query({ source: "gateway" });
      expect(results.length).toBe(1);
    });

    it("filters by level", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "a" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "error", message: "b" });
      const results = aggregator.query({ level: "error" });
      expect(results.length).toBe(1);
      expect(results[0].level).toBe("error");
    });

    it("filters by multiple levels", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "a" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "warn", message: "b" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "error", message: "c" });
      const results = aggregator.query({ levels: ["warn", "error"] });
      expect(results.length).toBe(2);
    });

    it("filters by time range", () => {
      const now = new Date();
      aggregator.ingestOne({ timestamp: new Date(now.getTime() - 7200_000).toISOString(), machine: "m1", source: "gw", level: "info", message: "old" });
      aggregator.ingestOne({ timestamp: now.toISOString(), machine: "m1", source: "gw", level: "info", message: "new" });

      const results = aggregator.query({
        since: new Date(now.getTime() - 3600_000).toISOString(),
        until: new Date(now.getTime() + 1000).toISOString(),
      });
      expect(results.length).toBe(1);
      expect(results[0].message).toBe("new");
    });

    it("filters by messagePattern regex", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "error", message: "EADDRINUSE on port 18789" });
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "All good" });
      const results = aggregator.query({ messagePattern: "EADDRINUSE" });
      expect(results.length).toBe(1);
    });

    it("messagePattern falls back to substring for invalid regex", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "has [bad regex( in it" });
      const results = aggregator.query({ messagePattern: "[bad regex(" });
      expect(results.length).toBe(1);
    });

    it("respects limit (returns last N)", () => {
      for (let i = 0; i < 10; i++) {
        aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: `msg-${i}` });
      }
      const results = aggregator.query({ limit: 3 });
      expect(results.length).toBe(3);
      expect(results[0].message).toBe("msg-7");
    });

    it("stores metadata", () => {
      aggregator.ingestOne({
        timestamp: new Date().toISOString(),
        machine: "m1",
        source: "gw",
        level: "info",
        message: "test",
        metadata: { key: "value" },
      });
      const results = aggregator.query();
      expect(results[0].metadata?.key).toBe("value");
    });
  });

  // ─── Error summary ────────────────────────────────────────────────────

  describe("getErrorSummary", () => {
    it("generates error summary for recent entries", () => {
      const now = new Date();
      aggregator.ingestOne({ timestamp: now.toISOString(), machine: "m1", source: "gateway", level: "error", message: "EADDRINUSE" });
      aggregator.ingestOne({ timestamp: now.toISOString(), machine: "m1", source: "gateway", level: "error", message: "EADDRINUSE" });
      aggregator.ingestOne({ timestamp: now.toISOString(), machine: "m2", source: "pm2", level: "warn", message: "High memory" });
      aggregator.ingestOne({ timestamp: now.toISOString(), machine: "m2", source: "pm2", level: "error", message: "Crash" });
      aggregator.ingestOne({ timestamp: now.toISOString(), machine: "m1", source: "gateway", level: "info", message: "OK" });

      const summary = aggregator.getErrorSummary(1);
      expect(summary.totalErrors).toBe(3);
      expect(summary.totalWarnings).toBe(1);
      expect(summary.byMachine.m1.errors).toBe(2);
      expect(summary.byMachine.m2.errors).toBe(1);
      expect(summary.byMachine.m2.warnings).toBe(1);
      expect(summary.bySource.gateway.errors).toBe(2);
      expect(summary.bySource.pm2.errors).toBe(1);
      expect(summary.topMessages.length).toBeGreaterThan(0);
      expect(summary.period.start).toBeTruthy();
      expect(summary.period.end).toBeTruthy();
    });

    it("returns empty summary when no errors", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "OK" });
      const summary = aggregator.getErrorSummary(1);
      expect(summary.totalErrors).toBe(0);
      expect(summary.totalWarnings).toBe(0);
    });

    it("includes fatal in error count", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "fatal", message: "System down" });
      const summary = aggregator.getErrorSummary(1);
      expect(summary.totalErrors).toBe(1);
    });

    it("topMessages sorted by frequency", () => {
      const now = new Date().toISOString();
      for (let i = 0; i < 5; i++) {
        aggregator.ingestOne({ timestamp: now, machine: "m1", source: "gw", level: "error", message: "Frequent error" });
      }
      for (let i = 0; i < 2; i++) {
        aggregator.ingestOne({ timestamp: now, machine: "m1", source: "gw", level: "error", message: "Less frequent" });
      }
      const summary = aggregator.getErrorSummary(1);
      expect(summary.topMessages[0].message).toBe("Frequent error");
      expect(summary.topMessages[0].count).toBe(5);
    });
  });

  // ─── JSONL persistence ────────────────────────────────────────────────

  describe("JSONL persistence", () => {
    it("persists entries to JSONL file", () => {
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "test" });

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("logs-") && f.endsWith(".jsonl"));
      expect(files.length).toBe(1);
      const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim();
      const record = JSON.parse(content);
      expect(record.message).toBe("test");
      expect(record.id).toBeTruthy();
    });

    it("does not crash on write failure", () => {
      const badAgg = new LogAggregator({ logDir: tmpDir });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      // Should not throw
      badAgg.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "test" });
    });
  });

  // ─── Buffer management ────────────────────────────────────────────────

  describe("buffer management", () => {
    it("getBufferSize returns current buffer count", () => {
      expect(aggregator.getBufferSize()).toBe(0);
      aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: "a" });
      expect(aggregator.getBufferSize()).toBe(1);
    });

    it("buffer caps at 10000 entries", () => {
      for (let i = 0; i < 10_050; i++) {
        aggregator.ingestOne({ timestamp: new Date().toISOString(), machine: "m1", source: "gw", level: "info", message: `msg-${i}` });
      }
      expect(aggregator.getBufferSize()).toBeLessThanOrEqual(10_000);
    });
  });

  // ─── Multi-machine aggregation ────────────────────────────────────────

  describe("multi-machine aggregation", () => {
    it("aggregates logs from multiple machines", () => {
      const machines = ["mac-mini-1", "mac-mini-2", "mac-studio", "vps-1", "vps-2"];
      const now = new Date().toISOString();

      for (const machine of machines) {
        aggregator.ingestOne({ timestamp: now, machine, source: "gateway", level: "info", message: "heartbeat" });
        aggregator.ingestOne({ timestamp: now, machine, source: "gateway", level: "error", message: "EADDRINUSE" });
      }

      const all = aggregator.query();
      expect(all.length).toBe(10);

      const m1Only = aggregator.query({ machine: "mac-mini-1" });
      expect(m1Only.length).toBe(2);

      const errorsOnly = aggregator.query({ level: "error" });
      expect(errorsOnly.length).toBe(5);
    });

    it("error summary spans all machines", () => {
      const now = new Date().toISOString();
      aggregator.ingestOne({ timestamp: now, machine: "mac-mini-1", source: "gw", level: "error", message: "err1" });
      aggregator.ingestOne({ timestamp: now, machine: "mac-mini-2", source: "gw", level: "error", message: "err2" });
      aggregator.ingestOne({ timestamp: now, machine: "vps-1", source: "pm2", level: "warn", message: "warn1" });

      const summary = aggregator.getErrorSummary(1);
      expect(Object.keys(summary.byMachine).length).toBe(3);
      expect(summary.totalErrors).toBe(2);
      expect(summary.totalWarnings).toBe(1);
    });
  });

  // ─── Disk query fallback ──────────────────────────────────────────────

  describe("disk query fallback", () => {
    it("reads from disk when buffer is empty for time-filtered queries", () => {
      // Write a record directly to disk
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10);
      const filePath = path.join(tmpDir, `logs-${dateStr}.jsonl`);
      const record = {
        id: "disk-record-1",
        timestamp: now.toISOString(),
        machine: "m1",
        source: "gateway",
        level: "error",
        message: "Disk-only error",
      };
      fs.writeFileSync(filePath, JSON.stringify(record) + "\n");

      // New aggregator with empty buffer
      const freshAgg = new LogAggregator({ logDir: tmpDir });
      const results = freshAgg.query({
        since: new Date(now.getTime() - 3600_000).toISOString(),
        until: new Date(now.getTime() + 3600_000).toISOString(),
      });
      expect(results.length).toBe(1);
      expect(results[0].message).toBe("Disk-only error");
    });
  });

  // ─── Constructor and retention ────────────────────────────────────────

  describe("constructor and retention", () => {
    it("does not crash if logDir creation fails", () => {
      expect(() => new LogAggregator({ logDir: "/dev/null/impossible", retentionDays: 30 })).not.toThrow();
    });

    it("cleans old files on construction", () => {
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
      const oldFile = `logs-${oldDate.toISOString().slice(0, 10)}.jsonl`;
      fs.writeFileSync(path.join(tmpDir, oldFile), '{"test":true}\n');

      // Create new aggregator with 30-day retention
      const _agg = new LogAggregator({ logDir: tmpDir, retentionDays: 30 });
      expect(fs.existsSync(path.join(tmpDir, oldFile))).toBe(false);
    });

    it("keeps recent files during cleanup", () => {
      const recentDate = new Date();
      const recentFile = `logs-${recentDate.toISOString().slice(0, 10)}.jsonl`;
      fs.writeFileSync(path.join(tmpDir, recentFile), '{"test":true}\n');

      const _agg = new LogAggregator({ logDir: tmpDir, retentionDays: 30 });
      expect(fs.existsSync(path.join(tmpDir, recentFile))).toBe(true);
    });

    it("defaults to 30 day retention", () => {
      // File from 31 days ago should be cleaned
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const oldFile = `logs-${oldDate.toISOString().slice(0, 10)}.jsonl`;
      fs.writeFileSync(path.join(tmpDir, oldFile), '{"test":true}\n');

      const _agg = new LogAggregator({ logDir: tmpDir });
      expect(fs.existsSync(path.join(tmpDir, oldFile))).toBe(false);
    });
  });

  // ─── Parse + ingest integration ───────────────────────────────────────

  describe("parse + ingest integration", () => {
    it("parses gateway log and ingests into queryable store", () => {
      const raw = [
        "2025-03-31T10:00:00.000Z [INFO] gateway: Started",
        "2025-03-31T10:01:00.000Z [ERROR] gateway: EADDRINUSE on port 18789",
      ].join("\n");

      const entries = aggregator.parseGatewayLog(raw, "mac-mini-1");
      aggregator.ingest(entries);

      const errors = aggregator.query({ level: "error" });
      expect(errors.length).toBe(1);
      expect(errors[0].message).toContain("EADDRINUSE");
    });

    it("parses PM2 log and ingests for multi-machine view", () => {
      const pm2Log = "2025-03-31T10:00:00: 0|gateway  | Error: connection timeout";
      const gwLog = "2025-03-31T10:00:00.000Z [ERROR] gateway: EADDRINUSE";

      aggregator.ingest(aggregator.parsePM2Log(pm2Log, "vps-1"));
      aggregator.ingest(aggregator.parseGatewayLog(gwLog, "mac-mini-1"));

      const allErrors = aggregator.query({ level: "error" });
      expect(allErrors.length).toBe(2);
      expect(allErrors.map((e) => e.machine).sort()).toEqual(["mac-mini-1", "vps-1"]);
    });
  });
});
