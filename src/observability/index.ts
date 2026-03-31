/**
 * Observability module — centralized logging, alerting, metrics, and dashboard API.
 */

export {
  EventLogger,
  type ObservabilityEvent,
  type StoredEvent,
  type EventFilter,
  type TimeRange,
  type Metrics,
  type EventLevel,
  type EventCategory,
  type EventLoggerConfig,
} from "./event-logger.js";

export {
  AlertManager,
  type AlertRule,
  type AlertCondition,
  type AlertConditionType,
  type AlertChannel,
  type AlertChannelType,
  type Alert,
  type AlertManagerConfig,
} from "./alert-manager.js";

export {
  MetricsCollector,
  type MetricPoint,
  type StoredMetricPoint,
  type TimeRange as MetricTimeRange,
  type TimeSeries,
  type MetricsSummary,
  type AgentMetric,
  type MetricsCollectorConfig,
} from "./metrics-collector.js";

export {
  DashboardApi,
  type DashboardDeps,
  type DashboardConfig,
} from "./dashboard-api.js";

export {
  InterventionDetector,
  type InterventionType,
  type InterventionEvent,
  type InterventionAlert,
  type InterventionDetectorConfig,
} from "./intervention-detector.js";

export {
  ConfigGuardian,
  type ConfigChangeEvent,
  type ConfigValidationResult,
  type ConfigGuardianAlert,
  type ConfigGuardianConfig,
} from "./config-guardian.js";

export {
  HealthChecker,
  type RestartEvent,
  type ErrorEvent,
  type HealthAlert,
  type HealthStatus,
  type HealthCheckerConfig,
} from "./health-checker.js";

export {
  AuthValidator,
  type AuthValidationResult,
  type AuthFileSet,
  type EnvValidationResult,
} from "./auth-validator.js";

export {
  ResourceMonitor,
  type MachineResources,
  type BackupStatus,
  type ResourceAlert,
  type ResourceAlertSeverity,
  type ResourceThresholds,
  type ResourceMonitorConfig,
} from "./resource-monitor.js";

export {
  AutoFixer,
  type FixRule,
  type FixResult,
  type FixRecord,
  type FixPattern,
  type FixPatternType,
  type FixAction,
  type FixActionType,
  type MachineCheck,
  type AutoFixerConfig,
} from "./auto-fixer.js";

export {
  ErrorKnowledgeBase,
  type KnownError,
  type ErrorOccurrence,
  type ErrorKnowledgeBaseConfig,
} from "./error-knowledge-base.js";

export {
  LogAggregator,
  type LogEntry,
  type StoredLogEntry,
  type LogFilter,
  type LogLevel,
  type ErrorSummary,
  type LogAggregatorConfig,
} from "./log-aggregator.js";
