/**
 * Agent permission checker for hierarchy-based access control.
 */

import type { OpenClawConfig } from "../config/config.js";
import type { AgentHierarchyConfig, AgentHierarchyLevel } from "../config/types.agent-hierarchy.js";
import { listAgentEntries } from "./agent-scope.js";

/**
 * Default permission matrix by hierarchy level.
 */
const DEFAULT_PERMISSIONS = {
  0: {
    // Admin
    ssh: "all" as const,
    credentials: "all" as const,
    gateway_restart: true,
    spawn_subagents: true,
    send_to_agents: "all" as const,
  },
  1: {
    // Lead
    ssh: "own_machine" as const,
    credentials: "read" as const,
    gateway_restart: false,
    spawn_subagents: true,
    send_to_agents: "team" as const,
  },
  2: {
    // Worker
    ssh: "none" as const,
    credentials: "none" as const,
    gateway_restart: false,
    spawn_subagents: false,
    send_to_agents: "lead_only" as const,
  },
};

/**
 * Get agent hierarchy config from OpenClaw config.
 */
function getAgentHierarchy(
  agentId: string,
  config: OpenClawConfig,
): AgentHierarchyConfig | undefined {
  const agents = listAgentEntries(config);
  const agent = agents.find((a) => a.id === agentId);
  return agent?.hierarchy;
}

/**
 * Get effective hierarchy level (default: 2 = worker).
 */
function getHierarchyLevel(agentId: string, config: OpenClawConfig): AgentHierarchyLevel {
  const hierarchy = getAgentHierarchy(agentId, config);
  return hierarchy?.level ?? 2; // Default: most restrictive
}

/**
 * Get team members (lead + workers) for an agent.
 */
function getTeamMembers(agentId: string, config: OpenClawConfig): string[] {
  const hierarchy = getAgentHierarchy(agentId, config);
  const team = new Set<string>([agentId]);

  // Add lead
  if (hierarchy?.lead) {
    team.add(hierarchy.lead);
  }

  // Add workers
  if (hierarchy?.workers) {
    hierarchy.workers.forEach((w) => team.add(w));
  }

  // If this agent IS a lead, find all agents that have this agent as their lead
  const agents = listAgentEntries(config);
  for (const agent of agents) {
    if (agent.hierarchy?.lead === agentId) {
      team.add(agent.id);
    }
  }

  return Array.from(team);
}

/**
 * Agent permission checker.
 */
export class AgentPermissions {
  /**
   * Check if agent can SSH to a target machine.
   */
  static canSSH(agentId: string, target: string, config: OpenClawConfig): boolean {
    const hierarchy = getAgentHierarchy(agentId, config);
    const level = getHierarchyLevel(agentId, config);

    // Permission override
    const sshPerm = hierarchy?.permissions?.ssh ?? DEFAULT_PERMISSIONS[level].ssh;

    if (sshPerm === "all") {
      return true;
    }
    if (sshPerm === "none") {
      return false;
    }

    // "own_machine": check if target is the same machine this agent runs on
    // For now, assume target matches if it contains agent's name (simplified)
    return target.toLowerCase().includes(agentId.toLowerCase());
  }

  /**
   * Check if agent can access credentials.
   */
  static canAccessCredentials(agentId: string, config: OpenClawConfig): boolean {
    const hierarchy = getAgentHierarchy(agentId, config);
    const level = getHierarchyLevel(agentId, config);

    const credPerm = hierarchy?.permissions?.credentials ?? DEFAULT_PERMISSIONS[level].credentials;
    return credPerm === "all" || credPerm === "read";
  }

  /**
   * Check if agent can write credentials.
   */
  static canWriteCredentials(agentId: string, config: OpenClawConfig): boolean {
    const hierarchy = getAgentHierarchy(agentId, config);
    const level = getHierarchyLevel(agentId, config);

    const credPerm = hierarchy?.permissions?.credentials ?? DEFAULT_PERMISSIONS[level].credentials;
    return credPerm === "all";
  }

  /**
   * Check if agent can restart gateway.
   */
  static canRestartGateway(agentId: string, config: OpenClawConfig): boolean {
    const hierarchy = getAgentHierarchy(agentId, config);
    const level = getHierarchyLevel(agentId, config);

    return hierarchy?.permissions?.gateway_restart ?? DEFAULT_PERMISSIONS[level].gateway_restart;
  }

  /**
   * Check if agent can spawn sub-agents.
   */
  static canSpawnSubagent(agentId: string, config: OpenClawConfig): boolean {
    const hierarchy = getAgentHierarchy(agentId, config);
    const level = getHierarchyLevel(agentId, config);

    return hierarchy?.permissions?.spawn_subagents ?? DEFAULT_PERMISSIONS[level].spawn_subagents;
  }

  /**
   * Check if agent can send messages to another agent.
   */
  static canSendToAgent(fromAgent: string, toAgent: string, config: OpenClawConfig): boolean {
    const hierarchy = getAgentHierarchy(fromAgent, config);
    const level = getHierarchyLevel(fromAgent, config);

    const sendPerm =
      hierarchy?.permissions?.send_to_agents ?? DEFAULT_PERMISSIONS[level].send_to_agents;

    if (sendPerm === "all") {
      return true;
    }
    if (sendPerm === "none") {
      return false;
    }

    if (sendPerm === "lead_only") {
      // Can only send to their lead
      return hierarchy?.lead === toAgent;
    }

    if (sendPerm === "team") {
      // Can send to anyone in their team (lead + workers)
      const team = getTeamMembers(fromAgent, config);
      return team.includes(toAgent);
    }

    return false;
  }

  /**
   * Get effective tool allowlist for an agent.
   */
  static getEffectiveToolsAllow(agentId: string, config: OpenClawConfig): string[] | undefined {
    const hierarchy = getAgentHierarchy(agentId, config);
    return hierarchy?.permissions?.tools_allow;
  }

  /**
   * Get effective tool denylist for an agent.
   */
  static getEffectiveToolsDeny(agentId: string, config: OpenClawConfig): string[] | undefined {
    const hierarchy = getAgentHierarchy(agentId, config);
    return hierarchy?.permissions?.tools_deny;
  }

  /**
   * Get hierarchy level for an agent.
   */
  static getLevel(agentId: string, config: OpenClawConfig): AgentHierarchyLevel {
    return getHierarchyLevel(agentId, config);
  }

  /**
   * Validate hierarchy configuration for cycles and missing references.
   * Returns array of validation errors, or empty array if valid.
   */
  static validateHierarchy(config: OpenClawConfig): string[] {
    const errors: string[] = [];
    const agents = listAgentEntries(config);
    const agentIds = new Set(agents.map((a) => a.id));

    for (const agent of agents) {
      if (!agent.hierarchy) {
        continue;
      }

      const hierarchy = agent.hierarchy;

      // Check for self-referential lead
      if (hierarchy.lead && hierarchy.lead === agent.id) {
        errors.push(`Agent ${agent.id}: lead cannot reference self`);
      }

      // Check for missing lead reference
      if (hierarchy.lead && !agentIds.has(hierarchy.lead)) {
        errors.push(`Agent ${agent.id}: lead "${hierarchy.lead}" does not exist`);
      }

      // Check for missing worker references
      if (hierarchy.workers) {
        for (const worker of hierarchy.workers) {
          if (!agentIds.has(worker)) {
            errors.push(`Agent ${agent.id}: worker "${worker}" does not exist`);
          }
          if (worker === agent.id) {
            errors.push(`Agent ${agent.id}: workers cannot include self`);
          }
        }
      }

      // Detect circular dependencies
      if (hierarchy.lead) {
        const visited = new Set<string>();
        let current = hierarchy.lead;
        visited.add(agent.id);

        while (current) {
          if (visited.has(current)) {
            errors.push(
              `Agent ${agent.id}: circular hierarchy detected (cycle includes: ${Array.from(visited).join(" -> ")} -> ${current})`,
            );
            break;
          }
          visited.add(current);

          const currentAgent = agents.find((a) => a.id === current);
          current = currentAgent?.hierarchy?.lead ?? "";
        }
      }
    }

    return errors;
  }
}
