import type { EnterpriseConfig } from "./EnterpriseConfig.js";

export const DEFAULT_CONFIG: EnterpriseConfig = {
  enabled: true,
  security: {
    injectionShield: {
      enabled: true,
      mode: "strict",
      maxInputLength: 100_000,
    },
    dlp: {
      enabled: true,
      piiTypes: ["email", "phone", "ssn", "creditCard"],
      redactionStyle: "mask",
    },
    networkPolicy: {
      enabled: true,
      allowedDomains: [],
      blockedDomains: [],
      blockPrivateRanges: true,
    },
    filesystemPolicy: {
      enabled: true,
      defaultMode: "restrictive",
      allowedPaths: [],
      blockedPaths: ["/etc/shadow", "/etc/passwd"],
    },
    contentSafety: {
      enabled: true,
      threshold: 0.8,
      categories: ["harmful", "illegal", "hateful"],
    },
    exfilGuard: {
      enabled: true,
      maxPayloadBytes: 1_048_576,
      monitorClipboard: true,
      monitorNetwork: true,
    },
    backdoorScanner: {
      enabled: true,
      scanIntervalMs: 300_000,
      hashAlgorithm: "sha256",
    },
  },
  infrastructure: {
    costGovernor: {
      enabled: true,
      monthlyBudgetUsd: 1000,
      perAgentLimitUsd: 100,
      alertAtPercent: 80,
    },
    smartRouter: {
      enabled: false,
      localFirst: true,
      ollamaEndpoint: "http://localhost:11434",
      complexityThreshold: 0.7,
    },
    selfHealer: {
      enabled: true,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
      healthCheckIntervalMs: 60_000,
    },
    agentHierarchy: {
      enabled: true,
      maxDepth: 5,
      inheritPermissions: true,
    },
    credentialManager: {
      enabled: false,
      rotationIntervalMs: 86_400_000,
      vaultEndpoint: "",
    },
  },
  compliance: {
    mode: "standard",
    auditLog: true,
    dataRetention: {
      defaultDays: 90,
      piiDays: 30,
      auditDays: 365,
    },
  },
  middleware: {
    rateLimiter: {
      enabled: true,
      windowMs: 60_000,
      maxRequests: 100,
    },
    auth: {
      enabled: false,
      method: "apiKey",
      jwtSecret: "",
    },
  },
  dashboard: {
    enabled: false,
    port: 9100,
    wsEnabled: true,
  },
};
