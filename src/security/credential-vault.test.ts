/**
 * Tests for credential vault.
 */

import { describe, expect, it } from "vitest";
import { CredentialVault } from "./credential-vault.js";

describe("CredentialVault", () => {
  describe("canAccess", () => {
    it("admin (level 0) can access all credentials", () => {
      const vault = new CredentialVault({
        credentials: [
          { key: "ANTHROPIC_API_KEY", value: "sk-xxx", minLevel: 0 },
          { key: "GITHUB_TOKEN", value: "ghp-xxx", minLevel: 1 },
        ],
      });

      expect(vault.canAccess("jarvis", "ANTHROPIC_API_KEY", 0)).toBe(true);
      expect(vault.canAccess("jarvis", "GITHUB_TOKEN", 0)).toBe(true);
    });

    it("lead (level 1) can access level 1+ credentials only", () => {
      const vault = new CredentialVault({
        credentials: [
          { key: "ANTHROPIC_API_KEY", value: "sk-xxx", minLevel: 0 },
          { key: "GITHUB_TOKEN", value: "ghp-xxx", minLevel: 1 },
          { key: "PUBLIC_DATA", value: "data", minLevel: 2 },
        ],
      });

      expect(vault.canAccess("boris", "ANTHROPIC_API_KEY", 1)).toBe(false);
      expect(vault.canAccess("boris", "GITHUB_TOKEN", 1)).toBe(true);
      expect(vault.canAccess("boris", "PUBLIC_DATA", 1)).toBe(true);
    });

    it("worker (level 2) can only access level 2 credentials", () => {
      const vault = new CredentialVault({
        credentials: [
          { key: "ANTHROPIC_API_KEY", value: "sk-xxx", minLevel: 0 },
          { key: "GITHUB_TOKEN", value: "ghp-xxx", minLevel: 1 },
          { key: "PUBLIC_DATA", value: "data", minLevel: 2 },
        ],
      });

      expect(vault.canAccess("alex", "ANTHROPIC_API_KEY", 2)).toBe(false);
      expect(vault.canAccess("alex", "GITHUB_TOKEN", 2)).toBe(false);
      expect(vault.canAccess("alex", "PUBLIC_DATA", 2)).toBe(true);
    });

    it("respects agent allowlist", () => {
      const vault = new CredentialVault({
        credentials: [
          {
            key: "ALEX_API_KEY",
            value: "sk-alex",
            minLevel: 2,
            allowedAgents: ["alex"],
          },
        ],
      });

      expect(vault.canAccess("alex", "ALEX_API_KEY", 2)).toBe(true);
      expect(vault.canAccess("diego", "ALEX_API_KEY", 2)).toBe(false);
    });

    it("returns false for non-existent credentials", () => {
      const vault = new CredentialVault();
      expect(vault.canAccess("jarvis", "NONEXISTENT", 0)).toBe(false);
    });
  });

  describe("get", () => {
    it("returns value when authorized", () => {
      const vault = new CredentialVault({
        credentials: [{ key: "TOKEN", value: "secret123", minLevel: 0 }],
      });

      expect(vault.get("jarvis", "TOKEN", 0)).toBe("secret123");
    });

    it("returns undefined when not authorized", () => {
      const vault = new CredentialVault({
        credentials: [{ key: "TOKEN", value: "secret123", minLevel: 0 }],
      });

      expect(vault.get("worker", "TOKEN", 2)).toBeUndefined();
    });
  });

  describe("getAccessibleCredentials", () => {
    it("returns only accessible credentials", () => {
      const vault = new CredentialVault({
        credentials: [
          { key: "ADMIN_KEY", value: "admin", minLevel: 0 },
          { key: "LEAD_KEY", value: "lead", minLevel: 1 },
          { key: "WORKER_KEY", value: "worker", minLevel: 2 },
        ],
      });

      const leadCreds = vault.getAccessibleCredentials("boris", 1);
      expect(leadCreds.size).toBe(2);
      expect(leadCreds.has("LEAD_KEY")).toBe(true);
      expect(leadCreds.has("WORKER_KEY")).toBe(true);
      expect(leadCreds.has("ADMIN_KEY")).toBe(false);
    });
  });

  describe("buildEnvForAgent", () => {
    it("merges base env with accessible credentials", () => {
      const vault = new CredentialVault({
        credentials: [
          { key: "API_KEY", value: "sk-xxx", minLevel: 0 },
          { key: "DATA_URL", value: "https://data.example.com", minLevel: 2 },
        ],
      });

      const env = vault.buildEnvForAgent("worker", 2, { PATH: "/usr/bin" });
      expect(env.PATH).toBe("/usr/bin");
      expect(env.DATA_URL).toBe("https://data.example.com");
      expect(env.API_KEY).toBeUndefined();
    });
  });

  describe("addCredential / removeCredential", () => {
    it("adds and removes credentials", () => {
      const vault = new CredentialVault();

      vault.addCredential({ key: "NEW_KEY", value: "new_value", minLevel: 0 });
      expect(vault.get("admin", "NEW_KEY", 0)).toBe("new_value");

      vault.removeCredential("NEW_KEY");
      expect(vault.get("admin", "NEW_KEY", 0)).toBeUndefined();
    });
  });

  describe("listCredentials", () => {
    it("lists all credentials without values", () => {
      const vault = new CredentialVault({
        credentials: [
          { key: "SECRET", value: "hidden", minLevel: 0, shared: true },
          { key: "TOKEN", value: "hidden2", minLevel: 1 },
        ],
      });

      const list = vault.listCredentials();
      expect(list).toHaveLength(2);
      // Verify no values exposed
      expect(list.find((c) => c.key === "SECRET")?.shared).toBe(true);
      expect((list[0] as Record<string, unknown>).value).toBeUndefined();
    });
  });

  describe("defaultMinLevel", () => {
    it("uses custom default min level", () => {
      const vault = new CredentialVault({
        defaultMinLevel: 1, // Leads can access by default
        credentials: [{ key: "TOKEN", value: "val" }],
      });

      expect(vault.canAccess("lead", "TOKEN", 1)).toBe(true);
      expect(vault.canAccess("worker", "TOKEN", 2)).toBe(false);
    });
  });
});
