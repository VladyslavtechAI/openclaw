// ─── Plugin (main entry point) ──────────────────────────────────────────────
export { OpenClawEnterprisePlugin } from "./plugin/OpenClawEnterprisePlugin.js";
export type { GatewayConfig, AllModules } from "./plugin/OpenClawEnterprisePlugin.js";
export { PluginContext } from "./plugin/PluginContext.js";
export type { ModuleHealth } from "./plugin/PluginContext.js";

// ─── Pipelines ──────────────────────────────────────────────────────────────
export { SecurityPipeline } from "./pipeline/SecurityPipeline.js";
export type {
  IInjectionShield,
  IDlpEngine,
  IContentSafety,
  IExfilGuard,
  SecurityModules,
} from "./pipeline/SecurityPipeline.js";

export { ToolPipeline } from "./pipeline/ToolPipeline.js";
export type {
  IFilesystemPolicy,
  INetworkPolicy,
  ISubagentScope,
  ToolModules,
} from "./pipeline/ToolPipeline.js";

export { FilePipeline } from "./pipeline/FilePipeline.js";
export type {
  IBackdoorScanner,
  IAuditLogger,
  FileModules,
} from "./pipeline/FilePipeline.js";

export { AgentPipeline } from "./pipeline/AgentPipeline.js";
export type {
  IAgentHierarchy,
  ICostGovernor,
  ISubagentScopeForSpawn,
  AgentModules,
} from "./pipeline/AgentPipeline.js";

// ─── Config ─────────────────────────────────────────────────────────────────
export type {
  EnterpriseConfig,
  SecurityConfig,
  InfrastructureConfig,
  ComplianceConfig,
  MiddlewareConfig,
  DashboardConfig,
  InjectionShieldConfig,
  DlpConfig,
  NetworkPolicyConfig,
  FilesystemPolicyConfig,
  ContentSafetyConfig,
  ExfilGuardConfig,
  BackdoorScannerConfig,
  CostGovernorConfig,
  SmartRouterConfig,
  SelfHealerConfig,
  AgentHierarchyConfig,
  CredentialManagerConfig,
  DataRetentionConfig,
  RateLimiterConfig,
  AuthConfig,
} from "./config/EnterpriseConfig.js";
export { ConfigValidator } from "./config/ConfigValidator.js";
export type { ValidationError, ValidationResult } from "./config/ConfigValidator.js";
export { DEFAULT_CONFIG } from "./config/defaults.js";

// ─── Events ─────────────────────────────────────────────────────────────────
export { EventBus } from "./events/EventBus.js";
export type {
  HookAction,
  HookResult,
  AgentIdentity,
  MessageContext,
  MessagePayload,
  ToolCallContext,
  ToolCallPayload,
  ToolResultPayload,
  AgentSpawnConfig,
  FileAccessPayload,
  HttpRequestPayload,
  SecurityViolationEvent,
  CostThresholdEvent,
  AnomalyEvent,
  HealthEvent,
  EventMap,
} from "./events/EventTypes.js";

// ─── Dashboard ──────────────────────────────────────────────────────────────
export { DashboardProvider } from "./dashboard/DashboardProvider.js";
export type {
  StatusResponse,
  SecurityEvent,
  CostEntry,
  ComplianceStatus,
  ComplianceCheck,
  AuditEntry,
  WsMessage,
} from "./dashboard/DashboardProvider.js";
export { createDashboardRoutes, handleDashboardRequest } from "./dashboard/routes.js";

// ─── Middleware ──────────────────────────────────────────────────────────────
export { RequestValidator } from "./middleware/RequestValidator.js";
export type { RequestValidatorConfig } from "./middleware/RequestValidator.js";
export { RateLimiter } from "./middleware/RateLimiter.js";
export { AuditMiddleware } from "./middleware/AuditMiddleware.js";
export type { AuditEntry as MiddlewareAuditEntry, AuditMiddlewareConfig } from "./middleware/AuditMiddleware.js";
export { AuthEnhancer } from "./middleware/AuthEnhancer.js";
export type {
  IncomingRequest,
  OutgoingResponse,
  NextFunction,
  Middleware,
  MiddlewareMetrics,
} from "./middleware/types.js";

// ─── Utilities ──────────────────────────────────────────────────────────────
export { Logger } from "./utils/logger.js";
export type { LogLevel } from "./utils/logger.js";
export { sha256, generateId, encrypt, decrypt } from "./utils/crypto.js";
export type { EncryptedBlob } from "./utils/crypto.js";
