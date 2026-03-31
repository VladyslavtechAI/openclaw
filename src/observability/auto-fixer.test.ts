import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObservabilityEvent } from "./event-logger.js";
import { AutoFixer } from "./auto-fixer.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "auto-fixer-test-"));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

function makeEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    timestamp: new Date().toISOString(),
    level: "error",
    category: "gateway",
    machine: "test-machine",
    event: "test.event",
    ...overrides,
  };
}

// ─── AutoFixer ────────────────────────────────────────────────────────────

describe("AutoFixer", () => {
  let tmpDir: string;
  let fixer: AutoFixer;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fixer = new AutoFixer({ logDir: tmpDir });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── Builtin rules loading ───────────────────────────────────────────

  describe("builtin rules", () => {
    it("loads all 10 builtin rules on construction", () => {
      const rules = fixer.getRules();
      expect(rules.length).toBe(10);
    });

    it("has port-conflict-guard rule", () => {
      const rule = fixer.getRule("port-conflict-guard");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.type).toBe("port_conflict");
      expect(rule!.severity).toBe("high");
      expect(rule!.enabled).toBe(true);
    });

    it("has zombie-gateway-detector rule", () => {
      const rule = fixer.getRule("zombie-gateway-detector");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.type).toBe("process_zombie");
      expect(rule!.severity).toBe("critical");
    });

    it("has backup-script-missing rule", () => {
      const rule = fixer.getRule("backup-script-missing");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.type).toBe("file_missing");
      expect(rule!.fix.type).toBe("create_file");
    });

    it("has auth-error-loop-breaker rule", () => {
      const rule = fixer.getRule("auth-error-loop-breaker");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.type).toBe("error_loop");
      expect(rule!.fix.type).toBe("alert_only");
    });

    it("has backup-freshness-checker rule", () => {
      const rule = fixer.getRule("backup-freshness-checker");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.type).toBe("backup_stale");
    });

    it("has restart-loop-breaker rule", () => {
      const rule = fixer.getRule("restart-loop-breaker");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.type).toBe("log_match");
    });

    it("has telegram-ipv4-fixer rule", () => {
      const rule = fixer.getRule("telegram-ipv4-fixer");
      expect(rule).not.toBeNull();
      expect(rule!.fix.type).toBe("update_config");
    });

    it("has stale-lock-cleaner rule", () => {
      const rule = fixer.getRule("stale-lock-cleaner");
      expect(rule).not.toBeNull();
      expect(rule!.fix.type).toBe("run_command");
    });

    it("has log-rotation-enforcer rule", () => {
      const rule = fixer.getRule("log-rotation-enforcer");
      expect(rule).not.toBeNull();
      expect(rule!.pattern.match).toContain("ENOSPC");
    });

    it("has config-syntax-checker rule", () => {
      const rule = fixer.getRule("config-syntax-checker");
      expect(rule).not.toBeNull();
      expect(rule!.fix.type).toBe("alert_only");
      expect(rule!.severity).toBe("medium");
    });
  });

  // ─── Pattern matching via evaluate (log_match) ────────────────────────

  describe("log_match pattern matching via evaluate", () => {
    it("matches restart-loop-breaker on restart loop message", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "restart loop detected" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("restart-loop-breaker");
    });

    it("matches restart-loop-breaker on restarted N times", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "service restarted 5 times in 10 minutes" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("restart-loop-breaker");
    });

    it("matches restart-loop-breaker on KeepAlive restart", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "KeepAlive restart triggered" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("restart-loop-breaker");
    });

    it("matches telegram-ipv4-fixer on ETIMEDOUT telegram", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "ETIMEDOUT connecting to telegram API" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("telegram-ipv4-fixer");
    });

    it("matches telegram-ipv4-fixer on EHOSTUNREACH telegram", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EHOSTUNREACH telegram bot" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("telegram-ipv4-fixer");
    });

    it("matches stale-lock-cleaner on stale lock", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "stale lock file detected" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("stale-lock-cleaner");
    });

    it("matches stale-lock-cleaner on lock timeout", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "lock timeout waiting for gateway" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("stale-lock-cleaner");
    });

    it("matches log-rotation-enforcer on ENOSPC", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "ENOSPC: no space left on device" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("log-rotation-enforcer");
    });

    it("matches log-rotation-enforcer on disk full", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "disk full error writing logs" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("log-rotation-enforcer");
    });

    it("matches config-syntax-checker on SyntaxError JSON", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "SyntaxError: Unexpected token in JSON" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("config-syntax-checker");
    });

    it("matches config-syntax-checker on JSON.parse error in config", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "JSON.parse error reading config file" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("config-syntax-checker");
    });

    it("matches config-syntax-checker on Unexpected token config", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "Unexpected token } in config" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("config-syntax-checker");
    });
  });

  // ─── Pattern matching via evaluate (port_conflict) ────────────────────

  describe("port_conflict pattern matching via evaluate", () => {
    it("matches port-conflict-guard on EADDRINUSE event", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE: address already in use :::18789" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("port-conflict-guard");
    });

    it("matches port-conflict-guard on port already in use", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "port already in use 3848" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("port-conflict-guard");
    });
  });

  // ─── Pattern matching via evaluate (process_zombie) ───────────────────

  describe("process_zombie pattern matching via evaluate", () => {
    it("matches zombie-gateway-detector on zombie message", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "zombie gateway process detected pid 1234" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("zombie-gateway-detector");
    });

    it("matches zombie-gateway-detector on process running not listening", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "process is running but not listening on port" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("zombie-gateway-detector");
    });
  });

  // ─── Pattern matching via evaluate (error_loop) ───────────────────────

  describe("error_loop pattern matching via evaluate", () => {
    it("matches auth-error-loop-breaker on error loop", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "error loop detected in auth subsystem" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("auth-error-loop-breaker");
    });

    it("matches auth-error-loop-breaker on repeated error", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "repeated error: auth failure count exceeded" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("auth-error-loop-breaker");
    });

    it("matches auth-error-loop-breaker on retry exceed", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "retry exceeded for auth token refresh" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("auth-error-loop-breaker");
    });
  });

  // ─── No match ─────────────────────────────────────────────────────────

  describe("no match scenarios", () => {
    it("returns null for unmatched events", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "everything is fine" }),
      );
      expect(result).toBeNull();
    });

    it("returns null for empty event string", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "" }),
      );
      expect(result).toBeNull();
    });
  });

  // ─── Dry run vs execute mode ──────────────────────────────────────────

  describe("dry run mode (default)", () => {
    it("returns DRY RUN result by default", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port 18789" }),
      );
      expect(result).not.toBeNull();
      expect(result!.message).toContain("[DRY RUN]");
      expect(result!.success).toBe(true);
    });

    it("includes attempt info in dry run", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port 18789" }),
      );
      expect(result!.details?.dryRun).toBe(true);
      expect(result!.details?.attempt).toBe(1);
    });
  });

  describe("execute mode", () => {
    it("returns planned action for kill_process in execute mode", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      const result = await execFixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port 18789" }),
      );
      expect(result).not.toBeNull();
      expect(result!.message).toContain("Fix planned");
      expect(result!.action).toBe("kill_process");
    });

    it("returns planned action for restart_service in execute mode", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      const result = await execFixer.evaluate(
        makeEvent({ event: "zombie gateway on host" }),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("restart_service");
    });

    it("returns planned action for run_command in execute mode", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      const result = await execFixer.evaluate(
        makeEvent({ event: "restart loop breaker triggered" }),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("run_command");
    });

    it("returns planned action for update_config in execute mode", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      const result = await execFixer.evaluate(
        makeEvent({ event: "ETIMEDOUT telegram API call" }),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("update_config");
    });

    it("returns alert_only result for alert rules in execute mode", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      const result = await execFixer.evaluate(
        makeEvent({ event: "error loop detected in auth" }),
      );
      expect(result).not.toBeNull();
      expect(result!.action).toBe("alert_only");
    });
  });

  // ─── Cooldown logic ───────────────────────────────────────────────────

  describe("cooldown logic", () => {
    it("returns null during cooldown period", async () => {
      const first = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port 18789" }),
      );
      expect(first).not.toBeNull();

      // Same rule + same machine — should be in cooldown (60s)
      const second = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE again" }),
      );
      expect(second).toBeNull();
    });

    it("allows fix after cooldown elapses", async () => {
      vi.useFakeTimers();
      try {
        const fixerTimed = new AutoFixer({ logDir: tmpDir });

        const first = await fixerTimed.evaluate(
          makeEvent({ event: "EADDRINUSE on port" }),
        );
        expect(first).not.toBeNull();

        // Advance past the 60s cooldown
        vi.advanceTimersByTime(61_000);

        const second = await fixerTimed.evaluate(
          makeEvent({ event: "EADDRINUSE on port" }),
        );
        expect(second).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("cooldown is per machine", async () => {
      const first = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port", machine: "machine-a" }),
      );
      expect(first).not.toBeNull();

      // Different machine — should not be in cooldown
      const second = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port", machine: "machine-b" }),
      );
      expect(second).not.toBeNull();
    });
  });

  // ─── maxAttempts and escalation ───────────────────────────────────────

  describe("maxAttempts and escalation", () => {
    it("escalates after exceeding maxAttempts", async () => {
      vi.useFakeTimers();
      try {
        const escalated: string[] = [];
        const escalateFixer = new AutoFixer({
          logDir: tmpDir,
          onEscalate: (ruleId, msg) => escalated.push(`${ruleId}: ${msg}`),
        });

        // port-conflict-guard has maxAttempts=3, cooldown=60
        for (let i = 0; i < 3; i++) {
          vi.advanceTimersByTime(61_000);
          const r = await escalateFixer.evaluate(
            makeEvent({ event: "EADDRINUSE on port" }),
          );
          expect(r).not.toBeNull();
          expect(r!.success).toBe(true);
        }

        // 4th attempt should escalate
        vi.advanceTimersByTime(61_000);
        const escalation = await escalateFixer.evaluate(
          makeEvent({ event: "EADDRINUSE on port" }),
        );
        expect(escalation).not.toBeNull();
        expect(escalation!.success).toBe(false);
        expect(escalation!.message).toContain("exceeded");
        expect(escalation!.action).toBe("alert_only");
        expect(escalated.length).toBe(1);
        expect(escalated[0]).toContain("port-conflict-guard");
      } finally {
        vi.useRealTimers();
      }
    });

    it("escalation result includes attempt details", async () => {
      vi.useFakeTimers();
      try {
        const escalateFixer = new AutoFixer({
          logDir: tmpDir,
          onEscalate: () => {},
        });

        // Burn through 3 attempts
        for (let i = 0; i < 3; i++) {
          vi.advanceTimersByTime(61_000);
          await escalateFixer.evaluate(
            makeEvent({ event: "EADDRINUSE on port" }),
          );
        }

        vi.advanceTimersByTime(61_000);
        const result = await escalateFixer.evaluate(
          makeEvent({ event: "EADDRINUSE on port" }),
        );
        expect(result!.details?.attempts).toBe(4);
        expect(result!.details?.maxAttempts).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("onEscalate callback error does not crash", async () => {
      vi.useFakeTimers();
      try {
        const escalateFixer = new AutoFixer({
          logDir: tmpDir,
          onEscalate: () => {
            throw new Error("callback crash");
          },
        });

        for (let i = 0; i < 3; i++) {
          vi.advanceTimersByTime(61_000);
          await escalateFixer.evaluate(
            makeEvent({ event: "EADDRINUSE on port" }),
          );
        }

        vi.advanceTimersByTime(61_000);
        // Should not throw
        const result = await escalateFixer.evaluate(
          makeEvent({ event: "EADDRINUSE on port" }),
        );
        expect(result).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Rule enable/disable ──────────────────────────────────────────────

  describe("rule enable/disable", () => {
    it("disableRule prevents rule from matching", async () => {
      fixer.disableRule("port-conflict-guard");
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port 18789" }),
      );
      // port-conflict-guard is disabled, so it should not match
      expect(result === null || result.ruleId !== "port-conflict-guard").toBe(true);
    });

    it("enableRule re-enables a disabled rule", async () => {
      fixer.disableRule("port-conflict-guard");
      fixer.enableRule("port-conflict-guard");

      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port 18789" }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("port-conflict-guard");
    });

    it("disableRule returns false for unknown rule", () => {
      expect(fixer.disableRule("nonexistent")).toBe(false);
    });

    it("enableRule returns false for unknown rule", () => {
      expect(fixer.enableRule("nonexistent")).toBe(false);
    });

    it("disableRule returns true for known rule", () => {
      expect(fixer.disableRule("port-conflict-guard")).toBe(true);
    });

    it("enableRule returns true for known rule", () => {
      expect(fixer.enableRule("port-conflict-guard")).toBe(true);
    });
  });

  // ─── History tracking ─────────────────────────────────────────────────

  describe("history tracking", () => {
    it("records fix results in history", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));
      const history = fixer.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].ruleId).toBe("port-conflict-guard");
      expect(history[0].id).toBeTruthy();
    });

    it("filters history by machine", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" }));
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m2" }));

      const m1 = fixer.getHistory({ machine: "m1" });
      expect(m1.length).toBe(1);
      expect(m1[0].machine).toBe("m1");
    });

    it("filters history by ruleId", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));
      await fixer.evaluate(makeEvent({ event: "SyntaxError JSON parse error" }));

      const portResults = fixer.getHistory({ ruleId: "port-conflict-guard" });
      expect(portResults.length).toBe(1);
    });

    it("filters history by since", async () => {
      const now = new Date();
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));

      const future = new Date(now.getTime() + 60_000).toISOString();
      const results = fixer.getHistory({ since: future });
      expect(results.length).toBe(0);
    });

    it("caps history at 10000 entries", async () => {
      vi.useFakeTimers();
      try {
        const fastFixer = new AutoFixer({ logDir: tmpDir });

        // Add a custom rule with 0 cooldown and very high maxAttempts
        fastFixer.addRule({
          id: "high-volume",
          name: "High volume rule",
          description: "Test rule",
          pattern: { type: "log_match", match: "highvol" },
          fix: { type: "alert_only", cooldown: 0, maxAttempts: 20_000 },
          severity: "low",
          enabled: true,
        });

        for (let i = 0; i < 10_050; i++) {
          vi.advanceTimersByTime(1);
          await fastFixer.evaluate(makeEvent({ event: "highvol event" }));
        }

        const history = fastFixer.getHistory();
        expect(history.length).toBeLessThanOrEqual(10_000);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── Attempt tracking and reset ───────────────────────────────────────

  describe("attempt tracking and reset", () => {
    it("getAttemptCount returns 0 for fresh rule+machine", () => {
      expect(fixer.getAttemptCount("port-conflict-guard", "m1")).toBe(0);
    });

    it("getAttemptCount increments after fix", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" }));
      expect(fixer.getAttemptCount("port-conflict-guard", "m1")).toBe(1);
    });

    it("resetAttempts clears for specific machine", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" }));
      fixer.resetAttempts("port-conflict-guard", "m1");
      expect(fixer.getAttemptCount("port-conflict-guard", "m1")).toBe(0);
    });

    it("resetAttempts without machine clears all machines", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" }));
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m2" }));
      fixer.resetAttempts("port-conflict-guard");
      expect(fixer.getAttemptCount("port-conflict-guard", "m1")).toBe(0);
      expect(fixer.getAttemptCount("port-conflict-guard", "m2")).toBe(0);
    });
  });

  // ─── JSONL persistence ────────────────────────────────────────────────

  describe("JSONL persistence", () => {
    it("persists fix results to JSONL file", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("fixes-") && f.endsWith(".jsonl"));
      expect(files.length).toBe(1);

      const lines = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim().split("\n");
      expect(lines.length).toBe(1);

      const record = JSON.parse(lines[0]);
      expect(record.ruleId).toBe("port-conflict-guard");
      expect(record.id).toBeTruthy();
    });

    it("appends multiple fix results to same daily file", async () => {
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" }));
      await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m2" }));

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("fixes-") && f.endsWith(".jsonl"));
      expect(files.length).toBe(1);

      const lines = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim().split("\n");
      expect(lines.length).toBe(2);
    });

    it("does not crash if logDir is removed", async () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      // Should not throw
      const result = await fixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));
      expect(result).not.toBeNull();
    });
  });

  // ─── onFix callback ──────────────────────────────────────────────────

  describe("onFix callback", () => {
    it("calls onFix when a fix is applied", async () => {
      const fixes: string[] = [];
      const cbFixer = new AutoFixer({
        logDir: tmpDir,
        onFix: (result) => fixes.push(result.ruleId),
      });
      await cbFixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));
      expect(fixes.length).toBe(1);
      expect(fixes[0]).toBe("port-conflict-guard");
    });

    it("onFix callback error does not crash", async () => {
      const cbFixer = new AutoFixer({
        logDir: tmpDir,
        onFix: () => {
          throw new Error("callback crash");
        },
      });
      // Should not throw
      const result = await cbFixer.evaluate(makeEvent({ event: "EADDRINUSE on port" }));
      expect(result).not.toBeNull();
    });
  });

  // ─── Custom rules ────────────────────────────────────────────────────

  describe("custom rules", () => {
    it("addRule registers a new rule", () => {
      fixer.addRule({
        id: "custom-1",
        name: "Custom rule",
        description: "Test",
        pattern: { type: "log_match", match: "custom_error" },
        fix: { type: "alert_only", cooldown: 0, maxAttempts: 10 },
        severity: "low",
        enabled: true,
      });
      expect(fixer.getRules().length).toBe(11);
      expect(fixer.getRule("custom-1")).not.toBeNull();
    });

    it("removeRule removes a rule", () => {
      expect(fixer.removeRule("port-conflict-guard")).toBe(true);
      expect(fixer.getRule("port-conflict-guard")).toBeNull();
      expect(fixer.getRules().length).toBe(9);
    });

    it("removeRule returns false for unknown rule", () => {
      expect(fixer.removeRule("nonexistent")).toBe(false);
    });

    it("getRule returns null for unknown rule", () => {
      expect(fixer.getRule("nonexistent")).toBeNull();
    });

    it("getRule returns a copy of the rule", () => {
      const rule = fixer.getRule("port-conflict-guard")!;
      rule.enabled = false;
      // Original should not be affected
      expect(fixer.getRule("port-conflict-guard")!.enabled).toBe(true);
    });

    it("getRules returns copies", () => {
      const rules = fixer.getRules();
      rules[0].enabled = false;
      // Original should not be affected
      expect(fixer.getRules()[0].enabled).toBe(true);
    });
  });

  // ─── checkMachine ─────────────────────────────────────────────────────

  describe("checkMachine", () => {
    it("detects port conflict via machine check with custom rule", async () => {
      const customFixer = new AutoFixer({ logDir: tmpDir });
      customFixer.addRule({
        id: "port-18789-check",
        name: "Port 18789 conflict",
        description: "Check port 18789",
        pattern: { type: "port_conflict", port: 18789 },
        fix: { type: "kill_process", command: "lsof -ti:18789 | xargs kill -9", cooldown: 60, maxAttempts: 3 },
        severity: "high",
        enabled: true,
      });

      const results = await customFixer.checkMachine({
        machine: "m1",
        listeningPorts: [18789],
      });
      expect(results.some((r) => r.ruleId === "port-18789-check")).toBe(true);
    });

    it("detects zombie gateway via machine check", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        gateway: { pid: 1234, port: 18789, running: true, listening: false },
      });
      expect(results.some((r) => r.ruleId === "zombie-gateway-detector")).toBe(true);
    });

    it("does not detect zombie if gateway is healthy", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        gateway: { pid: 1234, port: 18789, running: true, listening: true },
      });
      expect(results.some((r) => r.ruleId === "zombie-gateway-detector")).toBe(false);
    });

    it("detects file missing via machine check", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        filePaths: ["/some/other/file.sh"],
      });
      expect(results.some((r) => r.ruleId === "backup-script-missing")).toBe(true);
    });

    it("does not detect file missing if file exists in check list", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        filePaths: ["/opt/devops/backup-local.sh"],
      });
      expect(results.some((r) => r.ruleId === "backup-script-missing")).toBe(false);
    });

    it("detects backup stale when backup is not configured", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        backup: { lastBackup: null, ageHours: 0, configured: false },
      });
      expect(results.some((r) => r.ruleId === "backup-freshness-checker")).toBe(true);
    });

    it("detects backup stale when backup is too old", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        backup: { lastBackup: "2025-01-01T00:00:00Z", ageHours: 48, configured: true },
      });
      expect(results.some((r) => r.ruleId === "backup-freshness-checker")).toBe(true);
    });

    it("does not detect backup stale when backup is fresh", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        backup: { lastBackup: new Date().toISOString(), ageHours: 2, configured: true },
      });
      expect(results.some((r) => r.ruleId === "backup-freshness-checker")).toBe(false);
    });

    it("detects backup stale when lastBackup is null", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        backup: { lastBackup: null, ageHours: 0, configured: true },
      });
      expect(results.some((r) => r.ruleId === "backup-freshness-checker")).toBe(true);
    });

    it("detects error_loop via machine check with enough errors", async () => {
      const customFixer = new AutoFixer({ logDir: tmpDir });
      customFixer.addRule({
        id: "test-error-loop",
        name: "Test error loop",
        description: "Test",
        pattern: { type: "error_loop", match: "auth fail" },
        fix: { type: "alert_only", cooldown: 0, maxAttempts: 10 },
        severity: "high",
        enabled: true,
      });

      const results = await customFixer.checkMachine({
        machine: "m1",
        recentErrors: [
          "auth fail: invalid token",
          "auth fail: expired",
          "auth fail: revoked",
          "auth fail: bad format",
          "auth fail: missing",
        ],
      });
      expect(results.some((r) => r.ruleId === "test-error-loop")).toBe(true);
    });

    it("does not trigger error_loop with fewer than 5 matching errors", async () => {
      const customFixer = new AutoFixer({ logDir: tmpDir });
      customFixer.addRule({
        id: "test-error-loop",
        name: "Test error loop",
        description: "Test",
        pattern: { type: "error_loop", match: "auth fail" },
        fix: { type: "alert_only", cooldown: 0, maxAttempts: 10 },
        severity: "high",
        enabled: true,
      });

      const results = await customFixer.checkMachine({
        machine: "m1",
        recentErrors: [
          "auth fail: invalid token",
          "auth fail: expired",
          "some other error",
        ],
      });
      expect(results.some((r) => r.ruleId === "test-error-loop")).toBe(false);
    });

    it("detects log_match via machine check recentErrors", async () => {
      const customFixer = new AutoFixer({ logDir: tmpDir });
      customFixer.addRule({
        id: "test-log-match",
        name: "Test log match",
        description: "Test",
        pattern: { type: "log_match", match: "custom_pattern" },
        fix: { type: "alert_only", cooldown: 0, maxAttempts: 10 },
        severity: "low",
        enabled: true,
      });

      const results = await customFixer.checkMachine({
        machine: "m1",
        recentErrors: ["something custom_pattern happened"],
      });
      expect(results.some((r) => r.ruleId === "test-log-match")).toBe(true);
    });

    it("returns empty results for clean machine", async () => {
      const results = await fixer.checkMachine({
        machine: "m1",
        listeningPorts: [],
        filePaths: ["/opt/devops/backup-local.sh"],
        recentErrors: [],
        gateway: { pid: 1234, port: 18789, running: true, listening: true },
        backup: { lastBackup: new Date().toISOString(), ageHours: 1, configured: true },
      });
      expect(results.length).toBe(0);
    });
  });

  // ─── Execute mode: create_file ────────────────────────────────────────

  describe("execute mode: create_file", () => {
    it("creates a missing file in execute mode", async () => {
      const targetPath = path.join(tmpDir, "test-scripts", "backup.sh");
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      execFixer.addRule({
        id: "create-test-file",
        name: "Create test file",
        description: "Test",
        pattern: { type: "file_missing", path: targetPath },
        fix: {
          type: "create_file",
          content: "#!/bin/bash\necho hello\n",
          cooldown: 0,
          maxAttempts: 3,
        },
        severity: "low",
        enabled: true,
      });

      const results = await execFixer.checkMachine({
        machine: "m1",
        filePaths: [],
      });
      expect(results.some((r) => r.ruleId === "create-test-file" && r.success)).toBe(true);
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.readFileSync(targetPath, "utf-8")).toBe("#!/bin/bash\necho hello\n");
    });

    it("fails create_file when content is missing", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      execFixer.addRule({
        id: "bad-create",
        name: "Bad create",
        description: "Test",
        pattern: { type: "file_missing", path: "/some/path" },
        fix: {
          type: "create_file",
          cooldown: 0,
          maxAttempts: 3,
        },
        severity: "low",
        enabled: true,
      });

      const results = await execFixer.checkMachine({
        machine: "m1",
        filePaths: [],
      });
      expect(results.some((r) => r.ruleId === "bad-create" && !r.success)).toBe(true);
    });

    it("handles create_file failure gracefully", async () => {
      const execFixer = new AutoFixer({ logDir: tmpDir, executeMode: true });
      execFixer.addRule({
        id: "fail-create",
        name: "Fail create",
        description: "Test",
        pattern: { type: "file_missing", path: "/dev/null/impossible/path" },
        fix: {
          type: "create_file",
          content: "test",
          cooldown: 0,
          maxAttempts: 3,
        },
        severity: "low",
        enabled: true,
      });

      const results = await execFixer.checkMachine({
        machine: "m1",
        filePaths: [],
      });
      expect(results.some((r) => r.ruleId === "fail-create" && !r.success)).toBe(true);
    });
  });

  // ─── Constructor resilience ───────────────────────────────────────────

  describe("constructor resilience", () => {
    it("does not crash if logDir creation fails", () => {
      expect(() => new AutoFixer({ logDir: "/dev/null/impossible" })).not.toThrow();
    });

    it("defaults to dry run mode", async () => {
      const f = new AutoFixer({ logDir: tmpDir });
      const r = await f.evaluate(makeEvent({ event: "EADDRINUSE" }));
      expect(r?.message).toContain("[DRY RUN]");
    });
  });

  // ─── Concurrent fixes on different machines ───────────────────────────

  describe("concurrent fixes", () => {
    it("handles parallel evaluations on different machines", async () => {
      const promises = [
        fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" })),
        fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m2" })),
        fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m3" })),
      ];
      const results = await Promise.all(promises);
      expect(results.filter((r) => r !== null).length).toBe(3);
    });

    it("concurrent evaluations share history", async () => {
      await Promise.all([
        fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m1" })),
        fixer.evaluate(makeEvent({ event: "EADDRINUSE on port", machine: "m2" })),
      ]);
      expect(fixer.getHistory().length).toBe(2);
    });
  });

  // ─── matchesPattern with data field ───────────────────────────────────

  describe("matchesPattern with data field", () => {
    it("matches when error info is in data field", async () => {
      const result = await fixer.evaluate(
        makeEvent({
          event: "gateway.error",
          data: { error: "EADDRINUSE: address already in use" },
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleId).toBe("port-conflict-guard");
    });

    it("matches pattern via JSON-serialized data", async () => {
      const result = await fixer.evaluate(
        makeEvent({
          event: "config.error",
          data: { message: "SyntaxError: JSON.parse error" },
        }),
      );
      expect(result).not.toBeNull();
    });
  });

  // ─── Machine result details ───────────────────────────────────────────

  describe("result metadata", () => {
    it("includes machine in result", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port", machine: "mac-mini-1" }),
      );
      expect(result!.machine).toBe("mac-mini-1");
    });

    it("includes timestamp in result", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port" }),
      );
      expect(result!.timestamp).toBeTruthy();
      // Verify it's a valid ISO timestamp
      expect(new Date(result!.timestamp).getTime()).not.toBeNaN();
    });

    it("includes ruleName in result", async () => {
      const result = await fixer.evaluate(
        makeEvent({ event: "EADDRINUSE on port" }),
      );
      expect(result!.ruleName).toBe("Port conflict guard");
    });
  });
});
