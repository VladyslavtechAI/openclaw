/**
 * Tests for agent hierarchy permission system.
 */

import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { AgentPermissions } from "./agent-permissions.js";

const createConfig = (agents: unknown[]): OpenClawConfig =>
  ({
    agents: { list: agents },
  }) as OpenClawConfig;

describe("AgentPermissions", () => {
  describe("Level 0 (admin)", () => {
    const config = createConfig([{ id: "jarvis", hierarchy: { level: 0 } }]);

    it("can SSH to all machines", () => {
      expect(AgentPermissions.canSSH("jarvis", "any-machine", config)).toBe(true);
    });

    it("can access credentials (read+write)", () => {
      expect(AgentPermissions.canAccessCredentials("jarvis", config)).toBe(true);
      expect(AgentPermissions.canWriteCredentials("jarvis", config)).toBe(true);
    });

    it("can restart gateway", () => {
      expect(AgentPermissions.canRestartGateway("jarvis", config)).toBe(true);
    });

    it("can spawn sub-agents", () => {
      expect(AgentPermissions.canSpawnSubagent("jarvis", config)).toBe(true);
    });

    it("can send to any agent", () => {
      expect(AgentPermissions.canSendToAgent("jarvis", "anyone", config)).toBe(true);
    });
  });

  describe("Level 1 (lead)", () => {
    const config = createConfig([
      { id: "boris", hierarchy: { level: 1, workers: ["alex", "diego"] } },
      { id: "alex", hierarchy: { level: 2, lead: "boris" } },
      { id: "diego", hierarchy: { level: 2, lead: "boris" } },
    ]);

    it("can SSH only to own machine", () => {
      expect(AgentPermissions.canSSH("boris", "boris-machine", config)).toBe(true);
      expect(AgentPermissions.canSSH("boris", "other-machine", config)).toBe(false);
    });

    it("can read credentials but not write", () => {
      expect(AgentPermissions.canAccessCredentials("boris", config)).toBe(true);
      expect(AgentPermissions.canWriteCredentials("boris", config)).toBe(false);
    });

    it("cannot restart gateway", () => {
      expect(AgentPermissions.canRestartGateway("boris", config)).toBe(false);
    });

    it("can spawn sub-agents", () => {
      expect(AgentPermissions.canSpawnSubagent("boris", config)).toBe(true);
    });

    it("can send to team members only", () => {
      expect(AgentPermissions.canSendToAgent("boris", "alex", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("boris", "diego", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("boris", "outsider", config)).toBe(false);
    });
  });

  describe("Level 2 (worker)", () => {
    const config = createConfig([
      { id: "boris", hierarchy: { level: 1 } },
      { id: "alex", hierarchy: { level: 2, lead: "boris" } },
    ]);

    it("cannot SSH", () => {
      expect(AgentPermissions.canSSH("alex", "any-machine", config)).toBe(false);
    });

    it("cannot access credentials", () => {
      expect(AgentPermissions.canAccessCredentials("alex", config)).toBe(false);
      expect(AgentPermissions.canWriteCredentials("alex", config)).toBe(false);
    });

    it("cannot restart gateway", () => {
      expect(AgentPermissions.canRestartGateway("alex", config)).toBe(false);
    });

    it("cannot spawn sub-agents", () => {
      expect(AgentPermissions.canSpawnSubagent("alex", config)).toBe(false);
    });

    it("can send only to lead", () => {
      expect(AgentPermissions.canSendToAgent("alex", "boris", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("alex", "anyone-else", config)).toBe(false);
    });
  });

  describe("Default level (undefined = 2)", () => {
    const config = createConfig([{ id: "unknown", hierarchy: {} }]);

    it("defaults to level 2 (most restrictive)", () => {
      expect(AgentPermissions.getLevel("unknown", config)).toBe(2);
      expect(AgentPermissions.canSSH("unknown", "any", config)).toBe(false);
      expect(AgentPermissions.canAccessCredentials("unknown", config)).toBe(false);
      expect(AgentPermissions.canRestartGateway("unknown", config)).toBe(false);
      expect(AgentPermissions.canSpawnSubagent("unknown", config)).toBe(false);
    });
  });

  describe("Permission overrides", () => {
    const config = createConfig([
      {
        id: "custom",
        hierarchy: {
          level: 2,
          permissions: {
            ssh: "all", // Override: worker can SSH
            spawn_subagents: true, // Override: worker can spawn
          },
        },
      },
    ]);

    it("respects permission overrides", () => {
      expect(AgentPermissions.canSSH("custom", "anywhere", config)).toBe(true);
      expect(AgentPermissions.canSpawnSubagent("custom", config)).toBe(true);
      // But other perms still default to level 2
      expect(AgentPermissions.canRestartGateway("custom", config)).toBe(false);
    });
  });

  describe("Tool allow/deny", () => {
    const config = createConfig([
      {
        id: "limited",
        hierarchy: {
          level: 1,
          permissions: {
            tools_allow: ["read", "write"],
            tools_deny: ["exec", "ssh"],
          },
        },
      },
    ]);

    it("returns effective tools allow", () => {
      expect(AgentPermissions.getEffectiveToolsAllow("limited", config)).toEqual(["read", "write"]);
    });

    it("returns effective tools deny", () => {
      expect(AgentPermissions.getEffectiveToolsDeny("limited", config)).toEqual(["exec", "ssh"]);
    });
  });

  describe("Team membership", () => {
    const config = createConfig([
      { id: "jarvis", hierarchy: { level: 0 } },
      { id: "boris", hierarchy: { level: 1, workers: ["alex", "diego", "gorn"] } },
      { id: "alex", hierarchy: { level: 2, lead: "boris" } },
      { id: "diego", hierarchy: { level: 2, lead: "boris" } },
      { id: "gorn", hierarchy: { level: 2, lead: "boris" } },
      { id: "outsider", hierarchy: { level: 2 } },
    ]);

    it("lead can communicate with all workers", () => {
      expect(AgentPermissions.canSendToAgent("boris", "alex", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("boris", "diego", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("boris", "gorn", config)).toBe(true);
    });

    it("worker can only communicate with lead", () => {
      expect(AgentPermissions.canSendToAgent("alex", "boris", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("alex", "diego", config)).toBe(false); // peer
      expect(AgentPermissions.canSendToAgent("alex", "outsider", config)).toBe(false);
    });

    it("admin can communicate with everyone", () => {
      expect(AgentPermissions.canSendToAgent("jarvis", "boris", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("jarvis", "alex", config)).toBe(true);
      expect(AgentPermissions.canSendToAgent("jarvis", "outsider", config)).toBe(true);
    });
  });

  describe("Agent without hierarchy config", () => {
    const config = createConfig([
      { id: "plain" }, // No hierarchy field
    ]);

    it("defaults to level 2 (worker)", () => {
      expect(AgentPermissions.getLevel("plain", config)).toBe(2);
      expect(AgentPermissions.canSSH("plain", "any", config)).toBe(false);
      expect(AgentPermissions.canSpawnSubagent("plain", config)).toBe(false);
    });
  });

  describe("Hierarchy validation", () => {
    it("detects self-referential lead", () => {
      const config = createConfig([{ id: "self-ref", hierarchy: { level: 1, lead: "self-ref" } }]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("lead cannot reference self");
    });

    it("detects missing lead reference", () => {
      const config = createConfig([{ id: "worker", hierarchy: { level: 2, lead: "nonexistent" } }]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('lead "nonexistent" does not exist');
    });

    it("detects missing worker reference", () => {
      const config = createConfig([
        { id: "lead", hierarchy: { level: 1, workers: ["nonexistent"] } },
      ]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('worker "nonexistent" does not exist');
    });

    it("detects worker cannot be self", () => {
      const config = createConfig([{ id: "lead", hierarchy: { level: 1, workers: ["lead"] } }]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("workers cannot include self");
    });

    it("detects circular hierarchy (2-agent cycle)", () => {
      const config = createConfig([
        { id: "a", hierarchy: { level: 1, lead: "b" } },
        { id: "b", hierarchy: { level: 1, lead: "a" } },
      ]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("circular hierarchy detected");
    });

    it("detects circular hierarchy (3-agent cycle)", () => {
      const config = createConfig([
        { id: "a", hierarchy: { level: 1, lead: "b" } },
        { id: "b", hierarchy: { level: 1, lead: "c" } },
        { id: "c", hierarchy: { level: 1, lead: "a" } },
      ]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("circular hierarchy detected");
    });

    it("passes valid hierarchy", () => {
      const config = createConfig([
        { id: "admin", hierarchy: { level: 0 } },
        { id: "lead", hierarchy: { level: 1, lead: "admin", workers: ["worker1", "worker2"] } },
        { id: "worker1", hierarchy: { level: 2, lead: "lead" } },
        { id: "worker2", hierarchy: { level: 2, lead: "lead" } },
      ]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors).toEqual([]);
    });

    it("handles agents without hierarchy config", () => {
      const config = createConfig([{ id: "plain1" }, { id: "plain2" }]);
      const errors = AgentPermissions.validateHierarchy(config);
      expect(errors).toEqual([]);
    });
  });
});
