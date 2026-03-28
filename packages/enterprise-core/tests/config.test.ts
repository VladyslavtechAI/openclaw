import { describe, it, expect } from "vitest";
import { ConfigValidator } from "../src/config/ConfigValidator.js";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";

describe("ConfigValidator", () => {
  const validator = new ConfigValidator();

  it("validates default config as valid", () => {
    const result = validator.validate({});
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("merges partial config with defaults", () => {
    const result = validator.validate({
      security: {
        injectionShield: { mode: "permissive" },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.config.security.injectionShield.mode).toBe("permissive");
    expect(result.config.security.injectionShield.enabled).toBe(true);
    expect(result.config.security.dlp.enabled).toBe(true);
  });

  it("rejects negative maxInputLength", () => {
    const result = validator.validate({
      security: {
        injectionShield: { maxInputLength: -1 },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("maxInputLength"))).toBe(
      true,
    );
  });

  it("rejects content safety threshold > 1", () => {
    const result = validator.validate({
      security: {
        contentSafety: { threshold: 1.5 },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("threshold"))).toBe(true);
  });

  it("rejects negative monthly budget", () => {
    const result = validator.validate({
      infrastructure: {
        costGovernor: { monthlyBudgetUsd: -100 },
      },
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path.includes("monthlyBudgetUsd")),
    ).toBe(true);
  });

  it("rejects alert percent > 100", () => {
    const result = validator.validate({
      infrastructure: {
        costGovernor: { alertAtPercent: 150 },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects piiDays > defaultDays", () => {
    const result = validator.validate({
      compliance: {
        dataRetention: { defaultDays: 30, piiDays: 60, auditDays: 365 },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("piiDays"))).toBe(true);
  });

  it("rejects rate limiter window < 1000ms", () => {
    const result = validator.validate({
      middleware: {
        rateLimiter: { windowMs: 100 },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects JWT auth without secret", () => {
    const result = validator.validate({
      middleware: {
        auth: { enabled: true, method: "jwt", jwtSecret: "" },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("jwtSecret"))).toBe(true);
  });

  it("rejects invalid dashboard port", () => {
    const result = validator.validate({
      dashboard: { port: 0 },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects self healer max retries > 100", () => {
    const result = validator.validate({
      infrastructure: {
        selfHealer: { maxRetries: 200 },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects agent hierarchy max depth > 20", () => {
    const result = validator.validate({
      infrastructure: {
        agentHierarchy: { maxDepth: 50 },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("requires ollama endpoint when smartRouter enabled", () => {
    const result = validator.validate({
      infrastructure: {
        smartRouter: { enabled: true, ollamaEndpoint: "" },
      },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts valid custom config", () => {
    const result = validator.validate({
      enabled: true,
      security: {
        injectionShield: { enabled: true, mode: "moderate", maxInputLength: 50000 },
        dlp: { enabled: true, piiTypes: ["email"] },
        contentSafety: { threshold: 0.5 },
      },
      infrastructure: {
        costGovernor: { monthlyBudgetUsd: 500, perAgentLimitUsd: 50 },
      },
      compliance: {
        mode: "gdpr",
        dataRetention: { defaultDays: 60, piiDays: 30, auditDays: 365 },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.config.compliance.mode).toBe("gdpr");
  });

  it("collects multiple errors", () => {
    const result = validator.validate({
      security: {
        contentSafety: { threshold: 5 },
        injectionShield: { maxInputLength: -1 },
        exfilGuard: { maxPayloadBytes: -1 },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has all required top-level fields", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CONFIG.security).toBeDefined();
    expect(DEFAULT_CONFIG.infrastructure).toBeDefined();
    expect(DEFAULT_CONFIG.compliance).toBeDefined();
    expect(DEFAULT_CONFIG.middleware).toBeDefined();
    expect(DEFAULT_CONFIG.dashboard).toBeDefined();
  });

  it("has sensible security defaults", () => {
    expect(DEFAULT_CONFIG.security.injectionShield.enabled).toBe(true);
    expect(DEFAULT_CONFIG.security.injectionShield.mode).toBe("strict");
    expect(DEFAULT_CONFIG.security.dlp.enabled).toBe(true);
    expect(DEFAULT_CONFIG.security.networkPolicy.blockPrivateRanges).toBe(true);
  });

  it("has restrictive filesystem default", () => {
    expect(DEFAULT_CONFIG.security.filesystemPolicy.defaultMode).toBe(
      "restrictive",
    );
  });
});
