/**
 * Comprehensive tests for Corporate Pyramidal Hierarchy System
 * Tests all 6 modules with minimum 70 tests total.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  HierarchyManager,
  type AgentNode,
  type Delegation,
} from "./hierarchy-manager.js";
import {
  ApprovalWorkflow,
  type ApprovalRequest,
} from "./approval-workflow.js";
import {
  DepartmentIsolation,
  type DepartmentConfig,
  type CrossDepartmentRequest,
} from "./department-isolation.js";
import {
  ReportingPipeline,
  type GeneratedReport,
  type MetricDefinition,
} from "./reporting-pipeline.js";
import {
  SSOBridge,
  type ValidatedIdentity,
  type SAMLAssertion,
  type OIDCToken,
} from "./sso-bridge.js";
import {
  ComplianceExporter,
  type AuditLog,
  type EvidencePackage,
} from "./compliance-exporter.js";

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "corporate-test-"));
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
// HierarchyManager Tests (15 tests)
// ============================================================================

describe("HierarchyManager", () => {
  it("creates hierarchy manager and loads/saves state", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });
    expect(hm).toBeDefined();

    // File is created when first agent is added
    hm.addAgent({
      id: "test",
      name: "Test",
      level: 0,
      department: "Test",
      capabilities: [],
    });

    expect(fs.existsSync(path.join(dir, "hierarchy-nodes.json"))).toBe(true);
  });

  it("adds an agent to hierarchy", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    const ceo = hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: ["all"],
    });

    expect(ceo.id).toBe("ceo");
    expect(ceo.level).toBe(0);
    expect(ceo.reports).toEqual([]);
  });

  it("adds agent with manager and updates reporting chain", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: [],
    });

    const vp = hm.addAgent({
      id: "vp",
      name: "VP",
      level: 1,
      manager: "ceo",
      department: "Sales",
      capabilities: [],
    });

    expect(vp.manager).toBe("ceo");

    const ceo = hm.getAgent("ceo");
    expect(ceo?.reports).toContain("vp");
  });

  it("throws error if agent level exceeds max", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir, maxLevels: 5 });

    expect(() => {
      hm.addAgent({
        id: "deep",
        name: "Deep",
        level: 5,
        department: "Test",
        capabilities: [],
      });
    }).toThrow("exceeds max");
  });

  it("throws error if agent already exists", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "agent1",
      name: "Agent 1",
      level: 0,
      department: "Test",
      capabilities: [],
    });

    expect(() => {
      hm.addAgent({
        id: "agent1",
        name: "Agent 1 Duplicate",
        level: 1,
        department: "Test",
        capabilities: [],
      });
    }).toThrow("already exists");
  });

  it("throws error if manager does not exist", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    expect(() => {
      hm.addAgent({
        id: "orphan",
        name: "Orphan",
        level: 1,
        manager: "nonexistent",
        department: "Test",
        capabilities: [],
      });
    }).toThrow("does not exist");
  });

  it("throws error if manager level is not less than agent level", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "peer1",
      name: "Peer 1",
      level: 1,
      department: "Test",
      capabilities: [],
    });

    expect(() => {
      hm.addAgent({
        id: "peer2",
        name: "Peer 2",
        level: 1,
        manager: "peer1",
        department: "Test",
        capabilities: [],
      });
    }).toThrow("Manager level must be less than agent level");
  });

  it("removes agent and reassigns reports", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: [],
    });

    hm.addAgent({
      id: "vp",
      name: "VP",
      level: 1,
      manager: "ceo",
      department: "Sales",
      capabilities: [],
    });

    hm.addAgent({
      id: "manager",
      name: "Manager",
      level: 2,
      manager: "vp",
      department: "Sales",
      capabilities: [],
    });

    hm.removeAgent("vp");

    const manager = hm.getAgent("manager");
    expect(manager?.manager).toBe("ceo");

    const ceo = hm.getAgent("ceo");
    expect(ceo?.reports).toContain("manager");
    expect(ceo?.reports).not.toContain("vp");
  });

  it("throws error when removing top-level agent with reports", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: [],
    });

    hm.addAgent({
      id: "vp",
      name: "VP",
      level: 1,
      manager: "ceo",
      department: "Sales",
      capabilities: [],
    });

    expect(() => hm.removeAgent("ceo")).toThrow("Cannot remove top-level agent");
  });

  it("gets reporting chain from agent to CEO", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: [],
    });

    hm.addAgent({
      id: "vp",
      name: "VP",
      level: 1,
      manager: "ceo",
      department: "Sales",
      capabilities: [],
    });

    hm.addAgent({
      id: "manager",
      name: "Manager",
      level: 2,
      manager: "vp",
      department: "Sales",
      capabilities: [],
    });

    const chain = hm.getReportingChain("manager");
    expect(chain.agent).toBe("manager");
    expect(chain.chain).toEqual(["manager", "vp", "ceo"]);
  });

  it("gets direct reports", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: [],
    });

    hm.addAgent({
      id: "vp1",
      name: "VP 1",
      level: 1,
      manager: "ceo",
      department: "Sales",
      capabilities: [],
    });

    hm.addAgent({
      id: "vp2",
      name: "VP 2",
      level: 1,
      manager: "ceo",
      department: "Engineering",
      capabilities: [],
    });

    const reports = hm.getDirectReports("ceo");
    expect(reports.length).toBe(2);
    expect(reports.map((r) => r.id)).toContain("vp1");
    expect(reports.map((r) => r.id)).toContain("vp2");
  });

  it("gets all reports recursively", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: [],
    });

    hm.addAgent({
      id: "vp",
      name: "VP",
      level: 1,
      manager: "ceo",
      department: "Sales",
      capabilities: [],
    });

    hm.addAgent({
      id: "manager",
      name: "Manager",
      level: 2,
      manager: "vp",
      department: "Sales",
      capabilities: [],
    });

    const allReports = hm.getAllReports("ceo");
    expect(allReports.length).toBe(2);
    expect(allReports.map((r) => r.id)).toContain("vp");
    expect(allReports.map((r) => r.id)).toContain("manager");
  });

  it("delegates capability to another agent", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "admin",
      name: "Admin",
      level: 0,
      department: "IT",
      capabilities: ["deploy", "restart"],
    });

    hm.addAgent({
      id: "lead",
      name: "Lead",
      level: 1,
      manager: "admin",
      department: "IT",
      capabilities: [],
    });

    const delegation = hm.delegateCapability(
      "admin",
      "lead",
      "deploy",
      "department",
    );

    expect(delegation.capability).toBe("deploy");
    expect(delegation.delegatedTo).toBe("lead");
    expect(delegation.grantedBy).toBe("admin");

    const admin = hm.getAgent("admin");
    expect(admin?.delegations.length).toBe(1);
  });

  it("revokes delegation", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "admin",
      name: "Admin",
      level: 0,
      department: "IT",
      capabilities: ["deploy"],
    });

    hm.addAgent({
      id: "lead",
      name: "Lead",
      level: 1,
      manager: "admin",
      department: "IT",
      capabilities: [],
    });

    const delegation = hm.delegateCapability(
      "admin",
      "lead",
      "deploy",
      "department",
    );

    hm.revokeDelegation("admin", delegation.id);

    const admin = hm.getAgent("admin");
    expect(admin?.delegations.length).toBe(0);
  });

  it("checks if agent has capability directly or via delegation", () => {
    const dir = createTempDir();
    const hm = new HierarchyManager({ storageDir: dir });

    hm.addAgent({
      id: "admin",
      name: "Admin",
      level: 0,
      department: "IT",
      capabilities: ["deploy"],
    });

    hm.addAgent({
      id: "lead",
      name: "Lead",
      level: 1,
      manager: "admin",
      department: "IT",
      capabilities: ["restart"],
    });

    // Direct capability
    expect(hm.hasCapability("lead", "restart")).toBe(true);
    expect(hm.hasCapability("lead", "deploy")).toBe(false);

    // Via delegation
    hm.delegateCapability("admin", "lead", "deploy", "department");
    expect(hm.hasCapability("lead", "deploy")).toBe(true);
  });
});

// ============================================================================
// ApprovalWorkflow Tests (12 tests)
// ============================================================================

describe("ApprovalWorkflow", () => {
  it("creates approval workflow", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });
    expect(aw).toBeDefined();
  });

  it("creates approval request", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1", "admin1"],
      2,
    );

    expect(request.requester).toBe("worker1");
    expect(request.action).toBe("deploy");
    expect(request.status).toBe("pending");
    expect(request.approvalChain).toEqual(["lead1", "admin1"]);
    expect(request.requiredApprovals).toBe(2);
  });

  it("approves request", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
    );

    const approved = aw.approve(request.id, "lead1", "Looks good");

    expect(approved.status).toBe("approved");
    expect(approved.approvals.length).toBe(1);
    expect(approved.approvals[0].decision).toBe("approve");
    expect(approved.approvals[0].approver).toBe("lead1");
  });

  it("denies request", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
    );

    const denied = aw.deny(request.id, "lead1", "Too risky");

    expect(denied.status).toBe("denied");
    expect(denied.approvals.length).toBe(1);
    expect(denied.approvals[0].decision).toBe("deny");
  });

  it("throws error if wrong approver tries to approve", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1", "admin1"],
      2,
    );

    expect(() => aw.approve(request.id, "admin1")).toThrow("not the current approver");
  });

  it("requires multiple approvals", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1", "admin1"],
      2,
    );

    aw.approve(request.id, "lead1");
    const req = aw.getRequest(request.id);
    expect(req?.status).toBe("pending");

    aw.approve(request.id, "admin1");
    const approved = aw.getRequest(request.id);
    expect(approved?.status).toBe("approved");
  });

  it("escalates request", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
    );

    const escalated = aw.escalate(request.id, "admin1", "Urgent");

    expect(escalated.status).toBe("escalated");
    expect(escalated.escalatedTo).toBe("admin1");
    expect(escalated.approvalChain).toContain("admin1");
  });

  it("processes timeouts and auto-escalates", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir, defaultTimeout: 100 });

    aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1", "admin1"],
      1,
      undefined,
      10, // 10ms timeout
    );

    // Wait for timeout
    const start = Date.now();
    while (Date.now() - start < 50) {
      // Busy wait
    }

    const processed = aw.processTimeouts();
    expect(processed.length).toBe(1);
    expect(processed[0].status).toBe("escalated");
    expect(processed[0].currentApproverIndex).toBe(1);
  });

  it("marks request as timeout if no more approvers", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
      undefined,
      10,
    );

    // Wait for timeout
    const start = Date.now();
    while (Date.now() - start < 50) {
      // Busy wait
    }

    const processed = aw.processTimeouts();
    expect(processed.length).toBe(1);
    expect(processed[0].status).toBe("timeout");
  });

  it("gets pending requests for approver", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
    );

    aw.createRequest(
      "worker2",
      "restart",
      "Restart service",
      ["lead1"],
      1,
    );

    const pending = aw.getPendingRequests("lead1");
    expect(pending.length).toBe(2);
  });

  it("gets requests by requester", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
    );

    aw.createRequest(
      "worker1",
      "restart",
      "Restart service",
      ["lead1"],
      1,
    );

    const requests = aw.getRequestsByRequester("worker1");
    expect(requests.length).toBe(2);
  });

  it("gets audit trail for request", () => {
    const dir = createTempDir();
    const aw = new ApprovalWorkflow({ storageDir: dir });

    const request = aw.createRequest(
      "worker1",
      "deploy",
      "Deploy to production",
      ["lead1"],
      1,
    );

    aw.approve(request.id, "lead1", "LGTM");

    const trail = aw.getAuditTrail(request.id);
    expect(trail.length).toBe(2); // created + approved
    expect(trail[0].action).toBe("created");
    expect(trail[1].action).toBe("approved");
  });
});

// ============================================================================
// DepartmentIsolation Tests (13 tests)
// ============================================================================

describe("DepartmentIsolation", () => {
  it("creates department isolation", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });
    expect(di).toBeDefined();
  });

  it("creates department with isolated data path", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    const dept = di.createDepartment("Engineering", "eng-data");

    expect(dept.name).toBe("Engineering");
    expect(dept.agents).toEqual([]);
    expect(fs.existsSync(dept.dataPath)).toBe(true);
  });

  it("adds agent to department", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data");
    di.addAgentToDepartment("Engineering", "agent1");

    const dept = di.getDepartment("Engineering");
    expect(dept?.agents).toContain("agent1");
  });

  it("throws error if agent already in another department", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data");
    di.createDepartment("Sales", "sales-data");

    di.addAgentToDepartment("Engineering", "agent1");

    expect(() => {
      di.addAgentToDepartment("Sales", "agent1");
    }).toThrow("already in department");
  });

  it("removes agent from department", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data");
    di.addAgentToDepartment("Engineering", "agent1");
    di.removeAgentFromDepartment("Engineering", "agent1");

    const dept = di.getDepartment("Engineering");
    expect(dept?.agents).not.toContain("agent1");
  });

  it("checks if agent can read from department (same department)", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data");
    di.addAgentToDepartment("Engineering", "agent1");

    expect(di.canReadFrom("agent1", "Engineering")).toBe(true);
  });

  it("checks if agent can read from shared read zone", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data", ["HR"]);
    di.createDepartment("HR", "hr-data");

    di.addAgentToDepartment("Engineering", "agent1");

    expect(di.canReadFrom("agent1", "HR")).toBe(true);
  });

  it("checks if agent cannot read from non-shared department", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data");
    di.createDepartment("Finance", "finance-data");

    di.addAgentToDepartment("Engineering", "agent1");

    expect(di.canReadFrom("agent1", "Finance")).toBe(false);
  });

  it("creates cross-department request", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data", [], ["Finance"]);
    di.createDepartment("Finance", "finance-data");

    di.addAgentToDepartment("Engineering", "agent1");

    const request = di.createRequest("agent1", "Finance", "get_budget", { year: 2024 });

    expect(request.fromDepartment).toBe("Engineering");
    expect(request.toDepartment).toBe("Finance");
    expect(request.status).toBe("pending");
  });

  it("throws error if requesting from non-allowed department", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir, enforceIsolation: true });

    di.createDepartment("Engineering", "eng-data");
    di.createDepartment("Finance", "finance-data");

    di.addAgentToDepartment("Engineering", "agent1");

    expect(() => {
      di.createRequest("agent1", "Finance", "get_budget");
    }).toThrow("cannot request from");
  });

  it("approves cross-department request", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data", [], ["Finance"]);
    di.createDepartment("Finance", "finance-data");

    di.addAgentToDepartment("Engineering", "agent1");
    di.addAgentToDepartment("Finance", "agent2");

    const request = di.createRequest("agent1", "Finance", "get_budget");
    const approved = di.approveRequest(request.id, "agent2");

    expect(approved.status).toBe("approved");
    expect(approved.approvedBy).toBe("agent2");
  });

  it("denies cross-department request", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data", [], ["Finance"]);
    di.createDepartment("Finance", "finance-data");

    di.addAgentToDepartment("Engineering", "agent1");
    di.addAgentToDepartment("Finance", "agent2");

    const request = di.createRequest("agent1", "Finance", "get_budget");
    const denied = di.denyRequest(request.id, "agent2");

    expect(denied.status).toBe("denied");
  });

  it("executes cross-department request with response", () => {
    const dir = createTempDir();
    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng-data", [], ["Finance"]);
    di.createDepartment("Finance", "finance-data");

    di.addAgentToDepartment("Engineering", "agent1");
    di.addAgentToDepartment("Finance", "agent2");

    const request = di.createRequest("agent1", "Finance", "get_budget");
    di.approveRequest(request.id, "agent2");

    const executed = di.executeRequest(request.id, "agent2", { budget: 100000 });

    expect(executed.status).toBe("executed");
    expect(executed.response?.budget).toBe(100000);
  });
});

// ============================================================================
// ReportingPipeline Tests (12 tests)
// ============================================================================

describe("ReportingPipeline", () => {
  it("creates reporting pipeline", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });
    expect(rp).toBeDefined();
  });

  it("records metrics for agent", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.recordMetrics("agent1", { tasks_completed: 5, uptime_hours: 8 });

    const metrics = rp.getMetrics("agent1");
    expect(metrics.length).toBe(1);
    expect(metrics[0].metrics.tasks_completed).toBe(5);
  });

  it("registers report configuration", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    const config = rp.registerReport(
      "daily-summary",
      "daily",
      [
        {
          name: "tasks_completed",
          description: "Tasks completed",
          aggregation: "sum",
        },
      ],
      ["admin1"],
      ["agent1", "agent2"],
    );

    expect(config.frequency).toBe("daily");
    expect(config.metrics.length).toBe(1);
  });

  it("generates markdown report", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "daily-summary",
      "daily",
      [
        {
          name: "tasks_completed",
          description: "Tasks completed",
          aggregation: "sum",
          unit: "tasks",
        },
      ],
      ["admin1"],
      ["agent1", "agent2"],
      "markdown",
    );

    rp.recordMetrics("agent1", { tasks_completed: 5 });
    rp.recordMetrics("agent2", { tasks_completed: 3 });

    const report = rp.generateReport("daily-summary");

    expect(report.content).toContain("Daily Report");
    expect(report.content).toContain("tasks_completed");
    expect(report.metrics.agent1.tasks_completed).toBe(5);
    expect(report.metrics.agent2.tasks_completed).toBe(3);
  });

  it("generates JSON report", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "daily-summary",
      "daily",
      [
        {
          name: "tasks_completed",
          description: "Tasks completed",
          aggregation: "sum",
        },
      ],
      ["admin1"],
      ["agent1"],
      "json",
    );

    rp.recordMetrics("agent1", { tasks_completed: 5 });

    const report = rp.generateReport("daily-summary");
    const parsed = JSON.parse(report.content);

    expect(parsed.aggregated.agent1.tasks_completed).toBe(5);
  });

  it("aggregates metrics with sum", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "test",
      "daily",
      [{ name: "value", description: "Value", aggregation: "sum" }],
      [],
      ["agent1"],
    );

    rp.recordMetrics("agent1", { value: 10 });
    rp.recordMetrics("agent1", { value: 20 });
    rp.recordMetrics("agent1", { value: 30 });

    const report = rp.generateReport("test");
    expect(report.metrics.agent1.value).toBe(60);
  });

  it("aggregates metrics with avg", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "test",
      "daily",
      [{ name: "value", description: "Value", aggregation: "avg" }],
      [],
      ["agent1"],
    );

    rp.recordMetrics("agent1", { value: 10 });
    rp.recordMetrics("agent1", { value: 20 });
    rp.recordMetrics("agent1", { value: 30 });

    const report = rp.generateReport("test");
    expect(report.metrics.agent1.value).toBe(20);
  });

  it("aggregates metrics with count", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "test",
      "daily",
      [{ name: "value", description: "Value", aggregation: "count" }],
      [],
      ["agent1"],
    );

    rp.recordMetrics("agent1", { value: 10 });
    rp.recordMetrics("agent1", { value: 20 });

    const report = rp.generateReport("test");
    expect(report.metrics.agent1.value).toBe(2);
  });

  it("aggregates metrics with max", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "test",
      "daily",
      [{ name: "value", description: "Value", aggregation: "max" }],
      [],
      ["agent1"],
    );

    rp.recordMetrics("agent1", { value: 10 });
    rp.recordMetrics("agent1", { value: 30 });
    rp.recordMetrics("agent1", { value: 20 });

    const report = rp.generateReport("test");
    expect(report.metrics.agent1.value).toBe(30);
  });

  it("aggregates metrics with min", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "test",
      "daily",
      [{ name: "value", description: "Value", aggregation: "min" }],
      [],
      ["agent1"],
    );

    rp.recordMetrics("agent1", { value: 30 });
    rp.recordMetrics("agent1", { value: 10 });
    rp.recordMetrics("agent1", { value: 20 });

    const report = rp.generateReport("test");
    expect(report.metrics.agent1.value).toBe(10);
  });

  it("saves report to disk", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.registerReport(
      "test",
      "daily",
      [{ name: "value", description: "Value", aggregation: "sum" }],
      [],
      ["agent1"],
    );

    rp.recordMetrics("agent1", { value: 5 });
    const report = rp.generateReport("test");

    const reportsDir = path.join(dir, "reports");
    const reportFile = path.join(reportsDir, `${report.id}.md`);

    expect(fs.existsSync(reportFile)).toBe(true);
  });

  it("cleans up old metrics", () => {
    const dir = createTempDir();
    const rp = new ReportingPipeline({ storageDir: dir });

    rp.recordMetrics("agent1", { value: 5 });

    const futureTime = Date.now() + 10000;
    const deleted = rp.cleanupOldMetrics(futureTime);

    expect(deleted).toBe(1);
    expect(rp.getMetrics("agent1").length).toBe(0);
  });
});

// ============================================================================
// SSOBridge Tests (10 tests)
// ============================================================================

describe("SSOBridge", () => {
  it("creates SSO bridge", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [],
    });
    expect(sso).toBeDefined();
  });

  it("validates SAML assertion", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [
        { idpRole: "admin", hierarchyLevel: 0, capabilities: ["all"] },
      ],
    });

    const assertion = SSOBridge.createMockSAML("user1", ["admin"]);
    const identity = sso.validateSAML(assertion);

    expect(identity.userId).toBe("user1");
    expect(identity.hierarchyLevel).toBe(0);
    expect(identity.capabilities).toContain("all");
  });

  it("validates OIDC token", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      oidcIssuer: "mock-issuer",
      oidcAudience: "openclaw",
      roleMappings: [
        { idpRole: "developer", hierarchyLevel: 2, capabilities: ["deploy"] },
      ],
    });

    const token = SSOBridge.createMockOIDC("user2", ["developer"]);
    const identity = sso.validateOIDC(token);

    expect(identity.userId).toBe("user2");
    expect(identity.hierarchyLevel).toBe(2);
    expect(identity.capabilities).toContain("deploy");
  });

  it("throws error for expired SAML assertion", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [],
    });

    const assertion = SSOBridge.createMockSAML("user1", ["admin"], -1000);

    expect(() => sso.validateSAML(assertion)).toThrow("expired");
  });

  it("throws error for expired OIDC token", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      oidcIssuer: "mock-issuer",
      roleMappings: [],
    });

    const token = SSOBridge.createMockOIDC("user1", ["admin"], -1);

    expect(() => sso.validateOIDC(token)).toThrow("expired");
  });

  it("maps multiple roles to highest privilege", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [
        { idpRole: "admin", hierarchyLevel: 0 },
        { idpRole: "developer", hierarchyLevel: 2 },
      ],
    });

    const assertion = SSOBridge.createMockSAML("user1", ["admin", "developer"]);
    const identity = sso.validateSAML(assertion);

    // Level 0 is higher privilege than level 2
    expect(identity.hierarchyLevel).toBe(0);
  });

  it("uses default level if no role matches", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [{ idpRole: "admin", hierarchyLevel: 0 }],
      defaultLevel: 2,
    });

    const assertion = SSOBridge.createMockSAML("user1", ["unknown-role"]);
    const identity = sso.validateSAML(assertion);

    expect(identity.hierarchyLevel).toBe(2);
  });

  it("gets session by user ID", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [{ idpRole: "admin", hierarchyLevel: 0 }],
    });

    const assertion = SSOBridge.createMockSAML("user1", ["admin"]);
    sso.validateSAML(assertion);

    const session = sso.getSession("user1");
    expect(session?.userId).toBe("user1");
  });

  it("revokes session", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [{ idpRole: "admin", hierarchyLevel: 0 }],
    });

    const assertion = SSOBridge.createMockSAML("user1", ["admin"]);
    sso.validateSAML(assertion);

    sso.revokeSession("user1");

    const session = sso.getSession("user1");
    expect(session).toBeUndefined();
  });

  it("cleans up expired sessions", () => {
    const dir = createTempDir();
    const sso = new SSOBridge({
      storageDir: dir,
      roleMappings: [{ idpRole: "admin", hierarchyLevel: 0 }],
    });

    const assertion = SSOBridge.createMockSAML("user1", ["admin"], 50);
    sso.validateSAML(assertion);

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 100) {
      // Busy wait
    }

    const cleaned = sso.cleanupExpiredSessions();
    expect(cleaned).toBe(1);
  });
});

// ============================================================================
// ComplianceExporter Tests (13 tests)
// ============================================================================

describe("ComplianceExporter", () => {
  it("creates compliance exporter", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir });
    expect(ce).toBeDefined();
  });

  it("logs audit event", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir });

    ce.logAudit({
      actor: "agent1",
      action: "login",
      status: "success",
      ipAddress: "192.168.1.1",
    });

    const logs = ce.getAuditLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].action).toBe("login");
  });

  it("saves audit log to JSONL file", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir });

    ce.logAudit({
      actor: "agent1",
      action: "login",
      status: "success",
    });

    const date = new Date().toISOString().split("T")[0];
    const logFile = path.join(dir, "audit-logs", `audit-${date}.jsonl`);

    expect(fs.existsSync(logFile)).toBe(true);
  });

  it("registers custom compliance control", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: [] });

    ce.registerControl({
      id: "CUSTOM-1",
      framework: "iso27001",
      title: "Custom Control",
      description: "Custom control description",
      category: "Security",
      evidenceQuery: { type: "audit_log" },
    });

    const control = ce.getControl("CUSTOM-1");
    expect(control?.title).toBe("Custom Control");
  });

  it("generates evidence package for SOC 2", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: ["soc2"] });

    ce.logAudit({ actor: "agent1", action: "login", status: "success" });
    ce.logAudit({ actor: "agent2", action: "access_data", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    const pkg = ce.generateEvidencePackage("soc2", startTime, endTime);

    expect(pkg.framework).toBe("soc2");
    expect(pkg.controls.length).toBeGreaterThan(0);
    expect(pkg.evidence).toBeDefined();
  });

  it("generates evidence package for HIPAA", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: ["hipaa"] });

    ce.logAudit({ actor: "agent1", action: "access_phi", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    const pkg = ce.generateEvidencePackage("hipaa", startTime, endTime);

    expect(pkg.framework).toBe("hipaa");
    expect(pkg.controls.length).toBeGreaterThan(0);
  });

  it("generates evidence with count aggregation", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: ["soc2"] });

    ce.logAudit({ actor: "agent1", action: "login", status: "success" });
    ce.logAudit({ actor: "agent2", action: "login", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    const pkg = ce.generateEvidencePackage("soc2", startTime, endTime, ["CC6.1"]);
    const evidence = pkg.evidence["CC6.1"] as {
      data: { count: number };
    };

    expect(evidence.data.count).toBeGreaterThan(0);
  });

  it("exports HIPAA audit logs", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir });

    ce.logAudit({ actor: "agent1", action: "access_phi", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    const report = ce.exportHIPAALogs(startTime, endTime);

    expect(report).toContain("HIPAA Audit Log Export");
    expect(report).toContain("access_phi");
  });

  it("exports SOC 2 summary", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: ["soc2"] });

    ce.logAudit({ actor: "agent1", action: "login", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    const report = ce.exportSOC2Summary(startTime, endTime);

    expect(report).toContain("SOC 2 Type II Evidence Summary");
    expect(report).toContain("CC6.1");
  });

  it("gets audit logs by actor", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir });

    ce.logAudit({ actor: "agent1", action: "login", status: "success" });
    ce.logAudit({ actor: "agent2", action: "logout", status: "success" });
    ce.logAudit({ actor: "agent1", action: "access_data", status: "success" });

    const logs = ce.getAuditLogsByActor("agent1");
    expect(logs.length).toBe(2);
    expect(logs.every((l) => l.actor === "agent1")).toBe(true);
  });

  it("gets controls by framework", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({
      storageDir: dir,
      frameworks: ["soc2", "hipaa"],
    });

    const soc2Controls = ce.getControls("soc2");
    const hipaaControls = ce.getControls("hipaa");

    expect(soc2Controls.every((c) => c.framework === "soc2")).toBe(true);
    expect(hipaaControls.every((c) => c.framework === "hipaa")).toBe(true);
  });

  it("lists evidence packages", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: ["soc2"] });

    ce.logAudit({ actor: "agent1", action: "login", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    ce.generateEvidencePackage("soc2", startTime, endTime);

    const packages = ce.getEvidencePackages();
    expect(packages.length).toBeGreaterThan(0);
    expect(packages[0]).toContain("evidence-soc2");
  });

  it("reads evidence package from disk", () => {
    const dir = createTempDir();
    const ce = new ComplianceExporter({ storageDir: dir, frameworks: ["soc2"] });

    ce.logAudit({ actor: "agent1", action: "login", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    const pkg = ce.generateEvidencePackage("soc2", startTime, endTime);
    const packages = ce.getEvidencePackages();

    const loaded = ce.readEvidencePackage(packages[0]);
    expect(loaded.id).toBe(pkg.id);
    expect(loaded.framework).toBe("soc2");
  });
});

// ============================================================================
// Integration Tests (5 tests)
// ============================================================================

describe("Integration Tests", () => {
  it("full workflow: hierarchy + approval + department + reporting", () => {
    const dir = createTempDir();

    // Setup hierarchy
    const hm = new HierarchyManager({ storageDir: path.join(dir, "hierarchy") });
    hm.addAgent({
      id: "admin",
      name: "Admin",
      level: 0,
      department: "IT",
      capabilities: ["deploy"],
    });

    hm.addAgent({
      id: "lead",
      name: "Lead",
      level: 1,
      manager: "admin",
      department: "IT",
      capabilities: [],
    });

    hm.addAgent({
      id: "worker",
      name: "Worker",
      level: 2,
      manager: "lead",
      department: "IT",
      capabilities: [],
    });

    // Setup departments
    const di = new DepartmentIsolation({ storageDir: path.join(dir, "departments") });
    di.createDepartment("IT", "it-data");
    di.addAgentToDepartment("IT", "admin");
    di.addAgentToDepartment("IT", "lead");
    di.addAgentToDepartment("IT", "worker");

    // Create approval request
    const aw = new ApprovalWorkflow({ storageDir: path.join(dir, "approvals") });
    const request = aw.createRequest(
      "worker",
      "deploy",
      "Deploy to production",
      ["lead", "admin"],
      2,
    );

    // Approve
    aw.approve(request.id, "lead");
    aw.approve(request.id, "admin");

    const approved = aw.getRequest(request.id);
    expect(approved?.status).toBe("approved");

    // Record metrics
    const rp = new ReportingPipeline({ storageDir: path.join(dir, "reports") });
    rp.recordMetrics("worker", { deployments: 1 });
    rp.recordMetrics("lead", { approvals: 1 });
    rp.recordMetrics("admin", { approvals: 1 });

    rp.registerReport(
      "deployment-report",
      "daily",
      [
        { name: "deployments", description: "Deployments", aggregation: "sum" },
        { name: "approvals", description: "Approvals", aggregation: "sum" },
      ],
      ["admin"],
      ["worker", "lead", "admin"],
    );

    const report = rp.generateReport("deployment-report");
    expect(report.metrics.worker.deployments).toBe(1);
    expect(report.metrics.lead.approvals).toBe(1);
  });

  it("SSO + hierarchy mapping", () => {
    const dir = createTempDir();

    const sso = new SSOBridge({
      storageDir: path.join(dir, "sso"),
      roleMappings: [
        { idpRole: "ceo", hierarchyLevel: 0, department: "Executive" },
        { idpRole: "manager", hierarchyLevel: 1, department: "Sales" },
        { idpRole: "employee", hierarchyLevel: 2, department: "Sales" },
      ],
    });

    const assertion = SSOBridge.createMockSAML("john.doe", ["manager"]);
    const identity = sso.validateSAML(assertion);

    expect(identity.hierarchyLevel).toBe(1);
    expect(identity.department).toBe("Sales");
  });

  it("compliance + audit trail", () => {
    const dir = createTempDir();

    const ce = new ComplianceExporter({
      storageDir: dir,
      frameworks: ["soc2", "hipaa"],
    });

    // Simulate audit events
    ce.logAudit({ actor: "admin", action: "login", status: "success" });
    ce.logAudit({ actor: "user1", action: "access_phi", status: "success" });
    ce.logAudit({ actor: "user2", action: "access_data", status: "success" });

    const startTime = Date.now() - 10000;
    const endTime = Date.now();

    // Generate evidence
    const soc2Pkg = ce.generateEvidencePackage("soc2", startTime, endTime);
    const hipaaPkg = ce.generateEvidencePackage("hipaa", startTime, endTime);

    expect(soc2Pkg.framework).toBe("soc2");
    expect(hipaaPkg.framework).toBe("hipaa");
  });

  it("department isolation + cross-department request", () => {
    const dir = createTempDir();

    const di = new DepartmentIsolation({ storageDir: dir });

    di.createDepartment("Engineering", "eng", [], ["Finance"]);
    di.createDepartment("Finance", "fin", ["Engineering"], []);

    di.addAgentToDepartment("Engineering", "eng1");
    di.addAgentToDepartment("Finance", "fin1");

    // Engineering can request from Finance
    const request = di.createRequest("eng1", "Finance", "get_budget");
    di.approveRequest(request.id, "fin1");
    di.executeRequest(request.id, "fin1", { budget: 500000 });

    const executed = di.getRequest(request.id);
    expect(executed?.status).toBe("executed");
    expect(executed?.response?.budget).toBe(500000);

    // Finance can read from Engineering (shared read zone)
    expect(di.canReadFrom("fin1", "Engineering")).toBe(true);
  });

  it("full corporate hierarchy with all modules", () => {
    const dir = createTempDir();

    // 1. Setup hierarchy
    const hm = new HierarchyManager({ storageDir: path.join(dir, "hierarchy") });
    hm.addAgent({
      id: "ceo",
      name: "CEO",
      level: 0,
      department: "Executive",
      capabilities: ["all"],
    });

    hm.addAgent({
      id: "cto",
      name: "CTO",
      level: 1,
      manager: "ceo",
      department: "Engineering",
      capabilities: ["tech"],
    });

    hm.addAgent({
      id: "dev-lead",
      name: "Dev Lead",
      level: 2,
      manager: "cto",
      department: "Engineering",
      capabilities: ["deploy"],
    });

    // 2. Setup departments
    const di = new DepartmentIsolation({ storageDir: path.join(dir, "departments") });
    di.createDepartment("Executive", "exec");
    di.createDepartment("Engineering", "eng", ["Executive"]);

    di.addAgentToDepartment("Executive", "ceo");
    di.addAgentToDepartment("Engineering", "cto");
    di.addAgentToDepartment("Engineering", "dev-lead");

    // 3. SSO authentication
    const sso = new SSOBridge({
      storageDir: path.join(dir, "sso"),
      roleMappings: [
        { idpRole: "exec", hierarchyLevel: 0 },
        { idpRole: "tech-lead", hierarchyLevel: 1 },
      ],
    });

    const token = SSOBridge.createMockOIDC("cto@example.com", ["tech-lead"]);
    const identity = sso.validateOIDC(token);
    expect(identity.hierarchyLevel).toBe(1);

    // 4. Approval workflow
    const aw = new ApprovalWorkflow({ storageDir: path.join(dir, "approvals") });
    const request = aw.createRequest(
      "dev-lead",
      "deploy-prod",
      "Deploy to production",
      ["cto", "ceo"],
      2,
    );

    aw.approve(request.id, "cto");
    aw.approve(request.id, "ceo");

    // 5. Record metrics
    const rp = new ReportingPipeline({ storageDir: path.join(dir, "reports") });
    rp.recordMetrics("dev-lead", { deploys: 1 });
    rp.recordMetrics("cto", { reviews: 1 });

    // 6. Compliance audit
    const ce = new ComplianceExporter({
      storageDir: path.join(dir, "compliance"),
      frameworks: ["soc2"],
    });

    ce.logAudit({ actor: "cto", action: "approve_deploy", status: "success" });
    ce.logAudit({ actor: "ceo", action: "approve_deploy", status: "success" });

    const pkg = ce.generateEvidencePackage("soc2", Date.now() - 10000, Date.now());
    expect(pkg.controls.length).toBeGreaterThan(0);

    // Verify full chain
    const chain = hm.getReportingChain("dev-lead");
    expect(chain.chain).toEqual(["dev-lead", "cto", "ceo"]);

    expect(di.canReadFrom("cto", "Executive")).toBe(true);
  });
});
