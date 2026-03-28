/**
 * Group of Companies Management System.
 * Manages multiple companies under a holding/group structure.
 * Features: company CRUD, shared service registry, cross-company policies, group-level admin.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type CompanyId = string;

export type Company = {
  id: CompanyId;
  name: string;
  /** When company was created */
  createdAt: number;
  /** Company status */
  status: "active" | "suspended" | "archived";
  /** Company metadata */
  metadata?: Record<string, unknown>;
  /** Data sovereignty region (e.g., 'us', 'eu', 'asia') */
  region?: string;
  /** Version pinning (e.g., '2024.1.0') */
  version?: string;
};

export type CrossCompanyPolicy = {
  /** Policy ID */
  id: string;
  /** Source company ID (requester) */
  sourceCompanyId: CompanyId;
  /** Target company ID (provider) */
  targetCompanyId: CompanyId;
  /** What kind of access is allowed */
  accessType: "read" | "write" | "execute";
  /** Which resources can be accessed (glob patterns) */
  resourcePatterns: string[];
  /** Whether approval is required for each request */
  requireApproval: boolean;
  /** Policy status */
  enabled: boolean;
  /** When policy was created */
  createdAt: number;
  /** Optional expiry timestamp */
  expiresAt?: number;
};

export type GroupConfig = {
  /** Group name */
  name: string;
  /** Group admin IDs */
  adminIds: string[];
  /** Data directory for group state */
  dataDir: string;
};

/**
 * GroupManager handles company lifecycle and cross-company policies.
 */
export class GroupManager {
  private dataDir: string;
  private companies: Map<CompanyId, Company>;
  private policies: Map<string, CrossCompanyPolicy>;
  private groupName: string;
  private adminIds: Set<string>;

  constructor(config: GroupConfig) {
    this.dataDir = config.dataDir;
    this.groupName = config.name;
    this.adminIds = new Set(config.adminIds);
    this.companies = new Map();
    this.policies = new Map();

    fs.mkdirSync(this.dataDir, { recursive: true });
    this.loadState();
  }

  /**
   * Create a new company in the group.
   */
  createCompany(
    name: string,
    options?: { region?: string; version?: string; metadata?: Record<string, unknown> },
  ): Company {
    const id = this.generateCompanyId(name);

    if (this.companies.has(id)) {
      throw new Error(`Company with ID ${id} already exists`);
    }

    const company: Company = {
      id,
      name,
      createdAt: Date.now(),
      status: "active",
      region: options?.region,
      version: options?.version,
      metadata: options?.metadata,
    };

    this.companies.set(id, company);
    this.saveState();

    return company;
  }

  /**
   * Get a company by ID.
   */
  getCompany(companyId: CompanyId): Company | undefined {
    return this.companies.get(companyId);
  }

  /**
   * List all companies (optionally filtered by status).
   */
  listCompanies(statusFilter?: Company["status"]): Company[] {
    const companies = Array.from(this.companies.values());

    if (statusFilter) {
      return companies.filter((c) => c.status === statusFilter);
    }

    return companies;
  }

  /**
   * Update company metadata.
   */
  updateCompany(
    companyId: CompanyId,
    updates: Partial<Pick<Company, "name" | "region" | "version" | "metadata">>,
  ): Company {
    const company = this.companies.get(companyId);
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }

    const updated = {
      ...company,
      ...updates,
    };

    this.companies.set(companyId, updated);
    this.saveState();

    return updated;
  }

  /**
   * Suspend a company (prevents operations but keeps data).
   */
  suspendCompany(companyId: CompanyId): void {
    const company = this.companies.get(companyId);
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }

    company.status = "suspended";
    this.companies.set(companyId, company);
    this.saveState();
  }

  /**
   * Archive a company (read-only, no operations).
   */
  archiveCompany(companyId: CompanyId): void {
    const company = this.companies.get(companyId);
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }

    company.status = "archived";
    this.companies.set(companyId, company);
    this.saveState();
  }

  /**
   * Reactivate a suspended/archived company.
   */
  reactivateCompany(companyId: CompanyId): void {
    const company = this.companies.get(companyId);
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }

    company.status = "active";
    this.companies.set(companyId, company);
    this.saveState();
  }

  /**
   * Delete a company (permanently removes all data).
   * Requires confirmation parameter to prevent accidental deletion.
   */
  deleteCompany(companyId: CompanyId, confirmName: string): void {
    const company = this.companies.get(companyId);
    if (!company) {
      throw new Error(`Company ${companyId} not found`);
    }

    if (confirmName !== company.name) {
      throw new Error(`Confirmation failed: expected "${company.name}", got "${confirmName}"`);
    }

    this.companies.delete(companyId);

    // Remove all policies involving this company
    for (const [policyId, policy] of this.policies) {
      if (policy.sourceCompanyId === companyId || policy.targetCompanyId === companyId) {
        this.policies.delete(policyId);
      }
    }

    this.saveState();
  }

  /**
   * Create a cross-company access policy.
   */
  createPolicy(
    sourceCompanyId: CompanyId,
    targetCompanyId: CompanyId,
    options: {
      accessType: CrossCompanyPolicy["accessType"];
      resourcePatterns: string[];
      requireApproval?: boolean;
      expiresAt?: number;
    },
  ): CrossCompanyPolicy {
    // Verify both companies exist
    if (!this.companies.has(sourceCompanyId)) {
      throw new Error(`Source company ${sourceCompanyId} not found`);
    }
    if (!this.companies.has(targetCompanyId)) {
      throw new Error(`Target company ${targetCompanyId} not found`);
    }

    const policy: CrossCompanyPolicy = {
      id: this.generatePolicyId(),
      sourceCompanyId,
      targetCompanyId,
      accessType: options.accessType,
      resourcePatterns: options.resourcePatterns,
      requireApproval: options.requireApproval ?? true,
      enabled: true,
      createdAt: Date.now(),
      expiresAt: options.expiresAt,
    };

    this.policies.set(policy.id, policy);
    this.saveState();

    return policy;
  }

  /**
   * Get a policy by ID.
   */
  getPolicy(policyId: string): CrossCompanyPolicy | undefined {
    return this.policies.get(policyId);
  }

  /**
   * List policies (optionally filtered by company).
   */
  listPolicies(companyId?: CompanyId): CrossCompanyPolicy[] {
    const policies = Array.from(this.policies.values());

    if (companyId) {
      return policies.filter(
        (p) => p.sourceCompanyId === companyId || p.targetCompanyId === companyId,
      );
    }

    return policies;
  }

  /**
   * Check if a cross-company access is allowed by policy.
   */
  isAccessAllowed(
    sourceCompanyId: CompanyId,
    targetCompanyId: CompanyId,
    accessType: CrossCompanyPolicy["accessType"],
    resource: string,
  ): { allowed: boolean; policy?: CrossCompanyPolicy; reason?: string } {
    // Same company always allowed
    if (sourceCompanyId === targetCompanyId) {
      return { allowed: true };
    }

    // Check if source company is active
    const sourceCompany = this.companies.get(sourceCompanyId);
    if (!sourceCompany || sourceCompany.status !== "active") {
      return { allowed: false, reason: "Source company not active" };
    }

    // Check if target company is active
    const targetCompany = this.companies.get(targetCompanyId);
    if (!targetCompany || targetCompany.status !== "active") {
      return { allowed: false, reason: "Target company not active" };
    }

    // Find matching policy
    for (const policy of this.policies.values()) {
      if (
        policy.sourceCompanyId === sourceCompanyId &&
        policy.targetCompanyId === targetCompanyId &&
        policy.enabled
      ) {
        // Check expiry
        if (policy.expiresAt && Date.now() > policy.expiresAt) {
          continue;
        }

        // Check access type
        if (policy.accessType !== accessType) {
          continue;
        }

        // Check resource pattern match
        const matched = policy.resourcePatterns.some((pattern) =>
          this.matchPattern(resource, pattern),
        );

        if (matched) {
          return { allowed: true, policy };
        }
      }
    }

    return { allowed: false, reason: "No matching policy found" };
  }

  /**
   * Enable or disable a policy.
   */
  setPolicyEnabled(policyId: string, enabled: boolean): void {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new Error(`Policy ${policyId} not found`);
    }

    policy.enabled = enabled;
    this.policies.set(policyId, policy);
    this.saveState();
  }

  /**
   * Delete a policy.
   */
  deletePolicy(policyId: string): void {
    if (!this.policies.delete(policyId)) {
      throw new Error(`Policy ${policyId} not found`);
    }
    this.saveState();
  }

  /**
   * Check if a user is a group admin.
   */
  isGroupAdmin(userId: string): boolean {
    return this.adminIds.has(userId);
  }

  /**
   * Add a group admin.
   */
  addGroupAdmin(userId: string): void {
    this.adminIds.add(userId);
    this.saveState();
  }

  /**
   * Remove a group admin.
   */
  removeGroupAdmin(userId: string): void {
    this.adminIds.delete(userId);
    this.saveState();
  }

  /**
   * Get group overview statistics.
   */
  getGroupStats(): {
    totalCompanies: number;
    activeCompanies: number;
    suspendedCompanies: number;
    archivedCompanies: number;
    totalPolicies: number;
    activePolicies: number;
  } {
    const companies = Array.from(this.companies.values());
    const policies = Array.from(this.policies.values());

    return {
      totalCompanies: companies.length,
      activeCompanies: companies.filter((c) => c.status === "active").length,
      suspendedCompanies: companies.filter((c) => c.status === "suspended").length,
      archivedCompanies: companies.filter((c) => c.status === "archived").length,
      totalPolicies: policies.length,
      activePolicies: policies.filter((p) => p.enabled).length,
    };
  }

  /**
   * Generate a unique company ID based on name.
   */
  private generateCompanyId(name: string): CompanyId {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const hash = crypto.createHash("sha256").update(name + Date.now()).digest("hex").slice(0, 8);
    return `${normalized}-${hash}`;
  }

  /**
   * Generate a unique policy ID.
   */
  private generatePolicyId(): string {
    return crypto.randomBytes(16).toString("hex");
  }

  /**
   * Match resource against pattern (supports * wildcard).
   */
  private matchPattern(resource: string, pattern: string): boolean {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    return regex.test(resource);
  }

  /**
   * Load state from disk.
   */
  private loadState(): void {
    const statePath = path.join(this.dataDir, "group-state.json");

    if (!fs.existsSync(statePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(statePath, "utf-8");
      const state = JSON.parse(content);

      if (state.companies) {
        for (const company of state.companies) {
          this.companies.set(company.id, company);
        }
      }

      if (state.policies) {
        for (const policy of state.policies) {
          this.policies.set(policy.id, policy);
        }
      }

      if (state.adminIds) {
        this.adminIds = new Set(state.adminIds);
      }
    } catch {
      // Ignore parse errors, start fresh
    }
  }

  /**
   * Save state to disk.
   */
  private saveState(): void {
    const statePath = path.join(this.dataDir, "group-state.json");

    const state = {
      groupName: this.groupName,
      adminIds: Array.from(this.adminIds),
      companies: Array.from(this.companies.values()),
      policies: Array.from(this.policies.values()),
    };

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }
}
