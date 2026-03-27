/**
 * Tests for Security Phase 1: Audit Logger, Subagent Scope, DLP Engine.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLogger, scrubSecrets } from "./audit-logger.js";
import { DlpEngine } from "./dlp-engine.js";
import { SubagentScope } from "./subagent-scope.js";

// ============================================================
// Audit Logger
// ============================================================
describe("AuditLogger", () => {
  let logger: AuditLogger;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
    logger = new AuditLogger({ logDir: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Logging", () => {
    it("logs events with sequence numbers", () => {
      const r1 = logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: "echo hello" });
      const r2 = logger.log({ timestamp: Date.now(), type: "tool.read", agentId: "jarvis", action: "/workspace/file.txt" });
      expect(r1.seq).toBe(1);
      expect(r2.seq).toBe(2);
    });

    it("includes hash chain", () => {
      const r1 = logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: "test" });
      const r2 = logger.log({ timestamp: Date.now(), type: "tool.read", agentId: "jarvis", action: "test2" });
      expect(r2.prevHash).toBe(r1.hash);
      expect(r1.prevHash).toBe("genesis");
    });

    it("persists to JSONL file", () => {
      logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "boris", action: "ls" });
      const dateStr = new Date().toISOString().slice(0, 10);
      const filePath = path.join(tmpDir, `audit-${dateStr}.jsonl`);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("Hash chain verification", () => {
    it("verifies valid chain", () => {
      logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: "a" });
      logger.log({ timestamp: Date.now(), type: "tool.read", agentId: "jarvis", action: "b" });
      logger.log({ timestamp: Date.now(), type: "tool.write", agentId: "jarvis", action: "c" });
      const result = logger.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.totalRecords).toBe(3);
    });

    it("detects tampered records", () => {
      logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: "a" });
      logger.log({ timestamp: Date.now(), type: "tool.read", agentId: "jarvis", action: "b" });

      // Tamper with the log file
      const dateStr = new Date().toISOString().slice(0, 10);
      const filePath = path.join(tmpDir, `audit-${dateStr}.jsonl`);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.trim().split("\n");
      const record = JSON.parse(lines[0]);
      record.action = "TAMPERED";
      lines[0] = JSON.stringify(record);
      fs.writeFileSync(filePath, lines.join("\n") + "\n");

      // Re-create logger to read from disk
      const newLogger = new AuditLogger({ logDir: tmpDir });
      const result = newLogger.verifyChain();
      expect(result.valid).toBe(false);
    });
  });

  describe("Secret scrubbing", () => {
    it("scrubs Anthropic API keys", () => {
      const result = scrubSecrets("Key is sk-ant-api03-ABC123XYZ456DEF789GHI012");
      expect(result).toContain("[REDACTED:anthropic_key]");
      expect(result).not.toContain("ABC123");
    });

    it("scrubs OpenAI keys", () => {
      const result = scrubSecrets("key=sk-proj-ABC123XYZ456DEF789GHI");
      expect(result).toContain("[REDACTED:openai_key]");
    });

    it("scrubs GitHub tokens", () => {
      const result = scrubSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij");
      expect(result).toContain("[REDACTED:github_token]");
    });

    it("scrubs from logged events", () => {
      logger.log({
        timestamp: Date.now(),
        type: "tool.exec",
        agentId: "boris",
        action: "curl -H 'Authorization: Bearer sk-ant-api03-SECRETKEY123456789ABC'",
      });
      const records = logger.query({ agentId: "boris" });
      expect(records[0].action).not.toContain("SECRETKEY");
      expect(records[0].action).toContain("[REDACTED");
    });
  });

  describe("Query", () => {
    it("filters by agentId", () => {
      logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: "a" });
      logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "boris", action: "b" });
      const results = logger.query({ agentId: "jarvis" });
      expect(results.length).toBe(1);
    });

    it("filters by type", () => {
      logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: "a" });
      logger.log({ timestamp: Date.now(), type: "tool.read", agentId: "jarvis", action: "b" });
      const results = logger.query({ type: "tool.exec" });
      expect(results.length).toBe(1);
    });

    it("limits results", () => {
      for (let i = 0; i < 10; i++) {
        logger.log({ timestamp: Date.now(), type: "tool.exec", agentId: "jarvis", action: `cmd-${i}` });
      }
      const results = logger.query({ limit: 3 });
      expect(results.length).toBe(3);
    });
  });
});

// ============================================================
// Subagent Scope
// ============================================================
describe("SubagentScope", () => {
  describe("computeScope", () => {
    it("defaults to restricted scope", () => {
      const scope = SubagentScope.computeScope(1, undefined);
      expect(scope.level).toBe(2); // At least level 2
      expect(scope.allowExec).toBe(false);
      expect(scope.allowMessageSend).toBe(false);
      expect(scope.tools).not.toContain("exec");
      expect(scope.tools).not.toContain("message");
    });

    it("admin parent gets level 2 subagent by default", () => {
      const scope = SubagentScope.computeScope(0, undefined);
      expect(scope.level).toBe(2);
    });

    it("respects explicit exec permission", () => {
      const scope = SubagentScope.computeScope(0, undefined, { allowExec: true, tools: ["read", "exec"] });
      expect(scope.allowExec).toBe(true);
      expect(scope.tools).toContain("exec");
    });

    it("intersects with parent tools", () => {
      const scope = SubagentScope.computeScope(1, ["read", "write"], { tools: ["read", "write", "exec"] });
      expect(scope.tools).toContain("read");
      expect(scope.tools).toContain("write");
      expect(scope.tools).not.toContain("exec"); // Parent doesn't have exec
    });
  });

  describe("isToolAllowed", () => {
    it("always blocks gateway", () => {
      const scope = SubagentScope.computeScope(0, undefined, { tools: ["gateway", "read"] });
      expect(SubagentScope.isToolAllowed("gateway", scope)).toBe(false);
    });

    it("always blocks cron", () => {
      const scope = SubagentScope.computeScope(0, undefined, { tools: ["cron", "read"] });
      expect(SubagentScope.isToolAllowed("cron", scope)).toBe(false);
    });

    it("allows tools in scope", () => {
      const scope = SubagentScope.computeScope(0, undefined);
      expect(SubagentScope.isToolAllowed("read", scope)).toBe(true);
      expect(SubagentScope.isToolAllowed("write", scope)).toBe(true);
    });
  });

  describe("validateNoEscalation", () => {
    it("blocks level escalation", () => {
      const result = SubagentScope.validateNoEscalation(2, { maxLevel: 0 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("escalate");
    });

    it("blocks worker granting exec", () => {
      const result = SubagentScope.validateNoEscalation(2, { allowExec: true });
      expect(result.valid).toBe(false);
    });

    it("blocks worker granting message.send", () => {
      const result = SubagentScope.validateNoEscalation(2, { allowMessageSend: true });
      expect(result.valid).toBe(false);
    });

    it("allows admin granting exec to subagent", () => {
      const result = SubagentScope.validateNoEscalation(0, { allowExec: true });
      expect(result.valid).toBe(true);
    });

    it("allows same level subagent", () => {
      const result = SubagentScope.validateNoEscalation(1, { maxLevel: 1 });
      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================
// DLP Engine
// ============================================================
describe("DlpEngine", () => {
  const dlp = new DlpEngine();

  describe("Credential detection", () => {
    it("blocks Anthropic API key", () => {
      const r = dlp.scan("Here: sk-ant-api03-ABCDefGHIJklmnOPQrstUVWxyz123");
      expect(r.action).toBe("block");
      expect(r.findings.some((f) => f.pattern === "anthropic_api_key")).toBe(true);
    });

    it("blocks GitHub token", () => {
      const r = dlp.scan("Use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij please");
      expect(r.action).toBe("block");
    });

    it("blocks AWS access key", () => {
      const r = dlp.scan("AWS key: AKIAIOSFODNN7EXAMPLE");
      expect(r.action).toBe("block");
    });

    it("blocks private keys", () => {
      const r = dlp.scan("-----BEGIN RSA PRIVATE KEY-----\nMIIE...");
      expect(r.action).toBe("block");
    });
  });

  describe("PII detection", () => {
    it("warns on email addresses", () => {
      const r = dlp.scan("Contact: user@example.com");
      expect(r.findings.some((f) => f.pattern === "email_address")).toBe(true);
    });

    it("blocks SSN", () => {
      const r = dlp.scan("SSN: 123-45-6789");
      expect(r.action).toBe("block");
    });
  });

  describe("Financial data", () => {
    it("blocks credit card numbers", () => {
      const r = dlp.scan("Card: 4111-1111-1111-1111");
      expect(r.action).toBe("block");
    });
  });

  describe("Redaction", () => {
    it("redacts credentials in content", () => {
      const result = dlp.redact("Key is sk-ant-api03-SECRET123456789ABCDEF");
      expect(result).toContain("[REDACTED:");
      expect(result).not.toContain("SECRET123");
    });
  });

  describe("Agent exemptions", () => {
    it("exempts configured agents", () => {
      const dlpWithExempt = new DlpEngine({ exemptAgents: ["jarvis"] });
      const r = dlpWithExempt.scan("Key: sk-ant-api03-SECRET123456789ABCDEF", "jarvis");
      expect(r.action).toBe("log"); // Exempted
    });

    it("still blocks non-exempt agents", () => {
      const dlpWithExempt = new DlpEngine({ exemptAgents: ["jarvis"] });
      const r = dlpWithExempt.scan("Key: sk-ant-api03-SECRET123456789ABCDEF", "boris");
      expect(r.action).toBe("block");
    });
  });

  describe("Clean content", () => {
    it("passes normal text", () => {
      const r = dlp.scan("The weather in Warsaw is lovely today.");
      expect(r.action).toBe("log");
      expect(r.findings.length).toBe(0);
    });
  });
});
