import type { EnterpriseConfig } from "../config/EnterpriseConfig.js";
import type {
  HookResult,
  MessagePayload,
  MessageContext,
} from "../events/EventTypes.js";
import type { EventBus } from "../events/EventBus.js";
import { Logger } from "../utils/logger.js";

/**
 * Stub interfaces for external security modules.
 * In production these are imported from `@openclaw-enterprise/security`.
 */
export interface IInjectionShield {
  scan(content: string): Promise<{ safe: boolean; reason?: string }>;
}

export interface IDlpEngine {
  scan(content: string, piiTypes: readonly string[]): Promise<{
    hasPii: boolean;
    findings: ReadonlyArray<{ type: string; value: string; offset: number }>;
    redacted: string;
  }>;
}

export interface IContentSafety {
  check(content: string, categories: readonly string[]): Promise<{
    safe: boolean;
    score: number;
    category?: string;
  }>;
}

export interface IExfilGuard {
  check(content: string, maxBytes: number): Promise<{
    safe: boolean;
    reason?: string;
  }>;
}

export interface SecurityModules {
  injectionShield?: IInjectionShield;
  dlpEngine?: IDlpEngine;
  contentSafety?: IContentSafety;
  exfilGuard?: IExfilGuard;
}

interface PipelineMetrics {
  processed: number;
  blocked: number;
  modified: number;
  errors: number;
  totalLatencyMs: number;
}

/**
 * Processes messages through a chain of security checks:
 *   Message → InjectionShield → DlpEngine → ContentSafety → ExfilGuard → PASS/BLOCK
 */
export class SecurityPipeline {
  private readonly config: EnterpriseConfig;
  private readonly modules: SecurityModules;
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
    modules: SecurityModules,
    eventBus: EventBus,
    logger?: Logger,
  ) {
    this.config = config;
    this.modules = modules;
    this.eventBus = eventBus;
    this.logger = logger ?? new Logger("SecurityPipeline");
  }

  async process(
    message: MessagePayload,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    const start = performance.now();
    this.metrics.processed++;

    try {
      // Step 1: Injection Shield
      const injectionResult = await this.runInjectionShield(
        message.content,
        context,
      );
      if (injectionResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(injectionResult, start);
      }

      // Step 2: DLP Engine
      const dlpResult = await this.runDlpEngine(message, context);
      if (dlpResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(dlpResult, start);
      }
      // DLP may have modified the message (redacted PII)
      const currentMessage =
        dlpResult.action === "modify" && dlpResult.modified
          ? dlpResult.modified
          : message;

      // Step 3: Content Safety
      const safetyResult = await this.runContentSafety(
        currentMessage.content,
        context,
      );
      if (safetyResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(safetyResult, start);
      }

      // Step 4: Exfiltration Guard
      const exfilResult = await this.runExfilGuard(
        currentMessage.content,
        context,
      );
      if (exfilResult.action === "block") {
        this.metrics.blocked++;
        return this.finalize(exfilResult, start);
      }

      // All checks passed
      if (dlpResult.action === "modify") {
        this.metrics.modified++;
        return this.finalize(
          {
            action: "modify",
            modified: currentMessage,
            source: "SecurityPipeline",
          },
          start,
        );
      }

      return this.finalize(
        { action: "allow", source: "SecurityPipeline" },
        start,
      );
    } catch (err) {
      this.metrics.errors++;
      this.logger.error("Pipeline error", {
        error: String(err),
        agent: context.agent.id,
      });
      // Fail-open: allow message through on pipeline error to avoid
      // blocking production traffic due to a module bug.
      // In strict mode we could fail-closed here.
      return this.finalize(
        { action: "allow", source: "SecurityPipeline", reason: "pipeline-error-fail-open" },
        start,
      );
    }
  }

  getMetrics(): Readonly<PipelineMetrics> {
    return { ...this.metrics };
  }

  // ─── Individual check runners ────────────────────────────────────────────

  private async runInjectionShield(
    content: string,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.config.security.injectionShield.enabled || !this.modules.injectionShield) {
      return { action: "allow", source: "InjectionShield" };
    }

    if (content.length > this.config.security.injectionShield.maxInputLength) {
      await this.emitViolation("InjectionShield", "high", "Input exceeds maximum length", context);
      return {
        action: "block",
        reason: "Input exceeds maximum allowed length",
        source: "InjectionShield",
      };
    }

    const result = await this.modules.injectionShield.scan(content);
    if (!result.safe) {
      await this.emitViolation(
        "InjectionShield",
        "critical",
        result.reason ?? "Prompt injection detected",
        context,
      );
      return {
        action: "block",
        reason: result.reason ?? "Prompt injection detected",
        source: "InjectionShield",
      };
    }
    return { action: "allow", source: "InjectionShield" };
  }

  private async runDlpEngine(
    message: MessagePayload,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.config.security.dlp.enabled || !this.modules.dlpEngine) {
      return { action: "allow", source: "DlpEngine" };
    }

    const result = await this.modules.dlpEngine.scan(
      message.content,
      this.config.security.dlp.piiTypes,
    );
    if (!result.hasPii) {
      return { action: "allow", source: "DlpEngine" };
    }

    this.logger.info("PII detected, redacting", {
      findings: result.findings.length,
      agent: context.agent.id,
    });

    return {
      action: "modify",
      modified: { ...message, content: result.redacted },
      source: "DlpEngine",
    };
  }

  private async runContentSafety(
    content: string,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.config.security.contentSafety.enabled || !this.modules.contentSafety) {
      return { action: "allow", source: "ContentSafety" };
    }

    const result = await this.modules.contentSafety.check(
      content,
      this.config.security.contentSafety.categories,
    );
    if (result.safe || result.score < this.config.security.contentSafety.threshold) {
      return { action: "allow", source: "ContentSafety" };
    }

    await this.emitViolation(
      "ContentSafety",
      "high",
      `Unsafe content detected (category=${result.category}, score=${result.score})`,
      context,
    );
    return {
      action: "block",
      reason: `Unsafe content: ${result.category} (score ${result.score.toFixed(2)})`,
      source: "ContentSafety",
    };
  }

  private async runExfilGuard(
    content: string,
    context: MessageContext,
  ): Promise<HookResult<MessagePayload>> {
    if (!this.config.security.exfilGuard.enabled || !this.modules.exfilGuard) {
      return { action: "allow", source: "ExfilGuard" };
    }

    const result = await this.modules.exfilGuard.check(
      content,
      this.config.security.exfilGuard.maxPayloadBytes,
    );
    if (result.safe) {
      return { action: "allow", source: "ExfilGuard" };
    }

    await this.emitViolation(
      "ExfilGuard",
      "critical",
      result.reason ?? "Potential data exfiltration detected",
      context,
    );
    return {
      action: "block",
      reason: result.reason ?? "Potential data exfiltration",
      source: "ExfilGuard",
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async emitViolation(
    module: string,
    severity: "low" | "medium" | "high" | "critical",
    description: string,
    context: MessageContext,
  ): Promise<void> {
    await this.eventBus.emit("security:violation", {
      module,
      severity,
      description,
      agent: context.agent,
      timestamp: Date.now(),
    });
  }

  private finalize<T>(result: HookResult<T>, startTime: number): HookResult<T> {
    result.latencyMs = performance.now() - startTime;
    this.metrics.totalLatencyMs += result.latencyMs;
    return result;
  }
}
