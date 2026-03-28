import type { EnterpriseConfig } from "../config/EnterpriseConfig.js";
import type { EventBus } from "../events/EventBus.js";
import type { SecurityModules } from "../pipeline/SecurityPipeline.js";
import type { ToolModules } from "../pipeline/ToolPipeline.js";
import type { FileModules } from "../pipeline/FilePipeline.js";
import type { AgentModules } from "../pipeline/AgentPipeline.js";
import { Logger } from "../utils/logger.js";

export interface ModuleHealth {
  name: string;
  status: "healthy" | "degraded" | "down" | "disabled";
  lastCheck: number;
  message?: string;
}

/**
 * Shared context passed to all pipelines and modules during plugin lifecycle.
 * Holds references to all initialized modules and shared state.
 */
export class PluginContext {
  readonly config: EnterpriseConfig;
  readonly eventBus: EventBus;
  readonly logger: Logger;

  readonly securityModules: SecurityModules;
  readonly toolModules: ToolModules;
  readonly fileModules: FileModules;
  readonly agentModules: AgentModules;

  private readonly moduleHealth = new Map<string, ModuleHealth>();
  private startTime = 0;

  constructor(
    config: EnterpriseConfig,
    eventBus: EventBus,
    modules: {
      security: SecurityModules;
      tool: ToolModules;
      file: FileModules;
      agent: AgentModules;
    },
    logger?: Logger,
  ) {
    this.config = config;
    this.eventBus = eventBus;
    this.logger = logger ?? new Logger("PluginContext");
    this.securityModules = modules.security;
    this.toolModules = modules.tool;
    this.fileModules = modules.file;
    this.agentModules = modules.agent;
  }

  markStarted(): void {
    this.startTime = Date.now();
  }

  getUptime(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0;
  }

  setModuleHealth(name: string, health: Omit<ModuleHealth, "name">): void {
    this.moduleHealth.set(name, { name, ...health });
  }

  getModuleHealth(name: string): ModuleHealth | undefined {
    return this.moduleHealth.get(name);
  }

  getAllModuleHealth(): readonly ModuleHealth[] {
    return Array.from(this.moduleHealth.values());
  }

  getHealthSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    down: number;
    disabled: number;
  } {
    let healthy = 0;
    let degraded = 0;
    let down = 0;
    let disabled = 0;
    for (const h of this.moduleHealth.values()) {
      switch (h.status) {
        case "healthy":
          healthy++;
          break;
        case "degraded":
          degraded++;
          break;
        case "down":
          down++;
          break;
        case "disabled":
          disabled++;
          break;
      }
    }
    return {
      total: this.moduleHealth.size,
      healthy,
      degraded,
      down,
      disabled,
    };
  }
}
