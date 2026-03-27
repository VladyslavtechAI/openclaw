/**
 * Tests for auto-healer.
 */

import { describe, expect, it, vi } from "vitest";
import type { HealthIssue } from "./auto-healer.js";
import { AutoHealer } from "./auto-healer.js";

function makeIssue(type: HealthIssue["type"], machine = "Mini 1"): HealthIssue {
  return {
    type,
    machine,
    message: `Test ${type}`,
    timestamp: Date.now(),
    severity: "high",
  };
}

describe("AutoHealer", () => {
  describe("disabled by default", () => {
    it("returns disabled result when not enabled", async () => {
      const healer = new AutoHealer();
      const result = await healer.heal(makeIssue("gateway_down"));
      expect(result.success).toBe(false);
      expect(result.action).toBe("disabled");
    });
  });

  describe("enabled healer", () => {
    it("handles gateway_down", async () => {
      const healer = new AutoHealer({ enabled: true });
      const result = await healer.heal(makeIssue("gateway_down"));
      expect(result.success).toBe(true);
      expect(result.action).toBe("restart_gateway");
      expect(result.message).toContain("PATH");
    });

    it("handles auth_error", async () => {
      const healer = new AutoHealer({ enabled: true });
      const result = await healer.heal(makeIssue("auth_error"));
      expect(result.success).toBe(true);
      expect(result.action).toBe("validate_auth");
    });

    it("handles backup_stale", async () => {
      const healer = new AutoHealer({ enabled: true });
      const result = await healer.heal(makeIssue("backup_stale"));
      expect(result.success).toBe(true);
      expect(result.action).toBe("retry_backup");
    });

    it("handles agent_frozen", async () => {
      const healer = new AutoHealer({ enabled: true });
      const result = await healer.heal(makeIssue("agent_frozen"));
      expect(result.success).toBe(true);
      expect(result.action).toBe("kill_session");
    });

    it("escalates bot_token_invalid", async () => {
      const onEscalation = vi.fn();
      const healer = new AutoHealer({ enabled: true, onEscalation });
      const result = await healer.heal(makeIssue("bot_token_invalid"));
      expect(result.success).toBe(false);
      expect(result.escalate).toBe(true);
      expect(onEscalation).toHaveBeenCalled();
    });

    it("escalates ssh_unreachable", async () => {
      const onEscalation = vi.fn();
      const healer = new AutoHealer({ enabled: true, onEscalation });
      const result = await healer.heal(makeIssue("ssh_unreachable"));
      expect(result.escalate).toBe(true);
      expect(onEscalation).toHaveBeenCalled();
    });
  });

  describe("cooldown", () => {
    it("enforces cooldown between attempts", async () => {
      const healer = new AutoHealer({ enabled: true, cooldownSeconds: 600 });
      const issue = makeIssue("gateway_down");
      
      const first = await healer.heal(issue);
      expect(first.success).toBe(true);
      
      const second = await healer.heal(issue);
      expect(second.action).toBe("cooldown");
    });
  });

  describe("attempt limiting", () => {
    it("escalates after max attempts", async () => {
      const onEscalation = vi.fn();
      const healer = new AutoHealer({
        enabled: true,
        maxAttemptsPerHour: 2,
        cooldownSeconds: 0, // No cooldown for test
        onEscalation,
      });
      const issue = makeIssue("auth_error");

      await healer.heal(issue); // 1
      await healer.heal(issue); // 2
      const third = await healer.heal(issue); // 3 — exceeded

      expect(third.action).toBe("max_attempts");
      expect(third.escalate).toBe(true);
      expect(onEscalation).toHaveBeenCalled();
    });
  });

  describe("resetAttempts", () => {
    it("resets attempts for specific issue", async () => {
      const healer = new AutoHealer({ enabled: true, cooldownSeconds: 0, maxAttemptsPerHour: 1 });
      const issue = makeIssue("gateway_down");

      await healer.heal(issue);
      const blocked = await healer.heal(issue);
      expect(blocked.action).toBe("max_attempts");

      healer.resetAttempts("Mini 1", "gateway_down");
      const afterReset = await healer.heal(issue);
      expect(afterReset.action).toBe("restart_gateway");
    });

    it("resets all attempts for a machine", async () => {
      const healer = new AutoHealer({ enabled: true, cooldownSeconds: 0, maxAttemptsPerHour: 1 });

      await healer.heal(makeIssue("gateway_down", "Mini 2"));
      await healer.heal(makeIssue("auth_error", "Mini 2"));

      healer.resetAttempts("Mini 2"); // Reset all

      const gw = await healer.heal(makeIssue("gateway_down", "Mini 2"));
      const auth = await healer.heal(makeIssue("auth_error", "Mini 2"));
      expect(gw.action).toBe("restart_gateway");
      expect(auth.action).toBe("validate_auth");
    });
  });

  describe("all issue types handled", () => {
    const types: HealthIssue["type"][] = [
      "gateway_down", "auth_error", "backup_stale", "agent_frozen",
      "bot_token_invalid", "version_outdated", "telegram_bot_error", "ssh_unreachable",
    ];

    it.each(types)("has handler for %s", async (type) => {
      const healer = new AutoHealer({ enabled: true, cooldownSeconds: 0 });
      const result = await healer.heal(makeIssue(type));
      expect(result.action).not.toBe("no_handler");
    });
  });
});
