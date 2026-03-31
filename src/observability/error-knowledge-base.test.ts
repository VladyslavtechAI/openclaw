import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorKnowledgeBase } from "./error-knowledge-base.js";
import type { KnownError } from "./error-knowledge-base.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "error-kb-test-"));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

// ─── ErrorKnowledgeBase ──────────────────────────────────────────────────

describe("ErrorKnowledgeBase", () => {
  let tmpDir: string;
  let kb: ErrorKnowledgeBase;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    kb = new ErrorKnowledgeBase({ logDir: tmpDir });
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  // ─── Builtin errors loading ──────────────────────────────────────────

  describe("builtin errors", () => {
    it("loads all 23 builtin errors on construction", () => {
      expect(kb.size()).toBe(23);
    });

    it("has eaddrinuse error", () => {
      const error = kb.get("eaddrinuse");
      expect(error).not.toBeNull();
      expect(error!.category).toBe("port");
      expect(error!.severity).toBe("high");
      expect(error!.automated).toBe(true);
    });

    it("has exit-127 error", () => {
      const error = kb.get("exit-127");
      expect(error).not.toBeNull();
      expect(error!.category).toBe("script");
    });

    it("has gateway-already-running error", () => {
      const error = kb.get("gateway-already-running");
      expect(error).not.toBeNull();
      expect(error!.category).toBe("gateway");
    });

    it("has stale-socket-restart error", () => {
      const error = kb.get("stale-socket-restart");
      expect(error).not.toBeNull();
      expect(error!.severity).toBe("critical");
    });

    it("has auth-profiles-parse error", () => {
      const error = kb.get("auth-profiles-parse");
      expect(error).not.toBeNull();
      expect(error!.automated).toBe(false);
    });

    it("has all expected error IDs", () => {
      const expectedIds = [
        "eaddrinuse", "exit-127", "gateway-already-running", "stale-socket-restart",
        "auth-profiles-parse", "auth-suffix-format", "config-field-typo",
        "cost-field-wrong-location", "network-timeout", "backup-stale",
        "auth-error-loop", "agent-frozen", "telegram-bot-error", "version-outdated",
        "gateway-down", "ssh-unreachable", "sigterm-exit", "sigkill-exit",
        "memory-pressure", "path-not-found", "zombie-gateway", "stale-lock-file",
        "disk-full",
      ];
      for (const id of expectedIds) {
        expect(kb.get(id)).not.toBeNull();
      }
    });
  });

  // ─── Pattern matching (regex patterns) ────────────────────────────────

  describe("pattern matching - regex patterns", () => {
    it("identifies EADDRINUSE errors", () => {
      const result = kb.identify("Error: EADDRINUSE: address already in use :::18789");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("eaddrinuse");
    });

    it("identifies address already in use variant", () => {
      const result = kb.identify("address already in use on port 3848");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("eaddrinuse");
    });

    it("identifies port already bound", () => {
      const result = kb.identify("port already bound to 18789");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("eaddrinuse");
    });

    it("identifies exit code 127", () => {
      const result = kb.identify("Process exited with exit code: 127");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("exit-127");
    });

    it("identifies command not found", () => {
      const result = kb.identify("bash: openclaw: command not found");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("exit-127");
    });

    it("identifies gateway lock conflict", () => {
      const result = kb.identify("Error: gateway already running on pid 1234");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("gateway-already-running");
    });

    it("identifies lockfile held", () => {
      const result = kb.identify("Cannot start: lockfile held by another process");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("gateway-already-running");
    });

    it("identifies stale socket", () => {
      const result = kb.identify("Detected stale socket from previous crash");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("stale-socket-restart");
    });

    it("identifies auth profiles parse error", () => {
      const result = kb.identify("SyntaxError in auth-profiles.json parse");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("auth-profiles-parse");
    });

    it("identifies network timeout - ETIMEDOUT", () => {
      const result = kb.identify("Error: ETIMEDOUT connecting to api.telegram.org");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("network-timeout");
    });

    it("identifies network timeout - ECONNREFUSED", () => {
      const result = kb.identify("Error: ECONNREFUSED 127.0.0.1:18789");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("network-timeout");
    });

    it("identifies EHOSTUNREACH", () => {
      const result = kb.identify("EHOSTUNREACH: cannot reach api.telegram.org");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("network-timeout");
    });

    it("identifies connection timed out", () => {
      const result = kb.identify("connection timed out after 30s");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("network-timeout");
    });

    it("identifies backup stale", () => {
      const result = kb.identify("Warning: backup stale, last run 48h ago");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("backup-stale");
    });

    it("identifies backup not running", () => {
      const result = kb.identify("Alert: backup not running on mac-mini-2");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("backup-stale");
    });

    it("identifies auth error loop", () => {
      const result = kb.identify("auth error loop detected: 5 consecutive failures");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("auth-error-loop");
    });

    it("identifies agent frozen", () => {
      const result = kb.identify("Agent agent-123 frozen for 5 minutes");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("agent-frozen");
    });

    it("identifies agent not responding", () => {
      const result = kb.identify("agent not responding to health check");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("agent-frozen");
    });

    it("identifies telegram bot token invalid", () => {
      const result = kb.identify("401 Unauthorized: telegram bot token invalid");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("telegram-bot-error");
    });

    it("identifies gateway down", () => {
      const result = kb.identify("Alert: gateway down on mac-studio");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("gateway-down");
    });

    it("identifies gateway not running", () => {
      const result = kb.identify("gateway not running, port not listening");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("gateway-down");
    });

    it("identifies SSH unreachable", () => {
      const result = kb.identify("ssh unreachable: mac-mini-2 down");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("ssh-unreachable");
    });

    it("identifies SSH connection refused", () => {
      const result = kb.identify("Connection refused on port 22");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("ssh-unreachable");
    });

    it("identifies SIGTERM", () => {
      const result = kb.identify("Process received SIGTERM, shutting down");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("sigterm-exit");
    });

    it("identifies SIGKILL", () => {
      const result = kb.identify("Process killed with SIGKILL signal 9");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("sigkill-exit");
    });

    it("identifies killed -9", () => {
      const result = kb.identify("Process was killed -9 by OOM killer");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("sigkill-exit");
    });

    it("identifies memory pressure OOM", () => {
      const result = kb.identify("OOM: Cannot allocate memory for new process");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("memory-pressure");
    });

    it("identifies out of memory", () => {
      const result = kb.identify("Fatal error: out of memory");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("memory-pressure");
    });

    it("identifies PATH not found", () => {
      const result = kb.identify("PATH not found for openclaw binary");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("path-not-found");
    });

    it("identifies binary not found", () => {
      const result = kb.identify("binary not found: openclaw-gateway");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("path-not-found");
    });

    it("identifies zombie gateway", () => {
      const result = kb.identify("zombie gateway detected: pid exists but port not in LISTEN");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("zombie-gateway");
    });

    it("identifies process running not listening", () => {
      const result = kb.identify("process running but not listening on port 18789");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("zombie-gateway");
    });

    it("identifies stale lock file", () => {
      const result = kb.identify("Error: stale lock file exists at ~/.openclaw/gateway.lock");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("stale-lock-file");
    });

    it("identifies disk full ENOSPC", () => {
      const result = kb.identify("Error: ENOSPC: no space left on device");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("disk-full");
    });

    it("identifies write failed space", () => {
      const result = kb.identify("write failed: no space left on device");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("disk-full");
    });

    it("identifies version outdated", () => {
      const result = kb.identify("Warning: version outdated, update available");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("version-outdated");
    });

    it("identifies config field typo", () => {
      const result = kb.identify("Warning: possible typo in field name 'fallbacks'");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("config-field-typo");
    });

    it("identifies auth suffix format", () => {
      const result = kb.identify("Error: type contains colon: anthropic:main");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("auth-suffix-format");
    });

    it("identifies cost field wrong location", () => {
      const result = kb.identify("Warning: cost should be inside models array");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("cost-field-wrong-location");
    });
  });

  // ─── identify edge cases ──────────────────────────────────────────────

  describe("identify edge cases", () => {
    it("returns null for unrecognized error", () => {
      const result = kb.identify("everything is working perfectly");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(kb.identify("")).toBeNull();
    });

    it("returns null for non-string input", () => {
      expect(kb.identify(null as unknown as string)).toBeNull();
      expect(kb.identify(undefined as unknown as string)).toBeNull();
      expect(kb.identify(42 as unknown as string)).toBeNull();
    });

    it("case-insensitive matching", () => {
      const lower = kb.identify("eaddrinuse on port");
      const upper = kb.identify("EADDRINUSE ON PORT");
      expect(lower).not.toBeNull();
      expect(upper).not.toBeNull();
      expect(lower!.id).toBe(upper!.id);
    });

    it("returns a copy with copied occurrences", () => {
      const result = kb.identify("EADDRINUSE on port");
      expect(result).not.toBeNull();
      // Mutating should not affect the internal state
      result!.occurrences.push({
        timestamp: new Date().toISOString(),
        machine: "test",
      });
      const fresh = kb.identify("EADDRINUSE on port");
      expect(fresh!.occurrences.length).toBe(0);
    });
  });

  // ─── Recording occurrences ────────────────────────────────────────────

  describe("recording occurrences", () => {
    it("records an occurrence and increments count", () => {
      kb.record("eaddrinuse", "mac-mini-1", "port 18789");
      const error = kb.get("eaddrinuse")!;
      expect(error.occurrences.length).toBe(1);
      expect(error.occurrences[0].machine).toBe("mac-mini-1");
      expect(error.occurrences[0].details).toBe("port 18789");
    });

    it("records multiple occurrences", () => {
      kb.record("eaddrinuse", "mac-mini-1");
      kb.record("eaddrinuse", "mac-mini-2");
      kb.record("eaddrinuse", "mac-studio");
      expect(kb.get("eaddrinuse")!.occurrences.length).toBe(3);
    });

    it("does nothing for unknown errorId", () => {
      // Should not throw
      kb.record("nonexistent", "m1");
      expect(kb.size()).toBe(23); // unchanged
    });

    it("records occurrence without details", () => {
      kb.record("eaddrinuse", "m1");
      const occ = kb.get("eaddrinuse")!.occurrences[0];
      expect(occ.machine).toBe("m1");
      expect(occ.details).toBeUndefined();
    });

    it("persists occurrence to JSONL file", () => {
      kb.record("eaddrinuse", "m1", "port 3848");

      const files = fs.readdirSync(tmpDir).filter((f) => f.startsWith("error-occurrences-") && f.endsWith(".jsonl"));
      expect(files.length).toBe(1);

      const content = fs.readFileSync(path.join(tmpDir, files[0]), "utf-8").trim();
      const record = JSON.parse(content);
      expect(record.errorId).toBe("eaddrinuse");
      expect(record.machine).toBe("m1");
      expect(record.details).toBe("port 3848");
    });

    it("does not crash if logDir is removed", () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      // Should not throw
      kb.record("eaddrinuse", "m1");
    });
  });

  // ─── getTopErrors ─────────────────────────────────────────────────────

  describe("getTopErrors", () => {
    it("returns errors sorted by occurrence count", () => {
      kb.record("eaddrinuse", "m1");
      kb.record("eaddrinuse", "m2");
      kb.record("eaddrinuse", "m3");
      kb.record("gateway-down", "m1");
      kb.record("gateway-down", "m2");
      kb.record("memory-pressure", "m1");

      const top = kb.getTopErrors(3);
      expect(top.length).toBe(3);
      expect(top[0].id).toBe("eaddrinuse");
      expect(top[0].occurrences.length).toBe(3);
      expect(top[1].id).toBe("gateway-down");
      expect(top[1].occurrences.length).toBe(2);
      expect(top[2].id).toBe("memory-pressure");
      expect(top[2].occurrences.length).toBe(1);
    });

    it("returns all errors if limit exceeds total", () => {
      const all = kb.getTopErrors(100);
      expect(all.length).toBe(23);
    });

    it("returns empty for limit 0", () => {
      expect(kb.getTopErrors(0).length).toBe(0);
    });

    it("handles negative limit gracefully", () => {
      expect(kb.getTopErrors(-1).length).toBe(0);
    });
  });

  // ─── getByCategory and getBySeverity ──────────────────────────────────

  describe("getByCategory and getBySeverity", () => {
    it("filters by category", () => {
      const gatewayErrors = kb.getByCategory("gateway");
      expect(gatewayErrors.length).toBeGreaterThan(0);
      expect(gatewayErrors.every((e) => e.category === "gateway")).toBe(true);
    });

    it("returns empty for unknown category", () => {
      expect(kb.getByCategory("nonexistent").length).toBe(0);
    });

    it("filters by severity", () => {
      const critical = kb.getBySeverity("critical");
      expect(critical.length).toBeGreaterThan(0);
      expect(critical.every((e) => e.severity === "critical")).toBe(true);
    });

    it("returns empty for severity with no matches after filtering", () => {
      // Remove all low severity errors for this test
      const lowErrors = kb.getBySeverity("low");
      for (const e of lowErrors) {
        kb.remove(e.id);
      }
      expect(kb.getBySeverity("low").length).toBe(0);
    });
  });

  // ─── export and import ────────────────────────────────────────────────

  describe("export and import", () => {
    it("exports as valid JSON", () => {
      const json = kb.export();
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(23);
    });

    it("exports include all fields", () => {
      kb.record("eaddrinuse", "m1", "test details");
      const json = kb.export();
      const parsed = JSON.parse(json) as KnownError[];
      const eaddrinuse = parsed.find((e) => e.id === "eaddrinuse")!;
      expect(eaddrinuse.pattern).toBeTruthy();
      expect(eaddrinuse.category).toBe("port");
      expect(eaddrinuse.occurrences.length).toBe(1);
    });

    it("imports errors from JSON", () => {
      const newErrors: KnownError[] = [{
        id: "custom-error-1",
        pattern: "custom.*error",
        category: "custom",
        title: "Custom Error",
        cause: "Test cause",
        fix: "Test fix",
        automated: false,
        severity: "low",
        occurrences: [],
        preventionStrategy: "Test prevention",
      }];

      const count = kb.import(JSON.stringify(newErrors));
      expect(count).toBe(1);
      expect(kb.get("custom-error-1")).not.toBeNull();
    });

    it("import merges with existing", () => {
      const before = kb.size();
      const newErrors: KnownError[] = [{
        id: "new-error",
        pattern: "new",
        category: "test",
        title: "New",
        cause: "c",
        fix: "f",
        automated: false,
        severity: "low",
        occurrences: [],
        preventionStrategy: "p",
      }];
      kb.import(JSON.stringify(newErrors));
      expect(kb.size()).toBe(before + 1);
    });

    it("import returns 0 for invalid JSON", () => {
      expect(kb.import("not json")).toBe(0);
    });

    it("import returns 0 for non-array JSON", () => {
      expect(kb.import('{"not": "array"}')).toBe(0);
    });

    it("import skips items without id or pattern", () => {
      const data = [{ id: "valid", pattern: "test" }, { pattern: "no-id" }, { id: "no-pattern" }];
      const count = kb.import(JSON.stringify(data));
      expect(count).toBe(1);
    });

    it("import handles items with missing occurrences", () => {
      const data = [{ id: "no-occ", pattern: "test" }];
      const count = kb.import(JSON.stringify(data));
      expect(count).toBe(1);
      const error = kb.get("no-occ");
      expect(error).not.toBeNull();
      expect(error!.occurrences).toEqual([]);
    });

    it("roundtrip export/import preserves data", () => {
      kb.record("eaddrinuse", "m1", "port 18789");
      const exported = kb.export();

      const freshKb = new ErrorKnowledgeBase();
      // Clear builtins to test pure import
      for (const e of freshKb.getAll()) {
        freshKb.remove(e.id);
      }
      const count = freshKb.import(exported);
      expect(count).toBe(23);

      const eaddrinuse = freshKb.get("eaddrinuse")!;
      expect(eaddrinuse.occurrences.length).toBe(1);
      expect(eaddrinuse.occurrences[0].machine).toBe("m1");
    });
  });

  // ─── Adding and removing errors ───────────────────────────────────────

  describe("adding and removing errors", () => {
    it("add stores a new error", () => {
      const newError: KnownError = {
        id: "new-test-error",
        pattern: "new.*test",
        category: "test",
        title: "New Test Error",
        cause: "Testing",
        fix: "Fix it",
        automated: false,
        severity: "low",
        occurrences: [],
        preventionStrategy: "Prevent it",
      };
      kb.add(newError);
      expect(kb.get("new-test-error")).not.toBeNull();
      expect(kb.size()).toBe(24);
    });

    it("add stores a copy", () => {
      const newError: KnownError = {
        id: "copy-test",
        pattern: "copy",
        category: "test",
        title: "Copy",
        cause: "c",
        fix: "f",
        automated: false,
        severity: "low",
        occurrences: [{ timestamp: "2025-01-01T00:00:00Z", machine: "m1" }],
        preventionStrategy: "p",
      };
      kb.add(newError);
      // Mutate original
      newError.occurrences.push({ timestamp: "2025-01-02T00:00:00Z", machine: "m2" });
      // Internal should not be affected
      expect(kb.get("copy-test")!.occurrences.length).toBe(1);
    });

    it("remove deletes an error", () => {
      expect(kb.remove("eaddrinuse")).toBe(true);
      expect(kb.get("eaddrinuse")).toBeNull();
      expect(kb.size()).toBe(22);
    });

    it("remove returns false for unknown id", () => {
      expect(kb.remove("nonexistent")).toBe(false);
    });
  });

  // ─── getAll ───────────────────────────────────────────────────────────

  describe("getAll", () => {
    it("returns all errors", () => {
      const all = kb.getAll();
      expect(all.length).toBe(23);
    });

    it("returns copies", () => {
      const all = kb.getAll();
      all[0].occurrences.push({ timestamp: "test", machine: "test" });
      expect(kb.getAll()[0].occurrences.length).toBe(0);
    });
  });

  // ─── Constructor options ──────────────────────────────────────────────

  describe("constructor options", () => {
    it("works without logDir", () => {
      const kbNoDir = new ErrorKnowledgeBase();
      expect(kbNoDir.size()).toBe(23);
      // Recording should not crash
      kbNoDir.record("eaddrinuse", "m1");
    });

    it("does not crash if logDir creation fails", () => {
      expect(() => new ErrorKnowledgeBase({ logDir: "/dev/null/impossible" })).not.toThrow();
    });
  });

  // ─── Regex vs string fallback ─────────────────────────────────────────

  describe("regex vs string fallback", () => {
    it("falls back to substring match on invalid regex pattern", () => {
      kb.add({
        id: "bad-regex",
        pattern: "[invalid regex(",
        category: "test",
        title: "Bad Regex",
        cause: "c",
        fix: "f",
        automated: false,
        severity: "low",
        occurrences: [],
        preventionStrategy: "p",
      });
      // Should fall back to substring match
      const result = kb.identify("this has [invalid regex( in it");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("bad-regex");
    });

    it("substring fallback is case-insensitive", () => {
      kb.add({
        id: "bad-regex-ci",
        pattern: "[InvalidRegex(",
        category: "test",
        title: "Bad Regex CI",
        cause: "c",
        fix: "f",
        automated: false,
        severity: "low",
        occurrences: [],
        preventionStrategy: "p",
      });
      const result = kb.identify("THIS HAS [INVALIDREGEX( IN IT");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("bad-regex-ci");
    });
  });
});
