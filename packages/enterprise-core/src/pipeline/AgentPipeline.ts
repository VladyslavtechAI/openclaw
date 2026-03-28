import type { EnterpriseConfig } from "../config/EnterpriseConfig.js";
import type {
  HookResult,
  AgentSpawnConfig,
  AgentIdentity,
} from "../events/EventTypes.js";
import type { EventBus } from "../events/EventBus.js";
import { Logger } from "../utils/logger.js";

export interface IAgentHierarchy {
  validateSpawn(
    parent: AgentIdentity,
    child: AgentSpawnConfig,
  ): Promise<{ allowed: boolean; reason?: string; depth: number }>;
}

export interface ICostGovernor {
  checkBudget(
    agentId: string,
    estimatedCost: number,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    reason?: string;
  }>;
}

export interface ISubagentScopeForSpawn {
  validateSpawnConfig(
    parentAgent: AgentIdentity,
    childConfig: AgentSpawnConfig,
  ): Promise<{
    allowed: boolean;
    restrictedTools?: readonly string[];
    reason?: string;
  }>;
}

export interface AgentModules {
  agentHierarchy?: IAgentHierarchy;
  subagentScope?: ISubagentScopeForSpawn;
  costGovernor?: ICostGovernor;
}

interface PipelineMetrics {
  processed: number;
  blocked: number;
  modified: number;
  errors: number;
  totalLatencyMs: number;
}

/**
 * Pipeline for agent spawn security:
 *   Agent Spawn → AgentHierarchy → SubagentScope → CostGovernor → PASS/BLOCK
 */
export class AgentPipeline {
  private readonly config: EnterpriseConfig;
  private readonly modules: AgentModules;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly metrics: PipelineMetrics = {
    processed: 0,
    blocked: 0,
    modified: 0,
    errors: 0,
    totalLatencyMs: 0,
  };

  constructor(
    config: EnterpriseConfig,
    modules: AgentModules,
    eventBus: EventBus,
    logger?: Logger,
  ) {
    this.config = config;
    this.modules = modules;
    this.eventBus = eventBus;
    this.logger = logger ?? new Logger("AgentPipeline");
  }

  async process(
    parent: AgentIdentity,
    childConfig: AgentSpawnConfig,
  ): Promise<HookResult<AgentSpawnConfig>> {
    const start = performance.now();
    this.metrics.processed++;

    try {
      // Step 1: Hierarchy check (depth limit, parent-child validation)
      const hierarchyResult = await this.checkHierarchy(parent, childConfig);
      if (hierarchyResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(hierarchyResult, start);
      }

      // Step 2: Subagent scope (tool/permission restrictions)
      const scopeResult = await this.checkSubagentScope(parent, childConfig);
      if (scopeResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(scopeResult, start);
      }
      // Scope may restrict tools
      const currentConfig =
        scopeResult.action === "modify" && scopeResult.modified
          ? scopeResult.modified
          : childConfig;

      // Step 3: Cost governor (budget check)
      const costResult = await this.checkCostGovernor(parent, currentConfig);
      if (costResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(costResult, start);
      }

      // All checks passed
      if (scopeResult.action === "modify") {
        this.metrics.modified++;
        return this.finalize(
          {
            action: "modify",
            modified: currentConfig,
            source: "AgentPipeline",
          },
          start,
        );
      }

      return this.finalize({ action: "allow", source: "AgentPipeline" }, start);
    } catch (err) {
      this.metrics.errors++;
      this.logger.error("AgentPipeline error", {
        error: String(err),
        parent: parent.id,
        child: childConfig.name,
      });
      return this.finalize(
        { action: "allow", source: "AgentPipeline", reason: "pipeline-error-fail-open" },
        start,
      );
    }
  }

  getMetrics(): Readonly<PipelineMetrics> {
    return { ...this.metrics };
  }

  private async checkHierarchy(
    parent: AgentIdentity,
    childConfig: AgentSpawnConfig,
  ): Promise<HookResult<AgentSpawnConfig>> {
    if (!this.config.infrastructure.agentHierarchy.enabled || !this.modules.agentHierarchy) {
      return { action: "allow", source: "AgentHierarchy" };
    }

    const result = await this.modules.agentHierarchy.validateSpawn(
      parent,
      childConfig,
    );

    if (result.allowed) {
      return { action: "allow", source: "AgentHierarchy" };
    }

    await this.eventBus.emit("security:violation", {
      module: "AgentHierarchy",
      severity: "medium",
      description: result.reason ?? `Agent spawn denied (depth=${result.depth})`,
      agent: parent,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? "Agent hierarchy constraint violated",
      source: "AgentHierarchy",
    };
  }

  private async checkSubagentScope(
    parent: AgentIdentity,
    childConfig: AgentSpawnConfig,
  ): Promise<HookResult<AgentSpawnConfig>> {
    if (!this.modules.subagentScope) {
      return { action: "allow", source: "SubagentScope" };
    }

    const result = await this.modules.subagentScope.validateSpawnConfig(
      parent,
      childConfig,
    );

    if (result.allowed && !result.restrictedTools?.length) {
      return { action: "allow", source: "SubagentScope" };
    }

    if (!result.allowed) {
      await this.eventBus.emit("security:violation", {
        module: "SubagentScope",
        severity: "medium",
        description: result.reason ?? "Subagent spawn scope violation",
        agent: parent,
        timestamp: Date.now(),
      });

      return {
        action: "block",
        reason: result.reason ?? "Subagent scope constraint violated",
        source: "SubagentScope",
      };
    }

    // Allowed but with tool restrictions → modify the config
    const restrictedSet = new Set(result.restrictedTools);
    const filteredTools = childConfig.tools.filter(
      (t) => !restrictedSet.has(t),
    );

    return {
      action: "modify",
      modified: {
        ...childConfig,
        tools: filteredTools,
      },
      source: "SubagentScope",
    };
  }

  private async checkCostGovernor(
    parent: AgentIdentity,
    childConfig: AgentSpawnConfig,
  ): Promise<HookResult<AgentSpawnConfig>> {
    if (!this.config.infrastructure.costGovernor.enabled || !this.modules.costGovernor) {
      return { action: "allow", source: "CostGovernor" };
    }

    const estimatedCost = childConfig.maxBudget ?? this.config.infrastructure.costGovernor.perAgentLimitUsd;
    const result = await this.modules.costGovernor.checkBudget(
      parent.id,
      estimatedCost,
    );

    if (result.allowed) {
      // Emit threshold warning if applicable
      const percentUsed =
        ((estimatedCost - result.remaining + estimatedCost) /
          this.config.infrastructure.costGovernor.monthlyBudgetUsd) *
        100;
      if (percentUsed >= this.config.infrastructure.costGovernor.alertAtPercent) {
        await this.eventBus.emit("cost:threshold", {
          agentId: parent.id,
          currentCost: estimatedCost - result.remaining + estimatedCost,
          limit: this.config.infrastructure.costGovernor.monthlyBudgetUsd,
          percentUsed,
          timestamp: Date.now(),
        });
      }
      return { action: "allow", source: "CostGovernor" };
    }

    await this.eventBus.emit("cost:threshold", {
      agentId: parent.id,
      currentCost: estimatedCost,
      limit: this.config.infrastructure.costGovernor.perAgentLimitUsd,
      percentUsed: 100,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? "Budget limit exceeded",
      source: "CostGovernor",
    };
  }

  private finalize<T>(result: HookResult<T>, startTime: number): HookResult<T> {
    result.latencyMs = performance.now() - startTime;
    this.metrics.totalLatencyMs += result.latencyMs;
    return result;
  }
}
