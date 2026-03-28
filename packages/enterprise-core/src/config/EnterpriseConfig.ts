// ─── Security Config ─────────────────────────────────────────────────────────

export interface InjectionShieldConfig {
  enabled: boolean;
  mode: "strict" | "moderate" | "permissive";
  maxInputLength: number;
}

export interface DlpConfig {
  enabled: boolean;
  piiTypes: readonly string[];
  redactionStyle: "mask" | "hash" | "remove";
}

export interface NetworkPolicyConfig {
  enabled: boolean;
  allowedDomains: readonly string[];
  blockedDomains: readonly string[];
  blockPrivateRanges: boolean;
}

export interface FilesystemPolicyConfig {
  enabled: boolean;
  defaultMode: "restrictive" | "permissive";
  allowedPaths: readonly string[];
  blockedPaths: readonly string[];
}

export interface ContentSafetyConfig {
  enabled: boolean;
  threshold: number;
  categories: readonly string[];
}

export interface ExfilGuardConfig {
  enabled: boolean;
  maxPayloadBytes: number;
  monitorClipboard: boolean;
  monitorNetwork: boolean;
}

export interface BackdoorScannerConfig {
  enabled: boolean;
  scanIntervalMs: number;
  hashAlgorithm: "sha256" | "sha512";
}

export interface SecurityConfig {
  injectionShield: InjectionShieldConfig;
  dlp: DlpConfig;
  networkPolicy: NetworkPolicyConfig;
  filesystemPolicy: FilesystemPolicyConfig;
  contentSafety: ContentSafetyConfig;
  exfilGuard: ExfilGuardConfig;
  backdoorScanner: BackdoorScannerConfig;
}

// ─── Infrastructure Config ───────────────────────────────────────────────────

export interface CostGovernorConfig {
  enabled: boolean;
  monthlyBudgetUsd: number;
  perAgentLimitUsd: number;
  alertAtPercent: number;
}

export interface SmartRouterConfig {
  enabled: boolean;
  localFirst: boolean;
  ollamaEndpoint: string;
  complexityThreshold: number;
}

export interface SelfHealerConfig {
  enabled: boolean;
  maxRetries: number;
  circuitBreakerThreshold: number;
  healthCheckIntervalMs: number;
}

export interface AgentHierarchyConfig {
  enabled: boolean;
  maxDepth: number;
  inheritPermissions: boolean;
}

export interface CredentialManagerConfig {
  enabled: boolean;
  rotationIntervalMs: number;
  vaultEndpoint: string;
}

export interface InfrastructureConfig {
  costGovernor: CostGovernorConfig;
  smartRouter: SmartRouterConfig;
  selfHealer: SelfHealerConfig;
  agentHierarchy: AgentHierarchyConfig;
  credentialManager: CredentialManagerConfig;
}

// ─── Compliance Config ───────────────────────────────────────────────────────

export interface DataRetentionConfig {
  defaultDays: number;
  piiDays: number;
  auditDays: number;
}

export interface ComplianceConfig {
  mode: "standard" | "gdpr" | "hipaa" | "sox";
  auditLog: boolean;
  dataRetention: DataRetentionConfig;
}

// ─── Middleware Config ───────────────────────────────────────────────────────

export interface RateLimiterConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
}

export interface AuthConfig {
  enabled: boolean;
  method: "apiKey" | "jwt" | "both";
  jwtSecret: string;
}

export interface MiddlewareConfig {
  rateLimiter: RateLimiterConfig;
  auth: AuthConfig;
}

// ─── Dashboard Config ────────────────────────────────────────────────────────

export interface DashboardConfig {
  enabled: boolean;
  port: number;
  wsEnabled: boolean;
}

// ─── Root Config ─────────────────────────────────────────────────────────────

export interface EnterpriseConfig {
  enabled: boolean;
  security: SecurityConfig;
  infrastructure: InfrastructureConfig;
  compliance: ComplianceConfig;
  middleware: MiddlewareConfig;
  dashboard: DashboardConfig;
}
