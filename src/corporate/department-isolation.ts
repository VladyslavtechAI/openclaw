/**
 * Corporate Department Isolation
 * Data boundaries between departments, shared-read zones, cross-department request protocol.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export interface DepartmentConfig {
  name: string;
  agents: string[]; // Agent IDs in this department
  dataPath: string; // Isolated data directory
  sharedReadZones: string[]; // Departments this can read from
  allowedOutbound: string[]; // Departments this can send requests to
}

export interface CrossDepartmentRequest {
  id: string;
  fromDepartment: string;
  toDepartment: string;
  fromAgent: string;
  toAgent?: string; // Specific agent or any in department
  action: string;
  data?: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "executed";
  approvedBy?: string;
  createdAt: number;
  updatedAt: number;
  response?: Record<string, unknown>;
}

export interface DepartmentIsolationConfig {
  storageDir: string;
  enforceIsolation?: boolean; // Default true
}

export class DepartmentIsolation {
  private readonly storageDir: string;
  private readonly departmentsFile: string;
  private readonly requestsFile: string;
  private readonly enforceIsolation: boolean;
  private departments: Map<string, DepartmentConfig> = new Map();
  private requests: Map<string, CrossDepartmentRequest> = new Map();

  constructor(config: DepartmentIsolationConfig) {
    this.storageDir = config.storageDir;
    this.departmentsFile = path.join(this.storageDir, "departments.json");
    this.requestsFile = path.join(this.storageDir, "cross-dept-requests.json");
    this.enforceIsolation = config.enforceIsolation ?? true;

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.departmentsFile)) {
      const data = JSON.parse(fs.readFileSync(this.departmentsFile, "utf8"));
      this.departments = new Map(Object.entries(data));
    }

    if (fs.existsSync(this.requestsFile)) {
      const data = JSON.parse(fs.readFileSync(this.requestsFile, "utf8"));
      this.requests = new Map(Object.entries(data));
    }
  }

  private save(): void {
    const deptsData = Object.fromEntries(this.departments);
    fs.writeFileSync(this.departmentsFile, JSON.stringify(deptsData, null, 2), "utf8");

    const reqsData = Object.fromEntries(this.requests);
    fs.writeFileSync(this.requestsFile, JSON.stringify(reqsData, null, 2), "utf8");
  }

  /**
   * Create a new department.
   */
  createDepartment(
    name: string,
    dataPath: string,
    sharedReadZones?: string[],
    allowedOutbound?: string[],
  ): DepartmentConfig {
    if (this.departments.has(name)) {
      throw new Error(`Department ${name} already exists`);
    }

    // Create isolated data directory
    const fullPath = path.join(this.storageDir, dataPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true, mode: 0o700 });
    }

    const dept: DepartmentConfig = {
      name,
      agents: [],
      dataPath: fullPath,
      sharedReadZones: sharedReadZones ?? [],
      allowedOutbound: allowedOutbound ?? [],
    };

    this.departments.set(name, dept);
    this.save();
    return dept;
  }

  /**
   * Add an agent to a department.
   */
  addAgentToDepartment(department: string, agentId: string): void {
    const dept = this.departments.get(department);
    if (!dept) {
      throw new Error(`Department ${department} not found`);
    }

    if (dept.agents.includes(agentId)) {
      throw new Error(`Agent ${agentId} already in department ${department}`);
    }

    // Check if agent is in another department
    for (const [name, d] of this.departments.entries()) {
      if (d.agents.includes(agentId)) {
        throw new Error(`Agent ${agentId} already in department ${name}`);
      }
    }

    dept.agents.push(agentId);
    this.save();
  }

  /**
   * Remove an agent from a department.
   */
  removeAgentFromDepartment(department: string, agentId: string): void {
    const dept = this.departments.get(department);
    if (!dept) {
      throw new Error(`Department ${department} not found`);
    }

    dept.agents = dept.agents.filter((id) => id !== agentId);
    this.save();
  }

  /**
   * Check if an agent can read data from a department.
   */
  canReadFrom(agentId: string, targetDepartment: string): boolean {
    const agentDept = this.getAgentDepartment(agentId);
    if (!agentDept) {
      return false;
    }

    // Can always read from own department
    if (agentDept === targetDepartment) {
      return true;
    }

    // Check shared read zones
    const dept = this.departments.get(agentDept);
    if (!dept) {
      return false;
    }

    return dept.sharedReadZones.includes(targetDepartment);
  }

  /**
   * Check if an agent can send a request to a department.
   */
  canRequestFrom(agentId: string, targetDepartment: string): boolean {
    const agentDept = this.getAgentDepartment(agentId);
    if (!agentDept) {
      return false;
    }

    // Can always request within own department
    if (agentDept === targetDepartment) {
      return true;
    }

    const dept = this.departments.get(agentDept);
    if (!dept) {
      return false;
    }

    return dept.allowedOutbound.includes(targetDepartment);
  }

  /**
   * Create a cross-department request.
   */
  createRequest(
    fromAgent: string,
    toDepartment: string,
    action: string,
    data?: Record<string, unknown>,
    toAgent?: string,
  ): CrossDepartmentRequest {
    const fromDept = this.getAgentDepartment(fromAgent);
    if (!fromDept) {
      throw new Error(`Agent ${fromAgent} not in any department`);
    }

    if (this.enforceIsolation && !this.canRequestFrom(fromAgent, toDepartment)) {
      throw new Error(
        `Agent ${fromAgent} in ${fromDept} cannot request from ${toDepartment}`,
      );
    }

    const now = Date.now();
    const request: CrossDepartmentRequest = {
      id: crypto.randomUUID(),
      fromDepartment: fromDept,
      toDepartment,
      fromAgent,
      toAgent,
      action,
      data,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.requests.set(request.id, request);
    this.save();
    return request;
  }

  /**
   * Approve a cross-department request.
   */
  approveRequest(requestId: string, approver: string): CrossDepartmentRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Request ${requestId} is not pending`);
    }

    // Verify approver is in target department
    const approverDept = this.getAgentDepartment(approver);
    if (approverDept !== request.toDepartment) {
      throw new Error(
        `Approver ${approver} is not in target department ${request.toDepartment}`,
      );
    }

    request.status = "approved";
    request.approvedBy = approver;
    request.updatedAt = Date.now();

    this.save();
    return request;
  }

  /**
   * Deny a cross-department request.
   */
  denyRequest(requestId: string, denier: string): CrossDepartmentRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status !== "pending") {
      throw new Error(`Request ${requestId} is not pending`);
    }

    const denierDept = this.getAgentDepartment(denier);
    if (denierDept !== request.toDepartment) {
      throw new Error(
        `Denier ${denier} is not in target department ${request.toDepartment}`,
      );
    }

    request.status = "denied";
    request.updatedAt = Date.now();

    this.save();
    return request;
  }

  /**
   * Execute a cross-department request (store response).
   */
  executeRequest(
    requestId: string,
    executor: string,
    response: Record<string, unknown>,
  ): CrossDepartmentRequest {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status !== "approved") {
      throw new Error(`Request ${requestId} is not approved`);
    }

    const executorDept = this.getAgentDepartment(executor);
    if (executorDept !== request.toDepartment) {
      throw new Error(
        `Executor ${executor} is not in target department ${request.toDepartment}`,
      );
    }

    request.status = "executed";
    request.response = response;
    request.updatedAt = Date.now();

    this.save();
    return request;
  }

  /**
   * Get the department an agent belongs to.
   */
  getAgentDepartment(agentId: string): string | undefined {
    for (const [name, dept] of this.departments.entries()) {
      if (dept.agents.includes(agentId)) {
        return name;
      }
    }
    return undefined;
  }

  /**
   * Get a department configuration.
   */
  getDepartment(name: string): DepartmentConfig | undefined {
    return this.departments.get(name);
  }

  /**
   * Get all departments.
   */
  getAllDepartments(): DepartmentConfig[] {
    return Array.from(this.departments.values());
  }

  /**
   * Get pending requests for a department.
   */
  getPendingRequests(department: string): CrossDepartmentRequest[] {
    return Array.from(this.requests.values()).filter(
      (req) => req.toDepartment === department && req.status === "pending",
    );
  }

  /**
   * Get requests from a department.
   */
  getRequestsFrom(department: string): CrossDepartmentRequest[] {
    return Array.from(this.requests.values()).filter(
      (req) => req.fromDepartment === department,
    );
  }

  /**
   * Get a request by ID.
   */
  getRequest(requestId: string): CrossDepartmentRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Update department shared read zones.
   */
  updateSharedReadZones(department: string, zones: string[]): void {
    const dept = this.departments.get(department);
    if (!dept) {
      throw new Error(`Department ${department} not found`);
    }

    dept.sharedReadZones = zones;
    this.save();
  }

  /**
   * Update department allowed outbound.
   */
  updateAllowedOutbound(department: string, allowed: string[]): void {
    const dept = this.departments.get(department);
    if (!dept) {
      throw new Error(`Department ${department} not found`);
    }

    dept.allowedOutbound = allowed;
    this.save();
  }
}
