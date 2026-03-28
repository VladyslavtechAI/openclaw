import type { EnterpriseConfig } from "../config/EnterpriseConfig.js";
import type {
  HookResult,
  FileAccessPayload,
  AgentIdentity,
} from "../events/EventTypes.js";
import type { EventBus } from "../events/EventBus.js";
import type { IFilesystemPolicy } from "./ToolPipeline.js";
import { Logger } from "../utils/logger.js";

export interface IBackdoorScanner {
  verifyIntegrity(
    path: string,
    content?: string,
  ): Promise<{ clean: boolean; reason?: string }>;
}

export interface IAuditLogger {
  log(entry: {
    action: string;
    path: string;
    agent: AgentIdentity;
    result: "allow" | "block";
    reason?: string;
    timestamp: number;
  }): Promise<void>;
}

export interface FileModules {
  filesystemPolicy?: IFilesystemPolicy;
  backdoorScanner?: IBackdoorScanner;
  auditLogger?: IAuditLogger;
}

interface PipelineMetrics {
  processed: number;
  blocked: number;
  errors: number;
  totalLatencyMs: number;
}

/**
 * Pipeline for file access security:
 *   File Access → FilesystemPolicy → BackdoorScanner → AuditLogger → PASS/BLOCK
 */
export class FilePipeline {
  private readonly config: EnterpriseConfig;
  private readonly modules: FileModules;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly metrics: PipelineMetrics = {
    processed: 0,
    blocked: 0,
    errors: 0,
    totalLatencyMs: 0,
  };

  constructor(
    config: EnterpriseConfig,
    modules: FileModules,
    eventBus: EventBus,
    logger?: Logger,
  ) {
    this.config = config;
    this.modules = modules;
    this.eventBus = eventBus;
    this.logger = logger ?? new Logger("FilePipeline");
  }

  async process(
    payload: FileAccessPayload,
    agent: AgentIdentity,
  ): Promise<HookResult<FileAccessPayload>> {
    const start = performance.now();
    this.metrics.processed++;

    try {
      // Step 1: Filesystem policy check
      const policyResult = await this.checkFilesystemPolicy(payload, agent);
      if (policyResult.action === "block") {
        this.metrics.blocked++;
        await this.audit(payload, agent, "block", policyResult.reason);
        return this.finalize(policyResult, start);
      }

      // Step 2: Backdoor scanner (on writes only)
      if (
        (payload.operation === "write" || payload.operation === "execute") &&
        payload.content
      ) {
        const scanResult = await this.checkBackdoorScanner(payload, agent);
        if (scanResult.action === "block") {
          this.metrics.blocked++;
          await this.audit(payload, agent, "block", scanResult.reason);
          return this.finalize(scanResult, start);
        }
      }

      // Step 3: Audit log (always)
      await this.audit(payload, agent, "allow");

      return this.finalize(
        { action: "allow", source: "FilePipeline" },
        start,
      );
    } catch (err) {
      this.metrics.errors++;
      this.logger.error("FilePipeline error", {
        error: String(err),
        path: payload.path,
        agent: agent.id,
      });
      return this.finalize(
        { action: "allow", source: "FilePipeline", reason: "pipeline-error-fail-open" },
        start,
      );
    }
  }

  getMetrics(): Readonly<PipelineMetrics> {
    return { ...this.metrics };
  }

  private async checkFilesystemPolicy(
    payload: FileAccessPayload,
    agent: AgentIdentity,
  ): Promise<HookResult<FileAccessPayload>> {
    if (!this.config.security.filesystemPolicy.enabled || !this.modules.filesystemPolicy) {
      return { action: "allow", source: "FilesystemPolicy" };
    }

    const op =
      payload.operation === "delete" ? "write" : payload.operation;
    const result = await this.modules.filesystemPolicy.checkAccess(
      payload.path,
      op,
      agent,
    );

    if (result.allowed) {
      return { action: "allow", source: "FilesystemPolicy" };
    }

    await this.eventBus.emit("security:violation", {
      module: "FilesystemPolicy",
      severity: "high",
      description: `File ${payload.operation} denied: ${payload.path}`,
      agent,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? `Access denied: ${payload.path}`,
      source: "FilesystemPolicy",
    };
  }

  private async checkBackdoorScanner(
    payload: FileAccessPayload,
    agent: AgentIdentity,
  ): Promise<HookResult<FileAccessPayload>> {
    if (!this.config.security.backdoorScanner.enabled || !this.modules.backdoorScanner) {
      return { action: "allow", source: "BackdoorScanner" };
    }

    const result = await this.modules.backdoorScanner.verifyIntegrity(
      payload.path,
      payload.content,
    );

    if (result.clean) {
      return { action: "allow", source: "BackdoorScanner" };
    }

    await this.eventBus.emit("security:violation", {
      module: "BackdoorScanner",
      severity: "critical",
      description: `Integrity violation: ${payload.path} — ${result.reason}`,
      agent,
      timestamp: Date.now(),
    });

    return {
      action: "block",
      reason: result.reason ?? `Integrity check failed: ${payload.path}`,
      source: "BackdoorScanner",
    };
  }

  private async audit(
    payload: FileAccessPayload,
    agent: AgentIdentity,
    result: "allow" | "block",
    reason?: string,
  ): Promise<void> {
    if (!this.modules.auditLogger) return;

    await this.modules.auditLogger.log({
      action: `file:${payload.operation}`,
      path: payload.path,
      agent,
      result,
      reason,
      timestamp: Date.now(),
    });
  }

  private finalize<T>(result: HookResult<T>, startTime: number): HookResult<T> {
    result.latencyMs = performance.now() - startTime;
    this.metrics.totalLatencyMs += result.latencyMs;
    return result;
  }
}
