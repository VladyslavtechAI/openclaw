/**
 * Agent hierarchy types for permission control.
 * Defines role-based access control for multi-agent systems.
 */

/** Hierarchy level: 0=admin, 1=lead, 2=worker */
export type AgentHierarchyLevel = 0 | 1 | 2;

export type AgentHierarchyPermissions = {
  /** SSH access: all machines, own machine only, or none */
  ssh?: "all" | "own_machine" | "none";

  /** Credential access: full, read-only, or none */
  credentials?: "all" | "read" | "none";

  /** Can restart gateway */
  gateway_restart?: boolean;

  /** Can spawn sub-agents */
  spawn_subagents?: boolean;

  /** Agent-to-agent communication scope */
  send_to_agents?: "all" | "lead_only" | "team" | "none";

  /** Tool allowlist (overrides defaults) */
  tools_allow?: string[];

  /** Tool denylist (overrides defaults) */
  tools_deny?: string[];
};

export type AgentHierarchyConfig = {
  /** Hierarchy level (default: 2 = worker, most restrictive) */
  level?: AgentHierarchyLevel;

  /** Parent agent ID (for workers/leads) */
  lead?: string;

  /** Child agent IDs (for leads) */
  workers?: string[];

  /** Permission overrides */
  permissions?: AgentHierarchyPermissions;
};
