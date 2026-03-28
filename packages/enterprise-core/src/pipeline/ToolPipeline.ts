import type { EnterpriseConfig } from "../config/EnterpriseConfig.js";
import type {
  HookResult,
  ToolCallPayload,
  ToolCallContext,
  AgentIdentity,
} from "../events/EventTypes.js";
import type { EventBus } from "../events/EventBus.js";
import { Logger } from "../utils/logger.js";

export interface IFilesystemPolicy {
  checkAccess(
    path: string,
    operation: "read" | "write" | "execute",
    agent: AgentIdentity,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export interface INetworkPolicy {
  checkUrl(url: string, method: string): Promise<{
    allowed: boolean;
    reason?: string;
  }>;
}

export interface ISubagentScope {
  checkToolAccess(
    toolName: string,
    agent: AgentIdentity,
  ): Promise<{ allowed: boolean; reason?: string }>;
}

export interface ToolModules {
  filesystemPolicy?: IFilesystemPolicy;
  networkPolicy?: INetworkPolicy;
  subagentScope?: ISubagentScope;
}

interface PipelineMetrics {
  processed: number;
  blocked: number;
  errors: number;
  totalLatencyMs: number;
}

/**
 * Pipeline for tool call security:
 *   Tool Call → SubagentScope → FilesystemPolicy → NetworkPolicy → PASS/BLOCK
 */
export class ToolPipeline {
  private readonly config: EnterpriseConfig;
  private readonly modules: ToolModules;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly metrics: PipelineMetrics = {
    processed: 0,
    blocked: 0,
    errors: 0,
    totalLatencyMs: 0,
  };

  /** Tools that access the filesystem; checked against FilesystemPolicy */
  private static readonly FS_TOOLS = new Set([
    "read_file",
    "write_file",
    "edit_file",
    "create_file",
    "delete_file",
    "list_directory",
    "glob",
    "grep",
  ]);

  /** Tools that make network requests; checked against NetworkPolicy */
  private static readonly NET_TOOLS = new Set([
    "web_fetch",
    "http_request",
    "curl",
    "api_call",
  ]);

  constructor(
    config: EnterpriseConfig,
    modules: ToolModules,
    eventBus: EventBus,
    logger?: Logger,
  ) {
    this.config = config;
    this.modules = modules;
    this.eventBus = eventBus;
    this.logger = logger ?? new Logger("ToolPipeline");
  }

  async process(
    tool: ToolCallPayload,
    context: ToolCallContext,
  ): Promise<HookResult<ToolCallPayload>> {
    const start = performance.now();
    this.metrics.processed++;

    try {
      // Step 1: Subagent scope — can this agent use this tool at all?
      const scopeResult = await this.checkSubagentScope(tool, context);
      if (scopeResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(scopeResult, start);
      }

      // Step 2: Filesystem policy — if it's a file-related tool
      if (ToolPipeline.FS_TOOLS.has(tool.toolName)) {
        const fsResult = await this.checkFilesystem(tool, context);
        if (fsResult.action === "block") {
          this.metrics.blocked++;
          return this.finalize(fsResult, start);
        }
      }

      // Step 3: Network policy — if it's a network-related tool
      if (ToolPipeline.NET_TOOLS.has(tool.toolName)) {
        const netResult = await this.checkNetwork(tool, context);
        if (netResult.action === "block") {
          this.metrics.blocked++;
          return this.finalize(netResult, start);
        }
      }

      return this.finalize({ action: "allow", source: "ToolPipeline" }, start);
    } catch (err) {
      this.metrics.errors++;
      this.logger.error("ToolPipeline error", {
        error: String(err),
        tool: tool.toolName,
        agent: context.agent.id,
      });
      return this.finalize(
        { action: "allow", source: "ToolPipeline", reason: "pipeline-error-fail-open" },
        start,
      );
    }
  }

  getMetrics(): Readonly<PipelineMetrics> {
    return { ...this.metrics };
  }

  // ─── Individual checks ──────────────────────────────────────────────────

  private async checkSubagentScope(
    tool: ToolCallPayload,
    context: ToolCallContext,
  ): Promise<HookResult<ToolCallPayload>> {
    if (!this.modules.subagentScope) {
      return { action: "allow", source: "SubagentScope" };
    }

    const result = await this.modules.subagentScope.checkToolAccess(
      tool.toolName,
      context.agent,
    );
    if (result.allowed) {
      return { action: "allow", source: "SubagentScope" };
    }

    await this.eventBus.emit("security:violation", {
      module: "SubagentScope",
      severity: "medium",
      description: `Agent "${context.agent.name}" denied access to tool "${tool.toolName}"`,
      agent: context.agent,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? `Tool "${tool.toolName}" not allowed for this agent`,
      source: "SubagentScope",
    };
  }

  private async checkFilesystem(
    tool: ToolCallPayload,
    context: ToolCallContext,
  ): Promise<HookResult<ToolCallPayload>> {
    if (!this.config.security.filesystemPolicy.enabled || !this.modules.filesystemPolicy) {
      return { action: "allow", source: "FilesystemPolicy" };
    }

    const path = this.extractPath(tool);
    if (!path) {
      return { action: "allow", source: "FilesystemPolicy" };
    }

    const operation = this.inferFileOperation(tool.toolName);
    const result = await this.modules.filesystemPolicy.checkAccess(
      path,
      operation,
      context.agent,
    );

    if (result.allowed) {
      return { action: "allow", source: "FilesystemPolicy" };
    }

    await this.eventBus.emit("security:violation", {
      module: "FilesystemPolicy",
      severity: "high",
      description: `File ${operation} denied: ${path}`,
      agent: context.agent,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? `File access denied: ${path}`,
      source: "FilesystemPolicy",
    };
  }

  private async checkNetwork(
    tool: ToolCallPayload,
    context: ToolCallContext,
  ): Promise<HookResult<ToolCallPayload>> {
    if (!this.config.security.networkPolicy.enabled || !this.modules.networkPolicy) {
      return { action: "allow", source: "NetworkPolicy" };
    }

    const url = this.extractUrl(tool);
    if (!url) {
      return { action: "allow", source: "NetworkPolicy" };
    }

    const method = (tool.args["method"] as string | undefined) ?? "GET";
    const result = await this.modules.networkPolicy.checkUrl(url, method);

    if (result.allowed) {
      return { action: "allow", source: "NetworkPolicy" };
    }

    await this.eventBus.emit("security:violation", {
      module: "NetworkPolicy",
      severity: "high",
      description: `Network request blocked: ${method} ${url}`,
      agent: context.agent,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? `Network request denied: ${url}`,
      source: "NetworkPolicy",
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private extractPath(tool: ToolCallPayload): string | undefined {
    const candidates = ["path", "file_path", "filePath", "filename", "directory"];
    for (const key of candidates) {
      const val = tool.args[key];
      if (typeof val === "string" && val.length > 0) return val;
    }
    return undefined;
  }

  private extractUrl(tool: ToolCallPayload): string | undefined {
    const candidates = ["url", "endpoint", "uri", "href"];
    for (const key of candidates) {
      const val = tool.args[key];
      if (typeof val === "string" && val.length > 0) return val;
    }
    return undefined;
  }

  private inferFileOperation(
    toolName: string,
  ): "read" | "write" | "execute" {
    if (
      toolName === "write_file" ||
      toolName === "edit_file" ||
      toolName === "create_file" ||
      toolName === "delete_file"
    ) {
      return "write";
    }
    return "read";
  }

  private finalize<T>(result: HookResult<T>, startTime: number): HookResult<T> {
    result.latencyMs = performance.now() - startTime;
    this.metrics.totalLatencyMs += result.latencyMs;
    return result;
  }
}
