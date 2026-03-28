/**
 * Tenant Isolation for complete data separation.
 * Enforces filesystem sandboxing, network isolation, and credential separation per tenant.
 */

import fs from "node:fs";
import path from "node:path";
import { FilesystemPolicy } from "../security/filesystem-policy.js";
import { NetworkPolicy } from "../security/network-policy.js";
import { CredentialVault } from "../security/credential-vault.js";
import type { CredentialEntry } from "../security/credential-vault.js";

export type IsolationConfig = {
  tenantId: string;
  /** Base directory for this tenant's data */
  tenantDir: string;
  /** Allowed webhook URLs for this tenant */
  allowedWebhooks?: string[];
  /** Per-tenant credentials */
  credentials?: CredentialEntry[];
};

export type IsolationCheckResult = {
  allowed: boolean;
  reason?: string;
};

/**
 * Tenant Isolation enforces complete data separation between tenants.
 */
export class TenantIsolation {
  private tenantId: string;
  private tenantDir: string;
  private workspaceDir: string;
  private filesystemPolicy: FilesystemPolicy;
  private networkPolicy: NetworkPolicy;
  private credentialVault: CredentialVault;

  constructor(config: IsolationConfig) {
    this.tenantId = config.tenantId;
    this.tenantDir = config.tenantDir;
    this.workspaceDir = path.join(config.tenantDir, "workspace");

    // Ensure tenant directories exist
    this.ensureDirectories();

    // Setup filesystem isolation (workspace-only access)
    this.filesystemPolicy = new FilesystemPolicy({
      workspaceOnly: true,
      allowedPaths: [this.workspaceDir],
      blockTraversal: true,
      blockSymlinks: true,
    });

    // Setup network isolation (webhook-only access)
    const allowedDomains = this.extractDomainsFromUrls(config.allowedWebhooks ?? []);
    this.networkPolicy = new NetworkPolicy({
      urlWhitelist: allowedDomains,
    });

    // Setup credential isolation (tenant-specific vault)
    this.credentialVault = new CredentialVault({
      credentials: config.credentials ?? [],
      defaultMinLevel: 2, // Worker level by default
    });
  }

  /**
   * Check if a file path is accessible by this tenant.
   */
  checkFileAccess(filePath: string): IsolationCheckResult {
    const result = this.filesystemPolicy.checkAccess(filePath, this.workspaceDir);
    return {
      allowed: result.allowed,
      reason: result.reason,
    };
  }

  /**
   * Check if a URL is accessible by this tenant.
   */
  checkNetworkAccess(url: string): IsolationCheckResult {
    const result = this.networkPolicy.checkUrl(url);
    return {
      allowed: result.allowed,
      reason: result.reason,
    };
  }

  /**
   * Check if an exec command is allowed for this tenant.
   */
  checkExecCommand(command: string): IsolationCheckResult {
    const result = this.networkPolicy.checkExecCommand(command);
    return {
      allowed: result.allowed,
      reason: result.reason,
    };
  }

  /**
   * Get a credential value for this tenant.
   */
  getCredential(agentId: string, credentialKey: string): string | undefined {
    // All agents in this tenant are worker level (2) by default
    return this.credentialVault.get(agentId, credentialKey, 2);
  }

  /**
   * Get all accessible credentials for an agent in this tenant.
   */
  getAccessibleCredentials(agentId: string): Map<string, string> {
    return this.credentialVault.getAccessibleCredentials(agentId, 2);
  }

  /**
   * Add a credential to this tenant's vault.
   */
  addCredential(entry: CredentialEntry): void {
    this.credentialVault.addCredential(entry);
    this.saveCredentials();
  }

  /**
   * Remove a credential from this tenant's vault.
   */
  removeCredential(key: string): boolean {
    const removed = this.credentialVault.removeCredential(key);
    if (removed) {
      this.saveCredentials();
    }
    return removed;
  }

  /**
   * Get the workspace directory for this tenant.
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Get the logs directory for this tenant.
   */
  getLogsDir(): string {
    return path.join(this.tenantDir, "logs");
  }

  /**
   * Get the billing directory for this tenant.
   */
  getBillingDir(): string {
    return path.join(this.tenantDir, "billing");
  }

  /**
   * Verify complete isolation (for testing/auditing).
   */
  verifyIsolation(): {
    filesystemIsolated: boolean;
    networkIsolated: boolean;
    credentialsIsolated: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    let filesystemIsolated = true;
    let networkIsolated = true;
    let credentialsIsolated = true;

    // Check filesystem isolation
    const sensitiveFiles = ["/etc/passwd", "~/.ssh/id_rsa", "../../../etc/hosts"];
    for (const file of sensitiveFiles) {
      const result = this.checkFileAccess(file);
      if (result.allowed) {
        filesystemIsolated = false;
        errors.push(`Filesystem leak: ${file} is accessible`);
      }
    }

    // Check network isolation
    const blockedUrls = [
      "http://localhost:3000",
      "http://169.254.169.254/metadata",
      "http://metadata.google.internal",
    ];
    for (const url of blockedUrls) {
      const result = this.checkNetworkAccess(url);
      if (result.allowed) {
        networkIsolated = false;
        errors.push(`Network leak: ${url} is accessible`);
      }
    }

    // Check credential isolation (credentials should only be accessible to correct agents)
    const allCreds = this.credentialVault.listCredentials();
    if (allCreds.length > 0) {
      // Verify no credentials are accessible to agents from other tenants
      const otherTenantAgent = "other-tenant-agent";
      const leakedCreds = this.credentialVault.getAccessibleCredentials(otherTenantAgent, 2);
      if (leakedCreds.size > 0) {
        credentialsIsolated = false;
        errors.push(`Credential leak: ${leakedCreds.size} credentials accessible to other tenant`);
      }
    }

    return {
      filesystemIsolated,
      networkIsolated,
      credentialsIsolated,
      errors,
    };
  }

  /**
   * Ensure all required tenant directories exist.
   */
  private ensureDirectories(): void {
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(this.tenantDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(this.tenantDir, "billing"), { recursive: true });
    fs.mkdirSync(path.join(this.tenantDir, "credentials"), { recursive: true });
  }

  /**
   * Extract domain names from URLs for whitelist.
   */
  private extractDomainsFromUrls(urls: string[]): string[] {
    const domains: string[] = [];
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        domains.push(parsed.hostname);
      } catch {
        // Skip invalid URLs
      }
    }
    return domains;
  }

  /**
   * Save credentials to disk (encrypted in production).
   */
  private saveCredentials(): void {
    const credPath = path.join(this.tenantDir, "credentials", "vault.json");
    const creds = this.credentialVault.listCredentials();
    fs.writeFileSync(credPath, JSON.stringify(creds, null, 2));
  }

  /**
   * Create a sandboxed environment for an agent.
   */
  createSandboxEnv(agentId: string, baseEnv: Record<string, string> = {}): Record<string, string> {
    // Build environment with tenant-specific credentials
    const env = this.credentialVault.buildEnvForAgent(agentId, 2, baseEnv);

    // Add tenant-specific paths
    env.TENANT_ID = this.tenantId;
    env.TENANT_WORKSPACE = this.workspaceDir;
    env.TENANT_LOGS = this.getLogsDir();

    // Restrict PATH to prevent access to system tools
    env.PATH = "/usr/bin:/bin";

    // Remove potentially dangerous variables
    delete env.SSH_AUTH_SOCK;
    delete env.SSH_AGENT_PID;

    return env;
  }
}
