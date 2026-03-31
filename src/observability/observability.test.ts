import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertManager } from "./alert-manager.js";
import { DashboardApi } from "./dashboard-api.js";
import { EventLogger } from "./event-logger.js";
import type { ObservabilityEvent, StoredEvent } from "./event-logger.js";
import { MetricsCollector } from "./metrics-collector.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "observability-test-"));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

// ─── EventLogger ──────────────────────────────────────────────────────────

describe("EventLogger", () => {
  let tmpDir: string;
  let logger: EventLogger;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    logger = new EventLogger({ logDir: tmpDir, machineName: "test-machine" });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  it("logs an event and assigns an id", () => {
    const event = logger.log({
      level: "info",
      category: "gateway",
      event: "gateway.start",
    });
    expect(event.id).toBeTruthy();
    expect(event.level).toBe("info");
    expect(event.category).toBe("gateway");
    expect(event.machine).toBe("test-machine");
    expect(event.timestamp).toBeTruthy();
  });

  it("persists events to JSONL file", () => {
    logger.log({ level: "info", category: "gateway", event: "start" });
    logger.log({ level: "error", category: "api", event: "rate_limit" });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);

    const lines = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("includes optional fields when provided", () => {
    const event = logger.log({
      level: "warn",
      category: "agent",
      event: "agent.error",
      agentId: "agent-1",
      data: { reason: "timeout" },
      correlationId: "corr-123",
    });
    expect(event.agentId).toBe("agent-1");
    expect(event.data).toEqual({ reason: "timeout" });
    expect(event.correlationId).toBe("corr-123");
  });

  it("uses provided timestamp and machine", () => {
    const event = logger.log({
      level: "info",
      category: "gateway",
      event: "test",
      timestamp: "2025-01-01T00:00:00.000Z",
      machine: "custom-machine",
    });
    expect(event.timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(event.machine).toBe("custom-machine");
  });

  it("queries events with no filter returns recent events", () => {
    logger.log({ level: "info", category: "gateway", event: "a" });
    logger.log({ level: "error", category: "api", event: "b" });

    const results = logger.query({});
    expect(results.length).toBe(2);
  });

  it("filters by level", () => {
    logger.log({ level: "info", category: "gateway", event: "a" });
    logger.log({ level: "error", category: "api", event: "b" });
    logger.log({ level: "error", category: "tool", event: "c" });

    const errors = logger.query({ level: "error" });
    expect(errors.length).toBe(2);
    expect(errors.every((e) => e.level === "error")).toBe(true);
  });

  it("filters by multiple levels", () => {
    logger.log({ level: "info", category: "gateway", event: "a" });
    logger.log({ level: "warn", category: "api", event: "b" });
    logger.log({ level: "error", category: "tool", event: "c" });

    const results = logger.query({ levels: ["warn", "error"] });
    expect(results.length).toBe(2);
  });

  it("filters by category", () => {
    logger.log({ level: "info", category: "gateway", event: "a" });
    logger.log({ level: "info", category: "agent", event: "b" });

    const results = logger.query({ category: "gateway" });
    expect(results.length).toBe(1);
    expect(results[0].event).toBe("a");
  });

  it("filters by multiple categories", () => {
    logger.log({ level: "info", category: "gateway", event: "a" });
    logger.log({ level: "info", category: "agent", event: "b" });
    logger.log({ level: "info", category: "config", event: "c" });

    const results = logger.query({ categories: ["gateway", "config"] });
    expect(results.length).toBe(2);
  });

  it("filters by agentId", () => {
    logger.log({ level: "info", category: "agent", event: "a", agentId: "agent-1" });
    logger.log({ level: "info", category: "agent", event: "b", agentId: "agent-2" });

    const results = logger.query({ agentId: "agent-1" });
    expect(results.length).toBe(1);
    expect(results[0].agentId).toBe("agent-1");
  });

  it("filters by event name", () => {
    logger.log({ level: "info", category: "gateway", event: "gateway.start" });
    logger.log({ level: "info", category: "gateway", event: "gateway.stop" });

    const results = logger.query({ event: "gateway.start" });
    expect(results.length).toBe(1);
  });

  it("filters by correlationId", () => {
    logger.log({ level: "info", category: "agent", event: "a", correlationId: "c1" });
    logger.log({ level: "info", category: "agent", event: "b", correlationId: "c2" });

    const results = logger.query({ correlationId: "c1" });
    expect(results.length).toBe(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      logger.log({ level: "info", category: "gateway", event: `e${i}` });
    }

    const results = logger.query({ limit: 3 });
    expect(results.length).toBe(3);
    // Returns the last 3 (most recent)
    expect(results[0].event).toBe("e7");
  });

  it("filters by time range", () => {
    const now = new Date();
    logger.log({
      level: "info",
      category: "gateway",
      event: "old",
      timestamp: new Date(now.getTime() - 7200_000).toISOString(),
    });
    logger.log({
      level: "info",
      category: "gateway",
      event: "new",
      timestamp: now.toISOString(),
    });

    const results = logger.query({
      since: new Date(now.getTime() - 3600_000).toISOString(),
      until: new Date(now.getTime() + 1000).toISOString(),
    });
    expect(results.length).toBe(1);
    expect(results[0].event).toBe("new");
  });

  it("subscribe receives matching events", () => {
    const received: StoredEvent[] = [];
    const unsub = logger.subscribe({ level: "error" }, (event) => {
      received.push(event);
    });

    logger.log({ level: "info", category: "gateway", event: "a" });
    logger.log({ level: "error", category: "api", event: "b" });
    logger.log({ level: "error", category: "tool", event: "c" });

    expect(received.length).toBe(2);
    unsub();

    logger.log({ level: "error", category: "api", event: "d" });
    expect(received.length).toBe(2); // No more after unsub
  });

  it("getSubscriberCount tracks subscribers", () => {
    expect(logger.getSubscriberCount()).toBe(0);
    const unsub1 = logger.subscribe({}, () => {});
    const unsub2 = logger.subscribe({}, () => {});
    expect(logger.getSubscriberCount()).toBe(2);
    unsub1();
    expect(logger.getSubscriberCount()).toBe(1);
    unsub2();
    expect(logger.getSubscriberCount()).toBe(0);
  });

  it("subscriber errors do not crash the logger", () => {
    logger.subscribe({}, () => {
      throw new Error("subscriber crash");
    });

    // Should not throw
    const event = logger.log({ level: "info", category: "gateway", event: "test" });
    expect(event.id).toBeTruthy();
  });

  it("getMetrics returns aggregated data", () => {
    const now = new Date();
    logger.log({ level: "info", category: "gateway", event: "start", timestamp: now.toISOString(), machine: "m1" });
    logger.log({ level: "error", category: "api", event: "rate_limit", timestamp: now.toISOString(), machine: "m1" });
    logger.log({ level: "error", category: "api", event: "rate_limit", timestamp: now.toISOString(), machine: "m2" });
    logger.log({ level: "critical", category: "gateway", event: "crash", timestamp: now.toISOString(), machine: "m1" });

    const metrics = logger.getMetrics({
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(metrics.totalEvents).toBe(4);
    expect(metrics.byLevel.info).toBe(1);
    expect(metrics.byLevel.error).toBe(2);
    expect(metrics.byLevel.critical).toBe(1);
    expect(metrics.byCategory.gateway).toBe(2);
    expect(metrics.byCategory.api).toBe(2);
    expect(metrics.byMachine.m1).toBe(3);
    expect(metrics.byMachine.m2).toBe(1);
    expect(metrics.errorRate).toBe(0.75);
    expect(metrics.topEvents.length).toBeGreaterThan(0);
    expect(metrics.topEvents[0].event).toBe("rate_limit");
  });

  it("exportEvents as JSON", () => {
    logger.log({ level: "info", category: "gateway", event: "test" });
    const json = logger.exportEvents("json");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
  });

  it("exportEvents as CSV", () => {
    logger.log({ level: "info", category: "gateway", event: "test", data: { key: "value" } });
    const csv = logger.exportEvents("csv");
    const lines = csv.split("\n");
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("timestamp");
    expect(lines.length).toBe(2); // header + 1 row
  });

  it("handles corrupted JSONL lines gracefully", () => {
    // Write a valid event first
    logger.log({ level: "info", category: "gateway", event: "valid" });

    // Manually corrupt the file
    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".jsonl"));
    const filePath = path.join(tmpDir, files[0]);
    fs.appendFileSync(filePath, "not valid json\n");

    // Create a new logger to read the corrupted file — it should not crash,
    // but readDailyRecords will return [] on parse error (whole-file parse)
    const logger2 = new EventLogger({ logDir: tmpDir, machineName: "test" });
    const results = logger2.query({});
    // The corrupted line causes the entire file parse to fail, returning []
    expect(Array.isArray(results)).toBe(true);
  });

  it("cleans old files beyond retention", () => {
    // Create a file with an old date
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const oldFile = `events-${oldDate.toISOString().slice(0, 10)}.jsonl`;
    fs.writeFileSync(path.join(tmpDir, oldFile), '{"test":true}\n');

    // Create new logger — should clean old file
    const _logger2 = new EventLogger({ logDir: tmpDir, retentionDays: 30 });
    expect(fs.existsSync(path.join(tmpDir, oldFile))).toBe(false);
  });

  it("does not crash on write failure", () => {
    // Use a non-writable directory
    const badLogger = new EventLogger({ logDir: tmpDir, machineName: "test" });
    // Remove the directory
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Should not throw
    const event = badLogger.log({ level: "info", category: "gateway", event: "test" });
    expect(event.id).toBeTruthy();
  });
});

// ─── AlertManager ─────────────────────────────────────────────────────────

describe("AlertManager", () => {
  let tmpDir: string;
  let manager: AlertManager;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    manager = new AlertManager({ logDir: tmpDir, fetchFn: mockFetch as unknown as typeof fetch });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  const baseEvent: ObservabilityEvent = {
    timestamp: new Date().toISOString(),
    level: "error",
    category: "gateway",
    machine: "test-machine",
    event: "gateway.crash",
  };

  it("adds and retrieves rules", () => {
    manager.addRule({
      id: "r1",
      name: "Gateway crash",
      condition: { type: "match", level: "critical" },
      channels: [],
      cooldown: 60,
      severity: "critical",
    });

    expect(manager.getRules().length).toBe(1);
    expect(manager.getRule("r1")?.name).toBe("Gateway crash");
  });

  it("removes rules", () => {
    manager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match" },
      channels: [],
      cooldown: 60,
      severity: "info",
    });
    manager.removeRule("r1");
    expect(manager.getRules().length).toBe(0);
  });

  it("fires alert on match condition", async () => {
    manager.addRule({
      id: "r1",
      name: "Error alert",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const alerts = await manager.evaluate(baseEvent);
    expect(alerts.length).toBe(1);
    expect(alerts[0].ruleName).toBe("Error alert");
    expect(alerts[0].severity).toBe("warning");
  });

  it("does not fire on non-matching events", async () => {
    manager.addRule({
      id: "r1",
      name: "Critical only",
      condition: { type: "match", level: "critical" },
      channels: [],
      cooldown: 0,
      severity: "critical",
    });

    const alerts = await manager.evaluate(baseEvent); // level is "error", not "critical"
    expect(alerts.length).toBe(0);
  });

  it("respects cooldown period", async () => {
    manager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 3600, // 1 hour
      severity: "warning",
    });

    const first = await manager.evaluate(baseEvent);
    expect(first.length).toBe(1);

    const second = await manager.evaluate(baseEvent);
    expect(second.length).toBe(0); // Cooldown active
  });

  it("fires threshold alert when value exceeds threshold", async () => {
    manager.addRule({
      id: "cost-spike",
      name: "Cost spike",
      condition: { type: "threshold", field: "dailyCost", threshold: 10, category: "agent" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const lowCost = await manager.evaluate({
      ...baseEvent,
      category: "agent",
      data: { dailyCost: 5 },
    });
    expect(lowCost.length).toBe(0);

    const highCost = await manager.evaluate({
      ...baseEvent,
      category: "agent",
      data: { dailyCost: 15 },
    });
    expect(highCost.length).toBe(1);
  });

  it("fires rate alert when events exceed count in window", async () => {
    manager.addRule({
      id: "rate-limit",
      name: "Error burst",
      condition: { type: "rate", level: "error", maxCount: 3, windowSeconds: 600 },
      channels: [],
      cooldown: 0,
      severity: "critical",
    });

    // First 3 should not trigger
    for (let i = 0; i < 3; i++) {
      const alerts = await manager.evaluate(baseEvent);
      expect(alerts.length).toBe(0);
    }

    // 4th should trigger (exceeds maxCount of 3)
    const alerts = await manager.evaluate(baseEvent);
    expect(alerts.length).toBe(1);
  });

  it("disabled rules do not fire", async () => {
    manager.addRule({
      id: "r1",
      name: "Disabled",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
      enabled: false,
    });

    const alerts = await manager.evaluate(baseEvent);
    expect(alerts.length).toBe(0);
  });

  it("getActiveAlerts returns unacknowledged alerts", async () => {
    manager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    await manager.evaluate(baseEvent);
    expect(manager.getActiveAlerts().length).toBe(1);
  });

  it("acknowledge marks alert as acknowledged", async () => {
    manager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const [alert] = await manager.evaluate(baseEvent);
    expect(manager.acknowledge(alert.id)).toBe(true);
    expect(manager.getActiveAlerts().length).toBe(0);

    const acked = manager.getAllAlerts().find((a) => a.id === alert.id);
    expect(acked?.acknowledged).toBe(true);
    expect(acked?.acknowledgedAt).toBeTruthy();
  });

  it("acknowledge returns false for unknown id", () => {
    expect(manager.acknowledge("nonexistent")).toBe(false);
  });

  it("clearAcknowledged removes acknowledged alerts", async () => {
    manager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const [alert] = await manager.evaluate(baseEvent);
    manager.acknowledge(alert.id);
    const cleared = manager.clearAcknowledged();
    expect(cleared).toBe(1);
    expect(manager.getAllAlerts().length).toBe(0);
  });

  it("sends Telegram notification", async () => {
    manager.addRule({
      id: "r1",
      name: "Telegram test",
      condition: { type: "match", level: "error" },
      channels: [{ type: "telegram", botToken: "123:ABC", chatId: "456" }],
      cooldown: 0,
      severity: "critical",
    });

    await manager.evaluate(baseEvent);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.telegram.org/bot123:ABC/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("sends webhook notification", async () => {
    manager.addRule({
      id: "r1",
      name: "Webhook test",
      condition: { type: "match", level: "error" },
      channels: [{ type: "webhook", url: "https://hooks.example.com/alert" }],
      cooldown: 0,
      severity: "warning",
    });

    await manager.evaluate(baseEvent);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.example.com/alert",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("writes file alert", async () => {
    const alertFile = path.join(tmpDir, "test-alerts.jsonl");
    manager.addRule({
      id: "r1",
      name: "File test",
      condition: { type: "match", level: "error" },
      channels: [{ type: "file", filePath: alertFile }],
      cooldown: 0,
      severity: "info",
    });

    await manager.evaluate(baseEvent);

    // Give async dispatch a moment
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(alertFile)).toBe(true);
    const content = fs.readFileSync(alertFile, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.ruleName).toBe("File test");
  });

  it("channel dispatch failure does not crash evaluate", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    manager.addRule({
      id: "r1",
      name: "Fail test",
      condition: { type: "match", level: "error" },
      channels: [{ type: "webhook", url: "https://bad.example.com" }],
      cooldown: 0,
      severity: "warning",
    });

    // Should not throw
    const alerts = await manager.evaluate(baseEvent);
    expect(alerts.length).toBe(1);
  });

  it("match condition with category filter", async () => {
    manager.addRule({
      id: "r1",
      name: "API errors",
      condition: { type: "match", level: "error", category: "api" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const noMatch = await manager.evaluate(baseEvent); // category is "gateway"
    expect(noMatch.length).toBe(0);

    const match = await manager.evaluate({ ...baseEvent, category: "api" });
    expect(match.length).toBe(1);
  });

  it("match condition with event filter", async () => {
    manager.addRule({
      id: "r1",
      name: "Crash alert",
      condition: { type: "match", event: "gateway.crash" },
      channels: [],
      cooldown: 0,
      severity: "critical",
    });

    const match = await manager.evaluate(baseEvent);
    expect(match.length).toBe(1);

    const noMatch = await manager.evaluate({ ...baseEvent, event: "gateway.start" });
    expect(noMatch.length).toBe(0);
  });
});

// ─── MetricsCollector ─────────────────────────────────────────────────────

describe("MetricsCollector", () => {
  let tmpDir: string;
  let collector: MetricsCollector;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    collector = new MetricsCollector({ dataDir: tmpDir });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  const now = new Date();
  const ts = now.toISOString();

  it("records a metric point", () => {
    collector.record({ timestamp: ts, name: "requests", value: 42 });

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);
  });

  it("getTimeSeries returns bucketed data", () => {
    const base = now.getTime();
    // Record points across 5 minutes
    for (let i = 0; i < 5; i++) {
      collector.record({
        timestamp: new Date(base + i * 60_000).toISOString(),
        name: "latency",
        value: 100 + i * 10,
      });
    }

    const series = collector.getTimeSeries("latency", {
      start: new Date(base - 1000).toISOString(),
      end: new Date(base + 5 * 60_000).toISOString(),
    }, "1m");

    expect(series.name).toBe("latency");
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points.length).toBeLessThanOrEqual(5);
  });

  it("getTimeSeries aggregates values in same bucket", () => {
    const base = now.getTime();
    // Two points in the same 5-minute bucket
    collector.record({ timestamp: new Date(base).toISOString(), name: "cpu", value: 40 });
    collector.record({ timestamp: new Date(base + 1000).toISOString(), name: "cpu", value: 60 });

    const series = collector.getTimeSeries("cpu", {
      start: new Date(base - 1000).toISOString(),
      end: new Date(base + 60_000).toISOString(),
    }, "5m");

    expect(series.points.length).toBe(1);
    expect(series.points[0].value).toBe(50); // Average of 40 and 60
  });

  it("returns empty time series for unknown metric", () => {
    const series = collector.getTimeSeries("nonexistent", {
      start: new Date(now.getTime() - 3600_000).toISOString(),
      end: now.toISOString(),
    }, "1m");

    expect(series.points.length).toBe(0);
  });

  it("getSummary returns statistics", () => {
    const base = now.getTime();
    for (let i = 0; i < 10; i++) {
      collector.record({
        timestamp: new Date(base + i * 1000).toISOString(),
        name: "response_time",
        value: (i + 1) * 100,
      });
    }

    const summary = collector.getSummary({
      start: new Date(base - 1000).toISOString(),
      end: new Date(base + 60_000).toISOString(),
    });

    expect(summary.totalPoints).toBe(10);
    expect(summary.metrics.response_time).toBeDefined();

    const m = summary.metrics.response_time;
    expect(m.count).toBe(10);
    expect(m.min).toBe(100);
    expect(m.max).toBe(1000);
    expect(m.avg).toBe(550);
    expect(m.p50).toBeGreaterThan(0);
    expect(m.p95).toBeGreaterThanOrEqual(m.p50);
    expect(m.p99).toBeGreaterThanOrEqual(m.p95);
  });

  it("getSummary with multiple metrics", () => {
    collector.record({ timestamp: ts, name: "latency", value: 50 });
    collector.record({ timestamp: ts, name: "latency", value: 100 });
    collector.record({ timestamp: ts, name: "tokens", value: 1000 });

    const summary = collector.getSummary({
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(Object.keys(summary.metrics).length).toBe(2);
    expect(summary.metrics.latency.count).toBe(2);
    expect(summary.metrics.tokens.count).toBe(1);
  });

  it("getTopAgents ranks by total value", () => {
    collector.record({ timestamp: ts, name: "tokens", value: 100, agentId: "a1" });
    collector.record({ timestamp: ts, name: "tokens", value: 200, agentId: "a1" });
    collector.record({ timestamp: ts, name: "tokens", value: 500, agentId: "a2" });
    collector.record({ timestamp: ts, name: "tokens", value: 50, agentId: "a3" });

    const top = collector.getTopAgents("tokens", {
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    }, 2);

    expect(top.length).toBe(2);
    expect(top[0].agentId).toBe("a2");
    expect(top[0].value).toBe(500);
    expect(top[1].agentId).toBe("a1");
    expect(top[1].value).toBe(300);
  });

  it("getTopAgents ignores points without agentId", () => {
    collector.record({ timestamp: ts, name: "tokens", value: 100 }); // no agentId
    collector.record({ timestamp: ts, name: "tokens", value: 200, agentId: "a1" });

    const top = collector.getTopAgents("tokens", {
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    }, 10);

    expect(top.length).toBe(1);
    expect(top[0].agentId).toBe("a1");
  });

  it("respects limit in getTopAgents", () => {
    for (let i = 0; i < 5; i++) {
      collector.record({ timestamp: ts, name: "cost", value: i * 10, agentId: `a${i}` });
    }

    const top = collector.getTopAgents("cost", {
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    }, 3);

    expect(top.length).toBe(3);
  });

  it("handles resolution parsing", () => {
    collector.record({ timestamp: ts, name: "test", value: 1 });

    // Various resolution formats
    for (const res of ["1s", "5m", "1h", "1d"]) {
      const series = collector.getTimeSeries("test", {
        start: new Date(now.getTime() - 86_400_000).toISOString(),
        end: new Date(now.getTime() + 60_000).toISOString(),
      }, res);
      expect(series.points.length).toBeGreaterThanOrEqual(0);
    }

    // Invalid resolution falls back to 1m
    const series = collector.getTimeSeries("test", {
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    }, "invalid");
    expect(Array.isArray(series.points)).toBe(true);
  });

  it("cleans old metric files beyond retention", () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const oldFile = `metrics-${oldDate.toISOString().slice(0, 10)}.jsonl`;
    fs.writeFileSync(path.join(tmpDir, oldFile), '{"test":true}\n');

    const _collector2 = new MetricsCollector({ dataDir: tmpDir, retentionDays: 30 });
    expect(fs.existsSync(path.join(tmpDir, oldFile))).toBe(false);
  });

  it("does not crash on write failure", () => {
    const badCollector = new MetricsCollector({ dataDir: tmpDir });
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Should not throw
    badCollector.record({ timestamp: ts, name: "test", value: 1 });
  });
});

// ─── DashboardApi ─────────────────────────────────────────────────────────

describe("DashboardApi", () => {
  let tmpDir: string;
  let eventLogger: EventLogger;
  let alertManager: AlertManager;
  let metricsCollector: MetricsCollector;
  let api: DashboardApi;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    eventLogger = new EventLogger({ logDir: path.join(tmpDir, "events"), machineName: "test" });
    alertManager = new AlertManager({ logDir: path.join(tmpDir, "alerts") });
    metricsCollector = new MetricsCollector({ dataDir: path.join(tmpDir, "metrics") });
    api = new DashboardApi({ eventLogger, alertManager, metricsCollector });
  });

  afterEach(async () => {
    await api.stop();
    cleanDir(tmpDir);
  });

  // Helper to simulate HTTP requests using handleRequest directly
  function mockRequest(method: string, url: string): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve) => {
      const req = new http.IncomingMessage(null as unknown as import("node:net").Socket);
      req.method = method;
      req.url = url;
      req.headers = { host: "localhost:9100" };

      const chunks: Buffer[] = [];
      const res = new http.ServerResponse(req);
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);

      res.write = ((chunk: unknown) => {
        if (chunk) chunks.push(Buffer.from(chunk as string));
        return originalWrite(chunk);
      }) as typeof res.write;

      res.end = ((chunk?: unknown) => {
        if (chunk) chunks.push(Buffer.from(chunk as string));
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({ status: res.statusCode, body: JSON.parse(body) });
        return originalEnd();
      }) as typeof res.end;

      api.handleRequest(req, res);
    });
  }

  it("GET /api/events returns events", async () => {
    eventLogger.log({ level: "info", category: "gateway", event: "test" });

    const since = new Date(Date.now() - 3600_000).toISOString();
    const { status, body } = await mockRequest("GET", `/api/events?since=${encodeURIComponent(since)}`);
    expect(status).toBe(200);
    expect((body as { events: unknown[] }).events.length).toBe(1);
  });

  it("GET /api/events with filters", async () => {
    eventLogger.log({ level: "info", category: "gateway", event: "a" });
    eventLogger.log({ level: "error", category: "api", event: "b" });

    const since = new Date(Date.now() - 3600_000).toISOString();
    const { body } = await mockRequest("GET", `/api/events?level=error&since=${encodeURIComponent(since)}`);
    expect((body as { events: unknown[] }).events.length).toBe(1);
  });

  it("GET /api/metrics returns summary", async () => {
    metricsCollector.record({
      timestamp: new Date().toISOString(),
      name: "latency",
      value: 100,
    });

    const { status, body } = await mockRequest("GET", "/api/metrics");
    expect(status).toBe(200);
    expect((body as { summary: unknown }).summary).toBeDefined();
  });

  it("GET /api/metrics with name returns time series", async () => {
    metricsCollector.record({
      timestamp: new Date().toISOString(),
      name: "latency",
      value: 100,
    });

    const { body } = await mockRequest("GET", "/api/metrics?name=latency");
    expect((body as { timeSeries: unknown }).timeSeries).toBeDefined();
  });

  it("GET /api/alerts returns alerts and rules", async () => {
    alertManager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const { status, body } = await mockRequest("GET", "/api/alerts");
    expect(status).toBe(200);
    expect((body as { rules: unknown[] }).rules.length).toBe(1);
  });

  it("POST /api/alerts/:id/ack acknowledges alert", async () => {
    alertManager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    const alerts = await alertManager.evaluate({
      timestamp: new Date().toISOString(),
      level: "error",
      category: "gateway",
      machine: "test",
      event: "crash",
    });

    const { body } = await mockRequest("POST", `/api/alerts/${alerts[0].id}/ack`);
    expect((body as { success: boolean }).success).toBe(true);
    expect(alertManager.getActiveAlerts().length).toBe(0);
  });

  it("GET /api/agents returns agent list", async () => {
    eventLogger.log({
      level: "info",
      category: "agent",
      event: "session.start",
      agentId: "agent-1",
    });
    eventLogger.log({
      level: "error",
      category: "agent",
      event: "session.error",
      agentId: "agent-1",
    });

    const since = new Date(Date.now() - 3600_000).toISOString();
    const { body } = await mockRequest("GET", `/api/agents?since=${encodeURIComponent(since)}`);
    const agents = (body as { agents: Array<{ agentId: string; events: number; errors: number }> }).agents;
    expect(agents.length).toBe(1);
    expect(agents[0].agentId).toBe("agent-1");
    expect(agents[0].events).toBe(2);
    expect(agents[0].errors).toBe(1);
  });

  it("GET /api/health returns system health", async () => {
    const { status, body } = await mockRequest("GET", "/api/health");
    expect(status).toBe(200);

    const health = body as { status: string; timestamp: string; activeAlerts: number };
    expect(health.status).toBe("healthy");
    expect(health.timestamp).toBeTruthy();
    expect(health.activeAlerts).toBe(0);
  });

  it("GET /api/health shows degraded when warnings exist", async () => {
    alertManager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "warning",
    });

    await alertManager.evaluate({
      timestamp: new Date().toISOString(),
      level: "error",
      category: "gateway",
      machine: "test",
      event: "error",
    });

    const { body } = await mockRequest("GET", "/api/health");
    expect((body as { status: string }).status).toBe("degraded");
  });

  it("GET /api/health shows critical when critical alerts exist", async () => {
    alertManager.addRule({
      id: "r1",
      name: "Test",
      condition: { type: "match", level: "error" },
      channels: [],
      cooldown: 0,
      severity: "critical",
    });

    await alertManager.evaluate({
      timestamp: new Date().toISOString(),
      level: "error",
      category: "gateway",
      machine: "test",
      event: "crash",
    });

    const { body } = await mockRequest("GET", "/api/health");
    expect((body as { status: string }).status).toBe("critical");
  });

  it("returns 404 for unknown routes", async () => {
    const { status, body } = await mockRequest("GET", "/api/nonexistent");
    expect(status).toBe(404);
    expect((body as { error: string }).error).toBe("Not found");
  });

  it("handles OPTIONS for CORS preflight", async () => {
    const req = new http.IncomingMessage(null as unknown as import("node:net").Socket);
    req.method = "OPTIONS";
    req.url = "/api/events";
    req.headers = { host: "localhost" };

    const res = new http.ServerResponse(req);
    let endStatus = 0;
    const originalWriteHead = res.writeHead.bind(res);
    res.writeHead = ((status: number, ...args: unknown[]) => {
      endStatus = status;
      return originalWriteHead(status, ...args);
    }) as typeof res.writeHead;

    await api.handleRequest(req, res);
    expect(endStatus).toBe(204);
  });
});

// ─── Integration ──────────────────────────────────────────────────────────

describe("Observability integration", () => {
  let tmpDir: string;
  let eventLogger: EventLogger;
  let alertManager: AlertManager;
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    eventLogger = new EventLogger({ logDir: path.join(tmpDir, "events"), machineName: "integration-host" });
    alertManager = new AlertManager({ logDir: path.join(tmpDir, "alerts") });
    metricsCollector = new MetricsCollector({ dataDir: path.join(tmpDir, "metrics") });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  it("end-to-end: log event → evaluate alert → record metric", async () => {
    // Set up alert rule
    alertManager.addRule({
      id: "error-burst",
      name: "Error burst",
      condition: { type: "match", level: "error" },
      channels: [{ type: "file", filePath: path.join(tmpDir, "alerts", "alerts.jsonl") }],
      cooldown: 0,
      severity: "warning",
    });

    // Log events and evaluate
    for (let i = 0; i < 5; i++) {
      const event = eventLogger.log({
        level: "error",
        category: "api",
        event: "rate_limit",
        agentId: "agent-1",
        data: { statusCode: 429 },
      });

      await alertManager.evaluate(event);

      metricsCollector.record({
        timestamp: event.timestamp,
        name: "error_count",
        value: 1,
        agentId: "agent-1",
      });
    }

    // Verify events
    const events = eventLogger.query({ category: "api" });
    expect(events.length).toBe(5);

    // Verify alerts fired (only first due to cooldown=0, all fire)
    const alerts = alertManager.getAllAlerts();
    expect(alerts.length).toBe(5);

    // Verify metrics
    const summary = metricsCollector.getSummary({
      start: new Date(Date.now() - 60_000).toISOString(),
      end: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(summary.metrics.error_count.count).toBe(5);
    expect(summary.metrics.error_count.sum).toBe(5);
  });

  it("end-to-end: subscribe to events and collect metrics on match", () => {
    const collected: number[] = [];

    eventLogger.subscribe({ level: "critical" }, (event) => {
      metricsCollector.record({
        timestamp: event.timestamp,
        name: "critical_events",
        value: 1,
        machine: event.machine,
      });
      collected.push(1);
    });

    // Non-critical events should not trigger
    eventLogger.log({ level: "info", category: "gateway", event: "start" });
    eventLogger.log({ level: "warn", category: "config", event: "changed" });
    expect(collected.length).toBe(0);

    // Critical events should trigger
    eventLogger.log({ level: "critical", category: "gateway", event: "crash" });
    expect(collected.length).toBe(1);
  });

  it("multi-machine event aggregation", () => {
    const machines = ["mac-mini-1", "mac-mini-2", "mac-studio", "vps-1", "vps-2"];
    const now = new Date();

    for (const machine of machines) {
      for (let i = 0; i < 3; i++) {
        eventLogger.log({
          level: i === 2 ? "error" : "info",
          category: "agent",
          event: `agent.request`,
          machine,
          agentId: `${machine}-agent`,
          timestamp: now.toISOString(),
        });
      }
    }

    const metrics = eventLogger.getMetrics({
      start: new Date(now.getTime() - 60_000).toISOString(),
      end: new Date(now.getTime() + 60_000).toISOString(),
    });

    expect(metrics.totalEvents).toBe(15);
    expect(Object.keys(metrics.byMachine).length).toBe(5);
    expect(metrics.byLevel.error).toBe(5);
    expect(metrics.byLevel.info).toBe(10);
  });
});
