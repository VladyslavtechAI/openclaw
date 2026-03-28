import type { EnterpriseConfig } from "./EnterpriseConfig.js";
import { DEFAULT_CONFIG } from "./defaults.js";

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: readonly ValidationError[];
  config: EnterpriseConfig;
}

export class ConfigValidator {
  validate(partial: Record<string, unknown>): ValidationResult {
    const errors: ValidationError[] = [];
    const config = this.mergeDefaults(partial);

    this.validateSecurity(config, errors);
    this.validateInfrastructure(config, errors);
    this.validateCompliance(config, errors);
    this.validateMiddleware(config, errors);
    this.validateDashboard(config, errors);

    return { valid: errors.length === 0, errors, config };
  }

  mergeDefaults(partial: Record<string, unknown>): EnterpriseConfig {
    return deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      partial,
    ) as unknown as EnterpriseConfig;
  }

  private validateSecurity(
    config: EnterpriseConfig,
    errors: ValidationError[],
  ): void {
    const sec = config.security;

    if (
      sec.injectionShield.maxInputLength <= 0 ||
      sec.injectionShield.maxInputLength > 10_000_000
    ) {
      errors.push({
        path: "security.injectionShield.maxInputLength",
        message: "Must be between 1 and 10,000,000",
      });
    }

    if (sec.contentSafety.threshold < 0 || sec.contentSafety.threshold > 1) {
      errors.push({
        path: "security.contentSafety.threshold",
        message: "Must be between 0 and 1",
      });
    }

    if (sec.exfilGuard.maxPayloadBytes <= 0) {
      errors.push({
        path: "security.exfilGuard.maxPayloadBytes",
        message: "Must be positive",
      });
    }

    if (sec.backdoorScanner.scanIntervalMs < 1000) {
      errors.push({
        path: "security.backdoorScanner.scanIntervalMs",
        message: "Must be at least 1000ms",
      });
    }
  }

  private validateInfrastructure(
    config: EnterpriseConfig,
    errors: ValidationError[],
  ): void {
    const infra = config.infrastructure;

    if (infra.costGovernor.monthlyBudgetUsd < 0) {
      errors.push({
        path: "infrastructure.costGovernor.monthlyBudgetUsd",
        message: "Must be non-negative",
      });
    }

    if (infra.costGovernor.perAgentLimitUsd < 0) {
      errors.push({
        path: "infrastructure.costGovernor.perAgentLimitUsd",
        message: "Must be non-negative",
      });
    }

    if (
      infra.costGovernor.alertAtPercent < 0 ||
      infra.costGovernor.alertAtPercent > 100
    ) {
      errors.push({
        path: "infrastructure.costGovernor.alertAtPercent",
        message: "Must be between 0 and 100",
      });
    }

    if (infra.selfHealer.maxRetries < 0 || infra.selfHealer.maxRetries > 100) {
      errors.push({
        path: "infrastructure.selfHealer.maxRetries",
        message: "Must be between 0 and 100",
      });
    }

    if (
      infra.agentHierarchy.maxDepth < 1 ||
      infra.agentHierarchy.maxDepth > 20
    ) {
      errors.push({
        path: "infrastructure.agentHierarchy.maxDepth",
        message: "Must be between 1 and 20",
      });
    }

    if (
      infra.smartRouter.enabled &&
      infra.smartRouter.ollamaEndpoint === ""
    ) {
      errors.push({
        path: "infrastructure.smartRouter.ollamaEndpoint",
        message: "Required when smartRouter is enabled",
      });
    }
  }

  private validateCompliance(
    config: EnterpriseConfig,
    errors: ValidationError[],
  ): void {
    const c = config.compliance;

    if (c.dataRetention.defaultDays < 1) {
      errors.push({
        path: "compliance.dataRetention.defaultDays",
        message: "Must be at least 1",
      });
    }

    if (c.dataRetention.piiDays < 1) {
      errors.push({
        path: "compliance.dataRetention.piiDays",
        message: "Must be at least 1",
      });
    }

    if (c.dataRetention.piiDays > c.dataRetention.defaultDays) {
      errors.push({
        path: "compliance.dataRetention.piiDays",
        message: "PII retention should not exceed default retention",
      });
    }
  }

  private validateMiddleware(
    config: EnterpriseConfig,
    errors: ValidationError[],
  ): void {
    const mw = config.middleware;

    if (mw.rateLimiter.windowMs < 1000) {
      errors.push({
        path: "middleware.rateLimiter.windowMs",
        message: "Must be at least 1000ms",
      });
    }

    if (mw.rateLimiter.maxRequests < 1) {
      errors.push({
        path: "middleware.rateLimiter.maxRequests",
        message: "Must be at least 1",
      });
    }

    if (mw.auth.enabled && mw.auth.method !== "apiKey" && !mw.auth.jwtSecret) {
      errors.push({
        path: "middleware.auth.jwtSecret",
        message: "JWT secret required when auth method includes JWT",
      });
    }
  }

  private validateDashboard(
    config: EnterpriseConfig,
    errors: ValidationError[],
  ): void {
    const d = config.dashboard;

    if (d.port < 1 || d.port > 65535) {
      errors.push({
        path: "dashboard.port",
        message: "Must be between 1 and 65535",
      });
    }
  }
}

// ─── Deep merge utility ──────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(targetVal, sourceVal);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result;
}
