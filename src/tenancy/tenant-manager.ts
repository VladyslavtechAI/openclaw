/**
 * Tenant Manager for retail isolated tenant system.
 * Handles CRUD operations, suspension, and configuration generation.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type TenantStatus = "active" | "suspended" | "deleted";

export type TenantConfig = {
  id: string;
  name: string;
  status: TenantStatus;
  createdAt: number;
  updatedAt: number;
  /** Contact email for notifications */
  contactEmail?: string;
  /** Maximum number of agents this tenant can spawn */
  maxAgents?: number;
  /** Webhook URLs for integrations (POS, CRM, etc.) */
  webhooks?: {
    pos?: string;
    inventory?: string;
    crm?: string;
  };
  /** Communication channels enabled for this tenant */
  channels?: {
    telegram?: { botToken: string; chatId?: string };
    whatsapp?: { phoneNumber: string };
    email?: { smtpConfig: string };
  };
  /** Custom metadata */
  metadata?: Record<string, unknown>;
};

export type CreateTenantRequest = Omit<TenantConfig, "id" | "status" | "createdAt" | "updatedAt">;

export type TenantManagerConfig = {
  /** Base directory for tenant data */
  dataDir: string;
  /** Maximum number of tenants allowed */
  maxTenants?: number;
};

/**
 * Tenant Manager handles lifecycle operations for retail tenants.
 */
export class TenantManager {
  private dataDir: string;
  private maxTenants: number;
  private tenants: Map<string, TenantConfig>;

  constructor(config: TenantManagerConfig) {
    this.dataDir = config.dataDir;
    this.maxTenants = config.maxTenants ?? Number.POSITIVE_INFINITY;
    this.tenants = new Map();

    // Create data directory
    fs.mkdirSync(this.dataDir, { recursive: true });

    // Load existing tenants
    this.loadTenants();
  }

  /**
   * Create a new tenant.
   */
  createTenant(request: CreateTenantRequest): TenantConfig {
    // Check tenant limit
    const activeTenants = Array.from(this.tenants.values()).filter(
      (t) => t.status !== "deleted"
    );
    if (activeTenants.length >= this.maxTenants) {
      throw new Error(`Maximum tenant limit reached (${this.maxTenants})`);
    }

    const id = this.generateTenantId();
    const now = Date.now();

    const tenant: TenantConfig = {
      ...request,
      id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    // Create tenant directory structure
    this.createTenantDirectories(id);

    // Save tenant config
    this.saveTenantConfig(tenant);
    this.tenants.set(id, tenant);

    return tenant;
  }

  /**
   * Get tenant by ID.
   */
  getTenant(id: string): TenantConfig | undefined {
    return this.tenants.get(id);
  }

  /**
   * List all tenants (optionally filter by status).
   */
  listTenants(status?: TenantStatus): TenantConfig[] {
    const tenants = Array.from(this.tenants.values());
    if (status) {
      return tenants.filter((t) => t.status === status);
    }
    return tenants;
  }

  /**
   * Update tenant configuration.
   */
  updateTenant(id: string, updates: Partial<Omit<TenantConfig, "id" | "createdAt">>): TenantConfig {
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }

    if (tenant.status === "deleted") {
      throw new Error(`Cannot update deleted tenant: ${id}`);
    }

    const updated: TenantConfig = {
      ...tenant,
      ...updates,
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: Date.now(),
    };

    this.saveTenantConfig(updated);
    this.tenants.set(id, updated);

    return updated;
  }

  /**
   * Suspend a tenant (disables all operations but preserves data).
   */
  suspendTenant(id: string, reason?: string): TenantConfig {
    const tenant = this.getTenant(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }

    if (tenant.status === "deleted") {
      throw new Error(`Cannot suspend deleted tenant: ${id}`);
    }

    const updated = this.updateTenant(id, {
      status: "suspended",
      metadata: {
        ...tenant.metadata,
        suspensionReason: reason,
        suspendedAt: Date.now(),
      },
    });

    return updated;
  }

  /**
   * Resume a suspended tenant.
   */
  resumeTenant(id: string): TenantConfig {
    const tenant = this.getTenant(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }

    if (tenant.status !== "suspended") {
      throw new Error(`Tenant is not suspended: ${id}`);
    }

    const updated = this.updateTenant(id, {
      status: "active",
      metadata: {
        ...tenant.metadata,
        suspensionReason: undefined,
        suspendedAt: undefined,
        resumedAt: Date.now(),
      },
    });

    return updated;
  }

  /**
   * Delete a tenant (soft delete - marks as deleted).
   */
  deleteTenant(id: string): void {
    const tenant = this.getTenant(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }

    this.updateTenant(id, {
      status: "deleted",
      metadata: {
        ...tenant.metadata,
        deletedAt: Date.now(),
      },
    });
  }

  /**
   * Hard delete a tenant (removes all data).
   */
  hardDeleteTenant(id: string): void {
    const tenant = this.getTenant(id);
    if (!tenant) {
      throw new Error(`Tenant not found: ${id}`);
    }

    // Remove tenant directory
    const tenantDir = this.getTenantDirectory(id);
    if (fs.existsSync(tenantDir)) {
      fs.rmSync(tenantDir, { recursive: true, force: true });
    }

    // Remove from memory
    this.tenants.delete(id);
  }

  /**
   * Generate OpenClaw agent configuration for a tenant.
   */
  generateAgentConfig(tenantId: string, agentName: string): Record<string, unknown> {
    const tenant = this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    if (tenant.status !== "active") {
      throw new Error(`Tenant is not active: ${tenantId} (status: ${tenant.status})`);
    }

    const workspaceDir = path.join(this.getTenantDirectory(tenantId), "workspace");

    return {
      agentId: `${tenantId}-${agentName}`,
      workspaceDir,
      hierarchy: {
        level: 2, // Worker by default
        lead: `${tenantId}-admin`,
      },
      security: {
        filesystemPolicy: {
          workspaceOnly: true,
          allowedPaths: [workspaceDir],
          blockTraversal: true,
        },
        networkPolicy: {
          urlWhitelist: tenant.webhooks
            ? Object.values(tenant.webhooks).filter(Boolean)
            : [],
        },
      },
      tenant: {
        id: tenantId,
        name: tenant.name,
        contactEmail: tenant.contactEmail,
      },
    };
  }

  /**
   * Get tenant workspace directory.
   */
  getTenantDirectory(tenantId: string): string {
    return path.join(this.dataDir, "tenants", tenantId);
  }

  /**
   * Get tenant configuration file path.
   */
  private getTenantConfigPath(tenantId: string): string {
    return path.join(this.getTenantDirectory(tenantId), "tenant.json");
  }

  /**
   * Create directory structure for a new tenant.
   */
  private createTenantDirectories(tenantId: string): void {
    const tenantDir = this.getTenantDirectory(tenantId);
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.mkdirSync(path.join(tenantDir, "workspace"), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, "credentials"), { recursive: true });
    fs.mkdirSync(path.join(tenantDir, "billing"), { recursive: true });
  }

  /**
   * Save tenant configuration to disk.
   */
  private saveTenantConfig(tenant: TenantConfig): void {
    const configPath = this.getTenantConfigPath(tenant.id);
    fs.writeFileSync(configPath, JSON.stringify(tenant, null, 2));
  }

  /**
   * Load all tenant configurations from disk.
   */
  private loadTenants(): void {
    const tenantsDir = path.join(this.dataDir, "tenants");
    if (!fs.existsSync(tenantsDir)) {
      return;
    }

    const entries = fs.readdirSync(tenantsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const configPath = path.join(tenantsDir, entry.name, "tenant.json");
      if (!fs.existsSync(configPath)) continue;

      try {
        const content = fs.readFileSync(configPath, "utf-8");
        const tenant = JSON.parse(content) as TenantConfig;
        this.tenants.set(tenant.id, tenant);
      } catch {
        // Skip invalid configs
      }
    }
  }

  /**
   * Generate a unique tenant ID.
   */
  private generateTenantId(): string {
    return `tenant_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  }
}
