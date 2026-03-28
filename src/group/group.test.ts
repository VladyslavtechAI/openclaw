/**
 * Comprehensive tests for Group of Companies Management System.
 * Tests all 6 modules: GroupManager, CompanyEnvironment, SharedServiceRegistry,
 * CrossCompanyBus, ConsolidatedBilling, VersionManager.
 */

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GroupManager } from "./group-manager.js";
import { CompanyEnvironment } from "./company-environment.js";
import { SharedServiceRegistry } from "./shared-service-registry.js";
import { CrossCompanyBus } from "./cross-company-bus.js";
import { ConsolidatedBilling } from "./consolidated-billing.js";
import { VersionManager } from "./version-manager.js";

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "group-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs = [];
});

// ============================================================================
// GroupManager Tests (18 tests)
// ============================================================================

describe("GroupManager", () => {
  it("creates a new group", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    expect(manager).toBeDefined();
    expect(manager.isGroupAdmin("admin1")).toBe(true);
  });

  it("creates a company", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Acme Corp", { region: "us" });

    expect(company.name).toBe("Acme Corp");
    expect(company.status).toBe("active");
    expect(company.region).toBe("us");
    expect(company.id).toBeDefined();
  });

  it("prevents duplicate company IDs", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company1 = manager.createCompany("Test Co");

    // Creating another company with the same name will generate a different ID
    // because the hash includes timestamp
    // However, if done very quickly, there could be a collision
    // In that case, the manager should throw an error
    try {
      const company2 = manager.createCompany("Test Co");
      // If no error, verify IDs are different
      expect(company2.id).not.toBe(company1.id);
    } catch (error) {
      // If error thrown, verify it's about duplicate ID
      expect(String(error)).toContain("already exists");
    }
  });

  it("retrieves a company by ID", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const created = manager.createCompany("Beta Inc");
    const retrieved = manager.getCompany(created.id);

    expect(retrieved).toEqual(created);
  });

  it("lists all companies", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    manager.createCompany("Company A");
    manager.createCompany("Company B");
    manager.createCompany("Company C");

    const companies = manager.listCompanies();
    expect(companies).toHaveLength(3);
  });

  it("filters companies by status", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = manager.createCompany("Company 1");
    const c2 = manager.createCompany("Company 2");
    manager.suspendCompany(c2.id);

    const active = manager.listCompanies("active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(c1.id);

    const suspended = manager.listCompanies("suspended");
    expect(suspended).toHaveLength(1);
    expect(suspended[0].id).toBe(c2.id);
  });

  it("updates company metadata", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Test Co");
    const updated = manager.updateCompany(company.id, {
      name: "Updated Name",
      metadata: { foo: "bar" },
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.metadata).toEqual({ foo: "bar" });
  });

  it("suspends a company", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Test Co");
    manager.suspendCompany(company.id);

    const retrieved = manager.getCompany(company.id);
    expect(retrieved?.status).toBe("suspended");
  });

  it("archives a company", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Test Co");
    manager.archiveCompany(company.id);

    const retrieved = manager.getCompany(company.id);
    expect(retrieved?.status).toBe("archived");
  });

  it("reactivates a suspended company", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Test Co");
    manager.suspendCompany(company.id);
    manager.reactivateCompany(company.id);

    const retrieved = manager.getCompany(company.id);
    expect(retrieved?.status).toBe("active");
  });

  it("deletes a company with confirmation", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Delete Me");
    manager.deleteCompany(company.id, "Delete Me");

    const retrieved = manager.getCompany(company.id);
    expect(retrieved).toBeUndefined();
  });

  it("prevents company deletion without confirmation", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Keep Me");

    expect(() => {
      manager.deleteCompany(company.id, "Wrong Name");
    }).toThrow();

    const retrieved = manager.getCompany(company.id);
    expect(retrieved).toBeDefined();
  });

  it("creates a cross-company policy", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = manager.createCompany("Company 1");
    const c2 = manager.createCompany("Company 2");

    const policy = manager.createPolicy(c1.id, c2.id, {
      accessType: "read",
      resourcePatterns: ["data/*"],
    });

    expect(policy.sourceCompanyId).toBe(c1.id);
    expect(policy.targetCompanyId).toBe(c2.id);
    expect(policy.accessType).toBe("read");
    expect(policy.enabled).toBe(true);
  });

  it("checks access by policy", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = manager.createCompany("Company 1");
    const c2 = manager.createCompany("Company 2");

    manager.createPolicy(c1.id, c2.id, {
      accessType: "read",
      resourcePatterns: ["data/*"],
    });

    const result = manager.isAccessAllowed(c1.id, c2.id, "read", "data/file.txt");
    expect(result.allowed).toBe(true);

    const denied = manager.isAccessAllowed(c1.id, c2.id, "write", "data/file.txt");
    expect(denied.allowed).toBe(false);
  });

  it("respects policy expiry", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = manager.createCompany("Company 1");
    const c2 = manager.createCompany("Company 2");

    manager.createPolicy(c1.id, c2.id, {
      accessType: "read",
      resourcePatterns: ["*"],
      expiresAt: Date.now() - 1000, // Expired
    });

    const result = manager.isAccessAllowed(c1.id, c2.id, "read", "anything");
    expect(result.allowed).toBe(false);
  });

  it("allows same-company access", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const company = manager.createCompany("Company 1");

    const result = manager.isAccessAllowed(company.id, company.id, "read", "anything");
    expect(result.allowed).toBe(true);
  });

  it("manages group admins", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    expect(manager.isGroupAdmin("admin1")).toBe(true);
    expect(manager.isGroupAdmin("admin2")).toBe(false);

    manager.addGroupAdmin("admin2");
    expect(manager.isGroupAdmin("admin2")).toBe(true);

    manager.removeGroupAdmin("admin2");
    expect(manager.isGroupAdmin("admin2")).toBe(false);
  });

  it("provides group statistics", () => {
    const dataDir = makeTempDir();
    const manager = new GroupManager({
      name: "Test Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = manager.createCompany("Company 1");
    const c2 = manager.createCompany("Company 2");
    manager.suspendCompany(c2.id);

    const stats = manager.getGroupStats();
    expect(stats.totalCompanies).toBe(2);
    expect(stats.activeCompanies).toBe(1);
    expect(stats.suspendedCompanies).toBe(1);
  });
});

// ============================================================================
// CompanyEnvironment Tests (13 tests)
// ============================================================================

describe("CompanyEnvironment", () => {
  it("creates a company environment", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: {
        maxAgents: 5,
        agentIds: ["agent1", "agent2"],
      },
    });

    expect(env.getCompanyId()).toBe("test-co");
    expect(env.getActiveAgentCount()).toBe(0);
  });

  it("activates agents within pool", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: {
        maxAgents: 2,
        agentIds: ["agent1", "agent2"],
      },
    });

    const result1 = env.activateAgent("agent1");
    expect(result1.success).toBe(true);

    const result2 = env.activateAgent("agent2");
    expect(result2.success).toBe(true);

    expect(env.getActiveAgentCount()).toBe(2);
  });

  it("enforces max concurrent agents", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: {
        maxAgents: 1,
        agentIds: ["agent1", "agent2"],
      },
    });

    env.activateAgent("agent1");
    const result = env.activateAgent("agent2");

    expect(result.success).toBe(false);
    expect(result.reason).toContain("Max concurrent");
  });

  it("prevents activation of non-pool agents", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: {
        maxAgents: 5,
        agentIds: ["agent1"],
      },
    });

    const result = env.activateAgent("agent2");
    expect(result.success).toBe(false);
    expect(result.reason).toContain("not in company pool");
  });

  it("deactivates agents", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: {
        maxAgents: 5,
        agentIds: ["agent1"],
      },
    });

    env.activateAgent("agent1");
    expect(env.getActiveAgentCount()).toBe(1);

    env.deactivateAgent("agent1");
    expect(env.getActiveAgentCount()).toBe(0);
  });

  it("provides environment variables", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
      region: "us",
      envVars: { CUSTOM_VAR: "value" },
    });

    const vars = env.getEnvironmentVars();
    expect(vars.COMPANY_ID).toBe("test-co");
    expect(vars.COMPANY_REGION).toBe("us");
    expect(vars.CUSTOM_VAR).toBe("value");
  });

  it("enforces network endpoint whitelist", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
      allowedEndpoints: ["api.example.com", "*.internal.com"],
    });

    expect(env.isEndpointAllowed("api.example.com")).toBe(true);
    expect(env.isEndpointAllowed("data.internal.com")).toBe(true);
    expect(env.isEndpointAllowed("evil.com")).toBe(false);
  });

  it("enforces data sovereignty", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
      region: "eu",
    });

    expect(env.canDataLeaveRegion("eu")).toBe(true);
    expect(env.canDataLeaveRegion("us")).toBe(false);
  });

  it("prevents path traversal", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
    });

    expect(() => {
      env.getSafePath("../../../etc/passwd");
    }).toThrow("Path traversal");
  });

  it("validates workspace paths", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
    });

    const workspace = env.getWorkspaceDir();
    expect(env.isPathInWorkspace(path.join(workspace, "file.txt"))).toBe(true);
    expect(env.isPathInWorkspace("/tmp/outside.txt")).toBe(false);
  });

  it("manages agent pool", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: ["agent1"] },
    });

    env.addAgentToPool("agent2");
    expect(env.isAgentInPool("agent2")).toBe(true);

    env.removeAgentFromPool("agent2");
    expect(env.isAgentInPool("agent2")).toBe(false);
  });

  it("cleans up temp files", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
    });

    const tempDir = env.getTempDir();
    const oldFile = path.join(tempDir, "old.txt");
    fs.writeFileSync(oldFile, "data");

    // Wait a moment to ensure file timestamp is in the past
    const fileStats = fs.statSync(oldFile);
    const fileAge = Date.now() - fileStats.mtimeMs;

    // Clean files older than a negative value (ensures cleanup)
    const cleaned = env.cleanupTempFiles(fileAge - 1);
    expect(cleaned).toBeGreaterThanOrEqual(1);
  });

  it("calculates disk usage", () => {
    const dataDir = makeTempDir();
    const env = new CompanyEnvironment({
      companyId: "test-co",
      dataDir,
      agentPool: { maxAgents: 5, agentIds: [] },
    });

    const workspace = env.getWorkspaceDir();
    fs.writeFileSync(path.join(workspace, "test.txt"), "hello");

    const usage = env.getDiskUsage();
    expect(usage.totalBytes).toBeGreaterThan(0);
    expect(usage.workspaceBytes).toBeGreaterThan(0);
  });
});

// ============================================================================
// SharedServiceRegistry Tests (12 tests)
// ============================================================================

describe("SharedServiceRegistry", () => {
  it("registers a shared service", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Legal Service",
      agentIds: ["legal-agent-1"],
      allowedCompanyIds: [],
      available: true,
      tier: "premium",
    });

    expect(service.name).toBe("Legal Service");
    expect(service.id).toBeDefined();
  });

  it("checks company access to service", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "HR Service",
      agentIds: ["hr-agent"],
      allowedCompanyIds: ["company1"],
      available: true,
      tier: "basic",
    });

    expect(registry.canCompanyUseService("company1", service.id)).toBe(true);
    expect(registry.canCompanyUseService("company2", service.id)).toBe(false);
  });

  it("allows all companies when allowlist is empty", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Public Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
    });

    expect(registry.canCompanyUseService("any-company", service.id)).toBe(true);
  });

  it("grants and revokes access", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Restricted Service",
      agentIds: ["agent1"],
      allowedCompanyIds: ["company1"],
      available: true,
      tier: "enterprise",
    });

    registry.grantAccess(service.id, "company2");
    expect(registry.canCompanyUseService("company2", service.id)).toBe(true);

    registry.revokeAccess(service.id, "company2");
    expect(registry.canCompanyUseService("company2", service.id)).toBe(false);
  });

  it("enforces service capacity limits", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Limited Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
      maxConcurrentRequests: 1,
    });

    const req1 = registry.acquireRequest(service.id, "company1");
    expect(req1.success).toBe(true);

    const req2 = registry.acquireRequest(service.id, "company2");
    expect(req2.success).toBe(false);
    expect(req2.reason).toContain("capacity");

    registry.releaseRequest(service.id);
    const req3 = registry.acquireRequest(service.id, "company2");
    expect(req3.success).toBe(true);
  });

  it("records service usage", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Billable Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "premium",
      costPerRequest: 5.0,
    });

    const record = registry.recordUsage(service.id, "company1", "agent-x", 1000);

    expect(record.cost).toBe(5.0);
    expect(record.companyId).toBe("company1");
    expect(record.durationMs).toBe(1000);
  });

  it("gets company usage statistics", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Test Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
      costPerRequest: 2.0,
    });

    registry.recordUsage(service.id, "company1", "agent1", 500);
    registry.recordUsage(service.id, "company1", "agent2", 300);

    const cost = registry.getCompanyCost("company1");
    expect(cost).toBe(4.0);
  });

  it("provides usage breakdown by service", () => {
    const registry = new SharedServiceRegistry();

    const s1 = registry.registerService({
      name: "Service 1",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
      costPerRequest: 1.0,
    });

    const s2 = registry.registerService({
      name: "Service 2",
      agentIds: ["agent2"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
      costPerRequest: 2.0,
    });

    registry.recordUsage(s1.id, "company1", "agent1", 100);
    registry.recordUsage(s2.id, "company1", "agent2", 200);

    const breakdown = registry.getCompanyUsageBreakdown("company1");
    expect(breakdown.size).toBe(2);
    expect(breakdown.get(s1.id)?.requestCount).toBe(1);
    expect(breakdown.get(s2.id)?.totalCost).toBe(2.0);
  });

  it("identifies most used services", () => {
    const registry = new SharedServiceRegistry();

    const s1 = registry.registerService({
      name: "Popular Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
    });

    const s2 = registry.registerService({
      name: "Unpopular Service",
      agentIds: ["agent2"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
    });

    registry.recordUsage(s1.id, "c1", "a1", 100);
    registry.recordUsage(s1.id, "c2", "a2", 100);
    registry.recordUsage(s2.id, "c1", "a1", 100);

    const mostUsed = registry.getMostUsedServices(1);
    expect(mostUsed[0].serviceId).toBe(s1.id);
    expect(mostUsed[0].requestCount).toBe(2);
  });

  it("clears old usage records", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Test Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
    });

    registry.recordUsage(service.id, "company1", "agent1", 100);

    const cleared = registry.clearOldUsageRecords(Date.now() + 1000);
    expect(cleared).toBe(1);
  });

  it("unregisters a service", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Temporary Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
    });

    registry.unregisterService(service.id);
    expect(registry.getService(service.id)).toBeUndefined();
  });

  it("updates service availability", () => {
    const registry = new SharedServiceRegistry();

    const service = registry.registerService({
      name: "Test Service",
      agentIds: ["agent1"],
      allowedCompanyIds: [],
      available: true,
      tier: "basic",
    });

    registry.setServiceAvailable(service.id, false);
    expect(registry.canCompanyUseService("company1", service.id)).toBe(false);
  });
});

// ============================================================================
// CrossCompanyBus Tests (14 tests)
// ============================================================================

describe("CrossCompanyBus", () => {
  it("sends a message between companies", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("company1", "company2", "request", { data: "hello" });

    expect(message.sourceCompanyId).toBe("company1");
    expect(message.targetCompanyId).toBe("company2");
    expect(message.status).toBe("pending");
  });

  it("prevents same-company messages", () => {
    const bus = new CrossCompanyBus();

    expect(() => {
      bus.sendMessage("company1", "company1", "request", {});
    }).toThrow("Cannot send message to same company");
  });

  it("creates messages requiring approval by default", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("c1", "c2", "request", {});

    expect(message.requiresApproval).toBe(true);
    expect(message.status).toBe("pending");
  });

  it("creates messages without approval when specified", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("c1", "c2", "notification", {}, { requiresApproval: false });

    expect(message.requiresApproval).toBe(false);
    expect(message.status).toBe("delivered");
  });

  it("lists pending approvals", () => {
    const bus = new CrossCompanyBus();

    bus.sendMessage("c1", "c2", "request", {});
    bus.sendMessage("c1", "c2", "request", {});

    const pending = bus.getPendingApprovals("c2");
    expect(pending).toHaveLength(2);
  });

  it("approves a message", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("c1", "c2", "request", {});
    const approved = bus.approveMessage(message.id, "approver1");

    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe("approver1");

    const pending = bus.getPendingApprovals("c2");
    expect(pending).toHaveLength(0);
  });

  it("rejects a message", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("c1", "c2", "request", {});
    const rejected = bus.rejectMessage(message.id, "rejecter1", "Not allowed");

    expect(rejected.status).toBe("rejected");
  });

  it("marks message as delivered", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("c1", "c2", "request", {});
    bus.approveMessage(message.id, "approver");
    const delivered = bus.markDelivered(message.id);

    expect(delivered.status).toBe("delivered");
  });

  it("prevents delivery without approval", () => {
    const bus = new CrossCompanyBus();

    const message = bus.sendMessage("c1", "c2", "request", {});

    expect(() => {
      bus.markDelivered(message.id);
    }).toThrow("requires approval");
  });

  it("sends responses to messages", () => {
    const bus = new CrossCompanyBus();

    const request = bus.sendMessage("c1", "c2", "request", { question: "test" });
    const response = bus.sendResponse(request.id, { answer: "result" });

    expect(response.type).toBe("response");
    expect(response.sourceCompanyId).toBe("c2");
    expect(response.targetCompanyId).toBe("c1");
    expect(response.replyToMessageId).toBe(request.id);
    expect(response.requiresApproval).toBe(false);
  });

  it("gets conversation threads", () => {
    const bus = new CrossCompanyBus();

    const msg1 = bus.sendMessage("c1", "c2", "request", {});
    const msg2 = bus.sendResponse(msg1.id, {});
    const msg3 = bus.sendResponse(msg2.id, {});

    const thread = bus.getConversationThread(msg1.id);
    expect(thread).toHaveLength(3);
  });

  it("provides company audit trail", () => {
    const bus = new CrossCompanyBus();

    const msg = bus.sendMessage("c1", "c2", "request", {});
    bus.approveMessage(msg.id, "approver");

    const trail = bus.getCompanyAuditTrail("c2");
    expect(trail.length).toBeGreaterThanOrEqual(2); // Created + approved
  });

  it("calculates company statistics", () => {
    const bus = new CrossCompanyBus();

    bus.sendMessage("c1", "c2", "request", {});
    bus.sendMessage("c1", "c2", "request", {});
    const m3 = bus.sendMessage("c3", "c2", "request", {});
    bus.rejectMessage(m3.id, "admin", "No");

    const stats = bus.getCompanyStats("c2");
    expect(stats.receivedCount).toBe(3);
    expect(stats.pendingApprovalCount).toBe(2);
    expect(stats.rejectedCount).toBe(1);
  });

  it("clears old messages", () => {
    const bus = new CrossCompanyBus();

    bus.sendMessage("c1", "c2", "request", {});

    const cleared = bus.clearOldMessages(Date.now() + 1000);
    expect(cleared).toBe(1);
  });
});

// ============================================================================
// ConsolidatedBilling Tests (13 tests)
// ============================================================================

describe("ConsolidatedBilling", () => {
  it("records billing costs", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    const record = billing.recordCost("company1", "compute", 10.5);

    expect(record.companyId).toBe("company1");
    expect(record.amount).toBe(10.5);
    expect(record.category).toBe("compute");
  });

  it("sets company budgets", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.setCompanyBudget({
      companyId: "company1",
      dailyBudget: 100,
      monthlyBudget: 2000,
      blockOnExceed: true,
      alertThreshold: 80,
    });

    const budget = billing.getCompanyBudget("company1");
    expect(budget?.dailyBudget).toBe(100);
  });

  it("checks budget status", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.setCompanyBudget({
      companyId: "company1",
      dailyBudget: 100,
      monthlyBudget: 2000,
      blockOnExceed: true,
      alertThreshold: 80,
    });

    billing.recordCost("company1", "compute", 50);

    const status = billing.checkBudgetStatus("company1");
    expect(status.dailySpent).toBe(50);
    expect(status.dailyPercentUsed).toBe(50);
    expect(status.isOverBudget).toBe(false);
  });

  it("enforces budget limits", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.setCompanyBudget({
      companyId: "company1",
      dailyBudget: 100,
      monthlyBudget: 2000,
      blockOnExceed: true,
      alertThreshold: 80,
    });

    billing.recordCost("company1", "compute", 100);

    const result = billing.canCompanySpend("company1", 10);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Daily budget");
  });

  it("allows spending when budget not set", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    const result = billing.canCompanySpend("company1", 1000000);
    expect(result.allowed).toBe(true);
  });

  it("calculates daily costs", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.recordCost("company1", "compute", 10);
    billing.recordCost("company1", "storage", 5);

    const daily = billing.getDailyCost("company1");
    expect(daily).toBe(15);
  });

  it("provides cost breakdown by category", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.recordCost("company1", "compute", 10);
    billing.recordCost("company1", "storage", 5);
    billing.recordCost("company1", "compute", 15);

    const breakdown = billing.getCostByCategory("company1");
    expect(breakdown.get("compute")).toBe(25);
    expect(breakdown.get("storage")).toBe(5);
  });

  it("generates group summary", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.setCompanyBudget({
      companyId: "company1",
      dailyBudget: 50,
      monthlyBudget: 1000,
      blockOnExceed: true,
      alertThreshold: 80,
    });

    billing.recordCost("company1", "compute", 60);

    const summary = billing.getGroupSummary();
    expect(summary.totalDailySpent).toBe(60);
    expect(summary.companiesOverBudget).toContain("company1");
  });

  it("allocates costs between companies", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.allocateCost("company1", "company2", 20, "Shared service");

    const c1Cost = billing.getDailyCost("company1");
    const c2Cost = billing.getDailyCost("company2");

    expect(c1Cost).toBe(-20); // Credit
    expect(c2Cost).toBe(20); // Charge
  });

  it("generates invoices", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    const start = Date.now() - 1000;
    billing.recordCost("company1", "compute", 10);
    billing.recordCost("company1", "storage", 5);
    const end = Date.now() + 1000;

    const invoice = billing.generateInvoice("company1", start, end);

    expect(invoice.totalAmount).toBe(15);
    expect(invoice.records).toHaveLength(2);
    expect(invoice.categoryBreakdown.get("compute")).toBe(10);
  });

  it("filters records by time range", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    const now = Date.now();
    billing.recordCost("company1", "compute", 10);

    const records = billing.getRecords("company1", now - 1000, now + 1000);
    expect(records).toHaveLength(1);

    const futureRecords = billing.getRecords("company1", now + 2000, now + 3000);
    expect(futureRecords).toHaveLength(0);
  });

  it("clears old billing records", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.recordCost("company1", "compute", 10);

    const cleared = billing.clearOldRecords(Date.now() + 1000);
    expect(cleared).toBe(1);
  });

  it("alerts on budget threshold", () => {
    const dataDir = makeTempDir();
    const billing = new ConsolidatedBilling(dataDir);

    billing.setCompanyBudget({
      companyId: "company1",
      dailyBudget: 100,
      monthlyBudget: 2000,
      blockOnExceed: false,
      alertThreshold: 80,
    });

    billing.recordCost("company1", "compute", 85);

    const status = billing.checkBudgetStatus("company1");
    expect(status.shouldAlert).toBe(true);
  });
});

// ============================================================================
// VersionManager Tests (15 tests)
// ============================================================================

describe("VersionManager", () => {
  it("creates version manager with default version", () => {
    const vm = new VersionManager("2024.1.0");
    expect(vm.getDefaultVersion()).toBe("2024.1.0");
  });

  it("gets company version (defaults to default)", () => {
    const vm = new VersionManager("2024.1.0");
    expect(vm.getCompanyVersion("company1")).toBe("2024.1.0");
  });

  it("pins company to specific version", () => {
    const vm = new VersionManager("2024.1.0");

    vm.pinCompanyVersion("company1", "2023.12.0", { reason: "Stability" });

    expect(vm.getCompanyVersion("company1")).toBe("2023.12.0");
    expect(vm.isCompanyPinned("company1")).toBe(true);
  });

  it("unpins company", () => {
    const vm = new VersionManager("2024.1.0");

    vm.pinCompanyVersion("company1", "2023.12.0");
    expect(vm.getCompanyVersion("company1")).toBe("2023.12.0");

    vm.unpinCompanyVersion("company1");
    expect(vm.getCompanyVersion("company1")).toBe("2024.1.0");
    expect(vm.isCompanyPinned("company1")).toBe(false);
  });

  it("lists all version pins", () => {
    const vm = new VersionManager("2024.1.0");

    vm.pinCompanyVersion("company1", "2023.12.0");
    vm.pinCompanyVersion("company2", "2024.2.0");

    const pins = vm.getAllPins();
    expect(pins).toHaveLength(2);
  });

  it("groups companies by version", () => {
    const vm = new VersionManager("2024.1.0");

    vm.pinCompanyVersion("company1", "2023.12.0");
    vm.pinCompanyVersion("company2", "2023.12.0");
    vm.pinCompanyVersion("company3", "2024.2.0");

    const byVersion = vm.getCompaniesByVersion();
    expect(byVersion.get("2023.12.0")).toHaveLength(2);
    expect(byVersion.get("2024.2.0")).toHaveLength(1);
  });

  it("creates a staged rollout", () => {
    const vm = new VersionManager("2024.1.0");

    const rollout = vm.createRollout("2024.2.0", [
      { name: "canary", companyIds: ["c1"] },
      { name: "wave1", companyIds: ["c2", "c3"] },
      { name: "wave2", companyIds: ["c4", "c5"] },
    ]);

    expect(rollout.targetVersion).toBe("2024.2.0");
    expect(rollout.stages).toHaveLength(3);
    expect(rollout.status).toBe("pending");
  });

  it("starts a rollout", () => {
    const vm = new VersionManager("2024.1.0");

    const rollout = vm.createRollout("2024.2.0", [
      { name: "stage1", companyIds: ["c1"] },
    ]);

    const started = vm.startRollout(rollout.id);

    expect(started.status).toBe("in_progress");
    expect(started.stages[0].status).toBe("in_progress");
  });

  it("completes rollout stages sequentially", () => {
    const vm = new VersionManager("2024.1.0");

    const rollout = vm.createRollout("2024.2.0", [
      { name: "stage1", companyIds: ["c1"] },
      { name: "stage2", companyIds: ["c2"] },
    ]);

    vm.startRollout(rollout.id);
    const afterStage1 = vm.completeRolloutStage(rollout.id, "stage1");

    expect(afterStage1.stages[0].status).toBe("completed");
    expect(afterStage1.stages[1].status).toBe("in_progress");
    expect(vm.getCompanyVersion("c1")).toBe("2024.2.0");

    const completed = vm.completeRolloutStage(rollout.id, "stage2");
    expect(completed.status).toBe("completed");
  });

  it("fails a rollout stage", () => {
    const vm = new VersionManager("2024.1.0");

    const rollout = vm.createRollout("2024.2.0", [
      { name: "stage1", companyIds: ["c1"] },
    ]);

    vm.startRollout(rollout.id);
    const failed = vm.failRolloutStage(rollout.id, "stage1", "High error rate");

    expect(failed.status).toBe("failed");
    expect(failed.stages[0].status).toBe("failed");
    expect(failed.stages[0].failureReason).toBe("High error rate");
  });

  it("pauses and resumes rollouts", () => {
    const vm = new VersionManager("2024.1.0");

    const rollout = vm.createRollout("2024.2.0", [
      { name: "stage1", companyIds: ["c1"] },
    ]);

    vm.startRollout(rollout.id);
    const paused = vm.pauseRollout(rollout.id);
    expect(paused.status).toBe("paused");

    const resumed = vm.resumeRollout(rollout.id);
    expect(resumed.status).toBe("in_progress");
  });

  it("rolls back a company", () => {
    const vm = new VersionManager("2024.1.0");

    vm.pinCompanyVersion("company1", "2024.2.0");
    expect(vm.getCompanyVersion("company1")).toBe("2024.2.0");

    vm.rollbackCompany("company1", "2024.1.0", "Bug detected");
    expect(vm.getCompanyVersion("company1")).toBe("2024.1.0");
  });

  it("creates canary deployments", () => {
    const vm = new VersionManager("2024.1.0");

    const canary = vm.createCanary("2024.2.0-beta", ["c1", "c2"], 3600000, true);

    expect(canary.version).toBe("2024.2.0-beta");
    expect(canary.canaryCompanyIds).toHaveLength(2);
    expect(canary.status).toBe("active");
    expect(canary.autoPromote).toBe(true);

    expect(vm.getCompanyVersion("c1")).toBe("2024.2.0-beta");
  });

  it("updates canary metrics", () => {
    const vm = new VersionManager("2024.1.0");

    const canary = vm.createCanary("2024.2.0-beta", ["c1"], 3600000);

    vm.updateCanaryMetrics(canary.id, {
      errorRate: 0.5,
      responseTime: 150,
      successRate: 99.5,
    });

    const updated = vm.getCanary(canary.id);
    expect(updated?.metrics?.errorRate).toBe(0.5);
    expect(updated?.metrics?.successRate).toBe(99.5);
  });

  it("passes a canary deployment", () => {
    const vm = new VersionManager("2024.1.0");

    const canary = vm.createCanary("2024.2.0-beta", ["c1"], 3600000);
    const passed = vm.passCanary(canary.id);

    expect(passed.status).toBe("passed");
  });

  it("fails a canary and rolls back", () => {
    const vm = new VersionManager("2024.1.0");

    const canary = vm.createCanary("2024.2.0-beta", ["c1"], 3600000);
    const failed = vm.failCanary(canary.id);

    expect(failed.status).toBe("failed");
    expect(vm.getCompanyVersion("c1")).toBe("2024.1.0"); // Rolled back
  });
});

// ============================================================================
// Integration Tests (5 tests)
// ============================================================================

describe("Integration: Full Group Workflow", () => {
  it("creates companies with environments and billing", () => {
    const dataDir = makeTempDir();
    const groupManager = new GroupManager({
      name: "Tech Group",
      adminIds: ["admin1"],
      dataDir: path.join(dataDir, "group"),
    });

    const company = groupManager.createCompany("Acme Corp", { region: "us" });

    const env = new CompanyEnvironment({
      companyId: company.id,
      dataDir: path.join(dataDir, "companies", company.id),
      agentPool: { maxAgents: 10, agentIds: ["agent1", "agent2"] },
      region: "us",
    });

    const billing = new ConsolidatedBilling(path.join(dataDir, "billing"));
    billing.recordCost(company.id, "compute", 50);

    expect(env.getCompanyId()).toBe(company.id);
    expect(billing.getDailyCost(company.id)).toBe(50);
  });

  it("manages cross-company communication with policies", () => {
    const dataDir = makeTempDir();
    const groupManager = new GroupManager({
      name: "Tech Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = groupManager.createCompany("Company A");
    const c2 = groupManager.createCompany("Company B");

    groupManager.createPolicy(c1.id, c2.id, {
      accessType: "read",
      resourcePatterns: ["reports/*"],
    });

    const bus = new CrossCompanyBus();
    const message = bus.sendMessage(c1.id, c2.id, "request", { file: "reports/q1.pdf" });

    expect(message.status).toBe("pending");

    const access = groupManager.isAccessAllowed(c1.id, c2.id, "read", "reports/q1.pdf");
    expect(access.allowed).toBe(true);

    bus.approveMessage(message.id, "admin");
    expect(bus.getMessage(message.id)?.status).toBe("approved");
  });

  it("tracks shared service usage and billing", () => {
    const dataDir = makeTempDir();
    const groupManager = new GroupManager({
      name: "Tech Group",
      adminIds: ["admin1"],
      dataDir: path.join(dataDir, "group"),
    });

    const c1 = groupManager.createCompany("Company A");
    const c2 = groupManager.createCompany("Company B");

    const registry = new SharedServiceRegistry();
    const service = registry.registerService({
      name: "Legal Service",
      agentIds: ["legal-agent"],
      allowedCompanyIds: [],
      available: true,
      tier: "premium",
      costPerRequest: 25.0,
    });

    registry.recordUsage(service.id, c1.id, "agent1", 5000);
    registry.recordUsage(service.id, c2.id, "agent2", 3000);

    const billing = new ConsolidatedBilling(path.join(dataDir, "billing"));

    // Set budgets for companies so they appear in the group summary
    billing.setCompanyBudget({
      companyId: c1.id,
      dailyBudget: 100,
      monthlyBudget: 2000,
      blockOnExceed: false,
      alertThreshold: 80,
    });

    billing.setCompanyBudget({
      companyId: c2.id,
      dailyBudget: 100,
      monthlyBudget: 2000,
      blockOnExceed: false,
      alertThreshold: 80,
    });

    billing.recordCost(c1.id, "shared-service", 25);
    billing.recordCost(c2.id, "shared-service", 25);

    const summary = billing.getGroupSummary();
    expect(summary.totalDailySpent).toBe(50);
  });

  it("manages version rollout across companies", () => {
    const dataDir = makeTempDir();
    const groupManager = new GroupManager({
      name: "Tech Group",
      adminIds: ["admin1"],
      dataDir,
    });

    const c1 = groupManager.createCompany("Company A");
    const c2 = groupManager.createCompany("Company B");
    const c3 = groupManager.createCompany("Company C");

    const vm = new VersionManager("2024.1.0");

    // Create canary with c1
    const canary = vm.createCanary("2024.2.0", [c1.id], 3600000);
    expect(vm.getCompanyVersion(c1.id)).toBe("2024.2.0");

    // Pass canary, start rollout
    vm.passCanary(canary.id);

    const rollout = vm.createRollout("2024.2.0", [
      { name: "wave1", companyIds: [c2.id] },
      { name: "wave2", companyIds: [c3.id] },
    ]);

    vm.startRollout(rollout.id);
    vm.completeRolloutStage(rollout.id, "wave1");

    expect(vm.getCompanyVersion(c2.id)).toBe("2024.2.0");
    expect(vm.getCompanyVersion(c3.id)).toBe("2024.1.0"); // Not yet rolled out
  });

  it("enforces data sovereignty and environment isolation", () => {
    const dataDir = makeTempDir();

    const envUS = new CompanyEnvironment({
      companyId: "us-company",
      dataDir: path.join(dataDir, "us"),
      agentPool: { maxAgents: 5, agentIds: ["agent1"] },
      region: "us",
    });

    const envEU = new CompanyEnvironment({
      companyId: "eu-company",
      dataDir: path.join(dataDir, "eu"),
      agentPool: { maxAgents: 5, agentIds: ["agent2"] },
      region: "eu",
    });

    expect(envUS.canDataLeaveRegion("us")).toBe(true);
    expect(envUS.canDataLeaveRegion("eu")).toBe(false);

    expect(envEU.canDataLeaveRegion("eu")).toBe(true);
    expect(envEU.canDataLeaveRegion("us")).toBe(false);

    // Verify workspace isolation
    expect(envUS.getWorkspaceDir()).not.toBe(envEU.getWorkspaceDir());
    expect(envUS.isPathInWorkspace(envEU.getWorkspaceDir())).toBe(false);
  });
});
