import type { EnterpriseConfig } from "../config/EnterpriseConfig.js";
import type {
  HookResult,
  MessagePayload,
  MessageContext,
  ToolCallPayload,
  ToolCallContext,
  ToolResultPayload,
  AgentSpawnConfig,
  AgentIdentity,
  FileAccessPayload,
  HttpRequestPayload,
} from "../events/EventTypes.js";
import { EventBus } from "../events/EventBus.js";
import { ConfigValidator } from "../config/ConfigValidator.js";
import { SecurityPipeline } from "../pipeline/SecurityPipeline.js";
import type { SecurityModules } from "../pipeline/SecurityPipeline.js";
import { ToolPipeline } from "../pipeline/ToolPipeline.js";
import type { ToolModules } from "../pipeline/ToolPipeline.js";
import { FilePipeline } from "../pipeline/FilePipeline.js";
import type { FileModules } from "../pipeline/FilePipeline.js";
import { AgentPipeline } from "../pipeline/AgentPipeline.js";
import type { AgentModules } from "../pipeline/AgentPipeline.js";
import { PluginContext } from "./PluginContext.js";
import { Logger } from "../utils/logger.js";

export interface GatewayConfig {
  enterprise?: Record<string, unknown>;
}

export interface AllModules {
  security?: SecurityModules;
  tool?: ToolModules;
  file?: FileModules;
  agent?: AgentModules;
}

/**
 * Main entry point: OpenClaw loads this as a plugin.
 *
 * Lifecycle:
 *   1. construct with modules
 *   2. onGatewayStart(config) — validate config, initialize pipelines
 *   3. hook calls (onMessageBefore, onToolCallBefore, etc.)
 *   4. onGatewayStop() — tear down
 */
export class OpenClawEnterprisePlugin {
  private context: PluginContext | undefined;
  private securityPipeline: SecurityPipeline | undefined;
  private toolPipeline: ToolPipeline | undefined;
  private filePipeline: FilePipeline | undefined;
  private agentPipeline: AgentPipeline | undefined;
  private running = false;

  private readonly logger: Logger;
  private readonly allModules: AllModules;

  constructor(modules?: AllModules, logger?: Logger) {
    this.allModules = modules ?? {};
    this.logger = logger ?? new Logger("OpenClawEnterprisePlugin");
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async onGatewayStart(gatewayConfig: GatewayConfig): Promise<void> {
    this.logger.info("Enterprise plugin starting");

    const validator = new ConfigValidator();
    const result = validator.validate(
      (gatewayConfig.enterprise as Record<string, unknown>) ?? {},
    );

    if (!result.valid) {
      this.logger.error("Configuration validation failed", {
        errors: result.errors as unknown as Record<string, unknown>,
      });
      throw new Error(
        `Enterprise config invalid: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
      );
    }

    const config = result.config;
    if (!config.enabled) {
      this.logger.info("Enterprise plugin disabled by config");
      return;
    }

    const eventBus = new EventBus((err, evt) => {
      this.logger.error("EventBus handler error", {
        event: evt,
        error: String(err),
      });
    });

    const securityModules = this.allModules.security ?? {};
    const toolModules = this.allModules.tool ?? {};
    const fileModules = this.allModules.file ?? {};
    const agentModules = this.allModules.agent ?? {};

    this.context = new PluginContext(config, eventBus, {
      security: securityModules,
      tool: toolModules,
      file: fileModules,
      agent: agentModules,
    }, this.logger.child("context"));

    this.securityPipeline = new SecurityPipeline(
      config,
      securityModules,
      eventBus,
      this.logger.child("security"),
    );
    this.toolPipeline = new ToolPipeline(
      config,
      toolModules,
      eventBus,
      this.logger.child("tool"),
    );
    this.filePipeline = new FilePipeline(
      config,
      fileModules,
      eventBus,
      this.logger.child("file"),
    );
    this.agentPipeline = new AgentPipeline(
      config,
      agentModules,
      eventBus,
      this.logger.child("agent"),
    );

    this.initializeModuleHealth(config);
    this.context.markStarted();
    this.running = true;

    this.logger.info("Enterprise plugin started", {
      modules: {
        security: Object.keys(securityModules).length,
        tool: Object.keys(toolModules).length,
        file: Object.keys(fileModules).length,
        agent: Object.keys(agentModules).length,
      },
    });
  }

  async onGatewayStop(): Promise<void> {
    this.logger.info("Enterprise plugin stopping");
    this.running = false;
    this.context?.eventBus.removeAllListeners();
    this.context = undefined;
    this.securityPipeline = undefined;
    this.toolPipeline = undefined;
    this.filePipeline = undefined;
    this.agentPipeline = undefined;
    this.logger.info("Enterprise plugin stopped");
  }

  // ─── Message Hooks ──────────────────────────────────────────────────────

  async onMessageBefore(
    message: MessagePayload,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.running || !this.securityPipeline) {
      return { action: "allow" };
    }

    await this.context!.eventBus.emit("message:before", { message, context });
    return this.securityPipeline.process(message, context);
  }

  async onMessageAfter(
    response: MessagePayload,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.running || !this.securityPipeline) {
      return { action: "allow" };
    }

    // Run response through DLP/exfil checks too
    const result = await this.securityPipeline.process(response, context);
    await this.context!.eventBus.emit("message:after", { response, context });
    return result;
  }

  // ─── Tool Hooks ─────────────────────────────────────────────────────────

  async onToolCallBefore(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolCallContext,
  ): Promise<HookResult<ToolCallPayload>> {
    if (!this.running || !this.toolPipeline) {
      return { action: "allow" };
    }

    const payload: ToolCallPayload = { toolName, args };
    await this.context!.eventBus.emit("tool:before", { tool: payload, context });
    return this.toolPipeline.process(payload, context);
  }

  async onToolCallAfter(
    toolName: string,
    result: unknown,
    context: ToolCallContext,
    durationMs: number,
    success: boolean,
  ): Promise<HookResult<ToolResultPayload>> {
    if (!this.running) {
      return { action: "allow" };
    }

    const payload: ToolResultPayload = { toolName, result, durationMs, success };
    await this.context!.eventBus.emit("tool:after", { result: payload, context });
    return { action: "allow", source: "OpenClawEnterprisePlugin" };
  }

  // ─── Agent Hooks ────────────────────────────────────────────────────────

  async onAgentSpawn(
    parentAgent: AgentIdentity,
    childConfig: AgentSpawnConfig,
  ): Promise<HookResult<AgentSpawnConfig>> {
    if (!this.running || !this.agentPipeline) {
      return { action: "allow" };
    }

    await this.context!.eventBus.emit("agent:spawn", {
      parent: parentAgent,
      config: childConfig,
    });
    return this.agentPipeline.process(parentAgent, childConfig);
  }

  async onAgentMessage(
    fromAgent: AgentIdentity,
    toAgent: AgentIdentity,
    message: MessagePayload,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.running || !this.securityPipeline) {
      return { action: "allow" };
    }

    await this.context!.eventBus.emit("agent:message", {
      from: fromAgent,
      to: toAgent,
      message,
    });

    // Run inter-agent messages through security pipeline
    const msgContext: MessageContext = {
      agent: fromAgent,
      conversationId: `agent-msg-${fromAgent.id}-${toAgent.id}`,
      turnIndex: 0,
      timestamp: Date.now(),
      metadata: { toAgent: toAgent.id },
    };
    return this.securityPipeline.process(message, msgContext);
  }

  // ─── File Hooks ─────────────────────────────────────────────────────────

  async onFileRead(
    path: string,
    agent: AgentIdentity,
  ): Promise<HookResult<FileAccessPayload>> {
    if (!this.running || !this.filePipeline) {
      return { action: "allow" };
    }

    const payload: FileAccessPayload = { path, operation: "read" };
    await this.context!.eventBus.emit("file:read", { payload, agent });
    return this.filePipeline.process(payload, agent);
  }

  async onFileWrite(
    path: string,
    content: string,
    agent: AgentIdentity,
  ): Promise<HookResult<FileAccessPayload>> {
    if (!this.running || !this.filePipeline) {
      return { action: "allow" };
    }

    const payload: FileAccessPayload = { path, content, operation: "write" };
    await this.context!.eventBus.emit("file:write", { payload, agent });
    return this.filePipeline.process(payload, agent);
  }

  // ─── Network Hooks ──────────────────────────────────────────────────────

  async onHttpRequest(
    url: string,
    method: string,
    agent: AgentIdentity,
  ): Promise<HookResult<HttpRequestPayload>> {
    if (!this.running || !this.toolPipeline) {
      return { action: "allow" };
    }

    const payload: HttpRequestPayload = { url, method };
    await this.context!.eventBus.emit("http:request", { payload, agent });

    // Re-use tool pipeline's network policy check
    const toolPayload: ToolCallPayload = {
      toolName: "http_request",
      args: { url, method },
    };
    const toolContext: ToolCallContext = {
      agent,
      conversationId: "",
      timestamp: Date.now(),
      metadata: {},
    };
    const result = await this.toolPipeline.process(toolPayload, toolContext);
    return {
      action: result.action,
      reason: result.reason,
      source: result.source,
      latencyMs: result.latencyMs,
    };
  }

  // ─── Status & Metrics ───────────────────────────────────────────────────

  isRunning(): boolean {
    return this.running;
  }

  getContext(): PluginContext | undefined {
    return this.context;
  }

  getMetrics(): Record<string, unknown> {
    return {
      running: this.running,
      uptime: this.context?.getUptime() ?? 0,
      pipelines: {
        security: this.securityPipeline?.getMetrics() ?? null,
        tool: this.toolPipeline?.getMetrics() ?? null,
        file: this.filePipeline?.getMetrics() ?? null,
        agent: this.agentPipeline?.getMetrics() ?? null,
      },
      health: this.context?.getHealthSummary() ?? null,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private initializeModuleHealth(config: EnterpriseConfig): void {
    const ctx = this.context!;
    const now = Date.now();

    const secModules: Array<[string, boolean, boolean]> = [
      ["InjectionShield", config.security.injectionShield.enabled, !!this.allModules.security?.injectionShield],
      ["DlpEngine", config.security.dlp.enabled, !!this.allModules.security?.dlpEngine],
      ["ContentSafety", config.security.contentSafety.enabled, !!this.allModules.security?.contentSafety],
      ["ExfilGuard", config.security.exfilGuard.enabled, !!this.allModules.security?.exfilGuard],
    ];

    const infraModules: Array<[string, boolean, boolean]> = [
      ["FilesystemPolicy", config.security.filesystemPolicy.enabled, !!this.allModules.tool?.filesystemPolicy],
      ["NetworkPolicy", config.security.networkPolicy.enabled, !!this.allModules.tool?.networkPolicy],
      ["BackdoorScanner", config.security.backdoorScanner.enabled, !!this.allModules.file?.backdoorScanner],
      ["AgentHierarchy", config.infrastructure.agentHierarchy.enabled, !!this.allModules.agent?.agentHierarchy],
      ["CostGovernor", config.infrastructure.costGovernor.enabled, !!this.allModules.agent?.costGovernor],
    ];

    for (const [name, enabled, loaded] of [...secModules, ...infraModules]) {
      if (!enabled) {
        ctx.setModuleHealth(name, { status: "disabled", lastCheck: now });
      } else if (!loaded) {
        ctx.setModuleHealth(name, {
          status: "degraded",
          lastCheck: now,
          message: "Module enabled but not loaded",
        });
      } else {
        ctx.setModuleHealth(name, { status: "healthy", lastCheck: now });
      }
    }
  }
}
