/**
 * Comprehensive tests for the Retail Isolated Tenant System.
 * Covers TenantManager, TenantIsolation, TenantBilling, AgentTemplates, TenantDashboard.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { TenantManager } from "./tenant-manager.js";
import { TenantIsolation } from "./tenant-isolation.js";
import { TenantBilling } from "./tenant-billing.js";
import { AgentTemplateRegistry, BUILTIN_TEMPLATES } from "./agent-templates.js";
import { TenantDashboard } from "./tenant-dashboard.js";
import type { CreateTenantRequest, TenantConfig } from "./tenant-manager.js";
import type { BudgetStatus } from "./tenant-billing.js";

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tenancy-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs = [];
});

// ============================================================================
// TENANT MANAGER TESTS (18 tests)
// ============================================================================

describe("TenantManager", () => {
  it("should create a tenant manager", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });
    expect(manager).toBeDefined();
  });

  it("should create a new tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const request: CreateTenantRequest = {
      name: "Test Store",
      contactEmail: "test@example.com",
    };

    const tenant = manager.createTenant(request);
    expect(tenant.id).toBeDefined();
    expect(tenant.name).toBe("Test Store");
    expect(tenant.status).toBe("active");
    expect(tenant.contactEmail).toBe("test@example.com");
  });

  it("should create tenant directory structure", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    const tenantDir = manager.getTenantDirectory(tenant.id);

    expect(fs.existsSync(path.join(tenantDir, "workspace"))).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, "logs"))).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, "credentials"))).toBe(true);
    expect(fs.existsSync(path.join(tenantDir, "billing"))).toBe(true);
  });

  it("should get tenant by ID", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const created = manager.createTenant({ name: "Test Store" });
    const retrieved = manager.getTenant(created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(created.id);
    expect(retrieved?.name).toBe("Test Store");
  });

  it("should return undefined for non-existent tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });
    expect(manager.getTenant("nonexistent")).toBeUndefined();
  });

  it("should list all tenants", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    manager.createTenant({ name: "Store 1" });
    manager.createTenant({ name: "Store 2" });

    const tenants = manager.listTenants();
    expect(tenants).toHaveLength(2);
  });

  it("should filter tenants by status", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const t1 = manager.createTenant({ name: "Store 1" });
    manager.createTenant({ name: "Store 2" });
    manager.suspendTenant(t1.id);

    const active = manager.listTenants("active");
    const suspended = manager.listTenants("suspended");

    expect(active).toHaveLength(1);
    expect(suspended).toHaveLength(1);
  });

  it("should update tenant configuration", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    const updated = manager.updateTenant(tenant.id, {
      contactEmail: "new@example.com",
      maxAgents: 5,
    });

    expect(updated.contactEmail).toBe("new@example.com");
    expect(updated.maxAgents).toBe(5);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(tenant.updatedAt);
  });

  it("should throw error when updating non-existent tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    expect(() => {
      manager.updateTenant("nonexistent", { name: "New Name" });
    }).toThrow("Tenant not found");
  });

  it("should suspend a tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    const suspended = manager.suspendTenant(tenant.id, "Payment overdue");

    expect(suspended.status).toBe("suspended");
    expect(suspended.metadata?.suspensionReason).toBe("Payment overdue");
    expect(suspended.metadata?.suspendedAt).toBeDefined();
  });

  it("should resume a suspended tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    manager.suspendTenant(tenant.id);
    const resumed = manager.resumeTenant(tenant.id);

    expect(resumed.status).toBe("active");
    expect(resumed.metadata?.resumedAt).toBeDefined();
  });

  it("should throw error when resuming non-suspended tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    expect(() => {
      manager.resumeTenant(tenant.id);
    }).toThrow("Tenant is not suspended");
  });

  it("should soft delete a tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    manager.deleteTenant(tenant.id);

    const deleted = manager.getTenant(tenant.id);
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.metadata?.deletedAt).toBeDefined();
  });

  it("should hard delete a tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    const tenantDir = manager.getTenantDirectory(tenant.id);

    manager.hardDeleteTenant(tenant.id);

    expect(fs.existsSync(tenantDir)).toBe(false);
    expect(manager.getTenant(tenant.id)).toBeUndefined();
  });

  it("should generate agent configuration", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    const config = manager.generateAgentConfig(tenant.id, "agent1");

    expect(config.agentId).toBe(`${tenant.id}-agent1`);
    expect(config).toHaveProperty("workspaceDir");
    expect(config).toHaveProperty("hierarchy");
    expect(config).toHaveProperty("security");
  });

  it("should throw error when generating config for inactive tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    manager.suspendTenant(tenant.id);

    expect(() => {
      manager.generateAgentConfig(tenant.id, "agent1");
    }).toThrow("Tenant is not active");
  });

  it("should enforce maximum tenant limit", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir, maxTenants: 2 });

    manager.createTenant({ name: "Store 1" });
    manager.createTenant({ name: "Store 2" });

    expect(() => {
      manager.createTenant({ name: "Store 3" });
    }).toThrow("Maximum tenant limit reached");
  });

  it("should persist and reload tenants", () => {
    const dataDir = createTempDir();
    let manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });

    // Create new manager instance (simulates restart)
    manager = new TenantManager({ dataDir });

    const reloaded = manager.getTenant(tenant.id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.name).toBe("Test Store");
  });
});

// ============================================================================
// TENANT ISOLATION TESTS (14 tests)
// ============================================================================

describe("TenantIsolation", () => {
  it("should create tenant isolation", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });
    expect(isolation).toBeDefined();
  });

  it("should block access to files outside workspace", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const result = isolation.checkFileAccess("/etc/passwd");
    expect(result.allowed).toBe(false);
  });

  it("should allow access to files inside workspace", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const workspaceDir = isolation.getWorkspaceDir();
    const result = isolation.checkFileAccess(path.join(workspaceDir, "test.txt"));
    expect(result.allowed).toBe(true);
  });

  it("should block path traversal attacks", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const result = isolation.checkFileAccess("../../../etc/passwd");
    expect(result.allowed).toBe(false);
  });

  it("should block access to localhost URLs", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const result = isolation.checkNetworkAccess("http://localhost:3000");
    expect(result.allowed).toBe(false);
  });

  it("should block access to cloud metadata endpoints", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const result = isolation.checkNetworkAccess("http://169.254.169.254/metadata");
    expect(result.allowed).toBe(false);
  });

  it("should allow whitelisted URLs", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
      allowedWebhooks: ["https://api.example.com/webhook"],
    });

    const result = isolation.checkNetworkAccess("https://api.example.com/webhook");
    expect(result.allowed).toBe(true);
  });

  it("should block network scanning tools", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const result = isolation.checkExecCommand("nmap -sS 192.168.1.0/24");
    expect(result.allowed).toBe(false);
  });

  it("should add and retrieve credentials", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
      credentials: [
        { key: "API_KEY", value: "secret123", minLevel: 2 },
      ],
    });

    const value = isolation.getCredential("tenant1-agent1", "API_KEY");
    expect(value).toBe("secret123");
  });

  it("should return undefined for non-existent credentials", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const value = isolation.getCredential("tenant1-agent1", "NONEXISTENT");
    expect(value).toBeUndefined();
  });

  it("should create sandboxed environment", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
      credentials: [
        { key: "API_KEY", value: "secret123", minLevel: 2 },
      ],
    });

    const env = isolation.createSandboxEnv("tenant1-agent1");
    expect(env.TENANT_ID).toBe("tenant1");
    expect(env.API_KEY).toBe("secret123");
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.SSH_AUTH_SOCK).toBeUndefined();
  });

  it("should verify complete isolation", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const verification = isolation.verifyIsolation();
    expect(verification.filesystemIsolated).toBe(true);
    expect(verification.networkIsolated).toBe(true);
    expect(verification.credentialsIsolated).toBe(true);
    expect(verification.errors).toHaveLength(0);
  });

  it("should get workspace directory", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const workspaceDir = isolation.getWorkspaceDir();
    expect(workspaceDir).toBe(path.join(tenantDir, "workspace"));
  });

  it("should get logs directory", () => {
    const tenantDir = createTempDir();
    const isolation = new TenantIsolation({
      tenantId: "tenant1",
      tenantDir,
    });

    const logsDir = isolation.getLogsDir();
    expect(logsDir).toBe(path.join(tenantDir, "logs"));
  });
});

// ============================================================================
// TENANT BILLING TESTS (12 tests)
// ============================================================================

describe("TenantBilling", () => {
  it("should create tenant billing", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });
    expect(billing).toBeDefined();
  });

  it("should track request usage", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    const record = billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);
    expect(record.agentId).toBe("agent1");
    expect(record.model).toBe("claude-sonnet-4-5");
    expect(record.cost).toBeGreaterThan(0);
  });

  it("should calculate daily cost", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);
    billing.trackRequest("agent2", "claude-sonnet-4-5", 2000, 1000);

    const cost = billing.getDailyCost();
    expect(cost).toBeGreaterThan(0);
  });

  it("should check budget status", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);

    const status = billing.checkBudget();
    expect(status.tenantId).toBe("tenant1");
    expect(status.dailyCost).toBeGreaterThan(0);
    expect(status.dailyPercentUsed).toBeGreaterThan(0);
  });

  it("should detect over-budget status", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 0.001, // Very small budget
      monthly: 1,
      blockOnExceed: true,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 10000, 5000);

    const status = billing.checkBudget();
    expect(status.isOverDailyBudget).toBe(true);
    expect(status.shouldBlock).toBe(true);
  });

  it("should suggest model downgrade when over budget", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 0.001,
      monthly: 1,
      blockOnExceed: false,
      modelOnExceed: "claude-haiku-3-5",
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 10000, 5000);

    const status = billing.checkBudget();
    expect(status.downgradeTo).toBe("claude-haiku-3-5");
  });

  it("should get cost breakdown by agent", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);
    billing.trackRequest("agent2", "claude-sonnet-4-5", 2000, 1000);

    const breakdown = billing.getDailyCostByAgent();
    expect(breakdown.size).toBe(2);
    expect(breakdown.has("agent1")).toBe(true);
    expect(breakdown.has("agent2")).toBe(true);
  });

  it("should get cost breakdown by model", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);
    billing.trackRequest("agent2", "claude-haiku-3-5", 2000, 1000);

    const breakdown = billing.getDailyCostByModel();
    expect(breakdown.size).toBe(2);
    expect(breakdown.has("claude-sonnet-4-5")).toBe(true);
    expect(breakdown.has("claude-haiku-3-5")).toBe(true);
  });

  it("should generate invoice", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);

    const startDate = new Date();
    const endDate = new Date();
    const invoice = billing.generateInvoice(startDate, endDate, 0.1);

    expect(invoice.tenantId).toBe("tenant1");
    expect(invoice.lineItems.length).toBeGreaterThan(0);
    expect(invoice.subtotal).toBeGreaterThan(0);
    expect(invoice.tax).toBeGreaterThan(0);
    expect(invoice.total).toBe(invoice.subtotal + invoice.tax);
  });

  it("should predict budget exceedance", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 1,
      monthly: 30,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);

    const prediction = billing.willExceedBudget(0.5);
    expect(prediction).toHaveProperty("willExceedDaily");
    expect(prediction).toHaveProperty("willExceedMonthly");
    expect(prediction).toHaveProperty("remainingDaily");
    expect(prediction).toHaveProperty("remainingMonthly");
  });

  it("should update budget", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    const updated = billing.updateBudget({ daily: 20, monthly: 600 });
    expect(updated.daily).toBe(20);
    expect(updated.monthly).toBe(600);
  });

  it("should get usage summary for agent", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);
    billing.trackRequest("agent1", "claude-sonnet-4-5", 2000, 1000);

    const summary = billing.getAgentUsageSummary("agent1");
    expect(summary.requestCount).toBe(2);
    expect(summary.totalInput).toBe(3000);
    expect(summary.totalOutput).toBe(1500);
  });
});

// ============================================================================
// AGENT TEMPLATES TESTS (10 tests)
// ============================================================================

describe("AgentTemplateRegistry", () => {
  it("should create template registry with built-in templates", () => {
    const registry = new AgentTemplateRegistry();
    expect(registry).toBeDefined();
    expect(registry.listTemplates().length).toBeGreaterThan(0);
  });

  it("should get template by ID", () => {
    const registry = new AgentTemplateRegistry();
    const template = registry.getTemplate("customer-service");
    expect(template).toBeDefined();
    expect(template?.name).toBe("Customer Service Agent");
  });

  it("should return undefined for non-existent template", () => {
    const registry = new AgentTemplateRegistry();
    expect(registry.getTemplate("nonexistent")).toBeUndefined();
  });

  it("should list templates by category", () => {
    const registry = new AgentTemplateRegistry();
    const customerService = registry.listTemplates("customer_service");
    expect(customerService.length).toBeGreaterThan(0);
  });

  it("should create custom template", () => {
    const registry = new AgentTemplateRegistry();
    registry.createCustomTemplate({
      id: "custom-agent",
      name: "Custom Agent",
      description: "A custom agent",
      category: "custom",
      systemPrompt: "You are a custom agent",
      capabilities: ["chat"],
    });

    const template = registry.getTemplate("custom-agent");
    expect(template).toBeDefined();
    expect(template?.name).toBe("Custom Agent");
  });

  it("should throw error when creating duplicate template", () => {
    const registry = new AgentTemplateRegistry();
    expect(() => {
      registry.createCustomTemplate({
        id: "customer-service",
        name: "Duplicate",
        description: "Duplicate",
        category: "custom",
        systemPrompt: "Duplicate",
        capabilities: ["chat"],
      });
    }).toThrow("Template already exists");
  });

  it("should customize existing template", () => {
    const registry = new AgentTemplateRegistry();
    const customized = registry.customizeTemplate("customer-service", {
      model: "claude-opus-4-6",
      capabilities: { add: ["file_read"] },
    });

    expect(customized.model).toBe("claude-opus-4-6");
    expect(customized.capabilities).toContain("file_read");
    expect(customized.id).not.toBe("customer-service");
  });

  it("should generate agent config from template", () => {
    const registry = new AgentTemplateRegistry();
    const config = registry.generateAgentConfig(
      "customer-service",
      "tenant1",
      "cs-agent-1"
    );

    expect(config.agentId).toBe("tenant1-cs-agent-1");
    expect(config).toHaveProperty("systemPrompt");
    expect(config).toHaveProperty("model");
    expect(config).toHaveProperty("capabilities");
  });

  it("should validate webhooks", () => {
    const registry = new AgentTemplateRegistry();
    const validation = registry.validateWebhooks("customer-service", ["crm", "pos"]);
    expect(validation.valid).toBe(true);
    expect(validation.missing).toHaveLength(0);
  });

  it("should recommend templates based on keywords", () => {
    const registry = new AgentTemplateRegistry();
    const recommendations = registry.recommendTemplates(["customer", "service", "support"]);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].category).toBe("customer_service");
  });
});

// ============================================================================
// TENANT DASHBOARD TESTS (8 tests)
// ============================================================================

describe("TenantDashboard", () => {
  function createMockTenant(): TenantConfig {
    return {
      id: "tenant1",
      name: "Test Store",
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function createMockBudgetStatus(): BudgetStatus {
    return {
      tenantId: "tenant1",
      budget: { daily: 10, monthly: 300, blockOnExceed: false },
      dailyCost: 5,
      monthlyCost: 150,
      dailyPercentUsed: 50,
      monthlyPercentUsed: 50,
      isOverDailyBudget: false,
      isOverMonthlyBudget: false,
      shouldBlock: false,
    };
  }

  it("should create tenant dashboard", () => {
    const dashboard = new TenantDashboard("tenant1");
    expect(dashboard).toBeDefined();
  });

  it("should assess healthy status", () => {
    const dashboard = new TenantDashboard("tenant1");
    const health = dashboard.assessHealth(
      createMockBudgetStatus(),
      { total: 5, byType: new Map(), recent: [] },
      { filesystem: 0, network: 0, credentials: 0 }
    );

    expect(health.status).toBe("healthy");
    expect(health.issues).toHaveLength(0);
  });

  it("should assess warning status for high budget usage", () => {
    const dashboard = new TenantDashboard("tenant1");
    const budget = createMockBudgetStatus();
    budget.monthlyPercentUsed = 85;

    const health = dashboard.assessHealth(
      budget,
      { total: 5, byType: new Map(), recent: [] },
      { filesystem: 0, network: 0, credentials: 0 }
    );

    expect(health.status).toBe("warning");
    expect(health.issues.length).toBeGreaterThan(0);
  });

  it("should assess critical status for security violations", () => {
    const dashboard = new TenantDashboard("tenant1");
    const health = dashboard.assessHealth(
      createMockBudgetStatus(),
      { total: 5, byType: new Map(), recent: [] },
      { filesystem: 1, network: 0, credentials: 0 }
    );

    expect(health.status).toBe("critical");
    expect(health.issues.some((i) => i.includes("security violations"))).toBe(true);
  });

  it("should create and retrieve alerts", () => {
    const dashboard = new TenantDashboard("tenant1");
    const alert = dashboard.createAlert("warning", "High budget usage", "agent1");

    expect(alert.level).toBe("warning");
    expect(alert.message).toBe("High budget usage");
    expect(alert.acknowledged).toBe(false);

    const active = dashboard.getActiveAlerts();
    expect(active).toHaveLength(1);
  });

  it("should acknowledge alerts", () => {
    const dashboard = new TenantDashboard("tenant1");
    const alert = dashboard.createAlert("warning", "Test alert");

    const success = dashboard.acknowledgeAlert(alert.id);
    expect(success).toBe(true);

    const active = dashboard.getActiveAlerts();
    expect(active).toHaveLength(0);
  });

  it("should generate usage trends", () => {
    const dashboard = new TenantDashboard("tenant1");
    const dailyUsages = [
      {
        date: "2026-01-01",
        usage: {
          totalRequests: 100,
          totalInputTokens: 10000,
          totalOutputTokens: 5000,
          totalCost: 1.5,
          averageRequestCost: 0.015,
          requestsByModel: new Map(),
          costByModel: new Map(),
        },
      },
      {
        date: "2026-01-02",
        usage: {
          totalRequests: 150,
          totalInputTokens: 15000,
          totalOutputTokens: 7500,
          totalCost: 2.0,
          averageRequestCost: 0.0133,
          requestsByModel: new Map(),
          costByModel: new Map(),
        },
      },
    ];

    const trend = dashboard.generateUsageTrend(dailyUsages);
    expect(trend.dates).toHaveLength(2);
    expect(trend.costs).toEqual([1.5, 2.0]);
    expect(trend.requests).toEqual([100, 150]);
  });

  it("should generate budget forecast", () => {
    const dashboard = new TenantDashboard("tenant1");
    const dailyUsages = [
      {
        date: "2026-01-01",
        usage: {
          totalRequests: 100,
          totalInputTokens: 10000,
          totalOutputTokens: 5000,
          totalCost: 10,
          averageRequestCost: 0.1,
          requestsByModel: new Map(),
          costByModel: new Map(),
        },
      },
    ];

    const forecast = dashboard.getBudgetForecast(dailyUsages, 300);
    expect(forecast).toHaveProperty("daysUntilExceeded");
    expect(forecast).toHaveProperty("predictedMonthEnd");
    expect(forecast).toHaveProperty("isOnTrack");
  });
});

// ============================================================================
// INTEGRATION TESTS (8 tests)
// ============================================================================

describe("Integration Tests", () => {
  it("should create complete tenant with isolation and billing", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({
      name: "Integration Test Store",
      contactEmail: "test@example.com",
    });

    const tenantDir = manager.getTenantDirectory(tenant.id);
    const isolation = new TenantIsolation({
      tenantId: tenant.id,
      tenantDir,
    });

    const billingDir = isolation.getBillingDir();
    const billing = new TenantBilling(tenant.id, billingDir, {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    expect(tenant.id).toBeDefined();
    expect(isolation.getWorkspaceDir()).toBeDefined();
    expect(billing.getDailyCost()).toBe(0);
  });

  it("should enforce isolation across multiple tenants", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant1 = manager.createTenant({ name: "Store 1" });
    const tenant2 = manager.createTenant({ name: "Store 2" });

    const isolation1 = new TenantIsolation({
      tenantId: tenant1.id,
      tenantDir: manager.getTenantDirectory(tenant1.id),
    });

    const isolation2 = new TenantIsolation({
      tenantId: tenant2.id,
      tenantDir: manager.getTenantDirectory(tenant2.id),
    });

    const workspace1 = isolation1.getWorkspaceDir();
    const workspace2 = isolation2.getWorkspaceDir();

    expect(workspace1).not.toBe(workspace2);

    // Tenant 1 cannot access Tenant 2's workspace
    const result = isolation1.checkFileAccess(workspace2);
    expect(result.allowed).toBe(false);
  });

  it("should track billing separately per tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant1 = manager.createTenant({ name: "Store 1" });
    const tenant2 = manager.createTenant({ name: "Store 2" });

    const isolation1 = new TenantIsolation({
      tenantId: tenant1.id,
      tenantDir: manager.getTenantDirectory(tenant1.id),
    });

    const isolation2 = new TenantIsolation({
      tenantId: tenant2.id,
      tenantDir: manager.getTenantDirectory(tenant2.id),
    });

    const billing1 = new TenantBilling(tenant1.id, isolation1.getBillingDir(), {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    const billing2 = new TenantBilling(tenant2.id, isolation2.getBillingDir(), {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing1.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);
    billing2.trackRequest("agent2", "claude-sonnet-4-5", 2000, 1000);

    const cost1 = billing1.getDailyCost();
    const cost2 = billing2.getDailyCost();

    expect(cost1).toBeGreaterThan(0);
    expect(cost2).toBeGreaterThan(0);
    expect(cost2).toBeGreaterThan(cost1);
  });

  it("should deploy agent from template for tenant", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });
    const registry = new AgentTemplateRegistry();

    const tenant = manager.createTenant({ name: "Test Store" });
    const agentConfig = registry.generateAgentConfig(
      "customer-service",
      tenant.id,
      "cs-agent"
    );

    expect(agentConfig.agentId).toBe(`${tenant.id}-cs-agent`);
    expect(agentConfig).toHaveProperty("systemPrompt");
  });

  it("should generate dashboard snapshot with all metrics", async () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    const tenantDir = manager.getTenantDirectory(tenant.id);
    const isolation = new TenantIsolation({
      tenantId: tenant.id,
      tenantDir,
    });

    const billing = new TenantBilling(tenant.id, isolation.getBillingDir(), {
      daily: 10,
      monthly: 300,
      blockOnExceed: false,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 1000, 500);

    const dashboard = new TenantDashboard(tenant.id);
    const budget = billing.checkBudget();

    const snapshot = await dashboard.getSnapshot(
      tenant,
      budget,
      {
        totalRequests: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCost: billing.getDailyCost(),
        averageRequestCost: billing.getDailyCost(),
        requestsByModel: new Map([["claude-sonnet-4-5", 1]]),
        costByModel: new Map([["claude-sonnet-4-5", billing.getDailyCost()]]),
      },
      {
        totalRequests: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCost: billing.getMonthlyCost(),
        averageRequestCost: billing.getMonthlyCost(),
        requestsByModel: new Map([["claude-sonnet-4-5", 1]]),
        costByModel: new Map([["claude-sonnet-4-5", billing.getMonthlyCost()]]),
      },
      [],
      { total: 0, byType: new Map(), recent: [] },
      { filesystem: 0, network: 0, credentials: 0 }
    );

    expect(snapshot.tenant.id).toBe(tenant.id);
    expect(snapshot.budget.dailyCost).toBeGreaterThan(0);
    expect(snapshot.health.status).toBeDefined();
  });

  it("should suspend tenant and block operations", () => {
    const dataDir = createTempDir();
    const manager = new TenantManager({ dataDir });

    const tenant = manager.createTenant({ name: "Test Store" });
    manager.suspendTenant(tenant.id, "Payment overdue");

    expect(() => {
      manager.generateAgentConfig(tenant.id, "agent1");
    }).toThrow("Tenant is not active");
  });

  it("should enforce budget caps and prevent overspend", () => {
    const billingDir = createTempDir();
    const billing = new TenantBilling("tenant1", billingDir, {
      daily: 0.01,
      monthly: 0.1,
      blockOnExceed: true,
    });

    billing.trackRequest("agent1", "claude-sonnet-4-5", 10000, 5000);

    const status = billing.checkBudget();
    expect(status.isOverDailyBudget).toBe(true);
    expect(status.shouldBlock).toBe(true);
  });

  it("should validate complete system with all built-in templates", () => {
    const registry = new AgentTemplateRegistry();
    const templates = registry.listTemplates();

    expect(templates.length).toBeGreaterThanOrEqual(BUILTIN_TEMPLATES.length);

    for (const template of BUILTIN_TEMPLATES) {
      const retrieved = registry.getTemplate(template.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe(template.name);
    }
  });
});
