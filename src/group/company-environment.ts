/**
 * Company Environment: Isolated runtime configuration per company.
 * Features: independent agent pools, workspace isolation, data sovereignty enforcement.
 */

import fs from "node:fs";
import path from "node:path";
import type { CompanyId } from "./group-manager.js";

export type AgentPoolConfig = {
  /** Maximum number of concurrent agents */
  maxAgents: number;
  /** Agent IDs assigned to this company */
  agentIds: string[];
  /** Resource limits per agent */
  resourceLimits?: {
    /** Max memory in MB */
    maxMemoryMB?: number;
    /** Max CPU percentage */
    maxCpuPercent?: number;
    /** Max disk usage in MB */
    maxDiskMB?: number;
  };
};

export type CompanyEnvironmentConfig = {
  companyId: CompanyId;
  /** Root directory for company data */
  dataDir: string;
  /** Agent pool configuration */
  agentPool: AgentPoolConfig;
  /** Data sovereignty region */
  region?: string;
  /** Allowed network endpoints (whitelist) */
  allowedEndpoints?: string[];
  /** Environment variables for company */
  envVars?: Record<string, string>;
  /** Custom runtime settings */
  runtimeSettings?: Record<string, unknown>;
};

/**
 * CompanyEnvironment manages isolated runtime for a single company.
 */
export class CompanyEnvironment {
  private config: CompanyEnvironmentConfig;
  private workspaceDir: string;
  private activeAgents: Set<string>;

  constructor(config: CompanyEnvironmentConfig) {
    this.config = config;
    this.workspaceDir = path.join(config.dataDir, "workspace");
    this.activeAgents = new Set();

    // Create directory structure
    fs.mkdirSync(this.workspaceDir, { recursive: true });
    fs.mkdirSync(path.join(config.dataDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(config.dataDir, "temp"), { recursive: true });
  }

  /**
   * Get company ID.
   */
  getCompanyId(): CompanyId {
    return this.config.companyId;
  }

  /**
   * Get workspace directory for this company.
   */
  getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Get logs directory.
   */
  getLogsDir(): string {
    return path.join(this.config.dataDir, "logs");
  }

  /**
   * Get temp directory.
   */
  getTempDir(): string {
    return path.join(this.config.dataDir, "temp");
  }

  /**
   * Check if an agent is part of this company's pool.
   */
  isAgentInPool(agentId: string): boolean {
    return this.config.agentPool.agentIds.includes(agentId);
  }

  /**
   * Register an agent as active.
   */
  activateAgent(agentId: string): { success: boolean; reason?: string } {
    if (!this.isAgentInPool(agentId)) {
      return { success: false, reason: "Agent not in company pool" };
    }

    if (this.activeAgents.size >= this.config.agentPool.maxAgents) {
      return { success: false, reason: "Max concurrent agents reached" };
    }

    this.activeAgents.add(agentId);
    return { success: true };
  }

  /**
   * Deactivate an agent.
   */
  deactivateAgent(agentId: string): void {
    this.activeAgents.delete(agentId);
  }

  /**
   * Get count of active agents.
   */
  getActiveAgentCount(): number {
    return this.activeAgents.size;
  }

  /**
   * Get list of active agents.
   */
  getActiveAgents(): string[] {
    return Array.from(this.activeAgents);
  }

  /**
   * Check if at capacity.
   */
  isAtCapacity(): boolean {
    return this.activeAgents.size >= this.config.agentPool.maxAgents;
  }

  /**
   * Get environment variables for company agents.
   */
  getEnvironmentVars(): Record<string, string> {
    return {
      COMPANY_ID: this.config.companyId,
      COMPANY_WORKSPACE: this.workspaceDir,
      COMPANY_LOGS: this.getLogsDir(),
      COMPANY_TEMP: this.getTempDir(),
      ...(this.config.region ? { COMPANY_REGION: this.config.region } : {}),
      ...(this.config.envVars ?? {}),
    };
  }

  /**
   * Check if a network endpoint is allowed.
   */
  isEndpointAllowed(endpoint: string): boolean {
    // If no whitelist, allow all
    if (!this.config.allowedEndpoints || this.config.allowedEndpoints.length === 0) {
      return true;
    }

    // Check against whitelist (supports wildcards)
    return this.config.allowedEndpoints.some((pattern) => {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(endpoint);
    });
  }

  /**
   * Enforce data sovereignty - check if data can leave region.
   */
  canDataLeaveRegion(targetRegion: string): boolean {
    // If no region set, allow all
    if (!this.config.region) {
      return true;
    }

    // Data can only stay in same region
    return this.config.region === targetRegion;
  }

  /**
   * Get resource limits for agents.
   */
  getResourceLimits(): AgentPoolConfig["resourceLimits"] {
    return this.config.agentPool.resourceLimits;
  }

  /**
   * Check if a file path is within company workspace.
   */
  isPathInWorkspace(filePath: string): boolean {
    const normalized = path.normalize(filePath);
    const workspace = path.normalize(this.workspaceDir);
    return normalized.startsWith(workspace);
  }

  /**
   * Get a safe path within workspace (prevents directory traversal).
   */
  getSafePath(relativePath: string): string {
    const fullPath = path.join(this.workspaceDir, relativePath);
    const normalized = path.normalize(fullPath);

    if (!normalized.startsWith(path.normalize(this.workspaceDir))) {
      throw new Error("Path traversal attempt detected");
    }

    return normalized;
  }

  /**
   * Update agent pool configuration.
   */
  updateAgentPool(updates: Partial<AgentPoolConfig>): void {
    this.config.agentPool = {
      ...this.config.agentPool,
      ...updates,
    };
  }

  /**
   * Add agent to pool.
   */
  addAgentToPool(agentId: string): void {
    if (!this.config.agentPool.agentIds.includes(agentId)) {
      this.config.agentPool.agentIds.push(agentId);
    }
  }

  /**
   * Remove agent from pool.
   */
  removeAgentFromPool(agentId: string): void {
    const index = this.config.agentPool.agentIds.indexOf(agentId);
    if (index !== -1) {
      this.config.agentPool.agentIds.splice(index, 1);
    }

    // Also deactivate if currently active
    this.deactivateAgent(agentId);
  }

  /**
   * Get runtime settings.
   */
  getRuntimeSettings(): Record<string, unknown> {
    return this.config.runtimeSettings ?? {};
  }

  /**
   * Update runtime settings.
   */
  updateRuntimeSettings(settings: Record<string, unknown>): void {
    this.config.runtimeSettings = {
      ...this.config.runtimeSettings,
      ...settings,
    };
  }

  /**
   * Clean up temp files older than specified age.
   */
  cleanupTempFiles(maxAgeMs: number): number {
    const tempDir = this.getTempDir();
    let cleanedCount = 0;

    try {
      const files = fs.readdirSync(tempDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAgeMs) {
          fs.rmSync(filePath, { recursive: true, force: true });
          cleanedCount++;
        }
      }
    } catch {
      // Ignore errors
    }

    return cleanedCount;
  }

  /**
   * Get disk usage for company data.
   */
  getDiskUsage(): { totalBytes: number; workspaceBytes: number; logsBytes: number; tempBytes: number } {
    const getSize = (dir: string): number => {
      try {
        let total = 0;
        const files = fs.readdirSync(dir, { withFileTypes: true });

        for (const file of files) {
          const filePath = path.join(dir, file.name);
          if (file.isDirectory()) {
            total += getSize(filePath);
          } else {
            total += fs.statSync(filePath).size;
          }
        }

        return total;
      } catch {
        return 0;
      }
    };

    const workspaceBytes = getSize(this.workspaceDir);
    const logsBytes = getSize(this.getLogsDir());
    const tempBytes = getSize(this.getTempDir());

    return {
      totalBytes: workspaceBytes + logsBytes + tempBytes,
      workspaceBytes,
      logsBytes,
      tempBytes,
    };
  }

  /**
   * Export environment configuration.
   */
  exportConfig(): CompanyEnvironmentConfig {
    return { ...this.config };
  }
}
