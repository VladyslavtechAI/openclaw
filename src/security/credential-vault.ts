/**
 * Per-agent credential isolation.
 * Each agent only sees credentials allowed by their hierarchy level.
 */

import type { AgentHierarchyLevel } from "../config/types.agent-hierarchy.js";

export type CredentialEntry = {
  key: string;
  value: string;
  /** Which agents can access (empty = all with sufficient level) */
  allowedAgents?: string[];
  /** Minimum hierarchy level required (default: 0 = admin only) */
  minLevel?: AgentHierarchyLevel;
  /** Whether this is a shared credential (vs per-agent) */
  shared?: boolean;
};

export type VaultConfig = {
  /** Credentials registry */
  credentials?: CredentialEntry[];
  /** Default minimum level for untagged credentials */
  defaultMinLevel?: AgentHierarchyLevel;
};

/**
 * Credential vault with per-agent access control.
 */
export class CredentialVault {
  private credentials: Map<string, CredentialEntry>;
  private defaultMinLevel: AgentHierarchyLevel;

  constructor(config: VaultConfig = {}) {
    this.credentials = new Map();
    this.defaultMinLevel = config.defaultMinLevel ?? 0; // Admin only by default

    if (config.credentials) {
      for (const cred of config.credentials) {
        this.credentials.set(cred.key, cred);
      }
    }
  }

  /**
   * Check if an agent can access a specific credential.
   */
  canAccess(
    agentId: string,
    credentialKey: string,
    agentLevel: AgentHierarchyLevel,
  ): boolean {
    const cred = this.credentials.get(credentialKey);
    if (!cred) return false;

    const minLevel = cred.minLevel ?? this.defaultMinLevel;

    // Level check (lower number = higher privilege)
    if (agentLevel > minLevel) return false;

    // Agent allowlist check
    if (cred.allowedAgents && cred.allowedAgents.length > 0) {
      return cred.allowedAgents.includes(agentId);
    }

    return true;
  }

  /**
   * Get credential value if agent has access.
   * Returns undefined if not authorized.
   */
  get(
    agentId: string,
    credentialKey: string,
    agentLevel: AgentHierarchyLevel,
  ): string | undefined {
    if (!this.canAccess(agentId, credentialKey, agentLevel)) {
      return undefined;
    }
    return this.credentials.get(credentialKey)?.value;
  }

  /**
   * Get all credentials an agent can access.
   */
  getAccessibleCredentials(
    agentId: string,
    agentLevel: AgentHierarchyLevel,
  ): Map<string, string> {
    const result = new Map<string, string>();

    for (const [key, cred] of this.credentials) {
      if (this.canAccess(agentId, key, agentLevel)) {
        result.set(key, cred.value);
      }
    }

    return result;
  }

  /**
   * Build environment variables for an agent.
   * Only includes credentials the agent is authorized to see.
   */
  buildEnvForAgent(
    agentId: string,
    agentLevel: AgentHierarchyLevel,
    baseEnv: Record<string, string> = {},
  ): Record<string, string> {
    const env = { ...baseEnv };
    const accessible = this.getAccessibleCredentials(agentId, agentLevel);

    for (const [key, value] of accessible) {
      env[key] = value;
    }

    return env;
  }

  /**
   * Add a credential to the vault.
   */
  addCredential(entry: CredentialEntry): void {
    this.credentials.set(entry.key, entry);
  }

  /**
   * Remove a credential from the vault.
   */
  removeCredential(key: string): boolean {
    return this.credentials.delete(key);
  }

  /**
   * List all credential keys (not values) with access info.
   */
  listCredentials(): Array<{
    key: string;
    minLevel: AgentHierarchyLevel;
    allowedAgents?: string[];
    shared: boolean;
  }> {
    return Array.from(this.credentials.values()).map((cred) => ({
      key: cred.key,
      minLevel: cred.minLevel ?? this.defaultMinLevel,
      allowedAgents: cred.allowedAgents,
      shared: cred.shared ?? false,
    }));
  }
}
