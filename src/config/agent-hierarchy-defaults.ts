import type { AgentHierarchyConfig, AgentHierarchyLevel } from "./types.agent-hierarchy.js";

/**
 * Default hierarchy level when not specified.
 * Level 2 (worker) is the most restrictive by default.
 */
export const DEFAULT_HIERARCHY_LEVEL: AgentHierarchyLevel = 2;

/**
 * Default hierarchy configuration for agents.
 * Provides secure defaults with minimal permissions.
 */
export const DEFAULT_HIERARCHY_CONFIG: Required<AgentHierarchyConfig> = {
  level: DEFAULT_HIERARCHY_LEVEL,
  lead: "",
  workers: [],
  permissions: {
    ssh: "none",
    credentials: "none",
    gateway_restart: false,
    spawn_subagents: false,
    send_to_agents: "lead_only",
    tools_allow: [],
    tools_deny: [],
  },
};

/**
 * Resolve effective hierarchy level for an agent.
 * Returns level 2 (worker) if not specified - most restrictive.
 */
export function resolveHierarchyLevel(
  hierarchy: AgentHierarchyConfig | undefined,
): AgentHierarchyLevel {
  return hierarchy?.level ?? DEFAULT_HIERARCHY_LEVEL;
}

/**
 * Resolve effective hierarchy configuration with defaults applied.
 */
export function resolveHierarchyConfig(
  hierarchy: AgentHierarchyConfig | undefined,
): AgentHierarchyConfig {
  if (!hierarchy) {
    return { level: DEFAULT_HIERARCHY_LEVEL };
  }

  return {
    level: resolveHierarchyLevel(hierarchy),
    lead: hierarchy.lead,
    workers: hierarchy.workers,
    permissions: hierarchy.permissions
      ? {
          ssh: hierarchy.permissions.ssh ?? DEFAULT_HIERARCHY_CONFIG.permissions.ssh,
          credentials:
            hierarchy.permissions.credentials ?? DEFAULT_HIERARCHY_CONFIG.permissions.credentials,
          gateway_restart:
            hierarchy.permissions.gateway_restart ??
            DEFAULT_HIERARCHY_CONFIG.permissions.gateway_restart,
          spawn_subagents:
            hierarchy.permissions.spawn_subagents ??
            DEFAULT_HIERARCHY_CONFIG.permissions.spawn_subagents,
          send_to_agents:
            hierarchy.permissions.send_to_agents ??
            DEFAULT_HIERARCHY_CONFIG.permissions.send_to_agents,
          tools_allow: hierarchy.permissions.tools_allow,
          tools_deny: hierarchy.permissions.tools_deny,
        }
      : undefined,
  };
}
