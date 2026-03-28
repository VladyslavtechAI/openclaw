/**
 * Corporate Pyramidal Hierarchy Manager
 * Manages organizational chart tree, reporting chains, delegation rules.
 * Maximum 10 levels deep.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

export type HierarchyLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface AgentNode {
  id: string;
  name: string;
  level: HierarchyLevel;
  manager?: string; // Manager agent ID
  reports: string[]; // Direct reports
  department: string;
  capabilities: string[];
  delegations: Delegation[];
  metadata?: Record<string, unknown>;
}

export interface Delegation {
  id: string;
  capability: string;
  delegatedTo: string; // Agent ID
  scope: "department" | "team" | "all";
  expiresAt?: number; // Timestamp
  grantedBy: string; // Agent ID
  grantedAt: number;
}

export interface ReportingChain {
  agent: string;
  chain: string[]; // From agent up to CEO, ordered
}

export interface HierarchyManagerConfig {
  storageDir: string;
  maxLevels?: number;
}

const MAX_HIERARCHY_LEVELS = 10;

export class HierarchyManager {
  private readonly storageDir: string;
  private readonly maxLevels: number;
  private readonly nodesFile: string;
  private nodes: Map<string, AgentNode> = new Map();

  constructor(config: HierarchyManagerConfig) {
    this.storageDir = config.storageDir;
    this.maxLevels = config.maxLevels ?? MAX_HIERARCHY_LEVELS;
    this.nodesFile = path.join(this.storageDir, "hierarchy-nodes.json");

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.nodesFile)) {
      const data = JSON.parse(fs.readFileSync(this.nodesFile, "utf8"));
      this.nodes = new Map(Object.entries(data));
    }
  }

  private save(): void {
    const data = Object.fromEntries(this.nodes);
    fs.writeFileSync(this.nodesFile, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Add an agent to the hierarchy.
   */
  addAgent(agent: Omit<AgentNode, "reports" | "delegations">): AgentNode {
    if (agent.level >= this.maxLevels) {
      throw new Error(`Level ${agent.level} exceeds max ${this.maxLevels - 1}`);
    }

    if (this.nodes.has(agent.id)) {
      throw new Error(`Agent ${agent.id} already exists`);
    }

    const node: AgentNode = {
      ...agent,
      reports: [],
      delegations: [],
    };

    // If has manager, validate and add to manager's reports
    if (agent.manager) {
      const manager = this.nodes.get(agent.manager);
      if (!manager) {
        throw new Error(`Manager ${agent.manager} does not exist`);
      }

      if (manager.level >= agent.level) {
        throw new Error(`Manager level must be less than agent level`);
      }

      manager.reports.push(agent.id);
    }

    this.nodes.set(agent.id, node);
    this.save();
    return node;
  }

  /**
   * Remove an agent from the hierarchy.
   * Reassigns reports to the removed agent's manager.
   */
  removeAgent(agentId: string): void {
    const node = this.nodes.get(agentId);
    if (!node) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Reassign reports to this agent's manager
    if (node.reports.length > 0) {
      if (!node.manager) {
        throw new Error(`Cannot remove top-level agent ${agentId} with reports`);
      }

      const manager = this.nodes.get(node.manager)!;
      for (const reportId of node.reports) {
        const report = this.nodes.get(reportId)!;
        report.manager = node.manager;
        manager.reports.push(reportId);
      }

      // Remove this agent from manager's reports
      manager.reports = manager.reports.filter((id) => id !== agentId);
    } else if (node.manager) {
      // Remove from manager's reports
      const manager = this.nodes.get(node.manager)!;
      manager.reports = manager.reports.filter((id) => id !== agentId);
    }

    this.nodes.delete(agentId);
    this.save();
  }

  /**
   * Get an agent's reporting chain from agent up to CEO.
   */
  getReportingChain(agentId: string): ReportingChain {
    const chain: string[] = [agentId];
    let current = this.nodes.get(agentId);

    if (!current) {
      throw new Error(`Agent ${agentId} not found`);
    }

    while (current.manager) {
      chain.push(current.manager);
      current = this.nodes.get(current.manager);
      if (!current) {
        throw new Error(`Invalid hierarchy: manager not found`);
      }

      // Cycle detection
      if (chain.length > this.maxLevels) {
        throw new Error(`Hierarchy cycle detected for agent ${agentId}`);
      }
    }

    return { agent: agentId, chain };
  }

  /**
   * Get all direct reports of an agent.
   */
  getDirectReports(agentId: string): AgentNode[] {
    const node = this.nodes.get(agentId);
    if (!node) {
      throw new Error(`Agent ${agentId} not found`);
    }

    return node.reports.map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * Get all reports (recursively) of an agent.
   */
  getAllReports(agentId: string): AgentNode[] {
    const node = this.nodes.get(agentId);
    if (!node) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const allReports: AgentNode[] = [];
    const queue = [...node.reports];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const reportId = queue.shift()!;
      if (visited.has(reportId)) continue;

      visited.add(reportId);
      const report = this.nodes.get(reportId);
      if (report) {
        allReports.push(report);
        queue.push(...report.reports);
      }
    }

    return allReports;
  }

  /**
   * Delegate a capability to another agent.
   */
  delegateCapability(
    fromAgent: string,
    toAgent: string,
    capability: string,
    scope: "department" | "team" | "all",
    expiresAt?: number,
  ): Delegation {
    const from = this.nodes.get(fromAgent);
    const to = this.nodes.get(toAgent);

    if (!from || !to) {
      throw new Error("Agent not found");
    }

    if (!from.capabilities.includes(capability)) {
      throw new Error(`Agent ${fromAgent} does not have capability ${capability}`);
    }

    const delegation: Delegation = {
      id: crypto.randomUUID(),
      capability,
      delegatedTo: toAgent,
      scope,
      expiresAt,
      grantedBy: fromAgent,
      grantedAt: Date.now(),
    };

    from.delegations.push(delegation);
    this.save();
    return delegation;
  }

  /**
   * Revoke a delegation.
   */
  revokeDelegation(fromAgent: string, delegationId: string): void {
    const from = this.nodes.get(fromAgent);
    if (!from) {
      throw new Error(`Agent ${fromAgent} not found`);
    }

    from.delegations = from.delegations.filter((d) => d.id !== delegationId);
    this.save();
  }

  /**
   * Check if an agent has a capability (directly or via delegation).
   */
  hasCapability(agentId: string, capability: string): boolean {
    const node = this.nodes.get(agentId);
    if (!node) {
      return false;
    }

    // Direct capability
    if (node.capabilities.includes(capability)) {
      return true;
    }

    // Check delegations from managers
    const chain = this.getReportingChain(agentId);
    for (const managerId of chain.chain.slice(1)) {
      const manager = this.nodes.get(managerId);
      if (!manager) continue;

      for (const delegation of manager.delegations) {
        if (
          delegation.capability === capability &&
          delegation.delegatedTo === agentId &&
          (!delegation.expiresAt || delegation.expiresAt > Date.now())
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get the common ancestor of two agents.
   */
  getCommonAncestor(agentA: string, agentB: string): string | null {
    const chainA = this.getReportingChain(agentA).chain;
    const chainB = this.getReportingChain(agentB).chain;

    const setB = new Set(chainB);
    for (const ancestor of chainA) {
      if (setB.has(ancestor)) {
        return ancestor;
      }
    }

    return null;
  }

  /**
   * Get all agents in a department.
   */
  getAgentsByDepartment(department: string): AgentNode[] {
    return Array.from(this.nodes.values()).filter(
      (node) => node.department === department,
    );
  }

  /**
   * Get an agent by ID.
   */
  getAgent(agentId: string): AgentNode | undefined {
    return this.nodes.get(agentId);
  }

  /**
   * Get all agents.
   */
  getAllAgents(): AgentNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Update agent metadata.
   */
  updateAgent(agentId: string, updates: Partial<AgentNode>): void {
    const node = this.nodes.get(agentId);
    if (!node) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Don't allow changing id, reports, or manager via this method
    const { id, reports, manager, ...allowed } = updates;
    Object.assign(node, allowed);
    this.save();
  }

  /**
   * Export the entire hierarchy as a tree structure.
   */
  exportTree(): Record<string, unknown> {
    const roots = Array.from(this.nodes.values()).filter((node) => !node.manager);

    const buildTree = (node: AgentNode): Record<string, unknown> => {
      return {
        id: node.id,
        name: node.name,
        level: node.level,
        department: node.department,
        capabilities: node.capabilities,
        reports: node.reports.map((id) => buildTree(this.nodes.get(id)!)),
      };
    };

    return {
      roots: roots.map(buildTree),
      totalAgents: this.nodes.size,
    };
  }
}
