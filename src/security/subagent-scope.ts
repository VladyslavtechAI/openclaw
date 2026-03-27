/**
 * Subagent permission downscoping.
 * Ensures subagents never exceed parent's permissions.
 */

import type { AgentHierarchyLevel } from "../config/types.agent-hierarchy.js";

export type SubagentScopeConfig = {
  /** Tools allowed for the subagent (default: read, write, web_search) */
  tools?: string[];
  /** Paths accessible to the subagent */
  paths?: string[];
  /** Maximum hierarchy level (cannot be lower than parent) */
  maxLevel?: AgentHierarchyLevel;
  /** Whether exec is allowed (default: false) */
  allowExec?: boolean;
  /** Whether message.send is allowed (default: false) */
  allowMessageSend?: boolean;
  /** Whether SSH is allowed (default: false) */
  allowSsh?: boolean;
};

const DEFAULT_SUBAGENT_TOOLS = ["read", "write", "web_search", "web_fetch", "image", "pdf"];

const RESTRICTED_TOOLS = ["exec", "message", "gateway", "cron", "sessions_send", "sessions_spawn", "browser"];

/**
 * Subagent permission scope enforcer.
 */
export class SubagentScope {
  /**
   * Compute effective scope for a subagent.
   * Rule: subagent gets AT MOST parent's permissions, further restricted by config.
   */
  static computeScope(
    parentLevel: AgentHierarchyLevel,
    parentTools: string[] | undefined,
    config: SubagentScopeConfig = {},
  ): ResolvedScope {
    // Subagent level: at least parent level, never more privileged
    const level = Math.max(parentLevel, config.maxLevel ?? 2) as AgentHierarchyLevel;

    // Tools: intersection of parent's tools and config
    let tools = config.tools ?? DEFAULT_SUBAGENT_TOOLS;

    // Remove restricted tools unless explicitly allowed
    if (!config.allowExec) {
      tools = tools.filter((t) => t !== "exec");
    }
    if (!config.allowMessageSend) {
      tools = tools.filter((t) => t !== "message" && t !== "sessions_send");
    }
    if (!config.allowSsh) {
      tools = tools.filter((t) => t !== "ssh");
    }

    // If parent has a tool allowlist, intersect
    if (parentTools && parentTools.length > 0) {
      tools = tools.filter((t) => parentTools.includes(t));
    }

    return {
      level,
      tools,
      paths: config.paths ?? [],
      allowExec: config.allowExec ?? false,
      allowMessageSend: config.allowMessageSend ?? false,
      allowSsh: config.allowSsh ?? false,
    };
  }

  /**
   * Check if a tool is allowed for the subagent.
   */
  static isToolAllowed(tool: string, scope: ResolvedScope): boolean {
    // Always block certain tools for subagents
    if (tool === "gateway") return false; // Never restart gateway from subagent
    if (tool === "cron") return false; // Never modify cron from subagent

    return scope.tools.includes(tool);
  }

  /**
   * Validate that requested scope doesn't escalate beyond parent.
   */
  static validateNoEscalation(
    parentLevel: AgentHierarchyLevel,
    requestedConfig: SubagentScopeConfig,
  ): { valid: boolean; reason?: string } {
    // Can't request a level more privileged than parent
    if (requestedConfig.maxLevel !== undefined && requestedConfig.maxLevel < parentLevel) {
      return {
        valid: false,
        reason: `Cannot escalate: parent level ${parentLevel}, requested ${requestedConfig.maxLevel}`,
      };
    }

    // Level 2 (worker) can't allow exec for subagents
    if (parentLevel >= 2 && requestedConfig.allowExec) {
      return { valid: false, reason: "Worker cannot grant exec to subagent" };
    }

    // Level 2 (worker) can't allow message.send for subagents
    if (parentLevel >= 2 && requestedConfig.allowMessageSend) {
      return { valid: false, reason: "Worker cannot grant message.send to subagent" };
    }

    return { valid: true };
  }

  /**
   * Get default restricted tools list.
   */
  static getRestrictedTools(): string[] {
    return [...RESTRICTED_TOOLS];
  }
}

export type ResolvedScope = {
  level: AgentHierarchyLevel;
  tools: string[];
  paths: string[];
  allowExec: boolean;
  allowMessageSend: boolean;
  allowSsh: boolean;
};
